# MVP Integration Guide

## 🚀 Quick Start

### 1. Backend Setup
The indicators and metrics are ready to use. No additional backend setup needed.

### 2. Frontend Integration

#### Import New Components
```typescript
import EnhancedStrategyBuilder from './components/EnhancedStrategyBuilder';
import InteractiveChart from './components/InteractiveChart';
import BacktestResultsDashboard from './components/BacktestResultsDashboard';
```

#### Add to Dashboard Routes
```typescript
// In Dashboard.tsx
case 'strategy-builder':
  return <EnhancedStrategyBuilder />;
case 'charts':
  return <InteractiveChart candles={chartData} indicators={indicatorData} />;
```

### 3. Using Enhanced Backtest

The backtest endpoint now returns enhanced metrics:
```javascript
fetch('/backtest', {
  method: 'POST',
  body: formData
})
.then(res => res.json())
.then(data => {
  // data.metrics contains:
  // - sharpe_ratio
  // - max_drawdown_pct
  // - win_rate
  // - profit_factor
  // - equity_curve
  // etc.
  
  // Use BacktestResultsDashboard component
  <BacktestResultsDashboard metrics={data.metrics} trades={data.trades} />
});
```

### 4. Using Indicators in Strategies

```python
# In your strategy file (e.g., backend/strategies/orb.py)
from utils.indicators import calculate_ema, calculate_rsi, calculate_bollinger_bands
import pandas as pd

# Convert candles to DataFrame
df = pd.DataFrame(historical_data)

# Calculate indicators
df['ema_12'] = calculate_ema(df['close'], 12)
df['rsi'] = calculate_rsi(df['close'], 14)
upper_bb, middle_bb, lower_bb = calculate_bollinger_bands(df['close'], 20, 2.0)
```

## 📊 Component Usage Examples

### EnhancedStrategyBuilder
```typescript
<EnhancedStrategyBuilder />
// Features:
// - Select multiple indicators
// - Configure parameters
// - Build conditions with AND/OR logic
// - Real-time preview
```

### InteractiveChart
```typescript
const candleData = [
  { time: '2024-01-01', open: 100, high: 105, low: 99, close: 103, volume: 1000 },
  // ... more candles
];

const indicators = {
  sma: [{ time: '2024-01-01', value: 101 }],
  ema: [{ time: '2024-01-01', value: 102 }],
  // ... more indicators
};

<InteractiveChart 
  candles={candleData}
  indicators={indicators}
  timeframe="5min"
  height={500}
/>
```

### BacktestResultsDashboard
```typescript
const metrics = {
  total_trades: 25,
  win_rate: 65.0,
  total_pnl: 15000,
  sharpe_ratio: 1.45,
  // ... more metrics
};

<BacktestResultsDashboard metrics={metrics} trades={tradeList} />
```

## 🔄 Next Integration Steps

1. **Update BacktestContent.tsx** to use `BacktestResultsDashboard`
2. **Update DashboardContent.tsx** to include `EnhancedStrategyBuilder`
3. **Add chart integration** to MarketReplayContent
4. **Connect strategy builder** to backend save endpoint

## 📝 API Endpoints

### Enhanced Backtest Response
```
POST /backtest
Response: {
  "status": "success",
  "pnl": 15000,
  "trades": 25,
  "metrics": {
    "sharpe_ratio": 1.45,
    "max_drawdown_pct": 12.5,
    "win_rate": 65.0,
    "profit_factor": 2.1,
    "equity_curve": {...}
  }
}
```

## 🎨 UI Enhancements

All components use Bootstrap 5 for styling:
- Cards with shadows
- Responsive grid layout
- Color-coded metrics
- Interactive charts

## ⚡ Performance Notes

- Indicators calculated server-side
- Charts rendered client-side with Recharts
- Large datasets handled efficiently
- Real-time updates via WebSocket (existing)



