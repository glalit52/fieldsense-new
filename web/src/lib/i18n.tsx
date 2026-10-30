import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/** Interface languages. Translations are keyed by the English text, so a missing entry simply shows English. */
export const LANGUAGES = [
  { code: "en", name: "English" }, { code: "hi", name: "हिन्दी" }, { code: "mr", name: "मराठी" }, { code: "pa", name: "ਪੰਜਾਬੀ" },
  { code: "bn", name: "বাংলা" }, { code: "ta", name: "தமிழ்" }, { code: "te", name: "తెలుగు" },
] as const;
export type Lang = (typeof LANGUAGES)[number]["code"];
type Dict = Record<string, string>;
type Vars = Record<string, string | number>;

const STORAGE_KEY = "fieldsense.lang";
const isLang = (v: unknown): v is Lang => LANGUAGES.some((l) => l.code === v);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {}
  const browser = navigator.language?.slice(0, 2);
  return isLang(browser) ? browser : "en";
}

/** The current language for code outside React (the Agris request). */
let current: Lang = "en";
export const currentLang = () => current;

const interpolate = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : s);

interface I18n { lang: Lang; setLang: (l: Lang) => void; t: (text: string, vars?: Vars) => string }
const Ctx = createContext<I18n>({ lang: "en", setLang: () => {}, t: interpolate });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [dict, setDict] = useState<Dict>({});
  current = lang;

  useEffect(() => {
    document.documentElement.lang = lang;
    if (lang === "en") return void setDict({});
    let cancelled = false;
    // One small JSON per language, loaded on demand.
    import(`../i18n/${lang}.json`).then((m) => { if (!cancelled) setDict(m.default as Dict); }).catch(() => setDict({}));
    return () => { cancelled = true; };
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);
  const t = useCallback((text: string, vars?: Vars) => interpolate(dict[text] || text, vars), [dict]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;

/** Dates in the interface language, e.g. "Thu, 29 Oct". */
export function useDateFormat() {
  const { lang } = useI18n();
  const locale = lang === "en" ? undefined : `${lang}-IN`;
  return useCallback((iso: string, o: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
    new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString(locale, o), [locale]);
}

export function LanguagePicker() {
  const { lang, setLang, t } = useI18n();
  return (
    <select className="lang-picker" aria-label={t("Language")} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
      {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
    </select>
  );
}
