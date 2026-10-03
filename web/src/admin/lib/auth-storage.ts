import type { Currency } from "@/lib/bill";
import { ORDER_SERVER_URL } from "@/lib/order-server";
import { clearSession, readSession, writeSession, type AuthSession } from "../../shared/session";

// Adaptateur sur la session partagée (src/shared/session.ts, clé localStorage "mm_auth") : l'admin ne garde plus son propre stockage.
// Ne voit que les sessions d'administrateur ; une session de caissier est traitée au démarrage (renvoi vers /caisse/).

export const UNAUTHORIZED_EVENT = "mm-admin-unauthorized";

export interface AdminRestaurant {
  id: number;
  name: string;
  currency: Currency;
  timezone: string;
}

export interface AdminAuth {
  token: string;
  admin: { id: number; name: string; email: string };
  restaurant: AdminRestaurant;
}

export const toAdminAuth = (session: AuthSession): AdminAuth => ({
  token: session.token,
  admin: session.user,
  restaurant: session.restaurant,
});

export const readAuth = (): AdminAuth | null => {
  const session = readSession();
  return session?.role === "admin" ? toAdminAuth(session) : null;
};

/** Met à jour la session d'administrateur en gardant son heure de connexion */
export function writeAuth(auth: AdminAuth) {
  writeSession({
    role: "admin",
    token: auth.token,
    user: auth.admin,
    restaurant: auth.restaurant,
    loginAt: readSession()?.loginAt ?? Date.now(),
  });
}

export const clearAuth = clearSession;

export const getToken = () => readSession()?.token ?? "";

let checking = false;

/**
 * Appelé quand une requête reçoit un 401. Certaines routes répondent 401 sans que le jeton soit en cause (ex. ancien mot de passe
 * faux au changement de mot de passe) : on vérifie donc le jeton auprès du serveur avant de fermer la session.
 */
export async function handleUnauthorized() {
  if (checking || !getToken()) return;
  checking = true;
  try {
    const response = await fetch(`${ORDER_SERVER_URL}/api/auth/me`);
    if (response.status !== 401) return; // jeton valable, ou serveur injoignable : on reste connecté
    clearSession();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  } catch {
    // serveur injoignable : rien à faire
  } finally {
    checking = false;
  }
}
