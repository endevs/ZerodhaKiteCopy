import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { apiUrl } from '../config/api';
import OptionChainTable, { ChainRow, OptionChainTableHandle } from './OptionChainTable';
import PlotlyCandlestickChart, { PlotlyCandlePoint } from './PlotlyCandlestickChart';
import PayoffDiagramTab from './PayoffDiagramTab';
import PayoffChart from './PayoffChart';
import StrategyBuilderPanel from './StrategyBuilderPanel';
import {
  StrategyLeg,
  AppliedPresetContext,
  addLegToStrategy,
  strategyLegsToPositionInputs,
} from '../lib/optionStrategies';
import { buildPayoffGroups, IndexUnderlying } from '../lib/payoffDiagram';
import { applyQuotePatch, mergeChainBoard, mergeSpotUpdate, QuotePatch } from '../lib/optionChainLive';
import { positionsByTradingsymbol } from '../lib/optionChainPositions';
import {
  DEFAULT_IV_SPIKE_PCT,
  DEFAULT_PRICE_SPIKE_PCT,
  IV_SPIKE_STORAGE_KEY,
  PRICE_SPIKE_STORAGE_KEY,
  readStoredThreshold,
  resetSpikeThresholds,
  writeStoredThreshold,
} from '../lib/optionChainSpike';
import { useSocket } from '../hooks/useSocket';
import './OptionChainBoard.css';
import MarketDataBanner from './MarketDataBanner';

type OptionsMainTab = 'analysis' | 'payoff' | 'dbStatus';

interface ZerodhaPosition {
  tradingsymbol?: string;
  exchange?: string;
  quantity?: number;
  buy_price?: number;
  sell_price?: number;
  last_price?: number;
}

interface OptionChain {
  index: string;
  expiry_date: string;
  trading_date?: string;
  chain: ChainRow[];
  is_active: boolean;
  atm_strike?: number;
  spot?: number;
  data_source?: string;
  message?: string | null;
}

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Normalize candle timestamps for Plotly (naive IST, same as Advanced Charts). */
const normCandleTime = (t: string): string => {
  let raw = t.trim();
  raw = raw.replace(/\.\d+/, '');
  raw = raw.replace(/Z$/i, '');
  raw = raw.replace(/[+-]\d{2}:\d{2}$/, '');
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const sec = match[4] ?? '00';
    return `${match[1]}T${match[2]}:${match[3]}:${sec}`;
  }
  return raw.replace(' ', 'T');
};

const candleOnSelectedDate = (timestamp: string, datePrefix: string): boolean => {
  if (timestamp.startsWith(datePrefix) || normCandleTime(timestamp).startsWith(datePrefix)) {
    return true;
  }
  const parsed = Date.parse(normCandleTime(timestamp).replace('T', ' '));
  if (Number.isNaN(parsed)) return false;
  const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(parsed)
  );
  return istDate === datePrefix;
};

const toNumber = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** 5-minute bucket key for aligning option and index candles (IST-safe). */
const candleTimeBucket = (ts: string): string => {
  const norm = normCandleTime(ts);
  const match = norm.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return norm.slice(0, 16);
  const flooredMin = String(Math.floor(parseInt(match[3], 10) / 5) * 5).padStart(2, '0');
  return `${match[1]}T${match[2]}:${flooredMin}`;
};

