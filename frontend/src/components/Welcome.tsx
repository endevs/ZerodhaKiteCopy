import React, { useEffect, useState } from 'react';
const Welcome: React.FC = () => {
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginSuccess = params.get('loginSuccess');
    if (loginSuccess === 'true') {
      setMessage({ type: 'success', text: 'You have successfully logged in.' });
    }
  }, []);

  const handleLogout = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/logout', { method: 'POST', credentials: 'include' });
      const data = await response.json();
      if (response.ok) {
        window.location.href = '/login';
      } else {
        setMessage({ type: 'danger', text: data.message || 'Logout failed.' });
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
      }
    } catch (error) {
      console.error('Error during logout:', error);
      setMessage({ type: 'danger', text: 'An error occurred during logout.' });
      setTimeout(() => {
        window.location.href = '/login';
      }, 2000);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-overlay" />
      <nav className="auth-nav container">
        <div className="d-flex align-items-center">
          <img
            src="/drp-infotech-logo.png"
            alt="DRP Infotech Pvt Ltd"
            className="auth-logo"
          />
          <span className="auth-brand">DRP Infotech Pvt Ltd</span>
        </div>
        <div className="d-flex align-items-center gap-2">
          <a href="/dashboard" className="btn btn-outline-light btn-sm px-3">
            Go to Dashboard
          </a>
          <button onClick={handleLogout} className="btn btn-light btn-sm px-3 text-primary">
            Sign out
          </button>
        </div>
      </nav>

      <div className="container auth-container">
        <div className="row align-items-center g-5">
          <div className="col-lg-6">
            <span className="badge bg-primary-subtle text-primary-emphasis mb-3">
              Welcome to your AI Trading Command Center
            </span>
            <h1 className="display-5 fw-bold text-white">
              Connect Zerodha Kite and orchestrate your strategies in one powerful console.
            </h1>
            <p className="lead text-white-50 mt-3">
              You&apos;re moments away from streaming live market data, deploying AI-built strategies,
              and supervising execution in real time. Secure your Zerodha token to activate trade flows.
            </p>
            <div className="auth-metrics">
              <div>
                <strong>Real-time</strong>
                <small>Market feeds via Zerodha Kite Connect.</small>
              </div>
              <div>
                <strong>Single</strong>
                <small>Token unlocks trading, backtests, and monitoring.</small>
              </div>
              <div>
                <strong>Unified</strong>
                <small>AI strategy management, analytics, and automation.</small>
              </div>
            </div>
            <div className="auth-side-note mt-4">
              <strong>Why connect Zerodha?</strong> This secure OAuth handshake links your DRP Infotech account with
              live market access. Once authenticated, you can execute live or paper trades across equities,
              derivatives, and indices using your AI-generated playbooks.
            </div>
          </div>
          <div className="col-lg-5 offset-lg-1 col-xl-4">
            <div className="auth-card shadow-lg">
              <h3 className="fw-semibold mb-4">Authorize Zerodha access</h3>
              <p className="text-white-50 mb-4">
                Clicking the button below redirects you to Zerodha to grant API access. After authorising,
                you&apos;ll return here automatically.
              </p>

              {message && (
                <div className={`alert alert-${message.type} mb-4`} role="alert">
                  {message.text}
                </div>
              )}

              <div className="d-grid gap-3">
                <a href="/api/zerodha_login" className="btn btn-primary">
                  Authenticate with Zerodha
                </a>
                <button onClick={handleLogout} className="btn btn-outline-light">
                  Sign out
                </button>
              </div>
              <div className="text-center text-white-50 mt-4 small">
                Need help? Check your Zerodha app key/secret or contact{' '}
                <a href="mailto:contact@drpinfotech.com" className="text-white text-decoration-none">
                  contact@drpinfotech.com
                </a>
                .
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="container text-center auth-footer-text">
        © {new Date().getFullYear()} DRP Infotech Pvt Ltd · Intelligent Algo Trading &amp; AI Automation
      </div>
    </div>
  );
};

export default Welcome;

