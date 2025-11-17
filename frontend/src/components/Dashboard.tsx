import React, { useState, useEffect, useCallback, useRef } from 'react';
import Layout from './Layout';
import Navigation from './Navigation';
import { io, Socket } from 'socket.io-client';
import DashboardContent from './DashboardContent';
import AlgoVisualizationContent from './AlgoVisualizationContent';
import ChartModal from './ChartModal';
import EnhancedRealTimeStrategyMonitor from './EnhancedRealTimeStrategyMonitor';
import AIMLContent from './AIMLContent';
import LiveTradeContent from './LiveTradeContent';
import AdminContent from './AdminContent';
import { apiUrl, SOCKET_BASE_URL } from '../config/api';

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
  const socketRef = useRef<Socket | null>(null);
  const warningShownRef = useRef<boolean>(false);

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

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const response = await fetch(apiUrl('/api/user-data'), { credentials: 'include' });
        const data = await response.json();
        if (response.ok) {
          setUserName(data.user_name || 'User');
          setKiteClientId(data.kite_client_id || null);
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
          if (hasAccessToken) {
            fetch(apiUrl('/api/ticker/start'), {
              method: 'POST',
              credentials: 'include'
            })
              .then(response => response.json())
              .then(result => {
                if (result.status !== 'success') {
                  console.error('Failed to start ticker:', result.message);
                }
              })
              .catch(err => console.error('Error starting ticker:', err));
          }
        } else {
          console.error('Error fetching user data:', data.message);
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
          if (typeof data.nifty === 'number') setNiftyPrice(data.nifty.toFixed(2));
          if (typeof data.banknifty === 'number') setBankNiftyPrice(data.banknifty.toFixed(2));
        }
      } catch (error) {
        console.error('Error fetching initial market data:', error);
      }
    };

    fetchUserData();
    fetchInitialMarketData();
    
    // Also check periodically if access token becomes available (after login)
    const checkAccessTokenInterval = setInterval(() => {
      fetchUserData();
    }, 5000); // Check every 5 seconds

    const socket: Socket = io(SOCKET_BASE_URL, {
      path: '/socket.io/',
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      timeout: 20000,
      forceNew: false,
      // Explicitly set autoConnect to prevent premature connections
      autoConnect: true
    });
    
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Connected to WebSocket');
      socket.emit('my_event', { data: 'I\'m connected!' });
      
      // Request ticker startup if user is logged in and has access token
      // Check if access token is present and start ticker via HTTP endpoint
      fetch(apiUrl('/api/user-data'), { credentials: 'include' })
        .then(response => response.json())
        .then(data => {
          if (data.access_token_present) {
            fetch(apiUrl('/api/ticker/start'), {
              method: 'POST',
              credentials: 'include'
            })
              .then(response => response.json())
              .then(result => {
                if (result.status !== 'success') {
                  console.error('Failed to start ticker:', result.message);
                }
              })
              .catch(err => console.error('Error starting ticker:', err));
          } else {
            // silent
          }
        })
        .catch(err => console.error('Error checking access token:', err));
    });

    socket.on('disconnect', (reason: string) => {
      console.log('WebSocket disconnected:', reason);
      if (reason === 'io server disconnect') {
        // Server disconnected the socket, need to reconnect manually
        socket.connect();
      }
      // Otherwise, it will automatically reconnect
    });

    socket.on('connect_error', (error: any) => {
      console.error('WebSocket connection error:', error);
      // Don't set error state immediately - let reconnection handle it
    });

    socket.on('reconnect', (attemptNumber: number) => {
      console.log('WebSocket reconnected after', attemptNumber, 'attempts');
    });

    socket.on('reconnect_attempt', (attemptNumber: number) => {
      console.log('WebSocket reconnection attempt', attemptNumber);
    });

    socket.on('reconnect_error', (error: any) => {
      console.error('WebSocket reconnection error:', error);
    });

    socket.on('reconnect_failed', () => {
      console.error('WebSocket reconnection failed');
      setNiftyPrice('Connection Lost');
      setBankNiftyPrice('Connection Lost');
    });

    socket.on('unauthorized', (msg: { message: string }) => {
      alert(msg.message);
      window.location.href = '/login'; // Redirect to login page
    });

    socket.on('market_data', (msg: any) => {
      // Handle both separate and combined market data formats
      if (msg.nifty_price) {
        // Convert to number and format if needed
        const price = typeof msg.nifty_price === 'string' ? msg.nifty_price : msg.nifty_price.toFixed(2);
        setNiftyPrice(price);
      }
      if (msg.banknifty_price) {
        const price = typeof msg.banknifty_price === 'string' ? msg.banknifty_price : msg.banknifty_price.toFixed(2);
        setBankNiftyPrice(price);
      }
      // Also handle the new format with instrument_token
      if (msg.instrument_token === 256265 && msg.last_price !== undefined) {
        setNiftyPrice(typeof msg.last_price === 'number' ? msg.last_price.toFixed(2) : String(msg.last_price));
      }
      if (msg.instrument_token === 260105 && msg.last_price !== undefined) {
        setBankNiftyPrice(typeof msg.last_price === 'number' ? msg.last_price.toFixed(2) : String(msg.last_price));
      }
    });

    socket.on('info', (msg: { message: string }) => {
      // Reduce console noise; keep only warnings/errors elsewhere
    });

    socket.on('error', (msg: { message: string }) => {
      console.error('SocketIO error:', msg.message);
      if (msg.message.includes('Failed to start market data feed')) {
        setNiftyPrice('Error');
        setBankNiftyPrice('Error');
      }
    });

    socket.on('warning', (msg: { message: string }) => {
      console.warn('SocketIO warning:', msg.message);
      if (msg.message.includes('Zerodha session expired') || msg.message.includes('Zerodha credentials not configured')) {
        setNiftyPrice('Not Connected');
        setBankNiftyPrice('Not Connected');
      }
    });

    // Set timeout to show warning if no data received after 10 seconds (only once)
    const timeoutId = setTimeout(() => {
      if (!warningShownRef.current && (niftyPrice === 'Loading...' || bankNiftyPrice === 'Loading...')) {
        console.warn('Market data not received yet. Make sure Zerodha is connected and market is open.');
        warningShownRef.current = true;
      }
    }, 10000);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(checkAccessTokenInterval);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  const handleLogout = async () => {
    try {
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

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardContent onViewLiveStrategy={handleViewLiveStrategy} />;
      case 'algo-visualization':
        return <AlgoVisualizationContent />;
      case 'live-trade':
        return <LiveTradeContent />;
      case 'ai-ml':
        return <AIMLContent />;
      case 'admin':
        return <AdminContent />;
      default:
        return <DashboardContent onViewLiveStrategy={handleViewLiveStrategy} />;
    }
  };

  return (
    <Layout navigation={
      <Navigation
        activeTab={activeTab}
        onTabChange={setActiveTab}
        userName={userName}
        kiteClientId={kiteClientId}
        onLogout={handleLogout}
        niftyPrice={niftyPrice}
        bankNiftyPrice={bankNiftyPrice}
        isAdmin={isAdmin}
      />
    }>
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
    </Layout>
  );
};

export default Dashboard;
