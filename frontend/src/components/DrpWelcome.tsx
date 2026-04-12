import React from 'react';
import { Link } from 'react-router-dom';
import './DrpWelcome.css';
import '../App.css';
import PolicyLinks from './PolicyLinks';

const DrpWelcome: React.FC = () => {
  return (
    <div className="drp-welcome">
      <div className="drp-welcome-inner">
        <header className="drp-welcome-header">
          <div className="drp-welcome-toprow">
            <img
              src="/drp-infotech-logo.png"
              alt="DRP Infotech Pvt Ltd"
              className="drp-welcome-logo"
            />
          </div>
          <h1 className="drp-welcome-title">Welcome to DRP Infotech</h1>
          <p className="drp-welcome-subtitle">
            Choose a product to continue. Each experience opens in context—trading on this site, our
            dedicated web apps on their own domains, or OpenBook on Android.
          </p>
        </header>

        <div className="drp-welcome-grid">
          <Link to="/trading" className="drp-welcome-card">
            <div className="drp-welcome-card-icon drp-welcome-card-icon--trading" aria-hidden>
              <i className="bi bi-graph-up-arrow" />
            </div>
            <h2>Algorithmic trading</h2>
            <p>
              Zerodha Kite–connected platform: AI-assisted strategies, backtesting, and live trading tools.
            </p>
            <span className="drp-welcome-card-cta">
              Open trading <i className="bi bi-arrow-right" />
            </span>
          </Link>

          <a
            href="https://astro.drpinfotech.com"
            className="drp-welcome-card"
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="drp-welcome-card-icon drp-welcome-card-icon--astro" aria-hidden>
              <i className="bi bi-stars" />
            </div>
            <h2>Vedic astrology</h2>
            <p>Birth charts, divisional charts, dasha analysis, and consultations on astro.drpinfotech.com.</p>
            <span className="drp-welcome-card-cta">
              Open astrology <i className="bi bi-box-arrow-up-right" />
            </span>
          </a>

          <a
            href="https://ai.drpinfotech.com"
            className="drp-welcome-card"
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="drp-welcome-card-icon drp-welcome-card-icon--ai" aria-hidden>
              <i className="bi bi-robot" />
            </div>
            <h2>AI tools</h2>
            <p>Practical AI utilities—nutrition, medical imaging helpers, and more on ai.drpinfotech.com.</p>
            <span className="drp-welcome-card-cta">
              Open AI tools <i className="bi bi-box-arrow-up-right" />
            </span>
          </a>

          <Link to="/openbook" className="drp-welcome-card">
            <div className="drp-welcome-card-icon drp-welcome-card-icon--openbook" aria-hidden>
              <i className="bi bi-phone" />
            </div>
            <h2>OpenBook</h2>
            <p>
              Android EdTech: snap textbook pages, revise with quizzes, and track progress—download the APK from
              the product page.
            </p>
            <span className="drp-welcome-card-cta">
              Learn more &amp; download <i className="bi bi-arrow-right" />
            </span>
          </Link>
        </div>

        <footer className="drp-welcome-footer">
          <PolicyLinks />
          <small className="d-block mt-3">© {new Date().getFullYear()} DRP Infotech Pvt Ltd</small>
        </footer>
      </div>
    </div>
  );
};

export default DrpWelcome;
