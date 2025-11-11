import React from 'react';
import LegalLayout from './LegalLayout';

const ShippingPolicyPage: React.FC = () => (
  <LegalLayout title="Shipping & Delivery Policy" lastUpdated="Nov 12 2025">
    <p>
      For international buyers, orders are shipped and delivered through registered international courier
      companies and/or International Speed Post only. For domestic buyers, orders are shipped through
      registered domestic courier companies and/or Speed Post only.
    </p>
    <p>
      Orders are shipped within 0-7 days or as per the delivery date agreed at the time of order confirmation.
      Shipping and delivery timelines remain subject to courier company / post office norms. DRPINFOTECH PRIVATE
      LIMITED is not liable for any delay in delivery by the courier company / postal authorities and only
      guarantees to hand over the consignment to the courier company or postal authorities within 0-7 days from
      the date of order and payment, or as per the delivery date agreed at order confirmation.
    </p>
    <p>
      Delivery of all orders will be to the address provided by the buyer. Delivery of our services will be
      confirmed on your email ID as specified during registration. For any issues in utilising our services you
      may contact our helpdesk on{' '}
      <a className="text-white" href="tel:+918249363019">
        8249363019
      </a>{' '}
      or{' '}
      <a className="text-white" href="mailto:contact@drpinfotech.com">
        contact@drpinfotech.com
      </a>
      .
    </p>
  </LegalLayout>
);

export default ShippingPolicyPage;

