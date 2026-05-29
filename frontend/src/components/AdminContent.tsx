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

interface LegacyKiteAccount {
  id: number;
  legacy_user_id: string;
  name: string | null;
  email: string | null;
  api_key: string | null;
  api_secret: string | null;
  request_token: string | null;
  access_token: string | null;
  public_token: string | null;
  totp_secret: string | null;
  kite_password: string | null;
  strategy: string | null;
  allowed_exchanges: string | null;
  paper_trade_strategies: string | null;
  nfo_buy_and_sell: string | null;
  account_status: string | null;
  metadata_json: string | null;
  imported_at: string | null;
}

const AdminContent: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'user-management' | 'strategy-approvals' | 'subscriptions' | 'plan-prices' | 'auto-auth-schedule' | 'legacy-kite-accounts'>('user-management');
  const [legacyAccounts, setLegacyAccounts] = useState<LegacyKiteAccount[]>([]);
  const [loadingLegacyAccounts, setLoadingLegacyAccounts] = useState(false);
  const [legacySearch, setLegacySearch] = useState('');
  const [selectedLegacyAccount, setSelectedLegacyAccount] = useState<LegacyKiteAccount | null>(null);
  
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

  interface AutoAuthScheduleSettings {
    hour: number;
    minute: number;
    weekdays: number[];
    weekday_labels: string[];
    time: string;
    timezone: string;
    description: string;
    updated_at?: string | null;
    updated_by_email?: string | null;
  }

  const WEEKDAY_OPTIONS = [
    { value: 0, label: 'Mon' },
    { value: 1, label: 'Tue' },
    { value: 2, label: 'Wed' },
    { value: 3, label: 'Thu' },
    { value: 4, label: 'Fri' },
    { value: 5, label: 'Sat' },
    { value: 6, label: 'Sun' },
  ];

  const [autoAuthSchedule, setAutoAuthSchedule] = useState<AutoAuthScheduleSettings | null>(null);
  const [scheduleTime, setScheduleTime] = useState('08:45');
  const [scheduleWeekdays, setScheduleWeekdays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [loadingAutoAuthSchedule, setLoadingAutoAuthSchedule] = useState(false);
  const [savingAutoAuthSchedule, setSavingAutoAuthSchedule] = useState(false);

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editAppKey, setEditAppKey] = useState('');
  const [editAppSecret, setEditAppSecret] = useState('');
  const [clearCredentials, setClearCredentials] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);

  useEffect(() => {
    loadUsers();
    if (activeTab === 'strategy-approvals') {
      loadPendingStrategies();
    } else if (activeTab === 'subscriptions') {
      loadSubscriptions();
    } else if (activeTab === 'plan-prices') {
      loadPlanPrices();
    } else if (activeTab === 'auto-auth-schedule') {
      loadAutoAuthSchedule();
    } else if (activeTab === 'legacy-kite-accounts') {
      loadLegacyKiteAccounts();
    }
  }, [activeTab]);

  const loadLegacyKiteAccounts = async (query = legacySearch) => {
    try {
      setLoadingLegacyAccounts(true);
      const params = query ? `?q=${encodeURIComponent(query)}` : '';
      const response = await fetch(apiUrl(`/api/admin/legacy-kite-accounts${params}`), {
        credentials: 'include',
      });
      if (response.status === 403) {
        setError('You do not have admin access');
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to load legacy kite accounts');
      }
      const data = await response.json();
      if (data.status === 'success') {
        setLegacyAccounts(data.accounts || []);
      } else {
        setError(data.message || 'Failed to load legacy kite accounts');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoadingLegacyAccounts(false);
    }
  };

  const openLegacyAccountDetail = async (accountId: number) => {
    try {
      const response = await fetch(apiUrl(`/api/admin/legacy-kite-accounts/${accountId}`), {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to load legacy account detail');
      }
      const data = await response.json();
      if (data.status === 'success') {
        setSelectedLegacyAccount(data.account as LegacyKiteAccount);
      } else {
        alert(data.message || 'Failed to load legacy account detail');
      }
    } catch (err) {
      alert(`Error loading legacy account detail: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };
  
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

  const loadAutoAuthSchedule = async () => {
    try {
      setLoadingAutoAuthSchedule(true);
      const response = await fetch(apiUrl('/api/admin/auto-auth-schedule'), {
        credentials: 'include',
      });

      if (response.status === 403) {
        setError('You do not have admin access');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load auto-auth schedule');
      }

      const data = await response.json();
      if (data.status === 'success' && data.schedule) {
        const schedule = data.schedule as AutoAuthScheduleSettings;
        setAutoAuthSchedule(schedule);
        setScheduleTime(schedule.time || `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`);
        setScheduleWeekdays(Array.isArray(schedule.weekdays) ? schedule.weekdays : [0, 1, 2, 3, 4]);
      } else {
        setError(data.message || 'Failed to load auto-auth schedule');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoadingAutoAuthSchedule(false);
    }
  };

  const handleScheduleTimeChange = (value: string) => {
    setScheduleTime(value);
  };

  const toggleScheduleWeekday = (day: number) => {
    setScheduleWeekdays((prev) => {
      if (prev.includes(day)) {
        const next = prev.filter((d) => d !== day);
        return next.length > 0 ? next : prev;
      }
      return [...prev, day].sort((a, b) => a - b);
    });
  };

  const handleSaveAutoAuthSchedule = async () => {
    const [hourPart, minutePart] = scheduleTime.split(':');
    const hour = parseInt(hourPart, 10);
    const minute = parseInt(minutePart, 10);
    if (Number.isNaN(hour) || Number.isNaN(minute)) {
      alert('Please select a valid time.');
      return;
    }
    if (scheduleWeekdays.length === 0) {
      alert('Select at least one weekday.');
      return;
    }

    try {
      setSavingAutoAuthSchedule(true);
      const response = await fetch(apiUrl('/api/admin/auto-auth-schedule'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ hour, minute, weekdays: scheduleWeekdays }),
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to update auto-auth schedule');
      }
      setAutoAuthSchedule(data.schedule);
      alert(data.message || 'Auto-auth schedule updated successfully.');
    } catch (err) {
      alert(`Error saving schedule: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSavingAutoAuthSchedule(false);
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

  const handleDisableZerodhaToken = async (userId: number, email: string) => {
    if (!window.confirm('Disable current Zerodha session token for this user? API key/secret will remain saved.')) {
      return;
    }
    try {
      const response = await fetch(apiUrl(`/api/admin/users/${userId}/disable-zerodha-token`), {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json();
      if (data.status === 'success') {
        alert(data.message || 'Zerodha token disabled successfully');
        await loadUsers();
      } else {
        alert(`Error: ${data.message || 'Failed to disable token'}`);
      }
    } catch (err) {
      alert(`Error disabling token for ${email}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const maskSensitiveData = (value: string): string => {
    if (!value || value.length === 0) return 'Not set';
    if (value.length <= 4) return '****';
    return value.substring(0, 4) + '****' + value.substring(value.length - 4);
  };

  const openEditCredentials = (user: User) => {
    setEditingUser(user);
    setEditAppKey('');
    setEditAppSecret('');
    setClearCredentials(false);
  };

  const closeEditCredentials = () => {
    setEditingUser(null);
    setEditAppKey('');
    setEditAppSecret('');
    setClearCredentials(false);
    setSavingCredentials(false);
  };

  const handleSaveCredentials = async () => {
    if (!editingUser) return;

    if (!clearCredentials) {
      const key = editAppKey.trim();
      const secret = editAppSecret.trim();
      if (!key || !secret) {
        alert('Please provide both API Key and API Secret, or choose Clear Zerodha credentials.');
        return;
      }
    }

    try {
      setSavingCredentials(true);
      const body = clearCredentials
        ? { clear_zerodha_credentials: true }
        : { app_key: editAppKey.trim(), app_secret: editAppSecret.trim() };

      const response = await fetch(apiUrl(`/api/admin/users/${editingUser.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (data.status === 'success') {
        alert(data.message || 'Credentials updated successfully');
        closeEditCredentials();
        await loadUsers();
      } else {
        alert(`Error: ${data.message || 'Failed to update credentials'}`);
      }
    } catch (err) {
      alert(`Error updating credentials: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSavingCredentials(false);
    }
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
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'auto-auth-schedule' ? 'active' : ''}`}
                onClick={() => setActiveTab('auto-auth-schedule')}
              >
                <i className="bi bi-clock-history me-2"></i>
                Auto Auth Schedule
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === 'legacy-kite-accounts' ? 'active' : ''}`}
                onClick={() => setActiveTab('legacy-kite-accounts')}
              >
                <i className="bi bi-key me-2"></i>
                Legacy Kite Accounts
                {legacyAccounts.length > 0 && (
                  <span className="badge bg-danger ms-2">{legacyAccounts.length}</span>
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
                                  className="btn btn-sm btn-outline-primary"
                                  onClick={() => openEditCredentials(user)}
                                  title="Edit API credentials"
                                >
                                  <i className="bi bi-key"></i>
                                </button>
                                <button
                                  className="btn btn-sm btn-outline-secondary"
                                  onClick={() => handleDisableZerodhaToken(user.id, user.email)}
                                  title="Disable Zerodha token (keep API credentials)"
                                >
                                  <i className="bi bi-shield-x"></i>
                                </button>
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

          {activeTab === 'auto-auth-schedule' && (
            <div className="card">
              <div className="card-header d-flex justify-content-between align-items-center">
                <h5 className="mb-0">
                  <i className="bi bi-clock-history me-2"></i>
                  Global Auto Authentication Schedule
                </h5>
                <button
                  className="btn btn-sm btn-outline-primary"
                  onClick={loadAutoAuthSchedule}
                  disabled={loadingAutoAuthSchedule}
                >
                  <i className="bi bi-arrow-clockwise me-1"></i>
                  Refresh
                </button>
              </div>
              <div className="card-body">
                {loadingAutoAuthSchedule ? (
                  <div className="text-center py-4">
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="alert alert-info">
                      <i className="bi bi-info-circle me-2"></i>
                      This schedule applies to all users with auto-auth credentials configured.
                      Timezone: <strong>{autoAuthSchedule?.timezone || 'Asia/Kolkata'}</strong>.
                    </div>
                    {autoAuthSchedule?.description && (
                      <p className="mb-3">
                        Current schedule: <strong>{autoAuthSchedule.description}</strong>
                      </p>
                    )}
                    <div className="row g-3 mb-3">
                      <div className="col-md-4">
                        <label htmlFor="admin_auto_auth_time" className="form-label">Time (IST)</label>
                        <input
                          id="admin_auto_auth_time"
                          type="time"
                          className="form-control"
                          value={scheduleTime}
                          onChange={(e) => handleScheduleTimeChange(e.target.value)}
                        />
                      </div>
                      <div className="col-md-8">
                        <label className="form-label d-block">Weekdays</label>
                        <div className="d-flex flex-wrap gap-3">
                          {WEEKDAY_OPTIONS.map((day) => (
                            <div className="form-check" key={day.value}>
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id={`schedule-day-${day.value}`}
                                checked={scheduleWeekdays.includes(day.value)}
                                onChange={() => toggleScheduleWeekday(day.value)}
                              />
                              <label className="form-check-label" htmlFor={`schedule-day-${day.value}`}>
                                {day.label}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    {autoAuthSchedule?.updated_at && (
                      <p className="text-muted small">
                        Last updated: {new Date(autoAuthSchedule.updated_at).toLocaleString('en-IN')}
                        {autoAuthSchedule.updated_by_email ? ` by ${autoAuthSchedule.updated_by_email}` : ''}
                      </p>
                    )}
                    <div className="d-flex justify-content-end">
                      <button
                        className="btn btn-primary"
                        onClick={handleSaveAutoAuthSchedule}
                        disabled={savingAutoAuthSchedule}
                      >
                        {savingAutoAuthSchedule ? 'Saving...' : 'Save Schedule'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'legacy-kite-accounts' && (
            <div className="card">
              <div className="card-header d-flex justify-content-between align-items-center">
                <h5 className="mb-0">
                  <i className="bi bi-key me-2"></i>
                  Legacy Zerodha Credentials ({legacyAccounts.length})
                </h5>
                <div className="d-flex gap-2">
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    style={{ width: '240px' }}
                    placeholder="Search by user/email/key..."
                    value={legacySearch}
                    onChange={(e) => setLegacySearch(e.target.value)}
                  />
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => loadLegacyKiteAccounts()}
                    disabled={loadingLegacyAccounts}
                  >
                    <i className="bi bi-search me-1"></i>
                    Search
                  </button>
                </div>
              </div>
              <div className="card-body">
                <div className="alert alert-danger">
                  <i className="bi bi-exclamation-triangle-fill me-2"></i>
                  Highly sensitive data. Do not share or screenshot these credentials.
                </div>
                {loadingLegacyAccounts ? (
                  <div className="text-center py-4">
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : (
                  <div className="table-responsive">
                    <table className="table table-hover">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Legacy User</th>
                          <th>Name</th>
                          <th>Email</th>
                          <th>API Key</th>
                          <th>Access Token</th>
                          <th>TOTP</th>
                          <th>Password</th>
                          <th>Imported At</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {legacyAccounts.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="text-center text-muted">
                              No legacy accounts imported yet
                            </td>
                          </tr>
                        ) : (
                          legacyAccounts.map((acc) => (
                            <tr key={acc.id}>
                              <td>{acc.id}</td>
                              <td><code>{acc.legacy_user_id}</code></td>
                              <td>{acc.name || 'N/A'}</td>
                              <td>{acc.email || 'N/A'}</td>
                              <td><code>{acc.api_key || 'N/A'}</code></td>
                              <td><code>{acc.access_token || 'N/A'}</code></td>
                              <td><code>{acc.totp_secret || 'N/A'}</code></td>
                              <td><code>{acc.kite_password || 'N/A'}</code></td>
                              <td>{acc.imported_at ? new Date(acc.imported_at).toLocaleString() : 'N/A'}</td>
                              <td>
                                <button
                                  className="btn btn-sm btn-outline-dark"
                                  onClick={() => openLegacyAccountDetail(acc.id)}
                                >
                                  View
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {editingUser && (
        <div
          className="modal show d-block"
          tabIndex={-1}
          role="dialog"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  Zerodha API credentials — {editingUser.email}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={closeEditCredentials}
                  disabled={savingCredentials}
                />
              </div>
              <div className="modal-body">
                <p className="text-muted small mb-3">
                  User ID: {editingUser.id}. Changing credentials clears any active Kite session;
                  the user must use Welcome → Authenticate with Zerodha again.
                </p>
                <p className="small mb-3">
                  Current API key: <code>{maskSensitiveData(editingUser.app_key)}</code>
                  {' · '}
                  Secret: <code>{maskSensitiveData(editingUser.app_secret)}</code>
                </p>
                <div className="form-check mb-3">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="clear-zerodha-credentials"
                    checked={clearCredentials}
                    onChange={(e) => setClearCredentials(e.target.checked)}
                    disabled={savingCredentials}
                  />
                  <label className="form-check-label" htmlFor="clear-zerodha-credentials">
                    Clear Zerodha credentials (remove API key and secret)
                  </label>
                </div>
                {!clearCredentials && (
                  <>
                    <div className="mb-3">
                      <label htmlFor="admin-edit-app-key" className="form-label">
                        Zerodha API Key
                      </label>
                      <input
                        type="text"
                        id="admin-edit-app-key"
                        className="form-control"
                        value={editAppKey}
                        onChange={(e) => setEditAppKey(e.target.value)}
                        placeholder="Enter new API key"
                        disabled={savingCredentials}
                        autoComplete="off"
                      />
                    </div>
                    <div className="mb-3">
                      <label htmlFor="admin-edit-app-secret" className="form-label">
                        Zerodha API Secret
                      </label>
                      <input
                        type="password"
                        id="admin-edit-app-secret"
                        className="form-control"
                        value={editAppSecret}
                        onChange={(e) => setEditAppSecret(e.target.value)}
                        placeholder="Enter new API secret"
                        disabled={savingCredentials}
                        autoComplete="new-password"
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeEditCredentials}
                  disabled={savingCredentials}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveCredentials}
                  disabled={savingCredentials}
                >
                  {savingCredentials ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                      Saving...
                    </>
                  ) : (
                    'Save credentials'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {selectedLegacyAccount && (
        <div
          className="modal show d-block"
          tabIndex={-1}
          role="dialog"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  Legacy credentials detail — {selectedLegacyAccount.legacy_user_id}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => setSelectedLegacyAccount(null)}
                />
              </div>
              <div className="modal-body">
                <div className="alert alert-danger">
                  This record contains raw API secret, TOTP and password data.
                </div>
                <pre className="bg-light p-3 border rounded" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(selectedLegacyAccount, null, 2)}
                </pre>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedLegacyAccount(null)}>
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

export default AdminContent;

