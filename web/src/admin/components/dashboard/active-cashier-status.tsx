import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Clock, Activity } from "lucide-react";
import { useRestaurantSettings } from "@/lib/bill";
import { parseServerDate, useI18n } from "../../../shared/i18n";

export interface ActiveCashierSession {
  id: number;
  name: string;
  login_time: string;
  last_activity: string;
}

const REFRESH_MS = 30_000;

/** Caissiers actuellement connectés (sessions réelles du serveur), rafraîchis toutes les 30 secondes. */
export function useActiveCashiers() {
  const [sessions, setSessions] = useState<ActiveCashierSession[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/cashiers/active-session");
      const body = await response.json().catch(() => null);
      const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
      setSessions(response.ok ? list : []);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return sessions;
}

export function ActiveCashierStatus() {
  const { t, formatDateTime } = useI18n();
  const settings = useRestaurantSettings();
  const sessions = useActiveCashiers();

  if (sessions.length === 0) return null;

  return (
    <Card className="border-green-200 bg-green-50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-green-800">
          <Activity className="h-5 w-5" />
          {t("activeCashier.title", { count: sessions.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessions.map((session) => (
          <div key={session.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-green-600" />
                <span className="font-medium text-green-950">{session.name}</span>
              </div>
              <Badge className="bg-green-500 text-white">{t("activeCashier.connected")}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-green-700">
              <span className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                {t("activeCashier.loggedInAt", { time: formatDateTime(parseServerDate(session.login_time), settings?.timezone) })}
              </span>
              <span>{t("activeCashier.lastActivity", { time: formatDateTime(parseServerDate(session.last_activity), settings?.timezone) })}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
