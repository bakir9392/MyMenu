import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '../../../shared/i18n';

interface ImageCarouselProps {
  images: string[];
  alt: string;
  className?: string;
}

export function ImageCarousel({
  images,
  alt,
  className
}: ImageCarouselProps) {
  const { t, isRtl } = useI18n();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageErrors, setImageErrors] = useState<Set<number>>(new Set());

  // Filtre les images qui n'ont pas pu être chargées
  const validImages = (images || []).filter((_, index) => !imageErrors.has(index));

  if (validImages.length === 0) {
    return (
      <div className={cn("aspect-video w-full bg-muted rounded-lg flex flex-col items-center justify-center gap-2 text-muted-foreground", className)}>
        <ImageOff className="w-10 h-10 opacity-60" />
        <span className="text-sm">{t("admin.noImage")}</span>
      </div>
    );
  }

  const validCurrentIndex = Math.min(currentIndex, validImages.length - 1);

  const handleImageError = (index: number) => {
    setImageErrors(prev => new Set([...prev, index]));
  };

  const nextImage = () => setCurrentIndex((prev) => (prev + 1) % validImages.length);
  const prevImage = () => setCurrentIndex((prev) => (prev - 1 + validImages.length) % validImages.length);

  // En lecture de droite à gauche, la flèche « précédent » est à droite
  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div className={cn("relative group", className)}>
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-muted">
        <img
          src={validImages[validCurrentIndex]}
          alt={`${alt} ${validCurrentIndex + 1}`}
          className="w-full h-full object-cover transition-transform duration-300"
          onError={() => handleImageError(images.indexOf(validImages[validCurrentIndex]))}
        />
      </div>

      {validImages.length > 1 && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={prevImage}
            aria-label={t("admin.previousImage")}
            className="absolute start-2 top-1/2 -translate-y-1/2 bg-black/50 text-white hover:bg-black/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          >
            <PrevIcon className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={nextImage}
            aria-label={t("admin.nextImage")}
            className="absolute end-2 top-1/2 -translate-y-1/2 bg-black/50 text-white hover:bg-black/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          >
            <NextIcon className="w-4 h-4" />
          </Button>

          <div className="absolute bottom-2 end-2 bg-black/50 text-white text-xs px-2 py-1 rounded" dir="ltr">
            {validCurrentIndex + 1} / {validImages.length}
          </div>

          <div className="absolute bottom-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 flex gap-1">
            {validImages.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setCurrentIndex(index)}
                aria-label={t("admin.goToImage", { number: index + 1 })}
                className={cn(
                  "w-2 h-2 rounded-full transition-colors",
                  index === validCurrentIndex ? "bg-foreground" : "bg-foreground/50 hover:bg-foreground/75"
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
