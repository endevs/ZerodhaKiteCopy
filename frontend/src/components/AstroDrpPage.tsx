import React from 'react';
import { Link } from 'react-router-dom';
import './AstroDrpPage.css';
import '../App.css';
import PolicyLinks from './PolicyLinks';
import { astroDrpApkPath, astroDrpBenefits, astroDrpScreenshots } from '../data/astroDrpContent';

const AstroDrpPage: React.FC = () => {
  return (
    <div className="astrodpr-page">
      <nav className="astrodpr-nav">
        <div className="astrodpr-nav-brand">
          <i className="bi bi-moon-stars fs-4" aria-hidden />
          <span>AstroDRP</span>
        </div>
        <Link to="/">
          <i className="bi bi-house-door" aria-hidden />
          {' '}
          Back to home
        </Link>
      </nav>

      <main className="astrodpr-inner">
        <header className="astrodpr-hero">
          <h1>AstroDRP</h1>
          <p className="astrodpr-tagline">
            Your Android astrology companion for practical guidance, chart-based insights, and daily clarity.
          </p>
        </header>

        <section className="astrodpr-benefits" aria-labelledby="astrodpr-benefits-heading">
          <h2 id="astrodpr-benefits-heading">Why use AstroDRP</h2>
          <ul>
            {astroDrpBenefits.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="astrodpr-download" aria-labelledby="astrodpr-download-heading">
          <h2 id="astrodpr-download-heading">Download for Android (Test Mode)</h2>
          <p>
            AstroDRP is currently in testing and will be available on Google Play Store soon. For now, you can
            download the APK directly.
          </p>
          <a className="btn-download" href={astroDrpApkPath} download="astroDRP.apk">
            <i className="bi bi-download" aria-hidden />
            Download AstroDRP APK
          </a>
          <small>Android only. You may need to allow installs from your browser or files app on your phone.</small>
        </section>

        <section className="astrodpr-gallery" aria-labelledby="astrodpr-gallery-heading">
          {astroDrpScreenshots.map((shot) => (
            <article key={shot.src} className="astrodpr-shot">
              <div className="astrodpr-shot-image">
                <img src={shot.src} alt={`${shot.title}. ${shot.body.slice(0, 120)}…`} loading="lazy" />
              </div>
              <div className="astrodpr-shot-content">
                <span>App Screenshot</span>
                <h3>{shot.title}</h3>
                <p>{shot.body}</p>
              </div>
            </article>
          ))}
        </section>

        <p className="astrodpr-footer-note">
          <Link to="/legal/astrodrp-privacy-policy">Privacy policy (AstroDRP)</Link>
          {' · '}
          Questions or partnerships? Use <Link to="/legal/contact">Contact us</Link> on the main site.
        </p>

        <footer className="mt-4 pt-3 border-top border-secondary-subtle">
          <PolicyLinks />
        </footer>
      </main>
    </div>
  );
};

export default AstroDrpPage;

