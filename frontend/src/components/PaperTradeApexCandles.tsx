import React from 'react';
import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';

export interface PaperTradeApexCandlePoint {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  ema5?: number | null;
}

interface PaperTradeApexCandlesProps {
  data: PaperTradeApexCandlePoint[];
  height?: number;
}

const PaperTradeApexCandles: React.FC<PaperTradeApexCandlesProps> = ({ data, height = 500 }) => {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8f9fa',
        }}
      >
        <span className="text-muted">No candle data to display</span>
      </div>
    );
  }

  const candleSeriesData = data.map(c => ({
    x: c.time.getTime(),
    y: [c.open, c.high, c.low, c.close] as [number, number, number, number],
  }));

  const emaSeriesData = data
    .filter(c => c.ema5 != null && !Number.isNaN(c.ema5 as number))
    .map(c => ({
      x: c.time.getTime(),
      y: c.ema5 as number,
    }));

  const series: any[] = [
    {
      name: 'Option Close',
      type: 'candlestick',
      data: candleSeriesData,
    },
  ];

  if (emaSeriesData.length > 0) {
    series.push({
      name: 'EMA 5',
      type: 'line',
      data: emaSeriesData,
    });
  }

  const options: ApexOptions = {
    chart: {
      type: 'candlestick',
      animations: { enabled: false },
      toolbar: { show: false },
      zoom: { enabled: false },
    },
    xaxis: {
      type: 'datetime',
      labels: {
        datetimeUTC: false,
      },
    },
    yaxis: {
      tooltip: {
        enabled: true,
      },
    },
    plotOptions: {
      candlestick: {
        colors: {
          upward: '#28a745',
          downward: '#dc3545',
        },
        wick: {
          useFillColor: true,
        },
      },
    },
    tooltip: {
      shared: true,
      x: { show: true },
    },
    legend: {
      show: true,
      position: 'top',
    },
  };

  return (
    <ReactApexChart
      options={options}
      series={series}
      type="candlestick"
      height={height}
      width="100%"
    />
  );
};

export default PaperTradeApexCandles;

