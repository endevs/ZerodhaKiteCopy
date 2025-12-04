import React, { useState } from 'react';
import { apiUrl } from '../config/api';
import { Link, useNavigate } from 'react-router-dom';
import LoaderOverlay from './LoaderOverlay';
import SupportChat from './SupportChat';
import PolicyLinks from './PolicyLinks';

const Signup: React.FC = () => {
  const [mobile, setMobile] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setLoading(true);

    try {
      // Normalize email to lowercase for case-insensitive signup
      const normalizedEmail = email.trim().toLowerCase();
      
      const response = await fetch(apiUrl('/api/signup'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ mobile, email: normalizedEmail }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message || 'Signup successful! Please verify your OTP and then login.' });
        setTimeout(() => {
          navigate('/verify-otp', { state: { email: normalizedEmail } });
        }, 3000);
      } else {
        setMessage({ type: 'danger', text: data.message || 'Signup failed.' });
      }
    } catch (error) {
      console.error('Error during signup:', error);
      setMessage({ type: 'danger', text: 'An error occurred. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <LoaderOverlay visible={loading} message="Creating your account..." />
      <div className="auth-overlay" />
      <nav className="auth-nav container">
        <img
          src="/drp-infotech-logo.png"
          alt="DRP Infotech Pvt Ltd"
          className="auth-logo"
        />
        <div className="d-flex align-items-center gap-2">
          <Link to="/login" className="btn btn-outline-light btn-sm px-3">
            Log in
          </Link>
          <Link to="/signup" className="btn btn-light btn-sm px-3 text-primary">
            Get started
          </Link>
        </div>
      </nav>

      <div className="container auth-container">
        <div className="row align-items-center g-5">
          <div className="col-lg-6">
            <span className="badge bg-primary-subtle text-primary-emphasis mb-3">
              Launch your automated trading practice
            </span>
            <h1 className="display-5 fw-bold text-white">
              Build, test, and deploy algorithmic strategies with AI as your co-pilot.
            </h1>
            <p className="lead text-white-50 mt-3">
              Your DRP Infotech workspace brings together AI strategy design, backtesting analytics,
              and Zerodha-powered execution in one cohesive flow—purpose-built to amplify your growth.
            </p>
            <div className="auth-metrics">
              <div>
                <strong>10k+</strong>
                <small>Backtests executed across equities & derivatives.</small>
              </div>
              <div>
                <strong>65%</strong>
                <small>Average time saved converting ideas into production code.</small>
              </div>
              <div>
                <strong>360°</strong>
                <small>Risk visibility with real-time alerts and audit trails.</small>
              </div>
            </div>
            <div className="auth-side-note mt-4">
              <strong>What you need:</strong> just your contact information today. We’ll guide you to add your
              Zerodha Kite API key and secret once you reach your workspace, keeping sign-up fast and seamless.
            </div>
          </div>
          <div className="col-lg-5 offset-lg-1 col-xl-4">
            <div className="auth-card shadow-lg">
              <h3 className="fw-semibold mb-4">Create your account</h3>
              <p className="text-white-50 mb-4">
                Provide the details below to activate your AI trading console. We&apos;ll email an OTP to
                confirm your access, then help you connect Zerodha in the next step.
              </p>
              {message && (
                <div className={`alert alert-${message.type} mb-4`} role="alert">
                  {message.text}
                </div>
              )}
              <form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
                <div>
                  <label htmlFor="mobile" className="form-label">
                    Mobile Number
                  </label>
                  <input
                    type="tel"
                    className="form-control"
                    id="mobile"
                    name="mobile"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    placeholder="+91 98765 43210"
                    required
                  />
                </div>
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
                  Create account &amp; send OTP
                </button>
              </form>
              <div className="text-center text-white-50 mt-4">
                Already using DRP Infotech?{' '}
                <Link to="/login" className="text-white">
                  Log in here
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="container text-center auth-footer-text">
        Questions? Reach out at{' '}
        <a href="mailto:contact@drpinfotech.com" className="text-white text-decoration-none">
          contact@drpinfotech.com
        </a>{' '}
        · © {new Date().getFullYear()} DRP Infotech Pvt Ltd
      </div>
      <SupportChat />
      <PolicyLinks />
    </div>
  );
};

export default Signup;

