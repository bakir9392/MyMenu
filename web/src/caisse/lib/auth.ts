import { createContext, useContext } from "react";
import { AuthSession, readSession as readSharedSession } from "../../shared/session";

// Session du caissier : celle de la connexion commune (/login), lue dans le stockage partagé (src/shared/session.ts).
// Elle expire au bout de 8 h ; toute réponse 401 de l'API la termine aussi (voir main.tsx).

export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

/** Session d'un caissier encore valable (null si absente, d'un autre rôle ou expirée) */
export function readCashierSession(): AuthSession | null {
  const session = readSharedSession();
  if (!session || session.role !== "cashier") return null;
  if (Date.now() - session.loginAt > SESSION_MAX_AGE_MS) return null;
  return session;
}

export const getToken = () => readCashierSession()?.token ?? "";

interface CashierContextValue {
  session: AuthSession;
  logout: () => void;
}

export const CashierContext = createContext<CashierContextValue | null>(null);

export function useCashier(): CashierContextValue {
  const context = useContext(CashierContext);
  if (!context) throw new Error("useCashier must be used inside the authenticated app");
  return context;
}
