import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from './Layout';

const Login: React.FC = () => {
  const [email, setEmail] = useState<string>('');
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);

    try {
      const response = await fetch('http://localhost:8000/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });

      console.log('Raw response:', response);
      console.log('Response Status:', response.status);
      console.log('Response Status Text:', response.statusText);

      if (!response.ok) {
        // If response is not OK, try to parse JSON error, otherwise use status text
        let errorData;
        try {
          errorData = await response.json();
        } catch (jsonError) {
          errorData = { message: `Server error: ${response.statusText}` };
        }
        setMessage({ type: 'danger', text: errorData.message || 'Login failed.' });
        console.error('Login failed:', errorData);
        return;
      }

      const data = await response.json();
      console.log('Parsed data:', data); // Log the parsed data

      if (data.status === 'success') {
        setMessage({ type: 'success', text: data.message || 'OTP sent successfully!' });
        if (data.redirect) {
          navigate(data.redirect, { state: { email } });
        } else {
          navigate('/verify-otp', { state: { email } }); // Fallback if no redirect is provided
        }
      } else {
        // This case should ideally be caught by !response.ok, but as a fallback
        setMessage({ type: 'danger', text: data.message || 'Login failed.' });
        console.error('Login failed with success status false:', data);
      }
    } catch (error) {
      console.error('Error during login:', error);
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
              <h3 className="card-title text-center">Login</h3>
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
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary btn-block w-100">Login with OTP</button>
              </form>
              <div className="text-center mt-3">
                <Link to="/signup">Don't have an account? Sign Up</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Login;
