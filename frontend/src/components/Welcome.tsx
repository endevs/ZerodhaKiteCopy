import React, { useEffect, useState } from 'react';
import { apiUrl } from '../config/api';
import { useNavigate } from 'react-router-dom';
import LoaderOverlay from './LoaderOverlay';
import SupportChat from './SupportChat';
import PolicyLinks from './PolicyLinks';

const API_TUTORIAL_URL = 'https://youtu.be/r88L9AqnNaE?si=kdMDw04MxVZ8WCax';

type AutoAuthState = {
  status: 'idle' | 'running' | 'succeeded' | 'failed' | 'needs_manual' | 'not_configured';
  reason?: string | null;
  attempts?: number;
};

type CredentialsStateResponse = {
  has_credentials?: boolean;
  auto_auth_details_present?: boolean;
  missing_fields?: string[];
};

const WelcomeContent: React.FC<{
  message: { type: string; text: string } | null;
  onLogout: () => void;
  autoAuthEnabled: boolean;
  autoAuthState: AutoAuthState | null;
  onStartAutoAuth: () => Promise<void>;
}> = ({ message, onLogout, autoAuthEnabled, autoAuthState, onStartAutoAuth }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [hasAutoAuthDetails, setHasAutoAuthDetails] = useState(false);
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [kiteUserId, setKiteUserId] = useState('');
  const [kitePassword, setKitePassword] = useState('');
  const [kiteTotpSecret, setKiteTotpSecret] = useState('');
  const [feedback, setFeedback] = useState<{ type: string; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [startingAutoAuth, setStartingAutoAuth] = useState(false);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const statusToAlertClass = (status?: AutoAuthState['status']): string => {
    if (status === 'running') return 'info';
    if (status === 'succeeded') return 'success';
    if (status === 'failed' || status === 'needs_manual' || status === 'not_configured') return 'warning';
    return 'secondary';
  };
  const statusLabel = (state: AutoAuthState | null): string => {
    if (!state) return 'idle';
    if (state.status === 'not_configured') return 'not configured';
    return state.status.replace('_', ' ');
  };

  const reasonMessage = (reason?: string | null): string | null => {
    if (!reason) return null;
    const messages: Record<string, string> = {
      timeout:
        'Kite did not return a login token in time. In the Zerodha developer console, set the redirect URL to http://localhost:8003/callback (exact match), verify your TOTP secret, then try again or use manual authentication.',
      otp_rejected:
        'The TOTP code was rejected. Update your TOTP secret under profile settings and try again.',
      selector_mismatch:
        'The Kite login page layout changed. Use manual authentication for now.',
      external_2fa_required:
        'Zerodha is asking for approval in the Kite mobile app instead of a TOTP code. Use Authenticate with Zerodha (manual login) for this account.',
      request_token_missing:
        'Kite redirected without a login token. Check your API key and redirect URL.',
      exchange_failed:
        'Could not exchange the login token for an access token. Check API key and secret.',
      user_not_logged_in:
        'Your app session expired during automation. Sign in again and retry.',
    };
    return messages[reason] ?? reason;
  };

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
        setHasAutoAuthDetails(Boolean(data?.auto_auth_details_present));
        setMissingFields(Array.isArray(data?.missing_fields) ? data.missing_fields : []);
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
        body: JSON.stringify({
          app_key: appKey.trim(),
          app_secret: appSecret.trim(),
          kite_user_id: kiteUserId.trim(),
          kite_password: kitePassword.trim(),
          kite_totp_secret: kiteTotpSecret.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to store credentials. Please check that all fields are provided.');
      }
      setFeedback({ type: 'success', text: data.message || 'Credentials saved successfully.' });
      setHasCredentials(Boolean(data?.has_credentials));
      setHasAutoAuthDetails(Boolean(data?.auto_auth_details_present));
      setMissingFields(Array.isArray(data?.missing_fields) ? data.missing_fields : []);
      setAppKey('');
      setAppSecret('');
      setKiteUserId('');
      setKitePassword('');
      setKiteTotpSecret('');
    } catch (error: any) {
      let errorMessage = error.message || 'An unexpected error occurred. Please try again.';
      if (errorMessage.includes('Failed to store')) {
        errorMessage = 'Unable to save your credentials. Please ensure API and auto-auth details are filled correctly.';
      } else if (errorMessage.includes('Unexpected error')) {
        errorMessage = 'An error occurred while saving your credentials. Please check your internet connection and try again.';
      }
      setFeedback({ type: 'danger', text: errorMessage });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAutoAuthDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    setSubmitting(true);
    try {
      const response = await fetch(apiUrl('/api/user-credentials'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          kite_user_id: kiteUserId.trim(),
          kite_password: kitePassword.trim(),
          kite_totp_secret: kiteTotpSecret.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (Array.isArray(data?.missing_fields)) {
          setMissingFields(data.missing_fields);
        }
        throw new Error(data?.message || 'Failed to store auto-auth details.');
      }
      setFeedback({ type: 'success', text: data.message || 'Auto-auth details saved successfully.' });
      setHasAutoAuthDetails(Boolean(data?.auto_auth_details_present));
      setMissingFields(Array.isArray(data?.missing_fields) ? data.missing_fields : []);
      setKiteUserId('');
      setKitePassword('');
      setKiteTotpSecret('');
    } catch (error: any) {
      setFeedback({ type: 'danger', text: error.message || 'Failed to save auto-auth details.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartAutoAuth = async () => {
    setStartingAutoAuth(true);
    setFeedback(null);
    try {
      await onStartAutoAuth();
    } catch (error: any) {
      setFeedback({ type: 'danger', text: error?.message || 'Failed to start automated authentication.' });
    } finally {
      setStartingAutoAuth(false);
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
      {missingFields.length > 0 && (
        <div className="alert alert-warning mb-3 small" role="alert">
          Missing required fields: {missingFields.join(', ')}
        </div>
      )}

      {hasCredentials ? (
        <div className="d-grid gap-3">
          <button
            className="btn btn-outline-info"
            type="button"
            onClick={handleStartAutoAuth}
            disabled={startingAutoAuth || autoAuthState?.status === 'running' || !autoAuthEnabled}
          >
            {startingAutoAuth || autoAuthState?.status === 'running'
              ? 'Auto Authentication in progress...'
              : 'Auto Authentication'}
          </button>
          {!autoAuthEnabled && (
            <div className="alert alert-warning mb-0 small" role="alert">
              Auto Authentication is not configured yet. Please ask admin to set automation credentials.
            </div>
          )}
          {!hasAutoAuthDetails && (
            <form onSubmit={handleSaveAutoAuthDetails} className="d-flex flex-column gap-2">
              <div>
                <label htmlFor="kite_user_id_existing" className="form-label small mb-1">
                  Kite User ID
                </label>
                <input
                  type="text"
                  id="kite_user_id_existing"
                  className="form-control"
                  value={kiteUserId}
                  onChange={(event) => setKiteUserId(event.target.value)}
                  placeholder="RD1234"
                  required
                />
              </div>
              <div>
                <label htmlFor="kite_password_existing" className="form-label small mb-1">
                  Kite Password
                </label>
                <input
                  type="password"
                  id="kite_password_existing"
                  className="form-control"
                  value={kitePassword}
                  onChange={(event) => setKitePassword(event.target.value)}
                  placeholder="Your Kite password"
                  required
                />
              </div>
              <div>
                <label htmlFor="kite_totp_secret_existing" className="form-label small mb-1">
                  TOTP Secret
                </label>
                <input
                  type="password"
                  id="kite_totp_secret_existing"
                  className="form-control"
                  value={kiteTotpSecret}
                  onChange={(event) => setKiteTotpSecret(event.target.value)}
                  placeholder="Base32 TOTP secret"
                  required
                />
              </div>
              <button type="submit" className="btn btn-outline-light" disabled={submitting}>
                {submitting ? 'Saving auto-auth details...' : 'Save Auto Authentication Details'}
              </button>
            </form>
          )}
          {autoAuthState && autoAuthState.status !== 'idle' && (
            <div className={`alert alert-${statusToAlertClass(autoAuthState.status)} mb-0 small`} role="alert">
              <div>
                Automation status: <strong>{statusLabel(autoAuthState)}</strong>
                {typeof autoAuthState.attempts === 'number' ? ` • attempts: ${autoAuthState.attempts}` : ''}
              </div>
              {reasonMessage(autoAuthState.reason) && (
                <div className="mt-2">{reasonMessage(autoAuthState.reason)}</div>
              )}
            </div>
          )}
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
            <div>
              <label htmlFor="kite_user_id" className="form-label">
                Kite User ID
              </label>
              <input
                type="text"
                id="kite_user_id"
                className="form-control"
                value={kiteUserId}
                onChange={(event) => setKiteUserId(event.target.value)}
                placeholder="RD1234"
                required
              />
            </div>
            <div>
              <label htmlFor="kite_password" className="form-label">
                Kite Password
              </label>
              <input
                type="password"
                id="kite_password"
                className="form-control"
                value={kitePassword}
                onChange={(event) => setKitePassword(event.target.value)}
                placeholder="Your Kite password"
                required
              />
            </div>
            <div>
              <label htmlFor="kite_totp_secret" className="form-label">
                Kite TOTP Secret
              </label>
              <input
                type="password"
                id="kite_totp_secret"
                className="form-control"
                value={kiteTotpSecret}
                onChange={(event) => setKiteTotpSecret(event.target.value)}
                placeholder="Base32 TOTP secret"
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
  const [autoAuthState, setAutoAuthState] = useState<AutoAuthState | null>(null);
  const [autoAuthEnabled, setAutoAuthEnabled] = useState(false);
  const navigate = useNavigate();
  const redirectToLoginOnUnauthorized = () => {
    navigate('/login?reason=session_expired', { replace: true });
  };

  useEffect(() => {
    const checkZerodhaSession = async () => {
      try {
        const response = await fetch(apiUrl('/api/user-data'), {
          credentials: 'include',
        });
        if (response.status === 401) {
          redirectToLoginOnUnauthorized();
          return;
        }

        if (!response.ok) {
          return;
        }

        const data = await response.json();
        if (data?.auto_auth) {
          setAutoAuthState(data.auto_auth as AutoAuthState);
        }

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
    let timer: ReturnType<typeof setInterval> | undefined;
    const loadStatus = async () => {
      try {
        const response = await fetch(apiUrl('/api/zerodha/auto-auth-status'), { credentials: 'include' });
        if (response.status === 401) {
          redirectToLoginOnUnauthorized();
          return;
        }
        if (!response.ok) return;
        const data = await response.json();
        setAutoAuthEnabled(Boolean(data?.configured));
        if (data?.auto_auth) {
          setAutoAuthState(data.auto_auth as AutoAuthState);
          if (data.auto_auth.status === 'failed' || data.auto_auth.status === 'needs_manual') {
            // #region agent log
            fetch('http://127.0.0.1:7255/ingest/85086ee0-cdfe-4536-9e94-0e466df42afc',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'c3dc96'},body:JSON.stringify({sessionId:'c3dc96',runId:'pre-fix',hypothesisId:'H2',location:'Welcome.tsx:loadStatus',message:'auto-auth terminal state',data:{status:data.auto_auth.status,reason:data.auto_auth.reason,attempts:data.auto_auth.attempts},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
          }
          if (data.auto_auth.status === 'succeeded') {
            navigate('/dashboard', { replace: true });
          }
        } else if (!data?.configured) {
          setAutoAuthState({ status: 'not_configured' });
        }
      } catch (error) {
        console.error('Unable to fetch auto-auth status:', error);
      }
    };
    loadStatus();
    timer = setInterval(loadStatus, 5000);
    return () => {
      if (timer) clearInterval(timer);
    };
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

  const handleStartAutoAuth = async () => {
    if (!autoAuthEnabled) {
      setAutoAuthState({ status: 'not_configured' });
      throw new Error('Auto Authentication is not configured yet.');
    }
    const response = await fetch(apiUrl('/api/zerodha/auto-auth/start'), {
      method: 'POST',
      credentials: 'include',
    });
    if (response.status === 401) {
      redirectToLoginOnUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message || 'Failed to start automated authentication');
    }
    if (data?.auto_auth) {
      setAutoAuthState(data.auto_auth as AutoAuthState);
      if (data.auto_auth.status === 'succeeded') {
        navigate('/dashboard', { replace: true });
      }
    }
    if (data?.message) {
      setMessage({ type: 'info', text: data.message });
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
              <WelcomeContent
                message={message}
                onLogout={handleLogout}
                autoAuthEnabled={autoAuthEnabled}
                autoAuthState={autoAuthState}
                onStartAutoAuth={handleStartAutoAuth}
              />
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

