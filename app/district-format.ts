const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII'];
const numberPattern = '(?:[1-9]\\d?|[IVX]+)';
function districtNumber(value: string) {
  const number = /^\d+$/.test(value) ? Number(value) : roman.indexOf(value.toUpperCase());
  return number >= 1 && number <= 23 ? roman[number] : null;
}

/** Presentation only: source facts and translation numeric validation stay intact. */
export function formatEnglishDistricts(text: string, districtLabel = false): string {
  let result = text
    .replace(new RegExp(`\\bDistrict\\s+(${numberPattern})(?:st|nd|rd|th)?\\b`, 'gi'), (match, n: string) => {
      const value = districtNumber(n); return value ? `District ${value}` : match;
    })
    .replace(new RegExp(`\\b(?:the\\s+)?(${numberPattern})(?:st|nd|rd|th)?\\.?\\s+(?:district|kerület)\\b`, 'gi'), (match, n: string) => {
      const value = districtNumber(n); return value ? `District ${value}` : match;
    });
  // The dedicated district label can also be just "20" or "XX · Pesterzsébet".
  if (districtLabel) result = result.replace(new RegExp(`^(Budapest[ ,·]+)?(${numberPattern})\\.?(?=$|\\s*[·,–—-])`, 'i'), (match, city: string, n: string) => {
    const value = districtNumber(n); return value ? `${city ?? ''}District ${value}` : match;
  });
  return result;
}
