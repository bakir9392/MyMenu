import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, X, CheckCircle } from 'lucide-react';
import { useSocket } from '@/hooks/useSocket';
import { useRestaurant } from '@/hooks/useRestaurant';
import { useI18n } from '../../shared/i18n';

// Bulle flottante : nouvelles commandes à accepter ou refuser, et changements de statut, en temps réel
const OrderNotifications = () => {
  const { t } = useI18n();
  const { fmt, time } = useRestaurant();
  const { notifications, orderUpdates, clearNotifications, clearOrderUpdates, updateOrderStatus } = useSocket();
  const [isExpanded, setIsExpanded] = useState(false);

  const handleAcceptOrder = (order: { orderId: string; tableNumber: string }) => {
    updateOrderStatus({ orderId: order.orderId, tableNumber: order.tableNumber, status: 'confirmed' });
  };

  const handleRejectOrder = (order: { orderId: string; tableNumber: string }) => {
    updateOrderStatus({ orderId: order.orderId, tableNumber: order.tableNumber, status: 'cancelled' });
  };

  const totalNotifications = notifications.length + orderUpdates.length;

  if (totalNotifications === 0) {
    return null;
  }

  return (
    <div className="fixed top-4 end-4 z-50">
      {/* Notification Bell */}
      <Button
        variant="outline"
        size="icon"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-label={t("caisse.notif.title")}
        className="relative bg-white shadow-lg hover:bg-gray-50"
      >
        <Bell className="h-5 w-5" />
        {totalNotifications > 0 && (
          <Badge
            className="absolute -top-2 -end-2 h-6 w-6 rounded-full p-0 flex items-center justify-center bg-red-500 text-white text-xs font-bold"
          >
            {totalNotifications}
          </Badge>
        )}
      </Button>

      {/* Expanded Notifications Panel */}
      {isExpanded && (
        <Card className="w-96 max-w-[calc(100vw-2rem)] max-h-[80vh] overflow-hidden shadow-xl border-0">
          <CardHeader className="bg-primary text-white pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Bell className="h-5 w-5" />
                {t("caisse.notif.titleCount", { count: totalNotifications })}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsExpanded(false)}
                aria-label={t("common.close")}
                className="text-white hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="max-h-[60vh] overflow-y-auto">
              {/* New Orders */}
              {notifications.length > 0 && (
                <div className="border-b">
                  <div className="px-4 py-2 bg-blue-50">
                    <h4 className="font-medium text-blue-800">{t("caisse.notif.newOrders")}</h4>
                  </div>
                  {notifications.map((order) => (
                    <div key={order.id} className="p-4 border-b border-gray-100 hover:bg-gray-100">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h5 className="font-semibold text-gray-900">
                            {t("caisse.table.label", { number: order.tableNumber })}
                          </h5>
                          <p className="text-sm text-gray-600">
                            {t("caisse.notif.itemsCount", { count: order.items.length })} • {fmt(order.total)}
                          </p>
                          <p className="text-xs text-gray-500">
                            {time(order.timestamp)}
                          </p>
                        </div>
                        <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                          {t("caisse.notif.badgeNew")}
                        </Badge>
                      </div>

                      {/* Order Items */}
                      <div className="space-y-1 mb-3">
                        {order.items.map((item, index) => (
                          <div key={index} className="flex justify-between gap-2 text-sm">
                            <span className="text-gray-700">
                              {item.quantity}x {item.name}
                            </span>
                            <span className="text-gray-600 whitespace-nowrap">
                              {fmt(item.price * item.quantity)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleAcceptOrder(order)}
                          className="flex-1 bg-green-600 hover:bg-green-700"
                        >
                          <CheckCircle className="h-4 w-4 me-1" />
                          {t("caisse.notif.accept")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRejectOrder(order)}
                          className="flex-1"
                        >
                          <X className="h-4 w-4 me-1" />
                          {t("caisse.notif.reject")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Order Updates */}
              {orderUpdates.length > 0 && (
                <div>
                  <div className="px-4 py-2 bg-green-50">
                    <h4 className="font-medium text-green-800">{t("caisse.notif.updates")}</h4>
                  </div>
                  {orderUpdates.map((update, index) => (
                    <div key={`${update.orderId}-${index}`} className="p-4 border-b border-gray-100">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h5 className="font-medium text-gray-900">
                            {t("caisse.table.label", { number: update.tableNumber })}
                          </h5>
                          <p className="text-sm text-gray-600">
                            {t("caisse.notif.status", { status: t(`status.${update.status}`) })}
                          </p>
                          <p className="text-xs text-gray-500">
                            {time(update.timestamp)}
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className={`${
                            update.status === 'confirmed' ? 'bg-blue-100 text-blue-800' :
                            update.status === 'preparing' ? 'bg-yellow-100 text-yellow-800' :
                            update.status === 'ready' ? 'bg-green-100 text-green-800' :
                            'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {t(`status.${update.status}`)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t bg-gray-50">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearNotifications}
                  className="flex-1"
                >
                  {t("caisse.notif.clearOrders")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearOrderUpdates}
                  className="flex-1"
                >
                  {t("caisse.notif.clearUpdates")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default OrderNotifications;
