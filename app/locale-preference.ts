import type { Locale } from './locale';

const supported = (value: string | null): value is Locale => value === 'ru' || value === 'en' || value === 'hu';

export function resolveLocale(query: string | null, saved: string | null, languages: readonly string[]): Locale {
  if (supported(query)) return query;
  if (supported(saved)) return saved;
  for (const language of languages) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (supported(base)) return base;
  }
  return 'en';
}
