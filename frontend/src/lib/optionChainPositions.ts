import { IndexUnderlying, PositionInput } from './payoffDiagram';

export interface ChainPositionBadge {
  tradingsymbol: string;
  optionType: 'CE' | 'PE';
  quantity: number;
  side: 'B' | 'S';
  absLots: number;
}

const MONTHLY_EXPIRY_RE =
  /^(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d+)$/i;

const STRIKE_BOUNDS: Record<IndexUnderlying, { min: number; max: number; step: number }> = {
  NIFTY: { min: 5000, max: 60000, step: 50 },
  BANKNIFTY: { min: 15000, max: 100000, step: 100 },
};

function detectUnderlying(symbol: string): IndexUnderlying | null {
  const upper = symbol.toUpperCase();
  if (upper.startsWith('BANKNIFTY')) return 'BANKNIFTY';
  if (upper.startsWith('NIFTY')) return 'NIFTY';
  return null;
}

function parseOptionType(symbol: string): 'CE' | 'PE' | null {
  const upper = symbol.toUpperCase();
  if (upper.endsWith('CE')) return 'CE';
  if (upper.endsWith('PE')) return 'PE';
  return null;
}

function parseIndexOptionStrike(
  symbol: string,
  underlying: IndexUnderlying,
): number | null {
  const upper = symbol.toUpperCase();
  const optSuffix = upper.match(/(CE|PE)$/);
  if (!optSuffix) return null;

  const rest = upper.slice(underlying.length, -2);
  if (!rest) return null;

  const monthly = rest.match(MONTHLY_EXPIRY_RE);
  if (monthly) {
    const strike = parseInt(monthly[3], 10);
    const bounds = STRIKE_BOUNDS[underlying];
    if (!Number.isFinite(strike) || strike < bounds.min || strike > bounds.max) return null;
    return strike;
  }

  if (!/^\d+$/.test(rest)) return null;

  const afterYear = rest.slice(2);
  const bounds = STRIKE_BOUNDS[underlying];

  for (let len = 5; len >= 4; len--) {
    if (afterYear.length <= len) continue;
    const strike = parseInt(afterYear.slice(-len), 10);
    if (!Number.isFinite(strike)) continue;
    if (strike % bounds.step !== 0) continue;
    if (strike < bounds.min || strike > bounds.max) continue;
    return strike;
  }

  return null;
}

function toBadge(position: PositionInput): ChainPositionBadge | null {
  const symbol = (position.tradingsymbol || '').trim();
  const qty = Number(position.quantity);
  if (!symbol || !Number.isFinite(qty) || qty === 0) return null;

  const underlying = detectUnderlying(symbol);
  if (!underlying) return null;

  const optionType = parseOptionType(symbol);
  if (!optionType) return null;

  const strike = parseIndexOptionStrike(symbol, underlying);
  if (strike == null) return null;

  return {
    tradingsymbol: symbol,
    optionType,
    quantity: qty,
    side: qty > 0 ? 'B' : 'S',
    absLots: Math.abs(qty),
  };
}

export function positionsByTradingsymbol(
  positions: PositionInput[],
  index: IndexUnderlying,
): Map<string, ChainPositionBadge> {
  const map = new Map<string, ChainPositionBadge>();

  for (const pos of positions) {
    const badge = toBadge(pos);
    if (!badge) continue;
    const underlying = detectUnderlying(badge.tradingsymbol);
    if (underlying !== index) continue;
    map.set(badge.tradingsymbol, badge);
  }

  return map;
}
