import React, { useState } from 'react';
import { apiUrl } from '../config/api';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import LoaderOverlay from './LoaderOverlay';
import SupportChat from './SupportChat';
import PolicyLinks from './PolicyLinks';

const VerifyOtp: React.FC = () => {
  const [otp, setOtp] = useState<string>('');
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const queryEmail = React.useMemo(() => {
    try {
      const params = new URLSearchParams(location.search);
      return params.get('email') || '';
    } catch {
      return '';
    }
  }, [location.search]);
  const stateEmail = location.state?.email || '';
  const initialEmail = stateEmail || queryEmail;
  const [email, setEmail] = useState<string>(initialEmail);
  const isEmailReadOnly = Boolean(stateEmail || queryEmail);

  React.useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setLoading(true);

    if (!email.trim()) {
      setMessage({ type: 'danger', text: 'Email is required to verify OTP.' });
      setLoading(false);
      return;
    }

    if (!otp || !otp.trim()) {
      setMessage({ type: 'danger', text: 'OTP is required. Please enter the 6-digit code.' });
      setLoading(false);
      return;
    }

    try {
      // Normalize email to lowercase for case-insensitive verification
      const normalizedEmail = email.trim().toLowerCase();
      const trimmedOtp = otp.trim();
      
      const response = await fetch(apiUrl('/api/verify_otp'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email: normalizedEmail, otp: trimmedOtp }),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.status === 'success') {
          setMessage({ type: 'success', text: data.message || 'OTP verified successfully!' });
          if (data.redirect) {
            let redirectPath = data.redirect;
            try {
              const url = new URL(data.redirect);
              redirectPath = url.pathname + url.search;
            } catch {
              if (!data.redirect.startsWith('http')) {
                redirectPath = data.redirect;
              }
            }
            navigate(redirectPath);
          } else {
            navigate('/welcome');
          }
        } else {
          setMessage({ type: 'danger', text: data.message || 'OTP verification failed.' });
        }
      } else {
        setMessage({ type: 'danger', text: data.message || 'OTP verification failed.' });
      }
    } catch (error) {
      console.error('Error during OTP verification:', error);
      setMessage({ type: 'danger', text: 'An unexpected error occurred. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <LoaderOverlay visible={loading} message="Verifying OTP..." />
      <div className="auth-overlay" />
      <nav className="auth-nav container">
        <img
          src="/drp-infotech-logo.png"
          alt="DRP Infotech Pvt Ltd"
          className="auth-logo"
        />
        <div className="d-flex align-items-center gap-2">
          <Link to="/signup" className="btn btn-outline-light btn-sm px-3">
            Sign up
          </Link>
          <Link to="/login" className="btn btn-light btn-sm px-3 text-primary">
            Log in
          </Link>
        </div>
      </nav>

      <div className="container auth-container">
        <div className="row align-items-center g-5">
          <div className="col-lg-6">
            <span className="badge bg-primary-subtle text-primary-emphasis mb-3">
              Final step to unlock your AI trading suite
            </span>
            <h1 className="display-5 fw-bold text-white">
              Confirm your identity and dive back into hyper-intelligent trading.
            </h1>
            <p className="lead text-white-50 mt-3">
              We sent a secure one-time password to <strong>{email || 'your registered email address'}</strong>.
              Enter it below to continue managing your strategies, data feeds, and live deployments without missing a beat.
            </p>
            <div className="auth-metrics">
              <div>
                <strong>2 min</strong>
                <small>Average time to complete OTP verification.</small>
              </div>
              <div>
                <strong>5 layers</strong>
                <small>Of security guard your execution pipeline.</small>
              </div>
              <div>
                <strong>99.9%</strong>
                <small>Platform availability backed by automated checks.</small>
              </div>
            </div>
            <div className="auth-side-note mt-4">
              <strong>Didn&apos;t receive the email?</strong> Check spam or resend the OTP from the login screen. Still facing issues?
              Reach out at{' '}
              <a href="mailto:contact@drpinfotech.com" className="text-white text-decoration-none">
                contact@drpinfotech.com
              </a>
              .
            </div>
          </div>
          <div className="col-lg-5 offset-lg-1 col-xl-4">
            <div className="auth-card shadow-lg">
              <h3 className="fw-semibold mb-4">Verify one-time passcode</h3>
              <p className="text-white-50 mb-4">
                Enter the 6-digit code delivered to your inbox. This keeps every account tightly secured.
              </p>
              {message && (
                <div className={`alert alert-${message.type} mb-4`} role="alert">
                  {message.text}
                </div>
              )}
              <form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
                <div>
                  <label htmlFor="email" className="form-label">
                    Email Address
                  </label>
                  <input
                    type="email"
                    className="form-control"
                    id="email"
                    name="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    required
                    readOnly={isEmailReadOnly}
                  />
                </div>
                <div>
                  <label htmlFor="otp" className="form-label">
                    One-Time Passcode
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    id="otp"
                    name="otp"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="Enter 6-digit code"
                    autoComplete="one-time-code"
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary">
                  Verify &amp; Continue
                </button>
              </form>
              <div className="text-center text-white-50 mt-4">
                Need a new code?{' '}
                <Link to="/login" className="text-white">
                  Request OTP again
                </Link>
              </div>
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

export default VerifyOtp;
