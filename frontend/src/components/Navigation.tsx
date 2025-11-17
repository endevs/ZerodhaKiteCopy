import React from 'react';

interface NavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  userName: string;
  kiteClientId?: string | null;
  onLogout: () => void;
  niftyPrice: string;
  bankNiftyPrice: string;
  isAdmin?: boolean;
}

const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onTabChange,
  userName,
  kiteClientId,
  onLogout,
  niftyPrice,
  bankNiftyPrice,
  isAdmin = false,
}) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'algo-visualization', label: 'Algo Visualization', icon: '🎯' },
    { id: 'live-trade', label: 'Live Trade', icon: '⚡' },
    { id: 'ai-ml', label: 'AI / ML', icon: '🤖' },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: '🛡️' }] : []),
  ];

  return (
    <nav className="navbar navbar-expand-lg navbar-dark bg-dark shadow-sm">
      <div className="container-fluid">
        <a 
          className="navbar-brand d-flex align-items-center" 
          href="https://drpinfotech.com" 
          target="_blank" 
          rel="noopener noreferrer"
          style={{ paddingTop: '0.5rem', paddingBottom: '0.5rem' }}
        >
          <img 
            src="/drp-infotech-logo.png" 
            alt="DRP Infotech Pvt Ltd Logo" 
            style={{ 
              height: '45px', 
              width: 'auto',
              marginRight: '10px',
              objectFit: 'contain'
            }}
            onError={(e) => {
              // Fallback to text if image fails to load
              e.currentTarget.style.display = 'none';
              const fallback = document.createElement('span');
              fallback.className = 'fs-5 fw-bold text-light';
              fallback.textContent = 'DRP Infotech Pvt Ltd';
              e.currentTarget.parentElement?.appendChild(fallback);
            }}
          />
        </a>
        <button
          className="navbar-toggler"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#navbarNav"
          aria-controls="navbarNav"
          aria-expanded="false"
          aria-label="Toggle navigation"
        >
          <span className="navbar-toggler-icon"></span>
        </button>
        <div className="collapse navbar-collapse" id="navbarNav">
          <ul className="navbar-nav me-auto mb-2 mb-lg-0">
            {navItems.map((item) => (
              <li key={item.id} className="nav-item">
                <button
                  className={`nav-link ${activeTab === item.id ? 'active fw-bold' : ''}`}
                  onClick={() => onTabChange(item.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: activeTab === item.id ? '#0d6efd' : 'rgba(255,255,255,.55)',
                    cursor: 'pointer',
                    padding: '0.5rem 1rem',
                  }}
                  onMouseEnter={(e) => {
                    if (activeTab !== item.id) {
                      e.currentTarget.style.color = '#fff';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeTab !== item.id) {
                      e.currentTarget.style.color = 'rgba(255,255,255,.55)';
                    }
                  }}
                >
                  <span className="me-2">{item.icon}</span>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
          <ul className="navbar-nav ms-auto align-items-center">
            <li className="nav-item me-lg-3 mb-2 mb-lg-0">
              <span className="nav-link text-warning d-flex align-items-center">
                <i className="bi bi-activity me-2" />
                <span className="me-3">
                  <small className="text-uppercase text-white-50 d-block">Nifty 50</small>
                  <span className="fw-semibold">{niftyPrice}</span>
                </span>
                <span>
                  <small className="text-uppercase text-white-50 d-block">Bank Nifty</small>
                  <span className="fw-semibold">{bankNiftyPrice}</span>
                </span>
              </span>
            </li>
            <li className="nav-item">
              <span className="nav-link text-light">
                <i className="bi bi-person-circle me-2"></i>
                Welcome, <strong>{userName}</strong>
                {kiteClientId && (
                  <span className="ms-1 text-white-50">({kiteClientId})</span>
                )}
              </span>
            </li>
            <li className="nav-item">
              <button
                className="nav-link btn btn-link text-light text-decoration-none"
                onClick={onLogout}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.5rem 1rem',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#0d6efd';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#fff';
                }}
              >
                <i className="bi bi-box-arrow-right me-1"></i>
                Logout
              </button>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;

