import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarRange, FileText, Layers, Printer, RefreshCw, Search } from "lucide-react";
import { orderApi, parseServerDate } from "@/lib/order-server";
import { useRestaurant } from "@/hooks/useRestaurant";
import { PaperFormatSelect, usePaperFormat } from "@/components/print/paper-format-select";
import { BillBreakdown, breakdownLines, includedTaxNote } from "../../../shared/bill";
import { PeriodSummary, printReceipt, printReceipts, printSummary, Receipt } from "../../../shared/receipt";
import { useI18n } from "../../../shared/i18n";

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

// Les jours sont des chaînes AAAA-MM-JJ (comme les filtres du serveur), calculées dans le fuseau du restaurant.
// Les calculs de calendrier se font à midi UTC pour éviter tout décalage d'heure d'été.
const parseIso = (day: string) => new Date(`${day}T12:00:00Z`);
const toIso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const date = parseIso(day);
  date.setUTCDate(date.getUTCDate() + n);
  return toIso(date);
};
const mondayOf = (day: string) => addDays(day, -((parseIso(day).getUTCDay() + 6) % 7)); // semaine du lundi au dimanche
const monthRange = (year: number, month0: number): [string, string] => [
  toIso(new Date(Date.UTC(year, month0, 1, 12))),
  toIso(new Date(Date.UTC(year, month0 + 1, 0, 12))),
];

/** Le jour d'aujourd'hui (AAAA-MM-JJ) dans le fuseau du restaurant */
function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return toIso(new Date());
  }
}

/** Valeur d'un champ "semaine" (AAAA-Www, norme ISO) -> lundi et dimanche de cette semaine */
function isoWeekRange(value: string): [string, string] | null {
  const match = value.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const monday = addDays(mondayOf(`${match[1]}-01-04`), (Number(match[2]) - 1) * 7);
  return [monday, addDays(monday, 6)];
}

function currentIsoWeek(today: string): string {
  const thursday = addDays(mondayOf(today), 3);
  const year = thursday.slice(0, 4);
  const days = (parseIso(mondayOf(thursday)).getTime() - parseIso(mondayOf(`${year}-01-04`)).getTime()) / 864e5;
  return `${year}-W${String(1 + Math.round(days / 7)).padStart(2, "0")}`;
}

