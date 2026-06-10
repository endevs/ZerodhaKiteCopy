export type IndexUnderlying = 'NIFTY' | 'BANKNIFTY';

export type LegType = 'option' | 'future';

export interface PositionInput {
  tradingsymbol?: string;
  exchange?: string;
  quantity?: number;
  buy_price?: number;
  sell_price?: number;
  last_price?: number;
}

export interface ParsedLeg {
  tradingsymbol: string;
  underlying: IndexUnderlying;
  legType: LegType;
  optionType?: 'CE' | 'PE';
  strike?: number;
  quantity: number;
  entryPrice: number;
}

export interface PayoffPoint {
  spot: number;
  pnl: number;
}

export interface PayoffGroup {
  underlying: IndexUnderlying;
  legs: ParsedLeg[];
  excludedSymbols: string[];
  hasMixedExpiries: boolean;
}

export interface PayoffCurveResult {
  points: PayoffPoint[];
  breakevens: number[];
  maxProfit: number;
  maxLoss: number;
  spotMin: number;
  spotMax: number;
}

const INDEX_UNDERLYINGS: IndexUnderlying[] = ['NIFTY', 'BANKNIFTY'];

const MONTHLY_EXPIRY_RE =
  /^(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d+)$/i;

const STRIKE_BOUNDS: Record<IndexUnderlying, { min: number; max: number; step: number }> = {
  NIFTY: { min: 5000, max: 60000, step: 50 },
  BANKNIFTY: { min: 15000, max: 100000, step: 100 },
};

interface ParsedOptionMeta {
  strike: number;
  optionType: 'CE' | 'PE';
  expiryKey: string;
}

/** Parse NFO index option symbol (weekly numeric or monthly named expiry). */
function parseIndexOptionSymbol(
  symbol: string,
  underlying: IndexUnderlying
): ParsedOptionMeta | null {
  const upper = symbol.toUpperCase();
  const optSuffix = upper.match(/(CE|PE)$/);
  if (!optSuffix) return null;

  const optionType = optSuffix[1].toUpperCase() as 'CE' | 'PE';
  const rest = upper.slice(underlying.length, -2);
  if (!rest) return null;

  const monthly = rest.match(MONTHLY_EXPIRY_RE);
  if (monthly) {
    const strike = parseInt(monthly[3], 10);
    const bounds = STRIKE_BOUNDS[underlying];
    if (!Number.isFinite(strike) || strike < bounds.min || strike > bounds.max) return null;
    return {
      strike,
      optionType,
      expiryKey: `${monthly[1]}${monthly[2].toUpperCase()}`,
    };
  }

  if (!/^\d+$/.test(rest)) return null;

  const yy = rest.slice(0, 2);
  const afterYear = rest.slice(2);
  const bounds = STRIKE_BOUNDS[underlying];

  for (let len = 5; len >= 4; len--) {
    if (afterYear.length <= len) continue;
    const strike = parseInt(afterYear.slice(-len), 10);
    if (!Number.isFinite(strike)) continue;
    if (strike % bounds.step !== 0) continue;
    if (strike < bounds.min || strike > bounds.max) continue;

    const expiryPart = afterYear.slice(0, -len);
    if (expiryPart.length < 3 || expiryPart.length > 5) continue;

    return {
      strike,
      optionType,
      expiryKey: `${yy}${expiryPart}`,
    };
  }

  return null;
}

function detectUnderlying(symbol: string): IndexUnderlying | null {
  const upper = symbol.toUpperCase();
  if (upper.startsWith('BANKNIFTY')) return 'BANKNIFTY';
  if (upper.startsWith('NIFTY')) return 'NIFTY';
  return null;
}

