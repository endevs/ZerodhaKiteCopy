import React from 'react';

interface SubscriptionPopupModalProps {
  show: boolean;
  onClose: () => void;
  onSubscribe?: () => void;
  onViewPlans?: () => void;
}

const SubscriptionPopupModal: React.FC<SubscriptionPopupModalProps> = ({ show, onClose, onSubscribe, onViewPlans }) => {
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
              <i className="bi bi-star-fill me-2"></i>
              Subscription Required
            </h5>
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
            ></button>
          </div>
          <div className="modal-body">
            <div className="text-center mb-4">
              <i className="bi bi-lock-fill" style={{ fontSize: '48px', color: '#fd7e14' }}></i>
            </div>
            <h4 className="text-center mb-3">Live Strategy Deployment</h4>
            <p className="text-center text-muted mb-4">
              Live strategy deployment is available for Premium and Super Premium subscribers only.
            </p>
            
            <div className="alert alert-info">
              <h6 className="fw-bold mb-2">
                <i className="bi bi-info-circle me-2"></i>
                Free users can:
              </h6>
              <ul className="mb-0">
                <li>Create and save strategies</li>
                <li>Use AI strategy generation</li>
                <li>Run paper trading</li>
                <li>Backtest strategies (1 month)</li>
                <li>Get expert review</li>
              </ul>
            </div>

            <div className="alert alert-warning">
              <h6 className="fw-bold mb-2">
                <i className="bi bi-star me-2"></i>
                Upgrade to unlock:
              </h6>
              <ul className="mb-0">
                <li><strong>Live strategy deployment</strong> - Deploy strategies with real money</li>
                <li>Unlimited backtesting</li>
                <li>Strategy optimization</li>
                <li>AI/ML customization</li>
              </ul>
            </div>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-warning btn-lg px-5"
              onClick={onViewPlans || onSubscribe}
            >
              <i className="bi bi-star-fill me-2"></i>
              View Subscription Plans
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionPopupModal;

