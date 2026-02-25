export type SignalType = 'PE';

export interface MountainSignal {
  type: SignalType;
  high: number;
  low: number;
  time: string;
  candleIndex: number;
}

export enum MountainEventType {
  SIGNAL_IDENTIFIED = 'SIGNAL_IDENTIFIED',
  SIGNAL_RESET = 'SIGNAL_RESET',
  SIGNAL_CLEARED = 'SIGNAL_CLEARED',
  ENTRY_TRIGGERED = 'ENTRY_TRIGGERED',
  ENTRY_SKIPPED_REENTRY = 'ENTRY_SKIPPED_REENTRY',
  EXIT_INDEX_STOP = 'EXIT_INDEX_STOP',
  EXIT_INDEX_TARGET = 'EXIT_INDEX_TARGET',
  EXIT_MARKET_CLOSE = 'EXIT_MARKET_CLOSE',
  NEW_DAY_RESET = 'NEW_DAY_RESET',
  MARKET_CLOSE_SIGNAL_CLEAR = 'MARKET_CLOSE_SIGNAL_CLEAR',
}

export interface MountainEvent {
  timestamp: string;
  candleIndex: number;
  type: MountainEventType;
  message: string;
  details: {
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    ema5?: number | null;
    rsi14?: number | null;
    signalHigh?: number;
    signalLow?: number;
    signalTime?: string;
    entryPrice?: number;
    exitPrice?: number;
    exitReason?: string;
    pnl?: number;
    highestHighSinceExit?: number;
    [key: string]: unknown;
  };
}

export type ExitReason = 'INDEX_STOP' | 'INDEX_TARGET' | 'MARKET_CLOSE';

export interface MountainTrade {
  entryTime: string;
  entryPrice: number;
  entryCandleIndex: number;
  exitTime: string;
  exitPrice: number;
  exitCandleIndex: number;
  exitReason: ExitReason;
  pnl: number;
  pnlPercent: number;
  isFirstEntry: boolean;
  signalSnapshot: MountainSignal;
  durationCandles: number;
}

export interface MountainBacktestSummary {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
  max_win: number;
  max_loss: number;
  profit_factor: number;
}

export interface EquityPoint {
  timestamp: string;
  value: number;
}

export interface MountainBacktestResult {
  trades: MountainTrade[];
  events: MountainEvent[];
  summary: MountainBacktestSummary;
  equityCurve: EquityPoint[];
  indicators: {
    ema5: (number | null)[];
    rsi14: (number | null)[];
  };
}
