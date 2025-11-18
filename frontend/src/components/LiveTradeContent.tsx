import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../config/api';
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, Legend, ReferenceLine, CartesianGrid } from 'recharts';

interface StrategyOption {
  id: number;
  strategy_name: string;
  instrument: string;
  candle_time: string;
}

interface HistoryEntry {
  timestamp?: string;
  level?: string;
  message?: string;
  category?: string;
  meta?: Record<string, unknown>;
}

interface LiveOrder {
  order_id?: string;
  status?: string;
  tradingsymbol?: string;
  transaction_type?: string;
  quantity?: number;
  filled_quantity?: number;
  pending_quantity?: number;
  price?: number;
  trigger_price?: number;
  average_price?: number;
  exchange?: string;
  product?: string;
  order_type?: string;
  variety?: string;
  order_timestamp?: string;
  exchange_timestamp?: string;
}

interface LivePosition {
  tradingsymbol?: string;
  instrument_token?: number;
  exchange?: string;
  product?: string;
  quantity?: number;
  buy_quantity?: number;
  sell_quantity?: number;
  gross_quantity?: number;
  buy_price?: number;
  sell_price?: number;
  last_price?: number;
  pnl?: number;
  m2m?: number;
}

interface SquareOffResult {
  tradingsymbol?: string;
  quantity?: number;
  status?: string;
  order_id?: string;
  message?: string;
}

interface LiveTradePreview {
  instrument: string;
  optionSymbol: string;
  optionType: string;
  expiryDate: string;
  strike: number;
  spotPrice: number;
  optionLtp: number;
  stopLossPrice: number;
  targetPrice: number;
  lotSize: number;
  lotCount: number;
  totalQuantity: number;
  requiredCapital: number;
  stopLossPercent: number;
  stopLossPercentDisplay: number;
  targetPercent: number;
  targetPercentDisplay: number;
}

interface LiveDeploymentState {
  phase?: string;
  message?: string;
  lastCheck?: string;
  orders?: LiveOrder[];
  positions?: LivePosition[];
  margin?: {
    availableCash?: number;
    snapshot?: Record<string, unknown>;
    requiredCapital?: number;
  };
  livePnl?: number;
  history?: HistoryEntry[];
  squareOff?: SquareOffResult[];
  config?: {
    lotCount?: number;
    lotSize?: number;
    totalQuantity?: number;
    optionSymbol?: string;
    stopLossPercent?: number;
    targetPercent?: number;
    evaluationSecondsBeforeClose?: number;
    candleIntervalMinutes?: number;
  };
  openOrdersCount?: number;
  openPositionsCount?: number;
  lastEvaluationTarget?: string;
  auditCursor?: number;
  currentLtp?: number;
  eventStats?: {
    signalsIdentified?: number;
    signalsIgnored?: number;
    tradeEntries?: number;
    tradeExits?: number;
    stopLoss?: number;
    targetHit?: number;
  };
  strategyInsights?: {
    signalStatus?: string;
    currentMessage?: string;
    position?: number;
    tradedInstrument?: string;
    entryPrice?: number;
    stopLossLevel?: number;
    targetLevel?: number;
    pnl?: number;
    currentLtp?: number;
    [key: string]: any;
  };
}

interface LiveDeployment {
  id: number;
  userId: number;
  strategyId: number | null;
  strategyName: string | null;
  status: string;
  initialInvestment: number;
  scheduledStart: string | null;
  startedAt: string | null;
  lastRunAt: string | null;
  errorMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  state: LiveDeploymentState;
}

