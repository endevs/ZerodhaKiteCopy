import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import './index.css';
import DrpWelcome from './components/DrpWelcome';
import OpenBookPage from './components/OpenBookPage';
import LandingPage from './components/LandingPage';
import Login from './components/Login';
import Signup from './components/Signup';
import Welcome from './components/Welcome';
import Dashboard from './components/Dashboard';
import VerifyOtp from './components/VerifyOtp';
import ProtectedRoute from './components/ProtectedRoute';
import ContactPage from './components/legal/ContactPage';
import PrivacyPolicyPage from './components/legal/PrivacyPolicyPage';
import OpenBookPrivacyPolicyPage from './components/legal/OpenBookPrivacyPolicyPage';
import CancellationPolicyPage from './components/legal/CancellationPolicyPage';
import ShippingPolicyPage from './components/legal/ShippingPolicyPage';
import TermsPage from './components/legal/TermsPage';
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DrpWelcome />} />
        <Route path="/trading" element={<LandingPage />} />
        <Route path="/openbook" element={<OpenBookPage />} />
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
        <Route path="/legal/contact" element={<ContactPage />} />
        <Route path="/legal/privacy-policy" element={<PrivacyPolicyPage />} />
        <Route path="/legal/openbook-privacy-policy" element={<OpenBookPrivacyPolicyPage />} />
        <Route path="/legal/cancellation-policy" element={<CancellationPolicyPage />} />
        <Route path="/legal/shipping-policy" element={<ShippingPolicyPage />} />
        <Route path="/legal/terms" element={<TermsPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);

reportWebVitals();
