import { useState, useEffect, useMemo } from "react";
import { compressImageToDataUrl } from "@/lib/compress-image";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit, Trash2, Search, Upload, Image as ImageIcon, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { useRestaurant } from "@/hooks/useRestaurant";
import { useSocket } from "@/hooks/useSocket";
import { ORDER_SERVER_URL } from "@/lib/order-server";
import { useI18n } from "../../shared/i18n";
import { CURRENCY_CODES, type Currency } from "../../shared/bill";

// Menu du restaurant : plats, catégories, photos et devise (une devise par restaurant)

interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number | string;
  category: string;
  available: boolean;
  image?: string;
  image_url?: string;
}

interface FormData {
  name: string;
  description: string;
  price: string;
  category: string;
  available: boolean;
  image: string;
  currency: Currency;
}


const toNumber = (price: number | string): number =>
  typeof price === "number" ? price : parseFloat(price || "0") || 0;

const API_BASE = `${ORDER_SERVER_URL}/api`;

export const MenuManagement = () => {
  const { t } = useI18n();
  const { fmt, currency } = useRestaurant();
  const { refreshSettings } = useSocket();

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [serverCategories, setServerCategories] = useState<string[]>([]);
  const [formMode, setFormMode] = useState<"add" | "edit" | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [pendingCurrencySave, setPendingCurrencySave] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(false);

  const emptyForm = (): FormData => ({
    name: "",
    description: "",
    price: "",
    category: "",
    available: true,
    image: "",
    // la devise proposée est celle du restaurant
    currency,
  });
  const [formData, setFormData] = useState<FormData>(emptyForm);

  const categories = useMemo(
    () => Array.from(new Set([...serverCategories, ...menuItems.map((item) => item.category)].filter(Boolean))),
    [serverCategories, menuItems]
  );

  // Message d'erreur du serveur s'il y en a un, sinon le message générique donné
  const failureMessage = async (response: Response, fallback: string) => {
    const body = await response.json().catch(() => null);
    return body?.error ? t("caisse.error", { message: body.error }) : fallback;
  };

  const loadMenuItems = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/menu-items/all`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const menuData = data.data || data;

      setMenuItems(menuData.map((item: any) => ({
        ...item,
        price: toNumber(item.price),
        id: item.id?.toString() || item.id,
        // image et image_url désignent la même photo
        image: item.image || item.image_url || "",
        image_url: item.image || item.image_url || "",
      })));
    } catch {
      toast.error(t("caisse.menu.loadFailed"));
      setMenuItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await fetch(`${API_BASE}/menu-items/categories/all`);
      if (!response.ok) return;
      const data = await response.json();
      setServerCategories((data.data || []).map((cat: any) => cat.category));
    } catch {
      // les catégories se déduisent aussi des plats
    }
  };

  useEffect(() => {
    loadMenuItems();
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    // Photo réduite avant l'envoi ; le serveur l'enregistre en fichier et ne garde que son lien
    compressImageToDataUrl(file)
      .then((result) => setFormData((prev) => ({ ...prev, image: result })))
      .catch(() => toast.error(t("caisse.menu.imageFailed")));
  };

  const removeImage = () => setFormData((prev) => ({ ...prev, image: "" }));

  const closeForm = () => {
    setFormMode(null);
    setEditingItem(null);
    setPendingCurrencySave(false);
  };

  const openAddModal = () => {
    setEditingItem(null);
    setFormData(emptyForm());
    setFormMode("add");
  };

  const openEditModal = (item: MenuItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      description: item.description,
      price: toNumber(item.price).toString(),
      category: item.category,
      available: item.available,
      image: item.image || item.image_url || "",
      currency,
    });
    setFormMode("edit");
  };

  const isFormValid = () =>
    !!formData.name.trim() && !!formData.description.trim() && !!formData.category.trim() && parseFloat(formData.price) > 0;

  // Enregistre le plat (ajout ou modification) ; la devise choisie est envoyée avec le plat
  const saveItem = async () => {
    const isEdit = formMode === "edit" && !!editingItem;
    const currencyChanged = formData.currency !== currency;
    setPendingCurrencySave(false);

    try {
      setIsLoading(true);
      const response = await fetch(
        isEdit ? `${API_BASE}/menu-items/update/${editingItem!.id}` : `${API_BASE}/menu-items/add`,
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.name.trim(),
            description: formData.description.trim(),
            price: parseFloat(formData.price),
            category: formData.category.trim(),
            image_url: formData.image || "",
            available: formData.available,
            currency: formData.currency,
          }),
        }
      );

      if (!response.ok) {
        toast.error(await failureMessage(response, t(isEdit ? "caisse.menu.updateFailed" : "caisse.menu.addFailed")));
        return;
      }

      const data = await response.json();
      const saved = data.data || data;
      const savedItem: MenuItem = isEdit
        ? { ...saved, image: formData.image || saved.image || saved.image_url || "", image_url: formData.image || saved.image_url || "" }
        : saved;
      setMenuItems((prev) => (isEdit ? prev.map((item) => (item.id === editingItem!.id ? savedItem : item)) : [...prev, savedItem]));
      toast.success(t(isEdit ? "caisse.menu.updated" : "caisse.menu.added"));
      closeForm();

      // La devise est celle de tout le restaurant : le serveur l'a changée pour tous les plats et toutes les additions
      if (currencyChanged) {
        refreshSettings();
        loadMenuItems();
      }
      loadCategories();
    } catch {
      toast.error(t(isEdit ? "caisse.menu.updateFailed" : "caisse.menu.addFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = () => {
    if (!isFormValid()) {
      toast.error(t("caisse.menu.required"));
      return;
    }
    // Changer de devise touche tout le restaurant : on demande confirmation
    if (formData.currency !== currency) {
      setPendingCurrencySave(true);
      return;
    }
    saveItem();
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm(t("caisse.menu.deleteConfirm"))) return;

    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE}/menu-items/delete/${id}`, { method: "DELETE" });
      if (response.ok) {
        setMenuItems((prev) => prev.filter((item) => item.id !== id));
        toast.success(t("caisse.menu.deleted"));
      } else {
        toast.error(await failureMessage(response, t("caisse.menu.deleteFailed")));
      }
    } catch {
      toast.error(t("caisse.menu.deleteFailed"));
    } finally {
      setIsLoading(false);
    }
  };

  const filteredItems = menuItems.filter((item) => {
    const search = searchTerm.toLowerCase();
    const matchesSearch = item.name.toLowerCase().includes(search) || (item.description || "").toLowerCase().includes(search);
    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const isNewCategory = !!formData.category && !categories.includes(formData.category);
  const idPrefix = formMode === "edit" ? "edit" : "add";

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <PageHeader />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">{t("caisse.menu.title")}</h1>
        <Button onClick={openAddModal} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          {t("caisse.menu.addItem")}
        </Button>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("caisse.menu.search")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="ps-10"
            />
          </div>
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t("caisse.menu.category")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("caisse.menu.allCategories")}</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category} value={category}>{category}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Menu Items Grid */}
      {isLoading && menuItems.length === 0 ? (
        <div className="text-center py-8">
          <p>{t("caisse.menu.loading")}</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-8">
          <div className="space-y-4">
            <ImageIcon className="h-16 w-16 text-gray-400 mx-auto" />
            <h3 className="text-lg font-medium text-gray-900">{t("caisse.menu.noItems")}</h3>
            <p className="text-gray-500">
              {searchTerm || selectedCategory !== "all"
                ? t("caisse.menu.noMatch")
                : t("caisse.menu.emptyMenu")
              }
            </p>
            {!searchTerm && selectedCategory === "all" && (
              <Button onClick={openAddModal} className="flex items-center gap-2 mx-auto">
                <Plus className="h-4 w-4" />
                {t("caisse.menu.addFirst")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredItems.map((item) => (
            <Card key={item.id} className="overflow-hidden">
              {/* Image Section */}
              <div className="relative h-48 bg-gray-100">
                {(item.image || item.image_url) ? (
                  <img
                    src={item.image || item.image_url}
                    alt={item.name}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      // Fallback to icon if image fails to load
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      target.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                ) : null}
                <div className={`w-full h-full flex items-center justify-center ${(item.image || item.image_url) ? 'hidden' : ''}`}>
                  <ImageIcon className="h-16 w-16 text-gray-400" />
                </div>
                <Badge
                  variant={item.available ? "default" : "secondary"}
                  className="absolute top-2 end-2"
                >
                  {item.available ? t("caisse.menu.available") : t("caisse.menu.unavailable")}
                </Badge>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">{item.name}</h3>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold text-primary">
                    {fmt(toNumber(item.price))}
                  </span>
                  <Badge variant="outline">{item.category}</Badge>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEditModal(item)}
                    className="flex-1"
                  >
                    <Edit className="h-4 w-4 me-2" />
                    {t("common.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDeleteItem(item.id)}
                    aria-label={t("common.delete")}
                    title={t("common.delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Formulaire d'ajout / de modification d'un plat */}
      <Dialog open={formMode !== null} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="max-w-md max-h-[90vh] w-[95vw] sm:w-auto overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{formMode === "edit" ? t("caisse.menu.editTitle") : t("caisse.menu.addTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 overflow-y-auto max-h-[calc(90vh-120px)] pe-2 pb-4">
            <Input
              placeholder={t("caisse.menu.name")}
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            />
            <Textarea
              placeholder={t("caisse.menu.description")}
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
            />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("caisse.menu.price")}</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  placeholder={t("caisse.menu.pricePlaceholder", { currency: formData.currency })}
                  value={formData.price}
                  onChange={(e) => setFormData((prev) => ({ ...prev, price: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("common.currency")}</label>
                <Select value={formData.currency} onValueChange={(value) => setFormData((prev) => ({ ...prev, currency: value as Currency }))}>
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
            <p className={`text-xs ${formData.currency !== currency ? "text-warning font-medium" : "text-muted-foreground"}`}>
              {t("caisse.menu.currencyHint")}
            </p>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t("caisse.menu.category")}</label>
              <div className="flex gap-2">
                <Select value={formData.category} onValueChange={(value) => setFormData((prev) => ({ ...prev, category: value }))}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t("caisse.menu.selectCategory")} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder={t("caisse.menu.newCategory")}
                  value={formData.category}
                  onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}
                  className={`flex-1 ${isNewCategory ? 'border-green-500 bg-green-50' : ''}`}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("caisse.menu.categoryHint")}
              </p>
              {isNewCategory && (
                <div className="flex items-center gap-2 text-xs text-green-600">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  {t("caisse.menu.newCategoryNote", { name: formData.category })}
                </div>
              )}
            </div>

            {/* Image Upload Section */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("caisse.menu.image")}</label>
              {formData.image ? (
                <div className="relative">
                  <img
                    src={formData.image}
                    alt={t("caisse.menu.imagePreview")}
                    className="w-full h-32 object-cover rounded-md"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={removeImage}
                    aria-label={t("common.delete")}
                    className="absolute top-2 end-2 h-6 w-6 p-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="border-2 border-dashed border-gray-300 rounded-md p-4 text-center">
                  <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600 mb-2">{t("caisse.menu.imageUpload")}</p>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                    id={`${idPrefix}-image-upload`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById(`${idPrefix}-image-upload`)?.click()}
                  >
                    {t("caisse.menu.imageChoose")}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`${idPrefix}-available`}
                checked={formData.available}
                onChange={(e) => setFormData((prev) => ({ ...prev, available: e.target.checked }))}
                className="rounded border-gray-300 text-primary focus:ring-primary"
              />
              <label htmlFor={`${idPrefix}-available`} className="text-sm font-medium">
                {t("caisse.menu.availableToOrder")}
              </label>
            </div>

            <div className="flex gap-2 pt-4 border-t bg-white sticky bottom-0">
              <Button variant="outline" onClick={closeForm} className="flex-1">
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSubmit} disabled={isLoading} className="flex-1">
                {formMode === "edit" ? t("common.save") : t("caisse.menu.add")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation avant de changer la devise de tout le restaurant */}
      <AlertDialog open={pendingCurrencySave} onOpenChange={setPendingCurrencySave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("caisse.menu.currencyChangeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("caisse.menu.currencyChangeBody", { from: currency, to: formData.currency })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={saveItem}>{t("caisse.menu.currencyChangeConfirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
