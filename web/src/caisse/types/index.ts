export interface Table {
  id: number;
  number: string;
  status: 'free' | 'occupied' | 'reserved';
  orderTime?: Date;
  /** TVA propre à la table (0-100) ; null = taux du restaurant */
  taxRate: number | null;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  available: boolean;
  image?: string;
  image_url?: string;
}

export interface OrderItem {
  id: string;
  menuItem: MenuItem;
  quantity: number;
  notes?: string;
}

export interface Order {
  id: string;
  tableId: number;
  items: OrderItem[];
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'served' | 'paid' | 'cancelled';
  total: number;
  /** Texte saisi par le client avec sa commande */
  note?: string;
  createdAt: Date;
  updatedAt: Date;
  phoneNumber?: string;
}

/** Notification de la caisse : le texte est composé à l'affichage (traduit) à partir du type et de la table */
export interface Notification {
  id: string;
  type: 'new_order' | 'order_modified' | 'order_cancelled' | 'payment_received';
  tableNumber: string;
  orderId?: string;
  timestamp: Date;
  read: boolean;
}
