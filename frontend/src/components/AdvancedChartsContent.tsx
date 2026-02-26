import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import PlotlyCandlestickChart, { PlotlyCandlePoint, TradeMarker } from './PlotlyCandlestickChart';
import { Plot } from '../lib/plotly-finance';
import { apiUrl } from '../config/api';
import { useSocket } from '../hooks/useSocket';
import { runMountainBacktest } from './advancedCharts/mountainStrategyEngine';
import { MountainEvent, MountainEventType } from './advancedCharts/MountainStrategyTypes';

type BtStrategy = 'mountain' | 'ema_crossover';

type TabKey = 'live' | 'backtest';

const NIFTY_TOKEN = 256265;
const BANKNIFTY_TOKEN = 260105;

const todayStr = (): string => new Date().toISOString().split('T')[0];

const INTERVAL_MAP: Record<number, string> = {
  1: 'minute',
  5: '5minute',
  15: '15minute',
  30: '30minute',
};

const computeEma5 = (candles: PlotlyCandlePoint[]): PlotlyCandlePoint[] => {
  const ema: number[] = [];
  const multiplier = 2 / (5 + 1);
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      ema.push(candles[i].close);
    } else {
      ema.push((candles[i].close - ema[i - 1]) * multiplier + ema[i - 1]);
    }
  }
  return candles.map((c, idx) => ({ ...c, ema5: ema[idx] ?? null }));
};

const floorToInterval = (date: Date, intervalMin: number): Date => {
  const d = new Date(date);
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / intervalMin) * intervalMin);
  return d;
};

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
};

const EVENT_BADGE_MAP: Record<string, string> = {
  [MountainEventType.SIGNAL_IDENTIFIED]: 'bg-info',
  [MountainEventType.SIGNAL_RESET]: 'bg-warning text-dark',
  [MountainEventType.SIGNAL_CLEARED]: 'bg-secondary',
  [MountainEventType.ENTRY_TRIGGERED]: 'bg-primary',
  [MountainEventType.ENTRY_SKIPPED_REENTRY]: 'bg-dark',
  [MountainEventType.EXIT_INDEX_STOP]: 'bg-danger',
  [MountainEventType.EXIT_INDEX_TARGET]: 'bg-success',
  [MountainEventType.EXIT_MARKET_CLOSE]: 'bg-secondary',
  [MountainEventType.NEW_DAY_RESET]: 'bg-light text-dark border',
  [MountainEventType.MARKET_CLOSE_SIGNAL_CLEAR]: 'bg-light text-dark border',
};

const EVENT_LABEL_MAP: Record<string, string> = {
  [MountainEventType.SIGNAL_IDENTIFIED]: 'SIGNAL',
  [MountainEventType.SIGNAL_RESET]: 'SIG RESET',
  [MountainEventType.SIGNAL_CLEARED]: 'SIG CLEAR',
  [MountainEventType.ENTRY_TRIGGERED]: 'ENTRY',
  [MountainEventType.ENTRY_SKIPPED_REENTRY]: 'SKIP RE-ENTRY',
  [MountainEventType.EXIT_INDEX_STOP]: 'EXIT STOP',
  [MountainEventType.EXIT_INDEX_TARGET]: 'EXIT TARGET',
  [MountainEventType.EXIT_MARKET_CLOSE]: 'EXIT MKT CLOSE',
  [MountainEventType.NEW_DAY_RESET]: 'NEW DAY',
  [MountainEventType.MARKET_CLOSE_SIGNAL_CLEAR]: 'MKT CLR SIGNAL',
};

const eventBadgeClass = (type: MountainEventType): string => EVENT_BADGE_MAP[type] || 'bg-secondary';
const eventLabel = (type: MountainEventType): string => EVENT_LABEL_MAP[type] || type;

interface BacktestSummary {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
  max_win: number;
  max_loss: number;
}

interface EquityPoint {
  timestamp: string;
  value: number;
}

interface BacktestTrade {
  entry_time: string;
  entry_price: number;
  exit_time: string;
  exit_price: number;
  direction: 'long' | 'short';
  pnl: number;
  exit_reason?: string;
}

const AdvancedChartsContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>('live');
  const [selectedIndex, setSelectedIndex] = useState<'BANKNIFTY' | 'NIFTY'>('BANKNIFTY');
  const [timeframeMinutes, setTimeframeMinutes] = useState<number>(5);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [showEma, setShowEma] = useState<boolean>(true);
  const [showVolume, setShowVolume] = useState<boolean>(true);

  const [rawCandles, setRawCandles] = useState<PlotlyCandlePoint[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isLiveStreaming, setIsLiveStreaming] = useState<boolean>(false);

  // Backtest state
  const [btStrategy, setBtStrategy] = useState<BtStrategy>('mountain');
  const [btFromDate, setBtFromDate] = useState<string>(daysAgo(7));
  const [btToDate, setBtToDate] = useState<string>(todayStr());
  const [btEmaFast, setBtEmaFast] = useState<number>(5);
  const [btEmaSlow, setBtEmaSlow] = useState<number>(20);
  const [btLoading, setBtLoading] = useState<boolean>(false);
  const [btError, setBtError] = useState<string | null>(null);
  const [btCandles, setBtCandles] = useState<PlotlyCandlePoint[]>([]);
  const [btMarkers, setBtMarkers] = useState<TradeMarker[]>([]);
  const [btEquity, setBtEquity] = useState<EquityPoint[]>([]);
  const [btSummary, setBtSummary] = useState<BacktestSummary | null>(null);
  const [btTrades, setBtTrades] = useState<BacktestTrade[]>([]);
  const [btEvents, setBtEvents] = useState<MountainEvent[]>([]);
  const [eventFilter, setEventFilter] = useState<string>('ALL');
  const [btRsiOverbought, setBtRsiOverbought] = useState<number>(70);
  const [btRsiOversold, setBtRsiOversold] = useState<number>(30);
  const [btRsi, setBtRsi] = useState<(number | null)[]>([]);
  const [btAdx, setBtAdx] = useState<(number | null)[]>([]);
  const [showPnlDetailModal, setShowPnlDetailModal] = useState<boolean>(false);

  // Live tab state
  const [liveRsiOverbought, setLiveRsiOverbought] = useState<number>(70);
  const [liveRsiOversold, setLiveRsiOversold] = useState<number>(30);
  const [liveEvents, setLiveEvents] = useState<MountainEvent[]>([]);
  const [liveTrades, setLiveTrades] = useState<BacktestTrade[]>([]);
  const [liveRsi, setLiveRsi] = useState<(number | null)[]>([]);
  const [liveAdx, setLiveAdx] = useState<(number | null)[]>([]);
  const [liveMarkers, setLiveMarkers] = useState<TradeMarker[]>([]);
  const [lastStrategyRunTime, setLastStrategyRunTime] = useState<string | null>(null);
  const [liveLots, setLiveLots] = useState<number>(1);
  const [zerodhaOrders, setZerodhaOrders] = useState<any[]>([]);
  const [zerodhaPositions, setZerodhaPositions] = useState<any[]>([]);
  const [showEntryConfirm, setShowEntryConfirm] = useState<boolean>(false);
  const [showExitConfirm, setShowExitConfirm] = useState<boolean>(false);
  const [entryPreview, setEntryPreview] = useState<{ tradingsymbol: string; quantity: number; instrument: string; optionType: string; lots: number; indexLtp: number } | null>(null);
  const [positionsForConfirm, setPositionsForConfirm] = useState<{ tradingsymbol: string; quantity: number; product?: string; exchange?: string }[]>([]);
  const [entryExitLoading, setEntryExitLoading] = useState<{ entry: boolean; exit: boolean }>({ entry: false, exit: false });
  const [liveTradeMessage, setLiveTradeMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [autoPlaceOrders, setAutoPlaceOrders] = useState<boolean>(false);
  const [autoTradeActiveOnServer, setAutoTradeActiveOnServer] = useState<boolean>(false);
  const [autoTradeLoading, setAutoTradeLoading] = useState<boolean>(false);
  const [autoTradeLockedRsi, setAutoTradeLockedRsi] = useState<{ ob: number; os: number } | null>(null);
  const liveStrategyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveStrategyDataRef = useRef<{
    rawCandles: PlotlyCandlePoint[];
    rsiOb: number;
    rsiOs: number;
  }>({ rawCandles: [], rsiOb: 70, rsiOs: 30 });

  const socket = useSocket();

  const isToday = selectedDate === todayStr();
  const instrumentToken = selectedIndex === 'NIFTY' ? NIFTY_TOKEN : BANKNIFTY_TOKEN;
  const kiteInterval = INTERVAL_MAP[timeframeMinutes] || '5minute';

  // ---------- Live candle fetching ----------
  const fetchCandles = useCallback(async () => {
    if (!selectedDate) return;
    try {
      setLoading(true);
      setError(null);
      setWarning(null);

      const isLiveToday = activeTab === 'live' && selectedDate === todayStr();

      if (isLiveToday) {
        // Live tab + today: fetch warmup (3 days before) for valid RSI(14)
        const warmupFrom = (() => {
          const d = new Date(selectedDate);
          d.setDate(d.getDate() - 3);
          return d.toISOString().split('T')[0];
        })();
        const resp = await fetch(apiUrl('/api/backtest/run'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            index: selectedIndex,
            from_date: warmupFrom,
            to_date: selectedDate,
            interval: kiteInterval,
            strategy: 'ema_crossover',
            ema_fast: 5,
            ema_slow: 20,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          setError(data.message || data.error || 'Failed to load warmup candles.');
          setRawCandles([]);
          return;
        }
        const candles = (data.candles || []) as Array<{
          timestamp: string; open: number; high: number; low: number; close: number; volume?: number;
        }>;
        if (!candles.length) { setRawCandles([]); return; }
        const mapped: PlotlyCandlePoint[] = candles.map((c) => ({
          time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close,
          volume: c.volume ?? 0, indexClose: c.close, ema5: null,
        }));
        setRawCandles(computeEma5(mapped));
      } else {
        const url = apiUrl(
          `/api/plotly/index-candles?index=${selectedIndex}&date=${selectedDate}&interval=${kiteInterval}`,
        );
        const resp = await fetch(url, { credentials: 'include' });
        const data = await resp.json();

        if (!resp.ok) {
          if (resp.status === 401) {
            setError(data.error || 'Session expired or not logged in. Please log in again.');
          } else {
            setError(data.error || 'Failed to load index candles from Zerodha.');
          }
          setRawCandles([]);
          return;
        }

        if (data.warning) setWarning(data.warning);

        const candles = (data.candles || []) as Array<{
          timestamp: string; open: number; high: number; low: number; close: number; volume?: number;
        }>;

        if (!candles.length) { setRawCandles([]); return; }

        const mapped: PlotlyCandlePoint[] = candles.map((c) => ({
          time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close,
          volume: c.volume ?? 0, indexClose: c.close, ema5: null,
        }));

        setRawCandles(computeEma5(mapped));
      }
    } catch (e: any) {
      setError(e instanceof Error ? e.message : 'Unexpected error while loading candles.');
      setRawCandles([]);
    } finally {
      setLoading(false);
    }
  }, [selectedIndex, selectedDate, kiteInterval, activeTab]);

  useEffect(() => { fetchCandles(); }, [fetchCandles]);

  // ---------- Live strategy run (debounced) ----------
  // Keep ref updated so runStrategy always uses latest data when timer fires
  liveStrategyDataRef.current = {
    rawCandles,
    rsiOb: liveRsiOverbought,
    rsiOs: liveRsiOversold,
  };

  useEffect(() => {
    if (activeTab !== 'live' || selectedDate !== todayStr() || rawCandles.length === 0) return;

    const runStrategy = () => {
      const { rawCandles: candles, rsiOb, rsiOs } = liveStrategyDataRef.current;
      if (candles.length === 0) return;
      const result = runMountainBacktest(candles, {
        rsiOverbought: rsiOb,
        rsiOversold: rsiOs,
      });
      setLiveEvents(result.events);
      setLiveRsi(result.indicators.rsi14);
      setLiveAdx(result.indicators.adx14);
      setLiveTrades(result.trades.map((t) => ({
        entry_time: t.entryTime,
        entry_price: t.entryPrice,
        exit_time: t.exitTime,
        exit_price: t.exitPrice,
        direction: 'short' as const,
        pnl: t.pnl,
        exit_reason: t.exitReason,
      })));

      const markers: TradeMarker[] = [];
      for (const t of result.trades) {
        markers.push({ time: t.entryTime, price: t.entryPrice, direction: 'short', action: 'entry' });
        markers.push({
          time: t.exitTime, price: t.exitPrice, direction: 'short', action: 'exit',
          label: `${t.exitReason} | P&L: ${t.pnl > 0 ? '+' : ''}${t.pnl.toFixed(2)}`,
        });
      }
      for (const ev of result.events) {
        if (ev.type === MountainEventType.SIGNAL_IDENTIFIED || ev.type === MountainEventType.SIGNAL_RESET) {
          markers.push({
            time: ev.timestamp,
            price: (ev.details.high as number) ?? 0,
            direction: 'short',
            action: 'signal',
            label: `RSI: ${ev.details.rsi14 != null ? (ev.details.rsi14 as number).toFixed(1) : '–'}`,
          });
        }
      }
      setLiveMarkers(markers);
      setLastStrategyRunTime(new Date().toLocaleTimeString('en-IN', { hour12: false }));
    };

    // Only run when candle count or RSI params change - not on every tick (rawCandles.length in deps)
    const debounceMs = 2000;
    if (liveStrategyDebounceRef.current) clearTimeout(liveStrategyDebounceRef.current);
    liveStrategyDebounceRef.current = setTimeout(() => {
      runStrategy();
      liveStrategyDebounceRef.current = null;
    }, debounceMs);

    return () => {
      if (liveStrategyDebounceRef.current) clearTimeout(liveStrategyDebounceRef.current);
    };
  }, [activeTab, selectedDate, rawCandles.length, liveRsiOverbought, liveRsiOversold]);

  // ---------- Live orders/positions polling ----------
  useEffect(() => {
    if (activeTab !== 'live' || selectedDate !== todayStr()) return;

    const fetchOrders = async () => {
      try {
        const res = await fetch(apiUrl('/api/zerodha/orders?tag=mountain_signal'), { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'success' && Array.isArray(data.orders)) setZerodhaOrders(data.orders);
      } catch (e) {
        console.error('Failed to fetch Zerodha orders:', e);
      }
    };

    const fetchPositions = async () => {
      try {
        const res = await fetch(apiUrl('/api/zerodha/positions'), { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'success' && Array.isArray(data.positions)) setZerodhaPositions(data.positions);
      } catch (e) {
        console.error('Failed to fetch Zerodha positions:', e);
      }
    };

    fetchOrders();
    fetchPositions();
    const interval = setInterval(() => {
      fetchOrders();
      fetchPositions();
    }, 15000);
    return () => clearInterval(interval);
  }, [activeTab, selectedDate]);

  // ---------- Auto-trade status (when Live tab active) ----------
  useEffect(() => {
    if (activeTab !== 'live' || selectedDate !== todayStr()) return;
    const fetchStatus = async () => {
      try {
        const res = await fetch(apiUrl('/api/mountain_signal/live/auto_trade_status'), { credentials: 'include' });
        const data = await res.json();
        if (data.status === 'success' && data.active) {
          setAutoTradeActiveOnServer(true);
          setAutoPlaceOrders(true);
          setAutoTradeLockedRsi(
            data.rsiOverbought != null && data.rsiOversold != null
              ? { ob: data.rsiOverbought, os: data.rsiOversold }
              : null
          );
        } else {
          setAutoTradeActiveOnServer(false);
          setAutoPlaceOrders(false);
          setAutoTradeLockedRsi(null);
        }
      } catch {
        setAutoTradeActiveOnServer(false);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [activeTab, selectedDate]);

  // ---------- Live socket ticks ----------
  useEffect(() => {
    if (!isToday) { setIsLiveStreaming(false); return; }

    const onConnect = () => setIsLiveStreaming(true);
    const onDisconnect = () => setIsLiveStreaming(false);
    const onMarketData = (msg: any) => {
      const msgToken = msg.instrument_token;
      const lastPrice = msg.last_price;
      if (msgToken !== instrumentToken || lastPrice == null) return;

      const tickTime = msg.timestamp ? new Date(msg.timestamp) : new Date();
      const slotStart = floorToInterval(tickTime, timeframeMinutes);
      const slotKey = slotStart.toISOString();

      setRawCandles((prev) => {
        const updated = [...prev];
        const existingIdx = updated.findIndex((c) => {
          const candleSlot = floorToInterval(new Date(c.time), timeframeMinutes);
          return candleSlot.toISOString() === slotKey;
        });
        if (existingIdx >= 0) {
          const existing = { ...updated[existingIdx] };
          existing.high = Math.max(existing.high, lastPrice);
          existing.low = Math.min(existing.low, lastPrice);
          existing.close = lastPrice;
          existing.indexClose = lastPrice;
          updated[existingIdx] = existing;
        } else {
          updated.push({
            time: slotStart.toISOString(), open: lastPrice, high: lastPrice, low: lastPrice,
            close: lastPrice, volume: 0, indexClose: lastPrice, ema5: null,
          });
        }
        return computeEma5(updated);
      });
    };

    if (socket.connected) setIsLiveStreaming(true);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('market_data', onMarketData);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('market_data', onMarketData);
      setIsLiveStreaming(false);
    };
  }, [isToday, instrumentToken, timeframeMinutes, socket]);

  // ---------- Backtest runner ----------
  const runBacktest = useCallback(async () => {
    setBtLoading(true);
    setBtError(null);
    setBtCandles([]);
    setBtMarkers([]);
    setBtEquity([]);
    setBtSummary(null);
    setBtTrades([]);
    setBtEvents([]);
    setBtRsi([]);
    setBtAdx([]);

    try {
      // Fetch extra warmup days so RSI(14) is available from the first candle
      const warmupFromDate = btStrategy === 'mountain'
        ? (() => { const d = new Date(btFromDate); d.setDate(d.getDate() - 3); return d.toISOString().split('T')[0]; })()
        : btFromDate;

      const resp = await fetch(apiUrl('/api/backtest/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          index: selectedIndex,
          from_date: warmupFromDate,
          to_date: btToDate,
          interval: kiteInterval,
          strategy: 'ema_crossover',
          ema_fast: btEmaFast,
          ema_slow: btEmaSlow,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        setBtError(data.message || 'Backtest failed');
        return;
      }

      const allCandles: PlotlyCandlePoint[] = (data.candles || []).map((c: any) => ({
        time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close,
        volume: c.volume ?? 0, indexClose: c.close, ema5: null,
      }));

      if (btStrategy === 'mountain') {
        const result = runMountainBacktest(allCandles, {
          rsiOverbought: btRsiOverbought,
          rsiOversold: btRsiOversold,
        });

        // Find first candle index on or after the actual from_date to trim warmup data
        const fromDateMs = new Date(btFromDate + 'T00:00:00').getTime();
        const trimIdx = allCandles.findIndex((c) => {
          const t = typeof c.time === 'string' ? new Date(c.time).getTime() : (c.time as Date).getTime();
          return t >= fromDateMs;
        });
        const startIdx = trimIdx >= 0 ? trimIdx : 0;

        const candles = allCandles.slice(startIdx);
        const trimmedEma5 = result.indicators.ema5.slice(startIdx);
        const trimmedRsi14 = result.indicators.rsi14.slice(startIdx);
        const trimmedAdx14 = result.indicators.adx14.slice(startIdx);

        const withEma = candles.map((c, idx) => ({
          ...c,
          ema5: trimmedEma5[idx] ?? null,
        }));
        setBtCandles(withEma);
        setBtRsi(trimmedRsi14);
        setBtAdx(trimmedAdx14);

        // Filter trades/events to only those within the display range
        const displayFrom = candles.length > 0 ? (typeof candles[0].time === 'string' ? candles[0].time : (candles[0].time as Date).toISOString()) : '';
        const filteredTrades = result.trades.filter((t) => t.entryTime >= displayFrom);
        const filteredEvents = result.events.filter((e) => e.timestamp >= displayFrom);

        const markers: TradeMarker[] = [];
        for (const t of filteredTrades) {
          markers.push({ time: t.entryTime, price: t.entryPrice, direction: 'short', action: 'entry' });
          markers.push({
            time: t.exitTime, price: t.exitPrice, direction: 'short', action: 'exit',
            label: `${t.exitReason} | P&L: ${t.pnl > 0 ? '+' : ''}${t.pnl.toFixed(2)}`,
          });
        }

        // Highlight signal candles (SIGNAL_IDENTIFIED and SIGNAL_RESET)
        for (const ev of filteredEvents) {
          if (ev.type === MountainEventType.SIGNAL_IDENTIFIED || ev.type === MountainEventType.SIGNAL_RESET) {
            markers.push({
              time: ev.timestamp,
              price: (ev.details.high as number) ?? 0,
              direction: 'short',
              action: 'signal',
              label: `RSI: ${ev.details.rsi14 != null ? (ev.details.rsi14 as number).toFixed(1) : '–'}`,
            });
          }
        }
        setBtMarkers(markers);

        // Rebuild equity curve from filtered trades only
        const trimmedEquity = result.equityCurve.filter((e) => e.timestamp >= displayFrom);
        setBtEquity(trimmedEquity);
        setBtSummary(result.summary);
        setBtTrades(filteredTrades.map((t) => ({
          entry_time: t.entryTime,
          entry_price: t.entryPrice,
          exit_time: t.exitTime,
          exit_price: t.exitPrice,
          direction: 'short' as const,
          pnl: t.pnl,
          exit_reason: t.exitReason,
        })));
        setBtEvents(filteredEvents);
      } else {
        const candles = allCandles;
        // EMA crossover – use backend results as before
        setBtCandles(computeEma5(candles));

        const markers: TradeMarker[] = [];
        for (const t of data.trades || []) {
          markers.push({ time: t.entry_time, price: t.entry_price, direction: t.direction, action: 'entry' });
          markers.push({
            time: t.exit_time, price: t.exit_price, direction: t.direction, action: 'exit',
            label: `P&L: ${t.pnl > 0 ? '+' : ''}${t.pnl.toFixed(2)}`,
          });
        }
        setBtMarkers(markers);
        setBtEquity(data.equity_curve || []);
        setBtSummary(data.summary || null);
        setBtTrades(data.trades || []);
        setBtEvents([]);
      }
    } catch (e: any) {
      setBtError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setBtLoading(false);
    }
  }, [selectedIndex, btFromDate, btToDate, kiteInterval, btStrategy, btEmaFast, btEmaSlow, btRsiOverbought, btRsiOversold]);

  const chartData = useMemo(() => {
    if (activeTab !== 'live' || selectedDate !== todayStr() || rawCandles.length === 0) return rawCandles;
    const todayPrefix = todayStr();
    return rawCandles.filter((c) => {
      const t = typeof c.time === 'string' ? c.time : (c.time as Date).toISOString();
      return t.startsWith(todayPrefix);
    });
  }, [activeTab, selectedDate, rawCandles]);

  const todayPrefix = todayStr();
  const liveRsiDisplay = useMemo(() => {
    if (activeTab !== 'live' || selectedDate !== todayPrefix || rawCandles.length === 0 || liveRsi.length === 0)
      return liveRsi;
    const indices: number[] = [];
    rawCandles.forEach((c, i) => {
      const t = typeof c.time === 'string' ? c.time : (c.time as Date).toISOString();
      if (t.startsWith(todayPrefix)) indices.push(i);
    });
    return indices.map((i) => liveRsi[i] ?? null);
  }, [activeTab, selectedDate, rawCandles, liveRsi, todayPrefix]);

  const liveAdxDisplay = useMemo(() => {
    if (activeTab !== 'live' || selectedDate !== todayPrefix || rawCandles.length === 0 || liveAdx.length === 0)
      return liveAdx;
    const indices: number[] = [];
    rawCandles.forEach((c, i) => {
      const t = typeof c.time === 'string' ? c.time : (c.time as Date).toISOString();
      if (t.startsWith(todayPrefix)) indices.push(i);
    });
    return indices.map((i) => liveAdx[i] ?? null);
  }, [activeTab, selectedDate, rawCandles, liveAdx, todayPrefix]);

  const liveMarkersDisplay = useMemo(() => {
    if (activeTab !== 'live' || selectedDate !== todayPrefix) return liveMarkers;
    return liveMarkers.filter((m) => {
      const t = typeof m.time === 'string' ? m.time : (m.time as Date).toISOString();
      return t.startsWith(todayPrefix);
    });
  }, [activeTab, selectedDate, liveMarkers, todayPrefix]);

  const liveTradesDisplay = useMemo(() => {
    if (activeTab !== 'live' || selectedDate !== todayPrefix) return liveTrades;
    return liveTrades.filter((t) => t.entry_time.startsWith(todayPrefix));
  }, [activeTab, selectedDate, liveTrades, todayPrefix]);

  const liveEventsDisplayLast5 = useMemo(() => {
    if (activeTab !== 'live' || selectedDate !== todayPrefix) return liveEvents;
    const todayEvents = liveEvents.filter((e) => e.timestamp.startsWith(todayPrefix));
    return todayEvents.slice(-5);
  }, [activeTab, selectedDate, liveEvents, todayPrefix]);

  const filteredEvents = useMemo(() => {
    if (eventFilter === 'ALL') return btEvents;
    if (eventFilter === 'EXITS') {
      return btEvents.filter((e) =>
        e.type === MountainEventType.EXIT_INDEX_STOP ||
        e.type === MountainEventType.EXIT_INDEX_TARGET ||
        e.type === MountainEventType.EXIT_MARKET_CLOSE
      );
    }
    return btEvents.filter((e) => e.type === eventFilter);
  }, [btEvents, eventFilter]);

  const statusBanner = useMemo(() => {
    if (isToday && isLiveStreaming)
      return { text: 'Live - streaming real-time ticks from Zerodha', cls: 'alert-success' };
    if (isToday && !isLiveStreaming)
      return { text: "Today's candles loaded from Zerodha. Connecting for live ticks...", cls: 'alert-info' };
    return { text: `Historical data from Zerodha for ${selectedDate}`, cls: 'alert-secondary' };
  }, [isToday, isLiveStreaming, selectedDate]);

  return (
    <div className="container-fluid py-4">
      <div className="card shadow-sm border-0 mb-4">
        <div className="card-header bg-dark text-white">
          <h4 className="card-title mb-0">
            <i className="bi bi-bar-chart-line-fill me-2"></i>
            Advanced Charts (Plotly + Kite)
          </h4>
          <small className="text-white-50">
            Index-only candlestick charts fetched directly from Zerodha Kite API.
          </small>
        </div>
        <div className="card-body">
          {/* Tabs */}
          <ul className="nav nav-tabs mb-3" role="tablist">
            <li className="nav-item" role="presentation">
              <button type="button" className={`nav-link ${activeTab === 'live' ? 'active' : ''}`}
                onClick={() => setActiveTab('live')}>
                <i className="bi bi-broadcast-pin me-2" />Live Trading View
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button type="button" className={`nav-link ${activeTab === 'backtest' ? 'active' : ''}`}
                onClick={() => setActiveTab('backtest')}>
                <i className="bi bi-clipboard-data me-2" />Backtesting View
              </button>
            </li>
          </ul>

          {/* ============ LIVE TAB ============ */}
          {activeTab === 'live' && (
            <div>
              <div className={`alert ${statusBanner.cls} py-2 small mb-3`}>
                <i className={`bi ${isToday && isLiveStreaming ? 'bi-broadcast' : 'bi-clock-history'} me-2`}></i>
                {statusBanner.text}
                {chartData.length > 0 && <span className="ms-2 fw-bold">| {chartData.length} candles loaded</span>}
              </div>

              <div className="row g-3 mb-3 align-items-end">
                <div className="col-md-3">
                  <label className="form-label fw-bold">Index</label>
                  <select className="form-select" value={selectedIndex}
                    onChange={(e) => setSelectedIndex(e.target.value === 'NIFTY' ? 'NIFTY' : 'BANKNIFTY')}>
                    <option value="BANKNIFTY">BANKNIFTY</option>
                    <option value="NIFTY">NIFTY 50</option>
                  </select>
                </div>
                <div className="col-md-3">
                  <label className="form-label fw-bold">Timeframe</label>
                  <select className="form-select" value={timeframeMinutes}
                    onChange={(e) => setTimeframeMinutes(Number(e.target.value) || 5)}>
                    <option value={1}>1 min</option>
                    <option value={5}>5 min (default)</option>
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                  </select>
                </div>
                <div className="col-md-3">
                  <label className="form-label fw-bold">Trading Date</label>
                  <input type="date" className="form-control" value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)} max={todayStr()} />
                </div>
                <div className="col-md-3">
                  <label className="form-label fw-bold">Indicators</label>
                  <div className="d-flex flex-wrap gap-2">
                    <div className="form-check form-check-inline">
                      <input id="adv-ema" className="form-check-input" type="checkbox" checked={showEma}
                        onChange={(e) => setShowEma(e.target.checked)} />
                      <label className="form-check-label" htmlFor="adv-ema">EMA 5</label>
                    </div>
                    <div className="form-check form-check-inline">
                      <input id="adv-volume" className="form-check-input" type="checkbox" checked={showVolume}
                        onChange={(e) => setShowVolume(e.target.checked)} />
                      <label className="form-check-label" htmlFor="adv-volume">Volume</label>
                    </div>
                  </div>
                </div>
              </div>

              {isToday && (
                <div className="row g-3 mb-3 align-items-end">
                  <div className="col-md-1">
                    <label className="form-label fw-bold">RSI OB</label>
                    <input type="number" className="form-control" value={liveRsiOverbought} min={50} max={90}
                      onChange={(e) => setLiveRsiOverbought(Number(e.target.value) || 70)} />
                  </div>
                  <div className="col-md-1">
                    <label className="form-label fw-bold">RSI OS</label>
                    <input type="number" className="form-control" value={liveRsiOversold} min={10} max={50}
                      onChange={(e) => setLiveRsiOversold(Number(e.target.value) || 30)} />
                  </div>
                  <div className="col-md-2 d-flex align-items-end">
                    <span className="text-muted small">
                      {lastStrategyRunTime ? `Last signal run: ${lastStrategyRunTime}` : 'Strategy will run on candle update'}
                    </span>
                  </div>
                  {autoTradeActiveOnServer && (
                    <div className="col-12">
                      <span className="text-muted small">
                        RSI changes only affect chart display. Stop and restart auto-trade to apply new parameters.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {error && <div className="alert alert-danger py-2 small mb-2">{error}</div>}
              {warning && !error && <div className="alert alert-warning py-2 small mb-2">{warning}</div>}
              {loading && (
                <div className="text-center text-muted small mb-2">
                  <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                  Fetching candles from Zerodha...
                </div>
              )}

              <PlotlyCandlestickChart
                data={chartData}
                title={`${selectedIndex} – ${kiteInterval} candles${isToday ? ' (Live)' : ''}`}
                height={520}
                showIndexLine={false}
                showEma={showEma}
                showVolume={showVolume}
                showRsi={isToday && liveRsiDisplay.length > 0}
                rsiData={liveRsiDisplay}
                rsiOverbought={liveRsiOverbought}
                rsiOversold={liveRsiOversold}
                adxData={liveAdxDisplay}
                indexLabel={`${selectedIndex} Close`}
                markers={isToday ? liveMarkersDisplay : undefined}
              />

              {isToday && (
                <div className="row mt-3">
                  <div className="col-lg-6">
                    {liveTradesDisplay.length > 0 && (
                      <div className="mb-3">
                        <h6 className="fw-bold">Trade Log</h6>
                        <div className="table-responsive" style={{ maxHeight: 200 }}>
                          <table className="table table-sm table-striped table-hover mb-0">
                            <thead className="table-dark">
                              <tr>
                                <th>#</th>
                                <th>Entry Time</th>
                                <th>Entry Price</th>
                                <th>Exit Time</th>
                                <th>Exit Price</th>
                                <th>Exit Reason</th>
                                <th>P&L</th>
                              </tr>
                            </thead>
                            <tbody>
                              {liveTradesDisplay.map((t, idx) => (
                                <tr key={idx}>
                                  <td>{idx + 1}</td>
                                  <td className="small">{new Date(t.entry_time).toLocaleString()}</td>
                                  <td>{t.entry_price.toFixed(2)}</td>
                                  <td className="small">{new Date(t.exit_time).toLocaleString()}</td>
                                  <td>{t.exit_price.toFixed(2)}</td>
                                  <td>
                                    <span className={`badge ${
                                      t.exit_reason === 'INDEX_STOP' ? 'bg-danger' :
                                      t.exit_reason === 'INDEX_TARGET' ? 'bg-success' :
                                      'bg-secondary'
                                    }`}>
                                      {t.exit_reason}
                                    </span>
                                  </td>
                                  <td className={`fw-bold ${t.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                    {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="col-lg-6">
                    {liveEventsDisplayLast5.length > 0 && (
                      <div className="mb-3">
                        <h6 className="fw-bold">Strategy Event Log (last 5)</h6>
                        <div className="table-responsive" style={{ maxHeight: 200 }}>
                          <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.8rem' }}>
                            <thead className="table-dark">
                              <tr>
                                <th>Event</th>
                                <th>Time</th>
                                <th>Message</th>
                                <th>EMA5</th>
                                <th>RSI14</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...liveEventsDisplayLast5].reverse().map((ev, idx) => (
                                <tr key={idx}>
                                  <td><span className={`badge ${eventBadgeClass(ev.type)}`}>{eventLabel(ev.type)}</span></td>
                                  <td className="text-nowrap">{new Date(ev.timestamp).toLocaleString()}</td>
                                  <td>{ev.message}</td>
                                  <td>{ev.details.ema5 != null ? (ev.details.ema5 as number).toFixed(2) : '–'}</td>
                                  <td>{ev.details.rsi14 != null ? (ev.details.rsi14 as number).toFixed(1) : '–'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {isToday && (
                <>
                  <div className="row mt-3 align-items-center">
                    <div className="col-auto">
                      <label className="form-label fw-bold small mb-1">Lots</label>
                      <input type="number" className="form-control form-control-sm" style={{ width: 70 }}
                        value={liveLots} min={1} max={10}
                        onChange={(e) => setLiveLots(Math.max(1, Number(e.target.value) || 1))} />
                    </div>
                    <div className="col-auto d-flex align-items-end">
                      <div className="form-check form-switch mb-2">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="autoTradeToggle"
                          checked={autoPlaceOrders}
                          disabled={autoTradeLoading}
                          onChange={async (e) => {
                            const enabled = e.target.checked;
                            setAutoTradeLoading(true);
                            setLiveTradeMessage(null);
                            try {
                              const url = apiUrl(enabled ? '/api/mountain_signal/live/start_auto_trade' : '/api/mountain_signal/live/stop_auto_trade');
                              const res = await fetch(url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify(enabled ? {
                                  instrument: selectedIndex,
                                  lots: liveLots,
                                  rsiOverbought: liveRsiOverbought,
                                  rsiOversold: liveRsiOversold,
                                } : {}),
                              });
                              const data = await res.json();
                              if (res.status === 401 || data.authExpired) {
                                setLiveTradeMessage({ text: 'Session expired. Please log in again.', type: 'error' });
                              } else if (data.status === 'success') {
                                setAutoPlaceOrders(enabled);
                                setAutoTradeActiveOnServer(enabled);
                                if (enabled && data.rsiOverbought != null && data.rsiOversold != null) {
                                  setAutoTradeLockedRsi({ ob: data.rsiOverbought, os: data.rsiOversold });
                                } else if (!enabled) {
                                  setAutoTradeLockedRsi(null);
                                }
                                setLiveTradeMessage({ text: data.message || (enabled ? 'Auto-trade started.' : 'Auto-trade stopped.'), type: 'success' });
                              } else {
                                setLiveTradeMessage({ text: data.message || 'Request failed.', type: 'error' });
                                if (enabled) setAutoPlaceOrders(false);
                              }
                            } catch (err) {
                              setLiveTradeMessage({ text: (err as Error).message || 'Request failed.', type: 'error' });
                              if (enabled) setAutoPlaceOrders(false);
                            } finally {
                              setAutoTradeLoading(false);
                            }
                          }}
                        />
                        <label className="form-check-label small" htmlFor="autoTradeToggle">
                          Auto-trade (runs on server – continues when you switch away)
                        </label>
                      </div>
                      {autoTradeActiveOnServer && (
                        <span className="badge bg-success ms-2 mb-2">
                          Active{autoTradeLockedRsi ? ` (RSI OB: ${autoTradeLockedRsi.ob}, OS: ${autoTradeLockedRsi.os})` : ''}
                        </span>
                      )}
                    </div>
                    <div className="col-auto">
                      <button
                        type="button"
                        className="btn btn-sm btn-success"
                        disabled={entryExitLoading.entry || chartData.length === 0}
                        onClick={async () => {
                          const indexLtp = chartData.length > 0 ? (chartData[chartData.length - 1]?.close ?? 0) : 0;
                          if (!indexLtp) {
                            setLiveTradeMessage({ text: 'No chart data. Load today\'s chart first.', type: 'error' });
                            return;
                          }
                          setEntryExitLoading((p) => ({ ...p, entry: true }));
                          setLiveTradeMessage(null);
                          try {
                            const previewRes = await fetch(apiUrl('/api/mountain_signal/live/order_preview'), {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              credentials: 'include',
                              body: JSON.stringify({
                                instrument: selectedIndex,
                                optionType: 'PE',
                                indexLtp,
                                lots: liveLots,
                              }),
                            });
                            const previewData = await previewRes.json();
                            if (previewRes.status === 401 || previewData.authExpired) {
                              setLiveTradeMessage({ text: 'Session expired. Please log in again.', type: 'error' });
                            } else if (previewData.status === 'success') {
                              setEntryPreview({
                                tradingsymbol: previewData.tradingsymbol,
                                quantity: previewData.quantity,
                                instrument: previewData.instrument,
                                optionType: previewData.optionType,
                                lots: previewData.lots,
                                indexLtp,
                              });
                              setShowEntryConfirm(true);
                            } else {
                              setLiveTradeMessage({ text: previewData.message || 'Preview failed.', type: 'error' });
                            }
                          } catch (e) {
                            setLiveTradeMessage({ text: (e as Error).message || 'Request failed.', type: 'error' });
                          } finally {
                            setEntryExitLoading((p) => ({ ...p, entry: false }));
                          }
                        }}
                      >
                        {entryExitLoading.entry ? 'Loading...' : 'Entry (ATM PE)'}
                      </button>
                    </div>
                    <div className="col-auto">
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={entryExitLoading.exit}
                        onClick={async () => {
                          setEntryExitLoading((p) => ({ ...p, exit: true }));
                          setLiveTradeMessage(null);
                          try {
                            const posRes = await fetch(apiUrl('/api/zerodha/positions'), { credentials: 'include' });
                            const posData = await posRes.json();
                            if (posRes.status === 401 || posData.authExpired) {
                              setLiveTradeMessage({ text: 'Session expired. Please log in again.', type: 'error' });
                            } else if (posData.status === 'success' && Array.isArray(posData.positions)) {
                              const withQty = posData.positions.filter((p: { quantity?: number }) => p.quantity != null && Number(p.quantity) !== 0);
                              setPositionsForConfirm(withQty.map((p: { tradingsymbol?: string; quantity?: number; product?: string; exchange?: string }) => ({
                                tradingsymbol: p.tradingsymbol || '',
                                quantity: Math.abs(Number(p.quantity)),
                                product: p.product,
                                exchange: p.exchange,
                              })));
                              setShowExitConfirm(true);
                            } else {
                              setLiveTradeMessage({ text: posData.message || 'Failed to fetch positions.', type: 'error' });
                            }
                          } catch (e) {
                            setLiveTradeMessage({ text: (e as Error).message || 'Request failed.', type: 'error' });
                          } finally {
                            setEntryExitLoading((p) => ({ ...p, exit: false }));
                          }
                        }}
                      >
                        {entryExitLoading.exit ? 'Loading...' : 'Exit (Square Off All)'}
                      </button>
                    </div>
                  </div>

                  {liveTradeMessage && (
                    <div className={`alert alert-${liveTradeMessage.type} py-2 mt-2 mb-2`} role="alert">
                      <i className={`bi ${liveTradeMessage.type === 'success' ? 'bi-check-circle' : liveTradeMessage.type === 'error' ? 'bi-exclamation-triangle' : 'bi-info-circle'} me-2`}></i>
                      {liveTradeMessage.text}
                    </div>
                  )}

                  <div className="row mt-3">
                    <div className="col-lg-6">
                      <div className="card border-0 shadow-sm mb-3">
                        <div className="card-header bg-dark text-white">
                          <h6 className="mb-0"><i className="bi bi-list-ul me-2"></i>Zerodha Orders</h6>
                        </div>
                        <div className="card-body p-0">
                          {zerodhaOrders.length === 0 ? (
                            <div className="p-3 text-muted small">No orders (tag: mountain_signal). Place an order to see it here.</div>
                          ) : (
                            <div className="table-responsive">
                              <table className="table table-sm table-hover mb-0">
                                <thead className="table-light">
                                  <tr>
                                    <th>Order ID</th>
                                    <th>Symbol</th>
                                    <th>Type</th>
                                    <th>Qty</th>
                                    <th>Status</th>
                                    <th>Avg Price</th>
                                    <th>Time</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {zerodhaOrders.map((o, idx) => (
                                    <tr key={(o.order_id as string) || idx}>
                                      <td className="small">{o.order_id}</td>
                                      <td><code>{o.tradingsymbol}</code></td>
                                      <td>{o.transaction_type} {o.product}</td>
                                      <td>{o.quantity} / {o.filled_quantity ?? 0}</td>
                                      <td><span className={`badge ${o.status === 'COMPLETE' ? 'bg-success' : o.status === 'REJECTED' ? 'bg-danger' : 'bg-secondary'}`}>{o.status}</span></td>
                                      <td>{o.average_price != null ? Number(o.average_price).toFixed(2) : '–'}</td>
                                      <td className="small">{o.order_timestamp ? new Date(o.order_timestamp).toLocaleString() : '–'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="col-lg-6">
                      <div className="card border-0 shadow-sm mb-3">
                        <div className="card-header bg-dark text-white">
                          <h6 className="mb-0"><i className="bi bi-briefcase me-2"></i>Zerodha Positions</h6>
                        </div>
                        <div className="card-body p-0">
                          {zerodhaPositions.length === 0 ? (
                            <div className="p-3 text-muted small">No open positions.</div>
                          ) : (
                            <div className="table-responsive">
                              <table className="table table-sm table-hover mb-0">
                                <thead className="table-light">
                                  <tr>
                                    <th>Symbol</th>
                                    <th>Qty</th>
                                    <th>Buy Price</th>
                                    <th>LTP</th>
                                    <th>P&L</th>
                                    <th>Product</th>
                                    <th>Exchange</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {zerodhaPositions.filter((p: { quantity?: number }) => p.quantity != null && Number(p.quantity) !== 0).map((p, idx) => (
                                    <tr key={(p.tradingsymbol as string) || idx}>
                                      <td><code>{p.tradingsymbol}</code></td>
                                      <td>{p.quantity}</td>
                                      <td>{p.buy_price != null ? Number(p.buy_price).toFixed(2) : '–'}</td>
                                      <td>{p.last_price != null ? Number(p.last_price).toFixed(2) : '–'}</td>
                                      <td className={p.pnl != null ? (Number(p.pnl) >= 0 ? 'text-success' : 'text-danger') : ''}>
                                        {p.pnl != null ? (Number(p.pnl) >= 0 ? '+' : '') + Number(p.pnl).toFixed(2) : '–'}
                                      </td>
                                      <td>{p.product ?? '–'}</td>
                                      <td>{p.exchange ?? '–'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {showEntryConfirm && entryPreview && (
                    <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex={-1}>
                      <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content">
                          <div className="modal-header">
                            <h5 className="modal-title">Confirm Entry Order</h5>
                            <button type="button" className="btn-close" aria-label="Close" onClick={() => { setShowEntryConfirm(false); setEntryPreview(null); }}></button>
                          </div>
                          <div className="modal-body">
                            <p className="mb-2">You are about to place the following order:</p>
                            <ul className="list-unstyled mb-0">
                              <li><strong>Contract:</strong> {entryPreview.tradingsymbol}</li>
                              <li><strong>Type:</strong> BUY {entryPreview.optionType}</li>
                              <li><strong>Quantity:</strong> {entryPreview.quantity} ({entryPreview.lots} lot(s))</li>
                              <li><strong>Order type:</strong> Market</li>
                              <li><strong>Instrument:</strong> {entryPreview.instrument}</li>
                            </ul>
                          </div>
                          <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" onClick={() => { setShowEntryConfirm(false); setEntryPreview(null); }}>Cancel</button>
                            <button
                              type="button"
                              className="btn btn-success"
                              onClick={async () => {
                                setEntryExitLoading((p) => ({ ...p, entry: true }));
                                setLiveTradeMessage(null);
                                try {
                                  const res = await fetch(apiUrl('/api/mountain_signal/live/place_order'), {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    credentials: 'include',
                                    body: JSON.stringify({
                                      instrument: entryPreview.instrument,
                                      optionType: entryPreview.optionType,
                                      transactionType: 'BUY',
                                      indexLtp: entryPreview.indexLtp,
                                      lots: entryPreview.lots,
                                    }),
                                  });
                                  const data = await res.json();
                                  setShowEntryConfirm(false);
                                  setEntryPreview(null);
                                  if (res.status === 401 || data.authExpired) {
                                    setLiveTradeMessage({ text: 'Session expired. Please log in again.', type: 'error' });
                                  } else if (data.status === 'success') {
                                    setLiveTradeMessage({ text: data.message || `Order ${data.order_id} placed.`, type: 'success' });
                                    const ordRes = await fetch(apiUrl('/api/zerodha/orders?tag=mountain_signal'), { credentials: 'include' });
                                    if (ordRes.ok) {
                                      const ordData = await ordRes.json();
                                      if (ordData.status === 'success' && Array.isArray(ordData.orders)) setZerodhaOrders(ordData.orders);
                                    }
                                  } else {
                                    setLiveTradeMessage({ text: data.message || 'Order failed.', type: 'error' });
                                  }
                                } catch (e) {
                                  setLiveTradeMessage({ text: (e as Error).message || 'Request failed.', type: 'error' });
                                } finally {
                                  setEntryExitLoading((p) => ({ ...p, entry: false }));
                                }
                              }}
                            >
                              Confirm
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {showExitConfirm && (
                    <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex={-1}>
                      <div className="modal-dialog modal-dialog-centered">
                        <div className="modal-content">
                          <div className="modal-header">
                            <h5 className="modal-title">Confirm Square Off</h5>
                            <button type="button" className="btn-close" aria-label="Close" onClick={() => { setShowExitConfirm(false); setPositionsForConfirm([]); }}></button>
                          </div>
                          <div className="modal-body">
                            {positionsForConfirm.length === 0 ? (
                              <p className="mb-0">You have no open positions to square off.</p>
                            ) : (
                              <>
                                <p className="mb-2">The following position(s) will be closed:</p>
                                <div className="table-responsive">
                                  <table className="table table-sm mb-0">
                                    <thead><tr><th>Symbol</th><th>Qty</th><th>Product</th><th>Exchange</th></tr></thead>
                                    <tbody>
                                      {positionsForConfirm.map((p, i) => (
                                        <tr key={i}>
                                          <td><code>{p.tradingsymbol}</code></td>
                                          <td>{p.quantity}</td>
                                          <td>{p.product ?? '-'}</td>
                                          <td>{p.exchange ?? '-'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            )}
                          </div>
                          <div className="modal-footer">
                            <button type="button" className="btn btn-secondary" onClick={() => { setShowExitConfirm(false); setPositionsForConfirm([]); }}>{positionsForConfirm.length === 0 ? 'Close' : 'Cancel'}</button>
                            {positionsForConfirm.length > 0 && (
                              <button
                                type="button"
                                className="btn btn-danger"
                                onClick={async () => {
                                  setEntryExitLoading((p) => ({ ...p, exit: true }));
                                  setLiveTradeMessage(null);
                                  try {
                                    const res = await fetch(apiUrl('/api/mountain_signal/live/square_off_all'), {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      credentials: 'include',
                                      body: JSON.stringify({}),
                                    });
                                    const data = await res.json();
                                    setShowExitConfirm(false);
                                    setPositionsForConfirm([]);
                                    if (res.status === 401 || data.authExpired) {
                                      setLiveTradeMessage({ text: 'Session expired. Please log in again.', type: 'error' });
                                    } else if (data.status === 'success') {
                                      const msg = (data.results?.length ? `Squared off ${data.results.length} position(s).` : 'Square-off completed.');
                                      setLiveTradeMessage({ text: msg, type: 'success' });
                                      const ordRes = await fetch(apiUrl('/api/zerodha/orders?tag=mountain_signal'), { credentials: 'include' });
                                      if (ordRes.ok) {
                                        const ordData = await ordRes.json();
                                        if (ordData.status === 'success' && Array.isArray(ordData.orders)) setZerodhaOrders(ordData.orders);
                                      }
                                      const posRes = await fetch(apiUrl('/api/zerodha/positions'), { credentials: 'include' });
                                      if (posRes.ok) {
                                        const posData = await posRes.json();
                                        if (posData.status === 'success' && Array.isArray(posData.positions)) setZerodhaPositions(posData.positions);
                                      }
                                    } else {
                                      setLiveTradeMessage({ text: data.message || 'Square-off failed.', type: 'error' });
                                    }
                                  } catch (e) {
                                    setLiveTradeMessage({ text: (e as Error).message || 'Request failed.', type: 'error' });
                                  } finally {
                                    setEntryExitLoading((p) => ({ ...p, exit: false }));
                                  }
                                }}
                              >
                                Confirm
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ============ BACKTEST TAB ============ */}
          {activeTab === 'backtest' && (
            <div>
              {/* Controls row */}
              <div className="row g-3 mb-3 align-items-end">
                <div className="col-md-2">
                  <label className="form-label fw-bold">Strategy</label>
                  <select className="form-select" value={btStrategy}
                    onChange={(e) => setBtStrategy(e.target.value as BtStrategy)}>
                    <option value="mountain">Mountain Strategy</option>
                    <option value="ema_crossover">EMA Crossover</option>
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label fw-bold">Index</label>
                  <select className="form-select" value={selectedIndex}
                    onChange={(e) => setSelectedIndex(e.target.value === 'NIFTY' ? 'NIFTY' : 'BANKNIFTY')}>
                    <option value="BANKNIFTY">BANKNIFTY</option>
                    <option value="NIFTY">NIFTY 50</option>
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label fw-bold">From Date</label>
                  <input type="date" className="form-control" value={btFromDate}
                    onChange={(e) => setBtFromDate(e.target.value)} max={todayStr()} />
                </div>
                <div className="col-md-2">
                  <label className="form-label fw-bold">To Date</label>
                  <input type="date" className="form-control" value={btToDate}
                    onChange={(e) => setBtToDate(e.target.value)} max={todayStr()} />
                </div>
                {btStrategy === 'ema_crossover' && (
                  <>
                    <div className="col-md-1">
                      <label className="form-label fw-bold">Fast EMA</label>
                      <input type="number" className="form-control" value={btEmaFast} min={2} max={50}
                        onChange={(e) => setBtEmaFast(Number(e.target.value) || 5)} />
                    </div>
                    <div className="col-md-1">
                      <label className="form-label fw-bold">Slow EMA</label>
                      <input type="number" className="form-control" value={btEmaSlow} min={5} max={200}
                        onChange={(e) => setBtEmaSlow(Number(e.target.value) || 20)} />
                    </div>
                  </>
                )}
                {btStrategy === 'mountain' && (
                  <>
                    <div className="col-md-1">
                      <label className="form-label fw-bold">RSI OB</label>
                      <input type="number" className="form-control" value={btRsiOverbought} min={50} max={90}
                        onChange={(e) => setBtRsiOverbought(Number(e.target.value) || 70)} />
                    </div>
                    <div className="col-md-1">
                      <label className="form-label fw-bold">RSI OS</label>
                      <input type="number" className="form-control" value={btRsiOversold} min={10} max={50}
                        onChange={(e) => setBtRsiOversold(Number(e.target.value) || 30)} />
                    </div>
                  </>
                )}
                <div className="col-md-1">
                  <label className="form-label fw-bold">Timeframe</label>
                  <select className="form-select" value={timeframeMinutes}
                    onChange={(e) => setTimeframeMinutes(Number(e.target.value) || 5)}>
                    <option value={1}>1 min</option>
                    <option value={5}>5 min</option>
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                  </select>
                </div>
                <div className="col-md-2 d-grid">
                  <label className="form-label">&nbsp;</label>
                  <button className="btn btn-primary" onClick={runBacktest} disabled={btLoading}>
                    {btLoading ? (
                      <><span className="spinner-border spinner-border-sm me-2" role="status"></span>Running...</>
                    ) : (
                      <><i className="bi bi-play-fill me-1"></i>Run Backtest</>
                    )}
                  </button>
                </div>
              </div>

              {btError && <div className="alert alert-danger py-2 small mb-2">{btError}</div>}

              {/* Summary cards */}
              {btSummary && (
                <div className="row g-2 mb-3">
                  <div className="col">
                    <div className="card text-center border-0 bg-light">
                      <div className="card-body py-2">
                        <div className="text-muted small">Trades</div>
                        <div className="fw-bold">{btSummary.total_trades}</div>
                      </div>
                    </div>
                  </div>
                  <div className="col">
                    <div className="card text-center border-0 bg-light">
                      <div className="card-body py-2">
                        <div className="text-muted small">Win Rate</div>
                        <div className="fw-bold">{btSummary.win_rate}%</div>
                      </div>
                    </div>
                  </div>
                  <div className="col">
                    <div
                      className={`card text-center border-0 bg-light ${btTrades.length > 0 ? 'cursor-pointer' : ''}`}
                      style={btTrades.length > 0 ? { cursor: 'pointer' } : undefined}
                      onClick={btTrades.length > 0 ? () => setShowPnlDetailModal(true) : undefined}
                      role={btTrades.length > 0 ? 'button' : undefined}
                      tabIndex={btTrades.length > 0 ? 0 : undefined}
                      onKeyDown={btTrades.length > 0 ? (e) => e.key === 'Enter' && setShowPnlDetailModal(true) : undefined}
                    >
                      <div className="card-body py-2">
                        <div className="text-muted small">Total P&L</div>
                        <div className={`fw-bold ${btSummary.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                          {btSummary.total_pnl >= 0 ? '+' : ''}{btSummary.total_pnl.toFixed(2)}
                        </div>
                        {btTrades.length > 0 && <div className="text-muted small mt-1">Click for details</div>}
                      </div>
                    </div>
                  </div>
                  <div className="col">
                    <div className="card text-center border-0 bg-light">
                      <div className="card-body py-2">
                        <div className="text-muted small">Avg P&L</div>
                        <div className={`fw-bold ${btSummary.avg_pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                          {btSummary.avg_pnl >= 0 ? '+' : ''}{btSummary.avg_pnl.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="col">
                    <div className="card text-center border-0 bg-light">
                      <div className="card-body py-2">
                        <div className="text-muted small">Max Win</div>
                        <div className="fw-bold text-success">+{btSummary.max_win.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                  <div className="col">
                    <div className="card text-center border-0 bg-light">
                      <div className="card-body py-2">
                        <div className="text-muted small">Max Loss</div>
                        <div className="fw-bold text-danger">{btSummary.max_loss.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* P&L Trade Details Modal */}
              {showPnlDetailModal && btTrades.length > 0 && btSummary && (
                <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex={-1} onClick={() => setShowPnlDetailModal(false)}>
                  <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
                    <div className="modal-content">
                      <div className="modal-header">
                        <h5 className="modal-title">Trade Details</h5>
                        <div className="me-3">
                          <span className={`fw-bold ${btSummary.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                            Total P&L: {btSummary.total_pnl >= 0 ? '+' : ''}{btSummary.total_pnl.toFixed(2)}
                          </span>
                        </div>
                        <button type="button" className="btn-close" aria-label="Close" onClick={() => setShowPnlDetailModal(false)}></button>
                      </div>
                      <div className="modal-body">
                        {(() => {
                          const byDate = btTrades.reduce<Record<string, BacktestTrade[]>>((acc, t) => {
                            const d = new Date(t.entry_time).toLocaleDateString();
                            if (!acc[d]) acc[d] = [];
                            acc[d].push(t);
                            return acc;
                          }, {});
                          const dates = Object.keys(byDate).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
                          return (
                            <>
                              {dates.map((dateStr) => {
                                const trades = byDate[dateStr];
                                const dayPnl = trades.reduce((s, t) => s + t.pnl, 0);
                                return (
                                  <div key={dateStr} className="mb-4">
                                    <h6 className="fw-bold d-flex justify-content-between align-items-center">
                                      <span>{dateStr}</span>
                                      <span className={`${dayPnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                        Day P&L: {dayPnl >= 0 ? '+' : ''}{dayPnl.toFixed(2)}
                                      </span>
                                    </h6>
                                    <div className="table-responsive">
                                      <table className="table table-sm table-striped table-hover mb-0">
                                        <thead className="table-dark">
                                          <tr>
                                            <th>#</th>
                                            <th>Direction</th>
                                            <th>Entry Time</th>
                                            <th>Entry Price</th>
                                            <th>Exit Time</th>
                                            <th>Exit Price</th>
                                            {btStrategy === 'mountain' && <th>Exit Reason</th>}
                                            <th>P&L</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {trades.map((t, idx) => (
                                            <tr key={idx}>
                                              <td>{idx + 1}</td>
                                              <td>
                                                <span className={`badge ${t.direction === 'long' ? 'bg-success' : 'bg-danger'}`}>
                                                  {t.direction.toUpperCase()}
                                                </span>
                                              </td>
                                              <td className="small">{new Date(t.entry_time).toLocaleString()}</td>
                                              <td>{t.entry_price.toFixed(2)}</td>
                                              <td className="small">{new Date(t.exit_time).toLocaleString()}</td>
                                              <td>{t.exit_price.toFixed(2)}</td>
                                              {btStrategy === 'mountain' && (
                                                <td>
                                                  <span className={`badge ${
                                                    t.exit_reason === 'INDEX_STOP' ? 'bg-danger' :
                                                    t.exit_reason === 'INDEX_TARGET' ? 'bg-success' :
                                                    'bg-secondary'
                                                  }`}>
                                                    {t.exit_reason}
                                                  </span>
                                                </td>
                                              )}
                                              <td className={`fw-bold ${t.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                                {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          );
                        })()}
                      </div>
                      <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={() => setShowPnlDetailModal(false)}>Close</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Chart with markers */}
              {btCandles.length > 0 && (
                <>
                  <PlotlyCandlestickChart
                    data={btCandles}
                    title={`${selectedIndex} – ${btStrategy === 'mountain' ? 'Mountain Strategy' : `EMA(${btEmaFast}/${btEmaSlow})`} Backtest`}
                    height={520}
                    showIndexLine={false}
                    showEma={showEma}
                    showVolume={showVolume}
                    showRsi={btStrategy === 'mountain' && btRsi.length > 0}
                    rsiData={btRsi}
                    rsiOverbought={btRsiOverbought}
                    rsiOversold={btRsiOversold}
                    adxData={btAdx}
                    indexLabel={`${selectedIndex} Close`}
                    markers={btMarkers}
                  />

                  {/* Trade log table */}
                  {btTrades.length > 0 && (
                    <div className="mt-3">
                      <h6 className="fw-bold">Trade Log</h6>
                      <div className="table-responsive" style={{ maxHeight: 300 }}>
                        <table className="table table-sm table-striped table-hover mb-0">
                          <thead className="table-dark">
                            <tr>
                              <th>#</th>
                              <th>Direction</th>
                              <th>Entry Time</th>
                              <th>Entry Price</th>
                              <th>Exit Time</th>
                              <th>Exit Price</th>
                              {btStrategy === 'mountain' && <th>Exit Reason</th>}
                              <th>P&L</th>
                            </tr>
                          </thead>
                          <tbody>
                            {btTrades.map((t, idx) => (
                              <tr key={idx}>
                                <td>{idx + 1}</td>
                                <td>
                                  <span className={`badge ${t.direction === 'long' ? 'bg-success' : 'bg-danger'}`}>
                                    {t.direction.toUpperCase()}
                                  </span>
                                </td>
                                <td className="small">{new Date(t.entry_time).toLocaleString()}</td>
                                <td>{t.entry_price.toFixed(2)}</td>
                                <td className="small">{new Date(t.exit_time).toLocaleString()}</td>
                                <td>{t.exit_price.toFixed(2)}</td>
                                {btStrategy === 'mountain' && (
                                  <td>
                                    <span className={`badge ${
                                      t.exit_reason === 'INDEX_STOP' ? 'bg-danger' :
                                      t.exit_reason === 'INDEX_TARGET' ? 'bg-success' :
                                      'bg-secondary'
                                    }`}>
                                      {t.exit_reason}
                                    </span>
                                  </td>
                                )}
                                <td className={`fw-bold ${t.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                  {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Equity curve – placed after trade log to avoid overlapping RSI panel */}
                  {btEquity.length > 0 && (
                    <div className="mt-3">
                      <h6 className="fw-bold">Equity Curve (Cumulative P&L)</h6>
                      <Plot
                        data={[
                          {
                            x: btEquity.map((e) => e.timestamp),
                            y: btEquity.map((e) => e.value),
                            type: 'scatter' as const,
                            mode: 'lines' as const,
                            name: 'Equity Curve',
                            line: { color: '#0d6efd', width: 2 },
                            fill: 'tozeroy',
                            fillcolor: 'rgba(13,110,253,0.08)',
                          },
                        ]}
                        layout={{
                          height: 160,
                          margin: { l: 50, r: 30, t: 10, b: 30 },
                          xaxis: { type: 'date' as const, showgrid: true, gridcolor: '#e9ecef' },
                          yaxis: { title: { text: 'P&L' }, showgrid: true, gridcolor: '#e9ecef', zeroline: true, zerolinecolor: '#999' },
                          hovermode: 'x unified' as const,
                          showlegend: false,
                        }}
                        style={{ width: '100%', height: 160 }}
                        config={{ responsive: true, displaylogo: false }}
                      />
                    </div>
                  )}

                  {/* Mountain Strategy Event Log */}
                  {btStrategy === 'mountain' && btEvents.length > 0 && (
                    <div className="mt-3">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <h6 className="fw-bold mb-0">Strategy Event Log ({filteredEvents.length} events)</h6>
                        <select className="form-select form-select-sm" style={{ width: 200 }}
                          value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
                          <option value="ALL">All Events</option>
                          <option value={MountainEventType.SIGNAL_IDENTIFIED}>Signals Identified</option>
                          <option value={MountainEventType.SIGNAL_RESET}>Signal Resets</option>
                          <option value={MountainEventType.SIGNAL_CLEARED}>Signals Cleared</option>
                          <option value={MountainEventType.ENTRY_TRIGGERED}>Entries</option>
                          <option value={MountainEventType.ENTRY_SKIPPED_REENTRY}>Entries Skipped</option>
                          <option value="EXITS">All Exits</option>
                          <option value={MountainEventType.NEW_DAY_RESET}>New Day Resets</option>
                        </select>
                      </div>
                      <div className="table-responsive" style={{ maxHeight: 350, overflowY: 'auto' }}>
                        <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.8rem' }}>
                          <thead className="table-dark sticky-top">
                            <tr>
                              <th style={{ width: 40 }}>#</th>
                              <th style={{ width: 150 }}>Event</th>
                              <th style={{ width: 160 }}>Time</th>
                              <th>Message</th>
                              <th style={{ width: 80 }}>EMA5</th>
                              <th style={{ width: 80 }}>RSI14</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredEvents.map((ev, idx) => (
                              <tr key={idx}>
                                <td className="text-muted">{ev.candleIndex}</td>
                                <td><span className={`badge ${eventBadgeClass(ev.type)}`}>{eventLabel(ev.type)}</span></td>
                                <td className="text-nowrap">{new Date(ev.timestamp).toLocaleString()}</td>
                                <td>{ev.message}</td>
                                <td>{ev.details.ema5 != null ? (ev.details.ema5 as number).toFixed(2) : '–'}</td>
                                <td>{ev.details.rsi14 != null ? (ev.details.rsi14 as number).toFixed(1) : '–'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}

              {!btLoading && btCandles.length === 0 && !btError && (
                <div className="text-center text-muted py-5">
                  <i className="bi bi-clipboard-data fs-1 d-block mb-2"></i>
                  Select parameters and click <strong>Run Backtest</strong> to see results.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdvancedChartsContent;
