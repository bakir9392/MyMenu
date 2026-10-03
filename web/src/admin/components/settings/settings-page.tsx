import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Coins, Percent, Receipt, Save, Store } from "lucide-react";
import { breakdownLines, computeBill, CURRENCY_CODES, Currency, fetchSettings, includedTaxNote, RestaurantSettings } from "@/lib/bill";
import { LicenseCard } from "@/components/settings/license-card";
import { useI18n } from "../../../shared/i18n";

interface SettingsPageProps {
  notify: (title: string, isError?: boolean) => void;
}

// Fuseaux horaires courants (noms IANA) ; le fuseau actuel et celui de l'appareil sont ajoutés s'ils manquent
const COMMON_TIME_ZONES = [
  "UTC",
  "Europe/Paris", "Europe/Brussels", "Europe/Luxembourg", "Europe/Zurich", "Europe/Berlin", "Europe/Vienna", "Europe/Amsterdam",
  "Europe/Madrid", "Europe/Lisbon", "Europe/Rome", "Europe/London", "Europe/Dublin", "Europe/Athens", "Europe/Istanbul", "Europe/Moscow",
  "Africa/Algiers", "Africa/Tunis", "Africa/Casablanca", "Africa/Cairo", "Africa/Dakar", "Africa/Abidjan", "Africa/Lagos", "Africa/Johannesburg",
  "Asia/Beirut", "Asia/Dubai", "Asia/Riyadh", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore", "Asia/Shanghai", "Asia/Tokyo",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "America/Montreal", "America/Mexico_City",
  "America/Sao_Paulo", "America/Argentina/Buenos_Aires", "Australia/Sydney", "Pacific/Auckland",
];

