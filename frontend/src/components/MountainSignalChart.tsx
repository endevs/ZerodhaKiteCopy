import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Customized, XAxisProps, YAxisProps } from 'recharts';

interface Strategy {
  id: number;
  strategy_name: string;
  strategy_type: string;
  instrument: string;
  candle_time: string;
  ema_period?: number;
  start_time: string;
  end_time: string;
}

interface CandleData {
  x: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface ChartDataResponse {
  candles: CandleData[];
  ema5: Array<{ x: string; y: number | null }>;
  ema20?: Array<{ x: string; y: number | null }>;
  rsi14?: Array<{ x: string; y: number | null }>;
}

interface SignalCandle {
  index: number;
  type: 'PE' | 'CE';
  high: number;
  low: number;
  time: string;
}

interface TradeEvent {
  index: number;
  type: 'ENTRY' | 'EXIT' | 'STOP_LOSS' | 'TARGET' | 'MKT_CLOSE';
  tradeType: 'PE' | 'CE';
  price: number;
  time: string;
  signalCandleIndex: number;
}

interface IgnoredSignal {
  index: number;
  signalTime: string;
  signalType: 'PE' | 'CE';
  signalHigh: number;
  signalLow: number;
  reason: string;
  rsiValue: number | null;
}

interface WaitingSignal {
  index: number;
  signalTime: string;
  signalType: 'PE' | 'CE';
  signalHigh: number;
  signalLow: number;
  breakLevel: number;
  currentClose: number;
  rsiValue: number | null;
  emaValue: number;
}

interface RuleConfig {
  strikeRounding: Record<string, number>;
  lotSizes: Record<string, number>;
  optionTrade: {
    stopLossPercent: number;
    targetPercent: number;
  };
  exitPriority: string[];
  evaluationSecondsBeforeClose: number;
  rsiThreshold: number;
}

interface MountainSignalChartProps {
  strategy: Strategy;
  activeTab?: 'chart' | 'backtest' | 'optimizer';
}

interface TimeframeStat {
  label: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  avgPnl: number;
}

interface OptimizerSummary {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  averagePnl: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  roiPercent: number;
  openTrades: number;
  bestDay: TimeframeStat | null;
  worstDay: TimeframeStat | null;
  parameters: {
    stopLossPercent: number;
    targetPercent: number;
    lotSize: number;
    strikeStep: number;
    initialInvestment: number;
    rsiThreshold: number;
  };
  dateRange?: {
    from: string;
    to: string;
    days: number;
  };
}

interface OptimizerResults {
  summary: OptimizerSummary;
  optionSummary: OptimizerSummary;
  timeframes: {
    daily: TimeframeStat[];
    weekly: TimeframeStat[];
    monthly: TimeframeStat[];
    yearly: TimeframeStat[];
  };
  optionTimeframes: {
    daily: TimeframeStat[];
    weekly: TimeframeStat[];
    monthly: TimeframeStat[];
    yearly: TimeframeStat[];
  };
}

interface TimeframeTreeNode {
  id: string;
  label: string;
  stats: TimeframeStat | null;
  children: TimeframeTreeNode[];
  type: 'year' | 'month' | 'weekGroup' | 'week' | 'day';
  order?: number;
}

const monthNamesFull = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const buildTimeframeTree = (
  timeframes: {
    daily: TimeframeStat[];
    weekly: TimeframeStat[];
    monthly: TimeframeStat[];
    yearly: TimeframeStat[];
  } | undefined,
  prefix: string
): TimeframeTreeNode[] => {
  if (!timeframes) {
    return [];
  }

  const tree: TimeframeTreeNode[] = [];
  const yearMap = new Map<string, TimeframeTreeNode>();
  const monthMap = new Map<string, TimeframeTreeNode>();
  const weekGroupMap = new Map<string, TimeframeTreeNode>();

  const getYearNode = (year: string): TimeframeTreeNode => {
    let node = yearMap.get(year);
    if (!node) {
      node = {
        id: `${prefix}-year-${year}`,
        label: year,
        stats: null,
        children: [],
        type: 'year',
        order: Number(year),
      };
      yearMap.set(year, node);
      tree.push(node);
    }
    return node;
  };

  const getMonthNode = (year: string, month: string): TimeframeTreeNode => {
    const monthKey = `${year}-${month}`;
    let node = monthMap.get(monthKey);
    if (!node) {
      const monthIndex = parseInt(month, 10) - 1;
      const monthName = monthNamesFull[monthIndex] ?? `Month ${month}`;
      node = {
        id: `${prefix}-month-${monthKey}`,
        label: `${monthName} ${year}`,
        stats: null,
        children: [],
        type: 'month',
        order: monthIndex,
      };
      monthMap.set(monthKey, node);
      const yearNode = getYearNode(year);
      yearNode.children.push(node);
    }
    return node;
  };

  (timeframes.yearly ?? []).forEach((stat) => {
    const yearNode = getYearNode(stat.label);
    yearNode.stats = stat;
  });

  (timeframes.monthly ?? []).forEach((stat) => {
    const [year, month] = stat.label.split('-');
    if (!year || !month) {
      return;
    }
    const monthNode = getMonthNode(year, month);
    monthNode.stats = stat;
  });

  (timeframes.daily ?? []).forEach((stat) => {
    const parts = stat.label.split('-');
    if (parts.length < 3) {
      return;
    }
    const [year, month, day] = parts;
    const monthNode = getMonthNode(year, month);
    const dateObj = new Date(stat.label);
    const dayLabel = Number.isNaN(dateObj.getTime())
      ? stat.label
      : dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    monthNode.children.push({
      id: `${prefix}-day-${stat.label}`,
      label: dayLabel,
      stats: stat,
      children: [],
      type: 'day',
      order: parseInt(day, 10),
    });
  });

  (timeframes.weekly ?? []).forEach((stat) => {
    const parts = stat.label.split('-');
    if (parts.length < 2) {
      return;
    }
    const year = parts[0];
    const weekPart = parts[1];
    const yearNode = getYearNode(year);
    let weekGroup = weekGroupMap.get(year);
    if (!weekGroup) {
      weekGroup = {
        id: `${prefix}-weeks-${year}`,
        label: 'Weekly Breakdown',
        stats: null,
        children: [],
        type: 'weekGroup',
        order: 100,
      };
      weekGroupMap.set(year, weekGroup);
      yearNode.children.push(weekGroup);
    }
    const weekNumber = parseInt(weekPart.replace('W', ''), 10);
    weekGroup.children.push({
      id: `${prefix}-week-${stat.label}`,
      label: `Week ${weekPart.replace('W', '')}`,
      stats: stat,
      children: [],
      type: 'week',
      order: Number.isNaN(weekNumber) ? undefined : weekNumber,
    });
  });

  tree.forEach((yearNode) => {
    yearNode.children.forEach((child) => {
      if (child.children && child.children.length > 0) {
        child.children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      }
    });

    yearNode.children.sort((a, b) => {
      const typePriority: Record<string, number> = {
        month: 0,
        weekGroup: 1,
        week: 0,
        day: 0,
        year: 0,
      };
      const priorityDiff = (typePriority[a.type] ?? 0) - (typePriority[b.type] ?? 0);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return (a.order ?? 0) - (b.order ?? 0);
    });
  });

  tree.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));

  return tree;
};

