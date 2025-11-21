import React, { useState, useEffect } from 'react';
import { apiUrl } from '../config/api';

declare global {
  interface Window {
    Razorpay: any;
  }
}

interface PlanFeature {
  text: string;
  included: boolean;
}

interface SubscriptionPlan {
  id: string;
  name: string;
  price: string;
  priceNote?: string;
  description: string;
  features: PlanFeature[];
  popular?: boolean;
  buttonText: string;
  buttonVariant: string;
}

const SubscribeContent: React.FC = () => {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [showCustomization, setShowCustomization] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [planPrices, setPlanPrices] = useState<{[key: string]: number}>({
    premium: 1499.0,
    super_premium: 3499.0,
    customization: 4899.0
  });

  useEffect(() => {
    // Fetch plan prices from backend
    const fetchPlanPrices = async () => {
      try {
        const response = await fetch(apiUrl('/api/plan-prices'), {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          if (data.status === 'success' && data.prices) {
            setPlanPrices(data.prices);
          }
        }
      } catch (err) {
        console.error('Error fetching plan prices:', err);
        // Use default prices on error
      }
    };
    fetchPlanPrices();
  }, []);

  const plans: SubscriptionPlan[] = [
    {
      id: 'freemium',
      name: 'Freemium',
      price: 'Free',
      priceNote: '*7 days trial',
      description: 'Perfect for getting started with algorithmic trading',
      features: [
        { text: 'Using AI to generate strategies', included: true },
        { text: 'Paper trading (simulated trading)', included: true },
        { text: 'Backtest up to 1 month of historical data', included: true },
        { text: 'Talk with experts to review your strategy', included: true },
        { text: 'Basic strategy templates', included: true },
        { text: 'Community support', included: true },
      ],
      buttonText: 'Get Started Free',
      buttonVariant: 'outline-primary',
    },
    {
      id: 'premium',
      name: 'Premium',
      price: `₹${planPrices.premium?.toFixed(2) || '1,499.00'}`,
      priceNote: 'per month',
      description: 'Advanced features for serious traders',
      popular: true,
      features: [
        { text: 'All Freemium features', included: true },
        { text: 'Talk with expert and customize your strategy', included: true },
        { text: 'Deploy strategies to live market', included: true },
        { text: 'Strategy optimization tools', included: true },
        { text: 'All AI/ML features', included: true },
        { text: 'Extended backtest period (up to 1 year)', included: true },
        { text: 'Priority expert support', included: true },
        { text: 'Advanced analytics and reporting', included: true },
      ],
      buttonText: 'Subscribe Now',
      buttonVariant: 'primary',
    },
    {
      id: 'super-premium',
      name: 'Super Premium',
      price: `₹${planPrices.super_premium?.toFixed(2) || '3,499.00'}`,
      priceNote: 'per month',
      description: 'Complete solution with AI/ML customization',
      features: [
        { text: 'All Freemium features', included: true },
        { text: 'All Premium features', included: true },
        { text: 'AI/ML on top of customized strategy build', included: true },
        { text: 'Advanced machine learning models', included: true },
        { text: 'Reinforcement learning optimization', included: true },
        { text: 'Unlimited backtest period', included: true },
        { text: 'Dedicated account manager', included: true },
        { text: 'Custom strategy development', included: true },
        { text: '24/7 priority support', included: true },
        { text: 'Advanced risk management tools', included: true },
      ],
      buttonText: 'Subscribe Now',
      buttonVariant: 'success',
    },
  ];

  const handleSubscribe = async (planId: string) => {
    if (planId === 'freemium') {
      // Freemium is free, just activate trial
      try {
        setLoading(planId);
        setError(null);
        const response = await fetch(apiUrl('/api/subscription/activate-freemium'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        if (response.ok && data.status === 'success') {
          setSuccess('Free trial activated! You can now use all freemium features.');
          // Refresh page after 2 seconds to show updated subscription
          setTimeout(() => window.location.reload(), 2000);
        } else {
          setError(data.message || 'Failed to activate free trial');
        }
      } catch (err) {
        setError('Failed to activate free trial. Please try again.');
      } finally {
        setLoading(null);
      }
      return;
    }

    // For paid plans, create Razorpay order
    if (!window.Razorpay) {
      setError('Payment gateway not loaded. Please refresh the page.');
      return;
    }

    try {
      setLoading(planId);
      setError(null);
      setSuccess(null);

      // Map frontend plan IDs to backend plan types
      const planTypeMap: { [key: string]: string } = {
        'premium': 'premium',
        'super-premium': 'super_premium',
        'customization': 'customization'
      };
      
      const backendPlanType = planTypeMap[planId] || planId;
      
      // Create order
      const response = await fetch(apiUrl('/api/payment/create-order'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_type: backendPlanType })
      });

      const data = await response.json();
      
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to create payment order');
      }

      const order = data.order;
      
      // Open Razorpay checkout
      const options = {
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: 'DRP Infotech Trading Platform',
        description: `Subscription: ${planId}`,
        order_id: order.id,
        handler: async function (response: any) {
          // Verify payment
          try {
            const verifyResponse = await fetch(apiUrl('/api/payment/verify'), {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature
              })
            });

            const verifyData = await verifyResponse.json();
            
            if (verifyResponse.ok && verifyData.status === 'success') {
              setSuccess('Payment successful! Your subscription has been activated.');
              setReceiptData(verifyData.receipt || null);
              setShowReceipt(true);
              setLoading(null);
              // Don't reload immediately - let user see receipt
            } else {
              setError(verifyData.message || 'Payment verification failed');
              setLoading(null);
            }
          } catch (err) {
            setError('Failed to verify payment. Please contact support.');
            setLoading(null);
          }
        },
        prefill: {
          // You can prefill user details if available
        },
        theme: {
          color: '#0d6efd'
        },
        modal: {
          ondismiss: function() {
            setLoading(null);
            setError('Payment cancelled');
          }
        }
      };

      const razorpay = new window.Razorpay(options);
      razorpay.open();
      razorpay.on('payment.failed', function (response: any) {
        setError(`Payment failed: ${response.error.description || 'Unknown error'}`);
        setLoading(null);
      });
    } catch (err: any) {
      setError(err.message || 'Failed to initiate payment. Please try again.');
      setLoading(null);
    }
  };

  const handleCustomization = async () => {
    // Handle customization plan payment
    if (!window.Razorpay) {
      setError('Payment gateway not loaded. Please refresh the page.');
      return;
    }

    try {
      setLoading('customization');
      setError(null);
      setSuccess(null);

      // Create order for customization
      const response = await fetch(apiUrl('/api/payment/create-order'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_type: 'customization' })
      });

      const data = await response.json();
      
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to create payment order');
      }

      const order = data.order;
      
      // Open Razorpay checkout
      const options = {
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: 'DRP Infotech Trading Platform',
        description: `Strategy Customization (One-time fee: ₹${planPrices.customization?.toFixed(2) || '4,899.00'})`,
        order_id: order.id,
        handler: async function (response: any) {
          // Verify payment
          try {
            const verifyResponse = await fetch(apiUrl('/api/payment/verify'), {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature
              })
            });

            const verifyData = await verifyResponse.json();
            
            if (verifyResponse.ok && verifyData.status === 'success') {
              setSuccess('Payment successful! Your customization request has been submitted.');
              setReceiptData(verifyData.receipt || null);
              setShowReceipt(true);
              setLoading(null);
            } else {
              setError(verifyData.message || 'Payment verification failed');
              setLoading(null);
            }
          } catch (err) {
            setError('Failed to verify payment. Please contact support.');
            setLoading(null);
          }
        },
        prefill: {
          name: '',
          email: '',
          contact: ''
        },
        theme: {
          color: '#0d6efd'
        },
        modal: {
          ondismiss: function() {
            setLoading(null);
          }
        }
      };

      const razorpay = new window.Razorpay(options);
      razorpay.on('payment.failed', function (response: any) {
        setError(`Payment failed: ${response.error.description || 'Unknown error'}`);
        setLoading(null);
      });
      
      razorpay.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process customization payment');
      setLoading(null);
    }
  };

  return (
    <div className="container mt-4 mb-5">
      <div className="row">
        <div className="col-12 text-center mb-5">
          <h2 className="display-5 fw-bold mb-3">
            <i className="bi bi-star-fill text-warning me-2"></i>
            Choose Your Plan
          </h2>
          <p className="lead text-muted">
            Select the perfect plan for your trading needs
          </p>
        </div>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="row mb-4">
          <div className="col-12">
            <div className="alert alert-danger alert-dismissible fade show" role="alert">
              <i className="bi bi-exclamation-triangle me-2"></i>
              {error}
              <button type="button" className="btn-close" onClick={() => setError(null)}></button>
            </div>
          </div>
        </div>
      )}

      {success && (
        <div className="row mb-4">
          <div className="col-12">
            <div className="alert alert-success alert-dismissible fade show" role="alert">
              <i className="bi bi-check-circle me-2"></i>
              {success}
              <button type="button" className="btn-close" onClick={() => setSuccess(null)}></button>
            </div>
          </div>
        </div>
      )}

      <div className="row g-4 mb-5">
        {plans.map((plan) => (
          <div key={plan.id} className="col-lg-4 col-md-6">
            <div
              className={`card h-100 shadow-sm ${
                plan.popular ? 'border-primary border-3' : ''
              }`}
              style={{
                  transform: plan.popular ? 'scale(1.05)' : 'scale(1)',
                  transition: 'transform 0.3s ease',
                }}
            >
              {plan.popular && (
                <div className="position-absolute top-0 start-50 translate-middle">
                  <span className="badge bg-primary fs-6 px-3 py-2">
                    Most Popular
                  </span>
                </div>
              )}
              <div className="card-body d-flex flex-column p-4">
                <div className="text-center mb-4">
                  <h3 className="card-title fw-bold mb-2">{plan.name}</h3>
                  <div className="mb-2">
                    <span className="display-4 fw-bold text-primary">
                      {plan.price}
                    </span>
                    {plan.priceNote && (
                      <span className="text-muted ms-2 small">{plan.priceNote}</span>
                    )}
                  </div>
                  <p className="text-muted small mb-0">{plan.description}</p>
                </div>

                <hr />

                <ul className="list-unstyled flex-grow-1 mb-4">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="mb-3 d-flex align-items-start">
                      {feature.included ? (
                        <i className="bi bi-check-circle-fill text-success me-2 mt-1"></i>
                      ) : (
                        <i className="bi bi-x-circle text-muted me-2 mt-1"></i>
                      )}
                      <span className={feature.included ? '' : 'text-muted'}>
                        {feature.text}
                      </span>
                    </li>
                  ))}
                </ul>

                <button
                  className={`btn btn-${plan.buttonVariant} btn-lg w-100 mt-auto`}
                  onClick={() => handleSubscribe(plan.id)}
                  disabled={loading === plan.id}
                >
                  {loading === plan.id ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                      Processing...
                    </>
                  ) : (
                    plan.buttonText
                  )}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Strategy Customization Section */}
      <div className="row mt-5">
        <div className="col-12">
          <div className="card border-warning shadow">
            <div className="card-body p-4">
              <div className="row align-items-center">
                <div className="col-md-8">
                  <h4 className="fw-bold mb-2">
                    <i className="bi bi-tools text-warning me-2"></i>
                    Strategy Customization
                  </h4>
                  <p className="text-muted mb-0">
                    Need a completely custom strategy built specifically for your trading style? 
                    Our experts will work with you to create a personalized trading strategy 
                    tailored to your requirements.
                  </p>
                </div>
                <div className="col-md-4 text-md-end mt-3 mt-md-0">
                  <div className="mb-2">
                    <span className="display-6 fw-bold text-warning">₹{planPrices.customization?.toFixed(2) || '4,899.00'}</span>
                    <span className="text-muted ms-2">one-time</span>
                  </div>
                  <button
                    className="btn btn-warning btn-lg"
                    onClick={handleCustomization}
                    disabled={loading === 'customization'}
                  >
                    {loading === 'customization' ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                        Processing...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-credit-card me-2"></i>
                        Pay & Request Customization
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Comparison Table */}
      <div className="row mt-5">
        <div className="col-12">
          <div className="card shadow">
            <div className="card-header bg-light">
              <h5 className="mb-0">
                <i className="bi bi-list-check me-2"></i>
                Feature Comparison
              </h5>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Feature</th>
                      <th className="text-center">Freemium</th>
                      <th className="text-center">Premium</th>
                      <th className="text-center">Super Premium</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>AI Strategy Generation</td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                    </tr>
                    <tr>
                      <td>Paper Trading</td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                    </tr>
                    <tr>
                      <td>Backtest Period</td>
                      <td className="text-center">1 Month</td>
                      <td className="text-center">1 Year</td>
                      <td className="text-center">Unlimited</td>
                    </tr>
                    <tr>
                      <td>Expert Consultation</td>
                      <td className="text-center">Review Only</td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                    </tr>
                    <tr>
                      <td>Live Market Deployment</td>
                      <td className="text-center">
                        <i className="bi bi-x-circle text-muted"></i>
                      </td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                    </tr>
                    <tr>
                      <td>Strategy Optimization</td>
                      <td className="text-center">
                        <i className="bi bi-x-circle text-muted"></i>
                      </td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                    </tr>
                    <tr>
                      <td>AI/ML Customization</td>
                      <td className="text-center">
                        <i className="bi bi-x-circle text-muted"></i>
                      </td>
                      <td className="text-center">
                        <i className="bi bi-x-circle text-muted"></i>
                      </td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                    </tr>
                    <tr>
                      <td>Reinforcement Learning</td>
                      <td className="text-center">
                        <i className="bi bi-x-circle text-muted"></i>
                      </td>
                      <td className="text-center">
                        <i className="bi bi-x-circle text-muted"></i>
                      </td>
                      <td className="text-center">
                        <i className="bi bi-check-circle-fill text-success"></i>
                      </td>
                    </tr>
                    <tr>
                      <td>Support Level</td>
                      <td className="text-center">Community</td>
                      <td className="text-center">Priority</td>
                      <td className="text-center">24/7 Dedicated</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="row mt-5">
        <div className="col-12">
          <h3 className="text-center mb-4">
            <i className="bi bi-question-circle me-2"></i>
            Frequently Asked Questions
          </h3>
          <div className="accordion" id="faqAccordion">
            <div className="accordion-item">
              <h2 className="accordion-header">
                <button
                  className="accordion-button"
                  type="button"
                  data-bs-toggle="collapse"
                  data-bs-target="#faq1"
                >
                  Can I upgrade or downgrade my plan anytime?
                </button>
              </h2>
              <div id="faq1" className="accordion-collapse collapse show" data-bs-parent="#faqAccordion">
                <div className="accordion-body">
                  Yes, you can upgrade or downgrade your plan at any time. Changes will be reflected in your next billing cycle.
                </div>
              </div>
            </div>
            <div className="accordion-item">
              <h2 className="accordion-header">
                <button
                  className="accordion-button collapsed"
                  type="button"
                  data-bs-toggle="collapse"
                  data-bs-target="#faq2"
                >
                  What payment methods do you accept?
                </button>
              </h2>
              <div id="faq2" className="accordion-collapse collapse" data-bs-parent="#faqAccordion">
                <div className="accordion-body">
                  We accept all major credit cards, debit cards, UPI, and bank transfers.
                </div>
              </div>
            </div>
            <div className="accordion-item">
              <h2 className="accordion-header">
                <button
                  className="accordion-button collapsed"
                  type="button"
                  data-bs-toggle="collapse"
                  data-bs-target="#faq3"
                >
                  Is there a free trial for Premium plans?
                </button>
              </h2>
              <div id="faq3" className="accordion-collapse collapse" data-bs-parent="#faqAccordion">
                <div className="accordion-body">
                  Premium and Super Premium plans come with a 7-day free trial. You can cancel anytime during the trial period.
                </div>
              </div>
            </div>
            <div className="accordion-item">
              <h2 className="accordion-header">
                <button
                  className="accordion-button collapsed"
                  type="button"
                  data-bs-toggle="collapse"
                  data-bs-target="#faq4"
                >
                  What is Strategy Customization?
                </button>
              </h2>
              <div id="faq4" className="accordion-collapse collapse" data-bs-parent="#faqAccordion">
                <div className="accordion-body">
                  Strategy Customization is a one-time service where our expert team works with you to build a completely custom trading strategy tailored to your specific requirements, risk tolerance, and trading style.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Payment Receipt Modal */}
      {showReceipt && receiptData && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex={-1}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header bg-success text-white">
                <h5 className="modal-title">
                  <i className="bi bi-check-circle-fill me-2"></i>
                  Payment Successful!
                </h5>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => {
                    setShowReceipt(false);
                    setTimeout(() => window.location.reload(), 500);
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <div className="text-center mb-4">
                  <p className="lead">Thank you for your subscription!</p>
                  <p>A confirmation email has been sent to your registered email address.</p>
                </div>
                
                <div className="card border-primary">
                  <div className="card-header bg-primary text-white">
                    <h6 className="mb-0">Payment Receipt</h6>
                  </div>
                  <div className="card-body">
                    <table className="table table-sm mb-0">
                      <tbody>
                        <tr>
                          <td><strong>Plan:</strong></td>
                          <td className="text-end">{receiptData.plan_name || 'N/A'}</td>
                        </tr>
                        <tr>
                          <td><strong>Amount Paid:</strong></td>
                          <td className="text-end">₹{receiptData.amount?.toFixed(2) || '0.00'}</td>
                        </tr>
                        <tr>
                          <td><strong>Payment Method:</strong></td>
                          <td className="text-end">{receiptData.payment_method?.toUpperCase() || 'N/A'}</td>
                        </tr>
                        <tr>
                          <td><strong>Payment ID:</strong></td>
                          <td className="text-end">
                            <small className="font-monospace">{receiptData.razorpay_payment_id || 'N/A'}</small>
                          </td>
                        </tr>
                        <tr>
                          <td><strong>Order ID:</strong></td>
                          <td className="text-end">
                            <small className="font-monospace">{receiptData.razorpay_order_id || 'N/A'}</small>
                          </td>
                        </tr>
                        <tr>
                          <td><strong>Transaction Date:</strong></td>
                          <td className="text-end">
                            {receiptData.transaction_date 
                              ? new Date(receiptData.transaction_date).toLocaleString('en-IN', {
                                  dateStyle: 'medium',
                                  timeStyle: 'short'
                                })
                              : 'N/A'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setShowReceipt(false);
                    setTimeout(() => window.location.reload(), 500);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubscribeContent;

