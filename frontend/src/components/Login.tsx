import React, { useState, useEffect } from 'react';
import { apiUrl } from '../config/api';
import { Link, useNavigate } from 'react-router-dom';
import LoaderOverlay from './LoaderOverlay';
import SupportChat from './SupportChat';
import PolicyLinks from './PolicyLinks';

const GoogleLoginButton: React.FC = () => {
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const response = await fetch(apiUrl('/api/auth/google'), {
        credentials: 'include',
      });
      const data = await response.json();
      
      if (data.status === 'success' && data.auth_url) {
        // Redirect to Google OAuth
        window.location.href = data.auth_url;
      } else {
        alert(data.message || 'Failed to initiate Google login');
        setLoading(false);
      }
    } catch (error) {
      console.error('Error initiating Google login:', error);
      alert('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      className="btn btn-outline-light w-100 d-flex align-items-center justify-content-center gap-2"
      onClick={handleGoogleLogin}
      disabled={loading}
    >
      {loading ? (
        <>
          <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
          Connecting...
        </>
      ) : (
        <>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.20454C17.64 8.56636 17.5827 7.95272 17.4764 7.36363H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5614V15.8195H15.9564C17.4382 14.4182 18.3182 12.2727 18.3182 9.20454L17.64 9.20454Z" fill="#4285F4"/>
            <path d="M9 18C11.43 18 13.467 17.1941 14.9564 15.8195L11.0477 13.5614C10.2418 14.1014 9.21091 14.4204 9 14.4204C6.65455 14.4204 4.67182 12.8373 3.96409 10.71H0.957275V13.0418C2.43818 15.9832 5.48182 18 9 18Z" fill="#34A853"/>
            <path d="M3.96409 10.71C3.78409 10.17 3.68182 9.59318 3.68182 9C3.68182 8.40682 3.78409 7.83 3.96409 7.29V4.95818H0.957273C0.347727 6.17318 0 7.54773 0 9C0 10.4523 0.347727 11.8268 0.957273 13.0418L3.96409 10.71Z" fill="#FBBC05"/>
            <path d="M9 3.57955C10.3214 3.57955 11.5077 4.03364 12.4405 4.92545L15.0218 2.34409C13.4632 0.891818 11.4259 0 9 0C5.48182 0 2.43818 2.01682 0.957275 4.95818L3.96409 7.29C4.67182 5.16273 6.65455 3.57955 9 3.57955Z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </>
      )}
    </button>
  );
};

const Login: React.FC = () => {
  const [email, setEmail] = useState<string>('');
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const navigate = useNavigate();

  // Check if user is already authenticated and redirect to dashboard
  useEffect(() => {
    const checkAuthentication = async () => {
      try {
        const response = await fetch(apiUrl('/api/user-data'), {
          credentials: 'include',
        });
        
        if (response.ok) {
          const data = await response.json();
          const isAuthenticated = data.authenticated === true || (data.user_id !== undefined && data.user_id !== null);
          if (isAuthenticated) {
            // Check if user has API credentials
            // If not, redirect to welcome page; otherwise go to dashboard
            if (!data.zerodha_credentials_present) {
              navigate('/welcome', { replace: true });
            } else {
              navigate('/dashboard', { replace: true });
            }
            return;
          }
        }
      } catch (error) {
        console.error('Error checking authentication:', error);
      } finally {
        setCheckingAuth(false);
      }
    };

    checkAuthentication();
  }, [navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setLoading(true);

    try {
      // Normalize email to lowercase for case-insensitive login
      const normalizedEmail = email.trim().toLowerCase();
      
      const response = await fetch(apiUrl('/api/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email: normalizedEmail }),
      });

      // Check Content-Type before parsing
      const contentType = response.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');
      
      // Get response text first to check if it's JSON
      const responseText = await response.text();
      
      let data;
      if (isJson && responseText) {
        try {
          data = JSON.parse(responseText);
        } catch (jsonError) {
          console.error('Failed to parse JSON response:', jsonError);
          // If user not found (404), show appropriate message
          if (response.status === 404) {
            setMessage({ type: 'danger', text: 'User not found. Please sign up.' });
            return;
          }
          setMessage({ type: 'danger', text: 'An unexpected error occurred. Please try again.' });
          return;
        }
      } else {
        // Response is not JSON (likely HTML error page from Nginx/CloudFront)
        console.error('Non-JSON response received:', responseText.substring(0, 200));
        if (response.status === 404) {
          setMessage({ type: 'danger', text: 'User not found. Please sign up.' });
          return;
        }
        setMessage({ type: 'danger', text: 'An unexpected error occurred. Please try again.' });
        return;
      }

      // Handle error responses (either non-OK status or error status in JSON)
      if (!response.ok || data.status === 'error') {
        setMessage({ type: 'danger', text: data.message || 'Login failed.' });
        console.error('Login failed:', data);
        return;
      }

      if (data.status === 'success') {
        setMessage({ type: 'success', text: data.message || 'OTP sent successfully!' });
        if (data.redirect) {
          navigate(data.redirect, { state: { email: normalizedEmail } });
        } else {
          navigate('/verify-otp', { state: { email: normalizedEmail } }); // Fallback if no redirect is provided
        }
      } else if (data.status === 'otp_required') {
        setMessage({ type: 'info', text: data.message || 'Please verify the OTP sent to your email and try again.' });
        navigate('/verify-otp', { state: { email: normalizedEmail } });
      } else {
        // Unknown status
        setMessage({ type: 'danger', text: data.message || 'Login failed.' });
        console.error('Login failed with unknown status:', data);
      }
    } catch (error) {
      console.error('Error during login:', error);
      setMessage({ type: 'danger', text: 'An unexpected error occurred. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  // Show loading while checking authentication
  if (checkingAuth) {
    return (
      <div className="auth-page">
        <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
          <div className="text-center">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <LoaderOverlay visible={loading} message="Sending OTP..." />
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
              Secure Access to Your Trading Console
            </span>
            <h1 className="display-5 fw-bold text-white">
              Continue your AI-powered trading journey with confidence.
            </h1>
            <p className="lead text-white-50 mt-3">
              Verify your identity in seconds and step back into your personalised dashboard—
              complete with live strategies, analytics, and risk controls tailored to your portfolio.
            </p>
            <div className="auth-metrics">
              <div>
                <strong>500+</strong>
                <small>Live & paper strategies monitored seamlessly.</small>
              </div>
              <div>
                <strong>24/7</strong>
                <small>Automated oversight with proactive alerts.</small>
              </div>
              <div>
                <strong>2-step</strong>
                <small>OTP validation keeps every account secure.</small>
              </div>
            </div>
            <div className="auth-side-note mt-4">
              <strong>New to the platform?</strong> Your login uses a one-time password emailed to
              you. No passwords to remember—just secure, frictionless access.
            </div>
          </div>
          <div className="col-lg-5 offset-lg-1 col-xl-4">
            <div className="auth-card shadow-lg">
              <h3 className="fw-semibold mb-4">Sign in to your account</h3>
              <p className="text-white-50 mb-4">
                Enter the registered email address to receive a one-time passcode.
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
                  />
                </div>
                <button type="submit" className="btn btn-primary">
                  Send OTP
                </button>
              </form>
              
              <div className="divider my-4">
                <span className="text-white-50">or</span>
              </div>
              
              <GoogleLoginButton />
              <div className="text-center text-white-50 mt-4">
                Don&apos;t have an account?{' '}
                <Link to="/signup" className="text-white">
                  Create one now
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

export default Login;


