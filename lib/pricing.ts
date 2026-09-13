import { getPricingConfig } from './db';

// Rough sq-inch proxies per size label — a studio can refine these later
const SIZE_TO_SQIN: Record<string, number> = {
  small: 9, // ~3x3 in
  medium: 30, // ~6x5 in
  large: 70, // ~10x7 in
  sleeve: 250 // full sleeve, very rough
};

export interface QuoteResult {
  low: number;
  high: number;
  breakdown: string;
}

export function calculateQuote(
  studioId: string,
  sizeLabel: string,
  placement: string,
  style: string
): QuoteResult | null {
  const config = getPricingConfig(studioId);
  if (!config) return null;

  const sqIn = SIZE_TO_SQIN[sizeLabel] ?? SIZE_TO_SQIN['medium'];

  const placementKey = normalizeKey(placement, Object.keys(config.placement_multipliers));
  const styleKey = normalizeKey(style, Object.keys(config.style_multipliers));

  const placementMult = config.placement_multipliers[placementKey] ?? 1.0;
  const styleMult = config.style_multipliers[styleKey] ?? 1.0;

  const rawPrice = sqIn * config.base_rate_per_sq_in * placementMult * styleMult;
  const price = Math.max(rawPrice, config.min_price);

  // Give a range, not a false-precision single number — real quotes vary with
  // detail level and the artist's final assessment
  const low = Math.round((price * 0.9) / 50) * 50;
  const high = Math.round((price * 1.15) / 50) * 50;

  return {
    low,
    high,
    breakdown: `${sqIn} sq.in base × placement(${placementKey}: ${placementMult}) × style(${styleKey}: ${styleMult})`
  };
}

export function calculateDeposit(studioId: string, quotedHigh: number): number {
  const config = getPricingConfig(studioId);
  if (!config) return 0;
  return Math.round((quotedHigh * config.deposit_percent) / 100 / 50) * 50;
}

function normalizeKey(input: string, validKeys: string[]): string {
  const cleaned = input.toLowerCase().trim().replace(/\s+/g, '_');
  if (validKeys.includes(cleaned)) return cleaned;
  // fuzzy fallback: partial match
  const match = validKeys.find((k) => cleaned.includes(k) || k.includes(cleaned));
  return match ?? validKeys[0];
}
