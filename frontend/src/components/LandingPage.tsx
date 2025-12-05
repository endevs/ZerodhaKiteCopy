import React from 'react';
import { Link } from 'react-router-dom';
import '../App.css';
import SupportChat from './SupportChat';
import PolicyLinks from './PolicyLinks';

const LandingPage: React.FC = () => {
  return (
    <div className="landing-page">
      <header className="landing-hero">
        <nav className="landing-nav container">
          <div className="d-flex align-items-center">
            <img src="/drp-infotech-logo.png" alt="DRP Infotech Pvt Ltd" className="landing-logo" />
          </div>
          <div className="d-flex align-items-center gap-3">
            <Link to="/login" className="btn btn-outline-light btn-sm px-3">
              Log in
            </Link>
            <Link to="/signup" className="btn btn-primary btn-sm px-3">
              Get Started
            </Link>
          </div>
        </nav>

        <div className="container hero-content">
          <div className="row align-items-center g-5">
            <div className="col-lg-6">
              <span className="badge bg-primary-subtle text-primary-emphasis mb-3">
                AI-Driven Algorithmic Trading
              </span>
              <h1 className="display-4 fw-bold text-white">
                Amplify Your Growth with Intelligent Trading Automation
              </h1>
              <p className="lead text-white-50 mt-3">
                Harness advanced AI, real-time market intelligence, and automated execution to scale your
                investment strategies. Our all-in-one platform transforms complex ideas into deployable
                trading systems in minutes.
              </p>
              <div className="d-flex flex-wrap gap-3 mt-4">
                <Link to="/signup" className="btn btn-lg btn-primary px-4">
                  Launch Your Strategy
                </Link>
                <a href="#features" className="btn btn-lg btn-outline-light px-4">
                  Explore Features
                </a>
              </div>
              <div className="d-flex gap-4 mt-5 text-white-50">
                <div>
                  <h3 className="text-white fw-bold mb-0">24×7</h3>
                  <small>AI Strategy Assistant</small>
                </div>
                <div>
                  <h3 className="text-white fw-bold mb-0">10k+</h3>
                  <small>Backtests Executed</small>
                </div>
                <div>
                  <h3 className="text-white fw-bold mb-0">100%</h3>
                  <small>Secure & Compliant</small>
                </div>
              </div>
            </div>
            <div className="col-lg-6">
              <div className="hero-card shadow-lg">
                <h5 className="text-primary fw-semibold">Trusted Automation Pipeline</h5>
                <ul className="hero-list mt-3">
                  <li>
                    <span className="hero-pip bg-primary-subtle text-primary-emphasis">1</span>
                    Ideate and blueprint your strategy with AI assistance.
                  </li>
                  <li>
                    <span className="hero-pip bg-success-subtle text-success-emphasis">2</span>
                    Validate with institutional-grade backtesting and market replay.
                  </li>
                  <li>
                    <span className="hero-pip bg-warning-subtle text-warning-emphasis">3</span>
                    Deploy live or paper trade with real-time risk controls.
                  </li>
                </ul>
                <div className="alert alert-primary d-flex align-items-center gap-2 mb-0 mt-4">
                  <i className="bi bi-lightning-charge-fill fs-5"></i>
                  <span>
                    Adaptive AI refines your strategy as markets evolve—stay ahead of volatility with
                    confidence.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main>
        <section id="features" className="section section-light">
          <div className="container">
            <div className="text-center mb-5">
              <span className="badge bg-primary-subtle text-primary-emphasis">Why Traders Choose Us</span>
              <h2 className="fw-bold mt-3">AI + Automation Crafted for Modern Markets</h2>
              <p className="text-muted lead">
                From idea to execution, the DRP Infotech Algo Trading Platform delivers end-to-end tooling
                that empowers teams to build resilient, rules-based portfolios.
              </p>
            </div>
            <div className="row g-4">
              {[
                {
                  title: 'AI Strategy Studio',
                  description:
                    'Convert natural-language objectives into structured blueprints that align with Zerodha Kite Connect execution.',
                  icon: 'bi-cpu',
                },
                {
                  title: 'Full Lifecycle Automation',
                  description:
                    'Backtest, optimize, deploy, and monitor strategies in one unified environment with enterprise-grade controls.',
                  icon: 'bi-diagram-3',
                },
                {
                  title: 'Granular Risk Intelligence',
                  description:
                    'Dynamic stop-loss, exposure throttling, and anomaly alerts keep your capital protected in fast-moving markets.',
                  icon: 'bi-shield-check',
                },
              ].map((feature) => (
                <div className="col-md-4" key={feature.title}>
                  <div className="card feature-card h-100 border-0 shadow-sm">
                    <div className="card-body p-4">
                      <div className="icon-circle mb-3">
                        <i className={`bi ${feature.icon}`}></i>
                      </div>
                      <h5 className="fw-semibold">{feature.title}</h5>
                      <p className="text-muted mb-0">{feature.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-gradient">
          <div className="container">
            <div className="row align-items-center g-5">
              <div className="col-lg-6">
                <h2 className="fw-bold text-white">Designed for Traders Who Think in Systems</h2>
                <p className="text-white-50 lead">
                  Whether you are validating a new hypothesis or scaling a proven playbook, our platform
                  gives you the analytical depth and automation muscle to stay consistent.
                </p>
                <div className="d-flex flex-column gap-3 text-white-50">
                  <div className="d-flex gap-3">
                    <div className="icon-box bg-white text-primary">
                      <i className="bi bi-graph-up"></i>
                    </div>
                    <div>
                      <h6 className="text-white mb-1">Institutional-Grade Analytics</h6>
                      <p className="mb-0">
                        Capture performance metrics, drawdowns, and execution latency in real time for every
                        strategy.
                      </p>
                    </div>
                  </div>
                  <div className="d-flex gap-3">
                    <div className="icon-box bg-white text-primary">
                      <i className="bi bi-smartwatch"></i>
                    </div>
                    <div>
                      <h6 className="text-white mb-1">24/7 Monitoring & Alerts</h6>
                      <p className="mb-0">
                        Receive proactive notifications when strategies drift, markets shift, or risk
                        thresholds are breached.
                      </p>
                    </div>
                  </div>
                  <div className="d-flex gap-3">
                    <div className="icon-box bg-white text-primary">
                      <i className="bi bi-cloud-arrow-up"></i>
                    </div>
                    <div>
                      <h6 className="text-white mb-1">Seamless Zerodha Integration</h6>
                      <p className="mb-0">
                        Execute across equities, indices, and derivatives with Kite Connect APIs and low-latency
                        data streams.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="col-lg-6">
                <div className="glass-card shadow-lg">
                  <h5 className="text-white fw-semibold mb-4">AI Workflow in Action</h5>
                  <ol className="workflow-list">
                    <li>
                      <strong>Describe your idea.</strong> "Capture BankNifty momentum post 9:45 with defined
                      drawdown controls."
                    </li>
                    <li>
                      <strong>AI blueprints the logic.</strong> Receive structured entry, exit, and risk rules,
                      ready for deployment.
                    </li>
                    <li>
                      <strong>Backtest & optimize.</strong> Validate across historical data, adjust parameters,
                      and lock in the edge.
                    </li>
                    <li>
                      <strong>Deploy with confidence.</strong> Go live or paper trade with automated governance
                      and live telemetry.
                    </li>
                  </ol>
                  <div className="mt-4 text-center">
                    <Link to="/signup" className="btn btn-light px-4">
                      Experience the AI Studio
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section section-light">
          <div className="container">
            <div className="row g-4 align-items-center">
              <div className="col-lg-5">
                <span className="badge bg-primary-subtle text-primary-emphasis mb-3">
                  Amplify Your Growth
                </span>
                <h2 className="fw-bold">Build sustainable alpha, compound your edge.</h2>
                <p className="text-muted">
                  Our mission is to transform discretionary trading into an evidence-based discipline. With
                  DRP Infotech's platform, independent traders and boutique desks can compete with institutional
                  speed, precision, and discipline.
                </p>
                <div className="d-flex flex-wrap gap-3 mt-4">
                  <a href="mailto:contact@drpinfotech.com" className="btn btn-outline-primary">
                    Talk to Strategy Expert
                  </a>
                  <Link to="/login" className="btn btn-primary">
                    Access Your Console
                  </Link>
                </div>
              </div>
              <div className="col-lg-7">
                <div className="row g-3">
                  {[
                    {
                      stat: '98%',
                      caption: 'Automation Uptime across live deployments.',
                    },
                    {
                      stat: '30+',
                      caption: 'Pre-built playbooks to jump-start experimentation.',
                    },
                    {
                      stat: '15 mins',
                      caption: 'Average time to translate ideas into runnable strategies.',
                    },
                    {
                      stat: '500+',
                      caption: 'Simulated scenarios to stress test before capital deployment.',
                    },
                  ].map((item) => (
                    <div className="col-sm-6" key={item.caption}>
                      <div className="stat-card shadow-sm">
                        <h3 className="text-primary fw-bold">{item.stat}</h3>
                        <p className="mb-0 text-muted">{item.caption}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="container d-flex flex-column flex-lg-row align-items-center justify-content-between gap-3">
          <div className="d-flex align-items-center gap-3">
            <img src="/drp-infotech-logo.png" alt="DRP Infotech Pvt Ltd" className="landing-logo small" />
            <p className="mb-0 text-white-50">Algorithmic Trading | AI Strategy Automation</p>
          </div>
          <div className="text-white-50">
            <span className="me-3">
              <i className="bi bi-envelope-open me-1"></i>
              <a href="mailto:contact@drpinfotech.com" className="text-white-50 text-decoration-none">
                contact@drpinfotech.com
              </a>
            </span>
            <span>
              <i className="bi bi-globe me-1"></i>
              <a href="https://drpinfotech.com" className="text-white-50 text-decoration-none" target="_blank" rel="noreferrer">
                drpinfotech.com
              </a>
            </span>
          </div>
          <div className="text-white-50 small">
            © {new Date().getFullYear()} DRP Infotech Pvt Ltd. All rights reserved.
          </div>
        </div>
      </footer>
      <SupportChat />
      <PolicyLinks />
    </div>
  );
};

export default LandingPage;
