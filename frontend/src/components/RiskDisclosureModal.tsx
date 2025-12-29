import React from 'react';

interface RiskDisclosureModalProps {
  show: boolean;
  onClose: () => void;
}

const RiskDisclosureModal: React.FC<RiskDisclosureModalProps> = ({ show, onClose }) => {
  if (!show) return null;

  return (
    <div 
      className="modal fade show d-block" 
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 9999 }}
      onClick={onClose}
    >
      <div 
        className="modal-dialog modal-dialog-centered modal-lg" 
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content shadow-lg">
          <div className="modal-header bg-warning text-dark">
            <h5 className="modal-title fw-bold">
              <i className="bi bi-exclamation-triangle-fill me-2"></i>
              Risk Disclosures on Derivatives
            </h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
            ></button>
          </div>
          <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
            <div className="alert alert-warning mb-4">
              <strong>Important:</strong> Please read the following risk disclosures carefully before trading in derivatives.
            </div>
            
            <div className="mb-4">
              <h6 className="fw-bold mb-3">Key Findings from SEBI Study:</h6>
              <ul className="list-unstyled">
                <li className="mb-3 p-3 bg-light rounded">
                  <strong className="text-danger">9 out of 10</strong> individual traders in equity Futures and Options Segment, incurred net losses.
                </li>
                <li className="mb-3 p-3 bg-light rounded">
                  On an average, loss makers registered net trading loss close to <strong className="text-danger">₹50,000</strong>.
                </li>
                <li className="mb-3 p-3 bg-light rounded">
                  Over and above the net trading losses incurred, loss makers expended an additional <strong className="text-danger">28%</strong> of net trading losses as transaction costs.
                </li>
                <li className="mb-3 p-3 bg-light rounded">
                  Those making net trading profits, incurred between <strong className="text-danger">15% to 50%</strong> of such profits as transaction cost.
                </li>
              </ul>
            </div>

            <div className="border-top pt-3">
              <p className="text-muted small mb-0">
                <strong>Source:</strong> SEBI study dated January 25, 2023 on "Analysis of Profit and Loss of Individual Traders dealing in equity Futures and Options (F&O) Segment", wherein Aggregate Level findings are based on annual Profit/Loss incurred by individual traders in equity F&O during FY 2021-22.
              </p>
            </div>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-primary btn-lg px-5"
              onClick={onClose}
            >
              <i className="bi bi-check-circle me-2"></i>
              I Understand
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RiskDisclosureModal;


