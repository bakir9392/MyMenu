import type { Currency } from "./bill";

// Session du personnel (admin ou caissier), partagée par l'admin et la caisse : un seul écran de connexion (/login)
// pour tout le monde, le rôle du compte décide de la page ouverte ensuite (tableau de bord ou caisse).

export type Role = "admin" | "cashier";

export interface AuthSession {
  role: Role;
  token: string;
  user: { id: number; name: string; email: string };
  restaurant: { id: number; name: string; currency: Currency; timezone: string };
  /** Heure de connexion (ms) : sert à expirer la session comme le fait le serveur */
  loginAt: number;
}

const KEY = "mm_auth";
const MAX_AGE_MS: Record<Role, number> = { admin: 14 * 24 * 3600e3, cashier: 12 * 3600e3 };

/** Écran de connexion commun */
export const LOGIN_PATH = "/login";
/** Page d'accueil de chaque rôle */
export const HOME_BY_ROLE: Record<Role, string> = { admin: "/admin/", cashier: "/caisse/" };

export function readSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthSession;
    if (!session?.token || !MAX_AGE_MS[session.role] || Date.now() - session.loginAt > MAX_AGE_MS[session.role]) {
      localStorage.removeItem(KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function writeSession(session: AuthSession) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // stockage indisponible : la session ne survivra pas au rechargement
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // stockage indisponible
  }
}

/** En-tête d'authentification de la session en cours (vide si personne n'est connecté) */
export const bearerHeaders = (): Record<string, string> => {
  const session = readSession();
  return session ? { Authorization: `Bearer ${session.token}` } : {};
};

export type SignInError = "invalid" | "throttled" | "network" | "server";

/** Connexion avec l'e-mail et le mot de passe ; le serveur retrouve le compte (admin ou caissier) et renvoie son rôle */
export async function signIn(email: string, password: string): Promise<{ session: AuthSession } | { error: SignInError }> {
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 422) return { error: "invalid" };
    if (response.status === 429) return { error: "throttled" };
    if (!response.ok || !body?.data?.token) return { error: "server" };
    const data = body.data;
    const user = data.role === "cashier" ? data.cashier : data.admin;
    return {
      session: {
        role: data.role,
        token: data.token,
        user: { id: user.id, name: user.name, email: user.email },
        restaurant: data.restaurant,
        loginAt: Date.now(),
      },
    };
  } catch {
    return { error: "network" };
  }
}

/** Ouvre la page du rôle de la session (remplace la page actuelle) */
export const goHome = (role: Role) => window.location.replace(HOME_BY_ROLE[role]);
/** Retourne à l'écran de connexion commun */
export const goToLogin = () => window.location.replace(LOGIN_PATH);
