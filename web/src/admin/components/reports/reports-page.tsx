import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock, Download, Info, Loader2, Receipt, RefreshCw, ShoppingBag,
  TrendingUp, Trophy, Users, Wallet,
} from "lucide-react";
import { orderApi } from "@/lib/order-server";
import { useRestaurantSettings } from "@/lib/bill";
import { parseServerDate, useI18n } from "../../../shared/i18n";
import {
  ChartBox, Delta, KpiTile, ORDERS_COLOR, pad2, PRIMARY_COLOR, useDateTools, useTooltipStyle, VISITS_COLOR,
} from "./report-parts";

type Mode = "day" | "month" | "year";

interface PeriodSummary {
  revenue: number;
  invoices: number;
  average_ticket: number;
  tax: number;
  service: number;
  orders: number;
  cancelled: number;
  visits: number;
  orders_per_visit: number;
  revenue_per_visit: number;
}

interface Report {
  timezone: string;
  today: string;
  currentMonth: string;
  mode: Mode;
  selection: { mode: Mode; year: number; month: number | null; day: string | null; from: string; to: string };
  bucket: "hour" | "day" | "month";
  years: number[];
  kpis: { today_revenue: number; month_revenue: number; year_revenue: number; all_time_revenue: number; all_time_invoices: number };
  summary: PeriodSummary;
  previous: PeriodSummary;
  timeline: { bucket: number; revenue: number; invoices: number; orders: number; visits: number }[];
  topDishes: { name: string; quantity: number; revenue: number; orders: number }[];
  busiestHours: { hour: number; orders: number }[];
  busiestMonths: { label: string; orders: number; amount: number }[];
  cashiers: {
    name: string;
    status: "active" | "inactive" | null;
    invoices: number;
    revenue: number;
    average_ticket: number;
    last_payment: string | null;
    complaints: number;
  }[];
  yearly: { year: number; revenue: number; invoices: number }[];
  clients: {
    visits: number;
    previous_visits: number;
    orders_per_visit: number;
    revenue_per_visit: number;
    by_hour: { hour: number; visits: number }[];
    by_weekday: { weekday: number; visits: number }[];
  };
}

const MODES: Mode[] = ["day", "month", "year"];
const NOT_RECORDED = "Not recorded";

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const toYmd = (year: number, month: number, day: number) => `${year}-${pad2(month)}-${pad2(day)}`;
const parseYmd = (ymd: string) => {
  const [year, month, day] = ymd.split("-").map(Number);
  return { year, month, day };
};

