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
  reason?: 'session_closed' | 'server_error' | 'not_connected' | 'timeout';
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
    const newSocket = io(ORDER_SERVER_URL, {
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

  return {
    socket,
    isConnected,
    orderStatusUpdates,
    clearOrderStatusUpdates,
    sendOrder,
    joinSession,
    onSessionClosed,
  };
};
