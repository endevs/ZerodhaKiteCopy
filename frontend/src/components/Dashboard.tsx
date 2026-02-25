import React, { useState, useEffect, useCallback, useRef } from 'react';
import Layout from './Layout';
import Navigation from './Navigation';
import DashboardContent from './DashboardContent';
import AlgoVisualizationContent from './AlgoVisualizationContent';
import ChartModal from './ChartModal';
import EnhancedRealTimeStrategyMonitor from './EnhancedRealTimeStrategyMonitor';
import AIMLContent from './AIMLContent';
import LiveTradeContent from './LiveTradeContent';
import AdminContent from './AdminContent';
import ProfileContent from './ProfileContent';
import SubscribeContent from './SubscribeContent';
import OptionsContent from './OptionsContent';
import AdvancedChartsContent from './AdvancedChartsContent';
import RiskDisclosureModal from './RiskDisclosureModal';
import { apiUrl } from '../config/api';
import { useSocket } from '../hooks/useSocket';

const Dashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [userName, setUserName] = useState<string>('Guest');
  const [kiteClientId, setKiteClientId] = useState<string | null>(null);
  const [niftyPrice, setNiftyPrice] = useState<string>('Loading...');
  const [bankNiftyPrice, setBankNiftyPrice] = useState<string>('Loading...');
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const [showChartModal, setShowChartModal] = useState<boolean>(false);
  const [chartInstrumentToken, setChartInstrumentToken] = useState<string | undefined>(undefined);
  const [showLiveStrategyModal, setShowLiveStrategyModal] = useState<boolean>(false);
  const [liveStrategyId, setLiveStrategyId] = useState<string | null>(null);
  const [showRiskDisclosure, setShowRiskDisclosure] = useState<boolean>(false);
  const warningShownRef = useRef<boolean>(false);
  const socket = useSocket();

  const handleViewChart = useCallback((instrumentToken: string) => {
    setChartInstrumentToken(instrumentToken);
    setShowChartModal(true);
  }, []);

  const handleCloseChartModal = useCallback(() => {
    setShowChartModal(false);
    setChartInstrumentToken(undefined);
  }, []);

  const handleViewLiveStrategy = useCallback((strategyId: string) => {
    setLiveStrategyId(strategyId);
    setShowLiveStrategyModal(true);
  }, []);

  const handleCloseLiveStrategyModal = useCallback(() => {
    setShowLiveStrategyModal(false);
    setLiveStrategyId(null);
  }, []);


  const handleRiskDisclosureClose = useCallback(() => {
    setShowRiskDisclosure(false);
    // Mark as shown in this session (will show again after next login/new session)
    sessionStorage.setItem('riskDisclosureShown', 'true');
  }, []);

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const response = await fetch(apiUrl('/api/user-data'), { credentials: 'include' });
        const data = await response.json();
        if (response.ok) {
          // Use user_name from backend (which falls back to email if name not set)
          setUserName(data.user_name || data.email || 'User');
          setKiteClientId(data.kite_client_id || null);
          
          // Show risk disclosure modal after successful login (once per session)
          const riskDisclosureShown = sessionStorage.getItem('riskDisclosureShown');
          if (!riskDisclosureShown) {
            // Small delay to ensure page is fully loaded
            setTimeout(() => {
              setShowRiskDisclosure(true);
            }, 1000);
          }
          
          const hasAccessToken = data.access_token_present || false;
          
          // Check admin status
          try {
            const adminResponse = await fetch(apiUrl('/api/admin/check'), { credentials: 'include' });
            const adminData = await adminResponse.json();
            setIsAdmin(adminData.is_admin || false);
          } catch (err) {
            console.error('Error checking admin status:', err);
            setIsAdmin(false);
          }
          
          // If access token was just set (user just logged in), request ticker startup via HTTP
          // Only try if token is valid (not just present)
          // token_valid may not be present in older API responses, so default to false
          const isTokenValid = data.token_valid !== undefined ? data.token_valid : false;
          if (hasAccessToken && isTokenValid) {
            fetch(apiUrl('/api/ticker/start'), {
              method: 'POST',
              credentials: 'include'
            })
              .then(response => {
                if (!response.ok) {
                  // Don't log 401 errors as they're expected if token is invalid
                  if (response.status !== 401) {
                    return response.json().then(result => {
                      console.warn('Failed to start ticker:', result.message);
                    });
                  }
                  return Promise.resolve(); // Silently handle 401
                }
                return response.json();
              })
              .then(result => {
                if (result && result.status !== 'success') {
                  // Only log non-authentication errors
                  if (!result.message?.includes('Invalid access token') && 
                      !result.message?.includes('not connected')) {
                    console.warn('Failed to start ticker:', result.message);
                  }
                }
              })
              .catch(err => {
                // Only log unexpected errors
                if (!err.message?.includes('401')) {
                  console.warn('Error starting ticker:', err);
                }
              });
          }
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      }
    };

    const fetchInitialMarketData = async () => {
      try {
        const resp = await fetch(apiUrl('/api/market_snapshot'), { credentials: 'include' });
        const data = await resp.json();
        if (resp.ok && data.status === 'success') {
          setNiftyPrice(typeof data.nifty === 'number' ? data.nifty.toFixed(2) : '—');
          setBankNiftyPrice(typeof data.banknifty === 'number' ? data.banknifty.toFixed(2) : '—');
        } else {
          setNiftyPrice('Not Connected');
          setBankNiftyPrice('Not Connected');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage.includes('401')) {
          console.error('Error fetching initial market data:', error);
        }
        setNiftyPrice('Not Connected');
        setBankNiftyPrice('Not Connected');
      }
    };

    fetchUserData();
    fetchInitialMarketData();
    // Retry market snapshot once after 3s so banner updates if first request was before session/ticker ready
    const retryMarketSnapshot = setTimeout(fetchInitialMarketData, 3000);

    // Periodically refresh Nifty/Bank Nifty in the banner so they stay in sync (fallback when socket ticks are missing)
    const MARKET_SNAPSHOT_INTERVAL_MS = 30 * 1000; // 30 seconds
    const marketSnapshotInterval = setInterval(() => {
      fetch(apiUrl('/api/market_snapshot'), { credentials: 'include' })
        .then(async (resp) => {
          const data = await resp.json();
          if (resp.ok && data.status === 'success') {
            setNiftyPrice(typeof data.nifty === 'number' ? data.nifty.toFixed(2) : '—');
            setBankNiftyPrice(typeof data.banknifty === 'number' ? data.banknifty.toFixed(2) : '—');
          }
        })
        .catch(() => {});
    }, MARKET_SNAPSHOT_INTERVAL_MS);

    // Periodically re-check user data (e.g. after Zerodha login redirect)
    const checkAccessTokenInterval = setInterval(() => {
      fetchUserData();
    }, 30_000);

    const onConnect = () => {
      console.log('Connected to WebSocket');
      socket.emit('my_event', { data: 'I\'m connected!' });
    };
    const onDisconnect = (reason: string) => {
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    };
    const onReconnectFailed = () => {
      setNiftyPrice('Connection Lost');
      setBankNiftyPrice('Connection Lost');
    };
    const onUnauthorized = (msg: { message: string }) => {
      alert(msg.message);
      window.location.href = '/login';
    };
    const onMarketData = (msg: any) => {
      if (msg.nifty_price) {
        const price = typeof msg.nifty_price === 'string' ? msg.nifty_price : msg.nifty_price.toFixed(2);
        setNiftyPrice(price);
      }
      if (msg.banknifty_price) {
        const price = typeof msg.banknifty_price === 'string' ? msg.banknifty_price : msg.banknifty_price.toFixed(2);
        setBankNiftyPrice(price);
      }
      if (msg.instrument_token === 256265 && msg.last_price !== undefined) {
        setNiftyPrice(typeof msg.last_price === 'number' ? msg.last_price.toFixed(2) : String(msg.last_price));
      }
      if (msg.instrument_token === 260105 && msg.last_price !== undefined) {
        setBankNiftyPrice(typeof msg.last_price === 'number' ? msg.last_price.toFixed(2) : String(msg.last_price));
      }
    };
    const onError = (msg: { message: string }) => {
      console.error('SocketIO error:', msg.message);
      if (msg.message.includes('Failed to start market data feed')) {
        setNiftyPrice('Error');
        setBankNiftyPrice('Error');
      }
    };
    const onWarning = (msg: { message: string }) => {
      console.warn('SocketIO warning:', msg.message);
      if (msg.message.includes('Zerodha session expired') || msg.message.includes('Zerodha credentials not configured')) {
        setNiftyPrice('Not Connected');
        setBankNiftyPrice('Not Connected');
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('reconnect_failed', onReconnectFailed);
    socket.on('unauthorized', onUnauthorized);
    socket.on('market_data', onMarketData);
    socket.on('error', onError);
    socket.on('warning', onWarning);

    const timeoutId = setTimeout(() => {
      if (!warningShownRef.current && (niftyPrice === 'Loading...' || bankNiftyPrice === 'Loading...')) {
        console.warn('Market data not received yet. Make sure Zerodha is connected and market is open.');
        warningShownRef.current = true;
      }
    }, 10000);

    return () => {
      clearTimeout(timeoutId);
      clearTimeout(retryMarketSnapshot);
      clearInterval(checkAccessTokenInterval);
      clearInterval(marketSnapshotInterval);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('reconnect_failed', onReconnectFailed);
      socket.off('unauthorized', onUnauthorized);
      socket.off('market_data', onMarketData);
      socket.off('error', onError);
      socket.off('warning', onWarning);
    };
  }, [socket]);

  const handleLogout = async () => {
    try {
      // Clear risk disclosure flag so it shows again on next login
      sessionStorage.removeItem('riskDisclosureShown');
      
      const response = await fetch(apiUrl('/api/logout'), { method: 'POST', credentials: 'include' });
      if (response.ok) {
        window.location.href = '/login';
      } else {
        console.error('Logout failed');
      }
    } catch (error) {
      console.error('Error during logout:', error);
      // Even if API call fails, redirect to login
      window.location.href = '/login';
    }
  };

  const handleProfileClick = () => {
    setActiveTab('profile');
  };

  const handleSubscribeClick = () => {
    setActiveTab('subscribe');
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardContent onViewLiveStrategy={handleViewLiveStrategy} onSubscribeClick={handleSubscribeClick} />;
      case 'algo-visualization':
        return <AlgoVisualizationContent />;
      case 'live-trade':
        return <LiveTradeContent />;
      case 'ai-ml':
        return <AIMLContent onSubscribeClick={handleSubscribeClick} />;
      case 'admin':
        return <AdminContent />;
      case 'options':
        return <OptionsContent />;
      case 'advanced-charts':
        return <AdvancedChartsContent />;
      case 'profile':
        return <ProfileContent onSubscribeClick={handleSubscribeClick} />;
      case 'subscribe':
        return <SubscribeContent />;
      default:
        return <DashboardContent onViewLiveStrategy={handleViewLiveStrategy} />;
    }
  };

  return (
    <Layout 
      navigation={
        <Navigation
          activeTab={activeTab}
          onTabChange={setActiveTab}
          userName={userName}
          kiteClientId={kiteClientId}
          onLogout={handleLogout}
          niftyPrice={niftyPrice}
          bankNiftyPrice={bankNiftyPrice}
          isAdmin={isAdmin}
          onProfileClick={handleProfileClick}
          onSubscribeClick={handleSubscribeClick}
        />
      }
      onSubscribeClick={handleSubscribeClick}
    >
      {renderContent()}
      <ChartModal
        show={showChartModal}
        onClose={handleCloseChartModal}
        instrumentToken={chartInstrumentToken}
      />
      {liveStrategyId && (
        <EnhancedRealTimeStrategyMonitor
          strategyId={liveStrategyId}
          onClose={handleCloseLiveStrategyModal}
        />
      )}
      <RiskDisclosureModal
        show={showRiskDisclosure}
        onClose={handleRiskDisclosureClose}
      />
    </Layout>
  );
};

export default Dashboard;
