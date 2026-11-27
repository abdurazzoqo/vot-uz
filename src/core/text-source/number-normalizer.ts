/**
 * Deterministic Uzbek number and entity normalizer for TTS.
 * Converts digits, currency symbols, percentages, and quantity abbreviations
 * into natural, fully spelled-out Uzbek words in Latin script.
 */

const ONES: string[] = ['', 'bir', 'ikki', 'uch', "to'rt", 'besh', 'olti', 'yetti', 'sakkiz', "to'qqiz"];
const TENS: string[] = ['', "o'n", 'yigirma', "o'ttiz", 'qirq', 'ellik', 'oltmish', 'yetmish', 'sakson', "to'qson"];

function convertUnder1000(n: number): string {
  if (n <= 0) return '';
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rem = n % 100;

  if (hundreds > 0) {
    if (hundreds === 1) {
      parts.push('bir yuz');
    } else {
      parts.push(`${ONES[hundreds]} yuz`);
    }
  }

  const tens = Math.floor(rem / 10);
  const units = rem % 10;

  if (tens > 0) {
    parts.push(TENS[tens]);
  }
  if (units > 0) {
    parts.push(ONES[units]);
  }

  return parts.join(' ');
}

export function integerToUzbekWords(n: number): string {
  if (n === 0) return 'nol';
  if (n < 0) return `minus ${integerToUzbekWords(-n)}`;

  const parts: string[] = [];

  const billions = Math.floor(n / 1_000_000_000);
  let rem = n % 1_000_000_000;

  const millions = Math.floor(rem / 1_000_000);
  rem = rem % 1_000_000;

  const thousands = Math.floor(rem / 1_000);
  rem = rem % 1_000;

  if (billions > 0) {
    parts.push(`${convertUnder1000(billions)} milliard`);
  }
  if (millions > 0) {
    parts.push(`${convertUnder1000(millions)} million`);
  }
  if (thousands > 0) {
    parts.push(`${convertUnder1000(thousands)} ming`);
  }
  if (rem > 0) {
    parts.push(convertUnder1000(rem));
  }

  return parts.join(' ').trim();
}

/**
 * Normalizes all numbers, currency signs, percentages, and quantity abbreviations
 * in Uzbek text into full Uzbek words in Latin script.
 */
