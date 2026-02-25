/**
 * Pure TypeScript indicator calculations for Mountain Strategy.
 * Mirrors the Python implementations in Mountain_signal/indicators.py
 * so backtest results stay consistent.
 */

export function computeEMA(closes: number[], period: number): (number | null)[] {
  if (closes.length === 0) return [];

  const result: (number | null)[] = new Array(closes.length).fill(null);
  const multiplier = 2 / (period + 1);

  result[0] = closes[0];
  for (let i = 1; i < closes.length; i++) {
    const prev = result[i - 1] as number;
    result[i] = (closes[i] - prev) * multiplier + prev;
  }
  return result;
}

export function computeRSI(closes: number[], period: number = 14): (number | null)[] {
  if (closes.length < period + 1) {
    return new Array(closes.length).fill(null);
  }

  const result: (number | null)[] = new Array(closes.length).fill(null);
  const deltas: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    deltas.push(closes[i] - closes[i - 1]);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (deltas[i] > 0) avgGain += deltas[i];
    else avgLoss += Math.abs(deltas[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) {
    result[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    result[period] = 100 - 100 / (1 + rs);
  }

  for (let i = period; i < deltas.length; i++) {
    const gain = deltas[i] > 0 ? deltas[i] : 0;
    const loss = deltas[i] < 0 ? Math.abs(deltas[i]) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result[i + 1] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i + 1] = 100 - 100 / (1 + rs);
    }
  }

  return result;
}
