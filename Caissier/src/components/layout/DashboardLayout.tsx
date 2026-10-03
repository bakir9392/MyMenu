import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Bell, Menu, Users, UtensilsCrossed } from "lucide-react";

interface DashboardLayoutProps {
  children: ReactNode;
  currentUser?: string;
  onLogout: () => void;
  notificationCount?: number;
  isNotificationPanelOpen?: boolean;
  setIsNotificationPanelOpen?: (open: boolean) => void;
}

export const DashboardLayout = ({ 
  children, 
  currentUser = "Caissier", 
  onLogout,
  notificationCount = 0,
  isNotificationPanelOpen = false,
  setIsNotificationPanelOpen = () => {}
}: DashboardLayoutProps) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary to-background">
      {/* Header */}
      <header className="bg-card border-b border-border/50 shadow-sm">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="h-8 w-8 text-primary" />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
                Restaurant POS
              </h1>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="sm" 
              className="relative"
              onClick={() => setIsNotificationPanelOpen(!isNotificationPanelOpen)}
            >
              <Bell className="h-5 w-5" />
              {notificationCount > 0 && (
                <Badge 
                  variant="destructive" 
                  className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 text-xs flex items-center justify-center"
                >
                  {notificationCount > 99 ? '99+' : notificationCount}
                </Badge>
              )}
            </Button>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Connecté:</span>
              <span className="font-medium">{currentUser}</span>
            </div>
            <Button variant="outline" size="sm" onClick={onLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Déconnexion
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6">
        {children}
      </main>
    </div>
  );
};