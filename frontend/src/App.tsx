import React from 'react';
import { Navigate } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

const App: React.FC = () => {
  // Redirect root path to login page
  return <Navigate to="/login" replace />;
};

export default App;
