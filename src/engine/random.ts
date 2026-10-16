import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import { uniformFloat64 } from 'pure-rand/distribution/uniformFloat64';

export type Rng = {
  next(): number;
  int(maxExclusive: number): number;
  normal(): number;
  lognormal(median: number, sigma: number): number;
  chance(probability: number): boolean;
  hex(length: number): string;
  pick<T>(items: readonly T[]): T;
};

export type SeedPart = string | number;

// FNV-1a over the parts: cheap and identical in Node and every browser.
export function hashSeed(...parts: SeedPart[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2f;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Streams are keyed by a path (seed, minute, purpose) so no value depends on what was drawn before it.
export function createRng(...parts: SeedPart[]): Rng {
  const generator = xoroshiro128plus(hashSeed(...parts));
  const next = () => uniformFloat64(generator);
  let spareNormal: number | null = null;

  const normal = () => {
    if (spareNormal !== null) {
      const value = spareNormal;
      spareNormal = null;
      return value;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const radius = Math.sqrt(-2 * Math.log(u));
    spareNormal = radius * Math.sin(2 * Math.PI * v);
    return radius * Math.cos(2 * Math.PI * v);
  };

  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    normal,
    lognormal: (median, sigma) => median * Math.exp(sigma * normal()),
    chance: (probability) => next() < probability,
    hex: (length) => {
      let out = '';
      for (let i = 0; i < length; i++) out += Math.floor(next() * 16).toString(16);
      return out;
    },
    pick: (items) => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error('pick from an empty list');
      return item;
    },
  };
}
