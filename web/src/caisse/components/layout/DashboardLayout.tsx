import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Bell, Utensils } from "lucide-react";
import { LanguageSwitcher, useI18n } from "../../../shared/i18n";
import { useCashier } from "@/lib/auth";
import { useRestaurant } from "@/hooks/useRestaurant";
import { APP_NAME } from "../../../shared/brand";

interface DashboardLayoutProps {
  children: ReactNode;
  notificationCount?: number;
  isNotificationPanelOpen?: boolean;
  setIsNotificationPanelOpen?: (open: boolean) => void;
}

export const DashboardLayout = ({
  children,
  notificationCount = 0,
  isNotificationPanelOpen = false,
  setIsNotificationPanelOpen = () => {}
}: DashboardLayoutProps) => {
  const { t } = useI18n();
  const { session, logout } = useCashier();
  const { name } = useRestaurant();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary to-background">
      {/* Header */}
      <header className="bg-card border-b border-border/50 shadow-sm">
        <div className="px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Utensils className="h-8 w-8 shrink-0 text-primary" />
            <div className="min-w-0">
              <h1 className="text-2xl font-bold leading-tight truncate bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
                {name}
              </h1>
              <p className="text-xs text-muted-foreground">{APP_NAME} · {t("caisse.app.pos")}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <LanguageSwitcher />
            <Button
              variant="ghost"
              size="sm"
              className="relative"
              aria-label={t("caisse.notif.title")}
              onClick={() => setIsNotificationPanelOpen(!isNotificationPanelOpen)}
            >
              <Bell className="h-5 w-5" />
              {notificationCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -top-2 -end-2 min-w-[20px] h-5 px-1 text-xs flex items-center justify-center"
                >
                  {notificationCount > 99 ? '99+' : notificationCount}
                </Badge>
              )}
            </Button>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("caisse.layout.loggedIn")}</span>
              <span className="font-medium">{session.user.name}</span>
            </div>
            <Button variant="outline" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4 me-2 rtl:rotate-180" />
              {t("caisse.layout.logout")}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-4 sm:p-6">
        {children}
      </main>
    </div>
  );
};