/** Date de référence décalée d'un jour / mois / an (le jour du mois est borné à la longueur du nouveau mois) */
function shiftAnchor(anchor: string, mode: Mode, direction: 1 | -1): string {
  const { year, month, day } = parseYmd(anchor);
  if (mode === "day") {
    const date = new Date(Date.UTC(year, month - 1, day + direction));
    return toYmd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  if (mode === "month") {
    const index = year * 12 + (month - 1) + direction;
    const nextYear = Math.floor(index / 12);
    const nextMonth = (index % 12) + 1;
    return toYmd(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
  }
  return toYmd(year + direction, month, Math.min(day, daysInMonth(year + direction, month)));
}

const startsAfter = (anchor: string, mode: Mode, today: string) => {
  const size = mode === "day" ? 10 : mode === "month" ? 7 : 4;
  return anchor.slice(0, size) > today.slice(0, size);
};

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/40";

/** Rapports : une période au choix (jour, mois ou année), comparée à la précédente, avec chiffre d'affaires, clients, plats et caissiers */
export function ReportsPage() {
  const { t, money: formatMoney, formatNumber, formatDateTime, isRtl } = useI18n();
  const settings = useRestaurantSettings();
  const dates = useDateTools();
  const tooltipStyle = useTooltipStyle();
  const currency = settings?.currency;
  const timezone = settings?.timezone;
  const money = (value: number) => formatMoney(value, currency);

  const [mode, setMode] = useState<Mode>("day");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const fetchedKey = useRef<string | null>(null);

  const load = useCallback(async (nextMode: Mode, nextAnchor: string | null) => {
    const id = ++requestId.current;
    setLoading(true);
    let query = `mode=${nextMode}`;
    if (nextAnchor) {
      const { year, month, day } = parseYmd(nextAnchor);
      if (nextMode === "day") query += `&day=${toYmd(year, month, day)}`;
      else if (nextMode === "month") query += `&year=${year}&month=${month}`;
      else query += `&year=${year}`;
    }
    try {
      const data = await orderApi<Report>(`/reports?${query}`);
      if (id !== requestId.current) return;
      setReport(data);
      setError(null);
      if (!nextAnchor) {
        // Première réponse : le serveur donne « aujourd'hui » dans le fuseau du restaurant
        fetchedKey.current = `${nextMode}|${data.today}`;
        setAnchor(data.today);
      }
    } catch (e) {
      if (id === requestId.current) setError((e as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const key = `${mode}|${anchor}`;
    if (fetchedKey.current === key) return;
    fetchedKey.current = key;
    load(mode, anchor);
  }, [mode, anchor, load]);

  const today = report?.today ?? null;
  const current = anchor ?? today;
  const currentParts = current ? parseYmd(current) : null;
  const nextDisabled = !current || !today || startsAfter(shiftAnchor(current, mode, 1), mode, today);

  const yearOptions = useMemo(() => {
    const years = new Set<number>(report?.years ?? []);
    if (currentParts) years.add(currentParts.year);
    if (today) years.add(parseYmd(today).year);
    return [...years].sort((a, b) => b - a);
  }, [report?.years, currentParts?.year, today]);

  const setYear = (year: number) => {
    if (!current) return;
    const { month, day } = parseYmd(current);
    setAnchor(toYmd(year, month, Math.min(day, daysInMonth(year, month))));
  };
  const setMonth = (month: number) => {
    if (!current) return;
    const { year, day } = parseYmd(current);
    setAnchor(toYmd(year, month, Math.min(day, daysInMonth(year, month))));
  };

  // Tout ce qui s'affiche vient de la dernière réponse du serveur (report), pas des sélecteurs en cours de changement
  const view = useMemo(() => {
    if (!report) return null;
    const { selection } = report;
    const hourLabel = (hour: number) => `${pad2(hour)}:00`;
    const bucketLabel = (bucket: number) =>
      report.bucket === "hour" ? hourLabel(bucket)
        : report.bucket === "day" ? String(bucket)
        : dates.month(selection.year, bucket, { month: "short" });
    const bucketFull = (bucket: number) =>
      report.bucket === "hour" ? `${hourLabel(bucket)} – ${hourLabel((bucket + 1) % 24)}`
        : report.bucket === "day" ? dates.day(toYmd(selection.year, selection.month ?? 1, bucket), { dateStyle: "full" })
        : dates.month(selection.year, bucket, { month: "long", year: "numeric" });
    const bucketCsv = (bucket: number) =>
      report.bucket === "hour" ? hourLabel(bucket)
        : report.bucket === "day" ? toYmd(selection.year, selection.month ?? 1, bucket)
        : `${selection.year}-${pad2(bucket)}`;
    const timeline = report.timeline.map((point) => ({ ...point, label: bucketLabel(point.bucket), full: bucketFull(point.bucket) }));

    const weekdays = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      label: dates.weekday(weekday, "short"),
      full: dates.weekday(weekday, "long"),
      visits: report.clients.by_weekday.find((row) => row.weekday === weekday)?.visits ?? 0,
    }));
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: hourLabel(hour),
      full: `${hourLabel(hour)} – ${hourLabel((hour + 1) % 24)}`,
      visits: report.clients.by_hour.find((row) => row.hour === hour)?.visits ?? 0,
    }));

    const title =
      selection.mode === "day" && selection.day
        ? t("reports.periodDay", { date: dates.day(selection.day, { dateStyle: "full" }) })
        : selection.mode === "month"
          ? t("reports.periodMonth", { month: dates.month(selection.year, selection.month ?? 1, { month: "long", year: "numeric" }) })
          : t("reports.periodYear", { year: selection.year });
    const range =
      selection.mode === "day"
        ? null
        : t("reports.periodRange", {
            from: dates.day(selection.from, { dateStyle: "medium" }),
            to: dates.day(selection.to, { dateStyle: "medium" }),
          });
    const fileSuffix = selection.mode === "day" ? selection.day : selection.mode === "month" ? `${selection.year}-${pad2(selection.month ?? 1)}` : String(selection.year);
    return { selection, timeline, weekdays, hours, title, range, fileSuffix, hourLabel, bucketCsv };
  }, [report, dates, t]);

  const monthLabel = (month: number) => dates.month(2024, month, { month: "long" });
  const monthKeyLabel = (label: string) => {
    const [year, month] = label.split("-").map(Number);
    return dates.month(year, month, { month: "long", year: "numeric" });
  };

  const exportCsv = () => {
    if (!report || !view) return;
    const num = (value: number) => formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
    // Un texte qui commence par = + - @ serait interprété comme une formule par le tableur
    const safe = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
    const { summary: s, previous: p, clients } = report;
    const notRecorded = t("reports.cashiers.notRecorded");
    const rows: (string | number)[][] = [
      [t("reports.csv.report"), view.title],
      [t("reports.csv.currency"), currency ?? ""],
      [t("reports.csv.from"), view.selection.from, t("reports.csv.to"), view.selection.to],
      [],
      [t("reports.csv.summary")],
      [t("reports.csv.metric"), t("reports.csv.value"), t("reports.csv.previous")],
      [t("reports.kpi.revenue"), num(s.revenue), num(p.revenue)],
      [t("reports.kpi.invoices"), s.invoices, p.invoices],
      [t("reports.kpi.orders"), s.orders, p.orders],
      [t("reports.csv.cancelled"), s.cancelled, p.cancelled],
      [t("reports.kpi.avgTicket"), num(s.average_ticket), num(p.average_ticket)],
      [t("reports.csv.tax"), num(s.tax), num(p.tax)],
      [t("reports.csv.service"), num(s.service), num(p.service)],
      [t("reports.kpi.visits"), s.visits, p.visits],
      [],
      [t("reports.csv.timeline")],
      [t("reports.csv.bucket"), t("reports.kpi.revenue"), t("reports.kpi.invoices"), t("reports.kpi.orders"), t("reports.kpi.visits")],
      ...report.timeline.map((point) => [view.bucketCsv(point.bucket), num(point.revenue), point.invoices, point.orders, point.visits]),
      [],
      [t("reports.dishes.title")],
      [t("reports.csv.dish"), t("reports.csv.quantity"), t("reports.kpi.revenue"), t("reports.kpi.orders")],
      ...report.topDishes.map((d) => [safe(d.name), d.quantity, num(d.revenue), d.orders]),
      [],
      [t("reports.cashiers.title")],
      [t("reports.cashiers.cashier"), t("reports.cashiers.tablesPaid"), t("reports.kpi.revenue"), t("reports.kpi.avgTicket"), t("reports.cashiers.complaints")],
      ...report.cashiers.map((c) => [
        c.name === NOT_RECORDED ? notRecorded : safe(c.name), c.invoices, num(c.revenue), num(c.average_ticket), c.complaints,
      ]),
      [],
      [t("reports.clients.title")],
      [t("reports.csv.metric"), t("reports.csv.value"), t("reports.csv.previous")],
      [t("reports.kpi.visits"), clients.visits, clients.previous_visits],
      [t("reports.clients.ordersPerVisit"), num(clients.orders_per_visit), num(p.orders_per_visit)],
      [t("reports.clients.revenuePerVisit"), num(clients.revenue_per_visit), num(p.revenue_per_visit)],
      [],
      [t("reports.csv.weekday"), t("reports.kpi.visits")],
      ...view.weekdays.map((w) => [w.full, w.visits]),
      [],
      [t("reports.csv.hour"), t("reports.kpi.visits")],
      ...view.hours.map((h) => [h.label, h.visits]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `report-${view.fileSuffix}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const shortcutLabel = t(`reports.shortcut.${mode}`);
  const goNow = () => today && setAnchor(today);
  const compareLabel = t(`reports.compare.${report?.mode ?? mode}`);
  const axisNumber = (value: number) => formatNumber(value, { notation: "compact", maximumFractionDigits: 1 });
  const maxDish = Math.max(1, ...(report?.topDishes ?? []).map((d) => d.quantity));
  const maxMonthOrders = Math.max(1, ...(report?.busiestMonths ?? []).map((m) => m.orders));
  const maxHourOrders = Math.max(1, ...(report?.busiestHours ?? []).map((h) => h.orders));
  const chartMargin = { top: 8, right: 8, left: 0, bottom: 0 };
  const noActivity = report ? report.summary.orders === 0 && report.summary.invoices === 0 : false;

  const stepButton = (direction: 1 | -1) => (
    <Button
      variant="outline"
      size="icon"
      className="h-9 w-9"
      disabled={!current || (direction === 1 && nextDisabled)}
      onClick={() => current && setAnchor(shiftAnchor(current, mode, direction))}
      aria-label={t(`reports.${direction === 1 ? "next" : "prev"}.${mode}`)}
      title={t(`reports.${direction === 1 ? "next" : "prev"}.${mode}`)}
    >
      {(direction === -1) === !isRtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </Button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="bg-gradient-primary bg-clip-text text-3xl font-bold text-transparent">{t("reports.title")}</h1>
        <p className="text-muted-foreground">{t("reports.subtitle")}</p>
      </div>

      {/* Filtre de période : au-dessus de tous les graphiques */}
      <Card className="border-primary/30">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border bg-muted/40 p-1" role="group" aria-label={t("reports.filter.label")}>
              {MODES.map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={mode === m ? "default" : "ghost"}
                  className="h-8 px-4"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                >
                  {t(`reports.mode.${m}`)}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {stepButton(-1)}
              {current && currentParts ? (
                <>
                  {mode === "day" && (
                    <input
                      type="date"
                      className={selectClass}
                      value={current}
                      max={today ?? undefined}
                      aria-label={t("reports.pick.day")}
                      onChange={(event) => event.target.value && setAnchor(event.target.value)}
                    />
                  )}
                  {mode === "month" && (
                    <select
                      className={selectClass}
                      value={currentParts.month}
                      aria-label={t("reports.pick.month")}
                      onChange={(event) => setMonth(Number(event.target.value))}
                    >
                      {Array.from({ length: 12 }, (_, index) => (
                        <option key={index} value={index + 1}>{monthLabel(index + 1)}</option>
                      ))}
                    </select>
                  )}
                  {mode !== "day" && (
                    <select
                      className={selectClass}
                      value={currentParts.year}
                      aria-label={t("reports.pick.year")}
                      onChange={(event) => setYear(Number(event.target.value))}
                    >
                      {yearOptions.map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                  )}
                </>
              ) : (
                <span className="px-2 text-sm text-muted-foreground">{t("reports.loading")}</span>
              )}
              {stepButton(1)}
              <Button variant="secondary" size="sm" className="h-9" onClick={goNow} disabled={!today}>
                {shortcutLabel}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 ms-auto">
              <Button variant="outline" size="sm" className="h-9" onClick={() => load(mode, anchor)} disabled={loading}>
                <RefreshCw className={`me-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {t("reports.refresh")}
              </Button>
              <Button size="sm" className="h-9" onClick={exportCsv} disabled={!report || !view}>
                <Download className="me-2 h-4 w-4" />
                {t("reports.export")}
              </Button>
            </div>
          </div>

          {view && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm">
              <CalendarDays className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span className="font-semibold">{view.title}</span>
              {view.range && <span className="text-muted-foreground">· {view.range}</span>}
              {loading && <Loader2 className="ms-1 h-4 w-4 animate-spin text-muted-foreground" aria-label={t("reports.loading")} />}
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-destructive">
            <span>{t("reports.error", { message: error })}</span>
            <Button variant="outline" size="sm" onClick={() => load(mode, anchor)}>
              {t("reports.retry")}
            </Button>
          </CardContent>
        </Card>
      )}

      {!report && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          {t("reports.loading")}
        </div>
      )}

      {report && view && (
        <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {/* Indicateurs de la période, comparés à la précédente */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <KpiTile
              title={t("reports.kpi.revenue")}
              value={money(report.summary.revenue)}
              icon={Wallet}
              footer={<Delta current={report.summary.revenue} previous={report.previous.revenue} compareLabel={compareLabel} previousText={money(report.previous.revenue)} />}
            />
            <KpiTile
              title={t("reports.kpi.invoices")}
              value={formatNumber(report.summary.invoices)}
              icon={Receipt}
              footer={<Delta current={report.summary.invoices} previous={report.previous.invoices} compareLabel={compareLabel} previousText={formatNumber(report.previous.invoices)} />}
            />
            <KpiTile
              title={t("reports.kpi.orders")}
              value={formatNumber(report.summary.orders)}
              hint={report.summary.cancelled > 0 ? t("reports.kpi.cancelled", { count: report.summary.cancelled }) : undefined}
              icon={ShoppingBag}
              footer={<Delta current={report.summary.orders} previous={report.previous.orders} compareLabel={compareLabel} previousText={formatNumber(report.previous.orders)} />}
            />
            <KpiTile
              title={t("reports.kpi.avgTicket")}
              value={report.summary.invoices ? money(report.summary.average_ticket) : t("common.none")}
              icon={TrendingUp}
              footer={<Delta current={report.summary.average_ticket} previous={report.previous.average_ticket} compareLabel={compareLabel} previousText={money(report.previous.average_ticket)} />}
            />
            <KpiTile
              title={t("reports.kpi.visits")}
              value={formatNumber(report.summary.visits)}
              icon={Users}
              footer={<Delta current={report.summary.visits} previous={report.clients.previous_visits} compareLabel={compareLabel} previousText={formatNumber(report.clients.previous_visits)} />}
            />
          </div>

          {/* Chiffre d'affaires sur la période */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t(`reports.chart.revenue.${report.bucket}`)}</CardTitle>
              {noActivity && <p className="text-sm text-muted-foreground">{t("reports.chart.empty")}</p>}
            </CardHeader>
            <CardContent>
              <ChartBox>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={view.timeline} margin={chartMargin}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      fontSize={12}
                      interval={report.bucket === "month" ? 0 : "preserveStartEnd"}
                      minTickGap={6}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis yAxisId="revenue" tickLine={false} axisLine={false} fontSize={12} width={52} tickFormatter={axisNumber} stroke="hsl(var(--muted-foreground))" />
                    <YAxis yAxisId="orders" orientation="right" hide allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                      contentStyle={tooltipStyle}
                      formatter={(value: number, _name, item) => [
                        item.dataKey === "revenue" ? money(value) : formatNumber(value),
                        item.dataKey === "revenue" ? t("reports.chart.revenue") : t("reports.chart.orders"),
                      ]}
                      labelFormatter={(_label, payload) => payload?.[0]?.payload?.full ?? ""}
                    />
                    <Legend />
                    <Bar yAxisId="revenue" dataKey="revenue" name={t("reports.chart.revenue")} fill={PRIMARY_COLOR} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    <Line yAxisId="orders" dataKey="orders" name={t("reports.chart.orders")} type="monotone" stroke={ORDERS_COLOR} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartBox>
            </CardContent>
          </Card>

          {/* Clients */}
          <section className="space-y-4">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <Users className="h-5 w-5 text-primary" />
                {t("reports.clients.title")}
              </h2>
              <p className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{t("reports.clients.note")}</span>
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <KpiTile
                title={t("reports.kpi.visits")}
                value={formatNumber(report.clients.visits)}
                icon={Users}
                footer={<Delta current={report.clients.visits} previous={report.clients.previous_visits} compareLabel={compareLabel} previousText={formatNumber(report.clients.previous_visits)} />}
              />
              <KpiTile
                title={t("reports.clients.ordersPerVisit")}
                value={formatNumber(report.clients.orders_per_visit, { maximumFractionDigits: 2 })}
                icon={ShoppingBag}
                footer={<Delta current={report.clients.orders_per_visit} previous={report.previous.orders_per_visit} compareLabel={compareLabel} previousText={formatNumber(report.previous.orders_per_visit, { maximumFractionDigits: 2 })} />}
              />
              <KpiTile
                title={t("reports.clients.revenuePerVisit")}
                value={money(report.clients.revenue_per_visit)}
                icon={Wallet}
                footer={<Delta current={report.clients.revenue_per_visit} previous={report.previous.revenue_per_visit} compareLabel={compareLabel} previousText={money(report.previous.revenue_per_visit)} />}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t(`reports.clients.over.${report.bucket}`)}</CardTitle>
                {report.clients.visits === 0 && <p className="text-sm text-muted-foreground">{t("reports.clients.empty")}</p>}
              </CardHeader>
              <CardContent>
                <ChartBox>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={view.timeline} margin={chartMargin}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} interval={report.bucket === "month" ? 0 : "preserveStartEnd"} minTickGap={6} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tickLine={false} axisLine={false} fontSize={12} width={40} allowDecimals={false} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                        contentStyle={tooltipStyle}
                        formatter={(value: number) => [formatNumber(value), t("reports.kpi.visits")]}
                        labelFormatter={(_label, payload) => payload?.[0]?.payload?.full ?? ""}
                      />
                      <Bar dataKey="visits" fill={VISITS_COLOR} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartBox>
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t("reports.clients.byWeekday")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartBox>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={view.weekdays} margin={chartMargin}>
                        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} interval={0} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tickLine={false} axisLine={false} fontSize={12} width={40} allowDecimals={false} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                          contentStyle={tooltipStyle}
                          formatter={(value: number) => [formatNumber(value), t("reports.kpi.visits")]}
                          labelFormatter={(_label, payload) => payload?.[0]?.payload?.full ?? ""}
                        />
                        <Bar dataKey="visits" fill={VISITS_COLOR} radius={[4, 4, 0, 0]} maxBarSize={36} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartBox>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t("reports.clients.byHour")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartBox>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={view.hours} margin={chartMargin}>
                        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                        <XAxis dataKey="hour" tickFormatter={pad2} tickLine={false} axisLine={false} fontSize={11} interval={1} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tickLine={false} axisLine={false} fontSize={12} width={40} allowDecimals={false} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                          contentStyle={tooltipStyle}
                          formatter={(value: number) => [formatNumber(value), t("reports.kpi.visits")]}
                          labelFormatter={(_label, payload) => payload?.[0]?.payload?.full ?? ""}
                        />
                        <Bar dataKey="visits" fill={VISITS_COLOR} radius={[4, 4, 0, 0]} maxBarSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartBox>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Totaux « maintenant » : indépendants du filtre */}
          <section className="space-y-3">
            <div>
              <h2 className="text-xl font-semibold">{t("reports.now.title")}</h2>
              <p className="text-sm text-muted-foreground">{t("reports.now.note")}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile title={t("reports.now.today")} value={money(report.kpis.today_revenue)} icon={Wallet} />
              <KpiTile title={t("reports.now.month")} value={money(report.kpis.month_revenue)} icon={CalendarDays} />
              <KpiTile title={t("reports.now.year")} value={money(report.kpis.year_revenue)} icon={TrendingUp} />
              <KpiTile
                title={t("reports.now.all")}
                value={money(report.kpis.all_time_revenue)}
                hint={t("reports.now.allInvoices", { count: report.kpis.all_time_invoices })}
                icon={Receipt}
              />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Plats les plus vendus sur la période */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Trophy className="h-5 w-5 text-primary" />
                  {t("reports.dishes.title")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {report.topDishes.length > 0 ? (
                  <ol className="space-y-3">
                    {report.topDishes.map((dish, index) => (
                      <li key={dish.name} className="space-y-1">
                        <div className="flex justify-between gap-2 text-sm">
                          <span className="font-medium">{formatNumber(index + 1)}. {dish.name}</span>
                          <span className="whitespace-nowrap text-muted-foreground">
                            × {formatNumber(dish.quantity)} · {money(dish.revenue)}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${(dish.quantity / maxDish) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("reports.dishes.empty")}</p>
                )}
              </CardContent>
            </Card>

            {/* Heures et mois les plus chargés */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Clock className="h-5 w-5 text-primary" />
                  {t("reports.hours.title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {report.busiestHours.length > 0 ? (
                  <ol className="space-y-3">
                    {report.busiestHours.map((h) => (
                      <li key={h.hour} className="space-y-1">
                        <div className="flex justify-between gap-2 text-sm">
                          <bdi dir="ltr" className="font-medium">{view.hourLabel(h.hour)} – {view.hourLabel((h.hour + 1) % 24)}</bdi>
                          <span className="whitespace-nowrap text-muted-foreground">{t("reports.ordersCount", { count: h.orders })}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${(h.orders / maxHourOrders) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("reports.hours.empty")}</p>
                )}

                <div className="border-t pt-4">
                  <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <ShoppingBag className="h-4 w-4 text-primary" />
                    {t("reports.months.title")}
                  </p>
                  {report.busiestMonths.length > 0 ? (
                    <ol className="space-y-3">
                      {report.busiestMonths.map((m) => (
                        <li key={m.label} className="space-y-1">
                          <div className="flex justify-between gap-2 text-sm">
                            <span className="font-medium">{monthKeyLabel(m.label)}</span>
                            <span className="whitespace-nowrap text-muted-foreground">{t("reports.ordersCount", { count: m.orders })}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${(m.orders / maxMonthOrders) * 100}%` }} />
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("reports.months.empty")}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Caissiers de la période */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("reports.cashiers.title")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("reports.cashiers.subtitle")}</p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {report.cashiers.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-2 text-start font-medium">{t("reports.cashiers.cashier")}</th>
                      <th className="py-2 text-end font-medium">{t("reports.cashiers.tablesPaid")}</th>
                      <th className="py-2 text-end font-medium">{t("reports.kpi.revenue")}</th>
                      <th className="py-2 text-end font-medium">{t("reports.kpi.avgTicket")}</th>
                      <th className="py-2 text-end font-medium">{t("reports.cashiers.complaints")}</th>
                      <th className="py-2 text-end font-medium">{t("reports.cashiers.lastPayment")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.cashiers.map((c) => (
                      <tr key={c.name} className="border-b last:border-0">
                        <td className="py-2.5">
                          <span className="font-medium">{c.name === NOT_RECORDED ? t("reports.cashiers.notRecorded") : c.name}</span>
                          {c.status === "inactive" && <span className="ms-2 text-xs text-muted-foreground">{t("reports.cashiers.deactivated")}</span>}
                        </td>
                        <td className="py-2.5 text-end">{formatNumber(c.invoices)}</td>
                        <td className="py-2.5 text-end font-medium">{money(c.revenue)}</td>
                        <td className="py-2.5 text-end">{c.invoices ? money(c.average_ticket) : t("common.none")}</td>
                        <td className={`py-2.5 text-end ${c.complaints > 0 ? "font-medium text-destructive" : ""}`}>{formatNumber(c.complaints)}</td>
                        <td className="py-2.5 text-end text-muted-foreground">
                          {c.last_payment ? formatDateTime(parseServerDate(c.last_payment), timezone) : t("common.none")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted-foreground">{t("reports.cashiers.empty")}</p>
              )}
            </CardContent>
          </Card>

          {/* Par année */}
          {report.yearly.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t("reports.yearly.title")}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-2 text-start font-medium">{t("reports.yearly.year")}</th>
                      <th className="py-2 text-end font-medium">{t("reports.cashiers.tablesPaid")}</th>
                      <th className="py-2 text-end font-medium">{t("reports.kpi.revenue")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.yearly.map((y) => (
                      <tr key={y.year} className="border-b last:border-0">
                        <td className="py-2.5 font-medium">{y.year}</td>
                        <td className="py-2.5 text-end">{formatNumber(y.invoices)}</td>
                        <td className="py-2.5 text-end font-medium">{money(y.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
