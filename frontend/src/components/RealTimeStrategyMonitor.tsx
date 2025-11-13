import React, { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { apiUrl, SOCKET_BASE_URL } from '../config/api';

interface RealTimeStrategyMonitorProps {
  strategyId: string;
  onClose: () => void;
}

interface StrategyLog {
  timestamp: string;
  action: string;
  price: number;
  quantity: number;
  pnl: number;
  status: string;
}

interface LiveMetrics {
  currentPrice: number;
  entryPrice: number;
  currentPnL: number;
  unrealizedPnL: number;
  realizedPnL: number;
  quantity: number;
  status: string;
}

const RealTimeStrategyMonitor: React.FC<RealTimeStrategyMonitorProps> = ({ strategyId, onClose }) => {
  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics | null>(null);
  const [logs, setLogs] = useState<StrategyLog[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  useEffect(() => {
    // Initialize Socket connection
  const newSocket = io(SOCKET_BASE_URL, { transports: ['polling'] });
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setIsConnected(true);
      // Subscribe to strategy updates
      newSocket.emit('subscribe_strategy', { strategy_id: strategyId });
    });

    newSocket.on('strategy_update', (data: {
      strategy_id: string;
      metrics: LiveMetrics;
      log: StrategyLog;
    }) => {
      if (data.strategy_id === strategyId) {
        setLiveMetrics(data.metrics);
        if (data.log) {
          setLogs(prev => [data.log, ...prev].slice(0, 100)); // Keep last 100 logs
          setChartData(prev => [...prev, {
            time: data.log.timestamp,
            price: data.log.price,
            pnl: data.log.pnl
          }].slice(-50)); // Keep last 50 data points
        }
      }
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    // Fetch initial strategy status
    fetch(apiUrl(`/api/strategy/status/${strategyId}`), {
      credentials: 'include'
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          setLiveMetrics(data.metrics);
        }
      })
      .catch(err => console.error('Error fetching strategy status:', err));

    return () => {
      newSocket.emit('unsubscribe_strategy', { strategy_id: strategyId });
      newSocket.disconnect();
    };
  }, [strategyId]);

  return (
    <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex={-1}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content">
          <div className="modal-header bg-primary text-white">
            <h5 className="modal-title">
              <i className="bi bi-activity me-2"></i>
              Real-Time Strategy Monitor - Strategy #{strategyId}
            </h5>
            <button type="button" className="btn-close btn-close-white" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            {/* Connection Status */}
            <div className="mb-3">
              <span className={`badge ${isConnected ? 'bg-success' : 'bg-danger'}`}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            {/* Live Metrics Cards */}
            {liveMetrics && (
              <div className="row g-3 mb-4">
                <div className="col-md-3">
                  <div className="card bg-light">
                    <div className="card-body text-center">
                      <small className="text-muted d-block">Current Price</small>
                      <h4 className="mb-0 text-primary">{liveMetrics.currentPrice.toFixed(2)}</h4>
                    </div>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="card bg-light">
                    <div className="card-body text-center">
                      <small className="text-muted d-block">Entry Price</small>
                      <h4 className="mb-0">{liveMetrics.entryPrice.toFixed(2)}</h4>
                    </div>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="card bg-light">
                    <div className="card-body text-center">
                      <small className="text-muted d-block">Current P&L</small>
                      <h4 className={`mb-0 ${liveMetrics.currentPnL >= 0 ? 'text-success' : 'text-danger'}`}>
                        {liveMetrics.currentPnL.toFixed(2)}
                      </h4>
                    </div>
                  </div>
                </div>
                <div className="col-md-3">
                  <div className="card bg-light">
                    <div className="card-body text-center">
                      <small className="text-muted d-block">Quantity</small>
                      <h4 className="mb-0">{liveMetrics.quantity}</h4>
                    </div>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="card bg-light">
                    <div className="card-body text-center">
                      <small className="text-muted d-block">Unrealized P&L</small>
                      <h4 className={`mb-0 ${liveMetrics.unrealizedPnL >= 0 ? 'text-success' : 'text-danger'}`}>
                        {liveMetrics.unrealizedPnL.toFixed(2)}
                      </h4>
                    </div>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="card bg-light">
                    <div className="card-body text-center">
                      <small className="text-muted d-block">Realized P&L</small>
                      <h4 className={`mb-0 ${liveMetrics.realizedPnL >= 0 ? 'text-success' : 'text-danger'}`}>
                        {liveMetrics.realizedPnL.toFixed(2)}
                      </h4>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Chart */}
            {chartData.length > 0 && (
              <div className="card mb-4">
                <div className="card-header">
                  <h6 className="mb-0"><i className="bi bi-graph-up me-2"></i>Real-Time P&L Chart</h6>
                </div>
                <div className="card-body">
                  <div style={{ height: '300px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" />
                        <YAxis yAxisId="left" />
                        <YAxis yAxisId="right" orientation="right" />
                        <Tooltip />
                        <Legend />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="price"
                          stroke="#0d6efd"
                          name="Price"
                          dot={false}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="pnl"
                          stroke="#28a745"
                          name="P&L"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Strategy Logs */}
            <div className="card">
              <div className="card-header">
                <h6 className="mb-0"><i className="bi bi-list-ul me-2"></i>Strategy Activity Log</h6>
              </div>
              <div className="card-body" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {logs.length === 0 ? (
                  <p className="text-muted text-center">No activity yet. Waiting for market events...</p>
                ) : (
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Action</th>
                        <th>Price</th>
                        <th>Quantity</th>
                        <th>P&L</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log, index) => (
                        <tr key={index}>
                          <td>{new Date(log.timestamp).toLocaleTimeString()}</td>
                          <td>
                            <span className={`badge ${
                              log.action === 'BUY' ? 'bg-success' :
                              log.action === 'SELL' ? 'bg-danger' :
                              log.action === 'ENTRY' ? 'bg-info' :
                              log.action === 'EXIT' ? 'bg-warning' : 'bg-secondary'
                            }`}>
                              {log.action}
                            </span>
                          </td>
                          <td>{log.price.toFixed(2)}</td>
                          <td>{log.quantity}</td>
                          <td className={log.pnl >= 0 ? 'text-success' : 'text-danger'}>
                            {log.pnl.toFixed(2)}
                          </td>
                          <td>{log.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RealTimeStrategyMonitor;

