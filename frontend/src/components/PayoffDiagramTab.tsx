import React, { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import PayoffChart, { fmtPayoffPrice } from './PayoffChart';
import {
  buildPayoffGroups,
  defaultUnderlyingForGroups,
  IndexUnderlying,
  PositionInput,
} from '../lib/payoffDiagram';

export interface PayoffDiagramTabProps {
  positions: PositionInput[];
  spotPrices: { NIFTY?: number; BANKNIFTY?: number };
  defaultUnderlying?: IndexUnderlying;
  loading?: boolean;
  error?: string | null;
  needsCredentials?: boolean;
  authExpired?: boolean;
}

const PayoffDiagramTab: React.FC<PayoffDiagramTabProps> = ({
  positions,
  spotPrices,
  defaultUnderlying,
  loading = false,
  error = null,
  needsCredentials = false,
  authExpired = false,
}) => {
  const groups = useMemo(() => buildPayoffGroups(positions), [positions]);
  const [selectedUnderlying, setSelectedUnderlying] = useState<IndexUnderlying | ''>('');

  useEffect(() => {
    const next = defaultUnderlyingForGroups(groups, defaultUnderlying);
    setSelectedUnderlying(next ?? '');
  }, [groups, defaultUnderlying]);

  const activeGroup = groups.find((g) => g.underlying === selectedUnderlying);
  const spot =
    selectedUnderlying === 'NIFTY'
      ? spotPrices.NIFTY
      : selectedUnderlying === 'BANKNIFTY'
        ? spotPrices.BANKNIFTY
        : undefined;

  if (needsCredentials) {
    return (
      <div className="alert alert-warning">
        <i className="bi bi-key me-2" />
        Add your Zerodha API credentials on the Welcome page to view your open positions and
        payoff diagram.
        {' '}
        <Link to="/welcome" className="alert-link">
          Set up API credentials
        </Link>
      </div>
    );
  }

  if (authExpired) {
    return (
      <div className="alert alert-warning">
        <i className="bi bi-exclamation-triangle me-2" />
        Zerodha session expired. Please log in with Zerodha again from the welcome page.
        {' '}
        <Link to="/welcome" className="alert-link">
          Reconnect Zerodha
        </Link>
      </div>
    );
  }

  if (loading && groups.length === 0) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading positions…</span>
        </div>
        <p className="text-muted mt-2 mb-0 small">Loading open positions…</p>
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-danger py-2 small">{error}</div>;
  }

  if (groups.length === 0) {
    return (
      <div className="card border-0 shadow-sm">
        <div className="card-body p-4 text-muted">
          No open NIFTY or BANKNIFTY F&amp;O positions to chart.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card mb-3 border-0 shadow-sm">
        <div className="card-body">
          <div className="row g-3 align-items-end">
            <div className="col-md-3">
              <label className="form-label">Index</label>
              <select
                className="form-select"
                value={selectedUnderlying}
                onChange={(e) => setSelectedUnderlying(e.target.value as IndexUnderlying)}
              >
                {groups.map((g) => (
                  <option key={g.underlying} value={g.underlying}>
                    {g.underlying} ({g.legs.length} leg{g.legs.length !== 1 ? 's' : ''})
                  </option>
                ))}
              </select>
            </div>
            {spot != null && Number.isFinite(spot) && (
              <div className="col-md-3">
                <label className="form-label text-muted small">Current spot</label>
                <div className="fw-semibold">{fmtPayoffPrice(spot)}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {activeGroup?.hasMixedExpiries && (
        <div className="alert alert-info py-2 small mb-3">
          <i className="bi bi-info-circle me-2" />
          At-expiry view; assumes all legs expire together.
        </div>
      )}

      {activeGroup && activeGroup.legs.length === 0 ? (
        <div className="card border-0 shadow-sm">
          <div className="card-body p-4 text-muted">
            No open {selectedUnderlying} F&amp;O positions.
          </div>
        </div>
      ) : (
        <>
          {selectedUnderlying && activeGroup && (
            <PayoffChart
              legs={activeGroup.legs}
              underlying={selectedUnderlying}
              spot={spot}
            />
          )}

          {activeGroup && (
            <div className="card border-0 shadow-sm">
              <div className="card-header bg-dark text-white">
                <h6 className="mb-0">
                  <i className="bi bi-list-check me-2" />
                  Position legs — {selectedUnderlying}
                </h6>
              </div>
              <div className="card-body p-0">
                <div className="table-responsive">
                  <table className="table table-sm table-hover mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Symbol</th>
                        <th>Type</th>
                        <th>Strike</th>
                        <th>Qty</th>
                        <th>Entry</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeGroup.legs.map((leg) => (
                        <tr key={leg.tradingsymbol}>
                          <td><code>{leg.tradingsymbol}</code></td>
                          <td>
                            {leg.legType === 'future'
                              ? 'Future'
                              : leg.optionType ?? 'Option'}
                          </td>
                          <td>{leg.strike != null ? fmtPayoffPrice(leg.strike) : '–'}</td>
                          <td>{leg.quantity}</td>
                          <td>{fmtPayoffPrice(leg.entryPrice)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeGroup && activeGroup.excludedSymbols.length > 0 && (
            <div className="alert alert-secondary py-2 small mt-3 mb-0">
              <strong>Excluded (non index F&amp;O):</strong>{' '}
              {activeGroup.excludedSymbols.join(', ')}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PayoffDiagramTab;
