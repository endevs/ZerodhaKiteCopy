import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Customized } from 'recharts';
import { apiUrl } from '../config/api';

interface OptionChainItem {
  strike: number;
  ce: {
    instrument_token: number;
    tradingsymbol: string;
  } | null;
  pe: {
    instrument_token: number;
    tradingsymbol: string;
  } | null;
}

interface OptionChain {
  index: string;
  expiry_date: string;
  trading_date?: string;
  strikes: number[];
  chain: OptionChainItem[];
  is_active: boolean;
  atm_strike?: number;
  index_range?: {
    low: number;
    high: number;
    close: number;
  };
}

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const OptionsContent: React.FC = () => {
  const [selectedIndex, setSelectedIndex] = useState<string>('');
  const [expiryDates, setExpiryDates] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [currentLTP, setCurrentLTP] = useState<number | null>(null);
  const [optionChain, setOptionChain] = useState<OptionChain | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingExpiries, setLoadingExpiries] = useState(false);
  const [selectedOption, setSelectedOption] = useState<{
    instrument_token: number;
    tradingsymbol: string;
    expiry_date: string;
    strike: number;
    type: 'CE' | 'PE';
  } | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [indexCandles, setIndexCandles] = useState<Candle[]>([]);
  const [loadingCandles, setLoadingCandles] = useState(false);
  const [dbStatus, setDbStatus] = useState<any>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [collectingData, setCollectingData] = useState(false);
  const [showDbStatus, setShowDbStatus] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const loadExpiryDates = useCallback(async () => {
    if (!selectedIndex) return;
    
    try {
      setLoadingExpiries(true);
      const response = await fetch(apiUrl(`/api/options/expiry-dates?index=${selectedIndex}`), {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch expiry dates');
      
      const data = await response.json();
      setExpiryDates(data.expiry_dates || []);
      
      // Reset selected expiry when loading new dates
      setSelectedExpiry('');
      setOptionChain(null);
      setCurrentLTP(null);
    } catch (error) {
      console.error('Error loading expiry dates:', error);
    } finally {
      setLoadingExpiries(false);
    }
  }, [selectedIndex]);

  const loadLTP = useCallback(async () => {
    if (!selectedIndex) return;
    
    try {
      const response = await fetch(apiUrl(`/api/options/ltp?index=${selectedIndex}`), {
        credentials: 'include'
      });
      if (!response.ok) return;
      
      const data = await response.json();
      setCurrentLTP(data.ltp);
    } catch (error) {
      console.error('Error loading LTP:', error);
    }
  }, [selectedIndex]);

  const loadIndexCandles = useCallback(async () => {
    if (!selectedIndex || !selectedDate) return;
    
    try {
      const response = await fetch(
        apiUrl(`/api/options/index-candles?index=${selectedIndex}&date=${selectedDate}`),
        {
          credentials: 'include'
        }
      );
      
      if (!response.ok) {
        console.error('Failed to fetch index candles:', response.status);
        setIndexCandles([]);
        return;
      }
      
      const data = await response.json();
      console.log(`Loaded ${data.candles?.length || 0} index candles for ${selectedIndex} on ${selectedDate}`);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:123',message:'loadIndexCandles API response',data:{indexCandlesCount:data.candles?.length||0,hasCandles:!!data.candles,firstCandle:data.candles?.[0]||null,selectedDate,selectedIndex,hasWarning:!!data.warning},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      if (data.warning) {
        console.warn(data.warning);
      }
      
      setIndexCandles(data.candles || []);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:130',message:'setIndexCandles called',data:{indexCandlesCount:data.candles?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    } catch (error) {
      console.error('Error loading index candles:', error);
      setIndexCandles([]);
    }
  }, [selectedIndex, selectedDate]);

  const loadDbStatus = useCallback(async () => {
    try {
      setLoadingStatus(true);
      const response = await fetch(apiUrl('/api/options/db-status'), {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch database status');
      }
      
      const data = await response.json();
      setDbStatus(data);
    } catch (error) {
      console.error('Error loading database status:', error);
      alert('Failed to load database status');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  const triggerDataCollection = useCallback(async (date: string, index?: string) => {
    if (!window.confirm(`Collect data for ${index || 'all indices'} on ${date}? This may take a few minutes.`)) {
      return;
    }
    
    try {
      setCollectingData(true);
      const response = await fetch(apiUrl('/api/options/collect-data'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          date: date,
          index: index
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to collect data');
      }
      
      const result = await response.json();
      alert(result.message || 'Data collection completed!');
      
      // Reload database status
      await loadDbStatus();
    } catch (error: any) {
      console.error('Error triggering data collection:', error);
      alert(`Failed to collect data: ${error.message}`);
    } finally {
      setCollectingData(false);
    }
  }, [loadDbStatus]);

  const fetchOptionChain = async () => {
    if (!selectedIndex) {
      alert('Please select an index');
      return;
    }
    
    if (!selectedExpiry) {
      alert('Please select an expiry date');
      return;
    }
    
    if (!selectedDate) {
      alert('Please select a trading date');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(apiUrl('/api/options/fetch-chain'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          index: selectedIndex,
          expiry_date: selectedExpiry,
          trading_date: selectedDate,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch option chain');
      }

      const data: OptionChain = await response.json();
      setOptionChain(data);
      
      // Load LTP if active
      if (data.is_active) {
        loadLTP();
      }
      
      // Scroll to ATM after a short delay to ensure table is rendered
      setTimeout(() => {
        scrollToATM();
      }, 100);
    } catch (error: any) {
      console.error('Error fetching option chain:', error);
      alert(error.message || 'Failed to fetch option chain');
    } finally {
      setLoading(false);
    }
  };

  const loadOptionCandles = async (instrumentToken: number, tradingsymbol: string, strike: number, type: 'CE' | 'PE') => {
    if (!selectedDate) {
      alert('Please select a trading date');
      return;
    }
    
    try {
      setLoadingCandles(true);
      setSelectedOption({
        instrument_token: instrumentToken,
        tradingsymbol: tradingsymbol,
        expiry_date: selectedExpiry,
        strike: strike,
        type: type,
      });

      const response = await fetch(
        apiUrl(`/api/options/candles?instrument_token=${instrumentToken}&expiry_date=${selectedDate}`),
        {
          credentials: 'include'
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch candles');
      }

      const data = await response.json();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:279',message:'loadOptionCandles API response',data:{candlesCount:data.candles?.length||0,hasCandles:!!data.candles,firstCandle:data.candles?.[0]||null,selectedDate,instrumentToken},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      setCandles(data.candles || []);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:281',message:'setCandles called',data:{candlesCount:data.candles?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    } catch (error) {
      console.error('Error loading candles:', error);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:283',message:'loadOptionCandles error',data:{error:String(error)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      alert('Failed to load candle data');
    } finally {
      setLoadingCandles(false);
    }
  };

  // Format expiry date for display
  const formatExpiryDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // Calculate EMA5
  const calculateEMA = (data: number[], period: number): number[] => {
    const ema: number[] = [];
    const multiplier = 2 / (period + 1);
    
    // First value is just the first close price
    if (data.length > 0) {
      ema.push(data[0]);
    }
    
    // Calculate EMA for remaining values
    for (let i = 1; i < data.length; i++) {
      const value = (data[i] - ema[i - 1]) * multiplier + ema[i - 1];
      ema.push(value);
    }
    
    return ema;
  };

  // Format candles for chart display with EMA5 (memoized)
  const chartData = useMemo(() => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:318',message:'chartData useMemo entry',data:{selectedDate,hasSelectedDate:!!selectedDate,candlesCount:candles.length,indexCandlesCount:indexCandles.length,selectedIndex},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    if (!selectedDate) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:320',message:'chartData early return - no selectedDate',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      return [];
    }
    
    // Filter candles to only include the selected date
    const selectedDateObj = new Date(selectedDate);
    const selectedDateStr = selectedDateObj.toISOString().split('T')[0]; // YYYY-MM-DD format
    
    const filteredCandles = candles.filter(candle => {
      const candleDate = new Date(candle.timestamp);
      const candleDateStr = candleDate.toISOString().split('T')[0];
      return candleDateStr === selectedDateStr;
    });
    
    // Filter index candles to only include the selected date
    const filteredIndexCandles = indexCandles.filter(candle => {
      const candleDate = new Date(candle.timestamp);
      const candleDateStr = candleDate.toISOString().split('T')[0];
      return candleDateStr === selectedDateStr;
    });
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:336',message:'chartData after filtering',data:{selectedDateStr,filteredCandlesCount:filteredCandles.length,filteredIndexCandlesCount:filteredIndexCandles.length,originalCandlesCount:candles.length,originalIndexCandlesCount:indexCandles.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    // Create a map of index candles by time for quick lookup
    const indexCandleMap = new Map<string, Candle>();
    filteredIndexCandles.forEach(ic => {
      const icTime = new Date(ic.timestamp).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      });
      indexCandleMap.set(icTime, ic);
    });
    
    const formatted = filteredCandles.map(candle => {
      const candleTime = new Date(candle.timestamp).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      });
      
      // Find matching index candle - try exact match first
      let indexCandle = indexCandleMap.get(candleTime);
      
      // If no exact match, try to find closest match (within same minute)
      if (!indexCandle && filteredIndexCandles.length > 0) {
        const candleTimestamp = new Date(candle.timestamp).getTime();
        // Find index candle with closest timestamp (within 5 minutes)
        const closest = filteredIndexCandles.reduce((closest, ic) => {
          const icTimestamp = new Date(ic.timestamp).getTime();
          const diff = Math.abs(candleTimestamp - icTimestamp);
          const closestDiff = closest ? Math.abs(candleTimestamp - new Date(closest.timestamp).getTime()) : Infinity;
          return diff < closestDiff && diff <= 5 * 60 * 1000 ? ic : closest;
        }, undefined as Candle | undefined);
        indexCandle = closest;
      }
      
      return {
        time: candleTime,
        timestamp: candle.timestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        indexClose: indexCandle?.close ?? null,
      };
    });
    
    // Log only when data changes (using window to track previous state)
    if (formatted.length > 0) {
      const logKey = `${selectedDate}-${selectedIndex}-${formatted.length}-${filteredIndexCandles.length}`;
      if (!(window as any).lastChartLogKey || (window as any).lastChartLogKey !== logKey) {
        const matchedCount = formatted.filter(f => f.indexClose !== null).length;
        console.log(`[Chart Data] ${matchedCount}/${formatted.length} candles matched with index data for ${selectedDate}`);
        if (matchedCount === 0 && filteredIndexCandles.length > 0) {
          console.warn('[Chart] No index candles matched! Check time alignment.');
        }
        (window as any).lastChartLogKey = logKey;
      }
    }
    
    // Calculate EMA5 only on option candles
    const closes = formatted.map(c => c.close);
    const ema5 = calculateEMA(closes, 5);
    
    // Add EMA5 to each data point
    const result = formatted.map((item, index) => ({
      ...item,
      ema5: ema5[index] || null,
    }));
    
    // #region agent log
    const sampleItem = result[0] || null;
    const priceValues = result.map(r => ({close:r.close,open:r.open,high:r.high,low:r.low,ema5:r.ema5,indexClose:r.indexClose})).slice(0,3);
    const hasValidPrices = result.some(r => typeof r.close === 'number' && !isNaN(r.close));
    const hasValidIndexClose = result.some(r => r.indexClose !== null && typeof r.indexClose === 'number');
    fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:402',message:'chartData final result',data:{resultCount:result.length,sampleItem,priceValues,hasValidPrices,hasValidIndexClose,ema5Count:ema5.length,hasVolume:result.some(r=>r.volume>0)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    return result;
  }, [selectedDate, candles, indexCandles, selectedIndex]);

  // Custom Candlestick Component for Recharts
  const CandlestickRenderer = useCallback((props: any) => {
    try {
      // #region agent log
      const propKeys = Object.keys(props || {});
      fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:446',message:'CandlestickRenderer entry - full props',data:{propKeys,hasXAxisMap:!!props?.xAxisMap,hasYAxisMap:!!props?.yAxisMap,hasLayout:!!props?.layout,hasWidth:!!props?.width,chartDataCount:chartData.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      
      // Try different ways to access axis maps
      const xAxisMap = props?.xAxisMap || props?.layout?.xAxisMap;
      const yAxisMap = props?.yAxisMap || props?.layout?.yAxisMap;
      const width = props?.width || props?.layout?.width;
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:453',message:'CandlestickRenderer after prop access',data:{hasXAxisMap:!!xAxisMap,hasYAxisMap:!!yAxisMap,hasWidth:!!width,xAxisMapKeys:xAxisMap?Object.keys(xAxisMap):[],yAxisMapKeys:yAxisMap?Object.keys(yAxisMap):[]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      
      if (!xAxisMap || !yAxisMap) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:457',message:'CandlestickRenderer early return - no axis maps',data:{propsStructure:JSON.stringify(Object.keys(props||{}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        return null;
      }
      
      // Use chartData from closure (memoized value)
      if (!chartData || chartData.length === 0) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:417',message:'CandlestickRenderer early return - no chartData',data:{chartDataCount:chartData?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        return null;
      }
      
      const xKey = Object.keys(xAxisMap)[0];
      const yKey = Object.keys(yAxisMap)[0];
      if (!xKey || !yKey) return null;

      const xAxis = xAxisMap[xKey];
      const yAxis = yAxisMap[yKey];
      const xScale = xAxis?.scale;
      const yScale = yAxis?.scale;
      if (!xScale || !yScale) return null;

      const dataLength = chartData.length;
      const chartWidth = width || 800;
      const bandSize = dataLength > 0 ? chartWidth / dataLength : 10;
      const candleWidth = Math.max(4, Math.floor(bandSize * 0.5));
      const half = Math.floor(candleWidth / 2);

      return (
        <g>
          {chartData.map((item: any, index: number) => {
            let xPos: number;
            if (typeof xScale === 'function') {
              xPos = xScale(item.time);
            } else if (xScale && typeof xScale.bandwidth === 'function') {
              xPos = xScale(item.time) || (index * bandSize);
            } else {
              xPos = index * bandSize;
            }

            if (typeof xPos !== 'number' || isNaN(xPos)) return null;

            const centerX = xPos + (bandSize / 2);
            const startX = centerX - half;

            const isRising = item.close >= item.open;
            const highY = yScale(item.high);
            const lowY = yScale(item.low);
            const openY = yScale(item.open);
            const closeY = yScale(item.close);
            
            // #region agent log
            if (index === 0) {
              fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:488',message:'CandlestickRenderer first candle Y values',data:{item:{open:item.open,high:item.high,low:item.low,close:item.close},yValues:{highY,lowY,openY,closeY},yScaleType:typeof yScale,yScaleIsFunction:typeof yScale==='function'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
            }
            // #endregion

            if ([highY, lowY, openY, closeY].some((v: any) => typeof v !== 'number' || isNaN(v))) {
              // #region agent log
              if (index === 0) {
                fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:495',message:'CandlestickRenderer invalid Y values',data:{highY,lowY,openY,closeY,item},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
              }
              // #endregion
              return null;
            }

            const bodyTop = isRising ? closeY : openY;
            const bodyBottom = isRising ? openY : closeY;
            const bodyHeight = Math.max(2, Math.abs(bodyBottom - bodyTop));

            const color = isRising ? '#28a745' : '#dc3545';
            
            return (
              <g key={index}>
                {/* Wick (High-Low line) */}
                <line
                  x1={centerX}
                  y1={highY}
                  x2={centerX}
                  y2={lowY}
                  stroke={color}
                  strokeWidth={2}
                />
                {/* Candle body */}
                <rect
                  x={startX}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={color}
                  stroke={color}
                  strokeWidth={1}
                  opacity={0.9}
                />
              </g>
            );
          })}
        </g>
      );
    } catch (error) {
      console.error('Error rendering candlesticks:', error);
      return null;
    }
  }, [chartData]);

  // Calculate ATM strike (closest to selected date's index close or backend-provided ATM)
  const getATMStrike = (): number | null => {
    if (!optionChain || !optionChain.chain || optionChain.chain.length === 0) {
      return null;
    }
    
    // If backend provided ATM strike, use it
    if (optionChain.atm_strike) {
      // Find closest strike in chain to backend ATM
      let closestStrike = optionChain.chain[0].strike;
      let minDiff = Math.abs(optionChain.chain[0].strike - optionChain.atm_strike);
      
      for (const item of optionChain.chain) {
        const diff = Math.abs(item.strike - optionChain.atm_strike);
        if (diff < minDiff) {
          minDiff = diff;
          closestStrike = item.strike;
        }
      }
      return closestStrike;
    }
    
    // Fallback: calculate from index candles for selected date
    if (selectedDate && indexCandles.length > 0) {
      const selectedDateStr = new Date(selectedDate).toISOString().split('T')[0];
      const dayCandles = indexCandles.filter(c => {
        const candleDate = new Date(c.timestamp).toISOString().split('T')[0];
        return candleDate === selectedDateStr;
      });
      
      if (dayCandles.length > 0) {
        const closes = dayCandles.map(c => c.close);
        const avgClose = closes.reduce((a, b) => a + b, 0) / closes.length;
        const strikeStep = selectedIndex === 'BANKNIFTY' ? 100 : 50;
        const calculatedATM = Math.round(avgClose / strikeStep) * strikeStep;
        
        // Find closest strike in chain
        let atmStrike = optionChain.chain[0].strike;
        let minDiff = Math.abs(optionChain.chain[0].strike - calculatedATM);
        
        for (const item of optionChain.chain) {
          const diff = Math.abs(item.strike - calculatedATM);
          if (diff < minDiff) {
            minDiff = diff;
            atmStrike = item.strike;
          }
        }
        return atmStrike;
      }
    }
    
    // Last resort: use current LTP if available
    if (currentLTP && optionChain.chain.length > 0) {
      const strikeStep = selectedIndex === 'BANKNIFTY' ? 100 : 50;
      const atmStrike = Math.round(currentLTP / strikeStep) * strikeStep;
      
      // Find closest strike in chain
      let closestStrike = optionChain.chain[0].strike;
      let minDiff = Math.abs(optionChain.chain[0].strike - atmStrike);
      
      for (const item of optionChain.chain) {
        const diff = Math.abs(item.strike - atmStrike);
        if (diff < minDiff) {
          minDiff = diff;
          closestStrike = item.strike;
        }
      }
      return closestStrike;
    }
    
    return null;
  };

  // Scroll to ATM row in the middle of the table
  const scrollToATM = useCallback(() => {
    if (!tableContainerRef.current || !optionChain || !currentLTP) {
      return;
    }
    
    const atmStrike = getATMStrike();
    if (!atmStrike) return;
    
    // Find the index of ATM strike
    const atmIndex = optionChain.chain.findIndex(item => item.strike === atmStrike);
    if (atmIndex === -1) return;
    
    // Get the table rows
    const tbody = tableContainerRef.current.querySelector('tbody');
    if (!tbody) return;
    
    const rows = Array.from(tbody.querySelectorAll('tr'));
    if (rows.length === 0) return;
    
    const atmRow = rows[atmIndex];
    if (!atmRow) return;
    
    // Calculate scroll position to center ATM row
    const containerHeight = tableContainerRef.current.clientHeight;
    const rowHeight = atmRow.clientHeight;
    const scrollTop = atmRow.offsetTop - (containerHeight / 2) + (rowHeight / 2);
    
    tableContainerRef.current.scrollTo({
      top: Math.max(0, scrollTop),
      behavior: 'smooth'
    });
  }, [optionChain, currentLTP]);

  // Load expiry dates when index is selected
  useEffect(() => {
    if (selectedIndex) {
      loadExpiryDates();
    } else {
      // Clear expiry dates when index is deselected
      setExpiryDates([]);
      setSelectedExpiry('');
      setOptionChain(null);
      setCurrentLTP(null);
    }
  }, [selectedIndex, loadExpiryDates]);

  // Load index candles when date or index changes
  useEffect(() => {
    if (selectedIndex && selectedDate) {
      loadIndexCandles();
    } else {
      setIndexCandles([]);
    }
  }, [selectedIndex, selectedDate, loadIndexCandles]);

  // Load LTP when index or expiry changes (if active)
  useEffect(() => {
    if (selectedExpiry && optionChain?.is_active) {
      loadLTP();
      // Set up interval to refresh LTP every 5 seconds for active contracts
      const interval = setInterval(loadLTP, 5000);
      return () => clearInterval(interval);
    }
  }, [selectedIndex, selectedExpiry, optionChain?.is_active, loadLTP]);

  // Scroll to ATM when LTP updates or chain loads
  useEffect(() => {
    if (optionChain && currentLTP && tableContainerRef.current) {
      // Use a small delay to ensure DOM is updated
      const timer = setTimeout(() => {
        scrollToATM();
      }, 200);
      
      return () => clearTimeout(timer);
    }
  }, [currentLTP, optionChain, scrollToATM]);

  // Load DB status when tab is shown
  useEffect(() => {
    if (showDbStatus) {
      loadDbStatus();
    }
  }, [showDbStatus, loadDbStatus]);

  return (
    <div className="container-fluid py-4">
      <div className="row mb-4">
        <div className="col-12">
          <h2 className="mb-4">Options Trading Analysis</h2>
          
          {/* Tabs for main content and DB status */}
          <ul className="nav nav-tabs mb-4" role="tablist">
            <li className="nav-item" role="presentation">
              <button
                className={`nav-link ${!showDbStatus ? 'active' : ''}`}
                onClick={() => setShowDbStatus(false)}
              >
                Options Analysis
              </button>
            </li>
            <li className="nav-item" role="presentation">
              <button
                className={`nav-link ${showDbStatus ? 'active' : ''}`}
                onClick={() => setShowDbStatus(true)}
              >
                Database Record Status
              </button>
            </li>
          </ul>

          {!showDbStatus ? (
            <>
              {/* Controls */}
          <div className="card mb-4">
            <div className="card-body">
              <div className="row g-3 align-items-end">
                <div className="col-md-3">
                  <label className="form-label">Index</label>
                  <select
                    className="form-select"
                    value={selectedIndex}
                    onChange={(e) => {
                      setSelectedIndex(e.target.value);
                      setSelectedExpiry('');
                      setOptionChain(null);
                      setCurrentLTP(null);
                    }}
                  >
                    <option value="">Select Index</option>
                    <option value="BANKNIFTY">BANKNIFTY</option>
                    <option value="NIFTY">NIFTY</option>
                  </select>
                </div>
                
                <div className="col-md-3">
                  <label className="form-label">Expiry Date</label>
                  <select
                    className="form-select"
                    value={selectedExpiry}
                    onChange={(e) => {
                      setSelectedExpiry(e.target.value);
                      setSelectedDate('');
                      setOptionChain(null);
                    }}
                    disabled={!selectedIndex || loadingExpiries}
                  >
                    <option value="">{selectedIndex ? 'Select Expiry Date' : 'Select Index First'}</option>
                    {expiryDates.map((date) => (
                      <option key={date} value={date}>
                        {formatExpiryDate(date)}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="col-md-2">
                  <label className="form-label">Trading Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    disabled={!selectedExpiry}
                    max={new Date().toISOString().split('T')[0]}
                  />
                </div>
                
                <div className="col-md-2">
                  <button
                    className="btn btn-primary w-100"
                    onClick={fetchOptionChain}
                    disabled={!selectedExpiry || loading}
                  >
                    {loading ? 'Loading...' : 'Fetch Chain'}
                  </button>
                </div>
                
                <div className="col-md-2">
                  {currentLTP !== null && optionChain?.is_active && (
                    <div>
                      <label className="form-label text-muted small">Current LTP</label>
                      <div className="h5 mb-0 text-primary">
                        ₹{currentLTP.toFixed(2)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {selectedExpiry && (
                <div className="row g-3 mt-2">
                  <div className="col-md-12">
                    <small className="text-muted">
                      <strong>Note:</strong> Select a trading date to view historical candlestick data for any option contract.
                    </small>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Option Chain Display */}
          {optionChain && (
            <div className="card">
              <div className="card-header">
                <h5 className="mb-0">
                  Option Chain - {selectedIndex} {formatExpiryDate(optionChain.expiry_date)}
                  {optionChain.is_active && <span className="badge bg-success ms-2">Active</span>}
                </h5>
              </div>
              <div className="card-body">
                <div 
                  ref={tableContainerRef}
                  className="table-responsive" 
                  style={{ maxHeight: '600px', overflowY: 'auto' }}
                >
                  <table className="table table-sm table-hover">
                    <thead className="table-dark sticky-top">
                      <tr>
                        <th className="text-success">CE</th>
                        <th className="text-center">Strike</th>
                        <th className="text-danger">PE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optionChain.chain.map((item) => {
                        const atmStrike = getATMStrike();
                        const isATM = atmStrike !== null && item.strike === atmStrike;
                        
                        return (
                          <tr 
                            key={item.strike}
                            className={isATM ? 'table-warning' : ''}
                            style={isATM ? { backgroundColor: '#fff3cd', fontWeight: 'bold' } : {}}
                          >
                            <td>
                              {item.ce ? (
                                <button
                                  className="btn btn-sm btn-outline-success"
                                  onClick={() => {
                                    if (!selectedDate) {
                                      alert('Please select a trading date first');
                                      return;
                                    }
                                    loadOptionCandles(
                                      item.ce!.instrument_token,
                                      item.ce!.tradingsymbol,
                                      item.strike,
                                      'CE'
                                    );
                                  }}
                                  disabled={!selectedDate}
                                  title={!selectedDate ? 'Select a trading date first' : ''}
                                >
                                  {item.ce.tradingsymbol}
                                </button>
                              ) : (
                                <span className="text-muted">-</span>
                              )}
                            </td>
                            <td className="fw-bold text-center" style={{ backgroundColor: isATM ? '#fff3cd' : 'transparent' }}>
                              {item.strike}
                              {isATM && <span className="badge bg-warning text-dark ms-2">ATM</span>}
                            </td>
                            <td>
                              {item.pe ? (
                                <button
                                  className="btn btn-sm btn-outline-danger"
                                  onClick={() => {
                                    if (!selectedDate) {
                                      alert('Please select a trading date first');
                                      return;
                                    }
                                    loadOptionCandles(
                                      item.pe!.instrument_token,
                                      item.pe!.tradingsymbol,
                                      item.strike,
                                      'PE'
                                    );
                                  }}
                                  disabled={!selectedDate}
                                  title={!selectedDate ? 'Select a trading date first' : ''}
                                >
                                  {item.pe.tradingsymbol}
                                </button>
                              ) : (
                                <span className="text-muted">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Candle Chart */}
          {selectedOption && selectedDate && (
            <div className="card mt-4">
              <div className="card-header">
                <h5 className="mb-0">
                  {selectedOption.tradingsymbol} - 5 Minute Candlestick Chart
                  <span className="badge bg-info ms-2">
                    Expiry: {formatExpiryDate(selectedOption.expiry_date)}
                  </span>
                  {selectedDate && (
                    <span className="badge bg-secondary ms-2">
                      Date: {formatExpiryDate(selectedDate)}
                    </span>
                  )}
                </h5>
              </div>
              <div className="card-body">
                {loadingCandles ? (
                  <div className="text-center py-4">
                    <div className="spinner-border" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : candles.length > 0 ? (
                  <div>
                    {/* #region agent log */}
                    {(() => {
                      fetch('http://127.0.0.1:7242/ingest/09399331-58f8-4bb3-8b5a-6b5354452000',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OptionsContent.tsx:923',message:'Chart rendering',data:{chartDataCount:chartData.length,candlesLength:candles.length,hasChartData:chartData.length>0,selectedDate,selectedOption:selectedOption?.tradingsymbol},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                      return null;
                    })()}
                    {/* #endregion */}
                    <ResponsiveContainer width="100%" height={500}>
                      <ComposedChart
                        data={chartData}
                        margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="time" 
                          angle={-45}
                          textAnchor="end"
                          height={80}
                          interval="preserveStartEnd"
                        />
                        <YAxis 
                          yAxisId="price"
                          domain={['auto', 'auto']}
                          label={{ value: 'Price', angle: -90, position: 'insideLeft' }}
                        />
                        <YAxis 
                          yAxisId="volume"
                          orientation="right"
                          domain={['auto', 'auto']}
                          label={{ value: 'Volume', angle: 90, position: 'insideRight' }}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-dark text-white p-2 rounded shadow" style={{ opacity: 0.9 }}>
                                  <p className="mb-1"><strong>Time:</strong> {new Date(data.timestamp).toLocaleString()}</p>
                                  <p className="mb-1"><strong>Open:</strong> ₹{data.open.toFixed(2)}</p>
                                  <p className="mb-1"><strong>High:</strong> ₹{data.high.toFixed(2)}</p>
                                  <p className="mb-1"><strong>Low:</strong> ₹{data.low.toFixed(2)}</p>
                                  <p className="mb-1"><strong>Close:</strong> ₹{data.close.toFixed(2)}</p>
                                  {data.indexClose !== null && (
                                    <p className="mb-1"><strong>{selectedIndex} Close:</strong> ₹{data.indexClose.toFixed(2)}</p>
                                  )}
                                  {data.ema5 !== null && (
                                    <p className="mb-1"><strong>EMA5:</strong> ₹{data.ema5.toFixed(2)}</p>
                                  )}
                                  <p className="mb-0"><strong>Volume:</strong> {data.volume.toLocaleString()}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Legend />
                        <Customized component={CandlestickRenderer} />
                        {/* Close Price Line - connects all close prices */}
                        <Line
                          yAxisId="price"
                          type="monotone"
                          dataKey="close"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          name="Option Close Price"
                          dot={false}
                          connectNulls={false}
                        />
                        {/* Index Close Price Line */}
                        <Line
                          yAxisId="price"
                          type="monotone"
                          dataKey="indexClose"
                          stroke="#9333ea"
                          strokeWidth={3}
                          strokeDasharray="8 4"
                          name={`${selectedIndex} Close`}
                          dot={false}
                          connectNulls={true}
                          isAnimationActive={false}
                        />
                        {/* EMA5 Line */}
                        <Line
                          yAxisId="price"
                          type="monotone"
                          dataKey="ema5"
                          stroke="#ffc107"
                          strokeWidth={2}
                          name="EMA5"
                          dot={false}
                          connectNulls={false}
                        />
                        {/* Volume Line */}
                        <Line
                          yAxisId="volume"
                          type="monotone"
                          dataKey="volume"
                          stroke="#8884d8"
                          strokeWidth={2}
                          name="Volume"
                          dot={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div className="mt-3">
                      <small className="text-muted">
                        Total Candles: {chartData.length} | 
                        Date: {selectedDate ? formatExpiryDate(selectedDate) : 'N/A'}
                        {chartData.length > 0 && (
                          <span> | Time Range: {chartData[0]?.time} to {chartData[chartData.length - 1]?.time}</span>
                        )}
                      </small>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-muted mb-2">No candle data available for selected date</p>
                    {indexCandles.length === 0 && (
                      <p className="text-warning small mb-2">
                        No index data available. Check the "Database Record Status" tab to see available dates and collect data.
                      </p>
                    )}
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => setShowDbStatus(true)}
                    >
                      View Database Status
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
            </>
          ) : (
            // Database Record Status Tab
            <div className="card">
              <div className="card-header d-flex justify-content-between align-items-center">
                <h5 className="mb-0">Database Record Status</h5>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => loadDbStatus()}
                  disabled={loadingStatus}
                >
                  {loadingStatus ? 'Loading...' : 'Refresh'}
                </button>
              </div>
              <div className="card-body">
                {loadingStatus ? (
                  <div className="text-center py-4">
                    <div className="spinner-border" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : dbStatus ? (
                  <>
                    {/* Summary */}
                    <div className="row mb-4">
                      <div className="col-md-12">
                        <h6>Summary</h6>
                        <div className="table-responsive">
                          <table className="table table-sm table-bordered">
                            <thead>
                              <tr>
                                <th>Index</th>
                                <th>Dates Available</th>
                                <th>Earliest Date</th>
                                <th>Latest Date</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(dbStatus.summary || {}).map(([index, data]: [string, any]) => (
                                <tr key={index}>
                                  <td><strong>{index}</strong></td>
                                  <td>{data.date_count}</td>
                                  <td>{data.earliest_date}</td>
                                  <td>{data.latest_date}</td>
                                </tr>
                              ))}
                              {Object.keys(dbStatus.summary || {}).length === 0 && (
                                <tr>
                                  <td colSpan={4} className="text-center text-muted">No data available</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Index Data Table */}
                    <div className="row mb-4">
                      <div className="col-md-12">
                        <h6>Index 5-Minute Candles</h6>
                        <div className="table-responsive" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                          <table className="table table-sm table-striped table-bordered">
                            <thead className="table-light sticky-top">
                              <tr>
                                <th>Index</th>
                                <th>Date</th>
                                <th>Candle Count</th>
                                <th>First Candle</th>
                                <th>Last Candle</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dbStatus.index_data && dbStatus.index_data.length > 0 ? (
                                dbStatus.index_data.map((item: any, idx: number) => (
                                  <tr key={idx}>
                                    <td>{item.index}</td>
                                    <td>{item.date}</td>
                                    <td>{item.candle_count}</td>
                                    <td>{item.first_candle ? new Date(item.first_candle).toLocaleTimeString() : '-'}</td>
                                    <td>{item.last_candle ? new Date(item.last_candle).toLocaleTimeString() : '-'}</td>
                                    <td>
                                      <button
                                        className="btn btn-sm btn-outline-primary"
                                        onClick={() => triggerDataCollection(item.date, item.index)}
                                        disabled={collectingData}
                                      >
                                        {collectingData ? 'Collecting...' : 'Update'}
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={6} className="text-center text-muted">No index data available</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Option Contracts Table */}
                    <div className="row mb-4">
                      <div className="col-md-12">
                        <h6>Option Contracts</h6>
                        <div className="table-responsive" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                          <table className="table table-sm table-striped table-bordered">
                            <thead className="table-light sticky-top">
                              <tr>
                                <th>Index</th>
                                <th>Date</th>
                                <th>Contract Count</th>
                                <th>Strike Count</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dbStatus.option_data && dbStatus.option_data.length > 0 ? (
                                dbStatus.option_data.map((item: any, idx: number) => (
                                  <tr key={idx}>
                                    <td>{item.index}</td>
                                    <td>{item.date}</td>
                                    <td>{item.contract_count}</td>
                                    <td>{item.strike_count}</td>
                                    <td>
                                      <button
                                        className="btn btn-sm btn-outline-primary"
                                        onClick={() => triggerDataCollection(item.date, item.index)}
                                        disabled={collectingData}
                                      >
                                        {collectingData ? 'Collecting...' : 'Update'}
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={5} className="text-center text-muted">No option contracts available</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Manual Collection */}
                    <div className="row">
                      <div className="col-md-12">
                        <div className="card bg-light">
                          <div className="card-body">
                            <h6>Manual Data Collection</h6>
                            <p className="text-muted small mb-3">
                              Collect data for a specific date. This will fetch index candles and option chains from Zerodha API.
                            </p>
                            <div className="row g-3">
                              <div className="col-md-4">
                                <label className="form-label">Date</label>
                                <input
                                  type="date"
                                  className="form-control"
                                  id="collectionDate"
                                  max={new Date().toISOString().split('T')[0]}
                                />
                              </div>
                              <div className="col-md-4">
                                <label className="form-label">Index (Optional)</label>
                                <select className="form-select" id="collectionIndex">
                                  <option value="">All Indices</option>
                                  <option value="BANKNIFTY">BANKNIFTY</option>
                                  <option value="NIFTY">NIFTY</option>
                                </select>
                              </div>
                              <div className="col-md-4 d-flex align-items-end">
                                <button
                                  className="btn btn-primary"
                                  onClick={() => {
                                    const dateInput = document.getElementById('collectionDate') as HTMLInputElement;
                                    const indexSelect = document.getElementById('collectionIndex') as HTMLSelectElement;
                                    if (dateInput.value) {
                                      triggerDataCollection(dateInput.value, indexSelect.value || undefined);
                                    } else {
                                      alert('Please select a date');
                                    }
                                  }}
                                  disabled={collectingData}
                                >
                                  {collectingData ? 'Collecting...' : 'Collect Data'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4 text-muted">
                    Click "Refresh" to load database status
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OptionsContent;
