import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";
import { playSound } from "@/lib/sounds";
import { useCashier } from "@/lib/auth";
import { clearSession, goToLogin } from "../../shared/session";
import { ORDER_SERVER_URL, OrderStatus } from "@/lib/order-server";
import { useI18n } from "../../shared/i18n";
import { RestaurantSettings, useRestaurantSettings } from "../../shared/bill";

export interface OrderData {
  id: string;
  orderId: string;
  tableNumber: string;
  items: { name: string; price: number; quantity: number }[];
  total: number;
  timestamp: string;
}

export interface OrderStatusUpdate {
  orderId: string;
  tableNumber: string;
  status: OrderStatus;
  timestamp: string;
}

export interface SocketReply {
  ok: boolean;
  reason?: string;
}

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  notifications: OrderData[];
  orderUpdates: OrderStatusUpdate[];
  clearNotifications: () => void;
  clearOrderUpdates: () => void;
  updateOrderStatus: (updateData: { orderId: string; tableNumber: string; status: OrderStatus }) => void;
  /** Encaisse toute la table (toutes ses commandes) : la facture est créée par le serveur, au nom du caissier du jeton */
  payTable: (tableNumber: string) => Promise<SocketReply>;
  /** Envoie un message au client de la table (affiché sur son téléphone avec un son) */
  sendStaffMessage: (tableNumber: string, text: string) => Promise<SocketReply>;
  /** Paramètres du restaurant (devise, fuseau, TVA...), rechargés à chaque "settings-updated" */
  settings: RestaurantSettings | null;
  /** Force le rechargement des paramètres (ex. après un changement de devise depuis le menu) */
  refreshSettings: () => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

/** Une seule connexion temps réel pour toute la caisse, ouverte avec le jeton du caissier */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { session } = useCashier();
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [notifications, setNotifications] = useState<OrderData[]>([]);
  const [orderUpdates, setOrderUpdates] = useState<OrderStatusUpdate[]>([]);
  const [settingsVersion, setSettingsVersion] = useState(0);
  const settings = useRestaurantSettings(settingsVersion);

  useEffect(() => {
    const newSocket = io(ORDER_SERVER_URL, {
      auth: { token: session.token },
      transports: ["websocket", "polling"],
      timeout: 20000,
    });

    newSocket.on("connect", () => {
      newSocket.emit("join-staff"); // reçoit les commandes et statuts de toutes les tables du restaurant
      setIsConnected(true);
    });

    newSocket.on("disconnect", (reason) => {
      setIsConnected(false);
      // Le serveur a coupé la connexion : on retente (un jeton refusé ramène à la connexion via connect_error)
      if (reason === "io server disconnect") newSocket.connect();
    });

    newSocket.on("connect_error", (error) => {
      setIsConnected(false);
      if (error?.message === "unauthorized") {
        clearSession();
        goToLogin();
      }
    });

    newSocket.on("order-notification", (orderData: OrderData) => {
      setNotifications((prev) => [orderData, ...prev]);
      playSound("order");
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(tRef.current("caisse.notif.browserTitle"), {
          body: tRef.current("caisse.notif.browserBody", { table: orderData.tableNumber, count: orderData.items.length }),
          icon: "/favicon.ico",
          tag: orderData.orderId,
        });
      }
    });

    newSocket.on("order-status-changed", (updateData: OrderStatusUpdate) => {
      setOrderUpdates((prev) => [updateData, ...prev]);
    });

    newSocket.on("settings-updated", () => setSettingsVersion((n) => n + 1));

    setSocket(newSocket);

    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }

    return () => {
      newSocket.close();
    };
  }, [session.token]);

  const clearNotifications = useCallback(() => setNotifications([]), []);
  const clearOrderUpdates = useCallback(() => setOrderUpdates([]), []);
  const refreshSettings = useCallback(() => setSettingsVersion((n) => n + 1), []);

  const updateOrderStatus = useCallback<SocketContextValue["updateOrderStatus"]>((updateData) => {
    if (socket && isConnected) {
      socket.emit("order-status-update", { ...updateData, timestamp: new Date().toISOString() });
    }
  }, [socket, isConnected]);

  const emitWithAck = useCallback((event: string, data: unknown): Promise<SocketReply> => {
    if (!socket || !isConnected) return Promise.resolve({ ok: false, reason: "not_connected" });
    return new Promise((resolve) => {
      socket.timeout(8000).emit(event, data, (err: Error | null, reply: SocketReply) => {
        resolve(err ? { ok: false, reason: "timeout" } : reply);
      });
    });
  }, [socket, isConnected]);

  const payTable = useCallback((tableNumber: string) => emitWithAck("pay-table", { tableNumber }), [emitWithAck]);
  const sendStaffMessage = useCallback(
    (tableNumber: string, text: string) => emitWithAck("staff-message", { tableNumber, text }),
    [emitWithAck]
  );

  const value = useMemo<SocketContextValue>(() => ({
    socket,
    isConnected,
    notifications,
    orderUpdates,
    clearNotifications,
    clearOrderUpdates,
    updateOrderStatus,
    payTable,
    sendStaffMessage,
    settings,
    refreshSettings,
  }), [socket, isConnected, notifications, orderUpdates, clearNotifications, clearOrderUpdates, updateOrderStatus, payTable, sendStaffMessage, settings, refreshSettings]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const context = useContext(SocketContext);
  if (!context) throw new Error("useSocket must be used inside <SocketProvider>");
  return context;
}
