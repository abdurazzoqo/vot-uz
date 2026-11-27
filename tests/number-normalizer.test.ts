import { describe, it, expect } from 'vitest';
import { integerToUzbekWords, normalizeUzbekNumbers } from '../src/core/text-source/number-normalizer';

describe('Uzbek Number Normalizer', () => {
  it('converts basic integers to Uzbek words', () => {
    expect(integerToUzbekWords(0)).toBe('nol');
    expect(integerToUzbekWords(5)).toBe('besh');
    expect(integerToUzbekWords(10)).toBe("o'n");
    expect(integerToUzbekWords(25)).toBe('yigirma besh');
    expect(integerToUzbekWords(100)).toBe('bir yuz');
    expect(integerToUzbekWords(733)).toBe("yetti yuz o'ttiz uch");
    expect(integerToUzbekWords(1000)).toBe('bir ming');
    expect(integerToUzbekWords(2100)).toBe('ikki ming bir yuz');
    expect(integerToUzbekWords(12100)).toBe("o'n ikki ming bir yuz");
    expect(integerToUzbekWords(733000)).toBe("yetti yuz o'ttiz uch ming");
    expect(integerToUzbekWords(2000000)).toBe('ikki million');
    expect(integerToUzbekWords(2027)).toBe('ikki ming yigirma yetti');
  });

  it('normalizes 733k / 733 ming correctly (no millions)', () => {
    expect(normalizeUzbekNumbers("kanal 733 ming ko'rish to'pladi")).toBe("kanal yetti yuz o'ttiz uch ming ko'rish to'pladi");
    expect(normalizeUzbekNumbers("kanal 733k ko'rish to'pladi")).toBe("kanal yetti yuz o'ttiz uch ming ko'rish to'pladi");
    expect(normalizeUzbekNumbers("733000 ko'rish")).toBe("yetti yuz o'ttiz uch ming ko'rish");
  });

  it('normalizes $2,100 / 2,100 dollars correctly (no twelve thousand)', () => {
    expect(normalizeUzbekNumbers("daromad $2,100 bo'ldi")).toBe("daromad ikki ming bir yuz dollar bo'ldi");
    expect(normalizeUzbekNumbers("daromad 2100 dollar bo'ldi")).toBe("daromad ikki ming bir yuz dollar bo'ldi");
    expect(normalizeUzbekNumbers("daromad $2100 bo'ldi")).toBe("daromad ikki ming bir yuz dollar bo'ldi");
    expect(normalizeUzbekNumbers("daromad 2.1k dollar")).toBe("daromad ikki ming bir yuz dollar");
  });

  it('normalizes ranges and percentages', () => {
    expect(normalizeUzbekNumbers("RPM $5-7 tashkil etadi")).toBe("RPM besh dollardan yetti dollargacha tashkil etadi");
    expect(normalizeUzbekNumbers("15% daromad")).toBe("o'n besh foiz daromad");
  });

  it('normalizes large numbers and decimals', () => {
    expect(normalizeUzbekNumbers("32.5 ming obunachi")).toBe("o'ttiz ikki ming besh yuz obunachi");
    expect(normalizeUzbekNumbers("25 000 dollar")).toBe("yigirma besh ming dollar");
    expect(normalizeUzbekNumbers("2.6 тыс dollar")).toBe("ikki ming olti yuz dollar");
    expect(normalizeUzbekNumbers("4 905 218 ko'rish")).toBe("to'rt million to'qqiz yuz besh ming ikki yuz o'n sakkiz ko'rish");
  });

  it('preserves existing Uzbek words untouched', () => {
    expect(normalizeUzbekNumbers("u yetti yuz o'ttiz uch ming ko'rish to'pladi")).toBe("u yetti yuz o'ttiz uch ming ko'rish to'pladi");
    expect(normalizeUzbekNumbers("daromad ikki ming bir yuz dollar")).toBe("daromad ikki ming bir yuz dollar");
  });

  it('correctly handles the full sentence from the user report', () => {
    const raw = "Bu kanalda 733k ko'rish va $2,100 daromad bo'ldi";
    const normalized = normalizeUzbekNumbers(raw);
    expect(normalized).toBe("Bu kanalda yetti yuz o'ttiz uch ming ko'rish va ikki ming bir yuz dollar daromad bo'ldi");
    expect(normalized.includes("million")).toBe(false);
    expect(normalized.includes("o'n ikki ming")).toBe(false);
  });
});
