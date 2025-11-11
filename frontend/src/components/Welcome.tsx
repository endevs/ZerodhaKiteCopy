import React, { useEffect, useState } from 'react';
import Layout from './Layout';

const Welcome: React.FC = () => {
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);

  // In a real application, you would fetch messages from a context or API
  useEffect(() => {
    // Placeholder for fetching flashed messages
    // For now, let's simulate a success message after login
    const params = new URLSearchParams(window.location.search);
    const loginSuccess = params.get('loginSuccess');
    if (loginSuccess === 'true') {
      setMessage({ type: 'success', text: 'You have successfully logged in.' });
    }
  }, []);

  const handleLogout = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/logout', { method: 'POST', credentials: 'include' });
      const data = await response.json();
      if (response.ok) {
        // Redirect to login page after successful logout
        window.location.href = '/login';
      } else {
        setMessage({ type: 'danger', text: data.message || 'Logout failed.' });
        // Still redirect to login on failure
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
      }
    } catch (error) {
      console.error('Error during logout:', error);
      setMessage({ type: 'danger', text: 'An error occurred during logout.' });
      // Redirect to login even on error
      setTimeout(() => {
        window.location.href = '/login';
      }, 2000);
    }
  };

  return (
    <Layout>
      <div className="row justify-content-center">
        <div className="col-md-6">
          <div className="card mt-5">
            <div className="card-body">
              <h3 className="card-title text-center">Welcome!</h3>
              {message && (
                <div className={`alert alert-${message.type}`}>
                  {message.text}
                </div>
              )}
              <p className="text-center">You have successfully logged in.</p>
              <div className="text-center mt-4">
                <a href="/api/zerodha_login" className="btn btn-primary">Login with Zerodha</a>
              </div>
              <div className="text-center mt-3">
                <button onClick={handleLogout} className="btn btn-secondary">Logout</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Welcome;
