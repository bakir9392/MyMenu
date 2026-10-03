import { Info, User } from "lucide-react";
import { useI18n } from "../../../shared/i18n";
import { useActiveCashiers } from "./active-cashier-status";

/**
 * Qui est connecté en ce moment. Le serveur n'a pas de déconnexion forcée côté administrateur :
 * désactiver le caissier dans la section Caissiers coupe son accès immédiatement.
 */
export function CashierLogout() {
  const { t } = useI18n();
  const sessions = useActiveCashiers();

  if (sessions.length === 0) return null;

  return (
    <div className="space-y-1 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <div className="flex items-center gap-2">
        <User className="h-4 w-4 text-blue-600" />
        <span className="text-sm font-medium text-blue-800">
          {t("activeCashier.loggedInAs", { names: sessions.map((session) => session.name).join(", ") })}
        </span>
      </div>
      <p className="flex items-start gap-2 text-xs text-blue-700">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t("activeCashier.deactivateHint")}</span>
      </p>
    </div>
  );
}
