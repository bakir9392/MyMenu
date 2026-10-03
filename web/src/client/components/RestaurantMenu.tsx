import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Receipt, MessageSquare, Eye, Clock, CheckCircle, AlertCircle, ClipboardList, ChevronRight, QrCode, PartyPopper } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSocket, StaffMessage } from "@/hooks/useSocket";
import { getSessionToken, useTableSession } from "@/hooks/useTableSession";
import { ORDER_SERVER_URL } from "@/lib/orderServer";
import { useRestaurantSettings } from "@/lib/bill";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";
import DishModal from "./DishModal";
import BillPage from "./BillPage";
import ComplaintPage from "./ComplaintPage";
import MyOrdersPage, { SessionOrder } from "./MyOrdersPage";
import CartPage from "./CartPage";
import NotificationCenter, { AppNotification } from "./NotificationCenter";
import { playSound } from "@/lib/sounds";
import restaurantHero from "@/assets/restaurant-hero.jpg";

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  /** Devise du restaurant au moment du chargement ("EUR" | "USD") */
  currency?: string;
  category: string;
  image: string;
  images?: string[]; // Support multiple images
  available?: boolean;
}

export interface CartItem extends MenuItem {
  quantity: number;
  notes?: string;
  tableNumber?: string;
  orderId?: string; // Add orderId field for confirmed orders
}

type ViewType = "menu" | "bill" | "complaint" | "cart" | "orders";

// Valeur interne du filtre « Tous » (jamais affichée : on affiche t("common.all"))
const ALL_CATEGORIES = "__all__";
const PLACEHOLDER_IMAGE = "/placeholder.svg";

