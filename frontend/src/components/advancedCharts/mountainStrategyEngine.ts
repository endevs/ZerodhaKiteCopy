/**
 * Mountain Signal Strategy – self-contained client-side backtest engine.
 *
 * Rules reference: backend/rules/mountain_signal_pe.rules
 *
 * Adaptations for index-only backtesting:
 *   - Option premium / contract logic is skipped entirely.
 *   - Entry price = candle.close when trigger fires (SHORT on index).
 *   - Exit price  = candle.close when exit condition is met.
 *   - P&L = entryPrice − exitPrice  (SHORT: profit when price drops).
 *
 * Exit priority (index-only):
 *   1. INDEX_STOP   – candle.close > signal.high
 *   2. INDEX_TARGET  – candle.high < EMA(5), then 2 consecutive close > EMA(5)
 *   3. MARKET_CLOSE – candle time >= 15:15
 */

import { PlotlyCandlePoint } from '../PlotlyCandlestickChart';
import { computeEMA, computeRSI } from './mountainIndicators';
import {
  MountainSignal,
  MountainEvent,
  MountainEventType,
  MountainTrade,
  MountainBacktestResult,
  MountainBacktestSummary,
  EquityPoint,
  ExitReason,
} from './MountainStrategyTypes';

const EMA_PERIOD = 5;
const RSI_PERIOD = 14;
const MARKET_CLOSE_HOUR = 15;
const MARKET_CLOSE_MINUTE = 15;

export interface MountainBacktestConfig {
  rsiOverbought?: number;
  rsiOversold?: number;
}

function timeStr(t: Date | string): string {
  if (typeof t === 'string') return t;
  return t.toISOString();
}

function parseTime(t: Date | string): Date {
  return typeof t === 'string' ? new Date(t) : t;
}

function isAtOrAfterMarketClose(d: Date): boolean {
  const h = d.getHours();
  const m = d.getMinutes();
  return h > MARKET_CLOSE_HOUR || (h === MARKET_CLOSE_HOUR && m >= MARKET_CLOSE_MINUTE);
}

interface ActiveTrade {
  entryPrice: number;
  entryTime: string;
  entryCandleIndex: number;
  isFirstEntry: boolean;
  signalSnapshot: MountainSignal;
  highDroppedBelowEma: boolean;
  consecutiveCloseAboveEma: number;
}

// ─── Engine ────────────────────────────────────────────────────────────────────

