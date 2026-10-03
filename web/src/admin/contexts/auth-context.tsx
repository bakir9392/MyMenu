import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchMe } from "@/lib/auth-api";
import { AdminAuth, AdminRestaurant, clearAuth, readAuth, toAdminAuth, UNAUTHORIZED_EVENT, writeAuth } from "@/lib/auth-storage";
import { AuthSession, goHome, readSession, writeSession } from "../../shared/session";

type Status = "checking" | "anonymous" | "authenticated" | "unreachable";

interface AuthContextValue {
  status: Status;
  auth: AdminAuth | null;
  /** Vrai quand la session a pris fin toute seule (jeton expiré ou refusé) */
  sessionExpired: boolean;
  /** Enregistre la session d'un administrateur (connexion ou création du restaurant) */
  signIn: (session: AuthSession) => void;
  signOut: () => void;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AdminAuth | null>(readAuth);
  const [status, setStatus] = useState<Status>(() => (readSession() ? "checking" : "anonymous"));
  const [sessionExpired, setSessionExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Vérifie la session gardée au démarrage (compte supprimé, jeton expiré...) et rafraîchit le restaurant.
  // Une session de caissier n'a rien à faire ici : retour à la caisse.
  useEffect(() => {
    const stored = readSession();
    if (!stored) return;
    if (stored.role !== "admin") return goHome(stored.role);
    let cancelled = false;
    setStatus("checking");
    fetchMe().then((reply) => {
      if (cancelled) return;
      if (reply.ok && reply.data?.role === "admin") {
        const next: AdminAuth = { ...toAdminAuth(stored), restaurant: reply.data.restaurant as AdminRestaurant };
        writeAuth(next);
        setAuth(next);
        setStatus("authenticated");
      } else if (reply.ok && reply.data) {
        goHome(reply.data.role);
      } else if (reply.status === 0 || reply.status >= 500) {
        setStatus("unreachable");
      } else {
        clearAuth();
        setAuth(null);
        setSessionExpired(true);
        setStatus("anonymous");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Le serveur a répondu 401 pendant l'utilisation : retour à l'écran de connexion
  useEffect(() => {
    const expired = () => {
      setAuth(null);
      setSessionExpired(true);
      setStatus("anonymous");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, expired);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, expired);
  }, []);

  const signIn = useCallback((session: AuthSession) => {
    writeSession(session);
    setAuth(toAdminAuth(session));
    setSessionExpired(false);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(() => {
    clearAuth();
    setAuth(null);
    setSessionExpired(false);
    setStatus("anonymous");
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo(() => ({ status, auth, sessionExpired, signIn, signOut, retry }), [status, auth, sessionExpired, signIn, signOut, retry]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
