import { FormEvent, useState } from "react";
import { AlertTriangle, Check, Copy, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { isExpiringSoon, maskLicenseKey, renewLicense, useLicense } from "@/lib/license";
import { useI18n } from "../../../shared/i18n";

interface LicenseCardProps {
  notify: (title: string, isError?: boolean) => void;
}

/** Licence de l'administrateur : clé (masquée par défaut), dates, jours restants et renouvellement avec une nouvelle clé */
export function LicenseCard({ notify }: LicenseCardProps) {
  const { t, formatDate } = useI18n();
  const { license } = useLicense();
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [renewKey, setRenewKey] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [renewError, setRenewError] = useState("");

  const copyKey = async () => {
    if (license === "loading" || license === "error" || !license) return;
    try {
      await navigator.clipboard.writeText(license.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify(t("license.copyFailed"), true);
    }
  };

  const submitRenew = async (event: FormEvent) => {
    event.preventDefault();
    if (!renewKey.trim() || isBusy) return;
    setIsBusy(true);
    setRenewError("");
    const reply = await renewLicense(renewKey);
    setIsBusy(false);
    if (reply.ok) {
      setRenewKey("");
      return notify(t("license.renewed"));
    }
    setRenewError(reply.status === 422 ? t("license.renewInvalid") : reply.status === 0 ? t("auth.networkError") : t("license.renewError"));
  };

  const body = () => {
    if (license === "loading") return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
    if (license === "error") return <p className="text-sm text-destructive">{t("license.loadError")}</p>;
    if (license === null) return <p className="text-sm text-muted-foreground">{t("license.none")}</p>;

    const soon = isExpiringSoon(license);
    return (
      <>
        <div className="space-y-2">
          <Label>{t("license.key")}</Label>
          <div className="flex items-center gap-2">
            <div className="flex h-10 min-w-0 flex-1 items-center rounded-md border bg-muted/40 px-3 font-mono text-sm tracking-wider" dir="ltr">
              <span className="truncate">{visible ? license.key : maskLicenseKey(license.key)}</span>
            </div>
            <Button type="button" variant="outline" size="icon" onClick={() => setVisible((v) => !v)} aria-label={visible ? t("license.hideKey") : t("license.showKey")} title={visible ? t("license.hideKey") : t("license.showKey")}>
              {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button type="button" variant="outline" size="icon" onClick={copyKey} aria-label={t("license.copyKey")} title={t("license.copyKey")}>
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">{t("license.activatedOn")}</p>
            <p className="font-medium">{license.activatedDate ? formatDate(license.activatedDate) : t("common.none")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("license.expiresOn")}</p>
            <p className="font-medium">{license.expiresDate ? formatDate(license.expiresDate) : t("common.none")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("license.status")}</p>
            {license.expired ? (
              <Badge variant="destructive">{t("license.expired")}</Badge>
            ) : (
              <Badge className={soon ? "bg-amber-500 text-white hover:bg-amber-500" : "bg-green-600 text-white hover:bg-green-600"}>
                {license.daysLeft === null ? t("license.active") : t("license.daysLeft", { count: license.daysLeft })}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t("license.keepWarning")}</span>
        </div>

        <form onSubmit={submitRenew} className="space-y-2 border-t pt-4">
          <Label htmlFor="renewKey">{t("license.renewTitle")}</Label>
          <p className="text-xs text-muted-foreground">{t("license.renewHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <KeyRound className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="renewKey"
                dir="ltr"
                className="ps-9 text-start font-mono uppercase tracking-wider"
                value={renewKey}
                onChange={(e) => setRenewKey(e.target.value.toUpperCase())}
                placeholder={t("license.newKeyPlaceholder")}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button type="submit" disabled={isBusy || !renewKey.trim()}>
              {isBusy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t("license.renew")}
            </Button>
          </div>
          {renewError && <p role="alert" className="text-xs text-destructive">{renewError}</p>}
        </form>
      </>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5 text-primary" />{t("license.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{body()}</CardContent>
    </Card>
  );
}