export function runMountainBacktest(
  candles: PlotlyCandlePoint[],
  config?: MountainBacktestConfig,
): MountainBacktestResult {
  if (candles.length === 0) {
    return emptyResult();
  }

  const rsiOverboughtThreshold = config?.rsiOverbought ?? 70;

  const closes = candles.map((c) => c.close);
  const ema5 = computeEMA(closes, EMA_PERIOD);
  const rsi14 = computeRSI(closes, RSI_PERIOD);

  const events: MountainEvent[] = [];
  const trades: MountainTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let cumulativePnl = 0;

  // Mutable state in a container so TS narrowing isn't invalidated by closures
  const S = {
    signal: null as MountainSignal | null,
    trade: null as ActiveTrade | null,
    enteredIndices: new Set<number>(),
    candlesSinceExit: [] as PlotlyCandlePoint[],
    lastExitTime: null as Date | null,
    prevDay: null as string | null,
  };

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const candleTime = parseTime(c.time);
    const e5 = ema5[i];
    const r14 = rsi14[i];
    const dayKey = `${candleTime.getFullYear()}-${candleTime.getMonth()}-${candleTime.getDate()}`;

    // ── New day boundary: clear carry-forward state ──
    if (S.prevDay !== null && S.prevDay !== dayKey) {
      if (S.signal && !S.trade) {
        pushEvent(events, i, c, MountainEventType.NEW_DAY_RESET,
          `New trading day – clearing previous signal (was H:${S.signal.high} L:${S.signal.low})`,
          { signalHigh: S.signal.high, signalLow: S.signal.low, signalTime: S.signal.time });
        S.signal = null;
        S.enteredIndices = new Set();
      }
    }
    S.prevDay = dayKey;

    // ── Market close signal clear (15:15) for pending signals without active trade ──
    if (S.signal && !S.trade && isAtOrAfterMarketClose(candleTime)) {
      pushEvent(events, i, c, MountainEventType.MARKET_CLOSE_SIGNAL_CLEAR,
        `Market close – clearing pending signal (H:${S.signal.high} L:${S.signal.low})`,
        { signalHigh: S.signal.high, signalLow: S.signal.low, signalTime: S.signal.time });
      S.signal = null;
      S.enteredIndices = new Set();
    }

    // Skip candle if indicators not yet available
    if (e5 === null || r14 === null) {
      equityCurve.push({ timestamp: timeStr(c.time), value: cumulativePnl });
      continue;
    }

    // ══════════════════════════════════════════════════════════════════════
    // 1. EXIT EVALUATION (priority: INDEX_STOP > INDEX_TARGET > MARKET_CLOSE)
    // ══════════════════════════════════════════════════════════════════════
    if (S.trade) {
      const at = S.trade;
      let exited = false;

      // EXIT: INDEX_STOP – candle.close rises above signal.high
      if (c.close > at.signalSnapshot.high) {
        const exitPnl = at.entryPrice - c.close;
        const exitPnlPct = ((at.entryPrice - c.close) / at.entryPrice) * 100;
        trades.push(finalizeTrade(at, i, c, 'INDEX_STOP', exitPnl, exitPnlPct));
        cumulativePnl += exitPnl;

        pushEvent(events, i, c, MountainEventType.EXIT_INDEX_STOP,
          `INDEX STOP – close ${c.close.toFixed(2)} > signal.high ${at.signalSnapshot.high.toFixed(2)}. P&L: ${exitPnl.toFixed(2)}`,
          { entryPrice: at.entryPrice, exitPrice: c.close, exitReason: 'INDEX_STOP', pnl: exitPnl,
            signalHigh: at.signalSnapshot.high, ema5: e5, rsi14: r14 });

        resetAfterExit(S, candleTime);
        exited = true;
      }

      // EXIT: INDEX_TARGET – candle.high < EMA(5), then next 2 consecutive close > EMA(5)
      if (!exited) {
        if (c.high < e5) {
          at.highDroppedBelowEma = true;
          at.consecutiveCloseAboveEma = 0;
        } else if (at.highDroppedBelowEma && c.close > e5) {
          at.consecutiveCloseAboveEma += 1;
          if (at.consecutiveCloseAboveEma >= 2) {
            const exitPnl = at.entryPrice - c.close;
            const exitPnlPct = ((at.entryPrice - c.close) / at.entryPrice) * 100;
            trades.push(finalizeTrade(at, i, c, 'INDEX_TARGET', exitPnl, exitPnlPct));
            cumulativePnl += exitPnl;

            pushEvent(events, i, c, MountainEventType.EXIT_INDEX_TARGET,
              `INDEX TARGET – high dropped below EMA then 2 closes above EMA. P&L: ${exitPnl.toFixed(2)}`,
              { entryPrice: at.entryPrice, exitPrice: c.close, exitReason: 'INDEX_TARGET', pnl: exitPnl,
                ema5: e5, rsi14: r14 });

            resetAfterExit(S, candleTime);
            exited = true;
          }
        } else if (at.highDroppedBelowEma) {
          at.consecutiveCloseAboveEma = 0;
        }
      }

      // EXIT: MARKET_CLOSE – time >= 15:15
      if (!exited && isAtOrAfterMarketClose(candleTime)) {
        const exitPnl = at.entryPrice - c.close;
        const exitPnlPct = ((at.entryPrice - c.close) / at.entryPrice) * 100;
        trades.push(finalizeTrade(at, i, c, 'MARKET_CLOSE', exitPnl, exitPnlPct));
        cumulativePnl += exitPnl;

        pushEvent(events, i, c, MountainEventType.EXIT_MARKET_CLOSE,
          `MARKET CLOSE at ${candleTime.toLocaleTimeString()}. P&L: ${exitPnl.toFixed(2)}`,
          { entryPrice: at.entryPrice, exitPrice: c.close, exitReason: 'MARKET_CLOSE', pnl: exitPnl,
            ema5: e5, rsi14: r14 });

        resetAfterExit(S, candleTime);
        exited = true;
      }

      if (exited) {
        equityCurve.push({ timestamp: timeStr(c.time), value: cumulativePnl });
        continue;
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // 2. SIGNAL MANAGEMENT (only when no active trade)
    // ══════════════════════════════════════════════════════════════════════
    if (!S.trade) {
      const lowAboveEma = c.low > e5;
      const rsiOverbought = r14 > rsiOverboughtThreshold;

      if (S.signal === null) {
        if (lowAboveEma && rsiOverbought) {
          S.signal = { type: 'PE', high: c.high, low: c.low, time: timeStr(c.time), candleIndex: i };
          pushEvent(events, i, c, MountainEventType.SIGNAL_IDENTIFIED,
            `PE signal identified – H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} | EMA5:${e5.toFixed(2)} RSI:${r14.toFixed(1)}`,
            { signalHigh: c.high, signalLow: c.low, signalTime: timeStr(c.time), ema5: e5, rsi14: r14 });
        }
      } else {
        if (lowAboveEma && rsiOverbought) {
          const oldHigh = S.signal.high;
          const oldLow = S.signal.low;
          S.signal = { type: 'PE', high: c.high, low: c.low, time: timeStr(c.time), candleIndex: i };
          pushEvent(events, i, c, MountainEventType.SIGNAL_RESET,
            `PE signal reset – old H:${oldHigh.toFixed(2)} L:${oldLow.toFixed(2)} → new H:${c.high.toFixed(2)} L:${c.low.toFixed(2)}`,
            { signalHigh: c.high, signalLow: c.low, signalTime: timeStr(c.time), ema5: e5, rsi14: r14,
              oldSignalHigh: oldHigh, oldSignalLow: oldLow });
        } else if (!lowAboveEma && !rsiOverbought) {
          // Entry evaluation BEFORE signal clearing – when both overlap, entry takes priority
          tryEntry(S, c, i, e5, r14, events);
          if (!S.trade) {
            pushEvent(events, i, c, MountainEventType.SIGNAL_CLEARED,
              `PE signal cleared – low ${c.low.toFixed(2)} < EMA5 ${e5.toFixed(2)} & RSI ${r14.toFixed(1)} <= ${rsiOverboughtThreshold}`,
              { signalHigh: S.signal!.high, signalLow: S.signal!.low, ema5: e5, rsi14: r14 });
            S.signal = null;
          }
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // 3. ENTRY EVALUATION (only when no active trade and signal exists)
    // ══════════════════════════════════════════════════════════════════════
    if (!S.trade && S.signal !== null) {
      tryEntry(S, c, i, e5, r14, events);
    }

    // Track candles since last exit (for re-entry validation)
    if (S.lastExitTime !== null) {
      S.candlesSinceExit.push(c);
    }

    equityCurve.push({ timestamp: timeStr(c.time), value: cumulativePnl });
  }

  // Force-close any open trade at end of data
  if (S.trade && candles.length > 0) {
    const at = S.trade;
    const last = candles[candles.length - 1];
    const exitPnl = at.entryPrice - last.close;
    const exitPnlPct = ((at.entryPrice - last.close) / at.entryPrice) * 100;
    trades.push(finalizeTrade(at, candles.length - 1, last, 'MARKET_CLOSE', exitPnl, exitPnlPct));
    cumulativePnl += exitPnl;

    pushEvent(events, candles.length - 1, last, MountainEventType.EXIT_MARKET_CLOSE,
      `End of data – force closing open position. P&L: ${exitPnl.toFixed(2)}`,
      { entryPrice: at.entryPrice, exitPrice: last.close, exitReason: 'MARKET_CLOSE', pnl: exitPnl });

    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1].value = cumulativePnl;
    }
  }

  return { trades, events, summary: buildSummary(trades), equityCurve, indicators: { ema5, rsi14 } };
}

// ─── Pure helper functions ─────────────────────────────────────────────────────

interface StrategyState {
  signal: MountainSignal | null;
  trade: ActiveTrade | null;
  enteredIndices: Set<number>;
  candlesSinceExit: PlotlyCandlePoint[];
  lastExitTime: Date | null;
  prevDay: string | null;
}

function resetAfterExit(S: StrategyState, exitTime: Date) {
  S.trade = null;
  S.signal = null;
  S.lastExitTime = exitTime;
  S.candlesSinceExit = [];
  S.enteredIndices = new Set();
}

function createActiveTrade(
  c: PlotlyCandlePoint, idx: number, sig: MountainSignal, isFirst: boolean,
): ActiveTrade {
  return {
    entryPrice: c.close,
    entryTime: timeStr(c.time),
    entryCandleIndex: idx,
    isFirstEntry: isFirst,
    signalSnapshot: { ...sig },
    highDroppedBelowEma: false,
    consecutiveCloseAboveEma: 0,
  };
}

function tryEntry(
  S: StrategyState,
  c: PlotlyCandlePoint,
  idx: number,
  e5: number,
  r14: number,
  events: MountainEvent[],
): boolean {
  if (S.trade !== null || S.signal === null || c.close >= S.signal.low) return false;

  const isFirstEntry = !S.enteredIndices.has(S.signal.candleIndex);
  if (isFirstEntry) {
    S.trade = createActiveTrade(c, idx, S.signal, true);
    S.enteredIndices.add(S.signal.candleIndex);
    pushEvent(events, idx, c, MountainEventType.ENTRY_TRIGGERED,
      `FIRST ENTRY SHORT @ ${c.close.toFixed(2)} (signal L:${S.signal.low.toFixed(2)} H:${S.signal.high.toFixed(2)})`,
      { entryPrice: c.close, signalHigh: S.signal.high, signalLow: S.signal.low,
        signalTime: S.signal.time, ema5: e5, rsi14: r14 });
    return true;
  }
  const highestHigh = S.candlesSinceExit.reduce((mx, cc) => Math.max(mx, cc.high), -Infinity);
  if (highestHigh > S.signal.low) {
    S.trade = createActiveTrade(c, idx, S.signal, false);
    S.enteredIndices.add(S.signal.candleIndex);
    pushEvent(events, idx, c, MountainEventType.ENTRY_TRIGGERED,
      `RE-ENTRY SHORT @ ${c.close.toFixed(2)} (signal L:${S.signal.low.toFixed(2)} H:${S.signal.high.toFixed(2)})`,
      { entryPrice: c.close, signalHigh: S.signal.high, signalLow: S.signal.low,
        signalTime: S.signal.time, ema5: e5, rsi14: r14 });
    return true;
  }
  pushEvent(events, idx, c, MountainEventType.ENTRY_SKIPPED_REENTRY,
    `Re-entry skipped – highest high since exit ${highestHigh.toFixed(2)} <= signal.low ${S.signal.low.toFixed(2)}`,
    { highestHighSinceExit: highestHigh, signalLow: S.signal.low, ema5: e5, rsi14: r14 });
  return false;
}

function pushEvent(
  events: MountainEvent[], idx: number, c: PlotlyCandlePoint,
  type: MountainEventType, message: string, extra: Record<string, unknown>,
) {
  events.push({
    timestamp: timeStr(c.time),
    candleIndex: idx,
    type,
    message,
    details: {
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      ...extra,
    },
  });
}

function finalizeTrade(
  at: ActiveTrade, exitIdx: number, c: PlotlyCandlePoint, reason: ExitReason,
  pnl: number, pnlPct: number,
): MountainTrade {
  return {
    entryTime: at.entryTime,
    entryPrice: at.entryPrice,
    entryCandleIndex: at.entryCandleIndex,
    exitTime: timeStr(c.time),
    exitPrice: c.close,
    exitCandleIndex: exitIdx,
    exitReason: reason,
    pnl: Math.round(pnl * 100) / 100,
    pnlPercent: Math.round(pnlPct * 100) / 100,
    isFirstEntry: at.isFirstEntry,
    signalSnapshot: { ...at.signalSnapshot },
    durationCandles: exitIdx - at.entryCandleIndex,
  };
}

function buildSummary(trades: MountainTrade[]): MountainBacktestSummary {
  if (trades.length === 0) {
    return { total_trades: 0, winning_trades: 0, losing_trades: 0, win_rate: 0,
      total_pnl: 0, avg_pnl: 0, max_win: 0, max_loss: 0, profit_factor: 0 };
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const totalWinPnl = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLossPnl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const pnls = trades.map((t) => t.pnl);

  return {
    total_trades: trades.length,
    winning_trades: wins.length,
    losing_trades: losses.length,
    win_rate: Math.round((wins.length / trades.length) * 10000) / 100,
    total_pnl: Math.round(totalPnl * 100) / 100,
    avg_pnl: Math.round((totalPnl / trades.length) * 100) / 100,
    max_win: Math.round(Math.max(0, ...pnls) * 100) / 100,
    max_loss: Math.round(Math.min(0, ...pnls) * 100) / 100,
    profit_factor: totalLossPnl > 0 ? Math.round((totalWinPnl / totalLossPnl) * 100) / 100 : 0,
  };
}

function emptyResult(): MountainBacktestResult {
  return {
    trades: [],
    events: [],
    summary: { total_trades: 0, winning_trades: 0, losing_trades: 0, win_rate: 0,
      total_pnl: 0, avg_pnl: 0, max_win: 0, max_loss: 0, profit_factor: 0 },
    equityCurve: [],
    indicators: { ema5: [], rsi14: [] },
  };
}
