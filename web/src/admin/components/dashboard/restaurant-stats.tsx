import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Receipt, ShoppingBag, Users, Clock, XCircle, Info } from "lucide-react";
import { useRestaurantSocket } from "@/hooks/use-restaurant-socket";
import { orderApi } from "@/lib/order-server";
import { useRestaurantSettings } from "@/lib/bill";
import { useI18n } from "../../../shared/i18n";
import { ChartBox, pad2, PRIMARY_COLOR, useDateTools, useTooltipStyle } from "../reports/report-parts";

type Period = "today" | "week" | "month" | "year";

interface StatsData {
  period: Period;
  today: string;
  range: { from: string; to: string };
  topDishesRange: { days: number; from: string; to: string };
  summary: {
    orders_count: number;
    paid_orders: number;
    cancelled_orders: number;
    tables_served: number;
    revenue: number;
    average_ticket: number;
  };
  topDishes: { name: string; quantity: number; revenue: number }[];
  timeline: { label: string; orders: number; revenue: number }[];
  live: { active_orders: number; pending_orders: number; occupied_tables: number; total_tables: number };
}

const PERIODS: Period[] = ["today", "week", "month", "year"];

const StatTile = ({ title, value, hint, icon: Icon }: { title: string; value: string; hint?: string; icon: React.ComponentType<{ className?: string }> }) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      <div className="rounded-lg bg-primary/10 p-2 text-primary">
        <Icon className="h-4 w-4" />
      </div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </CardContent>
  </Card>
);

