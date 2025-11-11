import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';

interface BacktestMetrics {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  roi_percent: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  profit_factor: number;
  average_trade: number;
  equity_curve?: { [key: string]: number };
}

interface Props {
  metrics: BacktestMetrics;
  trades?: Array<{
    entry_date: string;
    exit_date: string;
    entry_price: number;
    exit_price: number;
    pnl: number;
    type: 'BUY' | 'SELL';
  }>;
}

const BacktestResultsDashboard: React.FC<Props> = ({ metrics, trades = [] }) => {
  // Convert equity curve to array format for chart
  const equityData = metrics.equity_curve
    ? Object.entries(metrics.equity_curve).map(([date, value]) => ({
        date: new Date(date).toLocaleDateString(),
        equity: value
      }))
    : [];

  // Trade analysis data
  const tradeData = trades.slice(0, 20).map((trade, index) => ({
    trade: index + 1,
    pnl: trade.pnl,
    type: trade.type
  }));

  const performanceCards = [
    {
      title: 'Total P&L',
      value: `₹${metrics.total_pnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      color: metrics.total_pnl >= 0 ? 'text-success' : 'text-danger',
      icon: '💰'
    },
    {
      title: 'ROI',
      value: `${metrics.roi_percent}%`,
      color: metrics.roi_percent >= 0 ? 'text-success' : 'text-danger',
      icon: '📈'
    },
    {
      title: 'Win Rate',
      value: `${metrics.win_rate}%`,
      color: 'text-info',
      icon: '🎯'
    },
    {
      title: 'Sharpe Ratio',
      value: metrics.sharpe_ratio.toFixed(2),
      color: metrics.sharpe_ratio > 1 ? 'text-success' : 'text-warning',
      icon: '⚖️'
    },
    {
      title: 'Max Drawdown',
      value: `${metrics.max_drawdown_pct}%`,
      color: 'text-danger',
      icon: '📉'
    },
    {
      title: 'Profit Factor',
      value: metrics.profit_factor.toFixed(2),
      color: metrics.profit_factor > 1 ? 'text-success' : 'text-danger',
      icon: '🔢'
    }
  ];

  return (
    <div className="container-fluid mt-4">
      {/* Performance Metrics Cards */}
      <div className="row mb-4">
        {performanceCards.map((card, index) => (
          <div key={index} className="col-md-4 col-lg-2 mb-3">
            <div className="card shadow-sm h-100">
              <div className="card-body text-center">
                <div className="fs-3 mb-2">{card.icon}</div>
                <h6 className="card-title text-muted">{card.title}</h6>
                <h4 className={`card-text ${card.color}`}>{card.value}</h4>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row">
        {/* Equity Curve */}
        <div className="col-lg-8 mb-4">
          <div className="card shadow-sm">
            <div className="card-header bg-primary text-white">
              <h5 className="mb-0">Equity Curve</h5>
            </div>
            <div className="card-body">
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={equityData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip 
                    formatter={(value: number) => [`₹${value.toLocaleString('en-IN')}`, 'Equity']}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="equity" 
                    stroke="#2196F3" 
                    strokeWidth={2}
                    name="Portfolio Value"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Trade Statistics */}
        <div className="col-lg-4 mb-4">
          <div className="card shadow-sm">
            <div className="card-header bg-info text-white">
              <h5 className="mb-0">Trade Statistics</h5>
            </div>
            <div className="card-body">
              <table className="table table-sm">
                <tbody>
                  <tr>
                    <td><strong>Total Trades</strong></td>
                    <td className="text-end">{metrics.total_trades}</td>
                  </tr>
                  <tr>
                    <td><strong>Winning Trades</strong></td>
                    <td className="text-end text-success">{metrics.winning_trades}</td>
                  </tr>
                  <tr>
                    <td><strong>Losing Trades</strong></td>
                    <td className="text-end text-danger">{metrics.losing_trades}</td>
                  </tr>
                  <tr>
                    <td><strong>Average Trade</strong></td>
                    <td className="text-end">₹{metrics.average_trade.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td><strong>Best Trade</strong></td>
                    <td className="text-end text-success">
                      ₹{trades.length > 0 ? Math.max(...trades.map(t => t.pnl)).toFixed(2) : '0.00'}
                    </td>
                  </tr>
                  <tr>
                    <td><strong>Worst Trade</strong></td>
                    <td className="text-end text-danger">
                      ₹{trades.length > 0 ? Math.min(...trades.map(t => t.pnl)).toFixed(2) : '0.00'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Risk Metrics */}
          <div className="card shadow-sm mt-3">
            <div className="card-header bg-warning text-dark">
              <h5 className="mb-0">Risk Metrics</h5>
            </div>
            <div className="card-body">
              <div className="mb-2">
                <small className="text-muted">Maximum Drawdown</small>
                <div className="progress" style={{ height: '20px' }}>
                  <div
                    className="progress-bar bg-danger"
                    role="progressbar"
                    style={{ width: `${Math.min(metrics.max_drawdown_pct, 100)}%` }}
                  >
                    {metrics.max_drawdown_pct}%
                  </div>
                </div>
              </div>
              <div className="mb-2">
                <small className="text-muted">Sharpe Ratio</small>
                <div className="d-flex align-items-center">
                  <div className="progress flex-grow-1 me-2" style={{ height: '20px' }}>
                    <div
                      className={`progress-bar ${metrics.sharpe_ratio > 1 ? 'bg-success' : 'bg-warning'}`}
                      role="progressbar"
                      style={{ width: `${Math.min(metrics.sharpe_ratio * 20, 100)}%` }}
                    />
                  </div>
                  <span className="fw-bold">{metrics.sharpe_ratio.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trade Analysis Chart */}
      {tradeData.length > 0 && (
        <div className="row mt-4">
          <div className="col-12">
            <div className="card shadow-sm">
              <div className="card-header bg-secondary text-white">
                <h5 className="mb-0">Trade Analysis</h5>
              </div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={tradeData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="trade" />
                    <YAxis />
                    <Tooltip 
                      formatter={(value: number) => [`₹${value.toFixed(2)}`, 'P&L']}
                    />
                    <Legend />
                    <Bar 
                      dataKey="pnl" 
                      fill="#4CAF50"
                      name="Trade P&L"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BacktestResultsDashboard;


