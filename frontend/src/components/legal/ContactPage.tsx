import React from 'react';
import LegalLayout from './LegalLayout';

const ContactPage: React.FC = () => (
  <LegalLayout title="Contact us" lastUpdated="Nov 12 2025">
    <p className="mb-4">
      You may contact us using the information below:
    </p>
    <h5 className="text-white mt-4">Merchant Details</h5>
    <p className="mb-1">
      <strong>Legal entity name:</strong> DRPINFOTECH PRIVATE LIMITED
    </p>
    <p className="mb-1">
      <strong>Registered Address:</strong> TS Homes Ratnakar Bagh Tankapani Road Bhubaneswar Khorda Orissa 751014
      India Bhubaneswar Court ODISHA 751014
    </p>
    <p className="mb-4">
      <strong>Operational Address:</strong> TS Homes Ratnakar Bagh Tankapani Road Bhubaneswar Khorda Orissa 751014
      India Bhubaneswar Court ODISHA 751014
    </p>
    <h5 className="text-white">Communication</h5>
    <p className="mb-1">
      <strong>Telephone:</strong>{' '}
      <a className="text-white" href="tel:+918249363019">
        8249363019
      </a>
    </p>
    <p className="mb-0">
      <strong>Email:</strong>{' '}
      <a className="text-white" href="mailto:contact@drpinfotech.com">
        contact@drpinfotech.com
      </a>
    </p>
  </LegalLayout>
);

export default ContactPage;





