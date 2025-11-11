import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface StrategyOption {
  id: number;
  strategy_name: string;
  instrument: string;
  candle_time: string;
}

interface HistoryEntry {
  timestamp?: string;
  level?: string;
  message?: string;
}

interface LiveOrder {
  order_id?: string;
  status?: string;
  tradingsymbol?: string;
  transaction_type?: string;
  quantity?: number;
  filled_quantity?: number;
  pending_quantity?: number;
  price?: number;
  trigger_price?: number;
  average_price?: number;
  exchange?: string;
  product?: string;
  order_type?: string;
  variety?: string;
  order_timestamp?: string;
  exchange_timestamp?: string;
}

interface LivePosition {
  tradingsymbol?: string;
  instrument_token?: number;
  exchange?: string;
  product?: string;
  quantity?: number;
  buy_quantity?: number;
  sell_quantity?: number;
  gross_quantity?: number;
  buy_price?: number;
  sell_price?: number;
  last_price?: number;
  pnl?: number;
  m2m?: number;
}

interface SquareOffResult {
  tradingsymbol?: string;
  quantity?: number;
  status?: string;
  order_id?: string;
  message?: string;
}

interface LiveTradePreview {
  instrument: string;
  optionSymbol: string;
  optionType: string;
  expiryDate: string;
  strike: number;
  spotPrice: number;
  optionLtp: number;
  stopLossPrice: number;
  targetPrice: number;
  lotSize: number;
  lotCount: number;
  totalQuantity: number;
  requiredCapital: number;
  stopLossPercent: number;
  stopLossPercentDisplay: number;
  targetPercent: number;
  targetPercentDisplay: number;
}

interface LiveDeploymentState {
  phase?: string;
  message?: string;
  lastCheck?: string;
  orders?: LiveOrder[];
  positions?: LivePosition[];
  margin?: {
    availableCash?: number;
    snapshot?: Record<string, unknown>;
    requiredCapital?: number;
  };
  livePnl?: number;
  history?: HistoryEntry[];
  squareOff?: SquareOffResult[];
  config?: {
    lotCount?: number;
    lotSize?: number;
    totalQuantity?: number;
    optionSymbol?: string;
    stopLossPercent?: number;
    targetPercent?: number;
    evaluationSecondsBeforeClose?: number;
    candleIntervalMinutes?: number;
  };
  openOrdersCount?: number;
  openPositionsCount?: number;
  lastEvaluationTarget?: string;
}

interface LiveDeployment {
  id: number;
  userId: number;
  strategyId: number | null;
  strategyName: string | null;
  status: string;
  initialInvestment: number;
  scheduledStart: string | null;
  startedAt: string | null;
  lastRunAt: string | null;
  errorMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  state: LiveDeploymentState;
}

