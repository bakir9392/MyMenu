import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { ORDER_SERVER_URL } from '@/lib/orderServer';

interface OrderStatusUpdate {
  orderId: string;
  tableNumber: string;
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'served' | 'paid' | 'cancelled';
  timestamp: string;
}

export interface SocketReply {
  ok: boolean;
  reason?: 'session_closed' | 'invalid_item' | 'empty_order' | 'server_error' | 'not_connected' | 'timeout';
  tableNumber?: string;
}

interface UseSocketReturn {
  socket: Socket | null;
  isConnected: boolean;
  orderStatusUpdates: OrderStatusUpdate[];
  clearOrderStatusUpdates: () => void;
  /** Envoie la commande ; résout avec la réponse du serveur (acceptée ou refusée) */
  sendOrder: (orderData: any) => Promise<SocketReply>;
  /** Rejoint la salle de la table de la session pour recevoir les mises à jour */
  joinSession: (sessionToken: string) => Promise<SocketReply>;
  /** Appelé quand la caisse a encaissé la table (session terminée) */
  onSessionClosed: (handler: () => void) => () => void;
  /** Message envoyé par la caisse / l'admin à cette table */
  onStaffMessage: (handler: (message: StaffMessage) => void) => () => void;
}

export interface StaffMessage {
  id: number;
  text: string;
  sender: string | null;
  created_at: string;
}

const emitWithAck = (socket: Socket | null, isConnected: boolean, event: string, data: any): Promise<SocketReply> => {
  if (!socket || !isConnected) return Promise.resolve({ ok: false, reason: 'not_connected' });
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, data, (err: Error | null, reply: SocketReply) => {
      resolve(err ? { ok: false, reason: 'timeout' } : reply);
    });
  });
};

export const useSocket = (): UseSocketReturn => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [orderStatusUpdates, setOrderStatusUpdates] = useState<OrderStatusUpdate[]>([]);

  useEffect(() => {
    const newSocket = io(ORDER_SERVER_URL || undefined, {
      transports: ['websocket', 'polling'],
      timeout: 5000,
    });

    newSocket.on('connect', () => {
      console.log('🔌 Client connected to server');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('🔌 Client disconnected from server');
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.warn('🔌 Socket.IO connection failed:', error.message);
      setIsConnected(false);
    });

    // Nouvelle commande passée depuis un autre téléphone de la même table
    newSocket.on('table-order-update', (data: { orderId: string }) => {
      setOrderStatusUpdates(prev => [{ orderId: data.orderId, tableNumber: '', status: 'pending', timestamp: new Date().toISOString() }, ...prev]);
    });

    newSocket.on('order-status-changed', (updateData: OrderStatusUpdate) => {
      console.log('📊 Order status update received:', updateData);
      setOrderStatusUpdates(prev => [updateData, ...prev]);
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, []);

  const clearOrderStatusUpdates = useCallback(() => {
    setOrderStatusUpdates([]);
  }, []);

  const sendOrder = useCallback(
    (orderData: any) => emitWithAck(socket, isConnected, 'new-order', orderData),
    [socket, isConnected]
  );

  const joinSession = useCallback(
    (sessionToken: string) => emitWithAck(socket, isConnected, 'join-session', sessionToken),
    [socket, isConnected]
  );

  const onSessionClosed = useCallback((handler: () => void) => {
    if (!socket) return () => {};
    socket.on('session-closed', handler);
    return () => {
      socket.off('session-closed', handler);
    };
  }, [socket]);

  const onStaffMessage = useCallback((handler: (message: StaffMessage) => void) => {
    if (!socket) return () => {};
    socket.on('staff-message', handler);
    return () => {
      socket.off('staff-message', handler);
    };
  }, [socket]);

  return {
    socket,
    isConnected,
    orderStatusUpdates,
    clearOrderStatusUpdates,
    sendOrder,
    joinSession,
    onSessionClosed,
    onStaffMessage,
  };
};
