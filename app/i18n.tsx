"use client";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { translate, type Locale } from './locale';
import { resolveLocale } from './locale-preference';
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
function browserLocale() {
  let saved: string | null = null;
  try { saved = window.localStorage.getItem('crime-map-language'); } catch { /* Browser storage may be disabled. */ }
  return resolveLocale(new URLSearchParams(window.location.search).get('lang'), saved, navigator.languages?.length ? navigator.languages : [navigator.language]);
}
const LocaleContext = createContext<{locale: Locale; setLocale: (locale: Locale) => void}>({locale:'ru',setLocale:()=>{}});
export function LocaleProvider({children}: {children: ReactNode}) {
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [selected, setLanguage] = useState<Locale | null>(null);
  const locale = selected ?? (mounted ? browserLocale() : 'ru');
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  function setLocale(next: Locale) {
    setLanguage(next);
    try { window.localStorage.setItem('crime-map-language', next); } catch { /* Keep the choice for this visit. */ }
    const url = new URL(window.location.href); url.searchParams.set('lang', next);
    window.history.replaceState(null, '', url);
  }
  return <LocaleContext.Provider value={{locale,setLocale}}>{children}</LocaleContext.Provider>;
}
export function useI18n() {
  const value = useContext(LocaleContext);
  return {...value, t: (text: string, values?: Record<string, string | number>) => translate(text, value.locale, values)};
}
