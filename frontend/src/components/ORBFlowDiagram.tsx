import React from 'react';

interface ORBFlowDiagramProps {
  strategy: {
    strategy_type: string;
    instrument: string;
    candle_time: string;
    start_time: string;
    end_time: string;
    stop_loss: number;
    target_profit: number;
    trailing_stop_loss: number;
  };
}

const ORBFlowDiagram: React.FC<ORBFlowDiagramProps> = ({ strategy }) => {
  const openingRangeMinutes = strategy.candle_time || '15';
  const startTime = strategy.start_time || '09:15';
  const stopLoss = strategy.stop_loss || 1;
  const targetProfit = strategy.target_profit || 2;
  const trailingStop = strategy.trailing_stop_loss || 0;

  return (
    <div className="orb-flow-diagram" style={{ fontFamily: 'Arial, sans-serif' }}>
      <style>{`
        .orb-flow-diagram .flow-container {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 20px;
          border-radius: 10px;
          margin-bottom: 20px;
        }
        .orb-flow-diagram .flow-box {
          background: white;
          border: 2px solid #333;
          border-radius: 8px;
          padding: 15px;
          margin: 10px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          position: relative;
          word-wrap: break-word;
        }
        .orb-flow-diagram .flow-box.start {
          background: #28a745;
          color: white;
          text-align: center;
          font-weight: bold;
        }
        .orb-flow-diagram .flow-box.decision {
          background: #ffc107;
          border-color: #ff9800;
          text-align: center;
          font-weight: bold;
          border-radius: 50px;
          min-width: 150px;
        }
        .orb-flow-diagram .flow-box.process {
          background: #17a2b8;
          color: white;
        }
        .orb-flow-diagram .flow-box.range {
          background: #6f42c1;
          color: white;
        }
        .orb-flow-diagram .flow-box.entry {
          background: #28a745;
          color: white;
          font-weight: bold;
        }
        .orb-flow-diagram .flow-box.exit {
          background: #dc3545;
          color: white;
          font-weight: bold;
        }
        .orb-flow-diagram .flow-arrow {
          text-align: center;
          font-size: 24px;
          color: #333;
          margin: 5px 0;
        }
        .orb-flow-diagram .flow-row {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          flex-wrap: wrap;
          margin: 10px 0;
        }
        .orb-flow-diagram .flow-column {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin: 0 10px;
        }
        .orb-flow-diagram .label-yes {
          color: #28a745;
          font-weight: bold;
          font-size: 12px;
        }
        .orb-flow-diagram .label-no {
          color: #dc3545;
          font-weight: bold;
          font-size: 12px;
        }
        .orb-flow-diagram .section-title {
          background: #343a40;
          color: white;
          padding: 10px;
          border-radius: 5px;
          text-align: center;
          font-weight: bold;
          margin: 20px 0 10px 0;
        }
        .orb-flow-diagram .parallel-flow {
          display: flex;
          justify-content: space-around;
          flex-wrap: wrap;
          margin: 20px 0;
        }
        .orb-flow-diagram .parallel-column {
          flex: 1;
          min-width: 300px;
          margin: 0 10px;
        }
        .orb-flow-diagram .info-box {
          background: rgba(255,255,255,0.2);
          border-left: 4px solid rgba(255,255,255,0.5);
          padding: 10px;
          margin: 10px 0;
          border-radius: 4px;
          color: white;
        }
        @media (max-width: 768px) {
          .orb-flow-diagram .parallel-flow {
            flex-direction: column;
          }
          .orb-flow-diagram .parallel-column {
            min-width: 100%;
            margin: 10px 0;
          }
        }
      `}</style>

      {/* Strategy Overview */}
      <div className="flow-container">
        <div className="flow-box start">
          <h5 className="mb-2">Opening Range Breakout (ORB) Strategy</h5>
          <div className="info-box" style={{ background: 'rgba(255,255,255,0.2)', color: 'white', border: 'none' }}>
            <strong>Instruments:</strong> {strategy.instrument}<br/>
            <strong>Opening Range:</strong> First {openingRangeMinutes} minutes from {startTime}<br/>
            <strong>Stop Loss:</strong> {stopLoss}% from entry price<br/>
            <strong>Target Profit:</strong> {targetProfit}% from entry price<br/>
            {trailingStop > 0 && <><strong>Trailing Stop Loss:</strong> {trailingStop}%<br/></>}
            <strong>Position Limit:</strong> One active trade at a time
          </div>
        </div>
      </div>

      {/* Main Flow Start */}
      <div className="flow-row">
        <div className="flow-column">
          <div className="flow-box process">
            <strong>Strategy Start</strong><br/>
            Market opens at {startTime}
          </div>
          <div className="flow-arrow">↓</div>
          <div className="flow-box range">
            <strong>Calculate Opening Range</strong><br/>
            Monitor first {openingRangeMinutes} minutes<br/>
            Track HIGH and LOW prices
          </div>
          <div className="flow-arrow">↓</div>
          <div className="flow-box decision">
            Opening Range Calculated?
          </div>
          <div className="flow-arrow">↓</div>
          <div className="flow-box process">
            <strong>Opening Range Established</strong><br/>
            High: Opening Range High<br/>
            Low: Opening Range Low<br/>
            Waiting for breakout...
          </div>
        </div>
      </div>

      {/* Parallel Breakout Logic */}
      <div className="parallel-flow">
        {/* Long (Buy) Breakout Column */}
        <div className="parallel-column">
          <div className="section-title">Long (Buy) Breakout Logic</div>
          
          <div className="flow-column">
            <div className="flow-box decision" style={{ minWidth: '200px' }}>
              Price &gt; Opening Range High?
            </div>
            <div className="flow-arrow">↓</div>
            <div className="flow-box entry">
              ✅ EXECUTE BUY TRADE<br/>
              (Long Position)
            </div>
            <div className="flow-arrow">↓</div>
            <div className="flow-box process">
              <strong>Position Open</strong><br/>
              Entry Price: Current Price<br/>
              Stop Loss: Entry × (1 - {stopLoss}%)<br/>
              Target: Entry × (1 + {targetProfit}%)
            </div>
            <div className="flow-arrow">↓</div>
            <div className="flow-box decision" style={{ minWidth: '200px' }}>
              Monitor Trade
            </div>
            <div className="flow-row">
              <div className="flow-column" style={{ flex: 1 }}>
                <div className="label-yes">Stop Loss Hit</div>
                <div className="flow-box exit">
                  Price ≤ Stop Loss<br/>
                  ❌ EXIT LONG
                </div>
              </div>
              <div className="flow-column" style={{ flex: 1 }}>
                <div className="label-yes">Target Hit</div>
                <div className="flow-box exit">
                  Price ≥ Target<br/>
                  ✅ EXIT LONG (Profit)
                </div>
              </div>
            </div>
            {trailingStop > 0 && (
              <>
                <div className="flow-box decision" style={{ marginTop: '10px' }}>
                  Trailing Stop Active?
                </div>
                <div className="flow-arrow">↓</div>
                <div className="flow-box process" style={{ background: '#ff9800', color: 'white' }}>
                  <strong>Trailing Stop Logic</strong><br/>
                  Update stop loss if price moves favorably<br/>
                  Trail by {trailingStop}% from highest price
                </div>
              </>
            )}
          </div>
        </div>

        {/* Short (Sell) Breakout Column */}
        <div className="parallel-column">
          <div className="section-title">Short (Sell) Breakout Logic</div>
          
          <div className="flow-column">
            <div className="flow-box decision" style={{ minWidth: '200px' }}>
              Price &lt; Opening Range Low?
            </div>
            <div className="flow-arrow">↓</div>
            <div className="flow-box entry">
              ✅ EXECUTE SELL TRADE<br/>
              (Short Position)
            </div>
            <div className="flow-arrow">↓</div>
            <div className="flow-box process">
              <strong>Position Open</strong><br/>
              Entry Price: Current Price<br/>
              Stop Loss: Entry × (1 + {stopLoss}%)<br/>
              Target: Entry × (1 - {targetProfit}%)
            </div>
            <div className="flow-arrow">↓</div>
            <div className="flow-box decision" style={{ minWidth: '200px' }}>
              Monitor Trade
            </div>
            <div className="flow-row">
              <div className="flow-column" style={{ flex: 1 }}>
                <div className="label-yes">Stop Loss Hit</div>
                <div className="flow-box exit">
                  Price ≥ Stop Loss<br/>
                  ❌ EXIT SHORT
                </div>
              </div>
              <div className="flow-column" style={{ flex: 1 }}>
                <div className="label-yes">Target Hit</div>
                <div className="flow-box exit">
                  Price ≤ Target<br/>
                  ✅ EXIT SHORT (Profit)
                </div>
              </div>
            </div>
            {trailingStop > 0 && (
              <>
                <div className="flow-box decision" style={{ marginTop: '10px' }}>
                  Trailing Stop Active?
                </div>
                <div className="flow-arrow">↓</div>
                <div className="flow-box process" style={{ background: '#ff9800', color: 'white' }}>
                  <strong>Trailing Stop Logic</strong><br/>
                  Update stop loss if price moves favorably<br/>
                  Trail by {trailingStop}% from lowest price
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Trade Management Rules */}
      <div className="flow-container" style={{ marginTop: '30px' }}>
        <div className="section-title">Trade Management Rules</div>
        <div className="flow-row">
          <div className="flow-box process" style={{ background: '#6c757d', color: 'white', flex: 1 }}>
            <strong>Opening Range Rules:</strong><br/>
            • Opening range calculated from {startTime} for first {openingRangeMinutes} minutes<br/>
            • Range High = Highest price during opening period<br/>
            • Range Low = Lowest price during opening period<br/>
            • Range remains fixed once calculated
          </div>
          <div className="flow-box process" style={{ background: '#6c757d', color: 'white', flex: 1 }}>
            <strong>Breakout Rules:</strong><br/>
            • Buy when price breaks above range high<br/>
            • Sell when price breaks below range low<br/>
            • Only one active trade at a time<br/>
            • No re-entry until current trade closes
          </div>
        </div>
        <div className="flow-row" style={{ marginTop: '10px' }}>
          <div className="flow-box process" style={{ background: '#6c757d', color: 'white', flex: 1 }}>
            <strong>Risk Management:</strong><br/>
            • Stop Loss: {stopLoss}% from entry<br/>
            • Target Profit: {targetProfit}% from entry<br/>
            {trailingStop > 0 && <>&bull; Trailing Stop: {trailingStop}% (activates after profit)<br/></>}
            • Trade closes when either stop loss or target is hit
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flow-container" style={{ marginTop: '20px', background: '#f8f9fa', padding: '15px' }}>
        <h6 className="mb-3">Legend:</h6>
        <div className="d-flex flex-wrap gap-3">
          <div className="d-flex align-items-center">
            <div className="flow-box start" style={{ width: '30px', height: '30px', padding: '5px', margin: '0 10px 0 0' }}></div>
            <span>Start/Strategy Info</span>
          </div>
          <div className="d-flex align-items-center">
            <div className="flow-box range" style={{ width: '30px', height: '30px', padding: '5px', margin: '0 10px 0 0' }}></div>
            <span>Range Calculation</span>
          </div>
          <div className="d-flex align-items-center">
            <div className="flow-box decision" style={{ width: '30px', height: '30px', padding: '5px', margin: '0 10px 0 0' }}></div>
            <span>Decision Point</span>
          </div>
          <div className="d-flex align-items-center">
            <div className="flow-box process" style={{ width: '30px', height: '30px', padding: '5px', margin: '0 10px 0 0' }}></div>
            <span>Process/Check</span>
          </div>
          <div className="d-flex align-items-center">
            <div className="flow-box entry" style={{ width: '30px', height: '30px', padding: '5px', margin: '0 10px 0 0' }}></div>
            <span>Entry Action</span>
          </div>
          <div className="d-flex align-items-center">
            <div className="flow-box exit" style={{ width: '30px', height: '30px', padding: '5px', margin: '0 10px 0 0' }}></div>
            <span>Exit Action</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ORBFlowDiagram;



