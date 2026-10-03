import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notification } from "@/types";
import { useI18n } from "../../../shared/i18n";
import { useRestaurant } from "@/hooks/useRestaurant";

interface NotificationPanelProps {
  notifications: Notification[];
  isOpen: boolean;
  onClose: () => void;
  onNotificationClick: (notification: Notification) => void;
  onMarkAsRead: (notificationId: string) => void;
}

export const NotificationPanel = ({
  notifications,
  isOpen,
  onClose,
  onNotificationClick,
  onMarkAsRead
}: NotificationPanelProps) => {
  const { t } = useI18n();
  const { time } = useRestaurant();
  if (!isOpen) return null;

  const messageFor = (notification: Notification) => t(`caisse.notif.${notification.type}`, { table: notification.tableNumber });

  const unreadCount = notifications.filter(n => !n.read).length;

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'new_order':
        return "🍽️";
      case 'order_modified':
        return "✏️";
      case 'order_cancelled':
        return "❌";
      case 'payment_received':
        return "💰";
      default:
        return "📋";
    }
  };

  const getNotificationColor = (type: Notification['type']) => {
    switch (type) {
      case 'new_order':
        return "border-s-warning";
      case 'order_modified':
        return "border-s-accent";
      case 'order_cancelled':
        return "border-s-destructive";
      case 'payment_received':
        return "border-s-success";
      default:
        return "border-s-muted";
    }
  };

  return (
    <div className="fixed top-16 end-6 w-80 max-h-96 bg-card border border-border rounded-lg shadow-xl z-50">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          <h3 className="font-semibold">{t("caisse.notif.title")}</h3>
          {unreadCount > 0 && (
            <Badge 
              variant="destructive" 
              className="min-w-[20px] h-5 px-1 text-xs flex items-center justify-center"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label={t("common.close")}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            {t("caisse.notif.empty")}
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {notifications.map((notification) => (
              <Card
                key={notification.id}
                className={`p-3 cursor-pointer transition-colors hover:bg-muted/50 border-s-4 ${getNotificationColor(notification.type)} ${
                  !notification.read ? 'bg-primary/5' : ''
                }`}
                onClick={() => {
                  onNotificationClick(notification);
                  if (!notification.read) {
                    onMarkAsRead(notification.id);
                  }
                }}
              >
                <div className="flex items-start gap-3">
                  <span className="text-lg">
                    {getNotificationIcon(notification.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${!notification.read ? 'font-medium' : ''}`}>
                      {messageFor(notification)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {time(notification.timestamp)}
                    </p>
                  </div>
                  {!notification.read && (
                    <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1" />
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};