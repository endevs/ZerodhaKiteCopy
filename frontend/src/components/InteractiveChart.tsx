import React from 'react';
import {
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface IndicatorData {
  time: string;
  value: number;
}

interface Props {
  candles: CandleData[];
  indicators?: {
    sma?: IndicatorData[];
    ema?: IndicatorData[];
    rsi?: IndicatorData[];
    macd?: IndicatorData[];
    bb_upper?: IndicatorData[];
    bb_lower?: IndicatorData[];
  };
  timeframe?: string;
  height?: number;
}

const InteractiveChart: React.FC<Props> = ({ 
  candles, 
  indicators = {}, 
  timeframe = '5min',
  height = 500 
}) => {
  // Transform data for Recharts
  const chartData = candles.map(candle => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume || 0,
    // Add indicators
    sma: indicators.sma?.find(i => i.time === candle.time)?.value,
    ema: indicators.ema?.find(i => i.time === candle.time)?.value,
    bb_upper: indicators.bb_upper?.find(i => i.time === candle.time)?.value,
    bb_lower: indicators.bb_lower?.find(i => i.time === candle.time)?.value,
  }));

  return (
    <div className="card shadow-sm">
      <div className="card-header bg-dark text-white">
        <h6 className="mb-0">Price Chart - {timeframe}</h6>
      </div>
      <div className="card-body">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="time" 
              angle={-45}
              textAnchor="end"
              height={80}
              interval="preserveStartEnd"
            />
            <YAxis 
              yAxisId="left"
              domain={['dataMin - 10', 'dataMax + 10']}
            />
            <YAxis 
              yAxisId="right" 
              orientation="right"
              domain={[0, 'dataMax * 1.1']}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#fff', border: '1px solid #ccc' }}
              formatter={(value: any, name: string) => {
                if (name === 'high' || name === 'low' || name === 'open' || name === 'close') {
                  return [`₹${value.toFixed(2)}`, name.toUpperCase()];
                }
                return [value?.toFixed(2) || 'N/A', name];
              }}
            />
            <Legend />

            {/* Price Range Representation */}
            <Area
              type="monotone"
              dataKey="high"
              stroke="#26a69a"
              fill="#26a69a"
              fillOpacity={0.2}
              yAxisId="left"
              name="High"
            />
            <Area
              type="monotone"
              dataKey="low"
              stroke="#ef5350"
              fill="#ef5350"
              fillOpacity={0.2}
              yAxisId="left"
              name="Low"
            />
            <Line
              type="monotone"
              dataKey="open"
              stroke="#FFA726"
              strokeWidth={1}
              dot={false}
              name="Open"
              yAxisId="left"
            />

            {/* Moving Averages */}
            {indicators.sma && (
              <Line
                type="monotone"
                dataKey="sma"
                stroke="#2196F3"
                strokeWidth={2}
                dot={false}
                name="SMA"
                yAxisId="left"
              />
            )}
            {indicators.ema && (
              <Line
                type="monotone"
                dataKey="ema"
                stroke="#FF9800"
                strokeWidth={2}
                dot={false}
                name="EMA"
                yAxisId="left"
              />
            )}

            {/* Bollinger Bands */}
            {indicators.bb_upper && (
              <Line
                type="monotone"
                dataKey="bb_upper"
                stroke="#9C27B0"
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={false}
                name="BB Upper"
                yAxisId="left"
              />
            )}
            {indicators.bb_lower && (
              <Line
                type="monotone"
                dataKey="bb_lower"
                stroke="#9C27B0"
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={false}
                name="BB Lower"
                yAxisId="left"
              />
            )}

            {/* Volume */}
            {chartData[0]?.volume && (
              <Bar
                dataKey="volume"
                fill="#8884d8"
                yAxisId="right"
                name="Volume"
                opacity={0.3}
              />
            )}

            {/* Price Lines */}
            <Line
              type="monotone"
              dataKey="close"
              stroke="#1976D2"
              strokeWidth={2}
              dot={false}
              name="Close"
              yAxisId="left"
            />
          </ComposedChart>
        </ResponsiveContainer>

        <div className="mt-3 d-flex justify-content-between">
          <small className="text-muted">
            <strong>Data Points:</strong> {candles.length} | 
            <strong> Timeframe:</strong> {timeframe}
          </small>
          <div>
            <button className="btn btn-sm btn-outline-primary me-2">Zoom In</button>
            <button className="btn btn-sm btn-outline-primary">Zoom Out</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InteractiveChart;

