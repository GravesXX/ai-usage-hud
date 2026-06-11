export interface ModelPrice { in: number; out: number; cacheRead: number; cacheWrite: number }

// Ordered: first substring match wins.
const PRICES: Array<[match: string, price: ModelPrice]> = [
  ["opus-4-5", { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ["opus-4-6", { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ["opus-4", { in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  ["sonnet-4", { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ["haiku-4", { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
];
const DEFAULT: ModelPrice = { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 };

export function priceFor(model: string): ModelPrice {
  for (const [match, price] of PRICES) if (model.includes(match)) return price;
  return DEFAULT;
}
