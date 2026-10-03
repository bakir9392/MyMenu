import { useCallback, useEffect, useState } from "react";
import { ORDER_SERVER_URL } from "@/lib/orderServer";

const STORAGE_KEY = "menu_magique_session";
// Dernière visite terminée (encaissée) : le serveur garde l'addition ~12 h et accepte une réclamation pendant 3 h
const LAST_VISIT_KEY = "menu_magique_last_visit";
const LAST_VISIT_HOURS = 12;
const COMPLAINT_HOURS = 3;

export type TableSessionStatus = "loading" | "active" | "none" | "closed";

export interface TableSession {
  status: TableSessionStatus;
  token: string | null;
  tableNumber: string | null;
  /** À appeler quand le serveur signale que la session est terminée (paiement) */
  endSession: () => void;
  /** Visite terminée depuis moins de 12 h (pour récupérer son addition après avoir payé), sinon null */
  lastVisit: StoredSession | null;
  /** Vrai si la dernière visite date de moins de 3 h : une réclamation est encore acceptée */
  canComplainAfterVisit: boolean;
}

interface StoredSession {
  token: string;
  tableNumber: string;
  /** Fin de la visite (ms), seulement pour la dernière visite terminée */
  endedAt?: number;
}

const readStored = (): StoredSession | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

// Mémorise la visite qui vient de se terminer
const rememberLastVisit = (session: StoredSession | null) => {
  if (!session) return;
  try {
    localStorage.setItem(LAST_VISIT_KEY, JSON.stringify({ token: session.token, tableNumber: session.tableNumber, endedAt: Date.now() }));
  } catch {
    // stockage indisponible
  }
};

const readLastVisit = (): StoredSession | null => {
  try {
    const raw = localStorage.getItem(LAST_VISIT_KEY);
    if (!raw) return null;
    const visit = JSON.parse(raw);
    if (Date.now() - visit.endedAt > LAST_VISIT_HOURS * 3600e3) return null;
    return { token: visit.token, tableNumber: visit.tableNumber, endedAt: visit.endedAt };
  } catch {
    return null;
  }
};

/** Jeton envoyé à l'API (en-tête X-Session-Token) : la session en cours, sinon celle de la visite qui vient de se terminer */
export const getSessionToken = (): string => readStored()?.token ?? readLastVisit()?.token ?? "";

const writeStored = (session: StoredSession | null) => {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: session.token, tableNumber: session.tableNumber }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // stockage indisponible (navigation privée) : la session reste valable pour cette page
  }
};

/**
 * Session de table créée en scannant le QR code de la table (lien ?t=<token de la table>).
 * Le paramètre est retiré de l'adresse aussitôt : un lien copié, un favori ou l'historique ne
 * contiennent plus que la page, et ne permettent pas de commander une fois la session terminée.
 */
export function useTableSession(): TableSession {
  const [lastVisit, setLastVisit] = useState<StoredSession | null>(readLastVisit);
  const [state, setState] = useState<Omit<TableSession, "endSession" | "lastVisit" | "canComplainAfterVisit">>({
    status: "loading",
    token: null,
    tableNumber: null,
  });

  useEffect(() => {
    let cancelled = false;
    const url = new URL(window.location.href);
    const qr = url.searchParams.get("t");

    if (qr) {
      url.searchParams.delete("t");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }

    const finish = (session: StoredSession | null, status: TableSessionStatus) => {
      writeStored(session);
      if (!cancelled) {
        setState({ status, token: session?.token ?? null, tableNumber: session?.tableNumber ?? null });
      }
    };

    const load = async () => {
      try {
        if (qr) {
          const response = await fetch(`${ORDER_SERVER_URL}/api/sessions/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ qr }),
          });
          if (response.ok) {
            const { data } = await response.json();
            return finish({ token: data.sessionToken, tableNumber: data.tableNumber }, "active");
          }
          return finish(null, "none");
        }

        const stored = readStored();
        if (!stored) return finish(null, "none");

        const response = await fetch(`${ORDER_SERVER_URL}/api/sessions/${encodeURIComponent(stored.token)}`);
        if (response.ok) return finish(stored, "active");
        // La visite a été encaissée pendant que la page était fermée
        rememberLastVisit(stored);
        if (!cancelled) setLastVisit(readLastVisit());
        return finish(null, "closed");
      } catch (error) {
        console.warn("Table session check failed:", error);
        // Réseau coupé : on garde la session mémorisée, le serveur la refusera si elle est terminée
        const stored = qr ? null : readStored();
        finish(stored, stored ? "active" : "none");
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const endSession = useCallback(() => {
    rememberLastVisit(readStored());
    setLastVisit(readLastVisit());
    writeStored(null);
    setState({ status: "closed", token: null, tableNumber: null });
  }, []);

  const canComplainAfterVisit = !!lastVisit?.endedAt && Date.now() - lastVisit.endedAt <= COMPLAINT_HOURS * 3600e3;
  return { ...state, endSession, lastVisit, canComplainAfterVisit };
}
