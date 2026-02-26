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

/**
 * Average Directional Index (ADX) with Wilder smoothing.
 * ADX(14, 14): period 14 for DI and ADX smoothing.
 * Returns null for first ~2*period - 1 bars until enough data for valid ADX.
 */
export function computeADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14,
): (number | null)[] {
  const n = highs.length;
  if (n < period + 1) return new Array(n).fill(null);

  const result: (number | null)[] = new Array(n).fill(null);

  // True Range and Directional Movement
  const tr: number[] = new Array(n);
  const plusDM: number[] = new Array(n);
  const minusDM: number[] = new Array(n);

  tr[0] = highs[0] - lows[0];
  plusDM[0] = 0;
  minusDM[0] = 0;

  for (let i = 1; i < n; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevHigh = highs[i - 1];
    const prevLow = lows[i - 1];
    const prevClose = closes[i - 1];

    tr[i] = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    if (upMove > downMove && upMove > 0) {
      plusDM[i] = upMove;
      minusDM[i] = 0;
    } else if (downMove > upMove && downMove > 0) {
      plusDM[i] = 0;
      minusDM[i] = downMove;
    } else {
      plusDM[i] = 0;
      minusDM[i] = 0;
    }
  }

  // Wilder smoothing: first = sum of first `period` values, then prior - prior/period + current
  const smoothTR: number[] = new Array(n);
  const smoothPlusDM: number[] = new Array(n);
  const smoothMinusDM: number[] = new Array(n);

  let sumTR = 0;
  let sumPlusDM = 0;
  let sumMinusDM = 0;
  for (let i = 0; i < period; i++) {
    sumTR += tr[i];
    sumPlusDM += plusDM[i];
    sumMinusDM += minusDM[i];
  }
  smoothTR[period - 1] = sumTR;
  smoothPlusDM[period - 1] = sumPlusDM;
  smoothMinusDM[period - 1] = sumMinusDM;

  for (let i = period; i < n; i++) {
    smoothTR[i] = smoothTR[i - 1] - smoothTR[i - 1] / period + tr[i];
    smoothPlusDM[i] = smoothPlusDM[i - 1] - smoothPlusDM[i - 1] / period + plusDM[i];
    smoothMinusDM[i] = smoothMinusDM[i - 1] - smoothMinusDM[i - 1] / period + minusDM[i];
  }

  // +DI, -DI, DX
  const plusDI: number[] = new Array(n);
  const minusDI: number[] = new Array(n);
  const dx: number[] = new Array(n);

  for (let i = period - 1; i < n; i++) {
    if (smoothTR[i] > 0) {
      plusDI[i] = (100 * smoothPlusDM[i]) / smoothTR[i];
      minusDI[i] = (100 * smoothMinusDM[i]) / smoothTR[i];
    } else {
      plusDI[i] = 0;
      minusDI[i] = 0;
    }

    const diSum = plusDI[i] + minusDI[i];
    if (diSum > 0) {
      dx[i] = (100 * Math.abs(plusDI[i] - minusDI[i])) / diSum;
    } else {
      dx[i] = 0;
    }
  }

  // ADX = smoothed DX (first = avg of first 14 DX, then (prior*13 + current)/14)
  const firstDxStart = period - 1;
  const firstDxEnd = firstDxStart + period;
  if (firstDxEnd > n) return result;

  let sumDx = 0;
  for (let i = firstDxStart; i < firstDxEnd; i++) {
    sumDx += dx[i];
  }
  result[firstDxEnd - 1] = sumDx / period;

  for (let i = firstDxEnd; i < n; i++) {
    result[i] = (result[i - 1]! * (period - 1) + dx[i]) / period;
  }

  return result;
}
