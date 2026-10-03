import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ORDER_SERVER_URL, OrderStatus } from "@/lib/order-server";
import { playSound } from "@/lib/sounds";
import { getToken, handleUnauthorized } from "@/lib/auth-storage";

interface Options {
  /** Nouvelle commande reçue d'une table */
  onNewOrder?: () => void;
  /** Statut d'une commande modifié (par l'admin ou la caisse) */
  onStatusChanged?: () => void;
  /** Facture créée (table encaissée) */
  onInvoiceCreated?: () => void;
  /** Nouvelle réclamation d'un client */
  onComplaintCreated?: (complaint: { id: number; table_number: string }) => void;
  /** Réclamation traitée / rouverte */
  onComplaintUpdated?: () => void;
  /** Paramètres du restaurant modifiés (devise, TVA, nom...) */
  onSettingsUpdated?: () => void;
  /** Jouer un son à chaque nouvelle commande */
  sounds?: boolean;
}

export interface SocketReply {
  ok: boolean;
  reason?: string;
}

/**
 * Connexion temps réel au serveur de commandes : l'admin reçoit les mêmes événements que la caisse
 * et peut faire les mêmes actions (confirmer, servir, encaisser, annuler, écrire au client).
 */
export function useRestaurantSocket({ onNewOrder, onStatusChanged, onInvoiceCreated, onComplaintCreated, onComplaintUpdated, onSettingsUpdated, sounds = false }: Options = {}) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const handlers = useRef({ onNewOrder, onStatusChanged, onInvoiceCreated, onComplaintCreated, onComplaintUpdated, onSettingsUpdated, sounds });
  handlers.current = { onNewOrder, onStatusChanged, onInvoiceCreated, onComplaintCreated, onComplaintUpdated, onSettingsUpdated, sounds };

  useEffect(() => {
    // Le jeton de l'admin est exigé : sans jeton valide la connexion est refusée
    const newSocket = io(ORDER_SERVER_URL || undefined, { auth: { token: getToken() }, transports: ["websocket", "polling"] });
    newSocket.on("connect", () => {
      newSocket.emit("join-staff"); // reçoit les commandes et statuts de toutes les tables
      setIsConnected(true);
    });
    newSocket.on("disconnect", () => setIsConnected(false));
    newSocket.on("connect_error", (error) => {
      setIsConnected(false);
      if (error?.message === "unauthorized") handleUnauthorized();
    });
    newSocket.on("order-notification", () => {
      if (handlers.current.sounds) playSound("order");
      handlers.current.onNewOrder?.();
    });
    newSocket.on("order-status-changed", () => handlers.current.onStatusChanged?.());
    newSocket.on("invoice-created", () => handlers.current.onInvoiceCreated?.());
    newSocket.on("complaint-created", (complaint) => {
      if (handlers.current.sounds) playSound("message");
      handlers.current.onComplaintCreated?.(complaint);
    });
    newSocket.on("complaint-updated", () => handlers.current.onComplaintUpdated?.());
    newSocket.on("settings-updated", () => handlers.current.onSettingsUpdated?.());
    setSocket(newSocket);
    return () => {
      newSocket.close();
    };
  }, []);

  const updateOrderStatus = useCallback(
    (orderId: string, tableNumber: string, status: OrderStatus) => {
      if (!socket || !isConnected) return false;
      socket.emit("order-status-update", { orderId, tableNumber, status });
      return true;
    },
    [socket, isConnected]
  );

  const emitWithAck = useCallback(
    (event: string, data: unknown): Promise<SocketReply> => {
      if (!socket || !isConnected) return Promise.resolve({ ok: false, reason: "not_connected" });
      return new Promise((resolve) => {
        socket.timeout(8000).emit(event, data, (err: Error | null, reply: SocketReply) => {
          resolve(err ? { ok: false, reason: "timeout" } : reply);
        });
      });
    },
    [socket, isConnected]
  );

  /** Encaisse toute la table : toutes ses commandes sont payées et la facture est créée */
  const payTable = useCallback((tableNumber: string) => emitWithAck("pay-table", { tableNumber }), [emitWithAck]);

  /** Message au client de la table (affiché sur son téléphone avec un son) */
  const sendMessage = useCallback(
    (tableNumber: string, text: string, sender?: string) => emitWithAck("staff-message", sender ? { tableNumber, text, sender } : { tableNumber, text }),
    [emitWithAck]
  );

  return { isConnected, updateOrderStatus, payTable, sendMessage };
}
