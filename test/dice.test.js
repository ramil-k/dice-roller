import { describe, it, expect } from 'vitest';
import { parseFormula, roll, poolToParsed } from '../src/dice.js';

describe('parseFormula', () => {
  it('parses d20 as one 20-sided die', () => {
    const p = parseFormula('d20');
    expect(p.terms).toHaveLength(1);
    expect(p.terms[0]).toMatchObject({ type: 'dice', count: 1, sides: 20 });
  });

  it('parses 2d6+3 into dice + modifier', () => {
    const p = parseFormula('2d6+3');
    expect(p.terms).toHaveLength(2);
    expect(p.terms[0]).toMatchObject({ count: 2, sides: 6 });
    expect(p.terms[1]).toMatchObject({ type: 'mod', value: 3, sign: 1 });
  });

  it('parses a negative modifier', () => {
    const p = parseFormula('1d8-2');
    expect(p.terms[1]).toMatchObject({ sign: -1, value: 2 });
  });

  it('parses keep-highest', () => {
    const p = parseFormula('4d6kh3');
    expect(p.terms[0].keep).toEqual({ mode: 'kh', n: 3 });
  });

  it('parses mixed dice and modifier', () => {
    const p = parseFormula('1d8+1d6+2');
    expect(p.terms).toHaveLength(3);
    expect(p.terms[2].value).toBe(2);
  });

  it('round-trips via toString', () => {
    expect(parseFormula('2d6+3').toString()).toBe('2d6 + 3');
    expect(parseFormula('1d8-2').toString()).toBe('1d8 - 2');
    expect(parseFormula('4d6kh3').toString()).toBe('4d6kh3');
  });

  it('rejects invalid input', () => {
    expect(() => parseFormula('')).toThrow();
    expect(() => parseFormula('2d6; drop')).toThrow();
    expect(() => parseFormula('5')).toThrow(); // no dice
    expect(() => parseFormula('2d6kh5')).toThrow(); // keep > count
  });
});

describe('roll', () => {
  it('keeps d20 within range', () => {
    for (let i = 0; i < 500; i++) {
      const r = roll(parseFormula('d20'));
      expect(r.total).toBeGreaterThanOrEqual(1);
      expect(r.total).toBeLessThanOrEqual(20);
    }
  });

  it('keeps 2d6+3 within 5..15', () => {
    for (let i = 0; i < 500; i++) {
      const r = roll(parseFormula('2d6+3'));
      expect(r.total).toBeGreaterThanOrEqual(5);
      expect(r.total).toBeLessThanOrEqual(15);
    }
  });

  it('4d6kh3 keeps the three highest and total matches', () => {
    for (let i = 0; i < 300; i++) {
      const r = roll(parseFormula('4d6kh3'));
      const rolls = r.terms[0].rolls;
      const kept = rolls.filter((d) => d.kept);
      expect(kept).toHaveLength(3);
      const top3 = [...rolls]
        .map((d) => d.value)
        .sort((a, b) => b - a)
        .slice(0, 3)
        .reduce((s, x) => s + x, 0);
      const keptSum = kept.reduce((s, d) => s + d.value, 0);
      expect(keptSum).toBe(top3);
      expect(r.total).toBe(keptSum);
    }
  });

  it('2d20kl1 keeps the lower die (disadvantage)', () => {
    for (let i = 0; i < 300; i++) {
      const r = roll(parseFormula('2d20kl1'));
      const rolls = r.terms[0].rolls;
      const kept = rolls.filter((d) => d.kept);
      expect(kept).toHaveLength(1);
      const min = Math.min(...rolls.map((d) => d.value));
      expect(kept[0].value).toBe(min);
      expect(r.total).toBe(min);
    }
  });

  it('subtracts a negative modifier', () => {
    for (let i = 0; i < 200; i++) {
      const r = roll(parseFormula('1d6-1'));
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.total).toBeLessThanOrEqual(5);
    }
  });

  it('mixed total equals subtotals + modifier', () => {
    for (let i = 0; i < 200; i++) {
      const r = roll(parseFormula('1d8+1d6+2'));
      expect(r.total).toBe(r.terms[0].subtotal + r.terms[1].subtotal + 2);
    }
  });
});

describe('poolToParsed (builder pool -> parsed)', () => {
  it('returns null for an empty pool (no dice = nothing to roll)', () => {
    expect(poolToParsed([], 0)).toBeNull();
    expect(poolToParsed([], 3)).toBeNull(); // a bare modifier is not a roll
  });

  it('groups same-sided dice into one term, in first-seen order', () => {
    const p = poolToParsed([20, 6, 6], 0);
    expect(p.terms).toHaveLength(2);
    expect(p.terms[0]).toMatchObject({ type: 'dice', count: 1, sides: 20 });
    expect(p.terms[1]).toMatchObject({ type: 'dice', count: 2, sides: 6 });
    expect(p.toString()).toBe('1d20 + 2d6');
  });

  it('appends a positive modifier term', () => {
    const p = poolToParsed([6, 6], 3);
    expect(p.terms[p.terms.length - 1]).toMatchObject({ type: 'mod', sign: 1, value: 3 });
    expect(p.toString()).toBe('2d6 + 3');
  });

  it('appends a negative modifier term', () => {
    const p = poolToParsed([8], -2);
    expect(p.terms[1]).toMatchObject({ type: 'mod', sign: -1, value: 2 });
    expect(p.toString()).toBe('1d8 - 2');
  });

  it('omits the modifier term when it is zero', () => {
    const p = poolToParsed([4], 0);
    expect(p.terms).toHaveLength(1);
    expect(p.terms.some((t) => t.type === 'mod')).toBe(false);
  });

  it('feeds roll() correctly: total stays within the pool bounds', () => {
    for (let i = 0; i < 200; i++) {
      const r = roll(poolToParsed([20, 6, 6], 2));
      // min = 1+1+1+2 = 5, max = 20+6+6+2 = 34
      expect(r.total).toBeGreaterThanOrEqual(5);
      expect(r.total).toBeLessThanOrEqual(34);
    }
  });
});
