import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, ChefHat, Clock, CreditCard, MessageSquare, RefreshCw, Wifi, WifiOff, XCircle } from "lucide-react";
import { SendMessageDialog } from "@/components/messages/send-message-dialog";
import { computeBill } from "@/lib/bill";
import { useShop } from "@/hooks/use-shop";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantSocket } from "@/hooks/use-restaurant-socket";
import { Order, OrderStatus, orderApi, parseServerDate, RestaurantTable } from "@/lib/order-server";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-warning/20 text-warning border-warning/30",
  confirmed: "bg-primary/20 text-primary border-primary/30",
  preparing: "bg-primary/20 text-primary border-primary/30",
  ready: "bg-success/20 text-success border-success/30",
  served: "bg-accent/20 text-accent border-accent/30",
};

export function LiveOrders() {
  const { settings, money, i18n } = useShop(); // TVA, frais de table, devise
  const { t, formatDateTime } = i18n;
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [tableRates, setTableRates] = useState<Record<string, number | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messageTable, setMessageTable] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      const [list, tables] = await Promise.all([
        orderApi<Order[]>("/orders?scope=active"),
        orderApi<RestaurantTable[]>("/tables").catch(() => [] as RestaurantTable[]),
      ]);
      setOrders(list);
      setTableRates(Object.fromEntries(tables.map((table) => [table.number, table.tax_rate ?? null])));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const { isConnected, updateOrderStatus, payTable: payTableOnServer, sendMessage } = useRestaurantSocket({
    onNewOrder: loadOrders,
    onStatusChanged: loadOrders,
  });

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const changeStatus = (order: Order, status: OrderStatus) => {
    if (!updateOrderStatus(order.id, order.table_number, status)) {
      toast({ title: t("orders.notConnected"), variant: "destructive" });
    }
  };

  // Encaisser toute la table : le serveur passe toutes ses commandes à "payée", termine la visite et crée la facture
  const payTable = async (tableNumber: string) => {
    const reply = await payTableOnServer(tableNumber);
    if (!reply.ok) {
      // commande sans session (ancienne) : encaissement commande par commande
      orders.filter((o) => o.table_number === tableNumber).forEach((o) => changeStatus(o, "paid"));
    }
    toast({ title: t("orders.paid", { table: tableNumber }) });
    loadOrders();
  };

  const byTable = useMemo(() => {
    const groups: Record<string, Order[]> = {};
    for (const order of orders) (groups[order.table_number] ||= []).push(order);
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [orders]);

  // Total à encaisser : plats + frais de table / service + TVA (taux propre à la table s'il y en a un)
  const totalFor = (tableNumber: string, tableOrders: Order[]) => {
    const rate = tableRates[tableNumber];
    const effective = settings && rate != null ? { ...settings, tax_enabled: true, tax_rate: rate } : settings;
    return computeBill(tableOrders.reduce((sum, o) => sum + o.total, 0), effective).total;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">{t("orders.title")}</h1>
          <p className="text-muted-foreground">{t("orders.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={isConnected ? "text-success border-success/40" : "text-destructive border-destructive/40"}>
            {isConnected ? <Wifi className="w-3 h-3 me-1" /> : <WifiOff className="w-3 h-3 me-1" />}
            {isConnected ? t("orders.connected") : t("orders.disconnected")}
          </Badge>
          <Button variant="outline" size="sm" onClick={loadOrders}>
            <RefreshCw className="w-4 h-4 me-2" />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-destructive">{t("admin.serverError", { error })}</CardContent>
        </Card>
      )}

      {!isLoading && !error && byTable.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{t("orders.none")}</CardContent>
        </Card>
      )}

      <SendMessageDialog
        open={!!messageTable}
        onOpenChange={(open) => !open && setMessageTable(null)}
        tableNumber={messageTable}
        onSend={(text) => sendMessage(messageTable!, text)}
        notify={(title, isError) => toast({ title, variant: isError ? "destructive" : "default" })}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {byTable.map(([tableNumber, tableOrders]) => {
          const tableTotal = totalFor(tableNumber, tableOrders);
          return (
            <Card key={tableNumber} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl">{t("common.table")} {tableNumber}</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-primary">{money(tableTotal)}</span>
                    <Button size="icon" variant="outline" className="h-8 w-8" title={t("orders.messageToCustomer")} aria-label={t("orders.messageToCustomer")} onClick={() => setMessageTable(tableNumber)}>
                      <MessageSquare className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-4">
                {tableOrders.map((order) => (
                  <div key={order.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge className={STATUS_STYLES[order.status] || ""}>
                        {order.status === "served" ? t("orders.servedAwaiting") : t(`status.${order.status}`)}
                      </Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(parseServerDate(order.created_at), settings?.timezone)}
                      </span>
                    </div>
                    <ul className="text-sm space-y-1">
                      {order.items.map((item, index) => (
                        <li key={index} className="flex justify-between gap-2">
                          <span>
                            {item.quantity} × {item.name}
                            {item.notes && <span className="block text-xs text-muted-foreground">{item.notes}</span>}
                          </span>
                          <span className="text-muted-foreground whitespace-nowrap">{money(item.price * item.quantity)}</span>
                        </li>
                      ))}
                    </ul>
                    {order.note && (
                      <p className="text-sm rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                        <span className="font-semibold">{t("orders.customerNote")} </span>{order.note}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {order.status === "pending" && (
                        <Button size="sm" onClick={() => changeStatus(order, "confirmed")}>
                          <CheckCircle className="w-4 h-4 me-1" />
                          {t("orders.confirm")}
                        </Button>
                      )}
                      {["confirmed", "preparing", "ready"].includes(order.status) && (
                        <Button size="sm" variant="secondary" onClick={() => changeStatus(order, "served")}>
                          <ChefHat className="w-4 h-4 me-1" />
                          {t("orders.served")}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => changeStatus(order, "cancelled")}>
                        <XCircle className="w-4 h-4 me-1" />
                        {t("orders.cancel")}
                      </Button>
                    </div>
                  </div>
                ))}
                <Button className="w-full bg-gradient-primary" onClick={() => payTable(tableNumber)}>
                  <CreditCard className="w-4 h-4 me-2" />
                  {t("orders.collectPayment", { amount: money(tableTotal) })}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
