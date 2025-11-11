import React, { useState, useEffect, useMemo } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Customized } from 'recharts';
import { io } from 'socket.io-client';

interface Strategy {
  id: number;
  strategy_name: string;
  strategy_type: string;
  instrument: string;
  candle_time: string;
  ema_period?: number;
  start_time: string;
  end_time: string;
  stop_loss: number;
  target_profit: number;
  total_lot: number;
  expiry_type: string;
}

interface AuditLog {
  id: number;
  timestamp: string;
  type: 'info' | 'signal' | 'entry' | 'exit' | 'warning' | 'error';
  message: string;
  details?: any;
}

interface TradeEvent {
  signalTime?: string;
  signalType?: 'PE' | 'CE';
  signalHigh?: number;
  signalLow?: number;
  entryTime?: string;
  entryPrice?: number;
  exitTime?: string;
  exitPrice?: number;
  exitType?: 'STOP_LOSS' | 'TARGET' | 'MKT_CLOSE' | null;
  pnl?: number;
  pnlPercent?: number;
  optionSymbol?: string;
  optionPrice?: number;
}

interface CandleData {
  x: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface PaperTradeContentProps {}

const PaperTradeContent: React.FC<PaperTradeContentProps> = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [liveChartData, setLiveChartData] = useState<CandleData[]>([]);
  const [ema5Data, setEma5Data] = useState<Array<{ x: string; y: number | null }>>([]);
  const [rsi14Data, setRsi14Data] = useState<Array<{ x: string; y: number | null }>>([]);
  const [tradeHistory, setTradeHistory] = useState<TradeEvent[]>([]);
  const [currentStatus, setCurrentStatus] = useState<string>('Not started');
  const [chartType, setChartType] = useState<'candlestick' | 'line'>('candlestick');
  const [signalCandles, setSignalCandles] = useState<Array<{ index: number; type: 'PE' | 'CE'; high: number; low: number; time: string }>>([]);
  const [tradeEvents, setTradeEvents] = useState<Array<{ index: number; type: 'ENTRY' | 'STOP_LOSS' | 'TARGET' | 'MKT_CLOSE'; tradeType: 'PE' | 'CE'; price: number; time: string }>>([]);
  const [historicalSessions, setHistoricalSessions] = useState<Array<any>>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'live' | 'historical'>('live');

