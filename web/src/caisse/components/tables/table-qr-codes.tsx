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
import { useRestaurant } from "@/hooks/useRestaurant";
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

interface TableQrCodesProps {
  notify: (title: string, isError?: boolean) => void;
}

export function TableQrCodes({ notify }: TableQrCodesProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const { name } = useRestaurant();
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [clientUrl, setClientUrl] = useState<string | null>(null);
  const [tableCount, setTableCount] = useState("10");
  const [newTable, setNewTable] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [printFormat, setPrintFormat] = useState<PrintFormat>("medium");
  const [showNumber, setShowNumber] = useState(true);
  const [showHint, setShowHint] = useState(true);
  const [printTitle, setPrintTitle] = useState("");
  const [titleEdited, setTitleEdited] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

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

  // Le texte du haut propose le nom du restaurant tant qu'on ne l'a pas modifié
  useEffect(() => {
    if (!titleEdited) setPrintTitle(name);
  }, [name, titleEdited]);

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
      notify(t("caisse.error", { message: (e as Error).message }), true);
    }
  };

  // À la création d'une table, son QR code est généré automatiquement par le serveur
  const createTables = () => {
    const count = parseInt(tableCount, 10);
    if (!Number.isInteger(count) || count < 1) return;
    run(() => orderApi("/tables", { method: "POST", body: JSON.stringify({ count }) }), t("caisse.qr.created"));
  };

  const addTable = () => {
    const number = newTable.trim();
    if (!number) return;
    run(() => orderApi("/tables", { method: "POST", body: JSON.stringify({ numbers: [number] }) }), t("caisse.qr.added", { number }));
    setNewTable("");
  };

  const regenerate = (table: RestaurantTable) => {
    if (!confirm(t("caisse.qr.regenerateConfirm", { number: table.number }))) return;
    run(() => orderApi(`/tables/${encodeURIComponent(table.number)}/regenerate`, { method: "POST" }), t("caisse.qr.regenerated"));
  };

  const remove = (table: RestaurantTable) => {
    if (!confirm(t("caisse.qr.deleteConfirm", { number: table.number }))) return;
    run(() => orderApi(`/tables/${encodeURIComponent(table.number)}`, { method: "DELETE" }), t("caisse.qr.deleted"));
  };

  const withLinks = (list: RestaurantTable[]) => list.map((table) => ({ number: table.number, link: linkFor(table) }));

  const print = async (list: RestaurantTable[]) => {
    const opened = await printQrSheet(withLinks(list), { format: printFormat, showNumber, showHint, title: printTitle.trim(), i18n });
    if (!opened) notify(t("caisse.qr.popup"), true);
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
          <h1 className="text-3xl font-bold">{t("caisse.qr.title")}</h1>
          <p className="text-muted-foreground">
            {t("caisse.qr.subtitle")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadTables}>
          <RefreshCw className="w-4 h-4 me-2" />
          {t("common.refresh")}
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-destructive">
            {t("caisse.qr.unreachable", { message: error })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("caisse.qr.setup")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {/* L'adresse du menu (Wi-Fi du PC) est choisie automatiquement : rien à afficher, sauf si aucun réseau n'est détecté */}
          {clientUrl && isLocalOnly(clientUrl) && (
            <p className="md:col-span-3 text-sm text-destructive">
              {t("caisse.qr.noWifi")}
            </p>
          )}
          <div className="space-y-2">
            <Label>{t("caisse.qr.createN")}</Label>
            <div className="flex gap-2">
              <Input type="number" min={1} max={500} value={tableCount} onChange={(e) => setTableCount(e.target.value)} />
              <Button onClick={createTables}>{t("caisse.qr.create")}</Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("caisse.qr.addOne")}</Label>
            <div className="flex gap-2">
              <Input value={newTable} onChange={(e) => setNewTable(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTable()} />
              <Button onClick={addTable} aria-label={t("caisse.qr.addAction")} title={t("caisse.qr.addAction")}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("caisse.qr.printTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("caisse.qr.printFormat")}</Label>
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
              <Label>{t("caisse.qr.topText")}</Label>
              <Input value={printTitle} onChange={(e) => { setTitleEdited(true); setPrintTitle(e.target.value); }} placeholder={t("caisse.qr.optional")} />
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={showNumber} onCheckedChange={setShowNumber} />
                {t("caisse.qr.showNumber")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={showHint} onCheckedChange={setShowHint} />
                {t("caisse.qr.showHint")}
              </label>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => print(tables)} disabled={tables.length === 0 || !clientUrl}>
              <Printer className="w-4 h-4 me-2" />
              {t("caisse.qr.printAll")}
            </Button>
            <Button variant="outline" onClick={zipAll} disabled={tables.length === 0 || isZipping || !clientUrl}>
              <FileArchive className="w-4 h-4 me-2" />
              {isZipping ? t("caisse.qr.preparing") : t("caisse.qr.downloadAll")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("caisse.qr.help")}
          </p>
        </CardContent>
      </Card>

      {tables.length === 0 && !error ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t("caisse.qr.empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tables.map((table) => (
            <Card key={table.number}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    {t("caisse.table.label", { number: table.number })}
                  </CardTitle>
                  <Badge variant="outline" className={table.has_open_session ? "text-orange-600 border-orange-400" : "text-green-600 border-green-400"}>
                    {table.has_open_session ? t("caisse.table.occupied") : t("caisse.table.free")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {table.tax_rate != null && (
                  <Badge variant="outline" className="text-xs font-normal">{t("caisse.table.vat", { rate: table.tax_rate })}</Badge>
                )}
                {qrImages[table.number] && (
                  <img src={qrImages[table.number]} alt={t("caisse.qr.alt", { number: table.number })} className="w-full rounded-md bg-white p-2" />
                )}
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" size="sm" onClick={() => downloadPng(table.number, linkFor(table))}>
                    <Download className="w-3 h-3 me-1" />PNG
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => downloadSvg(table.number, linkFor(table))}>
                    <Download className="w-3 h-3 me-1" />SVG
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => print([table])} aria-label={t("caisse.qr.printOne")} title={t("caisse.qr.printOne")}>
                    <Printer className="w-3 h-3" />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => regenerate(table)}>
                    <RotateCcw className="w-4 h-4 me-1" />
                    {t("caisse.qr.newQr")}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(table)} aria-label={t("common.delete")} title={t("common.delete")}>
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
