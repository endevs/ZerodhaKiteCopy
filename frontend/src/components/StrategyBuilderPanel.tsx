import React, { useMemo, useState } from 'react';
import { ChainRow } from './OptionChainTable';
import {
  StrategyLeg,
  StrategyCategory,
  StrategyPreset,
  AppliedPresetContext,
  STRATEGY_CATEGORIES,
  presetsByCategory,
  resolvePreset,
  netPremiumAtEntry,
  getLotSize,
  getStrikeStep,
  getPresetById,
  deriveStrategyAdjustments,
  applyStrategyAdjustments,
  getAdjustmentControls,
  bumpLegStrike,
  setLegStrike,
  snapToStrikeStep,
} from '../lib/optionStrategies';

export interface StrategyBuilderPanelProps {
  legs: StrategyLeg[];
  onLegsChange: (legs: StrategyLeg[]) => void;
  index: string;
  atmStrike: number | null;
  chain: ChainRow[];
  spot?: number | null;
  defaultLots: number;
  onDefaultLotsChange: (lots: number) => void;
  appliedPreset: AppliedPresetContext | null;
  onAppliedPresetChange: (ctx: AppliedPresetContext | null) => void;
}

const fmtPrice = (v: number) =>
  Number.isFinite(v) ? v.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '–';

interface AdjustmentStepperProps {
  label: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
  allowNegative?: boolean;
}

const AdjustmentStepper: React.FC<AdjustmentStepperProps> = ({
  label,
  value,
  step,
  onChange,
  allowNegative = false,
}) => (
  <div className="d-flex align-items-center gap-1 strategy-adjustment-stepper">
    <span className="small text-muted me-1" style={{ minWidth: '3.5rem' }}>
      {label}
    </span>
    <button
      type="button"
      className="btn btn-sm btn-outline-secondary"
      onClick={() => onChange(allowNegative ? value - step : Math.max(0, value - step))}
      aria-label={`Decrease ${label}`}
    >
      −
    </button>
    <input
      type="number"
      className="form-control form-control-sm text-center"
      style={{ width: '4.5rem' }}
      value={value}
      step={step}
      onChange={(e) => {
        const v = parseInt(e.target.value, 10);
        if (!Number.isFinite(v)) return;
        if (!allowNegative && v < 0) return;
        onChange(v);
      }}
    />
    <button
      type="button"
      className="btn btn-sm btn-outline-secondary"
      onClick={() => onChange(value + step)}
      aria-label={`Increase ${label}`}
    >
      +
    </button>
  </div>
);

