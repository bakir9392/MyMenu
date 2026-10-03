import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ShoppingCart, Plus, Minus, Receipt, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CartItem } from "./RestaurantMenu";
import { breakdownLines, computeBill, includedTaxNote, RestaurantSettings } from "@/lib/bill";
import { useI18n } from "@/lib/i18n";
import PageHeader from "./PageHeader";

interface CartPageProps {
  cart: CartItem[];
  onBack: () => void;
  onUpdateCart: (newCart: CartItem[]) => void;
  /** Envoie la commande avec la note du client ; résout true si elle est acceptée */
  onSubmitOrder: (note: string) => Promise<boolean | void> | void;
  orderStatuses: {[orderId: string]: "pending" | "preparing" | "ready"};
  /** Table de la session (QR code scanné), null si le client n'a pas scanné */
  tableNumber?: string | null;
  /** Paramètres du restaurant (TVA, frais de table, devise) */
  settings?: RestaurantSettings | null;
}

const CartPage = ({ cart, onBack, onUpdateCart, onSubmitOrder, tableNumber, settings = null }: CartPageProps) => {
  const [cartNotes, setCartNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { t, money } = useI18n();
  // La devise vient toujours des paramètres du restaurant (à défaut, de celle des plats du panier)
  const currency = settings?.currency ?? cart[0]?.currency;
  const m = (amount: number) => money(amount, currency);

  // La table vient de la session (QR code) : la commande part directement, sans saisie
  const handleSubmitOrder = async () => {
    if (cart.length === 0 || isSubmitting) {
      return;
    }
    if (!tableNumber) {
      toast({
        title: t("client.toast.scanTitle"),
        description: t("client.toast.scanOrder"),
        variant: "destructive"
      });
      return;
    }
    setIsSubmitting(true);
    try {
      const accepted = await onSubmitOrder(cartNotes.trim());
      if (accepted) setCartNotes("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const removeFromCart = (itemIndex: number) => {
    const item = cart[itemIndex];

    if (item.quantity > 1) {
      const newCart = cart.map((cartItem, index) =>
        index === itemIndex
          ? { ...cartItem, quantity: cartItem.quantity - 1 }
          : cartItem
      );
      onUpdateCart(newCart);
    } else {
      const newCart = cart.filter((_, index) => index !== itemIndex);
      onUpdateCart(newCart);
    }
  };

  const addToCart = (itemIndex: number) => {
    const newCart = cart.map((cartItem, index) =>
      index === itemIndex
        ? { ...cartItem, quantity: cartItem.quantity + 1 }
        : cartItem
    );
    onUpdateCart(newCart);
  };

  const removeItemCompletely = (itemIndex: number) => {
    const newCart = cart.filter((_, index) => index !== itemIndex);
    onUpdateCart(newCart);
  };

  const getTotal = () => {
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
  };

  const getItemCount = () => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  };

  if (cart.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-restaurant-cream to-background">
        <PageHeader title={t("client.cart.title")} subtitle={t("client.cart.subtitle")} onBack={onBack} />

        <div className="container mx-auto px-4 py-12">
          <Card className="bg-card/95 backdrop-blur-sm max-w-md mx-auto">
            <CardContent className="text-center py-12">
              <ShoppingCart className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold text-muted-foreground mb-2">{t("client.cart.emptyTitle")}</h2>
              <p className="text-muted-foreground mb-6">{t("client.cart.emptyText")}</p>
              <Button
                onClick={onBack}
                className="bg-gradient-to-r from-primary to-restaurant-warm hover:from-primary/90 hover:to-restaurant-warm/90 text-white font-medium px-6 py-3 rounded-xl"
              >
                {t("client.cart.browse")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const bill = computeBill(getTotal(), settings);
  const lines = breakdownLines(bill, t);
  const taxNote = includedTaxNote(bill, t, m);
  const itemsLabel = t("client.items", { count: getItemCount() });

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-restaurant-cream to-background">
      <PageHeader title={t("client.cart.title")} subtitle={`${itemsLabel} • ${m(getTotal())}`} onBack={onBack} />

      <div className="container mx-auto px-4 py-6">
        {/* Cart Items */}
        <div className="space-y-4 mb-6">
          {cart.map((item, index) => (
            <Card key={`${item.id}-${index}`} className="bg-card/95 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Item Image */}
                  <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0">
                    <img
                      src={item.image || '/placeholder.svg'}
                      alt={item.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = '/placeholder.svg';
                      }}
                    />
                  </div>

                  {/* Item Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-semibold text-lg truncate">{item.name}</h3>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItemCompletely(index)}
                        className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                        aria-label={t("common.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {item.notes && (
                      <p className="text-sm text-muted-foreground italic mb-2">
                        {t("client.cart.itemNote", { note: item.notes })}
                      </p>
                    )}

                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => removeFromCart(index)}
                          className="h-8 w-8 bg-red-50 border-red-200 text-red-600 hover:bg-red-100 hover:border-red-300 hover:text-red-700 transition-all duration-200 hover:scale-110 rounded-lg"
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-semibold text-gray-700">{item.quantity}</span>
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => addToCart(index)}
                          className="h-8 w-8 bg-green-50 border-green-200 text-green-600 hover:bg-green-100 hover:border-green-300 hover:text-green-700 transition-all duration-200 hover:scale-110 rounded-lg"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>

                      <div className="text-end">
                        <p className="text-sm text-muted-foreground">
                          {m(item.price)} × {item.quantity}
                        </p>
                        <p className="font-semibold text-lg">
                          {m(item.price * item.quantity)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Order Summary */}
        <Card className="bg-card/95 backdrop-blur-sm mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              {t("client.cart.summary")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Order Notes */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("client.cart.notesLabel")}</label>
              <Textarea
                placeholder={t("client.cart.notesPlaceholder")}
                value={cartNotes}
                onChange={(e) => setCartNotes(e.target.value.slice(0, 500))}
                className="min-h-[80px]"
              />
            </div>

            {/* Total */}
            <div className="flex justify-between items-center pt-4 border-t font-bold text-xl">
              <span>{t("client.cart.total")}</span>
              <span className="text-primary">{m(getTotal())}</span>
            </div>
            {/* Frais de table / service et TVA selon les paramètres du restaurant */}
            {lines.length === 0 ? (
              taxNote && <p className="text-xs text-muted-foreground text-end -mt-2">{taxNote}</p>
            ) : (
              <div className="space-y-1 -mt-2 text-sm text-muted-foreground">
                {lines.slice(1).map((line) => (
                  <div key={line.label} className="flex justify-between"><span>{line.label}</span><span>{m(line.amount)}</span></div>
                ))}
                <div className="flex justify-between font-semibold text-foreground"><span>{t("client.cart.totalToPay")}</span><span>{m(bill.total)}</span></div>
              </div>
            )}

            {/* Submit Button */}
            <Button
              onClick={handleSubmitOrder}
              disabled={cart.length === 0 || isSubmitting}
              className="w-full bg-gradient-to-r from-primary to-restaurant-warm hover:from-primary/90 hover:to-restaurant-warm/90 text-white font-bold py-4 rounded-xl shadow-lg hover:shadow-xl hover:shadow-primary/30 transform hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none btn-glow"
            >
              <Receipt className="h-5 w-5 me-2" />
              {isSubmitting
                ? t("client.cart.sending")
                : tableNumber
                  ? t("client.cart.sendTable", { table: tableNumber, items: itemsLabel })
                  : t("client.cart.send", { items: itemsLabel })}
            </Button>
          </CardContent>
        </Card>
      </div>

    </div>
  );
};

export default CartPage;
