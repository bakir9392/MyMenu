import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "@/components/ui/star-rating";
import { ImageCarousel } from "@/components/ui/image-carousel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Edit, Trash2, Search, ChefHat } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useShop } from "@/hooks/use-shop";
import { Dish, listDishes, deleteDish, setDishAvailability } from "./dishes";
import { DishFormDialog } from "./dish-form-dialog";

// Valeur du filtre « toutes les catégories » et « sans catégorie » (jamais affichées telles quelles)
const ALL = "__all__";
const NONE = "__none__";

export function MenuManagement() {
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(ALL);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [dishToDelete, setDishToDelete] = useState<Dish | null>(null);
  // Formulaire d'ajout / de modification (le même que celui de la caisse)
  const [formOpen, setFormOpen] = useState(false);
  const [editingDish, setEditingDish] = useState<Dish | null>(null);
  const { toast } = useToast();
  const { i18n, currency } = useShop();
  const { t, money } = i18n;

  const loadDishes = async () => {
    try {
      const { data } = await listDishes();
      setDishes(data);
    } catch {
      toast({ title: t("common.error"), description: t("menu.loadError"), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDishes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categoryOf = (dish: Dish) => dish.category?.trim() || NONE;

  const categories = useMemo(() => {
    const named = Array.from(new Set(dishes.map(categoryOf).filter((c) => c !== NONE))).sort((a, b) => a.localeCompare(b));
    return [ALL, ...named, ...(dishes.some((d) => categoryOf(d) === NONE) ? [NONE] : [])];
  }, [dishes]);

  const categoryLabel = (category: string) => (category === ALL ? t("menu.all") : category === NONE ? t("menu.uncategorized") : category);

  const filteredDishes = dishes.filter((dish) => {
    const matchesSearch = dish.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === ALL || categoryOf(dish) === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Disponible / indisponible : enregistré sur le serveur (le client voit le changement tout de suite)
  const handleToggleAvailability = async (dish: Dish) => {
    const next = !dish.is_available;
    setDishes((prev) => prev.map((d) => (d.id === dish.id ? { ...d, is_available: next } : d)));
    try {
      await setDishAvailability(dish.id, next);
      toast({
        title: next ? t("menu.addedToMenu") : t("menu.removedFromMenu"),
        description: t(next ? "menu.isNowAvailable" : "menu.isNowUnavailable", { name: dish.name }),
      });
    } catch {
      setDishes((prev) => prev.map((d) => (d.id === dish.id ? { ...d, is_available: dish.is_available } : d)));
      toast({ title: t("common.error"), description: t("menu.updateError"), variant: "destructive" });
    }
  };

  const handleDeleteClick = (dish: Dish) => {
    setDishToDelete(dish);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!dishToDelete) return;
    try {
      // Le serveur supprime aussi les photos du plat
      await deleteDish(dishToDelete.id);
      setDishes((prev) => prev.filter((dish) => dish.id !== dishToDelete.id));
      toast({
        title: t("menu.dishDeleted"),
        description: t("menu.dishDeletedText", { name: dishToDelete.name }),
        variant: "destructive",
      });
    } catch {
      toast({ title: t("common.error"), description: t("menu.deleteError"), variant: "destructive" });
    } finally {
      setDeleteDialogOpen(false);
      setDishToDelete(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setDishToDelete(null);
  };

  const openAddForm = () => {
    setEditingDish(null);
    setFormOpen(true);
  };

  const handleEditDish = (dish: Dish) => {
    setEditingDish(dish);
    setFormOpen(true);
  };

  // Catégories déjà utilisées, proposées dans le formulaire (on peut aussi en créer une nouvelle)
  const usedCategories = useMemo(
    () => Array.from(new Set(dishes.map((d) => d.category?.trim() ?? "").filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [dishes]
  );

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t("menu.title")}</h2>
          <p className="text-muted-foreground">{t("menu.subtitle")}</p>
        </div>
        <Button onClick={openAddForm} className="bg-gradient-primary shadow-glow hover:scale-105 transition-transform">
          <Plus className="w-4 h-4 me-2" />
          {t("menu.newDish")}
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input placeholder={t("menu.search")} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="ps-10" />
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {categories.map((category) => (
                <Button
                  key={category}
                  variant={selectedCategory === category ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategory(category)}
                  className={selectedCategory === category ? "bg-gradient-primary" : ""}
                >
                  {categoryLabel(category)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dishes Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredDishes.map((dish) => (
          <Card key={dish.id} className={`transition-all duration-200 hover:shadow-soft hover:-translate-y-1 ${!dish.is_available ? "opacity-60" : ""}`}>
            <CardHeader className="pb-3">
              <div className="mb-4">
                <ImageCarousel images={dish.images || []} alt={dish.name} />
              </div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ChefHat className="w-4 h-4 shrink-0 text-primary" />
                    <span className="truncate">{dish.name}</span>
                  </CardTitle>
                  <Badge variant="secondary" className="mt-2 bg-primary/10 text-primary">
                    {categoryLabel(categoryOf(dish))}
                  </Badge>
                </div>
                <Badge variant={dish.is_available ? "default" : "secondary"} className={dish.is_available ? "bg-success text-success-foreground" : ""}>
                  {dish.is_available ? t("menu.available") : t("menu.unavailable")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {dish.description && <p className="text-sm text-muted-foreground line-clamp-3">{dish.description}</p>}

              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-primary">{money(Number(dish.price), dish.currency ?? currency)}</span>
                {(dish.total_ratings ?? 0) > 0 && (
                  <StarRating rating={dish.average_rating || 0} totalRatings={dish.total_ratings || 0} size="sm" showCount={true} interactive={false} />
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => handleEditDish(dish)}>
                  <Edit className="w-4 h-4 me-1" />
                  {t("menu.edit")}
                </Button>
                <Button
                  variant={dish.is_available ? "outline" : "default"}
                  size="sm"
                  onClick={() => handleToggleAvailability(dish)}
                  className={!dish.is_available ? "bg-success hover:bg-success/90" : ""}
                >
                  {dish.is_available ? t("menu.remove") : t("menu.activate")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDeleteClick(dish)}
                  aria-label={t("menu.delete")}
                  title={t("menu.delete")}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && filteredDishes.length === 0 && (
        <Card className="text-center py-12">
          <CardContent>
            <ChefHat className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">{dishes.length === 0 ? t("menu.emptyMenu") : t("menu.noResults")}</h3>
            <p className="text-muted-foreground">{dishes.length === 0 ? t("menu.emptyMenuText") : t("menu.noResultsText")}</p>
          </CardContent>
        </Card>
      )}

      <DishFormDialog
        open={formOpen}
        dish={editingDish}
        categories={usedCategories}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          // La devise est celle de tout le restaurant : la liste se recharge avec les prix à jour
          loadDishes();
        }}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("menu.confirmDeletion")}</AlertDialogTitle>
            <AlertDialogDescription>{t("menu.confirmDeletionText", { name: dishToDelete?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDeleteCancel}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("menu.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
