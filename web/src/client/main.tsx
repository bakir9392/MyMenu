import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { I18nProvider } from '../shared/i18n'
import { installFetchHeaders } from '../shared/auth-fetch'
import { CLIENT_DICTIONARY } from './i18n/dictionary'
import { getSessionToken } from './hooks/useTableSession'
import { ORDER_SERVER_URL } from './lib/orderServer'

// Chaque appel /api du téléphone s'identifie avec le jeton de la session de table (relu à chaque appel)
installFetchHeaders({
  headers: () => ({ "X-Session-Token": getSessionToken() }),
  serverUrl: ORDER_SERVER_URL,
});

// La page d'accueil sans QR code (adresse du site seule) ouvre la connexion du restaurant : un client arrive toujours
// par le QR code de sa table (?t=...), et celui qui a déjà une visite en cours ou récente reste sur le menu.
const opensMenu = window.location.pathname === "/" && (new URLSearchParams(window.location.search).has("t") || getSessionToken() !== "");
if (window.location.pathname === "/" && !opensMenu) {
  window.location.replace("/login");
} else {
  createRoot(document.getElementById("root")!).render(
    <I18nProvider dictionary={CLIENT_DICTIONARY} storageKey="mm_lang_client">
      <App />
    </I18nProvider>
  );
}
