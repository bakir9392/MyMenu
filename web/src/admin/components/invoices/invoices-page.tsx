import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarRange, FileText, Layers, Printer, RefreshCw, Search } from "lucide-react";
import { orderApi, parseServerDate } from "@/lib/order-server";
import { BillBreakdown, breakdownLines, includedTaxNote } from "@/lib/bill";
import {
  getPaperFormat, PAPER_FORMATS, PAPER_LABEL_KEYS, PaperFormat, PeriodSummary, printReceipt, printReceipts, printSummary, Receipt, setPaperFormat,
} from "@/lib/print-invoice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useShop } from "@/hooks/use-shop";

interface InvoiceSummary {
  id: number;
  number: string;
  table_number: string;
  total: number;
  cashier_name?: string | null;
  created_at: string;
  items_count: number;
  // Détail figé à l'encaissement (absent sur les factures créées avant les paramètres de TVA / frais)
  subtotal?: number | null;
  service_amount?: number | null;
  service_label?: string | null;
  tax_amount?: number | null;
  tax_rate?: number | null;
  tax_mode?: "included" | "added" | null;
}

const invoiceBreakdown = (invoice: Omit<InvoiceSummary, "items_count">): BillBreakdown | null =>
  invoice.subtotal == null
    ? null
    : {
        subtotal: invoice.subtotal,
        service: invoice.service_amount ?? 0,
        serviceLabel: invoice.service_label ?? null,
        tax: invoice.tax_amount ?? 0,
        taxRate: invoice.tax_rate ?? 0,
        taxMode: invoice.tax_mode ?? null,
        total: invoice.total,
      };

interface InvoiceDetail extends Omit<InvoiceSummary, "items_count"> {
  items: { name: string; price: number; quantity: number }[];
}

type Preset = "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "week" | "custom" | "all";

// Dates au format AAAA-MM-JJ (comme les filtres du serveur), calculées à midi pour éviter les décalages d'heure d'été
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7)); // semaine du lundi au dimanche

/** Aujourd'hui dans le fuseau du restaurant (et non celui de ce navigateur), à midi */
function todayIn(timeZone?: string | null): Date {
  try {
    const text = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return new Date(`${text}T12:00:00`);
  } catch {
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    return now;
  }
}

/** Valeur d'un champ "semaine" (AAAA-Www, norme ISO) -> lundi et dimanche de cette semaine */
function isoWeekRange(value: string): [string, string] | null {
  const match = value.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const jan4 = new Date(Number(match[1]), 0, 4, 12);
  const monday = addDays(mondayOf(jan4), (Number(match[2]) - 1) * 7);
  return [iso(monday), iso(addDays(monday, 6))];
}

