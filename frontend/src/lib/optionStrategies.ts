import { ChainRow } from '../components/OptionChainTable';
import { PositionInput } from './payoffDiagram';

export type StrategySide = 'BUY' | 'SELL';
export type StrategyCategory = 'bullish' | 'bearish' | 'neutral' | 'other';

export interface StrategyLeg {
  id: string;
  tradingsymbol: string;
  strike: number;
  optionType: 'CE' | 'PE';
  side: StrategySide;
  lots: number;
  entryPrice: number;
}

export interface StrategyPresetLeg {
  optionType: 'CE' | 'PE';
  side: StrategySide;
  strikeOffset: number;
  lots: number;
}

export interface StrategyPreset {
  id: string;
  name: string;
  category: StrategyCategory;
  description: string;
  legs: StrategyPresetLeg[];
}

export interface AddLegParams {
  side: StrategySide;
  strike: number;
  optionType: 'CE' | 'PE';
  tradingsymbol: string;
  ltp: number;
  lots: number;
}

export interface ResolvePresetResult {
  legs: StrategyLeg[];
  missing: string[];
}

export interface StrategyAdjustments {
  shift: number;
  width: number;
  hedge: number;
}

export interface AppliedPresetContext {
  presetId: string;
  anchorStrike: number;
  shift: number;
  width: number;
  hedge: number;
}

export interface AdjustmentControls {
  shift: boolean;
  width: boolean;
  hedge: boolean;
}

export interface ChainQuote {
  strike: number;
  tradingsymbol: string;
  ltp: number | null;
}

const LOT_SIZES: Record<string, number> = {
  NIFTY: 75,
  BANKNIFTY: 30,
};

export function getStrikeStep(index: string): number {
  return index.toUpperCase() === 'BANKNIFTY' ? 100 : 50;
}

export function getLotSize(index: string): number {
  const key = index.toUpperCase();
  return LOT_SIZES[key] ?? 50;
}

