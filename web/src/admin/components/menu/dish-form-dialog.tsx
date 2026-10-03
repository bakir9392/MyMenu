import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useShop } from "@/hooks/use-shop";
import { compressImage } from "@/lib/compress-image";
import { ORDER_SERVER_URL } from "@/lib/order-server";
import { CURRENCY_CODES, type Currency } from "@/lib/bill";
import type { Dish } from "./dishes";

// Formulaire d'ajout / de modification d'un plat : le même que celui de la caisse (catégorie existante ou nouvelle,
// photo, disponibilité, devise du restaurant). Textes : DISH_FORM_DICTIONARY (src/shared/i18n/menu-form.ts).


interface FormState {
  name: string;
  description: string;
  price: string;
  category: string;
  available: boolean;
  image: string;
  currency: Currency;
}

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

interface DishFormDialogProps {
  open: boolean;
  /** Plat à modifier ; null pour en ajouter un */
  dish: Dish | null;
  /** Catégories déjà utilisées par le menu */
  categories: string[];
  onClose: () => void;
  /** Appelé après l'enregistrement ; currencyChanged : la devise de tout le restaurant a changé */
  onSaved: (currencyChanged: boolean) => void;
}

export function DishFormDialog({ open, dish, categories, onClose, onSaved }: DishFormDialogProps) {
  const { toast } = useToast();
  const { i18n, currency } = useShop();
  const { t } = i18n;
  const restaurantCurrency: Currency = currency ?? "EUR";
  const isEdit = dish !== null;

  const [form, setForm] = useState<FormState>({ name: "", description: "", price: "", category: "", available: true, image: "", currency: restaurantCurrency });
  const [saving, setSaving] = useState(false);
  const [confirmCurrency, setConfirmCurrency] = useState(false);

  // Le formulaire se remplit à l'ouverture : plat existant ou formulaire vide avec la devise du restaurant
  useEffect(() => {
    if (!open) return;
    setConfirmCurrency(false);
    setForm(dish
      ? {
        name: dish.name,
        description: dish.description ?? "",
        price: String(Number(dish.price)),
        category: dish.category ?? "",
        available: dish.is_available,
        image: dish.images?.[0] ?? "",
        currency: restaurantCurrency,
      }
      : { name: "", description: "", price: "", category: "", available: true, image: "", currency: restaurantCurrency });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dish]);

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const handleImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      // Photo réduite avant l'envoi ; le serveur l'enregistre en fichier et ne garde que son lien
      update({ image: await fileToDataUrl(await compressImage(file)) });
    } catch {
      toast({ title: t("common.error"), description: t("dishForm.imageFailed"), variant: "destructive" });
    }
  };

  const isValid = () => !!form.name.trim() && !!form.description.trim() && !!form.category.trim() && parseFloat(form.price) > 0;

  const save = async () => {
    const currencyChanged = form.currency !== restaurantCurrency;
    setConfirmCurrency(false);
    setSaving(true);
    try {
      const response = await fetch(
        isEdit ? `${ORDER_SERVER_URL}/api/menu-items/update/${dish!.id}` : `${ORDER_SERVER_URL}/api/menu-items/add`,
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim(),
            price: parseFloat(form.price),
            category: form.category.trim(),
            image_url: form.image || "",
            available: form.available,
            currency: form.currency,
          }),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast({
          title: t("common.error"),
          description: body?.error ? t("dishForm.error", { message: body.error }) : t(isEdit ? "dishForm.updateFailed" : "dishForm.addFailed"),
          variant: "destructive",
        });
        return;
      }
      toast({ title: t(isEdit ? "dishForm.updated" : "dishForm.added") });
      onSaved(currencyChanged);
      onClose();
    } catch {
      toast({ title: t("common.error"), description: t(isEdit ? "dishForm.updateFailed" : "dishForm.addFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    if (!isValid()) {
      toast({ title: t("common.error"), description: t("dishForm.required"), variant: "destructive" });
      return;
    }
    // Changer de devise touche tout le restaurant : on demande confirmation
    if (form.currency !== restaurantCurrency) setConfirmCurrency(true);
    else save();
  };

  const isNewCategory = !!form.category && !categories.includes(form.category);
  const idPrefix = isEdit ? "edit" : "add";

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-w-md max-h-[90vh] w-[95vw] sm:w-auto overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{t(isEdit ? "dishForm.editTitle" : "dishForm.addTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 overflow-y-auto max-h-[calc(90vh-120px)] pe-2 pb-4">
            <Input placeholder={t("dishForm.name")} value={form.name} onChange={(e) => update({ name: e.target.value })} />
            <Textarea placeholder={t("dishForm.description")} value={form.description} onChange={(e) => update({ description: e.target.value })} />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("dishForm.price")}</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  placeholder={t("dishForm.pricePlaceholder", { currency: form.currency })}
                  value={form.price}
                  onChange={(e) => update({ price: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("common.currency")}</label>
                <Select value={form.currency} onValueChange={(value) => update({ currency: value as Currency })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_CODES.map((code) => (
                      <SelectItem key={code} value={code}>{t(`common.currency${code}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className={`text-xs ${form.currency !== restaurantCurrency ? "text-warning font-medium" : "text-muted-foreground"}`}>
              {t("dishForm.currencyHint")}
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("dishForm.category")}</label>
              <div className="flex gap-2">
                <Select value={form.category} onValueChange={(value) => update({ category: value })}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t("dishForm.selectCategory")} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder={t("dishForm.newCategory")}
                  value={form.category}
                  onChange={(e) => update({ category: e.target.value })}
                  className={`flex-1 ${isNewCategory ? "border-green-500" : ""}`}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t("dishForm.categoryHint")}</p>
              {isNewCategory && (
                <div className="flex items-center gap-2 text-xs text-green-600">
                  <div className="w-2 h-2 bg-green-500 rounded-full" />
                  {t("dishForm.newCategoryNote", { name: form.category })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("dishForm.image")}</label>
              {form.image ? (
                <div className="relative">
                  <img src={form.image} alt={t("dishForm.imagePreview")} className="w-full h-32 object-cover rounded-md" />
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => update({ image: "" })}
                    aria-label={t("common.delete")}
                    className="absolute top-2 end-2 h-6 w-6 p-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="border-2 border-dashed border-border rounded-md p-4 text-center">
                  <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground mb-2">{t("dishForm.imageUpload")}</p>
                  <input type="file" accept="image/*" onChange={handleImage} className="hidden" id={`${idPrefix}-image-upload`} />
                  <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById(`${idPrefix}-image-upload`)?.click()}>
                    {t("dishForm.imageChoose")}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`${idPrefix}-available`}
                checked={form.available}
                onChange={(e) => update({ available: e.target.checked })}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <label htmlFor={`${idPrefix}-available`} className="text-sm font-medium">{t("dishForm.availableToOrder")}</label>
            </div>

            <div className="flex gap-2 pt-4 border-t sticky bottom-0 bg-background">
              <Button variant="outline" onClick={onClose} className="flex-1">{t("common.cancel")}</Button>
              <Button onClick={submit} disabled={saving} className="flex-1">{isEdit ? t("common.save") : t("dishForm.add")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation avant de changer la devise de tout le restaurant */}
      <AlertDialog open={confirmCurrency} onOpenChange={setConfirmCurrency}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dishForm.currencyChangeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("dishForm.currencyChangeBody", { from: restaurantCurrency, to: form.currency })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={save}>{t("dishForm.currencyChangeConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
