import { useState } from "react";
import { AlertTriangle, KeyRound, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isExpiringSoon, renewLicense, useLicense } from "@/lib/license";
import { useI18n } from "../../shared/i18n";

/** Bannière affichée quand la licence est expirée ou sur le point d'expirer (≤ 7 jours), avec le champ de renouvellement */
export function LicenseBanner() {
  const { t, formatDate } = useI18n();
  const { license } = useLicense();
  const [renewKey, setRenewKey] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [renewError, setRenewError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  if (license === "loading" || license === "error" || license === null || dismissed) return null;
  const isExpired = license.expired;
  if (!isExpired && !isExpiringSoon(license)) return null;

  const handleRenew = async () => {
    if (!renewKey.trim() || isBusy) return;
    setIsBusy(true);
    setRenewError("");
    const reply = await renewLicense(renewKey);
    setIsBusy(false);
    if (reply.ok) return setRenewKey("");
    setRenewError(reply.status === 422 ? t("license.renewInvalid") : reply.status === 0 ? t("auth.networkError") : t("license.renewError"));
  };

  return (
    <div className={`relative z-50 px-4 py-3 text-sm ${isExpired ? "bg-destructive text-destructive-foreground" : "bg-amber-500 text-white"}`}>
      <div className="mx-auto flex max-w-5xl flex-wrap items-start gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="font-medium">
            {isExpired
              ? t("license.bannerExpired")
              : t("license.bannerExpiring", { count: Math.max(1, license.daysLeft ?? 1), date: license.expiresDate ? formatDate(license.expiresDate) : "" })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 shrink-0 opacity-70" />
            <Input
              dir="ltr"
              className="h-8 w-44 border-white/40 bg-white/20 text-start font-mono text-sm uppercase text-white placeholder:text-white/60"
              placeholder={t("license.newKeyPlaceholder")}
              aria-label={t("license.newKey")}
              value={renewKey}
              onChange={(e) => setRenewKey(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleRenew()}
              spellCheck={false}
              autoComplete="off"
            />
            <Button
              size="sm"
              className={`h-8 bg-white hover:bg-white/90 ${isExpired ? "text-destructive" : "text-amber-700"}`}
              onClick={handleRenew}
              disabled={isBusy || !renewKey.trim()}
            >
              {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : t("license.activate")}
            </Button>
          </div>
          {!isExpired && (
            <button type="button" aria-label={t("common.close")} className="opacity-70 hover:opacity-100" onClick={() => setDismissed(true)}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {renewError && <p className="mx-auto mt-1 max-w-5xl text-xs opacity-90">{renewError}</p>}
    </div>
  );
}