export function newLegId(): string {
  return `leg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createLeg(params: AddLegParams): StrategyLeg {
  return {
    id: newLegId(),
    tradingsymbol: params.tradingsymbol,
    strike: params.strike,
    optionType: params.optionType,
    side: params.side,
    lots: Math.max(1, params.lots),
    entryPrice: params.ltp,
  };
}

/** Merge a new leg into existing legs (net by tradingsymbol). */
export function mergeAddLeg(existing: StrategyLeg[], incoming: StrategyLeg): StrategyLeg[] {
  const idx = existing.findIndex((l) => l.tradingsymbol === incoming.tradingsymbol);
  if (idx < 0) {
    return [...existing, incoming];
  }

  const current = existing[idx];
  const currentSigned = current.side === 'BUY' ? current.lots : -current.lots;
  const incomingSigned = incoming.side === 'BUY' ? incoming.lots : -incoming.lots;
  const netLots = currentSigned + incomingSigned;

  if (netLots === 0) {
    return existing.filter((_, i) => i !== idx);
  }

  const updated: StrategyLeg = {
    ...current,
    side: netLots > 0 ? 'BUY' : 'SELL',
    lots: Math.abs(netLots),
    entryPrice: incoming.entryPrice,
  };

  return existing.map((l, i) => (i === idx ? updated : l));
}

export function addLegToStrategy(existing: StrategyLeg[], params: AddLegParams): StrategyLeg[] {
  return mergeAddLeg(existing, createLeg(params));
}

function findChainRow(chain: ChainRow[], targetStrike: number): ChainRow | null {
  if (!chain.length) return null;
  let best = chain[0];
  let minDiff = Math.abs(chain[0].strike - targetStrike);
  for (const row of chain) {
    const diff = Math.abs(row.strike - targetStrike);
    if (diff < minDiff) {
      minDiff = diff;
      best = row;
    }
  }
  return best;
}

export function snapToStrikeStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function snapPointsToStep(points: number, step: number): number {
  return Math.max(0, Math.round(points / step) * step);
}

export function snapShiftToStep(shift: number, step: number): number {
  return Math.round(shift / step) * step;
}

export function lookupChainQuote(
  chain: ChainRow[],
  targetStrike: number,
  optionType: 'CE' | 'PE'
): ChainQuote | null {
  const row = findChainRow(chain, targetStrike);
  if (!row) return null;
  const side = optionType === 'CE' ? row.ce : row.pe;
  if (!side?.tradingsymbol) return null;
  const ltp = side.ltp != null && Number.isFinite(Number(side.ltp)) ? Number(side.ltp) : null;
  return {
    strike: row.strike,
    tradingsymbol: side.tradingsymbol,
    ltp,
  };
}

export function setLegStrike(leg: StrategyLeg, newStrike: number, chain: ChainRow[]): StrategyLeg {
  const quote = lookupChainQuote(chain, newStrike, leg.optionType);
  if (!quote) {
    return { ...leg, strike: newStrike };
  }
  return {
    ...leg,
    strike: quote.strike,
    tradingsymbol: quote.tradingsymbol,
    entryPrice: quote.ltp ?? leg.entryPrice,
  };
}

export function bumpLegStrike(
  leg: StrategyLeg,
  deltaSteps: number,
  index: string,
  chain: ChainRow[]
): StrategyLeg {
  const step = getStrikeStep(index);
  return setLegStrike(leg, leg.strike + deltaSteps * step, chain);
}

function findLeg(
  legs: StrategyLeg[],
  optionType: 'CE' | 'PE',
  side: StrategySide
): StrategyLeg | undefined {
  return legs.find((l) => l.optionType === optionType && l.side === side);
}

export function deriveStrategyAdjustments(
  legs: StrategyLeg[],
  anchorStrike: number
): StrategyAdjustments {
  if (!legs.length) {
    return { shift: 0, width: 0, hedge: 0 };
  }

  const peSell = findLeg(legs, 'PE', 'SELL');
  const ceSell = findLeg(legs, 'CE', 'SELL');
  const peBuy = findLeg(legs, 'PE', 'BUY');
  const ceBuy = findLeg(legs, 'CE', 'BUY');

  if (peSell && ceSell) {
    const width = ceSell.strike - peSell.strike;
    const shift = (peSell.strike + ceSell.strike) / 2 - anchorStrike;
    let hedge = 0;
    if (peBuy) hedge = Math.max(hedge, peSell.strike - peBuy.strike);
    if (ceBuy) hedge = Math.max(hedge, ceBuy.strike - ceSell.strike);
    return { shift, width, hedge };
  }

  if (legs.length === 2 && legs[0].optionType === legs[1].optionType) {
    const strikes = legs.map((l) => l.strike).sort((a, b) => a - b);
    return {
      shift: (strikes[0] + strikes[1]) / 2 - anchorStrike,
      width: strikes[1] - strikes[0],
      hedge: 0,
    };
  }

  if (legs.length === 2) {
    const peLeg = legs.find((l) => l.optionType === 'PE');
    const ceLeg = legs.find((l) => l.optionType === 'CE');
    if (peLeg && ceLeg) {
      const width = ceLeg.strike - peLeg.strike;
      return {
        shift: (peLeg.strike + ceLeg.strike) / 2 - anchorStrike,
        width,
        hedge: 0,
      };
    }
  }

  if (legs.length === 1) {
    return { shift: legs[0].strike - anchorStrike, width: 0, hedge: 0 };
  }

  const avgStrike = legs.reduce((s, l) => s + l.strike, 0) / legs.length;
  return { shift: avgStrike - anchorStrike, width: 0, hedge: 0 };
}

function buildLegFromTemplate(
  template: StrategyPresetLeg,
  targetStrike: number,
  chain: ChainRow[],
  step: number,
  existingLeg?: StrategyLeg
): StrategyLeg | null {
  const quote = lookupChainQuote(chain, targetStrike, template.optionType);
  const strike = quote?.strike ?? snapToStrikeStep(targetStrike, step);
  return {
    id: existingLeg?.id ?? newLegId(),
    tradingsymbol: quote?.tradingsymbol ?? existingLeg?.tradingsymbol ?? '',
    strike,
    optionType: template.optionType,
    side: template.side,
    lots: template.lots,
    entryPrice: quote?.ltp ?? existingLeg?.entryPrice ?? 0,
  };
}

function isIronButterflyPreset(preset: StrategyPreset): boolean {
  return preset.id === 'iron-butterfly';
}

function isShortStraddlePreset(preset: StrategyPreset): boolean {
  return preset.id === 'short-straddle' || preset.id === 'long-straddle';
}

function isVerticalSpreadPreset(preset: StrategyPreset): boolean {
  if (preset.legs.length !== 2) return false;
  return preset.legs[0].optionType === preset.legs[1].optionType;
}

export function getAdjustmentControls(preset: StrategyPreset): AdjustmentControls {
  if (preset.legs.length === 1) {
    return { shift: true, width: false, hedge: false };
  }
  if (isVerticalSpreadPreset(preset)) {
    return { shift: true, width: true, hedge: false };
  }
  if (isShortStraddlePreset(preset)) {
    return { shift: true, width: false, hedge: false };
  }
  if (isIronButterflyPreset(preset)) {
    return { shift: true, width: false, hedge: true };
  }
  if (preset.legs.length === 2) {
    return { shift: true, width: true, hedge: false };
  }
  if (preset.legs.length === 4) {
    return { shift: true, width: true, hedge: true };
  }
  return { shift: true, width: false, hedge: false };
}

function targetStrikesForPreset(
  preset: StrategyPreset,
  effectiveCenter: number,
  adjustments: StrategyAdjustments,
  index: string
): Map<string, number> {
  const step = getStrikeStep(index);
  const width = snapPointsToStep(adjustments.width, step);
  const hedge = snapPointsToStep(adjustments.hedge, step);
  const center = snapToStrikeStep(effectiveCenter, step);
  const targets = new Map<string, number>();

  const key = (t: StrategyPresetLeg) => `${t.side}-${t.optionType}`;

  if (preset.legs.length === 1) {
    targets.set(key(preset.legs[0]), center);
    return targets;
  }

  if (isVerticalSpreadPreset(preset)) {
    const buyLeg = preset.legs.find((l) => l.side === 'BUY');
    const sellLeg = preset.legs.find((l) => l.side === 'SELL');
    if (buyLeg && sellLeg) {
      const buyOffset = buyLeg.strikeOffset;
      const sellOffset = sellLeg.strikeOffset;
      const buyAtCenter = buyOffset === 0 || Math.abs(buyOffset) <= Math.abs(sellOffset);
      if (buyAtCenter) {
        targets.set(key(buyLeg), center);
        if (preset.legs[0].optionType === 'CE') {
          targets.set(key(sellLeg), center + width);
        } else {
          targets.set(key(sellLeg), center - width);
        }
      } else {
        targets.set(key(sellLeg), center);
        if (preset.legs[0].optionType === 'CE') {
          targets.set(key(buyLeg), center - width);
        } else {
          targets.set(key(buyLeg), center + width);
        }
      }
    }
    return targets;
  }

  if (isShortStraddlePreset(preset)) {
    for (const t of preset.legs) {
      targets.set(key(t), center);
    }
    return targets;
  }

  if (isIronButterflyPreset(preset)) {
    const peShort = center;
    const ceShort = center;
    const peLong = center - hedge;
    const ceLong = center + hedge;
    for (const t of preset.legs) {
      if (t.optionType === 'PE' && t.side === 'SELL') targets.set(key(t), peShort);
      else if (t.optionType === 'CE' && t.side === 'SELL') targets.set(key(t), ceShort);
      else if (t.optionType === 'PE' && t.side === 'BUY') targets.set(key(t), peLong);
      else if (t.optionType === 'CE' && t.side === 'BUY') targets.set(key(t), ceLong);
    }
    return targets;
  }

  const peShort = center - width / 2;
  const ceShort = center + width / 2;
  const peLong = peShort - hedge;
  const ceLong = ceShort + hedge;

  const hasWings = preset.legs.some((l) => l.side === 'BUY');

  for (const t of preset.legs) {
    if (t.optionType === 'PE' && t.side === 'SELL') {
      targets.set(key(t), peShort);
    } else if (t.optionType === 'CE' && t.side === 'SELL') {
      targets.set(key(t), ceShort);
    } else if (t.optionType === 'PE' && t.side === 'BUY') {
      targets.set(key(t), hasWings ? peLong : peShort);
    } else if (t.optionType === 'CE' && t.side === 'BUY') {
      targets.set(key(t), hasWings ? ceLong : ceShort);
    }
  }

  return targets;
}

export function applyStrategyAdjustments(
  preset: StrategyPreset,
  anchorStrike: number,
  adjustments: StrategyAdjustments,
  chain: ChainRow[],
  index: string,
  existingLegs: StrategyLeg[] = []
): StrategyLeg[] {
  const step = getStrikeStep(index);
  const shift = snapShiftToStep(adjustments.shift, step);
  const effectiveCenter = anchorStrike + shift;
  const targets = targetStrikesForPreset(preset, effectiveCenter, adjustments, index);
  const key = (t: StrategyPresetLeg) => `${t.side}-${t.optionType}`;

  return preset.legs.map((template, i) => {
    const existing = existingLegs[i];
    const strike = targets.get(key(template)) ?? effectiveCenter;
    return buildLegFromTemplate(template, strike, chain, step, existing) as StrategyLeg;
  });
}

export function getPresetById(presetId: string): StrategyPreset | undefined {
  return STRATEGY_PRESETS.find((p) => p.id === presetId);
}

function resolvePresetLeg(
  presetLeg: StrategyPresetLeg,
  chain: ChainRow[],
  atmStrike: number,
  index: string
): StrategyLeg | null {
  const step = getStrikeStep(index);
  const targetStrike = atmStrike + presetLeg.strikeOffset * step;
  const row = findChainRow(chain, targetStrike);
  if (!row) return null;

  const side = presetLeg.optionType === 'CE' ? row.ce : row.pe;
  if (!side?.tradingsymbol || side.ltp == null || !Number.isFinite(Number(side.ltp))) {
    return null;
  }

  return {
    id: newLegId(),
    tradingsymbol: side.tradingsymbol,
    strike: row.strike,
    optionType: presetLeg.optionType,
    side: presetLeg.side,
    lots: presetLeg.lots,
    entryPrice: Number(side.ltp),
  };
}

export function resolvePreset(
  preset: StrategyPreset,
  chain: ChainRow[],
  atmStrike: number | null,
  index: string
): ResolvePresetResult {
  if (atmStrike == null || !chain.length) {
    return { legs: [], missing: ['ATM strike or chain unavailable'] };
  }

  const legs: StrategyLeg[] = [];
  const missing: string[] = [];

  for (const pl of preset.legs) {
    const leg = resolvePresetLeg(pl, chain, atmStrike, index);
    if (leg) {
      legs.push(leg);
    } else {
      const step = getStrikeStep(index);
      const strike = atmStrike + pl.strikeOffset * step;
      missing.push(`${pl.side} ${strike} ${pl.optionType}`);
    }
  }

  return { legs, missing };
}

export function strategyLegsToPositionInputs(legs: StrategyLeg[], index: string): PositionInput[] {
  const lotSize = getLotSize(index);
  return legs.map((leg) => {
    const qty = leg.lots * lotSize;
    const signedQty = leg.side === 'BUY' ? qty : -qty;
    return {
      tradingsymbol: leg.tradingsymbol,
      exchange: 'NFO',
      quantity: signedQty,
      buy_price: leg.entryPrice,
      sell_price: leg.entryPrice,
    };
  });
}

export function netPremiumAtEntry(legs: StrategyLeg[], index: string): number {
  const lotSize = getLotSize(index);
  return legs.reduce((sum, leg) => {
    const premium = leg.lots * leg.entryPrice * lotSize;
    return leg.side === 'BUY' ? sum + premium : sum - premium;
  }, 0);
}

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: 'long-call',
    name: 'Long Call',
    category: 'bullish',
    description: 'Buy ATM call — unlimited upside, limited downside.',
    legs: [{ optionType: 'CE', side: 'BUY', strikeOffset: 0, lots: 1 }],
  },
  {
    id: 'bull-call-spread',
    name: 'Bull Call Spread',
    category: 'bullish',
    description: 'Buy ATM call, sell OTM call — capped profit, lower cost.',
    legs: [
      { optionType: 'CE', side: 'BUY', strikeOffset: 0, lots: 1 },
      { optionType: 'CE', side: 'SELL', strikeOffset: 1, lots: 1 },
    ],
  },
  {
    id: 'bull-put-spread',
    name: 'Bull Put Spread',
    category: 'bullish',
    description: 'Sell ATM put, buy OTM put — credit spread, bullish bias.',
    legs: [
      { optionType: 'PE', side: 'SELL', strikeOffset: 0, lots: 1 },
      { optionType: 'PE', side: 'BUY', strikeOffset: -1, lots: 1 },
    ],
  },
  {
    id: 'long-put',
    name: 'Long Put',
    category: 'bearish',
    description: 'Buy ATM put — profit from downward move.',
    legs: [{ optionType: 'PE', side: 'BUY', strikeOffset: 0, lots: 1 }],
  },
  {
    id: 'bear-put-spread',
    name: 'Bear Put Spread',
    category: 'bearish',
    description: 'Buy ATM put, sell OTM put — capped profit bearish spread.',
    legs: [
      { optionType: 'PE', side: 'BUY', strikeOffset: 0, lots: 1 },
      { optionType: 'PE', side: 'SELL', strikeOffset: -1, lots: 1 },
    ],
  },
  {
    id: 'bear-call-spread',
    name: 'Bear Call Spread',
    category: 'bearish',
    description: 'Sell ATM call, buy OTM call — credit spread, bearish bias.',
    legs: [
      { optionType: 'CE', side: 'SELL', strikeOffset: 0, lots: 1 },
      { optionType: 'CE', side: 'BUY', strikeOffset: 1, lots: 1 },
    ],
  },
  {
    id: 'short-straddle',
    name: 'Short Straddle',
    category: 'neutral',
    description: 'Sell ATM call and put — profit if price stays near ATM.',
    legs: [
      { optionType: 'CE', side: 'SELL', strikeOffset: 0, lots: 1 },
      { optionType: 'PE', side: 'SELL', strikeOffset: 0, lots: 1 },
    ],
  },
  {
    id: 'short-strangle',
    name: 'Short Strangle',
    category: 'neutral',
    description: 'Sell OTM call and put — wider profit zone, less premium.',
    legs: [
      { optionType: 'CE', side: 'SELL', strikeOffset: 1, lots: 1 },
      { optionType: 'PE', side: 'SELL', strikeOffset: -1, lots: 1 },
    ],
  },
  {
    id: 'long-straddle',
    name: 'Long Straddle',
    category: 'neutral',
    description: 'Buy ATM call and put — profit from large move either direction.',
    legs: [
      { optionType: 'CE', side: 'BUY', strikeOffset: 0, lots: 1 },
      { optionType: 'PE', side: 'BUY', strikeOffset: 0, lots: 1 },
    ],
  },
  {
    id: 'iron-condor',
    name: 'Iron Condor',
    category: 'neutral',
    description: 'Sell inner wings, buy outer wings — range-bound income.',
    legs: [
      { optionType: 'CE', side: 'SELL', strikeOffset: 1, lots: 1 },
      { optionType: 'CE', side: 'BUY', strikeOffset: 2, lots: 1 },
      { optionType: 'PE', side: 'SELL', strikeOffset: -1, lots: 1 },
      { optionType: 'PE', side: 'BUY', strikeOffset: -2, lots: 1 },
    ],
  },
  {
    id: 'iron-butterfly',
    name: 'Iron Butterfly',
    category: 'neutral',
    description: 'Short ATM straddle with OTM wing protection.',
    legs: [
      { optionType: 'CE', side: 'SELL', strikeOffset: 0, lots: 1 },
      { optionType: 'PE', side: 'SELL', strikeOffset: 0, lots: 1 },
      { optionType: 'CE', side: 'BUY', strikeOffset: 1, lots: 1 },
      { optionType: 'PE', side: 'BUY', strikeOffset: -1, lots: 1 },
    ],
  },
  {
    id: 'long-strangle',
    name: 'Long Strangle',
    category: 'other',
    description: 'Buy OTM call and put — cheaper volatility play.',
    legs: [
      { optionType: 'CE', side: 'BUY', strikeOffset: 1, lots: 1 },
      { optionType: 'PE', side: 'BUY', strikeOffset: -1, lots: 1 },
    ],
  },
  {
    id: 'call-ratio-spread',
    name: 'Call Ratio Spread (1:2)',
    category: 'other',
    description: 'Buy 1 ATM call, sell 2 OTM calls — ratio spread.',
    legs: [
      { optionType: 'CE', side: 'BUY', strikeOffset: 0, lots: 1 },
      { optionType: 'CE', side: 'SELL', strikeOffset: 1, lots: 2 },
    ],
  },
  {
    id: 'put-ratio-spread',
    name: 'Put Ratio Spread (1:2)',
    category: 'other',
    description: 'Buy 1 ATM put, sell 2 OTM puts — ratio spread.',
    legs: [
      { optionType: 'PE', side: 'BUY', strikeOffset: 0, lots: 1 },
      { optionType: 'PE', side: 'SELL', strikeOffset: -1, lots: 2 },
    ],
  },
];

export const STRATEGY_CATEGORIES: { id: StrategyCategory; label: string }[] = [
  { id: 'bullish', label: 'Bullish' },
  { id: 'bearish', label: 'Bearish' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'other', label: 'Other' },
];

export function presetsByCategory(category: StrategyCategory): StrategyPreset[] {
  return STRATEGY_PRESETS.filter((p) => p.category === category);
}