/** Paramètres du restaurant : nom et coordonnées (factures), devise, fuseau horaire, TVA, frais de table / service */
export function SettingsPage({ notify }: SettingsPageProps) {
  const { t, money } = useI18n();
  const [form, setForm] = useState<RestaurantSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchSettings().then(setForm);
  }, []);

  const set = <K extends keyof RestaurantSettings>(key: K, value: RestaurantSettings[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  // Aperçu : une addition de 100 avec les réglages saisis
  const example = useMemo(() => (form ? computeBill(100, form) : null), [form]);

  const timeZones = useMemo(() => {
    const zones = new Set(COMMON_TIME_ZONES);
    if (form?.timezone) zones.add(form.timezone);
    try {
      zones.add(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      // navigateur sans Intl complet
    }
    return Array.from(zones);
  }, [form?.timezone]);

  const save = async () => {
    if (!form) return;
    setIsSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json();
      if (!response.ok) {
        setErrors(body.errors || {});
        notify(t(body.errors ? "settings.checkFields" : "settings.saveError"), true);
        return;
      }
      setErrors({});
      setForm(body.data);
      notify(t("settings.saved"));
    } catch {
      notify(t("settings.saveError"), true);
    } finally {
      setIsSaving(false);
    }
  };

  if (!form) return <p className="text-muted-foreground">{t("common.loading")}</p>;

  // Le serveur répond en anglais : on affiche notre texte pour chaque champ refusé
  const fieldError = (key: string) => {
    if (!errors[key]) return null;
    const message = t(`settings.err.${key}`);
    return <p className="text-xs text-destructive">{message.startsWith("settings.err.") ? t("settings.invalidValue") : message}</p>;
  };
  const choice = (active: boolean) =>
    `rounded-lg border p-3 text-start text-sm transition-colors ${active ? "border-primary bg-primary/10" : "hover:border-primary/50"}`;
  const m = (amount: number) => money(amount, form.currency);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">{t("settings.title")}</h1>
          <p className="text-muted-foreground">{t("settings.subtitle")}</p>
        </div>
        <Button onClick={save} disabled={isSaving}>
          <Save className="w-4 h-4 me-2" />
          {isSaving ? t("settings.saving") : t("settings.save")}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Coordonnées */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Store className="w-5 h-5 text-primary" />{t("settings.restaurant")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>{t("settings.name")}</Label>
                <Input value={form.restaurant_name} onChange={(e) => set("restaurant_name", e.target.value)} placeholder={t("settings.namePlaceholder")} />
                {fieldError("restaurant_name")}
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>{t("settings.footer")}</Label>
                <Textarea rows={2} value={form.receipt_footer} onChange={(e) => set("receipt_footer", e.target.value)} placeholder={t("receipt.thanks")} />
              </div>
            </CardContent>
          </Card>

          {/* Devise et fuseau horaire */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Coins className="w-5 h-5 text-primary" />{t("settings.regional")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("common.currency")}</Label>
                <Select value={form.currency} onValueChange={(value) => set("currency", value as Currency)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_CODES.map((code) => (
                      <SelectItem key={code} value={code}>{t(`common.currency${code}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldError("currency")}
                <p className="text-xs text-muted-foreground">{t("settings.currencyHint")}</p>
              </div>
              <div className="space-y-2">
                <Label>{t("settings.timezone")}</Label>
                <Select value={form.timezone} onValueChange={(value) => set("timezone", value)}>
                  <SelectTrigger dir="ltr" className="text-start">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="ltr">
                    {timeZones.map((zone) => (
                      <SelectItem key={zone} value={zone}>{zone}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldError("timezone")}
                <p className="text-xs text-muted-foreground">{t("settings.timezoneHint")}</p>
              </div>
            </CardContent>
          </Card>

          {/* TVA */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Percent className="w-5 h-5 text-primary" />{t("settings.vat")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={form.tax_enabled} onCheckedChange={(v) => set("tax_enabled", v)} />
                {t("settings.applyVat")}
              </label>
              {form.tax_enabled && (
                <>
                  <div className="space-y-2 max-w-[12rem]">
                    <Label>{t("settings.rate")}</Label>
                    <Input type="number" min={0} max={100} step="0.5" value={form.tax_rate} onChange={(e) => set("tax_rate", Number(e.target.value))} />
                    {fieldError("tax_rate")}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <button type="button" className={choice(form.tax_mode === "included")} onClick={() => set("tax_mode", "included")}>
                      <p className="font-medium">{t("settings.vatIncluded")}</p>
                      <p className="text-muted-foreground text-xs mt-1">{t("settings.vatIncludedText")}</p>
                    </button>
                    <button type="button" className={choice(form.tax_mode === "added")} onClick={() => set("tax_mode", "added")}>
                      <p className="font-medium">{t("settings.vatAdded")}</p>
                      <p className="text-muted-foreground text-xs mt-1">{t("settings.vatAddedText")}</p>
                    </button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Frais de table / service */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Receipt className="w-5 h-5 text-primary" />{t("settings.serviceTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <button type="button" className={choice(form.service_type === "none")} onClick={() => set("service_type", "none")}>
                  <p className="font-medium">{t("settings.serviceNone")}</p>
                </button>
                <button type="button" className={choice(form.service_type === "fixed")} onClick={() => set("service_type", "fixed")}>
                  <p className="font-medium">{t("settings.serviceFixed")}</p>
                  <p className="text-muted-foreground text-xs mt-1">{t("settings.serviceFixedText")}</p>
                </button>
                <button type="button" className={choice(form.service_type === "percent")} onClick={() => set("service_type", "percent")}>
                  <p className="font-medium">{t("settings.servicePercent")}</p>
                  <p className="text-muted-foreground text-xs mt-1">{t("settings.servicePercentText")}</p>
                </button>
              </div>
              {form.service_type !== "none" && (
                <div className="space-y-2 max-w-[12rem]">
                  <Label>{form.service_type === "fixed" ? t("settings.amountPerTable", { currency: form.currency }) : t("settings.percentage")}</Label>
                  <Input type="number" min={0} step="0.5" value={form.service_value} onChange={(e) => set("service_value", Number(e.target.value))} />
                  {fieldError("service_value")}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Licence : clé, dates, renouvellement */}
          <LicenseCard notify={notify} />
        </div>

        {/* Aperçu d'une addition */}
        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle className="text-lg">{t("settings.preview")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("settings.previewExample", { amount: m(100) })}</p>
          </CardHeader>
          <CardContent className="space-y-2 font-mono text-sm">
            <p className="text-center font-bold text-base not-italic">{form.restaurant_name || "—"}</p>
            {form.restaurant_address && <p className="text-center text-xs text-muted-foreground">{form.restaurant_address}</p>}
            {form.restaurant_phone && <p className="text-center text-xs text-muted-foreground">{t("receipt.phone", { phone: form.restaurant_phone })}</p>}
            <div className="border-t border-dashed my-2" />
            <div className="flex justify-between"><span>{t("settings.previewDishes")}</span><span>{m(100)}</span></div>
            {example && breakdownLines(example, t).filter((l) => l.label !== t("bill.subtotal")).map((line) => (
              <div key={line.label} className="flex justify-between"><span>{line.label}</span><span>{m(line.amount)}</span></div>
            ))}
            <div className="flex justify-between font-bold text-base border-t border-dashed pt-2">
              <span>{t("receipt.total")}</span><span>{example ? m(example.total) : ""}</span>
            </div>
            {example && includedTaxNote(example, t, m) && <p className="text-xs text-muted-foreground text-end">{includedTaxNote(example, t, m)}</p>}
            <div className="border-t border-dashed my-2" />
            <p className="text-center text-xs">{form.receipt_footer || t("receipt.thanks")}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
