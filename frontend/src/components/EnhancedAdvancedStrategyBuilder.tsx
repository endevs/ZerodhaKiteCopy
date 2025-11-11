import React, { useState, useEffect } from 'react';

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
  conditionType: 'entry' | 'exit';
}

interface EntryExitRule {
  id: string;
  name: string;
  conditions: Condition[];
}

interface EnhancedAdvancedStrategyBuilderProps {
  onStrategySaved: () => void;
  editingStrategy?: any;
  isOpen?: boolean;
  onToggle?: (open: boolean) => void;
}

const EnhancedAdvancedStrategyBuilder: React.FC<EnhancedAdvancedStrategyBuilderProps> = ({ 
  onStrategySaved, 
  editingStrategy,
  isOpen = false,
  onToggle
}) => {
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
  const [entryRules, setEntryRules] = useState<EntryExitRule[]>([]);
  const [exitRules, setExitRules] = useState<EntryExitRule[]>([]);
  const [activeTab, setActiveTab] = useState<'basic' | 'indicators' | 'entry' | 'exit' | 'risk' | 'preview'>('basic');
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [showStrategyInfo, setShowStrategyInfo] = useState<boolean>(false);

  // Strategy type descriptions
  const strategyTypeInfo: { [key: string]: { name: string; description: string; howItWorks: string; bestFor: string; parameters: string } } = {
    'orb': {
      name: 'Opening Range Breakout (ORB)',
      description: 'A breakout trading strategy that identifies and trades breakouts from the opening range of a trading session.',
      howItWorks: 'The strategy defines an opening range (typically the first 15-30 minutes of trading) using high and low prices. It enters a trade when the price breaks above the range high (for long positions) or below the range low (for short positions). The strategy uses stop-loss and target profit levels to manage risk.',
      bestFor: 'Day traders looking for momentum plays at market open. Best suited for volatile instruments like NIFTY and BANKNIFTY options.',
      parameters: 'Key parameters include opening range time, stop loss percentage, target profit percentage, and position sizing.'
    },
    'capture_mountain_signal': {
      name: 'Capture Mountain Signal',
      description: 'A specialized pattern recognition strategy that identifies "mountain" formations in price charts to capture trend reversals.',
      howItWorks: 'The strategy monitors price action to identify mountain-like patterns characterized by significant price peaks and valleys. When a mountain formation is detected with specific confirmation signals, the strategy enters trades anticipating trend reversals or continuation patterns. It uses technical indicators and price action analysis to validate signals.',
      bestFor: 'Swing traders and position traders who can hold trades for extended periods. Works well with options and futures on major indices.',
      parameters: 'Requires pattern confirmation criteria, signal strength thresholds, stop loss levels, and target profit ratios.'
    },
    'custom': {
      name: 'Custom Strategy Builder',
      description: 'Build your own trading strategy using technical indicators, custom entry/exit rules, and advanced risk management.',
      howItWorks: 'You can combine multiple technical indicators (SMA, EMA, RSI, MACD, Bollinger Bands, etc.) with logical conditions (AND/OR) to create complex trading rules. Define entry conditions (when to buy) and exit conditions (when to sell) separately. Add indicators, set parameters, create multiple conditions, and configure risk management settings.',
      bestFor: 'Advanced traders who want full control over their strategy logic. Perfect for backtesting custom trading ideas before live deployment.',
      parameters: 'Fully customizable - add indicators with custom parameters, create entry/exit rules with multiple conditions, and set risk management parameters.'
    }
  };

  // Available Indicators with descriptions
  const availableIndicators = [
    { id: 'sma', name: 'Simple Moving Average (SMA)', type: 'trend' as const, defaultParams: { period: 20 }, description: 'Average price over a period' },
    { id: 'ema', name: 'Exponential Moving Average (EMA)', type: 'trend' as const, defaultParams: { period: 12 }, description: 'Weighted average giving more importance to recent prices' },
    { id: 'wma', name: 'Weighted Moving Average (WMA)', type: 'trend' as const, defaultParams: { period: 20 }, description: 'Linear weighted average' },
    { id: 'rsi', name: 'RSI (Relative Strength Index)', type: 'momentum' as const, defaultParams: { period: 14 }, description: 'Momentum oscillator (0-100)' },
    { id: 'macd', name: 'MACD', type: 'momentum' as const, defaultParams: { fast: 12, slow: 26, signal: 9 }, description: 'Moving Average Convergence Divergence' },
    { id: 'bb', name: 'Bollinger Bands', type: 'volatility' as const, defaultParams: { period: 20, std: 2 }, description: 'Volatility bands around price' },
    { id: 'atr', name: 'ATR (Average True Range)', type: 'volatility' as const, defaultParams: { period: 14 }, description: 'Measures market volatility' },
    { id: 'stoch', name: 'Stochastic Oscillator', type: 'momentum' as const, defaultParams: { k_period: 14, d_period: 3 }, description: 'Momentum indicator comparing closing price to price range' },
    { id: 'obv', name: 'OBV (On-Balance Volume)', type: 'volume' as const, defaultParams: {}, description: 'Volume-based momentum indicator' },
  ];

  // Initialize from editing strategy
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
    if (indicator && !selectedIndicators.find(i => i.id === indicatorId)) {
      const filteredParams: { [key: string]: number | string } = {};
      Object.entries(indicator.defaultParams).forEach(([key, value]) => {
        if (value !== undefined) {
          filteredParams[key] = value as number | string;
        }
      });
      
      const newIndicator: Indicator = {
        id: indicatorId,
        name: indicator.name,
        type: indicator.type,
        params: filteredParams
      };
      setSelectedIndicators([...selectedIndicators, newIndicator]);
    }
  };

  const removeIndicator = (id: string) => {
    setSelectedIndicators(selectedIndicators.filter(ind => ind.id !== id));
  };

  const updateIndicatorParams = (id: string, params: { [key: string]: number | string }) => {
    setSelectedIndicators(selectedIndicators.map(ind =>
      ind.id === id ? { ...ind, params: { ...ind.params, ...params } } : ind
    ));
  };

  const addEntryRule = () => {
    const newRule: EntryExitRule = {
      id: `entry_${Date.now()}`,
      name: `Entry Rule ${entryRules.length + 1}`,
      conditions: []
    };
    setEntryRules([...entryRules, newRule]);
  };

  const addExitRule = () => {
    const newRule: EntryExitRule = {
      id: `exit_${Date.now()}`,
      name: `Exit Rule ${exitRules.length + 1}`,
      conditions: []
    };
    setExitRules([...exitRules, newRule]);
  };

  const addConditionToRule = (ruleId: string, ruleType: 'entry' | 'exit') => {
    const condition: Condition = {
      id: `cond_${Date.now()}`,
      indicator: selectedIndicators[0]?.id || '',
      operator: '>',
      value: 0,
      logic: '',
      conditionType: ruleType
    };
    
    if (ruleType === 'entry') {
      setEntryRules(entryRules.map(rule =>
        rule.id === ruleId ? { ...rule, conditions: [...rule.conditions, condition] } : rule
      ));
    } else {
      setExitRules(exitRules.map(rule =>
        rule.id === ruleId ? { ...rule, conditions: [...rule.conditions, condition] } : rule
      ));
    }
  };

  const removeRule = (ruleId: string, ruleType: 'entry' | 'exit') => {
    if (ruleType === 'entry') {
      setEntryRules(entryRules.filter(rule => rule.id !== ruleId));
    } else {
      setExitRules(exitRules.filter(rule => rule.id !== ruleId));
    }
  };

  const handleSave = async () => {
    if (!strategyName.trim()) {
      setMessage({ type: 'danger', text: 'Please enter a strategy name' });
      return;
    }

    if (strategyType === 'custom' && entryRules.length === 0) {
      setMessage({ type: 'warning', text: 'Please add at least one entry rule for custom strategies' });
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
      entry_rules: entryRules,
      exit_rules: exitRules,
    };

    try {
      const response = await fetch('http://localhost:8000/api/strategy/save', {
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
            setEntryRules([]);
            setExitRules([]);
            setActiveTab('basic');
          }
          // Scroll to Saved Strategies section
          setTimeout(() => {
            const savedStrategiesCollapse = document.getElementById('collapseTwo');
            if (savedStrategiesCollapse) {
              savedStrategiesCollapse.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }, 500);
        }, 1500);
      } else {
        setMessage({ type: 'danger', text: data.message || 'Failed to save strategy.' });
      }
    } catch (error) {
      console.error('Error saving strategy:', error);
      setMessage({ type: 'danger', text: 'An error occurred. Please try again.' });
    }
  };

  // Auto-open when editing
  React.useEffect(() => {
    if (editingStrategy && onToggle) {
      onToggle(true);
    }
  }, [editingStrategy, onToggle]);

  return (
    <div className="accordion-item">
      <h2 className="accordion-header" id="headingOne">
        <button
          className={`accordion-button ${isOpen ? '' : 'collapsed'}`}
          type="button"
          onClick={() => onToggle && onToggle(!isOpen)}
          aria-expanded={isOpen}
          aria-controls="collapseOne"
        >
          <i className="bi bi-sliders me-2"></i>
          <strong>{editingStrategy ? `Edit: ${editingStrategy.strategy_name}` : 'Advanced Strategy Builder'}</strong>
        </button>
      </h2>
      <div 
        id="collapseOne" 
        className={`accordion-collapse collapse ${isOpen ? 'show' : ''}`} 
        aria-labelledby="headingOne" 
        data-bs-parent="#dashboardAccordion"
      >
        <div className="accordion-body" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
          {message && (
            <div className={`alert alert-${message.type} alert-dismissible fade show`} role="alert">
              <i className={`bi ${message.type === 'success' ? 'bi-check-circle' : message.type === 'warning' ? 'bi-exclamation-triangle' : 'bi-x-circle'} me-2`}></i>
              {message.text}
              <button type="button" className="btn-close" onClick={() => setMessage(null)}></button>
            </div>
          )}

          {/* Professional Tab Navigation */}
          <ul className="nav nav-pills mb-4 bg-light p-2 rounded" role="tablist">
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'basic' ? 'active' : ''}`}
                onClick={() => setActiveTab('basic')}
              >
                <i className="bi bi-gear me-2"></i>Basic
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'indicators' ? 'active' : ''}`}
                onClick={() => setActiveTab('indicators')}
                disabled={selectedIndicators.length === 0 && strategyType === 'custom'}
              >
                <i className="bi bi-graph-up-arrow me-2"></i>Indicators
                {selectedIndicators.length > 0 && (
                  <span className="badge bg-primary ms-2">{selectedIndicators.length}</span>
                )}
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'entry' ? 'active' : ''}`}
                onClick={() => setActiveTab('entry')}
                disabled={strategyType !== 'custom'}
              >
                <i className="bi bi-arrow-right-circle me-2"></i>Entry Rules
                {entryRules.length > 0 && (
                  <span className="badge bg-success ms-2">{entryRules.length}</span>
                )}
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'exit' ? 'active' : ''}`}
                onClick={() => setActiveTab('exit')}
                disabled={strategyType !== 'custom'}
              >
                <i className="bi bi-arrow-left-circle me-2"></i>Exit Rules
                {exitRules.length > 0 && (
                  <span className="badge bg-warning ms-2">{exitRules.length}</span>
                )}
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'risk' ? 'active' : ''}`}
                onClick={() => setActiveTab('risk')}
              >
                <i className="bi bi-shield-check me-2"></i>Risk
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'preview' ? 'active' : ''}`}
                onClick={() => { setActiveTab('preview'); setShowPreview(true); }}
              >
                <i className="bi bi-eye me-2"></i>Preview
              </button>
            </li>
          </ul>

          {/* Tab Content */}
          <div className="tab-content">
            {/* Basic Settings Tab */}
            {activeTab === 'basic' && (
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label fw-bold">
                    <i className="bi bi-tag me-2 text-primary"></i>Strategy Name *
                  </label>
                  <input
                    type="text"
                    className="form-control form-control-lg"
                    value={strategyName}
                    onChange={(e) => setStrategyName(e.target.value)}
                    placeholder="e.g., NIFTY ORB Strategy"
                    required
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-bold d-flex align-items-center">
                    <i className="bi bi-diagram-3 me-2 text-primary"></i>Strategy Type
                    <button
                      type="button"
                      className="btn btn-link p-0 ms-2 text-info"
                      style={{ fontSize: '1.1rem', lineHeight: '1', border: 'none', background: 'none' }}
                      onClick={() => setShowStrategyInfo(true)}
                      title="Click for strategy information"
                    >
                      <i className="bi bi-info-circle"></i>
                    </button>
                  </label>
                  <select
                    className="form-select form-select-lg"
                    value={strategyType}
                    onChange={(e) => {
                      setStrategyType(e.target.value);
                      if (e.target.value !== 'custom') {
                        setEntryRules([]);
                        setExitRules([]);
                      }
                    }}
                  >
                    <option value="orb">Opening Range Breakout (ORB)</option>
                    <option value="capture_mountain_signal">Capture Mountain Signal</option>
                    <option value="custom">Custom (Build Your Own)</option>
                  </select>
                  <small className="text-muted">Select "Custom" to build complex indicator-based strategies</small>
                </div>
                
                <div className="col-md-4">
                  <label className="form-label fw-bold">
                    <i className="bi bi-graph-up me-2 text-success"></i>Instrument
                  </label>
                  <select className="form-select" value={instrument} onChange={(e) => setInstrument(e.target.value)}>
                    <option value="NIFTY">NIFTY 50</option>
                    <option value="BANKNIFTY">BANK NIFTY</option>
                    <option value="FINNIFTY">FIN NIFTY</option>
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label fw-bold">
                    <i className="bi bi-layers me-2 text-info"></i>Segment
                  </label>
                  <select className="form-select" value={segment} onChange={(e) => setSegment(e.target.value)}>
                    <option value="Option">Options</option>
                    <option value="Future">Futures</option>
                    <option value="Equity">Equity</option>
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label fw-bold">
                    <i className="bi bi-clock me-2 text-warning"></i>Candle Timeframe
                  </label>
                  <select className="form-select" value={candleTime} onChange={(e) => setCandleTime(e.target.value)}>
                    <option value="1">1 Minute</option>
                    <option value="3">3 Minutes</option>
                    <option value="5">5 Minutes</option>
                    <option value="15">15 Minutes</option>
                    <option value="30">30 Minutes</option>
                    <option value="60">1 Hour</option>
                  </select>
                </div>

                <div className="col-md-4">
                  <label className="form-label fw-bold">
                    <i className="bi bi-play-circle me-2 text-success"></i>Execution Start
                  </label>
                  <input
                    type="time"
                    className="form-control"
                    value={executionStart}
                    onChange={(e) => setExecutionStart(e.target.value)}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label fw-bold">
                    <i className="bi bi-stop-circle me-2 text-danger"></i>Execution End
                  </label>
                  <input
                    type="time"
                    className="form-control"
                    value={executionEnd}
                    onChange={(e) => setExecutionEnd(e.target.value)}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label fw-bold">
                    <i className="bi bi-box-seam me-2 text-primary"></i>Total Lots
                  </label>
                  <input
                    type="number"
                    className="form-control"
                    value={totalLot}
                    onChange={(e) => setTotalLot(Number(e.target.value))}
                    min="1"
                  />
                </div>

                {segment === 'Option' && (
                  <>
                    <div className="col-md-4">
                      <label className="form-label fw-bold">
                        <i className="bi bi-arrow-up-down me-2"></i>Trade Type
                      </label>
                      <select className="form-select" value={tradeType} onChange={(e) => setTradeType(e.target.value)}>
                        <option value="Buy">Buy (Long)</option>
                        <option value="Sell">Sell (Short)</option>
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label fw-bold">
                        <i className="bi bi-bullseye me-2"></i>Strike Price
                      </label>
                      <select className="form-select" value={strikePrice} onChange={(e) => setStrikePrice(e.target.value)}>
                        <option value="ATM">ATM (At The Money)</option>
                        <option value="ITM">ITM (In The Money)</option>
                        <option value="OTM">OTM (Out The Money)</option>
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label fw-bold">
                        <i className="bi bi-calendar-event me-2"></i>Expiry Type
                      </label>
                      <select className="form-select" value={expiryType} onChange={(e) => setExpiryType(e.target.value)}>
                        <option value="Weekly">Weekly</option>
                        <option value="Monthly">Monthly</option>
                      </select>
                    </div>
                  </>
                )}

                <div className="col-12">
                  <div className="form-check form-switch">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="paper-trade-switch"
                      checked={paperTrade}
                      onChange={(e) => setPaperTrade(e.target.checked)}
                      style={{ width: '3rem', height: '1.5rem' }}
                    />
                    <label className="form-check-label fw-bold" htmlFor="paper-trade-switch">
                      <i className="bi bi-file-earmark-text me-2"></i>
                      Paper Trade Mode (Virtual Trading - No Real Money)
                    </label>
                  </div>
                  <small className="text-muted d-block ms-5">Test your strategy without risking real capital</small>
                </div>
              </div>
            )}

            {/* Indicators Tab */}
            {activeTab === 'indicators' && (
              <div>
                <div className="card border-primary mb-4">
                  <div className="card-header bg-primary text-white">
                    <h6 className="mb-0">
                      <i className="bi bi-graph-up-arrow me-2"></i>
                      Add Technical Indicators
                    </h6>
                  </div>
                  <div className="card-body">
                    <div className="row g-2">
                      {availableIndicators.map(ind => (
                        <div key={ind.id} className="col-md-6 col-lg-4">
                          <button
                            className={`btn w-100 ${selectedIndicators.find(s => s.id === ind.id) ? 'btn-success' : 'btn-outline-primary'}`}
                            onClick={() => {
                              if (selectedIndicators.find(s => s.id === ind.id)) {
                                removeIndicator(ind.id);
                              } else {
                                addIndicator(ind.id);
                              }
                            }}
                            type="button"
                          >
                            <div className="text-start">
                              <div className="fw-bold">{ind.name}</div>
                              <small className="text-muted d-block">{ind.description}</small>
                              <span className={`badge ${ind.type === 'trend' ? 'bg-info' : ind.type === 'momentum' ? 'bg-warning' : ind.type === 'volatility' ? 'bg-danger' : 'bg-secondary'} mt-1`}>
                                {ind.type}
                              </span>
                            </div>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {selectedIndicators.length > 0 && (
                  <div className="card border-success">
                    <div className="card-header bg-success text-white">
                      <h6 className="mb-0">
                        <i className="bi bi-list-check me-2"></i>
                        Selected Indicators ({selectedIndicators.length})
                      </h6>
                    </div>
                    <div className="card-body">
                      {selectedIndicators.map(indicator => {
                        const indicatorInfo = availableIndicators.find(i => i.id === indicator.id);
                        return (
                          <div key={indicator.id} className="card mb-3 border-info">
                            <div className="card-header bg-light d-flex justify-content-between align-items-center">
                              <div>
                                <strong>{indicatorInfo?.name}</strong>
                                <span className={`badge ms-2 ${indicator.type === 'trend' ? 'bg-info' : indicator.type === 'momentum' ? 'bg-warning' : indicator.type === 'volatility' ? 'bg-danger' : 'bg-secondary'}`}>
                                  {indicator.type}
                                </span>
                              </div>
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={() => removeIndicator(indicator.id)}
                                title="Remove Indicator"
                              >
                                <i className="bi bi-trash"></i>
                              </button>
                            </div>
                            <div className="card-body">
                              <div className="row g-2">
                                {Object.entries(indicator.params).map(([key, value]) => (
                                  <div key={key} className="col-md-4">
                                    <label className="form-label small text-capitalize fw-bold">
                                      {key.replace(/_/g, ' ')}
                                    </label>
                                    <input
                                      type="number"
                                      className="form-control"
                                      value={value}
                                      onChange={(e) => updateIndicatorParams(indicator.id, { [key]: Number(e.target.value) })}
                                      min="1"
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Entry Rules Tab */}
            {activeTab === 'entry' && (
              <div>
                <div className="alert alert-info">
                  <i className="bi bi-info-circle me-2"></i>
                  <strong>Entry Rules:</strong> Define when to enter a trade. Add multiple rules with AND/OR logic for complex strategies.
                </div>
                
                <button className="btn btn-success mb-3" onClick={addEntryRule}>
                  <i className="bi bi-plus-circle me-2"></i>Add Entry Rule
                </button>

                {entryRules.map((rule, ruleIndex) => (
                  <div key={rule.id} className="card mb-3 border-success">
                    <div className="card-header bg-success text-white d-flex justify-content-between align-items-center">
                      <div>
                        <i className="bi bi-arrow-right-circle me-2"></i>
                        <strong>{rule.name}</strong>
                      </div>
                      <button
                        className="btn btn-sm btn-light"
                        onClick={() => removeRule(rule.id, 'entry')}
                      >
                        <i className="bi bi-trash"></i>
                      </button>
                    </div>
                    <div className="card-body">
                      <input
                        type="text"
                        className="form-control mb-3"
                        value={rule.name}
                        onChange={(e) => {
                          setEntryRules(entryRules.map(r => r.id === rule.id ? { ...r, name: e.target.value } : r));
                        }}
                        placeholder="Rule name"
                      />
                      <button
                        className="btn btn-sm btn-primary mb-2"
                        onClick={() => addConditionToRule(rule.id, 'entry')}
                        disabled={selectedIndicators.length === 0}
                      >
                        <i className="bi bi-plus me-2"></i>Add Condition
                      </button>
                      {rule.conditions.map((condition, condIndex) => (
                        <div key={condition.id} className="card mb-2 bg-light">
                          <div className="card-body">
                            <div className="row align-items-center g-2">
                              {condIndex > 0 && (
                                <div className="col-md-2">
                                  <select
                                    className="form-select form-select-sm"
                                    value={condition.logic}
                                    onChange={(e) => {
                                      const updatedConditions = rule.conditions.map(c =>
                                        c.id === condition.id ? { ...c, logic: e.target.value as 'AND' | 'OR' } : c
                                      );
                                      setEntryRules(entryRules.map(r =>
                                        r.id === rule.id ? { ...r, conditions: updatedConditions } : r
                                      ));
                                    }}
                                  >
                                    <option value="AND">AND</option>
                                    <option value="OR">OR</option>
                                  </select>
                                </div>
                              )}
                              <div className="col-md-3">
                                <select
                                  className="form-select form-select-sm"
                                  value={condition.indicator}
                                  onChange={(e) => {
                                    const updatedConditions = rule.conditions.map(c =>
                                      c.id === condition.id ? { ...c, indicator: e.target.value } : c
                                    );
                                    setEntryRules(entryRules.map(r =>
                                      r.id === rule.id ? { ...r, conditions: updatedConditions } : r
                                    ));
                                  }}
                                >
                                  <option value="">Select Indicator</option>
                                  {selectedIndicators.map(ind => (
                                    <option key={ind.id} value={ind.id}>{ind.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="col-md-2">
                                <select
                                  className="form-select form-select-sm"
                                  value={condition.operator}
                                  onChange={(e) => {
                                    const updatedConditions = rule.conditions.map(c =>
                                      c.id === condition.id ? { ...c, operator: e.target.value as any } : c
                                    );
                                    setEntryRules(entryRules.map(r =>
                                      r.id === rule.id ? { ...r, conditions: updatedConditions } : r
                                    ));
                                  }}
                                >
                                  <option value=">">&gt;</option>
                                  <option value="<">&lt;</option>
                                  <option value=">=">&gt;=</option>
                                  <option value="<=">&lt;=</option>
                                  <option value="==">=</option>
                                  <option value="cross_above">Cross Above</option>
                                  <option value="cross_below">Cross Below</option>
                                </select>
                              </div>
                              <div className="col-md-3">
                                <input
                                  type="number"
                                  className="form-control form-control-sm"
                                  value={condition.value}
                                  onChange={(e) => {
                                    const updatedConditions = rule.conditions.map(c =>
                                      c.id === condition.id ? { ...c, value: Number(e.target.value) } : c
                                    );
                                    setEntryRules(entryRules.map(r =>
                                      r.id === rule.id ? { ...r, conditions: updatedConditions } : r
                                    ));
                                  }}
                                  placeholder="Value"
                                  step="0.01"
                                />
                              </div>
                              <div className="col-md-2">
                                <button
                                  className="btn btn-sm btn-danger w-100"
                                  onClick={() => {
                                    const updatedConditions = rule.conditions.filter(c => c.id !== condition.id);
                                    setEntryRules(entryRules.map(r =>
                                      r.id === rule.id ? { ...r, conditions: updatedConditions } : r
                                    ));
                                  }}
                                >
                                  <i className="bi bi-trash"></i>
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                      {rule.conditions.length === 0 && (
                        <p className="text-muted text-center py-2">No conditions added. Add at least one condition for this rule.</p>
                      )}
                    </div>
                  </div>
                ))}
                {entryRules.length === 0 && (
                  <div className="alert alert-warning">
                    <i className="bi bi-exclamation-triangle me-2"></i>
                    No entry rules defined. Add at least one entry rule to define when trades should be entered.
                  </div>
                )}
              </div>
            )}

            {/* Exit Rules Tab */}
            {activeTab === 'exit' && (
              <div>
                <div className="alert alert-warning">
                  <i className="bi bi-info-circle me-2"></i>
                  <strong>Exit Rules:</strong> Define when to exit a trade. These work alongside Stop Loss and Target Profit.
                </div>
                
                <button className="btn btn-warning mb-3" onClick={addExitRule}>
                  <i className="bi bi-plus-circle me-2"></i>Add Exit Rule
                </button>

                {exitRules.map((rule) => (
                  <div key={rule.id} className="card mb-3 border-warning">
                    <div className="card-header bg-warning text-dark d-flex justify-content-between align-items-center">
                      <div>
                        <i className="bi bi-arrow-left-circle me-2"></i>
                        <strong>{rule.name}</strong>
                      </div>
                      <button
                        className="btn btn-sm btn-light"
                        onClick={() => removeRule(rule.id, 'exit')}
                      >
                        <i className="bi bi-trash"></i>
                      </button>
                    </div>
                    <div className="card-body">
                      <input
                        type="text"
                        className="form-control mb-3"
                        value={rule.name}
                        onChange={(e) => {
                          setExitRules(exitRules.map(r => r.id === rule.id ? { ...r, name: e.target.value } : r));
                        }}
                        placeholder="Rule name"
                      />
                      <button
                        className="btn btn-sm btn-primary mb-2"
                        onClick={() => addConditionToRule(rule.id, 'exit')}
                        disabled={selectedIndicators.length === 0}
                      >
                        <i className="bi bi-plus me-2"></i>Add Condition
                      </button>
                      {/* Similar condition structure as entry rules */}
                      {rule.conditions.map((condition, condIndex) => (
                        <div key={condition.id} className="card mb-2 bg-light">
                          <div className="card-body">
                            <div className="row align-items-center g-2">
                              {condIndex > 0 && (
                                <div className="col-md-2">
                                  <select
                                    className="form-select form-select-sm"
                                    value={condition.logic}
                                    onChange={(e) => {
                                      const updatedConditions = rule.conditions.map(c =>
                                        c.id === condition.id ? { ...c, logic: e.target.value as 'AND' | 'OR' } : c
                                      );
                                      setExitRules(exitRules.map(r =>
                                        r.id === rule.id ? { ...r, conditions: updatedConditions } : r
                                      ));
                                    }}
                                  >
                                    <option value="AND">AND</option>
                                    <option value="OR">OR</option>
                                  </select>
                                </div>
                              )}
                              <div className="col-md-3">
                                <select
                                  className="form-select form-select-sm"
                                  value={condition.indicator}
                                  onChange={(e) => {
                                    const updatedConditions = rule.conditions.map(c =>
                                      c.id === condition.id ? { ...c, indicator: e.target.value } : c
                                    );
                                    setExitRules(exitRules.map(r =>
                                      r.id === rule.id ? { ...r, conditions: updatedConditions } : r
                                    ));
                                  }}
                                >
                                  <option value="">Select Indicator</option>
                                  {selectedIndicators.map(ind => (
                                    <option key={ind.id} value={ind.id}>{ind.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="col-md-2">
                                <select
                                  className="form-select form-select-sm"
                                  value={condition.operator}
                                  onChange={(e) => {
                                    const updatedConditions = rule.conditions.map(c =>
                                      c.id === condition.id ? { ...c, operator: e.target.value as any } : c
                                    );
                                    setExitRules(exitRules.map(r =>
                                      r.id === rule.id ? { ...r, conditions: updatedConditions } : r
                                    ));
                                  }}
                                >
                                  <option value=">">&gt;</option>
                                  <option value="<">&lt;</option>
                                  <option value=">=">&gt;=</option>
                                  <option value="<=">&lt;=</option>
                                  <option value="==">=</option>
                                  <option value="cross_above">Cross Above</option>
                                  <option value="cross_below">Cross Below</option>
                                </select>
                              </div>
                              <div className="col-md-3">
                                <input
                                  type="number"
                                  className="form-control form-control-sm"
                                  value={condition.value}
                                  onChange={(e) => {
                                    const updatedConditions = rule.conditions.map(c =>
                                      c.id === condition.id ? { ...c, value: Number(e.target.value) } : c
                                    );
                                    setExitRules(exitRules.map(r =>
                                      r.id === rule.id ? { ...r, conditions: updatedConditions } : r
                                    ));
                                  }}
                                  placeholder="Value"
                                  step="0.01"
                                />
                              </div>
                              <div className="col-md-2">
                                <button
                                  className="btn btn-sm btn-danger w-100"
                                  onClick={() => {
                                    const updatedConditions = rule.conditions.filter(c => c.id !== condition.id);
                                    setExitRules(exitRules.map(r =>
                                      r.id === rule.id ? { ...r, conditions: updatedConditions } : r
                                    ));
                                  }}
                                >
                                  <i className="bi bi-trash"></i>
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Risk Management Tab */}
            {activeTab === 'risk' && (
              <div className="row g-3">
                <div className="col-md-4">
                  <div className="card border-danger">
                    <div className="card-header bg-danger text-white">
                      <h6 className="mb-0">
                        <i className="bi bi-shield-x me-2"></i>Stop Loss
                      </h6>
                    </div>
                    <div className="card-body">
                      <input
                        type="number"
                        className="form-control form-control-lg text-center fw-bold"
                        value={stopLoss}
                        onChange={(e) => setStopLoss(Number(e.target.value))}
                        min="0"
                        step="0.1"
                      />
                      <small className="text-muted d-block mt-2 text-center">Percentage loss to exit trade</small>
                      <div className="mt-3 text-center">
                        <strong className="text-danger">Max Loss: ₹{((stopLoss / 100) * totalLot * 50).toFixed(2)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-md-4">
                  <div className="card border-success">
                    <div className="card-header bg-success text-white">
                      <h6 className="mb-0">
                        <i className="bi bi-trophy me-2"></i>Target Profit
                      </h6>
                    </div>
                    <div className="card-body">
                      <input
                        type="number"
                        className="form-control form-control-lg text-center fw-bold"
                        value={targetProfit}
                        onChange={(e) => setTargetProfit(Number(e.target.value))}
                        min="0"
                        step="0.1"
                      />
                      <small className="text-muted d-block mt-2 text-center">Percentage profit to exit trade</small>
                      <div className="mt-3 text-center">
                        <strong className="text-success">Max Profit: ₹{((targetProfit / 100) * totalLot * 50).toFixed(2)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-md-4">
                  <div className="card border-warning">
                    <div className="card-header bg-warning text-dark">
                      <h6 className="mb-0">
                        <i className="bi bi-arrow-down-up me-2"></i>Trailing Stop Loss
                      </h6>
                    </div>
                    <div className="card-body">
                      <input
                        type="number"
                        className="form-control form-control-lg text-center fw-bold"
                        value={trailingStopLoss}
                        onChange={(e) => setTrailingStopLoss(Number(e.target.value))}
                        min="0"
                        step="0.1"
                      />
                      <small className="text-muted d-block mt-2 text-center">Trailing stop to protect profits</small>
                    </div>
                  </div>
                </div>
                <div className="col-12">
                  <div className="card bg-gradient" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                    <div className="card-body text-white">
                      <h5 className="card-title mb-3">
                        <i className="bi bi-calculator me-2"></i>Risk Analysis Summary
                      </h5>
                      <div className="row">
                        <div className="col-md-3">
                          <div className="text-center p-3 bg-white bg-opacity-20 rounded">
                            <p className="mb-1 small">Risk/Reward Ratio</p>
                            <h3 className="mb-0 fw-bold">1 : {(targetProfit / stopLoss).toFixed(2)}</h3>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="text-center p-3 bg-white bg-opacity-20 rounded">
                            <p className="mb-1 small">Max Loss per Trade</p>
                            <h3 className="mb-0 fw-bold">₹{((stopLoss / 100) * totalLot * 50).toFixed(2)}</h3>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="text-center p-3 bg-white bg-opacity-20 rounded">
                            <p className="mb-1 small">Max Profit per Trade</p>
                            <h3 className="mb-0 fw-bold">₹{((targetProfit / 100) * totalLot * 50).toFixed(2)}</h3>
                          </div>
                        </div>
                        <div className="col-md-3">
                          <div className="text-center p-3 bg-white bg-opacity-20 rounded">
                            <p className="mb-1 small">Total Lot Size</p>
                            <h3 className="mb-0 fw-bold">{totalLot}</h3>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Preview Tab */}
            {activeTab === 'preview' && (
              <div className="card border-info">
                <div className="card-header bg-info text-white">
                  <h5 className="mb-0">
                    <i className="bi bi-eye me-2"></i>Strategy Preview
                  </h5>
                </div>
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-6">
                      <h6 className="fw-bold">Basic Information</h6>
                      <table className="table table-sm">
                        <tbody>
                          <tr>
                            <td><strong>Name:</strong></td>
                            <td>{strategyName || 'Not set'}</td>
                          </tr>
                          <tr>
                            <td><strong>Type:</strong></td>
                            <td>{strategyType}</td>
                          </tr>
                          <tr>
                            <td><strong>Instrument:</strong></td>
                            <td>{instrument}</td>
                          </tr>
                          <tr>
                            <td><strong>Segment:</strong></td>
                            <td>{segment}</td>
                          </tr>
                          <tr>
                            <td><strong>Timeframe:</strong></td>
                            <td>{candleTime} minutes</td>
                          </tr>
                          <tr>
                            <td><strong>Execution:</strong></td>
                            <td>{executionStart} - {executionEnd}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="col-md-6">
                      <h6 className="fw-bold">Risk Parameters</h6>
                      <table className="table table-sm">
                        <tbody>
                          <tr>
                            <td><strong>Stop Loss:</strong></td>
                            <td className="text-danger">{stopLoss}%</td>
                          </tr>
                          <tr>
                            <td><strong>Target Profit:</strong></td>
                            <td className="text-success">{targetProfit}%</td>
                          </tr>
                          <tr>
                            <td><strong>Trailing SL:</strong></td>
                            <td>{trailingStopLoss}%</td>
                          </tr>
                          <tr>
                            <td><strong>Lots:</strong></td>
                            <td>{totalLot}</td>
                          </tr>
                          <tr>
                            <td><strong>Paper Trade:</strong></td>
                            <td>{paperTrade ? 'Yes' : 'No'}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {strategyType === 'custom' && (
                    <>
                      <hr />
                      <h6 className="fw-bold">Indicators ({selectedIndicators.length})</h6>
                      <div className="row g-2">
                        {selectedIndicators.map(ind => (
                          <div key={ind.id} className="col-md-4">
                            <div className="card bg-light">
                              <div className="card-body p-2">
                                <small><strong>{ind.name}</strong></small>
                                <div className="small text-muted">
                                  {Object.entries(ind.params).map(([k, v]) => (
                                    <span key={k}>{k}: {v} </span>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <hr />
                      <div className="row">
                        <div className="col-md-6">
                          <h6 className="fw-bold text-success">Entry Rules ({entryRules.length})</h6>
                          {entryRules.map(rule => (
                            <div key={rule.id} className="card mb-2 border-success">
                              <div className="card-body p-2">
                                <strong>{rule.name}</strong>
                                <div className="small">
                                  {rule.conditions.length} condition(s)
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="col-md-6">
                          <h6 className="fw-bold text-warning">Exit Rules ({exitRules.length})</h6>
                          {exitRules.map(rule => (
                            <div key={rule.id} className="card mb-2 border-warning">
                              <div className="card-body p-2">
                                <strong>{rule.name}</strong>
                                <div className="small">
                                  {rule.conditions.length} condition(s)
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Save Button */}
          <div className="mt-4 d-flex justify-content-between align-items-center">
            <div>
              {editingStrategy && (
                <button
                  className="btn btn-outline-secondary"
                  onClick={() => window.location.reload()}
                >
                  <i className="bi bi-x-circle me-2"></i>Cancel Edit
                </button>
              )}
            </div>
            <button 
              className="btn btn-primary btn-lg px-5" 
              onClick={handleSave}
              disabled={!strategyName.trim()}
            >
              <i className="bi bi-save me-2"></i>
              {editingStrategy ? 'Update Strategy' : 'Save Strategy'}
            </button>
          </div>
        </div>
      </div>

      {/* Strategy Info Modal */}
      {showStrategyInfo && (
        <div 
          className="modal fade show d-block" 
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowStrategyInfo(false)}
        >
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header bg-primary text-white">
                <h5 className="modal-title">
                  <i className="bi bi-info-circle me-2"></i>
                  {strategyTypeInfo[strategyType]?.name || 'Strategy Information'}
                </h5>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => setShowStrategyInfo(false)}
                ></button>
              </div>
              <div className="modal-body">
                {strategyTypeInfo[strategyType] && (
                  <>
                    <div className="mb-4">
                      <h6 className="text-primary mb-2">
                        <i className="bi bi-file-text me-2"></i>Description
                      </h6>
                      <p className="text-muted">{strategyTypeInfo[strategyType].description}</p>
                    </div>

                    <div className="mb-4">
                      <h6 className="text-success mb-2">
                        <i className="bi bi-gear me-2"></i>How It Works
                      </h6>
                      <p className="text-muted">{strategyTypeInfo[strategyType].howItWorks}</p>
                    </div>

                    <div className="mb-4">
                      <h6 className="text-info mb-2">
                        <i className="bi bi-star me-2"></i>Best For
                      </h6>
                      <p className="text-muted">{strategyTypeInfo[strategyType].bestFor}</p>
                    </div>

                    <div className="mb-3">
                      <h6 className="text-warning mb-2">
                        <i className="bi bi-sliders me-2"></i>Key Parameters
                      </h6>
                      <p className="text-muted">{strategyTypeInfo[strategyType].parameters}</p>
                    </div>
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowStrategyInfo(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhancedAdvancedStrategyBuilder;

