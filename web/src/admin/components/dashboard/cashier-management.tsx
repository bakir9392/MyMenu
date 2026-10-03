import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { AlertTriangle, Check, Copy, Eye, EyeOff, Info, Loader2, MoreVertical, Pencil, Plus, RefreshCw, Trash2, UserCheck, UserPlus, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import api from "@/api";
import { useI18n } from "../../../shared/i18n";

interface Cashier {
  id: number;
  name: string;
  /** Toujours masqué dans la liste (« •••••• ») : le vrai mot de passe se demande à part */
  password: string;
  /** false = ancien compte dont le mot de passe n'est pas consultable */
  passwordViewable?: boolean;
  phone: string | null;
  /** null = ancien compte sans e-mail : il ne peut pas se connecter */
  email: string | null;
  status: "active" | "inactive";
  createdAt: string;
}

interface Reveal {
  visible: boolean;
  loading: boolean;
  /** undefined = pas encore demandé ; null = non consultable */
  value?: string | null;
}

type Filter = "all" | "loggedIn" | "notLoggedIn";
type FieldErrors = Partial<Record<"name" | "email" | "password" | "phone", string>>;

const EMPTY_FORM = { name: "", password: "", phone: "", email: "" };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[\d\s\-+()]{8,}$/;
const MASK = "••••••••";

/** Comptes des caissiers du restaurant : connexion par e-mail sur la même page que l'administrateur */
export function CashierManagement() {
  const { t, formatDate } = useI18n();
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Filter>("all");
  const [loggedInCashiers, setLoggedInCashiers] = useState<{ id: number; name: string }[]>([]);
  const [reveals, setReveals] = useState<Record<number, Reveal>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Modification d'un caissier
  const [editing, setEditing] = useState<Cashier | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editErrors, setEditErrors] = useState<FieldErrors>({});
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const loginUrl = `${window.location.origin}/login`;

  const fetchCashiers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get("/cashiers");
      setCashiers(Array.isArray(response.data) ? response.data : []);
      setReveals({});
    } catch {
      toast.error(t("cashierManagement.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const checkLoggedInCashiers = useCallback(async () => {
    try {
      const response = await api.get("/cashiers/active-session");
      setLoggedInCashiers(Array.isArray(response.data) ? response.data.map((s: { id: number; name: string }) => ({ id: s.id, name: s.name })) : []);
    } catch {
      setLoggedInCashiers([]);
    }
  }, []);

  useEffect(() => {
    fetchCashiers();
    checkLoggedInCashiers();
    const interval = setInterval(checkLoggedInCashiers, 30000); // qui est connecté en ce moment
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLoggedIn = (id: number) => loggedInCashiers.some((c) => c.id === id);

  const patchReveal = (id: number, patch: Partial<Reveal>) =>
    setReveals((prev) => ({ ...prev, [id]: { visible: false, loading: false, ...prev[id], ...patch } }));

  /** Mot de passe en clair, demandé au serveur seulement quand l'administrateur le veut (undefined = échec) */
  const loadPassword = async (cashier: Cashier): Promise<string | null | undefined> => {
    if (cashier.passwordViewable === false) return null;
    const known = reveals[cashier.id]?.value;
    if (known !== undefined) return known;
    patchReveal(cashier.id, { loading: true });
    try {
      const response = await api.get(`/cashiers/${cashier.id}/password`);
      const body = response.data;
      const password = body?.data ? body.data.password : body?.password;
      const value = typeof password === "string" ? password : null;
      patchReveal(cashier.id, { loading: false, value });
      return value;
    } catch {
      patchReveal(cashier.id, { loading: false });
      toast.error(t("cashierManagement.passwordLoadError"));
      return undefined;
    }
  };

  const togglePassword = async (cashier: Cashier) => {
    if (reveals[cashier.id]?.visible) return patchReveal(cashier.id, { visible: false });
    const value = await loadPassword(cashier);
    if (value !== undefined) patchReveal(cashier.id, { visible: true });
  };

  const copyPassword = async (cashier: Cashier) => {
    const value = await loadPassword(cashier);
    if (value === undefined) return;
    if (value === null) return toast.error(t("cashierManagement.passwordNotViewable"));
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(cashier.id);
      toast.success(t("cashierManagement.passwordCopied"));
      setTimeout(() => setCopiedId((id) => (id === cashier.id ? null : id)), 2000);
    } catch {
      toast.error(t("cashierManagement.copyFailed"));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setFormErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
    setEditErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const closeForm = () => {
    setShowRegisterForm(false);
    setShowPassword(false);
    setFormData(EMPTY_FORM);
    setFormErrors({});
  };

  /** Erreurs 422 du serveur (en anglais) -> notre texte, à côté du champ concerné */
  const serverFieldErrors = (errors: Record<string, string[] | string> | undefined): FieldErrors => {
    const next: FieldErrors = {};
    if (!errors) return next;
    const text = (value: string[] | string) => (Array.isArray(value) ? value.join(" ") : String(value));
    if (errors.email) next.email = /already|used|taken|exists/i.test(text(errors.email)) ? t("cashierManagement.err.emailTaken") : t("cashierManagement.invalidEmail");
    if (errors.name) next.name = /already|used|taken/i.test(text(errors.name)) ? t("cashierManagement.nameTaken") : t("cashierManagement.err.nameRequired");
    if (errors.password) next.password = t("cashierManagement.passwordTooShort");
    if (errors.phone) next.phone = t("cashierManagement.invalidPhone");
    return next;
  };

  const handleRegister = async () => {
    const errors: FieldErrors = {};
    if (!formData.name.trim()) errors.name = t("cashierManagement.err.nameRequired");
    if (!formData.email.trim()) errors.email = t("cashierManagement.err.emailRequired");
    else if (!EMAIL_PATTERN.test(formData.email.trim())) errors.email = t("cashierManagement.invalidEmail");
    if (formData.password.length < 6) errors.password = t("cashierManagement.passwordTooShort");
    if (formData.phone.trim() && !PHONE_PATTERN.test(formData.phone)) errors.phone = t("cashierManagement.invalidPhone");
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      setLoading(true);
      const response = await api.post("/cashiers", {
        name: formData.name.trim(),
        email: formData.email.trim(),
        password: formData.password,
        phone: formData.phone.trim() || null,
      });
      setCashiers((prev) => [...prev, { passwordViewable: true, ...response.data }]);
      closeForm();
      toast.success(t("cashierManagement.cashierRegistered"));
    } catch (error: any) {
      const fields = serverFieldErrors(error?.response?.data?.errors);
      if (Object.keys(fields).length > 0) setFormErrors(fields);
      else toast.error(t("cashierManagement.registerError"));
    } finally {
      setLoading(false);
    }
  };

  const openEdit = (cashier: Cashier) => {
    setEditing(cashier);
    setEditForm({ name: cashier.name, email: cashier.email ?? "", phone: cashier.phone ?? "", password: "" });
    setEditErrors({});
    setShowEditPassword(false);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const errors: FieldErrors = {};
    const changes: Record<string, string | null> = {};
    const name = editForm.name.trim();
    const email = editForm.email.trim();
    const phone = editForm.phone.trim();

    if (!name) errors.name = t("cashierManagement.err.nameRequired");
    else if (name !== editing.name) changes.name = name;

    if (!email) errors.email = t("cashierManagement.err.emailRequired");
    else if (!EMAIL_PATTERN.test(email)) errors.email = t("cashierManagement.invalidEmail");
    else if (email !== (editing.email ?? "")) changes.email = email;

    if (phone && !PHONE_PATTERN.test(phone)) errors.phone = t("cashierManagement.invalidPhone");
    else if (phone !== (editing.phone ?? "")) changes.phone = phone || null;

    if (editForm.password) {
      if (editForm.password.length < 6) errors.password = t("cashierManagement.passwordTooShort");
      else changes.password = editForm.password;
    }

    setEditErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (Object.keys(changes).length === 0) {
      setEditing(null);
      return toast.message(t("cashierManagement.nothingChanged"));
    }

    try {
      setSaving(true);
      const response = await api.patch(`/cashiers/${editing.id}`, changes);
      const returned = response.data && typeof response.data === "object" && !Array.isArray(response.data) ? response.data : {};
      setCashiers((prev) =>
        prev.map((c) =>
          c.id === editing.id
            ? { ...c, ...changes, ...returned, passwordViewable: changes.password ? true : returned.passwordViewable ?? c.passwordViewable, password: c.password }
            : c
        )
      );
      if (changes.password) setReveals((prev) => ({ ...prev, [editing.id]: { visible: false, loading: false } })); // le mot de passe affiché n'est plus le bon
      setEditing(null);
      toast.success(t("cashierManagement.cashierUpdated"));
    } catch (error: any) {
      const fields = serverFieldErrors(error?.response?.data?.errors);
      if (Object.keys(fields).length > 0) setEditErrors(fields);
      else toast.error(t("cashierManagement.updateError"));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCashier = async (cashier: Cashier) => {
    if (!confirm(t("cashierManagement.confirmRemove", { name: cashier.name }))) return;
    try {
      setLoading(true);
      await api.delete(`/cashiers/${cashier.id}`);
      setCashiers((prev) => prev.filter((c) => c.id !== cashier.id));
      setLoggedInCashiers((prev) => prev.filter((c) => c.id !== cashier.id));
      toast.success(t("cashierManagement.cashierRemoved"));
    } catch {
      toast.error(t("cashierManagement.removeError"));
    } finally {
      setLoading(false);
    }
  };

  const toggleCashierStatus = async (cashier: Cashier) => {
    const newStatus = cashier.status === "active" ? "inactive" : "active";
    try {
      setLoading(true);
      await api.patch(`/cashiers/${cashier.id}`, { status: newStatus });
      setCashiers((prev) => prev.map((c) => (c.id === cashier.id ? { ...c, status: newStatus } : c)));
      if (newStatus === "inactive") checkLoggedInCashiers(); // un compte désactivé est déconnecté tout de suite
    } catch {
      toast.error(t("cashierManagement.statusError"));
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = () => {
    checkLoggedInCashiers();
    fetchCashiers();
  };

  const filteredCashiers = cashiers.filter((cashier) => {
    if (statusFilter === "loggedIn") return isLoggedIn(cashier.id);
    if (statusFilter === "notLoggedIn") return !isLoggedIn(cashier.id);
    return true;
  });

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: t("common.all") },
    { id: "loggedIn", label: t("cashierManagement.filterLoggedIn") },
    { id: "notLoggedIn", label: t("cashierManagement.filterNotLoggedIn") },
  ];

  const fieldError = (message?: string) => (message ? <p className="mt-1 text-xs text-destructive">{message}</p> : null);

  // Mot de passe (création ou modification) avec son bouton afficher / masquer
  const passwordInput = (value: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void, visible: boolean, toggle: () => void, disabled: boolean, placeholder: string) => (
    <div className="relative">
      <Input name="password" type={visible ? "text" : "password"} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} className="pe-10" autoComplete="new-password" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute end-0 top-0 h-full px-3"
        aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")}
        onClick={toggle}
        disabled={disabled}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" />
            {t("cashierManagement.title")}
          </h2>
          <p className="text-muted-foreground">{t("cashierManagement.subtitle")}</p>
        </div>
        <Button onClick={() => setShowRegisterForm(!showRegisterForm)} className="flex items-center gap-2" disabled={loading}>
          <UserPlus className="h-4 w-4" />
          {t("cashierManagement.addCashier")}
        </Button>
      </div>

      {/* Les caissiers se connectent avec leur e-mail, sur la même page que l'administrateur */}
      <div className="flex items-start gap-3 rounded-lg border bg-muted/50 p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 space-y-1">
          <p>{t("cashierManagement.signInNote")}</p>
          <p className="text-muted-foreground">
            {t("cashierManagement.signInPage")} <code className="break-all rounded bg-background px-1.5 py-0.5 text-xs" dir="ltr">{loginUrl}</code>
          </p>
          <p className="text-muted-foreground">{t("cashierManagement.disabledNote")}</p>
        </div>
      </div>

      {showRegisterForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t("cashierManagement.registerNewCashier")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="mb-2 block">{t("cashierManagement.fullName")}</Label>
                <Input name="name" value={formData.name} onChange={handleInputChange} placeholder={t("cashierManagement.fullNamePlaceholder")} disabled={loading} />
                {fieldError(formErrors.name)}
              </div>
              <div>
                <Label className="mb-2 block">{t("cashierManagement.email")}</Label>
                <Input name="email" type="email" dir="ltr" className="text-start" value={formData.email} onChange={handleInputChange} placeholder={t("cashierManagement.emailPlaceholder")} disabled={loading} autoComplete="off" />
                {fieldError(formErrors.email)}
              </div>
              <div>
                <Label className="mb-2 block">{t("cashierManagement.password")}</Label>
                {passwordInput(formData.password, handleInputChange, showPassword, () => setShowPassword(!showPassword), loading, t("cashierManagement.passwordPlaceholder"))}
                {fieldError(formErrors.password)}
              </div>
              <div>
                <Label className="mb-2 block">
                  {t("cashierManagement.phone")} <span className="text-muted-foreground">{t("cashierManagement.optional")}</span>
                </Label>
                <Input name="phone" type="tel" dir="ltr" className="text-start" value={formData.phone} onChange={handleInputChange} placeholder={t("cashierManagement.phonePlaceholder")} disabled={loading} />
                {fieldError(formErrors.phone)}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleRegister} className="flex items-center gap-2" disabled={loading}>
                <Plus className="h-4 w-4" />
                {loading ? t("cashierManagement.registering") : t("cashierManagement.register")}
              </Button>
              <Button variant="outline" onClick={closeForm} disabled={loading}>
                {t("common.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("cashierManagement.registeredCashiers")}</CardTitle>
          <div className={`mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${loggedInCashiers.length > 0 ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300" : "border-border bg-muted/50 text-muted-foreground"}`}>
            <div className="flex items-center gap-2">
              <div className={`h-3 w-3 rounded-full ${loggedInCashiers.length > 0 ? "animate-pulse bg-green-500" : "bg-gray-400"}`} />
              {loggedInCashiers.length > 0 ? (
                <>
                  <span className="font-medium">{t("cashierManagement.currentlyLoggedIn")}</span>
                  <span className="font-semibold">{loggedInCashiers.map((c) => c.name).join(", ")}</span>
                </>
              ) : (
                <span className="font-medium">{t("cashierManagement.noneLoggedIn")}</span>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={refreshAll} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              {t("common.refresh")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-green-500" />
              <span>{t("cashierManagement.loggedInCount", { count: loggedInCashiers.length })}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-gray-500" />
              <span>{t("cashierManagement.notLoggedInCount", { count: Math.max(0, cashiers.length - loggedInCashiers.length) })}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-blue-500" />
              <span>{t("cashierManagement.totalCount", { count: cashiers.length })}</span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {filters.map((filter) => (
              <Button key={filter.id} variant={statusFilter === filter.id ? "default" : "outline"} size="sm" onClick={() => setStatusFilter(filter.id)}>
                {filter.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {loading && cashiers.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">{t("cashierManagement.loadingCashiers")}</div>
          ) : filteredCashiers.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {statusFilter === "all"
                ? t("cashierManagement.noCashiers")
                : statusFilter === "loggedIn"
                  ? t("cashierManagement.noLoggedIn")
                  : t("cashierManagement.noNotLoggedIn")}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredCashiers.map((cashier) => {
                const online = isLoggedIn(cashier.id);
                const reveal = reveals[cashier.id];
                const notViewable = cashier.passwordViewable === false || (reveal?.visible && reveal.value === null);
                return (
                  <div key={cashier.id} className="rounded-lg border">
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-primary">
                          <span className="font-semibold text-primary-foreground">
                            {cashier.name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium" title={cashier.name}>{cashier.name}</div>
                          {cashier.email ? (
                            <div className="truncate text-sm text-muted-foreground" dir="ltr" title={cashier.email}>{cashier.email}</div>
                          ) : (
                            <Badge variant="outline" className="mt-0.5 gap-1 border-amber-500/60 text-amber-700 dark:text-amber-400">
                              <AlertTriangle className="h-3 w-3" />
                              {t("cashierManagement.noEmailBadge")}
                            </Badge>
                          )}
                          <div className="text-sm text-muted-foreground">
                            {t("cashierManagement.registeredOn")} {formatDate(new Date(`${cashier.createdAt}T12:00:00`))}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={online ? "bg-green-500 text-white" : "bg-gray-500 text-white"}>
                            {online ? t("cashierManagement.badgeLoggedIn") : t("cashierManagement.badgeNotLoggedIn")}
                          </Badge>
                          {cashier.status === "inactive" && (
                            <Badge variant="outline" className="border-destructive/50 text-destructive">
                              {t("cashierManagement.badgeDisabled")}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Boutons sur grand écran */}
                      <div className="hidden items-center gap-2 md:flex">
                        <Button variant="outline" size="sm" onClick={() => openEdit(cashier)} disabled={loading}>
                          <Pencil className="me-1 h-4 w-4" />
                          {t("common.edit")}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => toggleCashierStatus(cashier)} disabled={loading}>
                          {cashier.status === "active" ? t("cashierManagement.deactivate") : t("cashierManagement.activate")}
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleRemoveCashier(cashier)} className="flex items-center gap-1" disabled={loading}>
                          <Trash2 className="h-4 w-4" />
                          {t("cashierManagement.remove")}
                        </Button>
                      </div>

                      {/* Menu sur mobile */}
                      <div className="md:hidden">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={loading} aria-label={cashier.name}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onClick={() => openEdit(cashier)} className="cursor-pointer">
                              <Pencil className="me-2 h-4 w-4" />
                              {t("common.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => toggleCashierStatus(cashier)} className="cursor-pointer">
                              {cashier.status === "active" ? (
                                <>
                                  <UserX className="me-2 h-4 w-4" />
                                  {t("cashierManagement.deactivate")}
                                </>
                              ) : (
                                <>
                                  <UserCheck className="me-2 h-4 w-4" />
                                  {t("cashierManagement.activate")}
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleRemoveCashier(cashier)} className="cursor-pointer text-destructive focus:text-destructive">
                              <Trash2 className="me-2 h-4 w-4" />
                              {t("cashierManagement.remove")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    <div className="space-y-3 border-t bg-muted/50 p-4">
                      {!cashier.email && (
                        <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2.5 text-sm">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          <span>{t("cashierManagement.noEmailWarning")}</span>
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <span className="text-sm font-medium text-muted-foreground">{t("cashierManagement.infoPassword")}</span>
                          <div className="mt-1 flex items-center gap-2">
                            <div className="min-w-0 flex-1 truncate rounded border bg-background px-2 py-1.5 font-mono text-sm" dir="ltr">
                              {reveal?.visible && typeof reveal.value === "string" ? reveal.value : MASK}
                            </div>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="h-8 w-8 shrink-0"
                              onClick={() => togglePassword(cashier)}
                              disabled={reveal?.loading}
                              aria-label={reveal?.visible ? t("auth.hidePassword") : t("auth.showPassword")}
                              title={reveal?.visible ? t("auth.hidePassword") : t("auth.showPassword")}
                            >
                              {reveal?.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : reveal?.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="h-8 w-8 shrink-0"
                              onClick={() => copyPassword(cashier)}
                              disabled={reveal?.loading || cashier.passwordViewable === false}
                              aria-label={t("cashierManagement.copyPassword")}
                              title={t("cashierManagement.copyPassword")}
                            >
                              {copiedId === cashier.id ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                            </Button>
                          </div>
                          {notViewable && <p className="mt-1 text-xs text-muted-foreground">{t("cashierManagement.passwordNotViewable")}</p>}
                        </div>
                        <div>
                          <span className="text-sm font-medium text-muted-foreground">{t("cashierManagement.infoPhone")}</span>
                          <div className="mt-1 text-sm font-medium" dir="ltr">{cashier.phone || t("cashierManagement.notProvided")}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modification : seuls les champs changés sont envoyés */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && !saving && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="text-start">
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              {t("cashierManagement.editTitle")}
            </DialogTitle>
            <DialogDescription>{t("cashierManagement.editHint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">{t("cashierManagement.fullName")}</Label>
              <Input name="name" value={editForm.name} onChange={handleEditChange} disabled={saving} />
              {fieldError(editErrors.name)}
            </div>
            <div>
              <Label className="mb-2 block">{t("cashierManagement.email")}</Label>
              <Input name="email" type="email" dir="ltr" className="text-start" value={editForm.email} onChange={handleEditChange} placeholder={t("cashierManagement.emailPlaceholder")} disabled={saving} autoComplete="off" />
              {fieldError(editErrors.email)}
            </div>
            <div>
              <Label className="mb-2 block">
                {t("cashierManagement.phone")} <span className="text-muted-foreground">{t("cashierManagement.optional")}</span>
              </Label>
              <Input name="phone" type="tel" dir="ltr" className="text-start" value={editForm.phone} onChange={handleEditChange} placeholder={t("cashierManagement.phonePlaceholder")} disabled={saving} />
              {fieldError(editErrors.phone)}
            </div>
            <div>
              <Label className="mb-2 block">{t("cashierManagement.newPassword")}</Label>
              {passwordInput(editForm.password, handleEditChange, showEditPassword, () => setShowEditPassword(!showEditPassword), saving, t("cashierManagement.passwordPlaceholder"))}
              <p className="mt-1 text-xs text-muted-foreground">{t("cashierManagement.newPasswordHint")}</p>
              {fieldError(editErrors.password)}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
                {t("common.cancel")}
              </Button>
              <Button onClick={handleSaveEdit} disabled={saving}>
                {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                {t("common.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
