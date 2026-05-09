import React from 'react';
import { Link } from 'react-router-dom';
import './OpenBookPage.css';
import '../App.css';
import PolicyLinks from './PolicyLinks';
import { openBookBenefits, openBookPlayStoreUrl, openBookScreenshots } from '../data/openBookContent';

const OpenBookPage: React.FC = () => {
  return (
    <div className="openbook-page">
      <nav className="openbook-nav">
        <div className="openbook-nav-brand">
          <i className="bi bi-book-half fs-4" aria-hidden />
          <span>OpenBook</span>
        </div>
        <Link to="/">
          <i className="bi bi-house-door" aria-hidden />
          Back to home
        </Link>
      </nav>

      <main className="openbook-inner">
        <header className="openbook-hero">
          <h1>OpenBook</h1>
          <p className="openbook-tagline">
            Android EdTech for students: snap pages from your textbooks and notes, revise with quizzes, and
            track progress—<strong>Snap. Revise. Succeed.</strong>
          </p>
        </header>

        <section className="openbook-benefits" aria-labelledby="openbook-benefits-heading">
          <h2 id="openbook-benefits-heading">Why use OpenBook</h2>
          <ul>
            {openBookBenefits.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="openbook-download" aria-labelledby="openbook-download-heading">
          <h2 id="openbook-download-heading">Download for Android</h2>
          <p>
            OpenBook is now available on Google Play. Use the official Play Store listing to install and receive
            updates.
          </p>
          <a className="btn-download" href={openBookPlayStoreUrl} target="_blank" rel="noopener noreferrer">
            <i className="bi bi-google-play" aria-hidden />
            Get it on Google Play
          </a>
          <small>Official Play Store listing for OpenBook: com.drpinfotech.openbook.</small>
        </section>

        <section className="openbook-gallery" aria-labelledby="openbook-gallery-heading">
          <h2 id="openbook-gallery-heading">How it works</h2>
          {openBookScreenshots.map((shot) => (
            <article key={shot.src} className="openbook-shot">
              <div className="openbook-shot-image">
                <img src={shot.src} alt={`${shot.title}. ${shot.body.slice(0, 120)}…`} loading="lazy" />
              </div>
              <div className="openbook-shot-content">
                <span>{shot.title}</span>
                <h3>{shot.body.slice(0, 80)}</h3>
                <p>{shot.body}</p>
              </div>
            </article>
          ))}
        </section>

        <p className="openbook-footer-note">
          <Link to="/legal/openbook-privacy-policy">Privacy policy (OpenBook)</Link>
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

export default OpenBookPage;
