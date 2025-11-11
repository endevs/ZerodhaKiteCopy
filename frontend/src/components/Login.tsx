import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LoaderOverlay from './LoaderOverlay';
import SupportChat from './SupportChat';

const Login: React.FC = () => {
  const [email, setEmail] = useState<string>('');
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setLoading(true);

    try {
      const response = await fetch('http://localhost:8000/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });

      console.log('Raw response:', response);
      console.log('Response Status:', response.status);
      console.log('Response Status Text:', response.statusText);

      if (!response.ok) {
        // If response is not OK, try to parse JSON error, otherwise use status text
        let errorData;
        try {
          errorData = await response.json();
        } catch (jsonError) {
          errorData = { message: `Server error: ${response.statusText}` };
        }
        setMessage({ type: 'danger', text: errorData.message || 'Login failed.' });
        console.error('Login failed:', errorData);
        return;
      }

      const data = await response.json();
      console.log('Parsed data:', data); // Log the parsed data

      if (data.status === 'success') {
        setMessage({ type: 'success', text: data.message || 'OTP sent successfully!' });
        if (data.redirect) {
          navigate(data.redirect, { state: { email } });
        } else {
          navigate('/verify-otp', { state: { email } }); // Fallback if no redirect is provided
        }
      } else if (data.status === 'otp_required') {
        setMessage({ type: 'info', text: data.message || 'Please verify the OTP sent to your email and try again.' });
        navigate('/verify-otp', { state: { email } });
      } else {
        // This case should ideally be caught by !response.ok, but as a fallback
        setMessage({ type: 'danger', text: data.message || 'Login failed.' });
        console.error('Login failed with success status false:', data);
      }
    } catch (error) {
      console.error('Error during login:', error);
      setMessage({ type: 'danger', text: 'An unexpected error occurred. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <LoaderOverlay visible={loading} message="Sending OTP..." />
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
    </div>
  );
};

export default Login;


