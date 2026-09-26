"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { translate, type Locale } from './locale';
const LocaleContext = createContext<{locale: Locale; setLocale: (locale: Locale) => void}>({locale:'ru',setLocale:()=>{}});
export function LocaleProvider({children}: {children: ReactNode}) {
  const [locale, setLanguage] = useState<Locale>('ru');
  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('lang');
    const saved = query ?? window.localStorage.getItem('crime-map-language');
    if (saved === 'ru' || saved === 'en' || saved === 'hu') setLanguage(saved);
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  function setLocale(next: Locale) {
    setLanguage(next); window.localStorage.setItem('crime-map-language', next);
    const url = new URL(window.location.href); url.searchParams.set('lang', next);
    window.history.replaceState(null, '', url);
  }
  return <LocaleContext.Provider value={{locale,setLocale}}>{children}</LocaleContext.Provider>;
}
export function useI18n() {
  const value = useContext(LocaleContext);
  return {...value, t: (text: string, values?: Record<string, string | number>) => translate(text, value.locale, values)};
}