function isoWeekOf(today: Date): string {
  const thursday = addDays(mondayOf(today), 3);
  const jan4 = new Date(thursday.getFullYear(), 0, 4, 12);
  const week = 1 + Math.round((mondayOf(thursday).getTime() - mondayOf(jan4).getTime()) / (7 * 864e5));
  return `${thursday.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Intervalle [du, au] d'un raccourci de période */
function presetRange(preset: Preset, today: Date): [string, string] | null {
  switch (preset) {
    case "today": return [iso(today), iso(today)];
    case "yesterday": return [iso(addDays(today, -1)), iso(addDays(today, -1))];
    case "thisWeek": return [iso(mondayOf(today)), iso(addDays(mondayOf(today), 6))];
    case "lastWeek": return [iso(addDays(mondayOf(today), -7)), iso(addDays(mondayOf(today), -1))];
    case "thisMonth": return [iso(new Date(today.getFullYear(), today.getMonth(), 1, 12)), iso(new Date(today.getFullYear(), today.getMonth() + 1, 0, 12))];
    case "lastMonth": return [iso(new Date(today.getFullYear(), today.getMonth() - 1, 1, 12)), iso(new Date(today.getFullYear(), today.getMonth(), 0, 12))];
    default: return null;
  }
}

interface InvoicesPageProps {
  notify: (title: string, isError?: boolean) => void;
  /** Rafraîchissement externe (ex. : une table vient d'être encaissée) */
  refreshKey?: number;
}

/** Factures des tables encaissées : liste, détail et impression sur l'imprimante du restaurant */
export function InvoicesPage({ notify, refreshKey = 0 }: InvoicesPageProps) {
  const { settings, currency, timezone, money, i18n } = useShop();
  const { t, formatDate, formatDateTime } = i18n;
  const [preset, setPreset] = useState<Preset>("today");
  const [from, setFrom] = useState(() => iso(todayIn(timezone)));
  const [to, setTo] = useState(() => iso(todayIn(timezone)));
  const [week, setWeek] = useState(() => isoWeekOf(todayIn(timezone)));
  const [isPrinting, setIsPrinting] = useState(false);
  const [search, setSearch] = useState("");
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [selected, setSelected] = useState<InvoiceDetail | null>(null);
  const [paper, setPaper] = useState<PaperFormat>(getPaperFormat);
  const [isLoading, setIsLoading] = useState(true);

  // Paramètres de la période choisie (communs à la liste, à l'impression en lot et au récapitulatif)
  function rangeParams(extra: Record<string, string> = {}) {
    const params = new URLSearchParams({ q: search.trim(), ...extra });
    if (preset === "all") params.set("period", "all");
    else {
      params.set("from", from);
      params.set("to", to);
    }
    return params.toString();
  }

  const load = useCallback(async () => {
    try {
      setInvoices(await orderApi<InvoiceSummary[]>(`/invoices?${rangeParams()}`));
    } catch {
      notify(t("invoices.loadError"), true);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, from, to, search]);

  useEffect(() => {
    const timer = setTimeout(load, 250); // attendre la fin de la saisie de recherche
    return () => clearTimeout(timer);
  }, [load, refreshKey]);

  const choosePreset = useCallback((next: Preset, weekValue = week) => {
    setPreset(next);
    const range = next === "week" ? isoWeekRange(weekValue) : presetRange(next, todayIn(timezone));
    if (range) {
      setFrom(range[0]);
      setTo(range[1]);
    }
  }, [timezone, week]);

  // Les paramètres arrivent après l'ouverture de la page : « aujourd'hui » est alors recalculé dans le fuseau du restaurant
  useEffect(() => {
    if (!settings?.timezone) return;
    if (preset !== "custom" && preset !== "all") choosePreset(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.timezone]);

  const chooseWeek = (value: string) => {
    setWeek(value);
    choosePreset("week", value);
  };

  const shortDate = (value: string) => formatDate(new Date(`${value}T12:00:00`));
  const periodLabel = preset === "all"
    ? t("invoices.allInvoices")
    : from === to ? shortDate(from) : t("invoices.periodRange", { from: shortDate(from), to: shortDate(to) });

  // Informations de l'en-tête des tickets : celles du restaurant
  const shopInfo = () =>
    settings
      ? { restaurantName: settings.restaurant_name, address: settings.restaurant_address, phone: settings.restaurant_phone, footer: settings.receipt_footer, currency: settings.currency, timeZone: settings.timezone }
      : null;

  // Toutes les factures de la période en une seule impression (un ticket par facture)
  const printAll = async () => {
    const shop = shopInfo();
    if (!shop) return notify(t("invoices.settingsMissing"), true);
    setIsPrinting(true);
    try {
      const list = await orderApi<(InvoiceDetail & { items: Receipt["lines"] })[]>(`/invoices?${rangeParams({ items: "1" })}`);
      if (list.length === 0) return notify(t("invoices.nothingToPrint"), true);
      const receipts: Receipt[] = [...list].reverse().map((invoice) => ({
        ...shop,
        number: invoice.number,
        tableNumber: invoice.table_number,
        cashier: invoice.cashier_name,
        date: parseServerDate(invoice.created_at),
        lines: invoice.items,
        total: invoice.total,
        breakdown: invoiceBreakdown(invoice),
      }));
      if (!printReceipts(receipts, i18n, paper)) notify(t("invoices.printFailed"), true);
    } catch (e) {
      notify(`${t("common.error")} : ${(e as Error).message}`, true);
    } finally {
      setIsPrinting(false);
    }
  };

  // Ticket récapitulatif de la période (clôture de journée / de semaine)
  const printPeriodSummary = async () => {
    const shop = shopInfo();
    if (!shop) return notify(t("invoices.settingsMissing"), true);
    setIsPrinting(true);
    try {
      const data = await orderApi<Omit<PeriodSummary, "restaurantName" | "periodLabel" | "currency">>(`/invoices/summary?${rangeParams()}`);
      const summary: PeriodSummary = { restaurantName: shop.restaurantName, address: shop.address, phone: shop.phone, currency: shop.currency, periodLabel, ...data };
      if (!printSummary(summary, i18n, paper)) notify(t("invoices.printFailed"), true);
    } catch (e) {
      notify(`${t("common.error")} : ${(e as Error).message}`, true);
    } finally {
      setIsPrinting(false);
    }
  };

  const open = async (id: number) => {
    try {
      setSelected(await orderApi<InvoiceDetail>(`/invoices/${id}`));
    } catch (e) {
      notify(`${t("common.error")} : ${(e as Error).message}`, true);
    }
  };

  const print = (invoice: InvoiceDetail) => {
    const shop = shopInfo();
    if (!shop) return notify(t("invoices.settingsMissing"), true);
    const ok = printReceipt({
      ...shop,
      cashier: invoice.cashier_name,
      breakdown: invoiceBreakdown(invoice),
      number: invoice.number,
      tableNumber: invoice.table_number,
      date: parseServerDate(invoice.created_at),
      lines: invoice.items,
      total: invoice.total,
    }, i18n, paper);
    if (!ok) notify(t("invoices.printFailed"), true);
  };

  const periodTotal = useMemo(() => invoices.reduce((sum, invoice) => sum + invoice.total, 0), [invoices]);

  const presets: { id: Preset; label: string }[] = [
    { id: "today", label: t("invoices.today") },
    { id: "yesterday", label: t("invoices.yesterday") },
    { id: "thisWeek", label: t("invoices.thisWeek") },
    { id: "lastWeek", label: t("invoices.lastWeek") },
    { id: "thisMonth", label: t("invoices.thisMonth") },
    { id: "lastMonth", label: t("invoices.lastMonth") },
    { id: "all", label: t("invoices.all") },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("invoices.title")}</h1>
          <p className="text-muted-foreground">{t("invoices.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Format du ticket : mémorisé sur ce poste (chaque poste a sa propre imprimante) */}
          <Select value={paper} onValueChange={(v) => { setPaper(v as PaperFormat); setPaperFormat(v as PaperFormat); }}>
            <SelectTrigger className="w-60" aria-label={t("invoices.paperFormat")} title={t("invoices.paperFormat")}>
              <Printer className="w-4 h-4 me-2 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAPER_FORMATS.map((key) => (
                <SelectItem key={key} value={key}>{t(PAPER_LABEL_KEYS[key])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-4 h-4 me-2" />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {/* Filtre de dates */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <Button key={p.id} size="sm" variant={preset === p.id ? "default" : "outline"} onClick={() => choosePreset(p.id)}>
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("invoices.week")}</span>
              <Input type="week" value={week} onChange={(e) => chooseWeek(e.target.value)} className={`w-44 ${preset === "week" ? "border-primary" : ""}`} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("invoices.from")}</span>
              <Input type="date" value={from} max={to} onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }} className="w-40" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("invoices.to")}</span>
              <Input type="date" value={to} min={from} onChange={(e) => { setPreset("custom"); setTo(e.target.value); }} className="w-40" />
            </label>
            <div className="relative ms-auto w-full sm:w-64">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("invoices.searchPlaceholder")} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-sm flex flex-wrap items-center gap-2">
              <CalendarRange className="w-4 h-4 text-primary" />
              <span className="font-medium">{periodLabel}</span>
              <span className="text-muted-foreground">· {t("invoices.count", { count: invoices.length })} · {money(periodTotal)}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={printPeriodSummary} disabled={isPrinting || invoices.length === 0}>
                <Layers className="w-4 h-4 me-2" />
                {t("invoices.printSummary")}
              </Button>
              <Button size="sm" onClick={printAll} disabled={isPrinting || invoices.length === 0}>
                <Printer className="w-4 h-4 me-2" />
                {t("invoices.printAll", { count: invoices.length })}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{t("invoices.count", { count: invoices.length })}</CardTitle>
              <span className="font-bold text-primary">{money(periodTotal)}</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!isLoading && invoices.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
                {t("invoices.none")}
              </div>
            ) : (
              <div className="divide-y">
                {invoices.map((invoice) => (
                  <button
                    key={invoice.id}
                    onClick={() => open(invoice.id)}
                    className={`w-full flex items-center justify-between gap-3 px-6 py-3 text-start transition-colors hover:bg-muted/50 ${selected?.id === invoice.id ? "bg-muted/60" : ""}`}
                  >
                    <div>
                      <p className="font-medium">{invoice.number}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("invoices.table", { table: invoice.table_number })} · {formatDateTime(parseServerDate(invoice.created_at), timezone)} · {t("invoices.items", { count: invoice.items_count })}
                        {invoice.cashier_name && <> · {t("invoices.by", { name: invoice.cashier_name })}</>}
                      </p>
                    </div>
                    <span className="font-semibold whitespace-nowrap">{money(invoice.total)}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 h-fit lg:sticky lg:top-20">
          {selected ? (
            <>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">{selected.number}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t("invoices.table", { table: selected.table_number })} · {formatDateTime(parseServerDate(selected.created_at), timezone)}
                </p>
                {selected.cashier_name && (
                  <p className="text-sm text-muted-foreground">{t("invoices.checkedOutBy")} <span className="font-medium text-foreground">{selected.cashier_name}</span></p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  {selected.items.map((item, index) => (
                    <div key={index} className="flex justify-between gap-2 text-sm">
                      <span>{item.quantity} × {item.name}</span>
                      <span className="text-muted-foreground whitespace-nowrap">{money(item.price * item.quantity)}</span>
                    </div>
                  ))}
                </div>
                {(() => {
                  const bill = invoiceBreakdown(selected);
                  const note = bill ? includedTaxNote(bill, t, money) : null;
                  return (
                    <>
                      {bill && breakdownLines(bill, t).map((line) => (
                        <div key={line.label} className="flex justify-between text-sm text-muted-foreground border-t pt-2 first:border-0">
                          <span>{line.label}</span>
                          <span>{money(line.amount)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between font-bold text-lg border-t pt-3">
                        <span>{t("common.total")}</span>
                        <span className="text-primary">{money(selected.total)}</span>
                      </div>
                      {note && <p className="text-xs text-muted-foreground text-end">{note}</p>}
                    </>
                  );
                })()}
                <Button className="w-full" onClick={() => print(selected)}>
                  <Printer className="w-4 h-4 me-2" />
                  {t("invoices.print")}
                </Button>
              </CardContent>
            </>
          ) : (
            <CardContent className="py-12 text-center text-muted-foreground">{t("invoices.select")}</CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