const StrategyBuilderPanel: React.FC<StrategyBuilderPanelProps> = ({
  legs,
  onLegsChange,
  index,
  atmStrike,
  chain,
  defaultLots,
  onDefaultLotsChange,
  appliedPreset,
  onAppliedPresetChange,
}) => {
  const [category, setCategory] = useState<StrategyCategory>('bullish');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');

  const categoryPresets = useMemo(() => presetsByCategory(category), [category]);
  const strikeStep = getStrikeStep(index);
  const lotSize = getLotSize(index);
  const netPremium = useMemo(() => netPremiumAtEntry(legs, index), [legs, index]);

  const activePreset = useMemo(
    () => (appliedPreset ? getPresetById(appliedPreset.presetId) : undefined),
    [appliedPreset]
  );

  const adjustmentControls = useMemo(
    () => (activePreset ? getAdjustmentControls(activePreset) : null),
    [activePreset]
  );

  const updateLeg = (id: string, patch: Partial<StrategyLeg>) => {
    onLegsChange(legs.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const syncAdjustmentsFromLegs = (nextLegs: StrategyLeg[]) => {
    if (!appliedPreset) return;
    const derived = deriveStrategyAdjustments(nextLegs, appliedPreset.anchorStrike);
    onAppliedPresetChange({ ...appliedPreset, ...derived });
  };

  const handleLegsChangeWithSync = (nextLegs: StrategyLeg[]) => {
    onLegsChange(nextLegs);
    syncAdjustmentsFromLegs(nextLegs);
  };

  const removeLeg = (id: string) => {
    const next = legs.filter((l) => l.id !== id);
    if (next.length === 0) {
      onAppliedPresetChange(null);
    }
    handleLegsChangeWithSync(next);
  };

  const flipSide = (id: string) => {
    handleLegsChangeWithSync(
      legs.map((l) =>
        l.id === id ? { ...l, side: l.side === 'BUY' ? 'SELL' : 'BUY' } : l
      )
    );
  };

  const handleBumpStrike = (legId: string, deltaSteps: number) => {
    const leg = legs.find((l) => l.id === legId);
    if (!leg) return;
    const updated = bumpLegStrike(leg, deltaSteps, index, chain);
    handleLegsChangeWithSync(legs.map((l) => (l.id === legId ? updated : l)));
  };

  const handleStrikeInput = (legId: string, raw: string) => {
    const leg = legs.find((l) => l.id === legId);
    if (!leg) return;
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v)) return;
    const snapped = snapToStrikeStep(v, strikeStep);
    const updated = setLegStrike(leg, snapped, chain);
    handleLegsChangeWithSync(legs.map((l) => (l.id === legId ? updated : l)));
  };

  const handleAdjustmentChange = (
    field: 'shift' | 'width' | 'hedge',
    value: number
  ) => {
    if (!appliedPreset || !activePreset) return;
    const nextAdjustments = { ...appliedPreset, [field]: value };
    const rebuilt = applyStrategyAdjustments(
      activePreset,
      appliedPreset.anchorStrike,
      nextAdjustments,
      chain,
      index,
      legs
    );
    const derived = deriveStrategyAdjustments(rebuilt, appliedPreset.anchorStrike);
    onAppliedPresetChange({
      presetId: appliedPreset.presetId,
      anchorStrike: appliedPreset.anchorStrike,
      ...derived,
    });
    onLegsChange(rebuilt);
  };

  const handleApplyPreset = () => {
    const preset = categoryPresets.find((p) => p.id === selectedPresetId);
    if (!preset || atmStrike == null) return;

    if (legs.length > 0) {
      const ok = window.confirm(
        `Replace current ${legs.length} leg(s) with "${preset.name}"?`
      );
      if (!ok) return;
    }

    const { legs: resolved, missing } = resolvePreset(preset, chain, atmStrike, index);
    if (resolved.length === 0) {
      alert(
        `Could not build "${preset.name}". Missing contracts: ${missing.join(', ') || 'unknown'}`
      );
      return;
    }
    if (missing.length > 0) {
      alert(
        `Applied "${preset.name}" with ${resolved.length} leg(s). Missing: ${missing.join(', ')}`
      );
    }

    const adjustments = deriveStrategyAdjustments(resolved, atmStrike);
    onAppliedPresetChange({
      presetId: preset.id,
      anchorStrike: atmStrike,
      ...adjustments,
    });
    onLegsChange(resolved);
  };

  const handleCategoryChange = (next: StrategyCategory) => {
    setCategory(next);
    const nextPresets = presetsByCategory(next);
    setSelectedPresetId(nextPresets[0]?.id ?? '');
  };

  const handleClearAll = () => {
    if (legs.length === 0 || window.confirm('Clear all strategy legs?')) {
      onLegsChange([]);
      onAppliedPresetChange(null);
    }
  };

  const legMissingQuote = (leg: StrategyLeg) =>
    !lookupHasQuote(leg, chain);

  return (
    <div className="card mt-4 border-0 shadow-sm">
      <div className="card-header bg-dark text-white d-flex flex-wrap align-items-center gap-2">
        <h6 className="mb-0">
          <i className="bi bi-sliders me-2" />
          Strategy Builder
        </h6>
        {legs.length > 0 && (
          <span className="badge bg-primary ms-auto">
            {activePreset
              ? `${legs.length} leg${legs.length !== 1 ? 's' : ''} — ${activePreset.name}`
              : `${legs.length} leg${legs.length !== 1 ? 's' : ''}`}
          </span>
        )}
      </div>
      <div className="card-body">
        <div className="row g-3 align-items-end mb-3">
          <div className="col-md-2">
            <label className="form-label small mb-1">Default lots</label>
            <input
              type="number"
              className="form-control form-control-sm"
              min={1}
              value={defaultLots}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                onDefaultLotsChange(Number.isFinite(v) && v >= 1 ? v : 1);
              }}
            />
            <small className="text-muted">Used when clicking B/S on chain</small>
          </div>

          <div className="col-md-2">
            <label className="form-label small mb-1">Category</label>
            <select
              className="form-select form-select-sm"
              value={category}
              onChange={(e) => handleCategoryChange(e.target.value as StrategyCategory)}
            >
              {STRATEGY_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-4">
            <label className="form-label small mb-1">Preset strategy</label>
            <select
              className="form-select form-select-sm"
              value={selectedPresetId}
              onChange={(e) => setSelectedPresetId(e.target.value)}
            >
              <option value="">Select strategy…</option>
              {categoryPresets.map((p: StrategyPreset) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {selectedPresetId && (
              <small className="text-muted d-block mt-1">
                {categoryPresets.find((p) => p.id === selectedPresetId)?.description}
              </small>
            )}
          </div>

          <div className="col-md-2">
            <button
              type="button"
              className="btn btn-sm btn-primary w-100"
              disabled={!selectedPresetId || !atmStrike}
              onClick={handleApplyPreset}
            >
              Apply preset
            </button>
          </div>

          <div className="col-md-2">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary w-100"
              disabled={legs.length === 0}
              onClick={handleClearAll}
            >
              Clear all
            </button>
          </div>
        </div>

        {legs.length > 0 && (
          <div className="alert alert-light border py-2 small mb-3 d-flex flex-wrap gap-3">
            <span>
              <strong>Net premium:</strong>{' '}
              <span className={netPremium >= 0 ? 'text-danger' : 'text-success'}>
                {netPremium >= 0 ? 'Debit ' : 'Credit '}
                ₹{fmtPrice(Math.abs(netPremium))}
              </span>
            </span>
            <span className="text-muted">Lot size: {lotSize}</span>
            {atmStrike != null && (
              <span className="text-muted">ATM: {atmStrike}</span>
            )}
          </div>
        )}

        {legs.length === 0 ? (
          <p className="text-muted small mb-0">
            Hover a row on the option chain and click Buy or Sell to add legs, or apply a preset strategy above.
          </p>
        ) : (
          <>
            <div className="table-responsive">
              <table className="table table-sm table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Symbol</th>
                    <th>Type</th>
                    <th>Strike</th>
                    <th>Side</th>
                    <th>Lots</th>
                    <th>Entry (₹)</th>
                    <th>Premium</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {legs.map((leg) => {
                    const premium = leg.lots * leg.entryPrice * lotSize;
                    const missingQuote = legMissingQuote(leg);
                    return (
                      <tr key={leg.id} className={missingQuote ? 'table-warning' : undefined}>
                        <td>
                          <code className="small">{leg.tradingsymbol || '—'}</code>
                          {missingQuote && (
                            <span
                              className="text-warning ms-1"
                              title="No live quote for this strike in the current chain"
                            >
                              <i className="bi bi-exclamation-triangle" />
                            </span>
                          )}
                        </td>
                        <td>{leg.optionType}</td>
                        <td style={{ minWidth: '8.5rem' }}>
                          <div className="d-flex align-items-center gap-1">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary py-0 px-1"
                              onClick={() => handleBumpStrike(leg.id, -1)}
                              aria-label="Decrease strike"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              className="form-control form-control-sm text-center"
                              style={{ width: '4.5rem' }}
                              value={leg.strike}
                              step={strikeStep}
                              onChange={(e) => handleStrikeInput(leg.id, e.target.value)}
                            />
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary py-0 px-1"
                              onClick={() => handleBumpStrike(leg.id, 1)}
                              aria-label="Increase strike"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`badge ${leg.side === 'BUY' ? 'bg-success' : 'bg-danger'}`}
                          >
                            {leg.side}
                          </span>
                        </td>
                        <td style={{ width: 80 }}>
                          <input
                            type="number"
                            className="form-control form-control-sm"
                            min={1}
                            value={leg.lots}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (Number.isFinite(v) && v >= 1) {
                                updateLeg(leg.id, { lots: v });
                              }
                            }}
                          />
                        </td>
                        <td style={{ width: 100 }}>
                          <input
                            type="number"
                            className="form-control form-control-sm"
                            min={0}
                            step={0.05}
                            value={leg.entryPrice}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (Number.isFinite(v) && v >= 0) {
                                updateLeg(leg.id, { entryPrice: v });
                              }
                            }}
                          />
                        </td>
                        <td className={leg.side === 'BUY' ? 'text-danger' : 'text-success'}>
                          {leg.side === 'BUY' ? '-' : '+'}₹{fmtPrice(premium)}
                        </td>
                        <td>
                          <div className="btn-group btn-group-sm">
                            <button
                              type="button"
                              className="btn btn-outline-secondary"
                              title="Flip buy/sell"
                              onClick={() => flipSide(leg.id)}
                            >
                              <i className="bi bi-arrow-left-right" />
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline-danger"
                              title="Remove leg"
                              onClick={() => removeLeg(leg.id)}
                            >
                              <i className="bi bi-trash" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {appliedPreset && adjustmentControls && (
              <div className="d-flex flex-wrap align-items-center gap-3 mt-3 pt-3 border-top strategy-adjustment-row">
                {adjustmentControls.shift && (
                  <AdjustmentStepper
                    label="Shift"
                    value={appliedPreset.shift}
                    step={strikeStep}
                    allowNegative
                    onChange={(v) => handleAdjustmentChange('shift', v)}
                  />
                )}
                {adjustmentControls.width && (
                  <AdjustmentStepper
                    label="Width"
                    value={appliedPreset.width}
                    step={strikeStep}
                    onChange={(v) => handleAdjustmentChange('width', v)}
                  />
                )}
                {adjustmentControls.hedge && (
                  <AdjustmentStepper
                    label="Hedge"
                    value={appliedPreset.hedge}
                    step={strikeStep}
                    onChange={(v) => handleAdjustmentChange('hedge', v)}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

function lookupHasQuote(leg: StrategyLeg, chain: ChainRow[]): boolean {
  const row = chain.find((r) => r.strike === leg.strike);
  if (!row) return false;
  const side = leg.optionType === 'CE' ? row.ce : row.pe;
  return Boolean(side?.tradingsymbol);
}

export default StrategyBuilderPanel;
