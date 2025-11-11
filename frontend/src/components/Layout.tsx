import React, { ReactNode } from 'react';

interface LayoutProps {
  children: ReactNode;
  navigation?: ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children, navigation }) => {
  return (
    <div className="min-vh-100 d-flex flex-column" style={{ backgroundColor: '#f8f9fa' }}>
      {navigation}
      <main className="flex-grow-1 container-fluid py-4">
        <div className="container-xxl">
          {children}
        </div>
      </main>
      <footer className="bg-dark text-light py-4 mt-auto">
        <div className="container">
          <div className="row">
            <div className="col-md-4 text-center text-md-start mb-3 mb-md-0">
              <div className="d-flex align-items-center justify-content-center justify-content-md-start mb-2">
                <a 
                  href="https://drpinfotech.com" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-decoration-none"
                >
                  <img 
                    src="/drp-infotech-logo.png" 
                    alt="DRP Infotech Pvt Ltd" 
                    style={{ height: '35px', width: 'auto', marginRight: '10px', filter: 'brightness(0) invert(1)' }}
                  />
                </a>
              </div>
              <h6 className="text-white mb-2">DRP Infotech Pvt Ltd</h6>
              <p className="mb-1 small text-white-50">Algorithmic Trading Platform</p>
              <p className="mb-0 small text-white-50">&copy; 2025 All rights reserved.</p>
            </div>
            <div className="col-md-4 text-center mb-3 mb-md-0">
              <h6 className="text-white mb-3">Quick Links</h6>
              <ul className="list-unstyled mb-0">
                <li className="mb-2">
                  <a 
                    href="#" 
                    onClick={(e) => {
                      e.preventDefault();
                      // Check authentication before navigating
                      fetch('http://localhost:8000/api/user-data', { credentials: 'include' })
                        .then(res => {
                          if (res.ok) {
                            window.location.href = '/dashboard';
                          } else {
                            alert('Please log in to access the dashboard.');
                            window.location.href = '/login';
                          }
                        })
                        .catch(() => {
                          alert('Please log in to access the dashboard.');
                          window.location.href = '/login';
                        });
                    }}
                    className="text-white-50 text-decoration-none small"
                  >
                    Dashboard
                  </a>
                </li>
                <li className="mb-2">
                  <span className="text-white-50 small">Market Replay</span>
                  <span className="text-white-50 small ms-1">(Login Required)</span>
                </li>
              </ul>
            </div>
            <div className="col-md-4 text-center text-md-end">
              <h6 className="text-white mb-3">Contact Us</h6>
              <p className="mb-2 small">
                <a href="mailto:contact@drpinfotech.com" className="text-white-50 text-decoration-none">
                  <i className="bi bi-envelope me-2"></i>contact@drpinfotech.com
                </a>
              </p>
              <p className="mb-0 small">
                <a href="https://drpinfotech.com" target="_blank" rel="noopener noreferrer" className="text-white-50 text-decoration-none">
                  <i className="bi bi-globe me-2"></i>drpinfotech.com
                </a>
              </p>
            </div>
          </div>
          <hr className="my-3 bg-secondary" />
          <div className="row">
            <div className="col-12 text-center">
              <p className="mb-0 small text-white-50">
                DRP Infotech Pvt Ltd - Professional Algorithmic Trading Solutions
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
