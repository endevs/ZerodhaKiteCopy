import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Area, Customized } from 'recharts';
import { apiUrl } from '../config/api';

interface ChartData {
  candles: Array<{
    x: string;
    o: number;
    h: number;
    l: number;
    c: number;
  }>;
  ema5?: Array<{ x: string; y: number | null }>;
  ema20?: Array<{ x: string; y: number | null }>;
  rsi14?: Array<{ x: string; y: number | null }>;
}

const ChartContent: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedInstrument, setSelectedInstrument] = useState<string>('BANKNIFTY');
  const [chartData, setChartData] = useState<ChartData>({ candles: [] });
  const [interval, setInterval] = useState<string>('5m');
  const [showEMA5, setShowEMA5] = useState<boolean>(true);
  const [showEMA20, setShowEMA20] = useState<boolean>(false);
  const [showRSI, setShowRSI] = useState<boolean>(false);
  const [chartType, setChartType] = useState<'line' | 'candle' | 'area' | 'ohlc'>('candle');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Set today's date as default
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    setSelectedDate(today);
  }, []);

  const fetchChartData = async (date: string) => {
    if (!date) {
      setError('Please select a date');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        apiUrl(
          `/api/chart_data?date=${date}&instrument=${encodeURIComponent(selectedInstrument)}&interval=${encodeURIComponent(
            interval
          )}`
        ),
        {
          credentials: 'include',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch chart data');
      }

      const data: ChartData = await response.json();
      setChartData(data);

      if (data.candles.length === 0) {
        setError('No data available for the selected date');
      }
    } catch (err) {
      console.error('Error fetching chart data:', err);
      setError(err instanceof Error ? err.message : 'An error occurred while fetching chart data');
    } finally {
      setLoading(false);
    }
  };

  const handleShowChart = () => {
    if (selectedDate) {
      fetchChartData(selectedDate);
    }
  };

  // Format time helper function
  const formatTime = (dateString: string): string => {
    const date = new Date(dateString);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  // Format full date time helper function
  const formatDateTime = (dateString: string): string => {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  };

  // Prepare data for Recharts
  const chartDataFormatted = chartData.candles.map((candle, index) => ({
    time: new Date(candle.x),
    timeFormatted: formatTime(candle.x),
    close: candle.c,
    open: candle.o,
    high: candle.h,
    low: candle.l,
    ema5: chartData.ema5?.[index]?.y ?? null,
    ema20: chartData.ema20?.[index]?.y ?? null,
  }));

  // Custom candlestick renderer using Recharts Customized
  const renderCandles = (props: any) => {
    try {
      const { xAxisMap, yAxisMap } = props;
      const xKey = Object.keys(xAxisMap)[0];
      const yKey = Object.keys(yAxisMap)[0];
      const xScale = xAxisMap[xKey].scale;
      const yScale = yAxisMap[yKey].scale;
      const bandSize = (xAxisMap[xKey].bandSize && Number(xAxisMap[xKey].bandSize)) || 10;
      const candleWidth = Math.max(3, Math.floor(bandSize * 0.7));
      const half = Math.floor(candleWidth / 2);
      return (
        <g>
          {chartDataFormatted.map((d, idx) => {
            const cx = xScale(d.timeFormatted);
            if (typeof cx !== 'number' || isNaN(cx)) return null;
            const x = cx - half;
            const yOpen = yScale(d.open);
            const yClose = yScale(d.close);
            const yHigh = yScale(d.high);
            const yLow = yScale(d.low);
            if ([yOpen, yClose, yHigh, yLow].some(v => typeof v !== 'number' || isNaN(v))) return null;
            const top = Math.min(yOpen, yClose);
            const height = Math.max(1, Math.abs(yClose - yOpen));
            const color = d.close >= d.open ? '#28a745' : '#dc3545';
            return (
              <g key={idx}>
                {/* Wick */}
                <line x1={x + half} y1={yHigh} x2={x + half} y2={yLow} stroke="#495057" strokeWidth={1} />
                {/* Body */}
                <rect x={x} y={top} width={candleWidth} height={height} fill={color} stroke={color} />
              </g>
            );
          })}
        </g>
      );
    } catch (e) {
      return null;
    }
  };

  // Custom OHLC bars renderer (no filled bodies, just open/close ticks and high/low wick)
  const renderOhlcBars = (props: any) => {
    try {
      const { xAxisMap, yAxisMap } = props;
      const xKey = Object.keys(xAxisMap)[0];
      const yKey = Object.keys(yAxisMap)[0];
      const xScale = xAxisMap[xKey].scale;
      const yScale = yAxisMap[yKey].scale;
      const bandSize = (xAxisMap[xKey].bandSize && Number(xAxisMap[xKey].bandSize)) || 10;
      const tick = Math.max(3, Math.floor(bandSize * 0.3));
      return (
        <g>
          {chartDataFormatted.map((d, idx) => {
            const cx = xScale(d.timeFormatted);
            if (typeof cx !== 'number' || isNaN(cx)) return null;
            const yOpen = yScale(d.open);
            const yClose = yScale(d.close);
            const yHigh = yScale(d.high);
            const yLow = yScale(d.low);
            if ([yOpen, yClose, yHigh, yLow].some(v => typeof v !== 'number' || isNaN(v))) return null;
            const color = d.close >= d.open ? '#28a745' : '#dc3545';
            return (
              <g key={idx}>
                {/* High-Low wick */}
                <line x1={cx} y1={yHigh} x2={cx} y2={yLow} stroke="#495057" strokeWidth={1} />
                {/* Open tick (left) */}
                <line x1={cx - tick} y1={yOpen} x2={cx} y2={yOpen} stroke={color} strokeWidth={2} />
                {/* Close tick (right) */}
                <line x1={cx} y1={yClose} x2={cx + tick} y2={yClose} stroke={color} strokeWidth={2} />
              </g>
            );
          })}
        </g>
      );
    } catch {
      return null;
    }
  };

  return (
    <div className="container mt-4">
      <div className="card shadow-sm border-0">
        <div className="card-header bg-info text-white">
          <h5 className="card-title mb-0">
            <i className="bi bi-graph-up me-2"></i>Candlestick Chart
          </h5>
        </div>
        <div className="card-body">
          <div className="row mb-4">
            <div className="col-md-4">
              <label htmlFor="date-picker" className="form-label">
                <i className="bi bi-calendar3 me-2"></i>Select Date
              </label>
              <input
                type="date"
                id="date-picker"
                className="form-control"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </div>
            <div className="col-md-3">
              <label htmlFor="instrument-picker" className="form-label">
                <i className="bi bi-activity me-2"></i>Select Index
              </label>
              <select
                id="instrument-picker"
                className="form-select"
                value={selectedInstrument}
                onChange={(e) => setSelectedInstrument(e.target.value)}
              >
                <option value="BANKNIFTY">NIFTY BANK (BANKNIFTY)</option>
                <option value="NIFTY">NIFTY 50 (NIFTY)</option>
              </select>
            </div>
            <div className="col-md-2">
              <label htmlFor="interval-picker" className="form-label">
                <i className="bi bi-clock-history me-2"></i>Timeframe
              </label>
              <select
                id="interval-picker"
                className="form-select"
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
              >
                <option value="1m">1m</option>
                <option value="3m">3m</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="30m">30m</option>
                <option value="60m">60m</option>
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label"><i className="bi bi-sliders me-2"></i>Indicators</label>
              <div className="d-flex gap-3">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="ema5" checked={showEMA5} onChange={(e) => setShowEMA5(e.target.checked)} />
                  <label className="form-check-label" htmlFor="ema5">EMA 5</label>
                </div>
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="ema20" checked={showEMA20} onChange={(e) => setShowEMA20(e.target.checked)} />
                  <label className="form-check-label" htmlFor="ema20">EMA 20</label>
                </div>
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="rsi14" checked={showRSI} onChange={(e) => setShowRSI(e.target.checked)} />
                  <label className="form-check-label" htmlFor="rsi14">RSI 14</label>
                </div>
              </div>
            </div>
            <div className="col-md-2">
              <label className="form-label"><i className="bi bi-kanban me-2"></i>Chart Type</label>
              <select className="form-select" value={chartType} onChange={(e) => setChartType(e.target.value as any)}>
                <option value="candle">Candlestick</option>
                <option value="line">Line</option>
                <option value="area">Area</option>
                <option value="ohlc">OHLC Bars</option>
              </select>
            </div>
            <div className="col-md-2 d-flex align-items-end">
              <button
                id="show-chart-btn"
                className="btn btn-primary w-100"
                onClick={handleShowChart}
                disabled={loading || !selectedDate}
              >
                {loading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                    Loading...
                  </>
                ) : (
                  <>
                    <i className="bi bi-graph-up-arrow me-2"></i>Show Chart
                  </>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="alert alert-warning" role="alert">
              <i className="bi bi-exclamation-triangle me-2"></i>{error}
            </div>
          )}

          {chartDataFormatted.length > 0 && (
            <div className="chart-container" style={{ width: '100%', minWidth: 0, height: 420 }}>
              <ResponsiveContainer width="100%" height={420}>
                {chartType === 'line' ? (
                  <LineChart data={chartDataFormatted} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    <XAxis dataKey="timeFormatted" stroke="#666" style={{ fontSize: '12px' }} />
                    <YAxis stroke="#666" style={{ fontSize: '12px' }} domain={['dataMin - 10', 'dataMax + 10']} />
                    <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '4px' }}
                      labelFormatter={(value) => {
                        const point = chartDataFormatted.find((d) => d.timeFormatted === value);
                        return point ? formatDateTime(point.time.toISOString()) : value;
                      }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="close" stroke="#0d6efd" strokeWidth={2} dot={false} name="Close" />
                    {showEMA5 && (
                      <Line type="monotone" dataKey="ema5" stroke="#ff6b35" strokeWidth={2} dot={false} name="EMA 5" strokeDasharray="5 5" />
                    )}
                    {showEMA20 && (
                      <Line type="monotone" dataKey="ema20" stroke="#28a745" strokeWidth={2} dot={false} name="EMA 20" strokeDasharray="3 3" />
                    )}
                  </LineChart>
                ) : chartType === 'candle' ? (
                  <ComposedChart data={chartDataFormatted} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    <XAxis dataKey="timeFormatted" stroke="#666" style={{ fontSize: '12px' }} />
                    <YAxis stroke="#666" style={{ fontSize: '12px' }} domain={['dataMin - 10', 'dataMax + 10']} />
                    <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '4px' }}
                      labelFormatter={(value) => {
                        const point = chartDataFormatted.find((d) => d.timeFormatted === value);
                        return point ? formatDateTime(point.time.toISOString()) : value;
                      }}
                    />
                    <Legend />
                    {/* Real candlesticks */}
                    <Customized component={renderCandles} />
                    {showEMA5 && (
                      <Line type="monotone" dataKey="ema5" stroke="#ff6b35" strokeWidth={2} dot={false} name="EMA 5" strokeDasharray="5 5" />
                    )}
                    {showEMA20 && (
                      <Line type="monotone" dataKey="ema20" stroke="#28a745" strokeWidth={2} dot={false} name="EMA 20" strokeDasharray="3 3" />
                    )}
                  </ComposedChart>
                ) : chartType === 'area' ? (
                  <ComposedChart data={chartDataFormatted} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    <XAxis dataKey="timeFormatted" stroke="#666" style={{ fontSize: '12px' }} />
                    <YAxis stroke="#666" style={{ fontSize: '12px' }} domain={['dataMin - 10', 'dataMax + 10']} />
                    <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '4px' }}
                      labelFormatter={(value) => {
                        const point = chartDataFormatted.find((d) => d.timeFormatted === value);
                        return point ? formatDateTime(point.time.toISOString()) : value;
                      }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="close" stroke="#0d6efd" fill="#e3f2fd" name="Close (Area)" />
                    {showEMA5 && (
                      <Line type="monotone" dataKey="ema5" stroke="#ff6b35" strokeWidth={2} dot={false} name="EMA 5" strokeDasharray="5 5" />
                    )}
                    {showEMA20 && (
                      <Line type="monotone" dataKey="ema20" stroke="#28a745" strokeWidth={2} dot={false} name="EMA 20" strokeDasharray="3 3" />
                    )}
                  </ComposedChart>
                ) : (
                  <ComposedChart data={chartDataFormatted} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    <XAxis dataKey="timeFormatted" stroke="#666" style={{ fontSize: '12px' }} />
                    <YAxis stroke="#666" style={{ fontSize: '12px' }} domain={['dataMin - 10', 'dataMax + 10']} />
                    <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '4px' }}
                      labelFormatter={(value) => {
                        const point = chartDataFormatted.find((d) => d.timeFormatted === value);
                        return point ? formatDateTime(point.time.toISOString()) : value;
                      }}
                    />
                    <Legend />
                    {/* OHLC bars */}
                    <Customized component={renderOhlcBars} />
                    {showEMA5 && (
                      <Line type="monotone" dataKey="ema5" stroke="#ff6b35" strokeWidth={2} dot={false} name="EMA 5" strokeDasharray="5 5" />
                    )}
                    {showEMA20 && (
                      <Line type="monotone" dataKey="ema20" stroke="#28a745" strokeWidth={2} dot={false} name="EMA 20" strokeDasharray="3 3" />
                    )}
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>
          )}

          {!loading && chartDataFormatted.length === 0 && !error && (
            <div className="text-center py-5 text-muted">
              <i className="bi bi-graph-up fs-1 d-block mb-3"></i>
              <p>Select a date and click "Show Chart" to view market data</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChartContent;

