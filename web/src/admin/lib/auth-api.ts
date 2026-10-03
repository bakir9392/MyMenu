import { ORDER_SERVER_URL } from "@/lib/order-server";
import type { Currency } from "@/lib/bill";
import type { AdminRestaurant } from "@/lib/auth-storage";

// Appels d'authentification (publics, ou avec le jeton ajouté par installFetchHeaders). La connexion passe par signIn() du socle commun.

export interface ApiReply<T> {
  ok: boolean;
  /** 0 = serveur injoignable */
  status: number;
  data?: T;
  error?: string;
  errors?: Record<string, string[] | string>;
}

async function call<T>(path: string, init?: RequestInit): Promise<ApiReply<T>> {
  try {
    const response = await fetch(`${ORDER_SERVER_URL}/api/auth${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok && body.success !== false, status: response.status, data: body.data, error: body.error, errors: body.errors };
  } catch {
    return { ok: false, status: 0 };
  }
}

export const fetchAuthOptions = () => call<{ signupOpen: boolean; whatsapp?: string | null }>("/options");

export interface RegisterPayload {
  restaurantName: string;
  name: string;
  email: string;
  password: string;
  currency: Currency;
  timezone: string;
  activationKey: string;
}

export interface RegisteredAdmin {
  role: "admin";
  token: string;
  admin: { id: number; name: string; email: string };
  restaurant: AdminRestaurant;
}

export const registerRequest = (payload: RegisterPayload) => call<RegisteredAdmin>("/register", { method: "POST", body: JSON.stringify(payload) });

/** Mot de passe oublié : e-mail + clé d'activation du compte + nouveau mot de passe (401 = e-mail ou clé incorrects, sans précision) */
export const resetPasswordWithKey = (email: string, activationKey: string, newPassword: string) =>
  call<undefined>("/reset-password-with-key", { method: "POST", body: JSON.stringify({ email, activationKey, newPassword }) });

export const fetchMe = () => call<{ role: "admin" | "cashier"; id: number; name: string; restaurant: AdminRestaurant }>("/me");

export const changePasswordRequest = (currentPassword: string, newPassword: string) =>
  call<undefined>("/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });

export interface LicenseStatus {
  key: string;
  /** UTC « AAAA-MM-JJ HH:MM:SS » */
  activatedAt: string;
  expiresAt: string;
  expired: boolean;
}

/** null dans data = ce compte n'a pas de licence */
export const fetchLicenseRequest = () => call<LicenseStatus | null>("/license");

export const renewLicenseRequest = (key: string) => call<LicenseStatus>("/license/renew", { method: "POST", body: JSON.stringify({ key }) });
