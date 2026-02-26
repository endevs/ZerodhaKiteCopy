import React, { useMemo } from 'react';
import { Plot } from '../lib/plotly-finance';

export interface PlotlyCandlePoint {
  time: Date | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  indexClose?: number | null;
  ema5?: number | null;
}

export interface TradeMarker {
  time: string;
  price: number;
  direction: 'long' | 'short';
  action: 'entry' | 'exit' | 'signal';
  label?: string;
}

interface PlotlyCandlestickChartProps {
  data: PlotlyCandlePoint[];
  title?: string;
  height?: number;
  showIndexLine?: boolean;
  showEma?: boolean;
  showVolume?: boolean;
  showRsi?: boolean;
  rsiData?: (number | null)[];
  rsiOverbought?: number;
  rsiOversold?: number;
  adxData?: (number | null)[];
  indexLabel?: string;
  markers?: TradeMarker[];
}

interface ChartErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class ChartErrorBoundary extends React.Component<
  { children: React.ReactNode; height: number },
  ChartErrorBoundaryState
> {
  state: ChartErrorBoundaryState = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): ChartErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[PlotlyChart] Render error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: this.props.height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fff3cd',
            border: '1px solid #ffc107',
            borderRadius: 8,
          }}
        >
          <div className="text-center p-3">
            <i className="bi bi-exclamation-triangle text-warning fs-3 d-block mb-2" />
            <strong>Chart failed to render</strong>
            <div className="text-muted small mt-1">{this.state.errorMessage}</div>
            <button
              className="btn btn-sm btn-outline-warning mt-2"
              onClick={() => this.setState({ hasError: false, errorMessage: '' })}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const PlotlyCandlestickChart: React.FC<PlotlyCandlestickChartProps> = ({
  data,
  title,
  height = 500,
  showIndexLine = true,
  showEma = true,
  showVolume = true,
  showRsi = false,
  rsiData,
  rsiOverbought = 70,
  rsiOversold = 30,
  adxData,
  indexLabel = 'Index Close',
  markers,
}) => {
  const hasRsi = showRsi && rsiData && rsiData.some((v) => v != null);
  const hasAdx = showRsi && adxData && adxData.some((v) => v != null);
  const hasVolume = showVolume && (data?.some((d) => (d.volume ?? 0) > 0) ?? false);

  const traces = useMemo(() => {
    if (!data || data.length === 0) return [];
    const times = data.map((d) =>
      d.time instanceof Date ? d.time.toISOString() : d.time
    );
    const opens = data.map((d) => d.open);
    const highs = data.map((d) => d.high);
    const lows = data.map((d) => d.low);
    const closes = data.map((d) => d.close);
    const volumes = data.map((d) => d.volume ?? 0);
    const ema5 = data.map((d) => (d.ema5 != null ? d.ema5 : null));
    const indexCloses = data.map((d) =>
      d.indexClose != null && !Number.isNaN(d.indexClose) ? d.indexClose : null
    );

    const out: any[] = [
      {
        x: times,
        open: opens,
        high: highs,
        low: lows,
        close: closes,
        type: 'candlestick',
        name: 'Price',
        yaxis: 'y',
      },
    ];

    if (showEma && ema5.some((v) => v != null)) {
      out.push({
      x: times,
      y: ema5,
      type: 'scatter',
      mode: 'lines',
      name: 'EMA 5',
      line: { color: '#ffc107', width: 2 },
      yaxis: 'y',
      connectgaps: false,
    });
  }

  if (showIndexLine && indexCloses.some((v) => v != null)) {
    out.push({
      x: times,
      y: indexCloses,
      type: 'scatter',
      mode: 'lines',
      name: indexLabel,
      line: { color: '#9333ea', width: 2, dash: 'dot' },
      yaxis: 'y',
      connectgaps: true,
    });
  }

  if (showVolume && volumes.some((v) => v > 0)) {
    out.push({
      x: times,
      y: volumes,
      type: 'bar',
      name: 'Volume',
      marker: { color: '#8884d8' },
      yaxis: 'y2',
      opacity: 0.4,
    });
  }

  if (hasRsi && rsiData) {
    // Ensure RSI length matches times (chartData) to prevent misaligned traces
    const alignedRsi = times.map((_, i) => rsiData[i] ?? null);
    out.push({
      x: times,
      y: alignedRsi,
      type: 'scatter',
      mode: 'lines',
      name: 'RSI 14',
      line: { color: '#0d9488', width: 1.5 },
      yaxis: 'y3',
      connectgaps: false,
    });
    out.push({
      x: [times[0], times[times.length - 1]],
      y: [rsiOverbought, rsiOverbought],
      type: 'scatter',
      mode: 'lines',
      name: `Overbought (${rsiOverbought})`,
      line: { color: '#dc3545', width: 1, dash: 'dash' },
      yaxis: 'y3',
      showlegend: true,
    });
    out.push({
      x: [times[0], times[times.length - 1]],
      y: [rsiOversold, rsiOversold],
      type: 'scatter',
      mode: 'lines',
      name: `Oversold (${rsiOversold})`,
      line: { color: '#198754', width: 1, dash: 'dash' },
      yaxis: 'y3',
      showlegend: true,
    });
  }

  if (hasAdx && adxData) {
    const alignedAdx = times.map((_, i) => adxData[i] ?? null);
    out.push({
      x: times,
      y: alignedAdx,
      type: 'scatter',
      mode: 'lines',
      name: 'ADX 14',
      line: { color: '#9333ea', width: 1.5 },
      yaxis: 'y3',
      connectgaps: false,
    });
  }

  if (markers && markers.length > 0) {
    const buyMarkers = markers.filter((m) => m.action === 'entry');
    const sellMarkers = markers.filter((m) => m.action === 'exit');
    const signalMarkers = markers.filter((m) => m.action === 'signal');

    if (buyMarkers.length > 0) {
      out.push({
        x: buyMarkers.map((m) => m.time),
        y: buyMarkers.map((m) => m.price),
        type: 'scatter',
        mode: 'markers',
        name: 'Entry',
        marker: {
          symbol: 'star',
          size: 14,
          color: '#198754',
          line: { width: 1, color: '#fff' },
        },
        text: buyMarkers.map(
          (m) => `${m.direction.toUpperCase()} entry @ ${m.price.toFixed(2)}`,
        ),
        hoverinfo: 'text+x',
        yaxis: 'y',
      });
    }

    if (sellMarkers.length > 0) {
      out.push({
        x: sellMarkers.map((m) => m.time),
        y: sellMarkers.map((m) => m.price),
        type: 'scatter',
        mode: 'markers',
        name: 'Exit',
        marker: {
          symbol: 'star',
          size: 14,
          color: '#dc3545',
          line: { width: 1, color: '#fff' },
        },
        text: sellMarkers.map(
          (m) =>
            `${m.direction.toUpperCase()} exit @ ${m.price.toFixed(2)}${m.label ? ' | ' + m.label : ''}`,
        ),
        hoverinfo: 'text+x',
        yaxis: 'y',
      });
    }

    if (signalMarkers.length > 0) {
      out.push({
        x: signalMarkers.map((m) => m.time),
        y: signalMarkers.map((m) => m.price),
        type: 'scatter',
        mode: 'markers',
        name: 'Signal',
        marker: {
          symbol: 'star',
          size: 14,
          color: '#ff69b4',
          line: { width: 1, color: '#c71585' },
        },
        text: signalMarkers.map(
          (m) => `PE Signal @ ${m.price.toFixed(2)}${m.label ? ' | ' + m.label : ''}`,
        ),
        hoverinfo: 'text+x',
        yaxis: 'y',
      });
    }
  }

  return out;
  }, [data, showEma, showVolume, showRsi, showIndexLine, rsiData, rsiOverbought, rsiOversold, adxData, indexLabel, markers, hasRsi, hasAdx]);

  const chartHeight = hasRsi ? Math.max(height, 620) : height;

  const layout = useMemo(() => {
    let priceDomainBottom = 0;
    if (hasVolume && hasRsi) {
      priceDomainBottom = 0.45;
    } else if (hasRsi) {
      priceDomainBottom = 0.25;
    } else if (hasVolume) {
      priceDomainBottom = 0.25;
    }

    return {
      uirevision: `${data.length}-${hasRsi}-${hasVolume}`,
      title: { text: title || '' },
    height: chartHeight,
    margin: { l: 50, r: 50, t: title ? 40 : 10, b: 40 },
    xaxis: {
      rangeslider: { visible: false },
      type: 'date',
      showgrid: true,
      gridcolor: '#e9ecef',
    },
    yaxis: {
      title: { text: 'Price' },
      domain: [priceDomainBottom, 1],
      autorange: true,
      showgrid: true,
      gridcolor: '#e9ecef',
    },
    ...(hasVolume && {
      yaxis2: {
        title: { text: 'Volume' },
        domain: hasRsi ? [0, 0.12] : [0, 0.2],
        showgrid: false,
      },
    }),
    ...(hasRsi && {
      yaxis3: {
        title: { text: hasAdx ? 'RSI / ADX' : 'RSI' },
        domain: hasVolume ? [0.15, 0.4] : [0, 0.2],
        range: [0, 100],
        autorange: false,
        showgrid: true,
        gridcolor: '#e9ecef',
        dtick: 10,
      },
    }),
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.02,
    },
    hovermode: 'x unified',
    dragmode: 'zoom',
    showlegend: true,
  };
  }, [data.length, hasRsi, hasAdx, hasVolume, height, title]);

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

  return (
    <ChartErrorBoundary height={chartHeight}>
      <Plot
        key={`chart-${hasRsi}-${hasVolume}`}
        data={traces}
        layout={layout}
        style={{ width: '100%', height: chartHeight }}
        config={{
          responsive: true,
          displaylogo: false,
          modeBarButtonsToRemove: ['autoScale2d', 'lasso2d', 'select2d'],
        }}
      />
    </ChartErrorBoundary>
  );
};

export default PlotlyCandlestickChart;