export function normalizeUzbekNumbers(text: string): string {
  if (!text) return '';

  let res = text;

  // 1. Currency ranges like "$5 - $7", "$5-7", "5 - 7 $", "5-7 dollar"
  res = res.replace(/(?:\$|USD\s*)?(\d+)\s*[-–—]\s*(?:\$|USD\s*)?(\d+)\s*(?:\$|USD|dollar(?:lar)?)?\b/gi, (_m, g1, g2) => {
    const from = integerToUzbekWords(parseInt(g1, 10));
    const to = integerToUzbekWords(parseInt(g2, 10));
    return `${from} dollardan ${to} dollargacha `;
  });

  // 2. Quantities with abbreviations:
  // e.g. "32.5 ming", "2.6k", "733k", "733 тыс", "733 ming"
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*(?:k|тыс\.?|ming)(?=$|\s|[.,!?])/gi, (_m, numStr) => {
    const cleanNum = parseFloat(numStr.replace(',', '.'));
    const total = Math.round(cleanNum * 1000);
    return integerToUzbekWords(total);
  });

  // e.g. "1.5 mln", "2m", "2 million", "2 млн"
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*(?:m|mln|млн\.?|million)(?=$|\s|[.,!?])/gi, (_m, numStr) => {
    const cleanNum = parseFloat(numStr.replace(',', '.'));
    const total = Math.round(cleanNum * 1_000_000);
    return integerToUzbekWords(total);
  });

  // e.g. "1.2 milliard", "1.2b"
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*(?:b|mlrd|млрд\.?|milliard)(?=$|\s|[.,!?])/gi, (_m, numStr) => {
    const cleanNum = parseFloat(numStr.replace(',', '.'));
    const total = Math.round(cleanNum * 1_000_000_000);
    return integerToUzbekWords(total);
  });

  // 3. Currency amounts with prefixes/suffixes ($2,100, $2100, 2100$, 2 100$)
  res = res.replace(/\$\s*(\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\b/g, (_m, numStr) => {
    const clean = numStr.replace(/[\s,]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? _m : `${integerToUzbekWords(Math.round(num))} dollar`;
  });

  res = res.replace(/(\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:\$|USD)\b/g, (_m, numStr) => {
    const clean = numStr.replace(/[\s,]/g, '');
    const num = parseFloat(clean);
    return isNaN(num) ? _m : `${integerToUzbekWords(Math.round(num))} dollar`;
  });

  // Ruble and Euro symbols
  res = res.replace(/(?:₽|rubl)\s*(\d+)/gi, (_m, numStr) => `${integerToUzbekWords(parseInt(numStr, 10))} rubl`);
  res = res.replace(/(\d+)\s*(?:₽|rubl)\b/gi, (_m, numStr) => `${integerToUzbekWords(parseInt(numStr, 10))} rubl`);
  res = res.replace(/(?:€|yevro|euro)\s*(\d+)/gi, (_m, numStr) => `${integerToUzbekWords(parseInt(numStr, 10))} yevro`);
  res = res.replace(/(\d+)\s*(?:€|yevro|euro)\b/gi, (_m, numStr) => `${integerToUzbekWords(parseInt(numStr, 10))} yevro`);

  // 4. Percentages: "15%", "15 %", "%15", "5.5%"
  res = res.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_m, numStr) => {
    const parts = numStr.replace(',', '.').split('.');
    if (parts.length === 2) {
      return `${integerToUzbekWords(parseInt(parts[0], 10))} nuqta ${integerToUzbekWords(parseInt(parts[1], 10))} foiz`;
    }
    return `${integerToUzbekWords(parseInt(numStr, 10))} foiz`;
  });
  res = res.replace(/%\s*(\d+(?:[.,]\d+)?)/g, (_m, numStr) => {
    const parts = numStr.replace(',', '.').split('.');
    if (parts.length === 2) {
      return `${integerToUzbekWords(parseInt(parts[0], 10))} nuqta ${integerToUzbekWords(parseInt(parts[1], 10))} foiz`;
    }
    return `${integerToUzbekWords(parseInt(numStr, 10))} foiz`;
  });

  // 5. Formatted numbers with comma or space thousands separator:
  // e.g. "2,100", "733,000", "25,000", "4 905 218"
  res = res.replace(/\b\d{1,3}(?:,\d{3})+\b/g, (match) => {
    const clean = match.replace(/,/g, '');
    const num = parseInt(clean, 10);
    return isNaN(num) ? match : integerToUzbekWords(num);
  });

  res = res.replace(/\b\d{1,3}(?:\s\d{3})+\b/g, (match) => {
    const clean = match.replace(/\s/g, '');
    const num = parseInt(clean, 10);
    return isNaN(num) ? match : integerToUzbekWords(num);
  });

  // 6. Decimals: e.g. "2.5" -> "ikki nuqta besh"
  res = res.replace(/\b(\d+)[.,](\d+)\b/g, (_m, intPart, decPart) => {
    return `${integerToUzbekWords(parseInt(intPart, 10))} nuqta ${integerToUzbekWords(parseInt(decPart, 10))}`;
  });

  // 7. Plain standalone integers: e.g. "733", "2027", "63"
  res = res.replace(/\b\d+\b/g, (match) => {
    const num = parseInt(match, 10);
    return isNaN(num) ? match : integerToUzbekWords(num);
  });

  // 8. Clean up multiple spaces and punctuation spacing
  res = res.replace(/\s+/g, ' ').trim();

  return res;
}
