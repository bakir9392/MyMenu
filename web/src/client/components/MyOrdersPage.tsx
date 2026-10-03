import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BellRing, ClipboardList, Receipt } from "lucide-react";
import type { StaffMessage } from "@/hooks/useSocket";
import { breakdownLines, computeBill, includedTaxNote, RestaurantSettings } from "@/lib/bill";
import { useI18n } from "@/lib/i18n";
import PageHeader from "./PageHeader";

export interface SessionOrder {
  id: string;
  table_number: string;
  status: "pending" | "confirmed" | "preparing" | "ready" | "served" | "paid" | "cancelled";
  total: number;
  note?: string | null;
  created_at: string;
  items: { dish_id: string | null; name: string; price: number; quantity: number; notes: string | null }[];
}

// Couleurs de chaque statut ; le libellé vient des traductions communes (status.*)
const STATUS_STYLE: Record<SessionOrder["status"], string> = {
  pending: "bg-orange-100 text-orange-700 border-orange-300",
  confirmed: "bg-blue-100 text-blue-700 border-blue-300",
  preparing: "bg-blue-100 text-blue-700 border-blue-300",
  ready: "bg-green-100 text-green-700 border-green-300",
  served: "bg-green-100 text-green-700 border-green-300",
  paid: "bg-gray-100 text-gray-700 border-gray-300",
  cancelled: "bg-red-100 text-red-700 border-red-300",
};

interface MyOrdersPageProps {
  orders: SessionOrder[];
  messages?: StaffMessage[];
  tableNumber: string | null;
  settings?: RestaurantSettings | null;
  onBack: () => void;
  /** Ouvre l'addition (à enregistrer ou imprimer) */
  onOpenBill: () => void;
}

/** Toutes les commandes de la visite en cours (chargées depuis le serveur : rien ne se perd en rescannant le QR code) */
const MyOrdersPage = ({ orders, messages = [], tableNumber, settings = null, onBack, onOpenBill }: MyOrdersPageProps) => {
  const { t, money, formatDate } = useI18n();
  const m = (amount: number) => money(amount, settings?.currency);
  const formatTime = (value: string) => formatDate(value, settings?.timezone, { timeStyle: "short" });
  const visitTotal = orders.filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + o.total, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-restaurant-cream to-background">
      <PageHeader
        title={t("client.orders.title")}
        subtitle={`${tableNumber ? `${t("client.tableNo", { table: tableNumber })} • ` : ""}${t("client.orders.count", { count: orders.length })}`}
        onBack={onBack}
      />

      <div className="container mx-auto p-4 space-y-4 max-w-2xl">
        {messages.length > 0 && (
          <Card className="border-primary/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BellRing className="h-4 w-4 text-primary" />
                {t("client.orders.messages")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {messages.map((message) => (
                <div key={message.id} className="rounded-xl bg-primary/5 px-3 py-2">
                  <p className="text-sm">{message.text}</p>
                  <p className="text-xs text-muted-foreground mt-1">{formatTime(message.created_at)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        {orders.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-50" />
              {t("client.orders.empty")}
            </CardContent>
          </Card>
        ) : (
          <>
            {orders.map((order, index) => (
              <Card key={order.id} className={order.status === "cancelled" ? "opacity-60" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      {t("client.orders.orderN", { number: index + 1 })} <span className="text-muted-foreground font-normal">• {formatTime(order.created_at)}</span>
                    </CardTitle>
                    <Badge variant="outline" className={STATUS_STYLE[order.status]}>
                      {t(`status.${order.status}`)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {order.items.map((item, i) => (
                    <div key={i} className="flex justify-between gap-2 text-sm">
                      <span>
                        {item.quantity} × {item.name}
                        {item.notes && <span className="block text-xs text-muted-foreground">{item.notes}</span>}
                      </span>
                      <span className="text-muted-foreground whitespace-nowrap">{m(item.price * item.quantity)}</span>
                    </div>
                  ))}
                  {order.note && (
                    <p className="text-sm rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                      <span className="font-medium">{t("client.orders.yourNote")} </span>{order.note}
                    </p>
                  )}
                  <div className="flex justify-between font-semibold pt-2 border-t">
                    <span>{t("common.total")}</span>
                    <span>{m(order.total)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
            {(() => {
              const bill = computeBill(visitTotal, settings);
              const note = includedTaxNote(bill, t, m);
              return (
                <Card className="bg-primary/5 border-primary/30">
                  <CardContent className="py-4 space-y-1">
                    {breakdownLines(bill, t).map((line) => (
                      <div key={line.label} className="flex justify-between text-sm text-muted-foreground">
                        <span>{line.label}</span><span>{m(line.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-bold text-lg">
                      <span>{t("client.orders.visitTotal")}</span>
                      <span className="text-primary">{m(bill.total)}</span>
                    </div>
                    {note && <p className="text-xs text-muted-foreground text-end">{note}</p>}
                    <Button onClick={onOpenBill} variant="outline" className="w-full mt-3">
                      <Receipt className="h-4 w-4 me-2" />
                      {t("client.orders.viewBill")}
                    </Button>
                  </CardContent>
                </Card>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
};

export default MyOrdersPage;
