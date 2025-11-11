import React, { useState, useEffect } from 'react';

interface LiveStrategyModalProps {
  show: boolean;
  onClose: () => void;
  strategyId: string | null;
}

interface TradeHistoryItem {
  time: string;
  action: string;
  instrument: string;
  price: number;
  order_id: string;
}

interface LiveStrategyStatus {
  status: string;
  message: string;
  strategy_name_display: string;
  paper_trade_mode: boolean;
  state: string;
  traded_instrument: string;
  entry_price: number;
  stop_loss_level: number;
  target_profit_level: number | string;
  entry_order_id: string;
  sl_order_id: string;
  tp_order_id: string;
  pnl: number;
  trade_history: TradeHistoryItem[];
  strategy_type?: string;
  opening_range_high?: number;
  opening_range_low?: number;
  current_ltp?: number;
  signal_status?: string;
  signal_candle_time?: string;
  signal_candle_high?: number;
  signal_candle_low?: number;
}

const LiveStrategyModal: React.FC<LiveStrategyModalProps> = ({ show, onClose, strategyId }) => {
  const [liveStatus, setLiveStatus] = useState<LiveStrategyStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLiveStrategyStatus = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/strategy/status/${id}`);
      const data = await response.json();
      if (response.ok) {
        setLiveStatus(data);
      } else {
        setError(data.message || 'Failed to fetch live strategy status.');
      }
    } catch (err) {
      console.error('Error fetching live strategy status:', err);
      setError('An error occurred while fetching live strategy status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;
    if (show && strategyId) {
      fetchLiveStrategyStatus(strategyId);
      interval = setInterval(() => fetchLiveStrategyStatus(strategyId), 2000);
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [show, strategyId]);

  if (!show) {
    return null;
  }

  return (
    <div className="modal fade show" style={{ display: 'block' }} tabIndex={-1} role="dialog">
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title" id="live-strategy-modal-label">
              Live Strategy Status: {liveStatus?.strategy_name_display || 'Loading...'}
            </h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
          </div>
          <div className="modal-body" id="live-strategy-panel">
            {loading && <p>Loading live status...</p>}
            {error && <div className="alert alert-danger">{error}</div>}
            {liveStatus && !loading && !error && (
              <>
                {liveStatus.paper_trade_mode && <div className="alert alert-info"><strong>PAPER TRADE MODE ACTIVE</strong></div>}
                <p><strong>State:</strong> {liveStatus.state}</p>
                <p><strong>Message:</strong> {liveStatus.message}</p>
                {liveStatus.strategy_type === 'orb' && (
                  <>
                    <p><strong>Opening Range High:</strong> {liveStatus.opening_range_high?.toFixed(2)}</p>
                    <p><strong>Opening Range Low:</strong> {liveStatus.opening_range_low?.toFixed(2)}</p>
                  </>
                )}
                {liveStatus.strategy_type === 'capture_mountain_signal' && (
                  <>
                    <p><strong>Current LTP:</strong> {liveStatus.current_ltp?.toFixed(2)}</p>
                    <p><strong>Signal Status:</strong> {liveStatus.signal_status}</p>
                    <p><strong>Signal Candle Time:</strong> {liveStatus.signal_candle_time}</p>
                    <p><strong>Signal Candle High:</strong> {liveStatus.signal_candle_high?.toFixed(2)}</p>
                    <p><strong>Signal Candle Low:</strong> {liveStatus.signal_candle_low?.toFixed(2)}</p>
                  </>
                )}
                <p><strong>Instrument:</strong> {liveStatus.traded_instrument || 'N/A'}</p>
                <p><strong>Entry Price:</strong> {liveStatus.entry_price?.toFixed(2)}</p>
                <p><strong>Stop Loss Level:</strong> {liveStatus.stop_loss_level?.toFixed(2)}</p>
                <p><strong>Target Profit Level:</strong> {liveStatus.target_profit_level !== 'N/A' && typeof liveStatus.target_profit_level === 'number' ? liveStatus.target_profit_level.toFixed(2) : 'N/A'}</p>
                <p><strong>Entry Order ID:</strong> {liveStatus.entry_order_id}</p>
                <p><strong>SL Order ID:</strong> {liveStatus.sl_order_id}</p>
                <p><strong>TP Order ID:</strong> {liveStatus.tp_order_id}</p>
                <p><strong>Live P&L:</strong> {liveStatus.pnl?.toFixed(2)}</p>
                <h5>Trade History</h5>
                {liveStatus.trade_history && liveStatus.trade_history.length > 0 ? (
                  <table className="table table-striped table-sm">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Action</th>
                        <th>Instrument</th>
                        <th>Price</th>
                        <th>Order ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liveStatus.trade_history.map((trade, index) => (
                        <tr key={index}>
                          <td>{trade.time}</td>
                          <td>{trade.action}</td>
                          <td>{trade.instrument}</td>
                          <td>{trade.price?.toFixed(2)}</td>
                          <td>{trade.order_id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p>No trade history yet.</p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveStrategyModal;
