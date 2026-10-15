// Seeded RNG whose whole state is one uint32, so it can live inside a
// serialisable game state. mulberry32: tiny, fast, and good enough for card
// shuffles; not for anything cryptographic.

export function nextRandom(state: number): [value: number, state: number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, s];
}

/** Mixes an arbitrary number (e.g. Date.now()) into a usable seed. */
export function seedFrom(n: number): number {
  return nextRandom(n >>> 0)[1] ^ 0x9e3779b9;
}

/** Mutable cursor over an RNG state, for use inside one engine step. */
export class Rng {
  constructor(public state: number) {}

  next(): number {
    const [v, s] = nextRandom(this.state);
    this.state = s;
    return v;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from empty list');
    return items[this.int(items.length)] as T;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /** Up to n distinct items, in random order. */
  sample<T>(items: readonly T[], n: number): T[] {
    return this.shuffle(items.slice()).slice(0, n);
  }
}
