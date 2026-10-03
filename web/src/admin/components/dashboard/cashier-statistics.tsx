import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { useRestaurantSocket } from "@/hooks/use-restaurant-socket";
import { orderApi } from "@/lib/order-server";
import { useRestaurantSettings } from "@/lib/bill";
import { parseServerDate, useI18n } from "../../../shared/i18n";

interface CashierStats {
  id: number;
  name: string;
  account_status: "active" | "inactive";
  online: boolean;
  today_sales: number;
  month_sales: number;
  total_sales: number;
  transactions: number;
  today_transactions: number;
  average_ticket: number;
  last_payment: string | null;
  complaints: number;
  created_at: string;
}

const REFRESH_MS = 60_000;

const Figure = ({ value, label, tone }: { value: string; label: string; tone: string }) => (
  <div className="rounded-lg bg-muted/50 p-3 text-center">
    <div className={`text-xl font-bold ${tone}`}>{value}</div>
    <div className="text-sm text-muted-foreground">{label}</div>
  </div>
);

/** Chiffres réels de chaque caissier créé par l'administrateur (ventes, tickets, dernier encaissement, réclamations). */
export function CashierStatistics() {
  const { t, money: formatMoney, formatNumber, formatDateTime } = useI18n();
  const settings = useRestaurantSettings();
  const money = (value: number) => formatMoney(value, settings?.currency);
  const [cashiers, setCashiers] = useState<CashierStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCashiers(await orderApi<CashierStats[]>("/cashiers/statistics"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useRestaurantSocket({ onNewOrder: load, onStatusChanged: load });

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const statusOf = (cashier: CashierStats) =>
    cashier.account_status === "inactive"
      ? { text: t("cashierStats.deactivated"), dot: "bg-red-500", variant: "destructive" as const }
      : cashier.online
        ? { text: t("cashierStats.online"), dot: "bg-green-500", variant: "default" as const }
        : { text: t("cashierStats.offline"), dot: "bg-gray-400", variant: "secondary" as const };

  if (error && !cashiers) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-4 text-destructive">{t("cashierStats.loadError", { message: error })}</CardContent>
      </Card>
    );
  }

  if (!cashiers) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }

  if (cashiers.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <Users className="h-8 w-8" aria-hidden />
          <p className="font-medium text-foreground">{t("cashierStats.emptyTitle")}</p>
          <p className="text-sm">{t("cashierStats.emptyHint")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{t("cashierStats.loadError", { message: error })}</p>}
      {cashiers.map((cashier) => {
        const status = statusOf(cashier);
        return (
          <Card key={cashier.id} className="p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-primary">
                  <span className="text-lg font-semibold text-primary-foreground">
                    {Array.from(cashier.name.trim())[0]?.toUpperCase() ?? "?"}
                  </span>
                </div>
                <div>
                  <div className="text-lg font-semibold">{cashier.name}</div>
                  <div className="flex items-center gap-2">
                    <span className={`h-3 w-3 rounded-full ${status.dot}`} aria-hidden />
                    <Badge variant={status.variant}>{status.text}</Badge>
                  </div>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                {t("cashierStats.lastPayment")}:{" "}
                <span className="font-medium text-foreground">
                  {cashier.last_payment ? formatDateTime(parseServerDate(cashier.last_payment), settings?.timezone) : t("cashierStats.noPayment")}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <Figure value={money(cashier.today_sales)} label={t("cashierStats.todaySales")} tone="text-green-600" />
              <Figure value={money(cashier.month_sales)} label={t("cashierStats.monthSales")} tone="text-blue-600" />
              <Figure value={money(cashier.total_sales)} label={t("cashierStats.totalSales")} tone="text-orange-600" />
              <Figure value={formatNumber(cashier.transactions)} label={t("cashierStats.transactions")} tone="text-purple-600" />
              <Figure
                value={cashier.transactions > 0 ? money(cashier.average_ticket) : t("common.none")}
                label={t("cashierStats.averageTicket")}
                tone="text-foreground"
              />
              <Figure
                value={formatNumber(cashier.complaints)}
                label={t("cashierStats.complaints")}
                tone={cashier.complaints > 0 ? "text-destructive" : "text-foreground"}
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
