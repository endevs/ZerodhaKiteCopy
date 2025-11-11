import React from 'react';

interface ChartModalProps {
  show: boolean;
  onClose: () => void;
  instrumentToken?: string;
}

const ChartModal: React.FC<ChartModalProps> = ({ show, onClose, instrumentToken }) => {
  if (!show) {
    return null;
  }

  return (
    <div className="modal fade show" style={{ display: 'block' }} tabIndex={-1} role="dialog">
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title" id="chart-modal-label">Tick Data Chart {instrumentToken && `for ${instrumentToken}`}</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
          </div>
          <div className="modal-body">
            <p>Chart will be displayed here for {instrumentToken || 'selected instrument'}.</p>
            {/* Chart rendering logic will go here */}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChartModal;
