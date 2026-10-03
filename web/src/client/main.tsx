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

createRoot(document.getElementById("root")!).render(
  <I18nProvider dictionary={CLIENT_DICTIONARY} storageKey="mm_lang_client">
    <App />
  </I18nProvider>
);
