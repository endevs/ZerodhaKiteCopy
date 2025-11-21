import React, { useState, useEffect } from 'react';
import { apiUrl } from '../config/api';

interface UserProfile {
  user_name: string;
  email: string;
  mobile?: string;
  kite_client_id?: string;
  account_balance: number;
}

interface SubscriptionInfo {
  has_subscription: boolean;
  plan_type: string;
  plan_name: string;
  status: string;
  start_date?: string;
  end_date?: string;
  trial_end_date?: string;
  trial_days_remaining: number;
  days_remaining?: number;
  auto_renew?: boolean;
}

interface ProfileContentProps {
  onSubscribeClick?: () => void;
}

const ProfileContent: React.FC<ProfileContentProps> = ({ onSubscribeClick }) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch user data from API (includes balance and kite_client_id)
      const userDataResponse = await fetch(apiUrl('/api/user-data'), {
        credentials: 'include'
      });
      
      const userData = await userDataResponse.json();
      
      // Fetch additional user details from database (email and mobile)
      const userDetailsResponse = await fetch(apiUrl('/api/user/profile'), {
        credentials: 'include'
      });
      
      const userDetails = await userDetailsResponse.json();
      
      // Fetch subscription information
      const subscriptionResponse = await fetch(apiUrl('/api/subscription/info'), {
        credentials: 'include'
      });
      
      let subscriptionData: SubscriptionInfo | null = null;
      if (subscriptionResponse.ok) {
        const subData = await subscriptionResponse.json();
        if (subData.status === 'success' && subData.subscription) {
          subscriptionData = subData.subscription;
        }
      }
      
      if (userDataResponse.ok && userData.status === 'success' && 
          userDetailsResponse.ok && userDetails.status === 'success') {
        setProfile({
          user_name: userData.user_name || 'Guest',
          email: userDetails.email || 'N/A',
          mobile: userDetails.mobile || 'N/A',
          kite_client_id: userData.kite_client_id || 'N/A',
          account_balance: userData.balance || 0
        });
        setSubscription(subscriptionData);
      } else {
        // If one API fails, still try to show what we can
        const errorMsg = userData.message || userDetails.message || 'Failed to load profile';
        setError(errorMsg);
        
        // Set partial profile if we have some data
        if (userDataResponse.ok && userData.status === 'success') {
          setProfile({
            user_name: userData.user_name || 'Guest',
            email: userDetails.email || 'N/A',
            mobile: userDetails.mobile || 'N/A',
            kite_client_id: userData.kite_client_id || 'N/A',
            account_balance: userData.balance || 0
          });
          setSubscription(subscriptionData);
        }
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
      setError('Failed to load profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="container mt-4">
        <div className="row justify-content-center">
          <div className="col-md-8">
            <div className="card">
              <div className="card-body text-center py-5">
                <div className="spinner-border text-primary" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
                <p className="mt-3 text-muted">Loading profile...</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mt-4">
        <div className="row justify-content-center">
          <div className="col-md-8">
            <div className="alert alert-danger">
              <i className="bi bi-exclamation-triangle me-2"></i>
              {error}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mt-4">
      <div className="row justify-content-center">
        <div className="col-md-8">
          <div className="card shadow-sm">
            <div className="card-header bg-primary text-white">
              <h4 className="mb-0">
                <i className="bi bi-person-circle me-2"></i>
                User Profile
              </h4>
            </div>
            <div className="card-body">
              <div className="row mb-4">
                <div className="col-12 text-center">
                  <div className="mb-3">
                    <i className="bi bi-person-circle" style={{ fontSize: '4rem', color: '#0d6efd' }}></i>
                  </div>
                  <h3 className="mb-0">{profile?.user_name || 'Guest'}</h3>
                </div>
              </div>

              <hr />

              <div className="row mb-3">
                <div className="col-md-4">
                  <label className="form-label fw-semibold text-muted">
                    <i className="bi bi-person me-2"></i>
                    Full Name
                  </label>
                </div>
                <div className="col-md-8">
                  <input
                    type="text"
                    className="form-control"
                    value={profile?.user_name || 'N/A'}
                    readOnly
                    style={{ backgroundColor: '#f8f9fa' }}
                  />
                </div>
              </div>

              <div className="row mb-3">
                <div className="col-md-4">
                  <label className="form-label fw-semibold text-muted">
                    <i className="bi bi-envelope me-2"></i>
                    Email Address
                  </label>
                </div>
                <div className="col-md-8">
                  <input
                    type="email"
                    className="form-control"
                    value={profile?.email || 'N/A'}
                    readOnly
                    style={{ backgroundColor: '#f8f9fa' }}
                  />
                </div>
              </div>

              <div className="row mb-3">
                <div className="col-md-4">
                  <label className="form-label fw-semibold text-muted">
                    <i className="bi bi-telephone me-2"></i>
                    Mobile Number
                  </label>
                </div>
                <div className="col-md-8">
                  <input
                    type="tel"
                    className="form-control"
                    value={profile?.mobile || 'N/A'}
                    readOnly
                    style={{ backgroundColor: '#f8f9fa' }}
                  />
                </div>
              </div>

              <div className="row mb-3">
                <div className="col-md-4">
                  <label className="form-label fw-semibold text-muted">
                    <i className="bi bi-briefcase me-2"></i>
                    Zerodha Client ID
                  </label>
                </div>
                <div className="col-md-8">
                  <input
                    type="text"
                    className="form-control"
                    value={profile?.kite_client_id || 'N/A'}
                    readOnly
                    style={{ backgroundColor: '#f8f9fa' }}
                  />
                </div>
              </div>

              <div className="row mb-3">
                <div className="col-md-4">
                  <label className="form-label fw-semibold text-muted">
                    <i className="bi bi-wallet2 me-2"></i>
                    Account Balance
                  </label>
                </div>
                <div className="col-md-8">
                  <input
                    type="text"
                    className="form-control fw-bold"
                    value={profile?.account_balance ? formatCurrency(profile.account_balance) : '₹0.00'}
                    readOnly
                    style={{ backgroundColor: '#f8f9fa', color: profile?.account_balance && profile.account_balance > 0 ? '#198754' : '#6c757d' }}
                  />
                </div>
              </div>

              <hr />

              {/* Subscription Section */}
              {subscription && subscription.has_subscription ? (
                <div className="mb-4">
                  <h5 className="mb-3">
                    <i className="bi bi-credit-card me-2"></i>
                    Subscription Details
                  </h5>
                  
                  <div className="row mb-3">
                    <div className="col-md-4">
                      <label className="form-label fw-semibold text-muted">
                        <i className="bi bi-tag me-2"></i>
                        Plan
                      </label>
                    </div>
                    <div className="col-md-8">
                      <span className={`badge ${
                        subscription.plan_type === 'super_premium' ? 'bg-success' :
                        subscription.plan_type === 'premium' ? 'bg-primary' : 'bg-secondary'
                      } fs-6`}>
                        {subscription.plan_name}
                      </span>
                    </div>
                  </div>

                  <div className="row mb-3">
                    <div className="col-md-4">
                      <label className="form-label fw-semibold text-muted">
                        <i className="bi bi-info-circle me-2"></i>
                        Status
                      </label>
                    </div>
                    <div className="col-md-8">
                      <span className={`badge ${
                        subscription.status === 'active' ? 'bg-success' :
                        subscription.status === 'trial' ? 'bg-info' : 'bg-secondary'
                      }`}>
                        {subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}
                      </span>
                    </div>
                  </div>

                  {subscription.start_date && (
                    <div className="row mb-3">
                      <div className="col-md-4">
                        <label className="form-label fw-semibold text-muted">
                          <i className="bi bi-calendar-check me-2"></i>
                          Start Date
                        </label>
                      </div>
                      <div className="col-md-8">
                        <input
                          type="text"
                          className="form-control"
                          value={new Date(subscription.start_date).toLocaleDateString('en-IN', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                          readOnly
                          style={{ backgroundColor: '#f8f9fa' }}
                        />
                      </div>
                    </div>
                  )}

                  {subscription.end_date && (
                    <div className="row mb-3">
                      <div className="col-md-4">
                        <label className="form-label fw-semibold text-muted">
                          <i className="bi bi-calendar-x me-2"></i>
                          Expiry/Renewal Date
                        </label>
                      </div>
                      <div className="col-md-8">
                        <input
                          type="text"
                          className="form-control"
                          value={new Date(subscription.end_date).toLocaleDateString('en-IN', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                          readOnly
                          style={{ backgroundColor: '#f8f9fa' }}
                        />
                        {subscription.days_remaining !== undefined && subscription.days_remaining !== null && (
                          <small className="text-muted">
                            {subscription.days_remaining > 0 
                              ? `${subscription.days_remaining} days remaining`
                              : 'Expired'}
                          </small>
                        )}
                      </div>
                    </div>
                  )}

                  {subscription.trial_end_date && subscription.plan_type === 'freemium' && (
                    <div className="row mb-3">
                      <div className="col-md-4">
                        <label className="form-label fw-semibold text-muted">
                          <i className="bi bi-hourglass-split me-2"></i>
                          Trial End Date
                        </label>
                      </div>
                      <div className="col-md-8">
                        <input
                          type="text"
                          className="form-control"
                          value={new Date(subscription.trial_end_date).toLocaleDateString('en-IN', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                          readOnly
                          style={{ backgroundColor: '#f8f9fa' }}
                        />
                        {subscription.trial_days_remaining > 0 && (
                          <small className="text-info">
                            {subscription.trial_days_remaining} days of trial remaining
                          </small>
                        )}
                      </div>
                    </div>
                  )}

                  {subscription.auto_renew && (
                    <div className="alert alert-success mt-3 mb-0">
                      <i className="bi bi-arrow-repeat me-2"></i>
                      <small>Auto-renewal is enabled</small>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mb-4">
                  <div className="alert alert-warning">
                    <h6 className="alert-heading">
                      <i className="bi bi-exclamation-triangle me-2"></i>
                      No Active Subscription
                    </h6>
                    <p className="mb-3">You don't have an active subscription. Subscribe now to unlock premium features!</p>
                    {onSubscribeClick && (
                      <button
                        className="btn btn-primary"
                        onClick={onSubscribeClick}
                      >
                        <i className="bi bi-credit-card me-2"></i>
                        Subscribe Now
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="alert alert-info mt-4 mb-0">
                <i className="bi bi-info-circle me-2"></i>
                <small>All fields are read-only. Contact support to update your information.</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileContent;

