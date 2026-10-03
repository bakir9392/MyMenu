import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ORDER_SERVER_URL, OrderStatus } from "@/lib/order-server";

interface Handlers {
  /** Nouvelle commande reçue d'une table */
  onNewOrder?: () => void;
  /** Statut d'une commande modifié (par l'admin ou la caisse) */
  onStatusChanged?: () => void;
}

/**
 * Connexion temps réel au serveur de commandes : l'admin reçoit les mêmes événements que la caisse
 * et peut faire les mêmes actions (confirmer, servir, encaisser, annuler).
 */
export function useRestaurantSocket({ onNewOrder, onStatusChanged }: Handlers = {}) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const handlers = useRef({ onNewOrder, onStatusChanged });
  handlers.current = { onNewOrder, onStatusChanged };

  useEffect(() => {
    const newSocket = io(ORDER_SERVER_URL, { transports: ["websocket", "polling"] });
    newSocket.on("connect", () => setIsConnected(true));
    newSocket.on("disconnect", () => setIsConnected(false));
    newSocket.on("connect_error", () => setIsConnected(false));
    newSocket.on("order-notification", () => handlers.current.onNewOrder?.());
    newSocket.on("order-status-changed", () => handlers.current.onStatusChanged?.());
    setSocket(newSocket);
    return () => {
      newSocket.close();
    };
  }, []);

  const updateOrderStatus = useCallback(
    (orderId: string, tableNumber: string, status: OrderStatus) => {
      if (!socket || !isConnected) return false;
      socket.emit("order-status-update", { orderId, tableNumber, status, timestamp: new Date().toISOString() });
      return true;
    },
    [socket, isConnected]
  );

  return { isConnected, updateOrderStatus };
}
