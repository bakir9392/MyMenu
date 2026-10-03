import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { I18nProvider } from "../shared/i18n";
import { installFetchHeaders } from "../shared/auth-fetch";
import { bearerHeaders, clearSession, goToLogin, readSession } from "../shared/session";
import { CAISSE_DICTIONARY } from "./i18n/dictionary";
import { ORDER_SERVER_URL } from "./lib/order-server";

// Tous les appels /api reçoivent le jeton de la session commune ; un 401 (jeton expiré, compte désactivé) ramène à la connexion
installFetchHeaders({
  headers: bearerHeaders,
  onUnauthorized: () => {
    if (!readSession()) return;
    clearSession();
    goToLogin();
  },
  serverUrl: ORDER_SERVER_URL,
});

createRoot(document.getElementById("root")!).render(
  <I18nProvider dictionary={CAISSE_DICTIONARY} storageKey="mm_lang_caisse">
    <App />
  </I18nProvider>
);
