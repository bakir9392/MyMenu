import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus, Menu, Receipt, QrCode, MessageSquareWarning } from "lucide-react";
import { useI18n } from "../../../shared/i18n";

interface QuickActionsProps {
  onNewOrder: () => void;
  onManageMenu: () => void;
  onViewReceipts: () => void;
  onManageTables: () => void;
  onViewComplaints: () => void;
  /** Réclamations non traitées */
  newComplaints?: number;
}

export const QuickActions = ({
  onNewOrder,
  onManageMenu,
  onViewReceipts,
  onManageTables,
  onViewComplaints,
  newComplaints = 0
}: QuickActionsProps) => {
  const { t } = useI18n();
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold mb-4">{t("caisse.quick.title")}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Button
          variant="gradient"
          className="h-20 flex-col gap-2"
          onClick={onNewOrder}
        >
          <Plus className="h-6 w-6" />
          <span className="text-sm font-medium">{t("caisse.quick.newOrder")}</span>
        </Button>

        <Button
          variant="outline"
          className="h-20 flex-col gap-2"
          onClick={onManageMenu}
        >
          <Menu className="h-6 w-6" />
          <span className="text-sm font-medium">{t("caisse.quick.menu")}</span>
        </Button>

        <Button
          variant="outline"
          className="h-20 flex-col gap-2"
          onClick={onViewReceipts}
        >
          <Receipt className="h-6 w-6" />
          <span className="text-sm font-medium">{t("caisse.quick.invoices")}</span>
        </Button>

        <Button
          variant="outline"
          className="h-20 flex-col gap-2"
          onClick={onManageTables}
        >
          <QrCode className="h-6 w-6" />
          <span className="text-sm font-medium">{t("caisse.quick.tables")}</span>
        </Button>

        <Button
          variant="outline"
          className="relative h-20 flex-col gap-2"
          onClick={onViewComplaints}
        >
          <MessageSquareWarning className="h-6 w-6" />
          <span className="text-sm font-medium">{t("caisse.quick.complaints")}</span>
          {newComplaints > 0 && (
            <span className="absolute top-2 end-2 rounded-full bg-destructive px-2 text-xs font-bold text-destructive-foreground">
              {newComplaints}
            </span>
          )}
        </Button>
      </div>
    </Card>
  );
};
