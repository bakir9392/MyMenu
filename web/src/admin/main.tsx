import { StrictMode, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DirectionProvider } from "@radix-ui/react-direction";
import "./index.css";
import App from "./App";
import { AuthProvider } from "@/contexts/auth-context";
import { ADMIN_DICTIONARY } from "@/i18n/dictionary";
import { I18nProvider, useI18n } from "../shared/i18n";
import { installFetchHeaders } from "../shared/auth-fetch";
import { handleUnauthorized } from "@/lib/auth-storage";
import { bearerHeaders } from "../shared/session";
import { APP_NAME } from "../shared/brand";
import { ORDER_SERVER_URL } from "@/lib/order-server";

document.title = `${APP_NAME} - Administration`;

// Tous les appels fetch("/api/...") portent le jeton de l'administrateur ; un 401 ramène à l'écran de connexion.
// À installer AVANT d'afficher quoi que ce soit.
installFetchHeaders({
  headers: bearerHeaders,
  onUnauthorized: handleUnauthorized,
  serverUrl: ORDER_SERVER_URL,
});

// Les composants Radix (menus, listes déroulantes) suivent le sens de lecture de la langue
function Direction({ children }: { children: ReactNode }) {
  const { dir } = useI18n();
  return <DirectionProvider dir={dir}>{children}</DirectionProvider>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider dictionary={ADMIN_DICTIONARY} storageKey="mm_lang_admin">
      <Direction>
        <AuthProvider>
          <App />
        </AuthProvider>
      </Direction>
    </I18nProvider>
  </StrictMode>
);