function parseLeg(position: PositionInput): ParsedLeg | null {
  const symbol = (position.tradingsymbol || '').trim();
  const qty = Number(position.quantity);
  if (!symbol || !Number.isFinite(qty) || qty === 0) return null;

  const underlying = detectUnderlying(symbol);
  if (!underlying) return null;

  const buyPrice = Number(position.buy_price);
  const sellPrice = Number(position.sell_price);
  const entryPrice = qty > 0 ? buyPrice : sellPrice;
  if (!Number.isFinite(entryPrice)) return null;

  const optionMeta = parseIndexOptionSymbol(symbol, underlying);
  if (optionMeta) {
    return {
      tradingsymbol: symbol,
      underlying,
      legType: 'option',
      optionType: optionMeta.optionType,
      strike: optionMeta.strike,
      quantity: qty,
      entryPrice,
    };
  }

  if (position.exchange === 'NFO' || symbol.length > underlying.length) {
    return {
      tradingsymbol: symbol,
      underlying,
      legType: 'future',
      quantity: qty,
      entryPrice,
    };
  }

  return null;
}

function legPayoffAtSpot(leg: ParsedLeg, spot: number): number {
  const { quantity: qty, entryPrice: entry } = leg;
  if (leg.legType === 'future') {
    return qty * (spot - entry);
  }
  const strike = leg.strike ?? 0;
  const intrinsic =
    leg.optionType === 'CE'
      ? Math.max(spot - strike, 0)
      : Math.max(strike - spot, 0);
  return qty * (intrinsic - entry);
}

function expiryKeyFromSymbol(symbol: string, underlying: IndexUnderlying): string | null {
  const meta = parseIndexOptionSymbol(symbol, underlying);
  return meta?.expiryKey ?? null;
}

export function buildPayoffGroups(positions: PositionInput[]): PayoffGroup[] {
  const legsByUnderlying: Record<IndexUnderlying, ParsedLeg[]> = {
    NIFTY: [],
    BANKNIFTY: [],
  };
  const excluded: string[] = [];

  for (const pos of positions) {
    const qty = Number(pos.quantity);
    if (!Number.isFinite(qty) || qty === 0) continue;

    const parsed = parseLeg(pos);
    if (parsed) {
      legsByUnderlying[parsed.underlying].push(parsed);
    } else if (pos.tradingsymbol) {
      excluded.push(pos.tradingsymbol);
    }
  }

  return INDEX_UNDERLYINGS.map((underlying) => {
    const legs = legsByUnderlying[underlying];
    const expiryKeys = new Set(
      legs
        .map((l) => expiryKeyFromSymbol(l.tradingsymbol, underlying))
        .filter((k): k is string => Boolean(k))
    );
    return {
      underlying,
      legs,
      excludedSymbols: excluded,
      hasMixedExpiries: expiryKeys.size > 1,
    };
  }).filter((g) => g.legs.length > 0);
}

export type PayoffZoomPreset = 'default' | 'wide' | 'full';

export const PAYOFF_SPOT_HALF_RANGE: Record<
  IndexUnderlying,
  Record<'default' | 'wide', number>
> = {
  NIFTY: { default: 1100, wide: 2200 },
  BANKNIFTY: { default: 2200, wide: 4400 },
};

function resolveSpotCenter(
  legs: ParsedLeg[],
  spot: number | undefined
): number {
  const strikes = legs
    .filter((l) => l.legType === 'option' && l.strike != null)
    .map((l) => l.strike as number);
  const entries = legs.map((l) => l.entryPrice);

  if (spot != null && Number.isFinite(spot)) return spot;
  if (strikes.length > 0) {
    return strikes.reduce((a, b) => a + b, 0) / strikes.length;
  }
  if (entries.length > 0) {
    return entries.reduce((a, b) => a + b, 0) / entries.length;
  }
  return 24000;
}

export function resolvePayoffHalfRange(
  underlying: IndexUnderlying,
  preset: PayoffZoomPreset,
  customHalfRange?: number | null
): number | null {
  if (preset === 'full') return null;
  if (customHalfRange != null && Number.isFinite(customHalfRange) && customHalfRange > 0) {
    return customHalfRange;
  }
  return PAYOFF_SPOT_HALF_RANGE[underlying][preset];
}

