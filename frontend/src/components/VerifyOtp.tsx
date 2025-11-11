import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Layout from './Layout';

const VerifyOtp: React.FC = () => {
  const [otp, setOtp] = useState<string>('');
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email || '';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);

    try {
      const response = await fetch('http://localhost:8000/api/verify_otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email, otp }),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.status === 'success') {
          setMessage({ type: 'success', text: data.message || 'OTP verified successfully!' });
          if (data.redirect) {
            // Extract path from full URL if needed, or use directly if it's already a path
            let redirectPath = data.redirect;
            try {
              const url = new URL(data.redirect);
              redirectPath = url.pathname + url.search;
            } catch {
              // If it's already a path (starts with /), use it directly
              if (!data.redirect.startsWith('http')) {
                redirectPath = data.redirect;
              }
            }
            navigate(redirectPath);
          } else {
            navigate('/welcome'); // Fallback if no redirect is provided
          }
        } else {
          setMessage({ type: 'danger', text: data.message || 'OTP verification failed.' });
        }
      } else {
        setMessage({ type: 'danger', text: data.message || 'OTP verification failed.' });
      }
    } catch (error) {
      console.error('Error during OTP verification:', error);
      setMessage({ type: 'danger', text: 'An unexpected error occurred. Please try again.' });
    }
  };

  return (
    <Layout>
      <div className="position-absolute top-0 start-0 m-3" style={{ zIndex: 1000 }}>
        <a 
          href="https://drpinfotech.com" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-decoration-none"
        >
          <img 
            src="/drp-infotech-logo.png" 
            alt="DRP Infotech Pvt Ltd Logo" 
            style={{ 
              height: '50px', 
              width: 'auto',
              objectFit: 'contain'
            }}
            onError={(e) => {
              // Fallback to text if image fails to load
              e.currentTarget.style.display = 'none';
              const fallback = document.createElement('span');
              fallback.className = 'fs-5 fw-bold text-dark';
              fallback.textContent = 'DRP Infotech Pvt Ltd';
              e.currentTarget.parentElement?.appendChild(fallback);
            }}
          />
        </a>
      </div>
      <div className="row justify-content-center">
        <div className="col-md-6">
          <div className="card mt-5">
            <div className="card-body">
              <h3 className="card-title text-center">Verify OTP</h3>
              {message && (
                <div className={`alert alert-${message.type}`}>
                  {message.text}
                </div>
              )}
              <form onSubmit={handleSubmit}>
                <div className="form-group mb-3">
                  <label htmlFor="email">Email Address</label>
                  <input
                    type="email"
                    className="form-control"
                    id="email"
                    name="email"
                    value={email}
                    readOnly
                  />
                </div>
                <div className="form-group mb-3">
                  <label htmlFor="otp">OTP</label>
                  <input
                    type="text"
                    className="form-control"
                    id="otp"
                    name="otp"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-block w-100">Verify</button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default VerifyOtp;
