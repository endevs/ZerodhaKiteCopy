import React, { useState, useRef, useEffect } from 'react';

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
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear timeout helper
  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  // Close dropdown with delay
  const scheduleClose = () => {
    clearCloseTimeout();
    closeTimeoutRef.current = setTimeout(() => {
      setShowDropdown(false);
    }, 200); // 200ms delay before closing
  };

  // Open dropdown immediately
  const openDropdown = () => {
    clearCloseTimeout();
    setShowDropdown(true);
  };

  // Close dropdown when clicking/touching outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
        clearCloseTimeout();
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      clearCloseTimeout();
    };
  }, [showDropdown]);
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
              <div 
                className="position-relative" 
                ref={dropdownRef}
                onMouseEnter={openDropdown}
                onMouseLeave={scheduleClose}
              >
                <span 
                  className="nav-link text-light"
                  style={{ cursor: 'pointer', touchAction: 'manipulation', userSelect: 'none' }}
                  onClick={() => {
                    if (showDropdown) {
                      setShowDropdown(false);
                      clearCloseTimeout();
                    } else {
                      openDropdown();
                    }
                  }}
                  onTouchStart={(e) => {
                    // Prevent default to avoid double-tap zoom on mobile
                    e.preventDefault();
                    if (showDropdown) {
                      setShowDropdown(false);
                      clearCloseTimeout();
                    } else {
                      openDropdown();
                    }
                  }}
                >
                  <i className="bi bi-person-circle me-2"></i>
                  Welcome, <strong>{userName}</strong>
                  {kiteClientId && (
                    <span className="ms-1 text-white-50">({kiteClientId})</span>
                  )}
                  <i className={`bi bi-chevron-${showDropdown ? 'up' : 'down'} ms-2`} style={{ fontSize: '0.75rem' }}></i>
                </span>
                {showDropdown && (
                  <div 
                    className="dropdown-menu show position-absolute end-0"
                    style={{ 
                      minWidth: '200px', 
                      zIndex: 1050,
                      marginTop: '0.25rem',
                      padding: '0.5rem 0'
                    }}
                  >
                    <button
                      className="dropdown-item"
                      style={{ touchAction: 'manipulation' }}
                      onClick={() => {
                        setShowDropdown(false);
                        if (onProfileClick) {
                          onProfileClick();
                        }
                      }}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        setShowDropdown(false);
                        if (onProfileClick) {
                          onProfileClick();
                        }
                      }}
                    >
                      <i className="bi bi-person me-2"></i>
                      Profile
                    </button>
                    <button
                      className="dropdown-item"
                      style={{ touchAction: 'manipulation' }}
                      onClick={() => {
                        setShowDropdown(false);
                        if (onSubscribeClick) {
                          onSubscribeClick();
                        }
                      }}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        setShowDropdown(false);
                        if (onSubscribeClick) {
                          onSubscribeClick();
                        }
                      }}
                    >
                      <i className="bi bi-star me-2"></i>
                      Subscribe
                    </button>
                    <hr className="dropdown-divider" />
                    <button
                      className="dropdown-item text-danger"
                      style={{ touchAction: 'manipulation' }}
                      onClick={() => {
                        setShowDropdown(false);
                        onLogout();
                      }}
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        setShowDropdown(false);
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

