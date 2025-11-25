import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { apiUrl, SOCKET_BASE_URL } from '../config/api';
import { io, Socket } from 'socket.io-client';
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
  // Ref for state event table container to maintain scroll position
  const stateEventTableRef = useRef<HTMLDivElement | null>(null);
  const previousHistoryLengthRef = useRef<number>(0);
  const [replayDuration, setReplayDuration] = useState<string>('15:30:00');
  const [replayProgress, setReplayProgress] = useState<number>(0);
  const replayIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const [currentLiveTime, setCurrentLiveTime] = useState<string>(new Date().toLocaleTimeString());
  // State to force re-render every minute to update current candle in table
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  const [tableRefreshing, setTableRefreshing] = useState<boolean>(false);
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
  
  // Archived deployments
  const [archivedDeployments, setArchivedDeployments] = useState<Array<any>>([]);
  const [archivedLoading, setArchivedLoading] = useState<boolean>(false);
  const [showArchived, setShowArchived] = useState<boolean>(false);

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

  // Fetch archived deployments
  const fetchArchivedDeployments = useCallback(async () => {
    try {
      setArchivedLoading(true);
      const response = await fetch(
        apiUrl('/api/live_trade/archived?limit=50'),
        { credentials: 'include' }
      );
      
      if (!response.ok) {
        throw new Error('Failed to fetch archived deployments');
      }
      
      const data = await response.json();
      if (data.status === 'success') {
        setArchivedDeployments(data.archived_deployments || []);
      } else {
        throw new Error(data.message || 'Failed to fetch archived deployments');
      }
    } catch (error) {
      console.error('Error fetching archived deployments:', error);
      setArchivedDeployments([]);
    } finally {
      setArchivedLoading(false);
    }
  }, []);

  // Delete archived deployment (admin only)
  const handleDeleteArchived = useCallback(async (archiveId: number) => {
    try {
      const response = await fetch(
        apiUrl(`/api/live_trade/archived/${archiveId}`),
        {
          method: 'DELETE',
          credentials: 'include'
        }
      );
      
      const data = await response.json();
      
      if (response.ok && data.status === 'success') {
        setActionMessage('Archived deployment deleted successfully.');
        // Refresh the archived deployments list
        fetchArchivedDeployments();
      } else {
        setError(data.message || 'Failed to delete archived deployment');
      }
    } catch (error) {
      console.error('Error deleting archived deployment:', error);
      setError('Failed to delete archived deployment');
    }
  }, [fetchArchivedDeployments]);

  // Clear replay mode and reset all replay-related state
  const handleClearReplay = useCallback(() => {
    setIsReplayMode(false);
    setReplayDate('');
    setCurrentReplayTime('09:15:00');
    setReplayProgress(0);
    setCandleData([]);
    setIsPlaying(false);
    setReplaySignals([]);
    setReplayIgnoredSignals([]);
    setReplayTrades([]);
    setReplayHistory([]);
    // Reset strategy dropdown and preview to default
    setSelectedStrategy('');
    selectedStrategyRef.current = '';
    setPreview(null);
    // Stop any replay interval if running
    if (replayIntervalRef.current) {
      clearInterval(replayIntervalRef.current);
      replayIntervalRef.current = null;
    }
    setActionMessage('Replay mode cleared.');
  }, []);

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
      // Update display time every second
      const liveTimeInterval = setInterval(() => {
        setCurrentLiveTime(new Date().toLocaleTimeString());
      }, 1000);
      
      // Update currentTime every 10 seconds to trigger table re-render with latest candle
      const tableUpdateInterval = setInterval(() => {
        setCurrentTime(new Date());
      }, 10000); // Update every 10 seconds to refresh current candle
      
      // Also update immediately on mount
      setCurrentTime(new Date());
      
      return () => {
        clearInterval(liveTimeInterval);
        clearInterval(tableUpdateInterval);
      };
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
      // Add cache-busting parameter to ensure fresh data
      const timestamp = new Date().getTime();
      const response = await fetch(apiUrl(`/api/live_trade/status?t=${timestamp}`), { 
        credentials: 'include',
        cache: 'no-cache'
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch live trade status');
      }
      // Log for debugging
      console.log('Fetched deployment status - History entries:', data.deployment?.state?.history?.length || 0);
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

  // Socket.IO connection for real-time updates
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Create Socket.IO connection for real-time strategy updates
    const socket: Socket = io(SOCKET_BASE_URL, {
      path: '/socket.io/',
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      forceNew: false,
      autoConnect: true
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('LiveTrade: Connected to WebSocket for real-time updates');
    });

    socket.on('disconnect', (reason: string) => {
      console.log('LiveTrade: WebSocket disconnected:', reason);
    });

    // Listen for strategy updates
    socket.on('strategy_update', (data: any) => {
      // Refresh deployment status when strategy update is received
      if (data && (data.strategy_id || data.deployment_id)) {
        fetchDeploymentStatus();
      }
    });

    // Cleanup on unmount
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [fetchDeploymentStatus]);

  // Smart polling: refresh at 20 seconds before each 5-minute candle close (when evaluations happen)
  // This ensures we get fresh data right when candle evaluations occur
  useEffect(() => {
    if (!deployment || isReplayMode) return; // Only for live mode with active deployment
    
    let timeoutId: NodeJS.Timeout | null = null;
    
    const scheduleNextRefresh = () => {
      const now = new Date();
      const minutes = now.getMinutes();
      const seconds = now.getSeconds();
      
      // Calculate next 5-minute candle close time
      // Round up to next 5-minute interval (e.g., 12:03 -> 12:05, 12:07 -> 12:10)
      const nextCandleMinutes = Math.ceil(minutes / 5) * 5;
      const nextCandleClose = new Date(now);
      nextCandleClose.setMinutes(nextCandleMinutes, 0, 0);
      nextCandleClose.setSeconds(0, 0);
      
      // If we've already passed this candle close, move to next one
      if (nextCandleClose <= now) {
        nextCandleClose.setMinutes(nextCandleMinutes + 5, 0, 0);
      }
      
      // Evaluation happens 20 seconds before candle close
      const evaluationTime = new Date(nextCandleClose.getTime() - 20 * 1000);
      
      // Calculate milliseconds until evaluation time + 2 seconds buffer to ensure data is ready
      const msUntilRefresh = evaluationTime.getTime() + 2000 - now.getTime();
      
      if (msUntilRefresh > 0 && msUntilRefresh < 6 * 60 * 1000) { // Only schedule if within next 6 minutes
        timeoutId = setTimeout(() => {
          fetchDeploymentStatus();
          // Schedule next refresh after this one completes
          scheduleNextRefresh();
        }, msUntilRefresh);
      } else {
        // Fallback: if calculation fails, use 30-second polling
        timeoutId = setTimeout(() => {
          fetchDeploymentStatus();
          scheduleNextRefresh();
        }, 30000);
      }
    };
    
    // Schedule first refresh
    scheduleNextRefresh();
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [deployment, fetchDeploymentStatus, isReplayMode]);
  
  // Fallback polling interval (every 30 seconds) in case smart scheduling fails
  useEffect(() => {
    if (!deployment || isReplayMode) return;
    
    const fallbackInterval = setInterval(() => {
      fetchDeploymentStatus();
    }, 30000); // Every 30 seconds as fallback
    
    return () => clearInterval(fallbackInterval);
  }, [deployment, fetchDeploymentStatus, isReplayMode]);

  // Scroll table to top when new data arrives (latest entries are at top)
  useEffect(() => {
    if (stateEventTableRef.current) {
      const container = stateEventTableRef.current;
      // Store current scroll position and check if user was near the top (within 200px)
      const currentScrollTop = container.scrollTop;
      const currentScrollHeight = container.scrollHeight;
      const currentClientHeight = container.clientHeight;
      const distanceFromTop = currentScrollTop;
      const wasNearTop = distanceFromTop < 200;
      const isFirstLoad = previousHistoryLengthRef.current === 0;
      
      // Use requestAnimationFrame and setTimeout to ensure DOM has fully updated after re-render
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (stateEventTableRef.current) {
            const updatedContainer = stateEventTableRef.current;
            const newScrollHeight = updatedContainer.scrollHeight;
            
            // Only scroll to top if:
            // 1. User was already near top (within 200px), OR
            // 2. It's the first load, OR
            // 3. New content was added (scrollHeight increased) AND user was near top
            const hasNewContent = newScrollHeight > currentScrollHeight;
            
            if ((wasNearTop && hasNewContent) || isFirstLoad) {
              updatedContainer.scrollTop = 0; // Scroll to top (latest entries)
            } else if (!wasNearTop) {
              // If user scrolled down, maintain their scroll position relative to the top
              // Adjust for new content added at the top
              const scrollDiff = newScrollHeight - currentScrollHeight;
              updatedContainer.scrollTop = currentScrollTop + scrollDiff;
            }
            
            // Update previous length for next comparison
            const currentHistoryLength = deployment?.state?.history?.length || replayHistory?.length || 0;
            previousHistoryLengthRef.current = currentHistoryLength;
          }
        }, 150);
      });
    }
  }, [
    deployment?.state?.history?.length, 
    deployment?.state?.lastCheck, 
    isReplayMode, 
    currentReplayTime, 
    candleData?.length,
    replayHistory?.length
  ]);

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
      // Check category field (HistoryEntry uses category, not type)
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
              {!deployment && !isReplayMode ? (
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-info-circle display-6 d-block mb-3"></i>
                  <p className="mb-0">
                    No live deployment detected. Configure a strategy and click <strong>Deploy Strategy</strong>.
                  </p>
                </div>
              ) : (
                <>
                  {/* Media Player Controls - Always visible when deployment exists or in replay mode */}
                  <div className="card bg-light mb-4" data-replay-section>
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
                        {isReplayMode && (
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={handleClearReplay}
                            title="Clear replay mode and return to live view"
                          >
                            <i className="bi bi-x-circle me-1"></i>
                            Clear Replay
                          </button>
                        )}
                      </div>
                      <div className="text-muted small">
                        {isReplayMode ? 'Simulating past trading day' : 'Live trading in progress'}
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

                  {/* User Visibility States - Live Trade & Replay */}
                  {(deployment || isReplayMode) && (
                    <div className="card mb-4">
                      <div className="card-header bg-primary text-white">
                        <h6 className="mb-0">
                          <i className="bi bi-diagram-3-fill me-2"></i>
                          User Visibility States - Trading Process Flow
                        </h6>
                      </div>
                      <div className="card-body">
                        {(() => {
                          // Define all states in order
                          const allStates = [
                            {
                              id: 'SEARCHING_SIGNAL',
                              name: 'Searching Signal',
                              description: 'Monitoring for PE signal conditions',
                              icon: 'bi-search',
                              color: '#6c757d',
                              details: (data: any) => ({
                                'Status': data.signalStatus || 'Monitoring market',
                                'Condition': 'LOW > EMA(5) AND RSI > 70',
                                'Last Check': data.lastCheck || 'N/A',
                                'Current LTP': data.currentLtp ? `₹${data.currentLtp.toFixed(2)}` : 'N/A',
                                'Candle Interval': `${data.candleInterval || 5} minutes`,
                                'Evaluation Time': `${data.evaluationSeconds || 20} seconds before candle close`
                              })
                            },
                            {
                              id: 'SIGNAL_IGNORED',
                              name: 'Signal Ignored',
                              description: 'Signal evaluated but ignored with reason',
                              icon: 'bi-x-circle',
                              color: '#dc3545',
                              details: (data: any) => ({
                                'Reason': data.ignoreReason || 'RSI or EMA condition not met',
                                'RSI Value': data.rsi ? data.rsi.toFixed(2) : 'N/A',
                                'EMA Value': data.ema ? `₹${data.ema.toFixed(2)}` : 'N/A',
                                'Candle High': data.high ? `₹${data.high.toFixed(2)}` : 'N/A',
                                'Candle Low': data.low ? `₹${data.low.toFixed(2)}` : 'N/A',
                                'Time': data.timestamp || 'N/A',
                                'Total Ignored': data.totalIgnored || 0
                              })
                            },
                            {
                              id: 'SIGNAL_ACTIVE',
                              name: 'Signal Active',
                              description: 'Identified PE signal, waiting for entry',
                              icon: 'bi-bullseye',
                              color: '#0d6efd',
                              details: (data: any) => ({
                                'Signal Type': 'PE',
                                'Signal High': data.signalHigh ? `₹${data.signalHigh.toFixed(2)}` : 'N/A',
                                'Signal Low': data.signalLow ? `₹${data.signalLow.toFixed(2)}` : 'N/A',
                                'EMA(5)': data.ema ? `₹${data.ema.toFixed(2)}` : 'N/A',
                                'RSI(14)': data.rsi ? data.rsi.toFixed(2) : 'N/A',
                                'Signal Time': data.signalTime || 'N/A',
                                'Entry Condition': 'Waiting for candle.close < signal.low',
                                'Current Close': data.currentClose ? `₹${data.currentClose.toFixed(2)}` : 'N/A'
                              })
                            },
                            {
                              id: 'TRADE_EXECUTED',
                              name: 'Trade Executed',
                              description: 'Order posted, Position open',
                              icon: 'bi-check-circle',
                              color: '#198754',
                              details: (data: any) => ({
                                'Order ID': data.orderId || 'N/A',
                                'Trading Symbol': data.tradingSymbol || data.optionSymbol || 'N/A',
                                'Entry Price': data.entryPrice ? `₹${data.entryPrice.toFixed(2)}` : 'N/A',
                                'Quantity': data.quantity || 'N/A',
                                'Lot Size': data.lotSize || 'N/A',
                                'Lot Count': data.lotCount || 'N/A',
                                'Position': data.position || 'N/A',
                                'Order Status': data.orderStatus || 'N/A',
                                'Entry Time': data.entryTime || 'N/A'
                              })
                            },
                            {
                              id: 'EXIT_CONDITION_EVALUATION',
                              name: 'Exit Condition Evaluation',
                              description: 'Monitoring exit conditions',
                              icon: 'bi-eye',
                              color: '#ffc107',
                              details: (data: any) => ({
                                'Current LTP': data.currentLtp ? `₹${data.currentLtp.toFixed(2)}` : 'N/A',
                                'Entry Price': data.entryPrice ? `₹${data.entryPrice.toFixed(2)}` : 'N/A',
                                'Current P&L': data.currentPnl ? `₹${data.currentPnl.toFixed(2)}` : 'N/A',
                                'P&L %': data.pnlPercent ? `${data.pnlPercent.toFixed(2)}%` : 'N/A',
                                'Stop Loss': data.stopLoss ? `₹${data.stopLoss.toFixed(2)} (${data.stopLossPercent || -17}%)` : 'N/A',
                                'Target': data.target ? `₹${data.target.toFixed(2)} (${data.targetPercent || 45}%)` : 'N/A',
                                'Exit Conditions': 'Stop Loss (-17%), Target (+45%), Market Close (15:15), Index Stop/Target',
                                'Monitoring Since': data.monitoringSince || 'N/A'
                              })
                            },
                            {
                              id: 'EXIT_EXECUTING',
                              name: 'Exit Executing',
                              description: 'Exit condition met, closing position',
                              icon: 'bi-arrow-right-circle',
                              color: '#ff9800',
                              details: (data: any) => ({
                                'Exit Reason': data.exitReason || 'N/A',
                                'Exit Price': data.exitPrice ? `₹${data.exitPrice.toFixed(2)}` : 'N/A',
                                'Entry Price': data.entryPrice ? `₹${data.entryPrice.toFixed(2)}` : 'N/A',
                                'P&L': data.pnl ? `₹${data.pnl.toFixed(2)}` : 'N/A',
                                'P&L %': data.pnlPercent ? `${data.pnlPercent.toFixed(2)}%` : 'N/A',
                                'Exit Order ID': data.exitOrderId || 'N/A',
                                'Exit Time': data.exitTime || 'N/A',
                                'Status': 'Closing position...'
                              })
                            },
                            {
                              id: 'TRADE_COMPLETE',
                              name: 'Trade Complete',
                              description: 'Position closed, ready for next cycle',
                              icon: 'bi-check2-all',
                              color: '#6f42c1',
                              details: (data: any) => ({
                                'Exit Reason': data.exitReason || 'N/A',
                                'Entry Price': data.entryPrice ? `₹${data.entryPrice.toFixed(2)}` : 'N/A',
                                'Exit Price': data.exitPrice ? `₹${data.exitPrice.toFixed(2)}` : 'N/A',
                                'Final P&L': data.pnl ? `₹${data.pnl.toFixed(2)}` : 'N/A',
                                'P&L %': data.pnlPercent ? `${data.pnlPercent.toFixed(2)}%` : 'N/A',
                                'Trade Duration': data.duration || 'N/A',
                                'Status': 'Ready for next signal cycle',
                                'Completed At': data.completedAt || 'N/A'
                              })
                            }
                          ];

                          // Determine current state based on deployment/replay data
                          const determineCurrentState = () => {
                            if (isReplayMode) {
                              // For replay mode, use replay data
                              if (replayTrades && replayTrades.length > 0) {
                                const latestTrade = replayTrades[replayTrades.length - 1];
                                const isEntry = latestTrade.type === 'entry' || latestTrade.data?.type === 'entry';
                                const isExit = latestTrade.type === 'exit' || latestTrade.data?.exit_reason;
                                
                                if (isExit) {
                                  // Check if exit is executing or complete
                                  const exitTime = new Date(latestTrade.timestamp || latestTrade.data?.timestamp || '');
                                  const now = parseTime(`${replayDate}T${currentReplayTime}`) || new Date();
                                  const timeDiff = (now.getTime() - exitTime.getTime()) / 1000;
                                  
                                  if (timeDiff < 5) {
                                    return 'EXIT_EXECUTING';
                                  }
                                  return 'TRADE_COMPLETE';
                                } else if (isEntry) {
                                  return 'EXIT_CONDITION_EVALUATION';
                                }
                              }
                              
                              if (replaySignals && replaySignals.length > 0) {
                                return 'SIGNAL_ACTIVE';
                              }
                              
                              if (replayIgnoredSignals && replayIgnoredSignals.length > 0) {
                                return 'SIGNAL_IGNORED';
                              }
                              
                              return 'SEARCHING_SIGNAL';
                            } else {
                              // For live mode, use deployment data
                              if (!deployment || !deployment.state) {
                                return 'SEARCHING_SIGNAL';
                              }
                              
                              const state = deployment.state;
                              const positions = state.positions || [];
                              const orders = state.orders || [];
                              const hasOpenPosition = positions.length > 0 && positions.some((p: any) => (p.quantity || 0) !== 0);
                              const hasOpenOrder = orders.length > 0 && orders.some((o: any) => o.status === 'OPEN' || o.status === 'PENDING');
                              
                              // Check for exit execution
                              if (state.squareOff && state.squareOff.length > 0) {
                                return 'EXIT_EXECUTING';
                              }
                              
                              // Check if trade is complete (recent exit)
                              const history = state.history || [];
                              const recentExit = history.find((h: any) => 
                                h.type === 'exit' || h.message?.toLowerCase().includes('exit') || h.message?.toLowerCase().includes('closed')
                              );
                              
                              if (recentExit && !hasOpenPosition) {
                                return 'TRADE_COMPLETE';
                              }
                              
                              // Check if in position (position exists and order is executed)
                              if (hasOpenPosition) {
                                // If we have a position, we're monitoring exit conditions
                                return 'EXIT_CONDITION_EVALUATION';
                              }
                              
                              // Check if order is placed but not yet executed (pending/executing)
                              if (hasOpenOrder || (state.openOrdersCount && state.openOrdersCount > 0)) {
                                return 'TRADE_EXECUTED';
                              }
                              
                              // Check if we have executed orders but no position (order just executed)
                              const executedOrderCheck = orders.find((o: any) => 
                                o.status === 'COMPLETE' || o.status === 'EXECUTED'
                              );
                              if (executedOrderCheck && !hasOpenPosition) {
                                // Order executed but position not yet reflected, still in TRADE_EXECUTED
                                return 'TRADE_EXECUTED';
                              }
                              
                              // Check for active signal
                              const signalStatus = state.strategyInsights?.signalStatus || '';
                              if (signalStatus.includes('Signal') || signalStatus.includes('signal')) {
                                if (signalStatus.toLowerCase().includes('ignored')) {
                                  return 'SIGNAL_IGNORED';
                                }
                                return 'SIGNAL_ACTIVE';
                              }
                              
                              return 'SEARCHING_SIGNAL';
                            }
                          };

                          const currentStateId = determineCurrentState();
                          const currentStateIndex = allStates.findIndex(s => s.id === currentStateId);
                          const processedStates = currentStateIndex + 1;
                          const remainingStates = allStates.length - processedStates;

                          // Get state data for current state
                          const getStateData = () => {
                            if (isReplayMode) {
                              const latestSignal = replaySignals && replaySignals.length > 0 ? replaySignals[replaySignals.length - 1] : null;
                              const latestIgnored = replayIgnoredSignals && replayIgnoredSignals.length > 0 ? replayIgnoredSignals[replayIgnoredSignals.length - 1] : null;
                              const latestTrade = replayTrades && replayTrades.length > 0 ? replayTrades[replayTrades.length - 1] : null;
                              
                              switch (currentStateId) {
                                case 'SIGNAL_IGNORED':
                                  return {
                                    ignoreReason: latestIgnored?.reason || latestIgnored?.data?.reason || 'RSI or EMA condition not met',
                                    rsi: latestIgnored?.data?.rsi || latestIgnored?.rsi_value,
                                    ema: latestIgnored?.data?.ema || latestIgnored?.ema_value,
                                    high: latestIgnored?.data?.high || latestIgnored?.signal_high,
                                    low: latestIgnored?.data?.low || latestIgnored?.signal_low,
                                    timestamp: latestIgnored?.timestamp || latestIgnored?.candle_time,
                                    totalIgnored: replayIgnoredSignals?.length || 0
                                  };
                                case 'SIGNAL_ACTIVE':
                                  return {
                                    signalHigh: latestSignal?.signal_high || latestSignal?.data?.signal_high,
                                    signalLow: latestSignal?.signal_low || latestSignal?.data?.signal_low,
                                    ema: latestSignal?.ema_value || latestSignal?.data?.ema,
                                    rsi: latestSignal?.rsi_value || latestSignal?.data?.rsi,
                                    signalTime: latestSignal?.timestamp || latestSignal?.candle_time,
                                    currentClose: latestSignal?.price || latestSignal?.data?.price
                                  };
                                case 'TRADE_EXECUTED':
                                case 'EXIT_CONDITION_EVALUATION':
                                  return {
                                    orderId: latestTrade?.data?.order_id || 'N/A',
                                    tradingSymbol: latestTrade?.data?.option_symbol || latestTrade?.data?.tradingsymbol,
                                    entryPrice: latestTrade?.data?.entry_price,
                                    quantity: latestTrade?.data?.quantity || latestTrade?.data?.total_quantity,
                                    lotSize: latestTrade?.data?.lot_size,
                                    lotCount: latestTrade?.data?.lot_count,
                                    position: latestTrade?.data?.position,
                                    orderStatus: latestTrade?.data?.order_status || 'EXECUTED',
                                    entryTime: latestTrade?.timestamp || latestTrade?.data?.timestamp,
                                    currentLtp: latestTrade?.data?.current_ltp,
                                    currentPnl: latestTrade?.data?.current_pnl || latestTrade?.data?.pnl,
                                    pnlPercent: latestTrade?.data?.pnl_percent,
                                    stopLoss: latestTrade?.data?.stop_loss,
                                    stopLossPercent: latestTrade?.data?.stop_loss_percent || -17,
                                    target: latestTrade?.data?.target,
                                    targetPercent: latestTrade?.data?.target_percent || 45,
                                    monitoringSince: latestTrade?.timestamp || latestTrade?.data?.entry_time
                                  };
                                case 'EXIT_EXECUTING':
                                case 'TRADE_COMPLETE':
                                  return {
                                    exitReason: latestTrade?.data?.exit_reason || 'Market Close',
                                    exitPrice: latestTrade?.data?.exit_price,
                                    entryPrice: latestTrade?.data?.entry_price,
                                    pnl: latestTrade?.data?.pnl,
                                    pnlPercent: latestTrade?.data?.pnl_percent,
                                    exitOrderId: latestTrade?.data?.exit_order_id || 'N/A',
                                    exitTime: latestTrade?.timestamp || latestTrade?.data?.exit_time,
                                    completedAt: latestTrade?.timestamp || latestTrade?.data?.exit_time
                                  };
                                default:
                                  return {
                                    signalStatus: 'Monitoring market for signals',
                                    lastCheck: currentReplayTime,
                                    currentLtp: null,
                                    candleInterval: 5,
                                    evaluationSeconds: 20
                                  };
                              }
                            } else {
                              // Live mode data
                              const state = deployment?.state || {};
                              const insights = state.strategyInsights || {};
                              const positions = state.positions || [];
                              const orders = state.orders || [];
                              
                              switch (currentStateId) {
                                case 'SIGNAL_IGNORED':
                                  const ignoredCount = state.eventStats?.signalsIgnored || 0;
                                  return {
                                    ignoreReason: 'RSI or EMA condition not met',
                                    totalIgnored: ignoredCount
                                  };
                                case 'SIGNAL_ACTIVE':
                                  return {
                                    signalHigh: insights.signalCandleHigh,
                                    signalLow: insights.signalCandleLow,
                                    ema: insights.ema5,
                                    rsi: insights.rsi14,
                                    signalTime: insights.signalCandleTime,
                                    currentClose: state.currentLtp
                                  };
                                case 'TRADE_EXECUTED':
                                  // Get the most recent executed order (COMPLETE status) or pending order
                                  const executedOrder = orders.find((o: any) => 
                                    o.status === 'COMPLETE' || o.status === 'EXECUTED'
                                  ) || orders.find((o: any) => 
                                    o.status === 'OPEN' || o.status === 'PENDING'
                                  );
                                  const execPosition = positions.find((p: any) => (p.quantity || 0) !== 0);
                                  const execQuantity = execPosition?.quantity || 0;
                                  return {
                                    orderId: executedOrder?.order_id || execPosition?.tradingsymbol?.split('-')[0] || 'N/A',
                                    tradingSymbol: executedOrder?.tradingsymbol || execPosition?.tradingsymbol || insights.tradedInstrument,
                                    entryPrice: executedOrder?.average_price || execPosition?.buy_price || insights.entryPrice,
                                    quantity: executedOrder?.filled_quantity || execQuantity || state.config?.totalQuantity,
                                    lotSize: state.config?.lotSize,
                                    lotCount: state.config?.lotCount,
                                    position: execPosition ? `${execQuantity > 0 ? 'LONG' : 'SHORT'} ${Math.abs(execQuantity)}` : 'N/A',
                                    orderStatus: executedOrder?.status || (execPosition ? 'EXECUTED' : 'PENDING'),
                                    entryTime: executedOrder?.order_timestamp || execPosition?.buy_price ? 'Position Active' : 'N/A'
                                  };
                                case 'EXIT_CONDITION_EVALUATION':
                                  const evalPosition = positions.find((p: any) => (p.quantity || 0) !== 0);
                                  return {
                                    currentLtp: state.currentLtp,
                                    entryPrice: insights.entryPrice,
                                    currentPnl: state.livePnl,
                                    pnlPercent: insights.currentPnlPercent,
                                    stopLoss: insights.stopLossLevel,
                                    stopLossPercent: state.config?.stopLossPercent || -17,
                                    target: insights.targetLevel,
                                    targetPercent: state.config?.targetPercent || 45,
                                    monitoringSince: evalPosition?.buy_price ? 'Position open' : 'N/A'
                                  };
                                case 'EXIT_EXECUTING':
                                  const squareOff = state.squareOff?.[0];
                                  return {
                                    exitReason: squareOff?.status || 'Market Close',
                                    exitPrice: state.currentLtp || insights.entryPrice,
                                    entryPrice: insights.entryPrice,
                                    exitOrderId: squareOff?.order_id || 'N/A',
                                    exitTime: new Date().toLocaleTimeString()
                                  };
                                case 'TRADE_COMPLETE':
                                  const recentExit = state.history?.find((h: any) => 
                                    h.type === 'exit' || h.message?.toLowerCase().includes('exit')
                                  );
                                  const exitMeta = recentExit?.meta || {};
                                  return {
                                    exitReason: exitMeta.exit_reason || recentExit?.message || 'Trade Closed',
                                    entryPrice: insights.entryPrice,
                                    exitPrice: exitMeta.exit_price,
                                    pnl: state.livePnl || exitMeta.pnl,
                                    completedAt: recentExit?.timestamp || new Date().toLocaleTimeString()
                                  };
                                default:
                                  return {
                                    signalStatus: insights.signalStatus || state.message || 'Monitoring market',
                                    lastCheck: state.lastCheck || 'N/A',
                                    currentLtp: state.currentLtp,
                                    candleInterval: state.config?.candleIntervalMinutes || 5,
                                    evaluationSeconds: state.config?.evaluationSecondsBeforeClose || 20
                                  };
                              }
                            }
                          };

                          const stateData = getStateData();
                          const currentState = allStates.find(s => s.id === currentStateId) || allStates[0];
                          const stateDetails = currentState.details(stateData);

                          // Helper function to parse time
                          const parseTime = (timeStr: string): Date | null => {
                            if (!timeStr) return null;
                            try {
                              if (timeStr.includes('T') || timeStr.includes('Z') || timeStr.includes('+')) {
                                return new Date(timeStr);
                              }
                              if (replayDate && timeStr.includes(':')) {
                                return new Date(`${replayDate}T${timeStr}`);
                              }
                              return new Date(timeStr);
                            } catch {
                              return null;
                            }
                          };

                          return (
                            <div>
                              {/* Progress Summary */}
                              <div className="alert alert-info mb-4">
                                <div className="row align-items-center">
                                  <div className="col-md-6">
                                    <h6 className="mb-2">
                                      <i className="bi bi-activity me-2"></i>
                                      Progress: {processedStates} of {allStates.length} states processed
                                    </h6>
                                    <div className="progress" style={{ height: '25px' }}>
                                      <div 
                                        className="progress-bar progress-bar-striped progress-bar-animated" 
                                        role="progressbar" 
                                        style={{ width: `${(processedStates / allStates.length) * 100}%` }}
                                        aria-valuenow={processedStates} 
                                        aria-valuemin={0} 
                                        aria-valuemax={allStates.length}
                                      >
                                        {Math.round((processedStates / allStates.length) * 100)}%
                                      </div>
                                    </div>
                                  </div>
                                  <div className="col-md-6 text-end">
                                    <span className="badge bg-success me-2">Processed: {processedStates}</span>
                                    <span className="badge bg-secondary">Remaining: {remainingStates}</span>
                                  </div>
                                </div>
                              </div>

                              {/* State Flow Visualization */}
                              <div className="mb-4">
                                <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
                                  {allStates.map((state, idx) => {
                                    const isCompleted = idx < currentStateIndex;
                                    const isCurrent = state.id === currentStateId;
                                    const isPending = idx > currentStateIndex;
                                    
                                    return (
                                      <React.Fragment key={state.id}>
                                        <div 
                                          className="flex-fill text-center p-3 rounded border"
                                          style={{
                                            backgroundColor: isCurrent ? `${state.color}15` : isCompleted ? `${state.color}08` : '#f8f9fa',
                                            borderColor: isCurrent ? state.color : isCompleted ? state.color : '#dee2e6',
                                            borderWidth: isCurrent ? '3px' : '1px',
                                            opacity: isPending ? 0.5 : 1,
                                            minWidth: '120px',
                                            maxWidth: '180px'
                                          }}
                                        >
                                          <i 
                                            className={`bi ${state.icon} mb-2`} 
                                            style={{ 
                                              fontSize: '2rem', 
                                              color: isCurrent ? state.color : isCompleted ? state.color : '#6c757d' 
                                            }}
                                          ></i>
                                          <div className="small fw-bold" style={{ color: isCurrent ? state.color : '#212529' }}>
                                            {state.name}
                                          </div>
                                          {isCurrent && (
                                            <span className="badge mt-1" style={{ backgroundColor: state.color }}>
                                              CURRENT
                                            </span>
                                          )}
                                          {isCompleted && (
                                            <span className="badge bg-success mt-1">
                                              <i className="bi bi-check"></i>
                                            </span>
                                          )}
                                        </div>
                                        {idx < allStates.length - 1 && (
                                          <i 
                                            className="bi bi-arrow-right" 
                                            style={{ 
                                              fontSize: '1.5rem', 
                                              color: isCompleted ? state.color : '#dee2e6' 
                                            }}
                                          ></i>
                                        )}
                                      </React.Fragment>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Current State Details */}
                              <div className="card border-primary mb-3">
                                <div 
                                  className="card-header text-white"
                                  style={{ backgroundColor: currentState.color }}
                                >
                                  <h6 className="mb-0">
                                    <i className={`bi ${currentState.icon} me-2`}></i>
                                    Current State: {currentState.name}
                                  </h6>
                                </div>
                                <div className="card-body">
                                  <p className="mb-3">{currentState.description}</p>
                                  <div className="row">
                                    {Object.entries(stateDetails).map(([key, value], idx) => (
                                      <div key={idx} className="col-md-6 mb-2">
                                        <strong>{key}:</strong> <span className="text-muted">{String(value)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              {/* Real-Time Activity in Current State */}
                              {(() => {
                                // Helper function to parse time
                                const parseTime = (timeStr: string): Date | null => {
                                  if (!timeStr) return null;
                                  try {
                                    if (timeStr.includes('T') || timeStr.includes('Z') || timeStr.includes('+')) {
                                      return new Date(timeStr);
                                    }
                                    if (replayDate && timeStr.includes(':')) {
                                      return new Date(`${replayDate}T${timeStr}`);
                                    }
                                    return new Date(timeStr);
                                  } catch {
                                    return null;
                                  }
                                };

                                // Helper function to format time
                                const formatTime = (date: Date | null): string => {
                                  if (!date || isNaN(date.getTime())) return 'N/A';
                                  return date.toLocaleTimeString('en-US', { 
                                    hour: '2-digit', 
                                    minute: '2-digit', 
                                    second: '2-digit', 
                                    hour12: false 
                                  });
                                };

                                // Get state entry time and recent activities
                                const getStateActivity = () => {
                                  const now = isReplayMode 
                                    ? (parseTime(`${replayDate}T${currentReplayTime}`) || new Date())
                                    : currentTime; // Use currentTime state which updates every minute
                                  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
                                  
                                  let stateEntryTime: Date | null = null;
                                  const recentActivities: Array<{
                                    time: string;
                                    message: string;
                                    type: string;
                                    details?: any;
                                  }> = [];

                                  if (isReplayMode) {
                                    // For replay mode, find when we entered this state
                                    if (currentStateId === 'SEARCHING_SIGNAL') {
                                      stateEntryTime = parseTime(`${replayDate}T09:15:00`) || now;
                                    } else if (currentStateId === 'SIGNAL_IGNORED' && replayIgnoredSignals && replayIgnoredSignals.length > 0) {
                                      const latest = replayIgnoredSignals[replayIgnoredSignals.length - 1];
                                      stateEntryTime = parseTime(latest.timestamp || latest.candle_time || latest.data?.timestamp) || now;
                                    } else if (currentStateId === 'SIGNAL_ACTIVE' && replaySignals && replaySignals.length > 0) {
                                      const latest = replaySignals[replaySignals.length - 1];
                                      stateEntryTime = parseTime(latest.timestamp || latest.candle_time || latest.data?.timestamp) || now;
                                    } else if (currentStateId === 'TRADE_EXECUTED' && replayTrades && replayTrades.length > 0) {
                                      const entry = replayTrades.find((t: any) => t.type === 'entry' || t.data?.type === 'entry');
                                      if (entry) {
                                        stateEntryTime = parseTime(entry.timestamp || entry.data?.timestamp || entry.data?.entry_time) || now;
                                      }
                                    } else if (currentStateId === 'EXIT_CONDITION_EVALUATION' && replayTrades && replayTrades.length > 0) {
                                      const entry = replayTrades.find((t: any) => t.type === 'entry' || t.data?.type === 'entry');
                                      if (entry) {
                                        stateEntryTime = parseTime(entry.timestamp || entry.data?.timestamp || entry.data?.entry_time) || now;
                                      }
                                    } else if (currentStateId === 'EXIT_EXECUTING' && replayTrades && replayTrades.length > 0) {
                                      const exit = replayTrades.find((t: any) => t.type === 'exit' || t.data?.exit_reason);
                                      if (exit) {
                                        stateEntryTime = parseTime(exit.timestamp || exit.data?.timestamp || exit.data?.exit_time) || now;
                                      }
                                    } else if (currentStateId === 'TRADE_COMPLETE' && replayTrades && replayTrades.length > 0) {
                                      const exit = replayTrades.find((t: any) => t.type === 'exit' || t.data?.exit_reason);
                                      if (exit) {
                                        stateEntryTime = parseTime(exit.timestamp || exit.data?.timestamp || exit.data?.exit_time) || now;
                                      }
                                    }

                                    // Get recent activities from history (last minute)
                                    if (replayHistory && replayHistory.length > 0) {
                                      replayHistory.forEach((entry: any) => {
                                        const entryTime = parseTime(entry.timestamp || entry.data?.timestamp);
                                        if (entryTime && entryTime >= oneMinuteAgo && entryTime <= now) {
                                          recentActivities.push({
                                            time: formatTime(entryTime),
                                            message: entry.message || entry.data?.message || entry.type || 'Activity',
                                            type: entry.type || entry.data?.type || 'info',
                                            details: entry.meta || entry.data
                                          });
                                        }
                                      });
                                    }
                                  } else {
                                    // For live mode
                                    const state = deployment?.state || {};
                                    const history = state.history || [];
                                    
                                    // Find state entry time based on state type
                                    if (currentStateId === 'SEARCHING_SIGNAL') {
                                      const startTime = deployment?.startedAt || deployment?.scheduledStart;
                                      stateEntryTime = startTime ? parseTime(startTime) || now : now;
                                    } else if (currentStateId === 'SIGNAL_IGNORED') {
                                      const ignoredEvent = history.find((h: any) => 
                                        h.type === 'signal_ignored' || h.message?.toLowerCase().includes('ignored')
                                      );
                                      stateEntryTime = ignoredEvent && ignoredEvent.timestamp 
                                        ? parseTime(ignoredEvent.timestamp) || now 
                                        : now;
                                    } else if (currentStateId === 'SIGNAL_ACTIVE') {
                                      const signalEvent = history.find((h: any) => 
                                        h.type === 'signal_identified' || h.message?.toLowerCase().includes('signal identified')
                                      );
                                      stateEntryTime = signalEvent && signalEvent.timestamp 
                                        ? parseTime(signalEvent.timestamp) || now 
                                        : now;
                                    } else if (currentStateId === 'TRADE_EXECUTED') {
                                      const entryEvent = history.find((h: any) => 
                                        h.type === 'entry' || h.message?.toLowerCase().includes('entry') || h.message?.toLowerCase().includes('order')
                                      );
                                      stateEntryTime = entryEvent && entryEvent.timestamp 
                                        ? parseTime(entryEvent.timestamp) || now 
                                        : now;
                                    } else if (currentStateId === 'EXIT_CONDITION_EVALUATION') {
                                      const entryEvent = history.find((h: any) => 
                                        h.type === 'entry' || h.message?.toLowerCase().includes('entry')
                                      );
                                      stateEntryTime = entryEvent && entryEvent.timestamp 
                                        ? parseTime(entryEvent.timestamp) || now 
                                        : now;
                                    } else if (currentStateId === 'EXIT_EXECUTING') {
                                      const exitEvent = history.find((h: any) => 
                                        h.type === 'exit' || h.message?.toLowerCase().includes('exit') || state.squareOff
                                      );
                                      stateEntryTime = exitEvent && exitEvent.timestamp 
                                        ? parseTime(exitEvent.timestamp) || now 
                                        : now;
                                    } else if (currentStateId === 'TRADE_COMPLETE') {
                                      const exitEvent = history.find((h: any) => 
                                        h.type === 'exit' || h.message?.toLowerCase().includes('exit')
                                      );
                                      stateEntryTime = exitEvent && exitEvent.timestamp 
                                        ? parseTime(exitEvent.timestamp) || now 
                                        : now;
                                    }

                                    // Get recent activities from history (last minute)
                                    history.forEach((entry: any) => {
                                      const entryTime = parseTime(entry.timestamp);
                                      if (entryTime && entryTime >= oneMinuteAgo && entryTime <= now) {
                                        recentActivities.push({
                                          time: formatTime(entryTime),
                                          message: entry.message || entry.type || 'Activity',
                                          type: entry.type || 'info',
                                          details: entry.meta
                                        });
                                      }
                                    });

                                    // Add real-time status updates
                                    if (state.message && state.lastCheck) {
                                      const lastCheckTime = parseTime(state.lastCheck);
                                      if (lastCheckTime && lastCheckTime >= oneMinuteAgo) {
                                        recentActivities.push({
                                          time: formatTime(lastCheckTime),
                                          message: state.message,
                                          type: 'status',
                                          details: { lastCheck: state.lastCheck }
                                        });
                                      }
                                    }

                                    // Add current LTP updates if available
                                    if (state.currentLtp && state.lastCheck) {
                                      const lastCheckTime = parseTime(state.lastCheck);
                                      if (lastCheckTime && lastCheckTime >= oneMinuteAgo) {
                                        recentActivities.push({
                                          time: formatTime(lastCheckTime),
                                          message: `Current LTP: ₹${state.currentLtp.toFixed(2)}`,
                                          type: 'ltp',
                                          details: { ltp: state.currentLtp }
                                        });
                                      }
                                    }
                                  }

                                  // Sort activities by time (most recent first)
                                  recentActivities.sort((a, b) => {
                                    const timeA = parseTime(a.time) || new Date(0);
                                    const timeB = parseTime(b.time) || new Date(0);
                                    return timeB.getTime() - timeA.getTime();
                                  });

                                  return { stateEntryTime, recentActivities, now };
                                };

                                const { stateEntryTime, recentActivities, now } = getStateActivity();

                                const getActivityIcon = (type: string) => {
                                  switch (type) {
                                    case 'entry': return 'bi-play-circle-fill text-success';
                                    case 'exit': return 'bi-stop-circle-fill text-danger';
                                    case 'signal_identified': return 'bi-bullseye text-primary';
                                    case 'signal_ignored': return 'bi-x-circle text-warning';
                                    case 'ltp': return 'bi-graph-up text-info';
                                    case 'status': return 'bi-info-circle text-secondary';
                                    default: return 'bi-circle text-muted';
                                  }
                                };

                                return (
                                  <div className="card border-info">
                                    <div className="card-header bg-info text-white">
                                      <h6 className="mb-0">
                                        <i className="bi bi-activity me-2"></i>
                                        Real-Time Activity in Current State
                                      </h6>
                                    </div>
                                    <div className="card-body">
                                      {/* State Entry Time */}
                                      <div className="mb-3 p-2 bg-light rounded">
                                        <div className="d-flex justify-content-between align-items-center">
                                          <div>
                                            <strong>State Entered At:</strong>{' '}
                                            <span className="text-primary">
                                              {stateEntryTime ? formatTime(stateEntryTime) : 'N/A'}
                                            </span>
                                          </div>
                                          <div>
                                            <strong>Duration in State:</strong>{' '}
                                            <span className="text-info">
                                              {stateEntryTime 
                                                ? `${Math.floor((now.getTime() - stateEntryTime.getTime()) / 1000)}s`
                                                : 'N/A'}
                                            </span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* State-Specific Event Table */}
                                      {(() => {
                                        const getStateEventTable = () => {
                                          // Get signalsIgnored from categorizedHistory (available in scope)
                                          const allIgnoredSignals = signalsIgnored || [];
                                          
                                          // Calculate 'now' for live mode - use currentTime state which updates every 30 seconds
                                          const now = isReplayMode 
                                            ? (parseTime(`${replayDate}T${currentReplayTime}`) || new Date())
                                            : currentTime;
                                          
                                          const events: Array<{
                                            time: string;
                                            evaluationTime: string; // Time when evaluated (20 sec before close)
                                            candle?: string;
                                            details: Record<string, any>;
                                            status?: string;
                                            isCurrent?: boolean;
                                          }> = [];

                                          // First, build ALL candle evaluations (for SEARCHING_SIGNAL)
                                          const allCandleEvaluations: Array<{
                                            candleTime: Date;
                                            evaluationTime: Date; // 20 seconds before candle close
                                            candle: any;
                                            rsi: number | null;
                                            ema: number | null;
                                            high: number;
                                            low: number;
                                            close: number;
                                            hasSignal: boolean;
                                            wasIgnored: boolean;
                                            signalData?: any;
                                            ignoredData?: any;
                                          }> = [];

                                          if (isReplayMode && candleData && candleData.length > 0) {
                                            candleData.forEach((candle: any) => {
                                              const candleTime = parseTime(candle.time || candle.date);
                                              if (candleTime && candleTime <= now) {
                                                // Evaluation happens 20 seconds before candle close
                                                // For 5-minute candles, close is at :00, :05, :10, etc.
                                                // So evaluation is at :19:40, :24:40, :29:40, etc.
                                                const candleCloseTime = new Date(candleTime);
                                                candleCloseTime.setSeconds(0, 0);
                                                const evaluationTime = new Date(candleCloseTime.getTime() - 20 * 1000);
                                                
                                                // Get RSI and EMA
                                                let rsi = candle.rsi || null;
                                                let ema = candle.ema5 || null;
                                                
                                                // Check for signal
                                                let hasSignal = false;
                                                let signalData = null;
                                                if (replaySignals && replaySignals.length > 0) {
                                                  const matchingSignal = replaySignals.find((sig: any) => {
                                                    const sigTime = parseTime(sig.timestamp || sig.candle_time || sig.data?.timestamp);
                                                    if (sigTime) {
                                                      // Check if signal is for this candle (within 5 minutes)
                                                      const timeDiff = Math.abs(sigTime.getTime() - candleTime.getTime());
                                                      return timeDiff < 5 * 60 * 1000;
                                                    }
                                                    return false;
                                                  });
                                                  
                                                  if (matchingSignal) {
                                                    hasSignal = true;
                                                    signalData = matchingSignal;
                                                    rsi = matchingSignal.rsi_value || matchingSignal.data?.rsi || rsi;
                                                    ema = matchingSignal.ema_value || matchingSignal.data?.ema || ema;
                                                  }
                                                }
                                                
                                                // Check if ignored
                                                let wasIgnored = false;
                                                let ignoredData = null;
                                                if (replayIgnoredSignals && replayIgnoredSignals.length > 0) {
                                                  const matchingIgnored = replayIgnoredSignals.find((sig: any) => {
                                                    const sigTime = parseTime(sig.timestamp || sig.candle_time || sig.data?.timestamp);
                                                    if (sigTime) {
                                                      const timeDiff = Math.abs(sigTime.getTime() - candleTime.getTime());
                                                      return timeDiff < 5 * 60 * 1000;
                                                    }
                                                    return false;
                                                  });
                                                  
                                                  if (matchingIgnored) {
                                                    wasIgnored = true;
                                                    ignoredData = matchingIgnored;
                                                    rsi = matchingIgnored.rsi_value || matchingIgnored.data?.rsi || rsi;
                                                    ema = matchingIgnored.ema_value || matchingIgnored.data?.ema || ema;
                                                  }
                                                }
                                                
                                                allCandleEvaluations.push({
                                                  candleTime,
                                                  evaluationTime,
                                                  candle,
                                                  rsi: rsi,
                                                  ema: ema,
                                                  high: candle.high || 0,
                                                  low: candle.low || 0,
                                                  close: candle.close || 0,
                                                  hasSignal,
                                                  wasIgnored,
                                                  signalData,
                                                  ignoredData
                                                });
                                              }
                                            });
                                          }

                                          // Now filter based on current state
                                          if (isReplayMode) {
                                            switch (currentStateId) {
                                            case 'SEARCHING_SIGNAL':
                                              // Show ALL candle evaluations (each row = one 5-minute candle evaluated at 20 seconds before close)
                                              allCandleEvaluations.forEach((candleEval) => {
                                                let result = 'No Signal';
                                                if (candleEval.hasSignal) {
                                                  result = 'PE Signal Found';
                                                } else if (candleEval.wasIgnored) {
                                                  result = 'Signal Ignored';
                                                } else if (candleEval.rsi && candleEval.ema) {
                                                  if (candleEval.low > candleEval.ema && candleEval.rsi > 70) {
                                                    result = 'Signal Condition Met';
                                                  } else {
                                                    result = 'No Signal';
                                                  }
                                                }
                                                
                                                events.push({
                                                  time: formatTime(candleEval.candleTime),
                                                  evaluationTime: formatTime(candleEval.evaluationTime),
                                                  candle: candleEval.candle.time || candleEval.candle.date || 'N/A',
                                                  details: {
                                                    'RSI': candleEval.rsi ? candleEval.rsi.toFixed(2) : 'N/A',
                                                    'EMA': candleEval.ema ? `₹${candleEval.ema.toFixed(2)}` : 'N/A',
                                                    'High': `₹${candleEval.high.toFixed(2)}`,
                                                    'Low': `₹${candleEval.low.toFixed(2)}`,
                                                    'Close': `₹${candleEval.close.toFixed(2)}`,
                                                    'Result': result
                                                  },
                                                  status: candleEval.hasSignal ? 'signal_found' : candleEval.wasIgnored ? 'ignored' : 'no_signal'
                                                });
                                              });
                                              break;
                                            case 'SIGNAL_IGNORED':
                                              // Show ONLY candles that were ignored (filtered from SEARCHING_SIGNAL)
                                              allCandleEvaluations
                                                .filter(candleEval => candleEval.wasIgnored)
                                                .forEach((candleEval) => {
                                                  const reason = candleEval.ignoredData?.reason || candleEval.ignoredData?.data?.reason || 
                                                    (candleEval.rsi && candleEval.rsi <= 70 ? 'RSI <= 70' : 
                                                     candleEval.low && candleEval.ema && candleEval.low <= candleEval.ema ? 'LOW <= EMA(5)' : 
                                                     'RSI or EMA condition not met');
                                                  
                                                  events.push({
                                                    time: formatTime(candleEval.candleTime),
                                                    evaluationTime: formatTime(candleEval.evaluationTime),
                                                    candle: candleEval.candle.time || candleEval.candle.date || 'N/A',
                                                    details: {
                                                      'Reason': reason,
                                                      'RSI': candleEval.rsi ? candleEval.rsi.toFixed(2) : 'N/A',
                                                      'EMA': candleEval.ema ? `₹${candleEval.ema.toFixed(2)}` : 'N/A',
                                                      'High': `₹${candleEval.high.toFixed(2)}`,
                                                      'Low': `₹${candleEval.low.toFixed(2)}`,
                                                      'Close': `₹${candleEval.close.toFixed(2)}`,
                                                      'Condition': 'LOW > EMA(5) AND RSI > 70 (Not Met)'
                                                    },
                                                    status: 'ignored'
                                                  });
                                                });
                                              break;
                                            case 'SIGNAL_ACTIVE':
                                              // Show ONLY candles that triggered active signal (filtered from SEARCHING_SIGNAL)
                                              allCandleEvaluations
                                                .filter(candleEval => candleEval.hasSignal && !candleEval.wasIgnored)
                                                .forEach((candleEval) => {
                                                  events.push({
                                                    time: formatTime(candleEval.candleTime),
                                                    evaluationTime: formatTime(candleEval.evaluationTime),
                                                    candle: candleEval.candle.time || candleEval.candle.date || 'N/A',
                                                    details: {
                                                      'Signal Type': candleEval.signalData?.type || 'PE',
                                                      'Signal High': `₹${candleEval.high.toFixed(2)}`,
                                                      'Signal Low': `₹${candleEval.low.toFixed(2)}`,
                                                      'EMA(5)': candleEval.ema ? `₹${candleEval.ema.toFixed(2)}` : 'N/A',
                                                      'RSI(14)': candleEval.rsi ? candleEval.rsi.toFixed(2) : 'N/A',
                                                      'Close': `₹${candleEval.close.toFixed(2)}`,
                                                      'Status': 'Waiting for entry: candle.close < signal.low'
                                                    },
                                                    status: 'active'
                                                  });
                                                });
                                              break;
                                            case 'TRADE_EXECUTED':
                                            case 'EXIT_CONDITION_EVALUATION':
                                              // Show candle where trade was executed (filtered from SIGNAL_ACTIVE)
                                              if (replayTrades && replayTrades.length > 0) {
                                                replayTrades.forEach((trade: any) => {
                                                  const tradeTime = parseTime(trade.timestamp || trade.data?.timestamp || trade.data?.entry_time);
                                                  if (tradeTime && tradeTime <= now) {
                                                    const isEntry = trade.type === 'entry' || trade.data?.type === 'entry';
                                                    if (isEntry) {
                                                      // Find the candle that triggered this entry
                                                      const entryCandle = allCandleEvaluations.find(candleEval => {
                                                        const timeDiff = Math.abs(candleEval.candleTime.getTime() - tradeTime.getTime());
                                                        return timeDiff < 5 * 60 * 1000;
                                                      });
                                                      
                                                      events.push({
                                                        time: formatTime(tradeTime),
                                                        evaluationTime: entryCandle ? formatTime(entryCandle.evaluationTime) : formatTime(tradeTime),
                                                        candle: entryCandle ? (entryCandle.candle.time || entryCandle.candle.date || 'N/A') : (trade.data?.candle_time || trade.timestamp || 'N/A'),
                                                        details: {
                                                          'Order ID': trade.data?.order_id || 'N/A',
                                                          'Symbol': trade.data?.option_symbol || trade.data?.tradingsymbol || 'N/A',
                                                          'Entry Price': `₹${trade.data?.entry_price?.toFixed(2) || 'N/A'}`,
                                                          'Quantity': trade.data?.quantity || trade.data?.total_quantity || 'N/A',
                                                          'Signal Low': entryCandle ? `₹${entryCandle.low.toFixed(2)}` : 'N/A',
                                                          'Close': entryCandle ? `₹${entryCandle.close.toFixed(2)}` : 'N/A',
                                                          'Status': currentStateId === 'TRADE_EXECUTED' ? 'Position Open' : 'Monitoring Exit'
                                                        },
                                                        status: 'executed'
                                                      });
                                                    }
                                                  }
                                                });
                                              }
                                              break;
                                            case 'EXIT_EXECUTING':
                                            case 'TRADE_COMPLETE':
                                              // Show exit candle (filtered from EXIT_CONDITION_EVALUATION)
                                              if (replayTrades && replayTrades.length > 0) {
                                                replayTrades.forEach((trade: any) => {
                                                  const tradeTime = parseTime(trade.timestamp || trade.data?.timestamp || trade.data?.exit_time);
                                                  if (tradeTime && tradeTime <= now) {
                                                    const isExit = trade.type === 'exit' || trade.data?.exit_reason;
                                                    if (isExit) {
                                                      // Find the candle where exit happened
                                                      const exitCandle = allCandleEvaluations.find(candleEval => {
                                                        const timeDiff = Math.abs(candleEval.candleTime.getTime() - tradeTime.getTime());
                                                        return timeDiff < 5 * 60 * 1000;
                                                      });
                                                      
                                                      events.push({
                                                        time: formatTime(tradeTime),
                                                        evaluationTime: exitCandle ? formatTime(exitCandle.evaluationTime) : formatTime(tradeTime),
                                                        candle: exitCandle ? (exitCandle.candle.time || exitCandle.candle.date || 'N/A') : (trade.data?.candle_time || trade.timestamp || 'N/A'),
                                                        details: {
                                                          'Exit Reason': trade.data?.exit_reason || 'Market Close',
                                                          'Exit Price': `₹${trade.data?.exit_price?.toFixed(2) || 'N/A'}`,
                                                          'Entry Price': `₹${trade.data?.entry_price?.toFixed(2) || 'N/A'}`,
                                                          'P&L': `₹${trade.data?.pnl?.toFixed(2) || 'N/A'}`,
                                                          'P&L %': trade.data?.pnl_percent ? `${trade.data.pnl_percent.toFixed(2)}%` : 'N/A',
                                                          'Status': currentStateId === 'EXIT_EXECUTING' ? 'Closing...' : 'Completed'
                                                        },
                                                        status: 'exit'
                                                      });
                                                    }
                                                  }
                                                });
                                              }
                                              break;
                                            }
                                          } else {
                                            // For live mode
                                            // Calculate 'now' for live mode - use currentTime state which updates every 30 seconds
                                            const now = currentTime;
                                            const state = deployment?.state || {};
                                            const history = state.history || [];
                                            
                                            switch (currentStateId) {
                                              case 'SEARCHING_SIGNAL':
                                                // Show all evaluations from history
                                                // Helper to format numeric values (handles 0 correctly)
                                                const formatNumericForSearch = (val: any, prefix: string = ''): string => {
                                                  if (val === null || val === undefined || (typeof val !== 'number' && isNaN(Number(val)))) {
                                                    return 'N/A';
                                                  }
                                                  const numVal = typeof val === 'number' ? val : Number(val);
                                                  return prefix ? `${prefix}${numVal.toFixed(2)}` : numVal.toFixed(2);
                                                };
                                                
                                                // Calculate current in-progress candle
                                                const getCurrentCandle = () => {
                                                  const nowDate = new Date(now);
                                                  const minutes = nowDate.getMinutes();
                                                  const seconds = nowDate.getSeconds();
                                                  
                                                  // Round down to nearest 5-minute interval (e.g., 11:13 -> 11:10)
                                                  const candleStartMinutes = Math.floor(minutes / 5) * 5;
                                                  const candleStart = new Date(nowDate);
                                                  candleStart.setMinutes(candleStartMinutes, 0, 0);
                                                  
                                                  // Candle close is 5 minutes after start (e.g., 11:10 -> 11:15)
                                                  const candleClose = new Date(candleStart);
                                                  candleClose.setMinutes(candleStartMinutes + 5, 0, 0);
                                                  
                                                  // Evaluation time is 20 seconds before candle close
                                                  const evaluationTime = new Date(candleClose.getTime() - 20 * 1000);
                                                  
                                                  return {
                                                    candleStart,
                                                    candleClose,
                                                    evaluationTime,
                                                    candleTimeStr: `${String(candleStart.getHours()).padStart(2, '0')}:${String(candleStartMinutes).padStart(2, '0')}`
                                                  };
                                                };
                                                
                                                const currentCandle = getCurrentCandle();
                                                const insights = state.strategyInsights || {};
                                                
                                                // Try to get the most recent RSI, EMA, High, Low, Close from multiple sources
                                                // Priority: 1. Latest history entry with these values, 2. strategyInsights, 3. state directly
                                                let currentRsi = insights.rsi14 ?? null;
                                                let currentEma = insights.ema5 ?? null;
                                                let currentLtp = state.currentLtp ?? insights.currentLtp ?? null;
                                                let currentHigh = insights.currentCandleHigh ?? null;
                                                let currentLow = insights.currentCandleLow ?? null;
                                                
                                                // Look for the most recent history entry that has RSI/EMA/High/Low values
                                                // This ensures we get the latest updated values
                                                if (history && history.length > 0) {
                                                  // Sort history by timestamp descending to get most recent first
                                                  const sortedHistory = [...history].sort((a: any, b: any) => {
                                                    const timeA = parseTime(a.timestamp) || new Date(0);
                                                    const timeB = parseTime(b.timestamp) || new Date(0);
                                                    return timeB.getTime() - timeA.getTime();
                                                  });
                                                  
                                                  // Find the most recent entry with RSI/EMA/High/Low data
                                                  for (const entry of sortedHistory) {
                                                    const entryTime = entry.timestamp ? parseTime(entry.timestamp) : null;
                                                    if (entryTime && entryTime <= now) {
                                                      // Check if this entry has RSI/EMA data in meta
                                                      const entryRsi = entry.meta?.rsi ?? entry.meta?.rsi14 ?? null;
                                                      const entryEma = entry.meta?.ema ?? entry.meta?.ema5 ?? null;
                                                      const entryHigh = entry.meta?.high ?? null;
                                                      const entryLow = entry.meta?.low ?? null;
                                                      const entryClose = entry.meta?.close ?? entry.meta?.currentLtp ?? null;
                                                      
                                                      // If we found values, use them (they're more recent)
                                                      if (entryRsi !== null && entryRsi !== undefined && typeof entryRsi === 'number') currentRsi = entryRsi;
                                                      if (entryEma !== null && entryEma !== undefined && typeof entryEma === 'number') currentEma = entryEma;
                                                      if (entryHigh !== null && entryHigh !== undefined && typeof entryHigh === 'number') currentHigh = entryHigh;
                                                      if (entryLow !== null && entryLow !== undefined && typeof entryLow === 'number') currentLow = entryLow;
                                                      if (entryClose !== null && entryClose !== undefined && typeof entryClose === 'number') currentLtp = entryClose;
                                                      
                                                      // If we found at least RSI or EMA, this is likely a recent evaluation
                                                      if ((entryRsi !== null && entryRsi !== undefined) || (entryEma !== null && entryEma !== undefined)) {
                                                        break; // Use this entry's values
                                                      }
                                                    }
                                                  }
                                                }
                                                
                                                // Fallback: if still no values, try to get from strategyInsights
                                                if (currentRsi === null && insights.rsi14 !== undefined && typeof insights.rsi14 === 'number') currentRsi = insights.rsi14;
                                                if (currentEma === null && insights.ema5 !== undefined && typeof insights.ema5 === 'number') currentEma = insights.ema5;
                                                if (currentHigh === null && insights.currentCandleHigh !== undefined && typeof insights.currentCandleHigh === 'number') currentHigh = insights.currentCandleHigh;
                                                if (currentLow === null && insights.currentCandleLow !== undefined && typeof insights.currentCandleLow === 'number') currentLow = insights.currentCandleLow;
                                                
                                                // Use currentLtp as fallback for High/Low if not available
                                                if (currentHigh === null) currentHigh = currentLtp;
                                                if (currentLow === null) currentLow = currentLtp;
                                                
                                                // Add current in-progress candle as first row if we have any data
                                                if (currentRsi !== null || currentEma !== null || currentLtp !== null) {
                                                  // Determine if evaluation has happened yet
                                                  const evaluationHasHappened = now >= currentCandle.evaluationTime;
                                                  const secondsUntilEvaluation = Math.max(0, Math.floor((currentCandle.evaluationTime.getTime() - now.getTime()) / 1000));
                                                  
                                                  events.push({
                                                    time: formatTime(now),
                                                    evaluationTime: formatTime(currentCandle.evaluationTime),
                                                    candle: currentCandle.candleTimeStr,
                                                    details: {
                                                      'Status': evaluationHasHappened 
                                                        ? 'Evaluation completed' 
                                                        : `Waiting for evaluation (${secondsUntilEvaluation}s)`,
                                                      'RSI': formatNumericForSearch(currentRsi),
                                                      'EMA': formatNumericForSearch(currentEma, '₹'),
                                                      'High': formatNumericForSearch(currentHigh, '₹'),
                                                      'Low': formatNumericForSearch(currentLow, '₹'),
                                                      'Close': formatNumericForSearch(currentLtp, '₹'),
                                                      'Result': evaluationHasHappened ? 'Pending evaluation' : 'In Progress'
                                                    },
                                                    status: 'in_progress',
                                                    isCurrent: true
                                                  });
                                                }
                                                
                                                history.forEach((entry: any) => {
                                                  const entryTime = parseTime(entry.timestamp);
                                                  if (entryTime && entryTime <= now) {
                                                    const evalType = entry.type || '';
                                                    if (evalType.includes('signal') || evalType.includes('evaluation') || entry.message?.toLowerCase().includes('candle')) {
                                                      // Calculate evaluation time (20 seconds before candle close)
                                                      const candleTime = parseTime(entry.meta?.candle_time || entry.timestamp);
                                                      let evaluationTime = entryTime;
                                                      if (candleTime) {
                                                        const candleCloseTime = new Date(candleTime);
                                                        candleCloseTime.setSeconds(0, 0);
                                                        evaluationTime = new Date(candleCloseTime.getTime() - 20 * 1000);
                                                      }
                                                      
                                                      // Extract RSI and EMA from multiple possible locations
                                                      const rsiValue = entry.meta?.rsi ?? entry.meta?.rsi_value ?? entry.data?.rsi ?? entry.data?.rsi_value ?? 
                                                                       (typeof entry.rsi === 'number' ? entry.rsi : null);
                                                      const emaValue = entry.meta?.ema ?? entry.meta?.ema_value ?? entry.data?.ema ?? entry.data?.ema_value ?? 
                                                                       (typeof entry.ema === 'number' ? entry.ema : null);
                                                      const highValue = entry.meta?.high ?? entry.data?.high ?? (typeof entry.high === 'number' ? entry.high : null);
                                                      const lowValue = entry.meta?.low ?? entry.data?.low ?? (typeof entry.low === 'number' ? entry.low : null);
                                                      const closeValue = entry.meta?.close ?? entry.data?.close ?? (typeof entry.close === 'number' ? entry.close : null);
                                                      
                                                      events.push({
                                                        time: formatTime(entryTime),
                                                        evaluationTime: formatTime(evaluationTime),
                                                        candle: entry.meta?.candle_time || entry.timestamp || 'N/A',
                                                        details: {
                                                          'Status': entry.message || 'Candle evaluated',
                                                          'RSI': formatNumericForSearch(rsiValue),
                                                          'EMA': formatNumericForSearch(emaValue, '₹'),
                                                          'High': formatNumericForSearch(highValue, '₹'),
                                                          'Low': formatNumericForSearch(lowValue, '₹'),
                                                          'Close': formatNumericForSearch(closeValue, '₹'),
                                                          'Result': entry.message || 'No signal'
                                                        },
                                                        status: entry.type || 'evaluated'
                                                      });
                                                    }
                                                  }
                                                });
                                                break;
                                              case 'SIGNAL_IGNORED':
                                                // Also check history for any signal_ignored entries that might not be in signalsIgnored array
                                                // This ensures we capture all evaluations, even if they weren't properly categorized
                                                const allHistoryIgnored = history.filter((entry: any) => 
                                                  entry.type === 'signal_ignored' || 
                                                  entry.message?.toLowerCase().includes('ignored') ||
                                                  entry.category === 'signal_ignored' ||
                                                  (entry.message && (
                                                    entry.message.includes('LOW') && entry.message.includes('EMA') ||
                                                    entry.message.includes('RSI') && entry.message.includes('70')
                                                  ))
                                                );
                                                
                                                // Combine signalsIgnored with history entries to ensure we don't miss any
                                                const allIgnoredEntries = new Map();
                                                
                                                // First, add entries from signalsIgnored
                                                (signalsIgnored || []).forEach((entry: any) => {
                                                  const key = entry.timestamp || entry.meta?.candle_time || entry.meta?.candleTime;
                                                  if (key) allIgnoredEntries.set(key, entry);
                                                });
                                                
                                                // Then, add entries from history that aren't already in the map
                                                allHistoryIgnored.forEach((entry: any) => {
                                                  const key = entry.timestamp || entry.meta?.candle_time || entry.meta?.candleTime;
                                                  if (key && !allIgnoredEntries.has(key)) {
                                                    allIgnoredEntries.set(key, entry);
                                                  }
                                                });
                                                
                                                // First, add current in-progress candle if we have data
                                                const getCurrentCandleForIgnored = () => {
                                                  const nowDate = new Date(now);
                                                  const minutes = nowDate.getMinutes();
                                                  
                                                  // Round down to nearest 5-minute interval (e.g., 11:46 -> 11:45)
                                                  const candleStartMinutes = Math.floor(minutes / 5) * 5;
                                                  const candleStart = new Date(nowDate);
                                                  candleStart.setMinutes(candleStartMinutes, 0, 0);
                                                  
                                                  // Candle close is 5 minutes after start (e.g., 11:45 -> 11:50)
                                                  const candleClose = new Date(candleStart);
                                                  candleClose.setMinutes(candleStartMinutes + 5, 0, 0);
                                                  
                                                  // Evaluation time is 20 seconds before candle close
                                                  const evaluationTime = new Date(candleClose.getTime() - 20 * 1000);
                                                  
                                                  return {
                                                    candleStart,
                                                    candleClose,
                                                    evaluationTime,
                                                    candleTimeStr: `${String(candleStart.getHours()).padStart(2, '0')}:${String(candleStartMinutes).padStart(2, '0')}`
                                                  };
                                                };
                                                
                                                const currentCandleIgnored = getCurrentCandleForIgnored();
                                                const insightsIgnored = state.strategyInsights || {};
                                                
                                                // Get the most recent RSI, EMA, High, Low, Close values
                                                let currentRsiIgnored = insightsIgnored.rsi14 ?? null;
                                                let currentEmaIgnored = insightsIgnored.ema5 ?? null;
                                                let currentLtpIgnored = state.currentLtp ?? insightsIgnored.currentLtp ?? null;
                                                let currentHighIgnored = insightsIgnored.currentCandleHigh ?? null;
                                                let currentLowIgnored = insightsIgnored.currentCandleLow ?? null;
                                                
                                                // Look for the most recent history entry with RSI/EMA/High/Low values
                                                if (history && history.length > 0) {
                                                  const sortedHistoryIgnored = [...history].sort((a: any, b: any) => {
                                                    const timeA = parseTime(a.timestamp) || new Date(0);
                                                    const timeB = parseTime(b.timestamp) || new Date(0);
                                                    return timeB.getTime() - timeA.getTime();
                                                  });
                                                  
                                                  for (const entry of sortedHistoryIgnored) {
                                                    const entryTime = entry.timestamp ? parseTime(entry.timestamp) : null;
                                                    if (entryTime && entryTime <= now) {
                                                      const entryRsi = entry.meta?.rsi ?? entry.meta?.rsi14 ?? null;
                                                      const entryEma = entry.meta?.ema ?? entry.meta?.ema5 ?? null;
                                                      const entryHigh = entry.meta?.high ?? null;
                                                      const entryLow = entry.meta?.low ?? null;
                                                      const entryClose = entry.meta?.close ?? entry.meta?.currentLtp ?? null;
                                                      
                                                      if (entryRsi !== null && entryRsi !== undefined && typeof entryRsi === 'number') currentRsiIgnored = entryRsi;
                                                      if (entryEma !== null && entryEma !== undefined && typeof entryEma === 'number') currentEmaIgnored = entryEma;
                                                      if (entryHigh !== null && entryHigh !== undefined && typeof entryHigh === 'number') currentHighIgnored = entryHigh;
                                                      if (entryLow !== null && entryLow !== undefined && typeof entryLow === 'number') currentLowIgnored = entryLow;
                                                      if (entryClose !== null && entryClose !== undefined && typeof entryClose === 'number') currentLtpIgnored = entryClose;
                                                      
                                                      if ((entryRsi !== null && entryRsi !== undefined) || (entryEma !== null && entryEma !== undefined)) {
                                                        break;
                                                      }
                                                    }
                                                  }
                                                }
                                                
                                                // Fallback to strategyInsights
                                                if (currentRsiIgnored === null && insightsIgnored.rsi14 !== undefined && typeof insightsIgnored.rsi14 === 'number') currentRsiIgnored = insightsIgnored.rsi14;
                                                if (currentEmaIgnored === null && insightsIgnored.ema5 !== undefined && typeof insightsIgnored.ema5 === 'number') currentEmaIgnored = insightsIgnored.ema5;
                                                if (currentHighIgnored === null && insightsIgnored.currentCandleHigh !== undefined && typeof insightsIgnored.currentCandleHigh === 'number') currentHighIgnored = insightsIgnored.currentCandleHigh;
                                                if (currentLowIgnored === null && insightsIgnored.currentCandleLow !== undefined && typeof insightsIgnored.currentCandleLow === 'number') currentLowIgnored = insightsIgnored.currentCandleLow;
                                                
                                                // Use currentLtp as fallback for High/Low
                                                if (currentHighIgnored === null) currentHighIgnored = currentLtpIgnored;
                                                if (currentLowIgnored === null) currentLowIgnored = currentLtpIgnored;
                                                
                                                // Check if there's already a completed evaluation for the current candle in history
                                                // This helps us decide whether to show the in-progress version or the completed one
                                                let hasCompletedEvaluationForCurrentCandle = false;
                                                history.forEach((entry: any) => {
                                                  const entryTime = entry.timestamp ? parseTime(entry.timestamp) : null;
                                                  if (!entryTime || entryTime > now) return;
                                                  
                                                  // Extract candle time from entry
                                                  const entryCandleTimeStr = entry.meta?.candle_time || entry.meta?.candleTime || entry.timestamp;
                                                  let entryCandleTimeOnly = '';
                                                  if (entryCandleTimeStr) {
                                                    const parsed = parseTime(entryCandleTimeStr);
                                                    if (parsed && !isNaN(parsed.getTime())) {
                                                      entryCandleTimeOnly = `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
                                                    } else if (entryCandleTimeStr.match(/^\d{2}:\d{2}/)) {
                                                      entryCandleTimeOnly = entryCandleTimeStr.substring(0, 5);
                                                    }
                                                  }
                                                  
                                                  // If we couldn't extract from meta, calculate from entryTime
                                                  if (!entryCandleTimeOnly) {
                                                    const entryDate = new Date(entryTime);
                                                    const minutes = entryDate.getMinutes();
                                                    const roundedMinutes = Math.floor(minutes / 5) * 5;
                                                    entryCandleTimeOnly = `${String(entryDate.getHours()).padStart(2, '0')}:${String(roundedMinutes).padStart(2, '0')}`;
                                                  }
                                                  
                                                  // Check if this entry is for the current candle and is a completed evaluation
                                                  const isSignalEval = entry.type === 'signal_ignored' || 
                                                    entry.type === 'signal_identified' ||
                                                    entry.message?.toLowerCase().includes('signal') ||
                                                    entry.message?.toLowerCase().includes('ignored');
                                                  
                                                  if (entryCandleTimeOnly === currentCandleIgnored.candleTimeStr && isSignalEval) {
                                                    hasCompletedEvaluationForCurrentCandle = true;
                                                  }
                                                });
                                                
                                                // Only show in-progress candle if evaluation hasn't happened yet AND there's no completed evaluation
                                                const evaluationHasHappenedIgnored = now >= currentCandleIgnored.evaluationTime;
                                                const shouldShowInProgress = !evaluationHasHappenedIgnored && !hasCompletedEvaluationForCurrentCandle;
                                                
                                                if (shouldShowInProgress && (currentRsiIgnored !== null || currentEmaIgnored !== null || currentLtpIgnored !== null)) {
                                                  const secondsUntilEvaluationIgnored = Math.max(0, Math.floor((currentCandleIgnored.evaluationTime.getTime() - now.getTime()) / 1000));
                                                  
                                                  const formatNumericForIgnored = (val: any, prefix: string = ''): string => {
                                                    if (val === null || val === undefined || (typeof val !== 'number' && isNaN(Number(val)))) {
                                                      return 'N/A';
                                                    }
                                                    const numVal = typeof val === 'number' ? val : Number(val);
                                                    return prefix ? `${prefix}${numVal.toFixed(2)}` : numVal.toFixed(2);
                                                  };
                                                  
                                                  events.push({
                                                    time: formatTime(now),
                                                    evaluationTime: formatTime(currentCandleIgnored.evaluationTime),
                                                    candle: currentCandleIgnored.candleTimeStr,
                                                    details: {
                                                      'Reason': `Waiting for evaluation (${secondsUntilEvaluationIgnored}s)`,
                                                      'RSI': formatNumericForIgnored(currentRsiIgnored),
                                                      'EMA': formatNumericForIgnored(currentEmaIgnored, '₹'),
                                                      'High': formatNumericForIgnored(currentHighIgnored, '₹'),
                                                      'Low': formatNumericForIgnored(currentLowIgnored, '₹'),
                                                      'Close': formatNumericForIgnored(currentLtpIgnored, '₹')
                                                    },
                                                    status: 'in_progress',
                                                    isCurrent: true
                                                  });
                                                }
                                                
                                                // Build a comprehensive map of all signal evaluations by candle time (HH:MM format)
                                                // This ensures we capture all evaluations, not just those in signalsIgnored
                                                const allEvaluationsByCandle = new Map<string, any>();
                                                
                                                // First, add entries from signalsIgnored (already categorized)
                                                (signalsIgnored || []).forEach((entry: any) => {
                                                  const entryTime = entry.timestamp ? parseTime(entry.timestamp) : null;
                                                  if (!entryTime || entryTime > now) return;
                                                  
                                                  // Extract candle time in HH:MM format
                                                  const entryCandleTimeStr = entry.meta?.candle_time || entry.meta?.candleTime || entry.timestamp;
                                                  let candleKey = '';
                                                  
                                                  if (entryCandleTimeStr) {
                                                    const parsed = parseTime(entryCandleTimeStr);
                                                    if (parsed && !isNaN(parsed.getTime())) {
                                                      candleKey = `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
                                                    } else if (entryCandleTimeStr.match(/^\d{2}:\d{2}/)) {
                                                      candleKey = entryCandleTimeStr.substring(0, 5);
                                                    }
                                                  }
                                                  
                                                  // If we couldn't extract from meta, calculate from entryTime
                                                  if (!candleKey && entryTime) {
                                                    const entryDate = new Date(entryTime);
                                                    const minutes = entryDate.getMinutes();
                                                    const roundedMinutes = Math.floor(minutes / 5) * 5;
                                                    candleKey = `${String(entryDate.getHours()).padStart(2, '0')}:${String(roundedMinutes).padStart(2, '0')}`;
                                                  }
                                                  
                                                  if (candleKey) {
                                                    allEvaluationsByCandle.set(candleKey, entry);
                                                  }
                                                });
                                                
                                                // Now scan ALL history entries for any signal evaluations we might have missed
                                                // This is more comprehensive than relying solely on categorizedHistory
                                                history.forEach((entry: any) => {
                                                  const entryTime = entry.timestamp ? parseTime(entry.timestamp) : null;
                                                  if (!entryTime || entryTime > now) return;
                                                  
                                                  // Check if this is a signal evaluation entry (broader check including category and message)
                                                  // Note: HistoryEntry uses 'category' field, not 'type'
                                                  const entryCategory = (entry.category || '').toLowerCase();
                                                  const entryMessage = (entry.message || '').toLowerCase();
                                                  
                                                  const isSignalEval = 
                                                    entryCategory === 'signal_ignored' ||
                                                    entryCategory === 'signal_identified' ||
                                                    (entryMessage && (
                                                      entryMessage.includes('signal') ||
                                                      entryMessage.includes('ignored') ||
                                                      entryMessage.includes('evaluation') ||
                                                      (entry.message && entry.message.includes('LOW') && entry.message.includes('EMA')) ||
                                                      (entry.message && entry.message.includes('RSI') && (entry.message.includes('70') || entry.message.includes('> 70')))
                                                    ));
                                                  
                                                  // For SIGNAL_IGNORED state, we only want ignored signals
                                                  const isIgnoredSignal = 
                                                    entryCategory === 'signal_ignored' ||
                                                    entryMessage.includes('ignored');
                                                  
                                                  if (isSignalEval && isIgnoredSignal) {
                                                    // Extract candle time in HH:MM format
                                                    const entryCandleTimeStr = entry.meta?.candle_time || entry.meta?.candleTime || entry.timestamp;
                                                    let candleKey = '';
                                                    
                                                    if (entryCandleTimeStr) {
                                                      const parsed = parseTime(entryCandleTimeStr);
                                                      if (parsed && !isNaN(parsed.getTime())) {
                                                        candleKey = `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
                                                      } else if (entryCandleTimeStr.match(/^\d{2}:\d{2}/)) {
                                                        candleKey = entryCandleTimeStr.substring(0, 5);
                                                      }
                                                    }
                                                    
                                                    // If we couldn't extract from meta, calculate from entryTime
                                                    if (!candleKey) {
                                                      const entryDate = new Date(entryTime);
                                                      const minutes = entryDate.getMinutes();
                                                      const roundedMinutes = Math.floor(minutes / 5) * 5;
                                                      candleKey = `${String(entryDate.getHours()).padStart(2, '0')}:${String(roundedMinutes).padStart(2, '0')}`;
                                                    }
                                                    
                                                    // Add if we don't already have an entry for this candle
                                                    // Prefer entries with more complete data (meta with rsi/ema)
                                                    if (candleKey) {
                                                      const existing = allEvaluationsByCandle.get(candleKey);
                                                      if (!existing) {
                                                        allEvaluationsByCandle.set(candleKey, entry);
                                                      } else {
                                                        // If existing entry has less data, replace it
                                                        const existingHasData = existing.meta?.rsi !== undefined || existing.meta?.ema !== undefined;
                                                        const newHasData = entry.meta?.rsi !== undefined || entry.meta?.ema !== undefined;
                                                        if (newHasData && !existingHasData) {
                                                          allEvaluationsByCandle.set(candleKey, entry);
                                                        }
                                                      }
                                                    }
                                                  }
                                                });
                                                
                                                // Convert map to array
                                                const allIgnoredSignals = Array.from(allEvaluationsByCandle.values());
                                                
                                                // Debug: Log what we found vs what we expect
                                                const expectedCandles = [];
                                                const nowDate = new Date(now);
                                                const startOfDay = new Date(nowDate);
                                                startOfDay.setHours(9, 15, 0, 0);
                                                
                                                // Generate expected candle times from 9:15 to current
                                                let expectedCandleTime = new Date(startOfDay);
                                                while (expectedCandleTime <= now) {
                                                  const hours = expectedCandleTime.getHours();
                                                  const minutes = expectedCandleTime.getMinutes();
                                                  expectedCandles.push(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
                                                  expectedCandleTime.setMinutes(expectedCandleTime.getMinutes() + 5);
                                                }
                                                
                                                const foundCandles = Array.from(allEvaluationsByCandle.keys()).sort();
                                                const missingCandles = expectedCandles.filter(c => !foundCandles.includes(c));
                                                
                                                if (missingCandles.length > 0) {
                                                  console.warn('Missing candle evaluations:', missingCandles);
                                                  console.log('Total history entries:', history.length);
                                                  console.log('Total found evaluations:', allIgnoredSignals.length);
                                                  
                                                  // Debug: Check if missing candles exist in history but weren't picked up
                                                  missingCandles.forEach(missingCandle => {
                                                    const entriesForCandle = history.filter((entry: any) => {
                                                      const entryTime = entry.timestamp ? parseTime(entry.timestamp) : null;
                                                      if (!entryTime) return false;
                                                      
                                                      // Calculate candle time from entry
                                                      const entryDate = new Date(entryTime);
                                                      const minutes = entryDate.getMinutes();
                                                      const roundedMinutes = Math.floor(minutes / 5) * 5;
                                                      const candleKey = `${String(entryDate.getHours()).padStart(2, '0')}:${String(roundedMinutes).padStart(2, '0')}`;
                                                      
                                                      return candleKey === missingCandle;
                                                    });
                                                    
                                                    if (entriesForCandle.length > 0) {
                                                      console.warn(`Found ${entriesForCandle.length} history entry/entries for missing candle ${missingCandle}:`, entriesForCandle.map((e: any) => ({
                                                        timestamp: e.timestamp,
                                                        category: e.category,
                                                        type: e.type,
                                                        message: e.message?.substring(0, 100)
                                                      })));
                                                    }
                                                  });
                                                }
                                                
                                                // Get current candle time string to filter out duplicates
                                                const currentCandleTimeStr = currentCandleIgnored.candleTimeStr;
                                                
                                                allIgnoredSignals.forEach((entry: any) => {
                                                  const entryTime = entry.timestamp ? parseTime(entry.timestamp) : null;
                                                  if (!entryTime || entryTime > now) return;
                                                  
                                                  // Extract candle time from entry
                                                  const entryCandleTimeStr = entry.meta?.candle_time || entry.meta?.candleTime || entry.timestamp;
                                                  // Parse to get just the time part (HH:MM)
                                                  let entryCandleTimeOnly = '';
                                                  if (entryCandleTimeStr) {
                                                    const parsed = parseTime(entryCandleTimeStr);
                                                    if (parsed && !isNaN(parsed.getTime())) {
                                                      entryCandleTimeOnly = `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
                                                    } else if (entryCandleTimeStr.match(/^\d{2}:\d{2}/)) {
                                                      entryCandleTimeOnly = entryCandleTimeStr.substring(0, 5);
                                                    }
                                                  }
                                                  
                                                  // If we couldn't extract candle time from meta, calculate from entryTime
                                                  if (!entryCandleTimeOnly) {
                                                    const entryDate = new Date(entryTime);
                                                    const minutes = entryDate.getMinutes();
                                                    const roundedMinutes = Math.floor(minutes / 5) * 5;
                                                    entryCandleTimeOnly = `${String(entryDate.getHours()).padStart(2, '0')}:${String(roundedMinutes).padStart(2, '0')}`;
                                                  }
                                                  
                                                  // Only skip if this is the current candle AND we're showing it as in-progress (evaluation hasn't happened yet)
                                                  // If evaluation has completed, we want to show the completed entry instead of the in-progress one
                                                  const isCurrentCandle = entryCandleTimeOnly === currentCandleTimeStr;
                                                  
                                                  // Skip only if it's the current candle AND we're showing it as in-progress (no completed evaluation exists)
                                                  if (isCurrentCandle && !hasCompletedEvaluationForCurrentCandle && !evaluationHasHappenedIgnored) {
                                                    return; // Skip this entry, we already have the in-progress one
                                                  }
                                                  
                                                  // Calculate evaluation time (20 seconds before candle close)
                                                  // Try multiple sources for candle time
                                                  const candleTimeStr = entry.meta?.candle_time || entry.meta?.candleTime || entry.timestamp;
                                                  let evaluationTime: Date | null = null;
                                                  
                                                  if (candleTimeStr) {
                                                    const candleTime = parseTime(candleTimeStr);
                                                    if (candleTime && !isNaN(candleTime.getTime())) {
                                                      // For 5-minute candles, the candle time is the start time
                                                      // Close time is 5 minutes after start
                                                      const candleCloseTime = new Date(candleTime);
                                                      // Add 5 minutes to get close time
                                                      candleCloseTime.setMinutes(candleCloseTime.getMinutes() + 5);
                                                      candleCloseTime.setSeconds(0, 0);
                                                      // Evaluation happens 20 seconds before candle close
                                                      evaluationTime = new Date(candleCloseTime.getTime() - 20 * 1000);
                                                    }
                                                  }
                                                  
                                                  // Fallback: if we can't parse candle time, calculate from entryTime
                                                  if (!evaluationTime || isNaN(evaluationTime.getTime())) {
                                                    // Round entryTime down to nearest 5-minute interval, add 5 min, subtract 20 sec
                                                    const entryDate = new Date(entryTime);
                                                    const minutes = entryDate.getMinutes();
                                                    const roundedMinutes = Math.floor(minutes / 5) * 5;
                                                    const candleCloseTime = new Date(entryDate);
                                                    candleCloseTime.setMinutes(roundedMinutes + 5, 0, 0);
                                                    evaluationTime = new Date(candleCloseTime.getTime() - 20 * 1000);
                                                  }
                                                  
                                                  // Extract RSI and EMA from meta (HistoryEntry uses meta, not data)
                                                  const meta = entry.meta || {};
                                                  const rsiValue = meta.rsi ?? meta.rsi_value ?? meta.rsiValue ?? null;
                                                  const emaValue = meta.ema ?? meta.ema_value ?? meta.emaValue ?? null;
                                                  const highValue = meta.high ?? meta.signal_high ?? meta.signalHigh ?? null;
                                                  const lowValue = meta.low ?? meta.signal_low ?? meta.signalLow ?? null;
                                                  const closeValue = meta.close ?? meta.currentClose ?? null;
                                                  
                                                  // Helper to format numeric values (handles 0 correctly)
                                                  const formatNumeric = (val: any, prefix: string = ''): string => {
                                                    if (val === null || val === undefined || (typeof val !== 'number' && isNaN(Number(val)))) {
                                                      return 'N/A';
                                                    }
                                                    const numVal = typeof val === 'number' ? val : Number(val);
                                                    return prefix ? `${prefix}${numVal.toFixed(2)}` : numVal.toFixed(2);
                                                  };
                                                  
                                                  // Extract reason from message or meta
                                                  const reason = entry.message || meta.reason || 'RSI or EMA condition not met';
                                                  
                                                  events.push({
                                                    time: formatTime(entryTime),
                                                    evaluationTime: formatTime(evaluationTime),
                                                    candle: entryCandleTimeOnly || meta.candle_time || meta.candleTime || entry.timestamp || 'N/A',
                                                    details: {
                                                      'Reason': reason,
                                                      'RSI': formatNumeric(rsiValue),
                                                      'EMA': formatNumeric(emaValue, '₹'),
                                                      'High': formatNumeric(highValue, '₹'),
                                                      'Low': formatNumeric(lowValue, '₹'),
                                                      'Close': formatNumeric(closeValue, '₹')
                                                    },
                                                    status: 'ignored'
                                                  });
                                                });
                                                break;
                                              case 'SIGNAL_ACTIVE':
                                                history.forEach((entry: any) => {
                                                  if (entry.type === 'signal_identified' || entry.message?.toLowerCase().includes('signal identified')) {
                                                    const entryTime = parseTime(entry.timestamp);
                                                    if (entryTime && entryTime <= now) {
                                                      // Calculate evaluation time (20 seconds before candle close)
                                                      const candleTime = parseTime(entry.meta?.candle_time || entry.timestamp);
                                                      let evaluationTime = entryTime;
                                                      if (candleTime) {
                                                        const candleCloseTime = new Date(candleTime);
                                                        candleCloseTime.setSeconds(0, 0);
                                                        evaluationTime = new Date(candleCloseTime.getTime() - 20 * 1000);
                                                      }
                                                      events.push({
                                                        time: formatTime(entryTime),
                                                        evaluationTime: formatTime(evaluationTime),
                                                        candle: entry.meta?.candle_time || entry.timestamp || 'N/A',
                                                        details: {
                                                          'Signal Type': 'PE',
                                                          'Signal High': entry.meta?.signal_high ? `₹${entry.meta.signal_high.toFixed(2)}` : 'N/A',
                                                          'Signal Low': entry.meta?.signal_low ? `₹${entry.meta.signal_low.toFixed(2)}` : 'N/A',
                                                          'EMA(5)': entry.meta?.ema ? `₹${entry.meta.ema.toFixed(2)}` : 'N/A',
                                                          'RSI(14)': entry.meta?.rsi?.toFixed(2) || 'N/A',
                                                          'Status': 'Waiting for entry: candle.close < signal.low'
                                                        },
                                                        status: 'active'
                                                      });
                                                    }
                                                  }
                                                });
                                                break;
                                              case 'TRADE_EXECUTED':
                                              case 'EXIT_CONDITION_EVALUATION':
                                                history.forEach((entry: any) => {
                                                  if (entry.type === 'entry' || entry.message?.toLowerCase().includes('entry') || entry.message?.toLowerCase().includes('order')) {
                                                    const entryTime = parseTime(entry.timestamp);
                                                    if (entryTime && entryTime <= now) {
                                                      // Calculate evaluation time (20 seconds before candle close)
                                                      const candleTime = parseTime(entry.meta?.candle_time || entry.timestamp);
                                                      let evaluationTime = entryTime;
                                                      if (candleTime) {
                                                        const candleCloseTime = new Date(candleTime);
                                                        candleCloseTime.setSeconds(0, 0);
                                                        evaluationTime = new Date(candleCloseTime.getTime() - 20 * 1000);
                                                      }
                                                      events.push({
                                                        time: formatTime(entryTime),
                                                        evaluationTime: formatTime(evaluationTime),
                                                        candle: entry.meta?.candle_time || entry.timestamp || 'N/A',
                                                        details: {
                                                          'Order ID': entry.meta?.order_id || 'N/A',
                                                          'Symbol': entry.meta?.option_symbol || entry.meta?.tradingsymbol || 'N/A',
                                                          'Entry Price': entry.meta?.entry_price ? `₹${entry.meta.entry_price.toFixed(2)}` : 'N/A',
                                                          'Quantity': entry.meta?.quantity || entry.meta?.total_quantity || 'N/A',
                                                          'Status': 'Position Open'
                                                        },
                                                        status: 'executed'
                                                      });
                                                    }
                                                  }
                                                });
                                                break;
                                              case 'EXIT_EXECUTING':
                                              case 'TRADE_COMPLETE':
                                                history.forEach((entry: any) => {
                                                  if (entry.type === 'exit' || entry.message?.toLowerCase().includes('exit')) {
                                                    const entryTime = parseTime(entry.timestamp);
                                                    if (entryTime && entryTime <= now) {
                                                      // Calculate evaluation time (20 seconds before candle close)
                                                      const candleTime = parseTime(entry.meta?.candle_time || entry.timestamp);
                                                      let evaluationTime = entryTime;
                                                      if (candleTime) {
                                                        const candleCloseTime = new Date(candleTime);
                                                        candleCloseTime.setSeconds(0, 0);
                                                        evaluationTime = new Date(candleCloseTime.getTime() - 20 * 1000);
                                                      }
                                                      events.push({
                                                        time: formatTime(entryTime),
                                                        evaluationTime: formatTime(evaluationTime),
                                                        candle: entry.meta?.candle_time || entry.timestamp || 'N/A',
                                                        details: {
                                                          'Exit Reason': entry.meta?.exit_reason || entry.message || 'Market Close',
                                                          'Exit Price': entry.meta?.exit_price ? `₹${entry.meta.exit_price.toFixed(2)}` : 'N/A',
                                                          'Entry Price': entry.meta?.entry_price ? `₹${entry.meta.entry_price.toFixed(2)}` : 'N/A',
                                                          'P&L': entry.meta?.pnl ? `₹${entry.meta.pnl.toFixed(2)}` : 'N/A',
                                                          'Status': currentStateId === 'EXIT_EXECUTING' ? 'Closing...' : 'Completed'
                                                        },
                                                        status: 'exit'
                                                      });
                                                    }
                                                  }
                                                });
                                                break;
                                            }
                                          }

                                          // Sort by candle time: in-progress at topmost, then latest candles at top, oldest at bottom
                                          events.sort((a, b) => {
                                            // Current in-progress items always go to topmost
                                            if (a.isCurrent && !b.isCurrent) return -1;
                                            if (!a.isCurrent && b.isCurrent) return 1;
                                            
                                            // For non-current items, sort by candle time (latest first, oldest last)
                                            // Try to parse candle time from event.candle, event.details, or event.time
                                            const getCandleTime = (event: any): Date => {
                                              // Helper to parse time-only format like "12:20" or "09:15"
                                              const parseTimeOnly = (timeStr: string): Date | null => {
                                                if (!timeStr || timeStr === 'N/A') return null;
                                                // Check if it's time-only format (HH:MM)
                                                const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})/);
                                                if (timeMatch) {
                                                  const hours = parseInt(timeMatch[1], 10);
                                                  const minutes = parseInt(timeMatch[2], 10);
                                                  if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
                                                    const today = new Date();
                                                    return new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes, 0, 0);
                                                  }
                                                }
                                                return null;
                                              };
                                              
                                              // Try to parse from candle field first (e.g., "11:45" or "2025-11-25T11:45:00+05:30")
                                              if (event.candle && event.candle !== 'N/A') {
                                                // First try time-only format
                                                const timeOnly = parseTimeOnly(event.candle);
                                                if (timeOnly) return timeOnly;
                                                
                                                // Then try full date format
                                                const candleTime = parseTime(event.candle);
                                                if (candleTime && !isNaN(candleTime.getTime())) return candleTime;
                                              }
                                              
                                              // Try to extract from evaluationTime which contains the candle time info
                                              if (event.evaluationTime && event.evaluationTime !== 'N/A') {
                                                const evalTime = parseTime(event.evaluationTime);
                                                if (evalTime && !isNaN(evalTime.getTime())) {
                                                  // Evaluation time is 20 seconds before candle close, so add 20 seconds to get close time
                                                  // Then subtract 5 minutes to get candle start time
                                                  const candleClose = new Date(evalTime.getTime() + 20 * 1000);
                                                  const candleStart = new Date(candleClose.getTime() - 5 * 60 * 1000);
                                                  return candleStart;
                                                }
                                              }
                                              
                                              // Fallback to event.time
                                              const timeParsed = parseTime(event.time);
                                              if (timeParsed && !isNaN(timeParsed.getTime())) return timeParsed;
                                              
                                              return new Date(0);
                                            };
                                            
                                            const candleTimeA = getCandleTime(a);
                                            const candleTimeB = getCandleTime(b);
                                            
                                            // Sort by candle time descending (latest first, oldest last)
                                            return candleTimeB.getTime() - candleTimeA.getTime();
                                          });

                                          return events;
                                        };

                                        const stateEvents = getStateEventTable();
                                        const tableHeaders = currentStateId === 'SEARCHING_SIGNAL' 
                                          ? ['Evaluation Time', 'Candle', 'RSI', 'EMA', 'High', 'Low', 'Close', 'Result']
                                          : currentStateId === 'SIGNAL_IGNORED'
                                          ? ['Evaluation Time', 'Candle', 'Reason', 'RSI', 'EMA', 'High', 'Low', 'Close']
                                          : currentStateId === 'SIGNAL_ACTIVE'
                                          ? ['Evaluation Time', 'Candle', 'Signal High', 'Signal Low', 'EMA(5)', 'RSI(14)', 'Close', 'Status']
                                          : currentStateId === 'TRADE_EXECUTED' || currentStateId === 'EXIT_CONDITION_EVALUATION'
                                          ? ['Entry Time', 'Candle', 'Order ID', 'Symbol', 'Entry Price', 'Quantity', 'Status']
                                          : ['Exit Time', 'Candle', 'Exit Reason', 'Exit Price', 'Entry Price', 'P&L', 'Status'];

                                        // Create a key based on deployment history length and last update to force re-render
                                        const historyLength = deployment?.state?.history?.length || 0;
                                        const lastUpdate = deployment?.state?.lastCheck || deployment?.lastRunAt || '';
                                        const tableKey = `${currentStateId}-${historyLength}-${lastUpdate}`;

                                        // Refresh handler for the table
                                        const handleRefreshTable = async () => {
                                          setTableRefreshing(true);
                                          try {
                                            if (isReplayMode) {
                                              // For replay mode, refresh replay data
                                              if (replayDate && selectedStrategy && currentReplayTime) {
                                                await fetchReplayData(replayDate, selectedStrategy, currentReplayTime);
                                              }
                                            } else {
                                              // For live mode, refresh deployment status
                                              await fetchDeploymentStatus();
                                            }
                                            // Force update currentTime to trigger re-render and recalculate current candle
                                            setCurrentTime(new Date());
                                            // Small delay to ensure state updates propagate
                                            await new Promise(resolve => setTimeout(resolve, 100));
                                          } catch (error) {
                                            console.error('Error refreshing table:', error);
                                          } finally {
                                            setTableRefreshing(false);
                                          }
                                        };

                                        return (
                                          <div className="mt-3" key={tableKey}>
                                            <div className="d-flex justify-content-between align-items-center mb-2">
                                              <h6 className="mb-0">
                                                <i className="bi bi-table me-2"></i>
                                                {currentStateId === 'SEARCHING_SIGNAL' 
                                                  ? 'Candle Evaluations (20 seconds before close)'
                                                  : currentStateId === 'SIGNAL_IGNORED'
                                                  ? 'Ignored Signals'
                                                  : currentStateId === 'SIGNAL_ACTIVE'
                                                  ? 'Active Signal Details'
                                                  : currentStateId === 'TRADE_EXECUTED'
                                                  ? 'Executed Trades'
                                                  : currentStateId === 'EXIT_CONDITION_EVALUATION'
                                                  ? 'Exit Condition Monitoring'
                                                  : 'Exit Events'}
                                              </h6>
                                              <button
                                                className="btn btn-sm btn-outline-primary"
                                                onClick={handleRefreshTable}
                                                disabled={tableRefreshing}
                                                title="Refresh table data"
                                              >
                                                {tableRefreshing ? (
                                                  <>
                                                    <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                                                    Refreshing...
                                                  </>
                                                ) : (
                                                  <>
                                                    <i className="bi bi-arrow-clockwise me-1"></i>
                                                    Refresh
                                                  </>
                                                )}
                                              </button>
                                            </div>
                                            {stateEvents.length === 0 ? (
                                              <div className="alert alert-secondary mb-0">
                                                <i className="bi bi-info-circle me-2"></i>
                                                No events recorded yet for this state. Table will update every 5 minutes (20 seconds before candle close).
                                              </div>
                                            ) : (
                                              <div 
                                                ref={stateEventTableRef}
                                                className="table-responsive" 
                                                style={{ maxHeight: '400px', overflowY: 'auto' }}
                                              >
                                                <table className="table table-sm table-hover table-bordered align-middle">
                                                  <thead className="table-light sticky-top">
                                                    <tr>
                                                      {tableHeaders.map((header, idx) => (
                                                        <th key={idx} style={{ fontSize: '0.85rem' }}>{header}</th>
                                                      ))}
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {stateEvents.map((event, idx) => {
                                                      const isInProgress = event.isCurrent || event.status === 'in_progress' || 
                                                        Object.values(event.details).some(val => String(val).includes('Waiting for evaluation'));
                                                      
                                                      // Extract Low and EMA values from details to check if Low > EMA
                                                      const details = event.details || {};
                                                      const lowStr = details['Low'] || details['Signal Low'] || '';
                                                      const emaStr = details['EMA'] || details['EMA(5)'] || '';
                                                      
                                                      // Parse numeric values (remove ₹ and commas, handle N/A)
                                                      const parseNumeric = (str: string): number | null => {
                                                        if (!str || str === 'N/A' || str.includes('N/A')) return null;
                                                        const cleaned = str.replace(/[₹,\s]/g, '');
                                                        const num = parseFloat(cleaned);
                                                        return isNaN(num) ? null : num;
                                                      };
                                                      
                                                      const lowValue = parseNumeric(lowStr);
                                                      const emaValue = parseNumeric(emaStr);
                                                      const lowGreaterThanEMA = lowValue !== null && emaValue !== null && lowValue > emaValue;
                                                      
                                                      return (
                                                        <tr 
                                                          key={idx}
                                                          style={{
                                                            backgroundColor: isInProgress 
                                                              ? '#fff3cd' // Light yellow/orange background for in-progress
                                                              : lowGreaterThanEMA
                                                              ? '#d1e7dd' // Light green background for Low > EMA
                                                              : idx === 0 
                                                              ? `${currentState.color}08` 
                                                              : 'white',
                                                            borderLeft: isInProgress 
                                                              ? '4px solid #ffc107' 
                                                              : lowGreaterThanEMA
                                                              ? '4px solid #198754' // Green border for Low > EMA
                                                              : 'none',
                                                            fontWeight: isInProgress ? '600' : (lowGreaterThanEMA ? '500' : 'normal')
                                                          }}
                                                          className={isInProgress ? 'table-warning' : (lowGreaterThanEMA ? 'table-success' : '')}
                                                        >
                                                          <td>
                                                            {isInProgress ? (
                                                              <span className="badge bg-warning text-dark">
                                                                <i className="bi bi-hourglass-split me-1"></i>
                                                                {event.evaluationTime || event.time}
                                                              </span>
                                                            ) : (
                                                              <span className="badge bg-info">{event.evaluationTime || event.time}</span>
                                                            )}
                                                          </td>
                                                          <td className="small">{event.candle || 'N/A'}</td>
                                                          {Object.values(event.details).slice(0, tableHeaders.length - 2).map((value, detailIdx) => (
                                                            <td key={detailIdx} className="small">
                                                              {String(value).includes('Waiting for evaluation') ? (
                                                                <span className="badge bg-warning text-dark">
                                                                  <i className="bi bi-clock-history me-1"></i>
                                                                  {String(value)}
                                                                </span>
                                                              ) : (
                                                                String(value)
                                                              )}
                                                            </td>
                                                          ))}
                                                        </tr>
                                                      );
                                                    })}
                                                  </tbody>
                                                </table>
                                                {/* Scroll Down Button */}
                                                <div className="position-relative">
                                                  <button
                                                    className="btn btn-sm btn-outline-secondary position-absolute"
                                                    style={{
                                                      bottom: '10px',
                                                      right: '10px',
                                                      zIndex: 10,
                                                      borderRadius: '50%',
                                                      width: '40px',
                                                      height: '40px',
                                                      display: 'flex',
                                                      alignItems: 'center',
                                                      justifyContent: 'center',
                                                      boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                                    }}
                                                    onClick={() => {
                                                      if (stateEventTableRef.current) {
                                                        stateEventTableRef.current.scrollTop = stateEventTableRef.current.scrollHeight;
                                                      }
                                                    }}
                                                    title="Scroll down to see older entries"
                                                  >
                                                    <i className="bi bi-arrow-down"></i>
                                                  </button>
                                                </div>
                                              </div>
                                            )}
                                            <div className="mt-2 small text-muted d-flex justify-content-between align-items-center">
                                              <span>
                                                <i className="bi bi-info-circle me-1"></i>
                                                Showing {stateEvents.length} event(s). Missing candles indicate evaluations not yet logged by backend.
                                              </span>
                                              <span className="text-primary">
                                                <i className="bi bi-arrow-up me-1"></i>
                                                Latest entries at top
                                              </span>
                                            </div>
                                          </div>
                                        );
                                      })()}

                                      {/* Real-time indicator */}
                                      <div className="mt-3 text-center">
                                        <span className="badge bg-success">
                                          <i className="bi bi-circle-fill me-1" style={{ fontSize: '0.5rem' }}></i>
                                          Live Updates Active
                                        </span>
                                        <small className="text-muted ms-2">
                                          Last updated: {new Date().toLocaleTimeString()}
                                        </small>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* State Transitions Visualization for Replay Mode */}
                  {isReplayMode && (
                    <div className="card mb-4">
                      <div className="card-header bg-info text-white">
                        <h6 className="mb-0">
                          <i className="bi bi-diagram-3-fill me-2"></i>
                          State Transitions Visualization - Strategy Logic Flow
                        </h6>
                      </div>
                      <div className="card-body">
                        {(() => {
                          // Collect all events and sort by time
                          const events: Array<{
                            time: string;
                            timestamp: Date;
                            eventType: string;
                            eventName: string;
                            description: string;
                            details: Record<string, any>;
                            color: string;
                            icon: string;
                          }> = [];

                          // Event type definitions
                          const eventDefs: Record<string, { name: string; color: string; icon: string }> = {
                            monitoring: { name: 'Monitoring Started', color: '#6c757d', icon: 'bi-eye' },
                            signal_identified: { name: 'PE Signal Identified', color: '#0d6efd', icon: 'bi-bullseye' },
                            signal_reset: { name: 'Signal Reset', color: '#ffc107', icon: 'bi-arrow-repeat' },
                            signal_ignored: { name: 'Signal Ignored', color: '#dc3545', icon: 'bi-x-circle' },
                            signal_cleared: { name: 'Signal Cleared', color: '#dc3545', icon: 'bi-x-circle' },
                            entry: { name: 'Trade Entry', color: '#198754', icon: 'bi-play-circle' },
                            exit: { name: 'Trade Exit', color: '#6f42c1', icon: 'bi-stop-circle' },
                            stop_loss: { name: 'Stop Loss Hit', color: '#dc3545', icon: 'bi-exclamation-triangle' },
                            target: { name: 'Target Hit', color: '#198754', icon: 'bi-check-circle' },
                            market_close: { name: 'Market Close', color: '#6c757d', icon: 'bi-clock' }
                          };

                          // Parse time string to Date
                          const parseTime = (timeStr: string): Date | null => {
                            if (!timeStr) return null;
                            try {
                              if (timeStr.includes('T') || timeStr.includes('Z') || timeStr.includes('+')) {
                                return new Date(timeStr);
                              }
                              if (replayDate && timeStr.includes(':')) {
                                return new Date(`${replayDate}T${timeStr}`);
                              }
                              if (timeStr.match(/^\d{2}:\d{2}/)) {
                                return new Date(`${replayDate}T${timeStr}`);
                              }
                              return new Date(timeStr);
                            } catch {
                              return null;
                            }
                          };

                          // Format time for display
                          const formatTime = (date: Date | null): string => {
                            if (!date || isNaN(date.getTime())) return 'N/A';
                            return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                          };

                          // Event 1: Monitoring Start
                          if (replayDate) {
                            events.push({
                              time: '09:15:00',
                              timestamp: parseTime(`${replayDate}T09:15:00`) || new Date(),
                              eventType: 'monitoring',
                              eventName: eventDefs.monitoring.name,
                              description: 'Strategy deployment started - Monitoring market for signals',
                              details: {
                                condition: 'Waiting for: LOW > EMA(5) AND RSI > 70',
                                evaluation: 'Every 5-minute candle, 20 seconds before close'
                              },
                              color: eventDefs.monitoring.color,
                              icon: eventDefs.monitoring.icon
                            });
                          }

                          // Events: Ignored Signals
                          if (replayIgnoredSignals && replayIgnoredSignals.length > 0) {
                            replayIgnoredSignals.forEach((sig: any) => {
                              const sigTime = sig.timestamp || sig.candle_time || sig.data?.timestamp;
                              const timestamp = parseTime(sigTime);
                              if (timestamp) {
                                const reason = sig.reason || sig.data?.reason || sig.message || 'RSI or EMA condition not met';
                                events.push({
                                  time: formatTime(timestamp),
                                  timestamp,
                                  eventType: 'signal_ignored',
                                  eventName: eventDefs.signal_ignored.name,
                                  description: `Signal evaluation - Ignored: ${reason}`,
                                  details: {
                                    reason: reason,
                                    rsi: sig.data?.rsi?.toFixed(2) || sig.rsi_value?.toFixed(2) || 'N/A',
                                    ema: sig.data?.ema?.toFixed(2) || sig.ema_value?.toFixed(2) || 'N/A',
                                    candle_high: sig.data?.high?.toFixed(2) || sig.signal_high?.toFixed(2) || 'N/A',
                                    candle_low: sig.data?.low?.toFixed(2) || sig.signal_low?.toFixed(2) || 'N/A'
                                  },
                                  color: eventDefs.signal_ignored.color,
                                  icon: eventDefs.signal_ignored.icon
                                });
                              }
                            });
                          }

                          // Events: Identified Signals
                          if (replaySignals && replaySignals.length > 0) {
                            replaySignals.forEach((sig: any, idx: number) => {
                              const sigTime = sig.timestamp || sig.candle_time || sig.data?.timestamp;
                              const timestamp = parseTime(sigTime);
                              if (timestamp) {
                                const isReset = idx > 0 && replaySignals[idx - 1];
                                const eventType = isReset ? 'signal_reset' : 'signal_identified';
                                const eventInfo = eventDefs[eventType];
                                const reasons = sig.reasons || sig.data?.reasons || [];
                                const reasonText = reasons.length > 0 ? reasons.join('; ') : 'LOW > EMA(5) AND RSI > 70';
                                
                                events.push({
                                  time: formatTime(timestamp),
                                  timestamp,
                                  eventType,
                                  eventName: eventInfo.name,
                                  description: `${eventInfo.name}: ${reasonText}`,
                                  details: {
                                    signal_type: sig.type || 'PE',
                                    signal_high: sig.signal_high?.toFixed(2) || sig.data?.signal_high?.toFixed(2) || 'N/A',
                                    signal_low: sig.signal_low?.toFixed(2) || sig.data?.signal_low?.toFixed(2) || 'N/A',
                                    ema5: sig.ema_value?.toFixed(2) || sig.data?.ema?.toFixed(2) || 'N/A',
                                    rsi14: sig.rsi_value?.toFixed(2) || sig.data?.rsi?.toFixed(2) || 'N/A',
                                    candle_time: sig.candle_time || sig.timestamp || 'N/A',
                                    reasons: reasons
                                  },
                                  color: eventInfo.color,
                                  icon: eventInfo.icon
                                });
                              }
                            });
                          }

                          // Events: Trade Entries
                          if (replayTrades && replayTrades.length > 0) {
                            replayTrades.forEach((trade: any) => {
                              const tradeTime = trade.timestamp || trade.data?.timestamp || trade.data?.entry_time || trade.data?.exit_time;
                              const timestamp = parseTime(tradeTime);
                              if (timestamp) {
                                const isEntry = trade.type === 'entry' || trade.data?.type === 'entry' || trade.data?.event_type === 'entry';
                                const isExit = trade.type === 'exit' || trade.data?.type === 'exit' || trade.data?.event_type === 'exit' || trade.data?.exit_reason;
                                
                                if (isEntry) {
                                  events.push({
                                    time: formatTime(timestamp),
                                    timestamp,
                                    eventType: 'entry',
                                    eventName: eventDefs.entry.name,
                                    description: 'Trade entry executed: Candle.close < Signal.low',
                                    details: {
                                      entry_price: trade.data?.entry_price?.toFixed(2) || 'N/A',
                                      option_symbol: trade.data?.option_symbol || trade.data?.tradingsymbol || 'N/A',
                                      quantity: trade.data?.quantity || trade.data?.total_quantity || 'N/A',
                                      lot_size: trade.data?.lot_size || 'N/A',
                                      lot_count: trade.data?.lot_count || 'N/A',
                                      stop_loss: trade.data?.stop_loss?.toFixed(2) || 'N/A',
                                      target: trade.data?.target?.toFixed(2) || 'N/A'
                                    },
                                    color: eventDefs.entry.color,
                                    icon: eventDefs.entry.icon
                                  });
                                } else if (isExit) {
                                  const exitReason = trade.data?.exit_reason || trade.data?.exit_type || 'Exit';
                                  let eventType = 'exit';
                                  
                                  if (exitReason.toLowerCase().includes('stop') || exitReason.toLowerCase().includes('stop_loss')) {
                                    eventType = 'stop_loss';
                                  } else if (exitReason.toLowerCase().includes('target') || exitReason.toLowerCase().includes('profit')) {
                                    eventType = 'target';
                                  } else if (exitReason.toLowerCase().includes('market') || exitReason.toLowerCase().includes('15:15') || exitReason.toLowerCase().includes('close')) {
                                    eventType = 'market_close';
                                  }
                                  
                                  const eventInfo = eventDefs[eventType];
                                  events.push({
                                    time: formatTime(timestamp),
                                    timestamp,
                                    eventType,
                                    eventName: eventInfo.name,
                                    description: `Trade exit: ${exitReason}`,
                                    details: {
                                      exit_reason: exitReason,
                                      exit_price: trade.data?.exit_price?.toFixed(2) || 'N/A',
                                      entry_price: trade.data?.entry_price?.toFixed(2) || 'N/A',
                                      pnl: trade.data?.pnl?.toFixed(2) || 'N/A',
                                      pnl_percent: trade.data?.pnl_percent?.toFixed(2) || 'N/A',
                                      option_symbol: trade.data?.option_symbol || trade.data?.tradingsymbol || 'N/A'
                                    },
                                    color: eventInfo.color,
                                    icon: eventInfo.icon
                                  });
                                }
                              }
                            });
                          }

                          // Events: History entries (signal cleared, etc.)
                          if (replayHistory && replayHistory.length > 0) {
                            replayHistory.forEach((entry: any) => {
                              const entryTime = entry.timestamp || entry.data?.timestamp;
                              const timestamp = parseTime(entryTime);
                              if (timestamp) {
                                const entryType = entry.type || entry.data?.type || '';
                                if (entryType.includes('cleared') || entry.message?.toLowerCase().includes('cleared')) {
                                  events.push({
                                    time: formatTime(timestamp),
                                    timestamp,
                                    eventType: 'signal_cleared',
                                    eventName: eventDefs.signal_cleared.name,
                                    description: 'Signal cleared: Criteria no longer met',
                                    details: {
                                      reason: entry.message || entry.data?.message || 'LOW < EMA(5) OR RSI ≤ 70',
                                      rsi: entry.data?.rsi?.toFixed(2) || 'N/A',
                                      ema: entry.data?.ema?.toFixed(2) || 'N/A'
                                    },
                                    color: eventDefs.signal_cleared.color,
                                    icon: eventDefs.signal_cleared.icon
                                  });
                                }
                              }
                            });
                          }

                          // Sort events by timestamp
                          events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

                          // Get current replay time
                          const currentReplayTimestamp = parseTime(`${replayDate}T${currentReplayTime}`);

                          return (
                            <div>
                              <div className="table-responsive">
                                <table className="table table-hover table-sm align-middle">
                                  <thead className="table-light">
                                    <tr>
                                      <th style={{ width: '10%' }}>Time</th>
                                      <th style={{ width: '8%' }}>Event</th>
                                      <th style={{ width: '20%' }}>Event Type</th>
                                      <th style={{ width: '25%' }}>Description</th>
                                      <th style={{ width: '37%' }}>Event Details</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {events.length === 0 ? (
                                      <tr>
                                        <td colSpan={5} className="text-center text-muted py-4">
                                          <i className="bi bi-info-circle me-2"></i>
                                          No events recorded yet. Start replay to see event timeline.
                                        </td>
                                      </tr>
                                    ) : (
                                      events.map((event, idx) => {
                                        const isCurrent = currentReplayTimestamp && 
                                          event.timestamp <= currentReplayTimestamp &&
                                          (idx === events.length - 1 || 
                                           (events[idx + 1] && events[idx + 1].timestamp > currentReplayTimestamp));
                                        
                                        return (
                                          <tr
                                            key={idx}
                                            style={{
                                              backgroundColor: isCurrent ? `${event.color}15` : 'transparent',
                                              borderLeft: isCurrent ? `4px solid ${event.color}` : 'none',
                                              fontWeight: isCurrent ? 'bold' : 'normal'
                                            }}
                                          >
                                            <td>
                                              <span className="badge bg-secondary">{event.time}</span>
                                            </td>
                                            <td className="text-center">
                                              <i className={`bi ${event.icon}`} style={{ color: event.color, fontSize: '1.3rem' }}></i>
                                            </td>
                                            <td>
                                              <span className="badge" style={{ backgroundColor: event.color, color: 'white' }}>
                                                {event.eventName}
                                              </span>
                                            </td>
                                            <td>{event.description}</td>
                                            <td>
                                              <div className="small">
                                                {Object.entries(event.details).map(([key, value], detailIdx) => (
                                                  <div key={detailIdx} className="mb-1">
                                                    <strong>{key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}:</strong>{' '}
                                                    <span className="text-muted">{String(value)}</span>
                                                  </div>
                                                ))}
                                              </div>
                                              {isCurrent && (
                                                <span className="badge bg-primary ms-2">CURRENT</span>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })
                                    )}
                                  </tbody>
                                </table>
                              </div>
                              
                              {/* Rules Reference */}
                              <div className="mt-3 p-3 border rounded bg-light">
                                <h6 className="mb-2">
                                  <i className="bi bi-file-text me-2"></i>
                                  Strategy Rules Reference (mountain_signal_pe.rules)
                                </h6>
                                <div className="small">
                                  <p className="mb-1"><strong>Evaluation:</strong> Every 5-minute candle, 20 seconds before close</p>
                                  <p className="mb-1"><strong>PE Signal:</strong> Candle LOW {'>'} EMA(5) AND RSI(14) {'>'} 70</p>
                                  <p className="mb-1"><strong>Entry:</strong> When candle.close falls below signal.low</p>
                                  <p className="mb-0"><strong>Exit Conditions:</strong> Stop Loss (-17%), Target (+45%), Market Close (15:15), Index Stop/Target</p>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
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
                          {isReplayMode ? (selectedStrategy ? `Strategy ID: ${selectedStrategy}` : 'N/A') : (deployment?.strategyName || 'N/A')}
                        </p>
                        <p className="mb-1">
                          <strong>Status:</strong>{' '}
                          {isReplayMode ? (
                            <span className="badge bg-info">
                              REPLAY: {replayDate} {currentReplayTime}
                            </span>
                          ) : (
                            <span className={`badge ${statusBadgeClass}`}>
                              {deployment?.status?.toUpperCase() || 'N/A'}
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
                          deployment?.scheduledStart
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
                          deployment?.startedAt
                            ? formatDateTime(deployment.startedAt)
                            : deployment?.status === 'SCHEDULED'
                              ? 'Pending start'
                              : deployment?.status === 'ACTIVE'
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
                            : deployment?.state?.message || '—'}
                        </p>
                        <p className="mb-1">
                          <strong>Last Check:</strong>{' '}
                          {isReplayMode 
                            ? `${replayDate} ${currentReplayTime}`
                            : formatDateTime(deployment?.state?.lastCheck)}
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
                                  (deployment?.state?.livePnl ?? 0) >= 0
                                    ? 'text-success fw-semibold'
                                    : 'text-danger fw-semibold'
                                }
                              >
                                {formatCurrency(deployment?.state?.livePnl)}
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

                  {deployment?.errorMessage && (
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

              {/* Archived Deployments Section - Always visible */}
              <div className="mb-4">
                <div className="card border-0 shadow-sm">
                  <div className="card-header bg-secondary text-white d-flex justify-content-between align-items-center">
                    <h5 className="card-title mb-0 d-flex align-items-center">
                      <i className="bi bi-archive me-2"></i>
                      Archived Deployments
                    </h5>
                    <button
                      className="btn btn-sm btn-light"
                      onClick={() => {
                        if (!showArchived) {
                          fetchArchivedDeployments();
                        }
                        setShowArchived(!showArchived);
                      }}
                    >
                      {showArchived ? 'Hide' : 'Show'} Archived
                    </button>
                  </div>
                  {showArchived && (
                    <div className="card-body">
                      {archivedLoading ? (
                        <div className="text-center py-4">
                          <span className="spinner-border spinner-border-sm me-2" role="status" />
                          Loading archived deployments...
                        </div>
                      ) : archivedDeployments.length === 0 ? (
                        <p className="text-muted mb-0">No archived deployments found.</p>
                      ) : (
                        <div className="table-responsive">
                          <table className="table table-hover table-striped mb-0">
                            <thead className="table-secondary">
                              <tr>
                                <th>Strategy</th>
                                <th>Status</th>
                                <th>Started</th>
                                <th>Archived</th>
                                <th>Final P&L</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {archivedDeployments.map((arch) => (
                                <tr key={arch.id}>
                                  <td>
                                    <strong>{arch.strategyName || 'N/A'}</strong>
                                    {arch.strategyId && (
                                      <small className="text-muted d-block">ID: {arch.strategyId}</small>
                                    )}
                                  </td>
                                  <td>
                                    <span className={`badge ${
                                      arch.status === 'active' ? 'bg-success' :
                                      arch.status === 'stopped' ? 'bg-danger' :
                                      arch.status === 'error' ? 'bg-warning' :
                                      'bg-secondary'
                                    }`}>
                                      {arch.status?.toUpperCase() || 'N/A'}
                                    </span>
                                  </td>
                                  <td>
                                    {arch.startedAt ? formatDateTime(arch.startedAt) : '—'}
                                  </td>
                                  <td>
                                    {arch.archivedAt ? formatDateTime(arch.archivedAt) : '—'}
                                  </td>
                                  <td>
                                    {arch.state?.livePnl !== undefined ? (
                                      <span className={arch.state.livePnl >= 0 ? 'text-success fw-bold' : 'text-danger fw-bold'}>
                                        ₹{arch.state.livePnl.toFixed(2)}
                                      </span>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td>
                                    <div className="d-flex gap-2">
                                      {isReplayMode && replayDate && arch.startedAt && 
                                       new Date(replayDate).toISOString().split('T')[0] === new Date(arch.startedAt).toISOString().split('T')[0] && 
                                       selectedStrategy === arch.strategyId?.toString() ? (
                                        // Show "Clear Replay" button if this archived deployment is currently being replayed
                                        <button
                                          className="btn btn-sm btn-outline-danger"
                                          onClick={handleClearReplay}
                                          title="Clear current replay and exit replay mode"
                                        >
                                          <i className="bi bi-x-circle me-1"></i>
                                          Clear Replay
                                        </button>
                                      ) : (
                                        // Show "Replay" button if not currently replaying this deployment
                                        <button
                                          className="btn btn-sm btn-outline-primary"
                                          onClick={async () => {
                                            // Load archived deployment for replay
                                            if (arch.strategyId) {
                                              // Set strategy first
                                              setSelectedStrategy(arch.strategyId.toString());
                                              
                                              // Determine the date to use for replay
                                              // Use startedAt if available (when deployment actually ran)
                                              // Otherwise use archivedAt or lastRunAt
                                              const dateToUse = arch.startedAt || arch.lastRunAt || arch.archivedAt;
                                              if (dateToUse) {
                                                const replayDateObj = new Date(dateToUse);
                                                const dateStr = replayDateObj.toISOString().split('T')[0];
                                                
                                                // Set replay mode and date
                                                setReplayDate(dateStr);
                                                setCurrentReplayTime('09:15:00'); // Start from market open
                                                setReplayProgress(0);
                                                setIsReplayMode(true);
                                                
                                                // Force immediate data fetch
                                                try {
                                                  // Fetch historical candles
                                                  await fetchHistoricalCandles(dateStr, arch.strategyId.toString());
                                                  // Fetch replay data for market open
                                                  await fetchReplayData(dateStr, arch.strategyId.toString(), '09:15:00');
                                                  
                                                  // Scroll to replay section
                                                  setTimeout(() => {
                                                    const replaySection = document.querySelector('[data-replay-section]');
                                                    if (replaySection) {
                                                      replaySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                    }
                                                  }, 500);
                                                } catch (error) {
                                                  console.error('Error loading replay data:', error);
                                                  setError('Failed to load replay data. Please try again.');
                                                }
                                              } else {
                                                setError('No valid date found for this archived deployment.');
                                              }
                                            } else {
                                              setError('Strategy ID not found for this archived deployment.');
                                            }
                                          }}
                                          title="Replay this archived deployment"
                                        >
                                          <i className="bi bi-play-circle me-1"></i>
                                          Replay
                                        </button>
                                      )}
                                      {isAdmin && (
                                        <button
                                          className="btn btn-sm btn-outline-danger"
                                          onClick={() => {
                                            if (window.confirm(`Are you sure you want to delete this archived deployment?\n\nStrategy: ${arch.strategyName || 'N/A'}\nArchived: ${arch.archivedAt ? formatDateTime(arch.archivedAt) : 'N/A'}\n\nThis action cannot be undone.`)) {
                                              handleDeleteArchived(arch.id);
                                            }
                                          }}
                                          title="Delete archived deployment (Admin only)"
                                        >
                                          <i className="bi bi-trash"></i>
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveTradeContent;


