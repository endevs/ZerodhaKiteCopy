import React, { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, ColorType } from 'lightweight-charts';

export interface CandlestickDataPoint {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  ema5?: number | null;
}

interface PaperTradeCandlestickChartProps {
  data: CandlestickDataPoint[];
  height?: number;
}

/**
 * Candlestick chart using TradingView Lightweight Charts (native candlestick support).
 * Used in Paper Trade tab when "Candlestick" is selected.
 */
const PaperTradeCandlestickChart: React.FC<PaperTradeCandlestickChartProps> = ({
  data,
  height = 500,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    if (data.length === 0) {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        candlestickSeriesRef.current = null;
        emaSeriesRef.current = null;
      }
      return;
    }

    if (!containerRef.current) return;

    const createOrUpdateChart = () => {
      const candleData = data.map((d) => ({
        time: Math.floor(d.time.getTime() / 1000) as any,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));
      const hasEma = data.some((d) => d.ema5 != null && !Number.isNaN(d.ema5));
      const emaData = hasEma
        ? data
            .filter((d) => d.ema5 != null && !Number.isNaN(d.ema5))
            .map((d) => ({
              time: Math.floor(d.time.getTime() / 1000) as any,
              value: d.ema5 as number,
            }))
        : [];

      if (!chartRef.current) {
        const chart = createChart(containerRef.current!, {
          layout: {
            background: { type: ColorType.Solid, color: '#ffffff' },
            textColor: '#333',
          },
          grid: {
            vertLines: { color: '#f0f0f0' },
            horzLines: { color: '#f0f0f0' },
          },
          width: containerRef.current!.clientWidth,
          height,
          timeScale: {
            timeVisible: true,
            secondsVisible: false,
            borderColor: '#e0e0e0',
          },
          rightPriceScale: {
            borderColor: '#e0e0e0',
          },
        });

        const candlestickSeries = chart.addCandlestickSeries({
          upColor: '#28a745',
          downColor: '#dc3545',
          borderVisible: true,
          wickUpColor: '#28a745',
          wickDownColor: '#dc3545',
        });

        chartRef.current = chart;
        candlestickSeriesRef.current = candlestickSeries;
        candlestickSeries.setData(candleData);

        if (emaData.length > 0) {
          const emaSeries = chart.addLineSeries({
            color: '#ff7300',
            lineWidth: 2,
            title: 'EMA 5',
          });
          emaSeriesRef.current = emaSeries;
          emaSeries.setData(emaData);
        }

        chart.timeScale().fitContent();
      } else {
        candlestickSeriesRef.current?.setData(candleData);
        if (emaSeriesRef.current && emaData.length > 0) {
          emaSeriesRef.current.setData(emaData);
        }
        chartRef.current.timeScale().fitContent();
      }
    };

    createOrUpdateChart();

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [data, height]);

  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        candlestickSeriesRef.current = null;
        emaSeriesRef.current = null;
      }
    };
  }, []);

  if (data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f9fa' }}>
        <span className="text-muted">No candle data to display</span>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height }} />;
};

export default PaperTradeCandlestickChart;
