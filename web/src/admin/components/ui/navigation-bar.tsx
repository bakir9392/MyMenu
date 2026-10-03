import { useState } from "react";
import {
  BarChart3,
  ChefHat,
  Utensils,
  ClipboardList,
  FileText,
  KeyRound,
  LineChart,
  LogOut,
  Menu,
  MessageSquareWarning,
  Settings,
  UserCircle,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { useAuth } from "@/contexts/auth-context";
import { useShop } from "@/hooks/use-shop";
import { APP_NAME } from "../../../shared/brand";
import type { Currency } from "../../../shared/bill";
import { LanguageSwitcher, useI18n } from "../../../shared/i18n";

// Texte court de la devise dans la barre du haut
const CURRENCY_SHORT: Record<Currency, string> = { EUR: "€ EUR", USD: "$ USD", DZD: "DZD" };

interface NavigationBarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  /** Compteurs affichés sur les entrées du menu (ex. : réclamations non traitées) */
  badges?: Record<string, number>;
}

/**
 * Barre du haut en trois blocs sur une ligne (grand écran, ≥ lg) :
 *   [logo + nom du restaurant : largeur bornée, texte coupé par …] [sections : prend le reste, défile si trop étroit] [contrôles : jamais compressés]
 * Le bloc du milieu est `flex-1 min-w-0` : il ne peut donc ni déborder ni recouvrir les deux autres, quelle que soit la longueur du nom.
 * Sous lg, les sections passent dans le menu hamburger. Tout est en classes logiques : la barre se retourne en arabe.
 */
