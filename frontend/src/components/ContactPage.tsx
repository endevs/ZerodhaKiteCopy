import React from 'react';
import PolicyPlaceholder from './legal/PolicyPlaceholder';

const ContactPage: React.FC = () => (
  <PolicyPlaceholder title="Contact us" lastUpdated="Nov 12 2025">
    <p className="text-white-50">You may contact us using the information below:</p>

    <h5 className="text-white mt-4">Merchant Details</h5>
    <p className="text-white-50 mb-1"><strong>Legal entity name:</strong> DRPINFOTECH PRIVATE LIMITED</p>
    <p className="text-white-50 mb-1">
      <strong>Registered Address:</strong> TS Homes Ratnakar Bagh Tankapani Road Bhubaneswar Khorda Orissa 751014 India Bhubaneswar Court ODISHA 751014
    </p>
    <p className="text-white-50 mb-4">
      <strong>Operational Address:</strong> TS Homes Ratnakar Bagh Tankapani Road Bhubaneswar Khorda Orissa 751014 India Bhubaneswar Court ODISHA 751014
    </p>

    <h5 className="text-white">Communication</h5>
    <p className="text-white-50 mb-1"><strong>Telephone:</strong> <a className="text-white" href="tel:+918249363019">8249363019</a></p>
    <p className="text-white-50"><strong>Email:</strong> <a className="text-white" href="mailto:contact@drpinfotech.com">contact@drpinfotech.com</a></p>
  </PolicyPlaceholder>
);

export default ContactPage;

