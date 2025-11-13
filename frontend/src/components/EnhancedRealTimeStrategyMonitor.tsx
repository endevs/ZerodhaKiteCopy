import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { apiUrl, SOCKET_BASE_URL } from '../config/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart, ReferenceLine } from 'recharts';

interface EnhancedRealTimeStrategyMonitorProps {
  strategyId: string;
  onClose: () => void;
}

interface OptionPrices {
  atm_ce?: number | null;
  atm_pe?: number | null;
  atm_plus2_ce?: number | null;
  atm_plus2_pe?: number | null;
  atm_minus2_ce?: number | null;
  atm_minus2_pe?: number | null;
}

interface OptionSymbols {
  atm_ce?: string | null;
  atm_pe?: string | null;
  atm_plus2_ce?: string | null;
  atm_plus2_pe?: string | null;
  atm_minus2_ce?: string | null;
  atm_minus2_pe?: string | null;
}

interface AuditTrailEntry {
  timestamp: string;
  event_type: string;
  message: string;
  data?: any;
}

interface StrategyMetrics {
  currentPrice: number;
  entryPrice: number;
  currentPnL: number;
  unrealizedPnL: number;
  realizedPnL: number;
  quantity: number;
  status: string;
  instrument?: string;
  strategyName?: string;
  option_prices?: OptionPrices;
  option_symbols?: OptionSymbols;
  traded_instrument?: string;
  traded_instrument_token?: number | null;
  audit_trail?: AuditTrailEntry[];
  // Mountain signal specific
  signal_status?: string;
  signal_candle_time?: string;
  signal_candle_high?: number;
  signal_candle_low?: number;
  entry_order_id?: string;
  sl_order_id?: string;
  tp_order_id?: string;
  stop_loss_level?: number;
  target_profit_level?: number;
  paper_trade_mode?: boolean;
  position?: number;
  message?: string;
  last_execution_time?: string;
}

interface StrategyLog {
  timestamp: string;
  action: string;
  price: number;
  quantity: number;
  pnl: number;
  status: string;
  message?: string;
}

interface MarketTick {
  timestamp: string;
  price: number;
  volume: number;
  instrument_token: number;
}

interface StrategyLogic {
  indicator: string;
  value: number;
  operator: string;
  currentValue?: number;
  conditionMet?: boolean;
}

