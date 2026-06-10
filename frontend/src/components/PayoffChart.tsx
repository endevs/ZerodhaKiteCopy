import React, { useEffect, useMemo, useState } from 'react';
import { Plot } from '../lib/plotly-finance';
import { ChainRow } from './OptionChainTable';
import {
  buildPayoffGroups,
  computePayoffCurve,
  getWideSpotHalfRange,
  IndexUnderlying,
  interpolatePayoffAtSpot,
  ParsedLeg,
  PAYOFF_SPOT_HALF_RANGE,
  PayoffZoomPreset,
  PositionInput,
  resolvePayoffHalfRange,
  splitPayoffBySign,
} from '../lib/payoffDiagram';
import { buildOiOverlay, chainHasOiData, totalOiAtSpot } from '../lib/oiOverlay';
import { computeSdLevels, getAtmIv } from '../lib/standardDeviation';
import './PayoffChart.css';

export const fmtPayoffPrice = (v: number) =>
  Number.isFinite(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '–';

export const fmtBreakevenPrice = (v: number) =>
  Number.isFinite(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '–';

export const fmtPayoffPnl = (v: number) => {
  if (!Number.isFinite(v)) return '–';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

export interface PayoffChartProps {
  legs?: ParsedLeg[];
  positions?: PositionInput[];
  underlying: IndexUnderlying;
  spot?: number;
  title?: string;
  legCount?: number;
  showDisclaimer?: boolean;
  className?: string;
  enhanced?: boolean;
  chain?: ChainRow[];
  atmStrike?: number | null;
  expiryDate?: string;
  tradingDate?: string;
}

const PayoffChart: React.FC<PayoffChartProps> = ({
  legs: legsProp,
  positions,
  underlying,
  spot,
  title,
  legCount,
  showDisclaimer = false,
  className = '',
  enhanced = false,
  chain = [],
  atmStrike = null,
  expiryDate,
  tradingDate,
}) => {
  const oiAvailable = useMemo(() => chainHasOiData(chain), [chain]);
  const atmIv = useMemo(() => getAtmIv(chain, atmStrike), [chain, atmStrike]);
  const sdAvailable = useMemo(() => {
    if (!enhanced || spot == null || !Number.isFinite(spot) || atmIv == null) return false;
    if (!expiryDate || !tradingDate) return false;
    return computeSdLevels(spot, atmIv, expiryDate, tradingDate) != null;
  }, [enhanced, spot, atmIv, expiryDate, tradingDate]);

  const [showOi, setShowOi] = useState(true);
  const [showSd, setShowSd] = useState(true);
  const [zoomPreset, setZoomPreset] = useState<PayoffZoomPreset>('default');
  const [customHalfRange, setCustomHalfRange] = useState<number | null>(null);

  const parsedLegs = useMemo(() => {
    if (legsProp && legsProp.length > 0) return legsProp;
    if (positions && positions.length > 0) {
      const groups = buildPayoffGroups(positions);
      const group = groups.find((g) => g.underlying === underlying);
      return group?.legs ?? [];
    }
    return [];
  }, [legsProp, positions, underlying]);

  const legsZoomKey = useMemo(
    () => parsedLegs.map((l) => `${l.tradingsymbol}:${l.quantity}:${l.entryPrice}`).join('|'),
    [parsedLegs]
  );

  useEffect(() => {
    setZoomPreset('default');
    setCustomHalfRange(null);
  }, [underlying, spot, legsZoomKey]);

  const defaultHalfRange = PAYOFF_SPOT_HALF_RANGE[underlying].default;
  const wideHalfRange = PAYOFF_SPOT_HALF_RANGE[underlying].wide;

  const maxWideHalfRange = useMemo(
    () => (parsedLegs.length > 0 ? getWideSpotHalfRange(parsedLegs, spot) : defaultHalfRange),
    [parsedLegs, spot, defaultHalfRange]
  );

  const effectiveHalfRange = useMemo(
    () => resolvePayoffHalfRange(underlying, zoomPreset, customHalfRange),
    [underlying, zoomPreset, customHalfRange]
  );

  const curve = useMemo(
    () =>
      parsedLegs.length > 0
        ? computePayoffCurve(parsedLegs, spot, 200, effectiveHalfRange)
        : null,
    [parsedLegs, spot, effectiveHalfRange]
  );

  const presetLabel = useMemo(() => {
    if (zoomPreset === 'full') return 'Full';
    if (customHalfRange != null) return 'Custom';
    return zoomPreset === 'wide' ? 'Wide' : 'Default';
  }, [zoomPreset, customHalfRange]);

  const activeHalfRangeDisplay = useMemo(() => {
    if (zoomPreset === 'full') return null;
    return effectiveHalfRange ?? defaultHalfRange;
  }, [zoomPreset, effectiveHalfRange, defaultHalfRange]);

  const canZoomIn =
    zoomPreset !== 'full' &&
    activeHalfRangeDisplay != null &&
    activeHalfRangeDisplay > defaultHalfRange + 1;

  const canZoomOut =
    zoomPreset !== 'full' &&
    activeHalfRangeDisplay != null &&
    activeHalfRangeDisplay < maxWideHalfRange - 1;

  const handleZoomIn = () => {
    if (!canZoomIn || activeHalfRangeDisplay == null) return;
    setCustomHalfRange(Math.max(defaultHalfRange, activeHalfRangeDisplay * 0.8));
  };

  const handleZoomOut = () => {
    if (!canZoomOut || activeHalfRangeDisplay == null) return;
    setCustomHalfRange(Math.min(maxWideHalfRange, activeHalfRangeDisplay * 1.25));
  };

  const handlePresetSelect = (preset: PayoffZoomPreset) => {
    setZoomPreset(preset);
    setCustomHalfRange(null);
  };

  const handleZoomReset = () => {
    setZoomPreset('default');
    setCustomHalfRange(null);
  };

  const sdLevels = useMemo(() => {
    if (!enhanced || spot == null || atmIv == null || !expiryDate || !tradingDate) return null;
    return computeSdLevels(spot, atmIv, expiryDate, tradingDate);
  }, [enhanced, spot, atmIv, expiryDate, tradingDate]);

  const oiOverlay = useMemo(() => {
    if (!enhanced || !curve || !chain.length) return [];
    return buildOiOverlay(chain, curve.spotMin, curve.spotMax);
  }, [enhanced, curve, chain]);

  const oiTotals = useMemo(() => {
    if (!enhanced || spot == null) return null;
    return totalOiAtSpot(chain, spot);
  }, [enhanced, chain, spot]);

  const projectedPnl = useMemo(() => {
    if (!curve || spot == null || !Number.isFinite(spot)) return null;
    return interpolatePayoffAtSpot(curve.points, spot);
  }, [curve, spot]);

  const chartData = useMemo(() => {
    if (!curve) return null;

    const traces: Record<string, unknown>[] = [];

    if (enhanced) {
      const split = splitPayoffBySign(curve.points);
      traces.push(
        {
          type: 'scatter',
          mode: 'lines',
          x: split.x,
          y: split.profitY,
          name: 'On Expiry',
          line: { color: '#28a745', width: 2.5 },
          fill: 'tozeroy',
          fillcolor: 'rgba(40, 167, 69, 0.18)',
          hovertemplate: 'Spot: %{x:.0f}<br>P&L: %{y:.2f}<extra>On Expiry</extra>',
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: split.x,
          y: split.lossY,
          name: 'On Expiry (loss)',
          line: { color: '#dc3545', width: 2.5 },
          fill: 'tozeroy',
          fillcolor: 'rgba(220, 53, 69, 0.15)',
          showlegend: false,
          hovertemplate: 'Spot: %{x:.0f}<br>P&L: %{y:.2f}<extra>On Expiry</extra>',
        }
      );

      if (showOi && oiOverlay.length > 0) {
        traces.push(
          {
            type: 'bar',
            x: oiOverlay.map((p) => p.strike),
            y: oiOverlay.map((p) => p.callOi),
            name: 'Call OI',
            yaxis: 'y2',
            marker: { color: 'rgba(220, 53, 69, 0.55)' },
            hovertemplate: 'Strike: %{x}<br>Call OI: %{y:.2f}L<extra></extra>',
          },
          {
            type: 'bar',
            x: oiOverlay.map((p) => p.strike),
            y: oiOverlay.map((p) => -p.putOi),
            name: 'Put OI',
            yaxis: 'y2',
            marker: { color: 'rgba(40, 167, 69, 0.55)' },
            hovertemplate: 'Strike: %{x}<br>Put OI: %{y:.2f}L<extra></extra>',
          }
        );
      }
    } else {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: curve.points.map((p) => p.spot),
        y: curve.points.map((p) => p.pnl),
        name: 'P&L at expiry',
        line: { color: '#0d6efd', width: 2 },
        fill: 'tozeroy',
        fillcolor: 'rgba(13, 110, 253, 0.08)',
      });
    }

    if (spot != null && Number.isFinite(spot)) {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: [spot, spot],
        y: [curve.maxLoss, curve.maxProfit],
        name: 'Spot',
        line: { color: '#fd7e14', width: 2, dash: 'dash' },
        hoverinfo: 'skip',
      });
    }

    return traces;
  }, [curve, spot, enhanced, showOi, oiOverlay]);

  const layout = useMemo(() => {
    if (!curve) return {};

    const shapes: Record<string, unknown>[] = [];
    const annotations: Record<string, unknown>[] = [];

    if (enhanced && showSd && sdLevels) {
      for (const level of sdLevels.levels) {
        if (level.price < curve.spotMin || level.price > curve.spotMax) continue;
        shapes.push({
          type: 'line',
          x0: level.price,
          x1: level.price,
          y0: 0,
          y1: 1,
          yref: 'paper',
          line: { color: '#adb5bd', width: 1, dash: 'dot' },
        });
        annotations.push({
          x: level.price,
          y: 1.02,
          yref: 'paper',
          text: level.label,
          showarrow: false,
          font: { size: 10, color: '#6c757d' },
          xanchor: 'center',
        });
      }
    }

    if (spot != null && Number.isFinite(spot) && projectedPnl != null) {
      const pct =
        projectedPnl !== 0 && Math.abs(projectedPnl) > 0
          ? ((projectedPnl / Math.max(Math.abs(curve.maxProfit), Math.abs(curve.maxLoss), 1)) * 100)
          : 0;
      const label =
        projectedPnl >= 0
          ? `Projected profit: ${fmtPayoffPnl(projectedPnl)}`
          : `Projected loss: ${fmtPayoffPnl(projectedPnl)} (${pct.toFixed(2)}%)`;

      annotations.push({
        x: spot,
        y: projectedPnl,
        text: label,
        showarrow: true,
        arrowhead: 2,
        arrowsize: 0.8,
        arrowcolor: projectedPnl >= 0 ? '#28a745' : '#dc3545',
        ax: 40,
        ay: projectedPnl >= 0 ? -40 : 40,
        bgcolor: 'rgba(255,255,255,0.92)',
        bordercolor: projectedPnl >= 0 ? '#28a745' : '#dc3545',
        borderwidth: 1,
        font: { size: 11, color: projectedPnl >= 0 ? '#28a745' : '#dc3545' },
      });

      annotations.push({
        x: spot,
        y: 1.06,
        yref: 'paper',
        text: fmtPayoffPrice(spot),
        showarrow: false,
        font: { size: 11, color: '#fd7e14', weight: 600 },
        xanchor: 'center',
      });
    }

    const baseLayout: Record<string, unknown> = {
      title: title ?? `${underlying} — Payoff at Expiry`,
      xaxis: {
        title: `${underlying} Price`,
        tickformat: ',.0f',
        range: [curve.spotMin, curve.spotMax],
        fixedrange: false,
        zeroline: false,
        gridcolor: '#eef0f2',
      },
      yaxis: {
        title: enhanced ? 'Profit/Loss (₹)' : 'P&L (₹)',
        tickformat: ',.0f',
        zeroline: true,
        zerolinecolor: '#adb5bd',
        zerolinewidth: 1,
        gridcolor: '#eef0f2',
      },
      margin: { l: 64, r: enhanced && showOi && oiOverlay.length > 0 ? 72 : 32, t: 56, b: 48 },
      hovermode: 'x unified' as const,
      showlegend: enhanced,
      legend: { orientation: 'h' as const, y: 1.14, x: 0 },
      height: enhanced ? 480 : 420,
      shapes,
      annotations,
      plot_bgcolor: '#fafbfc',
      paper_bgcolor: '#ffffff',
    };

    if (enhanced && showOi && oiOverlay.length > 0) {
      const maxOi = Math.max(
        ...oiOverlay.map((p) => Math.max(p.callOi, p.putOi)),
        1
      );
      baseLayout.yaxis2 = {
        title: 'Open Interest (L)',
        overlaying: 'y',
        side: 'right',
        showgrid: false,
        range: [-maxOi * 1.25, maxOi * 1.25],
        tickformat: ',.1f',
      };
      baseLayout.barmode = 'overlay';
    }

    return baseLayout;
  }, [
    curve,
    underlying,
    title,
    enhanced,
    showSd,
    sdLevels,
    showOi,
    oiOverlay,
    spot,
    projectedPnl,
  ]);

  if (!curve || !chartData) {
    return (
      <div className={`card border-0 shadow-sm payoff-chart-card ${className}`}>
        <div className="card-body p-4 text-muted">
          No legs to chart. Add options from the chain or apply a preset strategy.
        </div>
      </div>
    );
  }

  const displayLegCount = legCount ?? parsedLegs.length;

  const zoomControls = (
    <div className="payoff-zoom-controls">
      <div className="btn-group btn-group-sm" role="group" aria-label="Payoff chart zoom">
        <button
          type="button"
          className="btn btn-outline-secondary"
          title="Zoom in (narrower range)"
          disabled={!canZoomIn}
          onClick={handleZoomIn}
        >
          <i className="bi bi-zoom-in" />
        </button>
        <div className="btn-group btn-group-sm">
          <button
            type="button"
            className="btn btn-outline-secondary dropdown-toggle"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            {presetLabel}
          </button>
          <ul className="dropdown-menu dropdown-menu-sm">
            <li>
              <button
                type="button"
                className={`dropdown-item small${zoomPreset === 'default' && customHalfRange == null ? ' active' : ''}`}
                onClick={() => handlePresetSelect('default')}
              >
                Default (±{defaultHalfRange.toLocaleString('en-IN')})
              </button>
            </li>
            <li>
              <button
                type="button"
                className={`dropdown-item small${zoomPreset === 'wide' && customHalfRange == null ? ' active' : ''}`}
                onClick={() => handlePresetSelect('wide')}
              >
                Wide (±{wideHalfRange.toLocaleString('en-IN')})
              </button>
            </li>
            <li>
              <button
                type="button"
                className={`dropdown-item small${zoomPreset === 'full' ? ' active' : ''}`}
                onClick={() => handlePresetSelect('full')}
              >
                Full
              </button>
            </li>
          </ul>
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary"
          title="Zoom out (wider range)"
          disabled={!canZoomOut}
          onClick={handleZoomOut}
        >
          <i className="bi bi-zoom-out" />
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          title="Reset zoom to default"
          onClick={handleZoomReset}
        >
          <i className="bi bi-arrow-counterclockwise" />
        </button>
      </div>
      <span className="payoff-zoom-range-label text-muted small">
        Range: {fmtPayoffPrice(curve.spotMin)} – {fmtPayoffPrice(curve.spotMax)}
        {activeHalfRangeDisplay != null
          ? ` (±${activeHalfRangeDisplay.toLocaleString('en-IN', { maximumFractionDigits: 0 })})`
          : ''}
      </span>
    </div>
  );

  return (
    <div className={`payoff-chart-wrap ${className}`}>
      {showDisclaimer && (
        <div className="alert alert-info py-2 small mb-3">
          <i className="bi bi-info-circle me-2" />
          At-expiry P&amp;L; premiums from chain LTP at time of add.
        </div>
      )}
      <div className="card mb-3 border-0 shadow-sm payoff-chart-card">
        <div className="payoff-chart-toolbar">
          {enhanced && (
            <div className="payoff-oi-legend">
              {spot != null && (
                <span className="payoff-oi-legend-item">
                  <span className="payoff-oi-label">OI data at</span>{' '}
                  <strong>{Math.round(spot)}</strong>
                </span>
              )}
              {oiTotals?.hasData && (
                <>
                  <span className="payoff-oi-legend-item payoff-oi-call">
                    <span className="payoff-oi-label">Call OI</span>{' '}
                    <strong>{oiTotals.callCr.toFixed(2)}Cr</strong>
                  </span>
                  <span className="payoff-oi-legend-item payoff-oi-put">
                    <span className="payoff-oi-label">Put OI</span>{' '}
                    <strong>{oiTotals.putCr.toFixed(2)}Cr</strong>
                  </span>
                </>
              )}
              {sdLevels && (
                <span className="payoff-oi-legend-item text-muted">
                  IV {sdLevels.iv.toFixed(1)}% · {sdLevels.daysToExpiry}d · 1σ ±{Math.round(sdLevels.oneSigma)}
                </span>
              )}
            </div>
          )}
          {zoomControls}
          {enhanced && (
            <div className="payoff-chart-toggles">
              <div className="form-check form-switch form-check-inline mb-0">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id={`payoff-toggle-oi-${underlying}`}
                  checked={showOi}
                  disabled={!oiAvailable}
                  onChange={(e) => setShowOi(e.target.checked)}
                />
                <label className="form-check-label small" htmlFor={`payoff-toggle-oi-${underlying}`}>
                  Open Interest
                </label>
              </div>
              <div className="form-check form-switch form-check-inline mb-0">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id={`payoff-toggle-sd-${underlying}`}
                  checked={showSd}
                  disabled={!sdAvailable}
                  onChange={(e) => setShowSd(e.target.checked)}
                />
                <label className="form-check-label small" htmlFor={`payoff-toggle-sd-${underlying}`}>
                  SD Lines
                </label>
              </div>
            </div>
          )}
        </div>
        <div className="card-body pt-2">
          <Plot
            data={chartData}
            layout={layout}
            config={{ responsive: true, displayModeBar: false }}
            style={{ width: '100%' }}
          />
          <div className="row g-2 mt-2 small text-muted payoff-stats-row">
            <div className="col-md-3">
              <strong>Breakeven:</strong>{' '}
              {curve.breakevens.length
                ? curve.breakevens.map((b) => fmtBreakevenPrice(b)).join(', ')
                : '–'}
            </div>
            <div className="col-md-3">
              <strong>Max profit (range):</strong>{' '}
              <span className="text-success">{fmtPayoffPnl(curve.maxProfit)}</span>
            </div>
            <div className="col-md-3">
              <strong>Max loss (range):</strong>{' '}
              <span className="text-danger">{fmtPayoffPnl(curve.maxLoss)}</span>
            </div>
            <div className="col-md-3">
              <strong>Legs:</strong> {displayLegCount}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PayoffChart;
