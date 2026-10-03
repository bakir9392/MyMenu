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

// Ce composant est partagé entre le dashboard admin et l'application caisse (fichier identique dans les deux)

const CLIENT_URL_KEY = "restaurant-client-url";

// Adresse du menu client encodée dans les QR codes (port 8081 par défaut, à remplacer par l'adresse en ligne)
const defaultClientUrl = () => {
  try {
    const saved = localStorage.getItem(CLIENT_URL_KEY);
    if (saved) return saved;
  } catch {
    // stockage indisponible
  }
  return `${window.location.protocol}//${window.location.hostname}:8081`;
};

interface TableQrCodesProps {
  language?: "fr" | "ar";
  notify: (title: string, isError?: boolean) => void;
}

export function TableQrCodes({ language = "fr", notify }: TableQrCodesProps) {
  const L = (fr: string, ar: string) => (language === "ar" ? ar : fr);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [clientUrl, setClientUrl] = useState(defaultClientUrl);
  const [tableCount, setTableCount] = useState("10");
  const [newTable, setNewTable] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [printFormat, setPrintFormat] = useState<PrintFormat>("medium");
  const [showNumber, setShowNumber] = useState(true);
  const [showHint, setShowHint] = useState(true);
  const [printTitle, setPrintTitle] = useState("");
  const [isZipping, setIsZipping] = useState(false);

  const linkFor = useCallback(
    (table: RestaurantTable) => `${clientUrl.trim().replace(/\/+$/, "")}/?t=${encodeURIComponent(table.qr_token)}`,
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
    try {
      localStorage.setItem(CLIENT_URL_KEY, clientUrl);
    } catch {
      // stockage indisponible
    }
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
      notify(`${L("Erreur", "خطأ")} : ${(e as Error).message}`, true);
    }
  };

  // À la création d'une table, son QR code est généré automatiquement par le serveur
  const createTables = () => {
    const count = parseInt(tableCount, 10);
    if (!Number.isInteger(count) || count < 1) return;
    run(() => orderApi("/tables", { method: "POST", body: JSON.stringify({ count }) }), L("Tables créées", "تم إنشاء الطاولات"));
  };

  const addTable = () => {
    const number = newTable.trim();
    if (!number) return;
    run(() => orderApi("/tables", { method: "POST", body: JSON.stringify({ numbers: [number] }) }), L(`Table ${number} ajoutée`, `تمت إضافة الطاولة ${number}`));
    setNewTable("");
  };

  const regenerate = (table: RestaurantTable) => {
    if (!confirm(L(`Nouveau QR code pour la table ${table.number} ? L'ancien ne fonctionnera plus (à réimprimer).`, `رمز QR جديد للطاولة ${table.number}؟ الرمز القديم لن يعمل بعد الآن (يجب إعادة الطباعة).`))) return;
    run(() => orderApi(`/tables/${encodeURIComponent(table.number)}/regenerate`, { method: "POST" }), L("QR code régénéré", "تم تجديد رمز QR"));
  };

  const remove = (table: RestaurantTable) => {
    if (!confirm(L(`Supprimer la table ${table.number} ?`, `حذف الطاولة ${table.number}؟`))) return;
    run(() => orderApi(`/tables/${encodeURIComponent(table.number)}`, { method: "DELETE" }), L("Table supprimée", "تم حذف الطاولة"));
  };

  const withLinks = (list: RestaurantTable[]) => list.map((table) => ({ number: table.number, link: linkFor(table) }));

  const print = async (list: RestaurantTable[]) => {
    const opened = await printQrSheet(withLinks(list), { format: printFormat, showNumber, showHint, title: printTitle.trim() });
    if (!opened) notify(L("Autorisez les fenêtres pop-up pour imprimer", "اسمح بالنوافذ المنبثقة للطباعة"), true);
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
          <h1 className="text-3xl font-bold">{L("Tables et QR codes", "الطاولات ورموز QR")}</h1>
          <p className="text-muted-foreground">
            {L(
              "Un QR code par table, généré à la création. La commande n'est possible qu'avec une session ouverte en scannant, fermée automatiquement à l'encaissement.",
              "رمز QR لكل طاولة يُنشأ تلقائياً. الطلب ممكن فقط بجلسة تُفتح عند المسح وتُغلق تلقائياً عند الدفع."
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadTables}>
          <RefreshCw className="w-4 h-4 mr-2" />
          {L("Actualiser", "تحديث")}
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-destructive">
            {L("Impossible de joindre le serveur de commandes :", "تعذر الاتصال بخادم الطلبات:")} {error}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{L("Configuration des tables", "إعداد الطاولات")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>{L("Adresse du menu client (dans les QR codes)", "عنوان قائمة الزبون (داخل رموز QR)")}</Label>
            <Input value={clientUrl} onChange={(e) => setClientUrl(e.target.value)} placeholder="https://menu.mon-restaurant.com" />
          </div>
          <div className="space-y-2">
            <Label>{L("Créer les tables 1 à N", "إنشاء الطاولات من 1 إلى N")}</Label>
            <div className="flex gap-2">
              <Input type="number" min={1} max={500} value={tableCount} onChange={(e) => setTableCount(e.target.value)} />
              <Button onClick={createTables}>{L("Créer", "إنشاء")}</Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{L("Ajouter une table (ex : 12, A3, Terrasse 1)", "إضافة طاولة (مثال: 12، A3)")}</Label>
            <div className="flex gap-2">
              <Input value={newTable} onChange={(e) => setNewTable(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTable()} />
              <Button onClick={addTable}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{L("Impression et téléchargement", "الطباعة والتحميل")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{L("Format d'impression", "صيغة الطباعة")}</Label>
              <Select value={printFormat} onValueChange={(v) => setPrintFormat(v as PrintFormat)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRINT_FORMATS) as PrintFormat[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {L(PRINT_FORMATS[key].fr, PRINT_FORMATS[key].ar)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{L("Texte en haut (ex : nom du restaurant)", "نص في الأعلى (مثال: اسم المطعم)")}</Label>
              <Input value={printTitle} onChange={(e) => setPrintTitle(e.target.value)} placeholder={L("Optionnel", "اختياري")} />
            </div>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={showNumber} onCheckedChange={setShowNumber} />
                {L("Afficher le numéro de table", "إظهار رقم الطاولة")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={showHint} onCheckedChange={setShowHint} />
                {L("Afficher « Scannez pour commander »", "إظهار «امسح للطلب»")}
              </label>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => print(tables)} disabled={tables.length === 0}>
              <Printer className="w-4 h-4 mr-2" />
              {L("Imprimer toutes les tables", "طباعة كل الطاولات")}
            </Button>
            <Button variant="outline" onClick={zipAll} disabled={tables.length === 0 || isZipping}>
              <FileArchive className="w-4 h-4 mr-2" />
              {isZipping ? L("Préparation...", "جارٍ التحضير...") : L("Tout télécharger (PNG + SVG, .zip)", "تحميل الكل (PNG + SVG، zip)")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {L(
              "PNG haute définition pour l'impression directe, SVG vectoriel pour un graphiste (verre, autocollant, gravure...). Les QR codes tolèrent un logo au centre.",
              "PNG عالي الدقة للطباعة المباشرة، وSVG للمصمم (زجاج، ملصق، نقش...). رموز QR تتحمل وضع شعار في الوسط."
            )}
          </p>
        </CardContent>
      </Card>

      {tables.length === 0 && !error ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {L("Aucune table. Créez vos tables ci-dessus.", "لا توجد طاولات. أنشئ طاولاتك أعلاه.")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tables.map((table) => (
            <Card key={table.number}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    {L("Table", "طاولة")} {table.number}
                  </CardTitle>
                  <Badge variant="outline" className={table.has_open_session ? "text-orange-600 border-orange-400" : "text-green-600 border-green-400"}>
                    {table.has_open_session ? L("Occupée", "مشغولة") : L("Libre", "حرة")}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {qrImages[table.number] && (
                  <img src={qrImages[table.number]} alt={`QR table ${table.number}`} className="w-full rounded-md bg-white p-2" />
                )}
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" size="sm" onClick={() => downloadPng(table.number, linkFor(table))}>
                    <Download className="w-3 h-3 mr-1" />PNG
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => downloadSvg(table.number, linkFor(table))}>
                    <Download className="w-3 h-3 mr-1" />SVG
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => print([table])}>
                    <Printer className="w-3 h-3" />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="flex-1" onClick={() => regenerate(table)}>
                    <RotateCcw className="w-4 h-4 mr-1" />
                    {L("Nouveau QR", "رمز جديد")}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(table)}>
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
