import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { Dashboard } from "./pages/Dashboard";
import { MenuManagement } from "./pages/MenuManagement";
import { TablesSetup } from "./pages/TablesSetup";
import { InvoicesSetup } from "./pages/InvoicesSetup";
import { ComplaintsSetup } from "./pages/ComplaintsSetup";
import { SocketProvider } from "./hooks/useSocket";
import { CashierContext, readCashierSession } from "./lib/auth";
import { ORDER_SERVER_URL } from "./lib/order-server";
import { useI18n } from "../shared/i18n";
import { AuthSession, clearSession, goHome, goToLogin, readSession } from "../shared/session";

// Application de la caisse : la connexion se fait sur la page commune (/admin/), ici seulement les écrans de service
function App() {
  const { isRtl } = useI18n();
  const [session, setSession] = useState<AuthSession | null>(readCashierSession);

  // Sans session de caissier valable : un admin retourne à son tableau de bord, les autres à la connexion
  useEffect(() => {
    if (session) return;
    if (readSession()?.role === "admin") goHome("admin");
    else goToLogin();
  }, [session]);

  // La session change quand elle expire (8 h), ou depuis un autre onglet
  useEffect(() => {
    const sync = () =>
      setSession((previous) => {
        const next = readCashierSession();
        return previous && next && previous.token === next.token ? previous : next;
      });
    window.addEventListener("storage", sync);
    const interval = setInterval(sync, 60 * 1000);
    return () => {
      window.removeEventListener("storage", sync);
      clearInterval(interval);
    };
  }, []);

  // Signal de présence toutes les minutes tant que la caisse est ouverte et connectée :
  // le serveur sait quel caissier est en service (affiché sur les réclamations)
  const token = session?.token;
  useEffect(() => {
    if (!token) return;
    const beat = () => {
      fetch(`${ORDER_SERVER_URL}/api/cashiers/heartbeat`, { method: "POST" }).catch(() => {});
    };
    beat();
    const interval = setInterval(beat, 60 * 1000);
    return () => clearInterval(interval);
  }, [token]);

  const logout = useCallback(() => {
    // Fin de la session côté serveur (statut "connecté" visible par l'admin), puis retour à la connexion
    const finish = () => {
      clearSession();
      goToLogin();
    };
    fetch(`${ORDER_SERVER_URL}/api/cashiers/logout`, { method: "POST" }).catch(() => {}).finally(finish);
  }, []);

  const context = useMemo(() => (session ? { session, logout } : null), [session, logout]);

  if (!context) return null;

  return (
    <Router basename="/caisse">
      <div className="min-h-screen bg-background">
        <CashierContext.Provider value={context}>
          <SocketProvider>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/menu-management" element={<MenuManagement />} />
              <Route path="/tables" element={<TablesSetup />} />
              <Route path="/factures" element={<InvoicesSetup />} />
              <Route path="/reclamations" element={<ComplaintsSetup />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </SocketProvider>
        </CashierContext.Provider>
      </div>
      <Toaster richColors position="top-center" closeButton dir={isRtl ? "rtl" : "ltr"} />
    </Router>
  );
}

export default App;
