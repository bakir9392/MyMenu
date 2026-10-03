import { useCallback, useEffect, useState } from "react";
import { NavigationBar } from "@/components/ui/navigation-bar";
import { LicenseBanner } from "@/components/license-banner";
import { RestaurantStats } from "@/components/dashboard/restaurant-stats";
import { CashierStatistics } from "@/components/dashboard/cashier-statistics";
import { CashierManagement } from "@/components/dashboard/cashier-management";
import { ActiveCashierStatus } from "@/components/dashboard/active-cashier-status";
import { CashierLogout } from "@/components/dashboard/cashier-logout";
import { MenuManagement } from "@/components/menu/menu-management";
import { TableQrCodes } from "@/components/tables/table-qr-codes";
import { LiveOrders } from "@/components/orders/live-orders";
import { InvoicesPage } from "@/components/invoices/invoices-page";
import { ComplaintsPage } from "@/components/complaints/complaints-page";
import { ReportsPage } from "@/components/reports/reports-page";
import { SettingsPage } from "@/components/settings/settings-page";
import { SettingsRefreshContext } from "@/contexts/settings-refresh-context";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantSocket } from "@/hooks/use-restaurant-socket";
import { useI18n } from "../../shared/i18n";

const Index = () => {
  const [activeSection, setActiveSection] = useState("dashboard");
  const { t } = useI18n();
  const { toast } = useToast();

  // Réclamations non traitées (badge du menu) et rafraîchissement de la page Réclamations
  const [newComplaints, setNewComplaints] = useState(0);
  const [complaintsRefresh, setComplaintsRefresh] = useState(0);
  const [invoicesRefresh, setInvoicesRefresh] = useState(0);
  // Change quand l'admin modifie les paramètres (devise, TVA...) : les écrans rechargent alors les paramètres
  const [settingsRefresh, setSettingsRefresh] = useState(0);

  const refreshComplaintsCount = useCallback(() => {
    fetch("/api/complaints?status=new&period=all")
      .then((r) => r.json())
      .then((body) => setNewComplaints(body.newCount ?? 0))
      .catch(() => {});
  }, []);

  useEffect(refreshComplaintsCount, [refreshComplaintsCount]);

  // Son + notification à chaque nouvelle commande ou réclamation, quelle que soit la section ouverte
  useRestaurantSocket({
    sounds: true,
    onNewOrder: () => toast({ title: t("orders.newOrder") }),
    onComplaintCreated: (complaint) => {
      toast({
        title: t("complaints.newComplaint"),
        description: t("complaints.table", { table: complaint.table_number }),
        variant: "destructive",
      });
      setComplaintsRefresh((n) => n + 1);
      refreshComplaintsCount();
    },
    onComplaintUpdated: () => {
      setComplaintsRefresh((n) => n + 1);
      refreshComplaintsCount();
    },
    onInvoiceCreated: () => setInvoicesRefresh((n) => n + 1),
    onSettingsUpdated: () => setSettingsRefresh((n) => n + 1),
  });

  const notify = (title: string, isError?: boolean) => toast({ title, variant: isError ? "destructive" : "default" });

  const renderContent = () => {
    switch (activeSection) {
      case "menu":
        return <MenuManagement />;
      case "orders":
        return <LiveOrders />;
      case "settings":
        return <SettingsPage notify={notify} />;
      case "reports":
        return <ReportsPage />;
      case "complaints":
        return <ComplaintsPage refreshKey={complaintsRefresh} onNewCountChange={setNewComplaints} notify={notify} />;
      case "invoices":
        return <InvoicesPage notify={notify} refreshKey={invoicesRefresh} />;
      case "tables":
        return <TableQrCodes notify={notify} />;
      case "cashierManagement":
        return <CashierManagement />;
      default:
        return (
          <div className="space-y-8">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">{t("dashboard.title")}</h1>
              <p className="text-muted-foreground">{t("dashboard.subtitle")}</p>
            </div>

            <ActiveCashierStatus />

            <CashierLogout />

            <div>
              <h2 className="text-xl font-semibold mb-4">{t("dashboard.generalStatistics")}</h2>
              <RestaurantStats />
            </div>

            <div>
              <h2 className="text-xl font-semibold mb-4">{t("dashboard.cashierStatistics")}</h2>
              <CashierStatistics />
            </div>
          </div>
        );
    }
  };

  return (
    <SettingsRefreshContext.Provider value={settingsRefresh}>
      <div className="min-h-screen bg-background">
        <LicenseBanner />
        <NavigationBar activeSection={activeSection} onSectionChange={setActiveSection} badges={{ complaints: newComplaints }} />

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-fade-in">{renderContent()}</div>
        </main>
      </div>
    </SettingsRefreshContext.Provider>
  );
};

export default Index;
