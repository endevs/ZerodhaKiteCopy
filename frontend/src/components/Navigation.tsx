import React, { useState, useRef, useEffect, useCallback } from 'react';

interface NavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  userName: string;
  kiteClientId?: string | null;
  onLogout: () => void;
  niftyPrice: string;
  bankNiftyPrice: string;
  isAdmin?: boolean;
  onProfileClick?: () => void;
  onSubscribeClick?: () => void;
}

const useHoverDropdown = () => {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimeout();
    closeTimeoutRef.current = setTimeout(() => setShow(false), 200);
  }, [clearCloseTimeout]);

  const open = useCallback(() => {
    clearCloseTimeout();
    setShow(true);
  }, [clearCloseTimeout]);

  const close = useCallback(() => {
    clearCloseTimeout();
    setShow(false);
  }, [clearCloseTimeout]);

  const toggle = useCallback(() => {
    if (show) close();
    else open();
  }, [show, close, open]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        close();
      }
    };
    if (show) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      clearCloseTimeout();
    };
  }, [show, close, clearCloseTimeout]);

  return { show, ref, open, close, toggle, scheduleClose };
};

const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onTabChange,
  userName,
  kiteClientId,
  onLogout,
  niftyPrice,
  bankNiftyPrice,
  isAdmin = false,
  onProfileClick,
  onSubscribeClick,
}) => {
  const profileMenu = useHoverDropdown();
  const liveTradeMenu = useHoverDropdown();

  const isLiveTradeActive = activeTab === 'live-trade' || activeTab === 'position';

  const navItemsBeforeLiveTrade = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'algo-visualization', label: 'Algo Visualization', icon: '🎯' },
  ];

  const navItemsAfterLiveTrade = [
    { id: 'ai-ml', label: 'AI / ML', icon: '🤖' },
    { id: 'options', label: 'Options', icon: '📈' },
    { id: 'advanced-charts', label: 'Advanced Charts', icon: '📊' },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: '🛡️' }] : []),
  ];

  const renderNavButton = (item: { id: string; label: string; icon: string }) => (
    <li key={item.id} className="nav-item">
      <button
        className={`nav-link ${activeTab === item.id ? 'active fw-bold' : ''}`}
        onClick={() => onTabChange(item.id)}
        style={navLinkStyle(activeTab === item.id)}
        onMouseEnter={(e) => handleNavHoverEnter(e, activeTab === item.id)}
        onMouseLeave={(e) => handleNavHoverLeave(e, activeTab === item.id)}
      >
        <span className="me-2">{item.icon}</span>
        {item.label}
      </button>
    </li>
  );

  const navLinkStyle = (isActive: boolean): React.CSSProperties => ({
    background: 'none',
    border: 'none',
    color: isActive ? '#0d6efd' : 'rgba(255,255,255,.55)',
    cursor: 'pointer',
    padding: '0.5rem 1rem',
  });

  const handleNavHoverEnter = (e: React.MouseEvent<HTMLButtonElement>, isActive: boolean) => {
    if (!isActive) e.currentTarget.style.color = '#fff';
  };

  const handleNavHoverLeave = (e: React.MouseEvent<HTMLButtonElement>, isActive: boolean) => {
    if (!isActive) e.currentTarget.style.color = 'rgba(255,255,255,.55)';
  };

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
              objectFit: 'contain',
            }}
            onError={(e) => {
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
            {navItemsBeforeLiveTrade.map(renderNavButton)}

            <li className="nav-item">
              <div
                className="position-relative"
                ref={liveTradeMenu.ref}
                onMouseEnter={liveTradeMenu.open}
                onMouseLeave={liveTradeMenu.scheduleClose}
                style={{ touchAction: 'manipulation' }}
              >
                <button
                  type="button"
                  className={`nav-link ${isLiveTradeActive ? 'active fw-bold' : ''}`}
                  style={navLinkStyle(isLiveTradeActive)}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    liveTradeMenu.toggle();
                  }}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    liveTradeMenu.toggle();
                  }}
                  onMouseEnter={(e) => handleNavHoverEnter(e, isLiveTradeActive)}
                  onMouseLeave={(e) => handleNavHoverLeave(e, isLiveTradeActive)}
                >
                  <span className="me-2">⚡</span>
                  Live Trade
                  <i
                    className={`bi bi-chevron-${liveTradeMenu.show ? 'up' : 'down'} ms-1`}
                    style={{ fontSize: '0.75rem' }}
                  />
                </button>
                {liveTradeMenu.show && (
                  <div
                    className="dropdown-menu show position-absolute"
                    style={{
                      minWidth: '180px',
                      zIndex: 1050,
                      marginTop: '0.25rem',
                      padding: '0.5rem 0',
                    }}
                  >
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => {
                        liveTradeMenu.close();
                        onTabChange('live-trade');
                      }}
                    >
                      <i className="bi bi-lightning-charge me-2" />
                      Live Trade
                    </button>
                    <button
                      type="button"
                      className="dropdown-item"
                      onClick={() => {
                        liveTradeMenu.close();
                        onTabChange('position');
                      }}
                    >
                      <i className="bi bi-briefcase me-2" />
                      Position
                    </button>
                  </div>
                )}
              </div>
            </li>

            {navItemsAfterLiveTrade.map(renderNavButton)}
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
              <div
                className="position-relative"
                ref={profileMenu.ref}
                onMouseEnter={profileMenu.open}
                onMouseLeave={profileMenu.scheduleClose}
                style={{ touchAction: 'manipulation' }}
              >
                <button
                  type="button"
                  className="nav-link text-light border-0 bg-transparent p-0"
                  style={{
                    cursor: 'pointer',
                    touchAction: 'manipulation',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitTapHighlightColor: 'transparent',
                    display: 'inline-block',
                    minWidth: '44px',
                    minHeight: '44px',
                    padding: '0.5rem 1rem',
                    textAlign: 'left',
                    width: '100%',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    profileMenu.toggle();
                  }}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    profileMenu.toggle();
                  }}
                >
                  <i className="bi bi-person-circle me-2"></i>
                  Welcome, <strong>{userName}</strong>
                  {kiteClientId && (
                    <span className="ms-1 text-white-50">({kiteClientId})</span>
                  )}
                  <i
                    className={`bi bi-chevron-${profileMenu.show ? 'up' : 'down'} ms-2`}
                    style={{ fontSize: '0.75rem' }}
                  />
                </button>
                {profileMenu.show && (
                  <div
                    className="dropdown-menu show position-absolute end-0"
                    style={{
                      minWidth: '200px',
                      zIndex: 1050,
                      marginTop: '0.25rem',
                      padding: '0.5rem 0',
                    }}
                  >
                    <button
                      className="dropdown-item"
                      onClick={() => {
                        profileMenu.close();
                        onProfileClick?.();
                      }}
                    >
                      <i className="bi bi-person me-2"></i>
                      Profile
                    </button>
                    <button
                      className="dropdown-item"
                      onClick={() => {
                        profileMenu.close();
                        onSubscribeClick?.();
                      }}
                    >
                      <i className="bi bi-star me-2"></i>
                      Subscribe
                    </button>
                    <hr className="dropdown-divider" />
                    <button
                      className="dropdown-item text-danger"
                      onClick={() => {
                        profileMenu.close();
                        onLogout();
                      }}
                    >
                      <i className="bi bi-box-arrow-right me-2"></i>
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;
