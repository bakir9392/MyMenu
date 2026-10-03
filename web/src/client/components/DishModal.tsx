import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Minus, ShoppingCart, ChevronLeft, ChevronRight, Play, Pause } from "lucide-react";
import { MenuItem } from "./RestaurantMenu";
import { useI18n } from "@/lib/i18n";

interface DishModalProps {
  dish: MenuItem | null;
  isOpen: boolean;
  onClose: () => void;
  onAddToCart: (dish: MenuItem, quantity: number) => void;
  /** Devise du restaurant (paramètres) ; à défaut celle du plat */
  currency?: string | null;
}

// Image Slider Component for DishModal
const ImageSlider = ({ images, alt, className = "" }: { images: string[], alt: string, className?: string }) => {
  const { t } = useI18n();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  // Reset currentIndex when images change
  useEffect(() => {
    setCurrentIndex(0);
    setIsAutoPlaying(true);
  }, [images]);

  // Ensure currentIndex is always valid
  useEffect(() => {
    if (currentIndex >= images.length) setCurrentIndex(0);
  }, [currentIndex, images.length]);

  // Auto-play functionality
  useEffect(() => {
    if (!isAutoPlaying || images.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        const next = (prev + 1) % images.length;
        // Stop auto-play when we reach the last image
        if (next === 0) setIsAutoPlaying(false);
        return next;
      });
    }, 3000); // Change image every 3 seconds

    return () => clearInterval(interval);
  }, [isAutoPlaying, images.length]);

  if (!images || images.length === 0) return null;
  if (images.length === 1) {
    return (
      <img
        src={images[0]}
        alt={alt}
        className={className}
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
        }}
      />
    );
  }

  const nextImage = () => {
    setIsAutoPlaying(false); // Stop auto-play when user manually navigates
    setCurrentIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = () => {
    setIsAutoPlaying(false);
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  return (
    <div className="relative group" dir="ltr">
      <img
        src={images[currentIndex]}
        alt={alt}
        className={className}
        onError={(e) => {
          const target = e.target as HTMLImageElement;
          target.style.display = 'none';
        }}
      />

      {/* Navigation arrows (le diaporama garde toujours le sens gauche-droite) */}
      <button
        onClick={prevImage}
        className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={t("client.dish.prevImage")}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <button
        onClick={nextImage}
        className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={t("client.dish.nextImage")}
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {/* Image indicators */}
      <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex space-x-1">
        {images.map((_, index) => (
          <button
            key={index}
            onClick={() => {
              setIsAutoPlaying(false);
              setCurrentIndex(index);
            }}
            className={`w-2 h-2 rounded-full transition-colors ${
              index === currentIndex ? 'bg-white' : 'bg-white/50'
            }`}
            aria-label={t("client.dish.goToImage", { number: index + 1 })}
          />
        ))}
      </div>

      {/* Image counter */}
      <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
        {currentIndex + 1} / {images.length}
      </div>

      {/* Play/Pause button */}
      <button
        onClick={() => setIsAutoPlaying(!isAutoPlaying)}
        className="absolute top-2 left-2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label={isAutoPlaying ? t("client.dish.pause") : t("client.dish.play")}
      >
        {isAutoPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
    </div>
  );
};

const DishModal = ({ dish, isOpen, onClose, onAddToCart, currency = null }: DishModalProps) => {
  const { t, money } = useI18n();
  const [quantity, setQuantity] = useState(1);

  // Don't render if no dish or modal is not open
  if (!dish || !isOpen) return null;

  const m = (amount: number) => money(amount, currency ?? dish.currency);
  const images = dish.images && dish.images.length > 0 ? dish.images : dish.image ? [dish.image] : [];

  const handleAddToCart = () => {
    onAddToCart(dish, quantity);
    setQuantity(1);
    onClose();
  };

  const increaseQuantity = () => setQuantity(q => q + 1);
  const decreaseQuantity = () => setQuantity(q => Math.max(1, q - 1));

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto dialog-content">
        <DialogHeader>
          <DialogTitle className="text-xl text-start">{dish.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pb-4">
          {/* Image */}
          <div className="aspect-video overflow-hidden rounded-lg bg-gray-100">
            {images.length > 0 ? (
              <ImageSlider
                images={images}
                alt={dish.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <div className="text-4xl mb-2">🍽️</div>
                  <p className="text-sm">{t("client.dish.noImage")}</p>
                </div>
              </div>
            )}
          </div>

          {/* Description and Price */}
          <div className="space-y-2">
            {dish.description && <p className="text-muted-foreground">{dish.description}</p>}
            <div className="flex justify-between items-center">
              <Badge variant="secondary" className="bg-restaurant-gold/20 text-restaurant-dark text-lg px-3 py-1">
                {m(dish.price)}
              </Badge>
              {dish.category && <Badge variant="outline">{dish.category}</Badge>}
            </div>
          </div>

          {/* Quantity Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("client.dish.quantity")}</label>
            <div className="flex items-center gap-3">
              <Button
                size="icon"
                variant="outline"
                onClick={decreaseQuantity}
                className="h-10 w-10"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="text-xl font-medium w-12 text-center">{quantity}</span>
              <Button
                size="icon"
                variant="outline"
                onClick={increaseQuantity}
                className="h-10 w-10"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Total and Add Button */}
          <div className="space-y-3 pt-2 border-t">
            <div className="flex justify-between items-center">
              <span className="font-medium">{t("client.cart.total")}</span>
              <span className="text-xl font-bold text-primary">
                {m(dish.price * quantity)}
              </span>
            </div>

            <Button
              onClick={handleAddToCart}
              className="w-full bg-gradient-to-r from-primary to-restaurant-warm hover:from-primary/90 hover:to-restaurant-warm/90 text-white font-medium h-12"
            >
              <ShoppingCart className="h-5 w-5 me-2" />
              {t("client.dish.addToCart", { quantity })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DishModal;
