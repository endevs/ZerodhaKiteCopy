import React, { useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ReferenceArea, CartesianGrid, AreaChart, Area, ScatterChart, Scatter, ZAxis } from 'recharts';
import { apiUrl } from '../config/api';

interface AIMLContentProps {}

const AIMLContent: React.FC<AIMLContentProps> = () => {
  const [activeTab, setActiveTab] = useState<string>('overview');

  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'predictions', label: 'Price Predictions', icon: '🔮' },
    { id: 'reinforcement-learning', label: 'Reinforcement Learning', icon: '🤖' },
    { id: 'sentiment', label: 'Train Model', icon: '💭' },
    { id: 'pattern-recognition', label: 'Pattern Recognition', icon: '🔍' },
    { id: 'strategy-optimization', label: 'Strategy Optimization', icon: '⚙️' },
  ];

  return (
    <div className="container-fluid">
      <div className="card shadow-sm border-0 mb-4">
        <div className="card-header bg-gradient text-white" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
          <h4 className="card-title mb-0">
            <i className="bi bi-robot me-2"></i>
            AI / ML Trading Analytics
          </h4>
          <small className="text-white-50">Advanced AI-powered tools for trading insights and predictions</small>
        </div>
        <div className="card-body">
          {/* Tab Navigation */}
          <ul className="nav nav-tabs mb-4" role="tablist">
            {tabs.map((tab) => (
              <li key={tab.id} className="nav-item" role="presentation">
                <button
                  className={`nav-link ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  <span className="me-2">{tab.icon}</span>
                  {tab.label}
                </button>
              </li>
            ))}
          </ul>

          {/* Tab Content */}
          <div className="tab-content">
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="row">
                <div className="col-12">
                  <div className="card border-0 shadow-sm mb-4">
                    <div className="card-header bg-primary text-white">
                      <h6 className="mb-0">
                        <i className="bi bi-info-circle me-2"></i>
                        AI / ML Features Overview
                      </h6>
                    </div>
                    <div className="card-body">
                      <div className="row">
                        <div className="col-md-6 mb-4">
                          <div className="card h-100 border">
                            <div className="card-body">
                              <h5 className="card-title">
                                <i className="bi bi-graph-up-arrow text-primary me-2"></i>
                                Price Predictions
                              </h5>
                              <p className="card-text">
                                Machine learning models to predict future price movements based on historical data,
                                technical indicators, and market patterns.
                              </p>
                              <ul className="list-unstyled">
                                <li><i className="bi bi-check-circle text-success me-2"></i>LSTM Neural Networks</li>
                                <li><i className="bi bi-check-circle text-success me-2"></i>Random Forest Models</li>
                                <li><i className="bi bi-check-circle text-success me-2"></i>Support Vector Machines</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-6 mb-4">
                          <div className="card h-100 border">
                            <div className="card-body">
                              <h5 className="card-title">
                                <i className="bi bi-chat-dots text-info me-2"></i>
                                Sentiment Analysis
                              </h5>
                              <p className="card-text">
                                Analyze market sentiment from news, social media, and other sources to gauge
                                market mood and potential price movements.
                              </p>
                              <ul className="list-unstyled">
                                <li><i className="bi bi-check-circle text-success me-2"></i>News Sentiment Scoring</li>
                                <li><i className="bi bi-check-circle text-success me-2"></i>Social Media Analysis</li>
                                <li><i className="bi bi-check-circle text-success me-2"></i>Real-time Sentiment Tracking</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-6 mb-4">
                          <div className="card h-100 border">
                            <div className="card-body">
                              <h5 className="card-title">
                                <i className="bi bi-search text-warning me-2"></i>
                                Pattern Recognition
                              </h5>
                              <p className="card-text">
                                AI-powered pattern detection to identify chart patterns, candlestick formations,
                                and trading opportunities automatically.
                              </p>
                              <ul className="list-unstyled">
                                <li><i className="bi bi-check-circle text-success me-2"></i>Candlestick Pattern Detection</li>
                                <li><i className="bi bi-check-circle text-success me-2"></i>Chart Pattern Recognition</li>
                                <li><i className="bi bi-check-circle text-success me-2"></i>Anomaly Detection</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-6 mb-4">
                          <div className="card h-100 border">
                            <div className="card-body">
                              <h5 className="card-title">
                                <i className="bi bi-gear text-success me-2"></i>
                                Strategy Optimization
                              </h5>
                              <p className="card-text">
                                Use genetic algorithms and reinforcement learning to optimize trading strategy
                                parameters for better performance.
                              </p>
                              <ul className="list-unstyled">
                                <li><i className="bi bi-check-circle text-success me-2"></i>Parameter Optimization</li>
                                <li><i className="bi bi-check-circle text-success me-2"></i>Genetic Algorithms</li>
                                <li><i className="bi bi-check-circle text-success me-2"></i>Reinforcement Learning</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-6 mb-4">
                          <div className="card h-100 border">
                            <div className="card-body">
                              <h5 className="card-title">
                                <i className="bi bi-lightning-charge text-warning me-2"></i>
                                Real-time Analytics
                              </h5>
                              <p className="card-text">
                                Continuous learning models that adapt to market conditions in real-time,
                                providing up-to-date insights and predictions.
                              </p>
                              <ul className="list-unstyled">
                                <li><i className="bi bi-check-circle text-success me-2"></i>Online Learning</li>
                                <li><i className="bi bi-check-circle text-success me-2"></i>Adaptive Models</li>
                                <li><i className="bi bi-check-circle text-success me-2"></i>Real-time Updates</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Price Predictions Tab */}
            {activeTab === 'predictions' && (
              <AIMLPredictions />
            )}

            {/* Train Model Tab */}
            {activeTab === 'sentiment' && (
              <TrainModelPanel />
            )}

            {/* Pattern Recognition Tab */}
            {activeTab === 'pattern-recognition' && (
              <div className="card border-0 shadow-sm">
                <div className="card-header bg-info text-white">
                  <h6 className="mb-0">
                    <i className="bi bi-search me-2"></i>
                    Pattern Recognition
                  </h6>
                </div>
                <div className="card-body">
                  <div className="alert alert-info" role="alert">
                    <i className="bi bi-info-circle me-2"></i>
                    <strong>Coming Soon:</strong> AI-powered pattern recognition will automatically detect chart patterns,
                    candlestick formations, and trading opportunities.
                  </div>
                  <div className="text-center py-5">
                    <i className="bi bi-search" style={{ fontSize: '4rem', opacity: 0.3, color: '#6c757d' }}></i>
                    <p className="mt-3 text-muted">Pattern recognition features will be implemented here</p>
                  </div>
                </div>
              </div>
            )}

            {/* Strategy Optimization Tab */}
            {activeTab === 'strategy-optimization' && (
              <div className="card border-0 shadow-sm">
                <div className="card-header bg-info text-white">
                  <h6 className="mb-0">
                    <i className="bi bi-gear me-2"></i>
                    Strategy Optimization
                  </h6>
                </div>
                <div className="card-body">
                  <div className="alert alert-info" role="alert">
                    <i className="bi bi-info-circle me-2"></i>
                    <strong>Coming Soon:</strong> Use AI to optimize trading strategy parameters using genetic algorithms
                    and reinforcement learning for better performance.
                  </div>
                  <div className="text-center py-5">
                    <i className="bi bi-gear" style={{ fontSize: '4rem', opacity: 0.3, color: '#6c757d' }}></i>
                    <p className="mt-3 text-muted">Strategy optimization features will be implemented here</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIMLContent;



// Inline component for Phase-1 predictions UI
const AIMLPredictions: React.FC = () => {
  const DEFAULT_HORIZON = 1;
  const DEFAULT_LOOKBACK = 60;
  const [symbol, setSymbol] = useState<'NIFTY' | 'BANKNIFTY'>('NIFTY');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [dateSeries, setDateSeries] = useState<Array<{ time: string; actual: number; predicted: number }>>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDateData = async () => {
    setError(null);
    setLoading(true);
    setDateSeries([]);
    try {
      const params = new URLSearchParams({
        symbol,
        date: selectedDate,
        horizon: String(DEFAULT_HORIZON),
        lookback: String(DEFAULT_LOOKBACK)
      });
      const res = await fetch(`/api/aiml/evaluate_date?${params.toString()}`);
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json() : { status: 'error', message: await res.text() };
      if (!res.ok || data.status !== 'ok') throw new Error(data.message || 'Date evaluation failed');
      setDateSeries(data.series || []);
    } catch (e: any) {
      setError(e.message || 'Date evaluation error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-header bg-info text-white">
        <h6 className="mb-0">
          <i className="bi bi-graph-up-arrow me-2"></i>
          LSTM Price Predictions (Phase 1)
        </h6>
      </div>
      <div className="card-body">
        <div className="row g-3 align-items-end">
          <div className="col-sm-6 col-md-3">
            <label className="form-label small mb-1">Index</label>
            <select
              className="form-select form-select-sm"
              value={symbol}
              disabled={loading}
              onChange={(e) => setSymbol(e.target.value as 'NIFTY' | 'BANKNIFTY')}
            >
              <option value="NIFTY">NIFTY</option>
              <option value="BANKNIFTY">BANKNIFTY</option>
            </select>
          </div>
          <div className="col-sm-6 col-md-3">
            <label className="form-label small mb-1">Select Date</label>
            <input
              type="date"
              className="form-control form-control-sm"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              max={new Date().toISOString().split('T')[0]}
              disabled={loading}
            />
          </div>
          <div className="col-sm-12 col-md-3">
            <button className="btn btn-outline-info btn-sm mt-4" onClick={fetchDateData} disabled={loading || !selectedDate}>
              {loading ? 'Loading...' : 'Show Date Chart'}
            </button>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger mt-3" role="alert">
            <i className="bi bi-exclamation-triangle me-2"></i>
            {error}
          </div>
        )}

        {dateSeries.length > 0 && (
          <div className="mt-3">
            <h6>Actual vs Predicted for {selectedDate}</h6>
            <DateChart data={dateSeries} date={selectedDate} />
          </div>
        )}
      </div>
    </div>
  );
};

const OverlayChart: React.FC<{ data: Array<{ time: string; actual: number; predicted: number; subset: 'train'|'test' }> }> = ({ data }) => {
  const splitIndex = data.findIndex(d => d.subset === 'test');
  const chartData = data.map(d => ({ time: d.time, actual: d.actual, predicted: d.predicted, subset: d.subset }));
  // Determine x-range for test shading
  const testStart = splitIndex >= 0 ? chartData[splitIndex]?.time : undefined;
  const testEnd = chartData[chartData.length - 1]?.time;
  return (
    <div className="card">
      <div className="card-body">
        <ResponsiveContainer width="100%" height={420}>
          <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
            <XAxis dataKey="time" hide={true} />
            <YAxis domain={["dataMin", "dataMax"]} allowDecimals={false} />
            <Tooltip />
            <Legend />
            {/* Shade test region */}
            {testStart && testEnd && (
              <ReferenceArea x1={testStart} x2={testEnd} strokeOpacity={0.1} fill="#ffecb3" fillOpacity={0.3} />
            )}
            <Line type="monotone" dataKey="actual" stroke="#1976D2" dot={false} name="Actual" />
            <Line type="monotone" dataKey="predicted" stroke="#E91E63" dot={false} name="Predicted" />
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-2">
          <span className="badge bg-primary me-2">Actual</span>
          <span className="badge bg-danger me-2">Predicted</span>
          <span className="badge bg-warning text-dark">Shaded: Test (30%)</span>
        </div>
      </div>
    </div>
  );
};

const DateChart: React.FC<{ data: Array<{ time: string; actual: number; predicted: number; timeFull?: string }>; date: string }> = ({ data, date }) => {
  // Use time directly from backend (already formatted as HH:MM in IST)
  const chartData = data.map(d => {
    // Backend sends 'time' as HH:MM string, use it directly
    const timeStr = d.time.includes(':') && d.time.length <= 5 ? d.time :
      (d.timeFull ? new Date(d.timeFull).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : d.time);
    return {
      time: timeStr,
      timeFull: d.timeFull || d.time,
      actual: d.actual,
      predicted: d.predicted
    };
  });

  return (
    <div className="card">
      <div className="card-body">
        <ResponsiveContainer width="100%" height={420}>
          <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 60 }}>
            <XAxis
              dataKey="time"
              angle={-45}
              textAnchor="end"
              height={80}
              interval="preserveStartEnd"
            />
            <YAxis domain={["dataMin", "dataMax"]} allowDecimals={false} />
            <Tooltip
              formatter={(value: any, name: string) => [`₹${Number(value).toFixed(2)}`, name]}
              labelFormatter={(label) => `${date} ${label}`}
            />
            <Legend />
            <Line type="monotone" dataKey="actual" stroke="#1976D2" dot={false} strokeWidth={2} name="Actual" />
            <Line type="monotone" dataKey="predicted" stroke="#E91E63" dot={false} strokeWidth={2} name="Predicted" />
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-2">
          <span className="badge bg-primary me-2">Actual</span>
          <span className="badge bg-danger me-2">Predicted</span>
          <small className="text-muted ms-2">5-minute candles for {date}</small>
        </div>
      </div>
    </div>
  );
};

const RLEquityChart: React.FC<{ data: Array<{ time: string; equity: number; pnl?: number; subset?: string }> }> = ({ data }) => {
  if (!data.length) return null;
  const chartData = data.map((d) => ({
    time: d.time,
    equity: d.equity,
    pnl: d.pnl,
    subset: d.subset,
  }));
  const testEntries = chartData.filter((d) => d.subset === 'test');
  const testStart = testEntries.length > 0 ? testEntries[0].time : undefined;
  const testEnd = testEntries.length > 0 ? testEntries[testEntries.length - 1].time : undefined;

  return (
    <div>
      <ResponsiveContainer width="100%" height={420}>
        <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 60 }}>
          {testStart && testEnd && (
            <ReferenceArea x1={testStart} x2={testEnd} strokeOpacity={0.1} fill="#d1ecf1" fillOpacity={0.3} />
          )}
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            tickFormatter={(value) => {
              const dateObj = new Date(value);
              if (Number.isNaN(dateObj.getTime())) {
                return value;
              }
              return `${dateObj.toLocaleDateString()} ${dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            }}
            angle={-45}
            textAnchor="end"
            height={80}
            interval="preserveStartEnd"
          />
          <YAxis domain={['auto', 'auto']} />
          <Tooltip
            formatter={(value, name) => {
              if (name === 'Equity' || name === 'PnL') {
                return [`₹${Number(value).toFixed(2)}`, name];
              }
              return [value, name];
            }}
            labelFormatter={(label) => {
              const dateObj = new Date(label);
              return Number.isNaN(dateObj.getTime()) ? label : dateObj.toLocaleString();
            }}
          />
          <Legend />
          <Line type="monotone" dataKey="equity" stroke="#28a745" dot={false} strokeWidth={2} name="Equity" />
          <Line type="monotone" dataKey="pnl" stroke="#dc3545" dot={false} strokeWidth={1} name="PnL" />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-2">
        <span className="badge bg-success me-2">Equity</span>
        <span className="badge bg-danger me-2">PnL</span>
        <span className="badge bg-info text-dark">Shaded: Evaluation Test Region (30%)</span>
      </div>
    </div>
  );
};

const RLDrawdownChart: React.FC<{ data: Array<{ time: string; drawdown: number; drawdown_pct?: number; subset?: string }> }> = ({ data }) => {
  if (!data.length) return null;
  const testEntries = data.filter((d) => d.subset === 'test');
  const testStart = testEntries.length > 0 ? testEntries[0].time : undefined;
  const testEnd = testEntries.length > 0 ? testEntries[testEntries.length - 1].time : undefined;

  return (
    <div>
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 40 }}>
          {testStart && testEnd && (
            <ReferenceArea x1={testStart} x2={testEnd} strokeOpacity={0.1} fill="#fde2e4" fillOpacity={0.3} />
          )}
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            tickFormatter={(value) => {
              const dateObj = new Date(value);
              return Number.isNaN(dateObj.getTime()) ? value : dateObj.toLocaleString();
            }}
            angle={-45}
            textAnchor="end"
            height={70}
            interval="preserveStartEnd"
          />
          <YAxis tickFormatter={(value) => `₹${value.toFixed(0)}`} />
          <Tooltip
            formatter={(value: any) => [`₹${Number(value).toFixed(2)}`, 'Drawdown']}
            labelFormatter={(label) => {
              const dateObj = new Date(label);
              return Number.isNaN(dateObj.getTime()) ? label : dateObj.toLocaleString();
            }}
          />
          <Legend />
          <Area type="monotone" dataKey="drawdown" stroke="#dc3545" fill="#f8d7da" name="Drawdown (₹)" />
        </AreaChart>
      </ResponsiveContainer>
      <div className="mt-2">
        <span className="badge bg-danger me-2">Drawdown</span>
        <span className="badge bg-light text-dark">Shaded: Evaluation Test Region (30%)</span>
      </div>
    </div>
  );
};

