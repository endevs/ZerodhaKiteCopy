import React from 'react';
import LegalLayout from './LegalLayout';

const AstroDrpPrivacyPolicyPage: React.FC = () => (
  <LegalLayout title="AstroDRP – Privacy Policy" lastUpdated="May 09 2026">
    <p className="text-white-50 small mb-3">
      App: <strong className="text-white">AstroDRP</strong>
    </p>
    <p>
      This Privacy Policy applies to the <b>AstroDRP</b> mobile application and related services. The app and
      services are operated by <b>Lipsha Mohapatra</b> and <b>DRPINFOTECH PRIVATE LIMITED</b> (DRP Infotech Pvt
      Ltd).
    </p>
    <p>
      We are committed to ensuring that your privacy is protected. Should we ask you to provide certain information
      by which you can be identified when using the app or our website, you can be assured that it will only be used
      in accordance with this privacy statement.
    </p>
    <h5 className="text-white mt-4">Information we may collect</h5>
    <ul className="legal-list">
      <li>Name</li>
      <li>Contact information including email address</li>
      <li>Device and app usage information needed to provide AstroDRP features</li>
      <li>Other information relevant to support requests, service quality, and user experience</li>
    </ul>
    <h5 className="text-white mt-4">How we use the information we gather</h5>
    <ul className="legal-list">
      <li>To operate, maintain, and improve AstroDRP services and user experience.</li>
      <li>To provide customer support, account-related communication, and service updates.</li>
      <li>To improve app quality, reliability, and feature performance over time.</li>
      <li>To comply with applicable legal and regulatory obligations.</li>
    </ul>
    <p>
      We are committed to ensuring that your information is secure. In order to prevent unauthorised access or
      disclosure we have put in place suitable physical, electronic, and managerial procedures to safeguard and
      secure the information we collect.
    </p>
    <h5 className="text-white mt-4">Cookies and similar technologies</h5>
    <p>
      Our website and connected services may use cookies or similar technologies for analytics, performance, and
      improving user experience. You can choose to accept or decline cookies through your browser settings.
    </p>
    <h5 className="text-white mt-4">Controlling your personal information</h5>
    <p>
      We do not sell, distribute, or lease your personal information to third parties unless we have your permission
      or are required by law to do so.
    </p>
    <p>
      You may request details of personal information we hold about you and request correction or deletion where
      applicable by contacting us at{' '}
      <a className="text-white" href="mailto:contact@drpinfotech.com">
        contact@drpinfotech.com
      </a>
      .
    </p>
  </LegalLayout>
);

export default AstroDrpPrivacyPolicyPage;

