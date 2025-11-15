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
  const [activeTab, setActiveTab] = useState<'user-management' | 'strategy-approvals'>('user-management');
  
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

  useEffect(() => {
    loadUsers();
    if (activeTab === 'strategy-approvals') {
      loadPendingStrategies();
    }
  }, [activeTab]);
  
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
        </div>
      </div>
    </div>
  );
};

export default AdminContent;

