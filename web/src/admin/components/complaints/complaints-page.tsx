import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Clock, MessageSquareWarning, RefreshCw, RotateCcw, UserRound } from "lucide-react";
import { orderApi, parseServerDate } from "@/lib/order-server";
import { useShop } from "@/hooks/use-shop";

interface Complaint {
  id: number;
  table_number: string;
  text: string;
  cashier_names: string | null;
  status: "new" | "resolved";
  created_at: string;
  resolved_at: string | null;
}

type Period = "today" | "week" | "month" | "all";
type StatusFilter = "new" | "resolved" | "all";

interface ComplaintsPageProps {
  notify: (title: string, isError?: boolean) => void;
  /** Incrémenté à chaque événement temps réel (nouvelle réclamation, réclamation traitée) */
  refreshKey?: number;
  /** Nombre de réclamations non traitées (badge du menu) */
  onNewCountChange?: (count: number) => void;
}

/** Réclamations des clients : table, date, caissier(s) en service, texte, suivi traitée / non traitée */
export function ComplaintsPage({ notify, refreshKey = 0, onNewCountChange }: ComplaintsPageProps) {
  const { i18n, timezone } = useShop();
  const { t } = i18n;
  const [period, setPeriod] = useState<Period>("all");
  const [status, setStatus] = useState<StatusFilter>("new");
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/complaints?period=${period}&status=${status}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setComplaints(body.data);
      onNewCountChange?.(body.newCount);
    } catch {
      notify(t("complaints.loadError"), true);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, status]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const setComplaintStatus = async (complaint: Complaint, next: Complaint["status"]) => {
    try {
      await orderApi(`/complaints/${complaint.id}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      notify(next === "resolved" ? t("complaints.markedResolved") : t("complaints.reopened"));
      load();
    } catch (e) {
      notify(`${t("common.error")} : ${(e as Error).message}`, true);
    }
  };

  const formatDate = (value: string) => i18n.formatDateTime(parseServerDate(value), timezone);

  const periods: { id: Period; label: string }[] = [
    { id: "today", label: t("common.today") },
    { id: "week", label: t("complaints.days7") },
    { id: "month", label: t("complaints.thisMonth") },
    { id: "all", label: t("common.all") },
  ];
  const statuses: { id: StatusFilter; label: string }[] = [
    { id: "new", label: t("complaints.toHandle") },
    { id: "resolved", label: t("complaints.resolved") },
    { id: "all", label: t("common.all") },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t("complaints.title")}</h1>
          <p className="text-muted-foreground">{t("complaints.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="w-4 h-4 me-2" />
          {t("common.refresh")}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {statuses.map((s) => (
          <Button key={s.id} size="sm" variant={status === s.id ? "default" : "outline"} onClick={() => setStatus(s.id)}>
            {s.label}
          </Button>
        ))}
        <span className="mx-1 w-px bg-border" />
        {periods.map((p) => (
          <Button key={p.id} size="sm" variant={period === p.id ? "secondary" : "ghost"} onClick={() => setPeriod(p.id)}>
            {p.label}
          </Button>
        ))}
      </div>

      {!isLoading && complaints.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <MessageSquareWarning className="h-10 w-10 mx-auto mb-3 opacity-40" />
            {t("complaints.none")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {complaints.map((complaint) => (
            <Card key={complaint.id} className={complaint.status === "new" ? "border-warning/50" : "opacity-80"}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{t("complaints.table", { table: complaint.table_number })}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {formatDate(complaint.created_at)}
                    </p>
                  </div>
                  <Badge variant="outline" className={complaint.status === "new" ? "text-warning border-warning/50" : "text-success border-success/50"}>
                    {complaint.status === "new" ? t("complaints.toHandle") : t("complaints.resolved")}
                  </Badge>
                </div>

                <p className="rounded-lg bg-muted/50 px-4 py-3 text-sm whitespace-pre-wrap break-words">{complaint.text}</p>

                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <UserRound className="w-4 h-4" />
                  {t("complaints.cashierOnDuty")}{" "}
                  <span className="font-medium text-foreground">{complaint.cashier_names || t("complaints.noCashier")}</span>
                </p>

                <div className="flex justify-end">
                  {complaint.status === "new" ? (
                    <Button size="sm" onClick={() => setComplaintStatus(complaint, "resolved")}>
                      <CheckCircle2 className="w-4 h-4 me-1" />
                      {t("complaints.markResolved")}
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setComplaintStatus(complaint, "new")}>
                      <RotateCcw className="w-4 h-4 me-1" />
                      {t("complaints.reopen")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
