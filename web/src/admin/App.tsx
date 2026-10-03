import { useEffect } from "react";
import { Loader2, WifiOff } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/contexts/theme-context";
import { useAuth } from "@/contexts/auth-context";
import { useI18n } from "../shared/i18n";
import { LOGIN_PATH, goHome, readSession } from "../shared/session";
import Index from "./pages/Index";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

/** Écran affiché pendant la vérification de la session, ou quand le serveur est injoignable */
function SessionGate() {
  const { t } = useI18n();
  const { status, retry, signOut } = useAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      {status === "unreachable" ? (
        <>
          <WifiOff className="h-10 w-10 text-destructive" />
          <p className="max-w-sm text-muted-foreground">{t("admin.serverUnreachable")}</p>
          <div className="flex gap-2">
            <Button onClick={retry}>{t("admin.retry")}</Button>
            <Button variant="outline" onClick={signOut}>{t("auth.logout")}</Button>
          </div>
        </>
      ) : (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">{t("admin.checkingSession")}</p>
        </>
      )}
    </div>
  );
}

/** Rien du tableau de bord n'est affiché sans compte connecté */
function AuthGate() {
  const { status } = useAuth();
  const onLoginPage = window.location.pathname.replace(/\/+$/, "") === LOGIN_PATH;
  useEffect(() => {
    if (status === "anonymous" && !onLoginPage) window.location.replace(LOGIN_PATH + window.location.hash);
    if (status === "authenticated" && onLoginPage) goHome(readSession()?.role ?? "admin");
  }, [status, onLoginPage]);
  if (status === "anonymous") return onLoginPage ? <AuthPage /> : <SessionGate />;
  if (status !== "authenticated" || onLoginPage) return <SessionGate />;
  return (
    <BrowserRouter basename="/admin">
      <Routes>
        <Route path="/" element={<Index />} />
        {/* The catch-all route must be LAST */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

const App = () => (
  <ThemeProvider defaultTheme="system" storageKey="restaurant-theme">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthGate />
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
