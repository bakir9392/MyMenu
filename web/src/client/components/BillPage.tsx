import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Receipt as ReceiptIcon, ImageDown, Printer, RefreshCw, TriangleAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { breakdownLines, includedTaxNote, SessionBill } from "@/lib/bill";
import { loadSessionBill } from "@/lib/sessionBill";
import { parseServerDate, useI18n } from "@/lib/i18n";
import { printReceipt, saveReceiptImage, Receipt } from "@/lib/receipt";
import PageHeader from "./PageHeader";

interface BillPageProps {
  /** Jeton de la session en cours, ou de la visite qui vient de se terminer (l'addition reste disponible ~12 h) */
  sessionToken: string | null;
  /** Change quand l'état de la session change (ex. table encaissée) : l'addition est rechargée */
  reloadKey?: string;
  onBack: () => void;
}

type LoadState = { kind: "loading" } | { kind: "ready"; bill: SessionBill } | { kind: "nothing" } | { kind: "error" };

// Nom de fichier sûr pour l'image enregistrée
const fileNameFor = (bill: SessionBill) =>
  `${bill.restaurant.name}-${bill.invoiceNumber ?? "bill"}-${bill.table}`
    .normalize("NFKD")
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase() || "receipt";

/** L'addition de la visite telle que le serveur la calcule : à enregistrer en image ou à imprimer / enregistrer en PDF */
const BillPage = ({ sessionToken, reloadKey = "", onBack }: BillPageProps) => {
  const i18n = useI18n();
  const { t, money, formatDateTime } = i18n;
  const { toast } = useToast();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!sessionToken) {
      setState({ kind: "nothing" });
      return;
    }
    setState((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    const result = await loadSessionBill(sessionToken);
    if ("bill" in result) setState({ kind: "ready", bill: result.bill });
    else setState({ kind: result.reason === "nothing_to_bill" ? "nothing" : "error" });
  }, [sessionToken]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const bill = state.kind === "ready" ? state.bill : null;

  const toReceipt = (b: SessionBill): Receipt => ({
    restaurantName: b.restaurant.name,
    address: b.restaurant.address,
    phone: b.restaurant.phone,
    number: b.status === "paid" ? b.invoiceNumber : null,
    tableNumber: b.table,
    date: parseServerDate(b.date),
    lines: b.lines,
    total: b.total,
    currency: b.currency,
    timeZone: b.timezone,
    breakdown: b.breakdown,
    footer: b.restaurant.footer,
  });

  const handleSaveImage = async () => {
    if (!bill || saving) return;
    setSaving(true);
    try {
      const result = await saveReceiptImage(toReceipt(bill), i18n, fileNameFor(bill));
      if (result === "downloaded") toast({ title: t("client.bill.savedTitle"), description: t("client.bill.savedDownloaded") });
      else if (result === "shared") toast({ title: t("client.bill.savedTitle"), description: t("client.bill.savedShared") });
    } catch {
      toast({ title: t("client.bill.saveFailedTitle"), description: t("client.bill.saveFailedText"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    if (!bill) return;
    try {
      if (!printReceipt(toReceipt(bill), i18n, "80mm")) throw new Error("print blocked");
      toast({ title: t("client.bill.printOpenedTitle"), description: t("client.bill.printOpenedText") });
    } catch {
      toast({ title: t("client.bill.printFailedTitle"), description: t("client.bill.printFailedText"), variant: "destructive" });
    }
  };

  const m = (amount: number) => money(amount, bill?.currency);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-restaurant-cream to-background">
      <PageHeader
        title={t("client.bill.title")}
        subtitle={bill ? t("client.tableNo", { table: bill.table }) : undefined}
        onBack={onBack}
      />

      <div className="container mx-auto px-4 py-6 max-w-2xl">
        {state.kind === "loading" && (
          <div className="py-16 text-center text-muted-foreground">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto mb-4" />
            {t("client.bill.loading")}
          </div>
        )}

        {state.kind === "nothing" && (
          <Card className="bg-card/95 backdrop-blur-sm">
            <CardContent className="py-12 text-center text-muted-foreground">
              <ReceiptIcon className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium text-foreground mb-1">{t("client.bill.nothingTitle")}</p>
              <p className="text-sm">{t("client.bill.nothingText")}</p>
              <Button variant="outline" className="mt-6" onClick={onBack}>{t("client.cart.browse")}</Button>
            </CardContent>
          </Card>
        )}

        {state.kind === "error" && (
          <Card className="bg-card/95 backdrop-blur-sm">
            <CardContent className="py-12 text-center">
              <TriangleAlert className="h-12 w-12 mx-auto mb-3 text-destructive/70" />
              <p className="font-medium mb-1">{t("client.bill.errorTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("client.bill.errorText")}</p>
              <Button variant="outline" className="mt-6" onClick={load}>
                <RefreshCw className="h-4 w-4 me-2" />
                {t("client.common.retry")}
              </Button>
            </CardContent>
          </Card>
        )}

        {bill && (
          <>
            {bill.status === "open" ? (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <strong>{t("client.bill.unpaidTitle")}</strong> {t("client.bill.unpaidText")}
              </div>
            ) : (
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                {t("client.bill.paidText")}
              </div>
            )}

            <Card className="bg-card/95 backdrop-blur-sm">
              <CardHeader className="text-center pb-3">
                <CardTitle className="text-2xl">{bill.restaurant.name}</CardTitle>
                {bill.restaurant.address && <p className="text-sm text-muted-foreground">{bill.restaurant.address}</p>}
                {bill.restaurant.phone && (
                  <p className="text-sm text-muted-foreground" dir="ltr">{t("receipt.phone", { phone: bill.restaurant.phone })}</p>
                )}
                <p className="font-semibold pt-2">
                  {bill.status === "paid" && bill.invoiceNumber ? t("receipt.invoice", { number: bill.invoiceNumber }) : t("receipt.billUnpaid")}
                </p>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="flex justify-between text-sm text-muted-foreground border-y py-2">
                  <span>{t("client.tableNo", { table: bill.table })}</span>
                  <span>{formatDateTime(parseServerDate(bill.date), bill.timezone)}</span>
                </div>

                <div className="space-y-3">
                  {bill.lines.map((line, index) => (
                    <div key={`${line.name}-${index}`} className="flex justify-between items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium break-words">{line.name}</p>
                        <p className="text-sm text-muted-foreground">{m(line.price)} × {line.quantity}</p>
                      </div>
                      <p className="font-medium whitespace-nowrap">{m(line.price * line.quantity)}</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 pt-4 border-t">
                  {breakdownLines(bill.breakdown, t).map((line) => (
                    <div key={line.label} className="flex justify-between text-sm text-muted-foreground">
                      <span>{line.label}</span>
                      <span>{m(line.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-lg font-bold text-primary pt-2 border-t">
                    <span>{t("bill.total")}</span>
                    <span>{m(bill.total)}</span>
                  </div>
                  {includedTaxNote(bill.breakdown, t, m) && (
                    <p className="text-xs text-muted-foreground text-end">{includedTaxNote(bill.breakdown, t, m)}</p>
                  )}
                </div>

                {bill.restaurant.footer && (
                  <p className="text-center text-sm text-muted-foreground pt-2 whitespace-pre-line">{bill.restaurant.footer}</p>
                )}
              </CardContent>
            </Card>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Button
                onClick={handleSaveImage}
                disabled={saving}
                className="h-12 bg-gradient-to-r from-primary to-restaurant-warm text-white font-medium hover:from-primary/90 hover:to-restaurant-warm/90"
              >
                <ImageDown className="h-5 w-5 me-2" />
                {t("client.bill.saveImage")}
              </Button>
              <Button onClick={handlePrint} variant="outline" className="h-12 font-medium">
                <Printer className="h-5 w-5 me-2" />
                {t("client.bill.print")}
              </Button>
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">{t("client.bill.pdfHint")}</p>
            {bill.status === "open" && (
              <div className="mt-4 rounded-lg bg-muted/50 p-4">
                <p className="text-sm text-center text-muted-foreground">{t("client.bill.payWithServer")}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default BillPage;