const LiveTradeContent: React.FC = () => {
  const [strategies, setStrategies] = useState<StrategyOption[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');
  const [lotCount, setLotCount] = useState<number>(1);
  const [scheduledStart, setScheduledStart] = useState<string>('');
  const [deployment, setDeployment] = useState<LiveDeployment | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusLoading, setStatusLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<LiveTradePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [testOrderLoading, setTestOrderLoading] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  // Replay/Simulation controls
  const [replayDate, setReplayDate] = useState<string>('');
  const [isReplayMode, setIsReplayMode] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentReplayTime, setCurrentReplayTime] = useState<string>('09:15:00');
  const [replayDuration, setReplayDuration] = useState<string>('15:30:00');
  const [replayProgress, setReplayProgress] = useState<number>(0);
  const replayIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const [currentLiveTime, setCurrentLiveTime] = useState<string>(new Date().toLocaleTimeString());
  const selectedStrategyRef = React.useRef<string>('');
  // Chart data for replay mode
  const [candleData, setCandleData] = useState<Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    ema5?: number;
    volume?: number;
    isCurrent?: boolean;
  }>>([]);
  const [chartLoading, setChartLoading] = useState<boolean>(false);
  const [isDeploySectionCollapsed, setIsDeploySectionCollapsed] = useState<boolean>(false);
  // Replay data state
  const [replaySignals, setReplaySignals] = useState<Array<any>>([]);
  const [replayIgnoredSignals, setReplayIgnoredSignals] = useState<Array<any>>([]);
  const [replayTrades, setReplayTrades] = useState<Array<any>>([]);
  const [replayHistory, setReplayHistory] = useState<Array<any>>([]);
  const [replayDataLoading, setReplayDataLoading] = useState<boolean>(false);

  const formatCurrency = useCallback((value?: number | null, fallback = '—') => {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return fallback;
    }
    return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }, []);

  const formatDateTime = useCallback((value?: string | null) => {
    if (!value) return '—';
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    } catch {
      return value;
    }
  }, []);

  // Helper functions for replay time calculations
  const timeToMinutes = useCallback((timeStr: string): number => {
    const [hours, minutes, seconds] = timeStr.split(':').map(Number);
    return hours * 60 + minutes + seconds / 60;
  }, []);

  const minutesToTime = useCallback((minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    const secs = Math.floor((minutes % 1) * 60);
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, []);

  const calculateProgress = useCallback((): number => {
    const startMinutes = timeToMinutes('09:15:00');
    const endMinutes = timeToMinutes('15:30:00');
    const currentMinutes = timeToMinutes(currentReplayTime);
    const totalMinutes = endMinutes - startMinutes;
    const elapsedMinutes = currentMinutes - startMinutes;
    return totalMinutes > 0 ? Math.max(0, Math.min(100, (elapsedMinutes / totalMinutes) * 100)) : 0;
  }, [currentReplayTime, timeToMinutes]);

  // Fetch historical candle data for replay date
  const fetchHistoricalCandles = useCallback(async (date: string, strategyId: string) => {
    if (!date || !strategyId) {
      setCandleData([]);
      return;
    }
    
    try {
      setChartLoading(true);
      const response = await fetch(
        apiUrl(`/api/live_trade/replay_candles?date=${date}&strategy_id=${strategyId}`),
        { credentials: 'include' }
      );
      
      const data = await response.json();
      
      if (response.ok && data.status === 'success') {
        if (data.candles && Array.isArray(data.candles) && data.candles.length > 0) {
          setCandleData(data.candles);
        } else {
          // No candles available for this date
          setCandleData([]);
          if (data.message) {
            console.info(data.message);
          }
        }
      } else {
        // Error response
        setCandleData([]);
        const errorMsg = data.message || 'Failed to fetch historical candles';
        console.error('Error fetching historical candles:', errorMsg);
        if (data.authExpired) {
          setError('Zerodha session expired. Please log in again.');
        }
      }
    } catch (err) {
      console.error('Error fetching historical candles:', err);
      setCandleData([]);
      setError('Failed to fetch historical candle data. Please try again.');
    } finally {
      setChartLoading(false);
    }
  }, []);

  // Replay control handlers
  const handleReplayDateChange = useCallback((date: string) => {
    setReplayDate(date);
    const selectedDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    selectedDate.setHours(0, 0, 0, 0);
    
    if (selectedDate < today) {
      setIsReplayMode(true);
      setCurrentReplayTime('09:15:00');
      setReplayProgress(0);
      // Fetch historical candles when date is selected
      if (selectedStrategy) {
        fetchHistoricalCandles(date, selectedStrategy);
      }
    } else {
      setIsReplayMode(false);
      setCandleData([]);
    }
  }, [selectedStrategy, fetchHistoricalCandles]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      // Pause
      if (replayIntervalRef.current) {
        clearInterval(replayIntervalRef.current);
        replayIntervalRef.current = null;
      }
      setIsPlaying(false);
    } else {
      // Play
      if (!isReplayMode || !replayDate) return;
      
      replayIntervalRef.current = setInterval(() => {
        setCurrentReplayTime((prevTime) => {
          const currentMinutes = timeToMinutes(prevTime);
          const endMinutes = timeToMinutes('15:30:00');
          
          if (currentMinutes >= endMinutes) {
            // Reached end, pause
            if (replayIntervalRef.current) {
              clearInterval(replayIntervalRef.current);
              replayIntervalRef.current = null;
            }
            setIsPlaying(false);
            return prevTime;
          }
          
          // Advance by 1 minute (or 5 minutes for 5-minute candles)
          const newMinutes = currentMinutes + 5;
          return minutesToTime(newMinutes);
        });
      }, 1000); // Update every second for smooth progress
      
      setIsPlaying(true);
    }
  }, [isPlaying, isReplayMode, replayDate, timeToMinutes, minutesToTime]);

  const handleSeek = useCallback((progress: number) => {
    const startMinutes = timeToMinutes('09:15:00');
    const endMinutes = timeToMinutes('15:30:00');
    const totalMinutes = endMinutes - startMinutes;
    const targetMinutes = startMinutes + (totalMinutes * progress / 100);
    setCurrentReplayTime(minutesToTime(targetMinutes));
    setReplayProgress(progress);
  }, [timeToMinutes, minutesToTime]);

  const handleFastForward = useCallback(() => {
    const currentMinutes = timeToMinutes(currentReplayTime);
    const endMinutes = timeToMinutes('15:30:00');
    const newMinutes = Math.min(endMinutes, currentMinutes + 5); // Jump 5 minutes forward
    setCurrentReplayTime(minutesToTime(newMinutes));
  }, [currentReplayTime, timeToMinutes, minutesToTime]);

  const handleRewind = useCallback(() => {
    const currentMinutes = timeToMinutes(currentReplayTime);
    const startMinutes = timeToMinutes('09:15:00');
    const newMinutes = Math.max(startMinutes, currentMinutes - 5); // Jump 5 minutes backward
    setCurrentReplayTime(minutesToTime(newMinutes));
  }, [currentReplayTime, timeToMinutes, minutesToTime]);

  // Find current candle index based on replay time
  const currentCandleIndex = useMemo(() => {
    if (!isReplayMode || candleData.length === 0) {
      return -1;
    }
    
    const [replayHour, replayMin] = currentReplayTime.split(':').map(Number);
    if (isNaN(replayHour) || isNaN(replayMin)) {
      return -1;
    }
    const replayMinutes = replayHour * 60 + replayMin;
    
    // Find the candle that matches the current replay time
    for (let i = 0; i < candleData.length; i++) {
      const candle = candleData[i];
      // Handle different time formats: "2025-11-17 09:15:00" or "09:15:00"
      const timeStr = candle.time.includes(' ') ? candle.time.split(' ')[1] : candle.time;
      const timeParts = timeStr.split(':');
      if (timeParts.length < 2) continue;
      
      const candleHour = parseInt(timeParts[0], 10);
      const candleMin = parseInt(timeParts[1], 10);
      if (isNaN(candleHour) || isNaN(candleMin)) continue;
      
      const candleMinutes = candleHour * 60 + candleMin;
      
      // Check if this candle's time matches or is closest to replay time (within 5 minutes)
      if (Math.abs(candleMinutes - replayMinutes) <= 5) {
        return i;
      }
    }
    
    // If no exact match, find the closest candle
    let closestIndex = 0;
    let minDiff = Infinity;
    for (let i = 0; i < candleData.length; i++) {
      const candle = candleData[i];
      const timeStr = candle.time.includes(' ') ? candle.time.split(' ')[1] : candle.time;
      const timeParts = timeStr.split(':');
      if (timeParts.length < 2) continue;
      
      const candleHour = parseInt(timeParts[0], 10);
      const candleMin = parseInt(timeParts[1], 10);
      if (isNaN(candleHour) || isNaN(candleMin)) continue;
      
      const candleMinutes = candleHour * 60 + candleMin;
      const diff = Math.abs(candleMinutes - replayMinutes);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }
    
    // Debug logging
    console.log('Current Candle Index:', closestIndex, 'Replay Time:', currentReplayTime, 'Candle Time:', candleData[closestIndex]?.time);
    
    return closestIndex;
  }, [currentReplayTime, isReplayMode, candleData]);

  // Update progress when time changes
  useEffect(() => {
    if (isReplayMode) {
      setReplayProgress(calculateProgress());
      // Update current candle highlight based on replay time
      if (candleData.length > 0) {
        setCandleData(prev => prev.map((candle, index) => {
          const candleTime = candle.time.split(' ')[1] || candle.time; // Extract time part
          const [candleHour, candleMin] = candleTime.split(':').map(Number);
          const [replayHour, replayMin] = currentReplayTime.split(':').map(Number);
          
          // Check if this candle matches the current replay time (within 5-minute window)
          const candleMinutes = candleHour * 60 + candleMin;
          const replayMinutes = replayHour * 60 + replayMin;
          const isCurrent = Math.abs(candleMinutes - replayMinutes) < 5;
          
          return { ...candle, isCurrent };
        }));
      }
    }
  }, [currentReplayTime, isReplayMode, calculateProgress, candleData.length]);
  
  // Fetch candles when strategy or replay date changes
  useEffect(() => {
    if (isReplayMode && replayDate && selectedStrategy) {
      fetchHistoricalCandles(replayDate, selectedStrategy);
    }
  }, [isReplayMode, replayDate, selectedStrategy, fetchHistoricalCandles]);

  // Fetch replay data (signals, trades, etc.) aligned with replay time
  const fetchReplayData = useCallback(async (date: string, strategyId: string, currentTime: string) => {
    if (!date || !strategyId || !currentTime) {
      setReplaySignals([]);
      setReplayIgnoredSignals([]);
      setReplayTrades([]);
      setReplayHistory([]);
      return;
    }
    
    try {
      setReplayDataLoading(true);
      const response = await fetch(
        apiUrl(`/api/live_trade/replay_data?date=${date}&strategy_id=${strategyId}&current_time=${currentTime}`),
        { credentials: 'include' }
      );
      
      const data = await response.json();
      
      if (response.ok && data.status === 'success') {
        setReplaySignals(data.signals || []);
        setReplayIgnoredSignals(data.signals_ignored || []);
        setReplayTrades(data.trades || []);
        setReplayHistory(data.history || []);
      } else {
        setReplaySignals([]);
        setReplayIgnoredSignals([]);
        setReplayTrades([]);
        setReplayHistory([]);
        console.error('Error fetching replay data:', data.message);
      }
    } catch (err) {
      console.error('Error fetching replay data:', err);
      setReplaySignals([]);
      setReplayIgnoredSignals([]);
      setReplayTrades([]);
      setReplayHistory([]);
    } finally {
      setReplayDataLoading(false);
    }
  }, []);

  // Fetch replay data when replay time changes
  useEffect(() => {
    if (isReplayMode && replayDate && selectedStrategy && currentReplayTime) {
      fetchReplayData(replayDate, selectedStrategy, currentReplayTime);
    }
  }, [isReplayMode, replayDate, selectedStrategy, currentReplayTime, fetchReplayData]);

  // Update live time when not in replay mode
  useEffect(() => {
    if (!isReplayMode) {
      const liveTimeInterval = setInterval(() => {
        setCurrentLiveTime(new Date().toLocaleTimeString());
      }, 1000);
      return () => clearInterval(liveTimeInterval);
    }
  }, [isReplayMode]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (replayIntervalRef.current) {
        clearInterval(replayIntervalRef.current);
      }
    };
  }, []);

  const statusBadgeClass = useMemo(() => {
    if (!deployment) return 'bg-secondary';
    switch (deployment.status) {
      case 'active':
        return 'bg-success';
      case 'scheduled':
        return 'bg-info text-dark';
      case 'paused':
        return 'bg-warning text-dark';
      case 'stopped':
        return 'bg-secondary';
      case 'error':
        return 'bg-danger';
      default:
        return 'bg-secondary';
    }
  }, [deployment]);

  const fetchStrategies = useCallback(async () => {
    try {
      // Show user's strategies (any status) and public strategies
      const response = await fetch(apiUrl('/api/strategies'), { credentials: 'include' });
      const data = await response.json();
      if (response.ok && data.status === 'success') {
        const list: StrategyOption[] = data.strategies || [];
        setStrategies(list);
        // Only clear selection if we have a list and the selected strategy is definitely not in it
        // Use ref to get current value without causing re-renders
        const currentSelected = selectedStrategyRef.current;
        if (list.length > 0 && currentSelected && !list.some((s) => String(s.id) === String(currentSelected))) {
          // Strategy no longer exists, clear it
          setSelectedStrategy('');
          setPreview(null);
          selectedStrategyRef.current = '';
        }
      } else {
        console.warn('Unable to fetch strategies:', data.message || response.statusText);
      }
    } catch (err) {
      console.error('Error fetching strategies:', err);
    }
  }, []); // Remove selectedStrategy from dependencies to prevent unnecessary re-renders

  // Fetch admin status
  useEffect(() => {
    (async () => {
      try {
        const response = await fetch(apiUrl('/api/admin/check'), { credentials: 'include' });
        const data = await response.json();
        if (response.ok) {
          setIsAdmin(Boolean(data.is_admin));
        }
      } catch {
        setIsAdmin(false);
      }
    })();
  }, []);

  const fetchPreview = useCallback(
    async (strategyId: string, lots: number) => {
      if (!strategyId || lots <= 0) {
        setPreview(null);
        return;
      }
      try {
        setPreviewLoading(true);
        const response = await fetch(apiUrl('/api/live_trade/preview'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            strategy_id: strategyId,
            lot_count: lots,
          }),
        });
        const data = await response.json();
        if (!response.ok || data.status !== 'success') {
          throw new Error(data.message || 'Unable to compute trade preview');
        }
        setPreview(data.preview as LiveTradePreview);
      } catch (err) {
      console.error('Preview fetch error:', err);
        setPreview(null);
      const msg =
        err instanceof Error ? err.message : 'Unable to compute required capital.';
      if (msg.toLowerCase().includes('not found')) {
        setError('Strategy not found or not approved for your account.');
      } else {
        setError(msg);
      }
      } finally {
        setPreviewLoading(false);
      }
    },
    []
  );

  const fetchDeploymentStatus = useCallback(async () => {
    try {
      setStatusLoading(true);
      const response = await fetch(apiUrl('/api/live_trade/status'), { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch live trade status');
      }
      setDeployment(data.deployment ?? null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Unable to fetch live trade status');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStrategies();
    fetchDeploymentStatus();
  }, [fetchStrategies, fetchDeploymentStatus]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchDeploymentStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchDeploymentStatus]);

  // Auto-select deployed strategy when deployment exists
  useEffect(() => {
    if (deployment && deployment.strategyId && strategies.length > 0) {
      const strategyIdStr = String(deployment.strategyId);
      // Only auto-select if the currently selected strategy doesn't match the deployed one
      if (selectedStrategy !== strategyIdStr) {
        // Check if the strategy exists in the list
        const strategyExists = strategies.some((s) => String(s.id) === strategyIdStr);
        if (strategyExists) {
          setSelectedStrategy(strategyIdStr);
          selectedStrategyRef.current = strategyIdStr;
          // Also set lot count from deployment config if available
          if (deployment.state?.config?.lotCount) {
            setLotCount(deployment.state.config.lotCount);
          }
        }
      }
    }
    // Don't clear selection when deployment is null - let user keep their selection
    // Only clear when deployment is explicitly cleared by user action
  }, [deployment?.strategyId, deployment?.id, strategies.length, selectedStrategy]);

  useEffect(() => {
    if (selectedStrategy) {
      fetchPreview(selectedStrategy, lotCount);
    } else {
      setPreview(null);
    }
  }, [selectedStrategy, lotCount, fetchPreview]);

  const handleDeploy = async () => {
    setError(null);
    setActionMessage(null);

    if (!selectedStrategy) {
      setError('Please select a strategy to deploy.');
      return;
    }
    if (lotCount <= 0) {
      setError('Lot count must be greater than zero.');
      return;
    }
    if (!preview) {
      setError('Unable to compute trade preview. Please try again.');
      return;
    }

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        strategy_id: selectedStrategy,
        lot_count: lotCount,
      };
      if (scheduledStart) {
        const isoString = new Date(scheduledStart).toISOString();
        payload.scheduled_start = isoString;
      }

      const response = await fetch(apiUrl('/api/live_trade/deploy'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to deploy strategy.');
      }
      setDeployment(data.deployment ?? null);
      setActionMessage('Strategy deployment initiated successfully.');
    } catch (err) {
      console.error('Deploy error:', err);
      setError(err instanceof Error ? err.message : 'Failed to deploy strategy.');
    } finally {
      setLoading(false);
    }
  };

  const handleTestOrder = async () => {
    if (!selectedStrategy) {
      setError('Select a strategy before placing a test order.');
      return;
    }
    if (!preview) {
      setError('Generate a trade preview before placing a test order.');
      return;
    }

    setTestOrderLoading(true);
    setError(null);
    setActionMessage(null);
    try {
      const response = await fetch(apiUrl('/api/live_trade/preview_order'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy_id: selectedStrategy,
          lot_count: lotCount,
          order_type: 'ENTRY',
        }),
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Test order failed.');
      }
      setActionMessage(`Test order placed successfully (Order ID: ${data.order.order_id}).`);
    } catch (err) {
      console.error('Test order error:', err);
      setError(err instanceof Error ? err.message : 'Test order failed.');
    } finally {
      setTestOrderLoading(false);
    }
  };

  const handleSimpleAction = async (endpoint: string, successMessage: string) => {
    setError(null);
    setActionMessage(null);
    setLoading(true);
    try {
      const response = await fetch(apiUrl(endpoint), {
        method: endpoint === '/api/live_trade/delete' ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Action failed.');
      }
      if (endpoint === '/api/live_trade/delete') {
        // Clear deployment and reset all components to fresh state
        setDeployment(null);
        setSelectedStrategy('');
        selectedStrategyRef.current = '';
        setPreview(null);
        setReplayDate('');
        setScheduledStart('');
        setLotCount(1);
        setIsReplayMode(false);
        setCurrentReplayTime('09:15:00');
        setReplayProgress(0);
        setCandleData([]);
        setIsPlaying(false);
        // Stop any replay interval if running
        if (replayIntervalRef.current) {
          clearInterval(replayIntervalRef.current);
          replayIntervalRef.current = null;
        }
      } else {
        setDeployment(data.deployment ?? null);
      }
      setActionMessage(successMessage);
    } catch (err) {
      console.error('Live action error:', err);
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSquareOff = async () => {
    setError(null);
    setActionMessage(null);
    setLoading(true);
    try {
      const response = await fetch(apiUrl('/api/live_trade/square_off'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Square-off failed.');
      }
      setDeployment(data.deployment ?? null);
      setActionMessage('Square-off requested. Review order status for confirmation.');
    } catch (err) {
      console.error('Square-off error:', err);
      setError(err instanceof Error ? err.message : 'Square-off failed.');
    } finally {
      setLoading(false);
    }
  };

  const currentPhase = deployment?.state?.phase || 'idle';
  const history: HistoryEntry[] = Array.isArray(deployment?.state?.history)
    ? (deployment?.state?.history as HistoryEntry[])
    : [];
  const categorizedHistory = useMemo(() => {
    const buckets = {
      signalsIdentified: [] as HistoryEntry[],
      signalsIgnored: [] as HistoryEntry[],
      trades: [] as HistoryEntry[],
    };
    history.forEach((entry) => {
      const category = (entry.category || '').toLowerCase();
      if (!category) {
        return;
      }
      if (category === 'signal_ignored') {
        buckets.signalsIgnored.push(entry);
      } else if (category.startsWith('signal')) {
        buckets.signalsIdentified.push(entry);
      } else if (category.startsWith('trade')) {
        buckets.trades.push(entry);
      }
    });
    return buckets;
  }, [history]);
  const { signalsIdentified, signalsIgnored, trades } = categorizedHistory;
  const strategyInsights =
    (deployment?.state?.strategyInsights as { [key: string]: any }) || undefined;
  const signalStatusText =
    strategyInsights && typeof strategyInsights.signalStatus === 'string'
      ? (strategyInsights.signalStatus as string)
      : undefined;
  const strategyMessageText =
    strategyInsights && typeof strategyInsights.currentMessage === 'string'
      ? (strategyInsights.currentMessage as string)
      : undefined;
  
  // Process signals for table display (similar to paper trade)
  const processedIgnoredSignals = useMemo(() => {
    const allIgnored = isReplayMode ? replayIgnoredSignals : signalsIgnored;
    return allIgnored.map((entry, idx) => {
      const meta = entry.meta || {};
      const timestamp = entry.timestamp || meta.timestamp || meta.candleTime;
      return {
        index: idx + 1,
        signalTime: timestamp ? new Date(timestamp) : null,
        signalType: meta.signalType || entry.type || 'PE',
        signalHigh: meta.signalHigh || meta.signal_high || 0,
        signalLow: meta.signalLow || meta.signal_low || 0,
        rsiValue: meta.rsiValue || meta.rsi_value || null,
        reason: entry.message || entry.reason || meta.reason || 'Signal ignored',
      };
    });
  }, [isReplayMode, replayIgnoredSignals, signalsIgnored]);

  const processedWaitingSignals = useMemo(() => {
    const allSignals = isReplayMode ? replaySignals : signalsIdentified;
    // Get current LTP from strategy insights or deployment state
    const currentLtp = strategyInsights?.currentLtp || 
                      deployment?.state?.strategyInsights?.currentLtp || 
                      deployment?.state?.currentLtp || 0;
    
    return allSignals
      .filter(entry => {
        // Only show signals that are waiting for entry (not yet entered)
        const meta = entry.meta || {};
        // Check if this signal has been entered (would have a trade entry event)
        const hasEntry = trades.some(t => {
          const tradeMeta = t.meta || {};
          return tradeMeta.signalType === (meta.signalType || entry.type) &&
                 tradeMeta.candleTime === (meta.candleTime || meta.timestamp);
        });
        return !hasEntry;
      })
      .map((entry, idx) => {
        const meta = entry.meta || {};
        const timestamp = entry.timestamp || meta.timestamp || meta.candleTime;
        const signalType = meta.signalType || entry.type || 'PE';
        const signalHigh = meta.signalHigh || meta.signal_high || 0;
        const signalLow = meta.signalLow || meta.signal_low || 0;
        const breakLevel = signalType === 'PE' ? signalLow : signalHigh;
        const currentClose = currentLtp || meta.price || 0;
        const gap = signalType === 'PE' 
          ? currentClose - breakLevel 
          : breakLevel - currentClose;
        const gapPercent = breakLevel > 0 ? (gap / breakLevel) * 100 : 0;
        
        return {
          index: idx + 1,
          signalTime: timestamp ? new Date(timestamp) : null,
          signalType,
          signalHigh,
          signalLow,
          breakLevel,
          currentClose,
          gap,
          gapPercent,
          rsiValue: meta.rsiValue || meta.rsi_value || null,
          emaValue: meta.emaValue || meta.ema_value || 0,
        };
      });
  }, [isReplayMode, replaySignals, signalsIdentified, trades, deployment, strategyInsights]);

  const recentSignals = signalsIdentified.slice(-5).reverse();
  const recentIgnoredSignals = signalsIgnored.slice(-5).reverse();
  const recentTrades = trades.slice(-5).reverse();
  const orders: LiveOrder[] = Array.isArray(deployment?.state?.orders)
    ? (deployment?.state?.orders as LiveOrder[])
    : [];
  const pendingOrders = useMemo(
    () =>
      orders.filter((o) =>
        ['OPEN', 'TRIGGER PENDING', 'AMO REQ RECEIVED', 'VALIDATION PENDING', 'PUT ORDER REQUEST RECEIVED']
          .includes((o.status || '').toUpperCase())
      ),
    [orders],
  );
  const executedOrders = useMemo(
    () => orders.filter((o) => ['COMPLETE', 'CANCELLED', 'REJECTED'].includes((o.status || '').toUpperCase())),
    [orders],
  );
  const rawPositions = deployment?.state?.positions;
  const positions: LivePosition[] = Array.isArray(rawPositions)
    ? (rawPositions as LivePosition[])
    : [];
  const openPositionsCount = positions.length || deployment?.state?.openPositionsCount || 0;
  const squareOffResults = Array.isArray(deployment?.state?.squareOff)
    ? (deployment?.state?.squareOff as SquareOffResult[])
    : [];
  const availableCash = deployment?.state?.margin?.availableCash;
  const requiredCapital = preview?.requiredCapital ?? deployment?.state?.margin?.requiredCapital;
  const config = deployment?.state?.config ?? {};
  const evaluationSeconds = config.evaluationSecondsBeforeClose ?? 20;
  const candleInterval = config.candleIntervalMinutes ?? 5;
  const stopLossDisplay = preview
    ? preview.stopLossPercentDisplay
    : config.stopLossPercent
      ? Math.abs(config.stopLossPercent) * 100
      : null;
  const targetDisplay = preview
    ? preview.targetPercentDisplay
    : config.targetPercent
      ? Math.abs(config.targetPercent) * 100
      : null;

  return (
    <div className="container-fluid py-3">
      <div className="row g-3">
        <div 
          className={isDeploySectionCollapsed ? 'col-lg-1' : 'col-lg-4'}
          style={{
            transition: 'all 0.3s ease-in-out',
            overflow: 'hidden'
          }}
        >
          <div className="card border-0 shadow-sm h-100">
            <div className="card-header bg-dark text-white d-flex justify-content-between align-items-center">
              {!isDeploySectionCollapsed && (
                <h5 className="mb-0">
                  <i className="bi bi-rocket-takeoff me-2"></i>
                  Deploy Live Strategy
                </h5>
              )}
              <button
                className="btn btn-sm btn-outline-light"
                onClick={() => setIsDeploySectionCollapsed(!isDeploySectionCollapsed)}
                title={isDeploySectionCollapsed ? 'Expand section' : 'Collapse section'}
                style={{ marginLeft: isDeploySectionCollapsed ? 'auto' : '0' }}
              >
                <i className={`bi ${isDeploySectionCollapsed ? 'bi-chevron-right' : 'bi-chevron-left'}`}></i>
              </button>
            </div>
            {!isDeploySectionCollapsed && (
            <div className="card-body">
              <div className="mb-3">
                <label htmlFor="strategy-select" className="form-label fw-semibold">
                  Strategy
                </label>
                <select
                  id="strategy-select"
                  className="form-select"
                  value={selectedStrategy}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedStrategy(value);
                    selectedStrategyRef.current = value;
                  }}
                >
                  <option value="">Select a strategy</option>
                  {strategies.map((strategy) => (
                    <option key={strategy.id} value={strategy.id}>
                      {strategy.strategy_name} ({strategy.instrument})
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-3">
                <label htmlFor="lot-count-input" className="form-label fw-semibold">
                  Quantity (Lots)
                </label>
                <input
                  id="lot-count-input"
                  type="number"
                  min={1}
                  step={1}
                  className="form-control"
                  value={lotCount}
                  onChange={(e) => setLotCount(Number(e.target.value))}
                />
                <div className="form-text">
                  Lot size depends on the selected strategy (e.g., BankNifty 35 qty per lot).
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label fw-semibold d-flex align-items-center">
                  Trade Preview
                  {previewLoading && (
                    <span className="spinner-border spinner-border-sm ms-2" role="status" />
                  )}
                </label>
                {preview ? (
                  <div className="bg-light rounded p-3 small">
                    <div className="d-flex justify-content-between">
                      <span>Option Symbol</span>
                      <span className="fw-semibold">{preview.optionSymbol}</span>
                    </div>
                    <div className="d-flex justify-content-between">
                      <span>Strike / Expiry</span>
                      <span>{preview.strike} · {new Date(preview.expiryDate).toLocaleDateString()}</span>
                    </div>
                    <div className="d-flex justify-content-between">
                      <span>Option LTP</span>
                      <span>{preview.optionLtp.toFixed(2)}</span>
                    </div>
                    <div className="d-flex justify-content-between">
                      <span>Lot Size x Lots</span>
                      <span>{preview.lotSize} × {preview.lotCount} = {preview.totalQuantity}</span>
                    </div>
                    <div className="d-flex justify-content-between">
                      <span>Required Capital</span>
                      <span className="fw-semibold text-primary">
                        {formatCurrency(preview.requiredCapital)}
                      </span>
                    </div>
                    <div className="d-flex justify-content-between">
                      <span>Stop Loss</span>
                      <span>{preview.stopLossPercentDisplay.toFixed(2)}% (₹{preview.stopLossPrice.toFixed(2)})</span>
                    </div>
                    <div className="d-flex justify-content-between">
                      <span>Target</span>
                      <span>{preview.targetPercentDisplay.toFixed(2)}% (₹{preview.targetPrice.toFixed(2)})</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted small">
                    Select a strategy to view strike, lot size, and capital requirements.
                  </div>
                )}
              </div>

              <div className="mb-3">
                {isAdmin ? (
                  <>
                    <button
                      className="btn btn-outline-primary w-100"
                      disabled={testOrderLoading || !preview}
                      onClick={handleTestOrder}
                    >
                      {testOrderLoading ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status" />
                          Placing Test Order...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-lightning-charge me-2"></i>
                          Place Test Order
                        </>
                      )}
                    </button>
                    <div className="form-text">
                      Sends a market MIS order using the previewed lot size and option symbol.
                    </div>
                  </>
                ) : (
                  <div className="alert alert-secondary py-2 mb-0">
                    <i className="bi bi-shield-lock me-2"></i>
                    Test order is available to admin users only.
                  </div>
                )}
              </div>

              <div className="mb-3">
                <label htmlFor="replay-date-input" className="form-label fw-semibold">
                  <i className="bi bi-calendar3 me-2"></i>
                  Replay Past Trading Date (optional)
                </label>
                <input
                  id="replay-date-input"
                  type="date"
                  className="form-control"
                  value={replayDate}
                  onChange={(e) => handleReplayDateChange(e.target.value)}
                  max={new Date().toISOString().split('T')[0]} // Can't select future dates
                />
                <div className="form-text">
                  {isReplayMode 
                    ? 'Replay mode: Select a past date to simulate trading for that day.'
                    : 'Select a past trading date to replay and optimize your strategy.'}
                </div>
              </div>

              <div className="mb-3">
                <label htmlFor="schedule-input" className="form-label fw-semibold">
                  Schedule Start (optional)
                </label>
                <input
                  id="schedule-input"
                  type="datetime-local"
                  className="form-control"
                  value={scheduledStart}
                  onChange={(e) => setScheduledStart(e.target.value)}
                  disabled={isReplayMode}
                />
                <div className="form-text">
                  {isReplayMode 
                    ? 'Scheduling is disabled in replay mode.'
                    : 'If left blank, deployment starts immediately.'}
                </div>
              </div>

              <div className="d-grid gap-2">
                <button
                  className="btn btn-primary"
                  disabled={loading}
                  onClick={handleDeploy}
                >
                  {loading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" />
                      Deploying...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-play-circle me-2"></i>
                      Deploy Strategy
                    </>
                  )}
                </button>
              </div>

              <hr />

              <div className="d-grid gap-2">
                <button
                  className="btn btn-outline-warning"
                  disabled={!deployment || loading}
                  onClick={() => handleSimpleAction('/api/live_trade/pause', 'Deployment paused.')}
                >
                  <i className="bi bi-pause-circle me-2"></i>
                  Pause
                </button>
                <button
                  className="btn btn-outline-success"
                  disabled={!deployment || loading}
                  onClick={() => handleSimpleAction('/api/live_trade/resume', 'Deployment resumed.')}
                >
                  <i className="bi bi-play-btn me-2"></i>
                  Resume
                </button>
                <button
                  className="btn btn-outline-danger"
                  disabled={!deployment || loading}
                  onClick={() => handleSimpleAction('/api/live_trade/stop', 'Deployment stopped.')}
                >
                  <i className="bi bi-stop-circle me-2"></i>
                  Stop
                </button>
                <button
                  className="btn btn-outline-secondary"
                  disabled={!deployment || loading}
                  onClick={handleSquareOff}
                >
                  <i className="bi bi-arrow-repeat me-2"></i>
                  Square Off
                </button>
                <button
                  className="btn btn-outline-dark"
                  disabled={!deployment || loading}
                  onClick={() => handleSimpleAction('/api/live_trade/delete', 'Deployment record cleared.')}
                >
                  <i className="bi bi-trash3 me-2"></i>
                  Clear Deployment
                </button>
              </div>

              {(error || actionMessage) && (
                <div className="mt-3">
                  {error && (
                    <div className="alert alert-danger" role="alert">
                      <i className="bi bi-exclamation-triangle me-2"></i>
                      {error}
                    </div>
                  )}
                  {actionMessage && (
                    <div className="alert alert-success" role="alert">
                      <i className="bi bi-check-circle me-2"></i>
                      {actionMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
          </div>
        </div>

        <div className={isDeploySectionCollapsed ? 'col-lg-11' : 'col-lg-8'}>
          <div className="card border-0 shadow-sm h-100">
            <div className="card-header bg-secondary text-white d-flex justify-content-between align-items-center">
              <h5 className="mb-0">
                <i className="bi bi-activity me-2"></i>
                Live Trade Status
              </h5>
              {statusLoading && (
                <span className="spinner-border spinner-border-sm" role="status" />
              )}
            </div>
            <div className="card-body">
              {!deployment ? (
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-info-circle display-6 d-block mb-3"></i>
                  <p className="mb-0">
                    No live deployment detected. Configure a strategy and click <strong>Deploy Strategy</strong>.
                  </p>
                </div>
              ) : (
                <>
                  {/* Media Player Controls - Always visible when deployment exists */}
                  <div className="card bg-light mb-4">
                    <div className="card-body">
                      <div className="d-flex align-items-center justify-content-between mb-3">
                        <h6 className="mb-0">
                          <i className={`bi ${isReplayMode ? 'bi-clock-history' : 'bi-play-circle'} me-2`}></i>
                          {isReplayMode ? 'Replay Mode' : 'Live Mode'}
                          {replayDate && (
                            <span className="badge bg-info ms-2">
                              {new Date(replayDate).toLocaleDateString()}
                            </span>
                          )}
                        </h6>
                      <div className="text-muted small">
                        {isReplayMode ? 'Simulating past trading day' : 'Live trading in progress'}
                      </div>
                    </div>
                    
                    {/* Progress Section - Only show in replay mode */}
                    {isReplayMode && (
                      <>
                        {/* Progress Bar (Seek Bar) */}
                        <div className="mb-3">
                          <input
                            type="range"
                            className="form-range"
                            min="0"
                            max="100"
                            step="0.1"
                            value={replayProgress}
                            onChange={(e) => handleSeek(Number(e.target.value))}
                          />
                          <div className="d-flex justify-content-between small text-muted">
                            <span>09:15 AM</span>
                            <span>03:30 PM</span>
                          </div>
                        </div>

                        {/* Control Buttons */}
                        <div className="d-flex align-items-center justify-content-center gap-2 mb-3">
                          <button
                            className="btn btn-sm btn-outline-secondary"
                            onClick={handleRewind}
                            disabled={currentReplayTime === '09:15:00'}
                            title="Rewind 5 minutes"
                          >
                            <i className="bi bi-skip-backward-fill"></i>
                          </button>
                          
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={handlePlayPause}
                            disabled={!replayDate}
                            title={isPlaying ? 'Pause' : 'Play'}
                          >
                            {isPlaying ? (
                              <i className="bi bi-pause-fill"></i>
                            ) : (
                              <i className="bi bi-play-fill"></i>
                            )}
                          </button>
                          
                          <button
                            className="btn btn-sm btn-outline-secondary"
                            onClick={handleFastForward}
                            disabled={currentReplayTime === '15:30:00'}
                            title="Fast forward 5 minutes"
                          >
                            <i className="bi bi-skip-forward-fill"></i>
                          </button>
                        </div>

                        {/* Time Display */}
                        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                          <div className="small">
                            <strong>Current Time:</strong>{' '}
                            <span className="text-primary">
                              {currentReplayTime}
                            </span>
                          </div>
                          <div className="small">
                            <strong>Duration:</strong>{' '}
                            <span className="text-muted">
                              {replayDuration}
                            </span>
                          </div>
                          <div className="small">
                            <strong>Progress:</strong>{' '}
                            <span className="text-muted">
                              {replayProgress.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                    </div>
                  </div>

                  {/* Candlestick Chart for Replay Mode */}
                  {isReplayMode && candleData.length > 0 && (
                    <div className="card mb-4">
                      <div className="card-header bg-primary text-white">
                        <h6 className="mb-0">
                          <i className="bi bi-bar-chart-fill me-2"></i>
                          Trading Day Candlestick Chart - {replayDate && new Date(replayDate).toLocaleDateString()}
                        </h6>
                      </div>
                      <div className="card-body">
                        {chartLoading ? (
                          <div className="text-center py-5">
                            <span className="spinner-border spinner-border-sm me-2" role="status" />
                            Loading chart data...
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height={400}>
                            <ComposedChart data={candleData} margin={{ top: 10, right: 30, left: 20, bottom: 60 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                              <XAxis 
                                dataKey="time" 
                                angle={-45}
                                textAnchor="end"
                                height={80}
                                interval="preserveStartEnd"
                                tick={{ fontSize: 10 }}
                              />
                              <YAxis 
                                yAxisId="price"
                                domain={['auto', 'auto']}
                                label={{ value: 'Price', angle: -90, position: 'insideLeft' }}
                              />
                              <Tooltip 
                                content={({ active, payload }) => {
                                  if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                      <div className="bg-white border rounded p-2 shadow">
                                        <p className="mb-1"><strong>Time:</strong> {data.time}</p>
                                        <p className="mb-1"><strong>Open:</strong> ₹{data.open?.toFixed(2)}</p>
                                        <p className="mb-1"><strong>High:</strong> ₹{data.high?.toFixed(2)}</p>
                                        <p className="mb-1"><strong>Low:</strong> ₹{data.low?.toFixed(2)}</p>
                                        <p className="mb-1"><strong>Close:</strong> ₹{data.close?.toFixed(2)}</p>
                                        {data.ema5 && <p className="mb-0"><strong>EMA5:</strong> ₹{data.ema5.toFixed(2)}</p>}
                                        {data.isCurrent && (
                                          <p className="mb-0 mt-1 text-primary"><strong>Current Candle</strong></p>
                                        )}
                                      </div>
                                    );
                                  }
                                  return null;
                                }}
                              />
                              <Legend />
                              {/* Price lines - High, Low, Open, Close */}
                              <Line
                                yAxisId="price"
                                type="monotone"
                                dataKey="high"
                                stroke="#888"
                                strokeWidth={1}
                                dot={false}
                                name="High"
                                connectNulls
                              />
                              <Line
                                yAxisId="price"
                                type="monotone"
                                dataKey="low"
                                stroke="#888"
                                strokeWidth={1}
                                dot={false}
                                name="Low"
                                connectNulls
                              />
                              <Line
                                yAxisId="price"
                                type="monotone"
                                dataKey="open"
                                stroke="#28a745"
                                strokeWidth={2}
                                dot={{ r: 3, fill: '#28a745' }}
                                name="Open"
                                connectNulls
                              />
                              <Line
                                yAxisId="price"
                                type="monotone"
                                dataKey="close"
                                stroke="#dc3545"
                                strokeWidth={3}
                                dot={{ r: 4, fill: '#dc3545' }}
                                name="Close"
                                connectNulls
                              />
                              {/* EMA5 line */}
                              {candleData.some(c => c.ema5) && (
                                <Line
                                  yAxisId="price"
                                  type="monotone"
                                  dataKey="ema5"
                                  stroke="#ff7300"
                                  strokeWidth={2}
                                  dot={false}
                                  name="EMA 5"
                                  connectNulls
                                />
                              )}
                              {/* Moving vertical line that tracks replay time */}
                              {currentCandleIndex >= 0 && currentCandleIndex < candleData.length && (
                                <ReferenceLine
                                  x={candleData[currentCandleIndex].time}
                                  stroke="#ff0000"
                                  strokeWidth={4}
                                  strokeDasharray="0"
                                  label={{ 
                                    value: `▶ ${currentReplayTime}`, 
                                    position: 'insideTop',
                                    fill: '#ff0000',
                                    fontSize: 14,
                                    fontWeight: 'bold',
                                    offset: 10
                                  }}
                                />
                              )}
                            </ComposedChart>
                          </ResponsiveContainer>
                        )}
                        <div className="mt-2 small text-muted">
                          <i className="bi bi-info-circle me-1"></i>
                          Chart shows 5-minute candles. The <span className="text-danger fw-bold">red vertical line</span> moves with replay time.
                          {currentCandleIndex >= 0 && currentCandleIndex < candleData.length && (
                            <span className="text-primary ms-2">
                              <strong>Current Candle:</strong> {candleData[currentCandleIndex].time} | 
                              <strong className="ms-2">Replay Time:</strong> {currentReplayTime} | 
                              <strong className="ms-2">Index:</strong> {currentCandleIndex + 1}/{candleData.length}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="row g-3 mb-3">
                    <div className="col-md-6">
                      <div className="p-3 bg-light rounded h-100">
                        <h6 className="fw-semibold">
                          Strategy Details & Deployment Status
                          {isReplayMode && (
                            <span className="badge bg-warning text-dark ms-2">
                              REPLAY MODE
                            </span>
                          )}
                        </h6>
                        <p className="mb-1">
                          <strong>Strategy:</strong>{' '}
                          {deployment.strategyName || 'N/A'}
                        </p>
                        <p className="mb-1">
                          <strong>Status:</strong>{' '}
                          {isReplayMode ? (
                            <span className="badge bg-info">
                              REPLAY: {replayDate} {currentReplayTime}
                            </span>
                          ) : (
                            <span className={`badge ${statusBadgeClass}`}>
                              {deployment.status.toUpperCase()}
                            </span>
                          )}
                        </p>
                        <p className="mb-1">
                          <strong>Lots × Lot Size:</strong>{' '}
                          {config.lotCount && config.lotSize
                            ? `${config.lotCount} × ${config.lotSize} = ${config.totalQuantity ?? config.lotCount * config.lotSize}`
                            : '—'}
                        </p>
                      <p className="mb-1">
                        <strong>Scheduled Start:</strong>{' '}
                        {isReplayMode ? (
                          <span className="text-info">
                            {replayDate} {scheduledStart || '09:15:00'}
                          </span>
                        ) : (
                          deployment.scheduledStart
                            ? formatDateTime(deployment.scheduledStart)
                            : '—'
                        )}
                      </p>
                      <p className="mb-0">
                        <strong>Started:</strong>{' '}
                        {isReplayMode ? (
                          <span className="text-info">
                            Replay started at {currentReplayTime}
                          </span>
                        ) : (
                          deployment.startedAt
                            ? formatDateTime(deployment.startedAt)
                            : deployment.status === 'SCHEDULED'
                              ? 'Pending start'
                              : deployment.status === 'ACTIVE'
                                ? 'Starting...'
                                : '—'
                        )}
                      </p>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="p-3 bg-light rounded h-100">
                        <h6 className="fw-semibold">
                          Evaluation & Runtime Summary
                          {isReplayMode && (
                            <span className="badge bg-info ms-2">
                              {replayDate} {currentReplayTime}
                            </span>
                          )}
                        </h6>
                        <p className="mb-1">
                          <strong>Phase:</strong>{' '}
                          {isReplayMode ? 'REPLAY' : currentPhase}
                        </p>
                        <p className="mb-1">
                          <strong>Message:</strong>{' '}
                          {isReplayMode 
                            ? `Replaying historical data up to ${currentReplayTime}`
                            : deployment.state?.message || '—'}
                        </p>
                        <p className="mb-1">
                          <strong>Last Check:</strong>{' '}
                          {isReplayMode 
                            ? `${replayDate} ${currentReplayTime}`
                            : formatDateTime(deployment.state?.lastCheck)}
                        </p>
                        <p className="mb-1">
                          <strong>Candle Interval:</strong>{' '}
                          {candleInterval} min
                        </p>
                        <p className="mb-1">
                          <strong>Signal Evaluation:</strong>{' '}
                          {evaluationSeconds}s before close
                        </p>
                        {!isReplayMode && (
                          <>
                            <p className="mb-1">
                              <strong>Available Cash:</strong>{' '}
                              {formatCurrency(availableCash)}
                            </p>
                            <p className="mb-1">
                              <strong>Required Capital:</strong>{' '}
                              {formatCurrency(requiredCapital)}
                            </p>
                            <p className="mb-1">
                              <strong>Stop Loss / Target:</strong>{' '}
                              {stopLossDisplay !== null && targetDisplay !== null
                                ? `${stopLossDisplay.toFixed(2)}% / ${targetDisplay.toFixed(2)}%`
                                : '—'}
                            </p>
                            <p className="mb-1">
                              <strong>Live P&L:</strong>{' '}
                              <span
                                className={
                                  (deployment.state?.livePnl ?? 0) >= 0
                                    ? 'text-success fw-semibold'
                                    : 'text-danger fw-semibold'
                                }
                              >
                                {formatCurrency(deployment.state?.livePnl)}
                              </span>
                            </p>
                          </>
                        )}
                        {signalStatusText && !isReplayMode && (
                          <p className="mb-1">
                            <strong>Signal:</strong> {signalStatusText}
                          </p>
                        )}
                        {strategyMessageText && !isReplayMode && (
                          <p className="mb-0 text-muted small">
                            {strategyMessageText}
                          </p>
                        )}
                        {isReplayMode && (
                          <p className="mb-0 text-info small">
                            <i className="bi bi-info-circle me-1"></i>
                            All data shown is filtered up to the current replay time.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {deployment.errorMessage && (
                    <div className="alert alert-danger">
                      <i className="bi bi-x-octagon me-2"></i>
                      {deployment.errorMessage}
                    </div>
                  )}

                  {/* Ignored Signals Table */}
                  {processedIgnoredSignals.length > 0 && (
                    <div className="card border-0 shadow-sm mb-4">
                      <div className="card-header bg-warning text-dark">
                        <h5 className="card-title mb-0 d-flex align-items-center">
                          <i className="bi bi-exclamation-triangle me-2"></i>
                          Ignored Signals (RSI Condition Not Met)
                          {isReplayMode && (
                            <span className="badge bg-info ms-2">
                              Replay: {replayDate} {currentReplayTime}
                            </span>
                          )}
                        </h5>
                      </div>
                      <div className="card-body">
                        {replayDataLoading ? (
                          <p className="text-muted small mb-0">
                            <span className="spinner-border spinner-border-sm me-2" role="status" />
                            Loading replay data...
                          </p>
                        ) : (
                          <div className="table-responsive" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                            <table className="table table-hover table-striped mb-0">
                              <thead className="table-warning" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
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
                                {processedIgnoredSignals.map((signal) => (
                                  <tr key={`ignored-${signal.index}`}>
                                    <td><strong>{signal.index}</strong></td>
                                    <td>
                                      {signal.signalTime 
                                        ? new Date(signal.signalTime).toLocaleString()
                                        : 'N/A'}
                                    </td>
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
                        )}
                      </div>
                    </div>
                  )}

                  {/* Signals Identified - Waiting for Trade Entry */}
                  {processedWaitingSignals.length > 0 && (
                    <div className="card border-0 shadow-sm mb-4">
                      <div className="card-header bg-primary text-white">
                        <h5 className="card-title mb-0 d-flex align-items-center">
                          <i className="bi bi-clock-history me-2"></i>
                          Signals Identified — Waiting for Trade Entry
                          {isReplayMode && (
                            <span className="badge bg-info ms-2">
                              Replay: {replayDate} {currentReplayTime}
                            </span>
                          )}
                        </h5>
                        <small className="text-white-50">
                          Valid signals identified but entry condition not yet triggered (evaluated 20s before 5-min candle close)
                        </small>
                      </div>
                      <div className="card-body">
                        {replayDataLoading ? (
                          <p className="text-muted small mb-0">
                            <span className="spinner-border spinner-border-sm me-2" role="status" />
                            Loading replay data...
                          </p>
                        ) : (
                          <>
                            <div className="table-responsive" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                              <table className="table table-hover table-striped mb-0">
                                <thead className="table-primary" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
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
                                  {processedWaitingSignals.map((signal) => (
                                    <tr key={`waiting-${signal.index}`}>
                                      <td><strong>{signal.index}</strong></td>
                                      <td>
                                        {signal.signalTime 
                                          ? new Date(signal.signalTime).toLocaleString()
                                          : 'N/A'}
                                      </td>
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
                                        <span className={signal.gap > 0 ? 'text-warning' : 'text-success fw-bold'}>
                                          {signal.gap > 0 ? '+' : ''}{signal.gap.toFixed(2)} ({signal.gapPercent.toFixed(2)}%)
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
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="alert alert-info mb-0 mt-2">
                              <i className="bi bi-info-circle me-2"></i>
                              <strong>Note:</strong> These signals meet all criteria (EMA + RSI) but are waiting for the entry trigger:
                              <ul className="mb-0 mt-2">
                                <li><strong>PE Signals:</strong> Waiting for next candle to close below signal low (evaluated 20s before 5-min candle close)</li>
                                <li><strong>CE Signals:</strong> Waiting for next candle to close above signal high (evaluated 20s before 5-min candle close)</li>
                              </ul>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mb-4">
                    <h6 className="fw-semibold d-flex align-items-center">
                      <i className="bi bi-check2-circle me-2"></i>
                      Executed Trades
                      {isReplayMode && (
                        <span className="badge bg-info ms-2">
                          Replay: {replayDate} {currentReplayTime}
                        </span>
                      )}
                    </h6>
                    {replayDataLoading ? (
                      <p className="text-muted small mb-0">
                        <span className="spinner-border spinner-border-sm me-2" role="status" />
                        Loading replay data...
                      </p>
                    ) : (isReplayMode ? replayTrades.length === 0 : trades.length === 0) ? (
                      <p className="text-muted small mb-0">No option trades yet.</p>
                    ) : (
                      <ul className="list-unstyled small mb-0">
                        {(isReplayMode ? replayTrades : recentTrades).map((entry, idx) => (
                          <li key={`trade-${idx}`} className="mb-2">
                            <div className="fw-semibold">
                              {entry.message || `${entry.type || 'Trade'} event`}
                            </div>
                            <div className="text-muted">
                              {isReplayMode 
                                ? new Date(entry.timestamp || entry.candle_time).toLocaleString()
                                : formatDateTime(entry.timestamp)}
                            </div>
                            {isReplayMode && entry.data && (
                              <div className="text-muted small">
                                {entry.data.entry_price && `Entry: ₹${entry.data.entry_price.toFixed(2)}`}
                                {entry.data.exit_price && ` | Exit: ₹${entry.data.exit_price.toFixed(2)}`}
                                {entry.data.pnl !== undefined && (
                                  <span className={entry.data.pnl >= 0 ? 'text-success' : 'text-danger'}>
                                    {' | P&L: ₹' + entry.data.pnl.toFixed(2)}
                                  </span>
                                )}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Exit Conditions Section - Only show when position is open */}
                  {deployment?.state?.strategyInsights?.position !== 0 && 
                   deployment?.state?.strategyInsights?.exitConditions && (
                    <div className="mb-4">
                      <div className="card border-0 shadow-sm">
                        <div className="card-header bg-success text-white">
                          <h5 className="card-title mb-0 d-flex align-items-center">
                            <i className="bi bi-signpost-2 me-2"></i>
                            Trade Exit Conditions
                            {isReplayMode && (
                              <span className="badge bg-info ms-2">
                                Replay: {replayDate} {currentReplayTime}
                              </span>
                            )}
                          </h5>
                          <small className="text-white-50">
                            Conditions under which the current trade will exit (in priority order)
                          </small>
                        </div>
                        <div className="card-body">
                          <div className="table-responsive">
                            <table className="table table-hover table-striped mb-0">
                              <thead className="table-success" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                                <tr>
                                  <th style={{ width: '50px' }}>Priority</th>
                                  <th>Exit Type</th>
                                  <th>Exit Condition</th>
                                  <th style={{ width: '100px' }}>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(deployment.state.strategyInsights.exitConditions)
                                  .sort(([, a]: any, [, b]: any) => (a.priority || 999) - (b.priority || 999))
                                  .map(([key, condition]: [string, any]) => (
                                    <tr key={key}>
                                      <td>
                                        <span className="badge bg-secondary">
                                          #{condition.priority || '—'}
                                        </span>
                                      </td>
                                      <td>
                                        <strong>{condition.type || key}</strong>
                                        {condition.time && (
                                          <span className="text-muted ms-2">
                                            ({condition.time})
                                          </span>
                                        )}
                                      </td>
                                      <td>
                                        <small>{condition.condition || 'N/A'}</small>
                                      </td>
                                      <td>
                                        {condition.active ? (
                                          <span className="badge bg-success">Active</span>
                                        ) : (
                                          <span className="badge bg-secondary">Inactive</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="alert alert-info mb-0 mt-3">
                            <i className="bi bi-info-circle me-2"></i>
                            <strong>Note:</strong> Exit conditions are evaluated in priority order. The trade will exit when the first active condition is met.
                            <ul className="mb-0 mt-2">
                              <li><strong>Option-based exits:</strong> Based on option premium movement (Stop Loss: 17% below entry, Target: 45% above entry)</li>
                              <li><strong>Index-based exits:</strong> Based on index price action relative to signal candle and EMA</li>
                              <li><strong>Market Close:</strong> Automatic square-off at 3:15 PM regardless of other conditions</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mb-4">
                    <h6 className="fw-semibold d-flex align-items-center">
                      <i className="bi bi-clipboard-data me-2"></i>
                      Orders — Pending ({pendingOrders.length}) / Executed ({executedOrders.length})
                    </h6>
                    {orders.length === 0 ? (
                      <p className="text-muted mb-0">No orders observed yet.</p>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-sm table-bordered align-middle mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>Order ID</th>
                              <th>Status</th>
                              <th>Symbol</th>
                              <th>Type</th>
                              <th>Qty</th>
                              <th>Price</th>
                              <th>Avg Price</th>
                              <th>Timestamp</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orders.map((order) => (
                              <tr key={`${order.order_id}-${order.order_timestamp}`}>
                                <td>{order.order_id || '—'}</td>
                                <td>{order.status || '—'}</td>
                                <td>{order.tradingsymbol || '—'}</td>
                                <td>{order.transaction_type || '—'}</td>
                                <td>{order.quantity ?? '—'}</td>
                                <td>{order.price ?? '—'}</td>
                                <td>{order.average_price ?? '—'}</td>
                                <td>{order.order_timestamp || order.exchange_timestamp || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="mb-4">
                    <h6 className="fw-semibold d-flex align-items-center">
                      <i className="bi bi-diagram-3 me-2"></i>
                      Positions ({openPositionsCount})
                    </h6>
                    {openPositionsCount === 0 ? (
                      <p className="text-muted mb-0">No open positions.</p>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-sm table-bordered align-middle mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>Symbol</th>
                              <th>Exchange</th>
                              <th>Product</th>
                              <th>Quantity</th>
                              <th>Buy Price</th>
                              <th>Sell Price</th>
                              <th>Last Price</th>
                              <th>P&L</th>
                            </tr>
                          </thead>
                          <tbody>
                            {positions.map((position, idx) => (
                              <tr key={`${position.tradingsymbol}-${idx}`}>
                                <td>{position.tradingsymbol || '—'}</td>
                                <td>{position.exchange || '—'}</td>
                                <td>{position.product || '—'}</td>
                                <td>{position.quantity ?? '—'}</td>
                                <td>{position.buy_price ?? '—'}</td>
                                <td>{position.sell_price ?? '—'}</td>
                                <td>{position.last_price ?? '—'}</td>
                                <td
                                  className={
                                    (position.pnl ?? 0) >= 0
                                      ? 'text-success fw-semibold'
                                      : 'text-danger fw-semibold'
                                  }
                                >
                                  {position.pnl ?? '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {squareOffResults.length > 0 && (
                    <div className="mb-4">
                      <h6 className="fw-semibold d-flex align-items-center">
                        <i className="bi bi-arrow-repeat me-2"></i>
                        Square-off Requests
                      </h6>
                      <ul className="list-group list-group-flush">
                        {squareOffResults.map((result, idx) => (
                          <li key={`${result.tradingsymbol}-${idx}`} className="list-group-item">
                            <strong>{result.tradingsymbol || 'Unknown'}</strong> —{' '}
                            {result.status}{' '}
                            {result.order_id && <span>(Order ID: {result.order_id})</span>}
                            {result.message && (
                              <span className="text-muted ms-2">
                                {result.message}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <h6 className="fw-semibold d-flex align-items-center">
                      <i className="bi bi-journal-text me-2"></i>
                      Activity History
                      {isReplayMode && (
                        <span className="badge bg-info ms-2">
                          Replay: {replayDate} {currentReplayTime}
                        </span>
                      )}
                    </h6>
                    {replayDataLoading ? (
                      <p className="text-muted mb-0">
                        <span className="spinner-border spinner-border-sm me-2" role="status" />
                        Loading replay data...
                      </p>
                    ) : (isReplayMode ? replayHistory.length === 0 : history.length === 0) ? (
                      <p className="text-muted mb-0">No events logged yet.</p>
                    ) : (
                      <div 
                        className="border rounded"
                        style={{ 
                          maxHeight: '400px', 
                          overflowY: 'auto',
                          backgroundColor: '#f8f9fa'
                        }}
                      >
                        <ul className="list-group list-group-flush mb-0">
                          {(isReplayMode ? replayHistory : history).map((entry, idx) => (
                            <li key={`${entry.timestamp || entry.candle_time || idx}-${idx}`} className="list-group-item">
                              <div className="d-flex justify-content-between">
                                <span className="text-muted small">
                                  {isReplayMode 
                                    ? new Date(entry.timestamp || entry.candle_time).toLocaleString()
                                    : formatDateTime(entry.timestamp)}
                                </span>
                                <span className="badge bg-light text-dark text-uppercase">
                                  {(entry.category || entry.level || entry.type || 'info')
                                    .toString()
                                    .replace(/_/g, ' ')}
                                </span>
                              </div>
                              <div>{entry.message || 'Event recorded.'}</div>
                              {isReplayMode && entry.data && Object.keys(entry.data).length > 0 && (
                                <div className="text-muted small mt-1">
                                  <details>
                                    <summary className="text-primary" style={{ cursor: 'pointer' }}>
                                      View Details
                                    </summary>
                                    <pre className="mt-2 small bg-light p-2 rounded">
                                      {JSON.stringify(entry.data, null, 2)}
                                    </pre>
                                  </details>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveTradeContent;


