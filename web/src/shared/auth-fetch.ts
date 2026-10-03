// Identification des appels à l'API. Chaque interface installe UNE fois, au démarrage (main.tsx), les en-têtes qui
// la concernent :
//   - admin et caisse : "Authorization: Bearer <jeton>" (jeton reçu à la connexion) ;
//   - menu client : "X-Session-Token: <jeton de la session de table>" (reçu en scannant le QR code).
// Tous les fetch("/api/...") de l'interface en profitent sans rien changer. Les appels axios (admin) utilisent
// authHeaders() dans un intercepteur.

export interface FetchHeadersOptions {
  /** En-têtes à ajouter aux appels /api (relus à chaque appel : le jeton peut changer après une connexion) */
  headers: () => Record<string, string>;
  /** Appelé quand l'API répond 401 (jeton expiré ou compte supprimé) ; pas pour les écrans de connexion eux-mêmes */
  onUnauthorized?: () => void;
  /** Adresse du serveur si différente de la page (VITE_ORDER_SERVER_URL), sans / final */
  serverUrl?: string;
}

const PUBLIC_PATHS = ["/api/auth/login", "/api/auth/register", "/api/auth/options", "/api/cashiers/login"];

let installed: FetchHeadersOptions | null = null;
let originalFetch: typeof window.fetch | null = null;

export function installFetchHeaders(options: FetchHeadersOptions) {
  installed = options;
  if (originalFetch) return; // déjà installé (rechargement à chaud)
  originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const base = installed?.serverUrl ?? "";
    const path = raw.startsWith(base) ? raw.slice(base.length) : raw;
    const isApi = path.startsWith("/api/") || path === "/api";
    if (!isApi || !installed) return originalFetch!(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    for (const [name, value] of Object.entries(installed.headers())) if (value && !headers.has(name)) headers.set(name, value);

    const response = await originalFetch!(input, { ...init, headers });
    if (response.status === 401 && !PUBLIC_PATHS.some((p) => path.startsWith(p))) installed.onUnauthorized?.();
    return response;
  };
}

/** En-têtes d'authentification actuels (pour axios ou pour un appel hors fetch) */
export const authHeaders = (): Record<string, string> => installed?.headers() ?? {};
