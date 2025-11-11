import React from 'react';

interface CompanyInfoProps {
  variant?: 'full' | 'compact';
}

const CompanyInfo: React.FC<CompanyInfoProps> = ({ variant = 'full' }) => {
  if (variant === 'compact') {
    return (
      <div className="text-center py-2">
        <small className="text-muted">
          <span>© 2025 DRP Infotech Pvt Ltd</span>
          <span className="mx-2">|</span>
          <a href="mailto:contact@drpinfotech.com" className="text-muted text-decoration-none">
            contact@drpinfotech.com
          </a>
          <span className="mx-2">|</span>
          <a href="https://drpinfotech.com" target="_blank" rel="noopener noreferrer" className="text-muted text-decoration-none">
            drpinfotech.com
          </a>
        </small>
      </div>
    );
  }

  return (
    <div className="card shadow-sm mb-4">
      <div className="card-body">
        <div className="row align-items-center">
          <div className="col-md-8">
            <h5 className="card-title mb-2">DRP Infotech Pvt Ltd</h5>
            <p className="card-text text-muted mb-2">
              Professional Algorithmic Trading Solutions
            </p>
            <div className="d-flex flex-column flex-md-row gap-3">
              <div>
                <i className="bi bi-envelope me-2 text-primary"></i>
                <a href="mailto:contact@drpinfotech.com" className="text-decoration-none">
                  contact@drpinfotech.com
                </a>
              </div>
              <div>
                <i className="bi bi-globe me-2 text-primary"></i>
                <a href="https://drpinfotech.com" target="_blank" rel="noopener noreferrer" className="text-decoration-none">
                  drpinfotech.com
                </a>
              </div>
            </div>
          </div>
          <div className="col-md-4 text-center text-md-end mt-3 mt-md-0">
            <img 
              src="/drp-infotech-logo.png" 
              alt="DRP Infotech Pvt Ltd" 
              style={{ maxHeight: '80px', width: 'auto' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyInfo;

