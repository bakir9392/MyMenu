import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, Receipt, ShoppingBag, Users, Clock, XCircle } from "lucide-react";
import { useLanguage } from "@/contexts/language-context";
import { useRestaurantSocket } from "@/hooks/use-restaurant-socket";
import { orderApi, RestaurantStats as Stats } from "@/lib/order-server";

type Period = "today" | "week" | "month" | "year";

const StatTile = ({ title, value, hint, icon: Icon }: { title: string; value: string; hint?: string; icon: any }) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      <div className="p-2 rounded-lg text-primary bg-primary/10">
        <Icon className="w-4 h-4" />
      </div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </CardContent>
  </Card>
);

/** Statistiques réelles du restaurant, calculées à partir des commandes enregistrées. */
export function RestaurantStats() {
  const { language, t } = useLanguage();
  const L = (fr: string, ar: string) => (language === "ar" ? ar : fr);
  const currency = t("common.currency");
  const [period, setPeriod] = useState<Period>("today");
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await orderApi<Stats>(`/stats?period=${period}`));
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

  const money = (value: number) =>
    `${Math.round(value).toLocaleString(language === "ar" ? "ar-DZ" : "fr-FR")} ${currency}`;

  const periods: { id: Period; label: string }[] = [
    { id: "today", label: L("Aujourd'hui", "اليوم") },
    { id: "week", label: L("7 jours", "7 أيام") },
    { id: "month", label: L("Ce mois", "هذا الشهر") },
    { id: "year", label: L("Cette année", "هذه السنة") },
  ];

  const s = stats?.summary;
  const live = stats?.live;
  const maxDishQuantity = Math.max(1, ...(stats?.topDishes || []).map((d) => d.quantity));

  return (
    <div className="space-y-6">
      {/* Filtre de période, au-dessus de tous les graphiques */}
      <div className="flex flex-wrap gap-2">
        {periods.map((p) => (
          <Button key={p.id} size="sm" variant={period === p.id ? "default" : "outline"} onClick={() => setPeriod(p.id)}>
            {p.label}
          </Button>
        ))}
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-destructive">
            {L("Impossible de joindre le serveur de commandes :", "تعذر الاتصال بخادم الطلبات:")} {error}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatTile title={L("Chiffre d'affaires", "رقم الأعمال")} value={s ? money(s.revenue) : "–"}
          hint={s ? L(`${s.paid_orders} commande(s) encaissée(s)`, `${s.paid_orders} طلب مدفوع`) : undefined} icon={DollarSign} />
        <StatTile title={L("Commandes", "الطلبات")} value={s ? String(s.orders_count) : "–"}
          hint={s && s.cancelled_orders > 0 ? L(`${s.cancelled_orders} annulée(s)`, `${s.cancelled_orders} ملغاة`) : undefined} icon={ShoppingBag} />
        <StatTile title={L("Ticket moyen", "متوسط الفاتورة")} value={s ? money(s.average_ticket) : "–"} icon={Receipt} />
        <StatTile title={L("Tables servies", "الطاولات المخدومة")} value={s ? String(s.tables_served) : "–"} icon={Users} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatTile title={L("Tables occupées maintenant", "الطاولات المشغولة الآن")}
          value={live ? `${live.occupied_tables}/${live.total_tables}` : "–"} icon={Users} />
        <StatTile title={L("Commandes en cours", "الطلبات الجارية")} value={live ? String(live.active_orders) : "–"} icon={Clock} />
        <StatTile title={L("Nouvelles commandes à confirmer", "طلبات جديدة للتأكيد")} value={live ? String(live.pending_orders) : "–"} icon={XCircle} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">
              {period === "today"
                ? L("Chiffre d'affaires par heure", "رقم الأعمال حسب الساعة")
                : L("Chiffre d'affaires par jour", "رقم الأعمال حسب اليوم")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats && stats.timeline.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={stats.timeline} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={56} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--foreground))" }}
                    formatter={(value: number) => [money(value), L("Chiffre d'affaires", "رقم الأعمال")]}
                    labelFormatter={(label, payload) => {
                      const orders = payload?.[0]?.payload?.orders ?? 0;
                      return `${label} · ${orders} ${L("commande(s)", "طلب")}`;
                    }}
                  />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[280px] flex items-center justify-center text-muted-foreground">
                {L("Pas encore de commandes sur cette période", "لا توجد طلبات في هذه الفترة بعد")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{L("Plats les plus commandés", "الأطباق الأكثر طلباً")}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats && stats.topDishes.length > 0 ? (
              <ol className="space-y-3">
                {stats.topDishes.map((dish, index) => (
                  <li key={dish.name} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{index + 1}. {dish.name}</span>
                      <span className="text-muted-foreground">× {dish.quantity}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(dish.quantity / maxDishQuantity) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground text-sm">{L("Aucune donnée", "لا توجد بيانات")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