export function NavigationBar({ activeSection, onSectionChange, badges = {} }: NavigationBarProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const { t } = useI18n();
  const { auth, signOut } = useAuth();
  const { settings, currency } = useShop();

  const restaurantName = settings?.restaurant_name || auth?.restaurant.name || APP_NAME;
  const adminName = auth?.admin.name ?? "";
  const currencyCode: Currency = currency ?? "EUR";
  const currencyTitle = `${t("common.currency")}: ${t(`common.currency${currencyCode}`)}`;

  const navigationItems = [
    { id: "dashboard", label: t("nav.dashboard"), icon: BarChart3 },
    { id: "orders", label: t("nav.orders"), icon: ClipboardList },
    { id: "reports", label: t("nav.reports"), icon: LineChart },
    { id: "invoices", label: t("nav.invoices"), icon: FileText },
    { id: "complaints", label: t("nav.complaints"), icon: MessageSquareWarning },
    { id: "menu", label: t("nav.menu"), icon: ChefHat },
    { id: "tables", label: t("nav.tables"), icon: Users },
    { id: "cashierManagement", label: t("nav.cashierManagement"), icon: UserPlus },
    { id: "settings", label: t("nav.settings"), icon: Settings },
  ];

  return (
    <header className="bg-card border-b border-border shadow-soft sticky top-0 z-50">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center gap-3">
          {/* Logo + nom du restaurant : largeur bornée, le nom est coupé par … (nom complet au survol) */}
          <div className="flex min-w-0 max-w-[10rem] items-center gap-3 sm:max-w-[13rem] xl:max-w-[16rem]">
            <div className="w-10 h-10 bg-gradient-primary rounded-lg flex items-center justify-center shadow-glow shrink-0">
              <Utensils className="w-6 h-6 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1 leading-tight" title={adminName ? `${restaurantName} — ${adminName}` : restaurantName}>
              <h1 className="truncate text-lg font-bold bg-gradient-primary bg-clip-text text-transparent">{restaurantName}</h1>
              {adminName && <p className="truncate text-xs text-muted-foreground">{adminName}</p>}
            </div>
          </div>

          {/* Sections (≥ lg) : icônes seules, le libellé n'apparaît que sur la section ouverte (≥ xl).
              Le bloc prend l'espace restant (flex-1 min-w-0) et défile sans barre s'il est quand même trop étroit. */}
          <nav
            className="hidden min-w-0 flex-1 overflow-x-auto py-2 lg:block [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label={t("nav.sections")}
          >
            {/* mx-auto centre les boutons quand il y a de la place ; quand ils débordent, la marge tombe à 0 et tout reste atteignable */}
            <div className="mx-auto flex w-max items-center gap-1 px-1">
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                const count = badges[item.id] ?? 0;

                return (
                  <Button
                    key={item.id}
                    variant={isActive ? "default" : "ghost"}
                    onClick={() => onSectionChange(item.id)}
                    title={item.label}
                    aria-label={item.label}
                    aria-current={isActive ? "page" : undefined}
                    className={cn("relative shrink-0 gap-2 px-2.5 transition-all duration-200", isActive && "bg-gradient-primary shadow-glow")}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {isActive && <span className="hidden whitespace-nowrap xl:inline">{item.label}</span>}
                    {count > 0 && (
                      <span className="absolute -top-1 -end-1 min-w-[1rem] rounded-full bg-destructive px-1 text-center text-[10px] font-bold leading-4 text-destructive-foreground">
                        {count}
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>
          </nav>

          {/* Contrôles : ne rétrécissent jamais et ne passent jamais à la ligne ; ms-auto les garde à la fin quand les sections sont masquées */}
          <div className="ms-auto flex shrink-0 flex-nowrap items-center gap-2 lg:ms-0">
            {/* Devise du restaurant : un clic mène aux Paramètres pour la changer */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSectionChange("settings")}
              title={currencyTitle}
              aria-label={currencyTitle}
              className="hidden shrink-0 whitespace-nowrap font-semibold sm:inline-flex"
            >
              {CURRENCY_SHORT[currencyCode]}
            </Button>
            <LanguageSwitcher className="hidden shrink-0 sm:inline-flex" />
            <ThemeToggle />

            {/* Compte : nom, restaurant, changement de mot de passe, déconnexion */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0" aria-label={t("auth.account")} title={t("auth.account")}>
                  <UserCircle className="h-[1.2rem] w-[1.2rem]" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
                <DropdownMenuLabel className="space-y-0.5 font-normal">
                  <p className="text-xs text-muted-foreground">{t("auth.signedInAs")}</p>
                  <p className="font-semibold truncate" title={adminName}>{adminName}</p>
                  <p className="text-xs text-muted-foreground truncate" dir="ltr">{auth?.admin.email}</p>
                  <p className="text-xs text-muted-foreground truncate pt-1" title={restaurantName}>{t("auth.restaurant")} : {restaurantName}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer gap-2" onClick={() => setIsPasswordOpen(true)}>
                  <KeyRound className="h-4 w-4" />
                  {t("auth.changePassword")}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer gap-2 text-destructive focus:text-destructive" onClick={signOut}>
                  <LogOut className="h-4 w-4" />
                  {t("auth.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Bouton de déconnexion toujours visible (icône seule : peu de place) */}
            <Button variant="outline" size="icon" className="hidden shrink-0 lg:inline-flex" onClick={signOut} aria-label={t("auth.logout")} title={t("auth.logout")}>
              <LogOut className="h-[1.2rem] w-[1.2rem]" />
            </Button>

            {/* Bouton du menu hamburger (< lg) */}
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 lg:hidden"
              aria-label={isMobileMenuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
              aria-expanded={isMobileMenuOpen}
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        {/* Navigation du menu hamburger */}
        {isMobileMenuOpen && (
          <div className="lg:hidden py-4 border-t border-border animate-fade-in">
            <nav className="flex flex-col gap-2" aria-label={t("nav.sections")}>
              {navigationItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;

                return (
                  <Button
                    key={item.id}
                    variant={isActive ? "default" : "ghost"}
                    onClick={() => {
                      onSectionChange(item.id);
                      setIsMobileMenuOpen(false);
                    }}
                    className={cn("flex items-center gap-3 justify-start w-full", isActive && "bg-gradient-primary shadow-glow")}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {badges[item.id] > 0 && (
                      <span className="ms-auto rounded-full bg-destructive px-2 text-xs font-bold text-destructive-foreground">
                        {badges[item.id]}
                      </span>
                    )}
                  </Button>
                );
              })}
            </nav>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 sm:hidden">
              <LanguageSwitcher />
              <Button
                variant="outline"
                size="sm"
                className="font-semibold"
                title={currencyTitle}
                onClick={() => {
                  onSectionChange("settings");
                  setIsMobileMenuOpen(false);
                }}
              >
                {CURRENCY_SHORT[currencyCode]}
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={signOut}>
                <LogOut className="h-4 w-4" />
                {t("auth.logout")}
              </Button>
            </div>
          </div>
        )}
      </div>

      <ChangePasswordDialog open={isPasswordOpen} onOpenChange={setIsPasswordOpen} />
    </header>
  );
}
