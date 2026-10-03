import { useCallback, useEffect, useState } from "react";
import { fetchLicenseRequest, renewLicenseRequest, type LicenseStatus } from "@/lib/auth-api";
import { parseServerDate } from "../../shared/i18n";

// État de la licence de l'administrateur, partagé entre le bandeau d'alerte et la carte « Licence » des Paramètres.

const LICENSE_CHANGED = "mm-license-changed";
export const EXPIRY_WARNING_DAYS = 7;

export interface LicenseInfo extends LicenseStatus {
  expiresDate: Date | null;
  activatedDate: Date | null;
  /** Jours entiers restants (arrondis au-dessus), 0 si expirée */
  daysLeft: number | null;
}

const toInfo = (status: LicenseStatus): LicenseInfo => {
  const expiresDate = status.expiresAt ? parseServerDate(status.expiresAt) : null;
  const activatedDate = status.activatedAt ? parseServerDate(status.activatedAt) : null;
  const daysLeft = expiresDate ? Math.max(0, Math.ceil((expiresDate.getTime() - Date.now()) / 86_400_000)) : null;
  return { ...status, expiresDate, activatedDate, daysLeft };
};

export const isExpiringSoon = (license: LicenseInfo) => !license.expired && license.daysLeft !== null && license.daysLeft <= EXPIRY_WARNING_DAYS;

/** Clé masquée : les lettres et chiffres deviennent des points, les tirets restent */
export const maskLicenseKey = (key: string) => key.replace(/[A-Za-z0-9]/g, "•");

/** null = pas de licence ; "loading" tant que le serveur n'a pas répondu ; "error" si la lecture a échoué */
export function useLicense() {
  const [license, setLicense] = useState<LicenseInfo | null | "loading" | "error">("loading");

  const reload = useCallback(async () => {
    const reply = await fetchLicenseRequest();
    if (!reply.ok) return setLicense("error");
    setLicense(reply.data ? toInfo(reply.data) : null);
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener(LICENSE_CHANGED, reload);
    return () => window.removeEventListener(LICENSE_CHANGED, reload);
  }, [reload]);

  return { license, reload };
}

/** Renouvelle avec une nouvelle clé ; prévient les autres écrans qui affichent la licence */
export async function renewLicense(key: string) {
  const reply = await renewLicenseRequest(key.trim().toUpperCase());
  if (reply.ok) window.dispatchEvent(new Event(LICENSE_CHANGED));
  return reply;
}
