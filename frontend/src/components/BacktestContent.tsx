import React, { useState } from 'react';
import { apiUrl } from '../config/api';

interface BacktestResults {
  pnl: number;
  trades: number;
}

const BacktestContent: React.FC = () => {
  const [strategy, setStrategy] = useState<string>('orb');
  const [instrument, setInstrument] = useState<string>('NIFTY');
  const [segment, setSegment] = useState<string>('Option');
  const [totalLot, setTotalLot] = useState<number>(1);
  const [tradeType, setTradeType] = useState<string>('Buy');
  const [strikePrice, setStrikePrice] = useState<string>('ATM');
  const [expiryType, setExpiryType] = useState<string>('Weekly');
  const [candleTime, setCandleTime] = useState<string>('5');
  const [executionStart, setExecutionStart] = useState<string>('09:15');
  const [executionEnd, setExecutionEnd] = useState<string>('15:00');
  const [stopLoss, setStopLoss] = useState<number>(1);
  const [targetProfit, setTargetProfit] = useState<number>(2);
  const [trailingStopLoss, setTrailingStopLoss] = useState<number>(0.5);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [results, setResults] = useState<BacktestResults | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setResults(null);

    const formData = {
      strategy,
      instrument,
      segment,
      'total-lot': totalLot,
      'trade-type': tradeType,
      'strike-price': strikePrice,
      'expiry-type': expiryType,
      'candle-time': candleTime,
      'execution-start': executionStart,
      'execution-end': executionEnd,
      'stop-loss': stopLoss,
      'target-profit': targetProfit,
      'trailing-stop-loss': trailingStopLoss,
      'backtest-from-date': fromDate,
      'backtest-to-date': toDate,
    };

    try {
      const response = await fetch(apiUrl('/api/backtest'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        setResults(data);
      } else {
        console.error('Backtest failed:', data.message);
      }
    } catch (error) {
      console.error('Error during backtest:', error);
    }
  };

  return (
    <div className="container mt-4">
      <h2>Backtest Strategy</h2>
      <form onSubmit={handleSubmit}>
        <div className="row">
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-strategy" className="form-label">Strategy</label>
            <select
              className="form-select"
              id="backtest-strategy"
              name="strategy"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
            >
              <option value="orb">Opening Range Breakout (ORB)</option>
            </select>
          </div>
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-instrument" className="form-label">Instrument</label>
            <select
              className="form-select"
              id="backtest-instrument"
              name="instrument"
              value={instrument}
              onChange={(e) => setInstrument(e.target.value)}
            >
              <option value="NIFTY">NIFTY</option>
              <option value="BANKNIFTY">BANKNIFTY</option>
            </select>
          </div>
        </div>
        <div className="row">
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-segment" className="form-label">Select Segment</label>
            <select
              className="form-select"
              id="backtest-segment"
              name="segment"
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
            >
              <option value="Option">Option</option>
              <option value="Future">Future</option>
            </select>
          </div>
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-total-lot" className="form-label">Total Lot</label>
            <input
              type="number"
              className="form-control"
              id="backtest-total-lot"
              name="total-lot"
              min={1}
              max={50}
              value={totalLot}
              onChange={(e) => setTotalLot(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="row">
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-trade-type" className="form-label">Buy or Sell</label>
            <select
              className="form-select"
              id="backtest-trade-type"
              name="trade-type"
              value={tradeType}
              onChange={(e) => setTradeType(e.target.value)}
            >
              <option value="Buy">Buy</option>
              <option value="Sell">Sell</option>
            </select>
          </div>
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-strike-price" className="form-label">Strike Price</label>
            <input
              type="text"
              className="form-control"
              id="backtest-strike-price"
              name="strike-price"
              value={strikePrice}
              onChange={(e) => setStrikePrice(e.target.value)}
            />
          </div>
        </div>
        <div className="row">
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-expiry-type" className="form-label">Expiry Type</label>
            <select
              className="form-select"
              id="backtest-expiry-type"
              name="expiry-type"
              value={expiryType}
              onChange={(e) => setExpiryType(e.target.value)}
            >
              <option value="Weekly">Weekly</option>
              <option value="Next Weekly">Next Weekly</option>
              <option value="Monthly">Monthly</option>
            </select>
          </div>
        </div>
        <div className="row">
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-candle-time" className="form-label">Candle Time</label>
            <select
              className="form-select"
              id="backtest-candle-time"
              name="candle-time"
              value={candleTime}
              onChange={(e) => setCandleTime(e.target.value)}
            >
              <option value="5">5 minutes</option>
              <option value="10">10 minutes</option>
              <option value="15">15 minutes</option>
            </select>
          </div>
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-execution-start" className="form-label">Execution Start</label>
            <input
              type="time"
              className="form-control"
              id="backtest-execution-start"
              name="execution-start"
              value={executionStart}
              onChange={(e) => setExecutionStart(e.target.value)}
            />
          </div>
        </div>
        <div className="row">
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-execution-end" className="form-label">Execution End</label>
            <input
              type="time"
              className="form-control"
              id="backtest-execution-end"
              name="execution-end"
              value={executionEnd}
              onChange={(e) => setExecutionEnd(e.target.value)}
            />
          </div>
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-stop-loss" className="form-label">Stop Loss (%)</label>
            <input
              type="number"
              className="form-control"
              id="backtest-stop-loss"
              name="stop-loss"
              value={stopLoss}
              onChange={(e) => setStopLoss(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="row">
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-target-profit" className="form-label">Target Profit (%)</label>
            <input
              type="number"
              className="form-control"
              id="backtest-target-profit"
              name="target-profit"
              value={targetProfit}
              onChange={(e) => setTargetProfit(Number(e.target.value))}
            />
          </div>
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-trailing-stop-loss" className="form-label">Trailing Stop Loss (%)</label>
            <input
              type="number"
              className="form-control"
              id="backtest-trailing-stop-loss"
              name="trailing-stop-loss"
              value={trailingStopLoss}
              onChange={(e) => setTrailingStopLoss(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="row">
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-from-date" className="form-label">From Date</label>
            <input
              type="date"
              className="form-control"
              id="backtest-from-date"
              name="backtest-from-date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="col-md-6 mb-3">
            <label htmlFor="backtest-to-date" className="form-label">To Date</label>
            <input
              type="date"
              className="form-control"
              id="backtest-to-date"
              name="backtest-to-date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
        </div>
        <button type="submit" className="btn btn-primary">Run Backtest</button>
      </form>
      {results && (
        <div className="mt-4">
          <h5>Backtest Results</h5>
          <p>P&L: {results.pnl}</p>
          <p>Number of Trades: {results.trades}</p>
        </div>
      )}
    </div>
  );
};

export default BacktestContent;
