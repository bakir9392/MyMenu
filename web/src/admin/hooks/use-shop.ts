import { useI18n } from "../../shared/i18n";
import { useRestaurantSettings } from "@/lib/bill";
import { useSettingsRefreshKey } from "@/contexts/settings-refresh-context";
import { readAuth } from "@/lib/auth-storage";

/**
 * Paramètres du restaurant + formatage dans SA devise et SON fuseau horaire.
 * Tant que les paramètres ne sont pas chargés, on utilise ceux reçus à la connexion.
 */
export function useShop(refreshKey?: unknown) {
  const contextKey = useSettingsRefreshKey();
  const settings = useRestaurantSettings(refreshKey ?? contextKey);
  const i18n = useI18n();
  const stored = readAuth()?.restaurant;
  const currency = settings?.currency ?? stored?.currency;
  const timezone = settings?.timezone ?? stored?.timezone;
  return {
    settings,
    currency,
    timezone,
    i18n,
    money: (amount: number) => i18n.money(amount, currency),
    dateTime: (value: Date | string) => i18n.formatDateTime(value, timezone),
  };
}