const OptionsContent: React.FC = () => {
  const [selectedIndex, setSelectedIndex] = useState<string>('');
  const [expiryDates, setExpiryDates] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [currentLTP, setCurrentLTP] = useState<number | null>(null);
  const [optionChain, setOptionChain] = useState<OptionChain | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingExpiries, setLoadingExpiries] = useState(false);
  const [selectedOption, setSelectedOption] = useState<{
    instrument_token: number;
    tradingsymbol: string;
    expiry_date: string;
    strike: number;
    type: 'CE' | 'PE';
  } | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [indexCandles, setIndexCandles] = useState<Candle[]>([]);
  const [chartIndexCandles, setChartIndexCandles] = useState<Candle[]>([]);
  const [loadingCandles, setLoadingCandles] = useState(false);
  const [dbStatus, setDbStatus] = useState<any>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [collectingData, setCollectingData] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState<OptionsMainTab>('analysis');
  const [positions, setPositions] = useState<ZerodhaPosition[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsError, setPositionsError] = useState<string | null>(null);
  const [positionsNeedsCredentials, setPositionsNeedsCredentials] = useState(false);
  const [positionsAuthExpired, setPositionsAuthExpired] = useState(false);
  const [marketSnapshot, setMarketSnapshot] = useState<{ NIFTY?: number; BANKNIFTY?: number }>({});
  const [priceSpikeThreshold, setPriceSpikeThreshold] = useState(() =>
    readStoredThreshold(PRICE_SPIKE_STORAGE_KEY, DEFAULT_PRICE_SPIKE_PCT),
  );
  const [ivSpikeThreshold, setIvSpikeThreshold] = useState(() =>
    readStoredThreshold(IV_SPIKE_STORAGE_KEY, DEFAULT_IV_SPIKE_PCT),
  );
  const [showPositionPayoff, setShowPositionPayoff] = useState(false);
  const [positionPayoffEmptyMsg, setPositionPayoffEmptyMsg] = useState<string | null>(null);
  const [boardMessage, setBoardMessage] = useState<string | null>(null);
  const [chainUpdatedAt, setChainUpdatedAt] = useState<string | null>(null);
  const [initDone, setInitDone] = useState(false);
  const [strategyLegs, setStrategyLegs] = useState<StrategyLeg[]>([]);
  const [appliedPresetContext, setAppliedPresetContext] = useState<AppliedPresetContext | null>(null);
  const [defaultLots, setDefaultLots] = useState(1);
  const chainTableRef = useRef<OptionChainTableHandle>(null);
  const chainBoardInFlightRef = useRef(false);
  const captureSubscribedKeyRef = useRef<string | null>(null);
  const chartCardRef = useRef<HTMLDivElement>(null);
  const userChangedIndexRef = useRef(false);
  const lastQuoteTickAtRef = useRef(0);
  const liveChainStartedAtRef = useRef(0);
  const [liveTicksDegraded, setLiveTicksDegraded] = useState(false);
  const socket = useSocket();

  const loadExpiryDates = useCallback(async () => {
    if (!selectedIndex) return;
    
    try {
      setLoadingExpiries(true);
      const response = await fetch(apiUrl(`/api/options/expiry-dates?index=${selectedIndex}`), {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch expiry dates');
      
      const data = await response.json();
      const dates: string[] = data.expiry_dates || [];
      setExpiryDates(dates);
      const today = new Date().toISOString().split('T')[0];
      const next = dates.find((d) => d >= today) || dates[dates.length - 1] || '';
      setSelectedExpiry(next);
      setOptionChain(null);
      setCurrentLTP(null);
    } catch (error) {
      console.error('Error loading expiry dates:', error);
    } finally {
      setLoadingExpiries(false);
    }
  }, [selectedIndex]);

  const clearOptionChart = useCallback(() => {
    setSelectedOption(null);
    setCandles([]);
    setChartIndexCandles([]);
  }, []);

  const fetchIndexCandlesForDate = useCallback(async (index: string, date: string): Promise<Candle[]> => {
    const parseCandles = (data: { candles?: Candle[] }) => data.candles || [];

    try {
      const response = await fetch(
        apiUrl(`/api/options/index-candles?index=${index}&date=${date}`),
        { credentials: 'include' }
      );
      if (response.ok) {
        const data = await response.json();
        const rows = parseCandles(data);
        if (rows.length > 0) {
          console.log(`Loaded ${rows.length} index candles for ${index} on ${date}`);
          return rows;
        }
        if (data.warning) console.warn(data.warning);
      }
    } catch (error) {
      console.error('Error loading index candles from options API:', error);
    }

    try {
      const plotlyRes = await fetch(
        apiUrl(`/api/plotly/index-candles?index=${index}&date=${date}&interval=5minute`),
        { credentials: 'include' }
      );
      if (plotlyRes.ok) {
        const data = await plotlyRes.json();
        const rows = parseCandles(data);
        if (rows.length > 0) {
          console.log(`Loaded ${rows.length} index candles from Kite for ${index} on ${date}`);
          return rows;
        }
      }
    } catch (error) {
      console.error('Error loading index candles from plotly API:', error);
    }

    return [];
  }, []);

  const loadIndexCandles = useCallback(async () => {
    if (!selectedIndex || !selectedDate) return [];
    const rows = await fetchIndexCandlesForDate(selectedIndex, selectedDate);
    setIndexCandles(rows);
    return rows;
  }, [selectedIndex, selectedDate, fetchIndexCandlesForDate]);

  const loadDbStatus = useCallback(async () => {
    try {
      setLoadingStatus(true);
      const response = await fetch(apiUrl('/api/options/db-status'), {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch database status');
      }
      
      const data = await response.json();
      setDbStatus(data);
    } catch (error) {
      console.error('Error loading database status:', error);
      alert('Failed to load database status');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const fetchPositions = useCallback(async (silent = false) => {
    if (!silent) setPositionsLoading(true);
    setPositionsError(null);
    setPositionsNeedsCredentials(false);
    setPositionsAuthExpired(false);

    try {
      const response = await fetch(apiUrl('/api/zerodha/positions'), { credentials: 'include' });
      const data = await response.json();

      if (data.authExpired) {
        setPositionsAuthExpired(true);
        setPositionsError('Zerodha session expired. Please log in with Zerodha again from the welcome page.');
        return;
      }

      if (data.needsCredentials) {
        setPositionsNeedsCredentials(true);
        setPositionsError('Add your Zerodha API credentials to view positions.');
        return;
      }

      if (data.status === 'success' && Array.isArray(data.positions)) {
        setPositions(data.positions);
      } else if (data.message) {
        setPositionsError(data.message);
      }
    } catch (error) {
      setPositionsError(error instanceof Error ? error.message : 'Failed to load positions');
    } finally {
      if (!silent) setPositionsLoading(false);
    }
  }, []);

  const fetchMarketSnapshot = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/api/market_snapshot'), { credentials: 'include' });
      const data = await response.json();
      if (response.ok && data.status === 'success') {
        setMarketSnapshot({
          NIFTY: typeof data.nifty === 'number' ? data.nifty : undefined,
          BANKNIFTY: typeof data.banknifty === 'number' ? data.banknifty : undefined,
        });
      }
    } catch {
      // Best-effort spot prices for payoff chart marker
    }
  }, []);

  const triggerDataCollection = useCallback(async (date: string, index?: string) => {
    if (!window.confirm(`Collect data for ${index || 'all indices'} on ${date}? This may take a few minutes.`)) {
      return;
    }
    
    try {
      setCollectingData(true);
      const response = await fetch(apiUrl('/api/options/collect-data'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          date: date,
          index: index
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to collect data');
      }
      
      const result = await response.json();
      alert(result.message || 'Data collection completed!');
      
      // Reload database status
      await loadDbStatus();
    } catch (error: any) {
      console.error('Error triggering data collection:', error);
      alert(`Failed to collect data: ${error.message}`);
    } finally {
      setCollectingData(false);
    }
  }, [loadDbStatus]);

  const handlePriceSpikeThresholdChange = useCallback((raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setPriceSpikeThreshold(n);
    writeStoredThreshold(PRICE_SPIKE_STORAGE_KEY, n);
  }, []);

  const handleIvSpikeThresholdChange = useCallback((raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setIvSpikeThreshold(n);
    writeStoredThreshold(IV_SPIKE_STORAGE_KEY, n);
  }, []);

  const handleResetSpikeThresholds = useCallback(() => {
    const { price, iv } = resetSpikeThresholds();
    setPriceSpikeThreshold(price);
    setIvSpikeThreshold(iv);
  }, []);

  const loadChainBoard = useCallback(async (opts?: { silent?: boolean; livePoll?: boolean }) => {
    if (!selectedIndex || !selectedExpiry || !selectedDate) return;
    if (chainBoardInFlightRef.current) {
      return;
    }
    const silent = opts?.silent ?? false;
    chainBoardInFlightRef.current = true;
    try {
      if (!silent) setLoading(true);
      const q = new URLSearchParams({
        index: selectedIndex,
        trading_date: selectedDate,
        expiry_date: selectedExpiry,
      });
      if (opts?.livePoll === false) {
        q.set('live_poll', '0');
      }
      const response = await fetch(apiUrl(`/api/options/chain-board?${q}`), {
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to load option chain');
      }
      const raw = await response.json();
      const data: OptionChain = {
        ...raw,
        is_active: raw.is_active ?? raw.is_live ?? false,
      };
      setOptionChain((prev) => {
        if (!silent || !prev) return data;
        return {
          ...data,
          chain: mergeChainBoard(prev.chain, data.chain),
        };
      });
      setBoardMessage(data.message || null);
      if (data.spot != null) setCurrentLTP(data.spot);
      setChainUpdatedAt(new Date().toLocaleTimeString('en-IN', { hour12: false }));
    } catch (error: unknown) {
      if (!silent) {
        const msg = error instanceof Error ? error.message : 'Failed to load option chain';
        console.error('Error loading chain board:', error);
        alert(msg);
      }
    } finally {
      chainBoardInFlightRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [selectedIndex, selectedExpiry, selectedDate]);

  const handleRefreshChain = useCallback(() => {
    clearOptionChart();
    loadChainBoard({ silent: false });
  }, [clearOptionChart, loadChainBoard]);

  const loadOptionCandles = async (instrumentToken: number, tradingsymbol: string, strike: number, type: 'CE' | 'PE') => {
    if (!selectedDate) {
      alert('Please select a trading date');
      return;
    }
    
    try {
      setLoadingCandles(true);
      const indexRows = await fetchIndexCandlesForDate(selectedIndex, selectedDate);
      setIndexCandles(indexRows);
      setChartIndexCandles(indexRows);
      setSelectedOption({
        instrument_token: instrumentToken,
        tradingsymbol: tradingsymbol,
        expiry_date: selectedExpiry,
        strike: strike,
        type: type,
      });

      const response = await fetch(
        apiUrl(`/api/options/candles?instrument_token=${instrumentToken}&expiry_date=${selectedDate}`),
        {
          credentials: 'include'
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch candles');
      }

      const data = await response.json();
      setCandles(data.candles || []);
      requestAnimationFrame(() => {
        chartCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    } catch (error) {
      console.error('Error loading candles:', error);
      alert('Failed to load candle data');
    } finally {
      setLoadingCandles(false);
    }
  };

  // Format expiry date for display
  const formatExpiryDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // Calculate EMA5
  const calculateEMA = (data: number[], period: number): number[] => {
    const ema: number[] = [];
    const multiplier = 2 / (period + 1);
    
    // First value is just the first close price
    if (data.length > 0) {
      ema.push(data[0]);
    }
    
    // Calculate EMA for remaining values
    for (let i = 1; i < data.length; i++) {
      const value = (data[i] - ema[i - 1]) * multiplier + ema[i - 1];
      ema.push(value);
    }
    
    return ema;
  };

  // Option candles for selected trading date + EMA5
  const chartData = useMemo(() => {
    if (!selectedDate) {
      return [];
    }

    const filteredCandles = candles.filter((candle) =>
      candleOnSelectedDate(candle.timestamp, selectedDate)
    );

    const closes = filteredCandles.map((c) => toNumber(c.close));
    const ema5 = calculateEMA(closes, 5);

    return filteredCandles.map((candle, index) => ({
      timestamp: normCandleTime(candle.timestamp),
      open: toNumber(candle.open),
      high: toNumber(candle.high),
      low: toNumber(candle.low),
      close: toNumber(candle.close),
      ema5: ema5[index] ?? null,
    }));
  }, [selectedDate, candles]);

  const indexByBucket = useMemo(() => {
    const map = new Map<string, number>();
    if (!selectedDate) return map;
    const source = chartIndexCandles.length > 0 ? chartIndexCandles : indexCandles;
    for (const c of source) {
      if (!candleOnSelectedDate(c.timestamp, selectedDate)) continue;
      const close = toNumber(c.close);
      if (!Number.isFinite(close)) continue;
      map.set(candleTimeBucket(c.timestamp), close);
    }
    return map;
  }, [chartIndexCandles, indexCandles, selectedDate]);

  const plotlyChartData = useMemo((): PlotlyCandlePoint[] => {
    return chartData.map((d) => ({
      time: d.timestamp,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      ema5: d.ema5,
      indexClose: indexByBucket.get(candleTimeBucket(d.timestamp)) ?? null,
    }));
  }, [chartData, indexByBucket]);

  const indexOverlayCount = useMemo(
    () => plotlyChartData.filter((d) => d.indexClose != null && !Number.isNaN(d.indexClose)).length,
    [plotlyChartData]
  );

  const formatChartTime = (ts: string) =>
    new Date(ts).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  // Calculate ATM strike (closest to selected date's index close or backend-provided ATM)
  const getATMStrike = (): number | null => {
    if (!optionChain || !optionChain.chain || optionChain.chain.length === 0) {
      return null;
    }
    
    // If backend provided ATM strike, use it
    if (optionChain.atm_strike) {
      // Find closest strike in chain to backend ATM
      let closestStrike = optionChain.chain[0].strike;
      let minDiff = Math.abs(optionChain.chain[0].strike - optionChain.atm_strike);
      
      for (const item of optionChain.chain) {
        const diff = Math.abs(item.strike - optionChain.atm_strike);
        if (diff < minDiff) {
          minDiff = diff;
          closestStrike = item.strike;
        }
      }
      return closestStrike;
    }
    
    // Fallback: calculate from index candles for selected date
    if (selectedDate && indexCandles.length > 0) {
      const selectedDateStr = new Date(selectedDate).toISOString().split('T')[0];
      const dayCandles = indexCandles.filter(c => {
        const candleDate = new Date(c.timestamp).toISOString().split('T')[0];
        return candleDate === selectedDateStr;
      });
      
      if (dayCandles.length > 0) {
        const closes = dayCandles.map(c => c.close);
        const avgClose = closes.reduce((a, b) => a + b, 0) / closes.length;
        const strikeStep = selectedIndex === 'BANKNIFTY' ? 100 : 50;
        const calculatedATM = Math.round(avgClose / strikeStep) * strikeStep;
        
        // Find closest strike in chain
        let atmStrike = optionChain.chain[0].strike;
        let minDiff = Math.abs(optionChain.chain[0].strike - calculatedATM);
        
        for (const item of optionChain.chain) {
          const diff = Math.abs(item.strike - calculatedATM);
          if (diff < minDiff) {
            minDiff = diff;
            atmStrike = item.strike;
          }
        }
        return atmStrike;
      }
    }
    
    // Last resort: use current LTP if available
    if (currentLTP && optionChain.chain.length > 0) {
      const strikeStep = selectedIndex === 'BANKNIFTY' ? 100 : 50;
      const atmStrike = Math.round(currentLTP / strikeStep) * strikeStep;
      
      // Find closest strike in chain
      let closestStrike = optionChain.chain[0].strike;
      let minDiff = Math.abs(optionChain.chain[0].strike - atmStrike);
      
      for (const item of optionChain.chain) {
        const diff = Math.abs(item.strike - atmStrike);
        if (diff < minDiff) {
          minDiff = diff;
          closestStrike = item.strike;
        }
      }
      return closestStrike;
    }
    
    return null;
  };

  const chainScrollContextKey = useMemo(
    () => `${selectedIndex}|${selectedExpiry}|${selectedDate}`,
    [selectedIndex, selectedExpiry, selectedDate],
  );

  const bootstrapFromExpiryDates = useCallback(async (index: string) => {
    const today = new Date().toISOString().split('T')[0];
    try {
      const response = await fetch(apiUrl(`/api/options/expiry-dates?index=${index}`), {
        credentials: 'include',
      });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const dates: string[] = data.expiry_dates || [];
      const next = dates.find((d) => d >= today) || dates[dates.length - 1] || '';
      setExpiryDates(dates);
      setSelectedExpiry(next);
    } catch (e) {
      console.error('bootstrapFromExpiryDates failed', e);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const today = new Date().toISOString().split('T')[0];
      try {
        const response = await fetch(apiUrl('/api/options/default-selection?index=NIFTY'), {
          credentials: 'include',
        });
        if (!response.ok) {
          setSelectedIndex('NIFTY');
          setSelectedDate(today);
          await bootstrapFromExpiryDates('NIFTY');
          setInitDone(true);
          return;
        }
        const data = await response.json();
        setSelectedIndex(data.index || 'NIFTY');
        setExpiryDates(data.expiry_dates || []);
        setSelectedExpiry(data.expiry_date || '');
        setSelectedDate(data.trading_date || today);
        if (!data.expiry_date) {
          await bootstrapFromExpiryDates(data.index || 'NIFTY');
        }
        setInitDone(true);
      } catch (e) {
        console.error('default-selection failed', e);
        setSelectedIndex('NIFTY');
        setSelectedDate(today);
        await bootstrapFromExpiryDates('NIFTY');
        setInitDone(true);
      }
    };
    init();
  }, [bootstrapFromExpiryDates]);

  useEffect(() => {
    if (initDone && selectedIndex && selectedExpiry && selectedDate) {
      loadChainBoard();
    }
  }, [initDone, selectedIndex, selectedExpiry, selectedDate, loadChainBoard]);

  useEffect(() => {
    if (!optionChain?.is_active || !selectedIndex || !selectedExpiry) return;
    if (captureSubscribedKeyRef.current === chainScrollContextKey) return;
    captureSubscribedKeyRef.current = chainScrollContextKey;
    fetch(apiUrl('/api/options/capture/subscribe'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: selectedIndex, expiry_date: selectedExpiry }),
    }).catch(() => {});
  }, [optionChain?.is_active, chainScrollContextKey, selectedIndex, selectedExpiry]);

  useEffect(() => {
    if (!optionChain?.is_active || !selectedIndex) {
      return;
    }
    liveChainStartedAtRef.current = Date.now();
    lastQuoteTickAtRef.current = 0;
    setLiveTicksDegraded(false);

    socket.emit('join_options_chain', {});

    const onQuoteUpdate = (patch: QuotePatch) => {
      if (patch.index_name?.toUpperCase() !== selectedIndex.toUpperCase()) return;
      lastQuoteTickAtRef.current = Date.now();
      setLiveTicksDegraded(false);
      setOptionChain((prev) => {
        if (!prev) return prev;
        return { ...prev, chain: applyQuotePatch(prev.chain, patch) };
      });
      if (patch.updated_at) {
        try {
          const t = new Date(patch.updated_at);
          if (!Number.isNaN(t.getTime())) {
            setChainUpdatedAt(t.toLocaleTimeString('en-IN', { hour12: false }));
          }
        } catch {
          /* ignore */
        }
      }
    };

    const onMarketData = (data: { nifty_price?: string; banknifty_price?: string }) => {
      const spot = mergeSpotUpdate(selectedIndex, data);
      if (spot == null) return;
      setCurrentLTP(spot);
      setOptionChain((prev) => (prev ? { ...prev, spot } : prev));
    };

    socket.on('option_quote_update', onQuoteUpdate);
    socket.on('market_data', onMarketData);

    return () => {
      socket.emit('leave_options_chain', {});
      socket.off('option_quote_update', onQuoteUpdate);
      socket.off('market_data', onMarketData);
    };
  }, [optionChain?.is_active, selectedIndex, socket, chainScrollContextKey]);

  useEffect(() => {
    if (!optionChain?.is_active || !selectedIndex || !selectedExpiry || !selectedDate) return;
    const slowId = setInterval(() => {
      loadChainBoard({ silent: true, livePoll: false });
    }, 30000);
    return () => clearInterval(slowId);
  }, [optionChain?.is_active, selectedIndex, selectedExpiry, selectedDate, loadChainBoard]);

  useEffect(() => {
    if (!optionChain?.is_active) return;
    const id = setInterval(() => {
      const started = liveChainStartedAtRef.current;
      const lastTick = lastQuoteTickAtRef.current;
      const now = Date.now();
      const stale = lastTick > 0 && now - lastTick > 10000;
      const noTicksYet = lastTick === 0 && started > 0 && now - started > 10000;
      setLiveTicksDegraded(stale || noTicksYet);
    }, 2000);
    return () => clearInterval(id);
  }, [optionChain?.is_active]);

  useEffect(() => {
    if (!liveTicksDegraded || !optionChain?.is_active) return;
    const id = setInterval(() => {
      loadChainBoard({ silent: true, livePoll: false });
    }, 15000);
    return () => clearInterval(id);
  }, [liveTicksDegraded, optionChain?.is_active, loadChainBoard]);

  // Reload expiries only when the user changes index (init uses default-selection)
  useEffect(() => {
    if (!selectedIndex) {
      setExpiryDates([]);
      setSelectedExpiry('');
      setOptionChain(null);
      setCurrentLTP(null);
      return;
    }
    if (userChangedIndexRef.current) {
      loadExpiryDates();
    }
  }, [selectedIndex, loadExpiryDates]);

  // Load index candles when date or index changes
  useEffect(() => {
    if (selectedIndex && selectedDate) {
      loadIndexCandles();
    } else {
      setIndexCandles([]);
    }
  }, [selectedIndex, selectedDate, loadIndexCandles]);

  // Load DB status when tab is shown
  useEffect(() => {
    if (activeMainTab === 'dbStatus') {
      loadDbStatus();
    }
  }, [activeMainTab, loadDbStatus]);

  useEffect(() => {
    if (activeMainTab !== 'payoff' && activeMainTab !== 'analysis') return;

    fetchPositions();
    fetchMarketSnapshot();
    const pollMs = activeMainTab === 'payoff' ? 5000 : 30000;
    const interval = setInterval(() => {
      fetchPositions(true);
      fetchMarketSnapshot();
    }, pollMs);
    return () => clearInterval(interval);
  }, [activeMainTab, fetchPositions, fetchMarketSnapshot]);

  useEffect(() => {
    setStrategyLegs([]);
    setAppliedPresetContext(null);
    setShowPositionPayoff(false);
    setPositionPayoffEmptyMsg(null);
  }, [selectedIndex, selectedExpiry, selectedDate]);

  const handleAddStrategyLeg = useCallback(
    (params: {
      side: 'BUY' | 'SELL';
      strike: number;
      optionType: 'CE' | 'PE';
      tradingsymbol: string;
      ltp: number;
      lots: number;
    }) => {
      setStrategyLegs((prev) => addLegToStrategy(prev, params));
    },
    []
  );

  const openPositions = useMemo(
    () => positions.filter((p) => p.quantity != null && Number(p.quantity) !== 0),
    [positions]
  );

  const positionBySymbol = useMemo(() => {
    if (selectedIndex !== 'NIFTY' && selectedIndex !== 'BANKNIFTY') {
      return undefined;
    }
    return positionsByTradingsymbol(openPositions, selectedIndex);
  }, [openPositions, selectedIndex]);

  const positionPayoffLegs = useMemo(() => {
    if (selectedIndex !== 'NIFTY' && selectedIndex !== 'BANKNIFTY') return [];
    const groups = buildPayoffGroups(openPositions);
    return groups.find((g) => g.underlying === selectedIndex)?.legs ?? [];
  }, [openPositions, selectedIndex]);

  const canShowPositionPayoff =
    positionPayoffLegs.length > 0 &&
    !positionsNeedsCredentials &&
    !positionsAuthExpired;

  const handlePositionPayoffClick = useCallback(() => {
    if (positionsNeedsCredentials) {
      setPositionPayoffEmptyMsg('Add your Zerodha API credentials to view position payoff.');
      setShowPositionPayoff(false);
      return;
    }
    if (positionsAuthExpired) {
      setPositionPayoffEmptyMsg('Zerodha session expired. Please reconnect from the Welcome page.');
      setShowPositionPayoff(false);
      return;
    }
    if (positionPayoffLegs.length === 0) {
      setPositionPayoffEmptyMsg(`No open ${selectedIndex} F&O positions to chart.`);
      setShowPositionPayoff(false);
      return;
    }
    setPositionPayoffEmptyMsg(null);
    setShowPositionPayoff((v) => !v);
  }, [
    positionPayoffLegs.length,
    positionsAuthExpired,
    positionsNeedsCredentials,
    selectedIndex,
  ]);

  const spotPrices = useMemo(
    () => ({
      NIFTY:
        selectedIndex === 'NIFTY' && currentLTP != null
          ? currentLTP
          : marketSnapshot.NIFTY,
      BANKNIFTY:
        selectedIndex === 'BANKNIFTY' && currentLTP != null
          ? currentLTP
          : marketSnapshot.BANKNIFTY,
    }),
    [selectedIndex, currentLTP, marketSnapshot]
  );

  const strategyPayoffUnderlying = useMemo((): IndexUnderlying | null => {
    if (selectedIndex === 'NIFTY' || selectedIndex === 'BANKNIFTY') {
      return selectedIndex;
    }
    return null;
  }, [selectedIndex]);

  const strategyPayoffSpot = useMemo(() => {
    if (selectedIndex === 'NIFTY' || selectedIndex === 'BANKNIFTY') {
      return currentLTP ?? optionChain?.spot ?? spotPrices[selectedIndex];
    }
    return undefined;
  }, [selectedIndex, currentLTP, optionChain?.spot, spotPrices]);

  const strategyPositionInputs = useMemo(
    () => (selectedIndex ? strategyLegsToPositionInputs(strategyLegs, selectedIndex) : []),
    [strategyLegs, selectedIndex]
  );

  const strategyParsedLegs = useMemo(() => {
    if (!strategyPayoffUnderlying || strategyPositionInputs.length === 0) return [];
    const groups = buildPayoffGroups(strategyPositionInputs);
    return groups.find((g) => g.underlying === strategyPayoffUnderlying)?.legs ?? [];
  }, [strategyPositionInputs, strategyPayoffUnderlying]);

  return (
    <div className="container-fluid py-4">
      <MarketDataBanner />
      <div className="row mb-4">
        <div className="col-12">
          <h2 className="mb-4">Options Trading Analysis</h2>
          
          {/* Tabs for main content and DB status */}
          <ul className="nav nav-tabs mb-4" role="tablist">
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${activeMainTab === 'analysis' ? 'active' : ''}`}
                onClick={() => setActiveMainTab('analysis')}
              >
                Options Analysis
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${activeMainTab === 'payoff' ? 'active' : ''}`}
                onClick={() => setActiveMainTab('payoff')}
              >
                Pay Off Diagram
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button
                type="button"
                className={`nav-link ${activeMainTab === 'dbStatus' ? 'active' : ''}`}
                onClick={() => setActiveMainTab('dbStatus')}
              >
                Database Record Status
              </button>
            </li>
          </ul>

          {activeMainTab === 'analysis' && (
            <>
              {/* Controls */}
          <div className="card mb-4">
            <div className="card-body">
              <div className="row g-3 align-items-end">
                <div className="col-md-3">
                  <label className="form-label">Index</label>
                  <select
                    className="form-select"
                    value={selectedIndex}
                    onChange={(e) => {
                      userChangedIndexRef.current = true;
                      clearOptionChart();
                      setSelectedIndex(e.target.value);
                      setSelectedExpiry('');
                      setOptionChain(null);
                      setCurrentLTP(null);
                    }}
                  >
                    <option value="">Select Index</option>
                    <option value="BANKNIFTY">BANKNIFTY</option>
                    <option value="NIFTY">NIFTY</option>
                  </select>
                </div>
                
                <div className="col-md-3">
                  <label className="form-label">Expiry Date</label>
                  <select
                    className="form-select"
                    value={selectedExpiry}
                    onChange={(e) => {
                      clearOptionChart();
                      setSelectedExpiry(e.target.value);
                      setOptionChain(null);
                    }}
                    disabled={!selectedIndex || loadingExpiries}
                  >
                    <option value="">{selectedIndex ? 'Select Expiry Date' : 'Select Index First'}</option>
                    {expiryDates.map((date) => (
                      <option key={date} value={date}>
                        {formatExpiryDate(date)}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="col-md-2">
                  <label className="form-label">Trading Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={selectedDate}
                    onChange={(e) => {
                      clearOptionChart();
                      setSelectedDate(e.target.value);
                    }}
                    disabled={!selectedExpiry}
                    max={new Date().toISOString().split('T')[0]}
                  />
                </div>
                
                <div className="col-md-2">
                  <button
                    className="btn btn-primary w-100"
                    onClick={handleRefreshChain}
                    disabled={!selectedExpiry || !selectedDate || loading}
                  >
                    {loading ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
                
                <div className="col-md-2">
                  {currentLTP !== null && optionChain?.is_active && (
                    <div>
                      <label className="form-label text-muted small">Current LTP</label>
                      <div className="h5 mb-0 text-primary">
                        ₹{currentLTP.toFixed(2)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {selectedExpiry && (
                <div className="row g-3 mt-2">
                  <div className="col-md-12">
                    <small className="text-muted">
                      <strong>Note:</strong> Select a trading date to view historical candlestick data for any option contract.
                    </small>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Option Chain Display */}
          {optionChain && (
            <div className="card">
              <div className="card-header d-flex flex-wrap align-items-center gap-2">
                <h5 className="mb-0">
                  Option Chain — {selectedIndex} {formatExpiryDate(optionChain.expiry_date)}
                  {optionChain.is_active && <span className="badge bg-success ms-2">Live</span>}
                  {optionChain.data_source && (
                    <span className="badge bg-secondary ms-1">{optionChain.data_source}</span>
                  )}
                </h5>
                <span className="text-muted small ms-auto d-flex flex-wrap gap-2 align-items-center">
                  {currentLTP != null && (
                    <span>
                      Spot: <strong>₹{currentLTP.toFixed(2)}</strong>
                      {optionChain.atm_strike != null && (
                        <> · ATM: <strong>{optionChain.atm_strike}</strong></>
                      )}
                    </span>
                  )}
                  {chainUpdatedAt && optionChain.is_active && (
                    <span>Updated: <strong>{chainUpdatedAt}</strong></span>
                  )}
                  <label className="d-inline-flex align-items-center gap-1 mb-0">
                    <span className="text-muted">Price spike %</span>
                    <input
                      type="number"
                      className="form-control form-control-sm spike-threshold-input"
                      min={0.1}
                      step={0.1}
                      value={priceSpikeThreshold}
                      onChange={(e) => handlePriceSpikeThresholdChange(e.target.value)}
                      title="Highlight LTP cells when |day change %| meets or exceeds this value"
                    />
                  </label>
                  <label className="d-inline-flex align-items-center gap-1 mb-0">
                    <span className="text-muted">IV spike %</span>
                    <input
                      type="number"
                      className="form-control form-control-sm spike-threshold-input"
                      min={0.1}
                      step={0.1}
                      value={ivSpikeThreshold}
                      onChange={(e) => handleIvSpikeThresholdChange(e.target.value)}
                      title="Highlight IV cells when |day IV change %| meets or exceeds this value"
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    title="Reset spike thresholds to defaults (LTP 120%, IV 10%)"
                    onClick={handleResetSpikeThresholds}
                    aria-label="Reset spike thresholds"
                  >
                    <i className="bi bi-arrow-counterclockwise" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => chainTableRef.current?.scrollToAtm()}
                  >
                    Center ATM
                  </button>
                </span>
              </div>
              <div className="card-body">
                {boardMessage && (
                  <div className="alert alert-warning py-2 small">{boardMessage}</div>
                )}
                {optionChain.is_active && liveTicksDegraded && (
                  <div className="alert alert-info py-2 small mb-2">
                    Live tick stream unavailable — refreshing quotes every 15s via REST.
                  </div>
                )}
                <OptionChainTable
                  ref={chainTableRef}
                  chain={optionChain.chain}
                  spot={optionChain.spot ?? currentLTP ?? 0}
                  atmStrike={optionChain.atm_strike ?? getATMStrike()}
                  tradingDate={selectedDate}
                  scrollContextKey={chainScrollContextKey}
                  onSelectContract={(token, symbol, strike, type) =>
                    loadOptionCandles(token, symbol, strike, type)
                  }
                  highlightStrike={selectedOption?.strike ?? null}
                  defaultLots={defaultLots}
                  priceSpikeThreshold={priceSpikeThreshold}
                  ivSpikeThreshold={ivSpikeThreshold}
                  positionBySymbol={positionBySymbol}
                  onAddLeg={handleAddStrategyLeg}
                />
                <div className="option-chain-footer d-flex flex-wrap align-items-center gap-3 mt-3 pt-2 border-top">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handlePositionPayoffClick}
                  >
                    <i className="bi bi-graph-up me-1" />
                    Position Payoff Diagram
                  </button>
                  {positionsError && !positionsNeedsCredentials && !positionsAuthExpired && (
                    <span className="text-danger small">{positionsError}</span>
                  )}
                </div>
                {positionPayoffEmptyMsg && (
                  <div className="alert alert-info py-2 small mt-2 mb-0">{positionPayoffEmptyMsg}</div>
                )}
                {showPositionPayoff && canShowPositionPayoff && strategyPayoffUnderlying && (
                  <PayoffChart
                    legs={positionPayoffLegs}
                    underlying={strategyPayoffUnderlying}
                    spot={strategyPayoffSpot}
                    title={`${selectedIndex} — Position Payoff (Live)`}
                    className="mt-3"
                    enhanced
                    chain={optionChain.chain}
                    atmStrike={optionChain.atm_strike ?? getATMStrike()}
                    expiryDate={selectedExpiry}
                    tradingDate={selectedDate}
                  />
                )}
              </div>
            </div>
          )}

          {optionChain && (
            <>
              <StrategyBuilderPanel
                legs={strategyLegs}
                onLegsChange={setStrategyLegs}
                index={selectedIndex}
                atmStrike={optionChain.atm_strike ?? getATMStrike()}
                chain={optionChain.chain}
                spot={currentLTP ?? optionChain.spot}
                defaultLots={defaultLots}
                onDefaultLotsChange={setDefaultLots}
                appliedPreset={appliedPresetContext}
                onAppliedPresetChange={setAppliedPresetContext}
              />
              {strategyLegs.length > 0 && strategyPayoffUnderlying && (
                <PayoffChart
                  legs={strategyParsedLegs}
                  underlying={strategyPayoffUnderlying}
                  spot={strategyPayoffSpot}
                  title={`${strategyPayoffUnderlying} — Strategy Payoff (Simulation)`}
                  showDisclaimer
                  className="mt-3"
                  enhanced
                  chain={optionChain.chain}
                  atmStrike={optionChain.atm_strike ?? getATMStrike()}
                  expiryDate={selectedExpiry}
                  tradingDate={selectedDate}
                />
              )}
            </>
          )}

          {/* Candle Chart */}
          {selectedOption && selectedDate && (
            <div className="card mt-4" ref={chartCardRef}>
              <div className="card-header">
                <h5 className="mb-0">
                  {selectedOption.tradingsymbol} - 5 Minute Candlestick Chart
                  <span className="badge bg-info ms-2">
                    Expiry: {formatExpiryDate(selectedOption.expiry_date)}
                  </span>
                  {selectedDate && (
                    <span className="badge bg-secondary ms-2">
                      Date: {formatExpiryDate(selectedDate)}
                    </span>
                  )}
                </h5>
              </div>
              <div className="card-body">
                {loadingCandles ? (
                  <div className="text-center py-4">
                    <div className="spinner-border" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : plotlyChartData.length > 0 ? (
                  <div>
                    <PlotlyCandlestickChart
                      data={plotlyChartData}
                      title={`${selectedOption.tradingsymbol} – 5m (IST)`}
                      height={500}
                      showVolume={false}
                      showEma={true}
                      showIndexLine={true}
                      indexOnSecondaryAxis={true}
                      indexLabel={`${selectedIndex} Close`}
                    />
                    <div className="mt-3">
                      <small className="text-muted">
                        Total Candles: {plotlyChartData.length} |
                        Date: {selectedDate ? formatExpiryDate(selectedDate) : 'N/A'}
                        {plotlyChartData.length > 0 && (
                          <span>
                            {' '}
                            | Time Range: {formatChartTime(String(plotlyChartData[0].time))} to{' '}
                            {formatChartTime(String(plotlyChartData[plotlyChartData.length - 1].time))}
                          </span>
                        )}
                        {indexOverlayCount > 0 ? (
                          <span> | {selectedIndex} overlay: {indexOverlayCount} points</span>
                        ) : (
                          <span className="text-warning"> | {selectedIndex} index line unavailable (no index candles for this date)</span>
                        )}
                      </small>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-muted mb-2">No candle data available for selected date</p>
                    {candles.length > 0 && (
                      <p className="text-warning small mb-2">
                        Received {candles.length} candles from API but none match trading date{' '}
                        {selectedDate}. Try another date or collect data in Database Record Status.
                      </p>
                    )}
                    {indexCandles.length === 0 && (
                      <p className="text-warning small mb-2">
                        No index data available. Check the "Database Record Status" tab to see available dates and collect data.
                      </p>
                    )}
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => setActiveMainTab('dbStatus')}
                    >
                      View Database Status
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
            </>
          )}

          {activeMainTab === 'payoff' && (
            <PayoffDiagramTab
              positions={openPositions}
              spotPrices={spotPrices}
              defaultUnderlying={
                selectedIndex === 'NIFTY' || selectedIndex === 'BANKNIFTY'
                  ? selectedIndex
                  : undefined
              }
              loading={positionsLoading}
              error={positionsError}
              needsCredentials={positionsNeedsCredentials}
              authExpired={positionsAuthExpired}
            />
          )}

          {activeMainTab === 'dbStatus' && (
            <div className="card">
              <div className="card-header d-flex justify-content-between align-items-center">
                <h5 className="mb-0">Database Record Status</h5>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => loadDbStatus()}
                  disabled={loadingStatus}
                >
                  {loadingStatus ? 'Loading...' : 'Refresh'}
                </button>
              </div>
              <div className="card-body">
                {loadingStatus ? (
                  <div className="text-center py-4">
                    <div className="spinner-border" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : dbStatus ? (
                  <>
                    {/* Summary */}
                    <div className="row mb-4">
                      <div className="col-md-12">
                        <h6>Summary</h6>
                        <div className="table-responsive">
                          <table className="table table-sm table-bordered">
                            <thead>
                              <tr>
                                <th>Index</th>
                                <th>Dates Available</th>
                                <th>Earliest Date</th>
                                <th>Latest Date</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(dbStatus.summary || {}).map(([index, data]: [string, any]) => (
                                <tr key={index}>
                                  <td><strong>{index}</strong></td>
                                  <td>{data.date_count}</td>
                                  <td>{data.earliest_date}</td>
                                  <td>{data.latest_date}</td>
                                </tr>
                              ))}
                              {Object.keys(dbStatus.summary || {}).length === 0 && (
                                <tr>
                                  <td colSpan={4} className="text-center text-muted">No data available</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Index Data Table */}
                    <div className="row mb-4">
                      <div className="col-md-12">
                        <h6>Index 5-Minute Candles</h6>
                        <div className="table-responsive" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                          <table className="table table-sm table-striped table-bordered">
                            <thead className="table-light sticky-top">
                              <tr>
                                <th>Index</th>
                                <th>Date</th>
                                <th>Candle Count</th>
                                <th>First Candle</th>
                                <th>Last Candle</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dbStatus.index_data && dbStatus.index_data.length > 0 ? (
                                dbStatus.index_data.map((item: any, idx: number) => (
                                  <tr key={idx}>
                                    <td>{item.index}</td>
                                    <td>{item.date}</td>
                                    <td>{item.candle_count}</td>
                                    <td>{item.first_candle ? new Date(item.first_candle).toLocaleTimeString() : '-'}</td>
                                    <td>{item.last_candle ? new Date(item.last_candle).toLocaleTimeString() : '-'}</td>
                                    <td>
                                      <button
                                        className="btn btn-sm btn-outline-primary"
                                        onClick={() => triggerDataCollection(item.date, item.index)}
                                        disabled={collectingData}
                                      >
                                        {collectingData ? 'Collecting...' : 'Update'}
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={6} className="text-center text-muted">No index data available</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Option Contracts Table */}
                    <div className="row mb-4">
                      <div className="col-md-12">
                        <h6>Option Contracts</h6>
                        <div className="table-responsive" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                          <table className="table table-sm table-striped table-bordered">
                            <thead className="table-light sticky-top">
                              <tr>
                                <th>Index</th>
                                <th>Date</th>
                                <th>Contract Count</th>
                                <th>Strike Count</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dbStatus.option_data && dbStatus.option_data.length > 0 ? (
                                dbStatus.option_data.map((item: any, idx: number) => (
                                  <tr key={idx}>
                                    <td>{item.index}</td>
                                    <td>{item.date}</td>
                                    <td>{item.contract_count}</td>
                                    <td>{item.strike_count}</td>
                                    <td>
                                      <button
                                        className="btn btn-sm btn-outline-primary"
                                        onClick={() => triggerDataCollection(item.date, item.index)}
                                        disabled={collectingData}
                                      >
                                        {collectingData ? 'Collecting...' : 'Update'}
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={5} className="text-center text-muted">No option contracts available</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Manual Collection */}
                    <div className="row">
                      <div className="col-md-12">
                        <div className="card bg-light">
                          <div className="card-body">
                            <h6>Manual Data Collection</h6>
                            <p className="text-muted small mb-3">
                              Collect data for a specific date. This will fetch index candles and option chains from Zerodha API.
                            </p>
                            <div className="row g-3">
                              <div className="col-md-4">
                                <label className="form-label">Date</label>
                                <input
                                  type="date"
                                  className="form-control"
                                  id="collectionDate"
                                  max={new Date().toISOString().split('T')[0]}
                                />
                              </div>
                              <div className="col-md-4">
                                <label className="form-label">Index (Optional)</label>
                                <select className="form-select" id="collectionIndex">
                                  <option value="">All Indices</option>
                                  <option value="BANKNIFTY">BANKNIFTY</option>
                                  <option value="NIFTY">NIFTY</option>
                                </select>
                              </div>
                              <div className="col-md-4 d-flex align-items-end">
                                <button
                                  className="btn btn-primary"
                                  onClick={() => {
                                    const dateInput = document.getElementById('collectionDate') as HTMLInputElement;
                                    const indexSelect = document.getElementById('collectionIndex') as HTMLSelectElement;
                                    if (dateInput.value) {
                                      triggerDataCollection(dateInput.value, indexSelect.value || undefined);
                                    } else {
                                      alert('Please select a date');
                                    }
                                  }}
                                  disabled={collectingData}
                                >
                                  {collectingData ? 'Collecting...' : 'Collect Data'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4 text-muted">
                    Click "Refresh" to load database status
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OptionsContent;
