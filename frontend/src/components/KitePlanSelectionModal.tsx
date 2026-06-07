import React, { useState } from 'react';
import { apiUrl } from '../config/api';

interface KitePlanSelectionModalProps {
  onComplete: () => void;
}

const KitePlanSelectionModal: React.FC<KitePlanSelectionModalProps> = ({ onComplete }) => {
  const [plan, setPlan] = useState<'connect' | 'personal'>('connect');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(apiUrl('/api/user-credentials/plan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kite_developer_plan: plan }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to save plan type');
      }
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save plan type');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal d-block"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      tabIndex={-1}
    >
      <div className="modal-dialog modal-dialog-centered modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Select your Kite developer app type</h5>
          </div>
          <div className="modal-body">
            <p className="text-muted small">
              This matches the app type in your{' '}
              <a
                href="https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/how-do-i-sign-up-for-kite-connect"
                target="_blank"
                rel="noopener noreferrer"
              >
                Zerodha developer console
              </a>
              .
            </p>
            <div className="row g-3">
              <div className="col-md-6">
                <label
                  className={`card h-100 p-3 ${plan === 'connect' ? 'border-primary' : ''}`}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="radio"
                      name="kitePlanModal"
                      checked={plan === 'connect'}
                      onChange={() => setPlan('connect')}
                    />
                    <span className="form-check-label fw-semibold ms-1">Connect</span>
                  </div>
                  <ul className="small text-muted mb-0 mt-2 ps-3">
                    <li>Historical chart data APIs</li>
                    <li>Live market quotes and WebSockets</li>
                    <li>Full platform data on your API key</li>
                  </ul>
                </label>
              </div>
              <div className="col-md-6">
                <label
                  className={`card h-100 p-3 ${plan === 'personal' ? 'border-primary' : ''}`}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="radio"
                      name="kitePlanModal"
                      checked={plan === 'personal'}
                      onChange={() => setPlan('personal')}
                    />
                    <span className="form-check-label fw-semibold ms-1">Personal</span>
                  </div>
                  <ul className="small text-muted mb-0 mt-2 ps-3">
                    <li>Investing, trading, and reports APIs</li>
                    <li>No historical/live data on your key</li>
                    <li>Options/charts use platform shared feed</li>
                    <li>Position tab uses your Zerodha account</li>
                  </ul>
                </label>
              </div>
            </div>
            {error && <div className="alert alert-danger mt-3 mb-0 py-2 small">{error}</div>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default KitePlanSelectionModal;
