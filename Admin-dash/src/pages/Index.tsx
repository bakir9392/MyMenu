import { useState } from "react";
import { NavigationBar } from "@/components/ui/navigation-bar";
import { RestaurantStats } from "@/components/dashboard/restaurant-stats";
import { CashierStatistics } from "@/components/dashboard/cashier-statistics";
import { CashierManagement } from "@/components/dashboard/cashier-management";
import { ActiveCashierStatus } from "@/components/dashboard/active-cashier-status";
import { CashierLogout } from "@/components/dashboard/cashier-logout";
import { MenuManagement } from "@/components/menu/menu-management";
import { TableQrCodes } from "@/components/tables/table-qr-codes";
import { LiveOrders } from "@/components/orders/live-orders";
import { useLanguage } from "@/contexts/language-context";
import { useToast } from "@/hooks/use-toast";

const Index = () => {
  const [activeSection, setActiveSection] = useState("dashboard");
  const { t, language } = useLanguage();
  const { toast } = useToast();

  const renderContent = () => {
    switch (activeSection) {
      case "dashboard":
        return (
          <div className="space-y-8">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                {t('dashboard.title')}
              </h1>
              <p className="text-muted-foreground">
                {t('dashboard.subtitle')}
              </p>
            </div>
            
            {/* Active Cashier Status */}
            <ActiveCashierStatus />
            
            {/* Cashier Logout */}
            <CashierLogout />
            
            {/* General Statistics */}
            <div>
              <h2 className="text-xl font-semibold mb-4">{t('dashboard.title')} Générales</h2>
              <RestaurantStats />
            </div>
            
            {/* Cashier Statistics */}
            <div>
              <h2 className="text-xl font-semibold mb-4">{t('cashiers.title')}</h2>
              <CashierStatistics />
            </div>
          </div>
        );
      case "menu":
        return <MenuManagement />;
      case "orders":
        return <LiveOrders />;
      case "tables":
        return (
          <TableQrCodes
            language={language}
            notify={(title, isError) => toast({ title, variant: isError ? "destructive" : "default" })}
          />
        );
      case "cashierManagement":
        return <CashierManagement />;
      default:
        return (
          <div className="text-center py-12">
            <h2 className="text-2xl font-bold mb-4">{t('common.developmentSection')}</h2>
            <p className="text-muted-foreground">{t('common.availableSoon')}</p>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <NavigationBar 
        activeSection={activeSection}
        onSectionChange={setActiveSection}
      />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-fade-in">
          {renderContent()}
        </div>
      </main>
    </div>
  );
};

export default Index;