/** Intervalle [du, au] d'un raccourci de période */
function presetRange(preset: Preset, today: string): [string, string] | null {
  const year = Number(today.slice(0, 4));
  const month0 = Number(today.slice(5, 7)) - 1;
  switch (preset) {
    case "today": return [today, today];
    case "yesterday": return [addDays(today, -1), addDays(today, -1)];
    case "thisWeek": return [mondayOf(today), addDays(mondayOf(today), 6)];
    case "lastWeek": return [addDays(mondayOf(today), -7), addDays(mondayOf(today), -1)];
    case "thisMonth": return monthRange(year, month0);
    case "lastMonth": return monthRange(year, month0 - 1);
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
  const i18n = useI18n();
  const { t, formatDate } = i18n;
  const { settings, name, currency, timezone, fmt, dateTime } = useRestaurant();
  const [today] = useState(() => todayIn(timezone));
  const [preset, setPreset] = useState<Preset>("today");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [week, setWeek] = useState(() => currentIsoWeek(today));
  const [isPrinting, setIsPrinting] = useState(false);
  const [search, setSearch] = useState("");
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [selected, setSelected] = useState<InvoiceDetail | null>(null);
  const [paper, setPaper] = usePaperFormat();
  const [isLoading, setIsLoading] = useState(true);

  // Paramètres de la période choisie (communs à la liste, à l'impression en lot et au récapitulatif)
  const rangeParams = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ q: search.trim(), ...extra });
    if (preset === "all") params.set("period", "all");
    else {
      params.set("from", from);
      params.set("to", to);
    }
    return params.toString();
  };

  const load = useCallback(async () => {
    try {
      setInvoices(await orderApi<InvoiceSummary[]>(`/invoices?${rangeParams()}`));
    } catch (e) {
      notify(t("caisse.error", { message: (e as Error).message }), true);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, from, to, search, t]);

  useEffect(() => {
    const timer = setTimeout(load, 250); // attendre la fin de la saisie de recherche
    return () => clearTimeout(timer);
  }, [load, refreshKey]);

  const choosePreset = (next: Preset) => {
    setPreset(next);
    const range = next === "week" ? isoWeekRange(week) : presetRange(next, today);
    if (range) {
      setFrom(range[0]);
      setTo(range[1]);
    }
  };

  const chooseWeek = (value: string) => {
    setWeek(value);
    setPreset("week");
    const range = isoWeekRange(value);
    if (range) {
      setFrom(range[0]);
      setTo(range[1]);
    }
  };

  const shortDate = (value: string) => formatDate(parseIso(value), "UTC");
  const periodLabel = preset === "all"
    ? t("caisse.invoices.periodAll")
    : from === to ? shortDate(from) : t("caisse.invoices.periodRange", { from: shortDate(from), to: shortDate(to) });

  // Coordonnées du restaurant imprimées en tête de chaque ticket (paramètres du restaurant)
  const shopInfo = () => ({
    restaurantName: name,
    address: settings?.restaurant_address,
    phone: settings?.restaurant_phone,
    footer: settings?.receipt_footer,
    currency,
    timeZone: timezone,
  });

  // Toutes les factures de la période en une seule impression (un ticket par facture)
  const printAll = async () => {
    setIsPrinting(true);
    try {
      const list = await orderApi<InvoiceDetail[]>(`/invoices?${rangeParams({ items: "1" })}`);
      if (list.length === 0) return notify(t("caisse.invoices.nothingToPrint"), true);
      const receipts: Receipt[] = [...list].reverse().map((invoice) => ({
        ...shopInfo(),
        number: invoice.number,
        tableNumber: invoice.table_number,
        cashier: invoice.cashier_name,
        date: parseServerDate(invoice.created_at),
        lines: invoice.items,
        total: invoice.total,
        breakdown: invoiceBreakdown(invoice),
      }));
      if (!printReceipts(receipts, i18n, paper)) notify(t("caisse.toast.printFailed"), true);
    } catch (e) {
      notify(t("caisse.error", { message: (e as Error).message }), true);
    } finally {
      setIsPrinting(false);
    }
  };

  // Ticket récapitulatif de la période (clôture de journée / de semaine)
  const printPeriodSummary = async () => {
    setIsPrinting(true);
    try {
      const data = await orderApi<Omit<PeriodSummary, "restaurantName" | "periodLabel" | "currency">>(`/invoices/summary?${rangeParams()}`);
      const summary: PeriodSummary = { restaurantName: name, address: settings?.restaurant_address, phone: settings?.restaurant_phone, periodLabel, currency, ...data };
      if (!printSummary(summary, i18n, paper)) notify(t("caisse.toast.printFailed"), true);
    } catch (e) {
      notify(t("caisse.error", { message: (e as Error).message }), true);
    } finally {
      setIsPrinting(false);
    }
  };

  const open = async (id: number) => {
    try {
      setSelected(await orderApi<InvoiceDetail>(`/invoices/${id}`));
    } catch (e) {
      notify(t("caisse.error", { message: (e as Error).message }), true);
    }
  };

  const print = (invoice: InvoiceDetail) => {
    const ok = printReceipt({
      ...shopInfo(),
      cashier: invoice.cashier_name,
      breakdown: invoiceBreakdown(invoice),
      number: invoice.number,
      tableNumber: invoice.table_number,
      date: parseServerDate(invoice.created_at),
      lines: invoice.items,
      total: invoice.total,
    }, i18n, paper);
    if (!ok) notify(t("caisse.toast.printFailed"), true);
  };

  const periodTotal = useMemo(() => invoices.reduce((sum, invoice) => sum + invoice.total, 0), [invoices]);

  const presets: { id: Preset; label: string }[] = [
    { id: "today", label: t("common.today") },
    { id: "yesterday", label: t("caisse.invoices.yesterday") },
    { id: "thisWeek", label: t("caisse.invoices.thisWeek") },
    { id: "lastWeek", label: t("caisse.invoices.lastWeek") },
    { id: "thisMonth", label: t("caisse.invoices.thisMonth") },
    { id: "lastMonth", label: t("caisse.invoices.lastMonth") },
    { id: "all", label: t("common.all") },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("caisse.invoices.title")}</h1>
          <p className="text-muted-foreground">
            {t("caisse.invoices.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Format du ticket : mémorisé sur ce poste (chaque caisse a sa propre imprimante) */}
          <PaperFormatSelect value={paper} onChange={setPaper} />
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
              <span className="text-muted-foreground">{t("caisse.invoices.week")}</span>
              <Input type="week" value={week} onChange={(e) => chooseWeek(e.target.value)} className={`w-44 ${preset === "week" ? "border-primary" : ""}`} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("caisse.invoices.from")}</span>
              <Input type="date" value={from} max={to} onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }} className="w-40" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">{t("caisse.invoices.to")}</span>
              <Input type="date" value={to} min={from} onChange={(e) => { setPreset("custom"); setTo(e.target.value); }} className="w-40" />
            </label>
            <div className="relative ms-auto w-full sm:w-64">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("caisse.invoices.search")} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-sm flex flex-wrap items-center gap-2">
              <CalendarRange className="w-4 h-4 text-primary" />
              <span className="font-medium">{periodLabel}</span>
              <span className="text-muted-foreground">· {t("caisse.invoices.count", { count: invoices.length })} · {fmt(periodTotal)}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={printPeriodSummary} disabled={isPrinting || invoices.length === 0}>
                <Layers className="w-4 h-4 me-2" />
                {t("caisse.invoices.printSummary")}
              </Button>
              <Button size="sm" onClick={printAll} disabled={isPrinting || invoices.length === 0}>
                <Printer className="w-4 h-4 me-2" />
                {t("caisse.invoices.printAll", { count: invoices.length })}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                {t("caisse.invoices.count", { count: invoices.length })}
              </CardTitle>
              <span className="font-bold text-primary">{fmt(periodTotal)}</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!isLoading && invoices.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
                {t("caisse.invoices.empty")}
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
                        {t("caisse.table.label", { number: invoice.table_number })} · {dateTime(invoice.created_at)} · {t("caisse.invoices.itemsCount", { count: invoice.items_count })}
                        {invoice.cashier_name && <> · {t("caisse.invoices.by", { name: invoice.cashier_name })}</>}
                      </p>
                    </div>
                    <span className="font-semibold whitespace-nowrap">{fmt(invoice.total)}</span>
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
                  {t("caisse.table.label", { number: selected.table_number })} · {dateTime(selected.created_at)}
                </p>
                {selected.cashier_name && (
                  <p className="text-sm text-muted-foreground">{t("caisse.invoices.checkedOutBy")} <span className="font-medium text-foreground">{selected.cashier_name}</span></p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  {selected.items.map((item, index) => (
                    <div key={index} className="flex justify-between gap-2 text-sm">
                      <span>{item.quantity} × {item.name}</span>
                      <span className="text-muted-foreground whitespace-nowrap">{fmt(item.price * item.quantity)}</span>
                    </div>
                  ))}
                </div>
                {(() => {
                  const bill = invoiceBreakdown(selected);
                  const taxNote = bill ? includedTaxNote(bill, t, fmt) : null;
                  return (
                    <>
                      {bill && breakdownLines(bill, t).map((line) => (
                        <div key={line.label} className="flex justify-between text-sm text-muted-foreground border-t pt-2 first:border-0">
                          <span>{line.label}</span>
                          <span>{fmt(line.amount)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between font-bold text-lg border-t pt-3">
                        <span>{t("common.total")}</span>
                        <span className="text-primary">{fmt(selected.total)}</span>
                      </div>
                      {taxNote && <p className="text-xs text-muted-foreground text-end">{taxNote}</p>}
                    </>
                  );
                })()}
                <Button className="w-full" onClick={() => print(selected)}>
                  <Printer className="w-4 h-4 me-2" />
                  {t("caisse.invoices.print")}
                </Button>
                <PaperFormatSelect value={paper} onChange={setPaper} className="w-full h-9 text-xs" />
              </CardContent>
            </>
          ) : (
            <CardContent className="py-12 text-center text-muted-foreground">
              {t("caisse.invoices.selectOne")}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
