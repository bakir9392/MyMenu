import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TableGrid } from "@/components/dashboard/TableGrid";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { OrdersSummary } from "@/components/dashboard/OrdersSummary";
import { TableManagementModal } from "@/components/modals/TableManagementModal";
import { TableSelectionModal } from "@/components/modals/TableSelectionModal";
import { NotificationPanel } from "@/components/notifications/NotificationPanel";
import OrderNotifications from "@/components/OrderNotifications";
import { useSocket } from "@/hooks/useSocket";
import { useRestaurant } from "@/hooks/useRestaurant";
import { useCashier } from "@/lib/auth";
import { Table, Order, Notification } from "@/types";
import { toast } from "@/hooks/use-toast";
import { ORDER_SERVER_URL, orderApi, parseServerDate, RestaurantTable, Order as ServerOrder } from "@/lib/order-server";
import { SendMessageDialog } from "@/components/messages/send-message-dialog";
import { playSound } from "@/lib/sounds";
import { computeBill } from "../../shared/bill";
import { useI18n } from "../../shared/i18n";
import { PaperFormat, printReceipt } from "../../shared/receipt";

export const Dashboard = () => {
  const navigate = useNavigate();
  const i18n = useI18n();
  const { t } = i18n;
  const { session } = useCashier();
  const { socket, updateOrderStatus, payTable, sendStaffMessage } = useSocket();
  const { settings, name: restaurantName, currency, timezone } = useRestaurant();
  const [messageTable, setMessageTable] = useState<Table | null>(null);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isTableSelectionModalOpen, setIsTableSelectionModalOpen] = useState(false);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);

  // Tables et commandes en cours, chargées depuis le serveur (rechargées à chaque événement temps réel)
  const [tables, setTables] = useState<Table[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [todayRevenue, setTodayRevenue] = useState<number | undefined>(undefined);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [serverTables, serverOrders, stats] = await Promise.all([
        orderApi<RestaurantTable[]>("/tables"),
        orderApi<ServerOrder[]>("/orders?scope=active"),
        orderApi<{ summary: { revenue: number } }>("/stats?period=today"),
      ]);

      // Tables configurées + tables encore référencées par une commande en cours (si supprimées entre-temps)
      const numbers = serverTables.map((table) => table.number);
      serverOrders.forEach((o) => {
        if (!numbers.includes(o.table_number)) numbers.push(o.table_number);
      });
      const mappedTables: Table[] = numbers.map((number, index) => ({
        id: index + 1,
        number,
        status: serverTables.find((table) => table.number === number)?.has_open_session ? "occupied" : "free",
        taxRate: serverTables.find((table) => table.number === number)?.tax_rate ?? null,
      }));
      const tableIdByNumber = new Map(mappedTables.map((table) => [table.number, table.id]));

      setTables(mappedTables);
      setOrders(serverOrders.map((o) => ({
        id: o.id,
        tableId: tableIdByNumber.get(o.table_number)!,
        items: o.items.map((item, index) => ({
          id: `${o.id}-${index}`,
          menuItem: {
            id: String(item.dish_id ?? index),
            name: item.name,
            description: "",
            price: item.price,
            category: "",
            available: true,
          },
          quantity: item.quantity,
          notes: item.notes ?? undefined,
        })),
        status: o.status as Order["status"],
        total: o.total,
        note: o.note ?? undefined,
        createdAt: parseServerDate(o.created_at),
        updatedAt: parseServerDate(o.created_at),
      })));
      setTodayRevenue(stats.summary.revenue);
    } catch (error) {
      console.error("Error loading orders:", error);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000); // filet de sécurité si un événement est manqué
    return () => clearInterval(interval);
  }, [loadData]);

  // Nouvelle commande, changement de statut, nouveau client à une table : on recharge et on prévient
  useEffect(() => {
    if (!socket) return;
    const onNewOrder = (order: { orderId: string; tableNumber: string; timestamp?: string }) => {
      loadData();
      setNotifications(prev => {
        const id = `socket-${order.orderId}`;
        if (prev.some(n => n.id === id)) return prev;
        return [{
          id,
          type: 'new_order' as const,
          tableNumber: order.tableNumber,
          orderId: order.orderId,
          timestamp: order.timestamp ? new Date(order.timestamp) : new Date(),
          read: false
        }, ...prev];
      });
    };
    const onStatusChanged = () => loadData();
    const onTableOpened = ({ tableNumber }: { tableNumber: string }) => {
      toast.info(t("caisse.toast.tableOpened", { table: tableNumber }));
      loadData();
    };
    socket.on("order-notification", onNewOrder);
    socket.on("order-status-changed", onStatusChanged);
    socket.on("table-opened", onTableOpened);
    socket.on("table-released", onStatusChanged);
    return () => {
      socket.off("order-notification", onNewOrder);
      socket.off("order-status-changed", onStatusChanged);
      socket.off("table-opened", onTableOpened);
      socket.off("table-released", onStatusChanged);
    };
  }, [socket, loadData, t]);

  // Réclamations non traitées (compteur du bouton) + alerte en temps réel
  const [newComplaints, setNewComplaints] = useState(0);
  const refreshComplaintsCount = useCallback(() => {
    fetch(`${ORDER_SERVER_URL}/api/complaints?status=new&period=all`)
      .then((r) => r.json())
      .then((body) => setNewComplaints(body.newCount ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshComplaintsCount();
    if (!socket) return;
    const onComplaint = (complaint: { table_number: string }) => {
      playSound('message');
      toast.error(t("caisse.toast.newComplaint", { table: complaint.table_number }), {
        action: { label: t("caisse.toast.view"), onClick: () => navigate('/reclamations') },
      });
      refreshComplaintsCount();
    };
    socket.on('complaint-created', onComplaint);
    socket.on('complaint-updated', refreshComplaintsCount);
    return () => {
      socket.off('complaint-created', onComplaint);
      socket.off('complaint-updated', refreshComplaintsCount);
    };
  }, [socket, refreshComplaintsCount, navigate, t]);

  const tableNumberOf = (order: Order) => tables.find(table => table.id === order.tableId)?.number ?? String(order.tableId);

  // Commandes en cours de la même table que la commande donnée (la caisse travaille par table)
  const activeOrdersOfTable = (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return [];
    return orders.filter(o => o.tableId === order.tableId && o.status !== 'paid' && o.status !== 'cancelled');
  };

  const setStatus = (targets: Order[], status: Order['status']) => {
    if (targets.length === 0) return;
    const ids = new Set(targets.map(o => o.id));
    setOrders(prev => prev.map(o => (ids.has(o.id) ? { ...o, status, updatedAt: new Date() } : o)));
    targets.forEach(o => updateOrderStatus({ orderId: o.id, tableNumber: tableNumberOf(o), status }));
  };

  const handleReleaseTable = async (table: Table, hasOrder: boolean) => {
    await orderApi(`/tables/${encodeURIComponent(table.number)}/release`, { method: "POST", body: JSON.stringify({ force: hasOrder }) });
    await loadData();
  };

  const handleTableSelect = (table: Table) => {
    setSelectedTable(table);
    setIsTableModalOpen(true);
  };

  const handleConfirmOrder = async (orderId: string) => {
    const targets = activeOrdersOfTable(orderId).filter(o => o.status === 'pending');
    setNotifications(prev => prev.filter(n => !targets.some(o => o.id === n.orderId)));
    setStatus(targets, 'confirmed');
  };

  const handleMarkReady = async (orderId: string) => {
    const targets = activeOrdersOfTable(orderId).filter(o => o.status !== 'served');
    setStatus(targets, 'served');
  };

  // Encaissement : toutes les commandes de la table sont payées, la session de la table se ferme.
  // Le nom du caissier sur la facture vient du jeton, côté serveur.
  const handleProcessPayment = async (orderId: string) => {
    const targets = activeOrdersOfTable(orderId);
    if (targets.length === 0) return;
    const tableNumber = tableNumberOf(targets[0]);
    const reply = await payTable(tableNumber);
    if (!reply.ok) {
      if (reply.reason === 'not_connected' || reply.reason === 'timeout') {
        toast.error(t("caisse.toast.paymentFailed"));
        return;
      }
      // pas de session (commande ancienne) : encaissement commande par commande
      setStatus(targets, 'paid');
    }
    setNotifications(prev => prev.filter(n => !targets.some(o => o.id === n.orderId)));
    setIsTableModalOpen(false);
    toast.success(t("caisse.toast.paid", { table: tableNumber }));
    loadData();
  };

  const handleSendMessage = (table: Table) => setMessageTable(table);

  // Addition provisoire de la table (non payée) sur l'imprimante du restaurant
  const handlePrintBill = (table: Table, order: Order, paper: PaperFormat) => {
    const lines = order.items.map((item) => ({ name: item.menuItem.name, price: item.menuItem.price, quantity: item.quantity }));
    const bill = computeBill(order.total, settings, table.taxRate);
    const ok = printReceipt({
      restaurantName,
      address: settings?.restaurant_address,
      phone: settings?.restaurant_phone,
      footer: settings?.receipt_footer,
      cashier: session.user.name,
      tableNumber: table.number,
      date: new Date(),
      lines,
      total: bill.total,
      breakdown: bill,
      currency,
      timeZone: timezone,
    }, i18n, paper);
    if (!ok) toast.error(t("caisse.toast.printFailed"));
  };

  const handleDeleteOrder = async (orderId: string) => {
    const targets = activeOrdersOfTable(orderId);
    setNotifications(prev => prev.filter(n => !targets.some(o => o.id === n.orderId)));
    setStatus(targets, 'cancelled');
    setIsTableModalOpen(false);
  };

  const handleNotificationClick = (notification: Notification) => {
    if (notification.orderId) {
      const order = orders.find(o => o.id === notification.orderId);
      const table = tables.find(tb => tb.id === order?.tableId);
      if (table) {
        setSelectedTable(table);
        setIsTableModalOpen(true);
        setIsNotificationPanelOpen(false);
      }
    }
  };

  const handleMarkNotificationAsRead = (notificationId: string) => {
    setNotifications(prev => prev.map(n =>
      n.id === notificationId ? { ...n, read: true } : n
    ));
  };

  // Toutes les commandes en cours de la table réunies (articles, total, étape la moins avancée)
  const getSelectedTableOrder = (): Order | null => {
    if (!selectedTable) return null;
    const table = tables.find(tb => tb.number === selectedTable.number);
    if (!table) return null;
    const tableOrders = orders
      .filter(o => o.tableId === table.id && o.status !== 'paid' && o.status !== 'cancelled')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (tableOrders.length === 0) return null;
    const stage: Order['status'][] = ['pending', 'confirmed', 'preparing', 'ready', 'served'];
    const status = stage.find(st => tableOrders.some(o => o.status === st)) ?? tableOrders[0].status;
    return {
      ...tableOrders[0],
      status,
      items: tableOrders.flatMap(o => o.items),
      total: tableOrders.reduce((sum, o) => sum + o.total, 0),
      note: tableOrders.map(o => o.note).filter(Boolean).join(' • ') || undefined,
    };
  };

  const unreadNotifications = notifications.filter(n => !n.read).length;

  return (
    <>
      <DashboardLayout
        notificationCount={unreadNotifications}
        isNotificationPanelOpen={isNotificationPanelOpen}
        setIsNotificationPanelOpen={setIsNotificationPanelOpen}
      >
        <div className="space-y-6">
          {/* Résumé des commandes */}
          <OrdersSummary orders={orders} todayRevenue={todayRevenue} />

          {/* Actions rapides */}
          <QuickActions
            onNewOrder={() => setIsTableSelectionModalOpen(true)}
            onManageMenu={() => navigate('/menu-management')}
            onViewReceipts={() => navigate('/factures')}
            onManageTables={() => navigate('/tables')}
            onViewComplaints={() => navigate('/reclamations')}
            newComplaints={newComplaints}
          />

          {/* Grille des tables */}
          <div className="bg-card rounded-lg border border-border/50 p-4 sm:p-6">
            <h2 className="text-xl font-semibold mb-6">{t("caisse.dashboard.tables")}</h2>
            <TableGrid
              tables={tables}
              orders={orders}
              onTableSelect={handleTableSelect}
            />
          </div>
        </div>
      </DashboardLayout>

      {/* Modal de sélection de table pour nouvelle commande */}
      <TableSelectionModal
        isOpen={isTableSelectionModalOpen}
        onClose={() => setIsTableSelectionModalOpen(false)}
        tables={tables}
        orders={orders}
        onTableSelect={handleTableSelect}
        onTakeawaySelect={() => setSelectedTable(null)}
      />

      {/* Modal de gestion des tables */}
      <TableManagementModal
        table={tables.find(tb => tb.number === selectedTable?.number) ?? selectedTable}
        order={getSelectedTableOrder()}
        isOpen={isTableModalOpen}
        onClose={() => setIsTableModalOpen(false)}
        onConfirmOrder={handleConfirmOrder}
        onMarkReady={handleMarkReady}
        onProcessPayment={handleProcessPayment}
        onDeleteOrder={handleDeleteOrder}
        onSendMessage={handleSendMessage}
        onReleaseTable={handleReleaseTable}
        onPrintBill={handlePrintBill}
      />

      {/* Message au client d'une table */}
      <SendMessageDialog
        open={!!messageTable}
        onOpenChange={(open) => !open && setMessageTable(null)}
        tableNumber={messageTable?.number ?? null}
        onSend={(text) => sendStaffMessage(messageTable!.number, text)}
        notify={(title, isError) => (isError ? toast.error(title) : toast.success(title))}
      />

      {/* Panel de notifications */}
      <NotificationPanel
        notifications={notifications}
        isOpen={isNotificationPanelOpen}
        onClose={() => setIsNotificationPanelOpen(false)}
        onNotificationClick={handleNotificationClick}
        onMarkAsRead={handleMarkNotificationAsRead}
      />

      {/* Commandes en temps réel : accepter / refuser */}
      <OrderNotifications />
    </>
  );
};

export default Dashboard;
