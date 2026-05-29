import React, { useState, useEffect } from 'react';
import { apiUrl } from '../config/api';

interface Invoice {
  payment_id: number;
  invoice_number: string;
  amount: number;
  plan_type: string;
  transaction_date: string;
  user_name: string;
  user_email: string;
}

const InvoiceSection: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState<number | null>(null);

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const response = await fetch(apiUrl('/api/invoice/list'), {
        credentials: 'include',
      });
      const data = await response.json();
      if (data.status === 'success') {
        setInvoices(data.invoices || []);
      }
    } catch (error) {
      console.error('Error fetching invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResendInvoice = async (paymentId: number) => {
    try {
      setResending(paymentId);
      const response = await fetch(apiUrl(`/api/invoice/resend/${paymentId}`), {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (data.status === 'success') {
        alert('Invoice email sent successfully!');
      } else {
        alert(`Error: ${data.message || 'Failed to resend invoice'}`);
      }
    } catch (error) {
      alert('Error resending invoice. Please try again.');
      console.error('Error resending invoice:', error);
    } finally {
      setResending(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-3">
        <div className="spinner-border spinner-border-sm" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <div className="alert alert-info mb-0">
        <i className="bi bi-info-circle me-2"></i>
        No invoices found. Invoices will appear here after successful payments.
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="table table-hover">
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Date</th>
            <th>Plan</th>
            <th>Amount</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.payment_id}>
              <td>
                <code className="small">{invoice.invoice_number}</code>
              </td>
              <td>
                {invoice.transaction_date
                  ? new Date(invoice.transaction_date).toLocaleDateString('en-IN', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })
                  : 'N/A'}
              </td>
              <td>
                <span className="badge bg-secondary">
                  {invoice.plan_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </span>
              </td>
              <td className="fw-bold">₹{invoice.amount.toFixed(2)}</td>
              <td>
                <div className="btn-group btn-group-sm">
                  <a
                    href={apiUrl(`/api/invoice/download/${invoice.payment_id}`)}
                    className="btn btn-outline-primary"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Download Invoice"
                  >
                    <i className="bi bi-download me-1"></i>
                    Download
                  </a>
                  <button
                    className="btn btn-outline-secondary"
                    onClick={() => handleResendInvoice(invoice.payment_id)}
                    disabled={resending === invoice.payment_id}
                    title="Resend Invoice Email"
                  >
                    {resending === invoice.payment_id ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                        Sending...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-envelope me-1"></i>
                        Resend
                      </>
                    )}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

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

interface CredentialMetadata {
  has_credentials: boolean;
  auto_auth_details_present: boolean;
  missing_fields: string[];
  kite_user_id?: string | null;
  app_key_masked?: string;
  has_app_secret?: boolean;
  has_kite_password?: boolean;
  has_kite_totp_secret?: boolean;
  auto_auth_configured_at?: string | null;
}

interface ScheduleRunRow {
  scheduled_for: string;
  day: string;
  started_at?: string | null;
  finished_at?: string | null;
  status: string;
  reason?: string | null;
  trigger?: string;
  details?: string;
}

interface ScheduleActivity {
  schedule: {
    description: string;
    timezone: string;
    weekdays: string[];
    time: string;
  };
  past_runs: ScheduleRunRow[];
  upcoming_runs: ScheduleRunRow[];
}

interface ProfileContentProps {
  onSubscribeClick?: () => void;
}

const configuredBadge = (configured: boolean) => (
  <span className={`badge ${configured ? 'bg-success' : 'bg-secondary'}`}>
    {configured ? 'Configured' : 'Not set'}
  </span>
);

const scheduleStatusBadgeClass = (status: string): string => {
  switch (status) {
    case 'succeeded':
      return 'bg-success';
    case 'failed':
      return 'bg-danger';
    case 'needs_manual':
      return 'bg-warning text-dark';
    case 'running':
    case 'pending':
      return 'bg-info text-dark';
    case 'skipped':
      return 'bg-secondary';
    default:
      return 'bg-light text-dark border';
  }
};

const formatScheduleDateTime = (iso: string): string => {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });
  } catch {
    return iso;
  }
};

const ProfileContent: React.FC<ProfileContentProps> = ({ onSubscribeClick }) => {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [kiteUserId, setKiteUserId] = useState('');
  const [kitePassword, setKitePassword] = useState('');
  const [kiteTotpSecret, setKiteTotpSecret] = useState('');
  const [credentialMessage, setCredentialMessage] = useState<{ type: 'success' | 'danger' | 'warning'; text: string } | null>(null);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [credentialMeta, setCredentialMeta] = useState<CredentialMetadata | null>(null);
  const [editingCredentials, setEditingCredentials] = useState(false);
  const [scheduleActivity, setScheduleActivity] = useState<ScheduleActivity | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [startingAutoAuth, setStartingAutoAuth] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchCredentialMetadata = async () => {
    try {
      const response = await fetch(apiUrl('/api/user-credentials'), { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      if (data.status === 'success') {
        setCredentialMeta(data);
        if (Array.isArray(data.missing_fields) && data.missing_fields.length > 0) {
          setCredentialMessage({
            type: 'warning',
            text: `Missing fields: ${data.missing_fields.join(', ')}`,
          });
        }
      }
    } catch (credentialsErr) {
      console.error('Error fetching credential metadata:', credentialsErr);
    }
  };

  const fetchScheduleActivity = async () => {
    try {
      setLoadingSchedule(true);
      const response = await fetch(apiUrl('/api/zerodha/auto-auth/schedule-activity'), {
        credentials: 'include',
      });
      if (!response.ok) return;
      const data = await response.json();
      if (data.status === 'success') {
        setScheduleActivity(data);
      }
    } catch (scheduleErr) {
      console.error('Error fetching schedule activity:', scheduleErr);
    } finally {
      setLoadingSchedule(false);
    }
  };

  const fetchProfile = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Helper function to safely parse JSON response
      const parseJsonResponse = async (response: Response) => {
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          console.error('Non-JSON response received:', text.substring(0, 200));
          throw new Error(`Expected JSON but received ${contentType || 'unknown content type'}`);
        }
        return await response.json();
      };
      
      // Fetch user data from API (includes balance and kite_client_id)
      let userData: any = null;
      let userDataResponse: Response | null = null;
      try {
        userDataResponse = await fetch(apiUrl('/api/user-data'), {
          credentials: 'include'
        });
        userData = await parseJsonResponse(userDataResponse);
      } catch (err) {
        console.error('Error fetching user data:', err);
        throw new Error('Failed to fetch user data');
      }
      
      // Fetch additional user details from database (email and mobile)
      let userDetails: any = null;
      let userDetailsResponse: Response | null = null;
      try {
        userDetailsResponse = await fetch(apiUrl('/api/user/profile'), {
          credentials: 'include'
        });
        userDetails = await parseJsonResponse(userDetailsResponse);
      } catch (err) {
        console.error('Error fetching user profile:', err);
        // Continue with partial data if profile fetch fails
        userDetails = { status: 'error', email: 'N/A', mobile: 'N/A' };
      }
      
      // Fetch subscription information
      let subscriptionData: SubscriptionInfo | null = null;
      try {
        const subscriptionResponse = await fetch(apiUrl('/api/subscription/status'), {
          credentials: 'include'
        });
        
        if (subscriptionResponse.ok) {
          const subData = await parseJsonResponse(subscriptionResponse);
          // Transform the response to match SubscriptionInfo interface
          if (subData.status === 'success') {
            subscriptionData = {
              has_subscription: !subData.is_free_user,
              plan_type: subData.plan_type || 'freemium',
              plan_name: subData.plan_type === 'premium' ? 'Premium' : 
                        subData.plan_type === 'super_premium' ? 'Super Premium' : 'Freemium',
              status: 'active',
              trial_days_remaining: 0,
              days_remaining: 0
            };
          }
        }
      } catch (err) {
        console.error('Error fetching subscription:', err);
        // Continue without subscription data if fetch fails
      }
      
      if (userDataResponse && userDataResponse.ok && userData.status === 'success') {
        // Backend now returns email as fallback for user_name, so use it directly
        setProfile({
          user_name: userData.user_name || userDetails?.email || 'Guest',
          email: userDetails?.email || 'N/A',
          mobile: userDetails?.mobile || 'N/A',
          kite_client_id: userData.kite_client_id || 'N/A',
          account_balance: userData.balance || 0
        });
        setSubscription(subscriptionData);
      } else {
        // If API fails, show error
        const errorMsg = userData?.message || userDetails?.message || 'Failed to load profile';
        setError(errorMsg);
      }

      try {
        await fetchCredentialMetadata();
        await fetchScheduleActivity();
      } catch (credentialsErr) {
        console.error('Error fetching credential flags:', credentialsErr);
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

  const handleSaveCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    setCredentialMessage(null);
    setSavingCredentials(true);
    try {
      const response = await fetch(apiUrl('/api/user-credentials'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          app_key: appKey.trim(),
          app_secret: appSecret.trim(),
          kite_user_id: kiteUserId.trim(),
          kite_password: kitePassword.trim(),
          kite_totp_secret: kiteTotpSecret.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to update details.');
      }
      setCredentialMessage({
        type: 'success',
        text: data?.message || 'Details updated successfully.',
      });
      setAppKey('');
      setAppSecret('');
      setKiteUserId('');
      setKitePassword('');
      setKiteTotpSecret('');
      setEditingCredentials(false);
      await fetchCredentialMetadata();
    } catch (saveErr: any) {
      setCredentialMessage({
        type: 'danger',
        text: saveErr?.message || 'Failed to update details.',
      });
    } finally {
      setSavingCredentials(false);
    }
  };

  const handleCancelCredentialEdit = () => {
    setEditingCredentials(false);
    setAppKey('');
    setAppSecret('');
    setKiteUserId('');
    setKitePassword('');
    setKiteTotpSecret('');
    setCredentialMessage(null);
  };

  const handleStartCredentialEdit = () => {
    setEditingCredentials(true);
    setKiteUserId(credentialMeta?.kite_user_id || '');
    setAppKey('');
    setAppSecret('');
    setKitePassword('');
    setKiteTotpSecret('');
    setCredentialMessage(null);
  };

  const handleRunAutoAuthNow = async () => {
    setStartingAutoAuth(true);
    try {
      const response = await fetch(apiUrl('/api/zerodha/auto-auth/start'), {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to start auto authentication.');
      }
      setCredentialMessage({
        type: 'success',
        text: data?.message || 'Automated authentication started.',
      });
      await fetchScheduleActivity();
    } catch (runErr: any) {
      setCredentialMessage({
        type: 'danger',
        text: runErr?.message || 'Failed to start auto authentication.',
      });
    } finally {
      setStartingAutoAuth(false);
    }
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
                  <h3 className="mb-0">{profile?.user_name || profile?.email || 'Guest'}</h3>
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

              {/* Invoice Section */}
              <div className="mb-4">
                <h5 className="mb-3">
                  <i className="bi bi-receipt me-2"></i>
                  Invoices
                </h5>
                <InvoiceSection />
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

              <hr />
              <div className="mb-4">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h5 className="mb-0">
                    <i className="bi bi-shield-lock me-2"></i>
                    Update Zerodha & Auto Authentication Details
                  </h5>
                  {!editingCredentials && (
                    <button type="button" className="btn btn-outline-primary btn-sm" onClick={handleStartCredentialEdit}>
                      <i className="bi bi-pencil me-1"></i>
                      Edit
                    </button>
                  )}
                </div>

                {credentialMeta && (
                  <div className="mb-3">
                    {credentialMeta.missing_fields.length === 0 ? (
                      <span className="badge bg-success">Credentials complete</span>
                    ) : (
                      <span className="badge bg-warning text-dark">
                        Missing: {credentialMeta.missing_fields.join(', ')}
                      </span>
                    )}
                    {credentialMeta.auto_auth_configured_at && (
                      <small className="text-muted ms-2">
                        Last updated: {new Date(credentialMeta.auto_auth_configured_at).toLocaleString('en-IN')}
                      </small>
                    )}
                  </div>
                )}

                {credentialMessage && (
                  <div className={`alert alert-${credentialMessage.type} py-2`} role="alert">
                    {credentialMessage.text}
                  </div>
                )}

                {!editingCredentials ? (
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label text-muted">Zerodha API Key</label>
                      <div className="form-control bg-light">
                        {credentialMeta?.app_key_masked || 'Not set'}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label text-muted">Zerodha API Secret</label>
                      <div>{configuredBadge(Boolean(credentialMeta?.has_app_secret))}</div>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label text-muted">Kite User ID</label>
                      <div className="form-control bg-light">
                        {credentialMeta?.kite_user_id || 'Not set'}
                      </div>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label text-muted">Kite Password</label>
                      <div>{configuredBadge(Boolean(credentialMeta?.has_kite_password))}</div>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label text-muted">Kite TOTP Secret</label>
                      <div>{configuredBadge(Boolean(credentialMeta?.has_kite_totp_secret))}</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-muted small mb-3">
                      Leave secret fields blank to keep existing saved values.
                    </p>
                    <form onSubmit={handleSaveCredentials} className="row g-3">
                      <div className="col-md-6">
                        <label htmlFor="profile_app_key" className="form-label">Zerodha API Key</label>
                        <input
                          id="profile_app_key"
                          type="text"
                          className="form-control"
                          value={appKey}
                          onChange={(e) => setAppKey(e.target.value)}
                          placeholder={credentialMeta?.app_key_masked || 'Enter API key'}
                        />
                      </div>
                      <div className="col-md-6">
                        <label htmlFor="profile_app_secret" className="form-label">Zerodha API Secret</label>
                        <input
                          id="profile_app_secret"
                          type="password"
                          className="form-control"
                          value={appSecret}
                          onChange={(e) => setAppSecret(e.target.value)}
                          placeholder="Leave blank to keep current"
                        />
                      </div>
                      <div className="col-md-4">
                        <label htmlFor="profile_kite_user_id" className="form-label">Kite User ID</label>
                        <input
                          id="profile_kite_user_id"
                          type="text"
                          className="form-control"
                          value={kiteUserId}
                          onChange={(e) => setKiteUserId(e.target.value)}
                          placeholder="Kite user ID"
                        />
                      </div>
                      <div className="col-md-4">
                        <label htmlFor="profile_kite_password" className="form-label">Kite Password</label>
                        <input
                          id="profile_kite_password"
                          type="password"
                          className="form-control"
                          value={kitePassword}
                          onChange={(e) => setKitePassword(e.target.value)}
                          placeholder="Leave blank to keep current"
                        />
                      </div>
                      <div className="col-md-4">
                        <label htmlFor="profile_kite_totp" className="form-label">Kite TOTP Secret</label>
                        <input
                          id="profile_kite_totp"
                          type="password"
                          className="form-control"
                          value={kiteTotpSecret}
                          onChange={(e) => setKiteTotpSecret(e.target.value)}
                          placeholder="Leave blank to keep current"
                        />
                      </div>
                      <div className="col-12 d-flex gap-2">
                        <button type="submit" className="btn btn-primary" disabled={savingCredentials}>
                          {savingCredentials ? 'Saving...' : 'Save Details'}
                        </button>
                        <button type="button" className="btn btn-outline-secondary" onClick={handleCancelCredentialEdit}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </div>

              <hr />
              <div className="mb-4">
                <h5 className="mb-3">
                  <i className="bi bi-clock-history me-2"></i>
                  Auto Authentication Schedule
                </h5>
                <div className="alert alert-info mb-3">
                  <i className="bi bi-info-circle me-2"></i>
                  Runs automatically {scheduleActivity?.schedule.description || 'Mon–Fri 8:45 AM IST'} for your account when credentials are configured.
                </div>
                <button
                  type="button"
                  className="btn btn-outline-success btn-sm mb-3"
                  onClick={handleRunAutoAuthNow}
                  disabled={startingAutoAuth || !credentialMeta?.auto_auth_details_present}
                >
                  {startingAutoAuth ? 'Starting...' : 'Run Auto Authentication Now'}
                </button>

                <h6 className="mb-2 d-flex justify-content-between align-items-center">
                  <span>Schedule Activity</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
                    onClick={fetchScheduleActivity}
                    disabled={loadingSchedule}
                  >
                    Refresh
                  </button>
                </h6>
                {loadingSchedule ? (
                  <div className="text-center py-3">
                    <div className="spinner-border spinner-border-sm" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-sm table-hover align-middle">
                      <thead>
                        <tr>
                          <th>When (IST)</th>
                          <th>Day</th>
                          <th>Status</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(scheduleActivity?.upcoming_runs || []).map((run) => (
                          <tr key={`upcoming-${run.scheduled_for}`}>
                            <td>{formatScheduleDateTime(run.scheduled_for)}</td>
                            <td>{run.day}</td>
                            <td>
                              <span className={`badge ${scheduleStatusBadgeClass(run.status)}`}>
                                {run.status}
                              </span>
                            </td>
                            <td className="small text-muted">{run.details || '—'}</td>
                          </tr>
                        ))}
                        {(scheduleActivity?.past_runs || []).map((run) => (
                          <tr key={`past-${run.scheduled_for}`}>
                            <td>{formatScheduleDateTime(run.scheduled_for)}</td>
                            <td>{run.day}</td>
                            <td>
                              <span className={`badge ${scheduleStatusBadgeClass(run.status)}`}>
                                {run.status}
                              </span>
                            </td>
                            <td className="small text-muted">{run.details || '—'}</td>
                          </tr>
                        ))}
                        {!scheduleActivity?.past_runs?.length && !scheduleActivity?.upcoming_runs?.length && (
                          <tr>
                            <td colSpan={4} className="text-muted text-center">
                              No schedule activity yet. Upcoming Mon–Fri runs will appear here.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    <small className="text-muted">
                      Showing next {scheduleActivity?.upcoming_runs?.length || 0} upcoming and last {scheduleActivity?.past_runs?.length || 0} completed runs.
                    </small>
                  </div>
                )}
              </div>

              <div className="alert alert-info mt-4 mb-0">
                <i className="bi bi-info-circle me-2"></i>
                <small>Profile identity fields are read-only. Zerodha and auto-auth details can be updated above.</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileContent;

