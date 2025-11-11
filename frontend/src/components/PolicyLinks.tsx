import React from 'react';
import { Link } from 'react-router-dom';

const PolicyLinks: React.FC = () => (
  <div className="policy-links">
    <Link to="/legal/contact">Contact us</Link>
    <span>•</span>
    <Link to="/legal/privacy-policy">Privacy Policy</Link>
    <span>•</span>
    <Link to="/legal/cancellation-policy">Cancellation &amp; Refund Policy</Link>
    <span>•</span>
    <Link to="/legal/shipping-policy">Shipping &amp; Delivery Policy</Link>
    <span>•</span>
    <Link to="/legal/terms">Terms &amp; Conditions</Link>
  </div>
);

export default PolicyLinks;

