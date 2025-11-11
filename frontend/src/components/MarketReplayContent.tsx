import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area, ReferenceLine } from 'recharts';
import { io, Socket } from 'socket.io-client';

interface MarketReplayResults {
  pnl: number;
  trades: number;
  currentPrice?: number;
  currentTime?: string;
  progress?: number;
  status?: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  metrics?: {
    total_pnl: number;
    total_trades: number;
    win_rate: number;
    avg_pnl_per_trade: number;
  };
}

interface ReplayDataPoint {
  time: string;
  price: number;
  pnl: number;
}

interface IndexCandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StrategyDataPoint extends ReplayDataPoint {
  position?: number;
  entry_price?: number;
  ema?: number;
}

interface AuditTrailEntry {
  timestamp: string;
  event_type: string;
  message: string;
  price?: number;
  pnl?: number;
  position?: number;
}

const MarketReplayContent: React.FC = () => {
  const [strategy, setStrategy] = useState<string>('');
  const [showInfo, setShowInfo] = useState<boolean>(false);
  const [instrument, setInstrument] = useState<string>('BANKNIFTY');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [results, setResults] = useState<MarketReplayResults | null>(null);
  const [replayStatus, setReplayStatus] = useState<'idle' | 'running' | 'paused' | 'completed' | 'error'>('idle');
  const [speed, setSpeed] = useState<number>(1); // 0.5x, 1x, 2x, 5x, 10x
  const [progress, setProgress] = useState<number>(0);
  const [replayData, setReplayData] = useState<ReplayDataPoint[]>([]);
  const [indexData, setIndexData] = useState<IndexCandleData[]>([]);
  const [strategyData, setStrategyData] = useState<StrategyDataPoint[]>([]);
  const [auditTrail, setAuditTrail] = useState<AuditTrailEntry[]>([]);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Initialize socket connection
    socketRef.current = io('http://localhost:8000', { transports: ['polling'] });
    
    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('Connected to WebSocket for market replay');
    });

    socket.on('replay_update', (data: {
      currentPrice: number;
      currentTime: string;
      pnl: number;
      progress: number;
      status: string;
      trades?: number;
      audit_trail?: AuditTrailEntry[];
      index_data?: IndexCandleData[];
      strategy_data_points?: StrategyDataPoint[];
      position?: number;
      entry_price?: number;
    }) => {
      setCurrentPrice(data.currentPrice);
      setCurrentTime(data.currentTime);
      setProgress(data.progress);
      
      // Update index chart data
      if (data.index_data && data.index_data.length > 0) {
        setIndexData(data.index_data);
      }
      
      // Update strategy execution chart data
      if (data.strategy_data_points && data.strategy_data_points.length > 0) {
        setStrategyData(data.strategy_data_points);
        // Also update legacy replayData for backward compatibility
        setReplayData(data.strategy_data_points.map(point => ({
          time: point.time,
          price: point.price,
          pnl: point.pnl
        })));
      }
      
      // Update audit trail
      if (data.audit_trail && data.audit_trail.length > 0) {
        setAuditTrail(data.audit_trail);
      }

      // Update results
      setResults(prev => ({
        ...prev!,
        pnl: data.pnl,
        trades: data.trades || prev?.trades || 0,
        currentPrice: data.currentPrice,
        currentTime: data.currentTime,
        progress: data.progress,
      }));
    });

    socket.on('replay_complete', (data: { 
      pnl: number; 
      trades: number;
      audit_trail?: AuditTrailEntry[];
      index_data?: IndexCandleData[];
      strategy_data_points?: StrategyDataPoint[];
      metrics?: {
        total_pnl: number;
        total_trades: number;
        win_rate: number;
        avg_pnl_per_trade: number;
      };
    }) => {
      setReplayStatus('completed');
      
      // Update final data
      if (data.index_data) {
        setIndexData(data.index_data);
      }
      if (data.strategy_data_points) {
        setStrategyData(data.strategy_data_points);
        setReplayData(data.strategy_data_points.map(point => ({
          time: point.time,
          price: point.price,
          pnl: point.pnl
        })));
      }
      if (data.audit_trail) {
        setAuditTrail(data.audit_trail);
      }
      
      setResults(prev => ({
        ...prev!,
        pnl: data.pnl,
        trades: data.trades,
        status: 'completed',
        metrics: data.metrics,
      }));
    });

    socket.on('replay_error', (data: { message: string }) => {
      setReplayStatus('error');
      console.error('Replay error:', data.message);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleStartReplay = async () => {
    if (!strategy || !instrument || !fromDate || !toDate) {
      alert('Please fill in all fields');
      return;
    }

    setReplayStatus('running');
    setProgress(0);
    setReplayData([]);
    setIndexData([]);
    setStrategyData([]);
    setAuditTrail([]);
    setResults({
      pnl: 0,
      trades: 0,
      status: 'running',
    });

    const formData = {
      strategy,
      instrument,
      'from-date': fromDate,
      'to-date': toDate,
      speed: speed,
    };

    try {
      const response = await fetch('http://localhost:8000/api/market_replay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        setReplayStatus('error');
        alert(data.message || 'Market Replay failed');
      }
    } catch (error) {
      console.error('Error starting market replay:', error);
      setReplayStatus('error');
      alert('An error occurred while starting market replay');
    }
  };

  const handlePause = () => {
    if (socketRef.current) {
      socketRef.current.emit('replay_pause');
      setReplayStatus('paused');
    }
  };

  const handleResume = () => {
    if (socketRef.current) {
      socketRef.current.emit('replay_resume', { speed });
      setReplayStatus('running');
    }
  };

  const handleStop = () => {
    if (socketRef.current) {
      socketRef.current.emit('replay_stop');
      setReplayStatus('idle');
      setReplayData([]);
      setResults(null);
      setProgress(0);
    }
  };

  const handleSpeedChange = (newSpeed: number) => {
    setSpeed(newSpeed);
    if (replayStatus === 'running' && socketRef.current) {
      socketRef.current.emit('replay_speed_change', { speed: newSpeed });
    }
  };

  const speedOptions = [
    { value: 0.5, label: '0.5x' },
    { value: 1, label: '1x' },
    { value: 2, label: '2x' },
    { value: 5, label: '5x' },
    { value: 10, label: '10x' },
  ];

  return (
    <div className="container mt-4">
      <div className="card shadow-sm border-0">
        <div className="card-header bg-success text-white">
          <h5 className="card-title mb-0">
            <i className="bi bi-play-circle me-2"></i>Market Replay
          </h5>
        </div>
        <div className="card-body">
          {/* Strategy Info Modal */}
          {showInfo && strategy && (
            <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setShowInfo(false)}>
              <div className="modal-dialog modal-lg modal-dialog-centered">
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header bg-primary text-white">
                    <h5 className="modal-title">
                      <i className="bi bi-info-circle me-2"></i>
                      {strategy === 'orb' ? 'Opening Range Breakout (ORB)' : 'Capture Mountain Signal'}
                    </h5>
                    <button type="button" className="btn-close btn-close-white" onClick={() => setShowInfo(false)}></button>
                  </div>
                  <div className="modal-body">
                    {strategy === 'orb' ? (
                      <>
                        <p><strong>Logic:</strong> Trade breakouts of the opening range (first N minutes). Buy above range high, sell below range low. Manage with stop loss/target.</p>
                        <ul>
                          <li>Timeframe: Selectable (typically 5m)</li>
                          <li>Entry: Price breaks above opening range high (Long) or below low (Short)</li>
                          <li>Stops/Targets: Configurable; manage risk</li>
                        </ul>
                      </>
                    ) : (
                      <>
                        <p>
                          <strong>Logic:</strong> Use 5 EMA and signal candle conditions to identify CE/PE entries as specified
                          (LOW &gt; EMA for PE signal, HIGH &lt; EMA for CE signal; entries on next candle break).
                        </p>
                        <ul>
                          <li>Indicator: 5-EMA</li>
                          <li>Entries: Next candle close crossing signal candle high/low</li>
                          <li>SL: Opposite side of signal candle</li>
                        </ul>
                      </>
                    )}
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowInfo(false)}>Close</button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); handleStartReplay(); }}>
            <div className="row mb-3">
              <div className="col-md-6 mb-3">
                <label htmlFor="replay-strategy" className="form-label d-flex align-items-center">
                  <i className="bi bi-diagram-3 me-2"></i>Strategy
                  <button 
                    type="button" 
                    className="btn btn-link p-0 ms-2 text-info" 
                    title="Strategy Info" 
                    onClick={() => setShowInfo(true)}
                    disabled={!strategy}
                    style={{ opacity: strategy ? 1 : 0.5, cursor: strategy ? 'pointer' : 'not-allowed' }}
                  >
                    <i className="bi bi-info-circle"></i>
                  </button>
                </label>
                <select
                  className="form-select"
                  id="replay-strategy"
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  required
                >
                  <option value="">Select a strategy</option>
                  <option value="orb">Opening Range Breakout (ORB)</option>
                  <option value="capture_mountain_signal">Capture Mountain Signal</option>
                </select>
                <small className="text-muted">Select a strategy to replay</small>
              </div>
              <div className="col-md-6 mb-3">
                <label htmlFor="replay-instrument" className="form-label">
                  <i className="bi bi-graph-up me-2"></i>Instrument
                </label>
                <select
                  className="form-select"
                  id="replay-instrument"
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                >
                  <option value="BANKNIFTY">NIFTY BANK (BANKNIFTY)</option>
                  <option value="NIFTY">NIFTY 50 (NIFTY)</option>
                </select>
              </div>
            </div>
            <div className="row mb-3">
              <div className="col-md-6 mb-3">
                <label htmlFor="replay-from-date" className="form-label">
                  <i className="bi bi-calendar3 me-2"></i>From Date
                </label>
                <input
                  type="date"
                  className="form-control"
                  id="replay-from-date"
                  name="from-date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  required
                />
              </div>
              <div className="col-md-6 mb-3">
                <label htmlFor="replay-to-date" className="form-label">
                  <i className="bi bi-calendar3 me-2"></i>To Date
                </label>
                <input
                  type="date"
                  className="form-control"
                  id="replay-to-date"
                  name="to-date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Speed Controls */}
            <div className="row mb-3">
              <div className="col-md-12">
                <label className="form-label">
                  <i className="bi bi-speedometer2 me-2"></i>Playback Speed
                </label>
                <div className="btn-group w-100" role="group">
                  {speedOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`btn ${speed === option.value ? 'btn-primary' : 'btn-outline-primary'}`}
                      onClick={() => handleSpeedChange(option.value)}
                      disabled={replayStatus === 'idle'}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Control Buttons */}
            <div className="row mb-3">
              <div className="col-md-12">
                <div className="btn-group" role="group">
                  {replayStatus === 'idle' && (
                    <button type="submit" className="btn btn-success">
                      <i className="bi bi-play-fill me-2"></i>Start Replay
                    </button>
                  )}
                  {replayStatus === 'running' && (
                    <>
                      <button type="button" className="btn btn-warning" onClick={handlePause}>
                        <i className="bi bi-pause-fill me-2"></i>Pause
                      </button>
                      <button type="button" className="btn btn-danger" onClick={handleStop}>
                        <i className="bi bi-stop-fill me-2"></i>Stop
                      </button>
                    </>
                  )}
                  {replayStatus === 'paused' && (
                    <>
                      <button type="button" className="btn btn-success" onClick={handleResume}>
                        <i className="bi bi-play-fill me-2"></i>Resume
                      </button>
                      <button type="button" className="btn btn-danger" onClick={handleStop}>
                        <i className="bi bi-stop-fill me-2"></i>Stop
                      </button>
                    </>
                  )}
                  {replayStatus === 'completed' && (
                    <button type="button" className="btn btn-primary" onClick={handleStop}>
                      <i className="bi bi-arrow-clockwise me-2"></i>Reset
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            {(replayStatus === 'running' || replayStatus === 'paused' || replayStatus === 'completed') && (
              <div className="row mb-3">
                <div className="col-md-12">
                  <label className="form-label">Progress</label>
                  <div className="progress" style={{ height: '25px' }}>
                    <div
                      className={`progress-bar ${
                        replayStatus === 'completed' ? 'bg-success' :
                        replayStatus === 'paused' ? 'bg-warning' :
                        'bg-info progress-bar-striped progress-bar-animated'
                      }`}
                      role="progressbar"
                      style={{ width: `${progress}%` }}
                      aria-valuenow={progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      {progress.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Current Status Display */}
            {(replayStatus === 'running' || replayStatus === 'paused' || replayStatus === 'completed') && (
              <div className="row mb-3">
                <div className="col-md-4">
                  <div className="card bg-light">
                    <div className="card-body text-center">
                      <small className="text-muted d-block">Current Price</small>
                      <h5 className="mb-0 fw-bold text-primary">{currentPrice.toFixed(2)}</h5>
                    </div>
                  </div>
                </div>
                <div className="col-md-4">
                  <div className="card bg-light">
                    <div className="card-body text-center">
                      <small className="text-muted d-block">Current Time</small>
                      <h6 className="mb-0">{currentTime || '--'}</h6>
                    </div>
                  </div>
                </div>
                <div className="col-md-4">
                  <div className="card bg-light">
                    <div className="card-body text-center">
                      <small className="text-muted d-block">Current P&L</small>
                      <h5 className={`mb-0 fw-bold ${(results?.pnl || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                        {(results?.pnl || 0).toFixed(2)}
                      </h5>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </form>

          {/* Results Display */}
          {results && replayStatus === 'completed' && (
            <div className="mt-4">
              <div className="card bg-light">
                <div className="card-header">
                  <h5 className="mb-0">
                    <i className="bi bi-check-circle-fill text-success me-2"></i>Market Replay Results
                  </h5>
                </div>
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-6">
                      <p className="mb-2">
                        <strong>Total P&L:</strong>{' '}
                        <span className={results.pnl >= 0 ? 'text-success' : 'text-danger'}>
                          {results.pnl.toFixed(2)}
                        </span>
                      </p>
                    </div>
                    <div className="col-md-6">
                      <p className="mb-2">
                        <strong>Number of Trades:</strong> {results.trades}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Index Chart (Top) */}
          {indexData.length > 0 && (
            <div className="mt-4">
              <div className="card">
                <div className="card-header bg-info text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-graph-up-arrow me-2"></i>
                    {instrument} Index - Historical Price
                  </h5>
                </div>
                <div className="card-body">
                  <div style={{ height: '300px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={indexData.slice(-100)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                        <XAxis 
                          dataKey="time" 
                          stroke="#666" 
                          style={{ fontSize: '10px' }}
                          tickFormatter={(value) => {
                            const date = new Date(value);
                            return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                          }}
                        />
                        <YAxis stroke="#666" style={{ fontSize: '12px' }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                          }}
                          labelFormatter={(value) => {
                            const date = new Date(value);
                            return date.toLocaleString();
                          }}
                        />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="close"
                          stroke="#0d6efd"
                          fill="#0d6efd"
                          fillOpacity={0.3}
                          name="Close Price"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Strategy Execution Chart (Bottom) */}
          {strategyData.length > 0 && (
            <div className="mt-4">
              <div className="card">
                <div className="card-header bg-success text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-activity me-2"></i>
                    Strategy Execution - {strategy.toUpperCase()} on {instrument}
                  </h5>
                </div>
                <div className="card-body">
                  <div style={{ height: '400px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={strategyData.slice(-100)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                        <XAxis
                          dataKey="time"
                          stroke="#666"
                          style={{ fontSize: '10px' }}
                          tickFormatter={(value) => {
                            const date = new Date(value);
                            return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
                          }}
                        />
                        <YAxis
                          stroke="#666"
                          style={{ fontSize: '12px' }}
                          yAxisId="left"
                          label={{ value: 'Price', angle: -90, position: 'insideLeft' }}
                        />
                        <YAxis
                          stroke="#666"
                          style={{ fontSize: '12px' }}
                          yAxisId="right"
                          orientation="right"
                          label={{ value: 'P&L', angle: 90, position: 'insideRight' }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                          }}
                          labelFormatter={(value) => {
                            const date = new Date(value);
                            return date.toLocaleString();
                          }}
                        />
                        <Legend />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="price"
                          stroke="#0d6efd"
                          strokeWidth={2}
                          dot={false}
                          name="Price"
                          activeDot={{ r: 4 }}
                        />
                        {strategyData.some(d => d.ema !== undefined) && (
                          <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="ema"
                            stroke="#ff6b35"
                            strokeWidth={1.5}
                            strokeDasharray="5 5"
                            dot={false}
                            name="EMA 5"
                          />
                        )}
                        {strategyData.some(d => d.entry_price !== undefined && d.entry_price !== null) && (
                          <ReferenceLine
                            yAxisId="left"
                            y={(strategyData.find(d => d.entry_price !== undefined && d.entry_price !== null)?.entry_price || 0)}
                            stroke="#28a745"
                            strokeDasharray="3 3"
                            label={{ value: "Entry", position: "top" }}
                          />
                        )}
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="pnl"
                          stroke="#28a745"
                          strokeWidth={2}
                          dot={false}
                          name="P&L"
                          activeDot={{ r: 4 }}
                        />
                        <ReferenceLine yAxisId="right" y={0} stroke="#666" strokeDasharray="2 2" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Performance Metrics */}
          {results && (replayStatus === 'running' || replayStatus === 'paused' || replayStatus === 'completed') && (
            <div className="mt-4">
              <div className="card">
                <div className="card-header bg-primary text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-bar-chart me-2"></i>Performance Metrics
                  </h5>
                </div>
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-3">
                      <div className="text-center p-3 bg-light rounded">
                        <small className="text-muted d-block">Total P&L</small>
                        <h4 className={`mb-0 ${(results.pnl || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                          ₹{((results.pnl || 0)).toFixed(2)}
                        </h4>
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="text-center p-3 bg-light rounded">
                        <small className="text-muted d-block">Total Trades</small>
                        <h4 className="mb-0 text-primary">{results.trades || 0}</h4>
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="text-center p-3 bg-light rounded">
                        <small className="text-muted d-block">Avg P&L/Trade</small>
                        <h4 className={`mb-0 ${results.trades > 0 ? ((results.pnl || 0) / results.trades >= 0 ? 'text-success' : 'text-danger') : 'text-muted'}`}>
                          ₹{results.trades > 0 ? ((results.pnl || 0) / results.trades).toFixed(2) : '0.00'}
                        </h4>
                      </div>
                    </div>
                    <div className="col-md-3">
                      <div className="text-center p-3 bg-light rounded">
                        <small className="text-muted d-block">Win Rate</small>
                        <h4 className="mb-0 text-info">
                          {results.metrics?.win_rate ? `${(results.metrics.win_rate * 100).toFixed(1)}%` : 'N/A'}
                        </h4>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Audit Trail */}
          {auditTrail.length > 0 && (
            <div className="mt-4">
              <div className="card">
                <div className="card-header bg-warning text-dark">
                  <h5 className="mb-0">
                    <i className="bi bi-list-check me-2"></i>Audit Trail
                  </h5>
                </div>
                <div className="card-body" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  <table className="table table-sm table-hover">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Event</th>
                        <th>Message</th>
                        <th>Price</th>
                        <th>P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditTrail.slice().reverse().map((entry, idx) => (
                        <tr key={idx}>
                          <td>
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </td>
                          <td>
                            <span className={`badge ${
                              entry.event_type === 'entry' ? 'bg-success' :
                              entry.event_type === 'exit' ? 'bg-danger' :
                              entry.event_type === 'signal_identified' ? 'bg-info' :
                              entry.event_type === 'stop_loss' ? 'bg-warning' :
                              'bg-secondary'
                            }`}>
                              {entry.event_type}
                            </span>
                          </td>
                          <td>{entry.message}</td>
                          <td>{entry.price ? entry.price.toFixed(2) : '--'}</td>
                          <td className={entry.pnl !== undefined && entry.pnl >= 0 ? 'text-success' : entry.pnl !== undefined ? 'text-danger' : ''}>
                            {entry.pnl !== undefined ? `₹${entry.pnl.toFixed(2)}` : '--'}
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
      </div>
    </div>
  );
};

export default MarketReplayContent;