const RLTradeScatter: React.FC<{ data: Array<{ exit_time: string; pnl: number; subset?: string; position?: string }> }> = ({ data }) => {
  if (!data.length) return null;
  return (
    <div>
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 10, right: 30, bottom: 40, left: 0 }}>
          <CartesianGrid />
          <XAxis
            dataKey="exit_time"
            name="Exit Time"
            tickFormatter={(value) => {
              const dateObj = new Date(value);
              return Number.isNaN(dateObj.getTime()) ? value : dateObj.toLocaleString();
            }}
            angle={-45}
            textAnchor="end"
            height={70}
          />
          <YAxis dataKey="pnl" name="PnL" tickFormatter={(value) => `₹${value.toFixed(0)}`} />
          <ZAxis range={[60, 120]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            formatter={(value: any, name: string, props: any) => {
              if (name === 'pnl') {
                return [`₹${Number(value).toFixed(2)}`, 'PnL'];
              }
              return [value, name];
            }}
            labelFormatter={(label) => {
              const dateObj = new Date(label);
              return Number.isNaN(dateObj.getTime()) ? label : dateObj.toLocaleString();
            }}
          />
          <Legend />
          <Scatter data={data} fill="#0d6efd" name="Trades" />
        </ScatterChart>
      </ResponsiveContainer>
      <div className="mt-2">
        <span className="badge bg-primary">Trade Exit PnL</span>
      </div>
    </div>
  );
};

