export const PRICE_SPIKE_STORAGE_KEY = 'optionChain.priceSpikePct';
export const IV_SPIKE_STORAGE_KEY = 'optionChain.ivSpikePct';

export const DEFAULT_PRICE_SPIKE_PCT = 120;
export const DEFAULT_IV_SPIKE_PCT = 10;

export function readStoredThreshold(
  key: string,
  defaultValue: number,
): number {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null || raw === '') return defaultValue;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function writeStoredThreshold(key: string, value: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* ignore quota errors */
  }
}

/** Day-change LTP % vs yesterday close; both + and − count. */
export function isLtpSpike(
  ltpChgPct: number | null | undefined,
  threshold: number,
): boolean {
  if (ltpChgPct == null || !Number.isFinite(ltpChgPct) || threshold <= 0) return false;
  return Math.abs(ltpChgPct) >= threshold;
}

/** Day-change IV % vs baseline; falls back to absolute iv_chg when pct missing. */
export function isIvSpike(
  ivChgPct: number | null | undefined,
  ivChg: number | null | undefined,
  threshold: number,
): boolean {
  if (threshold <= 0) return false;
  if (ivChgPct != null && Number.isFinite(ivChgPct)) {
    return Math.abs(ivChgPct) >= threshold;
  }
  if (ivChg != null && Number.isFinite(ivChg)) {
    return Math.abs(ivChg) >= threshold;
  }
  return false;
}
