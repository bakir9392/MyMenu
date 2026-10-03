import { Card } from "@/components/ui/card";
import { Order } from "@/types";
import { Banknote, Clock, TrendingUp } from "lucide-react";
import { useI18n } from "../../../shared/i18n";
import { useRestaurant } from "@/hooks/useRestaurant";

interface OrdersSummaryProps {
  orders: Order[];
  /** Chiffre d'affaires du jour calculé par le serveur (commandes encaissées) */
  todayRevenue?: number;
}

export const OrdersSummary = ({ orders, todayRevenue: serverRevenue }: OrdersSummaryProps) => {
  const { t } = useI18n();
  const { fmt } = useRestaurant();
  const pendingOrders = orders.filter(order => order.status === 'pending' || order.status === 'confirmed');
  const todayRevenue = serverRevenue ?? orders
    .filter(order => order.status === 'paid')
    .reduce((sum, order) => sum + order.total, 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-warning/20 rounded-lg">
            <Clock className="h-6 w-6 text-warning" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("caisse.summary.pending")}</p>
            <p className="text-2xl font-bold">{pendingOrders.length}</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-success/20 rounded-lg">
            <Banknote className="h-6 w-6 text-success" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("caisse.summary.revenue")}</p>
            <p className="text-2xl font-bold">{fmt(todayRevenue)}</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary/20 rounded-lg">
            <TrendingUp className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{t("caisse.summary.total")}</p>
            <p className="text-2xl font-bold">{orders.length}</p>
          </div>
        </div>
      </Card>
    </div>
  );
};
