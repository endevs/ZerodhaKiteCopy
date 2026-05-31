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

export interface PredictionOverlay {
  name: string;
  x: (string | Date)[];
  y: number[];
  color: string;
  /** Secondary axis for constituent stocks (absolute price, not index scale). */
  yaxis?: 'y' | 'y4';
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
  predictionOverlays?: PredictionOverlay[];
}

interface ChartErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

const toPlotTime = (t: Date | string): string =>
  t instanceof Date ? t.toISOString() : t;

const plotTimeMs = (t: Date | string): number => {
  const ms = new Date(toPlotTime(t)).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

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
  predictionOverlays,
}) => {
  const hasRsi = showRsi && rsiData && rsiData.some((v) => v != null);
  const hasAdx = showRsi && adxData && adxData.some((v) => v != null);
  const hasVolume = showVolume && (data?.some((d) => (d.volume ?? 0) > 0) ?? false);
  const hasY4Overlay = predictionOverlays?.some((o) => o.yaxis === 'y4') ?? false;

  const traces = useMemo(() => {
    if (!data || data.length === 0) return [];
    const times = data.map((d) => toPlotTime(d.time));
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

    if (predictionOverlays && predictionOverlays.length > 0) {
      for (const overlay of predictionOverlays) {
        const x = overlay.x.map((v) => toPlotTime(v));
        if (x.length > 0 && overlay.y.length === x.length) {
          const onConstituentAxis = overlay.yaxis === 'y4';
          const trace: Record<string, unknown> = {
            x,
            y: overlay.y,
            type: 'scatter',
            mode: onConstituentAxis ? 'lines' : 'lines+markers',
            name: overlay.name,
            line: { color: overlay.color, width: 1.5 },
            yaxis: onConstituentAxis ? 'y4' : 'y',
            connectgaps: false,
          };
          if (!onConstituentAxis) {
            trace.marker = { size: 5 };
          }
          out.push(trace);
        }
      }
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
        x: times,
        y: times.map(() => rsiOverbought),
        type: 'scatter',
        mode: 'lines',
        name: `Overbought (${rsiOverbought})`,
        line: { color: '#dc3545', width: 1, dash: 'dash' },
        yaxis: 'y3',
        showlegend: true,
        hoverinfo: 'skip',
      });
      out.push({
        x: times,
        y: times.map(() => rsiOversold),
        type: 'scatter',
        mode: 'lines',
        name: `Oversold (${rsiOversold})`,
        line: { color: '#198754', width: 1, dash: 'dash' },
        yaxis: 'y3',
        showlegend: true,
        hoverinfo: 'skip',
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
  }, [data, showEma, showVolume, showRsi, showIndexLine, rsiData, rsiOverbought, rsiOversold, adxData, indexLabel, markers, predictionOverlays, hasRsi, hasAdx]);

  const chartHeight = hasRsi ? Math.max(height, 620) : height;

  const xRange = useMemo(() => {
    if (!data || data.length === 0) return undefined;
    // Keep axis bounds in the same string format as candle times (naive IST).
    // Do NOT use Date.toISOString() — Plotly treats naive strings as UTC wall-clock;
    // mixing UTC Z bounds with naive candle x values hides most of the session.
    const minTime = toPlotTime(data[0].time);
    let maxTime = toPlotTime(data[data.length - 1].time);
    let maxMs = plotTimeMs(maxTime);

    if (predictionOverlays?.length) {
      for (const overlay of predictionOverlays) {
        for (const x of overlay.x) {
          const ms = plotTimeMs(x);
          if (ms > maxMs) {
            maxMs = ms;
            maxTime = toPlotTime(x);
          }
        }
      }
    }
    return [minTime, maxTime] as [string, string];
  }, [data, predictionOverlays]);

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
      uirevision: `${data.length}-${hasRsi}-${hasVolume}-${hasY4Overlay}`,
      title: { text: title || '' },
      height: chartHeight,
      margin: { l: 50, r: hasY4Overlay ? 72 : 50, t: title ? 40 : 10, b: 40 },
      xaxis: {
        rangeslider: { visible: false },
        type: 'date',
        range: xRange,
        tickformat: '%H:%M',
        showgrid: true,
        gridcolor: '#e9ecef',
      },
      yaxis: {
        title: { text: 'Index price' },
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
      ...(hasY4Overlay && {
        yaxis4: {
          title: { text: 'Constituents' },
          overlaying: 'y',
          side: 'right',
          autorange: true,
          showgrid: false,
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
  }, [data.length, hasRsi, hasAdx, hasVolume, hasY4Overlay, height, title, chartHeight, xRange]);

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
        key={`chart-${hasRsi}-${hasVolume}-${hasY4Overlay}`}
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
