import { ChainRow } from '../components/OptionChainTable';

export interface OiBarPoint {
  strike: number;
  callOi: number;
  putOi: number;
}

export interface OiTotals {
  callCr: number;
  putCr: number;
  hasData: boolean;
}

function findNearestRow(chain: ChainRow[], spot: number): ChainRow | null {
  if (!chain.length) return null;
  let best = chain[0];
  let minDiff = Math.abs(chain[0].strike - spot);
  for (const row of chain) {
    const diff = Math.abs(row.strike - spot);
    if (diff < minDiff) {
      minDiff = diff;
      best = row;
    }
  }
  return best;
}

export function buildOiOverlay(
  chain: ChainRow[],
  spotMin: number,
  spotMax: number
): OiBarPoint[] {
  return chain
    .filter((row) => row.strike >= spotMin && row.strike <= spotMax)
    .map((row) => ({
      strike: row.strike,
      callOi: row.ce?.oi_lakh != null && Number.isFinite(Number(row.ce.oi_lakh))
        ? Number(row.ce.oi_lakh)
        : 0,
      putOi: row.pe?.oi_lakh != null && Number.isFinite(Number(row.pe.oi_lakh))
        ? Number(row.pe.oi_lakh)
        : 0,
    }))
    .filter((p) => p.callOi > 0 || p.putOi > 0);
}

export function totalOiAtSpot(chain: ChainRow[], spot: number): OiTotals {
  const row = findNearestRow(chain, spot);
  if (!row) {
    return { callCr: 0, putCr: 0, hasData: false };
  }

  const callLakh = row.ce?.oi_lakh != null ? Number(row.ce.oi_lakh) : 0;
  const putLakh = row.pe?.oi_lakh != null ? Number(row.pe.oi_lakh) : 0;
  const hasData =
    (Number.isFinite(callLakh) && callLakh > 0) ||
    (Number.isFinite(putLakh) && putLakh > 0);

  return {
    callCr: Number.isFinite(callLakh) ? callLakh / 100 : 0,
    putCr: Number.isFinite(putLakh) ? putLakh / 100 : 0,
    hasData,
  };
}

export function chainHasOiData(chain: ChainRow[]): boolean {
  return chain.some(
    (row) =>
      (row.ce?.oi_lakh != null && Number(row.ce.oi_lakh) > 0) ||
      (row.pe?.oi_lakh != null && Number(row.pe.oi_lakh) > 0)
  );
}
