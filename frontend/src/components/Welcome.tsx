import React, { useEffect, useState } from 'react';
import { apiUrl } from '../config/api';
import { useNavigate } from 'react-router-dom';
import LoaderOverlay from './LoaderOverlay';
import SupportChat from './SupportChat';
import PolicyLinks from './PolicyLinks';

const API_TUTORIAL_URL = 'https://youtu.be/r88L9AqnNaE?si=kdMDw04MxVZ8WCax';

const WelcomeContent: React.FC<{ message: { type: string; text: string } | null; onLogout: () => void }> = ({ message, onLogout }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [feedback, setFeedback] = useState<{ type: string; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchCredentialsStatus = async () => {
      try {
        const response = await fetch(apiUrl('/api/user-credentials'), {
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error('Failed to fetch credentials state');
        }
        const data = await response.json();
        setHasCredentials(Boolean(data?.has_credentials));
      } catch (error) {
        console.error('Unable to fetch user credential status:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchCredentialsStatus();
  }, []);

  const handleSaveCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    setSubmitting(true);
    try {
      const response = await fetch(apiUrl('/api/user-credentials'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ app_key: appKey.trim(), app_secret: appSecret.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        // Use backend error message which is now user-friendly
        throw new Error(data?.message || 'Failed to store credentials. Please check that both API Key and Secret are provided.');
      }
      setFeedback({ type: 'success', text: data.message || 'Credentials saved successfully.' });
      setHasCredentials(true);
      setAppKey('');
      setAppSecret('');
    } catch (error: any) {
      // Display user-friendly error messages
      let errorMessage = error.message || 'An unexpected error occurred. Please try again.';
      
      // Make error messages more user-friendly
      if (errorMessage.includes('API key') || errorMessage.includes('API Secret')) {
        // Already user-friendly from backend
      } else if (errorMessage.includes('Failed to store')) {
        errorMessage = 'Unable to save your API credentials. Please ensure both API Key and Secret are correct and try again.';
      } else if (errorMessage.includes('Unexpected error')) {
        errorMessage = 'An error occurred while saving your credentials. Please check your internet connection and try again.';
      }
      
      setFeedback({ type: 'danger', text: errorMessage });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <>
        <LoaderOverlay visible message="Checking your configuration..." />
        <div className="text-center text-white-50">
          <p className="mt-3">Preparing your workspace...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <h3 className="fw-semibold mb-4">
        {hasCredentials ? 'Authorize Zerodha access' : 'Enter Zerodha API credentials'}
      </h3>
      <p className="text-white-50 mb-4">
        {hasCredentials
          ? 'Clicking the button below redirects you to Zerodha to grant API access. After authorising, you’ll return here automatically.'
          : 'Provide your Zerodha Kite Connect API key and secret so we can establish secure connectivity for strategy deployment.'}
      </p>

      {message && (
        <div className={`alert alert-${message.type} mb-3`} role="alert">
          {message.text}
        </div>
      )}
      {feedback && (
        <div className={`alert alert-${feedback.type} mb-3`} role="alert">
          {feedback.text}
        </div>
      )}

      {hasCredentials ? (
        <div className="d-grid gap-3">
          <a href="/api/zerodha_login" className="btn btn-primary">
            Authenticate with Zerodha
          </a>
          <button onClick={onLogout} className="btn btn-outline-light">
            Sign out
          </button>
        </div>
      ) : (
        <>
          <form onSubmit={handleSaveCredentials} className="d-flex flex-column gap-3">
            <div>
              <label htmlFor="app_key" className="form-label">
                Zerodha API Key
              </label>
              <input
                type="text"
                id="app_key"
                className="form-control"
                value={appKey}
                onChange={(event) => setAppKey(event.target.value)}
                placeholder="kiteconnect_apikey"
                required
              />
            </div>
            <div>
              <label htmlFor="app_secret" className="form-label">
                Zerodha API Secret
              </label>
              <input
                type="password"
                id="app_secret"
                className="form-control"
                value={appSecret}
                onChange={(event) => setAppSecret(event.target.value)}
                placeholder="kiteconnect_secret"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                  Saving...
                </>
              ) : (
                'Save Credentials'
              )}
            </button>
          </form>
          <div className="d-grid gap-2 mt-3">
            <button 
              onClick={() => navigate('/dashboard')} 
              type="button"
              className="btn btn-outline-secondary"
            >
              Skip for now - Go to Dashboard
            </button>
            <button onClick={onLogout} type="button" className="btn btn-outline-light">
              Sign out
            </button>
          </div>
          <div className="alert alert-info mt-3 mb-0 small">
            <i className="bi bi-info-circle me-2"></i>
            You can add your API credentials later from the dashboard. You'll be able to use the platform as a freemium user without API credentials.
          </div>
        </>
      )}
      <div className="text-center text-white-50 mt-4 small">
        Need help generating your API key?{' '}
        <a
          href={API_TUTORIAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-white text-decoration-none"
        >
          Watch the setup tutorial
        </a>
        .
      </div>
      <div className="text-center text-white-50 mt-2 small">
        Need help? Refer to your Zerodha developer console or contact{' '}
        <a href="mailto:contact@drpinfotech.com" className="text-white text-decoration-none">
          contact@drpinfotech.com
        </a>
        .
      </div>
    </>
  );
};

const Welcome: React.FC = () => {
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const checkZerodhaSession = async () => {
      try {
        const response = await fetch(apiUrl('/api/user-data'), {
          credentials: 'include',
        });

        if (!response.ok) {
          return;
        }

        const data = await response.json();

        // Only auto-redirect if user has valid token AND credentials
        // If credentials are missing, let user stay on welcome page to add them or skip
        if (data?.token_valid && data?.zerodha_credentials_present) {
          navigate('/dashboard', { replace: true });
          return;
        }

        if (!data?.zerodha_credentials_present) {
          setMessage({
            type: 'info',
            text: 'Add your Zerodha API key and secret to enable live trading, or skip for now to use the platform as a freemium user.',
          });
        } else if (data?.message) {
          setMessage({
            type: data?.access_token_present ? 'info' : 'warning',
            text: data.message,
          });
        }
      } catch (error) {
        console.error('Unable to validate Zerodha session:', error);
      }
    };

    checkZerodhaSession();
  }, [navigate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginSuccess = params.get('loginSuccess');
    if (loginSuccess === 'true') {
      setMessage({ type: 'success', text: 'You have successfully logged in.' });
    }
    const credStatus = params.get('credentials');
    const errorType = params.get('error');
    if (credStatus === 'missing') {
      if (errorType === 'api_key_missing') {
        setMessage({ 
          type: 'warning', 
          text: 'Zerodha API credentials are required to enable live trading. Please add your API Key and Secret below, or skip for now to continue as a freemium user.' 
        });
      } else {
        setMessage({ 
          type: 'warning', 
          text: 'Please add your Zerodha API credentials to enable live trading features. You can skip for now and add them later.' 
        });
      }
    } else if (credStatus === 'invalid' || errorType === 'api_key_invalid') {
      setMessage({ 
        type: 'danger', 
        text: 'The provided Zerodha API credentials are invalid or incorrect. Please check your API Key and Secret and try again. Make sure you copied them correctly from your Zerodha developer console.' 
      });
    } else if (credStatus === 'error' || errorType === 'session_failed') {
      setMessage({ 
        type: 'danger', 
        text: 'Unable to authenticate with Zerodha. Please check your API credentials and try again. If the problem persists, contact support.' 
      });
    } else if (credStatus === 'saved') {
      setMessage({ type: 'success', text: 'Zerodha API credentials saved successfully. You can authenticate now.' });
    }
  }, []);

  const handleLogout = async () => {
    try {
      const response = await fetch(apiUrl('/api/logout'), { method: 'POST', credentials: 'include' });
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
        <img
          src="/drp-infotech-logo.png"
          alt="DRP Infotech Pvt Ltd"
          className="auth-logo"
        />
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
              <WelcomeContent message={message} onLogout={handleLogout} />
            </div>
          </div>
        </div>
      </div>
      <div className="container text-center auth-footer-text">
        © {new Date().getFullYear()} DRP Infotech Pvt Ltd · Intelligent Algo Trading &amp; AI Automation
      </div>
      <SupportChat />
      <PolicyLinks />
    </div>
  );
};

export default Welcome;

