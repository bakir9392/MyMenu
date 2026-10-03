import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Order } from "@/types";
import { Clock, Euro, TrendingUp } from "lucide-react";

interface OrdersSummaryProps {
  orders: Order[];
}

export const OrdersSummary = ({ orders }: OrdersSummaryProps) => {
  const pendingOrders = orders.filter(order => order.status === 'pending' || order.status === 'confirmed');
  const todayRevenue = orders
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
            <p className="text-sm font-medium text-muted-foreground">Commandes en attente</p>
            <p className="text-2xl font-bold">{pendingOrders.length}</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-success/20 rounded-lg">
            <Euro className="h-6 w-6 text-success" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Chiffre d'affaires aujourd'hui</p>
            <p className="text-2xl font-bold">{todayRevenue.toFixed(2)} DZD</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary/20 rounded-lg">
            <TrendingUp className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">Total commandes</p>
            <p className="text-2xl font-bold">{orders.length}</p>
          </div>
        </div>
      </Card>
    </div>
  );
};