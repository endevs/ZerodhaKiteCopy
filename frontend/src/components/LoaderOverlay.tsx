import React from 'react';

interface LoaderOverlayProps {
  visible: boolean;
  message?: string;
}

const LoaderOverlay: React.FC<LoaderOverlayProps> = ({ visible, message }) => {
  if (!visible) return null;

  return (
    <div className="loader-overlay">
      <div className="loader-backdrop" />
      <div className="loader-content text-center text-white">
        <div className="spinner-border text-light mb-3" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <p className="mb-0">{message || 'Processing...'}</p>
      </div>
    </div>
  );
};

export default LoaderOverlay;

