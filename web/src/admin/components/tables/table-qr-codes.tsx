import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileArchive, Plus, Printer, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { orderApi, RestaurantTable } from "@/lib/order-server";
import {
  downloadAllZip, downloadPng, downloadSvg, PRINT_FORMATS, PrintFormat, printQrSheet, qrPngDataUrl,
} from "@/lib/qr-export";
import { useShop } from "@/hooks/use-shop";
import { useI18n } from "../../../shared/i18n";

// Un téléphone ne peut pas ouvrir "localhost" (ce serait le téléphone lui-même)
const isLocalOnly = (url: string) => {
  try {
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

/**
 * Adresse du menu client encodée dans les QR codes, choisie automatiquement (rien à configurer pour l'admin) :
 * 1. l'adresse publique du site si elle est définie sur le serveur (PUBLIC_URL dans server/config.env) ;
 * 2. sinon l'adresse de cette page si elle n'est pas "localhost" ;
 * 3. sinon l'adresse du PC sur le Wi-Fi (détectée par le serveur).
 */
async function resolveClientUrl(): Promise<string> {
  const origin = window.location.origin;
  try {
    const info = await orderApi<{ publicUrl: string | null; lanAddresses: string[] }>("/server-info");
    if (info.publicUrl) return info.publicUrl;
    if (!isLocalOnly(origin) || info.lanAddresses.length === 0) return origin;
    const port = window.location.port ? `:${window.location.port}` : "";
    return `${window.location.protocol}//${info.lanAddresses[0]}${port}`;
  } catch {
    return origin;
  }
}

/** Taux saisi -> nombre 0-100, null si vide (taux par défaut), undefined si invalide */
function parseRate(value: string): number | null | undefined {
  const text = value.trim().replace(",", ".");
  if (text === "") return null;
  const rate = Number(text);
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : undefined;
}

interface TableVatFieldProps {
  table: RestaurantTable;
  placeholder: string;
  onSave: (table: RestaurantTable, rate: number | null) => Promise<boolean>;
}

/** Taux de TVA propre à une table : vide = taux par défaut du restaurant */
function TableVatField({ table, placeholder, onSave }: TableVatFieldProps) {
  const { t } = useI18n();
  const saved = table.tax_rate == null ? "" : String(table.tax_rate);
  const [draft, setDraft] = useState(saved);
  const [isSaving, setIsSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(saved);
    setInvalid(false);
  }, [saved]);

  const submit = async (value: string) => {
    const rate = parseRate(value);
    if (rate === undefined) return setInvalid(true);
    setInvalid(false);
    setIsSaving(true);
    await onSave(table, rate);
    setIsSaving(false);
  };

  const id = `vat-${table.number}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{t("tables.vatLabel")}</Label>
      <div className="flex gap-1.5">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step="0.01"
          dir="ltr"
          className={`h-8 text-start ${invalid ? "border-destructive" : ""}`}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit(draft)}
        />
        <Button size="sm" className="h-8 px-2" onClick={() => submit(draft)} disabled={isSaving || draft === saved}>
          {t("tables.vatSave")}
        </Button>
      </div>
      {invalid && <p className="text-xs text-destructive">{t("tables.vatInvalid")}</p>}
      {table.tax_rate != null && (
        <button
          type="button"
          className="text-xs text-primary hover:underline disabled:opacity-50"
          disabled={isSaving}
          onClick={() => {
            setDraft("");
            submit("");
          }}
        >
          {t("tables.vatReset")}
        </button>
      )}
    </div>
  );
}

interface TableQrCodesProps {
  notify: (title: string, isError?: boolean) => void;
}

export function TableQrCodes({ notify }: TableQrCodesProps) {
  const { settings, i18n } = useShop();
  const { t, lang, dir, formatNumber } = i18n;
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [clientUrl, setClientUrl] = useState<string | null>(null);
  const [tableCount, setTableCount] = useState("10");
  const [newTable, setNewTable] = useState("");
  const [newTaxRate, setNewTaxRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [printFormat, setPrintFormat] = useState<PrintFormat>("medium");
  const [showNumber, setShowNumber] = useState(true);
  const [showHint, setShowHint] = useState(true);
  const [printTitle, setPrintTitle] = useState("");
  const [isZipping, setIsZipping] = useState(false);

  // Taux par défaut du restaurant, montré en filigrane dans chaque champ TVA
  const defaultRatePlaceholder = settings
    ? settings.tax_enabled
      ? t("tables.vatDefault", { rate: formatNumber(settings.tax_rate) })
      : t("tables.vatNone")
    : "";

  const linkFor = useCallback(
    (table: RestaurantTable) => `${(clientUrl ?? window.location.origin).replace(/\/+$/, "")}/?t=${encodeURIComponent(table.qr_token)}`,
    [clientUrl]
  );

  const loadTables = useCallback(async () => {
    try {
      setTables(await orderApi<RestaurantTable[]>("/tables"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    loadTables();
    const interval = setInterval(loadTables, 15000); // statut occupée / libre
    return () => clearInterval(interval);
  }, [loadTables]);

  useEffect(() => {
    resolveClientUrl().then(setClientUrl);
  }, []);

  useEffect(() => {
    if (!clientUrl) return;
    let cancelled = false;
    Promise.all(tables.map(async (table) => [table.number, await qrPngDataUrl(linkFor(table))] as const)).then((entries) => {
      if (!cancelled) setQrImages(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [tables, clientUrl, linkFor]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      notify(success);
      await loadTables();
    } catch (e) {
      notify(`${t("common.error")} : ${(e as Error).message}`, true);
    }
  };

  /** Taux de TVA à envoyer à la création ; undefined = champ invalide (message affiché) */
  const newRateForCreation = (): { tax_rate?: number } | undefined => {
    const rate = parseRate(newTaxRate);
    if (rate === undefined) {
      notify(t("tables.vatInvalid"), true);
      return undefined;
    }
    return rate === null ? {} : { tax_rate: rate };
  };

  // À la création d'une table, son QR code est généré automatiquement par le serveur
  const createTables = () => {
    const count = parseInt(tableCount, 10);
    if (!Number.isInteger(count) || count < 1) return;
    const rate = newRateForCreation();
    if (!rate) return;
    run(() => orderApi("/tables", { method: "POST", body: JSON.stringify({ count, ...rate }) }), t("tables.created"));
  };

  const addTable = () => {
    const number = newTable.trim();
    if (!number) return;
    const rate = newRateForCreation();
    if (!rate) return;
    run(() => orderApi("/tables", { method: "POST", body: JSON.stringify({ numbers: [number], ...rate }) }), t("tables.added", { number }));
    setNewTable("");
  };

  const saveTableRate = async (table: RestaurantTable, rate: number | null) => {
    try {
      await orderApi(`/tables/${encodeURIComponent(table.number)}`, { method: "PATCH", body: JSON.stringify({ tax_rate: rate }) });
      notify(rate === null ? t("tables.vatCleared", { number: table.number }) : t("tables.vatSaved", { number: table.number }));
      await loadTables();
      return true;
    } catch {
      notify(t("tables.vatError"), true);
      return false;
    }
  };

  const regenerate = (table: RestaurantTable) => {
    if (!confirm(t("tables.confirmRegenerate", { number: table.number }))) return;
    run(() => orderApi(`/tables/${encodeURIComponent(table.number)}/regenerate`, { method: "POST" }), t("tables.regenerated"));
  };

  const remove = (table: RestaurantTable) => {
    if (!confirm(t("tables.confirmDelete", { number: table.number }))) return;
    run(() => orderApi(`/tables/${encodeURIComponent(table.number)}`, { method: "DELETE" }), t("tables.deleted"));
  };

  const withLinks = (list: RestaurantTable[]) => list.map((table) => ({ number: table.number, link: linkFor(table) }));

  const print = async (list: RestaurantTable[]) => {
    const opened = await printQrSheet(withLinks(list), {
      format: printFormat,
      showNumber,
      showHint,
      title: printTitle.trim(),
      labels: { table: (number) => t("tables.table", { number }), hint: t("tables.scanToOrder"), pageTitle: t("tables.sheetTitle") },
      lang,
      dir,
    });
    if (!opened) notify(t("tables.popupBlocked"), true);
  };

  const zipAll = async () => {
    setIsZipping(true);
    try {
      await downloadAllZip(withLinks(tables));
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("tables.title")}</h1>
          <p className="text-muted-foreground">{t("tables.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadTables}>
          <RefreshCw className="w-4 h-4 me-2" />
          {t("common.refresh")}
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-destructive">{t("admin.serverError", { error })}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("tables.setup")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {/* L'adresse du menu (Wi-Fi du PC) est choisie automatiquement : rien à afficher, sauf si aucun réseau n'est détecté */}
          {clientUrl && isLocalOnly(clientUrl) && (
            <p className="md:col-span-3 text-sm text-destructive">{t("tables.wifiWarning")}</p>
          )}
          <div className="space-y-2">
            <Label>{t("tables.createUpTo")}</Label>
            <div className="flex gap-2">
              <Input type="number" min={1} max={500} value={tableCount} onChange={(e) => setTableCount(e.target.value)} />
              <Button onClick={createTables}>{t("tables.create")}</Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("tables.addOne")}</Label>
            <div className="flex gap-2">
              <Input value={newTable} onChange={(e) => setNewTable(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTable()} />
              <Button onClick={addTable} aria-label={t("tables.create")}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="newTaxRate">{t("tables.vatForNew")}</Label>
            <Input
              id="newTaxRate"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.01"
              dir="ltr"
              className="text-start"
              value={newTaxRate}
              placeholder={defaultRatePlaceholder}
              onChange={(e) => setNewTaxRate(e.target.value)}
            />
          </div>
          <p className="md:col-span-3 text-xs text-muted-foreground">{t("tables.vatHint")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("tables.printDownload")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("tables.printFormat")}</Label>
              <Select value={printFormat} onValueChange={(v) => setPrintFormat(v as PrintFormat)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRINT_FORMATS) as PrintFormat[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {t(PRINT_FORMATS[key].labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("tables.topText")}</Label>
              <Input value={printTitle} onChange={(e) => setPrintTitle(e.target.value)} placeholder={t("tables.optional")} />
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={showNumber} onCheckedChange={setShowNumber} />
                {t("tables.showNumber")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={showHint} onCheckedChange={setShowHint} />
                {t("tables.showHint")}
              </label>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => print(tables)} disabled={tables.length === 0 || !clientUrl}>
              <Printer className="w-4 h-4 me-2" />
              {t("tables.printAll")}
            </Button>
            <Button variant="outline" onClick={zipAll} disabled={tables.length === 0 || isZipping || !clientUrl}>
              <FileArchive className="w-4 h-4 me-2" />
              {isZipping ? t("tables.preparing") : t("tables.downloadAll")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("tables.downloadHint")}</p>
        </CardContent>
      </Card>

      {tables.length === 0 && !error ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{t("tables.none")}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tables.map((table) => (
            <Card key={table.number}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">{t("tables.table", { number: table.number })}</CardTitle>
                  <Badge variant="outline" className={table.has_open_session ? "text-orange-600 border-orange-400" : "text-green-600 border-green-400"}>
                    {table.has_open_session ? t("tables.occupied") : t("tables.free")}
                  </Badge>
                </div>
                {table.tax_rate != null && (
                  <Badge variant="secondary" className="w-fit bg-primary/10 text-primary">
                    {t("tables.vatBadge", { rate: formatNumber(table.tax_rate) })}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {qrImages[table.number] && (
                  <img src={qrImages[table.number]} alt={t("tables.qrAlt", { number: table.number })} className="w-full rounded-md bg-white p-2" />
                )}
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" size="sm" onClick={() => downloadPng(table.number, linkFor(table))}>
                    <Download className="w-3 h-3 me-1" />PNG
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => downloadSvg(table.number, linkFor(table))}>
                    <Download className="w-3 h-3 me-1" />SVG
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => print([table])} aria-label={t("tables.printAll")}>
                    <Printer className="w-3 h-3" />
                  </Button>
                </div>
                <TableVatField table={table} placeholder={defaultRatePlaceholder} onSave={saveTableRate} />
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => regenerate(table)}>
                    <RotateCcw className="w-4 h-4 me-1" />
                    {t("tables.newQr")}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(table)} aria-label={t("common.delete")}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
