import React, { useEffect, useState } from 'react';
import { apiUrl } from '../config/api';

const MarketDataBanner: React.FC = () => {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/user-data'), { credentials: 'include' })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled || data.market_data_source !== 'shared') {
          return;
        }
        if (data.has_trading_credentials) {
          setMessage(
            'Viewing live market data via platform data feed. Position tab uses your Zerodha account.'
          );
        } else {
          setMessage('Viewing live market data via platform data feed.');
        }
      })
      .catch(() => {
        // Banner is optional UX hint.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!message) {
    return null;
  }

  return (
    <div className="alert alert-info py-2 small mb-3">
      <i className="bi bi-broadcast me-2" />
      {message}
    </div>
  );
};

export default MarketDataBanner;
