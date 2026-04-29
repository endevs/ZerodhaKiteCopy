import React from 'react';
import { Link } from 'react-router-dom';
import './OpenBookPage.css';
import '../App.css';
import PolicyLinks from './PolicyLinks';
import { openBookApkPath, openBookBenefits, openBookScreenshots } from '../data/openBookContent';

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
            Install the release APK on your phone. You may need to allow installs from your browser or files app,
            and enable “Install unknown apps” for that source if Android prompts you.
          </p>
          <a className="btn-download" href={openBookApkPath} download="OpenBook-app-release.apk">
            <i className="bi bi-download" aria-hidden />
            Download APK
          </a>
          <small>Android only. For best results use a recent Android version. Install from this APK is offered alongside any future Play Store listing.</small>
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
