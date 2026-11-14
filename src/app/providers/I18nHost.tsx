import { useCallback, useState, type PropsWithChildren } from "react";
import {
  I18nProvider,
  detectLocale,
  persistLocale,
  type Locale,
} from "@/shared/i18n";

/**
 * UI locale is a desktop preference. It is persisted locally and falls back to
 * the system language; it never changes the report locale stored in seo.toml.
 */
export function I18nHost({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<Locale>(() => detectLocale());
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
  }, []);

  return (
    <I18nProvider locale={locale} onLocaleChange={setLocale}>
      {children}
    </I18nProvider>
  );
}
