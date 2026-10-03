import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle, ChefHat, Clock, CreditCard, RefreshCw, Wifi, WifiOff, XCircle } from "lucide-react";
import { useLanguage } from "@/contexts/language-context";
import { useToast } from "@/hooks/use-toast";
import { useRestaurantSocket } from "@/hooks/use-restaurant-socket";
import { Order, OrderStatus, orderApi, parseServerDate } from "@/lib/order-server";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-warning/20 text-warning border-warning/30",
  confirmed: "bg-primary/20 text-primary border-primary/30",
  preparing: "bg-primary/20 text-primary border-primary/30",
  ready: "bg-success/20 text-success border-success/30",
  served: "bg-accent/20 text-accent border-accent/30",
};

export function LiveOrders() {
  const { language, t } = useLanguage();
  const L = (fr: string, ar: string) => (language === "ar" ? ar : fr);
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const statusLabel: Record<string, string> = {
    pending: L("Nouvelle", "جديدة"),
    confirmed: L("En préparation", "قيد التحضير"),
    preparing: L("En préparation", "قيد التحضير"),
    ready: L("Prête", "جاهزة"),
    served: L("Servie – à encaisser", "تم التقديم – في انتظار الدفع"),
  };

  const loadOrders = useCallback(async () => {
    try {
      setOrders(await orderApi<Order[]>("/orders?scope=active"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const { isConnected, updateOrderStatus } = useRestaurantSocket({
    onNewOrder: () => {
      loadOrders();
      toast({ title: L("Nouvelle commande", "طلب جديد") });
    },
    onStatusChanged: loadOrders,
  });

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const changeStatus = (order: Order, status: OrderStatus) => {
    if (!updateOrderStatus(order.id, order.table_number, status)) {
      toast({ title: L("Serveur non connecté", "الخادم غير متصل"), variant: "destructive" });
    }
  };

  // Encaisser toute la table : toutes ses commandes en cours passent à "payée" (la session de la table se ferme)
  const payTable = (tableNumber: string) => {
    orders.filter((o) => o.table_number === tableNumber).forEach((o) => changeStatus(o, "paid"));
    toast({ title: L(`Table ${tableNumber} encaissée`, `تم دفع الطاولة ${tableNumber}`) });
  };

  const byTable = useMemo(() => {
    const groups: Record<string, Order[]> = {};
    for (const order of orders) (groups[order.table_number] ||= []).push(order);
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [orders]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            {L("Commandes en cours", "الطلبات الجارية")}
          </h1>
          <p className="text-muted-foreground">
            {L("Les mêmes actions que la caisse, en temps réel", "نفس صلاحيات الصراف، في الوقت الحقيقي")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={isConnected ? "text-success border-success/40" : "text-destructive border-destructive/40"}>
            {isConnected ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
            {isConnected ? L("Connecté", "متصل") : L("Déconnecté", "غير متصل")}
          </Badge>
          <Button variant="outline" size="sm" onClick={loadOrders}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {L("Actualiser", "تحديث")}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-4 text-destructive">
            {L("Impossible de joindre le serveur de commandes :", "تعذر الاتصال بخادم الطلبات:")} {error}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && byTable.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {L("Aucune commande en cours", "لا توجد طلبات جارية")}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {byTable.map(([tableNumber, tableOrders]) => {
          const tableTotal = tableOrders.reduce((sum, o) => sum + o.total, 0);
          return (
            <Card key={tableNumber} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl">
                    {L("Table", "طاولة")} {tableNumber}
                  </CardTitle>
                  <span className="font-bold text-primary">
                    {tableTotal.toFixed(2)} {t("common.currency")}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-4">
                {tableOrders.map((order) => (
                  <div key={order.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge className={STATUS_STYLES[order.status] || ""}>{statusLabel[order.status] || order.status}</Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {parseServerDate(order.created_at).toLocaleTimeString(language === "ar" ? "ar-DZ" : "fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <ul className="text-sm space-y-1">
                      {order.items.map((item, index) => (
                        <li key={index} className="flex justify-between gap-2">
                          <span>
                            {item.quantity} × {item.name}
                            {item.notes && <span className="block text-xs text-muted-foreground">{item.notes}</span>}
                          </span>
                          <span className="text-muted-foreground">{(item.price * item.quantity).toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {order.status === "pending" && (
                        <Button size="sm" onClick={() => changeStatus(order, "confirmed")}>
                          <CheckCircle className="w-4 h-4 mr-1" />
                          {L("Confirmer", "تأكيد")}
                        </Button>
                      )}
                      {["confirmed", "preparing", "ready"].includes(order.status) && (
                        <Button size="sm" variant="secondary" onClick={() => changeStatus(order, "served")}>
                          <ChefHat className="w-4 h-4 mr-1" />
                          {L("Servie", "تم التقديم")}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => changeStatus(order, "cancelled")}>
                        <XCircle className="w-4 h-4 mr-1" />
                        {L("Annuler", "إلغاء")}
                      </Button>
                    </div>
                  </div>
                ))}
                <Button className="w-full bg-gradient-primary" onClick={() => payTable(tableNumber)}>
                  <CreditCard className="w-4 h-4 mr-2" />
                  {L("Encaisser la table", "دفع الطاولة")} ({tableTotal.toFixed(2)} {t("common.currency")})
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
