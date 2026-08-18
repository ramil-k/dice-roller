import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { CATEGORIES, iconUrl } from '../src/battle-mat/registry.js';

describe('CATEGORIES', () => {
  it('starts with humanoids, animals, monsters', () => {
    expect(CATEGORIES.slice(0, 3).map((c) => c.id)).toEqual(['humanoids', 'animals', 'monsters']);
  });

  it('every category has a unique id, a label and icons', () => {
    const ids = new Set();
    for (const cat of CATEGORIES) {
      expect(cat.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(ids.has(cat.id)).toBe(false);
      ids.add(cat.id);
      expect(cat.label.length).toBeGreaterThan(0);
      expect(cat.icons.length).toBeGreaterThan(0);
    }
  });

  it('every icon has an ASCII name and an svg path, unique within its category', () => {
    for (const cat of CATEGORIES) {
      const paths = new Set();
      for (const icon of cat.icons) {
        // printable ASCII only — catches emoji and stray non-Latin characters
        expect(icon.name).toMatch(/^[\x20-\x7e]+$/);
        expect(icon.path).toMatch(/^[^/]+\/.+\.svg$/);
        expect(paths.has(icon.path)).toBe(false);
        paths.add(icon.path);
      }
    }
  });

  it('every icon path has its SVG checked in under public/365/', () => {
    for (const cat of CATEGORIES) {
      for (const icon of cat.icons) {
        const file = fileURLToPath(new URL(`../public/365/${icon.path}`, import.meta.url));
        expect(existsSync(file), `missing ${icon.path}`).toBe(true);
      }
    }
  });
});

describe('iconUrl', () => {
  it('builds an absolute https URL from a registry path', () => {
    const url = iconUrl({ name: 'Knight', path: '090-human/knight.svg' });
    expect(url).toBe('https://ramil-k.github.io/dice-roller/365/090-human/knight.svg');
  });

  it('prefers an explicit url when present (roster entries)', () => {
    expect(iconUrl({ name: 'Aria', url: 'https://example.com/aria.png' })).toBe('https://example.com/aria.png');
  });

  it('produces https URLs for the whole registry', () => {
    for (const cat of CATEGORIES) {
      for (const icon of cat.icons) {
        expect(iconUrl(icon)).toMatch(/^https:\/\/ramil-k\.github\.io\/dice-roller\/365\/.+\.svg$/);
      }
    }
  });
});