  // Fetch historical sessions
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const url = selectedDate 
          ? `http://localhost:8000/api/paper_trade/sessions?date=${selectedDate}`
          : 'http://localhost:8000/api/paper_trade/sessions';
        const response = await fetch(url, { credentials: 'include' });
        const data = await response.json();
        if (response.ok && data.status === 'success') {
          setHistoricalSessions(data.sessions || []);
        }
      } catch (error) {
        console.error('Error fetching historical sessions:', error);
      }
    };

    if (viewMode === 'historical') {
      fetchSessions();
    }
  }, [selectedDate, viewMode]);

  // Fetch audit trail for selected session
  useEffect(() => {
    if (!selectedSessionId || viewMode !== 'historical') return;

    const fetchAuditTrail = async () => {
      try {
        const response = await fetch(`http://localhost:8000/api/paper_trade/audit_trail/${selectedSessionId}`, {
          credentials: 'include'
        });
        const data = await response.json();
        if (response.ok && data.status === 'success') {
          setAuditLogs(data.audit_logs || []);
        }
      } catch (error) {
        console.error('Error fetching audit trail:', error);
      }
    };

    fetchAuditTrail();
  }, [selectedSessionId, viewMode]);

  // Fetch strategies
  useEffect(() => {
    const fetchStrategies = async () => {
      try {
        setLoading(true);
        const response = await fetch('http://localhost:8000/api/strategies', {
          credentials: 'include',
        });
        const data = await response.json();
        if (response.ok && data.status === 'success') {
          // Filter only Mountain Signal strategies
          const mountainStrategies = (data.strategies || []).filter(
            (s: Strategy) => s.strategy_type === 'capture_mountain_signal'
          );
          setStrategies(mountainStrategies);
        } else {
          console.error('Error fetching strategies:', data.message);
        }
      } catch (error) {
        console.error('Error fetching strategies:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStrategies();
  }, []);

  // SocketIO connection for live data
  useEffect(() => {
    if (!isRunning || !selectedStrategy) return;

    const socket = io('http://localhost:8000', {
      transports: ['polling', 'websocket'],
      withCredentials: true
    });
    
    socket.on('connect', () => {
      console.log('SocketIO connected for paper trading');
      // Join paper trade room
      socket.emit('join_paper_trade', { strategy_id: selectedStrategy.id });
    });

    socket.on('paper_trade_update', (data: any) => {
      // Update audit logs
      if (data.auditLog) {
        setAuditLogs(prev => [...prev, data.auditLog].slice(-200)); // Keep last 200 logs
      }
      
      // Update chart data
      if (data.chartData) {
        setLiveChartData(data.chartData.candles || []);
        setEma5Data(data.chartData.ema5 || []);
        setRsi14Data(data.chartData.rsi14 || []);
      }
      
      // Update trade history
      if (data.tradeEvent) {
        setTradeHistory(prev => [...prev, data.tradeEvent]);
      }
      
      // Update status
      if (data.status) {
        setCurrentStatus(data.status);
      }
    });

    socket.on('disconnect', () => {
      console.log('SocketIO disconnected');
    });

    socket.on('error', (error: any) => {
      console.error('SocketIO error:', error);
    });

    return () => {
      socket.disconnect();
    };
  }, [isRunning, selectedStrategy]);

  const handleStart = async () => {
    if (!selectedStrategy) {
      alert('Please select a strategy first');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('http://localhost:8000/api/paper_trade/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          strategy_id: selectedStrategy.id,
        }),
      });

      const data = await response.json();
      if (response.ok && data.status === 'success') {
        setIsRunning(true);
        setAuditLogs([]);
        setTradeHistory([]);
        setLiveChartData([]);
        setCurrentStatus('Strategy started');
      } else {
        alert(data.message || 'Failed to start paper trading');
      }
    } catch (error) {
      console.error('Error starting paper trade:', error);
      alert('Error starting paper trading');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:8000/api/paper_trade/stop', {
        method: 'POST',
        credentials: 'include',
      });

      const data = await response.json();
      if (response.ok && data.status === 'success') {
        setIsRunning(false);
        setCurrentStatus('Stopped');
      } else {
        alert(data.message || 'Failed to stop paper trading');
      }
    } catch (error) {
      console.error('Error stopping paper trade:', error);
      alert('Error stopping paper trading');
    } finally {
      setLoading(false);
    }
  };

  // Format time for display
  const formatTime = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // Process audit logs to extract signals and trades
  useEffect(() => {
    if (!liveChartData.length || !auditLogs.length) return;

    const signals: typeof signalCandles = [];
    const events: typeof tradeEvents = [];

    auditLogs.forEach((log) => {
      const logTime = new Date(log.timestamp);
      
      // Find matching candle index
      const candleIndex = liveChartData.findIndex(c => {
        const candleTime = new Date(c.x);
        // Match within same minute (for 5-minute candles)
        return Math.abs(candleTime.getTime() - logTime.getTime()) < 300000; // 5 minutes
      });

      if (candleIndex === -1) return;

      // Extract signal candles
      if (log.type === 'signal' && log.details) {
        const signalType = log.message.includes('PE') ? 'PE' : 'CE';
        const candle = liveChartData[candleIndex];
        signals.push({
          index: candleIndex,
          type: signalType,
          high: candle.h,
          low: candle.l,
          time: candle.x
        });
      }

      // Extract trade events
      if (log.type === 'entry' && log.details) {
        const tradeType = log.message.includes('PE') ? 'PE' : 'CE';
        const entryPrice = log.details.entry_price || log.details.price || 0;
        events.push({
          index: candleIndex,
          type: 'ENTRY',
          tradeType: tradeType,
          price: entryPrice,
          time: log.timestamp
        });
      }

      if ((log.type === 'exit' || log.type === 'info') && log.details) {
        const exitType = log.details.exit_type || (log.message.includes('Stop Loss') ? 'STOP_LOSS' : 
                                                      log.message.includes('Target') ? 'TARGET' : 
                                                      log.message.includes('Market Close') ? 'MKT_CLOSE' : null);
        if (exitType) {
          const exitPrice = log.details.exit_price || log.details.price || 0;
          events.push({
            index: candleIndex,
            type: exitType as 'STOP_LOSS' | 'TARGET' | 'MKT_CLOSE',
            tradeType: log.message.includes('PE') ? 'PE' : 'CE',
            price: exitPrice,
            time: log.timestamp
          });
        }
      }
    });

    setSignalCandles(signals);
    setTradeEvents(events);
  }, [auditLogs, liveChartData]);

  // Prepare chart data with signals and trade events
  const chartDataFormatted = useMemo(() => {
    return liveChartData.map((candle, index) => {
      const ema5Value = ema5Data[index]?.y ?? null;
      const rsi14Value = rsi14Data[index]?.y ?? null;
      const signalCandle = signalCandles.find(s => s.index === index);
      const tradeEvent = tradeEvents.find(t => t.index === index);

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
      };
    });
  }, [liveChartData, ema5Data, rsi14Data, signalCandles, tradeEvents]);

  // Enhanced Custom Tooltip with signal and trade info
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const signalCandle = signalCandles.find(s => s.index === chartDataFormatted.findIndex(c => c.timeFormatted === label));
      const tradeEvent = tradeEvents.find(t => t.index === chartDataFormatted.findIndex(c => c.timeFormatted === label));
      const trade = tradeHistory.find(t => 
        t.signalTime === data.time?.toISOString() || 
        t.entryTime === data.time?.toISOString() || 
        t.exitTime === data.time?.toISOString()
      );

      return (
        <div className="bg-white border shadow-lg p-3 rounded" style={{ minWidth: '250px', maxWidth: '350px' }}>
          <p className="mb-1 fw-bold border-bottom pb-2">{data.timeFormatted}</p>
          
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
              <strong>EMA 5:</strong> {data.ema5.toFixed(2)}
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
                {tradeEvent.type === 'ENTRY' ? '✅' : tradeEvent.type === 'STOP_LOSS' ? '❌' : tradeEvent.type === 'MKT_CLOSE' ? '🔒' : '🎯'} {tradeEvent.type === 'MKT_CLOSE' ? 'Market Close' : tradeEvent.type} ({tradeEvent.tradeType})
              </p>
              <p className="mb-0 small"><strong>Price:</strong> {tradeEvent.price.toFixed(2)}</p>
            </div>
          )}

          {/* Trade History Info */}
          {trade && (
            <div className="mb-0 border-top pt-2" style={{ backgroundColor: '#f8f9fa', padding: '8px', borderRadius: '4px' }}>
              <p className="mb-1 small fw-bold">Trade Details:</p>
              {trade.signalTime && <p className="mb-0 small"><strong>Signal:</strong> {formatTime(trade.signalTime)}</p>}
              {trade.entryTime && <p className="mb-0 small"><strong>Entry:</strong> {formatTime(trade.entryTime)} @ {trade.entryPrice?.toFixed(2)}</p>}
              {trade.exitTime && (
                <>
                  <p className="mb-0 small">
                    <strong>Exit:</strong> {formatTime(trade.exitTime)} @ {trade.exitPrice?.toFixed(2)} 
                    <span className="ms-1">({trade.exitType === 'MKT_CLOSE' ? 'Market Close' : trade.exitType})</span>
                  </p>
                  {trade.pnl !== undefined && trade.pnlPercent !== undefined && (
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

  // Custom Candlestick Renderer
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

  return (
    <div className="container-fluid">
      <div className="card shadow-sm border-0 mb-4">
        <div className="card-header bg-success text-white">
          <h4 className="card-title mb-0">
            <i className="bi bi-clipboard-check me-2"></i>
            Paper Trade - Live Market Execution
          </h4>
          <small className="text-white-50">Real-time paper trading with live market data</small>
        </div>
        <div className="card-body">
          {/* View Mode Toggle */}
          <div className="row mb-3">
            <div className="col-12">
              <div className="btn-group" role="group">
                <button
                  type="button"
                  className={`btn ${viewMode === 'live' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setViewMode('live')}
                >
                  <i className="bi bi-play-circle me-2"></i>Live Trading
                </button>
                <button
                  type="button"
                  className={`btn ${viewMode === 'historical' ? 'btn-primary' : 'btn-outline-primary'}`}
                  onClick={() => setViewMode('historical')}
                >
                  <i className="bi bi-clock-history me-2"></i>Historical Sessions
                </button>
              </div>
            </div>
          </div>

          {/* Historical Sessions View */}
          {viewMode === 'historical' && (
            <div className="card border-0 shadow-sm mb-4">
              <div className="card-header bg-info text-white">
                <h6 className="mb-0">
                  <i className="bi bi-clock-history me-2"></i>Historical Paper Trade Sessions
                </h6>
              </div>
              <div className="card-body">
                <div className="row mb-3">
                  <div className="col-md-4">
                    <label htmlFor="session-date-filter" className="form-label fw-bold">
                      <i className="bi bi-calendar3 me-2"></i>Filter by Date
                    </label>
                    <input
                      type="date"
                      id="session-date-filter"
                      className="form-control"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                    />
                  </div>
                  <div className="col-md-8">
                    <label className="form-label fw-bold">&nbsp;</label>
                    <button
                      className="btn btn-sm btn-outline-secondary d-block"
                      onClick={() => setSelectedDate('')}
                    >
                      Clear Filter
                    </button>
                  </div>
                </div>

                {historicalSessions.length === 0 ? (
                  <div className="text-center text-muted py-4">
                    <i className="bi bi-inbox" style={{ fontSize: '3rem', opacity: 0.3 }}></i>
                    <p className="mt-3">No historical sessions found</p>
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover">
                      <thead className="table-dark">
                        <tr>
                          <th>Session ID</th>
                          <th>Strategy</th>
                          <th>Instrument</th>
                          <th>Started At</th>
                          <th>Stopped At</th>
                          <th>Status</th>
                          <th>Total Trades</th>
                          <th>Total P&L</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historicalSessions.map((session) => (
                          <tr key={session.id}>
                            <td>{session.id}</td>
                            <td>{session.strategy_name}</td>
                            <td>
                              <span className="badge bg-info">{session.instrument}</span>
                            </td>
                            <td>{new Date(session.started_at).toLocaleString()}</td>
                            <td>{session.stopped_at ? new Date(session.stopped_at).toLocaleString() : '-'}</td>
                            <td>
                              <span className={`badge ${session.status === 'running' ? 'bg-success' : 'bg-secondary'}`}>
                                {session.status}
                              </span>
                            </td>
                            <td>{session.total_trades}</td>
                            <td>
                              <span className={`fw-bold ${session.total_pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                {session.total_pnl >= 0 ? '+' : ''}{session.total_pnl.toFixed(2)}
                              </span>
                            </td>
                            <td>
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => setSelectedSessionId(session.id)}
                              >
                                <i className="bi bi-eye me-1"></i>View Audit Trail
                              </button>
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

          {/* Strategy Selection */}
          {viewMode === 'live' && (
          <div className="row mb-4">
            <div className="col-md-6">
              <label htmlFor="paper-trade-strategy-select" className="form-label fw-bold">
                <i className="bi bi-list-ul me-2"></i>Select Strategy
              </label>
              <select
                id="paper-trade-strategy-select"
                className="form-select form-select-lg"
                value={selectedStrategy?.id.toString() || ''}
                onChange={(e) => {
                  const strategy = strategies.find(s => s.id.toString() === e.target.value);
                  setSelectedStrategy(strategy || null);
                }}
                disabled={loading || strategies.length === 0 || isRunning}
              >
                <option value="">
                  {loading ? 'Loading strategies...' : strategies.length === 0 ? 'No strategies available' : '-- Select a strategy --'}
                </option>
                {strategies.map((strategy) => (
                  <option key={strategy.id} value={strategy.id.toString()}>
                    {strategy.strategy_name} ({strategy.instrument} - {strategy.strategy_type})
                  </option>
                ))}
              </select>
              {selectedStrategy && (
                <div className="mt-2">
                  <small className="text-muted">
                    <strong>Instrument:</strong> {selectedStrategy.instrument} |{' '}
                    <strong>Candle Time:</strong> {selectedStrategy.candle_time}min |{' '}
                    <strong>EMA Period:</strong> {selectedStrategy.ema_period || 5}
                  </small>
                </div>
              )}
            </div>
            <div className="col-md-6 d-flex align-items-end">
              <div className="w-100">
                <label className="form-label fw-bold">&nbsp;</label>
                <div className="d-flex gap-2">
                  <button
                    className="btn btn-success btn-lg flex-fill"
                    onClick={handleStart}
                    disabled={loading || !selectedStrategy || isRunning}
                  >
                    {loading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                        Starting...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-play-circle me-2"></i>Start Paper Trade
                      </>
                    )}
                  </button>
                  <button
                    className="btn btn-danger btn-lg flex-fill"
                    onClick={handleStop}
                    disabled={loading || !isRunning}
                  >
                    {loading ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                        Stopping...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-stop-circle me-2"></i>Stop Paper Trade
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
          )}

          {/* Status Indicator */}
          {isRunning && (
            <div className="alert alert-info mb-4" role="alert">
              <i className="bi bi-info-circle me-2"></i>
              <strong>Status:</strong> {currentStatus}
            </div>
          )}

          {/* Live Chart */}
          {viewMode === 'live' && isRunning && chartDataFormatted.length > 0 && (
            <div className="card border-0 shadow-sm mb-4">
              <div className="card-header bg-dark text-white">
                <div className="d-flex justify-content-between align-items-center">
                  <h6 className="mb-0">
                    <i className="bi bi-graph-up me-2"></i>
                    Live Candlestick Chart with Indicators
                  </h6>
                  <select
                    className="form-select form-select-sm"
                    style={{ width: 'auto' }}
                    value={chartType}
                    onChange={(e) => setChartType(e.target.value as 'candlestick' | 'line')}
                  >
                    <option value="candlestick">Candlestick</option>
                    <option value="line">Line</option>
                  </select>
                </div>
              </div>
              <div className="card-body">
                <div style={{ width: '100%', height: '500px', minWidth: 0 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={chartDataFormatted}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="timeFormatted" 
                        angle={-45} 
                        textAnchor="end" 
                        height={80}
                        interval="preserveStartEnd"
                      />
                      <YAxis yAxisId="price" orientation="left" />
                      <YAxis yAxisId="rsi" orientation="right" domain={[0, 100]} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      {chartType === 'candlestick' ? (
                        <>
                          {/* Render candlesticks using Customized component */}
                          <Customized component={CandlestickRenderer} />
                          <Line 
                            yAxisId="price"
                            type="monotone" 
                            dataKey="ema5" 
                            stroke="#ff7300" 
                            strokeWidth={2}
                            name="EMA 5"
                            dot={false}
                          />
                        </>
                      ) : (
                        <>
                          <Line 
                            yAxisId="price"
                            type="monotone" 
                            dataKey="close" 
                            stroke="#8884d8" 
                            strokeWidth={2}
                            name="Price"
                            dot={false}
                          />
                          <Line 
                            yAxisId="price"
                            type="monotone" 
                            dataKey="ema5" 
                            stroke="#ff7300" 
                            strokeWidth={2}
                            name="EMA 5"
                            dot={false}
                          />
                        </>
                      )}
                      <Line 
                        yAxisId="rsi"
                        type="monotone" 
                        dataKey="rsi14" 
                        stroke="#82ca9d" 
                        strokeWidth={2}
                        name="RSI 14"
                        dot={false}
                      />
                      <ReferenceLine yAxisId="rsi" y={70} stroke="#dc3545" strokeDasharray="3 3" label="Overbought" />
                      <ReferenceLine yAxisId="rsi" y={30} stroke="#28a745" strokeDasharray="3 3" label="Oversold" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Trade History & P&L Analysis */}
          {viewMode === 'live' && isRunning && (
            <div className="card border-0 shadow-sm mb-4">
              <div className="card-header bg-dark text-white">
                <h6 className="mb-0">
                  <i className="bi bi-table me-2"></i>
                  Trade History & P&L Analysis
                </h6>
              </div>
              <div className="card-body">
                <div className="table-responsive">
                  <table className="table table-hover table-striped">
                    <thead className="table-dark">
                      <tr>
                        <th>#</th>
                        <th>Signal Time</th>
                        <th>Signal Type</th>
                        <th>Entry Time</th>
                        <th>Entry Price (Index)</th>
                        <th>Option Symbol</th>
                        <th>Option Price</th>
                        <th>Exit Time</th>
                        <th>Exit Price (Index)</th>
                        <th>Exit Type</th>
                        <th>P&L</th>
                        <th>P&L %</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tradeHistory.length === 0 ? (
                        <tr>
                          <td colSpan={13} className="text-center text-muted">
                            No trades yet. Waiting for signals...
                          </td>
                        </tr>
                      ) : (
                        tradeHistory.map((trade, index) => (
                          <tr key={index}>
                            <td>{index + 1}</td>
                            <td>{trade.signalTime ? formatTime(trade.signalTime) : '-'}</td>
                            <td>
                              {trade.signalType ? (
                                <span className={`badge ${trade.signalType === 'PE' ? 'bg-danger' : 'bg-success'}`}>
                                  {trade.signalType}
                                </span>
                              ) : '-'}
                            </td>
                            <td>{trade.entryTime ? formatTime(trade.entryTime) : '-'}</td>
                            <td>{trade.entryPrice ? trade.entryPrice.toFixed(2) : '-'}</td>
                            <td>{trade.optionSymbol || '-'}</td>
                            <td>{trade.optionPrice ? trade.optionPrice.toFixed(2) : '-'}</td>
                            <td>{trade.exitTime ? formatTime(trade.exitTime) : '-'}</td>
                            <td>{trade.exitPrice ? trade.exitPrice.toFixed(2) : '-'}</td>
                            <td>
                              {trade.exitType ? (
                                <span className={`badge ${
                                  trade.exitType === 'STOP_LOSS' ? 'bg-danger' : 
                                  trade.exitType === 'MKT_CLOSE' ? 'bg-secondary' : 'bg-warning'
                                }`}>
                                  {trade.exitType === 'MKT_CLOSE' ? 'Market Close' : trade.exitType}
                                </span>
                              ) : '-'}
                            </td>
                            <td>
                              {trade.pnl !== undefined ? (
                                <span className={`fw-bold ${trade.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
                                  {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                                </span>
                              ) : '-'}
                            </td>
                            <td>
                              {trade.pnlPercent !== undefined ? (
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
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Real-time Audit Trail */}
          {(viewMode === 'live' && isRunning || viewMode === 'historical') && (
            <div className="card border-0 shadow-sm">
              <div className="card-header bg-dark text-white">
                  <h6 className="mb-0">
                    <i className="bi bi-journal-text me-2"></i>
                    {viewMode === 'historical' ? 'Historical' : 'Real-time'} Audit Trail & Strategy Logs
                    {viewMode === 'historical' && selectedSessionId && (
                      <small className="ms-2 text-white-50">(Session ID: {selectedSessionId})</small>
                    )}
                  </h6>
              </div>
              <div className="card-body" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {auditLogs.length === 0 ? (
                  <div className="text-center text-muted">
                    <i className="bi bi-hourglass-split me-2"></i>
                    Waiting for strategy events...
                  </div>
                ) : (
                  <div className="list-group">
                    {auditLogs.map((log, index) => (
                      <div
                        key={index}
                        className={`list-group-item list-group-item-action ${
                          log.type === 'error' ? 'list-group-item-danger' :
                          log.type === 'warning' ? 'list-group-item-warning' :
                          log.type === 'signal' ? 'list-group-item-info' :
                          log.type === 'entry' ? 'list-group-item-success' :
                          log.type === 'exit' ? 'list-group-item-primary' :
                          ''
                        }`}
                      >
                        <div className="d-flex w-100 justify-content-between">
                          <div className="flex-grow-1">
                            <p className="mb-1 fw-bold">
                              <i className={`bi ${
                                log.type === 'error' ? 'bi-exclamation-triangle-fill' :
                                log.type === 'warning' ? 'bi-exclamation-circle-fill' :
                                log.type === 'signal' ? 'bi-flag-fill' :
                                log.type === 'entry' ? 'bi-arrow-down-circle-fill' :
                                log.type === 'exit' ? 'bi-arrow-up-circle-fill' :
                                'bi-info-circle-fill'
                              } me-2`}></i>
                              {log.message}
                            </p>
                            {log.details && (
                              <small className="text-muted">
                                {JSON.stringify(log.details, null, 2)}
                              </small>
                            )}
                          </div>
                          <small className="text-muted">{formatTime(log.timestamp)}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Empty State */}
          {viewMode === 'live' && !isRunning && (
            <div className="text-center py-5">
              <i className="bi bi-clipboard-check" style={{ fontSize: '4rem', opacity: 0.3, color: '#6c757d' }}></i>
              <p className="mt-3 text-muted">
                Select a strategy and click "Start Paper Trade" to begin live paper trading.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PaperTradeContent;

