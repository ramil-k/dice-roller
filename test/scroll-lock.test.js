import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lockScroll, unlockScroll } from '../src/scroll-lock.js';

describe('scroll lock', () => {
  let style;
  beforeEach(() => {
    style = { overflow: '', scrollbarGutter: '' };
    globalThis.document = { documentElement: { style } };
  });
  afterEach(() => {
    delete globalThis.document;
  });

  it('locks and restores the previous inline values', () => {
    style.overflow = 'auto';
    const a = {};
    lockScroll(a);
    expect(style).toEqual({ overflow: 'hidden', scrollbarGutter: 'stable' });
    unlockScroll(a);
    expect(style).toEqual({ overflow: 'auto', scrollbarGutter: '' });
  });

  it('stays locked until the last owner releases it', () => {
    const a = {};
    const b = {};
    lockScroll(a);
    lockScroll(b);
    unlockScroll(a);
    expect(style.overflow).toBe('hidden');
    unlockScroll(b);
    expect(style.overflow).toBe('');
  });

  it('ignores a repeated lock and an unlock by a non-owner', () => {
    const a = {};
    lockScroll(a);
    lockScroll(a);
    unlockScroll({});
    expect(style.overflow).toBe('hidden');
    unlockScroll(a);
    expect(style.overflow).toBe('');
  });
});
