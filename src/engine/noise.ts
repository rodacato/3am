import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { createRng, type SeedPart } from './random';

const cache = new Map<string, NoiseFunction2D>();

// Smooth wobble in roughly [-1, 1] for baselines such as traffic and CPU.
export function smoothNoise(...parts: SeedPart[]): (x: number, y?: number) => number {
  const key = parts.join('|');
  let fn = cache.get(key);
  if (!fn) {
    fn = createNoise2D(createRng('noise', ...parts).next);
    cache.set(key, fn);
  }
  const noise = fn;
  return (x, y = 0) => noise(x, y);
}