const MountainSignalChart: React.FC<MountainSignalChartProps> = ({ strategy, activeTab = 'chart' }) => {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [chartData, setChartData] = useState<ChartDataResponse>({ candles: [], ema5: [] });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);
  const [signalCandles, setSignalCandles] = useState<SignalCandle[]>([]);
  const [tradeEvents, setTradeEvents] = useState<TradeEvent[]>([]);
  const [peBreakLevel, setPeBreakLevel] = useState<number | null>(null);
  const [ceBreakLevel, setCeBreakLevel] = useState<number | null>(null);
  const [chartType, setChartType] = useState<'candlestick' | 'line'>('line');
  const [ignoredSignals, setIgnoredSignals] = useState<IgnoredSignal[]>([]);
  const [waitingSignals, setWaitingSignals] = useState<WaitingSignal[]>([]);
  const [optimizerFromDate, setOptimizerFromDate] = useState<string>('');
  const [optimizerToDate, setOptimizerToDate] = useState<string>('');
  const [optimizerStopLossPercent, setOptimizerStopLossPercent] = useState<number>(17);
  const [optimizerTargetPercent, setOptimizerTargetPercent] = useState<number>(45);
  const [optimizerRsiThreshold, setOptimizerRsiThreshold] = useState<number>(70);
  const [optimizerInitialInvestment, setOptimizerInitialInvestment] = useState<number>(100000);
  const [optimizerLoading, setOptimizerLoading] = useState<boolean>(false);
  const [optimizerError, setOptimizerError] = useState<string | null>(null);
  const [optimizerResults, setOptimizerResults] = useState<OptimizerResults | null>(null);
  const [tradeHistory, setTradeHistory] = useState<Array<{
    signalIndex: number;
    signalTime: string;
    signalType: 'PE' | 'CE';
    signalHigh: number;
    signalLow: number;
    entryIndex: number;
    entryTime: string;
    entryPrice: number;
    exitIndex: number | null;
    exitTime: string | null;
    exitPrice: number | null;
    exitType: 'STOP_LOSS' | 'TARGET' | 'MKT_CLOSE' | null;
    pnl: number | null;
    pnlPercent: number | null;
  }>>([]);
  
  // Real Option Contract Trade History
  const [optionTradeHistory, setOptionTradeHistory] = useState<Array<{
    signalIndex: number;
    signalTime: string;
    signalType: 'PE' | 'CE';
    signalHigh: number;
    signalLow: number;
    indexAtEntry: number;
    atmStrike: number;
    optionSymbol: string;
    entryIndex: number;
    entryTime: string;
    optionEntryPrice: number; // Option contract premium
    exitIndex: number | null;
    exitTime: string | null;
    optionExitPrice: number | null; // Option contract premium
    exitType: 'STOP_LOSS' | 'TARGET' | 'MKT_CLOSE' | null;
    stopLossPrice: number; // Rule-based stop loss price
    targetPrice: number; // Rule-based target price
    pnl: number | null;
    pnlPercent: number | null;
    status?: string;
    lotSize?: number;
  }>>([]);
  const [optionLtpMap, setOptionLtpMap] = useState<Record<string, number>>({});
  const [ruleConfig, setRuleConfig] = useState<RuleConfig>({
    strikeRounding: {
      BANKNIFTY: 100,
      NIFTY: 50,
    },
    lotSizes: {
      BANKNIFTY: 35,
      NIFTY: 75,
    },
    optionTrade: {
      stopLossPercent: -0.17,
      targetPercent: 0.45,
    },
    exitPriority: [],
    evaluationSecondsBeforeClose: 20,
  rsiThreshold: 70,
  });
  const [expandedTreeNodes, setExpandedTreeNodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadRuleConfig = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/rules/mountain_signal', {
          credentials: 'include',
        });
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (data.status === 'success' && data.rules) {
          const rules = data.rules;
          setRuleConfig((prev) => ({
            strikeRounding: {
              ...prev.strikeRounding,
              ...(rules.strike_rounding || {}),
            },
            lotSizes: {
              ...prev.lotSizes,
              ...(rules.lot_sizes || {}),
            },
            optionTrade: {
              stopLossPercent: rules.option_trade?.stop_loss_percent ?? prev.optionTrade.stopLossPercent,
              targetPercent: rules.option_trade?.target_percent ?? prev.optionTrade.targetPercent,
            },
            exitPriority: rules.exit_priority || prev.exitPriority,
            evaluationSecondsBeforeClose: rules.evaluation?.seconds_before_close ?? prev.evaluationSecondsBeforeClose,
            rsiThreshold:
              rules.signals?.PE?.rsi_threshold ??
              rules.signals?.pe?.rsi_threshold ??
              prev.rsiThreshold,
          }));
        }
      } catch (rulesError) {
        console.error('Error loading rule configuration:', rulesError);
      }
    };

    loadRuleConfig();
  }, []);
  
  useEffect(() => {
    const defaultStopLossPercent = Math.abs(ruleConfig.optionTrade.stopLossPercent) * 100;
    const defaultTargetPercent = Math.abs(ruleConfig.optionTrade.targetPercent) * 100;
    const defaultRsiThreshold = ruleConfig.rsiThreshold ?? 70;

    if (!optimizerResults) {
      setOptimizerStopLossPercent(Number(defaultStopLossPercent.toFixed(2)));
      setOptimizerTargetPercent(Number(defaultTargetPercent.toFixed(2)));
      setOptimizerRsiThreshold(Number(defaultRsiThreshold.toFixed(2)));
    }
  }, [ruleConfig.optionTrade.stopLossPercent, ruleConfig.optionTrade.targetPercent, optimizerResults]);
  
  useEffect(() => {
    if (!optimizerResults) {
      setExpandedTreeNodes(new Set());
      return;
    }

    const expanded = new Set<string>();
    (optimizerResults.timeframes?.yearly ?? []).forEach((stat) => {
      expanded.add(`index-year-${stat.label}`);
    });
    (optimizerResults.optionTimeframes?.yearly ?? []).forEach((stat) => {
      expanded.add(`option-year-${stat.label}`);
    });
    setExpandedTreeNodes(expanded);
  }, [optimizerResults]);
  
  // Backtest state
  const [backtestFromDate, setBacktestFromDate] = useState<string>('');
  const [backtestToDate, setBacktestToDate] = useState<string>('');
  const [backtestLoading, setBacktestLoading] = useState<boolean>(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [filterPE, setFilterPE] = useState<boolean>(true);
  const [filterCE, setFilterCE] = useState<boolean>(false);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [backtestResults, setBacktestResults] = useState<{
    trades: Array<{
      signalTime: string;
      signalType: 'PE' | 'CE';
      signalHigh: number;
      signalLow: number;
      entryTime: string;
      entryPrice: number;
      exitTime: string | null;
      exitPrice: number | null;
      exitType:
        | 'STOP_LOSS'
        | 'TARGET'
        | 'MKT_CLOSE'
        | 'OPTION_STOP_LOSS'
        | 'OPTION_TARGET'
        | 'INDEX_STOP'
        | 'INDEX_TARGET'
        | 'FORCED_CLOSE'
        | null;
      pnl: number | null;
      pnlPercent: number | null;
      date: string;
      lotSize: number | null;
      optionTradeId: number | null;
      optionSymbol: string | null;
      optionEntryPrice: number | null;
      stopLossPrice: number | null;
      targetPrice: number | null;
      optionExitPrice: number | null;
    }>;
    summary: {
      totalTrades: number;
      winningTrades: number;
      losingTrades: number;
      winRate: number;
      totalPnl: number;
      averagePnl: number;
      maxDrawdown: number;
      maxDrawdownPercent: number;
      maxWinningDay: { date: string; pnl: number };
      maxLosingDay: { date: string; pnl: number };
    };
    optionTrades: Array<{
      id: number | null;
      indexTradeIndex: number | null;
      signalTime: string;
      signalType: 'PE' | 'CE';
      signalHigh: number | null;
      signalLow: number | null;
      entryTime: string;
      indexAtEntry: number | null;
      atmStrike: number | null;
      optionSymbol: string | null;
      optionEntryPrice: number | null;
      stopLossPrice: number | null;
      targetPrice: number | null;
      optionExitPrice: number | null;
      exitTime: string | null;
      exitType: string | null;
      pnl: number | null;
      pnlPercent: number | null;
      status: string;
      lotSize: number | null;
      date: string;
    }>;
    optionSummary: {
      totalTrades: number;
      winningTrades: number;
      losingTrades: number;
      winRate: number;
      totalPnl: number;
      averagePnl: number;
      maxWinningDay: { date: string; pnl: number };
      maxLosingDay: { date: string; pnl: number };
    };
  } | null>(null);

  const emaPeriod = strategy.ema_period || 5;
  const candleTime = parseInt(strategy.candle_time) || 5;
  const instrument = strategy.instrument; // NIFTY or BANKNIFTY
  
  // Helper functions to interpret rule configuration
  const getInstrumentKey = (symbol: string): string => symbol.toUpperCase();

  const roundToATM = (price: number, instrumentSymbol: string): number => {
    const key = getInstrumentKey(instrumentSymbol);
    const rounding = ruleConfig.strikeRounding[key] ?? (key.includes('BANK') ? 100 : 50);
    if (rounding === 0) {
      return price;
    }
    return Math.round(price / rounding) * rounding;
  };

  const getLotSize = (instrumentSymbol: string): number => {
    const key = getInstrumentKey(instrumentSymbol);
    return ruleConfig.lotSizes[key] ?? (key.includes('BANK') ? 35 : 75);
  };

  const formatPercentValue = (value: number): string => {
    const decimals = Number.isInteger(value) ? 0 : 2;
    return value.toFixed(decimals);
  };

  const formatNumericValue = (value: number): string => {
    const decimals = Number.isInteger(value) ? 0 : 2;
    return value.toFixed(decimals).replace(/\.00$/, '');
  };

  const MAX_OPTIMIZER_DAYS = 365 * 3;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  const validateOptimizerInputs = (): string | null => {
    if (!optimizerFromDate || !optimizerToDate) {
      return 'Please select both from and to dates';
    }

    const fromDate = new Date(optimizerFromDate);
    const toDate = new Date(optimizerToDate);

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return 'Invalid date selection';
    }

    if (fromDate > toDate) {
      return 'From date must be before or equal to To date';
    }

    const diffDays = Math.floor((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY) + 1;
    if (diffDays > MAX_OPTIMIZER_DAYS) {
      return 'Maximum 3 years allowed. Please adjust the date range';
    }

    if (optimizerStopLossPercent <= 0) {
      return 'Stop loss percent must be greater than 0';
    }

    if (optimizerTargetPercent <= 0) {
      return 'Target percent must be greater than 0';
    }

    if (optimizerRsiThreshold <= 0) {
      return 'RSI threshold must be greater than 0';
    }

    if (optimizerInitialInvestment <= 0) {
      return 'Initial investment must be greater than 0';
    }

    return null;
  };

  const runOptimizer = async () => {
    const validationError = validateOptimizerInputs();
    if (validationError) {
      setOptimizerError(validationError);
      return;
    }

    setOptimizerLoading(true);
    setOptimizerError(null);

    try {
      const response = await fetch('http://localhost:8000/api/optimizer_mountain_signal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          strategy_id: strategy.id,
          from_date: optimizerFromDate,
          to_date: optimizerToDate,
          instrument: strategy.instrument,
          candle_time: strategy.candle_time,
          ema_period: strategy.ema_period || 5,
          option_stop_loss_percent: optimizerStopLossPercent,
          option_target_percent: optimizerTargetPercent,
          initial_investment: optimizerInitialInvestment,
          rsi_threshold: optimizerRsiThreshold,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to optimize strategy');
      }

      const data = await response.json();
      if (data.status === 'success') {
        const { status, ...payload } = data;
        setOptimizerResults(payload as OptimizerResults);
      } else {
        throw new Error(data.message || 'Optimization failed');
      }
    } catch (err) {
      console.error('Error running optimizer:', err);
      setOptimizerError(err instanceof Error ? err.message : 'An error occurred while running optimizer');
    } finally {
      setOptimizerLoading(false);
    }
  };

  const getExitBadgeClass = (exitType: string | null | undefined): string => {
    switch (exitType) {
      case 'STOP_LOSS':
      case 'OPTION_STOP_LOSS':
      case 'INDEX_STOP':
        return 'bg-danger';
      case 'TARGET':
      case 'OPTION_TARGET':
      case 'INDEX_TARGET':
        return 'bg-warning';
      case 'MKT_CLOSE':
      case 'MARKET_CLOSE':
        return 'bg-secondary';
      case 'FORCED_CLOSE':
        return 'bg-dark';
      default:
        return 'bg-primary';
    }
  };

  const getExitLabel = (exitType: string | null | undefined): string => {
    switch (exitType) {
      case 'STOP_LOSS':
        return 'Stop Loss';
      case 'TARGET':
        return 'Target';
      case 'MKT_CLOSE':
        return 'Market Close';
      case 'OPTION_STOP_LOSS':
        return 'Option SL';
      case 'OPTION_TARGET':
        return 'Option Target';
      case 'INDEX_STOP':
        return 'Index Stop';
      case 'INDEX_TARGET':
        return 'Index Target';
      case 'MARKET_CLOSE':
        return 'Market Close';
      case 'FORCED_CLOSE':
        return 'Forced Close';
      default:
        return exitType || '-';
    }
  };

  const stopLossPercentSigned = ruleConfig.optionTrade.stopLossPercent * 100;
  const targetPercentSigned = ruleConfig.optionTrade.targetPercent * 100;
  const stopLossPercentAbsLabel = formatPercentValue(Math.abs(stopLossPercentSigned));
  const targetPercentAbsLabel = formatPercentValue(Math.abs(targetPercentSigned));
  const stopLossPercentLabelWithSign = `${stopLossPercentSigned < 0 ? '-' : '+'}${stopLossPercentAbsLabel}`;
  const targetPercentLabelWithSign = `${targetPercentSigned < 0 ? '-' : '+'}${targetPercentAbsLabel}`;

  const bankLotSizeDisplay = formatNumericValue(ruleConfig.lotSizes.BANKNIFTY ?? 35);
  const niftyLotSizeDisplay = formatNumericValue(ruleConfig.lotSizes.NIFTY ?? 75);
  const bankRoundingDisplay = formatNumericValue(ruleConfig.strikeRounding.BANKNIFTY ?? 100);
  const niftyRoundingDisplay = formatNumericValue(ruleConfig.strikeRounding.NIFTY ?? 50);
  const evaluationSecondsDisplay = ruleConfig.evaluationSecondsBeforeClose;
  
  // Helper function to get option symbol with proper format
  const getOptionSymbol = (strike: number, optionType: 'PE' | 'CE', instrument: string, date: string): string => {
    const instrumentName = instrument.toUpperCase().includes('BANK') ? 'BANKNIFTY' : 'NIFTY';
    
    // Get year (last 2 digits) and month from the date
    const dateObj = new Date(date);
    const year = dateObj.getFullYear().toString().slice(-2); // Last 2 digits (e.g., 2025 → 25)
    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const month = monthNames[dateObj.getMonth()];
    
    // Format: BANKNIFTY25NOV57700PE or NIFTY25NOV19550CE
    return `${instrumentName}${year}${month}${strike}${optionType}`;
  };
  
  // Simulate option premium (for visualization - in real trading, fetch from API)
  const simulateOptionPremium = (indexPrice: number, strike: number, optionType: 'PE' | 'CE'): number => {
    // Simple simulation: premium based on distance from ATM
    const distance = Math.abs(indexPrice - strike);
    const distancePercent = distance / strike;
    
    // Base premium (simplified model)
    let premium = 100; // Base premium
    
    if (optionType === 'PE') {
      // PE: More valuable when strike > index (ITM)
      if (strike > indexPrice) {
        premium += distance * 0.5; // ITM premium
      } else {
        premium -= distance * 0.3; // OTM discount
      }
    } else {
      // CE: More valuable when strike < index (ITM)
      if (strike < indexPrice) {
        premium += distance * 0.5; // ITM premium
      } else {
        premium -= distance * 0.3; // OTM discount
      }
    }
    
    return Math.max(10, premium); // Minimum ₹10
  };

  // Set today's date as default
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    setSelectedDate(today);
  }, []);

  const fetchChartData = useCallback(async () => {
    if (!selectedDate) {
      setError('Please select a date');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `http://localhost:8000/api/chart_data?date=${selectedDate}&instrument=${encodeURIComponent(strategy.instrument)}&interval=${candleTime}m`,
        { credentials: 'include' }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch chart data');
      }

      const data: ChartDataResponse = await response.json();
      setChartData(data);
      const fetchTimestamp = new Date();
      setLastUpdateTime(fetchTimestamp); // Track when data was last updated

      if (data.candles.length === 0) {
        setError('No data available for the selected date');
      } else {
        // Process Mountain Signal logic (returns simulated option trades as fallback)
        const simulatedOptionTrades = processMountainSignalLogic(data) || [];
        setOptionLtpMap({});

        let optionTradesSetFromServer = false;

        try {
          const optionHistoryResponse = await fetch(
            `http://localhost:8000/api/option_trade_history?instrument=${encodeURIComponent(strategy.instrument)}`,
            { credentials: 'include' }
          );

          if (optionHistoryResponse.ok) {
            const optionData = await optionHistoryResponse.json();
            if (optionData.status === 'success' && Array.isArray(optionData.trades) && optionData.trades.length > 0) {
              const normalizedTrades = optionData.trades.map((trade: any) => ({
                signalTime: trade.signalTime,
                signalType: trade.signalType,
                signalHigh: trade.signalHigh,
                signalLow: trade.signalLow,
                indexAtEntry: trade.indexAtEntry,
                atmStrike: trade.atmStrike,
                optionSymbol: trade.optionSymbol,
                entryTime: trade.entryTime,
                optionEntryPrice: trade.optionEntryPrice,
                stopLossPrice: trade.stopLossPrice,
                targetPrice: trade.targetPrice,
                optionExitPrice: trade.optionExitPrice,
                exitTime: trade.exitTime,
                exitType: trade.exitType,
                pnl: trade.pnl,
                pnlPercent: trade.pnlPercent,
                status: trade.status || 'open',
                lotSize: trade.lotSize ?? trade.lot_size ?? getLotSize(strategy.instrument)
              }));

              setOptionTradeHistory(normalizedTrades);
              optionTradesSetFromServer = true;

               const openSymbols = normalizedTrades
                 .filter((trade: typeof normalizedTrades[number]) => trade.status !== 'closed' && !!trade.optionSymbol)
                 .map((trade: typeof normalizedTrades[number]) => trade.optionSymbol as string);

               if (openSymbols.length > 0) {
                 try {
                   const uniqueSymbols = Array.from(new Set(openSymbols));
                   const ltpResp = await fetch(
                     `http://localhost:8000/api/option_ltp?symbols=${encodeURIComponent(uniqueSymbols.join(','))}`,
                     { credentials: 'include' }
                   );
                   if (ltpResp.ok) {
                     const ltpData = await ltpResp.json();
                     if (ltpData.status === 'success' && ltpData.ltp) {
                       setOptionLtpMap(ltpData.ltp);
                     }
                   }
                 } catch (ltpError) {
                   console.error('Error fetching option LTP data:', ltpError);
                 }
               }
            }
          }
        } catch (optionError) {
          console.error('Error fetching option trade history:', optionError);
        }

        if (!optionTradesSetFromServer) {
          setOptionTradeHistory(simulatedOptionTrades);
          setOptionLtpMap({});
        }
      }
    } catch (err) {
      console.error('Error fetching chart data:', err);
      setError(err instanceof Error ? err.message : 'An error occurred while fetching chart data');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, strategy.instrument, candleTime]);

  // Fetch chart data when date or strategy changes
  useEffect(() => {
    if (selectedDate) {
      fetchChartData();
    }
  }, [selectedDate, fetchChartData]);

  // Auto-refresh when viewing today's date (every 30 seconds for live P&L updates)
  useEffect(() => {
    if (!selectedDate) return;
    
    const today = new Date().toISOString().split('T')[0];
    const isToday = selectedDate === today;
    
    if (isToday && activeTab === 'chart') {
      // Set up auto-refresh interval
      const refreshInterval = setInterval(() => {
        console.log('Auto-refreshing chart data for live P&L updates...');
        fetchChartData();
      }, 30000); // Refresh every 30 seconds
      
      return () => clearInterval(refreshInterval);
    }
  }, [selectedDate, activeTab, fetchChartData]);

  const processMountainSignalLogic = (data: ChartDataResponse) => {
    /**
     * SIGNAL EVALUATION TIMING: 20 Seconds Before Candle Close
     * 
     * LIVE TRADING (Backend):
     * - Signals are evaluated 20 seconds BEFORE each 5-minute candle closes
     * - For example, for a 10:30-10:35 candle, evaluation happens at 10:34:40
     * - At this time, the candle is 99% complete (4 min 40 sec out of 5 min)
     * - This gives earlier signal detection for faster trade entries
     * 
     * HISTORICAL VISUALIZATION (Frontend/This Code):
     * - We process COMPLETED candles with full OHLC data
     * - Signal evaluation happens after candle close (retrospective view)
     * - This shows what signals WOULD have been detected in real-time
     * - The logic matches the backend but operates on completed candles
     * 
     * WHY 20 SECONDS BEFORE?
     * - Gets 99% complete candle data (very accurate)
     * - Allows earlier trade entries (20 seconds sooner)
     * - Mimics real-world trading where you watch forming candles
     * - Reduces lag between signal detection and entry execution
     */
    const candles = data.candles;
    const ema5Values = data.ema5.map(e => e.y).filter(v => v !== null && v !== undefined) as number[];
    const rsi14Values = data.rsi14 ? data.rsi14.map(e => e.y).filter(v => v !== null && v !== undefined) as number[] : [];
    
    if (candles.length < emaPeriod + 1 || ema5Values.length < emaPeriod + 1) {
      return; // Not enough data
    }

    const signals: SignalCandle[] = [];
    const trades: TradeEvent[] = [];
    const ignored: IgnoredSignal[] = [];
    const waiting: WaitingSignal[] = [];
    // Track latest waiting signal per type to avoid duplicates
    let latestPeWaiting: WaitingSignal | null = null;
    let latestCeWaiting: WaitingSignal | null = null;
    let currentPeSignal: SignalCandle | null = null;
    let currentCeSignal: SignalCandle | null = null;
    let activeTradeEvent: TradeEvent | null = null;
    let consecutiveCandlesForTarget: number = 0;
    let lastCandleHighLessThanEMA: boolean = false;
    let lastCandleLowGreaterThanEMA: boolean = false;
    // Track which signal candles have already had an entry
    const signalCandlesWithEntry = new Set<number>();
    // Track if price has traded above PE signal low / below CE signal high (required before entry)
    let peSignalPriceAboveLow: boolean = false;
    let ceSignalPriceBelowHigh: boolean = false;

    // Process each candle
    for (let i = emaPeriod; i < candles.length; i++) {
      const candle = candles[i];
      const prevCandle = candles[i - 1];
      const ema5 = ema5Values[i] || ema5Values[i - 1] || 0;
      const candleLow = candle.l;
      const candleHigh = candle.h;
      const candleClose = candle.c;
      const prevCandleClose = prevCandle.c;

      // Get RSI value for current candle (for signal identification only)
      const currentRsi = rsi14Values.length > i ? rsi14Values[i] : null;

      // --- SIGNAL CANDLE IDENTIFICATION ---
      // NOTE: In live trading, this evaluation happens 20 seconds before candle close
      // Here we use completed candle data for historical visualization
      
      // PE Signal Candle Identification: LOW > 5 EMA AND RSI > 70
      if (candleLow > ema5) {
        // RSI condition must be met at signal identification time
        if (currentRsi !== null && currentRsi > 70) {
          // Signal Reset: If a newer candle meets the same criteria (LOW > 5 EMA + RSI > 70), 
          // it REPLACES the previous PE signal candle
          if (currentPeSignal) {
            // New PE signal candle identified - old signal candle is now invalid
            currentPeSignal = {
              index: i,
              type: 'PE',
              high: candleHigh,
              low: candleLow,
              time: candle.x
            };
            signals.push(currentPeSignal);
            // Old signal candle is replaced, reset price action tracking
            peSignalPriceAboveLow = false;
            // Clear entry tracking for old signal (new signal will start fresh)
            signalCandlesWithEntry.delete(currentPeSignal.index);
            setPeBreakLevel(null);
          } else {
            // First PE signal
            currentPeSignal = {
              index: i,
              type: 'PE',
              high: candleHigh,
              low: candleLow,
              time: candle.x
            };
            signals.push(currentPeSignal);
            // Reset price action tracking for new signal
            peSignalPriceAboveLow = false;
            // New signal candle starts fresh (no previous entries)
            signalCandlesWithEntry.delete(currentPeSignal.index);
          }
        }
        // If RSI condition not met, log as ignored (only if no current signal exists)
        else if (!currentPeSignal) {
          ignored.push({
            index: i,
            signalTime: candle.x,
            signalType: 'PE',
            signalHigh: candleHigh,
            signalLow: candleLow,
            reason: `Signal candle identified but RSI condition not met (RSI must be > 70, current: ${currentRsi !== null ? currentRsi.toFixed(2) : 'N/A'})`,
            rsiValue: currentRsi
          });
        }
      }

      // CE Signal Candle Identification: HIGH < 5 EMA AND RSI < 30
      if (candleHigh < ema5) {
        // RSI condition must be met at signal identification time
        if (currentRsi !== null && currentRsi < 30) {
          // Signal Reset: If a newer candle meets the same criteria (HIGH < 5 EMA + RSI < 30), 
          // it REPLACES the previous CE signal candle
          if (currentCeSignal) {
            // New CE signal candle identified - old signal candle is now invalid
            currentCeSignal = {
              index: i,
              type: 'CE',
              high: candleHigh,
              low: candleLow,
              time: candle.x
            };
            signals.push(currentCeSignal);
            // Old signal candle is replaced, reset price action tracking
            ceSignalPriceBelowHigh = false;
            // Clear entry tracking for old signal (new signal will start fresh)
            signalCandlesWithEntry.delete(currentCeSignal.index);
            setCeBreakLevel(null);
          } else {
            // First CE signal
            currentCeSignal = {
              index: i,
              type: 'CE',
              high: candleHigh,
              low: candleLow,
              time: candle.x
            };
            signals.push(currentCeSignal);
            // Reset price action tracking for new signal
            ceSignalPriceBelowHigh = false;
            // New signal candle starts fresh (no previous entries)
            signalCandlesWithEntry.delete(currentCeSignal.index);
          }
        }
        // If RSI condition not met, log as ignored (only if no current signal exists)
        else if (!currentCeSignal) {
          ignored.push({
            index: i,
            signalTime: candle.x,
            signalType: 'CE',
            signalHigh: candleHigh,
            signalLow: candleLow,
            reason: `Signal candle identified but RSI condition not met (RSI must be < 30, current: ${currentRsi !== null ? currentRsi.toFixed(2) : 'N/A'})`,
            rsiValue: currentRsi
          });
        }
      }

      // Track price action: Check if price has traded above PE signal low or below CE signal high
      // This validation is only needed AFTER a trade exit (stop loss or target), not before first entry
      if (currentPeSignal && !activeTradeEvent && !peSignalPriceAboveLow) {
        // Check if price (high) has traded above PE signal candle's low
        // Only check if no active trade (meaning we're waiting for re-entry after exit)
        if (candleHigh > currentPeSignal.low) {
          peSignalPriceAboveLow = true;
        }
      }
      
      if (currentCeSignal && !activeTradeEvent && !ceSignalPriceBelowHigh) {
        // Check if price (low) has traded below CE signal candle's high
        // Only check if no active trade (meaning we're waiting for re-entry after exit)
        if (candleLow < currentCeSignal.high) {
          ceSignalPriceBelowHigh = true;
        }
      }

      // Entry Triggers (only if no active trade)
      // RSI is checked only at signal identification, not at entry time
      if (!activeTradeEvent) {
        // PE Entry: Next candle CLOSE < signal candle LOW
        // For first entry: no price action validation needed
        // For re-entry after exit: price must have previously traded ABOVE the signal candle's low
        const isFirstEntry = !signalCandlesWithEntry.has(currentPeSignal?.index || -1);
        const peEntryAllowed = isFirstEntry || peSignalPriceAboveLow;
        
        if (currentPeSignal && candleClose < currentPeSignal.low && peEntryAllowed) {
          // Entry taken - signal candle already validated with RSI at identification time
          // and price action requirement met
          activeTradeEvent = {
            index: i,
            type: 'ENTRY',
            tradeType: 'PE',
            price: candleClose,
            time: candle.x,
            signalCandleIndex: currentPeSignal.index
          };
          trades.push(activeTradeEvent);
          signalCandlesWithEntry.add(currentPeSignal.index);
          setPeBreakLevel(currentPeSignal.low);
          // Reset price action validation after entry (for next exit/entry cycle)
          peSignalPriceAboveLow = false;
        } else if (currentPeSignal && !activeTradeEvent) {
          // Signal exists but entry condition not met yet - track as waiting
          // Only track if no active trade and entry not blocked
          if (peEntryAllowed) {
            // Update latest waiting signal (replaces previous waiting states for same signal type)
            latestPeWaiting = {
              index: i,
              signalTime: currentPeSignal.time,
              signalType: 'PE',
              signalHigh: currentPeSignal.high,
              signalLow: currentPeSignal.low,
              breakLevel: currentPeSignal.low,
              currentClose: candleClose,
              rsiValue: currentRsi,
              emaValue: ema5
            };
          }
        }
        // CE Entry: Next candle CLOSE > signal candle HIGH
        // For first entry: no price action validation needed
        // For re-entry after exit: price must have previously traded BELOW the signal candle's high
        else {
          const isFirstEntry = !signalCandlesWithEntry.has(currentCeSignal?.index || -1);
          const ceEntryAllowed = isFirstEntry || ceSignalPriceBelowHigh;
          
          if (currentCeSignal && candleClose > currentCeSignal.high && ceEntryAllowed) {
            // Entry taken - signal candle already validated with RSI at identification time
            // and price action requirement met
            activeTradeEvent = {
              index: i,
              type: 'ENTRY',
              tradeType: 'CE',
              price: candleClose,
              time: candle.x,
              signalCandleIndex: currentCeSignal.index
            };
            trades.push(activeTradeEvent);
            signalCandlesWithEntry.add(currentCeSignal.index);
            setCeBreakLevel(currentCeSignal.high);
            // Reset price action validation after entry (for next exit/entry cycle)
            ceSignalPriceBelowHigh = false;
          } else if (currentCeSignal && !activeTradeEvent) {
            // Signal exists but entry condition not met yet - track as waiting
            // Only track if no active trade and entry not blocked
            if (ceEntryAllowed) {
              // Update latest waiting signal (replaces previous waiting states for same signal type)
              latestCeWaiting = {
                index: i,
                signalTime: currentCeSignal.time,
                signalType: 'CE',
                signalHigh: currentCeSignal.high,
                signalLow: currentCeSignal.low,
                breakLevel: currentCeSignal.high,
                currentClose: candleClose,
                rsiValue: currentRsi,
                emaValue: ema5
              };
            }
          }
        }
      }

      // Trade Management (if trade is active)
      if (activeTradeEvent) {
        const signalCandle = activeTradeEvent.tradeType === 'PE' ? currentPeSignal : currentCeSignal;
        if (!signalCandle) {
          activeTradeEvent = null;
          continue;
        }

        // Check for Market Close Square Off (15 minutes before market close at 3:30 PM)
        // Square off at 3:15 PM (15:15) or later
        const candleTime = new Date(candle.x);
        const candleHour = candleTime.getHours();
        const candleMinute = candleTime.getMinutes();
        const marketCloseSquareOffHour = 15; // 3 PM
        const marketCloseSquareOffMinute = 15; // 15 minutes
        
        // Check if current candle time is at or after 3:15 PM
        if (candleHour > marketCloseSquareOffHour || 
            (candleHour === marketCloseSquareOffHour && candleMinute >= marketCloseSquareOffMinute)) {
          // Square off the trade at market close
          const tradeType = activeTradeEvent.tradeType; // Save before nulling
          trades.push({
            index: i,
            type: 'MKT_CLOSE',
            tradeType: tradeType,
            price: candleClose,
            time: candle.x,
            signalCandleIndex: signalCandle.index
          });
          activeTradeEvent = null;
          // Keep signal active - don't reset it
          if (tradeType === 'PE') {
            setPeBreakLevel(null);
          } else {
            setCeBreakLevel(null);
          }
          consecutiveCandlesForTarget = 0;
          lastCandleHighLessThanEMA = false;
          lastCandleLowGreaterThanEMA = false;
          continue; // Move to next candle
        }

        // Stop Loss for PE: Price closes above signal candle HIGH
        if (activeTradeEvent.tradeType === 'PE' && candleClose > signalCandle.high) {
          trades.push({
            index: i,
            type: 'STOP_LOSS',
            tradeType: 'PE',
            price: candleClose,
            time: candle.x,
            signalCandleIndex: signalCandle.index
          });
          activeTradeEvent = null;
          // Keep currentPeSignal active - don't reset it, signal candle remains valid for next entry
          // Reset price action validation after exit (for next entry)
          peSignalPriceAboveLow = false;
          setPeBreakLevel(null);
          consecutiveCandlesForTarget = 0;
          lastCandleHighLessThanEMA = false;
        }
        // Stop Loss for CE: Price closes below signal candle LOW
        else if (activeTradeEvent.tradeType === 'CE' && candleClose < signalCandle.low) {
          trades.push({
            index: i,
            type: 'STOP_LOSS',
            tradeType: 'CE',
            price: candleClose,
            time: candle.x,
            signalCandleIndex: signalCandle.index
          });
          activeTradeEvent = null;
          // Keep currentCeSignal active - don't reset it, signal candle remains valid for next entry
          // Reset price action validation after exit (for next entry)
          ceSignalPriceBelowHigh = false;
          setCeBreakLevel(null);
          consecutiveCandlesForTarget = 0;
          lastCandleLowGreaterThanEMA = false;
        }
        // Target for PE: Wait for HIGH < EMA, then 2 consecutive CLOSE > EMA
        else if (activeTradeEvent.tradeType === 'PE') {
          if (candleHigh < ema5) {
            lastCandleHighLessThanEMA = true;
          }
          if (lastCandleHighLessThanEMA && candleClose > ema5) {
            consecutiveCandlesForTarget++;
            if (consecutiveCandlesForTarget >= 2) {
              trades.push({
                index: i,
                type: 'TARGET',
                tradeType: 'PE',
                price: candleClose,
                time: candle.x,
                signalCandleIndex: signalCandle.index
              });
              activeTradeEvent = null;
              // Keep currentPeSignal active - don't reset it, signal candle remains valid for next entry
              // Reset price action validation after exit (for next entry)
              peSignalPriceAboveLow = false;
              setPeBreakLevel(null);
              consecutiveCandlesForTarget = 0;
              lastCandleHighLessThanEMA = false;
            }
          } else if (candleClose <= ema5) {
            consecutiveCandlesForTarget = 0;
          }
        }
        // Target for CE: Wait for LOW > EMA, then 2 consecutive CLOSE < EMA
        else if (activeTradeEvent.tradeType === 'CE') {
          if (candleLow > ema5) {
            lastCandleLowGreaterThanEMA = true;
          }
          if (lastCandleLowGreaterThanEMA && candleClose < ema5) {
            consecutiveCandlesForTarget++;
            if (consecutiveCandlesForTarget >= 2) {
              trades.push({
                index: i,
                type: 'TARGET',
                tradeType: 'CE',
                price: candleClose,
                time: candle.x,
                signalCandleIndex: signalCandle.index
              });
              activeTradeEvent = null;
              // Keep currentCeSignal active - don't reset it, signal candle remains valid for next entry
              // Reset price action validation after exit (for next entry)
              ceSignalPriceBelowHigh = false;
              setCeBreakLevel(null);
              consecutiveCandlesForTarget = 0;
              lastCandleLowGreaterThanEMA = false;
            }
          } else if (candleClose >= ema5) {
            consecutiveCandlesForTarget = 0;
          }
        }
      }
    }

    // Add latest waiting signals to the array (only if they exist)
    if (latestPeWaiting) waiting.push(latestPeWaiting);
    if (latestCeWaiting) waiting.push(latestCeWaiting);
    
    // Update all state at once (React automatically batches these)
    setSignalCandles(signals);
    setTradeEvents(trades);
    setIgnoredSignals(ignored);
    setWaitingSignals(waiting);

    // Build trade history for table
    const history: typeof tradeHistory = [];
    let activeTradeHistory: {
      signalIndex: number;
      signalTime: string;
      signalType: 'PE' | 'CE';
      signalHigh: number;
      signalLow: number;
      entryIndex: number;
      entryTime: string;
      entryPrice: number;
      exitIndex: number | null;
      exitTime: string | null;
      exitPrice: number | null;
      exitType: 'STOP_LOSS' | 'TARGET' | 'MKT_CLOSE' | null;
      pnl: number | null;
      pnlPercent: number | null;
    } | null = null;

    for (const event of trades) {
      if (event.type === 'ENTRY') {
        const signalCandle = signals.find(s => s.index === event.signalCandleIndex);
        if (signalCandle) {
          activeTradeHistory = {
            signalIndex: signalCandle.index,
            signalTime: signalCandle.time,
            signalType: signalCandle.type,
            signalHigh: signalCandle.high,
            signalLow: signalCandle.low,
            entryIndex: event.index,
            entryTime: event.time,
            entryPrice: event.price,
            exitIndex: null,
            exitTime: null,
            exitPrice: null,
            exitType: null,
            pnl: null,
            pnlPercent: null
          };
        }
      } else if (activeTradeHistory && (event.type === 'STOP_LOSS' || event.type === 'TARGET' || event.type === 'MKT_CLOSE')) {
        activeTradeHistory.exitIndex = event.index;
        activeTradeHistory.exitTime = event.time;
        activeTradeHistory.exitPrice = event.price;
        activeTradeHistory.exitType = event.type;
        
        // Calculate P&L
        const indexLotSize = getLotSize(instrument);

        if (activeTradeHistory.signalType === 'PE') {
          // PE: Profit when price goes down (exit < entry)
          activeTradeHistory.pnl = (activeTradeHistory.entryPrice - activeTradeHistory.exitPrice) * indexLotSize;
          activeTradeHistory.pnlPercent = ((activeTradeHistory.entryPrice - activeTradeHistory.exitPrice) / activeTradeHistory.entryPrice) * 100;
        } else {
          // CE: Profit when price goes up (exit > entry)
          activeTradeHistory.pnl = (activeTradeHistory.exitPrice - activeTradeHistory.entryPrice) * indexLotSize;
          activeTradeHistory.pnlPercent = ((activeTradeHistory.exitPrice - activeTradeHistory.entryPrice) / activeTradeHistory.entryPrice) * 100;
        }
        
        history.push({ ...activeTradeHistory });
        activeTradeHistory = null;
      }
    }

    // If there's an open trade, add it without exit
    if (activeTradeHistory) {
      history.push(activeTradeHistory);
    }

    setTradeHistory(history);
    
    // Build option contract trade history (real trade simulation)
    const optionHistory: typeof optionTradeHistory = [];
    let activeOptionTrade: typeof optionTradeHistory[0] | null = null;
    
    // Process all candles to check for option stop loss hits (on every candle, not just on index exit)
    for (let i = emaPeriod; i < candles.length; i++) {
      const candle = candles[i];
      const indexPrice = candle.c;
      
      // Check for new entries from trade events
      const entryEvent = trades.find(e => e.type === 'ENTRY' && e.index === i);
      if (entryEvent) {
        const signalCandle = signals.find(s => s.index === entryEvent.signalCandleIndex);
        if (signalCandle) {
          // Get index price at entry
          const indexAtEntry = candle.c; // Index close price at entry
          
          // Calculate ATM strike
          const atmStrike = roundToATM(indexAtEntry, instrument);
          
          // Get option symbol with proper format (e.g., BANKNIFTY25NOV57700PE)
          const optionSymbol = getOptionSymbol(atmStrike, entryEvent.tradeType, instrument, candle.x);
          
          // Simulate option entry premium
          const optionEntryPrice = simulateOptionPremium(indexAtEntry, atmStrike, entryEvent.tradeType);

          const stopLossPercent = ruleConfig.optionTrade.stopLossPercent;
          const targetPercent = ruleConfig.optionTrade.targetPercent;

          // Rule-based stop loss and target (expressed as percentages of premium)
          const stopLossPrice = optionEntryPrice * (1 + stopLossPercent);
          const targetPrice = optionEntryPrice * (1 + targetPercent);
          const lotSize = getLotSize(instrument);
          
          activeOptionTrade = {
            signalIndex: signalCandle.index,
            signalTime: signalCandle.time,
            signalType: signalCandle.type,
            signalHigh: signalCandle.high,
            signalLow: signalCandle.low,
            indexAtEntry,
            atmStrike,
            optionSymbol,
            entryIndex: i,
            entryTime: entryEvent.time,
            optionEntryPrice,
            exitIndex: null,
            exitTime: null,
            optionExitPrice: null,
            exitType: null,
            stopLossPrice,
            targetPrice,
            pnl: null,
            pnlPercent: null,
            status: 'open',
            lotSize
          };
        }
      }
      
      // Check for exits from trade events (index-based exits)
      const exitEvent = trades.find(e => (e.type === 'STOP_LOSS' || e.type === 'TARGET' || e.type === 'MKT_CLOSE') && e.index === i);
      
      // If active option trade exists, check for option-based stop loss/target or index-based exit
      if (activeOptionTrade) {
        // Calculate current option premium
        const currentOptionPremium = simulateOptionPremium(indexPrice, activeOptionTrade.atmStrike, activeOptionTrade.signalType);
        
        // Check for rule-based option stop loss hit (PRIORITY 1)
        if (currentOptionPremium <= activeOptionTrade.stopLossPrice) {
          // Option stop loss hit
          activeOptionTrade.exitIndex = i;
          activeOptionTrade.exitTime = candle.x;
          activeOptionTrade.exitType = 'STOP_LOSS';
          activeOptionTrade.optionExitPrice = currentOptionPremium;
          
          const lotSize = activeOptionTrade.lotSize ?? getLotSize(instrument);
          activeOptionTrade.pnl = (activeOptionTrade.optionExitPrice - activeOptionTrade.optionEntryPrice) * lotSize;
          activeOptionTrade.pnlPercent = ((activeOptionTrade.optionExitPrice - activeOptionTrade.optionEntryPrice) / activeOptionTrade.optionEntryPrice) * 100;
          activeOptionTrade.status = 'closed';
          
          optionHistory.push({ ...activeOptionTrade });
          activeOptionTrade = null;
        }
        // Check for rule-based option target profit hit (PRIORITY 2)
        else if (currentOptionPremium >= activeOptionTrade.targetPrice) {
          // Option target hit
          activeOptionTrade.exitIndex = i;
          activeOptionTrade.exitTime = candle.x;
          activeOptionTrade.exitType = 'TARGET';
          activeOptionTrade.optionExitPrice = currentOptionPremium;
          
          const lotSize = activeOptionTrade.lotSize ?? getLotSize(instrument);
          activeOptionTrade.pnl = (activeOptionTrade.optionExitPrice - activeOptionTrade.optionEntryPrice) * lotSize;
          activeOptionTrade.pnlPercent = ((activeOptionTrade.optionExitPrice - activeOptionTrade.optionEntryPrice) / activeOptionTrade.optionEntryPrice) * 100;
          activeOptionTrade.status = 'closed';
          
          optionHistory.push({ ...activeOptionTrade });
          activeOptionTrade = null;
        }
        // Check for market close (PRIORITY 3)
        else if (exitEvent && exitEvent.type === 'MKT_CLOSE') {
          activeOptionTrade.exitIndex = i;
          activeOptionTrade.exitTime = exitEvent.time;
          activeOptionTrade.exitType = 'MKT_CLOSE';
          activeOptionTrade.optionExitPrice = currentOptionPremium;
          
          const lotSize = activeOptionTrade.lotSize ?? getLotSize(instrument);
          activeOptionTrade.pnl = (activeOptionTrade.optionExitPrice - activeOptionTrade.optionEntryPrice) * lotSize;
          activeOptionTrade.pnlPercent = ((activeOptionTrade.optionExitPrice - activeOptionTrade.optionEntryPrice) / activeOptionTrade.optionEntryPrice) * 100;
          activeOptionTrade.status = 'closed';
          
          optionHistory.push({ ...activeOptionTrade });
          activeOptionTrade = null;
        }
      }
    }
    
    // If there's an open option trade, add it without exit
    if (activeOptionTrade) {
      optionHistory.push(activeOptionTrade);
    }
    
    return optionHistory;
  };

  // Format time for display
  const formatTime = (dateString: string): string => {
    const date = new Date(dateString);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  // Prepare chart data with indicators and markers
  const chartDataFormatted = useMemo(() => {
    return chartData.candles.map((candle, index) => {
      const ema5Value = chartData.ema5?.[index]?.y ?? null;
      const rsi14Value = chartData.rsi14?.[index]?.y ?? null;
      const signalCandle = signalCandles.find(s => s.index === index && ((s.type === 'PE' && filterPE) || (s.type === 'CE' && filterCE)));
      const tradeEvent = tradeEvents.find(t => t.index === index && ((t.tradeType === 'PE' && filterPE) || (t.tradeType === 'CE' && filterCE)));

      return {
        time: new Date(candle.x),
        timeFormatted: formatTime(candle.x),
        open: candle.o,
        high: candle.h,
        low: candle.l,
        close: candle.c,
        ema5: ema5Value,
        rsi14: rsi14Value,
        isSignalCandle: !!signalCandle,
        signalType: signalCandle?.type || null,
        tradeEvent: tradeEvent || null,
        // For candlestick rendering
        ohlc: [candle.o, candle.h, candle.l, candle.c]
      };
    });
  }, [chartData, signalCandles, tradeEvents, filterPE, filterCE]);

  // Enhanced Custom Tooltip with full details
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const candleIndex = chartDataFormatted.findIndex(c => c.timeFormatted === label);
      const signalCandle = signalCandles.find(s => s.index === candleIndex);
      const tradeEvent = tradeEvents.find(t => t.index === candleIndex);
      const trade = tradeHistory.find(t => 
        t.signalIndex === candleIndex || 
        t.entryIndex === candleIndex || 
        t.exitIndex === candleIndex
      );

      return (
        <div className="bg-white border shadow-lg p-3 rounded" style={{ minWidth: '250px', maxWidth: '350px' }}>
          <p className="fw-bold mb-2 border-bottom pb-2">{formatDateTime(data.time.toISOString())}</p>
          
          {/* OHLC Data */}
          <div className="mb-2">
            <p className="mb-1 small"><strong>Open:</strong> <span className="text-primary">{data.open.toFixed(2)}</span></p>
            <p className="mb-1 small"><strong>High:</strong> <span className="text-success">{data.high.toFixed(2)}</span></p>
            <p className="mb-1 small"><strong>Low:</strong> <span className="text-danger">{data.low.toFixed(2)}</span></p>
            <p className="mb-1 small"><strong>Close:</strong> <span className="text-info">{data.close.toFixed(2)}</span></p>
          </div>

          {/* EMA */}
          {data.ema5 && (
            <p className="mb-2 small border-top pt-2" style={{ color: '#ff6b35' }}>
              <strong>EMA {emaPeriod}:</strong> {data.ema5.toFixed(2)}
            </p>
          )}

          {/* RSI */}
          {data.rsi14 !== null && data.rsi14 !== undefined && (
            <p className="mb-2 small border-top pt-2" style={{ color: '#82ca9d' }}>
              <strong>RSI 14:</strong> {data.rsi14.toFixed(2)}
              {data.rsi14 > 70 && <span className="ms-2 text-danger">(Overbought)</span>}
              {data.rsi14 < 30 && <span className="ms-2 text-success">(Oversold)</span>}
            </p>
          )}

          {/* Signal Candle Info */}
          {signalCandle && (
            <div className="mb-2 border-top pt-2" style={{ backgroundColor: signalCandle.type === 'PE' ? '#fff5f5' : '#f0fff4', padding: '8px', borderRadius: '4px' }}>
              <p className="mb-1 small fw-bold" style={{ color: signalCandle.type === 'PE' ? '#dc3545' : '#28a745' }}>
                🎯 Signal Candle ({signalCandle.type})
              </p>
              <p className="mb-0 small"><strong>High:</strong> {signalCandle.high.toFixed(2)}</p>
              <p className="mb-0 small"><strong>Low:</strong> {signalCandle.low.toFixed(2)}</p>
            </div>
          )}

          {/* Trade Event Info */}
          {tradeEvent && (
            <div className="mb-2 border-top pt-2" style={{ backgroundColor: tradeEvent.type === 'ENTRY' ? '#f0fff4' : tradeEvent.type === 'STOP_LOSS' ? '#fff5f5' : '#fffbf0', padding: '8px', borderRadius: '4px' }}>
              <p className="mb-1 small fw-bold" style={{ color: tradeEvent.type === 'ENTRY' ? '#28a745' : tradeEvent.type === 'STOP_LOSS' ? '#dc3545' : '#ffc107' }}>
                {tradeEvent.type === 'ENTRY' ? '✅' : tradeEvent.type === 'STOP_LOSS' ? '❌' : '🎯'} {tradeEvent.type} ({tradeEvent.tradeType})
              </p>
              <p className="mb-0 small"><strong>Price:</strong> {tradeEvent.price.toFixed(2)}</p>
            </div>
          )}

          {/* Trade History Info */}
          {trade && (
            <div className="mb-0 border-top pt-2" style={{ backgroundColor: '#f8f9fa', padding: '8px', borderRadius: '4px' }}>
              <p className="mb-1 small fw-bold">Trade Details:</p>
              <p className="mb-0 small"><strong>Signal:</strong> {formatDateTime(trade.signalTime)}</p>
              <p className="mb-0 small"><strong>Entry:</strong> {formatDateTime(trade.entryTime)} @ {trade.entryPrice.toFixed(2)}</p>
              {trade.exitTime && (
                <>
                  <p className="mb-0 small">
                    <strong>Exit:</strong> {formatDateTime(trade.exitTime)} @ {trade.exitPrice?.toFixed(2)} 
                    <span className="ms-1">({trade.exitType === 'MKT_CLOSE' ? 'Market Close' : trade.exitType})</span>
                  </p>
                  {trade.pnl !== null && trade.pnlPercent !== null && (
                    <p className="mb-0 small fw-bold" style={{ color: trade.pnl >= 0 ? '#28a745' : '#dc3545' }}>
                      P&L: {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)} ({trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%)
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const formatDateTime = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // Custom Candlestick Component for Recharts
  const CandlestickRenderer = (props: any) => {
    try {
      const { xAxisMap, yAxisMap } = props;
      if (!xAxisMap || !yAxisMap) return null;
      
      const xKey = Object.keys(xAxisMap)[0];
      const yKey = Object.keys(yAxisMap)[0];
      
      if (!xKey || !yKey) return null;

      const xAxis = xAxisMap[xKey];
      const yAxis = yAxisMap[yKey];
      const xScale = xAxis?.scale;
      const yScale = yAxis?.scale;
      
      if (!xScale || !yScale) return null;

      // Calculate band size for categorical axis
      const dataLength = chartDataFormatted.length;
      const chartWidth = props.width || 800;
      const bandSize = dataLength > 0 ? chartWidth / dataLength : 10;
      const candleWidth = Math.max(4, Math.floor(bandSize * 0.5));
      const half = Math.floor(candleWidth / 2);

      return (
        <g>
          {chartDataFormatted.map((candle, index) => {
            let xPos: number;
            if (typeof xScale === 'function') {
              xPos = xScale(candle.timeFormatted);
            } else if (xScale && typeof xScale.bandwidth === 'function') {
              xPos = xScale(candle.timeFormatted) || (index * bandSize);
            } else {
              xPos = index * bandSize;
            }

            if (typeof xPos !== 'number' || isNaN(xPos)) return null;

            const centerX = xPos + (bandSize / 2);
            const startX = centerX - half;

            const isRising = candle.close >= candle.open;
            const highY = yScale(candle.high);
            const lowY = yScale(candle.low);
            const openY = yScale(candle.open);
            const closeY = yScale(candle.close);

            if ([highY, lowY, openY, closeY].some(v => typeof v !== 'number' || isNaN(v))) return null;

            const bodyTop = isRising ? closeY : openY;
            const bodyBottom = isRising ? openY : closeY;
            const bodyHeight = Math.max(2, Math.abs(bodyBottom - bodyTop));

            const signalCandle = signalCandles.find(s => s.index === index);
            const tradeEvent = tradeEvents.find(t => t.index === index);
            const borderColor = signalCandle 
              ? (signalCandle.type === 'PE' ? '#dc3545' : '#28a745')
              : 'transparent';
            const borderWidth = signalCandle ? 3 : 0;

            return (
              <g key={index}>
                {/* Wick */}
                <line
                  x1={centerX}
                  y1={highY}
                  x2={centerX}
                  y2={lowY}
                  stroke={isRising ? '#28a745' : '#dc3545'}
                  strokeWidth={2}
                />
                {/* Body */}
                <rect
                  x={startX}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={isRising ? '#28a745' : '#dc3545'}
                  stroke={borderColor}
                  strokeWidth={borderWidth}
                  opacity={0.9}
                />
                {/* Entry marker */}
                {tradeEvent?.type === 'ENTRY' && (
                  <g>
                    <circle
                      cx={centerX}
                      cy={yScale(tradeEvent.price)}
                      r={8}
                      fill={tradeEvent.tradeType === 'PE' ? '#dc3545' : '#28a745'}
                      stroke="white"
                      strokeWidth={2}
                    />
                    <text
                      x={centerX}
                      y={yScale(tradeEvent.price) - 12}
                      textAnchor="middle"
                      fill={tradeEvent.tradeType === 'PE' ? '#dc3545' : '#28a745'}
                      fontSize="10"
                      fontWeight="bold"
                    >
                      ENTRY
                    </text>
                  </g>
                )}
                {/* Exit marker */}
                {(tradeEvent?.type === 'STOP_LOSS' || tradeEvent?.type === 'TARGET' || tradeEvent?.type === 'MKT_CLOSE') && (
                  <g>
                    <circle
                      cx={centerX}
                      cy={yScale(tradeEvent.price)}
                      r={8}
                      fill={tradeEvent.type === 'STOP_LOSS' ? '#dc3545' : tradeEvent.type === 'MKT_CLOSE' ? '#6c757d' : '#ffc107'}
                      stroke="white"
                      strokeWidth={2}
                    />
                    <text
                      x={centerX}
                      y={yScale(tradeEvent.price) - 12}
                      textAnchor="middle"
                      fill={tradeEvent.type === 'STOP_LOSS' ? '#dc3545' : tradeEvent.type === 'MKT_CLOSE' ? '#6c757d' : '#ffc107'}
                      fontSize="10"
                      fontWeight="bold"
                    >
                      {tradeEvent.type === 'STOP_LOSS' ? 'SL' : tradeEvent.type === 'MKT_CLOSE' ? 'MC' : 'TP'}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      );
    } catch (e) {
      console.error('Error rendering candlesticks:', e);
      return null;
    }
  };

  // Backtest functions
  const validateDateRange = (from: string, to: string): string | null => {
    if (!from || !to) {
      return 'Please select both from and to dates';
    }
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (fromDate > toDate) {
      return 'From date must be before or equal to to date';
    }
    const daysDiff = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 30) {
      return 'Maximum 30 days allowed. Please select a date range within 30 days';
    }
    return null;
  };

  const runBacktest = async () => {
    const validationError = validateDateRange(backtestFromDate, backtestToDate);
    if (validationError) {
      setBacktestError(validationError);
      return;
    }

    setBacktestLoading(true);
    setBacktestError(null);
    setBacktestResults(null);

    try {
      const response = await fetch('http://localhost:8000/api/backtest_mountain_signal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          strategy_id: strategy.id,
          from_date: backtestFromDate,
          to_date: backtestToDate,
          instrument: strategy.instrument,
          candle_time: strategy.candle_time,
          ema_period: strategy.ema_period || 5,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to run backtest');
      }

      const data = await response.json();
      if (data.status === 'success') {
        setBacktestResults(data);
      } else {
        throw new Error(data.message || 'Backtest failed');
      }
    } catch (err) {
      console.error('Error running backtest:', err);
      setBacktestError(err instanceof Error ? err.message : 'An error occurred while running backtest');
    } finally {
      setBacktestLoading(false);
    }
  };

  // If backtest tab, show backtest UI
  if (activeTab === 'backtest') {
    return (
      <div className="mountain-signal-chart">
        <div className="card border-0 shadow-sm mb-3">
          <div className="card-body">
            <h5 className="card-title mb-4">
              <i className="bi bi-clipboard-data me-2"></i>
              Backtest Report - {strategy.strategy_name}
            </h5>
            
            <div className="row mb-4">
              <div className="col-md-4">
                <label htmlFor="backtest-from-date" className="form-label fw-bold">
                  <i className="bi bi-calendar3 me-2"></i>From Date
                </label>
                <input
                  type="date"
                  id="backtest-from-date"
                  className="form-control"
                  value={backtestFromDate}
                  onChange={(e) => setBacktestFromDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div className="col-md-4">
                <label htmlFor="backtest-to-date" className="form-label fw-bold">
                  <i className="bi bi-calendar3 me-2"></i>To Date
                </label>
                <input
                  type="date"
                  id="backtest-to-date"
                  className="form-control"
                  value={backtestToDate}
                  onChange={(e) => setBacktestToDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div className="col-md-4">
                <label className="form-label">&nbsp;</label>
                <button
                  className="btn btn-primary w-100"
                  onClick={runBacktest}
                  disabled={backtestLoading || !backtestFromDate || !backtestToDate}
                >
                  {backtestLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                      Running...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-play-circle me-2"></i>Run Backtest
                    </>
                  )}
                </button>
              </div>
            </div>

            {backtestError && (
              <div className="alert alert-danger" role="alert">
                <i className="bi bi-exclamation-triangle me-2"></i>{backtestError}
              </div>
            )}

            {backtestResults && (() => {
              const filteredTrades = backtestResults.trades.filter(trade => {
                if (filterPE && filterCE) return true;
                if (filterPE && trade.signalType === 'PE') return true;
                if (filterCE && trade.signalType === 'CE') return true;
                return false;
              });

              const optionTrades = backtestResults.optionTrades || [];
              const filteredOptionTrades = optionTrades.filter(trade => {
                if (filterPE && filterCE) return true;
                if (filterPE && trade.signalType === 'PE') return true;
                if (filterCE && trade.signalType === 'CE') return true;
                return false;
              });

              const closedFilteredTrades = filteredTrades.filter(t => t.exitTime !== null);
              const optionClosedFilteredTrades = filteredOptionTrades.filter(t => t.exitTime !== null);

              const filteredTotalTrades = closedFilteredTrades.length;
              const filteredWinningTrades = closedFilteredTrades.filter(t => t.pnl !== null && t.pnl > 0).length;
              const filteredLosingTrades = closedFilteredTrades.filter(t => t.pnl !== null && t.pnl <= 0).length;
              const filteredWinRate = filteredTotalTrades > 0 ? (filteredWinningTrades / filteredTotalTrades) * 100 : 0;
              const filteredTotalPnl = closedFilteredTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
              const filteredAveragePnl = filteredTotalTrades > 0 ? filteredTotalPnl / filteredTotalTrades : 0;

              const optionFilteredTotalTrades = optionClosedFilteredTrades.length;
              const optionFilteredWinningTrades = optionClosedFilteredTrades.filter(t => t.pnl !== null && t.pnl > 0).length;
              const optionFilteredLosingTrades = optionClosedFilteredTrades.filter(t => t.pnl !== null && t.pnl <= 0).length;
              const optionFilteredWinRate = optionFilteredTotalTrades > 0 ? (optionFilteredWinningTrades / optionFilteredTotalTrades) * 100 : 0;
              const optionFilteredTotalPnl = optionClosedFilteredTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
              const optionFilteredAveragePnl = optionFilteredTotalTrades > 0 ? optionFilteredTotalPnl / optionFilteredTotalTrades : 0;
              const optionOpenTrades = filteredOptionTrades.length - optionFilteredTotalTrades;

              const tradesByDate = filteredTrades.reduce((acc, trade) => {
                const dateKey = trade.date;
                if (!acc[dateKey]) {
                  acc[dateKey] = [];
                }
                acc[dateKey].push(trade);
                return acc;
              }, {} as Record<string, typeof filteredTrades>);

              const optionTradesByDate = filteredOptionTrades.reduce((acc, trade) => {
                const dateKey = trade.date;
                if (!acc[dateKey]) {
                  acc[dateKey] = [];
                }
                acc[dateKey].push(trade);
                return acc;
              }, {} as Record<string, typeof filteredOptionTrades>);

              const optionDailyPnlFiltered: Record<string, number> = {};
              optionClosedFilteredTrades.forEach(trade => {
                const dateKey = trade.date;
                if (!optionDailyPnlFiltered[dateKey]) {
                  optionDailyPnlFiltered[dateKey] = 0;
                }
                optionDailyPnlFiltered[dateKey] += trade.pnl || 0;
              });

              const dateSet = new Set<string>([
                ...Object.keys(tradesByDate),
                ...Object.keys(optionTradesByDate),
              ]);
              const sortedDates = Array.from(dateSet).sort();

              const toggleDate = (date: string) => {
                const newExpanded = new Set(expandedDates);
                if (newExpanded.has(date)) {
                  newExpanded.delete(date);
                } else {
                  newExpanded.add(date);
                }
                setExpandedDates(newExpanded);
              };

              let optionFilteredMaxWinningDay = { date: '', pnl: 0 };
              let optionFilteredMaxLosingDay = { date: '', pnl: 0 };
              Object.entries(optionDailyPnlFiltered).forEach(([dateKey, pnl]) => {
                if (optionFilteredMaxWinningDay.date === '' || pnl > optionFilteredMaxWinningDay.pnl) {
                  optionFilteredMaxWinningDay = { date: dateKey, pnl };
                }
                if (optionFilteredMaxLosingDay.date === '' || pnl < optionFilteredMaxLosingDay.pnl) {
                  optionFilteredMaxLosingDay = { date: dateKey, pnl };
                }
              });

              return (
                <>
                  {/* Filter Controls */}
                  <div className="card border-0 shadow-sm mb-3">
                    <div className="card-body">
                      <div className="row align-items-center">
                        <div className="col-md-6">
                          <label className="form-label fw-bold me-3">
                            <i className="bi bi-funnel me-2"></i>Filter by Signal Type:
                          </label>
                          <div className="form-check form-check-inline">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              id="filter-pe"
                              checked={filterPE}
                              onChange={(e) => setFilterPE(e.target.checked)}
                            />
                            <label className="form-check-label" htmlFor="filter-pe">
                              <span className="badge bg-danger">PE</span>
                            </label>
                          </div>
                          <div className="form-check form-check-inline">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              id="filter-ce"
                              checked={filterCE}
                              onChange={(e) => setFilterCE(e.target.checked)}
                            />
                            <label className="form-check-label" htmlFor="filter-ce">
                              <span className="badge bg-success">CE</span>
                            </label>
                          </div>
                        </div>
                        <div className="col-md-6 text-end">
                          <small className="text-muted">
                            Showing {filteredTrades.length} of {backtestResults.trades.length} trades
                          </small>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Summary Metrics */}
                  <div className="card border-0 shadow-sm mb-4">
                    <div className="card-header bg-primary text-white">
                      <h6 className="mb-0">
                        <i className="bi bi-bar-chart-line me-2"></i>
                        Summary Report {(!filterPE || !filterCE) && `(Filtered)`}
                      </h6>
                    </div>
                    <div className="card-body">
                      <div className="row">
                        <div className="col-md-3 mb-3">
                          <div className="text-center p-3 bg-light rounded">
                            <div className="text-muted small">Total Trades (Index)</div>
                            <div className="h4 mb-0 fw-bold">{filteredTotalTrades}</div>
                            <div className="small text-muted">
                              {filteredWinningTrades}W / {filteredLosingTrades}L
                            </div>
                          </div>
                        </div>
                        <div className="col-md-3 mb-3">
                          <div className="text-center p-3 bg-light rounded">
                            <div className="text-muted small">Win Rate</div>
                            <div className="h4 mb-0 fw-bold" style={{ color: filteredWinRate >= 50 ? '#28a745' : '#dc3545' }}>
                              {filteredWinRate.toFixed(2)}%
                            </div>
                          </div>
                        </div>
                        <div className="col-md-3 mb-3">
                          <div className="text-center p-3 bg-light rounded">
                            <div className="text-muted small">Total P&L</div>
                            <div className={`h4 mb-0 fw-bold ${filteredTotalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                              {filteredTotalPnl >= 0 ? '+' : ''}{filteredTotalPnl.toFixed(2)}
                            </div>
                            <div className="text-muted small">Avg: {filteredAveragePnl >= 0 ? '+' : ''}{filteredAveragePnl.toFixed(2)}</div>
                          </div>
                        </div>
                        <div className="col-md-3 mb-3">
                          <div className="text-center p-3 bg-light rounded">
                            <div className="text-muted small">Max Drawdown</div>
                            <div className="h4 mb-0 fw-bold text-danger">
                              {backtestResults.summary.maxDrawdownPercent.toFixed(2)}%
                            </div>
                            <div className="text-muted small">₹{backtestResults.summary.maxDrawdown.toFixed(2)}</div>
                          </div>
                        </div>
                        <div className="col-md-6 mb-3">
                          <div className="text-center p-3 bg-success bg-opacity-10 rounded">
                            <div className="text-muted small">Max Winning Day (Index)</div>
                            <div className="h5 mb-0 fw-bold text-success">
                              {new Date(backtestResults.summary.maxWinningDay.date).toLocaleDateString()}
                            </div>
                            <div className="text-success">+₹{backtestResults.summary.maxWinningDay.pnl.toFixed(2)}</div>
                          </div>
                        </div>
                        <div className="col-md-6 mb-3">
                          <div className="text-center p-3 bg-danger bg-opacity-10 rounded">
                            <div className="text-muted small">Max Losing Day (Index)</div>
                            <div className="h5 mb-0 fw-bold text-danger">
                              {new Date(backtestResults.summary.maxLosingDay.date).toLocaleDateString()}
                            </div>
                            <div className="text-danger">₹{backtestResults.summary.maxLosingDay.pnl.toFixed(2)}</div>
                          </div>
                        </div>
                      </div>

                      <hr className="my-4" />

                      <div className="row">
                        <div className="col-12">
                          <h6 className="text-muted text-uppercase small mb-3">
                            Option Trades (Simulation) {(!filterPE || !filterCE) && `(Filtered)`}
                          </h6>
                        </div>
                      </div>
                      <div className="row">
                        <div className="col-md-3 mb-3">
                          <div className="text-center p-3 bg-light rounded">
                            <div className="text-muted small">Total Option Trades</div>
                            <div className="h4 mb-0 fw-bold">{optionFilteredTotalTrades}</div>
                            <div className="small text-muted">
                              {optionFilteredWinningTrades}W / {optionFilteredLosingTrades}L
                            </div>
                          </div>
                        </div>
                        <div className="col-md-3 mb-3">
                          <div className="text-center p-3 bg-light rounded">
                            <div className="text-muted small">Win Rate</div>
                            <div className="h4 mb-0 fw-bold" style={{ color: optionFilteredWinRate >= 50 ? '#28a745' : '#dc3545' }}>
                              {optionFilteredWinRate.toFixed(2)}%
                            </div>
                          </div>
                        </div>
                        <div className="col-md-3 mb-3">
                          <div className="text-center p-3 bg-light rounded">
                            <div className="text-muted small">Total Option P&L</div>
                            <div className={`h4 mb-0 fw-bold ${optionFilteredTotalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                              {optionFilteredTotalPnl >= 0 ? '+' : ''}{optionFilteredTotalPnl.toFixed(2)}
                            </div>
                            <div className="text-muted small">Avg: {optionFilteredAveragePnl >= 0 ? '+' : ''}{optionFilteredAveragePnl.toFixed(2)}</div>
                          </div>
                        </div>
                        <div className="col-md-3 mb-3">
                          <div className="text-center p-3 bg-light rounded">
                            <div className="text-muted small">Open Option Trades</div>
                            <div className="h4 mb-0 fw-bold">{optionOpenTrades}</div>
                            <div className="small text-muted">Awaiting exit</div>
                          </div>
                        </div>
                        <div className="col-md-6 mb-3">
                          <div className="text-center p-3 bg-success bg-opacity-10 rounded">
                            <div className="text-muted small">Max Winning Day (Options)</div>
                            <div className="h5 mb-0 fw-bold text-success">
                              {optionFilteredMaxWinningDay.date
                                ? new Date(optionFilteredMaxWinningDay.date).toLocaleDateString()
                                : 'N/A'}
                            </div>
                            <div className="text-success">
                              {optionFilteredMaxWinningDay.pnl >= 0 ? '+' : ''}
                              ₹{optionFilteredMaxWinningDay.pnl.toFixed(2)}
                            </div>
                          </div>
                        </div>
                        <div className="col-md-6 mb-3">
                          <div className="text-center p-3 bg-danger bg-opacity-10 rounded">
                            <div className="text-muted small">Max Losing Day (Options)</div>
                            <div className="h5 mb-0 fw-bold text-danger">
                              {optionFilteredMaxLosingDay.date
                                ? new Date(optionFilteredMaxLosingDay.date).toLocaleDateString()
                                : 'N/A'}
                            </div>
                            <div className="text-danger">
                              ₹{optionFilteredMaxLosingDay.pnl.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Trade History Table - Grouped by Date */}
                  <div className="card border-0 shadow-sm">
                    <div className="card-header bg-dark text-white">
                      <h6 className="mb-0">
                        <i className="bi bi-table me-2"></i>
                        Trade History & P&L Analysis {(!filterPE || !filterCE) && `(Filtered)`}
                      </h6>
                    </div>
                    <div className="card-body p-0">
                      <div className="table-responsive">
                        <table className="table table-hover table-striped mb-0">
                          <thead className="table-dark">
                            <tr>
                              <th style={{ width: '40px' }}></th>
                              <th style={{ width: '50px' }}>#</th>
                              <th>Date</th>
                              <th>Signal Time</th>
                              <th>Signal Type</th>
                              <th>Entry Time</th>
                              <th>Entry Price</th>
                              <th>Exit Time</th>
                              <th>Exit Price</th>
                              <th>Exit Type</th>
                              <th>P&L</th>
                              <th>P&L %</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedDates.map((dateKey, dateIndex) => {
                              const dateTrades = tradesByDate[dateKey] ?? [];
                              const optionTradesForDate = optionTradesByDate[dateKey] ?? [];
                              const isExpanded = expandedDates.has(dateKey);
                              const closedTradesForDate = dateTrades.filter(t => t.exitTime !== null);
                              const dateTotalPnl = closedTradesForDate.reduce((sum, t) => sum + (t.pnl || 0), 0);
                              const optionClosedForDate = optionTradesForDate.filter(t => t.exitTime !== null);
                              const optionDateTotalPnl = optionClosedForDate.reduce((sum, t) => sum + (t.pnl || 0), 0);
                              
                              return (
                                <React.Fragment key={dateKey}>
                                  <tr 
                                    className="table-secondary fw-bold cursor-pointer" 
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => toggleDate(dateKey)}
                                  >
                                    <td>
                                      <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'}`}></i>
                                    </td>
                                    <td colSpan={11}>
                                      <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center gap-2">
                                        <span className="d-flex align-items-center flex-wrap gap-2">
                                          <i className="bi bi-calendar3 me-2"></i>
                                          {new Date(dateKey).toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                                          {dateTrades.length > 0 && (
                                            <span className="badge bg-info">
                                              {dateTrades.length} index trade{dateTrades.length !== 1 ? 's' : ''}
                                            </span>
                                          )}
                                          {optionTradesForDate.length > 0 && (
                                            <span className="badge bg-secondary">
                                              {optionTradesForDate.length} option trade{optionTradesForDate.length !== 1 ? 's' : ''}
                                            </span>
                                          )}
                                        </span>
                                        <div className="d-flex flex-column flex-md-row gap-3">
                                          <span className={`fw-bold ${dateTotalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                            Index P&L: {dateTotalPnl >= 0 ? '+' : ''}{dateTotalPnl.toFixed(2)}
                                          </span>
                                          {optionTradesForDate.length > 0 && (
                                            <span className={`fw-bold ${optionDateTotalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                              Option P&L: {optionDateTotalPnl >= 0 ? '+' : ''}{optionDateTotalPnl.toFixed(2)}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                  {isExpanded && (
                                    <>
                                      {dateTrades.map((trade, tradeIndex) => (
                                        <tr key={`${dateKey}-${tradeIndex}`} className="table-light">
                                          <td></td>
                                          <td>{dateIndex * 1000 + tradeIndex + 1}</td>
                                          <td>{new Date(trade.date).toLocaleDateString()}</td>
                                          <td>{new Date(trade.signalTime).toLocaleTimeString()}</td>
                                          <td>
                                            <span className={`badge ${trade.signalType === 'PE' ? 'bg-danger' : 'bg-success'}`}>
                                              {trade.signalType}
                                            </span>
                                          </td>
                                          <td>{new Date(trade.entryTime).toLocaleTimeString()}</td>
                                          <td>{trade.entryPrice.toFixed(2)}</td>
                                          <td>{trade.exitTime ? new Date(trade.exitTime).toLocaleTimeString() : '-'}</td>
                                          <td>{trade.exitPrice ? trade.exitPrice.toFixed(2) : '-'}</td>
                                          <td>
                                            {trade.exitType ? (
                                              <span className={`badge ${getExitBadgeClass(trade.exitType)}`}>
                                                {getExitLabel(trade.exitType)}
                                              </span>
                                            ) : '-'}
                                          </td>
                                          <td>
                                            {trade.pnl !== null ? (
                                              <span className={`fw-bold ${trade.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                                {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                                              </span>
                                            ) : '-'}
                                          </td>
                                          <td>
                                            {trade.pnlPercent !== null ? (
                                              <span className={`fw-bold ${trade.pnlPercent >= 0 ? 'text-success' : 'text-danger'}`}>
                                                {trade.pnlPercent >= 0 ? '+' : ''}{trade.pnlPercent.toFixed(2)}%
                                              </span>
                                            ) : '-'}
                                          </td>
                                          <td>
                                            <span className={`badge ${trade.exitTime ? 'bg-success' : 'bg-warning'}`}>
                                              {trade.exitTime ? 'Closed' : 'Open'}
                                            </span>
                                          </td>
                                        </tr>
                                      ))}

                                      {optionTradesForDate.length > 0 && (
                                        <tr className="bg-white">
                                          <td></td>
                                          <td colSpan={12}>
                                            <div className="p-3 border-top">
                                              <div className="d-flex justify-content-between align-items-center mb-3">
                                                <div className="fw-bold">
                                                  Option Trades (Simulation)
                                                  <span className="badge bg-secondary ms-2">
                                                    {optionTradesForDate.length} trade{optionTradesForDate.length !== 1 ? 's' : ''}
                                                  </span>
                                                </div>
                                                <div className={`fw-bold ${optionDateTotalPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                                  Daily Option P&L: {optionDateTotalPnl >= 0 ? '+' : ''}{optionDateTotalPnl.toFixed(2)}
                                                </div>
                                              </div>
                                              <div className="table-responsive">
                                                <table className="table table-sm table-bordered align-middle mb-0">
                                                  <thead className="table-light">
                                                    <tr>
                                                      <th>#</th>
                                                      <th>Signal Time</th>
                                                      <th>Option Symbol</th>
                                                      <th>Lot Size</th>
                                                      <th>ATM Strike</th>
                                                      <th>Entry Premium</th>
                                                      <th>Stop Loss</th>
                                                      <th>Target</th>
                                                      <th>Exit Time</th>
                                                      <th>Exit Premium</th>
                                                      <th>Exit Type</th>
                                                      <th>P&L</th>
                                                      <th>P&L %</th>
                                                      <th>Status</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {optionTradesForDate.map((optTrade, optIndex) => {
                                                      const exitBadgeClass = getExitBadgeClass(optTrade.exitType || null);
                                                      const pnlClass = optTrade.pnl !== null ? (optTrade.pnl >= 0 ? 'text-success' : 'text-danger') : '';
                                                      return (
                                                        <tr key={`option-${dateKey}-${optIndex}`}>
                                                          <td>{optIndex + 1}</td>
                                                          <td>{optTrade.signalTime ? new Date(optTrade.signalTime).toLocaleTimeString() : '-'}</td>
                                                          <td>{optTrade.optionSymbol ?? '-'}</td>
                                                          <td>{optTrade.lotSize ?? '-'}</td>
                                                          <td>{optTrade.atmStrike !== null ? optTrade.atmStrike.toFixed(0) : '-'}</td>
                                                          <td>{optTrade.optionEntryPrice !== null ? optTrade.optionEntryPrice.toFixed(2) : '-'}</td>
                                                          <td>{optTrade.stopLossPrice !== null ? optTrade.stopLossPrice.toFixed(2) : '-'}</td>
                                                          <td>{optTrade.targetPrice !== null ? optTrade.targetPrice.toFixed(2) : '-'}</td>
                                                          <td>{optTrade.exitTime ? new Date(optTrade.exitTime).toLocaleTimeString() : '-'}</td>
                                                          <td>{optTrade.optionExitPrice !== null ? optTrade.optionExitPrice.toFixed(2) : '-'}</td>
                                                          <td>
                                                            {optTrade.exitType ? (
                                                              <span className={`badge ${exitBadgeClass}`}>
                                                                {getExitLabel(optTrade.exitType)}
                                                              </span>
                                                            ) : (
                                                              <span className="badge bg-warning">Open</span>
                                                            )}
                                                          </td>
                                                          <td>
                                                            {optTrade.pnl !== null ? (
                                                              <span className={`fw-bold ${pnlClass}`}>
                                                                {optTrade.pnl >= 0 ? '+' : ''}{optTrade.pnl.toFixed(2)}
                                                              </span>
                                                            ) : '-'}
                                                          </td>
                                                          <td>
                                                            {optTrade.pnlPercent !== null ? (
                                                              <span className={`fw-bold ${optTrade.pnlPercent >= 0 ? 'text-success' : 'text-danger'}`}>
                                                                {optTrade.pnlPercent >= 0 ? '+' : ''}{optTrade.pnlPercent.toFixed(2)}%
                                                              </span>
                                                            ) : '-'}
                                                          </td>
                                                          <td>
                                                            <span className={`badge ${optTrade.status === 'closed' ? 'bg-success' : 'bg-warning'}`}>
                                                              {optTrade.status === 'closed' ? 'Closed' : 'Open'}
                                                            </span>
                                                          </td>
                                                        </tr>
                                                      );
                                                    })}
                                                  </tbody>
                                                </table>
                                              </div>
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                    </>
                                  )}
                                </React.Fragment>
                              );
                            })}
                            <tr className="table-info fw-bold">
                              <td colSpan={10} className="text-end">Total P&L ({(!filterPE || !filterCE) && 'Filtered'}):</td>
                              <td className={filteredTotalPnl >= 0 ? 'text-success' : 'text-danger'}>
                                {filteredTotalPnl >= 0 ? '+' : ''}{filteredTotalPnl.toFixed(2)}
                              </td>
                              <td colSpan={2}></td>
                            </tr>
                            <tr className="table-warning fw-bold">
                              <td colSpan={10} className="text-end">Total P&L (Option Contracts {(!filterPE || !filterCE) && 'Filtered'}):</td>
                              <td className={optionFilteredTotalPnl >= 0 ? 'text-success' : 'text-danger'}>
                                {optionFilteredTotalPnl >= 0 ? '+' : ''}{optionFilteredTotalPnl.toFixed(2)}
                              </td>
                              <td colSpan={2}></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'optimizer') {
    const todayIso = new Date().toISOString().split('T')[0];
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    const threeYearsAgoIso = threeYearsAgo.toISOString().split('T')[0];

    const summary = optimizerResults?.summary;
    const optionSummary = optimizerResults?.optionSummary;

    const timeframeOrder: Array<{ key: 'daily' | 'weekly' | 'monthly' | 'yearly'; label: string }> = [
      { key: 'daily', label: 'Daily' },
      { key: 'weekly', label: 'Weekly' },
      { key: 'monthly', label: 'Monthly' },
      { key: 'yearly', label: 'Yearly' },
    ];

    const renderSummaryCard = (title: string, cardSummary?: OptimizerSummary, headerClass = 'bg-dark') => {
      if (!cardSummary) {
        return null;
      }

      const safeNumber = (value: number | null | undefined, fallback = 0) =>
        typeof value === 'number' && Number.isFinite(value) ? value : fallback;
      const safePercent = (value: number | null | undefined) =>
        typeof value === 'number' && Number.isFinite(value) ? value : 0;

      const totalPnlValue = safeNumber(cardSummary.totalPnl);
      const averagePnlValue = safeNumber(cardSummary.averagePnl);
      const drawdownValue = safeNumber(cardSummary.maxDrawdown);
      const drawdownPercentValue = safePercent(cardSummary.maxDrawdownPercent);
      const roiValue = safePercent(cardSummary.roiPercent);
      const initialInvestmentValue = safeNumber(cardSummary.parameters.initialInvestment);
      const rsiThresholdValue = safeNumber(cardSummary.parameters.rsiThreshold);

      const totalPnlClass = totalPnlValue >= 0 ? 'text-success' : 'text-danger';
      const averagePnlClass = averagePnlValue >= 0 ? 'text-success' : 'text-danger';
      const drawdownClass = drawdownValue >= 0 ? 'text-success' : 'text-danger';
      const roiClass = roiValue >= 0 ? 'text-success' : 'text-danger';

      return (
        <div className="card border-0 shadow-sm mb-4">
          <div className={`card-header ${headerClass} text-white`}>
            <h6 className="mb-0">
              <i className="bi bi-graph-up-arrow me-2"></i>
              {title}
            </h6>
          </div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-md-3">
                <div className="text-center p-3 bg-light rounded">
                  <div className="text-muted small">Total Trades</div>
                  <div className="h4 fw-bold mb-0">{cardSummary.totalTrades}</div>
                  <div className="small text-muted">
                    {cardSummary.winningTrades}W / {cardSummary.losingTrades}L
                  </div>
                </div>
              </div>
              <div className="col-md-3">
                <div className="text-center p-3 bg-light rounded">
                  <div className="text-muted small">Win Rate</div>
                  <div className="h4 fw-bold mb-0" style={{ color: cardSummary.winRate >= 50 ? '#198754' : '#dc3545' }}>
                    {cardSummary.winRate.toFixed(2)}%
                  </div>
                  <div className="small text-muted">Open Trades: {cardSummary.openTrades}</div>
                </div>
              </div>
              <div className="col-md-3">
                <div className="text-center p-3 bg-light rounded">
                  <div className="text-muted small">Total P&L</div>
                  <div className={`h4 fw-bold mb-0 ${totalPnlClass}`}>
                    {totalPnlValue >= 0 ? '+' : ''}₹{formatNumericValue(totalPnlValue)}
                  </div>
                </div>
              </div>
              <div className="col-md-3">
                <div className="text-center p-3 bg-light rounded">
                  <div className="text-muted small">Average P&L</div>
                  <div className={`h4 fw-bold mb-0 ${averagePnlClass}`}>
                    {averagePnlValue >= 0 ? '+' : ''}₹{formatNumericValue(averagePnlValue)}
                  </div>
                </div>
              </div>
              <div className="col-md-3">
                <div className="text-center p-3 bg-light rounded">
                  <div className="text-muted small">Max Drawdown</div>
                  <div className={`h4 fw-bold mb-0 ${drawdownClass}`}>
                    {drawdownValue >= 0 ? '+' : ''}₹{formatNumericValue(drawdownValue)}
                  </div>
                  <div className="small text-muted">{drawdownPercentValue.toFixed(2)}%</div>
                </div>
              </div>
              <div className="col-md-3">
                <div className="text-center p-3 bg-light rounded">
                  <div className="text-muted small">ROI</div>
                  <div className={`h4 fw-bold mb-0 ${roiClass}`}>
                    {roiValue >= 0 ? '+' : ''}{roiValue.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>

            <div className="row g-3 mt-3">
              <div className="col-md-6">
                <div className="p-3 bg-success bg-opacity-10 rounded">
                  <div className="text-muted small">Best Day</div>
                  {cardSummary.bestDay ? (
                    <>
                      <div className="fw-semibold">{cardSummary.bestDay.label}</div>
                      <div className="text-success mb-0">
                        {cardSummary.bestDay.pnl >= 0 ? '+' : ''}₹{formatNumericValue(cardSummary.bestDay.pnl)}
                      </div>
                    </>
                  ) : (
                    <div className="text-muted small mb-0">No data available</div>
                  )}
                </div>
              </div>
              <div className="col-md-6">
                <div className="p-3 bg-danger bg-opacity-10 rounded">
                  <div className="text-muted small">Worst Day</div>
                  {cardSummary.worstDay ? (
                    <>
                      <div className="fw-semibold">{cardSummary.worstDay.label}</div>
                      <div className="text-danger mb-0">
                        {cardSummary.worstDay.pnl >= 0 ? '+' : ''}₹{formatNumericValue(cardSummary.worstDay.pnl)}
                      </div>
                    </>
                  ) : (
                    <div className="text-muted small mb-0">No data available</div>
                  )}
                </div>
              </div>
            </div>

            <div className="row mt-3 align-items-center">
              <div className="col-md-6">
                <small className="text-muted">
                  <strong>Parameters:</strong> SL {formatNumericValue(cardSummary.parameters.stopLossPercent)}% | Target {formatNumericValue(cardSummary.parameters.targetPercent)}% | Lot {cardSummary.parameters.lotSize} | Strike Step {cardSummary.parameters.strikeStep} | RSI {formatNumericValue(rsiThresholdValue)} | Initial ₹{formatNumericValue(initialInvestmentValue)}
                </small>
              </div>
              {cardSummary.dateRange && (
                <div className="col-md-6 text-md-end">
                  <small className="text-muted">
                    <strong>Date Range:</strong> {cardSummary.dateRange.from} → {cardSummary.dateRange.to} ({cardSummary.dateRange.days} days)
                  </small>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    };

    const renderTimeframeSection = (
      title: string,
      dataset?: {
        daily: TimeframeStat[];
        weekly: TimeframeStat[];
        monthly: TimeframeStat[];
        yearly: TimeframeStat[];
      },
      prefix = 'timeframe'
    ) => {
      const nodes = buildTimeframeTree(dataset, prefix);

      return (
        <div className="card border-0 shadow-sm mb-4">
          <div className="card-header bg-secondary text-white">
            <h6 className="mb-0">
              <i className="bi bi-calendar-range me-2"></i>
              {title}
            </h6>
          </div>
          <div className="card-body">
            {nodes.length === 0 ? (
              <p className="text-muted small mb-0">No timeframe data available.</p>
            ) : (
              <ul className="list-unstyled mb-0">
                {nodes.map((node) => renderTreeNode(node, expandedTreeNodes, setExpandedTreeNodes, formatNumericValue))}
              </ul>
            )}
          </div>
        </div>
      );
    };

    return (
      <div className="mountain-signal-chart">
        <div className="card border-0 shadow-sm mb-3">
          <div className="card-body">
            <h5 className="card-title mb-3">
              <i className="bi bi-sliders me-2"></i>
              Strategy Optimizer - {strategy.strategy_name}
            </h5>
            <p className="text-muted small mb-4">
              Experiment with option stop-loss and target percentages across a broad historical window (up to 3 years) to evaluate profitability and win rates.
            </p>

            <div className="row g-3 mb-3">
              <div className="col-md-3">
                <label htmlFor="optimizer-from-date" className="form-label fw-bold">
                  <i className="bi bi-calendar3 me-2"></i>From Date
                </label>
                <input
                  type="date"
                  id="optimizer-from-date"
                  className="form-control"
                  value={optimizerFromDate}
                  onChange={(e) => setOptimizerFromDate(e.target.value)}
                  min={threeYearsAgoIso}
                  max={todayIso}
                />
              </div>
              <div className="col-md-3">
                <label htmlFor="optimizer-to-date" className="form-label fw-bold">
                  <i className="bi bi-calendar3 me-2"></i>To Date
                </label>
                <input
                  type="date"
                  id="optimizer-to-date"
                  className="form-control"
                  value={optimizerToDate}
                  onChange={(e) => setOptimizerToDate(e.target.value)}
                  min={threeYearsAgoIso}
                  max={todayIso}
                />
              </div>
              <div className="col-md-3">
                <label htmlFor="optimizer-stop-loss" className="form-label fw-bold">
                  <i className="bi bi-shield-exclamation me-2"></i>Option Stop Loss (%)
                </label>
                <input
                  type="number"
                  id="optimizer-stop-loss"
                  className="form-control"
                  value={optimizerStopLossPercent}
                  min={0.1}
                  step={0.1}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    setOptimizerStopLossPercent(Number.isNaN(value) ? 0 : value);
                  }}
                />
              </div>
              <div className="col-md-3">
                <label htmlFor="optimizer-target" className="form-label fw-bold">
                  <i className="bi bi-bullseye me-2"></i>Option Target (%)
                </label>
                <input
                  type="number"
                  id="optimizer-target"
                  className="form-control"
                  value={optimizerTargetPercent}
                  min={0.1}
                  step={0.1}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    setOptimizerTargetPercent(Number.isNaN(value) ? 0 : value);
                  }}
                />
              </div>
              <div className="col-md-3">
                <label htmlFor="optimizer-rsi" className="form-label fw-bold">
                  <i className="bi bi-activity me-2"></i>RSI Threshold
                </label>
                <input
                  type="number"
                  id="optimizer-rsi"
                  className="form-control"
                  value={optimizerRsiThreshold}
                  min={10}
                  max={100}
                  step={0.5}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    setOptimizerRsiThreshold(Number.isNaN(value) ? 0 : value);
                  }}
                />
              </div>
              <div className="col-md-3">
                <label htmlFor="optimizer-investment" className="form-label fw-bold">
                  <i className="bi bi-cash-coin me-2"></i>Initial Investment (₹)
                </label>
                <input
                  type="number"
                  id="optimizer-investment"
                  className="form-control"
                  value={optimizerInitialInvestment}
                  min={1000}
                  step={1000}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    setOptimizerInitialInvestment(Number.isNaN(value) ? 0 : value);
                  }}
                />
              </div>
            </div>

            <div className="row g-3 align-items-end mb-3">
              <div className="col-md-6">
                <div className="alert alert-secondary py-2 mb-0">
                  <i className="bi bi-info-circle me-2"></i>
                  Use positive percentages for stop loss and target. The optimizer will apply these values to every qualifying option trade within the selected window.
                </div>
              </div>
              <div className="col-md-3">
                <label className="form-label fw-bold">&nbsp;</label>
                <button
                  className="btn btn-outline-secondary w-100"
                  type="button"
                  onClick={() => {
                    const defaultStopLossPercent = Math.abs(ruleConfig.optionTrade.stopLossPercent) * 100;
                    const defaultTargetPercent = Math.abs(ruleConfig.optionTrade.targetPercent) * 100;
                    const defaultRsiThreshold = ruleConfig.rsiThreshold ?? 70;
                    setOptimizerStopLossPercent(Number(defaultStopLossPercent.toFixed(2)));
                    setOptimizerTargetPercent(Number(defaultTargetPercent.toFixed(2)));
                    setOptimizerInitialInvestment(100000);
                    setOptimizerRsiThreshold(Number(defaultRsiThreshold.toFixed(2)));
                  }}
                  disabled={optimizerLoading}
                >
                  <i className="bi bi-arrow-counterclockwise me-2"></i>Reset Parameters
                </button>
              </div>
              <div className="col-md-3">
                <label className="form-label fw-bold">&nbsp;</label>
                <button
                  className="btn btn-primary w-100"
                  onClick={runOptimizer}
                  disabled={optimizerLoading || !optimizerFromDate || !optimizerToDate}
                >
                  {optimizerLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                      Running...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-play-circle me-2"></i>Run Optimizer
                    </>
                  )}
                </button>
              </div>
            </div>

            {optimizerError && (
              <div className="alert alert-danger" role="alert">
                <i className="bi bi-exclamation-triangle me-2"></i>
                {optimizerError}
              </div>
            )}

            {optimizerResults && (
              <>
                {renderSummaryCard('Index Performance Overview', summary, 'bg-dark')}
                {renderSummaryCard('Option Performance Overview', optionSummary, 'bg-secondary')}

                <div className="row">
                  <div className="col-lg-6">
                    {renderTimeframeSection('Index Timeframe Breakdown', optimizerResults.timeframes, 'index')}
                  </div>
                  <div className="col-lg-6">
                    {renderTimeframeSection('Option Timeframe Breakdown', optimizerResults.optionTimeframes, 'option')}
                  </div>
                </div>
              </>
            )}

            {!optimizerResults && !optimizerLoading && (
              <div className="alert alert-info border-0 bg-info bg-opacity-10">
                <i className="bi bi-lightbulb me-2"></i>
                Select a date range and adjust the stop loss / target percentages, then click <strong>Run Optimizer</strong> to view results.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mountain-signal-chart">
      <div className="card border-0 shadow-sm mb-3">
        <div className="card-body">
          <div className="row align-items-end mb-3">
            <div className="col-md-4">
              <label htmlFor="chart-date-picker" className="form-label fw-bold">
                <i className="bi bi-calendar3 me-2"></i>Select Date
              </label>
              <input
                type="date"
                id="chart-date-picker"
                className="form-control"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="col-md-3">
              <label htmlFor="chart-type-select" className="form-label fw-bold">
                <i className="bi bi-bar-chart me-2"></i>Chart Type
              </label>
              <select
                id="chart-type-select"
                className="form-select"
                value={chartType}
                onChange={(e) => setChartType(e.target.value as 'candlestick' | 'line')}
              >
                <option value="candlestick">Candlestick</option>
                <option value="line">Line</option>
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">&nbsp;</label>
              <button
                className="btn btn-primary w-100"
                onClick={fetchChartData}
                disabled={loading || !selectedDate}
              >
                {loading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                    Loading...
                  </>
                ) : (
                  <>
                    <i className="bi bi-graph-up-arrow me-2"></i>Load Chart
                  </>
                )}
              </button>
            </div>
            <div className="col-md-3">
              <label className="form-label fw-bold">
                <i className="bi bi-sliders me-2"></i>Include in Chart & P&L
              </label>
              <div className="d-flex gap-3">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="filter-pe-chart" checked={filterPE} onChange={(e) => setFilterPE(e.target.checked)} />
                  <label className="form-check-label" htmlFor="filter-pe-chart">PE</label>
                </div>
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="filter-ce-chart" checked={filterCE} onChange={(e) => setFilterCE(e.target.checked)} />
                  <label className="form-check-label" htmlFor="filter-ce-chart">CE</label>
                </div>
              </div>
              <div className="text-muted small mt-2">
                <strong>Strategy:</strong> {strategy.strategy_name}<br/>
                <strong>Instrument:</strong> {strategy.instrument} | <strong>EMA:</strong> {emaPeriod}
              </div>
            </div>
          </div>

          {error && (
            <div className="alert alert-warning" role="alert">
              <i className="bi bi-exclamation-triangle me-2"></i>{error}
            </div>
          )}

          {chartDataFormatted.length > 0 && (
            <div className="mb-3">
              {(() => {
                const today = new Date().toISOString().split('T')[0];
                const isToday = selectedDate === today;
                const openTrades = tradeHistory.filter(t => !t.exitTime).length;
                
                if (isToday && openTrades > 0) {
                  return (
                    <div className="alert alert-info mb-2 py-2">
                      <div className="d-flex justify-content-between align-items-center">
                        <span>
                          <i className="bi bi-broadcast me-2"></i>
                          <strong>Live P&L Tracking Active</strong> - Auto-refreshing every 30 seconds
                        </span>
                        {lastUpdateTime && (
                          <small className="text-muted">
                            Last updated: {lastUpdateTime.toLocaleTimeString()}
                          </small>
                        )}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              <div className="row text-center">
                <div className="col-md-3">
                  <span className="badge bg-danger me-2">PE Signal</span>
                  <span className="badge bg-success me-2">CE Signal</span>
                </div>
                <div className="col-md-3">
                  <span className="badge bg-success me-2">Entry</span>
                  <span className="badge bg-danger me-2">Stop Loss</span>
                  <span className="badge bg-warning me-2">Target</span>
                </div>
                <div className="col-md-3">
                  <small className="text-muted">
                    Signals Found: <strong>{signalCandles.filter(s => (s.type === 'PE' && filterPE) || (s.type === 'CE' && filterCE)).length}</strong>
                  </small>
                </div>
                <div className="col-md-3">
                  <small className="text-muted">
                    Trades: <strong>{tradeEvents.filter(t => t.type === 'ENTRY' && ((t.tradeType === 'PE' && filterPE) || (t.tradeType === 'CE' && filterCE))).length}</strong>
                  </small>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {chartDataFormatted.length > 0 && (
        <div className="card border-0 shadow-sm">
          <div className="card-body">
            <h5 className="card-title mb-3">
              <i className="bi bi-bar-chart-fill me-2"></i>
              Mountain Signal Strategy Chart
            </h5>
            <div style={{ width: '100%', height: '600px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartDataFormatted}
                  margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                  <XAxis
                    dataKey="timeFormatted"
                    type="category"
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    stroke="#666"
                    style={{ fontSize: '12px' }}
                    interval={Math.floor(chartDataFormatted.length / 20)} // Show ~20 labels
                  />
                  <YAxis
                    stroke="#666"
                    style={{ fontSize: '12px' }}
                    domain={['dataMin - 10', 'dataMax + 10']}
                  />
                  {/* RSI YAxis (0-100 scale) */}
                  {chartDataFormatted.some(c => c.rsi14 !== null && c.rsi14 !== undefined) && (
                    <YAxis
                      yAxisId="rsi"
                      orientation="right"
                      stroke="#82ca9d"
                      style={{ fontSize: '12px' }}
                      domain={[0, 100]}
                      label={{ value: 'RSI', angle: -90, position: 'insideRight' }}
                    />
                  )}
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  
                  {/* EMA Line */}
                  {chartDataFormatted.some(c => c.ema5 !== null) && (
                    <Line
                      type="monotone"
                      dataKey="ema5"
                      stroke="#ff6b35"
                      strokeWidth={2}
                      dot={false}
                      name={`EMA ${emaPeriod}`}
                      connectNulls={false}
                    />
                  )}

                  {/* RSI 14 Line (on separate Y-axis) */}
                  {chartDataFormatted.some(c => c.rsi14 !== null && c.rsi14 !== undefined) && (
                    <Line
                      type="monotone"
                      dataKey="rsi14"
                      stroke="#82ca9d"
                      strokeWidth={2}
                      dot={false}
                      name="RSI 14"
                      connectNulls={false}
                      yAxisId="rsi"
                    />
                  )}

                  {/* RSI 14 Reference Lines (Thresholds) */}
                  {chartDataFormatted.some(c => c.rsi14 !== null && c.rsi14 !== undefined) && (
                    <>
                      <ReferenceLine yAxisId="rsi" y={70} stroke="#dc3545" strokeDasharray="3 3" strokeWidth={1} label={{ value: 'RSI 70 (PE Entry)', position: 'right', fill: '#dc3545' }} />
                      <ReferenceLine yAxisId="rsi" y={30} stroke="#28a745" strokeDasharray="3 3" strokeWidth={1} label={{ value: 'RSI 30 (CE Entry)', position: 'right', fill: '#28a745' }} />
                    </>
                  )}

                  {/* PE Break Level Reference Line */}
                  {peBreakLevel && (
                    <ReferenceLine
                      y={peBreakLevel}
                      stroke="#dc3545"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                      label={{ value: 'PE Break Level', position: 'right', fill: '#dc3545' }}
                    />
                  )}

                  {/* CE Break Level Reference Line */}
                  {ceBreakLevel && (
                    <ReferenceLine
                      y={ceBreakLevel}
                      stroke="#28a745"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                      label={{ value: 'CE Break Level', position: 'right', fill: '#28a745' }}
                    />
                  )}

                  {/* Chart based on type */}
                  {chartType === 'candlestick' ? (
                    <>
                      {/* Custom Candlestick Renderer */}
                      <Customized component={CandlestickRenderer} />
                      {/* Invisible line to trigger tooltip */}
                      <Line
                        type="monotone"
                        dataKey="close"
                        stroke="transparent"
                        strokeWidth={0}
                        dot={false}
                        activeDot={false}
                        connectNulls={false}
                      />
                    </>
                  ) : (
                    <>
                      {/* Line Chart */}
                      <Line
                        type="monotone"
                        dataKey="close"
                        stroke="#8884d8"
                        strokeWidth={2}
                        dot={false}
                        name="Close Price"
                        connectNulls={false}
                      />
                  {/* Entry markers on line */}
                  {tradeEvents.filter(e => e.type === 'ENTRY' && ((e.tradeType === 'PE' && filterPE) || (e.tradeType === 'CE' && filterCE))).map((event, idx) => {
                        const candle = chartDataFormatted[event.index];
                        if (!candle) return null;
                        return (
                          <ReferenceLine
                            key={`entry-${idx}`}
                            x={candle.timeFormatted}
                            stroke={event.tradeType === 'PE' ? '#dc3545' : '#28a745'}
                            strokeDasharray="3 3"
                            strokeWidth={2}
                            label={{ value: `ENTRY ${event.tradeType}`, position: 'top', fill: event.tradeType === 'PE' ? '#dc3545' : '#28a745' }}
                          />
                        );
                      })}
                  {/* Exit markers on line */}
                  {tradeEvents.filter(e => (e.type === 'STOP_LOSS' || e.type === 'TARGET') && ((e.tradeType === 'PE' && filterPE) || (e.tradeType === 'CE' && filterCE))).map((event, idx) => {
                        const candle = chartDataFormatted[event.index];
                        if (!candle) return null;
                        return (
                          <ReferenceLine
                            key={`exit-${idx}`}
                            x={candle.timeFormatted}
                            stroke={event.type === 'STOP_LOSS' ? '#dc3545' : '#ffc107'}
                            strokeDasharray="3 3"
                            strokeWidth={2}
                            label={{ value: event.type, position: 'bottom', fill: event.type === 'STOP_LOSS' ? '#dc3545' : '#ffc107' }}
                          />
                        );
                      })}
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {!loading && chartDataFormatted.length === 0 && !error && (
        <div className="card border-0 shadow-sm">
          <div className="card-body text-center py-5">
            <i className="bi bi-graph-up" style={{ fontSize: '4rem', opacity: 0.3, color: '#6c757d' }}></i>
            <p className="mt-3 text-muted">Select a date and click "Load Chart" to view the Mountain Signal strategy visualization</p>
          </div>
        </div>
      )}

      {/* Ignored Signals Table */}
      {ignoredSignals.length > 0 && (
        <div className="card border-0 shadow-sm mt-3">
          <div className="card-header bg-warning text-dark">
            <h5 className="card-title mb-0">
              <i className="bi bi-exclamation-triangle me-2"></i>
              Ignored Signals (RSI Condition Not Met)
            </h5>
          </div>
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-hover table-striped">
                <thead className="table-warning">
                  <tr>
                    <th>#</th>
                    <th>Signal Time</th>
                    <th>Signal Type</th>
                    <th>Signal High</th>
                    <th>Signal Low</th>
                    <th>RSI Value</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {ignoredSignals.map((signal, index) => (
                    <tr key={index}>
                      <td><strong>{index + 1}</strong></td>
                      <td>{formatDateTime(signal.signalTime)}</td>
                      <td>
                        <span className={`badge ${signal.signalType === 'PE' ? 'bg-danger' : 'bg-success'}`}>
                          {signal.signalType}
                        </span>
                      </td>
                      <td>{signal.signalHigh.toFixed(2)}</td>
                      <td>{signal.signalLow.toFixed(2)}</td>
                      <td>
                        {signal.rsiValue !== null ? (
                          <span className={signal.signalType === 'PE' && signal.rsiValue <= 70 ? 'text-danger' : signal.signalType === 'CE' && signal.rsiValue >= 30 ? 'text-danger' : 'text-muted'}>
                            {signal.rsiValue.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-muted">N/A</span>
                        )}
                      </td>
                      <td>
                        <small className="text-muted">{signal.reason}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Signals Identified - Waiting for Trade */}
      {waitingSignals.length > 0 && (
        <div className="card border-0 shadow-sm mt-3">
          <div className="card-header bg-primary text-white">
            <h5 className="card-title mb-0">
              <i className="bi bi-clock-history me-2"></i>
              Signals Identified - Waiting for Trade Entry
            </h5>
            <small className="text-white-50">
              Valid signals identified but entry condition not yet triggered
            </small>
          </div>
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-hover table-striped">
                <thead className="table-primary">
                  <tr>
                    <th>#</th>
                    <th>Signal Time</th>
                    <th>Signal Type</th>
                    <th>Signal High</th>
                    <th>Signal Low</th>
                    <th>Break Level</th>
                    <th>Current Close</th>
                    <th>Gap to Entry</th>
                    <th>RSI</th>
                    <th>EMA</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {waitingSignals.filter(s => (s.signalType === 'PE' && filterPE) || (s.signalType === 'CE' && filterCE)).map((signal, index) => {
                    const gap = signal.signalType === 'PE' 
                      ? signal.currentClose - signal.breakLevel 
                      : signal.breakLevel - signal.currentClose;
                    const gapPercent = (gap / signal.breakLevel) * 100;
                    
                    return (
                      <tr key={index}>
                        <td><strong>{index + 1}</strong></td>
                        <td>{formatDateTime(signal.signalTime)}</td>
                        <td>
                          <span className={`badge ${signal.signalType === 'PE' ? 'bg-danger' : 'bg-success'}`}>
                            {signal.signalType}
                          </span>
                        </td>
                        <td>{signal.signalHigh.toFixed(2)}</td>
                        <td>{signal.signalLow.toFixed(2)}</td>
                        <td>
                          <strong className="text-primary">{signal.breakLevel.toFixed(2)}</strong>
                        </td>
                        <td>{signal.currentClose.toFixed(2)}</td>
                        <td>
                          <span className={gap > 0 ? 'text-warning' : 'text-success fw-bold'}>
                            {gap > 0 ? '+' : ''}{gap.toFixed(2)} ({gapPercent.toFixed(2)}%)
                          </span>
                        </td>
                        <td>
                          {signal.rsiValue !== null ? (
                            <span className={
                              signal.signalType === 'PE' && signal.rsiValue > 70 ? 'text-success' : 
                              signal.signalType === 'CE' && signal.rsiValue < 30 ? 'text-success' : 
                              'text-muted'
                            }>
                              {signal.rsiValue.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-muted">N/A</span>
                          )}
                        </td>
                        <td>{signal.emaValue.toFixed(2)}</td>
                        <td>
                          <span className="badge bg-info">
                            {signal.signalType === 'PE' ? 'Waiting: Close < ' : 'Waiting: Close > '}
                            {signal.breakLevel.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="alert alert-info mb-0 mt-2">
              <i className="bi bi-info-circle me-2"></i>
              <strong>Note:</strong> These signals meet all criteria (EMA + RSI) but are waiting for the entry trigger:
              <ul className="mb-0 mt-2">
                <li><strong>PE Signals:</strong> Waiting for next candle to close below {waitingSignals.filter(s => s.signalType === 'PE').length > 0 ? waitingSignals.filter(s => s.signalType === 'PE')[0]?.breakLevel.toFixed(2) : 'signal low'}</li>
                <li><strong>CE Signals:</strong> Waiting for next candle to close above {waitingSignals.filter(s => s.signalType === 'CE').length > 0 ? waitingSignals.filter(s => s.signalType === 'CE')[0]?.breakLevel.toFixed(2) : 'signal high'}</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Trade History Table */}
      {tradeHistory.length > 0 && (
        <div className="card border-0 shadow-sm mt-3">
          <div className="card-header bg-info text-white">
            <h5 className="card-title mb-0">
              <i className="bi bi-table me-2"></i>
              Trade History & P&L Analysis {(!filterPE || !filterCE) && '(Filtered)'}
            </h5>
            <small className="text-white-50">
              <i className="bi bi-broadcast me-1"></i>
              Open trades show live unrealized P&L based on latest price
            </small>
          </div>
          <div className="card-body">
            <div className="table-responsive">
              <table className="table table-hover table-striped">
                <thead className="table-dark">
                  <tr>
                    <th>#</th>
                    <th>Signal Time</th>
                    <th>Signal Type</th>
                    <th>Signal High</th>
                    <th>Signal Low</th>
                    <th>Entry Time</th>
                    <th>Entry Price</th>
                    <th>Exit Time</th>
                    <th>Exit Price</th>
                    <th>Exit Type</th>
                    <th>P&L</th>
                    <th>P&L %</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tradeHistory.filter(trade => (trade.signalType === 'PE' && filterPE) || (trade.signalType === 'CE' && filterCE)).map((trade, index) => {
                    // Calculate live P&L for open trades using latest candle close
                    const latestClose = chartData.candles.length > 0 ? chartData.candles[chartData.candles.length - 1].c : null;
                    let livePnl = trade.pnl;
                    let livePnlPercent = trade.pnlPercent;
                    
                    // If trade is open and we have latest price, calculate unrealized P&L
                    if (!trade.exitTime && latestClose) {
                      if (trade.signalType === 'PE') {
                        // PE: Profit when price goes down (current < entry)
                        livePnl = (trade.entryPrice - latestClose) * 50; // Assuming 50 units per lot
                        livePnlPercent = ((trade.entryPrice - latestClose) / trade.entryPrice) * 100;
                      } else {
                        // CE: Profit when price goes up (current > entry)
                        livePnl = (latestClose - trade.entryPrice) * 50;
                        livePnlPercent = ((latestClose - trade.entryPrice) / trade.entryPrice) * 100;
                      }
                    }
                    
                    return (
                    <tr key={index} className={!trade.exitTime ? 'table-warning' : ''}>
                      <td><strong>{index + 1}</strong></td>
                      <td>{formatDateTime(trade.signalTime)}</td>
                      <td>
                        <span className={`badge ${trade.signalType === 'PE' ? 'bg-danger' : 'bg-success'}`}>
                          {trade.signalType}
                        </span>
                      </td>
                      <td>{trade.signalHigh.toFixed(2)}</td>
                      <td>{trade.signalLow.toFixed(2)}</td>
                      <td>{formatDateTime(trade.entryTime)}</td>
                      <td><strong>{trade.entryPrice.toFixed(2)}</strong></td>
                      <td>
                        {trade.exitTime ? formatDateTime(trade.exitTime) : (
                          <span className="text-primary fw-bold">
                            <i className="bi bi-activity me-1"></i>Live
                          </span>
                        )}
                      </td>
                      <td>
                        {trade.exitPrice ? trade.exitPrice.toFixed(2) : (
                          latestClose ? (
                            <span className="text-primary fw-bold">
                              {latestClose.toFixed(2)} <small className="text-muted">(LTP)</small>
                            </span>
                          ) : (
                            <span className="text-muted">-</span>
                          )
                        )}
                      </td>
                      <td>
                        {trade.exitType ? (
                          <span className={`badge ${
                            trade.exitType === 'STOP_LOSS' ? 'bg-danger' : 
                            trade.exitType === 'MKT_CLOSE' ? 'bg-secondary' : 
                            'bg-warning'
                          }`}>
                            {trade.exitType === 'STOP_LOSS' ? 'Stop Loss' : 
                             trade.exitType === 'MKT_CLOSE' ? 'Market Close' : 
                             'Target'}
                          </span>
                        ) : (
                          <span className="badge bg-info">Pending</span>
                        )}
                      </td>
                      <td>
                        {livePnl !== null ? (
                          <span className={`fw-bold ${livePnl >= 0 ? 'text-success' : 'text-danger'}`}>
                            {livePnl >= 0 ? '+' : ''}{livePnl.toFixed(2)}
                            {!trade.exitTime && <small className="text-muted ms-1">(Live)</small>}
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        {livePnlPercent !== null ? (
                          <span className={`fw-bold ${livePnlPercent >= 0 ? 'text-success' : 'text-danger'}`}>
                            {livePnlPercent >= 0 ? '+' : ''}{livePnlPercent.toFixed(2)}%
                            {!trade.exitTime && <small className="text-muted ms-1">(Live)</small>}
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        {trade.exitTime ? (
                          <span className="badge bg-secondary">Closed</span>
                        ) : (
                          <span className="badge bg-success">
                            <i className="bi bi-broadcast me-1"></i>Open
                          </span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                  {/* Summary Row */}
                  <tr className="table-info fw-bold">
                    <td colSpan={10} className="text-end">Total P&L (Realized + Unrealized):</td>
                    <td>
                      {(() => {
                        const latestClose = chartData.candles.length > 0 ? chartData.candles[chartData.candles.length - 1].c : null;
                        const filteredTrades = tradeHistory.filter(t => (t.signalType === 'PE' && filterPE) || (t.signalType === 'CE' && filterCE));
                        
                        const totalPnL = filteredTrades.reduce((sum, t) => {
                          if (t.pnl !== null) {
                            // Closed trade - use actual P&L
                            return sum + t.pnl;
                          } else if (latestClose) {
                            // Open trade - calculate live unrealized P&L
                            const livePnl = t.signalType === 'PE' 
                              ? (t.entryPrice - latestClose) * 50
                              : (latestClose - t.entryPrice) * 50;
                            return sum + livePnl;
                          }
                          return sum;
                        }, 0);
                        
                        const hasOpenTrades = filteredTrades.some(t => !t.exitTime);
                        
                        return (
                          <span className={totalPnL >= 0 ? 'text-success' : 'text-danger'}>
                            {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
                            {hasOpenTrades && <small className="text-muted ms-1">(Live)</small>}
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const latestClose = chartData.candles.length > 0 ? chartData.candles[chartData.candles.length - 1].c : null;
                        const filteredTrades = tradeHistory.filter(t => (t.signalType === 'PE' && filterPE) || (t.signalType === 'CE' && filterCE));
                        
                        const totalPnLPercent = filteredTrades.reduce((sum, t) => {
                          if (t.pnlPercent !== null) {
                            // Closed trade - use actual P&L %
                            return sum + t.pnlPercent;
                          } else if (latestClose) {
                            // Open trade - calculate live unrealized P&L %
                            const livePnlPercent = t.signalType === 'PE'
                              ? ((t.entryPrice - latestClose) / t.entryPrice) * 100
                              : ((latestClose - t.entryPrice) / t.entryPrice) * 100;
                            return sum + livePnlPercent;
                          }
                          return sum;
                        }, 0);
                        
                        const hasOpenTrades = filteredTrades.some(t => !t.exitTime);
                        
                        return (
                          <span className={totalPnLPercent >= 0 ? 'text-success' : 'text-danger'}>
                            {totalPnLPercent >= 0 ? '+' : ''}{totalPnLPercent.toFixed(2)}%
                            {hasOpenTrades && <small className="text-muted ms-1">(Live)</small>}
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const filteredTrades = tradeHistory.filter(t => (t.signalType === 'PE' && filterPE) || (t.signalType === 'CE' && filterCE));
                        const closedTrades = filteredTrades.filter(t => t.exitTime).length;
                        const openTrades = filteredTrades.filter(t => !t.exitTime).length;
                        return (
                          <>
                            <span className="badge bg-secondary me-1">{closedTrades} Closed</span>
                            {openTrades > 0 && <span className="badge bg-success">{openTrades} Open</span>}
                          </>
                        );
                      })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Real Option Contract Trade Implementation */}
      {optionTradeHistory.length > 0 && (
        <div className="card border-0 shadow-sm mt-3">
          <div className="card-header bg-success text-white">
            <h5 className="card-title mb-0">
              <i className="bi bi-currency-rupee me-2"></i>
              Real Option Contract Trades (Simulation)
            </h5>
            <small className="text-white-50">
              Signals based on Index | Trades executed on Option Contracts | {stopLossPercentAbsLabel}% Stop Loss on Premium
            </small>
          </div>
          <div className="card-body">
            <div className="alert alert-primary">
              <strong>Trade Logic:</strong>
              <ul className="mb-0 mt-2 small">
                <li><strong>Signal:</strong> Identified using index price (EMA + RSI) – evaluated {evaluationSecondsDisplay} sec before candle close</li>
                <li><strong>Entry:</strong> At breakout, select ATM option contract (NIFTY: nearest {niftyRoundingDisplay} | BANKNIFTY: nearest {bankRoundingDisplay})</li>
                <li><strong>Stop Loss:</strong> {stopLossPercentAbsLabel}% below option premium entry price</li>
                <li><strong>Target Profit:</strong> {targetPercentAbsLabel}% above option premium entry price</li>
                <li><strong>Exit Priority:</strong> 1) Option SL ({stopLossPercentLabelWithSign}%) 2) Option Target ({targetPercentLabelWithSign}%) 3) Market Close (3:15 PM)</li>
                <li><strong>Lot Size:</strong> NIFTY: {niftyLotSizeDisplay} | BANKNIFTY: {bankLotSizeDisplay}</li>
                <li><strong>Expiry:</strong> NIFTY: Weekly | BANKNIFTY: Monthly</li>
                <li><strong>Symbol Format:</strong> BANKNIFTY25NOV57700PE or NIFTY25NOV19550CE (Year + Month + Strike + Type)</li>
              </ul>
            </div>
            
            <div className="table-responsive">
              <table className="table table-hover table-striped">
                <thead className="table-success">
                  <tr>
                    <th>#</th>
                    <th>Signal Time</th>
                    <th>Type</th>
                    <th>Index @ Entry</th>
                    <th>ATM Strike</th>
                    <th>Option Symbol</th>
                    <th>Entry Time</th>
                    <th>Entry Premium</th>
                    <th>Stop Loss ({stopLossPercentLabelWithSign}%)</th>
                    <th>Target ({targetPercentLabelWithSign}%)</th>
                    <th>Exit Time</th>
                    <th>Exit Premium</th>
                    <th>Exit Reason</th>
                    <th>P&L</th>
                    <th>P&L %</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {optionTradeHistory.filter(trade => (trade.signalType === 'PE' && filterPE) || (trade.signalType === 'CE' && filterCE)).map((trade, index) => {
                    // Calculate live P&L for open option trades
                    const latestClose = chartData.candles.length > 0 ? chartData.candles[chartData.candles.length - 1].c : null;
                    let liveOptionPremium = trade.optionExitPrice;
                    let livePnl = trade.pnl;
                    let livePnlPercent = trade.pnlPercent;
                    
                    // If trade is open and we have latest index price, calculate live option premium
                    if (!trade.exitTime && latestClose) {
                      const liveOptionLtp = trade.optionSymbol ? optionLtpMap[trade.optionSymbol] : undefined;
                      if (liveOptionLtp !== undefined) {
                        liveOptionPremium = liveOptionLtp;
                      } else {
                        liveOptionPremium = simulateOptionPremium(latestClose, trade.atmStrike, trade.signalType);
                      }
                      const lotSize = trade.lotSize ?? getLotSize(instrument);
                      livePnl = (liveOptionPremium - trade.optionEntryPrice) * lotSize;
                      livePnlPercent = ((liveOptionPremium - trade.optionEntryPrice) / trade.optionEntryPrice) * 100;
                    }
                    
                    return (
                      <tr key={index} className={!trade.exitTime ? 'table-warning' : ''}>
                        <td><strong>{index + 1}</strong></td>
                        <td>{formatDateTime(trade.signalTime)}</td>
                        <td>
                          <span className={`badge ${trade.signalType === 'PE' ? 'bg-danger' : 'bg-success'}`}>
                            {trade.signalType}
                          </span>
                        </td>
                        <td>
                          <strong>{trade.indexAtEntry.toFixed(2)}</strong>
                        </td>
                        <td>
                          <span className="badge bg-primary">{Math.round(trade.atmStrike)}</span>
                        </td>
                        <td>
                          <code className="small">{trade.optionSymbol}</code>
                        </td>
                        <td>{formatDateTime(trade.entryTime)}</td>
                        <td>
                          <strong className="text-success">₹{trade.optionEntryPrice.toFixed(2)}</strong>
                        </td>
                        <td>
                          <span className="text-danger fw-bold">
                            ₹{trade.stopLossPrice.toFixed(2)}
                            {!trade.exitTime && liveOptionPremium && liveOptionPremium <= trade.stopLossPrice && (
                              <span className="badge bg-danger ms-2">SL HIT!</span>
                            )}
                          </span>
                        </td>
                        <td>
                          <span className="text-success fw-bold">
                            ₹{trade.targetPrice.toFixed(2)}
                            {!trade.exitTime && liveOptionPremium && liveOptionPremium >= trade.targetPrice && (
                              <span className="badge bg-success ms-2">TARGET HIT!</span>
                            )}
                          </span>
                        </td>
                        <td>
                          {trade.exitTime ? formatDateTime(trade.exitTime) : (
                            <span className="text-primary fw-bold">
                              <i className="bi bi-activity me-1"></i>Live
                            </span>
                          )}
                        </td>
                        <td>
                          {trade.optionExitPrice ? (
                            `₹${trade.optionExitPrice.toFixed(2)}`
                          ) : (
                            liveOptionPremium ? (
                              <span className="text-primary fw-bold">
                                ₹{liveOptionPremium.toFixed(2)} <small className="text-muted">(LTP)</small>
                              </span>
                            ) : (
                              <span className="text-muted">-</span>
                            )
                          )}
                        </td>
                        <td>
                          {trade.exitType ? (
                            <span className={`badge ${
                              trade.exitType === 'STOP_LOSS' ? 'bg-danger' : 
                              trade.exitType === 'MKT_CLOSE' ? 'bg-secondary' : 
                              'bg-warning'
                            }`}>
                            {trade.exitType === 'STOP_LOSS' ? `Stop Loss (${stopLossPercentLabelWithSign}%)` : 
                             trade.exitType === 'MKT_CLOSE' ? 'Market Close' : 
                             `Target (${targetPercentLabelWithSign}%)`}
                            </span>
                          ) : (
                            <span className="badge bg-info">Pending</span>
                          )}
                        </td>
                        <td>
                          {livePnl !== null ? (
                            <span className={`fw-bold ${livePnl >= 0 ? 'text-success' : 'text-danger'}`}>
                              {livePnl >= 0 ? '+' : ''}₹{livePnl.toFixed(2)}
                              {!trade.exitTime && <small className="text-muted ms-1">(Live)</small>}
                            </span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          {livePnlPercent !== null ? (
                            <span className={`fw-bold ${livePnlPercent >= 0 ? 'text-success' : 'text-danger'}`}>
                              {livePnlPercent >= 0 ? '+' : ''}{livePnlPercent.toFixed(2)}%
                              {!trade.exitTime && <small className="text-muted ms-1">(Live)</small>}
                            </span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          {trade.exitTime ? (
                            <span className="badge bg-secondary">Closed</span>
                          ) : (
                            <span className="badge bg-success">
                              <i className="bi bi-broadcast me-1"></i>Open
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Summary Row */}
                  <tr className="table-success fw-bold">
                    <td colSpan={13} className="text-end">Total P&L (Option Contracts):</td>
                    <td>
                      {(() => {
                        const latestClose = chartData.candles.length > 0 ? chartData.candles[chartData.candles.length - 1].c : null;
                        const filteredTrades = optionTradeHistory.filter(t => (t.signalType === 'PE' && filterPE) || (t.signalType === 'CE' && filterCE));
                        
                        const totalPnL = filteredTrades.reduce((sum, t) => {
                          if (t.pnl !== null) {
                            return sum + t.pnl;
                          } else if (latestClose) {
                            // Open trade - calculate live P&L
                            const liveOptionLtp = t.optionSymbol ? optionLtpMap[t.optionSymbol] : undefined;
                            const liveOptionPremium = liveOptionLtp !== undefined ? liveOptionLtp : simulateOptionPremium(latestClose, t.atmStrike, t.signalType);
                            const lotSize = t.lotSize ?? getLotSize(instrument);
                            const livePnl = (liveOptionPremium - t.optionEntryPrice) * lotSize;
                            return sum + livePnl;
                          }
                          return sum;
                        }, 0);
                        
                        const hasOpenTrades = filteredTrades.some(t => !t.exitTime);
                        
                        return (
                          <span className={totalPnL >= 0 ? 'text-success' : 'text-danger'}>
                            {totalPnL >= 0 ? '+' : ''}₹{totalPnL.toFixed(2)}
                            {hasOpenTrades && <small className="text-muted ms-1">(Live)</small>}
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const latestClose = chartData.candles.length > 0 ? chartData.candles[chartData.candles.length - 1].c : null;
                        const filteredTrades = optionTradeHistory.filter(t => (t.signalType === 'PE' && filterPE) || (t.signalType === 'CE' && filterCE));
                        
                        const totalPnLPercent = filteredTrades.reduce((sum, t) => {
                          if (t.pnlPercent !== null) {
                            return sum + t.pnlPercent;
                          } else if (latestClose) {
                            // Open trade - calculate live P&L %
                            const liveOptionLtp = t.optionSymbol ? optionLtpMap[t.optionSymbol] : undefined;
                            const liveOptionPremium = liveOptionLtp !== undefined ? liveOptionLtp : simulateOptionPremium(latestClose, t.atmStrike, t.signalType);
                            const livePnlPercent = ((liveOptionPremium - t.optionEntryPrice) / t.optionEntryPrice) * 100;
                            return sum + livePnlPercent;
                          }
                          return sum;
                        }, 0);
                        
                        const hasOpenTrades = filteredTrades.some(t => !t.exitTime);
                        
                        return (
                          <span className={totalPnLPercent >= 0 ? 'text-success' : 'text-danger'}>
                            {totalPnLPercent >= 0 ? '+' : ''}{totalPnLPercent.toFixed(2)}%
                            {hasOpenTrades && <small className="text-muted ms-1">(Live)</small>}
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const filteredTrades = optionTradeHistory.filter(t => (t.signalType === 'PE' && filterPE) || (t.signalType === 'CE' && filterCE));
                        const closedTrades = filteredTrades.filter(t => t.exitTime).length;
                        const openTrades = filteredTrades.filter(t => !t.exitTime).length;
                        return (
                          <>
                            <span className="badge bg-secondary me-1">{closedTrades} Closed</span>
                            {openTrades > 0 && <span className="badge bg-success">{openTrades} Open</span>}
                          </>
                        );
                      })()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const toggleTreeNode = (
  id: string,
  expandedTreeNodes: Set<string>,
  setExpandedTreeNodes: React.Dispatch<React.SetStateAction<Set<string>>>
) => {
  setExpandedTreeNodes((prev) => {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  });
};

const renderTreeNode = (
  node: TimeframeTreeNode,
  expandedTreeNodes: Set<string>,
  setExpandedTreeNodes: React.Dispatch<React.SetStateAction<Set<string>>>,
  formatNumericValue: (value: number) => string
): React.ReactElement => {
  const hasChildren = node.children && node.children.length > 0;
  const expanded = expandedTreeNodes.has(node.id);
  const pnlValue = node.stats?.pnl ?? null;
  const avgPnlValue = node.stats?.avgPnl ?? null;

  return (
    <li key={node.id} className="mb-2">
      <div className="d-flex align-items-start">
        {hasChildren ? (
          <button
            type="button"
            className="btn btn-sm btn-link text-decoration-none p-0 me-2"
            onClick={() => toggleTreeNode(node.id, expandedTreeNodes, setExpandedTreeNodes)}
            aria-expanded={expanded}
            aria-controls={`${node.id}-children`}
          >
            <i className={`bi bi-caret-${expanded ? 'down-fill' : 'right-fill'}`}></i>
          </button>
        ) : (
          <span className="me-2" style={{ width: '1rem' }}></span>
        )}
        <div>
          <div className="fw-semibold">{node.label}</div>
          {node.stats && (
            <div className="small text-muted">
              Trades: {node.stats.trades} · Wins: {node.stats.wins} · Losses: {node.stats.losses} · Win% {node.stats.winRate.toFixed(2)}%
              {pnlValue !== null && (
                <>
                  {' · '}P&L{' '}
                  <span className={pnlValue >= 0 ? 'text-success' : 'text-danger'}>
                    {pnlValue >= 0 ? '+' : ''}₹{formatNumericValue(pnlValue)}
                  </span>
                </>
              )}
              {avgPnlValue !== null && (
                <>
                  {' · '}Avg{' '}
                  <span className={avgPnlValue >= 0 ? 'text-success' : 'text-danger'}>
                    {avgPnlValue >= 0 ? '+' : ''}₹{formatNumericValue(avgPnlValue)}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {hasChildren && expanded && (
        <ul id={`${node.id}-children`} className="list-unstyled ms-4 mt-2">
          {node.children.map((child) => renderTreeNode(child, expandedTreeNodes, setExpandedTreeNodes, formatNumericValue))}
        </ul>
      )}
    </li>
  );
};

export default MountainSignalChart;

