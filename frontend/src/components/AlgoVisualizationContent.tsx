import React, { useState, useEffect } from 'react';
import MountainSignalFlowDiagram from './MountainSignalFlowDiagram';
import ORBFlowDiagram from './ORBFlowDiagram';
import MountainSignalChart from './MountainSignalChart';

interface Strategy {
  id: number;
  strategy_name: string;
  strategy_type: string;
  instrument: string;
  candle_time: string;
  start_time: string;
  end_time: string;
  stop_loss: number;
  target_profit: number;
  total_lot: number;
  trailing_stop_loss: number;
  segment: string;
  trade_type: string;
  strike_price: string;
  expiry_type: string;
  ema_period?: number;
  indicators?: string;
  entry_rules?: string;
  exit_rules?: string;
}

interface AlgoVisualizationContentProps {
  // Add any props if needed in the future
}

const AlgoVisualizationContent: React.FC<AlgoVisualizationContentProps> = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [activeTab, setActiveTab] = useState<'flow' | 'chart' | 'backtest' | 'optimizer'>('flow');
  const [loading, setLoading] = useState<boolean>(false);

  // Fetch strategies from backend
  useEffect(() => {
    const fetchStrategies = async () => {
      try {
        setLoading(true);
        const response = await fetch('http://localhost:8000/api/strategies', {
          credentials: 'include',
        });
        const data = await response.json();
        if (response.ok && data.status === 'success') {
          setStrategies(data.strategies || []);
        } else {
          console.error('Error fetching strategies:', data.message);
        }
      } catch (error) {
        console.error('Error fetching strategies:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStrategies();
  }, []);

  const handleStrategyChange = (strategyId: string) => {
    const strategy = strategies.find(s => s.id.toString() === strategyId);
    setSelectedStrategy(strategy || null);
    // Reset to flow diagram when strategy changes
    setActiveTab('flow');
  };

  return (
    <div className="container-fluid">
      <div className="card shadow-sm border-0 mb-4">
        <div className="card-header bg-primary text-white">
          <h4 className="card-title mb-0">
            <i className="bi bi-diagram-3 me-2"></i>
            Algorithm Visualization
          </h4>
          <small className="text-white-50">Visualize and understand your trading strategies</small>
        </div>
        <div className="card-body">
          {/* Strategy Selection */}
          <div className="row mb-4">
            <div className="col-md-6">
              <label htmlFor="strategy-select" className="form-label fw-bold">
                <i className="bi bi-list-ul me-2"></i>Select Strategy
              </label>
              <select
                id="strategy-select"
                className="form-select form-select-lg"
                value={selectedStrategy?.id.toString() || ''}
                onChange={(e) => handleStrategyChange(e.target.value)}
                disabled={loading || strategies.length === 0}
              >
                <option value="">
                  {loading ? 'Loading strategies...' : strategies.length === 0 ? 'No strategies available' : '-- Select a strategy --'}
                </option>
                {strategies.map((strategy) => (
                  <option key={strategy.id} value={strategy.id.toString()}>
                    {strategy.strategy_name} ({strategy.strategy_type.toUpperCase()})
                  </option>
                ))}
              </select>
              {selectedStrategy && (
                <div className="mt-2">
                  <small className="text-muted">
                    <strong>Type:</strong> {selectedStrategy.strategy_type} |{' '}
                    <strong>Instrument:</strong> {selectedStrategy.instrument} |{' '}
                    <strong>Candle Time:</strong> {selectedStrategy.candle_time}
                  </small>
                </div>
              )}
            </div>
          </div>

          {/* Tabs for different visualizations */}
          {selectedStrategy && (
            <>
              <ul className="nav nav-tabs mb-3" role="tablist">
                <li className="nav-item" role="presentation">
                  <button
                    className={`nav-link ${activeTab === 'flow' ? 'active' : ''}`}
                    onClick={() => setActiveTab('flow')}
                    type="button"
                  >
                    <i className="bi bi-diagram-3 me-2"></i>
                    Flow Diagram
                  </button>
                </li>
                <li className="nav-item" role="presentation">
                  <button
                    className={`nav-link ${activeTab === 'chart' ? 'active' : ''}`}
                    onClick={() => setActiveTab('chart')}
                    type="button"
                  >
                    <i className="bi bi-graph-up me-2"></i>
                    Paper Trade
                  </button>
                </li>
                <li className="nav-item" role="presentation">
                  <button
                    className={`nav-link ${activeTab === 'backtest' ? 'active' : ''}`}
                    onClick={() => setActiveTab('backtest')}
                    type="button"
                  >
                    <i className="bi bi-clipboard-data me-2"></i>
                    Backtest Report
                  </button>
                </li>
                <li className="nav-item" role="presentation">
                  <button
                    className={`nav-link ${activeTab === 'optimizer' ? 'active' : ''}`}
                    onClick={() => setActiveTab('optimizer')}
                    type="button"
                  >
                    <i className="bi bi-sliders me-2"></i>
                    Strategy Optimizer
                  </button>
                </li>
              </ul>

              {/* Tab Content */}
              <div className="tab-content">
                {/* Flow Diagram Tab */}
                {activeTab === 'flow' && (
                  <div className="tab-pane fade show active">
                    <div className="card border-0 bg-light">
                      <div className="card-body">
                        {selectedStrategy.strategy_type === 'capture_mountain_signal' ? (
                          <MountainSignalFlowDiagram strategy={selectedStrategy} />
                        ) : selectedStrategy.strategy_type === 'orb' ? (
                          <ORBFlowDiagram strategy={selectedStrategy} />
                        ) : (
                          <>
                            <h5 className="card-title mb-3">
                              <i className="bi bi-diagram-3 me-2 text-primary"></i>
                              Strategy Logic Flow Diagram
                            </h5>
                            <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '400px' }}>
                              <div className="text-center text-muted">
                                <i className="bi bi-diagram-3" style={{ fontSize: '4rem', opacity: 0.3 }}></i>
                                <p className="mt-3">Flow diagram for {selectedStrategy.strategy_type} will be implemented soon</p>
                                <p className="small">
                                  Strategy: <strong>{selectedStrategy.strategy_name}</strong>
                                </p>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Candlestick Chart Tab */}
                {activeTab === 'chart' && (
                  <div className="tab-pane fade show active">
                    {selectedStrategy.strategy_type === 'capture_mountain_signal' ? (
                      <MountainSignalChart strategy={selectedStrategy} activeTab="chart" />
                    ) : (
                      <div className="card border-0 bg-light">
                        <div className="card-body">
                          <h5 className="card-title mb-3">
                            <i className="bi bi-graph-up me-2 text-primary"></i>
                            Paper Trade
                          </h5>
                          <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '400px' }}>
                            <div className="text-center text-muted">
                              <i className="bi bi-graph-up" style={{ fontSize: '4rem', opacity: 0.3 }}></i>
                              <p className="mt-3">Paper Trade view for {selectedStrategy.strategy_type} will be implemented soon</p>
                              <p className="small">
                                Strategy: <strong>{selectedStrategy.strategy_name}</strong> |{' '}
                                Instrument: <strong>{selectedStrategy.instrument}</strong>
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Backtest Report Tab */}
                {activeTab === 'backtest' && (
                  <div className="tab-pane fade show active">
                    {selectedStrategy.strategy_type === 'capture_mountain_signal' ? (
                      <MountainSignalChart strategy={selectedStrategy} activeTab="backtest" />
                    ) : (
                      <div className="card border-0 bg-light">
                        <div className="card-body">
                          <h5 className="card-title mb-3">
                            <i className="bi bi-clipboard-data me-2 text-primary"></i>
                            Backtest Report
                          </h5>
                          <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '400px' }}>
                            <div className="text-center text-muted">
                              <i className="bi bi-clipboard-data" style={{ fontSize: '4rem', opacity: 0.3 }}></i>
                              <p className="mt-3">Backtest report for {selectedStrategy.strategy_type} will be implemented soon</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Strategy Optimizer Tab */}
                {activeTab === 'optimizer' && (
                  <div className="tab-pane fade show active">
                    {selectedStrategy.strategy_type === 'capture_mountain_signal' ? (
                      <MountainSignalChart strategy={selectedStrategy} activeTab="optimizer" />
                    ) : (
                      <div className="card border-0 bg-light">
                        <div className="card-body">
                          <h5 className="card-title mb-3">
                            <i className="bi bi-sliders me-2 text-primary"></i>
                            Strategy Optimizer
                          </h5>
                          <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '400px' }}>
                            <div className="text-center text-muted">
                              <i className="bi bi-sliders" style={{ fontSize: '4rem', opacity: 0.3 }}></i>
                              <p className="mt-3">Strategy optimizer for {selectedStrategy.strategy_type} will be implemented soon</p>
                              <p className="small">
                                Strategy: <strong>{selectedStrategy.strategy_name}</strong>
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Empty State */}
          {!selectedStrategy && (
            <div className="text-center py-5">
              <i className="bi bi-diagram-3" style={{ fontSize: '4rem', opacity: 0.3, color: '#6c757d' }}></i>
              <p className="mt-3 text-muted">
                Please select a strategy from the dropdown above to visualize its logic and execution.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AlgoVisualizationContent;

