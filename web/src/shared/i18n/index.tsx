import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Globe } from "lucide-react";

// Traductions partagées par les trois interfaces (client, caisse, admin) : anglais, français, allemand, arabe.
// L'arabe s'écrit de droite à gauche : <html dir="rtl"> est posé automatiquement, utilisez les classes logiques
// de Tailwind (ms-/me-/ps-/pe-/text-start/text-end) plutôt que ml-/mr-/pl-/pr-/text-left/text-right.

export type Lang = "en" | "fr" | "de" | "ar";

export const LANGUAGES: { code: Lang; label: string; dir: "ltr" | "rtl"; locale: string }[] = [
  { code: "en", label: "English", dir: "ltr", locale: "en-GB" },
  { code: "fr", label: "Français", dir: "ltr", locale: "fr-FR" },
  { code: "de", label: "Deutsch", dir: "ltr", locale: "de-DE" },
  // chiffres latins (0-9) : l'usage dans les restaurants et sur les tickets
  { code: "ar", label: "العربية", dir: "rtl", locale: "ar-u-nu-latn" },
];

/** Un dictionnaire par langue. L'anglais est la référence : une clé absente d'une autre langue retombe sur l'anglais. */
export type Dictionary = { en: Record<string, string> } & Partial<Record<Lang, Record<string, string>>>;

export type TranslateParams = Record<string, string | number>;
export type Translate = (key: string, params?: TranslateParams) => string;

/** Fusionne plusieurs dictionnaires (le dernier gagne en cas de clé commune) */
export function mergeDictionaries(...dictionaries: Dictionary[]): Dictionary {
  const merged: Dictionary = { en: {}, fr: {}, de: {}, ar: {} };
  for (const dictionary of dictionaries) {
    for (const lang of ["en", "fr", "de", "ar"] as Lang[]) Object.assign(merged[lang] as Record<string, string>, dictionary[lang] ?? {});
  }
  return merged;
}

export type MoneyFormatter = (amount: number, currency?: string | null) => string;

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  dir: "ltr" | "rtl";
  isRtl: boolean;
  /** Code de langue pour Intl (dates, nombres) */
  locale: string;
  /** t("clé") ou t("clé", { name: "Ali" }) pour « Bonjour {name} » ; t("clé", { count: 3 }) choisit clé_one / clé_other */
  t: Translate;
  /** 12,5 EUR -> « 12,50 € » / « €12.50 » selon la langue ; devise : "EUR", "USD" ou "DZD" */
  money: MoneyFormatter;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** Date et heure d'une date, dans le fuseau du restaurant si fourni */
  formatDateTime: (value: Date | string, timeZone?: string | null) => string;
  formatDate: (value: Date | string, timeZone?: string | null, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const isLang = (value: unknown): value is Lang => value === "en" || value === "fr" || value === "de" || value === "ar";

function readStoredLang(storageKey: string, fallback: Lang): Lang {
  try {
    const stored = localStorage.getItem(storageKey);
    if (isLang(stored)) return stored;
  } catch {
    // stockage indisponible
  }
  // Première visite : langue du navigateur si on la propose
  const browser = (navigator.language || "").slice(0, 2).toLowerCase();
  return isLang(browser) ? browser : fallback;
}

const interpolate = (text: string, params?: TranslateParams) =>
  params ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text;

interface ProviderProps {
  dictionary: Dictionary;
  /** Clé localStorage où la langue choisie est gardée (une par interface) */
  storageKey: string;
  defaultLang?: Lang;
  children: ReactNode;
}

export function I18nProvider({ dictionary, storageKey, defaultLang = "en", children }: ProviderProps) {
  const [lang, setLangState] = useState<Lang>(() => readStoredLang(storageKey, defaultLang));
  const meta = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // stockage indisponible
    }
  }, [storageKey]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = meta.dir;
  }, [lang, meta.dir]);

  const value = useMemo<I18nContextValue>(() => {
    const plural = new Intl.PluralRules(meta.locale);
    const t: Translate = (key, params) => {
      const table = dictionary[lang] ?? {};
      let text: string | undefined;
      if (params && typeof params.count === "number") {
        const rule = plural.select(params.count); // one | other | few | many | zero | two
        text = table[`${key}_${rule}`] ?? table[`${key}_other`] ?? dictionary.en[`${key}_${rule}`] ?? dictionary.en[`${key}_other`];
      }
      text = text ?? table[key] ?? dictionary.en[key] ?? key;
      return interpolate(text, params);
    };

    const money: MoneyFormatter = (amount, currency) => {
      const value = Number.isFinite(amount) ? amount : 0;
      if (currency === "EUR" || currency === "USD" || currency === "DZD") {
        return new Intl.NumberFormat(meta.locale, { style: "currency", currency }).format(value);
      }
      return new Intl.NumberFormat(meta.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    };

    const toDate = (value: Date | string) => (value instanceof Date ? value : parseServerDate(value));
    const safeZone = (timeZone?: string | null) => {
      if (!timeZone) return undefined;
      try {
        new Intl.DateTimeFormat("en", { timeZone });
        return timeZone;
      } catch {
        return undefined;
      }
    };

    return {
      lang,
      setLang,
      dir: meta.dir,
      isRtl: meta.dir === "rtl",
      locale: meta.locale,
      t,
      money,
      formatNumber: (n, options) => new Intl.NumberFormat(meta.locale, options).format(n),
      formatDate: (v, timeZone, options = { dateStyle: "short" }) =>
        new Intl.DateTimeFormat(meta.locale, { ...options, timeZone: safeZone(timeZone) }).format(toDate(v)),
      formatDateTime: (v, timeZone) =>
        new Intl.DateTimeFormat(meta.locale, { dateStyle: "short", timeStyle: "short", timeZone: safeZone(timeZone) }).format(toDate(v)),
    };
  }, [dictionary, lang, meta, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside <I18nProvider>");
  return context;
}

/** Dates enregistrées par le serveur en UTC ("AAAA-MM-JJ HH:MM:SS") -> Date */
export const parseServerDate = (value: string) => new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");

/** Sélecteur de langue compact (liste native : fonctionne partout, y compris sur téléphone) */
export function LanguageSwitcher({ className = "", tone = "default" }: { className?: string; tone?: "default" | "light" }) {
  const { lang, setLang, t } = useI18n();
  const colors = tone === "light"
    ? "border-white/40 bg-white/10 text-white [&>option]:text-black"
    : "border-border bg-background text-foreground";
  return (
    <label className={`inline-flex items-center gap-1.5 text-sm ${className}`}>
      <Globe className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
      <span className="sr-only">{t("lang.label")}</span>
      <select
        value={lang}
        onChange={(event) => setLang(event.target.value as Lang)}
        aria-label={t("lang.label")}
        className={`h-8 rounded-md border px-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 ${colors}`}
      >
        {LANGUAGES.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