const EnhancedRealTimeStrategyMonitor: React.FC<EnhancedRealTimeStrategyMonitorProps> = ({ strategyId, onClose }) => {
  const [liveMetrics, setLiveMetrics] = useState<StrategyMetrics | null>(null);
  const [logs, setLogs] = useState<StrategyLog[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [auditTrail, setAuditTrail] = useState<AuditTrailEntry[]>([]);
  const [marketTicks, setMarketTicks] = useState<MarketTick[]>([]);
  const [strategyLogic, setStrategyLogic] = useState<StrategyLogic[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Initialize Socket connection
    const newSocket = io(SOCKET_BASE_URL, {
      transports: ['polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 20000
    });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setIsConnected(true);
      // Subscribe to strategy updates
      newSocket.emit('subscribe_strategy', { strategy_id: strategyId });
      // Subscribe to market data
      newSocket.emit('subscribe_market_data', { strategy_id: strategyId });
    });

    newSocket.on('disconnect', (reason: string) => {
      setIsConnected(false);
      console.log('Monitor WebSocket disconnected:', reason);
      if (reason === 'io server disconnect') {
        // Server disconnected the socket, need to reconnect manually
        newSocket.connect();
      }
    });

    newSocket.on('reconnect', () => {
      setIsConnected(true);
      console.log('Monitor WebSocket reconnected');
      // Re-subscribe after reconnection
      newSocket.emit('subscribe_strategy', { strategy_id: strategyId });
      newSocket.emit('subscribe_market_data', { strategy_id: strategyId });
    });

    // Strategy updates
    newSocket.on('strategy_update', (data: {
      strategy_id: string;
      metrics: StrategyMetrics;
      log?: StrategyLog;
      logic_status?: StrategyLogic[];
      historical_candles?: any[];
      signal_candle_high?: number;
      signal_candle_low?: number;
      pe_break_level?: number | null;
      ce_break_level?: number | null;
    }) => {
      if (data.strategy_id === strategyId) {
        // Ensure metrics values are numbers
        const parseMetricValue = (val: any): number => {
          if (val === null || val === undefined || val === '') return 0;
          const num = typeof val === 'string' ? parseFloat(val) : Number(val);
          return isNaN(num) ? 0 : num;
        };
        
        const safeMetrics: StrategyMetrics = {
          currentPrice: parseMetricValue(data.metrics.currentPrice),
          entryPrice: parseMetricValue(data.metrics.entryPrice),
          currentPnL: parseMetricValue(data.metrics.currentPnL),
          unrealizedPnL: parseMetricValue(data.metrics.unrealizedPnL),
          realizedPnL: parseMetricValue(data.metrics.realizedPnL),
          quantity: parseMetricValue(data.metrics.quantity),
          status: data.metrics.status || 'unknown',
          instrument: data.metrics.instrument || '',
          strategyName: data.metrics.strategyName || '',
          option_prices: data.metrics.option_prices || {},
          option_symbols: data.metrics.option_symbols || {},
          traded_instrument: data.metrics.traded_instrument || '',
          traded_instrument_token: data.metrics.traded_instrument_token || null,
          audit_trail: data.metrics.audit_trail || [],
          // Mountain signal specific
          signal_status: data.metrics.signal_status || '',
          signal_candle_time: data.metrics.signal_candle_time || 'N/A',
          signal_candle_high: parseMetricValue(data.metrics.signal_candle_high),
          signal_candle_low: parseMetricValue(data.metrics.signal_candle_low),
          entry_order_id: data.metrics.entry_order_id || 'N/A',
          sl_order_id: data.metrics.sl_order_id || 'N/A',
          tp_order_id: data.metrics.tp_order_id || 'N/A',
          stop_loss_level: parseMetricValue(data.metrics.stop_loss_level),
          target_profit_level: parseMetricValue(data.metrics.target_profit_level),
          paper_trade_mode: data.metrics.paper_trade_mode || false,
          position: data.metrics.position || 0,
          message: data.metrics.message || '',
          last_execution_time: data.metrics.last_execution_time || new Date().toISOString()
        };
        
        setLiveMetrics(safeMetrics);
        if (data.metrics.audit_trail && Array.isArray(data.metrics.audit_trail)) {
          setAuditTrail(data.metrics.audit_trail.slice(-100));
        }
        
        // Update candlestick chart data
        if (data.historical_candles && Array.isArray(data.historical_candles)) {
          const candleChartData = data.historical_candles.map((candle: any, index: number) => ({
            time: candle.time || '',
            timestamp: candle.time || new Date().toISOString(),
            open: parseMetricValue(candle.open),
            high: parseMetricValue(candle.high),
            low: parseMetricValue(candle.low),
            close: parseMetricValue(candle.close),
            volume: parseMetricValue(candle.volume || 0),
            ema5: parseMetricValue(candle.ema5),
            isSignalCandle: (index === data.historical_candles!.length - 2 || 
                           (data.signal_candle_high && data.signal_candle_high > 0) ||
                           (data.signal_candle_low && data.signal_candle_low > 0))
          }));
          setChartData(candleChartData);
        }
        
        if (data.log) {
          const newLog: StrategyLog = {
            ...data.log,
            timestamp: new Date().toISOString(),
            price: parseMetricValue(data.log.price),
            pnl: parseMetricValue(data.log.pnl),
            quantity: parseMetricValue(data.log.quantity || 0)
          };
          setLogs(prev => [newLog, ...prev].slice(0, 200)); // Keep last 200 logs
        }
        if (data.logic_status) {
          // Ensure logic status values are also numbers
          const safeLogicStatus = data.logic_status.map(logic => ({
            ...logic,
            currentValue: logic.currentValue !== undefined ? parseMetricValue(logic.currentValue) : undefined
          }));
          setStrategyLogic(safeLogicStatus);
        }
      }
    });

    // Market data updates
    newSocket.on('market_data', (data: {
      instrument_token: number;
      last_price: number;
      timestamp: string;
      volume: number;
    }) => {
      if (liveMetrics?.instrument && data.instrument_token) {
        const newTick: MarketTick = {
          timestamp: data.timestamp || new Date().toISOString(),
          price: data.last_price,
          volume: data.volume || 0,
          instrument_token: data.instrument_token
        };
        setMarketTicks(prev => [newTick, ...prev].slice(0, 100));
        
        // Update chart with market data
        setChartData(prev => {
          const last = prev[prev.length - 1];
          if (last) {
            return [...prev.slice(0, -1), {
              ...last,
              marketPrice: data.last_price
            }];
          }
          return prev;
        });
      }
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    newSocket.on('error', (error: any) => {
      console.error('Socket error:', error);
    });

    // Fetch initial strategy status
    const fetchInitialStatus = async () => {
      try {
        const response = await fetch(apiUrl(`/api/strategy/status/${strategyId}`), {
          credentials: 'include'
        });
        
        if (!response.ok) {
          // If strategy not running, still show the modal with a message
          if (response.status === 404) {
            setLiveMetrics({
              currentPrice: 0,
              entryPrice: 0,
              currentPnL: 0,
              unrealizedPnL: 0,
              realizedPnL: 0,
              quantity: 0,
              status: 'not_running',
              instrument: '',
              strategyName: 'Strategy not running'
            });
          }
          return;
        }
        
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (parseErr) {
          console.error('Error parsing JSON response:', parseErr);
          console.error('Response text:', text.substring(0, 500)); // Log first 500 chars
          // Try to extract some info even if JSON is malformed
          return;
        }
        
        if (data.strategy_name_display || data.status !== 'error') {
          // Ensure all numeric values are actually numbers
          const parseNumber = (val: any): number => {
            if (val === null || val === undefined || val === '') return 0;
            const num = typeof val === 'string' ? parseFloat(val) : Number(val);
            return isNaN(num) ? 0 : num;
          };
          
          setLiveMetrics({
            currentPrice: parseNumber(data.current_ltp || data.current_price || data.entry_price),
            entryPrice: parseNumber(data.entry_price),
            currentPnL: parseNumber(data.pnl),
            unrealizedPnL: parseNumber(data.pnl),
            realizedPnL: parseNumber(data.realized_pnl || 0),
            quantity: parseNumber(data.quantity),
            status: data.status || data.state || 'unknown',
            instrument: data.traded_instrument || '',
            strategyName: data.strategy_name_display || 'Strategy',
            option_prices: data.option_prices || {},
            option_symbols: data.option_symbols || {},
            traded_instrument: data.traded_instrument || '',
            traded_instrument_token: data.traded_instrument_token || null,
            audit_trail: data.audit_trail || [],
            // Mountain signal specific
            signal_status: data.signal_status || '',
            signal_candle_time: data.signal_candle_time || 'N/A',
            signal_candle_high: parseNumber(data.signal_candle_high),
            signal_candle_low: parseNumber(data.signal_candle_low),
            entry_order_id: data.entry_order_id || 'N/A',
            sl_order_id: data.sl_order_id || 'N/A',
            tp_order_id: data.tp_order_id || 'N/A',
            stop_loss_level: parseNumber(data.stop_loss_level),
            target_profit_level: parseNumber(data.target_profit_level),
            paper_trade_mode: data.paper_trade_mode || false,
            position: data.position || 0,
            message: data.message || '',
            last_execution_time: data.last_execution_time || new Date().toISOString()
          });
          
          if (data.audit_trail && Array.isArray(data.audit_trail)) {
            setAuditTrail(data.audit_trail.slice(-100)); // Keep last 100 entries for display
          }
          
          // Set historical candles for charting
          if (data.historical_candles && Array.isArray(data.historical_candles)) {
            const candleChartData = data.historical_candles.map((candle: any) => ({
              time: candle.time || '',
              timestamp: candle.time || new Date().toISOString(),
              open: parseNumber(candle.open),
              high: parseNumber(candle.high),
              low: parseNumber(candle.low),
              close: parseNumber(candle.close),
              volume: parseNumber(candle.volume || 0),
              ema5: parseNumber(candle.ema5),
              isSignalCandle: false // Will be determined by signal candle data
            }));
            setChartData(candleChartData);
          }
        }
      } catch (err) {
        // Only log actual network errors, not JSON parse errors (already handled above)
        if (!(err instanceof SyntaxError)) {
          console.error('Error fetching strategy status:', err);
        }
      }
    };

    fetchInitialStatus();

    // Auto-refresh status every 2 seconds (only if auto-refresh is enabled)
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchInitialStatus, 2000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      newSocket.emit('unsubscribe_strategy', { strategy_id: strategyId });
      newSocket.disconnect();
    };
  }, [strategyId, autoRefresh]);

  const formatTime = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
    } catch {
      return timestamp;
    }
  };

  // Safe number formatter - handles strings, null, undefined, and non-numeric values
  const formatNumber = (value: any, decimals: number = 2): string => {
    if (value === null || value === undefined || value === '') {
      return '0.00';
    }
    const num = typeof value === 'string' ? parseFloat(value) : Number(value);
    if (isNaN(num)) {
      return '0.00';
    }
    return num.toFixed(decimals);
  };

  const combinedChartData = chartData.map((point, index) => ({
    ...point,
    index,
    marketPrice: marketTicks[index]?.price || point.price
  }));

  return (
    <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 1050 }} tabIndex={-1}>
      <div className="modal-dialog modal-xl modal-dialog-centered" style={{ maxWidth: '90vw' }}>
        <div className="modal-content">
          <div className="modal-header bg-gradient text-white" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
            <div className="flex-grow-1">
              <h4 className="modal-title mb-0">
                <i className="bi bi-activity me-2"></i>
                <strong>Real-Time Strategy Monitor</strong>
                {liveMetrics?.strategyName && (
                  <span className="ms-2 badge bg-light text-dark">{liveMetrics.strategyName}</span>
                )}
              </h4>
              <small>Strategy ID: {strategyId}</small>
            </div>
            <div className="d-flex align-items-center gap-2">
              <span className={`badge ${isConnected ? 'bg-success' : 'bg-danger'}`}>
                <i className={`bi ${isConnected ? 'bi-wifi' : 'bi-wifi-off'} me-1`}></i>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-light"
                onClick={() => setAutoRefresh(!autoRefresh)}
                title={autoRefresh ? 'Pause Auto-Refresh' : 'Resume Auto-Refresh'}
              >
                <i className={`bi ${autoRefresh ? 'bi-pause-circle' : 'bi-play-circle'}`}></i>
              </button>
              <button type="button" className="btn-close btn-close-white" onClick={onClose}></button>
            </div>
          </div>
          <div className="modal-body" style={{ maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}>
            {/* Strategy Information Section */}
            {liveMetrics && (
              <div className="card mb-4 border-primary shadow-sm">
                <div className="card-header bg-primary text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-info-circle me-2"></i>
                    Strategy Information & Execution Details
                  </h5>
                </div>
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-md-4">
                      <div className="d-flex justify-content-between align-items-center p-2 bg-light rounded">
                        <span className="fw-bold">Strategy Name:</span>
                        <span className="badge bg-primary">{liveMetrics.strategyName || 'N/A'}</span>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="d-flex justify-content-between align-items-center p-2 bg-light rounded">
                        <span className="fw-bold">Status:</span>
                        <span className={`badge ${
                          liveMetrics.status === 'running' ? 'bg-success' :
                          liveMetrics.status === 'position_open' ? 'bg-info' :
                          liveMetrics.status === 'position_closed' ? 'bg-secondary' :
                          'bg-warning'
                        }`}>
                          {liveMetrics.status || 'Unknown'}
                        </span>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="d-flex justify-content-between align-items-center p-2 bg-light rounded">
                        <span className="fw-bold">Trade Mode:</span>
                        <span className={`badge ${liveMetrics.paper_trade_mode ? 'bg-warning text-dark' : 'bg-success'}`}>
                          {liveMetrics.paper_trade_mode ? 'Paper Trade' : 'Live Trade'}
                        </span>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="p-2 bg-info bg-opacity-10 rounded">
                        <small className="text-muted d-block">Last Execution Time</small>
                        <strong className="text-primary">
                          {liveMetrics.last_execution_time ? 
                            new Date(liveMetrics.last_execution_time).toLocaleString('en-US', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit'
                            }) : 'N/A'}
                        </strong>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="p-2 bg-warning bg-opacity-10 rounded">
                        <small className="text-muted d-block">Execution Timing (Mountain Strategy)</small>
                        <strong className="text-warning">
                          Every 5 minutes - 20 seconds
                        </strong>
                        <small className="text-muted d-block mt-1">
                          (e.g., 9:19:40, 9:24:40, 9:29:40, etc.)
                        </small>
                      </div>
                    </div>
                    <div className="col-md-12">
                      <div className="p-2 bg-secondary bg-opacity-10 rounded">
                        <small className="text-muted d-block">Current Strategy Message</small>
                        <strong>{liveMetrics.message || 'Waiting for market data...'}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Signal Candle Information */}
            {liveMetrics && (liveMetrics.signal_status || (liveMetrics.signal_candle_high && liveMetrics.signal_candle_high > 0) || (liveMetrics.signal_candle_low && liveMetrics.signal_candle_low > 0)) && (
              <div className="card mb-4 border-warning shadow-sm">
                <div className="card-header bg-warning text-dark">
                  <h5 className="mb-0">
                    <i className="bi bi-signal me-2"></i>
                    Signal Candle Information
                  </h5>
                </div>
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-md-4">
                      <div className="p-3 bg-warning bg-opacity-10 rounded">
                        <small className="text-muted d-block">Signal Status</small>
                        <strong className={`${liveMetrics.signal_status && liveMetrics.signal_status !== 'Waiting for market data' ? 'text-success' : 'text-muted'}`}>
                          {liveMetrics.signal_status || 'Waiting for signal...'}
                        </strong>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="p-3 bg-info bg-opacity-10 rounded">
                        <small className="text-muted d-block">Signal Candle Time</small>
                        <strong>{liveMetrics.signal_candle_time || 'N/A'}</strong>
                      </div>
                    </div>
                    <div className="col-md-2">
                      <div className="p-3 bg-success bg-opacity-10 rounded">
                        <small className="text-muted d-block">High</small>
                        <strong className="text-success">{formatNumber(liveMetrics.signal_candle_high)}</strong>
                      </div>
                    </div>
                    <div className="col-md-2">
                      <div className="p-3 bg-danger bg-opacity-10 rounded">
                        <small className="text-muted d-block">Low</small>
                        <strong className="text-danger">{formatNumber(liveMetrics.signal_candle_low)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Trade Details Section */}
            {liveMetrics && (liveMetrics.traded_instrument || liveMetrics.entry_order_id !== 'N/A') && (
              <div className="card mb-4 border-success shadow-sm">
                <div className="card-header bg-success text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-graph-up-arrow me-2"></i>
                    Active Trade Details
                  </h5>
                </div>
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-md-3">
                      <div className="p-2 bg-light rounded">
                        <small className="text-muted d-block">Traded Instrument</small>
                        <strong>{liveMetrics.traded_instrument || 'N/A'}</strong>
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="p-2 bg-light rounded">
                        <small className="text-muted d-block">Entry Price</small>
                        <strong className="text-info">₹{formatNumber(liveMetrics.entryPrice)}</strong>
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="p-2 bg-light rounded">
                        <small className="text-muted d-block">Current P&L</small>
                        <strong className={`${(liveMetrics.currentPnL || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                          ₹{formatNumber(liveMetrics.currentPnL)}
                        </strong>
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="p-2 bg-light rounded">
                        <small className="text-muted d-block">Position</small>
                        <strong className={`badge ${
                          liveMetrics.position === 1 ? 'bg-success' :
                          liveMetrics.position === -1 ? 'bg-danger' :
                          'bg-secondary'
                        }`}>
                          {liveMetrics.position === 1 ? 'LONG (CE)' :
                           liveMetrics.position === -1 ? 'SHORT (PE)' :
                           'FLAT'}
                        </strong>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="p-2 bg-info bg-opacity-10 rounded">
                        <small className="text-muted d-block">Entry Order ID</small>
                        <strong className="text-primary">{liveMetrics.entry_order_id || 'N/A'}</strong>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="p-2 bg-danger bg-opacity-10 rounded">
                        <small className="text-muted d-block">Stop Loss Order ID</small>
                        <strong className="text-danger">{liveMetrics.sl_order_id || 'N/A'}</strong>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="p-2 bg-success bg-opacity-10 rounded">
                        <small className="text-muted d-block">Target Profit Order ID</small>
                        <strong className="text-success">{liveMetrics.tp_order_id || 'N/A'}</strong>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="p-2 bg-danger bg-opacity-10 rounded">
                        <small className="text-muted d-block">Stop Loss Level</small>
                        <strong className="text-danger">₹{formatNumber(liveMetrics.stop_loss_level)}</strong>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="p-2 bg-success bg-opacity-10 rounded">
                        <small className="text-muted d-block">Target Profit Level</small>
                        <strong className="text-success">
                          {(liveMetrics.target_profit_level && liveMetrics.target_profit_level > 0) ? `₹${formatNumber(liveMetrics.target_profit_level)}` : 'Dynamic'}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Live Metrics Dashboard */}
            {liveMetrics && (
              <div className="row g-3 mb-4">
                <div className="col-md-3">
                  <div className="card border-primary shadow-sm">
                    <div className="card-header bg-primary text-white">
                      <small className="d-block">Current Market Price</small>
                    </div>
                    <div className="card-body text-center">
                      <h2 className="mb-0 fw-bold text-primary">
                        {formatNumber(liveMetrics.currentPrice)}
                      </h2>
                      <small className="text-muted">LTP</small>
                    </div>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="card border-info shadow-sm">
                    <div className="card-header bg-info text-white">
                      <small className="d-block">Entry Price</small>
                    </div>
                    <div className="card-body text-center">
                      <h2 className="mb-0 fw-bold">
                        {formatNumber(liveMetrics.entryPrice)}
                      </h2>
                      <small className="text-muted">Entry</small>
                    </div>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="card border-success shadow-sm">
                    <div className="card-header bg-success text-white">
                      <small className="d-block">Current P&L</small>
                    </div>
                    <div className="card-body text-center">
                      <h2 className={`mb-0 fw-bold ${(liveMetrics.currentPnL || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                        ₹{formatNumber(liveMetrics.currentPnL)}
                      </h2>
                      <small className="text-muted">Live P&L</small>
                    </div>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="card border-warning shadow-sm">
                    <div className="card-header bg-warning text-dark">
                      <small className="d-block">Position Size</small>
                    </div>
                    <div className="card-body text-center">
                      <h2 className="mb-0 fw-bold">{liveMetrics.quantity}</h2>
                      <small className="text-muted">Qty</small>
                    </div>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="card border-success shadow-sm">
                    <div className="card-header bg-success text-white">
                      <small className="d-block">Unrealized P&L</small>
                    </div>
                    <div className="card-body text-center">
                      <h3 className={`mb-0 fw-bold ${(liveMetrics.unrealizedPnL || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                        ₹{formatNumber(liveMetrics.unrealizedPnL)}
                      </h3>
                    </div>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="card border-info shadow-sm">
                    <div className="card-header bg-info text-white">
                      <small className="d-block">Realized P&L</small>
                    </div>
                    <div className="card-body text-center">
                      <h3 className={`mb-0 fw-bold ${(liveMetrics.realizedPnL || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                        ₹{formatNumber(liveMetrics.realizedPnL)}
                      </h3>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Option Prices Section */}
            {liveMetrics && (
              <div className="card mb-4 border-secondary shadow-sm">
                <div className="card-header bg-secondary text-white">
                  <h6 className="mb-0">
                    <i className="bi bi-graph-up-arrow me-2"></i>
                    {liveMetrics.traded_instrument ? 'Traded Option Price' : 'Option Prices (ATM, ATM±2)'}
                  </h6>
                </div>
                <div className="card-body">
                  {liveMetrics.traded_instrument ? (
                    // Show only traded option when trade is active
                    <div className="row g-3">
                      <div className="col-md-12">
                        <div className="card border-primary">
                          <div className="card-body">
                            <div className="d-flex justify-content-between align-items-center">
                              <div>
                                <h5 className="mb-1">{liveMetrics.traded_instrument}</h5>
                                <small className="text-muted">Active Position</small>
                              </div>
                              <div className="text-end">
                                <h3 className={`mb-0 fw-bold ${(liveMetrics.currentPnL || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                                  {formatNumber(liveMetrics.currentPrice)}
                                </h3>
                                <small className="text-muted">Current Price</small>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Show ATM, ATM+2, ATM-2 option prices when no trade
                    <div className="row g-3">
                      <div className="col-md-4">
                        <div className="card border-info">
                          <div className="card-header bg-info text-white py-2">
                            <small className="fw-bold">ATM Options</small>
                          </div>
                          <div className="card-body">
                            <div className="d-flex justify-content-between mb-2">
                              <span>CE:</span>
                              <strong>{liveMetrics.option_prices?.atm_ce !== null && liveMetrics.option_prices?.atm_ce !== undefined 
                                ? formatNumber(liveMetrics.option_prices.atm_ce) 
                                : '--'}</strong>
                            </div>
                            <div className="d-flex justify-content-between">
                              <span>PE:</span>
                              <strong>{liveMetrics.option_prices?.atm_pe !== null && liveMetrics.option_prices?.atm_pe !== undefined 
                                ? formatNumber(liveMetrics.option_prices.atm_pe) 
                                : '--'}</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="card border-warning">
                          <div className="card-header bg-warning text-dark py-2">
                            <small className="fw-bold">ATM+2</small>
                          </div>
                          <div className="card-body">
                            <div className="d-flex justify-content-between mb-2">
                              <span>CE:</span>
                              <strong>{liveMetrics.option_prices?.atm_plus2_ce !== null && liveMetrics.option_prices?.atm_plus2_ce !== undefined 
                                ? formatNumber(liveMetrics.option_prices.atm_plus2_ce) 
                                : '--'}</strong>
                            </div>
                            <div className="d-flex justify-content-between">
                              <span>PE:</span>
                              <strong>{liveMetrics.option_prices?.atm_plus2_pe !== null && liveMetrics.option_prices?.atm_plus2_pe !== undefined 
                                ? formatNumber(liveMetrics.option_prices.atm_plus2_pe) 
                                : '--'}</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="card border-danger">
                          <div className="card-header bg-danger text-white py-2">
                            <small className="fw-bold">ATM-2</small>
                          </div>
                          <div className="card-body">
                            <div className="d-flex justify-content-between mb-2">
                              <span>CE:</span>
                              <strong>{liveMetrics.option_prices?.atm_minus2_ce !== null && liveMetrics.option_prices?.atm_minus2_ce !== undefined 
                                ? formatNumber(liveMetrics.option_prices.atm_minus2_ce) 
                                : '--'}</strong>
                            </div>
                            <div className="d-flex justify-content-between">
                              <span>PE:</span>
                              <strong>{liveMetrics.option_prices?.atm_minus2_pe !== null && liveMetrics.option_prices?.atm_minus2_pe !== undefined 
                                ? formatNumber(liveMetrics.option_prices.atm_minus2_pe) 
                                : '--'}</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Strategy Logic Status */}
            {strategyLogic.length > 0 && (
              <div className="card mb-4 border-primary">
                <div className="card-header bg-primary text-white">
                  <h6 className="mb-0">
                    <i className="bi bi-diagram-3 me-2"></i>Strategy Logic Status (Live Market Alignment)
                  </h6>
                </div>
                <div className="card-body">
                  <div className="row g-2">
                    {strategyLogic.map((logic, index) => (
                      <div key={index} className="col-md-6">
                        <div className={`card ${logic.conditionMet ? 'border-success' : 'border-secondary'}`}>
                          <div className="card-body p-2">
                            <div className="d-flex justify-content-between align-items-center">
                              <div>
                                <strong className="small">{logic.indicator}</strong>
                                <div className="small text-muted">
                                  {logic.operator} {logic.value}
                                </div>
                                {logic.currentValue !== undefined && (
                                  <div className="small">
                                    Current: <strong>{formatNumber(logic.currentValue)}</strong>
                                  </div>
                                )}
                              </div>
                              <span className={`badge ${logic.conditionMet ? 'bg-success' : 'bg-secondary'}`}>
                                {logic.conditionMet ? 'Met' : 'Not Met'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Real-Time Candlestick Chart with 5 EMA and Signal Candle */}
            <div className="card mb-4 shadow-sm border-primary">
              <div className="card-header bg-primary text-white">
                <h5 className="mb-0">
                  <i className="bi bi-bar-chart-fill me-2"></i>
                  Real-Time Candlestick Chart with 5 EMA & Signal Candle
                </h5>
              </div>
              <div className="card-body">
                {chartData.length > 0 && chartData.some(c => c.open && c.high && c.low && c.close) ? (
                  <div style={{ height: '500px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                        <XAxis 
                          dataKey="time" 
                          stroke="#666"
                          style={{ fontSize: '11px' }}
                          angle={-45}
                          textAnchor="end"
                          height={80}
                        />
                        <YAxis 
                          yAxisId="price"
                          stroke="#0d6efd"
                          style={{ fontSize: '12px' }}
                          label={{ value: 'Price', angle: -90, position: 'insideLeft' }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                          }}
                          formatter={(value: any, name: string, props: any) => {
                            if (name === 'Candle') {
                              return [`O: ${formatNumber(props.payload.open)} H: ${formatNumber(props.payload.high)} L: ${formatNumber(props.payload.low)} C: ${formatNumber(props.payload.close)}`, 'OHLC'];
                            }
                            return [formatNumber(value), name];
                          }}
                        />
                        <Legend />
                        
                        {/* 5 EMA Line */}
                        {chartData.some(c => c.ema5 > 0) && (
                          <Line
                            yAxisId="price"
                            type="monotone"
                            dataKey="ema5"
                            stroke="#ff9800"
                            strokeWidth={2}
                            name="5 EMA"
                            dot={false}
                            strokeDasharray=""
                          />
                        )}
                        
                        {/* High Line */}
                        <Line
                          yAxisId="price"
                          type="monotone"
                          dataKey="high"
                          stroke="#28a745"
                          strokeWidth={1}
                          name="High"
                          dot={false}
                          strokeDasharray="2 2"
                        />
                        
                        {/* Low Line */}
                        <Line
                          yAxisId="price"
                          type="monotone"
                          dataKey="low"
                          stroke="#dc3545"
                          strokeWidth={1}
                          name="Low"
                          dot={false}
                          strokeDasharray="2 2"
                        />
                        
                        {/* Close Line (main price line) */}
                        <Line
                          yAxisId="price"
                          type="monotone"
                          dataKey="close"
                          stroke="#0d6efd"
                          strokeWidth={2.5}
                          name="Close Price"
                          dot={{ fill: '#0d6efd', r: 3 }}
                        />
                        
                        {/* Signal Candle High Reference Line */}
                        {liveMetrics && liveMetrics.signal_candle_high && liveMetrics.signal_candle_high > 0 && (
                          <ReferenceLine
                            yAxisId="price"
                            y={liveMetrics.signal_candle_high}
                            stroke="#ffc107"
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            label={{ value: `Signal High: ${formatNumber(liveMetrics.signal_candle_high)}`, position: 'right' }}
                          />
                        )}
                        
                        {/* Signal Candle Low Reference Line */}
                        {liveMetrics && liveMetrics.signal_candle_low && liveMetrics.signal_candle_low > 0 && (
                          <ReferenceLine
                            yAxisId="price"
                            y={liveMetrics.signal_candle_low}
                            stroke="#ffc107"
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            label={{ value: `Signal Low: ${formatNumber(liveMetrics.signal_candle_low)}`, position: 'right' }}
                          />
                        )}
                        
                        {/* PE Break Level (below signal candle low for PE entry) */}
                        {liveMetrics && liveMetrics.position === -1 && liveMetrics.signal_candle_low && liveMetrics.signal_candle_low > 0 && (
                          <ReferenceLine
                            yAxisId="price"
                            y={liveMetrics.signal_candle_low}
                            stroke="#dc3545"
                            strokeWidth={2}
                            strokeDasharray="3 3"
                            label={{ value: `PE Break: ${formatNumber(liveMetrics.signal_candle_low)}`, position: 'right', fill: '#dc3545' }}
                          />
                        )}
                        
                        {/* CE Break Level (above signal candle high for CE entry) */}
                        {liveMetrics && liveMetrics.position === 1 && liveMetrics.signal_candle_high && liveMetrics.signal_candle_high > 0 && (
                          <ReferenceLine
                            yAxisId="price"
                            y={liveMetrics.signal_candle_high}
                            stroke="#28a745"
                            strokeWidth={2}
                            strokeDasharray="3 3"
                            label={{ value: `CE Break: ${formatNumber(liveMetrics.signal_candle_high)}`, position: 'right', fill: '#28a745' }}
                          />
                        )}
                        
                        {/* Entry Price Line */}
                        {liveMetrics && liveMetrics.entryPrice > 0 && (
                          <ReferenceLine
                            yAxisId="price"
                            y={liveMetrics.entryPrice}
                            stroke="#6f42c1"
                            strokeWidth={2}
                            strokeDasharray="4 4"
                            label={{ value: `Entry: ${formatNumber(liveMetrics.entryPrice)}`, position: 'right', fill: '#6f42c1' }}
                          />
                        )}
                        
                        {/* Stop Loss Level */}
                        {liveMetrics && liveMetrics.stop_loss_level && liveMetrics.stop_loss_level > 0 && (
                          <ReferenceLine
                            yAxisId="price"
                            y={liveMetrics.stop_loss_level}
                            stroke="#dc3545"
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            label={{ value: `SL: ${formatNumber(liveMetrics.stop_loss_level)}`, position: 'right', fill: '#dc3545' }}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                    
                    {/* Chart Legend Info */}
                    <div className="mt-3 p-2 bg-light rounded">
                      <div className="row text-center">
                        <div className="col-md-3">
                          <span className="badge bg-primary">Blue: Close Price</span>
                        </div>
                        <div className="col-md-3">
                          <span className="badge bg-warning text-dark">Orange: 5 EMA</span>
                        </div>
                        <div className="col-md-3">
                          <span className="badge bg-success">Green: High</span>
                        </div>
                        <div className="col-md-3">
                          <span className="badge bg-danger">Red: Low</span>
                        </div>
                        {liveMetrics && liveMetrics.signal_candle_high && liveMetrics.signal_candle_high > 0 && (
                          <div className="col-md-12 mt-2">
                            <span className="badge bg-warning text-dark me-2">Yellow Dashed: Signal Candle Levels</span>
                            {liveMetrics.position === -1 && <span className="badge bg-danger">Red: PE Break Level</span>}
                            {liveMetrics.position === 1 && <span className="badge bg-success ms-2">Green: CE Break Level</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-5 text-muted">
                    <i className="bi bi-bar-chart-fill fs-1 d-block mb-3"></i>
                    <p>Waiting for candlestick data...</p>
                    <small>Chart will display 5-minute candles with 5 EMA and signal candle levels when available</small>
                  </div>
                )}
              </div>
            </div>

            {/* Today's Signal History */}
            {Array.isArray((liveMetrics as any)?.signal_history_today) && (liveMetrics as any).signal_history_today.length > 0 && (
              <div className="card mb-4 border-warning">
                <div className="card-header bg-warning text-dark">
                  <h6 className="mb-0">
                    <i className="bi bi-clock-history me-2"></i>Today's Signal History (latest considered for trade)
                  </h6>
                </div>
                <div className="card-body p-0">
                  <table className="table table-sm table-striped mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>#</th>
                        <th>Type</th>
                        <th>Time</th>
                        <th>High</th>
                        <th>Low</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(liveMetrics as any).signal_history_today.slice(-50).map((s: any, idx: number) => (
                        <tr key={idx}>
                          <td>{idx + 1}</td>
                          <td><span className={`badge ${s.type === 'CE' ? 'bg-success' : 'bg-danger'}`}>{s.type}</span></td>
                          <td className="small">{s.time}</td>
                          <td>{formatNumber(s.high)}</td>
                          <td>{formatNumber(s.low)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Strategy Activity Log with Live Market Alignment */}
            <div className="row">
              <div className="col-md-8">
                <div className="card shadow-sm">
                  <div className="card-header bg-dark text-white">
                    <div className="d-flex justify-content-between align-items-center">
                      <h6 className="mb-0">
                        <i className="bi bi-list-ul me-2"></i>Strategy Activity Log
                      </h6>
                      <span className="badge bg-success">Live</span>
                    </div>
                  </div>
                  <div className="card-body p-0" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {logs.length === 0 ? (
                      <div className="text-center py-5 text-muted">
                        <i className="bi bi-hourglass-split fs-1 d-block mb-3"></i>
                        <p>No activity yet. Waiting for strategy signals...</p>
                        <small>Strategy logic will execute based on live market conditions</small>
                      </div>
                    ) : (
                      <table className="table table-sm table-hover mb-0">
                        <thead className="table-light sticky-top">
                          <tr>
                            <th>Time</th>
                            <th>Action</th>
                            <th>Price</th>
                            <th>Qty</th>
                            <th>P&L</th>
                            <th>Status</th>
                            <th>Market Context</th>
                          </tr>
                        </thead>
                        <tbody>
                          {logs.map((log, index) => (
                            <tr key={index} className={index === 0 ? 'table-info' : ''}>
                              <td className="small">{formatTime(log.timestamp)}</td>
                              <td>
                                <span className={`badge ${
                                  log.action === 'BUY' || log.action === 'ENTRY' ? 'bg-success' :
                                  log.action === 'SELL' || log.action === 'EXIT' ? 'bg-danger' :
                                  log.action === 'STOP_LOSS' ? 'bg-warning' :
                                  log.action === 'TARGET' ? 'bg-info' : 'bg-secondary'
                                }`}>
                                  {log.action}
                                </span>
                              </td>
                              <td className="fw-bold">{formatNumber(log.price)}</td>
                              <td>{log.quantity}</td>
                              <td className={log.pnl >= 0 ? 'text-success fw-bold' : 'text-danger fw-bold'}>
                                ₹{formatNumber(log.pnl)}
                              </td>
                              <td>
                                <span className={`badge ${
                                  log.status === 'filled' ? 'bg-success' :
                                  log.status === 'pending' ? 'bg-warning' :
                                  'bg-secondary'
                                }`}>
                                  {log.status}
                                </span>
                              </td>
                              <td className="small text-muted">
                                {log.message || 'Market condition triggered'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
              <div className="col-md-4">
                <div className="card shadow-sm">
                  <div className="card-header bg-info text-white">
                    <h6 className="mb-0">
                      <i className="bi bi-speedometer2 me-2"></i>Live Market Ticks
                    </h6>
                  </div>
                  <div className="card-body p-0" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {marketTicks.length === 0 ? (
                      <div className="text-center py-4 text-muted small">
                        Waiting for market data...
                      </div>
                    ) : (
                      <div className="list-group list-group-flush">
                        {marketTicks.slice(0, 20).map((tick, index) => (
                          <div key={index} className="list-group-item px-3 py-2">
                            <div className="d-flex justify-content-between align-items-center">
                              <div>
                                <div className="fw-bold text-primary">{formatNumber(tick.price)}</div>
                                <small className="text-muted">{formatTime(tick.timestamp)}</small>
                              </div>
                              <small className="text-muted">Vol: {tick.volume}</small>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Audit Trail / Strategy Behavior History */}
            {auditTrail.length > 0 && (
              <div className="card mb-4 border-dark shadow-sm">
                <div className="card-header bg-dark text-white">
                  <h6 className="mb-0">
                    <i className="bi bi-journal-text me-2"></i>Audit Trail & Strategy Behavior History
                  </h6>
                </div>
                <div className="card-body p-0">
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    <table className="table table-sm table-hover mb-0">
                      <thead className="table-light sticky-top">
                        <tr>
                          <th>Time</th>
                          <th>Event Type</th>
                          <th>Message</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {auditTrail.slice().reverse().map((entry, index) => (
                          <tr key={index}>
                            <td className="small">{formatTime(entry.timestamp)}</td>
                            <td>
                              <span className={`badge ${
                                entry.event_type === 'signal_identified' ? 'bg-primary' :
                                entry.event_type === 'entry' ? 'bg-success' :
                                entry.event_type === 'exit' ? 'bg-info' :
                                entry.event_type === 'stop_loss' ? 'bg-danger' :
                                entry.event_type === 'target_hit' ? 'bg-warning' :
                                'bg-secondary'
                              }`}>
                                {entry.event_type}
                              </span>
                            </td>
                            <td className="small">{entry.message}</td>
                            <td className="small text-muted">
                              {entry.data && Object.keys(entry.data).length > 0 ? (
                                <details>
                                  <summary className="text-primary" style={{ cursor: 'pointer' }}>View Details</summary>
                                  <pre className="mt-2 mb-0 small" style={{ fontSize: '0.75rem' }}>
                                    {JSON.stringify(entry.data, null, 2)}
                                  </pre>
                                </details>
                              ) : '--'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer bg-light">
            <div className="flex-grow-1">
              <small className="text-muted">
                <i className="bi bi-info-circle me-1"></i>
                Real-time monitoring aligned with live market data. All strategy logic executes based on current market conditions.
              </small>
            </div>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              <i className="bi bi-x-circle me-2"></i>Close Monitor
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnhancedRealTimeStrategyMonitor;

