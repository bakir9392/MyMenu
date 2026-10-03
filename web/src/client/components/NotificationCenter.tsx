import { useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { BellRing, CheckCircle2, ChefHat, PartyPopper, Send, X, XCircle } from "lucide-react";

export type NotificationKind = "sent" | "confirmed" | "served" | "cancelled" | "paid" | "message";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  text: string;
  /** Les messages du restaurant restent affichés jusqu'à ce que le client les ferme */
  sticky?: boolean;
  /** Bouton d'action (ex. « Enregistrer mon reçu ») : la notification reste affichée jusqu'à ce que le client la ferme */
  action?: { label: string; onClick: () => void };
}

const STYLES: Record<NotificationKind, { icon: typeof BellRing; ring: string; iconBg: string; bar: string }> = {
  sent: { icon: Send, ring: "border-emerald-200", iconBg: "bg-emerald-100 text-emerald-600", bar: "bg-emerald-500" },
  confirmed: { icon: ChefHat, ring: "border-blue-200", iconBg: "bg-blue-100 text-blue-600", bar: "bg-blue-500" },
  served: { icon: CheckCircle2, ring: "border-green-200", iconBg: "bg-green-100 text-green-600", bar: "bg-green-500" },
  cancelled: { icon: XCircle, ring: "border-red-200", iconBg: "bg-red-100 text-red-600", bar: "bg-red-500" },
  paid: { icon: PartyPopper, ring: "border-amber-200", iconBg: "bg-amber-100 text-amber-600", bar: "bg-amber-500" },
  message: { icon: BellRing, ring: "border-primary/40", iconBg: "bg-primary/15 text-primary", bar: "bg-primary" },
};

const AUTO_HIDE_MS = 7000;

function NotificationCard({ notification, onDismiss }: { notification: AppNotification; onDismiss: (id: string) => void }) {
  const { t } = useI18n();
  const style = STYLES[notification.kind];
  const Icon = style.icon;

  useEffect(() => {
    if (notification.sticky || notification.action) return;
    const timer = setTimeout(() => onDismiss(notification.id), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [notification, onDismiss]);

  return (
    <div
      role="status"
      className={`relative overflow-hidden rounded-2xl border ${style.ring} bg-white/95 backdrop-blur shadow-xl animate-in slide-in-from-top-4 fade-in duration-300`}
    >
      <div className={`absolute start-0 top-0 h-full w-1.5 ${style.bar}`} />
      <div className="flex items-start gap-3 p-4 ps-5">
        <div className={`shrink-0 rounded-full p-2.5 ${style.iconBg}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900">{notification.title}</p>
          <p className="text-sm text-gray-600 mt-0.5 break-words">{notification.text}</p>
          {notification.action && (
            <button
              onClick={() => {
                notification.action?.onClick();
                onDismiss(notification.id);
              }}
              className={`mt-3 me-2 rounded-lg px-4 py-1.5 text-sm font-medium text-white ${style.bar} hover:opacity-90`}
            >
              {notification.action.label}
            </button>
          )}
          {(notification.sticky || notification.action) && (
            <button
              onClick={() => onDismiss(notification.id)}
              className={`mt-3 rounded-lg px-4 py-1.5 text-sm font-medium ${notification.action ? "border border-gray-300 text-gray-700 hover:bg-gray-50" : `text-white ${style.bar} hover:opacity-90`}`}
            >
              {t("client.notification.gotIt")}
            </button>
          )}
        </div>
        <button onClick={() => onDismiss(notification.id)} className="shrink-0 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label={t("common.close")}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Notifications affichées en haut de l'écran du client (statut de ses commandes, messages du restaurant) */
const NotificationCenter = ({ notifications, onDismiss }: { notifications: AppNotification[]; onDismiss: (id: string) => void }) => {
  if (notifications.length === 0) return null;
  return (
    <div className="fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3 pointer-events-none">
      {notifications.slice(-3).map((notification) => (
        <div key={notification.id} className="w-full max-w-md pointer-events-auto">
          <NotificationCard notification={notification} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
};

export default NotificationCenter;