const addDays = (ymd: string, days: number) => {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Statistiques réelles du restaurant, calculées à partir des commandes enregistrées. */
export function RestaurantStats() {
  const { t, money: formatMoney, formatNumber } = useI18n();
  const settings = useRestaurantSettings();
  const dates = useDateTools();
  const tooltipStyle = useTooltipStyle();
  const money = (value: number) => formatMoney(value, settings?.currency);

  const [period, setPeriod] = useState<Period>("today");
  const [stats, setStats] = useState<StatsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await orderApi<StatsData>(`/stats?period=${period}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [period]);

  // Mise à jour en direct à chaque nouvelle commande ou changement de statut
  useRestaurantSocket({ onNewOrder: load, onStatusChanged: load });

  useEffect(() => {
    load();
  }, [load]);

  const s = stats?.summary;
  const live = stats?.live;
  const maxDishQuantity = Math.max(1, ...(stats?.topDishes || []).map((d) => d.quantity));

  // Bannière : quelle période couvrent les chiffres affichés
  const banner = useMemo(() => {
    if (!stats) return null;
    if (stats.period === "today") return t("stats.banner.today", { date: dates.day(stats.today, { dateStyle: "full" }) });
    return t(`stats.banner.${stats.period}`, {
      from: dates.day(stats.range.from, { dateStyle: "medium" }),
      to: dates.day(stats.range.to, { dateStyle: "medium" }),
    });
  }, [stats, dates, t]);

  // Courbe : par heure (aujourd'hui), par jour (7 jours, mois) ou par mois (année), les périodes sans activité à zéro
  const chart = useMemo(() => {
    if (!stats) return [];
    const byLabel = new Map(stats.timeline.map((point) => [point.label, point]));
    const hourly = stats.period === "today";
    const monthly = stats.period === "year";
    if (hourly) {
      return Array.from({ length: 24 }, (_, hour) => {
        const label = `${pad2(hour)}:00`;
        const point = byLabel.get(label);
        return { key: label, label, full: `${label} – ${pad2((hour + 1) % 24)}:00`, orders: point?.orders ?? 0, revenue: point?.revenue ?? 0 };
      });
    }
    if (monthly) {
      const year = Number(stats.today.slice(0, 4));
      return Array.from({ length: 12 }, (_, index) => {
        const prefix = `${year}-${pad2(index + 1)}`;
        const points = stats.timeline.filter((point) => point.label.startsWith(prefix));
        return {
          key: prefix,
          label: dates.month(year, index + 1, { month: "short" }),
          full: dates.month(year, index + 1, { month: "long", year: "numeric" }),
          orders: points.reduce((sum, point) => sum + point.orders, 0),
          revenue: points.reduce((sum, point) => sum + point.revenue, 0),
        };
      });
    }
    const days: string[] = [];
    for (let day = stats.range.from; day <= stats.range.to && days.length < 366; day = addDays(day, 1)) days.push(day);
    return days.map((day) => {
      const point = byLabel.get(day);
      return {
        key: day,
        label: dates.day(day, { day: "numeric", month: "short" }),
        full: dates.day(day, { dateStyle: "full" }),
        orders: point?.orders ?? 0,
        revenue: point?.revenue ?? 0,
      };
    });
  }, [stats, dates]);

  const chartTitle = period === "today" ? t("stats.revenueByHour") : period === "year" ? t("stats.revenueByMonth") : t("stats.revenueByDay");
  const hasActivity = chart.some((point) => point.orders > 0 || point.revenue > 0);

  return (
    <div className="space-y-6">
      {/* Filtre de période, au-dessus de tous les graphiques */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Button key={p} size="sm" variant={period === p ? "default" : "outline"} onClick={() => setPeriod(p)}>
            {t(`stats.period.${p}`)}
          </Button>
        ))}
      </div>

      {banner && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
          <Info className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="font-medium">{banner}</span>
        </div>
      )}

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-destructive">{t("stats.loadError", { message: error })}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatTile
          title={t("stats.revenue")}
          value={s ? money(s.revenue) : t("common.none")}
          hint={s ? t("stats.paidOrders", { count: s.paid_orders }) : undefined}
          icon={DollarSign}
        />
        <StatTile
          title={t("stats.orders")}
          value={s ? formatNumber(s.orders_count) : t("common.none")}
          hint={s && s.cancelled_orders > 0 ? t("stats.cancelled", { count: s.cancelled_orders }) : undefined}
          icon={ShoppingBag}
        />
        <StatTile title={t("stats.averageTicket")} value={s ? money(s.average_ticket) : t("common.none")} icon={Receipt} />
        <StatTile title={t("stats.tablesServed")} value={s ? formatNumber(s.tables_served) : t("common.none")} icon={Users} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatTile
          title={t("stats.occupiedNow")}
          value={live ? `${formatNumber(live.occupied_tables)}/${formatNumber(live.total_tables)}` : t("common.none")}
          icon={Users}
        />
        <StatTile title={t("stats.inProgress")} value={live ? formatNumber(live.active_orders) : t("common.none")} icon={Clock} />
        <StatTile title={t("stats.toConfirm")} value={live ? formatNumber(live.pending_orders) : t("common.none")} icon={XCircle} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">{chartTitle}</CardTitle>
            {stats && !hasActivity && <p className="text-sm text-muted-foreground">{t("stats.noOrdersPeriod")}</p>}
          </CardHeader>
          <CardContent>
            <ChartBox>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    interval={period === "year" ? 0 : "preserveStartEnd"}
                    minTickGap={8}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    width={52}
                    tickFormatter={(value: number) => formatNumber(value, { notation: "compact", maximumFractionDigits: 1 })}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    contentStyle={tooltipStyle}
                    formatter={(value: number) => [money(value), t("stats.revenue")]}
                    labelFormatter={(_label, payload) => {
                      const point = payload?.[0]?.payload;
                      return point ? `${point.full} · ${t("stats.ordersCount", { count: point.orders })}` : "";
                    }}
                  />
                  <Bar dataKey="revenue" fill={PRIMARY_COLOR} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </ChartBox>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-lg">{t("stats.topDishes")}</CardTitle>
              <Badge variant="secondary">{t("stats.last30")}</Badge>
            </div>
            {stats && (
              <p className="text-xs text-muted-foreground">
                {t("stats.topRange", {
                  from: dates.day(stats.topDishesRange.from, { dateStyle: "medium" }),
                  to: dates.day(stats.topDishesRange.to, { dateStyle: "medium" }),
                })}
                {" · "}
                {t("stats.topNote")}
              </p>
            )}
          </CardHeader>
          <CardContent>
            {stats && stats.topDishes.length > 0 ? (
              <ol className="space-y-3">
                {stats.topDishes.map((dish, index) => (
                  <li key={dish.name} className="space-y-1">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="font-medium">{formatNumber(index + 1)}. {dish.name}</span>
                      <span className="whitespace-nowrap text-muted-foreground">× {formatNumber(dish.quantity)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(dish.quantity / maxDishQuantity) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">{t("stats.noDishes")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
