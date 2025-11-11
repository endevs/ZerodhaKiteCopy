import React from 'react';
import { Link } from 'react-router-dom';
import SupportChat from '../SupportChat';
import PolicyLinks from '../PolicyLinks';

interface LegalLayoutProps {
  title: string;
  lastUpdated?: string;
  children: React.ReactNode;
}

const LegalLayout: React.FC<LegalLayoutProps> = ({ title, lastUpdated, children }) => (
  <div className="auth-page">
    <div className="auth-overlay" />
    <nav className="auth-nav container">
      <div className="d-flex align-items-center">
        <img src="/drp-infotech-logo.png" alt="DRP Infotech Pvt Ltd" className="auth-logo" />
        <span className="auth-brand">DRP Infotech Pvt Ltd</span>
      </div>
      <div className="d-flex align-items-center gap-2">
        <Link to="/" className="btn btn-outline-light btn-sm px-3">
          Home
        </Link>
        <Link to="/login" className="btn btn-light btn-sm px-3 text-primary">
          Login
        </Link>
      </div>
    </nav>

    <div className="container auth-container">
      <div className="row justify-content-center">
        <div className="col-lg-8 col-xl-7">
          <div className="auth-card shadow-lg text-start">
            <span className="badge bg-primary-subtle text-primary-emphasis mb-3 text-uppercase">
              {title}
            </span>
            <h2 className="fw-bold text-white">{title}</h2>
            {lastUpdated && (
              <p className="text-white-50 small mb-3">Last updated on {lastUpdated}</p>
            )}
            <hr className="border-white-25" />
            <div className="legal-body text-white-50">{children}</div>
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

export default LegalLayout;

