import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiUrl } from '../config/api';

type PositionTab = 'positions' | 'orders' | 'holdings';

interface ZerodhaPosition {
  tradingsymbol?: string;
  quantity?: number;
  buy_price?: number;
  last_price?: number;
  pnl?: number;
  product?: string;
  exchange?: string;
}

interface ZerodhaOrder {
  order_id?: string;
  tradingsymbol?: string;
  transaction_type?: string;
  quantity?: number;
  filled_quantity?: number;
  status?: string;
  average_price?: number;
  product?: string;
  order_timestamp?: string;
}

interface ZerodhaHolding {
  tradingsymbol?: string;
  exchange?: string;
  isin?: string;
  quantity?: number;
  last_price?: number;
  average_price?: number;
  pnl?: number;
  product?: string;
  collateral_quantity?: number;
}

const PositionContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState<PositionTab>('positions');
  const [positions, setPositions] = useState<ZerodhaPosition[]>([]);
  const [orders, setOrders] = useState<ZerodhaOrder[]>([]);
  const [holdings, setHoldings] = useState<ZerodhaHolding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [needsCredentials, setNeedsCredentials] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    setAuthExpired(false);
    setNeedsCredentials(false);

    try {
      const [posRes, ordRes, holdRes] = await Promise.all([
        fetch(apiUrl('/api/zerodha/positions'), { credentials: 'include' }),
        fetch(apiUrl('/api/zerodha/orders'), { credentials: 'include' }),
        fetch(apiUrl('/api/zerodha/holdings'), { credentials: 'include' }),
      ]);

      const posData = await posRes.json();
      const ordData = await ordRes.json();
      const holdData = await holdRes.json();

      if (posData.authExpired || ordData.authExpired || holdData.authExpired) {
        setAuthExpired(true);
        setError('Zerodha session expired. Please log in with Zerodha again from the welcome page.');
        return;
      }

      if (posData.needsCredentials || ordData.needsCredentials || holdData.needsCredentials) {
        setNeedsCredentials(true);
        setError('Add your Zerodha API credentials to view positions, orders, and holdings.');
        return;
      }

      const errors: string[] = [];
      if (posData.status === 'success' && Array.isArray(posData.positions)) {
        setPositions(posData.positions);
      } else if (posData.message) {
        errors.push(posData.message);
      }

      if (ordData.status === 'success' && Array.isArray(ordData.orders)) {
        setOrders(ordData.orders);
      } else if (ordData.message) {
        errors.push(ordData.message);
      }

      if (holdData.status === 'success' && Array.isArray(holdData.holdings)) {
        setHoldings(holdData.holdings);
      } else if (holdData.message) {
        errors.push(holdData.message);
      }

      if (errors.length > 0 && !posData.positions && !ordData.orders && !holdData.holdings) {
        setError(errors[0]);
      }

      setLastUpdated(new Date().toLocaleTimeString('en-IN', { hour12: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load portfolio data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(() => fetchAll(true), 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const openPositions = positions.filter(
    (p) => p.quantity != null && Number(p.quantity) !== 0
  );

  const fmtPrice = (v: unknown) =>
    v != null && !Number.isNaN(Number(v)) ? Number(v).toFixed(2) : '–';

  const fmtPnl = (v: unknown) => {
    if (v == null || Number.isNaN(Number(v))) return '–';
    const n = Number(v);
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
  };

  const pnlClass = (v: unknown) => {
    if (v == null || Number.isNaN(Number(v))) return '';
    return Number(v) >= 0 ? 'text-success' : 'text-danger';
  };

  return (
    <div className="container-fluid py-4">
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-4">
        <div>
          <h2 className="mb-1">Position</h2>
          <p className="text-muted mb-0 small">
            Zerodha positions, orders, and holdings
            {lastUpdated && (
              <span className="ms-2">· Updated {lastUpdated}</span>
            )}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => fetchAll()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {needsCredentials && (
        <div className="alert alert-warning">
          <i className="bi bi-key me-2" />
          Add your Zerodha API credentials on the Welcome page to view your portfolio.
          {' '}
          <Link to="/welcome" className="alert-link">
            Set up API credentials
          </Link>
        </div>
      )}

      {authExpired && (
        <div className="alert alert-warning">
          <i className="bi bi-exclamation-triangle me-2" />
          {error}
        </div>
      )}

      {error && !authExpired && !needsCredentials && (
        <div className="alert alert-danger py-2 small">{error}</div>
      )}

      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === 'positions' ? 'active' : ''}`}
            onClick={() => setActiveTab('positions')}
          >
            Positions
            {openPositions.length > 0 && (
              <span className="badge bg-primary ms-2">{openPositions.length}</span>
            )}
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === 'orders' ? 'active' : ''}`}
            onClick={() => setActiveTab('orders')}
          >
            Orders
            {orders.length > 0 && (
              <span className="badge bg-secondary ms-2">{orders.length}</span>
            )}
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link ${activeTab === 'holdings' ? 'active' : ''}`}
            onClick={() => setActiveTab('holdings')}
          >
            Holdings
            {holdings.length > 0 && (
              <span className="badge bg-secondary ms-2">{holdings.length}</span>
            )}
          </button>
        </li>
      </ul>

      {loading && positions.length === 0 && orders.length === 0 && holdings.length === 0 ? (
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading…</span>
          </div>
        </div>
      ) : (
        <>
          {activeTab === 'positions' && (
            <div className="card border-0 shadow-sm">
              <div className="card-header bg-dark text-white">
                <h6 className="mb-0">
                  <i className="bi bi-briefcase me-2" />
                  Open Positions
                </h6>
              </div>
              <div className="card-body p-0">
                {openPositions.length === 0 ? (
                  <div className="p-4 text-muted">No open positions.</div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm table-hover mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Symbol</th>
                          <th>Qty</th>
                          <th>Buy Price</th>
                          <th>LTP</th>
                          <th>P&amp;L</th>
                          <th>Product</th>
                          <th>Exchange</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openPositions.map((p, idx) => (
                          <tr key={p.tradingsymbol || idx}>
                            <td><code>{p.tradingsymbol}</code></td>
                            <td>{p.quantity}</td>
                            <td>{fmtPrice(p.buy_price)}</td>
                            <td>{fmtPrice(p.last_price)}</td>
                            <td className={pnlClass(p.pnl)}>{fmtPnl(p.pnl)}</td>
                            <td>{p.product ?? '–'}</td>
                            <td>{p.exchange ?? '–'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'orders' && (
            <div className="card border-0 shadow-sm">
              <div className="card-header bg-dark text-white">
                <h6 className="mb-0">
                  <i className="bi bi-list-ul me-2" />
                  Orders
                </h6>
              </div>
              <div className="card-body p-0">
                {orders.length === 0 ? (
                  <div className="p-4 text-muted">No orders found.</div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm table-hover mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Order ID</th>
                          <th>Symbol</th>
                          <th>Type</th>
                          <th>Qty</th>
                          <th>Status</th>
                          <th>Avg Price</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o, idx) => (
                          <tr key={o.order_id || idx}>
                            <td className="small">{o.order_id}</td>
                            <td><code>{o.tradingsymbol}</code></td>
                            <td>{o.transaction_type} {o.product}</td>
                            <td>{o.quantity} / {o.filled_quantity ?? 0}</td>
                            <td>
                              <span
                                className={`badge ${
                                  o.status === 'COMPLETE'
                                    ? 'bg-success'
                                    : o.status === 'REJECTED'
                                      ? 'bg-danger'
                                      : 'bg-secondary'
                                }`}
                              >
                                {o.status}
                              </span>
                            </td>
                            <td>{fmtPrice(o.average_price)}</td>
                            <td className="small">
                              {o.order_timestamp
                                ? new Date(o.order_timestamp).toLocaleString()
                                : '–'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'holdings' && (
            <div className="card border-0 shadow-sm">
              <div className="card-header bg-dark text-white">
                <h6 className="mb-0">
                  <i className="bi bi-wallet2 me-2" />
                  Holdings
                </h6>
              </div>
              <div className="card-body p-0">
                {holdings.length === 0 ? (
                  <div className="p-4 text-muted">No holdings in your demat account.</div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm table-hover mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Symbol</th>
                          <th>Qty</th>
                          <th>Avg Price</th>
                          <th>LTP</th>
                          <th>P&amp;L</th>
                          <th>Product</th>
                          <th>Exchange</th>
                        </tr>
                      </thead>
                      <tbody>
                        {holdings.map((h, idx) => (
                          <tr key={h.tradingsymbol || h.isin || idx}>
                            <td><code>{h.tradingsymbol}</code></td>
                            <td>{h.quantity}</td>
                            <td>{fmtPrice(h.average_price)}</td>
                            <td>{fmtPrice(h.last_price)}</td>
                            <td className={pnlClass(h.pnl)}>{fmtPnl(h.pnl)}</td>
                            <td>{h.product ?? '–'}</td>
                            <td>{h.exchange ?? '–'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PositionContent;
