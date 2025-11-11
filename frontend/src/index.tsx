import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import App from './App';
import Login from './components/Login';
import Signup from './components/Signup';
import Welcome from './components/Welcome';
import Dashboard from './components/Dashboard';
import VerifyOtp from './components/VerifyOtp';
import ProtectedRoute from './components/ProtectedRoute';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/verify-otp" element={<VerifyOtp />} />
        <Route 
          path="/welcome" 
          element={
            <ProtectedRoute>
              <Welcome />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
        {/* Add other protected routes here as needed */}
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

reportWebVitals();
