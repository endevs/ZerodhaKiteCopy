import React, { useState, useEffect, useRef } from 'react';
import EnhancedAdvancedStrategyBuilder from './EnhancedAdvancedStrategyBuilder';

// Enhanced Market Data Component
const MarketData: React.FC<{ niftyPrice: string; bankNiftyPrice: string }> = ({ niftyPrice, bankNiftyPrice }) => (
  <div className="card shadow-sm border-0 mb-4">
    <div className="card-header bg-primary text-white">
      <h5 className="card-title mb-0">
        <i className="bi bi-graph-up-arrow me-2"></i>Live Market Data
      </h5>
    </div>
    <div className="card-body">
      <div className="row g-3">
        <div className="col-md-6">
          <div className="d-flex align-items-center p-3 bg-light rounded">
            <div className="flex-grow-1">
              <small className="text-muted d-block">NIFTY 50</small>
              <h4 className="mb-0 fw-bold text-primary" id="nifty-price">{niftyPrice}</h4>
            </div>
            <div className="ms-3">
              <span className="badge bg-success fs-6">LIVE</span>
            </div>
          </div>
        </div>
        <div className="col-md-6">
          <div className="d-flex align-items-center p-3 bg-light rounded">
            <div className="flex-grow-1">
              <small className="text-muted d-block">BANK NIFTY</small>
              <h4 className="mb-0 fw-bold text-info" id="banknifty-price">{bankNiftyPrice}</h4>
            </div>
            <div className="ms-3">
              <span className="badge bg-success fs-6">LIVE</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// Enhanced Account Info Component
const AccountInfo: React.FC<{ balance: string; access_token: boolean }> = ({ balance, access_token }) => (
  <div className="card shadow-sm border-0 mb-4">
    <div className="card-header bg-success text-white">
      <h5 className="card-title mb-0">
        <i className="bi bi-wallet2 me-2"></i>Account Information
      </h5>
    </div>
    <div className="card-body">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <span className="text-muted">Available Balance:</span>
        <h4 className="mb-0 fw-bold text-success" id="balance">₹{balance}</h4>
      </div>
      {!access_token && (
        <a href="http://localhost:8000/zerodha_login" className="btn btn-primary w-100">
          <i className="bi bi-box-arrow-in-right me-2"></i>Connect with Zerodha
        </a>
      )}
    </div>
  </div>
);

const StrategyConfiguration: React.FC<{ 
  onStrategySaved: () => void; 
  editingStrategy?: any;
  isOpen?: boolean;
  onToggle?: (open: boolean) => void;
}> = ({ onStrategySaved, editingStrategy, isOpen, onToggle }) => {
  return <EnhancedAdvancedStrategyBuilder 
    onStrategySaved={onStrategySaved} 
    editingStrategy={editingStrategy}
    isOpen={isOpen}
    onToggle={onToggle}
  />;
};

interface Strategy {
  id: string;
  strategy_name: string;
  strategy_type?: string;
  instrument: string;
  expiry_type: string;
  total_lot: number;
  status: string;
  stop_loss?: number;
  target_profit?: number;
  candle_time?: string;
  start_time?: string;
  end_time?: string;
  segment?: string;
  trade_type?: string;
  strike_price?: string;
  trailing_stop_loss?: number;
  indicators?: string; // JSON string
  entry_rules?: string; // JSON string
  exit_rules?: string; // JSON string
  // Add other strategy properties as needed
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface StrategyValidation {
  is_valid: boolean;
  missing_sections: string[];
  warnings: string[];
}

interface SavedStrategiesProps {
  onViewLive: (strategyId: string) => void;
  onStrategyUpdated: number;
  onEditStrategy?: (strategy: Strategy) => void;
  isOpen?: boolean;
  onToggle?: (open: boolean) => void;
  refreshTrigger?: () => void; // Optional manual refresh trigger
}

const SavedStrategies: React.FC<SavedStrategiesProps> = ({ onViewLive, onStrategyUpdated, onEditStrategy, isOpen = false, onToggle, refreshTrigger }) => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategyInfo, setSelectedStrategyInfo] = useState<Strategy | null>(null);
  const [showStrategyInfoModal, setShowStrategyInfoModal] = useState<boolean>(false);

  const fetchStrategies = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/strategies', { credentials: 'include' });
      const data = await response.json();
      if (data.status === 'success') {
        setStrategies(data.strategies);
      } else {
        console.error('Error fetching strategies:', data.message);
      }
    } catch (error) {
      console.error('Error fetching strategies:', error);
    }
  };

  // Expose fetchStrategies to parent via useImperativeHandle or callback
  React.useEffect(() => {
    if (refreshTrigger) {
      // Store the refresh function reference (if we need to expose it)
    }
  }, [refreshTrigger]);

  useEffect(() => {
    fetchStrategies();
  }, [onStrategyUpdated]); // Re-fetch when onStrategyUpdated is called
  
  // Also listen to window events or custom events for refresh
  useEffect(() => {
    const handleRefresh = () => {
      fetchStrategies();
    };
    
    // Listen for custom refresh event
    window.addEventListener('refreshStrategies', handleRefresh);
    
    return () => {
      window.removeEventListener('refreshStrategies', handleRefresh);
    };
  }, []);
  
  // Also fetch on initial load and when the section is expanded
  useEffect(() => {
    const savedStrategiesSection = document.getElementById('collapseTwo');
    if (savedStrategiesSection) {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const target = mutation.target as HTMLElement;
            if (target.classList.contains('show')) {
              // Section is now expanded, refresh strategies
              fetchStrategies();
            }
          }
        });
      });
      
      observer.observe(savedStrategiesSection, {
        attributes: true,
        attributeFilter: ['class']
      });
      
      return () => observer.disconnect();
    }
  }, []);

  const handleEditStrategy = async (strategyId: string) => {
    try {
      const response = await fetch(`http://localhost:8000/strategy/edit/${strategyId}`, { credentials: 'include' });
      const data = await response.json();
      if (response.ok && data.status === 'success') {
        const strategyToEdit = data.strategy;
        if (onEditStrategy) {
          onEditStrategy(strategyToEdit);
        }
        // Scroll to strategy builder
        setTimeout(() => {
          const collapseElement = document.getElementById('collapseOne');
          if (collapseElement) {
            collapseElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // Expand if collapsed
            if (!collapseElement.classList.contains('show')) {
              const bsCollapse = new (window as any).bootstrap.Collapse(collapseElement);
              bsCollapse.show();
            }
          }
        }, 300);
      } else {
        alert('Error: ' + (data.message || 'Failed to load strategy'));
      }
    } catch (error) {
      console.error('Error loading strategy for edit:', error);
      alert('An error occurred while loading the strategy.');
    }
  };

  const handleDeleteStrategy = async (strategyId: string) => {
    if (!window.confirm('Are you sure you want to delete this strategy?')) {
      return;
    }
    try {
      const response = await fetch(`http://localhost:8000/api/strategy/delete/${strategyId}`, { method: 'POST', credentials: 'include' });
      const data = await response.json();
      if (response.ok) {
        alert(data.message);
        fetchStrategies();
      } else {
        alert('Error: ' + data.message);
      }
    } catch (error) {
      console.error('Error deleting strategy:', error);
      alert('An error occurred while deleting the strategy.');
    }
  };

  const handleDeployStrategy = async (strategyId: string) => {
    try {
      const response = await fetch(`http://localhost:8000/api/strategy/deploy/${strategyId}`, { 
        method: 'POST', 
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });
      
      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.error('Non-JSON response:', text);
        alert(`Error deploying strategy: ${response.status} ${response.statusText}. Please check if backend server is running and route exists.`);
        return;
      }
      
      if (response.ok) {
        alert(data.message || 'Strategy deployed successfully!');
        fetchStrategies();
      } else {
        alert('Error: ' + (data.message || 'Failed to deploy strategy'));
      }
    } catch (error: any) {
      console.error('Error deploying strategy:', error);
      alert(`An error occurred while deploying the strategy: ${error.message}`);
    }
  };

  const handlePauseStrategy = async (strategyId: string) => {
    try {
      const response = await fetch(`http://localhost:8000/api/strategy/pause/${strategyId}`, { 
        method: 'POST', 
        credentials: 'include' 
      });
      
      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.error('Non-JSON response from pause:', text);
        alert(`Error pausing strategy: ${response.status} ${response.statusText}`);
        return;
      }
      
      if (response.ok) {
        alert(data.message || 'Strategy paused successfully!');
        fetchStrategies();
        // Trigger refresh for Saved Strategies
        window.dispatchEvent(new CustomEvent('refreshStrategies'));
      } else {
        alert('Error: ' + (data.message || 'Failed to pause strategy'));
      }
    } catch (error: any) {
      console.error('Error pausing strategy:', error);
      alert(`An error occurred while pausing the strategy: ${error.message || 'Unknown error'}`);
    }
  };

  const handleSquareOffStrategy = async (strategyId: string) => {
    if (!window.confirm('Are you sure you want to square off this strategy?')) {
      return;
    }
    try {
      const response = await fetch(`http://localhost:8000/api/strategy/squareoff/${strategyId}`, { method: 'POST', credentials: 'include' });
      const data = await response.json();
      if (response.ok) {
        alert(data.message);
        fetchStrategies();
      } else {
        alert('Error: ' + data.message);
      }
    } catch (error) {
      console.error('Error squaring off strategy:', error);
      alert('An error occurred while squaring off the strategy.');
    }
  };

  return (
    <div className="accordion-item mt-3">
      <h2 className="accordion-header" id="headingTwo">
        <button
          className={`accordion-button ${isOpen ? '' : 'collapsed'}`}
          type="button"
          onClick={() => onToggle && onToggle(!isOpen)}
          aria-expanded={isOpen}
          aria-controls="collapseTwo"
        >
          Saved Strategies
        </button>
      </h2>
      <div 
        id="collapseTwo" 
        className={`accordion-collapse collapse ${isOpen ? 'show' : ''}`} 
        aria-labelledby="headingTwo" 
        data-bs-parent="#dashboardAccordion"
      >
        <div className="accordion-body">
          <table className="table table-striped">
            <thead>
              <tr>
                <th>Strategy Name</th>
                <th>Type</th>
                <th>Instrument</th>
                <th>Lots</th>
                <th>Stop Loss / Target</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="saved-strategies-table-body">
              {strategies.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-muted py-4">
                    <i className="bi bi-inbox fs-1 d-block mb-2"></i>
                    No strategies saved yet. Create your first strategy above!
                  </td>
                </tr>
              ) : (
                strategies.map((strategy) => (
                  <tr key={strategy.id}>
                    <td>
                      <div className="d-flex align-items-center">
                        <strong className="me-2">{strategy.strategy_name || 'Unnamed Strategy'}</strong>
                        <button
                          type="button"
                          className="btn btn-link p-0 text-info"
                          style={{ fontSize: '0.9rem', lineHeight: '1', border: 'none', background: 'none' }}
                          onClick={() => {
                            setSelectedStrategyInfo(strategy);
                            setShowStrategyInfoModal(true);
                          }}
                          title="View Strategy Details"
                        >
                          <i className="bi bi-info-circle"></i>
                        </button>
                      </div>
                    </td>
                    <td>
                      <span className="badge bg-secondary">{strategy.strategy_type || 'custom'}</span>
                    </td>
                    <td>{strategy.instrument || 'N/A'}</td>
                    <td>{strategy.total_lot || 1}</td>
                    <td>
                      <small>
                        SL: {strategy.stop_loss || 0}% / TP: {strategy.target_profit || 0}%
                      </small>
                    </td>
                    <td>
                      <span className={`badge ${
                        strategy.status === 'running' ? 'bg-success' :
                        strategy.status === 'paused' ? 'bg-warning' :
                        strategy.status === 'error' ? 'bg-danger' :
                        strategy.status === 'sq_off' ? 'bg-info' :
                        'bg-secondary'
                      }`}>
                        {strategy.status || 'saved'}
                      </span>
                    </td>
                    <td>
                      <div className="btn-group" role="group">
                        <button 
                          className="btn btn-sm btn-info" 
                          onClick={() => handleEditStrategy(strategy.id)}
                          title="Edit Strategy"
                        >
                          <i className="bi bi-pencil"></i>
                        </button>
                        {(strategy.status === 'saved' || strategy.status === 'paused' || strategy.status === 'error' || strategy.status === 'sq_off') && (
                          <button 
                            className="btn btn-sm btn-success" 
                            onClick={() => handleDeployStrategy(strategy.id)}
                            title="Deploy/Play Strategy"
                          >
                            <i className="bi bi-play-fill"></i>
                          </button>
                        )}
                        {strategy.status === 'running' && (
                          <button 
                            className="btn btn-sm btn-warning" 
                            onClick={() => handlePauseStrategy(strategy.id)}
                            title="Pause Strategy"
                          >
                            <i className="bi bi-pause-fill"></i>
                          </button>
                        )}
                        <button 
                          className="btn btn-sm btn-danger" 
                          onClick={() => handleDeleteStrategy(strategy.id)}
                          title="Delete Strategy"
                        >
                          <i className="bi bi-trash"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Strategy Info Modal */}
      {showStrategyInfoModal && selectedStrategyInfo && (
        <div 
          className="modal fade show d-block" 
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowStrategyInfoModal(false)}
        >
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header bg-primary text-white">
                <h5 className="modal-title">
                  <i className="bi bi-info-circle me-2"></i>
                  Strategy Details: {selectedStrategyInfo.strategy_name}
                </h5>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => setShowStrategyInfoModal(false)}
                ></button>
              </div>
              <div className="modal-body">
                <StrategyInfoContent strategy={selectedStrategyInfo} />
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowStrategyInfoModal(false)}
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

// Component to display strategy information
const StrategyInfoContent: React.FC<{ strategy: Strategy }> = ({ strategy }) => {
  // Parse JSON strings for indicators and rules
  let indicators: any[] = [];
  let entryRules: any[] = [];
  let exitRules: any[] = [];
  
  try {
    if (strategy.indicators) {
      indicators = JSON.parse(strategy.indicators);
    }
  } catch (e) {
    console.error('Error parsing indicators:', e);
  }
  
  try {
    if (strategy.entry_rules) {
      entryRules = JSON.parse(strategy.entry_rules);
    }
  } catch (e) {
    console.error('Error parsing entry rules:', e);
  }
  
  try {
    if (strategy.exit_rules) {
      exitRules = JSON.parse(strategy.exit_rules);
    }
  } catch (e) {
    console.error('Error parsing exit rules:', e);
  }

  // Strategy type descriptions
  const getStrategyTypeDescription = (type: string | undefined) => {
    switch (type) {
      case 'orb':
        return {
          name: 'Opening Range Breakout (ORB)',
          logic: `This strategy identifies the opening range (high and low) during the first ${strategy.candle_time || 15} minutes of trading. It enters a position when price breaks above the range high (long) or below the range low (short). The strategy uses the following logic:
          
• Opening Range: Calculated from ${strategy.start_time || '09:15'} to the first ${strategy.candle_time || 15} minutes
• Entry Signal: Price breaks above range high (bullish) or below range low (bearish)
• Stop Loss: ${strategy.stop_loss || 1}% from entry price
• Target Profit: ${strategy.target_profit || 2}% from entry price
• Position Size: ${strategy.total_lot || 1} lot(s) of ${strategy.instrument || 'NIFTY'} ${strategy.segment || 'Option'}
• Trade Type: ${strategy.trade_type || 'Buy'}
• Strike Selection: ${strategy.strike_price || 'ATM'} with ${strategy.expiry_type || 'Weekly'} expiry
• Trailing Stop: ${strategy.trailing_stop_loss || 0}% trailing stop loss for profit protection`,
          howItWorks: 'The ORB strategy capitalizes on the momentum that occurs when price breaks out of the opening range. This is based on the theory that the first 15-30 minutes often set the tone for the day. When price breaks above/below this range with volume, it indicates strong directional momentum.'
        };
      case 'capture_mountain_signal':
        return {
          name: 'Capture Mountain Signal',
          logic: `This pattern recognition strategy identifies "mountain" formations in price charts. The strategy logic includes:
          
• Pattern Detection: Monitors price action for mountain-like patterns (peaks and valleys)
• Signal Confirmation: Validates signals using technical indicators and price action
• Entry: Enters on confirmed mountain pattern signals
• Exit: Uses stop loss (${strategy.stop_loss || 1}%) and target profit (${strategy.target_profit || 2}%)
• Position Management: ${strategy.total_lot || 1} lot(s) with trailing stop (${strategy.trailing_stop_loss || 0}%)
• Execution Window: Active from ${strategy.start_time || '09:15'} to ${strategy.end_time || '15:00'}
• Instrument: ${strategy.instrument || 'NIFTY'} ${strategy.segment || 'Option'} with ${strategy.expiry_type || 'Weekly'} expiry`,
          howItWorks: 'The strategy analyzes candlestick patterns and price formations to identify mountain-like structures. When a mountain pattern is detected along with confirmation signals, the strategy enters trades anticipating trend reversals or continuations. It uses multiple timeframes and technical analysis to validate signals.'
        };
      case 'custom':
        return {
          name: 'Custom Strategy',
          logic: `This is a custom-built strategy using technical indicators and custom rules. Strategy configuration:
          
• Indicators Used: ${indicators.length > 0 ? indicators.map((ind: any) => ind.name || ind.id).join(', ') : 'None configured'}
• Entry Rules: ${entryRules.length} rule(s) defined
• Exit Rules: ${exitRules.length} rule(s) defined
• Risk Parameters: Stop Loss ${strategy.stop_loss || 1}%, Target ${strategy.target_profit || 2}%, Trailing Stop ${strategy.trailing_stop_loss || 0}%
• Position Size: ${strategy.total_lot || 1} lot(s)
• Execution: ${strategy.start_time || '09:15'} to ${strategy.end_time || '15:00'}
• Instrument: ${strategy.instrument || 'NIFTY'} ${strategy.segment || 'Option'}`,
          howItWorks: 'This custom strategy combines multiple technical indicators with logical conditions to generate entry and exit signals. The strategy evaluates conditions based on indicator values and executes trades when all conditions are met according to the defined rules.'
        };
      default:
        return {
          name: strategy.strategy_type || 'Unknown Strategy',
          logic: 'Strategy logic details not available.',
          howItWorks: 'This strategy uses custom logic configured during creation.'
        };
    }
  };

  const strategyInfo = getStrategyTypeDescription(strategy.strategy_type);

  return (
    <div>
      {/* Basic Information */}
      <div className="mb-4">
        <h6 className="text-primary mb-3">
          <i className="bi bi-card-heading me-2"></i>Basic Information
        </h6>
        <div className="row g-3">
          <div className="col-md-6">
            <strong>Strategy Name:</strong> {strategy.strategy_name}
          </div>
          <div className="col-md-6">
            <strong>Type:</strong> <span className="badge bg-primary">{strategyInfo.name}</span>
          </div>
          <div className="col-md-6">
            <strong>Instrument:</strong> {strategy.instrument}
          </div>
          <div className="col-md-6">
            <strong>Segment:</strong> {strategy.segment || 'Option'}
          </div>
          <div className="col-md-6">
            <strong>Execution Window:</strong> {strategy.start_time || '09:15'} - {strategy.end_time || '15:00'}
          </div>
          <div className="col-md-6">
            <strong>Status:</strong> 
            <span className={`badge ms-2 ${
              strategy.status === 'running' ? 'bg-success' :
              strategy.status === 'paused' ? 'bg-warning' :
              strategy.status === 'error' ? 'bg-danger' :
              'bg-secondary'
            }`}>
              {strategy.status || 'saved'}
            </span>
          </div>
        </div>
      </div>

      {/* Strategy Logic */}
      <div className="mb-4">
        <h6 className="text-success mb-3">
          <i className="bi bi-cpu me-2"></i>Strategy Logic
        </h6>
        <div className="card bg-light">
          <div className="card-body">
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 }}>{strategyInfo.logic}</pre>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="mb-4">
        <h6 className="text-info mb-3">
          <i className="bi bi-gear me-2"></i>How It Works
        </h6>
        <p className="text-muted">{strategyInfo.howItWorks}</p>
      </div>

      {/* Risk Management */}
      <div className="mb-4">
        <h6 className="text-warning mb-3">
          <i className="bi bi-shield-check me-2"></i>Risk Management
        </h6>
        <div className="row g-3">
          <div className="col-md-3">
            <div className="card border-warning">
              <div className="card-body text-center">
                <strong className="text-warning d-block">Stop Loss</strong>
                <span className="fs-5">{strategy.stop_loss || 0}%</span>
              </div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card border-success">
              <div className="card-body text-center">
                <strong className="text-success d-block">Target Profit</strong>
                <span className="fs-5">{strategy.target_profit || 0}%</span>
              </div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card border-info">
              <div className="card-body text-center">
                <strong className="text-info d-block">Trailing Stop</strong>
                <span className="fs-5">{strategy.trailing_stop_loss || 0}%</span>
              </div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card border-primary">
              <div className="card-body text-center">
                <strong className="text-primary d-block">Position Size</strong>
                <span className="fs-5">{strategy.total_lot || 1} lot(s)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Strategy Details */}
      {strategy.strategy_type === 'custom' && (
        <>
          {/* Indicators */}
          {indicators.length > 0 && (
            <div className="mb-4">
              <h6 className="text-primary mb-3">
                <i className="bi bi-graph-up me-2"></i>Technical Indicators ({indicators.length})
              </h6>
              <div className="row g-2">
                {indicators.map((indicator: any, idx: number) => (
                  <div key={idx} className="col-md-6">
                    <div className="card">
                      <div className="card-body p-2">
                        <strong>{indicator.name || indicator.id}</strong>
                        {indicator.params && Object.keys(indicator.params).length > 0 && (
                          <div className="small text-muted">
                            Params: {Object.entries(indicator.params).map(([k, v]) => `${k}: ${v}`).join(', ')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Entry Rules */}
          {entryRules.length > 0 && (
            <div className="mb-4">
              <h6 className="text-success mb-3">
                <i className="bi bi-arrow-right-circle me-2"></i>Entry Rules ({entryRules.length})
              </h6>
              {entryRules.map((rule: any, idx: number) => (
                <div key={idx} className="card mb-2 border-success">
                  <div className="card-body">
                    <strong>{rule.name || `Entry Rule ${idx + 1}`}</strong>
                    {rule.conditions && rule.conditions.length > 0 && (
                      <div className="mt-2">
                        {rule.conditions.map((cond: any, cIdx: number) => (
                          <div key={cIdx} className="small ms-3">
                            {cIdx > 0 && <span className="badge bg-secondary me-1">{cond.logic || 'AND'}</span>}
                            <span>{cond.indicator} {cond.operator} {cond.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Exit Rules */}
          {exitRules.length > 0 && (
            <div className="mb-4">
              <h6 className="text-danger mb-3">
                <i className="bi bi-arrow-left-circle me-2"></i>Exit Rules ({exitRules.length})
              </h6>
              {exitRules.map((rule: any, idx: number) => (
                <div key={idx} className="card mb-2 border-danger">
                  <div className="card-body">
                    <strong>{rule.name || `Exit Rule ${idx + 1}`}</strong>
                    {rule.conditions && rule.conditions.length > 0 && (
                      <div className="mt-2">
                        {rule.conditions.map((cond: any, cIdx: number) => (
                          <div key={cIdx} className="small ms-3">
                            {cIdx > 0 && <span className="badge bg-secondary me-1">{cond.logic || 'AND'}</span>}
                            <span>{cond.indicator} {cond.operator} {cond.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Trading Parameters */}
      <div className="mb-3">
        <h6 className="text-secondary mb-3">
          <i className="bi bi-sliders me-2"></i>Trading Parameters
        </h6>
        <div className="row g-2">
          <div className="col-md-4">
            <small><strong>Trade Type:</strong> {strategy.trade_type || 'Buy'}</small>
          </div>
          <div className="col-md-4">
            <small><strong>Strike Price:</strong> {strategy.strike_price || 'ATM'}</small>
          </div>
          <div className="col-md-4">
            <small><strong>Expiry:</strong> {strategy.expiry_type || 'Weekly'}</small>
          </div>
          <div className="col-md-4">
            <small><strong>Candle Timeframe:</strong> {strategy.candle_time || '5'} min</small>
          </div>
        </div>
      </div>
    </div>
  );
};

const AIEnabledStrategyChat: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [latestStrategy, setLatestStrategy] = useState<string>('');
  const [latestValidation, setLatestValidation] = useState<StrategyValidation | null>(null);
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages]);

  const buildHistoryPayload = (msgs: ChatMessage[]) =>
    msgs.map(({ role, content }) => ({ role, content }));

  const handleSend = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || loading) {
      return;
    }

    const timestamp = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: `user-${timestamp}`,
      role: 'user',
      content: trimmed,
      timestamp,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setError(null);
    setLastSavedPath(null);
    setLoading(true);

    try {
      const response = await fetch('http://localhost:8000/api/ai/strategy_chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          message: trimmed,
          history: buildHistoryPayload([...messages, userMessage].slice(-10)),
        }),
      });

      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.message || 'Failed to generate strategy');
      }

      const data = await response.json();

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.strategy
          ? 'Strategy blueprint generated. Review the formatted output on the right.'
          : data.message || 'Response received.',
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (typeof data.strategy === 'string') {
        setLatestStrategy(data.strategy);
      } else {
        setLatestStrategy('');
      }

      if (data.validation) {
        setLatestValidation(data.validation);
      } else {
        setLatestValidation(null);
      }

      if (data.savedPath) {
        setLastSavedPath(data.savedPath);
      }
    } catch (apiError: any) {
      console.error('AI assistant error:', apiError);
      setError(apiError.message || 'Unexpected error occurred while generating strategy');
      const failureMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '⚠️ Unable to generate strategy. Please try again or refine your request.',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, failureMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleCopyStrategy = async () => {
    if (!latestStrategy) {
      return;
    }
    try {
      await navigator.clipboard.writeText(latestStrategy);
      setLastSavedPath('Copied to clipboard');
      setError(null);
    } catch (copyError: any) {
      console.error('Failed to copy strategy:', copyError);
      setError('Failed to copy strategy to clipboard');
    }
  };

  const handleSaveStrategy = async () => {
    if (!latestStrategy || loading) {
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/api/ai/strategy_chat/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ strategy_text: latestStrategy }),
      });
      if (!response.ok) {
        const errPayload = await response.json().catch(() => ({}));
        throw new Error(errPayload.message || 'Failed to save strategy');
      }
      const data = await response.json();
      setLastSavedPath(data.savedPath || 'Strategy saved');
      if (data.validation) {
        setLatestValidation(data.validation);
      }
    } catch (saveError: any) {
      console.error('Error saving strategy:', saveError);
      setError(saveError.message || 'An error occurred while saving the strategy');
    } finally {
      setLoading(false);
    }
  };

  const renderValidation = () => {
    if (!latestValidation) {
      return null;
    }

    return (
      <div className="mt-3">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span className={`badge ${latestValidation.is_valid ? 'bg-success' : 'bg-warning text-dark'}`}>
            {latestValidation.is_valid ? 'Format Valid' : 'Needs Attention'}
          </span>
          {lastSavedPath && (
            <span className="badge bg-info text-dark">
              {lastSavedPath}
            </span>
          )}
        </div>
        {latestValidation.missing_sections?.length > 0 && (
          <div className="alert alert-warning mt-3 py-2 px-3">
            <strong>Missing Sections:</strong> {latestValidation.missing_sections.join(', ')}
          </div>
        )}
        {latestValidation.warnings?.length > 0 && (
          <div className="alert alert-info mt-2 py-2 px-3">
            <strong>Warnings:</strong>
            <ul className="mb-0 ps-3">
              {latestValidation.warnings.map((warning, idx) => (
                <li key={idx}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="card shadow-sm border-0 mt-4">
      <div className="card-header bg-dark text-white d-flex align-items-center justify-content-between">
        <div>
          <h5 className="card-title mb-0">
            <i className="bi bi-robot me-2"></i>
            AI Strategy Assistant
          </h5>
          <small className="text-white-50">
            Describe trading ideas in natural language and receive production-ready strategy blueprints.
          </small>
        </div>
        {loading && (
          <span className="badge bg-secondary">
            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            Generating...
          </span>
        )}
      </div>
      <div className="card-body">
        {error && (
          <div className="alert alert-danger d-flex align-items-center" role="alert">
            <i className="bi bi-exclamation-triangle-fill me-2"></i>
            <div>{error}</div>
          </div>
        )}
        <div className="row g-4">
          <div className="col-lg-6">
            <div className="border rounded p-3 h-100 d-flex flex-column">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h6 className="mb-0">
                  <i className="bi bi-chat-text-fill me-2 text-primary"></i>
                  Conversation
                </h6>
                <span className="badge bg-light text-muted">{messages.length} messages</span>
              </div>
              <div
                ref={chatBodyRef}
                className="flex-grow-1 overflow-auto bg-light rounded p-3"
                style={{ maxHeight: '420px' }}
              >
                {messages.length === 0 ? (
                  <div className="text-center text-muted py-5">
                    <i className="bi bi-stars fs-1 d-block mb-3"></i>
                    Ask the assistant to design a strategy. Example:
                    <div className="mt-3">
                      <code>Build a Bank Nifty PE strategy that triggers when RSI crosses above 70 with 5m candles.</code>
                    </div>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`mb-3 d-flex ${msg.role === 'user' ? 'justify-content-end' : 'justify-content-start'}`}
                    >
                      <div
                        className={`p-3 rounded shadow-sm ${msg.role === 'user' ? 'bg-primary text-white' : 'bg-white border'}`}
                        style={{ maxWidth: '85%' }}
                      >
                        <div className="small text-muted mb-1">
                          {msg.role === 'user' ? 'You' : 'Assistant'} · {new Date(msg.timestamp).toLocaleTimeString()}
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-3">
                <label htmlFor="ai-strategy-input" className="form-label fw-semibold">
                  Describe your strategy idea
                </label>
                <textarea
                  id="ai-strategy-input"
                  className="form-control"
                  placeholder="E.g., Create a momentum breakout strategy using 5m Bank Nifty candles with EMA and volume confirmation..."
                  rows={3}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                ></textarea>
                <div className="d-flex justify-content-end mt-2 gap-2">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setInputValue('')}
                    disabled={loading || inputValue.length === 0}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSend}
                    disabled={loading || inputValue.trim().length === 0}
                  >
                    <i className="bi bi-send-fill me-2"></i>
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="col-lg-6">
            <div className="border rounded p-3 h-100 d-flex flex-column bg-light">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h6 className="mb-0">
                  <i className="bi bi-file-code-fill me-2 text-success"></i>
                  Generated Strategy Blueprint
                </h6>
                <div className="btn-group btn-group-sm">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={handleCopyStrategy}
                    disabled={!latestStrategy}
                  >
                    <i className="bi bi-clipboard me-2"></i>
                    Copy
                  </button>
                  <button
                    type="button"
                    className="btn btn-success"
                    onClick={handleSaveStrategy}
                    disabled={!latestStrategy || loading}
                  >
                    <i className="bi bi-save me-2"></i>
                    Save
                  </button>
                </div>
              </div>
              <div className="bg-white border rounded p-3 flex-grow-1 overflow-auto" style={{ maxHeight: '420px' }}>
                {latestStrategy ? (
                  <pre className="mb-0" style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                    {latestStrategy}
                  </pre>
                ) : (
                  <div className="text-muted text-center py-5">
                    <i className="bi bi-journal-code fs-1 d-block mb-3"></i>
                    Generated strategy code will appear here once the assistant responds.
                  </div>
                )}
              </div>
              {renderValidation()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface DashboardContentProps {
  niftyPrice: string;
  bankNiftyPrice: string;
  balance: string;
  access_token: boolean;
  onViewLiveStrategy: (strategyId: string) => void;
  onViewChart: (instrumentToken: string) => void;
}

const DashboardContent: React.FC<DashboardContentProps> = ({ niftyPrice, bankNiftyPrice, balance, access_token, onViewLiveStrategy, onViewChart }) => {
  const [refreshStrategies, setRefreshStrategies] = useState<number>(0);
  const [editingStrategy, setEditingStrategy] = useState<any>(null);
  const [strategyBuilderOpen, setStrategyBuilderOpen] = useState<boolean>(false);
  const [savedStrategiesOpen, setSavedStrategiesOpen] = useState<boolean>(false);

  const handleStrategySaved = () => {
    setRefreshStrategies(prev => prev + 1);
    setEditingStrategy(null); // Reset editing state after save
    // Auto-open saved strategies section
    setSavedStrategiesOpen(true);
  };

  const handleEditStrategy = (strategy: any) => {
    setEditingStrategy(strategy);
    setStrategyBuilderOpen(true);
  };

  return (
    <div className="container mt-4" id="dashboard-content">
      <div className="row">
        <div className="col-md-4">
          <MarketData niftyPrice={niftyPrice} bankNiftyPrice={bankNiftyPrice} />
          <AccountInfo balance={balance} access_token={access_token} />
        </div>
        <div className="col-md-8">
          <div className="accordion" id="dashboardAccordion">
            <StrategyConfiguration 
              onStrategySaved={handleStrategySaved} 
              editingStrategy={editingStrategy}
              isOpen={strategyBuilderOpen}
              onToggle={setStrategyBuilderOpen}
            />
            <SavedStrategies 
              onViewLive={onViewLiveStrategy} 
              onStrategyUpdated={refreshStrategies}
              onEditStrategy={handleEditStrategy}
              isOpen={savedStrategiesOpen}
              onToggle={setSavedStrategiesOpen}
            />
          </div>
          <AIEnabledStrategyChat />
        </div>
      </div>
    </div>
  );
};

export default DashboardContent;
