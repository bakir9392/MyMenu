import { FormEvent, ReactNode, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Utensils, Eye, EyeOff, KeyRound, Loader2, QrCode, ReceiptText, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useAuth } from "@/contexts/auth-context";
import { ApiReply, fetchAuthOptions, registerRequest, resetPasswordWithKey } from "@/lib/auth-api";
import { CURRENCY_CODES, type Currency } from "@/lib/bill";
import { APP_NAME } from "../../shared/brand";
import { WhatsAppIcon } from "../../shared/WhatsAppIcon";
import { LanguageSwitcher, useI18n } from "../../shared/i18n";
import { goHome, signIn as signInRequest, writeSession } from "../../shared/session";

type Mode = "login" | "signup" | "forgot";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mot de passe avec bouton afficher / masquer (le bouton suit le sens de lecture) */
function PasswordField({ id, value, onChange, autoComplete, placeholder }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="h-11 pe-11"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("auth.hidePassword") : t("auth.showPassword")}
        className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** ClÃ© d'activation : saisie en majuscules, toujours de gauche Ã  droite */
function ActivationKeyInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative">
      <KeyRound className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="activationKey"
        dir="ltr"
        className="h-11 ps-9 text-start font-mono uppercase tracking-wider"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="XXXX-XXXX-XXXX"
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

function Field({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Banner({ tone, children }: { tone: "error" | "info" | "success"; children: ReactNode }) {
  const colors =
    tone === "error"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "success"
        ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400"
        : "border-warning/50 bg-warning/10 text-foreground";
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${colors}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** Encadre : la cle d'activation s'obtient en contactant l'equipe sur WhatsApp (numero regle cote serveur : WHATSAPP_NUMBER) */
function ActivationKeyNotice({ whatsapp }: { whatsapp: string | null }) {
  const { t } = useI18n();
  const link = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(t("auth.whatsappMessage", { app: APP_NAME }))}` : null;
  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm">
      <p className="flex items-start gap-2">
        <span aria-hidden className="text-base leading-5">🔑</span>
        <span>{t("auth.keyNotice")}</span>
      </p>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#25D366] px-4 font-medium text-white shadow-soft transition-opacity hover:opacity-90"
        >
          <WhatsAppIcon className="h-5 w-5 text-white" />
          {t("auth.contactWhatsapp")}
        </a>
      )}
    </div>
  );
}

/** Connexion (administrateurs et caissiers), crÃ©ation d'un restaurant et mot de passe oubliÃ© */
export default function AuthPage() {
  const { t } = useI18n();
  const { signIn, sessionExpired } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [signupOpen, setSignupOpen] = useState(true);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [activationKey, setActivationKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // L'inscription peut Ãªtre fermÃ©e par l'hÃ©bergeur du serveur (ALLOW_SIGNUP=false)
  useEffect(() => {
    fetchAuthOptions().then((reply) => {
      if (reply.ok && reply.data) {
        setSignupOpen(reply.data.signupOpen);
        setWhatsapp(reply.data.whatsapp ?? null);
      }
    });
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setFormError(null);
    setFormSuccess(null);
    setFieldErrors({});
  };

  const describeFailure = (reply: ApiReply<unknown>): string => {
    if (reply.status === 0) return t("auth.networkError");
    if (reply.status === 401) return t("auth.invalidCredentials");
    if (reply.status === 429) return t("auth.tooManyAttempts");
    if (reply.status === 403) return t("auth.signupClosed");
    if (reply.status >= 500) return t("auth.serverError");
    return t("auth.genericError");
  };

  // Un seul Ã©cran de connexion : un administrateur reste ici, un caissier est envoyÃ© Ã  la caisse
  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    if (!email.trim() || !password) return setFormError(t("auth.err.required"));
    setIsBusy(true);
    const result = await signInRequest(email, password);
    if ("error" in result) {
      setIsBusy(false);
      const messages = { invalid: "auth.invalidCredentials", throttled: "auth.tooManyAttempts", network: "auth.networkError", server: "auth.serverError" } as const;
      return setFormError(t(messages[result.error]));
    }
    if (result.session.role === "cashier") {
      writeSession(result.session);
      return goHome("cashier");
    }
    setIsBusy(false);
    signIn(result.session);
  };

  const submitSignup = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const errors: Record<string, string> = {};
    if (restaurantName.trim().length < 2) errors.restaurantName = t("auth.err.restaurantName");
    if (name.trim().length < 2) errors.name = t("auth.err.name");
    if (!EMAIL_PATTERN.test(email.trim())) errors.email = t("auth.err.email");
    if (password.length < 8) errors.password = t("auth.err.password");
    if (!activationKey.trim()) errors.activationKey = t("auth.err.activationKeyRequired");
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsBusy(true);
    const reply = await registerRequest({
      restaurantName: restaurantName.trim(),
      name: name.trim(),
      email: email.trim(),
      password,
      currency,
      timezone,
      activationKey: activationKey.trim().toUpperCase(),
    });
    setIsBusy(false);
    if (reply.ok && reply.data) {
      const { token, admin, restaurant } = reply.data;
      return signIn({ role: "admin", token, user: { id: admin.id, name: admin.name, email: admin.email }, restaurant, loginAt: Date.now() });
    }

    if (reply.status === 422 && reply.errors) {
      const next: Record<string, string> = {};
      for (const [field, messages] of Object.entries(reply.errors)) {
        const raw = Array.isArray(messages) ? messages.join(" ") : String(messages);
        const known = t(`auth.err.${field}`);
        next[field] = field === "email" && /already/i.test(raw) ? t("auth.err.emailTaken") : known.startsWith("auth.err.") ? t("auth.genericError") : known;
      }
      setFieldErrors(next);
      return;
    }
    setFormError(describeFailure(reply));
  };

  // Mot de passe oubliÃ© : e-mail + clÃ© d'activation du compte + nouveau mot de passe, puis retour Ã  la connexion
  const submitReset = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    const errors: Record<string, string> = {};
    if (!EMAIL_PATTERN.test(email.trim())) errors.email = t("auth.err.email");
    if (!activationKey.trim()) errors.activationKey = t("auth.err.activationKeyRequired");
    if (newPassword.length < 8) errors.newPassword = t("auth.err.password");
    else if (newPassword !== confirmPassword) errors.confirmPassword = t("auth.passwordsMismatch");
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsBusy(true);
    const reply = await resetPasswordWithKey(email.trim(), activationKey.trim().toUpperCase(), newPassword);
    setIsBusy(false);
    if (reply.ok) {
      setMode("login");
      setPassword("");
      setActivationKey("");
      setNewPassword("");
      setConfirmPassword("");
      setFieldErrors({});
      return setFormSuccess(t("auth.resetDone"));
    }
    if (reply.status === 401) return setFormError(t("auth.resetInvalid"));
    if (reply.status === 422) return setFormError(t("auth.resetCheckFields"));
    if (reply.status === 429) return setFormError(t("auth.tooManyAttempts"));
    if (reply.status === 0) return setFormError(t("auth.networkError"));
    setFormError(reply.status >= 500 ? t("auth.serverError") : t("auth.genericError"));
  };

  const showSignup = mode === "signup" && signupOpen;

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      {/* Panneau de prÃ©sentation (grands Ã©crans) */}
      <aside className="relative hidden overflow-hidden bg-gradient-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -top-24 -end-24 h-72 w-72 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -bottom-32 -start-16 h-80 w-80 rounded-full bg-white/10" aria-hidden />
        <div className="relative flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
            <Utensils className="h-7 w-7" />
          </div>
          <span className="text-2xl font-bold">{APP_NAME}</span>
        </div>
        <div className="relative space-y-8">
          <p className="max-w-md text-3xl font-semibold leading-snug">{t("auth.tagline")}</p>
          <div className="flex gap-4 text-white/90" aria-hidden>
            <QrCode className="h-9 w-9" />
            <UtensilsCrossed className="h-9 w-9" />
            <ReceiptText className="h-9 w-9" />
          </div>
        </div>
        <span className="relative text-sm text-white/70">{APP_NAME}</span>
      </aside>

      <main className="flex flex-col">
        <div className="flex items-center justify-between gap-3 p-4 sm:p-6">
          <div className="flex items-center gap-2 lg:invisible">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
              <Utensils className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold">{APP_NAME}</span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-4 pb-10 sm:px-6">
          <div className="w-full max-w-md space-y-6">

            {/* ---- MOT DE PASSE OUBLIÃ‰ (clÃ© d'activation) ---- */}
            {mode === "forgot" && (
              <>
                <div className="space-y-1.5">
                  <h1 className="text-3xl font-bold">{t("auth.forgotTitle")}</h1>
                  <p className="text-muted-foreground">{t("auth.forgotSubtitle")}</p>
                </div>
                <ActivationKeyNotice whatsapp={whatsapp} />
                {formError && <Banner tone="error">{formError}</Banner>}
                <form onSubmit={submitReset} className="space-y-4" noValidate>
                  <Field label={t("auth.email")} htmlFor="email" error={fieldErrors.email}>
                    <Input id="email" type="email" dir="ltr" className="h-11 text-start" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.emailPlaceholder")} autoComplete="username" autoFocus />
                  </Field>
                  <Field label={t("auth.activationKey")} htmlFor="activationKey" error={fieldErrors.activationKey}>
                    <ActivationKeyInput value={activationKey} onChange={setActivationKey} />
                    <p className="text-xs text-muted-foreground">{t("auth.forgotKeyHint")}</p>
                  </Field>
                  <Field label={t("auth.newPassword")} htmlFor="newPassword" error={fieldErrors.newPassword}>
                    <PasswordField id="newPassword" value={newPassword} onChange={setNewPassword} autoComplete="new-password" placeholder={t("auth.passwordMin")} />
                  </Field>
                  <Field label={t("auth.confirmPassword")} htmlFor="confirmPassword" error={fieldErrors.confirmPassword}>
                    <PasswordField id="confirmPassword" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
                  </Field>
                  <Button type="submit" size="lg" className="h-11 w-full bg-gradient-primary shadow-glow" disabled={isBusy}>
                    {isBusy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                    {isBusy ? t("auth.resetting") : t("auth.resetSubmit")}
                  </Button>
                </form>
                <p className="text-center text-sm text-muted-foreground">
                  <button type="button" className="font-medium text-primary hover:underline" onClick={() => switchMode("login")}>
                    {t("auth.backToLogin")}
                  </button>
                </p>
              </>
            )}

            {/* ---- CONNEXION / INSCRIPTION ---- */}
            {(mode === "login" || mode === "signup") && (
              <>
                <div className="space-y-1.5">
                  <h1 className="text-3xl font-bold">{showSignup ? t("auth.signupTitle") : t("auth.loginTitle")}</h1>
                  <p className="text-muted-foreground">{showSignup ? t("auth.signupSubtitle") : t("auth.loginSubtitle")}</p>
                </div>

                {signupOpen && (
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
                    {(["login", "signup"] as Mode[]).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={mode === tab}
                        onClick={() => switchMode(tab)}
                        className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${mode === tab ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {tab === "login" ? t("auth.loginTab") : t("auth.signupTab")}
                      </button>
                    ))}
                  </div>
                )}

                {sessionExpired && mode === "login" && !formSuccess && <Banner tone="info">{t("auth.sessionExpired")}</Banner>}
                {formSuccess && mode === "login" && <Banner tone="success">{formSuccess}</Banner>}
                {formError && <Banner tone="error">{formError}</Banner>}

                {showSignup ? (
                  <form onSubmit={submitSignup} className="space-y-4" noValidate>
                    <Field label={t("auth.restaurantName")} htmlFor="restaurantName" error={fieldErrors.restaurantName}>
                      <Input id="restaurantName" className="h-11" value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} placeholder={t("auth.restaurantNamePlaceholder")} autoComplete="organization" />
                    </Field>
                    <Field label={t("auth.yourName")} htmlFor="adminName" error={fieldErrors.name}>
                      <Input id="adminName" className="h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("auth.yourNamePlaceholder")} autoComplete="name" />
                    </Field>
                    <Field label={t("auth.email")} htmlFor="email" error={fieldErrors.email}>
                      <Input id="email" type="email" dir="ltr" className="h-11 text-start" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.emailPlaceholder")} autoComplete="email" />
                    </Field>
                    <Field label={t("auth.password")} htmlFor="password" error={fieldErrors.password}>
                      <PasswordField id="password" value={password} onChange={setPassword} autoComplete="new-password" placeholder={t("auth.passwordMin")} />
                    </Field>
                    <Field label={t("common.currency")} htmlFor="currency" error={fieldErrors.currency}>
                      <Select value={currency} onValueChange={(value) => setCurrency(value as Currency)}>
                        <SelectTrigger id="currency" className="h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CURRENCY_CODES.map((code) => (
                            <SelectItem key={code} value={code}>{t(`common.currency${code}`)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">{t("auth.currencyNote")}</p>
                    </Field>
                    <ActivationKeyNotice whatsapp={whatsapp} />
                    <Field label={t("auth.activationKey")} htmlFor="activationKey" error={fieldErrors.activationKey}>
                      <ActivationKeyInput value={activationKey} onChange={setActivationKey} />
                    </Field>
                    <Button type="submit" size="lg" className="h-11 w-full bg-gradient-primary shadow-glow" disabled={isBusy}>
                      {isBusy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                      {isBusy ? t("auth.creating") : t("auth.createRestaurant")}
                    </Button>
                  </form>
                ) : (
                  <form onSubmit={submitLogin} className="space-y-4" noValidate>
                    <Field label={t("auth.email")} htmlFor="email">
                      <Input id="email" type="email" dir="ltr" className="h-11 text-start" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.emailPlaceholder")} autoComplete="username" autoFocus />
                    </Field>
                    <Field label={t("auth.password")} htmlFor="password">
                      <PasswordField id="password" value={password} onChange={setPassword} autoComplete="current-password" />
                    </Field>
                    <div className="flex justify-end">
                      <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => switchMode("forgot")}>
                        {t("auth.forgotLink")}
                      </button>
                    </div>
                    <Button type="submit" size="lg" className="h-11 w-full bg-gradient-primary shadow-glow" disabled={isBusy}>
                      {isBusy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                      {isBusy ? t("auth.loggingIn") : t("auth.login")}
                    </Button>
                  </form>
                )}

                {!signupOpen && <p className="text-center text-sm text-muted-foreground">{t("auth.signupClosed")} {t("auth.signupClosedHint")}</p>}
                {signupOpen && (
                  <p className="text-center text-sm text-muted-foreground">
                    <button type="button" className="font-medium text-primary hover:underline" onClick={() => switchMode(showSignup ? "login" : "signup")}>
                      {showSignup ? t("auth.switchToLogin") : t("auth.switchToSignup")}
                    </button>
                  </p>
                )}

                {mode === "login" && whatsapp && (
                  <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm leading-none text-muted-foreground">
                    <span>{t("auth.needHelp")}</span>
                    <a
                      href={`https://wa.me/${whatsapp}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      dir="ltr"
                      className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                    >
                      <WhatsAppIcon className="h-5 w-5 shrink-0 text-[#25D366]" />
                      <span>+{whatsapp}</span>
                    </a>
                  </p>
                )}
              </>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
