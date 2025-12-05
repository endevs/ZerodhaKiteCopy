import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { apiUrl } from './config/api';
import LandingPage from './components/LandingPage';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const checkAuthentication = async () => {
      try {
        const response = await fetch(apiUrl('/api/user-data'), {
          credentials: 'include',
        });
        
        if (response.ok) {
          const data = await response.json();
          // Check if user is authenticated
          const isAuth = data.authenticated === true || (data.user_id !== undefined && data.user_id !== null);
          console.log('[App] Authentication check:', { authenticated: isAuth, data });
          setIsAuthenticated(isAuth);
        } else {
          console.log('[App] Authentication check failed:', response.status);
          setIsAuthenticated(false);
        }
      } catch (error) {
        console.error('[App] Error checking authentication:', error);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuthentication();
  }, []);

  if (isLoading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  // If authenticated, redirect to dashboard; otherwise, show landing page at root
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  // Render LandingPage component at root path (URL stays as /)
  return <LandingPage />;
};

export default App;
