import { useCallback } from "react";
import { useI18n } from "../../shared/i18n";
import { useCashier } from "@/lib/auth";
import { useSocket } from "@/hooks/useSocket";

/**
 * Le restaurant du caissier : nom, devise et fuseau (paramètres à jour, sinon ceux reçus à la connexion),
 * avec les formateurs de montants et d'heures qui s'y rapportent.
 */
export function useRestaurant() {
  const { session } = useCashier();
  const { settings } = useSocket();
  const { money, formatDateTime, formatDate } = useI18n();

  const currency = settings?.currency ?? session.restaurant.currency;
  const timezone = settings?.timezone || session.restaurant.timezone;
  const name = settings?.restaurant_name || session.restaurant.name;

  const fmt = useCallback((amount: number) => money(amount, currency), [money, currency]);
  // Une date absente ou illisible (événement incomplet) s'affiche vide plutôt que de casser l'écran
  const dateTime = useCallback((value?: Date | string | null) => {
    if (!value) return "";
    try {
      return formatDateTime(value, timezone);
    } catch {
      return "";
    }
  }, [formatDateTime, timezone]);
  const time = useCallback((value?: Date | string | null) => {
    if (!value) return "";
    try {
      return formatDate(value, timezone, { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }, [formatDate, timezone]);

  return { settings, name, currency, timezone, fmt, dateTime, time };
}
