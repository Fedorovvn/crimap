import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {LocaleProvider, useI18n} from './i18n';
import {resolveLocale} from './locale-preference';

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); window.history.replaceState(null, '', '/'); });

describe('language preference', () => {
  it('matches regional browser languages in preference order and defaults to English', () => {
    expect(resolveLocale(null, null, ['hu-HU', 'en-US'])).toBe('hu');
    expect(resolveLocale(null, null, ['de-DE', 'ru-RU', 'en'])).toBe('ru');
    expect(resolveLocale(null, null, ['en-GB', 'hu'])).toBe('en');
    expect(resolveLocale(null, null, ['de-DE'])).toBe('en');
    expect(resolveLocale(null, 'ru', ['hu-HU'])).toBe('ru');
    expect(resolveLocale('hu', 'ru', ['en-US'])).toBe('hu');
    expect(resolveLocale('bad', 'bad', ['hu-HU'])).toBe('hu');
  });
  it('starts in the browser language, then remembers an explicit choice on a new visit', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['hu-HU']);
    function Example() { const {locale, setLocale} = useI18n(); return <button onClick={() => setLocale('ru')}>{locale}</button>; }
    const view = render(<LocaleProvider><Example /></LocaleProvider>);
    expect(screen.getByRole('button').textContent).toBe('hu');
    await userEvent.setup().click(screen.getByRole('button'));
    expect(document.documentElement.lang).toBe('ru');
    expect(window.localStorage.getItem('crime-map-language')).toBe('ru');
    view.unmount();
    window.history.replaceState(null, '', '/');
    render(<LocaleProvider><Example /></LocaleProvider>);
    expect(screen.getByRole('button').textContent).toBe('ru');
  });
});
