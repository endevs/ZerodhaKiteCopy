import React from 'react';
import { Navigate } from 'react-router-dom';
import './App.css';
import 'bootstrap/dist/css/bootstrap.min.css';

function App() {
  // For now, redirect to login page. In a real app, you'd check authentication status.
  return <Navigate to="/login" />;
}

export default App;
