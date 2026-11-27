import { describe, it, expect } from 'vitest';
import { maskApiKey, DEFAULT_SETTINGS } from '@/core/storage/settings';

describe('Settings and Storage Utilities', () => {
  it('masks api key correctly', () => {
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey('12345')).toBe('••••••••');
    const key = 'AQ.Ab8RN6IEiQZBW919SE8ewyNR13yk4-7eg1roGG5sAw2YBoUH7w';
    const masked = maskApiKey(key);
    expect(masked.startsWith('AQ.Ab')).toBe(true);
    expect(masked.endsWith('H7w')).toBe(true);
    expect(masked.includes('••••••••')).toBe(true);
    expect(masked.includes('NR13yk4')).toBe(false); // Does not reveal sensitive middle portion
  });

  it('has proper default settings', () => {
    expect(DEFAULT_SETTINGS.autoTranslate).toBe(true);
    expect(DEFAULT_SETTINGS.holdVideo).toBe(true);
    expect(DEFAULT_SETTINGS.voice).toBe('f1');
    expect(DEFAULT_SETTINGS.originalVolume).toBe(0.15);
  });
});