const LiveTradeContent: React.FC = () => {
  const [strategies, setStrategies] = useState<StrategyOption[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');
  const [lotCount, setLotCount] = useState<number>(1);
  const [scheduledStart, setScheduledStart] = useState<string>('');
  const [deployment, setDeployment] = useState<LiveDeployment | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [statusLoading, setStatusLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<LiveTradePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [testOrderLoading, setTestOrderLoading] = useState<boolean>(false);

  const formatCurrency = useCallback((value?: number | null, fallback = '—') => {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return fallback;
    }
    return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }, []);

  const formatDateTime = useCallback((value?: string | null) => {
    if (!value) return '—';
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    } catch {
      return value;
    }
  }, []);

  const statusBadgeClass = useMemo(() => {
    if (!deployment) return 'bg-secondary';
    switch (deployment.status) {
      case 'active':
        return 'bg-success';
      case 'scheduled':
        return 'bg-info text-dark';
      case 'paused':
        return 'bg-warning text-dark';
      case 'stopped':
        return 'bg-secondary';
      case 'error':
        return 'bg-danger';
      default:
        return 'bg-secondary';
    }
  }, [deployment]);

  const fetchStrategies = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:8000/api/strategies', { credentials: 'include' });
      const data = await response.json();
      if (response.ok && data.status === 'success') {
        setStrategies(data.strategies || []);
      } else {
        console.warn('Unable to fetch strategies:', data.message || response.statusText);
      }
    } catch (err) {
      console.error('Error fetching strategies:', err);
    }
  }, []);

  const fetchPreview = useCallback(
    async (strategyId: string, lots: number) => {
      if (!strategyId || lots <= 0) {
        setPreview(null);
        return;
      }
      try {
        setPreviewLoading(true);
        const response = await fetch('http://localhost:8000/api/live_trade/preview', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            strategy_id: strategyId,
            lot_count: lots,
          }),
        });
        const data = await response.json();
        if (!response.ok || data.status !== 'success') {
          throw new Error(data.message || 'Unable to compute trade preview');
        }
        setPreview(data.preview as LiveTradePreview);
      } catch (err) {
        console.error('Preview fetch error:', err);
        setPreview(null);
        setError(err instanceof Error ? err.message : 'Unable to compute required capital.');
      } finally {
        setPreviewLoading(false);
      }
    },
    []
  );

  const fetchDeploymentStatus = useCallback(async () => {
    try {
      setStatusLoading(true);
      const response = await fetch('http://localhost:8000/api/live_trade/status', { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch live trade status');
      }
      setDeployment(data.deployment ?? null);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Unable to fetch live trade status');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStrategies();
    fetchDeploymentStatus();
  }, [fetchStrategies, fetchDeploymentStatus]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchDeploymentStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchDeploymentStatus]);

  useEffect(() => {
    if (selectedStrategy) {
      fetchPreview(selectedStrategy, lotCount);
    } else {
      setPreview(null);
    }
  }, [selectedStrategy, lotCount, fetchPreview]);

  const handleDeploy = async () => {
    setError(null);
    setActionMessage(null);

    if (!selectedStrategy) {
      setError('Please select a strategy to deploy.');
      return;
    }
    if (lotCount <= 0) {
      setError('Lot count must be greater than zero.');
      return;
    }
    if (!preview) {
      setError('Unable to compute trade preview. Please try again.');
      return;
    }

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        strategy_id: selectedStrategy,
        lot_count: lotCount,
      };
      if (scheduledStart) {
        const isoString = new Date(scheduledStart).toISOString();
        payload.scheduled_start = isoString;
      }

      const response = await fetch('http://localhost:8000/api/live_trade/deploy', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to deploy strategy.');
      }
      setDeployment(data.deployment ?? null);
      setActionMessage('Strategy deployment initiated successfully.');
    } catch (err) {
      console.error('Deploy error:', err);
      setError(err instanceof Error ? err.message : 'Failed to deploy strategy.');
    } finally {
      setLoading(false);
    }
  };

  const handleTestOrder = async () => {
    if (!selectedStrategy) {
      setError('Select a strategy before placing a test order.');
      return;
    }
    if (!preview) {
      setError('Generate a trade preview before placing a test order.');
      return;
    }

    setTestOrderLoading(true);
    setError(null);
    setActionMessage(null);
    try {
      const response = await fetch('http://localhost:8000/api/live_trade/preview_order', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy_id: selectedStrategy,
          lot_count: lotCount,
          order_type: 'ENTRY',
        }),
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Test order failed.');
      }
      setActionMessage(`Test order placed successfully (Order ID: ${data.order.order_id}).`);
    } catch (err) {
      console.error('Test order error:', err);
      setError(err instanceof Error ? err.message : 'Test order failed.');
    } finally {
      setTestOrderLoading(false);
    }
  };

  const handleSimpleAction = async (endpoint: string, successMessage: string) => {
    setError(null);
    setActionMessage(null);
    setLoading(true);
    try {
      const response = await fetch(`http://localhost:8000${endpoint}`, {
        method: endpoint === '/api/live_trade/delete' ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Action failed.');
      }
      if (endpoint === '/api/live_trade/delete') {
        setDeployment(null);
      } else {
        setDeployment(data.deployment ?? null);
      }
      setActionMessage(successMessage);
    } catch (err) {
      console.error('Live action error:', err);
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSquareOff = async () => {
    setError(null);
    setActionMessage(null);
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/api/live_trade/square_off', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Square-off failed.');
      }
      setDeployment(data.deployment ?? null);
      setActionMessage('Square-off requested. Review order status for confirmation.');
    } catch (err) {
      console.error('Square-off error:', err);
      setError(err instanceof Error ? err.message : 'Square-off failed.');
    } finally {
      setLoading(false);
    }
  };

  const currentPhase = deployment?.state?.phase || 'idle';
  const history = deployment?.state?.history ?? [];
  const orders: LiveOrder[] = Array.isArray(deployment?.state?.orders)
    ? (deployment?.state?.orders as LiveOrder[])
    : [];
  const rawPositions = deployment?.state?.positions;
  const positions: LivePosition[] = Array.isArray(rawPositions)
    ? (rawPositions as LivePosition[])
    : [];
  const openPositionsCount = positions.length || deployment?.state?.openPositionsCount || 0;
  const squareOffResults = Array.isArray(deployment?.state?.squareOff)
    ? (deployment?.state?.squareOff as SquareOffResult[])
    : [];
  const availableCash = deployment?.state?.margin?.availableCash;
  const requiredCapital = preview?.requiredCapital ?? deployment?.state?.margin?.requiredCapital;
  const config = deployment?.state?.config ?? {};
  const stopLossDisplay = preview
    ? preview.stopLossPercentDisplay
    : config.stopLossPercent
      ? Math.abs(config.stopLossPercent) * 100
      : null;
  const targetDisplay = preview
    ? preview.targetPercentDisplay
    : config.targetPercent
      ? Math.abs(config.targetPercent) * 100
      : null;

  return (
    <div className="container-fluid py-3">
      <div className="row g-3">
        <div className="col-lg-4">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-header bg-dark text-white">
              <h5 className="mb-0">
                <i className="bi bi-rocket-takeoff me-2"></i>
                Deploy Live Strategy
              </h5>
            </div>
            <div className="card-body">
              <div className="mb-3">
                <label htmlFor="strategy-select" className="form-label fw-semibold">
                  Strategy
                </label>
                <select
                  id="strategy-select"
                  className="form-select"
                  value={selectedStrategy}
                  onChange={(e) => setSelectedStrategy(e.target.value)}
                >
                  <option value="">Select a strategy</option>
                  {strategies.map((strategy) => (
                    <option key={strategy.id} value={strategy.id}>
                      {strategy.strategy_name} ({strategy.instrument})
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-3">
                <label htmlFor="lot-count-input" className="form-label fw-semibold">
                  Quantity (Lots)
                </label>
                <input
                  id="lot-count-input"
                  type="number"
                  min={1}
                  step={1}
                  className="form-control"
                  value={lotCount}
                  onChange={(e) => setLotCount(Number(e.target.value))}
                />
                <div className="form-text">
                  Lot size depends on the selected strategy (e.g., BankNifty 35 qty per lot).
                </div>
              </div>

              <div className="mb-3">
                <label className="form-label fw-semibold d-flex align-items-center">
                  Trade Preview
                  {previewLoading && (
                    <span className="spinner-border spinner-border-sm ms-2" role="status" />
                  )}
                </label>
                {preview ? (
                  <div className="bg-light rounded p-3 small">
                    <div className="d-flex justify-content-between">
                      <span>Option Symbol</span>
                      <span className="fw-semibold">{preview.optionSymbol}</span>
                    </div>
                    <div className="d-flex justify-content-between">
                      <span>Strike / Expiry</span>
                      <span>{preview.strike} · {new Date(preview.expiryDate).toLocaleDateString()}</span>
                    </div>
                    <div className="d-flex justify-content-between">
                      <span>Option LTP</span>
                      <span>{preview.optionLtp.toFixed(2)}</span>
                    </div>
                    <div className="d-flex justify-content-between">
                      <span>Lot Size x Lots</span>
                      <span>{preview.lotSize} × {preview.lotCount} = {preview.totalQuantity}</span>
                    </div>
                    <div className="d-flex justify-content-between">
                      <span>Required Capital</span>
                      <span className="fw-semibold text-primary">
                        {formatCurrency(preview.requiredCapital)}
                      </span>
                    </div>
                    <div className="d-flex justify-content-between">
                      <span>Stop Loss</span>
                      <span>{preview.stopLossPercentDisplay.toFixed(2)}% (₹{preview.stopLossPrice.toFixed(2)})</span>
                    </div>
                    <div className="d-flex justify-content-between">
                      <span>Target</span>
                      <span>{preview.targetPercentDisplay.toFixed(2)}% (₹{preview.targetPrice.toFixed(2)})</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted small">
                    Select a strategy to view strike, lot size, and capital requirements.
                  </div>
                )}
              </div>

              <div className="mb-3">
                <button
                  className="btn btn-outline-primary w-100"
                  disabled={testOrderLoading || !preview}
                  onClick={handleTestOrder}
                >
                  {testOrderLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" />
                      Placing Test Order...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-lightning-charge me-2"></i>
                      Place Test Order
                    </>
                  )}
                </button>
                <div className="form-text">
                  Sends a market MIS order using the previewed lot size and option symbol.
                </div>
              </div>

              <div className="mb-3">
                <label htmlFor="schedule-input" className="form-label fw-semibold">
                  Schedule Start (optional)
                </label>
                <input
                  id="schedule-input"
                  type="datetime-local"
                  className="form-control"
                  value={scheduledStart}
                  onChange={(e) => setScheduledStart(e.target.value)}
                />
                <div className="form-text">
                  If left blank, deployment starts immediately.
                </div>
              </div>

              <div className="d-grid gap-2">
                <button
                  className="btn btn-primary"
                  disabled={loading}
                  onClick={handleDeploy}
                >
                  {loading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" />
                      Deploying...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-play-circle me-2"></i>
                      Deploy Strategy
                    </>
                  )}
                </button>
              </div>

              <hr />

              <div className="d-grid gap-2">
                <button
                  className="btn btn-outline-warning"
                  disabled={!deployment || loading}
                  onClick={() => handleSimpleAction('/api/live_trade/pause', 'Deployment paused.')}
                >
                  <i className="bi bi-pause-circle me-2"></i>
                  Pause
                </button>
                <button
                  className="btn btn-outline-success"
                  disabled={!deployment || loading}
                  onClick={() => handleSimpleAction('/api/live_trade/resume', 'Deployment resumed.')}
                >
                  <i className="bi bi-play-btn me-2"></i>
                  Resume
                </button>
                <button
                  className="btn btn-outline-danger"
                  disabled={!deployment || loading}
                  onClick={() => handleSimpleAction('/api/live_trade/stop', 'Deployment stopped.')}
                >
                  <i className="bi bi-stop-circle me-2"></i>
                  Stop
                </button>
                <button
                  className="btn btn-outline-secondary"
                  disabled={!deployment || loading}
                  onClick={handleSquareOff}
                >
                  <i className="bi bi-arrow-repeat me-2"></i>
                  Square Off
                </button>
                <button
                  className="btn btn-outline-dark"
                  disabled={!deployment || loading}
                  onClick={() => handleSimpleAction('/api/live_trade/delete', 'Deployment record cleared.')}
                >
                  <i className="bi bi-trash3 me-2"></i>
                  Clear Deployment
                </button>
              </div>

              {(error || actionMessage) && (
                <div className="mt-3">
                  {error && (
                    <div className="alert alert-danger" role="alert">
                      <i className="bi bi-exclamation-triangle me-2"></i>
                      {error}
                    </div>
                  )}
                  {actionMessage && (
                    <div className="alert alert-success" role="alert">
                      <i className="bi bi-check-circle me-2"></i>
                      {actionMessage}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-8">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-header bg-secondary text-white d-flex justify-content-between align-items-center">
              <h5 className="mb-0">
                <i className="bi bi-activity me-2"></i>
                Live Trade Status
              </h5>
              {statusLoading && (
                <span className="spinner-border spinner-border-sm" role="status" />
              )}
            </div>
            <div className="card-body">
              {!deployment ? (
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-info-circle display-6 d-block mb-3"></i>
                  <p className="mb-0">
                    No live deployment detected. Configure a strategy and click <strong>Deploy Strategy</strong>.
                  </p>
                </div>
              ) : (
                <>
                  <div className="row g-3 mb-3">
                    <div className="col-md-6">
                      <div className="p-3 bg-light rounded h-100">
                        <h6 className="fw-semibold">Deployment Details</h6>
                        <p className="mb-1">
                          <strong>Strategy:</strong>{' '}
                          {deployment.strategyName || 'N/A'}
                        </p>
                        <p className="mb-1">
                          <strong>Status:</strong>{' '}
                          <span className={`badge ${statusBadgeClass}`}>
                            {deployment.status.toUpperCase()}
                          </span>
                        </p>
                        <p className="mb-1">
                          <strong>Lots × Lot Size:</strong>{' '}
                          {config.lotCount && config.lotSize
                            ? `${config.lotCount} × ${config.lotSize} = ${config.totalQuantity ?? config.lotCount * config.lotSize}`
                            : '—'}
                        </p>
                      <p className="mb-1">
                        <strong>Scheduled Start:</strong>{' '}
                        {deployment.scheduledStart
                          ? formatDateTime(deployment.scheduledStart)
                          : '—'}
                      </p>
                      <p className="mb-0">
                        <strong>Started:</strong>{' '}
                        {deployment.startedAt
                          ? formatDateTime(deployment.startedAt)
                          : deployment.status === 'SCHEDULED'
                            ? 'Pending start'
                            : deployment.status === 'ACTIVE'
                              ? 'Starting...'
                              : '—'}
                      </p>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="p-3 bg-light rounded h-100">
                        <h6 className="fw-semibold">Runtime Summary</h6>
                        <p className="mb-1">
                          <strong>Phase:</strong> {currentPhase}
                        </p>
                        <p className="mb-1">
                          <strong>Message:</strong>{' '}
                          {deployment.state?.message || '—'}
                        </p>
                        <p className="mb-1">
                          <strong>Last Check:</strong>{' '}
                          {formatDateTime(deployment.state?.lastCheck)}
                        </p>
                        <p className="mb-1">
                          <strong>Available Cash:</strong>{' '}
                          {formatCurrency(availableCash)}
                        </p>
                        <p className="mb-1">
                          <strong>Required Capital:</strong>{' '}
                          {formatCurrency(requiredCapital)}
                        </p>
                        <p className="mb-1">
                          <strong>Stop Loss / Target:</strong>{' '}
                          {stopLossDisplay !== null && targetDisplay !== null
                            ? `${stopLossDisplay.toFixed(2)}% / ${targetDisplay.toFixed(2)}%`
                            : '—'}
                        </p>
                        <p className="mb-0">
                          <strong>Live P&L:</strong>{' '}
                          <span
                            className={
                              (deployment.state?.livePnl ?? 0) >= 0
                                ? 'text-success fw-semibold'
                                : 'text-danger fw-semibold'
                            }
                          >
                            {formatCurrency(deployment.state?.livePnl)}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {deployment.errorMessage && (
                    <div className="alert alert-danger">
                      <i className="bi bi-x-octagon me-2"></i>
                      {deployment.errorMessage}
                    </div>
                  )}

                  <div className="mb-4">
                    <h6 className="fw-semibold d-flex align-items-center">
                      <i className="bi bi-clipboard-data me-2"></i>
                      Orders ({orders.length})
                    </h6>
                    {orders.length === 0 ? (
                      <p className="text-muted mb-0">No orders observed yet.</p>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-sm table-bordered align-middle mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>Order ID</th>
                              <th>Status</th>
                              <th>Symbol</th>
                              <th>Type</th>
                              <th>Qty</th>
                              <th>Price</th>
                              <th>Avg Price</th>
                              <th>Timestamp</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orders.map((order) => (
                              <tr key={`${order.order_id}-${order.order_timestamp}`}>
                                <td>{order.order_id || '—'}</td>
                                <td>{order.status || '—'}</td>
                                <td>{order.tradingsymbol || '—'}</td>
                                <td>{order.transaction_type || '—'}</td>
                                <td>{order.quantity ?? '—'}</td>
                                <td>{order.price ?? '—'}</td>
                                <td>{order.average_price ?? '—'}</td>
                                <td>{order.order_timestamp || order.exchange_timestamp || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="mb-4">
                    <h6 className="fw-semibold d-flex align-items-center">
                      <i className="bi bi-diagram-3 me-2"></i>
                      Positions ({openPositionsCount})
                    </h6>
                    {openPositionsCount === 0 ? (
                      <p className="text-muted mb-0">No open positions.</p>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-sm table-bordered align-middle mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>Symbol</th>
                              <th>Exchange</th>
                              <th>Product</th>
                              <th>Quantity</th>
                              <th>Buy Price</th>
                              <th>Sell Price</th>
                              <th>Last Price</th>
                              <th>P&L</th>
                            </tr>
                          </thead>
                          <tbody>
                            {positions.map((position, idx) => (
                              <tr key={`${position.tradingsymbol}-${idx}`}>
                                <td>{position.tradingsymbol || '—'}</td>
                                <td>{position.exchange || '—'}</td>
                                <td>{position.product || '—'}</td>
                                <td>{position.quantity ?? '—'}</td>
                                <td>{position.buy_price ?? '—'}</td>
                                <td>{position.sell_price ?? '—'}</td>
                                <td>{position.last_price ?? '—'}</td>
                                <td
                                  className={
                                    (position.pnl ?? 0) >= 0
                                      ? 'text-success fw-semibold'
                                      : 'text-danger fw-semibold'
                                  }
                                >
                                  {position.pnl ?? '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {squareOffResults.length > 0 && (
                    <div className="mb-4">
                      <h6 className="fw-semibold d-flex align-items-center">
                        <i className="bi bi-arrow-repeat me-2"></i>
                        Square-off Requests
                      </h6>
                      <ul className="list-group list-group-flush">
                        {squareOffResults.map((result, idx) => (
                          <li key={`${result.tradingsymbol}-${idx}`} className="list-group-item">
                            <strong>{result.tradingsymbol || 'Unknown'}</strong> —{' '}
                            {result.status}{' '}
                            {result.order_id && <span>(Order ID: {result.order_id})</span>}
                            {result.message && (
                              <span className="text-muted ms-2">
                                {result.message}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <h6 className="fw-semibold d-flex align-items-center">
                      <i className="bi bi-journal-text me-2"></i>
                      Activity History
                    </h6>
                    {history.length === 0 ? (
                      <p className="text-muted mb-0">No events logged yet.</p>
                    ) : (
                      <ul className="list-group list-group-flush">
                        {history.map((entry, idx) => (
                          <li key={`${entry.timestamp}-${idx}`} className="list-group-item">
                            <div className="d-flex justify-content-between">
                              <span className="text-muted small">
                                {formatDateTime(entry.timestamp)}
                              </span>
                              <span className="badge bg-light text-dark text-uppercase">
                                {entry.level || 'info'}
                              </span>
                            </div>
                            <div>{entry.message || 'Event recorded.'}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveTradeContent;


