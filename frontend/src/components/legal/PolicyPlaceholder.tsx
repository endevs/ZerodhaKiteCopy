import React from 'react';
import { Link } from 'react-router-dom';
import SupportChat from '../SupportChat';

interface PolicyPlaceholderProps {
  title: string;
  lastUpdated?: string;
  children?: React.ReactNode;
}

const PolicyPlaceholder: React.FC<PolicyPlaceholderProps> = ({
  title,
  lastUpdated,
  children,
}) => (
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
        <div className="col-lg-8">
          <div className="auth-card shadow-lg text-start">
            <span className="badge bg-primary-subtle text-primary-emphasis mb-3">
              {title}
            </span>
            <h2 className="fw-bold text-white">{title}</h2>
            {lastUpdated && (
              <p className="text-white-50 small">Last updated on {lastUpdated}</p>
            )}
            <hr className="border-white-25" />
            {children || (
              <p className="text-white-50">
                Detailed {title.toLowerCase()} will be published here shortly.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>

    <div className="container text-center auth-footer-text">
      © {new Date().getFullYear()} DRP Infotech Pvt Ltd · Intelligent Algo Trading &amp; AI Automation
    </div>
    <SupportChat />
    <div className="policy-ribbon">
      <Link to="/legal/contact">Contact us</Link>
      <span>•</span>
      <Link to="/legal/privacy-policy">Privacy Policy</Link>
      <span>•</span>
      <Link to="/legal/cancellation-policy">Cancellation &amp; Refund Policy</Link>
      <span>•</span>
      <Link to="/legal/shipping-policy">Shipping &amp; Delivery Policy</Link>
      <span>•</span>
      <Link to="/legal/terms">Terms &amp; Conditions</Link>
    </div>
  </div>
);

export default PolicyPlaceholder;



