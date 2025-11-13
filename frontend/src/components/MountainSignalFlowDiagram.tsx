import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../config/api';

interface MountainSignalFlowDiagramProps {
  strategy: {
    strategy_type: string;
    instrument: string;
    candle_time: string;
    ema_period?: number;
  };
}

interface RuleConfig {
  strike_rnd: Record<string, number>;
  lot_sz: Record<string, number>;
  stop_loss: number;
  target: number;
  exit_priority: string[];
  evaluation_seconds: number;
}

const defaultRuleConfig: RuleConfig = {
  strike_rnd: {
    BANKNIFTY: 100,
    NIFTY: 50,
  },
  lot_sz: {
    BANKNIFTY: 35,
    NIFTY: 75,
  },
  stop_loss: -0.17,
  target: 0.45,
  exit_priority: ['option_stop_loss', 'option_target', 'index_stop', 'index_target', 'market_close 15:15'],
  evaluation_seconds: 20,
};

const formatPercent = (value: number): string => {
  const pct = value * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(Number.isInteger(pct) ? 0 : 2)}%`;
};

const formatAbsolutePercent = (value: number): string => {
  const pct = Math.abs(value * 100);
  return `${pct.toFixed(Number.isInteger(pct) ? 0 : 2)}%`;
};

const MountainSignalFlowDiagram: React.FC<MountainSignalFlowDiagramProps> = ({ strategy }) => {
  const emaPeriod = strategy.ema_period || 5;
  const candleTime = strategy.candle_time || '5m';

  const [ruleConfig, setRuleConfig] = useState<RuleConfig>(defaultRuleConfig);

  useEffect(() => {
    const loadRules = async () => {
      try {
        const response = await fetch(apiUrl('/api/rules/mountain_signal'), {
          credentials: 'include',
        });
        if (!response.ok) return;
        const data = await response.json();
        if (data.status === 'success' && data.rules) {
          const rules = data.rules;
          setRuleConfig((prev) => ({
            strike_rnd: {
              ...prev.strike_rnd,
              ...(rules.strike_rounding || {}),
            },
            lot_sz: {
              ...prev.lot_sz,
              ...(rules.lot_sizes || {}),
            },
            stop_loss: rules.option_trade?.stop_loss_percent ?? prev.stop_loss,
            target: rules.option_trade?.target_percent ?? prev.target,
            exit_priority: rules.exit_priority || prev.exit_priority,
            evaluation_seconds: rules.evaluation?.seconds_before_close ?? prev.evaluation_seconds,
          }));
        }
      } catch (error) {
        console.error('Failed to load Mountain Signal rules for flow diagram:', error);
      }
    };

    loadRules();
  }, []);

  const instrumentKey = useMemo(() => strategy.instrument.toUpperCase(), [strategy.instrument]);
  const strikeRounding = ruleConfig.strike_rnd[instrumentKey] ?? (instrumentKey.includes('BANK') ? 100 : 50);
  const lotSize = ruleConfig.lot_sz[instrumentKey] ?? (instrumentKey.includes('BANK') ? 35 : 75);
  const stopLossPercentLabel = formatPercent(ruleConfig.stop_loss);
  const stopLossAbsoluteLabel = formatAbsolutePercent(ruleConfig.stop_loss);
  const targetPercentLabel = formatPercent(ruleConfig.target);
  const targetAbsoluteLabel = formatAbsolutePercent(ruleConfig.target);
  const evaluationSeconds = ruleConfig.evaluation_seconds;
  const exampleSeconds = (60 - (evaluationSeconds % 60)) % 60;
  const exampleSecondsLabel = exampleSeconds.toString().padStart(2, '0');

  const exitPriorityHumanReadable = useMemo(() => {
    return ruleConfig.exit_priority.map((item) => {
      if (item.startsWith('option_stop_loss')) return `1) Option SL (${stopLossPercentLabel})`;
      if (item.startsWith('option_target')) return `2) Option Target (${targetPercentLabel})`;
      if (item.startsWith('index_stop')) return '3) Index Stop (Close above signal high)';
      if (item.startsWith('index_target')) return '4) Index Target Pattern (High < EMA then two closes > EMA)';
      if (item.toLowerCase().includes('market_close')) return '5) Market Close 15:15';
      return item;
    });
  }, [ruleConfig.exit_priority, stopLossPercentLabel, targetPercentLabel]);

  return (
    <div className="mountain-signal-flow-diagram" style={{ fontFamily: 'Arial, sans-serif' }}>
      <style>{`
        .mountain-signal-flow-diagram .flow-container {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 20px;
          border-radius: 10px;
          margin-bottom: 20px;
        }
        .mountain-signal-flow-diagram .flow-box {
          background: white;
          border: 2px solid #333;
          border-radius: 8px;
          padding: 15px;
          margin: 10px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          position: relative;
          word-wrap: break-word;
        }
        .mountain-signal-flow-diagram .flow-box.start {
          background: #28a745;
          color: white;
          text-align: center;
          font-weight: bold;
        }
        .mountain-signal-flow-diagram .flow-box.decision {
          background: #ffc107;
          border-color: #ff9800;
          text-align: center;
          font-weight: bold;
          border-radius: 50px;
          min-width: 180px;
        }
        .mountain-signal-flow-diagram .flow-box.process {
          background: #17a2b8;
          color: white;
        }
        .mountain-signal-flow-diagram .flow-box.signal {
          background: #6f42c1;
          color: white;
        }
        .mountain-signal-flow-diagram .flow-box.entry {
          background: #28a745;
          color: white;
          font-weight: bold;
        }
        .mountain-signal-flow-diagram .flow-box.exit {
          background: #dc3545;
          color: white;
          font-weight: bold;
        }
        .mountain-signal-flow-diagram .flow-arrow {
          text-align: center;
          font-size: 24px;
          color: #333;
          margin: 5px 0;
        }
        .mountain-signal-flow-diagram .flow-row {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          flex-wrap: wrap;
          margin: 10px 0;
        }
        .mountain-signal-flow-diagram .flow-column {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin: 0 10px;
        }
        .mountain-signal-flow-diagram .section-title {
          background: #343a40;
          color: white;
          padding: 10px;
          border-radius: 5px;
          text-align: center;
          font-weight: bold;
          margin: 20px 0 10px 0;
        }
        .mountain-signal-flow-diagram .info-box {
          background: rgba(255,255,255,0.2);
          border-left: 4px solid rgba(255,255,255,0.5);
          padding: 10px;
          margin: 10px 0;
          border-radius: 4px;
          color: white;
        }
        .mountain-signal-flow-diagram .bullet-list {
          text-align: left;
          padding-left: 18px;
          margin: 0;
        }
        .mountain-signal-flow-diagram .bullet-list li {
          margin-bottom: 4px;
        }
        .mountain-signal-flow-diagram .flow-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 15px;
        }
        @media (max-width: 768px) {
          .mountain-signal-flow-diagram .flow-box.decision {
            min-width: 100%;
          }
        }
      `}</style>

      <div className="flow-container">
        <div className="flow-box start">
          <h5 className="mb-2">Capture Mountain Signal Strategy</h5>
          <div className="info-box" style={{ background: 'rgba(255,255,255,0.2)', color: 'white', border: 'none' }}>
            <strong>Instrument:</strong> {strategy.instrument} ATM Options<br/>
            <strong>Timeframe:</strong> {candleTime} candles<br/>
            <strong>Indicators:</strong> EMA{emaPeriod} + RSI14<br/>
            <strong>Evaluation Window:</strong> {evaluationSeconds}s prior to candle close<br/>
            <small style={{ display: 'block', marginTop: '5px', opacity: 0.9 }}>
              Example timestamps: 09:19:{exampleSecondsLabel}, 09:24:{exampleSecondsLabel}, 09:29:{exampleSecondsLabel}
            </small>
            <strong>Trade Limit:</strong> One active PE signal & option trade at a time
          </div>
        </div>
      </div>

      <div className="flow-row">
        <div className="flow-column">
          <div className="flow-box process">
            <strong>Evaluate forming candle</strong><br/>
            (Candle − {evaluationSeconds}s)
          </div>
          <div className="flow-arrow">↓</div>
          <div className="flow-box decision">
            LOW &gt; EMA{emaPeriod} AND RSI &gt; 70?
          </div>
        </div>
      </div>

      <div className="flow-container">
        <div className="section-title">PE Signal Lifecycle</div>
        <div className="flow-row">
          <div className="flow-box signal" style={{ flex: 1, minWidth: 260 }}>
            <strong>Identify / Promote</strong>
            <ul className="bullet-list">
              <li>Qualifying candle becomes active PE signal</li>
              <li>Latest qualifying candle replaces previous signal</li>
              <li>Reset post-exit validation when signal updates</li>
            </ul>
          </div>
          <div className="flow-box process" style={{ flex: 1, minWidth: 260 }}>
            <strong>Maintain / Clear</strong>
            <ul className="bullet-list">
              <li>Signal persists until replaced or invalidated</li>
              <li>Cleared when LOW ≤ EMA{emaPeriod} or RSI ≤ 70</li>
              <li>Only PE logic active in this phase</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="flow-container">
        <div className="section-title">Entry & Re-entry Logic</div>
        <div className="flow-row">
          <div className="flow-column">
            <div className="flow-box process">
              <strong>Breakout Check</strong><br/>
              Next candle CLOSE &lt; signal LOW?
            </div>
            <div className="flow-arrow">↓</div>
            <div className="flow-box entry">
              ✅ Buy PE Option at breakout
              <ul className="bullet-list" style={{ marginTop: 8 }}>
                <li>ATM strike rounding: {strikeRounding}</li>
                <li>Lot size: {lotSize}</li>
                <li>Stop loss: {stopLossAbsoluteLabel}</li>
                <li>Target: {targetAbsoluteLabel}</li>
              </ul>
            </div>
            <div className="flow-arrow">↓</div>
            <div className="flow-box decision">
              <strong>Re-entry control</strong><br/>
              • First entry always allowed<br/>
              • Re-entry after exit requires price trading above signal LOW<br/>
              • New signal candle resets validation
            </div>
          </div>
        </div>
      </div>

      <div className="flow-container">
        <div className="section-title">Exit Priority (Rule Driven)</div>
        <div className="flow-grid">
          <div className="flow-box exit">
            <strong>Option Stop Loss</strong>
            <ul className="bullet-list">
              <li>Premium drawdown hits {stopLossPercentLabel}</li>
              <li>Immediate exit</li>
            </ul>
          </div>
          <div className="flow-box exit">
            <strong>Option Target</strong>
            <ul className="bullet-list">
              <li>Premium rallies by {targetPercentLabel}</li>
              <li>Book profits</li>
            </ul>
          </div>
          <div className="flow-box exit">
            <strong>Index Stop</strong>
            <ul className="bullet-list">
              <li>Index CLOSE rises above signal HIGH</li>
              <li>Close option position</li>
            </ul>
          </div>
          <div className="flow-box exit">
            <strong>Index Target</strong>
            <ul className="bullet-list">
              <li>First candle: HIGH &lt; EMA{emaPeriod}</li>
              <li>Then two consecutive closes &gt; EMA{emaPeriod}</li>
              <li>Confirm reversal, exit trade</li>
            </ul>
          </div>
          <div className="flow-box exit">
            <strong>Market Close 15:15</strong>
            <ul className="bullet-list">
              <li>Failsafe auto square-off</li>
              <li>No overnight exposure</li>
            </ul>
          </div>
        </div>
        <div className="flow-box process" style={{ background: '#6c757d', color: 'white' }}>
          <strong>Priority Sequence:</strong><br/>
          {exitPriorityHumanReadable.join(' → ')}
        </div>
      </div>

      <div className="flow-container" style={{ marginTop: '30px' }}>
        <div className="section-title">Signal Memory & Monitoring</div>
        <div className="flow-row">
          <div className="flow-box process" style={{ background: '#6c757d', color: 'white', flex: 1 }}>
            <strong>Signal Memory</strong>
            <ul className="bullet-list">
              <li>One active signal stored in memory</li>
              <li>Automatically replaced by newer qualifying candle</li>
              <li>Cleared when rule conditions fail</li>
            </ul>
          </div>
          <div className="flow-box process" style={{ background: '#6c757d', color: 'white', flex: 1 }}>
            <strong>Monitoring Loop</strong>
            <ul className="bullet-list">
              <li>Re-evaluated every {candleTime} (~{evaluationSeconds}s before close)</li>
              <li>Option prices observed continuously for SL/Target</li>
              <li>Audit trail records every decision</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="flow-container" style={{ marginTop: '20px', background: '#f8f9fa', padding: '15px' }}>
        <h6 className="mb-3">Legend</h6>
        <div className="d-flex flex-wrap gap-3">
          <div className="d-flex align-items-center">
            <div className="flow-box start" style={{ width: 30, height: 30, padding: 5, marginRight: 10 }}></div>
            <span>Overview / Start</span>
          </div>
          <div className="d-flex align-items-center">
            <div className="flow-box signal" style={{ width: 30, height: 30, padding: 5, marginRight: 10 }}></div>
            <span>Signal Identification</span>
          </div>
          <div className="d-flex align-items-center">
            <div className="flow-box decision" style={{ width: 30, height: 30, padding: 5, marginRight: 10 }}></div>
            <span>Decision Point</span>
          </div>
          <div className="d-flex align-items-center">
            <div className="flow-box process" style={{ width: 30, height: 30, padding: 5, marginRight: 10 }}></div>
            <span>Process / Rule</span>
          </div>
          <div className="d-flex align-items-center">
            <div className="flow-box entry" style={{ width: 30, height: 30, padding: 5, marginRight: 10 }}></div>
            <span>Entry Action</span>
          </div>
          <div className="d-flex align-items-center">
            <div className="flow-box exit" style={{ width: 30, height: 30, padding: 5, marginRight: 10 }}></div>
            <span>Exit Action</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MountainSignalFlowDiagram;

