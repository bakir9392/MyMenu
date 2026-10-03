import { useCallback, useEffect, useState } from "react";
import { ORDER_SERVER_URL } from "@/lib/orderServer";

const STORAGE_KEY = "menu_magique_session";

export type TableSessionStatus = "loading" | "active" | "none" | "closed";

export interface TableSession {
  status: TableSessionStatus;
  token: string | null;
  tableNumber: string | null;
  /** À appeler quand le serveur signale que la session est terminée (paiement) */
  endSession: () => void;
}

interface StoredSession {
  token: string;
  tableNumber: string;
}

const readStored = (): StoredSession | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeStored = (session: StoredSession | null) => {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
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
  const [state, setState] = useState<Omit<TableSession, "endSession">>({
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
        return finish(null, "closed");
      } catch (error) {
        console.warn("Table session check failed:", error);
        finish(null, "none");
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const endSession = useCallback(() => {
    writeStored(null);
    setState({ status: "closed", token: null, tableNumber: null });
  }, []);

  return { ...state, endSession };
}