const RestaurantMenu = () => {
  const { t, money } = useI18n();
  // Les gestionnaires d'événements (socket) lisent toujours la langue actuelle sans se réabonner
  const tRef = useRef(t);
  tRef.current = t;

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // Le serveur a refusé le menu (401) : pas de session de table valable, il faut scanner le QR code
  const [needsSession, setNeedsSession] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const cartRef = useRef<CartItem[]>(cart);
  cartRef.current = cart;
  // Commandes de la visite, chargées depuis le serveur (conservées si le client rescanne ou recharge la page)
  const [sessionOrders, setSessionOrders] = useState<SessionOrder[]>([]);
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);

  const [currentView, setCurrentView] = useState<ViewType>("menu");
  const [selectedDish, setSelectedDish] = useState<MenuItem | null>(null);
  const [isDishModalOpen, setIsDishModalOpen] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [successItem, setSuccessItem] = useState<{name: string, quantity: number} | null>(null);

  // Incrémentés pour recharger les paramètres / le menu (changement fait par l'admin, plat retiré...)
  const [settingsKey, setSettingsKey] = useState(0);
  const [menuKey, setMenuKey] = useState(0);
  const hasMenuRef = useRef(false);

  const { toast } = useToast();
  const { socket, isConnected, sendOrder, joinSession, onSessionClosed, onStaffMessage, orderStatusUpdates } = useSocket();

  // Session de table créée en scannant le QR code de la table
  const tableSession = useTableSession();
  const tableNumber = tableSession.tableNumber;

  // Paramètres du restaurant (nom, devise, TVA, frais de table) : rechargés quand la session apparaît ou que l'admin les change
  const settings = useRestaurantSettings(`${tableSession.status}|${tableSession.token ?? ""}|${settingsKey}`);
  const currency = settings?.currency ?? menuItems[0]?.currency;

  // L'admin a changé les paramètres (devise, TVA...) : on recharge paramètres et menu
  useEffect(() => {
    if (!socket) return;
    const handler = () => setSettingsKey((key) => key + 1);
    socket.on("settings-updated", handler);
    return () => {
      socket.off("settings-updated", handler);
    };
  }, [socket]);

  // Rejoindre la salle de la table (mises à jour de statut) dès que la session et le socket sont prêts
  useEffect(() => {
    if (!isConnected || !tableSession.token) return;
    joinSession(tableSession.token).then((reply) => {
      if (!reply.ok && reply.reason === 'session_closed') tableSession.endSession();
    });
  }, [isConnected, tableSession.token, joinSession, tableSession.endSession]);

  // Notifications à l'écran (statuts, messages du restaurant), avec un son
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  // Même notification reçue plusieurs fois d'affilée (ex. : 2 commandes servies en même temps) : affichée une seule fois
  const lastShown = useRef<Record<string, number>>({});
  const notify = useCallback((notification: Omit<AppNotification, "id">) => {
    const key = `${notification.kind}|${notification.title}|${notification.text}`;
    const now = Date.now();
    if (!notification.sticky && now - (lastShown.current[key] ?? 0) < 3000) return;
    lastShown.current[key] = now;
    playSound(notification.kind === "sent" ? "confirmed" : notification.kind);
    setNotifications((prev) => [...prev, { ...notification, id: `${Date.now()}-${Math.random()}` }]);
  }, []);
  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Messages envoyés par le restaurant pendant la visite
  const [staffMessages, setStaffMessages] = useState<StaffMessage[]>([]);

  useEffect(() => {
    return onStaffMessage((message) => {
      setStaffMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      notify({ kind: "message", title: tRef.current("client.notify.messageTitle"), text: message.text, sticky: true });
    });
  }, [onStaffMessage, notify]);

  // La caisse a encaissé la table : la visite est terminée, le client peut garder son reçu
  useEffect(() => {
    return onSessionClosed(() => {
      tableSession.endSession();
      setStaffMessages([]);
      notify({
        kind: "paid",
        title: tRef.current("client.notify.paidTitle"),
        text: tRef.current("client.notify.paidText"),
        action: { label: tRef.current("client.notify.saveReceipt"), onClick: () => setCurrentView("bill") },
      });
    });
  }, [onSessionClosed, tableSession.endSession, notify]);

  const loadSessionOrders = useCallback(async () => {
    if (!tableSession.token) {
      setSessionOrders([]);
      return;
    }
    try {
      const base = `${ORDER_SERVER_URL}/api/sessions/${encodeURIComponent(tableSession.token)}`;
      const [ordersResponse, messagesResponse] = await Promise.all([fetch(`${base}/orders`), fetch(`${base}/messages`)]);
      if (ordersResponse.ok) setSessionOrders((await ordersResponse.json()).data);
      if (messagesResponse.ok) setStaffMessages((await messagesResponse.json()).data);
    } catch {
      // hors ligne : on garde l'affichage actuel
    }
  }, [tableSession.token]);

  useEffect(() => {
    loadSessionOrders();
  }, [loadSessionOrders]);

  // Changement de statut : uniquement pour les commandes de cette visite (les autres tables sont ignorées)
  useEffect(() => {
    const latest = orderStatusUpdates[0];
    if (!latest) return;
    if (!sessionOrders.some((o) => o.id === latest.orderId)) {
      // commande passée depuis un autre téléphone de la table : on recharge l'historique
      if (latest.status === 'pending') loadSessionOrders();
      return;
    }
    loadSessionOrders();
    if (latest.status === 'confirmed' || latest.status === 'preparing') {
      notify({ kind: "confirmed", title: t("client.notify.confirmedTitle"), text: t("client.notify.confirmedText") });
    } else if (latest.status === 'ready' || latest.status === 'served') {
      notify({ kind: "served", title: t("client.notify.servedTitle"), text: t("client.notify.servedText") });
    } else if (latest.status === 'cancelled') {
      notify({ kind: "cancelled", title: t("client.notify.cancelledTitle"), text: t("client.notify.cancelledText") });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderStatusUpdates]);

  // Vues dérivées des commandes du serveur : statuts affichés sur le menu et lignes de la facture
  const orderStatuses = useMemo(() => {
    const statuses: { [orderId: string]: "pending" | "preparing" | "ready" } = {};
    for (const order of sessionOrders) {
      if (order.status === 'paid' || order.status === 'cancelled') continue;
      statuses[order.id] = order.status === 'pending' ? 'pending'
        : order.status === 'confirmed' || order.status === 'preparing' ? 'preparing' : 'ready';
    }
    return statuses;
  }, [sessionOrders]);

  const hasBillableOrders = useMemo(() => sessionOrders.some((order) => order.status !== 'cancelled'), [sessionOrders]);

  const activeOrdersCount = Object.keys(orderStatuses).length;

  // Après le paiement : la session est terminée mais l'addition reste consultable un moment
  const visitEnded = !tableSession.token && !!tableSession.lastVisit;
  const canOpenBill = hasBillableOrders || visitEnded;

  // Le panier suit le menu rechargé : prix à jour, plats retirés ou indisponibles enlevés
  const syncCartWithMenu = useCallback((items: MenuItem[]) => {
    const current = cartRef.current;
    if (current.length === 0) return;
    const byId = new Map(items.map((item) => [item.id, item]));
    const next = current
      .filter((line) => byId.has(line.id))
      .map((line) => ({ ...line, price: byId.get(line.id)!.price, currency: byId.get(line.id)!.currency }));
    const priceChanged = next.some((line) => line.price !== current.find((c) => c.id === line.id)?.price);
    if (next.length !== current.length || priceChanged) {
      setCart(next);
      toast({
        title: tRef.current("client.toast.cartUpdatedTitle"),
        description: tRef.current("client.toast.cartUpdatedText"),
      });
    }
  }, [toast]);

  // Charge le menu du restaurant de la table (nécessite une session valable : sinon 401 « scannez le QR code »)
  useEffect(() => {
    if (tableSession.status === "loading") return;
    let cancelled = false;

    const loadMenuItems = async () => {
      if (!getSessionToken()) {
        setMenuItems([]);
        setNeedsSession(true);
        setLoadFailed(false);
        setIsLoading(false);
        return;
      }
      try {
        if (!hasMenuRef.current) setIsLoading(true);
        setLoadFailed(false);

        const response = await fetch(`${ORDER_SERVER_URL}/api/dishes`);
        if (cancelled) return;

        if (response.status === 401) {
          hasMenuRef.current = false;
          setMenuItems([]);
          setNeedsSession(true);
          return;
        }
        if (!response.ok) throw new Error(`Failed to load menu items: ${response.status}`);

        const data = await response.json();
        if (cancelled) return;
        const rows: any[] = Array.isArray(data) ? data : [];

        const items: MenuItem[] = rows
          .filter((item) => item.is_available !== false && item.available !== false) // Hide unavailable dishes
          .map((item) => {
            const images: string[] = Array.isArray(item.images) && item.images.length > 0
              ? item.images
              : item.image_url ? [item.image_url] : item.image ? [item.image] : [];
            return {
              id: String(item.id),
              name: item.name ?? "",
              description: item.description ?? "",
              price: typeof item.price === 'number' ? item.price : parseFloat(item.price || '0'),
              currency: item.currency,
              category: item.category ?? "",
              image: images[0] ?? "",
              images,
              available: true,
            };
          });

        hasMenuRef.current = true;
        setNeedsSession(false);
        setMenuItems(items);
        syncCartWithMenu(items);
      } catch (error) {
        console.error('Error loading menu items:', error);
        if (!cancelled && !hasMenuRef.current) setLoadFailed(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadMenuItems();
    return () => {
      cancelled = true;
    };
  }, [tableSession.status, tableSession.token, settingsKey, menuKey, syncCartWithMenu]);

  // Catégories saisies par le restaurant (texte libre) ; « Tous » est ajouté à l'affichage
  const categories = useMemo(
    () => Array.from(new Set(menuItems.map((item) => item.category).filter(Boolean))),
    [menuItems]
  );
  useEffect(() => {
    if (selectedCategory !== ALL_CATEGORIES && !categories.includes(selectedCategory)) setSelectedCategory(ALL_CATEGORIES);
  }, [categories, selectedCategory]);

  const openDishModal = (item: MenuItem) => {
    setSelectedDish(item);
    setIsDishModalOpen(true);
  };

  const addToCartFromModal = (item: MenuItem, quantity: number) => {
    const existingItemIndex = cart.findIndex(cartItem => cartItem.id === item.id);

    if (existingItemIndex >= 0) {
      setCart(cart.map((cartItem, index) =>
        index === existingItemIndex
          ? { ...cartItem, quantity: cartItem.quantity + quantity }
          : cartItem
      ));
    } else {
      setCart([...cart, { ...item, quantity }]);
    }

    // Afficher le message de succès animé
    setSuccessItem({ name: item.name, quantity });
    setShowSuccessMessage(true);

    // Masquer le message après 2 secondes
    setTimeout(() => {
      setShowSuccessMessage(false);
      setSuccessItem(null);
    }, 2000);
  };

  const submitOrder = async (note = ""): Promise<boolean> => {
    if (cart.length === 0) {
      toast({
        title: t("client.toast.cartEmptyTitle"),
        description: t("client.toast.cartEmptyText"),
        variant: "destructive"
      });
      return false;
    }

    if (tableSession.status !== 'active' || !tableSession.token || !tableNumber) {
      toast({
        title: t("client.toast.scanTitle"),
        description: t("client.toast.scanOrder"),
        variant: "destructive"
      });
      return false;
    }

    // Créer un ID unique pour cette commande
    const orderId = `order_${tableNumber}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Le serveur recalcule noms et prix à partir du menu : seuls les plats, quantités et notes comptent
    const orderData = {
      id: orderId,
      sessionToken: tableSession.token,
      tableNumber,
      note,
      items: cart.map(item => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        notes: item.notes
      })),
      total: cart.reduce((total, item) => total + (item.price * item.quantity), 0)
    };

    // Envoyer la commande et attendre la réponse du serveur
    const reply = await sendOrder(orderData);
    if (!reply.ok) {
      if (reply.reason === 'session_closed') {
        tableSession.endSession();
        toast({
          title: t("client.toast.sessionEndedTitle"),
          description: t("client.toast.sessionEndedText"),
          variant: "destructive"
        });
      } else if (reply.reason === 'invalid_item') {
        // Plat retiré, indisponible ou prix modifié : on recharge le menu (le panier est mis à jour avec)
        setMenuKey((key) => key + 1);
        toast({
          title: t("client.toast.invalidItemTitle"),
          description: t("client.toast.invalidItemText"),
          variant: "destructive"
        });
      } else if (reply.reason === 'empty_order') {
        toast({
          title: t("client.toast.cartEmptyTitle"),
          description: t("client.toast.cartEmptyText"),
          variant: "destructive"
        });
      } else {
        toast({
          title: t("client.toast.orderFailedTitle"),
          description: t("client.toast.orderFailedText"),
          variant: "destructive"
        });
      }
      return false;
    }

    // L'historique de la visite (avec les totaux calculés par le serveur) est rechargé depuis le serveur
    await loadSessionOrders();

    setCurrentView("menu");

    // Vider le panier après confirmation de la commande
    setCart([]);

    // Confirmation à l'écran (même style que les autres notifications)
    notify({
      kind: "sent",
      title: t("client.notify.sentTitle"),
      text: t("client.notify.sentText", { table: tableNumber }),
    });

    return true;
  };

  // Handle different views (les notifications restent visibles sur toutes les vues)
  const notificationLayer = <NotificationCenter notifications={notifications} onDismiss={dismissNotification} />;

  if (currentView === "orders") {
    return (
      <>
        {notificationLayer}
        <MyOrdersPage
          orders={sessionOrders}
          messages={staffMessages}
          tableNumber={tableNumber}
          settings={settings}
          onBack={() => setCurrentView("menu")}
          onOpenBill={() => setCurrentView("bill")}
        />
      </>
    );
  }

  if (currentView === "bill") {
    return (
      <>
        {notificationLayer}
        <BillPage
          sessionToken={tableSession.token ?? tableSession.lastVisit?.token ?? null}
          reloadKey={tableSession.status}
          onBack={() => setCurrentView("menu")}
        />
      </>
    );
  }

  if (currentView === "complaint") {
    const complaintToken = tableSession.token ?? (tableSession.canComplainAfterVisit ? tableSession.lastVisit?.token ?? null : null);
    return (
      <>
        {notificationLayer}
        <ComplaintPage
          onBack={() => setCurrentView("menu")}
          tableNumber={tableNumber ?? (complaintToken ? tableSession.lastVisit?.tableNumber ?? null : null)}
          sessionToken={complaintToken}
          timeZone={settings?.timezone}
        />
      </>
    );
  }

  if (currentView === "cart") {
    return (
      <>
        {notificationLayer}
        <CartPage
          cart={cart}
          onBack={() => setCurrentView("menu")}
          onUpdateCart={setCart}
          onSubmitOrder={submitOrder}
          orderStatuses={orderStatuses}
          tableNumber={tableNumber}
          settings={settings}
        />
      </>
    );
  }

  const filteredItems = selectedCategory === ALL_CATEGORIES
    ? menuItems
    : menuItems.filter(item => item.category === selectedCategory);

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-restaurant-cream to-background flex items-center justify-center">
        <div className="absolute top-3 end-3">
          <LanguageSwitcher />
        </div>
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-primary">{t("client.menu.loading")}</h2>
          <p className="text-muted-foreground">{t("client.menu.loadingSubtitle")}</p>
        </div>
      </div>
    );
  }

  // Pas de session de table valable : le menu n'est montré qu'aux clients installés à une table
  if (needsSession) {
    return (
      <>
        {notificationLayer}
        <div className="min-h-screen bg-gradient-to-br from-background via-restaurant-cream to-background flex items-center justify-center p-6">
          <div className="absolute top-3 end-3">
            <LanguageSwitcher />
          </div>
          <div className="text-center max-w-md mx-auto">
            <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 text-primary">
              <QrCode className="h-12 w-12" />
            </div>
            <h2 className="text-2xl font-bold text-primary mb-3">{t("client.scan.title")}</h2>
            <p className="text-muted-foreground">{t("client.scan.text")}</p>
            {visitEnded && (
              <div className="mt-8 space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-start">
                <p className="flex items-center gap-2 font-semibold text-amber-900">
                  <PartyPopper className="h-5 w-5" />
                  {t("client.scan.thanksTitle")}
                </p>
                <p className="text-sm text-amber-800">{t("client.scan.thanksText")}</p>
                <Button onClick={() => setCurrentView("bill")} className="w-full bg-gradient-to-r from-primary to-restaurant-warm text-white">
                  <Receipt className="h-4 w-4 me-2" />
                  {t("client.notify.saveReceipt")}
                </Button>
                {tableSession.canComplainAfterVisit && (
                  <Button onClick={() => setCurrentView("complaint")} variant="outline" className="w-full">
                    <MessageSquare className="h-4 w-4 me-2" />
                    {t("client.menu.complaint")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // Show error state
  if (loadFailed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-restaurant-cream to-background flex items-center justify-center">
        <div className="absolute top-3 end-3">
          <LanguageSwitcher />
        </div>
        <div className="text-center max-w-md mx-auto p-6">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-red-600 mb-2">{t("client.menu.errorTitle")}</h2>
          <p className="text-muted-foreground mb-4">{t("client.menu.errorText")}</p>
          <Button onClick={() => setMenuKey((key) => key + 1)} variant="outline">
            {t("client.common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const iconButtonClass = "relative bg-white/10 backdrop-blur-md border-white/30 text-white hover:bg-white/20 hover:border-white/50 hover:scale-110 transition-all duration-300 shadow-lg hover:shadow-white/20 group";

  return (
    <>
      <div className="bg-gradient-to-br from-background via-restaurant-cream to-background min-h-screen overflow-y-auto">
        {/* Hero Header */}
        <div className="relative h-48 overflow-hidden">
          <img
            src={restaurantHero}
            alt={t("client.menu.heroAlt")}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r rtl:bg-gradient-to-l from-restaurant-dark/70 to-transparent" />
          <div className="absolute top-3 end-3 z-10">
            <LanguageSwitcher tone="light" />
          </div>
          <div className="absolute inset-0 flex items-center justify-between gap-3 px-6 pt-8">
            <div className="min-w-0">
              <h1 className="text-4xl font-bold text-white mb-2 truncate">{settings?.restaurant_name || t("client.menu.defaultTitle")}</h1>
              <p className="text-restaurant-cream text-lg">
                {tableNumber ? t("client.tableNo", { table: tableNumber }) : t("client.menu.scanToOrder")}
              </p>
              <p className="text-restaurant-cream text-sm opacity-80">
                {t("client.menu.dishesCount", { count: filteredItems.length })}
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="icon"
                className={iconButtonClass}
                onClick={() => setCurrentView("cart")}
                title={cart.length > 0 ? t("client.menu.confirmInCart") : t("client.menu.viewCart")}
              >
                <ShoppingCart className="h-5 w-5 group-hover:rotate-12 transition-transform duration-300" />
                {cart.length > 0 && (
                  <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 bg-red-500 text-white text-xs px-2 py-1 rounded-md whitespace-nowrap animate-bounce shadow-lg">
                    ⚠️ {t("client.menu.confirmBadge")}
                  </div>
                )}
                {cart.length > 0 && (
                  <div className="absolute -bottom-16 left-1/2 transform -translate-x-1/2 bg-yellow-500 text-black text-xs px-3 py-2 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-300 shadow-lg">
                    {t("client.menu.cartNotSent")}
                  </div>
                )}
                {cart.length > 0 && (
                  <Badge
                    className="absolute -top-2 -end-2 h-6 w-6 rounded-full p-0 flex items-center justify-center bg-gradient-to-r from-red-500 to-pink-500 text-white text-xs font-bold animate-pulse shadow-lg"
                  >
                    {cartCount}
                  </Badge>
                )}
              </Button>
              {/* Mes commandes : historique de la visite */}
              {sessionOrders.length > 0 && (
                <Button
                  variant="outline"
                  size="icon"
                  className={iconButtonClass}
                  onClick={() => setCurrentView("orders")}
                  title={t("client.menu.myOrders")}
                >
                  <ClipboardList className="h-5 w-5 group-hover:rotate-12 transition-transform duration-300" />
                  {activeOrdersCount > 0 && (
                    <Badge className="absolute -top-2 -end-2 h-6 w-6 rounded-full p-0 flex items-center justify-center bg-blue-500 text-white text-xs font-bold shadow-lg">
                      {activeOrdersCount}
                    </Badge>
                  )}
                </Button>
              )}
              {/* Addition : visible dès qu'une commande a été envoyée, et après le paiement pour garder son reçu */}
              {canOpenBill && (
                <Button
                  variant="outline"
                  size="icon"
                  className={iconButtonClass}
                  onClick={() => setCurrentView("bill")}
                  title={t("client.menu.viewBill")}
                >
                  <Receipt className="h-5 w-5 group-hover:rotate-12 transition-transform duration-300" />
                </Button>
              )}
              <Button
                variant="outline"
                size="icon"
                className={iconButtonClass}
                onClick={() => setCurrentView("complaint")}
                title={t("client.menu.complaint")}
              >
                <MessageSquare className="h-5 w-5 group-hover:rotate-12 transition-transform duration-300" />
              </Button>
            </div>
          </div>
        </div>

        {/* Visite terminée : remerciement et reçu à garder */}
        {visitEnded && (
          <div className="m-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <PartyPopper className="h-6 w-6 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-amber-900">{t("client.scan.thanksTitle")}</p>
              <p className="text-sm text-amber-800">{t("client.scan.thanksText")}</p>
            </div>
            <Button size="sm" onClick={() => setCurrentView("bill")} className="shrink-0 bg-gradient-to-r from-primary to-restaurant-warm text-white">
              {t("client.notify.saveReceipt")}
            </Button>
          </div>
        )}

        {/* Order Statuses - Display all confirmed orders with their statuses */}
        {Object.keys(orderStatuses).length > 0 && (
          <div className="space-y-4 m-4">
            {Object.entries(orderStatuses).map(([orderId, status]) => (
              <div
                key={orderId}
                className={`p-4 border-s-4 cursor-pointer transition-all duration-300 hover:shadow-md hover:scale-[1.02] ${
                  status === "pending" ? "bg-orange-50 border-orange-400" :
                  status === "preparing" ? "bg-blue-50 border-blue-400" :
                  "bg-green-50 border-green-400"
                }`}
                onClick={() => setCurrentView("orders")}
                title={t("client.menu.viewMyOrders")}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    status === "pending" ? "bg-orange-100 text-orange-600" :
                    status === "preparing" ? "bg-blue-100 text-blue-600" :
                    "bg-green-100 text-green-600"
                  }`}>
                    {status === "pending" && <AlertCircle className="h-4 w-4" />}
                    {status === "preparing" && <Clock className="h-4 w-4" />}
                    {status === "ready" && <CheckCircle className="h-4 w-4" />}
                  </div>
                  <div className="flex-1">
                    <p className={`font-semibold ${
                      status === "pending" ? "text-orange-700" :
                      status === "preparing" ? "text-blue-700" :
                      "text-green-700"
                    }`}>
                      {t(`client.menu.order_${status}`)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t(`client.menu.order_${status}_text`)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2 italic">
                      💡 {t("client.menu.tapOrders")}
                    </p>
                  </div>
                  {(status === "preparing" || status === "ready") && (
                    <div className="text-muted-foreground">
                      <Receipt className="h-5 w-5" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Panier non envoyé : barre fixe en bas de l'écran, la commande ne part qu'après validation */}
        {cart.length > 0 && (
          <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 pointer-events-none">
            <button
              onClick={() => setCurrentView("cart")}
              className="pointer-events-auto mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl bg-gray-900 p-2.5 ps-3 text-start text-white shadow-2xl ring-1 ring-black/10 transition-transform active:scale-[0.98]"
            >
              <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10">
                <ShoppingCart className="h-5 w-5" />
                <span className="absolute -end-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold">
                  {cartCount}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold leading-tight">
                  {money(cart.reduce((sum, item) => sum + item.price * item.quantity, 0), currency)}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-white/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  {t("client.menu.orderNotSent")}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 rounded-xl bg-gradient-to-r from-primary to-restaurant-warm px-4 py-2.5 text-sm font-bold">
                {t("client.menu.send")}
                <ChevronRight className="h-4 w-4 rtl:rotate-180" />
              </span>
            </button>
          </div>
        )}

        <div className="container mx-auto px-4 py-6 pb-32">
          {/* Category Filter */}
          {categories.length > 0 && (
            <div className="flex gap-3 mb-6 overflow-x-auto pb-2">
              {[ALL_CATEGORIES, ...categories].map((category) => (
                <Button
                  key={category}
                  variant={selectedCategory === category ? "default" : "outline"}
                  onClick={() => setSelectedCategory(category)}
                  className={`whitespace-nowrap px-6 py-3 rounded-xl font-medium transition-all duration-300 transform hover:scale-105 ${
                    selectedCategory === category
                      ? "bg-gradient-to-r from-primary to-restaurant-warm text-white shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40"
                      : "bg-white/80 backdrop-blur-sm border-2 border-gray-200 text-gray-700 hover:bg-white hover:border-primary/30 hover:text-primary hover:shadow-md"
                  }`}
                >
                  {category === ALL_CATEGORIES ? t("common.all") : category}
                </Button>
              ))}
            </div>
          )}

          {menuItems.length === 0 && (
            <div className="py-16 text-center text-muted-foreground">
              <p>{t("client.menu.empty")}</p>
            </div>
          )}

          {/* Menu Items Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {filteredItems.map((item) => (
              <Card
                key={item.id}
                className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 bg-card/80 backdrop-blur-sm border-border/50 cursor-pointer"
                onClick={() => openDishModal(item)}
              >
                <div className="aspect-video overflow-hidden rounded-t-lg">
                  <img
                    src={item.image || PLACEHOLDER_IMAGE}
                    alt={item.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      if (!target.src.endsWith(PLACEHOLDER_IMAGE)) target.src = PLACEHOLDER_IMAGE;
                    }}
                  />
                </div>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start gap-2">
                    <CardTitle className="text-lg">{item.name}</CardTitle>
                    <Badge variant="secondary" className="bg-restaurant-gold/20 text-restaurant-dark whitespace-nowrap">
                      {money(item.price, currency ?? item.currency)}
                    </Badge>
                  </div>
                  {item.description && <CardDescription className="text-sm">{item.description}</CardDescription>}
                </CardHeader>
                <CardContent className="pt-0">
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      openDishModal(item);
                    }}
                    className="w-full bg-gradient-to-r from-primary to-restaurant-warm hover:from-primary/90 hover:to-restaurant-warm/90 text-white font-medium py-3 rounded-xl shadow-lg hover:shadow-xl hover:shadow-primary/30 transform hover:scale-105 transition-all duration-300 group"
                  >
                    <Eye className="h-4 w-4 me-2 group-hover:scale-110 transition-transform duration-300" />
                    {t("client.menu.viewDetails")}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Dish Modal */}
      <DishModal
        dish={selectedDish}
        isOpen={isDishModalOpen}
        onClose={() => setIsDishModalOpen(false)}
        onAddToCart={addToCartFromModal}
        currency={currency}
      />

      {/* Success Message Animation */}
      {showSuccessMessage && successItem && (
        <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white p-6 rounded-2xl shadow-2xl transform animate-in slide-in-from-bottom-4 zoom-in-95 duration-500 pointer-events-auto">
            <div className="flex items-center gap-4">
              <div className="bg-white/20 p-3 rounded-full">
                <ShoppingCart className="h-8 w-8 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold mb-1">🎉 {t("client.menu.addedTitle")}</h3>
                <p className="text-green-100">
                  {t("client.menu.addedText", { name: successItem.name, quantity: successItem.quantity })}
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-center">
              <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce mx-1"></div>
              <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce mx-1" style={{animationDelay: '0.1s'}}></div>
              <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce mx-1" style={{animationDelay: '0.2s'}}></div>
            </div>
          </div>
        </div>
      )}

      {/* Order Status Notifications */}
      {notificationLayer}
    </>
  );
};

export default RestaurantMenu;
