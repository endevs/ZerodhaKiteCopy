import { ChainRow } from '../components/OptionChainTable';

export interface SdLevel {
  label: string;
  price: number;
}

export interface SdLevels {
  iv: number;
  daysToExpiry: number;
  oneSigma: number;
  levels: SdLevel[];
}

function findNearestRow(chain: ChainRow[], atmStrike: number): ChainRow | null {
  if (!chain.length) return null;
  let best = chain[0];
  let minDiff = Math.abs(chain[0].strike - atmStrike);
  for (const row of chain) {
    const diff = Math.abs(row.strike - atmStrike);
    if (diff < minDiff) {
      minDiff = diff;
      best = row;
    }
  }
  return best;
}

export function getAtmIv(chain: ChainRow[], atmStrike: number | null): number | null {
  if (atmStrike == null || !chain.length) return null;
  const row = findNearestRow(chain, atmStrike);
  if (!row) return null;

  const ceIv = row.ce?.iv != null ? Number(row.ce.iv) : null;
  const peIv = row.pe?.iv != null ? Number(row.pe.iv) : null;

  if (ceIv != null && Number.isFinite(ceIv) && peIv != null && Number.isFinite(peIv)) {
    return (ceIv + peIv) / 2;
  }
  if (ceIv != null && Number.isFinite(ceIv)) return ceIv;
  if (peIv != null && Number.isFinite(peIv)) return peIv;
  return null;
}

function daysBetween(fromDate: string, toDate: string): number {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 1;
  const ms = to.getTime() - from.getTime();
  return Math.max(Math.ceil(ms / (1000 * 60 * 60 * 24)), 1);
}

export function computeSdLevels(
  spot: number,
  atmIv: number,
  expiryDate: string,
  tradingDate: string
): SdLevels | null {
  if (!Number.isFinite(spot) || spot <= 0 || !Number.isFinite(atmIv) || atmIv <= 0) {
    return null;
  }

  const daysToExpiry = daysBetween(tradingDate, expiryDate);
  const T = daysToExpiry / 365;
  const oneSigma = spot * (atmIv / 100) * Math.sqrt(T);

  return {
    iv: atmIv,
    daysToExpiry,
    oneSigma,
    levels: [
      { label: '-2SD', price: spot - 2 * oneSigma },
      { label: '-1SD', price: spot - oneSigma },
      { label: '1SD', price: spot + oneSigma },
      { label: '2SD', price: spot + 2 * oneSigma },
    ],
  };
}