const TrainModelPanel: React.FC = () => {
  const [symbol, setSymbol] = useState<'NIFTY' | 'BANKNIFTY'>('NIFTY');
  const [years, setYears] = useState<number>(2);
  const [horizon, setHorizon] = useState<number>(1);
  const [lookback, setLookback] = useState<number>(60);
  const [epochs, setEpochs] = useState<number>(15);
  const [steps, setSteps] = useState<number>(3);
  const [loading, setLoading] = useState<boolean>(false);
  const [trainingInfo, setTrainingInfo] = useState<any>(null);
  const [overlaySeries, setOverlaySeries] = useState<any[]>([]);
  const [prediction, setPrediction] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [rlSymbol, setRlSymbol] = useState<'NIFTY' | 'BANKNIFTY'>('BANKNIFTY');
  const [rlYears, setRlYears] = useState<number>(3);
  const [episodes, setEpisodes] = useState<number>(100);
  const [epsilon, setEpsilon] = useState<number>(1.0);
  const [epsilonDecay, setEpsilonDecay] = useState<number>(0.995);
  const [rlStrategy, setRlStrategy] = useState<string>('');
  const [rlLoading, setRlLoading] = useState<boolean>(false);
  const [rlTrainingInfo, setRlTrainingInfo] = useState<any>(null);
  const [rlEvaluationResults, setRlEvaluationResults] = useState<any>(null);
  const [rlEvaluationLabel, setRlEvaluationLabel] = useState<string>('');
  const [savedStrategies, setSavedStrategies] = useState<Array<{ id: string | number; strategy_name?: string; name?: string }>>([]);
  const [strategiesLoading, setStrategiesLoading] = useState<boolean>(false);
  const [rlSeries, setRlSeries] = useState<Array<any>>([]);
  const [rlChartSeries, setRlChartSeries] = useState<Array<any>>([]);
  const [rlDrawdownSeries, setRlDrawdownSeries] = useState<Array<any>>([]);
  const [rlDrawdownChart, setRlDrawdownChart] = useState<Array<any>>([]);
  const [rlTradePoints, setRlTradePoints] = useState<Array<any>>([]);
  const [rlTradeChart, setRlTradeChart] = useState<Array<any>>([]);
  const [rlSelectedDate, setRlSelectedDate] = useState<string>('');
  const [trainStart, setTrainStart] = useState<string>('2020-01-01');
  const [trainEnd, setTrainEnd] = useState<string>('2022-12-31');
  const [testStart, setTestStart] = useState<string>('2023-01-01');
  const [testEnd, setTestEnd] = useState<string>('2023-12-31');
  const [oosStart, setOosStart] = useState<string>('2024-01-01');
  const [oosEnd, setOosEnd] = useState<string>('2024-12-31');

  const trainModel = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(apiUrl('/api/ai/lstm/train'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, years, horizon, lookback, epochs }),
      });
      if (!response.ok) throw new Error('Training failed');
      const data = await response.json();
      setTrainingInfo(data);
    } catch (e: any) {
      setError(e.message || 'Training error');
    } finally {
      setLoading(false);
    }
  };

  const runPrediction = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(apiUrl('/api/ai/lstm/predict'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, horizon, steps }),
      });
      if (!response.ok) throw new Error('Prediction failed');
      const data = await response.json();
      setPrediction(data);
    } catch (e: any) {
      setError(e.message || 'Prediction error');
    } finally {
      setLoading(false);
    }
  };

  const fetchOverlay = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(apiUrl(`/api/ai/lstm/overlay?symbol=${symbol}`));
      if (!response.ok) throw new Error('Overlay fetch failed');
      const data = await response.json();
      setOverlaySeries(data.series || []);
    } catch (e: any) {
      setError(e.message || 'Overlay error');
    } finally {
      setLoading(false);
    }
  };

  const trainRL = async () => {
    if (!rlStrategy) {
      setError('Please select a strategy before training the RL agent.');
      return;
    }
    if (!trainStart || !trainEnd) {
      setError('Please provide training start and end dates.');
      return;
    }
    setError(null);
    setRlLoading(true);
    setRlTrainingInfo(null);
    setRlEvaluationResults(null);
    setRlEvaluationLabel('');
    setRlSeries([]);
    setRlChartSeries([]);
    setRlDrawdownSeries([]);
    setRlDrawdownChart([]);
    setRlTradePoints([]);
    setRlTradeChart([]);
    try {
      const payload = {
        symbol: rlSymbol,
        years: rlYears,
        episodes,
        epsilon,
        epsilon_decay: epsilonDecay,
        strategy: rlStrategy,
        train_start: trainStart,
        train_end: trainEnd,
      };
      const res = await fetch(apiUrl('/api/rl/train'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json() : { status: 'error', message: await res.text() };
      if (!res.ok || data.status !== 'ok') throw new Error(data.message || 'RL training failed');
      setRlTrainingInfo(data);
    } catch (e: any) {
      setError(e.message || 'RL training error');
    } finally {
      setRlLoading(false);
    }
  };

  const evaluateRL = async (start: string, end: string, label: string) => {
    if (!start || !end) {
      setError(`Please provide both start and end dates for the ${label} evaluation.`);
      return;
    }
    setError(null);
    setRlLoading(true);
    setRlEvaluationResults(null);
    setRlEvaluationLabel(label);
    setRlSeries([]);
    setRlChartSeries([]);
    setRlDrawdownSeries([]);
    setRlDrawdownChart([]);
    setRlTradePoints([]);
    setRlTradeChart([]);
    try {
      const params = new URLSearchParams({ symbol: rlSymbol, start, end, label });
      const res = await fetch(apiUrl(`/api/rl/evaluate?${params.toString()}`), {
        credentials: 'include',
      });
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json() : { status: 'error', message: await res.text() };
      if (!res.ok || data.status !== 'ok') throw new Error(data.message || 'RL evaluation failed');
      setRlEvaluationResults(data);
      const series = data.series || [];
      setRlSeries(series);
      setRlChartSeries(series);
      const drawdown = data.drawdown_series || [];
      setRlDrawdownSeries(drawdown);
      setRlDrawdownChart(drawdown);
      const trades = data.trade_points || [];
      setRlTradePoints(trades);
      setRlTradeChart(trades);
      if (series.length > 0) {
        const lastEntry = series[series.length - 1];
        const initialEntry = series[0];
        const lastDate = lastEntry.date || (lastEntry.time ? lastEntry.time.substring(0, 10) : '');
        setRlSelectedDate(lastDate || (initialEntry?.date ?? ''));
      } else {
        setRlSelectedDate('');
      }
    } catch (e: any) {
      setError(e.message || 'RL evaluation error');
    } finally {
      setRlLoading(false);
    }
  };

  useEffect(() => {
    const fetchSavedStrategies = async () => {
      setStrategiesLoading(true);
      try {
        // Only fetch approved strategies for dropdowns
        const res = await fetch(apiUrl('/api/strategies?only_approved=true'), { credentials: 'include' });
        const ct = res.headers.get('content-type') || '';
        const data = ct.includes('application/json') ? await res.json() : { status: 'error', message: await res.text() };
        if (res.ok && data.status === 'success') {
          setSavedStrategies(data.strategies || []);
        } else {
          setSavedStrategies([]);
        }
      } catch (err) {
        setSavedStrategies([]);
      } finally {
        setStrategiesLoading(false);
      }
    };

    fetchSavedStrategies();
  }, []);

  const showRlDateChart = () => {
    if (!rlSeries.length) return;
    if (!rlSelectedDate) {
      setRlChartSeries(rlSeries);
      setRlDrawdownChart(rlDrawdownSeries);
      setRlTradeChart(rlTradePoints);
      return;
    }
    const filtered = rlSeries.filter((entry) => {
      const dateValue = entry.date || (entry.time ? entry.time.substring(0, 10) : '');
      return dateValue === rlSelectedDate;
    });
    const filteredDrawdown = rlDrawdownSeries.filter((entry) => {
      const dateValue = entry.date || (entry.time ? entry.time.substring(0, 10) : '');
      return dateValue === rlSelectedDate;
    });
    const filteredTrades = rlTradePoints.filter((entry) => {
      const dateValue = entry.exit_time ? entry.exit_time.substring(0, 10) : '';
      return dateValue === rlSelectedDate;
    });
    setRlChartSeries(filtered.length > 0 ? filtered : rlSeries);
    setRlDrawdownChart(filteredDrawdown.length > 0 ? filteredDrawdown : rlDrawdownSeries);
    setRlTradeChart(filteredTrades.length > 0 ? filteredTrades : rlTradePoints);
  };

  return (
    <>
      <div className="card border-0 shadow-sm">
        <div className="card-header bg-secondary text-white">
          <h6 className="mb-0">
            <i className="bi bi-graph-up-arrow me-2"></i>
            LSTM Price Predictions (Phase 1)
          </h6>
        </div>
        <div className="card-body">
          <div className="row g-3 align-items-end">
            <div className="col-md-2">
              <label className="form-label">Symbol</label>
              <select className="form-select" value={symbol} onChange={(e) => setSymbol(e.target.value as any)}>
                <option value="NIFTY">NIFTY</option>
                <option value="BANKNIFTY">BANKNIFTY</option>
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">Years</label>
              <select className="form-select" value={years} onChange={(e) => setYears(Number(e.target.value))}>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">Horizon (candles)</label>
              <select className="form-select" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">Lookback</label>
              <input className="form-control" type="number" value={lookback} min={30} max={200} onChange={(e) => setLookback(Number(e.target.value))} />
            </div>
            <div className="col-md-2">
              <label className="form-label">Epochs</label>
              <input className="form-control" type="number" value={epochs} min={5} max={50} onChange={(e) => setEpochs(Number(e.target.value))} />
            </div>
            <div className="col-md-2">
              <label className="form-label">Predict Steps</label>
              <select className="form-select" value={steps} onChange={(e) => setSteps(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-3 d-flex gap-2">
            <button className="btn btn-primary" onClick={trainModel} disabled={loading}>
              {loading ? 'Training...' : 'Train Model'}
            </button>
            <button className="btn btn-outline-primary" onClick={runPrediction} disabled={loading}>
              {loading ? 'Predicting...' : 'Predict Next'}
            </button>
            <button className="btn btn-outline-secondary" onClick={fetchOverlay} disabled={loading}>
              {loading ? 'Loading...' : 'Show 3Y Overlay (70/30)'}
            </button>
          </div>

          {error && (
            <div className="alert alert-danger mt-3" role="alert">
              <i className="bi bi-exclamation-triangle me-2"></i>
              {error}
            </div>
          )}

          {trainingInfo && (
            <div className="mt-3">
              <div className="alert alert-success">
                <strong>Model Trained:</strong> {trainingInfo.symbol} h{trainingInfo.horizon} | Test MSE: {trainingInfo.test_mse ?? 'N/A'}
              </div>
              <pre className="bg-light p-2 rounded" style={{ maxHeight: 200, overflow: 'auto' }}>
{JSON.stringify({ loss: trainingInfo.history?.loss?.slice(-5), val_loss: trainingInfo.history?.val_loss?.slice(-5) }, null, 2)}
              </pre>
            </div>
          )}

          {prediction && (
            <div className="mt-3">
              <div className="alert alert-info">
                <strong>Predictions ({steps} candles ahead):</strong>
                <div className="mt-2">
                  {prediction.predictions.map((p: number, i: number) => (
                    <span key={i} className="badge bg-secondary me-2">T+{i + 1}: ₹{p.toFixed(2)}</span>
                  ))}
                </div>
                <div className="mt-2"><strong>Confidence:</strong> {(prediction.confidence * 100).toFixed(1)}%</div>
              </div>
            </div>
          )}

          {overlaySeries.length > 0 && (
            <div className="mt-3">
              <h6>Actual vs Predicted (3 years, 70/30 split)</h6>
              <OverlayChart data={overlaySeries} />
            </div>
          )}
        </div>
      </div>

      <div className="card border-0 shadow-sm mt-4">
        <div className="card-header bg-success text-white">
          <h6 className="mb-0">
            <i className="bi bi-robot me-2"></i>
            Reinforcement Learning
          </h6>
        </div>
        <div className="card-body">
          <div className="alert alert-info">
            <strong>About:</strong> This RL agent learns to trade using Mountain Signal strategy rules.
            It uses Deep Q-Network (DQN) to optimize entry/exit decisions based on PE/CE signals, RSI, and EMA indicators.
          </div>

          <div className="row g-3 align-items-end mb-3">
            <div className="col-md-3">
              <label className="form-label">Strategy</label>
              <select className="form-select" value={rlStrategy} onChange={(e) => setRlStrategy(e.target.value)} disabled={strategiesLoading}>
                <option value="">-- Select Strategy --</option>
                {savedStrategies.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.strategy_name || s.name || `Strategy ${s.id}`}
                  </option>
                ))}
              </select>
              {(!strategiesLoading && savedStrategies.length === 0) && (
                <small className="text-muted">No saved strategies found.</small>
              )}
            </div>
            <div className="col-md-3">
              <label className="form-label">Symbol</label>
              <select className="form-select" value={rlSymbol} onChange={(e) => setRlSymbol(e.target.value as any)}>
                <option value="NIFTY">NIFTY</option>
                <option value="BANKNIFTY">BANKNIFTY</option>
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">Years</label>
              <select className="form-select" value={rlYears} onChange={(e) => setRlYears(Number(e.target.value))}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label">Episodes</label>
              <input className="form-control" type="number" value={episodes} min={50} max={500} onChange={(e) => setEpisodes(Number(e.target.value))} />
            </div>
            <div className="col-md-2">
              <label className="form-label">Epsilon</label>
              <input className="form-control" type="number" step="0.1" value={epsilon} min={0.1} max={1.0} onChange={(e) => setEpsilon(Number(e.target.value))} />
            </div>
            <div className="col-md-3">
              <label className="form-label">Epsilon Decay</label>
              <input className="form-control" type="number" step="0.001" value={epsilonDecay} min={0.9} max={0.999} onChange={(e) => setEpsilonDecay(Number(e.target.value))} />
            </div>
          </div>

          <div className="row g-3 align-items-end mb-3">
            <div className="col-md-4">
              <label className="form-label">Training Period (PE Model Fit)</label>
              <div className="d-flex gap-2">
                <input className="form-control" type="date" value={trainStart} onChange={(e) => setTrainStart(e.target.value)} />
                <input className="form-control" type="date" value={trainEnd} onChange={(e) => setTrainEnd(e.target.value)} />
              </div>
            </div>
            <div className="col-md-4">
              <label className="form-label">Test Period (Cross-Validation)</label>
              <div className="d-flex gap-2">
                <input className="form-control" type="date" value={testStart} onChange={(e) => setTestStart(e.target.value)} />
                <input className="form-control" type="date" value={testEnd} onChange={(e) => setTestEnd(e.target.value)} />
              </div>
            </div>
            <div className="col-md-4">
              <label className="form-label">Out-of-Sample Validation</label>
              <div className="d-flex gap-2">
                <input className="form-control" type="date" value={oosStart} onChange={(e) => setOosStart(e.target.value)} />
                <input className="form-control" type="date" value={oosEnd} onChange={(e) => setOosEnd(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="d-flex gap-2 mb-3">
            <button className="btn btn-success" onClick={trainRL} disabled={rlLoading}>
              {rlLoading ? 'Training...' : 'Train RL Agent'}
            </button>
            <button className="btn btn-outline-success" onClick={() => evaluateRL(testStart, testEnd, 'Test Period')} disabled={rlLoading}>
              {rlLoading ? 'Evaluating...' : 'Evaluate Test Period'}
            </button>
            <button className="btn btn-outline-secondary" onClick={() => evaluateRL(oosStart, oosEnd, 'Out-of-Sample')} disabled={rlLoading}>
              {rlLoading ? 'Evaluating...' : 'Evaluate Out-of-Sample'}
            </button>
          </div>

          {rlTrainingInfo && (
            <div className="mt-3">
              <div className="alert alert-success">
                <h6><strong>Training Complete!</strong></h6>
                <div className="row">
                  <div className="col-md-6">
                    <p><strong>Symbol:</strong> {rlTrainingInfo.symbol}</p>
                    <p><strong>Episodes:</strong> {rlTrainingInfo.episodes}</p>
                    <p><strong>Final Reward:</strong> {rlTrainingInfo.final_reward?.toFixed(2) || 'N/A'}</p>
                    <p><strong>Final PnL:</strong> ₹{rlTrainingInfo.final_pnl?.toFixed(2) || 'N/A'}</p>
                    <p><strong>Training Period:</strong> {rlTrainingInfo.train_start} → {rlTrainingInfo.train_end}</p>
                  </div>
                  <div className="col-md-6">
                    <p><strong>Total Trades:</strong> {rlTrainingInfo.trade_count ?? 'N/A'}</p>
                    <p><strong>Winning Trades:</strong> {rlTrainingInfo.winning_trades ?? 'N/A'}</p>
                    <p><strong>Losing Trades:</strong> {rlTrainingInfo.losing_trades ?? 'N/A'}</p>
                    <p><strong>Win Ratio:</strong> {rlTrainingInfo.win_ratio !== undefined ? `${(rlTrainingInfo.win_ratio * 100).toFixed(1)}%` : 'N/A'}</p>
                    <p><strong>Max Drawdown:</strong> {rlTrainingInfo.max_drawdown !== undefined ? `₹${rlTrainingInfo.max_drawdown.toFixed(2)}` : 'N/A'}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {rlEvaluationResults && (
            <div className="mt-3">
              <div className="alert alert-primary">
                <h6><strong>Evaluation Results</strong></h6>
                <p><strong>Evaluation:</strong> {rlEvaluationLabel || rlEvaluationResults.label || 'Custom'}</p>
                <p><strong>Period:</strong> {rlEvaluationResults.period}</p>
                <p><strong>Net PnL:</strong> ₹{rlEvaluationResults.pnl !== undefined ? rlEvaluationResults.pnl.toFixed(2) : 'N/A'}</p>
                <p><strong>Winning Trades:</strong> {rlEvaluationResults.wins ?? 'N/A'}</p>
                <p><strong>Losing Trades:</strong> {rlEvaluationResults.losses ?? 'N/A'}</p>
                <p><strong>Win Rate:</strong> {rlEvaluationResults.win_rate !== undefined ? `${rlEvaluationResults.win_rate.toFixed(2)}%` : 'N/A'}</p>
                <p><strong>Average Win:</strong> ₹{rlEvaluationResults.avg_win !== undefined ? rlEvaluationResults.avg_win.toFixed(2) : 'N/A'}</p>
                <p><strong>Average Loss:</strong> ₹{rlEvaluationResults.avg_loss !== undefined ? rlEvaluationResults.avg_loss.toFixed(2) : 'N/A'}</p>
              </div>
              {rlSeries.length > 0 && (
                <div className="card border-0 shadow-sm mt-3">
                  <div className="card-header bg-warning text-dark">
                    <h6 className="mb-0">
                      <i className="bi bi-graph-up-arrow me-2"></i>
                      Reinforcement Learning Equity Curve
                    </h6>
                  </div>
                  <div className="card-body">
                    <div className="row g-2 align-items-end mb-3">
                      <div className="col-sm-6 col-md-3">
                        <label className="form-label small mb-1">Select Date</label>
                        <input
                          type="date"
                          className="form-control form-control-sm"
                          value={rlSelectedDate}
                          onChange={(e) => setRlSelectedDate(e.target.value)}
                          min={rlSeries[0].date || rlSeries[0].time?.slice(0, 10)}
                          max={rlSeries[rlSeries.length - 1].date || rlSeries[rlSeries.length - 1].time?.slice(0, 10)}
                        />
                      </div>
                      <div className="col-sm-6 col-md-3 d-flex gap-2">
                        <button className="btn btn-outline-info btn-sm" onClick={showRlDateChart}>
                          Show RL Chart
                        </button>
                        <button
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => {
                            setRlChartSeries(rlSeries);
                            setRlDrawdownChart(rlDrawdownSeries);
                            setRlTradeChart(rlTradePoints);
                          }}
                        >
                          Show Full
                        </button>
                      </div>
                    </div>
                    {rlChartSeries.length > 0 ? (
                      <RLEquityChart data={rlChartSeries} />
                    ) : (
                      <div className="alert alert-warning mb-0">
                        <i className="bi bi-info-circle me-2"></i>
                        No data available for the selected date.
                      </div>
                    )}
                  </div>
                </div>
              )}
              {rlDrawdownChart.length > 0 && (
                <div className="card border-0 shadow-sm mt-3">
                  <div className="card-header bg-secondary text-white">
                    <h6 className="mb-0">
                      <i className="bi bi-graph-down-arrow me-2"></i>
                      Drawdown Curve
                    </h6>
                  </div>
                  <div className="card-body">
                    <RLDrawdownChart data={rlDrawdownChart} />
                  </div>
                </div>
              )}
              {rlTradeChart.length > 0 && (
                <div className="card border-0 shadow-sm mt-3">
                  <div className="card-header bg-info text-white">
                    <h6 className="mb-0">
                      <i className="bi bi-scatter-chart me-2"></i>
                      Trade Outcomes (Exit Time vs PnL)
                    </h6>
                  </div>
                  <div className="card-body">
                    <RLTradeScatter data={rlTradeChart} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

