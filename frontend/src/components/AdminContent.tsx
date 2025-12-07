import React, { useState, useEffect } from 'react';
import { apiUrl } from '../config/api';

interface User {
  id: number;
  email: string;
  mobile: string;
  email_verified: boolean;
  app_key: string;
  app_secret: string;
  is_admin: boolean;
  has_token: boolean;
  token_created_at: string | null;
}

const AdminContent: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'user-management' | 'strategy-approvals' | 'subscriptions' | 'plan-prices'>('user-management');
  
  interface PendingStrategy {
    id: number;
    strategy_name: string;
    strategy_type: string;
    instrument: string;
    user_id: number;
    user_email: string;
    user_mobile: string;
    created_at: string;
    submitted_for_approval_at: string;
    approval_status: string;
  }
  
  const [pendingStrategies, setPendingStrategies] = useState<PendingStrategy[]>([]);
  const [loadingStrategies, setLoadingStrategies] = useState(false);
  
  interface Subscription {
    subscription_id: number;
    user_id: number;
    email: string;
    mobile: string;
    plan_type: string;
    subscription_status: string;
    start_date: string;
    end_date: string | null;
    trial_end_date: string | null;
    subscription_created_at: string;
    payment_id: number | null;
    razorpay_payment_id: string | null;
    razorpay_order_id: string | null;
    amount: number | null;
    payment_status: string | null;
    payment_method: string | null;
    transaction_date: string | null;
  }
  
  interface Payment {
    payment_id: number;
    razorpay_order_id: string | null;
    razorpay_payment_id: string | null;
    invoice_number: string | null;
    amount: number;
    currency: string;
    plan_type: string;
    payment_status: string;
    payment_method: string | null;
    transaction_date: string | null;
    created_at: string;
    subscription_id: number | null;
    subscription_plan_type: string | null;
    subscription_status: string | null;
  }
  
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [userPayments, setUserPayments] = useState<{[key: number]: Payment[]}>({});
  const [loadingPayments, setLoadingPayments] = useState<{[key: number]: boolean}>({});

  const [planPrices, setPlanPrices] = useState<{[key: string]: {price: number, updated_at?: string}}>({});
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [editingPrices, setEditingPrices] = useState<{[key: string]: number}>({});
  const [savingPrices, setSavingPrices] = useState(false);

  useEffect(() => {
    loadUsers();
    if (activeTab === 'strategy-approvals') {
      loadPendingStrategies();
    } else if (activeTab === 'subscriptions') {
      loadSubscriptions();
    } else if (activeTab === 'plan-prices') {
      loadPlanPrices();
    }
  }, [activeTab]);
  
  const loadPlanPrices = async () => {
    try {
      setLoadingPrices(true);
      const response = await fetch(apiUrl('/api/admin/plan-prices'), {
        credentials: 'include',
      });

      if (response.status === 403) {
        setError('You do not have admin access');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load plan prices');
      }

      const data = await response.json();
      if (data.status === 'success') {
        setPlanPrices(data.prices || {});
        // Initialize editing prices with current values
        const editState: {[key: string]: number} = {};
        Object.keys(data.prices || {}).forEach(key => {
          editState[key] = data.prices[key].price;
        });
        setEditingPrices(editState);
      } else {
        setError(data.message || 'Failed to load plan prices');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoadingPrices(false);
    }
  };
  
  const handlePriceChange = (planType: string, value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0) {
      setEditingPrices(prev => ({
        ...prev,
        [planType]: numValue
      }));
    }
  };
  
  const handleSavePrices = async () => {
    try {
      setSavingPrices(true);
      const response = await fetch(apiUrl('/api/admin/plan-prices'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          prices: editingPrices
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update plan prices');
      }

      const data = await response.json();
      if (data.status === 'success') {
        setPlanPrices(data.prices || {});
        alert('Plan prices updated successfully!');
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert(`Error saving prices: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSavingPrices(false);
    }
  };
  
  const loadSubscriptions = async () => {
    try {
      setLoadingSubscriptions(true);
      const response = await fetch(apiUrl('/api/admin/subscriptions'), {
        credentials: 'include',
      });

      if (response.status === 403) {
        setError('You do not have admin access');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load subscriptions');
      }

      const data = await response.json();
      if (data.status === 'success') {
        setSubscriptions(data.subscriptions || []);
      } else {
        setError(data.message || 'Failed to load subscriptions');
        setSubscriptions([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoadingSubscriptions(false);
    }
  };

  const loadUserPayments = async (userId: number) => {
    if (userPayments[userId]) {
      // Already loaded, just toggle
      return;
    }

    try {
      setLoadingPayments(prev => ({ ...prev, [userId]: true }));
      const response = await fetch(apiUrl(`/api/admin/user/${userId}/payments`), {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to load payment history');
      }

      const data = await response.json();
      if (data.status === 'success') {
        setUserPayments(prev => ({ ...prev, [userId]: data.payments || [] }));
      }
    } catch (err) {
      console.error('Error loading user payments:', err);
      setUserPayments(prev => ({ ...prev, [userId]: [] }));
    } finally {
      setLoadingPayments(prev => ({ ...prev, [userId]: false }));
    }
  };

  const toggleUserTransactions = (userId: number) => {
    const newExpanded = new Set(expandedUsers);
    if (newExpanded.has(userId)) {
      newExpanded.delete(userId);
    } else {
      newExpanded.add(userId);
      loadUserPayments(userId);
    }
    setExpandedUsers(newExpanded);
  };
  
  const loadPendingStrategies = async () => {
    try {
      setLoadingStrategies(true);
      const response = await fetch(apiUrl('/api/admin/strategies/pending'), {
        credentials: 'include',
      });

      if (response.status === 403) {
        setError('You do not have admin access');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load pending strategies');
      }

      const data = await response.json();
      if (data.status === 'success') {
        console.log('Pending strategies loaded:', data.strategies);
        setPendingStrategies(data.strategies || []);
      } else {
        setError(data.message || 'Failed to load pending strategies');
        setPendingStrategies([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoadingStrategies(false);
    }
  };

  const handleApproveStrategy = async (strategyId: number) => {
    if (!window.confirm('Approve this strategy? It will be available for deployment.')) {
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/admin/strategies/${strategyId}/approve`), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      if (data.status === 'success') {
        alert('Strategy approved successfully');
        loadPendingStrategies();
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert(`Error approving strategy: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleRejectStrategy = async (strategyId: number) => {
    const rejectionReason = window.prompt('Enter rejection reason (optional):');
    if (rejectionReason === null) {
      return; // User cancelled
    }

    try {
      const response = await fetch(apiUrl(`/api/admin/strategies/${strategyId}/reject`), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rejection_reason: rejectionReason || '',
        }),
      });

      const data = await response.json();
      if (data.status === 'success') {
        alert('Strategy rejected successfully');
        loadPendingStrategies();
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert(`Error rejecting strategy: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(apiUrl('/api/admin/users'), {
        credentials: 'include',
      });

      if (response.status === 403) {
        setError('You do not have admin access');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load users');
      }

      const data = await response.json();
      if (data.status === 'success') {
        setUsers(data.users);
      } else {
        setError(data.message || 'Failed to load users');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId: number, email: string) => {
    if (!window.confirm(`Are you sure you want to delete user ${email}? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/admin/users/${userId}`), {
        method: 'DELETE',
        credentials: 'include',
      });

      const data = await response.json();
      if (data.status === 'success') {
        setUsers(users.filter(u => u.id !== userId));
        alert('User deleted successfully');
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert(`Error deleting user: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleToggleAdmin = async (userId: number, currentAdminStatus: boolean) => {
    try {
      const response = await fetch(apiUrl(`/api/admin/users/${userId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          is_admin: !currentAdminStatus,
        }),
      });

      const data = await response.json();
      if (data.status === 'success') {
        setUsers(users.map(u => 
          u.id === userId ? { ...u, is_admin: !currentAdminStatus } : u
        ));
        alert(`User ${!currentAdminStatus ? 'promoted to' : 'removed from'} admin successfully`);
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert(`Error updating user: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleToggleActive = async (userId: number, currentStatus: boolean) => {
    try {
      const response = await fetch(apiUrl(`/api/admin/users/${userId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          email_verified: !currentStatus,
        }),
      });

      const data = await response.json();
      if (data.status === 'success') {
        setUsers(users.map(u => 
          u.id === userId ? { ...u, email_verified: !currentStatus } : u
        ));
        alert(`User ${!currentStatus ? 'activated' : 'deactivated'} successfully`);
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert(`Error updating user: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const maskSensitiveData = (value: string): string => {
    if (!value || value.length === 0) return 'Not set';
    if (value.length <= 4) return '****';
    return value.substring(0, 4) + '****' + value.substring(value.length - 4);
  };

  if (loading) {
    return (
      <div className="container mt-4">
        <div className="text-center">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mt-4">
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid mt-4">
      <div className="row">
        <div className="col-12">
          <h2 className="mb-4">
            <i className="bi bi-shield-check me-2"></i>
            Admin Panel
          </h2>

          {/* Tabs */}
          <ul className="nav nav-tabs mb-4">
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'user-management' ? 'active' : ''}`}
                onClick={() => setActiveTab('user-management')}
              >
                <i className="bi bi-people me-2"></i>
                User Management
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'strategy-approvals' ? 'active' : ''}`}
                onClick={() => setActiveTab('strategy-approvals')}
              >
                <i className="bi bi-clipboard-check me-2"></i>
                Strategy Approvals
                {pendingStrategies.length > 0 && (
                  <span className="badge bg-danger ms-2">{pendingStrategies.length}</span>
                )}
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'subscriptions' ? 'active' : ''}`}
                onClick={() => setActiveTab('subscriptions')}
              >
                <i className="bi bi-credit-card me-2"></i>
                Subscriptions
                {subscriptions.length > 0 && (
                  <span className="badge bg-success ms-2">{subscriptions.length}</span>
                )}
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'plan-prices' ? 'active' : ''}`}
                onClick={() => setActiveTab('plan-prices')}
              >
                <i className="bi bi-currency-rupee me-2"></i>
                Plan Prices
              </button>
            </li>
          </ul>

          {/* Strategy Approvals Tab */}
          {activeTab === 'strategy-approvals' && (
            <div className="card">
              <div className="card-header d-flex justify-content-between align-items-center">
                <h5 className="mb-0">
                  <i className="bi bi-clipboard-check me-2"></i>
                  Pending Strategy Approvals ({pendingStrategies.length})
                </h5>
                <button
                  className="btn btn-sm btn-outline-primary"
                  onClick={loadPendingStrategies}
                  disabled={loadingStrategies}
                >
                  <i className="bi bi-arrow-clockwise me-1"></i>
                  Refresh
                </button>
              </div>
              <div className="card-body">
                {loadingStrategies ? (
                  <div className="text-center py-4">
                    <div className="spinner-border" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : pendingStrategies.length === 0 ? (
                  <div className="text-center text-muted py-4">
                    <i className="bi bi-check-circle fs-1 d-block mb-2"></i>
                    No pending strategy approvals
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Strategy Name</th>
                          <th>Type</th>
                          <th>Instrument</th>
                          <th>User</th>
                          <th>Submitted At</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingStrategies.map((strategy) => (
                          <tr key={strategy.id}>
                            <td>{strategy.id}</td>
                            <td>
                              <strong>{strategy.strategy_name}</strong>
                            </td>
                            <td>
                              <span className="badge bg-secondary">
                                {strategy.strategy_type || 'custom'}
                              </span>
                            </td>
                            <td>{strategy.instrument || 'N/A'}</td>
                            <td>
                              <div>{strategy.user_email}</div>
                              <small className="text-muted">{strategy.user_mobile || 'N/A'}</small>
                            </td>
                            <td>
                              {strategy.submitted_for_approval_at
                                ? new Date(strategy.submitted_for_approval_at).toLocaleString()
                                : 'N/A'}
                            </td>
                            <td>
                              <div className="btn-group btn-group-sm">
                                <button
                                  className="btn btn-outline-success"
                                  onClick={() => handleApproveStrategy(strategy.id)}
                                  title="Approve"
                                >
                                  <i className="bi bi-check-circle me-1"></i>
                                  Approve
                                </button>
                                <button
                                  className="btn btn-outline-danger"
                                  onClick={() => handleRejectStrategy(strategy.id)}
                                  title="Reject"
                                >
                                  <i className="bi bi-x-circle me-1"></i>
                                  Reject
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* User Management Tab */}
          {activeTab === 'user-management' && (
            <div className="card">
              <div className="card-header d-flex justify-content-between align-items-center">
                <h5 className="mb-0">
                  <i className="bi bi-people me-2"></i>
                  All Users ({users.length})
                </h5>
                <button
                  className="btn btn-sm btn-outline-primary"
                  onClick={loadUsers}
                >
                  <i className="bi bi-arrow-clockwise me-1"></i>
                  Refresh
                </button>
              </div>
              <div className="card-body">
                <div className="table-responsive">
                  <table className="table table-hover">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Email</th>
                        <th>Mobile</th>
                        <th>Status</th>
                        <th>Admin</th>
                        <th>API Key</th>
                        <th>Secret Key</th>
                        <th>Zerodha Token</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="text-center text-muted">
                            No users found
                          </td>
                        </tr>
                      ) : (
                        users.map((user) => (
                          <tr key={user.id}>
                            <td>{user.id}</td>
                            <td>{user.email}</td>
                            <td>{user.mobile || 'N/A'}</td>
                            <td>
                              <span className={`badge ${user.email_verified ? 'bg-success' : 'bg-secondary'}`}>
                                {user.email_verified ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td>
                              <div className="form-check form-switch">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={user.is_admin}
                                  onChange={() => handleToggleAdmin(user.id, user.is_admin)}
                                  id={`admin-${user.id}`}
                                />
                                <label className="form-check-label" htmlFor={`admin-${user.id}`}>
                                  {user.is_admin ? 'Admin' : 'User'}
                                </label>
                              </div>
                            </td>
                            <td>
                              <code className="text-muted small">
                                {maskSensitiveData(user.app_key)}
                              </code>
                            </td>
                            <td>
                              <code className="text-muted small">
                                {maskSensitiveData(user.app_secret)}
                              </code>
                            </td>
                            <td>
                              {user.has_token ? (
                                <span className="badge bg-info">
                                  <i className="bi bi-check-circle me-1"></i>
                                  Active
                                </span>
                              ) : (
                                <span className="badge bg-secondary">None</span>
                              )}
                            </td>
                            <td>
                              <div className="btn-group" role="group">
                                <button
                                  className="btn btn-sm btn-outline-warning"
                                  onClick={() => handleToggleActive(user.id, user.email_verified)}
                                  title={user.email_verified ? 'Deactivate' : 'Activate'}
                                >
                                  <i className={`bi ${user.email_verified ? 'bi-toggle-on' : 'bi-toggle-off'}`}></i>
                                </button>
                                <button
                                  className="btn btn-sm btn-outline-danger"
                                  onClick={() => handleDeleteUser(user.id, user.email)}
                                  title="Delete User"
                                >
                                  <i className="bi bi-trash"></i>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Subscriptions Tab */}
          {activeTab === 'subscriptions' && (
            <div className="card">
              <div className="card-header d-flex justify-content-between align-items-center">
                <h5 className="mb-0">
                  <i className="bi bi-credit-card me-2"></i>
                  Active Subscriptions ({subscriptions.length})
                </h5>
                <button
                  className="btn btn-sm btn-outline-primary"
                  onClick={loadSubscriptions}
                  disabled={loadingSubscriptions}
                >
                  <i className="bi bi-arrow-clockwise me-1"></i>
                  Refresh
                </button>
              </div>
              <div className="card-body">
                {loadingSubscriptions ? (
                  <div className="text-center py-4">
                    <div className="spinner-border" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : subscriptions.length === 0 ? (
                  <div className="text-center text-muted py-4">
                    <i className="bi bi-inbox fs-1 d-block mb-2"></i>
                    No active subscriptions
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>User</th>
                          <th>Plan</th>
                          <th>Status</th>
                          <th>Start Date</th>
                          <th>End Date</th>
                          <th>Trial End</th>
                          <th>Amount</th>
                          <th>Payment Method</th>
                          <th>Payment ID</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subscriptions.map((sub, idx) => {
                          const isExpanded = expandedUsers.has(sub.user_id);
                          const payments = userPayments[sub.user_id] || [];
                          const isLoadingPayments = loadingPayments[sub.user_id] || false;
                          
                          return (
                            <React.Fragment key={sub.subscription_id}>
                              <tr>
                                <td>{idx + 1}</td>
                                <td>
                                  <div>
                                    <strong>{sub.email}</strong>
                                  </div>
                                  <small className="text-muted">{sub.mobile || 'N/A'}</small>
                                  <br />
                                  <small className="text-muted">User ID: {sub.user_id}</small>
                                  <br />
                                  <button
                                    className="btn btn-sm btn-link p-0 mt-1 text-primary"
                                    onClick={() => toggleUserTransactions(sub.user_id)}
                                    style={{ fontSize: '0.85rem', textDecoration: 'none' }}
                                  >
                                    <i className={`bi ${isExpanded ? 'bi-chevron-down' : 'bi-chevron-right'} me-1`}></i>
                                    {isExpanded ? 'Hide' : 'Show'} Transaction History
                                    {payments.length > 0 && ` (${payments.length})`}
                                  </button>
                                </td>
                            <td>
                              <span className={`badge ${
                                sub.plan_type === 'super_premium' ? 'bg-success' :
                                sub.plan_type === 'premium' ? 'bg-primary' : 'bg-secondary'
                              }`}>
                                {sub.plan_type === 'super_premium' ? 'Super Premium' :
                                 sub.plan_type === 'premium' ? 'Premium' :
                                 sub.plan_type === 'freemium' ? 'Freemium' : sub.plan_type}
                              </span>
                            </td>
                            <td>
                              <span className={`badge ${
                                sub.subscription_status === 'active' ? 'bg-success' :
                                sub.subscription_status === 'trial' ? 'bg-info' : 'bg-secondary'
                              }`}>
                                {sub.subscription_status || 'N/A'}
                              </span>
                            </td>
                            <td>
                              {sub.start_date 
                                ? new Date(sub.start_date).toLocaleDateString('en-IN', {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric'
                                  })
                                : 'N/A'}
                            </td>
                            <td>
                              {sub.end_date 
                                ? new Date(sub.end_date).toLocaleDateString('en-IN', {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric'
                                  })
                                : 'N/A'}
                            </td>
                            <td>
                              {sub.trial_end_date 
                                ? new Date(sub.trial_end_date).toLocaleDateString('en-IN', {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric'
                                  })
                                : 'N/A'}
                            </td>
                            <td>
                              {sub.amount !== null && sub.amount !== undefined
                                ? `₹${sub.amount.toFixed(2)}`
                                : 'N/A'}
                            </td>
                            <td>
                              {sub.payment_method 
                                ? <span className="badge bg-secondary">{sub.payment_method.toUpperCase()}</span>
                                : 'N/A'}
                            </td>
                            <td>
                              {sub.razorpay_payment_id 
                                ? <small className="font-monospace">{sub.razorpay_payment_id.substring(0, 12)}...</small>
                                : 'N/A'}
                            </td>
                            <td>
                              {sub.payment_id && sub.payment_status === 'completed' ? (
                                <a
                                  href={apiUrl(`/api/invoice/download/${sub.payment_id}`)}
                                  className="btn btn-sm btn-outline-primary"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Download Invoice"
                                >
                                  <i className="bi bi-download me-1"></i>
                                  Invoice
                                </a>
                              ) : (
                                <span className="text-muted small">N/A</span>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={11} className="p-0">
                                <div className="bg-light p-3">
                                  {isLoadingPayments ? (
                                    <div className="text-center py-2">
                                      <div className="spinner-border spinner-border-sm" role="status">
                                        <span className="visually-hidden">Loading...</span>
                                      </div>
                                    </div>
                                  ) : payments.length === 0 ? (
                                    <div className="text-center text-muted py-2">
                                      No payment transactions found
                                    </div>
                                  ) : (
                                    <div>
                                      <h6 className="mb-3">
                                        <i className="bi bi-clock-history me-2"></i>
                                        Payment Transaction History ({payments.length})
                                      </h6>
                                      <div className="table-responsive">
                                        <table className="table table-sm table-bordered">
                                          <thead className="table-secondary">
                                            <tr>
                                              <th>Date</th>
                                              <th>Invoice #</th>
                                              <th>Plan</th>
                                              <th>Amount</th>
                                              <th>Status</th>
                                              <th>Method</th>
                                              <th>Payment ID</th>
                                              <th>Actions</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {payments.map((payment) => (
                                              <tr key={payment.payment_id}>
                                                <td>
                                                  {payment.transaction_date
                                                    ? new Date(payment.transaction_date).toLocaleDateString('en-IN', {
                                                        year: 'numeric',
                                                        month: 'short',
                                                        day: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                      })
                                                    : 'N/A'}
                                                </td>
                                                <td>
                                                  <code className="small">{payment.invoice_number || 'N/A'}</code>
                                                </td>
                                                <td>
                                                  <span className="badge bg-secondary">
                                                    {payment.plan_type?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'N/A'}
                                                  </span>
                                                </td>
                                                <td className="fw-bold">₹{payment.amount.toFixed(2)}</td>
                                                <td>
                                                  <span className={`badge ${
                                                    payment.payment_status === 'completed' ? 'bg-success' :
                                                    payment.payment_status === 'pending' ? 'bg-warning' :
                                                    payment.payment_status === 'failed' ? 'bg-danger' : 'bg-secondary'
                                                  }`}>
                                                    {payment.payment_status || 'N/A'}
                                                  </span>
                                                </td>
                                                <td>
                                                  {payment.payment_method ? (
                                                    <span className="badge bg-info">{payment.payment_method.toUpperCase()}</span>
                                                  ) : 'N/A'}
                                                </td>
                                                <td>
                                                  {payment.razorpay_payment_id ? (
                                                    <small className="font-monospace">{payment.razorpay_payment_id.substring(0, 12)}...</small>
                                                  ) : 'N/A'}
                                                </td>
                                                <td>
                                                  {payment.payment_status === 'completed' && payment.payment_id ? (
                                                    <a
                                                      href={apiUrl(`/api/invoice/download/${payment.payment_id}`)}
                                                      className="btn btn-sm btn-outline-primary"
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      title="Download Invoice"
                                                    >
                                                      <i className="bi bi-download"></i>
                                                    </a>
                                                  ) : (
                                                    <span className="text-muted small">-</span>
                                                  )}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                        );
                      })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Plan Prices Tab */}
          {activeTab === 'plan-prices' && (
            <div className="card">
              <div className="card-header d-flex justify-content-between align-items-center">
                <h5 className="mb-0">
                  <i className="bi bi-currency-rupee me-2"></i>
                  Manage Plan Prices
                </h5>
                <button
                  className="btn btn-sm btn-outline-primary"
                  onClick={loadPlanPrices}
                  disabled={loadingPrices}
                >
                  <i className="bi bi-arrow-clockwise me-1"></i>
                  Refresh
                </button>
              </div>
              <div className="card-body">
                {loadingPrices ? (
                  <div className="text-center py-4">
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="alert alert-info">
                      <i className="bi bi-info-circle me-2"></i>
                      Update plan prices below. Changes will be reflected immediately in the subscription page.
                    </div>
                    <div className="table-responsive">
                      <table className="table table-hover">
                        <thead>
                          <tr>
                            <th>Plan Type</th>
                            <th>Current Price</th>
                            <th>New Price (₹)</th>
                            <th>Last Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>
                              <strong>Premium</strong>
                              <br />
                              <small className="text-muted">Monthly subscription</small>
                            </td>
                            <td>
                              <span className="badge bg-primary">
                                ₹{planPrices.premium?.price?.toFixed(2) || '0.00'}
                              </span>
                            </td>
                            <td>
                              <div className="input-group" style={{maxWidth: '200px'}}>
                                <span className="input-group-text">₹</span>
                                <input
                                  type="number"
                                  className="form-control"
                                  min="0"
                                  step="0.01"
                                  value={editingPrices.premium || planPrices.premium?.price || 0}
                                  onChange={(e) => handlePriceChange('premium', e.target.value)}
                                />
                              </div>
                            </td>
                            <td>
                              {planPrices.premium?.updated_at
                                ? new Date(planPrices.premium.updated_at).toLocaleString()
                                : 'Never'}
                            </td>
                          </tr>
                          <tr>
                            <td>
                              <strong>Super Premium</strong>
                              <br />
                              <small className="text-muted">Monthly subscription</small>
                            </td>
                            <td>
                              <span className="badge bg-success">
                                ₹{planPrices.super_premium?.price?.toFixed(2) || '0.00'}
                              </span>
                            </td>
                            <td>
                              <div className="input-group" style={{maxWidth: '200px'}}>
                                <span className="input-group-text">₹</span>
                                <input
                                  type="number"
                                  className="form-control"
                                  min="0"
                                  step="0.01"
                                  value={editingPrices.super_premium || planPrices.super_premium?.price || 0}
                                  onChange={(e) => handlePriceChange('super_premium', e.target.value)}
                                />
                              </div>
                            </td>
                            <td>
                              {planPrices.super_premium?.updated_at
                                ? new Date(planPrices.super_premium.updated_at).toLocaleString()
                                : 'Never'}
                            </td>
                          </tr>
                          <tr>
                            <td>
                              <strong>Strategy Customization</strong>
                              <br />
                              <small className="text-muted">One-time payment</small>
                            </td>
                            <td>
                              <span className="badge bg-warning text-dark">
                                ₹{planPrices.customization?.price?.toFixed(2) || '0.00'}
                              </span>
                            </td>
                            <td>
                              <div className="input-group" style={{maxWidth: '200px'}}>
                                <span className="input-group-text">₹</span>
                                <input
                                  type="number"
                                  className="form-control"
                                  min="0"
                                  step="0.01"
                                  value={editingPrices.customization || planPrices.customization?.price || 0}
                                  onChange={(e) => handlePriceChange('customization', e.target.value)}
                                />
                              </div>
                            </td>
                            <td>
                              {planPrices.customization?.updated_at
                                ? new Date(planPrices.customization.updated_at).toLocaleString()
                                : 'Never'}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 d-flex justify-content-end">
                      <button
                        className="btn btn-primary"
                        onClick={handleSavePrices}
                        disabled={savingPrices}
                      >
                        {savingPrices ? (
                          <>
                            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                            Saving...
                          </>
                        ) : (
                          <>
                            <i className="bi bi-save me-2"></i>
                            Save Prices
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminContent;

