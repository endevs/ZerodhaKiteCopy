import type { ChainRow, QuoteSide } from '../components/OptionChainTable';

export interface QuotePatch {
  instrument_token: number;
  tradingsymbol?: string;
  strike: number;
  instrument_type: 'CE' | 'PE';
  index_name: string;
  ltp: number;
  ltp_chg?: number | null;
  ltp_chg_pct?: number | null;
  iv?: number | null;
  iv_chg?: number | null;
  oi_lakh?: number | null;
  updated_at?: string;
}

export interface MarketDataSpot {
  nifty_price?: string;
  banknifty_price?: string;
}

/** Merge a single quote patch into the chain grid (immutable, one row only). */
export function applyQuotePatch(chain: ChainRow[], patch: QuotePatch): ChainRow[] {
  const idx = chain.findIndex((r) => r.strike === patch.strike);
  if (idx < 0) return chain;

  const row = chain[idx];
  const sideKey = patch.instrument_type === 'CE' ? 'ce' : 'pe';
  const existing = row[sideKey];
  if (!existing || existing.instrument_token !== patch.instrument_token) return chain;

  const updatedSide = {
    ...existing,
    ltp: patch.ltp,
    ltp_chg: patch.ltp_chg ?? existing.ltp_chg,
    ltp_chg_pct: patch.ltp_chg_pct ?? existing.ltp_chg_pct,
    iv: patch.iv ?? existing.iv,
    iv_chg: patch.iv_chg ?? existing.iv_chg,
    oi_lakh: patch.oi_lakh ?? existing.oi_lakh,
  };

  const next = chain.slice();
  next[idx] = { ...row, [sideKey]: updatedSide };
  return next;
}

function mergeQuoteSide(prev: QuoteSide | null, next: QuoteSide | null): QuoteSide | null {
  if (!next) return prev;
  if (!prev) return next;
  if (
    prev.instrument_token != null &&
    next.instrument_token != null &&
    prev.instrument_token !== next.instrument_token
  ) {
    return next;
  }
  return { ...prev, ...next };
}

/** Merge REST chain-board refresh into existing grid (preserves row order for scroll). */
export function mergeChainBoard(prev: ChainRow[], next: ChainRow[]): ChainRow[] {
  if (prev.length === 0) return next;
  if (prev.length !== next.length) return next;
  const strikesMatch = prev.every((row, i) => row.strike === next[i]?.strike);
  if (!strikesMatch) return next;

  return prev.map((row, i) => {
    const fresh = next[i];
    return {
      strike: row.strike,
      ce: mergeQuoteSide(row.ce, fresh.ce),
      pe: mergeQuoteSide(row.pe, fresh.pe),
    };
  });
}

/** Read index spot from shared market_data socket payload. */
export function mergeSpotUpdate(index: string, data: MarketDataSpot): number | null {
  const key = index.toUpperCase();
  if (key === 'NIFTY' && data.nifty_price != null) {
    const n = parseFloat(data.nifty_price);
    return Number.isFinite(n) ? n : null;
  }
  if (key === 'BANKNIFTY' && data.banknifty_price != null) {
    const n = parseFloat(data.banknifty_price);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
