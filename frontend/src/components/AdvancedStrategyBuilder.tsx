import React, { useState, useEffect } from 'react';
import { apiUrl } from '../config/api';

interface Indicator {
  id: string;
  name: string;
  type: 'trend' | 'momentum' | 'volatility' | 'volume';
  params: { [key: string]: number | string };
}

interface Condition {
  id: string;
  indicator: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | 'cross_above' | 'cross_below';
  value: number;
  logic: 'AND' | 'OR' | '';
}

interface AdvancedStrategyBuilderProps {
  onStrategySaved: () => void;
  editingStrategy?: any; // Strategy being edited
}

const AdvancedStrategyBuilder: React.FC<AdvancedStrategyBuilderProps> = ({ onStrategySaved, editingStrategy }) => {
  // Basic Strategy Info
  const [strategyName, setStrategyName] = useState<string>(editingStrategy?.strategy_name || '');
  const [strategyType, setStrategyType] = useState<string>(editingStrategy?.strategy_type || 'custom');
  const [instrument, setInstrument] = useState<string>(editingStrategy?.instrument || 'NIFTY');
  const [segment, setSegment] = useState<string>(editingStrategy?.segment || 'Option');
  
  // Timeframe & Execution
  const [candleTime, setCandleTime] = useState<string>(editingStrategy?.candle_time || '5');
  const [executionStart, setExecutionStart] = useState<string>(editingStrategy?.start_time || '09:15');
  const [executionEnd, setExecutionEnd] = useState<string>(editingStrategy?.end_time || '15:00');
  
  // Risk Management
  const [stopLoss, setStopLoss] = useState<number>(editingStrategy?.stop_loss || 1);
  const [targetProfit, setTargetProfit] = useState<number>(editingStrategy?.target_profit || 2);
  const [trailingStopLoss, setTrailingStopLoss] = useState<number>(editingStrategy?.trailing_stop_loss || 0.5);
  const [totalLot, setTotalLot] = useState<number>(editingStrategy?.total_lot || 1);
  
  // Options Parameters
  const [tradeType, setTradeType] = useState<string>(editingStrategy?.trade_type || 'Buy');
  const [strikePrice, setStrikePrice] = useState<string>(editingStrategy?.strike_price || 'ATM');
  const [expiryType, setExpiryType] = useState<string>(editingStrategy?.expiry_type || 'Weekly');
  
  // Advanced Features
  const [paperTrade, setPaperTrade] = useState<boolean>(editingStrategy?.paper_trade || false);
  const [selectedIndicators, setSelectedIndicators] = useState<Indicator[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [activeTab, setActiveTab] = useState<'basic' | 'advanced' | 'risk'>('basic');
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

  // Available Indicators
  const availableIndicators = [
    { id: 'sma', name: 'Simple Moving Average (SMA)', type: 'trend' as const, defaultParams: { period: 20 } },
    { id: 'ema', name: 'Exponential Moving Average (EMA)', type: 'trend' as const, defaultParams: { period: 12 } },
    { id: 'wma', name: 'Weighted Moving Average (WMA)', type: 'trend' as const, defaultParams: { period: 20 } },
    { id: 'rsi', name: 'RSI (Relative Strength Index)', type: 'momentum' as const, defaultParams: { period: 14 } },
    { id: 'macd', name: 'MACD', type: 'momentum' as const, defaultParams: { fast: 12, slow: 26, signal: 9 } },
    { id: 'bb', name: 'Bollinger Bands', type: 'volatility' as const, defaultParams: { period: 20, std: 2 } },
    { id: 'atr', name: 'ATR (Average True Range)', type: 'volatility' as const, defaultParams: { period: 14 } },
    { id: 'stoch', name: 'Stochastic Oscillator', type: 'momentum' as const, defaultParams: { k_period: 14, d_period: 3 } },
    { id: 'obv', name: 'OBV (On-Balance Volume)', type: 'volume' as const, defaultParams: {} },
  ];

  // Initialize from editing strategy if provided
  useEffect(() => {
    if (editingStrategy) {
      setStrategyName(editingStrategy.strategy_name || '');
      setStrategyType(editingStrategy.strategy_type || 'custom');
      setInstrument(editingStrategy.instrument || 'NIFTY');
      setSegment(editingStrategy.segment || 'Option');
      setCandleTime(editingStrategy.candle_time || '5');
      setExecutionStart(editingStrategy.start_time || '09:15');
      setExecutionEnd(editingStrategy.end_time || '15:00');
      setStopLoss(editingStrategy.stop_loss || 1);
      setTargetProfit(editingStrategy.target_profit || 2);
      setTrailingStopLoss(editingStrategy.trailing_stop_loss || 0.5);
      setTotalLot(editingStrategy.total_lot || 1);
      setTradeType(editingStrategy.trade_type || 'Buy');
      setStrikePrice(editingStrategy.strike_price || 'ATM');
      setExpiryType(editingStrategy.expiry_type || 'Weekly');
      setPaperTrade(editingStrategy.paper_trade || false);
    }
  }, [editingStrategy]);

  const addIndicator = (indicatorId: string) => {
    const indicator = availableIndicators.find(i => i.id === indicatorId);
    if (indicator) {
      const filteredParams: { [key: string]: number | string } = {};
      Object.entries(indicator.defaultParams).forEach(([key, value]) => {
        if (value !== undefined) {
          filteredParams[key] = value as number | string;
        }
      });
      
      const newIndicator: Indicator = {
        id: `${indicatorId}_${Date.now()}`,
        name: indicator.name,
        type: indicator.type,
        params: filteredParams
      };
      setSelectedIndicators([...selectedIndicators, newIndicator]);
    }
  };

  const removeIndicator = (id: string) => {
    setSelectedIndicators(selectedIndicators.filter(ind => ind.id !== id));
    setConditions(conditions.filter(cond => cond.indicator !== id));
  };

  const updateIndicatorParams = (id: string, params: { [key: string]: number | string }) => {
    setSelectedIndicators(selectedIndicators.map(ind =>
      ind.id === id ? { ...ind, params: { ...ind.params, ...params } } : ind
    ));
  };

  const addCondition = () => {
    const newCondition: Condition = {
      id: `cond_${Date.now()}`,
      indicator: selectedIndicators[0]?.id || '',
      operator: '>',
      value: 0,
      logic: conditions.length > 0 ? 'AND' : ''
    };
    setConditions([...conditions, newCondition]);
  };

  const updateCondition = (id: string, updates: Partial<Condition>) => {
    setConditions(conditions.map(cond =>
      cond.id === id ? { ...cond, ...updates } : cond
    ));
  };

  const removeCondition = (id: string) => {
    setConditions(conditions.filter(cond => cond.id !== id));
  };

  const handleSave = async () => {
    if (!strategyName.trim()) {
      setMessage({ type: 'danger', text: 'Please enter a strategy name' });
      return;
    }

    setMessage(null);

    const formData = {
      strategy_id: editingStrategy?.id || null,
      strategy: strategyType,
      'strategy-name': strategyName,
      instrument,
      segment,
      'candle-time': candleTime,
      'execution-start': executionStart,
      'execution-end': executionEnd,
      'stop-loss': stopLoss,
      'target-profit': targetProfit,
      'trailing-stop-loss': trailingStopLoss,
      'total-lot': totalLot,
      'trade-type': tradeType,
      'strike-price': strikePrice,
      'expiry-type': expiryType,
      paper_trade: paperTrade,
      indicators: selectedIndicators,
      conditions: conditions,
    };

    try {
      const response = await fetch(apiUrl('/api/strategy/save'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message || 'Strategy saved successfully!' });
        setTimeout(() => {
          onStrategySaved();
          // Reset form if not editing
          if (!editingStrategy) {
            setStrategyName('');
            setSelectedIndicators([]);
            setConditions([]);
          }
        }, 1000);
      } else {
        setMessage({ type: 'danger', text: data.message || 'Failed to save strategy.' });
      }
    } catch (error) {
      console.error('Error saving strategy:', error);
      setMessage({ type: 'danger', text: 'An error occurred. Please try again.' });
    }
  };

  return (
    <div className="accordion-item">
      <h2 className="accordion-header" id="headingOne">
        <button
          className="accordion-button"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#collapseOne"
          aria-expanded="true"
          aria-controls="collapseOne"
        >
          <i className="bi bi-gear-wide-connected me-2"></i>
          {editingStrategy ? 'Edit Strategy' : 'Strategy Builder'}
        </button>
      </h2>
      <div id="collapseOne" className="accordion-collapse collapse show" aria-labelledby="headingOne" data-bs-parent="#dashboardAccordion">
        <div className="accordion-body">
          {message && (
            <div className={`alert alert-${message.type} alert-dismissible fade show`} role="alert">
              {message.text}
              <button type="button" className="btn-close" onClick={() => setMessage(null)}></button>
            </div>
          )}

          {/* Tab Navigation */}
          <ul className="nav nav-tabs mb-4" role="tablist">
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'basic' ? 'active' : ''}`}
                onClick={() => setActiveTab('basic')}
              >
                <i className="bi bi-info-circle me-2"></i>Basic Settings
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'advanced' ? 'active' : ''}`}
                onClick={() => setActiveTab('advanced')}
              >
                <i className="bi bi-graph-up-arrow me-2"></i>Indicators & Conditions
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'risk' ? 'active' : ''}`}
                onClick={() => setActiveTab('risk')}
              >
                <i className="bi bi-shield-check me-2"></i>Risk Management
              </button>
            </li>
          </ul>

          {/* Tab Content */}
          <div className="tab-content">
            {/* Basic Settings Tab */}
            {activeTab === 'basic' && (
              <div className="row">
                <div className="col-md-6 mb-3">
                  <label className="form-label fw-bold">Strategy Name *</label>
                  <input
                    type="text"
                    className="form-control"
                    value={strategyName}
                    onChange={(e) => setStrategyName(e.target.value)}
                    placeholder="Enter strategy name"
                    required
                  />
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label fw-bold">Strategy Type</label>
                  <select
                    className="form-select"
                    value={strategyType}
                    onChange={(e) => setStrategyType(e.target.value)}
                  >
                    <option value="orb">Opening Range Breakout (ORB)</option>
                    <option value="capture_mountain_signal">Capture Mountain Signal</option>
                    <option value="custom">Custom (Indicator-Based)</option>
                  </select>
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label fw-bold">Instrument</label>
                  <select
                    className="form-select"
                    value={instrument}
                    onChange={(e) => setInstrument(e.target.value)}
                  >
                    <option value="NIFTY">NIFTY</option>
                    <option value="BANKNIFTY">BANKNIFTY</option>
                    <option value="FINNIFTY">FINNIFTY</option>
                  </select>
                </div>
                <div className="col-md-6 mb-3">
                  <label className="form-label fw-bold">Segment</label>
                  <select
                    className="form-select"
                    value={segment}
                    onChange={(e) => setSegment(e.target.value)}
                  >
                    <option value="Option">Option</option>
                    <option value="Future">Future</option>
                    <option value="Equity">Equity</option>
                  </select>
                </div>
                <div className="col-md-4 mb-3">
                  <label className="form-label fw-bold">Candle Time (minutes)</label>
                  <select
                    className="form-select"
                    value={candleTime}
                    onChange={(e) => setCandleTime(e.target.value)}
                  >
                    <option value="1">1 min</option>
                    <option value="3">3 min</option>
                    <option value="5">5 min</option>
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                    <option value="60">60 min</option>
                  </select>
                </div>
                <div className="col-md-4 mb-3">
                  <label className="form-label fw-bold">Execution Start</label>
                  <input
                    type="time"
                    className="form-control"
                    value={executionStart}
                    onChange={(e) => setExecutionStart(e.target.value)}
                  />
                </div>
                <div className="col-md-4 mb-3">
                  <label className="form-label fw-bold">Execution End</label>
                  <input
                    type="time"
                    className="form-control"
                    value={executionEnd}
                    onChange={(e) => setExecutionEnd(e.target.value)}
                  />
                </div>
                {segment === 'Option' && (
                  <>
                    <div className="col-md-4 mb-3">
                      <label className="form-label fw-bold">Trade Type</label>
                      <select
                        className="form-select"
                        value={tradeType}
                        onChange={(e) => setTradeType(e.target.value)}
                      >
                        <option value="Buy">Buy</option>
                        <option value="Sell">Sell</option>
                      </select>
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label fw-bold">Strike Price</label>
                      <select
                        className="form-select"
                        value={strikePrice}
                        onChange={(e) => setStrikePrice(e.target.value)}
                      >
                        <option value="ATM">ATM</option>
                        <option value="ITM">ITM</option>
                        <option value="OTM">OTM</option>
                      </select>
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label fw-bold">Expiry Type</label>
                      <select
                        className="form-select"
                        value={expiryType}
                        onChange={(e) => setExpiryType(e.target.value)}
                      >
                        <option value="Weekly">Weekly</option>
                        <option value="Monthly">Monthly</option>
                      </select>
                    </div>
                  </>
                )}
                <div className="col-md-6 mb-3">
                  <label className="form-label fw-bold">Total Lot</label>
                  <input
                    type="number"
                    className="form-control"
                    value={totalLot}
                    onChange={(e) => setTotalLot(Number(e.target.value))}
                    min="1"
                  />
                </div>
                <div className="col-md-6 mb-3 form-check mt-4">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id="paper-trade"
                    checked={paperTrade}
                    onChange={(e) => setPaperTrade(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="paper-trade">
                    Paper Trade (Virtual Trading)
                  </label>
                </div>
              </div>
            )}

            {/* Indicators & Conditions Tab */}
            {activeTab === 'advanced' && (
              <div>
                <div className="card mb-4">
                  <div className="card-header bg-info text-white">
                    <h6 className="mb-0"><i className="bi bi-graph-up me-2"></i>Technical Indicators</h6>
                  </div>
                  <div className="card-body">
                    <div className="row mb-3">
                      <div className="col-md-6">
                        <select
                          className="form-select"
                          onChange={(e) => {
                            if (e.target.value) {
                              addIndicator(e.target.value);
                              e.target.value = '';
                            }
                          }}
                        >
                          <option value="">Add Indicator...</option>
                          {availableIndicators.map(ind => (
                            <option key={ind.id} value={ind.id}>{ind.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {selectedIndicators.map(indicator => (
                      <div key={indicator.id} className="card mb-2">
                        <div className="card-body">
                          <div className="d-flex justify-content-between align-items-center mb-2">
                            <h6 className="mb-0">{indicator.name}</h6>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => removeIndicator(indicator.id)}
                            >
                              <i className="bi bi-trash"></i>
                            </button>
                          </div>
                          <div className="row">
                            {Object.entries(indicator.params).map(([key, value]) => (
                              <div key={key} className="col-md-4 mb-2">
                                <label className="form-label small text-capitalize">{key.replace('_', ' ')}</label>
                                <input
                                  type="number"
                                  className="form-control form-control-sm"
                                  value={value}
                                  onChange={(e) => updateIndicatorParams(indicator.id, { [key]: Number(e.target.value) })}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="card-header bg-warning text-dark">
                    <h6 className="mb-0"><i className="bi bi-diagram-3 me-2"></i>Trading Conditions</h6>
                  </div>
                  <div className="card-body">
                    <button className="btn btn-sm btn-primary mb-3" onClick={addCondition}>
                      <i className="bi bi-plus-circle me-2"></i>Add Condition
                    </button>
                    {conditions.map((condition, index) => (
                      <div key={condition.id} className="card mb-2">
                        <div className="card-body">
                          <div className="row align-items-center">
                            {index > 0 && (
                              <div className="col-md-2 mb-2">
                                <select
                                  className="form-select form-select-sm"
                                  value={condition.logic}
                                  onChange={(e) => updateCondition(condition.id, { logic: e.target.value as 'AND' | 'OR' })}
                                >
                                  <option value="AND">AND</option>
                                  <option value="OR">OR</option>
                                </select>
                              </div>
                            )}
                            <div className="col-md-3 mb-2">
                              <select
                                className="form-select form-select-sm"
                                value={condition.indicator}
                                onChange={(e) => updateCondition(condition.id, { indicator: e.target.value })}
                              >
                                <option value="">Select Indicator</option>
                                {selectedIndicators.map(ind => (
                                  <option key={ind.id} value={ind.id}>{ind.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="col-md-2 mb-2">
                              <select
                                className="form-select form-select-sm"
                                value={condition.operator}
                                onChange={(e) => updateCondition(condition.id, { operator: e.target.value as any })}
                              >
                                <option value=">">Greater Than</option>
                                <option value="<">Less Than</option>
                                <option value=">=">Greater or Equal</option>
                                <option value="<=">Less or Equal</option>
                                <option value="==">Equal To</option>
                                <option value="cross_above">Cross Above</option>
                                <option value="cross_below">Cross Below</option>
                              </select>
                            </div>
                            <div className="col-md-3 mb-2">
                              <input
                                type="number"
                                className="form-control form-control-sm"
                                value={condition.value}
                                onChange={(e) => updateCondition(condition.id, { value: Number(e.target.value) })}
                                placeholder="Value"
                              />
                            </div>
                            <div className="col-md-2 mb-2">
                              <button
                                className="btn btn-sm btn-danger w-100"
                                onClick={() => removeCondition(condition.id)}
                              >
                                <i className="bi bi-trash"></i>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {conditions.length === 0 && (
                      <p className="text-muted text-center py-3">No conditions added. Add conditions to create entry/exit rules.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Risk Management Tab */}
            {activeTab === 'risk' && (
              <div className="row">
                <div className="col-md-4 mb-3">
                  <label className="form-label fw-bold">Stop Loss (%)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={stopLoss}
                    onChange={(e) => setStopLoss(Number(e.target.value))}
                    min="0"
                    step="0.1"
                  />
                  <small className="text-muted">Percentage loss to exit trade</small>
                </div>
                <div className="col-md-4 mb-3">
                  <label className="form-label fw-bold">Target Profit (%)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={targetProfit}
                    onChange={(e) => setTargetProfit(Number(e.target.value))}
                    min="0"
                    step="0.1"
                  />
                  <small className="text-muted">Percentage profit to exit trade</small>
                </div>
                <div className="col-md-4 mb-3">
                  <label className="form-label fw-bold">Trailing Stop Loss (%)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={trailingStopLoss}
                    onChange={(e) => setTrailingStopLoss(Number(e.target.value))}
                    min="0"
                    step="0.1"
                  />
                  <small className="text-muted">Trailing stop to protect profits</small>
                </div>
                <div className="col-12">
                  <div className="card bg-light">
                    <div className="card-body">
                      <h6 className="card-title">Risk Summary</h6>
                      <div className="row">
                        <div className="col-md-4">
                          <p className="mb-1"><strong>Risk/Reward Ratio:</strong></p>
                          <p className="text-primary">1 : {(targetProfit / stopLoss).toFixed(2)}</p>
                        </div>
                        <div className="col-md-4">
                          <p className="mb-1"><strong>Max Loss per Trade:</strong></p>
                          <p className="text-danger">₹{((stopLoss / 100) * totalLot * 50).toFixed(2)}</p>
                        </div>
                        <div className="col-md-4">
                          <p className="mb-1"><strong>Max Profit per Trade:</strong></p>
                          <p className="text-success">₹{((targetProfit / 100) * totalLot * 50).toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Save Button */}
          <div className="mt-4 d-flex justify-content-end gap-2">
            {editingStrategy && (
              <button
                className="btn btn-secondary"
                onClick={() => window.location.reload()}
              >
                Cancel
              </button>
            )}
            <button className="btn btn-primary btn-lg" onClick={handleSave}>
              <i className="bi bi-save me-2"></i>
              {editingStrategy ? 'Update Strategy' : 'Save Strategy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdvancedStrategyBuilder;

