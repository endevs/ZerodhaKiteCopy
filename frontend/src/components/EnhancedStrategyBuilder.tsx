import React, { useState } from 'react';

interface Indicator {
  id: string;
  name: string;
  type: 'trend' | 'momentum' | 'volatility' | 'volume';
  params: { [key: string]: number | string };
}

interface Condition {
  id: string;
  indicator: string;
  operator: '>' | '<' | '>=' | '<=' | '==';
  value: number;
  logic: 'AND' | 'OR' | '';
}

const EnhancedStrategyBuilder: React.FC = () => {
  const [strategyName, setStrategyName] = useState<string>('');
  const [selectedIndicators, setSelectedIndicators] = useState<Indicator[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [timeframe, setTimeframe] = useState<string>('5min');
  const [instrument, setInstrument] = useState<string>('NIFTY');

  const availableIndicators = [
    { id: 'sma', name: 'Simple Moving Average', type: 'trend' as const, defaultParams: { period: 20 } },
    { id: 'ema', name: 'Exponential Moving Average', type: 'trend' as const, defaultParams: { period: 12 } },
    { id: 'rsi', name: 'RSI', type: 'momentum' as const, defaultParams: { period: 14 } },
    { id: 'macd', name: 'MACD', type: 'momentum' as const, defaultParams: { fast: 12, slow: 26, signal: 9 } },
    { id: 'bb', name: 'Bollinger Bands', type: 'volatility' as const, defaultParams: { period: 20, std: 2 } },
    { id: 'atr', name: 'ATR', type: 'volatility' as const, defaultParams: { period: 14 } },
    { id: 'stoch', name: 'Stochastic', type: 'momentum' as const, defaultParams: { k_period: 14, d_period: 3 } },
  ];

  const timeframes = [
    { value: '1min', label: '1 Minute' },
    { value: '5min', label: '5 Minutes' },
    { value: '10min', label: '10 Minutes' },
    { value: '15min', label: '15 Minutes' },
    { value: '30min', label: '30 Minutes' },
    { value: '60min', label: '1 Hour' },
    { value: 'day', label: '1 Day' },
  ];

  const addIndicator = (indicatorId: string) => {
    const indicator = availableIndicators.find(i => i.id === indicatorId);
    if (indicator) {
      // Filter out undefined values and ensure all values are string | number
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
      logic: ''
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

  const saveStrategy = async () => {
    // Implementation will connect to backend
    console.log('Saving strategy:', {
      name: strategyName,
      indicators: selectedIndicators,
      conditions,
      timeframe,
      instrument
    });
  };

  return (
    <div className="container-fluid mt-4">
      <div className="row">
        {/* Left Panel - Strategy Configuration */}
        <div className="col-lg-4">
          <div className="card shadow-sm">
            <div className="card-header bg-primary text-white">
              <h5 className="mb-0">Strategy Builder</h5>
            </div>
            <div className="card-body">
              {/* Strategy Name */}
              <div className="mb-3">
                <label className="form-label">Strategy Name</label>
                <input
                  type="text"
                  className="form-control"
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                  placeholder="Enter strategy name"
                />
              </div>

              {/* Instrument Selection */}
              <div className="mb-3">
                <label className="form-label">Instrument</label>
                <select
                  className="form-select"
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                >
                  <option value="NIFTY">NIFTY</option>
                  <option value="BANKNIFTY">BANKNIFTY</option>
                </select>
              </div>

              {/* Timeframe Selection */}
              <div className="mb-3">
                <label className="form-label">Timeframe</label>
                <select
                  className="form-select"
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                >
                  {timeframes.map(tf => (
                    <option key={tf.value} value={tf.value}>{tf.label}</option>
                  ))}
                </select>
              </div>

              {/* Add Indicators */}
              <div className="mb-3">
                <label className="form-label">Technical Indicators</label>
                <select
                  className="form-select"
                  onChange={(e) => {
                    if (e.target.value) {
                      addIndicator(e.target.value);
                      e.target.value = '';
                    }
                  }}
                >
                  <option value="">Select Indicator...</option>
                  {availableIndicators.map(ind => (
                    <option key={ind.id} value={ind.id}>{ind.name}</option>
                  ))}
                </select>
              </div>

              {/* Selected Indicators */}
              {selectedIndicators.map(indicator => (
                <div key={indicator.id} className="card mb-2">
                  <div className="card-body">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <strong>{indicator.name}</strong>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => removeIndicator(indicator.id)}
                      >
                        ×
                      </button>
                    </div>
                    {Object.entries(indicator.params).map(([key, value]) => (
                      <div key={key} className="mb-2">
                        <label className="form-label small">{key}</label>
                        <input
                          type="number"
                          className="form-control form-control-sm"
                          value={value as number}
                          onChange={(e) => updateIndicatorParams(indicator.id, {
                            [key]: parseFloat(e.target.value) || 0
                          })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Strategy Conditions */}
              <div className="mb-3">
                <label className="form-label">Strategy Conditions</label>
                <button
                  className="btn btn-sm btn-primary w-100 mb-2"
                  onClick={addCondition}
                  disabled={selectedIndicators.length === 0}
                >
                  + Add Condition
                </button>

                {conditions.map((cond, index) => (
                  <div key={cond.id} className="card mb-2">
                    <div className="card-body">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <strong>Condition {index + 1}</strong>
                        {index > 0 && (
                          <select
                            className="form-select form-select-sm"
                            style={{ width: 'auto' }}
                            value={cond.logic}
                            onChange={(e) => updateCondition(cond.id, { logic: e.target.value as 'AND' | 'OR' })}
                          >
                            <option value="">---</option>
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                          </select>
                        )}
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => removeCondition(cond.id)}
                        >
                          ×
                        </button>
                      </div>
                      <div className="row g-2">
                        <div className="col-5">
                          <select
                            className="form-select form-select-sm"
                            value={cond.indicator}
                            onChange={(e) => updateCondition(cond.id, { indicator: e.target.value })}
                          >
                            <option value="">Select...</option>
                            {selectedIndicators.map(ind => (
                              <option key={ind.id} value={ind.id}>{ind.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-3">
                          <select
                            className="form-select form-select-sm"
                            value={cond.operator}
                            onChange={(e) => updateCondition(cond.id, { operator: e.target.value as any })}
                          >
                            <option value=">">&gt;</option>
                            <option value="<">&lt;</option>
                            <option value=">=">&gt;=</option>
                            <option value="<=">&lt;=</option>
                            <option value="==">==</option>
                          </select>
                        </div>
                        <div className="col-4">
                          <input
                            type="number"
                            className="form-control form-control-sm"
                            value={cond.value}
                            onChange={(e) => updateCondition(cond.id, { value: parseFloat(e.target.value) || 0 })}
                            step="0.01"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Save Button */}
              <button
                className="btn btn-success w-100"
                onClick={saveStrategy}
                disabled={!strategyName || selectedIndicators.length === 0}
              >
                Save Strategy
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel - Preview */}
        <div className="col-lg-8">
          <div className="card shadow-sm">
            <div className="card-header bg-info text-white">
              <h5 className="mb-0">Strategy Preview</h5>
            </div>
            <div className="card-body">
              <div className="alert alert-info">
                <strong>Strategy Logic:</strong>
                <div className="mt-2">
                  {conditions.length === 0 ? (
                    <span className="text-muted">No conditions defined yet</span>
                  ) : (
                    conditions.map((cond, index) => {
                      const indicator = selectedIndicators.find(ind => ind.id === cond.indicator);
                      return (
                        <span key={cond.id}>
                          {index > 0 && <span className="badge bg-secondary mx-1">{cond.logic}</span>}
                          <code>
                            {indicator?.name || 'Indicator'} {cond.operator} {cond.value}
                          </code>
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-3">
                <h6>Selected Indicators:</h6>
                <ul>
                  {selectedIndicators.map(ind => (
                    <li key={ind.id}>
                      {ind.name} ({Object.entries(ind.params).map(([k, v]) => `${k}: ${v}`).join(', ')})
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-3">
                <small className="text-muted">
                  <strong>Instrument:</strong> {instrument} | 
                  <strong> Timeframe:</strong> {timeframes.find(tf => tf.value === timeframe)?.label}
                </small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnhancedStrategyBuilder;