/** Legacy wide range: 12% buffer + strike expansion (Full preset). */
export function computeWideSpotRange(
  legs: ParsedLeg[],
  spot: number | undefined
): { min: number; max: number } {
  const strikes = legs
    .filter((l) => l.legType === 'option' && l.strike != null)
    .map((l) => l.strike as number);
  const center = resolveSpotCenter(legs, spot);

  const strikeMin = strikes.length ? Math.min(...strikes) : center;
  const strikeMax = strikes.length ? Math.max(...strikes) : center;
  const buffer = Math.max(center * 0.12, 500);

  const min = Math.min(strikeMin, center) - buffer;
  const max = Math.max(strikeMax, center) + buffer;
  return { min: Math.max(0, min), max };
}

export function computeSpotRange(
  legs: ParsedLeg[],
  spot: number | undefined,
  halfRange?: number | null
): { min: number; max: number } {
  if (halfRange == null) {
    return computeWideSpotRange(legs, spot);
  }

  const center = resolveSpotCenter(legs, spot);
  return {
    min: Math.max(0, center - halfRange),
    max: center + halfRange,
  };
}

export function getWideSpotHalfRange(
  legs: ParsedLeg[],
  spot: number | undefined
): number {
  const { min, max } = computeWideSpotRange(legs, spot);
  return Math.max((max - min) / 2, 1);
}

export function computePayoffCurve(
  legs: ParsedLeg[],
  spot?: number,
  numPoints = 200,
  halfRange?: number | null
): PayoffCurveResult | null {
  if (!legs.length) return null;

  const { min, max } = computeSpotRange(legs, spot, halfRange);
  const step = (max - min) / (numPoints - 1);
  const points: PayoffPoint[] = [];

  for (let i = 0; i < numPoints; i++) {
    const s = min + step * i;
    const pnl = legs.reduce((sum, leg) => sum + legPayoffAtSpot(leg, s), 0);
    points.push({ spot: s, pnl });
  }

  const breakevens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.pnl === 0) breakevens.push(prev.spot);
    if (prev.pnl * curr.pnl < 0) {
      const t = Math.abs(prev.pnl) / (Math.abs(prev.pnl) + Math.abs(curr.pnl));
      breakevens.push(prev.spot + t * (curr.spot - prev.spot));
    }
  }
  if (points[points.length - 1]?.pnl === 0) {
    breakevens.push(points[points.length - 1].spot);
  }

  const pnls = points.map((p) => p.pnl);
  return {
    points,
    breakevens: Array.from(new Set(breakevens.map((b) => Math.round(b)))),
    maxProfit: Math.max(...pnls),
    maxLoss: Math.min(...pnls),
    spotMin: min,
    spotMax: max,
  };
}

export interface SplitPayoffTraces {
  x: number[];
  profitY: (number | null)[];
  lossY: (number | null)[];
}

/** Split payoff into profit (>=0) and loss (<0) segments for dual-color fill. */
export function splitPayoffBySign(points: PayoffPoint[]): SplitPayoffTraces {
  const x: number[] = [];
  const profitY: (number | null)[] = [];
  const lossY: (number | null)[] = [];

  for (const p of points) {
    x.push(p.spot);
    profitY.push(p.pnl >= 0 ? p.pnl : 0);
    lossY.push(p.pnl < 0 ? p.pnl : 0);
  }

  return { x, profitY, lossY };
}

export function interpolatePayoffAtSpot(points: PayoffPoint[], targetSpot: number): number | null {
  if (!points.length || !Number.isFinite(targetSpot)) return null;
  if (targetSpot <= points[0].spot) return points[0].pnl;
  if (targetSpot >= points[points.length - 1].spot) return points[points.length - 1].pnl;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (targetSpot >= prev.spot && targetSpot <= curr.spot) {
      const span = curr.spot - prev.spot;
      if (span === 0) return curr.pnl;
      const t = (targetSpot - prev.spot) / span;
      return prev.pnl + t * (curr.pnl - prev.pnl);
    }
  }
  return null;
}

export function defaultUnderlyingForGroups(
  groups: PayoffGroup[],
  preferred?: string
): IndexUnderlying | null {
  if (preferred === 'NIFTY' || preferred === 'BANKNIFTY') {
    const match = groups.find((g) => g.underlying === preferred);
    if (match) return preferred;
  }
  return groups[0]?.underlying ?? null;
}
