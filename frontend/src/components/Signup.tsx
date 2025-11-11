import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from './Layout';

const Signup: React.FC = () => {
  const [mobile, setMobile] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [appKey, setAppKey] = useState<string>('');
  const [appSecret, setAppSecret] = useState<string>('');
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);

    try {
      const response = await fetch('http://localhost:8000/api/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ mobile, email, app_key: appKey, app_secret: appSecret }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: data.message || 'Signup successful! Please login.' });
        if (data.redirect) {
          navigate(data.redirect, { state: { email } });
        } else {
          navigate('/login'); // Fallback if no redirect is provided
        }
      } else {
        setMessage({ type: 'danger', text: data.message || 'Signup failed.' });
      }
    } catch (error) {
      console.error('Error during signup:', error);
      setMessage({ type: 'danger', text: 'An error occurred. Please try again.' });
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
              <h3 className="card-title text-center">Sign Up</h3>
              {message && (
                <div className={`alert alert-${message.type}`}>
                  {message.text}
                </div>
              )}
              <form onSubmit={handleSubmit}>
                <div className="form-group mb-3">
                  <label htmlFor="mobile">Mobile Number</label>
                  <input
                    type="text"
                    className="form-control"
                    id="mobile"
                    name="mobile"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group mb-3">
                  <label htmlFor="email">Email Address</label>
                  <input
                    type="email"
                    className="form-control"
                    id="email"
                    name="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group mb-3">
                  <label htmlFor="app_key">API Key</label>
                  <input
                    type="text"
                    className="form-control"
                    id="app_key"
                    name="app_key"
                    value={appKey}
                    onChange={(e) => setAppKey(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group mb-3">
                  <label htmlFor="app_secret">API Secret</label>
                  <input
                    type="text"
                    className="form-control"
                    id="app_secret"
                    name="app_secret"
                    value={appSecret}
                    onChange={(e) => setAppSecret(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-block w-100">Sign Up</button>
              </form>
              <div className="text-center mt-3">
                <Link to="/login">Already have an account? Login</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Signup;
