import { describe, expect, it } from 'vitest';
import { formatEnglishDistricts } from './district-format';
import { translateContent } from './locale';

describe('English district formatting', () => {
  it('uses District + Roman numeral in both labels and prose', () => {
    for (const value of ['20', 'XX', '20th district', 'XX. district', 'District 20', '20. kerület']) {
      expect(formatEnglishDistricts(value, true)).toBe('District XX');
    }
    expect(formatEnglishDistricts('7 · Erzsébetváros', true)).toBe('District VII · Erzsébetváros');
    expect(formatEnglishDistricts('An attack in the 13th district near District 7.')).toBe('An attack in District XIII near District VII.');
    expect(formatEnglishDistricts('Budapest XX.', true)).toBe('Budapest District XX');
  });
  it('leaves unrelated numbers, unsupported district numbers and other locales intact', () => {
    const text = 'A 20-year-old at 20 Main Street took tram 4 at 20:00 on 20 September.';
    expect(formatEnglishDistricts(text)).toBe(text);
    expect(formatEnglishDistricts('District 24')).toBe('District 24');
    expect(formatEnglishDistricts('District XXIV')).toBe('District XXIV');
    expect(translateContent({ district: '20', title: 'District 20' }, 'ru')).toEqual({ district: '20', title: 'District 20' });
    expect(translateContent({ district: '20. kerület' }, 'hu')).toEqual({ district: '20. kerület' });
  });
  it('normalizes existing English translations in every nested display field without changing source links', () => {
    const source = { district: 'XX', title: 'Заголовок', updates: [{ detail: 'Текст' }], sourceUrl: 'https://example.com/20th-district' };
    expect(translateContent(source, 'en', { XX: '20', Заголовок: 'Incident in the 20th district', Текст: 'Police in District 20' })).toEqual({
      district: 'District XX', title: 'Incident in District XX', updates: [{ detail: 'Police in District XX' }], sourceUrl: source.sourceUrl,
    });
    expect(source.district).toBe('XX');
  });
});
