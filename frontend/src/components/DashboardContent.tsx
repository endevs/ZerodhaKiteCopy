import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { apiUrl } from '../config/api';

type VisibilityOption = 'private' | 'public';

const normalizeVisibility = (value?: string | null): VisibilityOption =>
  value && value.toLowerCase() === 'public' ? 'public' : 'private';

const toDate = (raw?: string | null): Date | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasT = trimmed.includes('T');
  const base = hasT ? trimmed : trimmed.replace(' ', 'T');
  const hasTimezone = /([zZ]|[+\-]\d{2}:\d{2})$/.test(base);
  const iso = hasTimezone ? base : `${base}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateTime = (raw?: string | null): string => {
  const date = toDate(raw);
  if (!date) return 'N/A';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const parseJsonField = <T,>(raw: unknown): T | null => {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      console.warn('Failed to parse JSON field:', error);
      return null;
    }
  }
  if (typeof raw === 'object') {
    return raw as T;
  }
  return null;
};

const visibilityBadgeClass = (visibility: VisibilityOption): string =>
  visibility === 'public' ? 'bg-info text-dark' : 'bg-dark';

interface Strategy {
  id: string;
  strategy_name: string;
  strategy_type?: string;
  instrument: string;
  expiry_type: string;
  total_lot: number;
  status: string;
  stop_loss?: number;
  target_profit?: number;
  candle_time?: string;
  start_time?: string;
  end_time?: string;
  segment?: string;
  trade_type?: string;
  strike_price?: string;
  trailing_stop_loss?: number;
  indicators?: string;
  entry_rules?: string;
  exit_rules?: string;
  visibility?: string;
  blueprint?: string;
  created_at?: string;
  updated_at?: string;
  can_edit?: boolean;
  user_id?: number;
  approval_status?: string;
  submitted_for_approval_at?: string;
  approved_at?: string;
  rejected_at?: string;
  rejection_reason?: string;
}

interface SavedStrategiesProps {
  onViewLive: (strategyId: string) => void;
  onStrategyUpdated: number;
  onEditStrategy: (strategy: Strategy) => void;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface StrategyValidation {
  is_valid: boolean;
  missing_sections: string[];
  warnings: string[];
}

interface FlowNode {
  id: string;
  title: string;
  subtitle?: string;
  details: string[];
}

// Advanced builder removed from dashboard per new UX

const REQUIRED_BLUEPRINT_SECTIONS = ['STRATEGY', 'DESCRIPTION', 'EVALUATION', 'RULE', 'ENTRY', 'EXIT'];

interface StrategyInfoContentProps {
  strategy: Strategy;
  onStrategyUpdated: (updatedStrategy: Strategy) => void;
  onClose: () => void;
}

const validateBlueprintFormat = (strategyText: string) => {
  const upperText = strategyText.toUpperCase();
  const missingSections = REQUIRED_BLUEPRINT_SECTIONS.filter((section) => !upperText.includes(section));
  const warnings: string[] = [];
  if (!upperText.includes('WHEN') && !upperText.includes('TRIGGER')) {
    warnings.push('No conditions found (WHEN/TRIGGER).');
  }
  return {
    isValid: missingSections.length === 0,
    missingSections,
    warnings,
  };
};

const extractStrategyName = (strategyText: string): string | null => {
  const match = strategyText.match(/STRATEGY\s+"([^"]+)"/i);
  return match ? match[1].trim() : null;
};

const StrategyInfoContent: React.FC<StrategyInfoContentProps> = ({ strategy, onStrategyUpdated, onClose }) => {
  const parseJson = (raw?: string) => {
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error('Failed to parse strategy JSON block:', error);
      return [];
    }
  };

  const indicators = parseJson(strategy.indicators);
  const entryRules = parseJson(strategy.entry_rules);
  const exitRules = parseJson(strategy.exit_rules);

  const description = useMemo(() => {
    switch (strategy.strategy_type) {
      case 'orb':
        return 'Opening range breakout strategy using configurable time windows.';
      case 'capture_mountain_signal':
        return 'Pattern recognition for mountain formations with confirmation steps.';
      case 'custom':
        return 'Custom strategy defined via the advanced builder.';
      default:
        return 'Algorithmic trading routine.';
    }
  }, [strategy.strategy_type]);

  const visibility = useMemo(
    () => normalizeVisibility(strategy.visibility),
    [strategy.visibility],
  );
  const lastEdited = useMemo(
    () => formatDateTime(strategy.updated_at || strategy.created_at),
    [strategy.updated_at, strategy.created_at],
  );
  const createdAt = useMemo(
    () => formatDateTime(strategy.created_at),
    [strategy.created_at],
  );
  const canEdit = strategy.can_edit !== false;

  const [isEditingBlueprint, setIsEditingBlueprint] = useState(false);
  const [blueprintDraft, setBlueprintDraft] = useState(strategy.blueprint || '');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [savingBlueprint, setSavingBlueprint] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setBlueprintDraft(strategy.blueprint || '');
    setIsEditingBlueprint(false);
    setValidationErrors([]);
    setValidationWarnings([]);
    setSavingBlueprint(false);
    setSaveFeedback(null);
    setSaveError(null);
  }, [strategy]);

  const handleStartEditing = () => {
    setIsEditingBlueprint(true);
    setSaveFeedback(null);
    setSaveError(null);
  };

  const handleCancelEditing = () => {
    setBlueprintDraft(strategy.blueprint || '');
    setIsEditingBlueprint(false);
    setValidationErrors([]);
    setValidationWarnings([]);
    setSaveFeedback(null);
    setSaveError(null);
  };

  const handleSaveBlueprint = async () => {
    const trimmedBlueprint = blueprintDraft.trim();
    if (!trimmedBlueprint) {
      setValidationErrors(['Blueprint cannot be empty.']);
      setValidationWarnings([]);
      return;
    }

    const validation = validateBlueprintFormat(trimmedBlueprint);
    setValidationErrors(validation.missingSections);
    setValidationWarnings(validation.warnings);
    if (!validation.isValid) {
      return;
    }

    const updatedStrategyName = extractStrategyName(trimmedBlueprint) || strategy.strategy_name;

    const indicatorsPayload = parseJsonField<Record<string, any>[]>(strategy.indicators) || [];
    const entryRulesPayload = parseJsonField<Record<string, any>[]>(strategy.entry_rules) || [];
    const exitRulesPayload = parseJsonField<Record<string, any>[]>(strategy.exit_rules) || [];

    const payload = {
      strategy_id: strategy.id,
      strategy: strategy.strategy_type || 'custom',
      'strategy-name': updatedStrategyName || strategy.strategy_name,
      instrument: strategy.instrument || 'NIFTY',
      segment: strategy.segment || 'Option',
      visibility,
      'candle-time': strategy.candle_time || '5',
      'execution-start': strategy.start_time || '09:15',
      'execution-end': strategy.end_time || '15:00',
      'stop-loss': strategy.stop_loss ?? 0,
      'target-profit': strategy.target_profit ?? 0,
      'trailing-stop-loss': strategy.trailing_stop_loss ?? 0,
      'total-lot': strategy.total_lot ?? 1,
      'trade-type': strategy.trade_type || 'Buy',
      'strike-price': strategy.strike_price || 'ATM',
      'expiry-type': strategy.expiry_type || 'Weekly',
      indicators: indicatorsPayload,
      entry_rules: entryRulesPayload,
      exit_rules: exitRulesPayload,
      blueprint: trimmedBlueprint,
    };

    setSavingBlueprint(true);
    setSaveFeedback(null);
    setSaveError(null);
    try {
      const response = await fetch(apiUrl('/api/strategy/save'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data === 'string' ? data : data.message || 'Failed to save blueprint');
      }

      const updatedStrategy: Strategy = {
        ...strategy,
        blueprint: trimmedBlueprint,
        strategy_name: updatedStrategyName || strategy.strategy_name,
        updated_at: new Date().toISOString(),
      };
      onStrategyUpdated(updatedStrategy);
      setSaveFeedback(data.message || 'Blueprint updated successfully.');
      setIsEditingBlueprint(false);
      // Close/minimize the popup after successful save
      onClose();
    } catch (error: any) {
      setSaveError(error.message || 'Failed to update blueprint. Please try again.');
    } finally {
      setSavingBlueprint(false);
    }
  };

  return (
    <div>
      <div className="row g-3 mb-3">
        <div className="col-md-6">
          <strong>Name:</strong> {strategy.strategy_name}
        </div>
        <div className="col-md-6">
          <strong>Type:</strong>{' '}
          <span className="badge bg-primary">
            {strategy.strategy_type || 'custom'}
          </span>
        </div>
        <div className="col-md-4">
          <strong>Instrument:</strong> {strategy.instrument}
        </div>
        <div className="col-md-4">
          <strong>Lots:</strong> {strategy.total_lot}
        </div>
        <div className="col-md-4">
          <strong>Status:</strong>{' '}
          <span className={`badge ${strategy.status === 'running' ? 'bg-success' : 'bg-secondary'}`}>
            {strategy.status || 'saved'}
          </span>
        </div>
        <div className="col-md-4">
          <strong>Visibility:</strong>{' '}
          <span className={`badge ${visibilityBadgeClass(visibility)} ms-2`}>
            {visibility === 'public' ? 'Public' : 'Private'}
          </span>
        </div>
        <div className="col-md-4">
          <strong>Last Edited:</strong> {lastEdited}
        </div>
        <div className="col-md-4">
          <strong>Created:</strong> {createdAt}
        </div>
      </div>

      <p className="text-muted small mb-4">{description}</p>

      <div className="row g-2 mb-4">
        <div className="col-sm-3">
          <div className="card border-warning">
            <div className="card-body text-center">
              <strong className="text-warning d-block">Stop Loss</strong>
              <span>{strategy.stop_loss ?? 0}%</span>
            </div>
          </div>
        </div>
        <div className="col-sm-3">
          <div className="card border-success">
            <div className="card-body text-center">
              <strong className="text-success d-block">Target</strong>
              <span>{strategy.target_profit ?? 0}%</span>
            </div>
          </div>
        </div>
        <div className="col-sm-3">
          <div className="card border-info">
            <div className="card-body text-center">
              <strong className="text-info d-block">Trailing</strong>
              <span>{strategy.trailing_stop_loss ?? 0}%</span>
            </div>
          </div>
        </div>
        <div className="col-sm-3">
          <div className="card border-primary">
            <div className="card-body text-center">
              <strong className="text-primary d-block">Timeframe</strong>
              <span>{strategy.candle_time || '5'} min</span>
            </div>
          </div>
        </div>
      </div>

      {indicators.length > 0 && (
        <div className="mb-3">
          <h6 className="text-primary mb-2">
            <i className="bi bi-graph-up me-2" />
            Indicators
          </h6>
          <div className="row g-2">
            {indicators.map((indicator: any, idx: number) => (
              <div key={idx} className="col-md-6">
                <div className="border rounded p-2">
                  <strong>{indicator.name || indicator.id}</strong>
                  {indicator.params && (
                    <div className="small text-muted">
                      Params:{' '}
                      {Object.entries(indicator.params)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ')}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {entryRules.length > 0 && (
        <div className="mb-3">
          <h6 className="text-success mb-2">
            <i className="bi bi-box-arrow-in-right me-2" />
            Entry Rules
          </h6>
          {entryRules.map((rule: any, idx: number) => (
            <div key={idx} className="border rounded p-2 mb-2">
              <strong>{rule.name || `Entry Rule ${idx + 1}`}</strong>
              {rule.conditions?.length > 0 && (
                <ul className="small mb-0 mt-2">
                  {rule.conditions.map((cond: any, cIdx: number) => (
                    <li key={cIdx}>
                      {cond.indicator} {cond.operator} {cond.value}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {exitRules.length > 0 && (
        <div>
          <h6 className="text-danger mb-2">
            <i className="bi bi-box-arrow-left me-2" />
            Exit Rules
          </h6>
          {exitRules.map((rule: any, idx: number) => (
            <div key={idx} className="border rounded p-2 mb-2">
              <strong>{rule.name || `Exit Rule ${idx + 1}`}</strong>
              {rule.conditions?.length > 0 && (
                <ul className="small mb-0 mt-2">
                  {rule.conditions.map((cond: any, cIdx: number) => (
                    <li key={cIdx}>
                      {cond.indicator} {cond.operator} {cond.value}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h6 className="text-primary mb-0">
            <i className="bi bi-code-square me-2" />
            Strategy Blueprint
          </h6>
          {canEdit && (
            <div className="btn-group btn-group-sm">
              {isEditingBlueprint ? (
                <button className="btn btn-outline-secondary" onClick={handleCancelEditing} disabled={savingBlueprint}>
                  Cancel
                </button>
              ) : (
                <button className="btn btn-outline-primary" onClick={handleStartEditing}>
                  {strategy.blueprint ? 'Edit Blueprint' : 'Add Blueprint'}
                </button>
              )}
            </div>
          )}
        </div>

        {saveFeedback && (
          <div className="alert alert-success py-2">{saveFeedback}</div>
        )}
        {saveError && (
          <div className="alert alert-danger py-2">{saveError}</div>
        )}
        {validationErrors.length > 0 && (
          <div className="alert alert-warning py-2">
            <strong>Missing Sections:</strong> {validationErrors.join(', ')}
          </div>
        )}
        {validationWarnings.length > 0 && (
          <div className="alert alert-info py-2">
            <strong>Warnings:</strong>
            <ul className="mb-0 ps-3">
              {validationWarnings.map((warning, idx) => (
                <li key={idx}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {isEditingBlueprint && canEdit ? (
          <div>
            <textarea
              className="form-control bg-light"
              style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
              rows={12}
              value={blueprintDraft}
              onChange={(event) => setBlueprintDraft(event.target.value)}
              placeholder='STRATEGY "Name" VERSION 1.0 ...'
            />
            <div className="d-flex justify-content-end mt-2">
              <button
                className="btn btn-primary"
                onClick={handleSaveBlueprint}
                disabled={savingBlueprint}
              >
                {savingBlueprint && (
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                )}
                Save Blueprint
              </button>
            </div>
          </div>
        ) : strategy.blueprint ? (
          <pre
            className="bg-light border rounded p-3"
            style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem' }}
          >
            {strategy.blueprint}
          </pre>
        ) : (
          <div className="alert alert-secondary py-2">
            No blueprint saved yet. {canEdit ? 'Click "Add Blueprint" to paste a formatted strategy blueprint.' : ''}
          </div>
        )}
      </div>
    </div>
  );
};

const SavedStrategies: React.FC<SavedStrategiesProps> = ({
  onViewLive,
  onStrategyUpdated,
  onEditStrategy,
  isOpen,
  onToggle,
}) => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const formatTimestamp = useCallback(
    (value?: string | null) => formatDateTime(value),
    [],
  );

  const fetchStrategies = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/api/strategies'), {
        credentials: 'include',
      });
      const data = await response.json();
      if (response.ok && data.status === 'success') {
        setStrategies(data.strategies);
      } else {
        console.error('Error fetching strategies:', data.message);
      }
    } catch (error) {
      console.error('Error fetching strategies:', error);
    }
  }, []);

  useEffect(() => {
    fetchStrategies();
  }, [fetchStrategies, onStrategyUpdated]);

  useEffect(() => {
    const handler = () => fetchStrategies();
    window.addEventListener('refreshStrategies', handler);
    return () => window.removeEventListener('refreshStrategies', handler);
  }, [fetchStrategies]);

  const handleAction = async (
    url: string,
    confirmMessage?: string,
  ): Promise<void> => {
    if (confirmMessage && !window.confirm(confirmMessage)) {
      return;
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data =
        response.headers.get('content-type')?.includes('application/json')
          ? await response.json()
          : await response.text();
      if (!response.ok) {
        throw new Error(
          typeof data === 'string' ? data : data.message || 'Request failed',
        );
      }
      if (typeof data !== 'string') {
        alert(data.message || 'Action completed successfully.');
      }
      fetchStrategies();
    } catch (error: any) {
      console.error('Saved strategies action failed:', error);
      alert(error.message || 'An unexpected error occurred.');
    }
  };

  const handleSubmitForApproval = async (strategyId: string) => {
    await handleAction(
      apiUrl(`/api/strategy/${strategyId}/submit-for-approval`),
      'Submit this strategy for admin approval?',
    );
  };

  const handleRevokeApproval = async (strategyId: string) => {
    await handleAction(
      apiUrl(`/api/strategy/${strategyId}/revoke-approval`),
      'Revoke approval request and return to draft?',
    );
  };

  const handleResubmit = async (strategyId: string) => {
    await handleAction(
      apiUrl(`/api/strategy/${strategyId}/resubmit`),
      'Resubmit this strategy for approval?',
    );
  };

  return (
    <div className="accordion-item mt-3">
      <h2 className="accordion-header" id="saved-strategies-heading">
        <button
          className={`accordion-button ${isOpen ? '' : 'collapsed'}`}
          type="button"
          onClick={() => onToggle(!isOpen)}
          aria-expanded={isOpen}
          aria-controls="saved-strategies"
        >
          Saved Strategies
        </button>
      </h2>
      <div
        id="saved-strategies"
        className={`accordion-collapse collapse ${isOpen ? 'show' : ''}`}
        aria-labelledby="saved-strategies-heading"
        data-bs-parent="#dashboardAccordion"
      >
        <div className="accordion-body">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="mb-0">All Strategies ({strategies.length})</h5>
            <button
              className="btn btn-sm btn-outline-primary"
              onClick={fetchStrategies}
              title="Refresh strategies list"
            >
              <i className="bi bi-arrow-clockwise me-1"></i>
              Refresh
            </button>
          </div>
          <div className="table-responsive">
            <table className="table table-striped align-middle">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Instrument</th>
                  <th>Lots</th>
                  <th>SL / TP</th>
                  <th>Status</th>
                  <th>Approval</th>
                  <th>Visibility</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {strategies.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-muted py-4">
                      <i className="bi bi-inbox fs-1 d-block mb-2" />
                      No strategies saved yet. Build one using the Strategy Builder.
                    </td>
                  </tr>
                ) : (
                  strategies.map((strategy) => {
                    const canEdit = strategy.can_edit !== false;
                    const visibility = normalizeVisibility(strategy.visibility);
                    const lastEditedLabel = formatTimestamp(strategy.updated_at || strategy.created_at);

                    return (
                      <tr key={strategy.id}>
                        <td>
                          <strong>{strategy.strategy_name || 'Unnamed Strategy'}</strong>
                          <button
                            type="button"
                            className="btn btn-link btn-sm ms-2 p-0"
                            title="View details"
                            onClick={() => setSelectedStrategy(strategy)}
                          >
                            <i className="bi bi-info-circle" />
                          </button>
                          <div className="small text-muted">
                            Last edited: {lastEditedLabel}
                          </div>
                        </td>
                        <td>
                          <span className="badge bg-secondary">
                            {strategy.strategy_type || 'custom'}
                          </span>
                        </td>
                        <td>{strategy.instrument || 'N/A'}</td>
                        <td>{strategy.total_lot || 1}</td>
                        <td>
                          <small>
                            SL {strategy.stop_loss ?? 0}% / TP {strategy.target_profit ?? 0}%
                          </small>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              strategy.status === 'running'
                                ? 'bg-success'
                                : strategy.status === 'paused'
                                ? 'bg-warning'
                                : strategy.status === 'error'
                                ? 'bg-danger'
                                : strategy.status === 'sq_off'
                                ? 'bg-info'
                                : 'bg-secondary'
                            }`}
                          >
                            {strategy.status || 'saved'}
                          </span>
                        </td>
                        <td>
                          {(() => {
                            const approvalStatus = strategy.approval_status || 'draft';
                            const badgeClass = 
                              approvalStatus === 'approved' ? 'bg-success' :
                              approvalStatus === 'pending' ? 'bg-warning' :
                              approvalStatus === 'rejected' ? 'bg-danger' :
                              'bg-secondary';
                            const statusLabel = 
                              approvalStatus === 'approved' ? 'Approved' :
                              approvalStatus === 'pending' ? 'Pending' :
                              approvalStatus === 'rejected' ? 'Rejected' :
                              'Draft';
                            return (
                              <span className={`badge ${badgeClass}`}>
                                {statusLabel}
                              </span>
                            );
                          })()}
                          {strategy.rejection_reason && (
                            <div className="small text-danger mt-1" title={strategy.rejection_reason}>
                              <i className="bi bi-exclamation-triangle" /> Rejected
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${visibilityBadgeClass(visibility)}`}>
                            {visibility === 'public' ? 'Public' : 'Private'}
                          </span>
                          {!canEdit && (
                            <div className="small text-muted mt-1">Shared by another user</div>
                          )}
                        </td>
                        <td className="text-end">
                          {canEdit ? (
                            <div className="btn-group btn-group-sm" role="group">
                              <button
                                className="btn btn-outline-primary"
                                title="Live monitor"
                                onClick={() => onViewLive(strategy.id)}
                              >
                                <i className="bi bi-activity" />
                              </button>
                              <button
                                className="btn btn-outline-info"
                                title="Edit"
                                onClick={() => onEditStrategy(strategy)}
                              >
                                <i className="bi bi-pencil" />
                              </button>
                              {(() => {
                                const approvalStatus = strategy.approval_status || 'draft';
                                const canDeploy = approvalStatus === 'approved' && 
                                  (strategy.status === 'saved' ||
                                   strategy.status === 'paused' ||
                                   strategy.status === 'error' ||
                                   strategy.status === 'sq_off');
                                
                                if (canDeploy) {
                                  return (
                                    <button
                                      className="btn btn-outline-success"
                                      title="Deploy"
                                      onClick={() =>
                                        handleAction(
                                        apiUrl(`/api/strategy/deploy/${strategy.id}`),
                                        )
                                      }
                                    >
                                      <i className="bi bi-play-fill" />
                                    </button>
                                  );
                                }
                                return null;
                              })()}
                              {(() => {
                                const approvalStatus = strategy.approval_status || 'draft';
                                if (approvalStatus === 'draft' && canEdit) {
                                  return (
                                    <button
                                      className="btn btn-outline-primary"
                                      title="Send for Approval"
                                      onClick={() => handleSubmitForApproval(strategy.id)}
                                    >
                                      <i className="bi bi-send" />
                                    </button>
                                  );
                                }
                                if (approvalStatus === 'pending' && canEdit) {
                                  return (
                                    <button
                                      className="btn btn-outline-warning"
                                      title="Revoke Approval"
                                      onClick={() => handleRevokeApproval(strategy.id)}
                                    >
                                      <i className="bi bi-arrow-counterclockwise" />
                                    </button>
                                  );
                                }
                                if (approvalStatus === 'approved' && canEdit) {
                                  return (
                                    <button
                                      className="btn btn-outline-warning"
                                      title="Revoke Approval (reset to draft)"
                                      onClick={() => handleRevokeApproval(strategy.id)}
                                    >
                                      <i className="bi bi-arrow-counterclockwise" />
                                    </button>
                                  );
                                }
                                if (approvalStatus === 'rejected' && canEdit) {
                                  return (
                                    <button
                                      className="btn btn-outline-primary"
                                      title="Resubmit for Approval"
                                      onClick={() => handleResubmit(strategy.id)}
                                    >
                                      <i className="bi bi-arrow-repeat" />
                                    </button>
                                  );
                                }
                                return null;
                              })()}
                              {strategy.status === 'running' && (
                                <button
                                  className="btn btn-outline-warning"
                                  title="Pause"
                                  onClick={() =>
                                    handleAction(
                                    apiUrl(`/api/strategy/pause/${strategy.id}`),
                                    )
                                  }
                                >
                                  <i className="bi bi-pause-fill" />
                                </button>
                              )}
                              {(() => {
                                const approvalStatus = strategy.approval_status || 'draft';
                                const canDelete = ['draft', 'rejected'].includes(approvalStatus);
                                if (canDelete) {
                                  return (
                                    <button
                                      className="btn btn-outline-danger"
                                      title="Delete"
                                      onClick={() =>
                                        handleAction(
                                          apiUrl(`/api/strategy/delete/${strategy.id}`),
                                          'Delete this strategy permanently?',
                                        )
                                      }
                                    >
                                      <i className="bi bi-trash" />
                                    </button>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          ) : (
                            <span className="badge bg-light text-muted">View only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {selectedStrategy && (
        <div
          className="modal fade show d-block"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setSelectedStrategy(null)}
        >
          <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content" onClick={(event) => event.stopPropagation()}>
              <div className="modal-header bg-primary text-white">
                <h5 className="modal-title">
                  <i className="bi bi-info-circle me-2" />
                  Strategy Details — {selectedStrategy.strategy_name}
                </h5>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => setSelectedStrategy(null)}
                />
              </div>
              <div className="modal-body">
                <StrategyInfoContent
                  strategy={selectedStrategy}
                  onStrategyUpdated={(updated) => {
                    setSelectedStrategy(updated);
                    fetchStrategies();
                  }}
                  onClose={() => setSelectedStrategy(null)}
                />
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedStrategy(null)}
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

const StrategyFlowDiagram: React.FC<{ nodes: FlowNode[] }> = ({ nodes }) => (
  <div className="card border-0 shadow-sm h-100">
    <div className="card-header bg-info text-white">
      <h6 className="mb-0">
        <i className="bi bi-diagram-3 me-2" />
        Strategy Flow Diagram
      </h6>
    </div>
    <div className="card-body">
      {nodes.length === 0 ? (
        <div className="text-center text-muted py-5">
          <i className="bi bi-diagram-3 fs-1 d-block mb-3" />
          Generate a strategy to view the execution flow.
        </div>
      ) : (
        <div className="position-relative ps-4">
          <div
            className="position-absolute top-0 bottom-0 start-0 bg-secondary"
            style={{ width: '2px', opacity: 0.3 }}
          />
          {nodes.map((node, index) => (
            <div key={node.id} className="mb-4 position-relative">
              <span
                className="position-absolute translate-middle badge rounded-pill bg-primary"
                style={{ left: '-18px', top: '0' }}
              >
                {index + 1}
              </span>
              <div className="ps-3">
                <h6 className="mb-1">{node.title}</h6>
                {node.subtitle && (
                  <small className="text-muted d-block mb-1">{node.subtitle}</small>
                )}
                <ul className="list-unstyled small mb-0">
                  {node.details.map((detail, detailIdx) => (
                    <li key={`${node.id}-${detailIdx}`}>• {detail}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);

const buildFlowNodes = (strategyText: string): FlowNode[] => {
  if (!strategyText) return [];

  const nodes: FlowNode[] = [];

  const strategyMatch = strategyText.match(/STRATEGY\s+"([^"]+)"\s+VERSION\s+([^\n]+)/i);
  if (strategyMatch) {
    nodes.push({
      id: 'strategy',
      title: `Strategy: ${strategyMatch[1]}`,
      subtitle: `Version ${strategyMatch[2].trim()}`,
      details: [],
    });
  }

  const descriptionMatch = strategyText.match(/DESCRIPTION\s+"([^"]+)"/i);
  if (descriptionMatch) {
    nodes.push({
      id: 'description',
      title: 'Description',
      details: [descriptionMatch[1]],
    });
  }

  const scheduleMatch = strategyText.match(/SCHEDULE\s+every\s+([^\n]+)/i);
  const timingMatch = strategyText.match(/TIMING\s+evaluate\s+([^\n]+)/i);
  if (scheduleMatch || timingMatch) {
    nodes.push({
      id: 'timing',
      title: 'Evaluation Window',
      details: [
        scheduleMatch ? `Schedule: every ${scheduleMatch[1]}` : 'Schedule not specified',
        timingMatch ? `Timing: evaluate ${timingMatch[1]}` : 'Timing not specified',
      ],
    });
  }

  const ruleRegex = /RULE\s+"([^"]+)"([\s\S]*?)(?=\nRULE|\nENTRY|\nEXIT|$)/gi;
  let ruleMatch: RegExpExecArray | null;
  while ((ruleMatch = ruleRegex.exec(strategyText)) !== null) {
    const lines = ruleMatch[2]
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6);
    nodes.push({
      id: `rule-${nodes.length}`,
      title: `Rule: ${ruleMatch[1]}`,
      details: lines,
    });
  }

  const extractBlock = (label: string) => {
    const lines = strategyText.split(/\r?\n/);
    const startIndex = lines.findIndex((line) =>
      line.trim().toUpperCase().startsWith(label.toUpperCase()),
    );
    if (startIndex === -1) return null;

    const details: string[] = [];
    for (let i = startIndex + 1; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (!trimmed) {
        continue;
      }

      const isHeading =
        /^[A-Z0-9][A-Z0-9\s:&()]*$/.test(trimmed) &&
        !trimmed.startsWith('-') &&
        !trimmed.startsWith('•');

      if (isHeading) {
        break;
      }

      details.push(trimmed);
      if (details.length >= 6) {
        break;
      }
    }

    return details.length > 0 ? details : null;
  };

  const entryBlock = extractBlock('ENTRY');
  if (entryBlock) {
    nodes.push({
      id: 'entry',
      title: 'Entry Logic',
      details: entryBlock,
    });
  }

  const exitBlock = extractBlock('EXIT');
  if (exitBlock) {
    nodes.push({
      id: 'exit',
      title: 'Exit Logic',
      details: exitBlock,
    });
  }

  return nodes;
};

interface AIEnabledStrategyChatProps {
  // Load a blueprint into the editor (from Saved Strategies edit)
  incomingBlueprint?: string | null;
  // Strategy being edited (when editing existing)
  editingStrategy?: Strategy | null;
  // Notify parent after a successful save to refresh lists
  onStrategySaved?: () => void;
  // When incoming blueprint has been consumed
  onBlueprintConsumed?: () => void;
}

const AIEnabledStrategyChat: React.FC<AIEnabledStrategyChatProps> = ({
  incomingBlueprint,
  editingStrategy,
  onStrategySaved,
  onBlueprintConsumed,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestStrategy, setLatestStrategy] = useState('');
  const [latestValidation, setLatestValidation] = useState<StrategyValidation | null>(null);
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null);
  const [isEditingBlueprint, setIsEditingBlueprint] = useState(false);
  const [draftBlueprint, setDraftBlueprint] = useState('');
  const [strategyName, setStrategyName] = useState<string>('');
  const [blueprintMaximized, setBlueprintMaximized] = useState(false);
  const [visibilitySelection, setVisibilitySelection] = useState<VisibilityOption>('private');
  const chatBodyRef = useRef<HTMLDivElement | null>(null);

  // Consume incoming blueprint (from Saved Strategies Edit)
  useEffect(() => {
    if (incomingBlueprint && incomingBlueprint.trim()) {
      setLatestStrategy(incomingBlueprint);
      setDraftBlueprint(incomingBlueprint);
      setIsEditingBlueprint(true);
      setError(null);
      setLastSavedPath(null);
      setStrategyName(extractStrategyName(incomingBlueprint) || (editingStrategy?.strategy_name ?? ''));
      setVisibilitySelection(normalizeVisibility(editingStrategy?.visibility));
      onBlueprintConsumed && onBlueprintConsumed();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [incomingBlueprint, onBlueprintConsumed]);

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages]);

  const historyPayload = useCallback(
    (history: ChatMessage[]) =>
      history.slice(-10).map(({ role, content }) => ({ role, content })),
    [],
  );

  const flowNodes = useMemo(() => buildFlowNodes(latestStrategy), [latestStrategy]);

  // Keep strategyName in sync with latestStrategy content or selected strategy
  useEffect(() => {
    const nameFromBlueprint = extractStrategyName(latestStrategy || '');
    if (nameFromBlueprint) {
      setStrategyName(nameFromBlueprint);
    } else if (editingStrategy?.strategy_name) {
      setStrategyName(editingStrategy.strategy_name);
    }
    if (editingStrategy) {
      setVisibilitySelection(normalizeVisibility(editingStrategy.visibility));
    }
  }, [latestStrategy, editingStrategy?.strategy_name, editingStrategy]);

  const ensureStrategyNameInBlueprint = (text: string): string => {
    const hasName = /STRATEGY\s+"[^"]+"/i.test(text);
    if (hasName) return text;
    const suggested = (strategyName || '').trim() || window.prompt('Enter a strategy name to save:', 'My Strategy');
    if (!suggested) {
      throw new Error('Strategy name is required to save.');
    }
    setStrategyName(suggested);
    return `STRATEGY "${suggested}" VERSION 1.0\n` + text;
  };

  const applyStrategyNameToBlueprint = (text: string, name: string): string => {
    if (!name?.trim()) return text;
    const hasLine = /STRATEGY\s+"[^"]+"\s+VERSION\s+[^\n]+/i.test(text);
    if (hasLine) {
      return text.replace(/STRATEGY\s+"[^"]+"\s+VERSION\s+([^\n]+)/i, `STRATEGY "${name.trim()}" VERSION $1`);
    }
    return `STRATEGY "${name.trim()}" VERSION 1.0\n` + text;
  };

  const handleSend = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || loading) {
      return;
    }

    const timestamp = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: `user-${timestamp}`,
      role: 'user',
      content: trimmed,
      timestamp,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setError(null);
    setLastSavedPath(null);
    setLoading(true);

    try {
      const response = await fetch(apiUrl('/api/ai/strategy_chat'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          message: trimmed,
          history: historyPayload([...messages, userMessage]),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to generate strategy');
      }

      const data = await response.json();

      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: data.strategy
            ? 'Strategy blueprint generated. Review the formatted output on the right.'
            : data.message || 'Response received.',
          timestamp: new Date().toISOString(),
        },
      ]);

      setLatestStrategy(typeof data.strategy === 'string' ? data.strategy : '');
      setDraftBlueprint(typeof data.strategy === 'string' ? data.strategy : '');
      if (typeof data.strategy === 'string') {
        setStrategyName(extractStrategyName(data.strategy) || strategyName || '');
      }
      setLatestValidation(data.validation ?? null);
      if (data.savedPath) {
        setLastSavedPath(data.savedPath);
      }
    } catch (apiError: any) {
      console.error('AI assistant error:', apiError);
      setError(apiError.message || 'Unexpected error occurred while generating strategy');
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content:
            '⚠️ Unable to generate strategy. Please try again or refine your request.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStrategy = async () => {
    const blueprintToSave = (isEditingBlueprint ? draftBlueprint : latestStrategy).trim();
    if (!blueprintToSave || loading) return;
    setLoading(true);
    setError(null);
    try {
      // Enforce: Only approved strategies can be made public
      if (visibilitySelection === 'public') {
        const status = editingStrategy?.approval_status || 'draft';
        if (status !== 'approved') {
          setError('Only approved strategies can be made public. Please get approval first.');
          setLoading(false);
          return;
        }
      }
      // If editing existing strategy, use /api/strategy/save with strategy fields preserved
      if (editingStrategy) {
        const validationLocal = validateBlueprintFormat(blueprintToSave);
        if (!validationLocal.isValid) {
          setLatestValidation({
            is_valid: false,
            missing_sections: validationLocal.missingSections,
            warnings: validationLocal.warnings,
          });
          throw new Error('Blueprint format incomplete. Please fill required sections.');
        }
        // Build payload based on existing strategy, only replacing blueprint and name if present
        const desiredName =
          (strategyName && strategyName.trim()) ||
          extractStrategyName(blueprintToSave) ||
          editingStrategy.strategy_name;
        const blueprintWithName = applyStrategyNameToBlueprint(blueprintToSave, desiredName || 'My Strategy');
        const indicatorsPayload = parseJsonField<Record<string, any>[]>(editingStrategy.indicators) || [];
        const entryRulesPayload = parseJsonField<Record<string, any>[]>(editingStrategy.entry_rules) || [];
        const exitRulesPayload = parseJsonField<Record<string, any>[]>(editingStrategy.exit_rules) || [];
        const payload = {
          strategy_id: editingStrategy.id,
          strategy: editingStrategy.strategy_type || 'custom',
          'strategy-name': desiredName || editingStrategy.strategy_name,
          instrument: editingStrategy.instrument || 'NIFTY',
          segment: editingStrategy.segment || 'Option',
          visibility: visibilitySelection,
          'candle-time': editingStrategy.candle_time || '5',
          'candle_time': editingStrategy.candle_time || '5',
          'execution-start': editingStrategy.start_time || '09:15',
          'execution_start': editingStrategy.start_time || '09:15',
          'execution-end': editingStrategy.end_time || '15:00',
          'execution_end': editingStrategy.end_time || '15:00',
          'stop-loss': Number(editingStrategy.stop_loss ?? 0),
          'stop_loss': Number(editingStrategy.stop_loss ?? 0),
          'target-profit': Number(editingStrategy.target_profit ?? 0),
          'target_profit': Number(editingStrategy.target_profit ?? 0),
          'trailing-stop-loss': Number(editingStrategy.trailing_stop_loss ?? 0),
          'trailing_stop_loss': Number(editingStrategy.trailing_stop_loss ?? 0),
          'total-lot': Number(editingStrategy.total_lot ?? 1),
          'total_lot': Number(editingStrategy.total_lot ?? 1),
          'trade-type': editingStrategy.trade_type || 'Buy',
          'trade_type': editingStrategy.trade_type || 'Buy',
          'strike-price': editingStrategy.strike_price || 'ATM',
          'strike_price': editingStrategy.strike_price || 'ATM',
          'expiry-type': editingStrategy.expiry_type || 'Weekly',
          'expiry_type': editingStrategy.expiry_type || 'Weekly',
          indicators: indicatorsPayload,
          entry_rules: entryRulesPayload,
          exit_rules: exitRulesPayload,
          blueprint: blueprintWithName,
        };
        const response = await fetch(apiUrl('/api/strategy/save'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(typeof data === 'string' ? data : data.message || 'Failed to save strategy');
        }
        setLastSavedPath(data.message || 'Strategy updated.');
        setLatestStrategy('');
        setDraftBlueprint('');
        setStrategyName('');
        setLatestValidation(null);
        setMessages([]);
        setIsEditingBlueprint(false);
        onStrategySaved && onStrategySaved();
        return;
      }

      // Creating a new strategy from AI blueprint
      let blueprintText = blueprintToSave;
      try {
        blueprintText = ensureStrategyNameInBlueprint(blueprintToSave);
      } catch (namingError: any) {
        setError(namingError.message);
        return;
      }
      const validationLocal = validateBlueprintFormat(blueprintText);
      if (!validationLocal.isValid) {
        setLatestValidation({
          is_valid: false,
          missing_sections: validationLocal.missingSections,
          warnings: validationLocal.warnings,
        });
        throw new Error('Blueprint format incomplete. Please fill required sections.');
      }
      // Build minimal payload for new strategy with sensible defaults
      const createdName =
        (strategyName && strategyName.trim()) ||
        extractStrategyName(blueprintText) ||
        'New Strategy';
      const blueprintWithName = applyStrategyNameToBlueprint(blueprintText, createdName);
      const payloadNew = {
        strategy: 'custom',
        'strategy-name': createdName,
        instrument: 'NIFTY',
        segment: 'Option',
        visibility: visibilitySelection,
        'candle-time': '5',
        'candle_time': '5',
        'execution-start': '09:15',
        'execution_start': '09:15',
        'execution-end': '15:00',
        'execution_end': '15:00',
        'stop-loss': 0,
        'stop_loss': 0,
        'target-profit': 0,
        'target_profit': 0,
        'trailing-stop-loss': 0,
        'trailing_stop_loss': 0,
        'total-lot': 1,
        'total_lot': 1,
        'trade-type': 'Buy',
        'trade_type': 'Buy',
        'strike-price': 'ATM',
        'strike_price': 'ATM',
        'expiry-type': 'Weekly',
        'expiry_type': 'Weekly',
        indicators: [],
        entry_rules: [],
        exit_rules: [],
        blueprint: blueprintWithName,
      };
      const response = await fetch(apiUrl('/api/strategy/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payloadNew),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data === 'string' ? data : data.message || 'Failed to save strategy');
      }
      setLastSavedPath(data.message || 'Strategy saved.');
      setLatestValidation(null);
      setLatestStrategy('');
      setDraftBlueprint('');
      setStrategyName('');
      setVisibilitySelection('private');
      setMessages([]);
      setIsEditingBlueprint(false);
      onStrategySaved && onStrategySaved();
    } catch (saveError: any) {
      console.error('Error saving strategy:', saveError);
      setError(saveError.message || 'An error occurred while saving the strategy');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyStrategy = async () => {
    if (!latestStrategy) return;
    try {
      await navigator.clipboard.writeText(latestStrategy);
      setLastSavedPath('Copied to clipboard');
    } catch (copyError: any) {
      console.error('Failed to copy strategy:', copyError);
      setError('Failed to copy strategy to clipboard');
    }
  };

  const startEditing = () => {
    setIsEditingBlueprint(true);
    setDraftBlueprint(latestStrategy);
    setError(null);
    setLastSavedPath(null);
  };

  const handleApplyEditsOnly = () => {
    const trimmed = (draftBlueprint || '').trim();
    if (!trimmed) {
      setError('Blueprint cannot be empty.');
      return;
    }
    // Apply edits locally without saving to DB
    setLatestStrategy(trimmed);
    const extracted = extractStrategyName(trimmed);
    if (extracted) {
      setStrategyName(extracted);
    }
    const validationLocal = validateBlueprintFormat(trimmed);
    setLatestValidation({
      is_valid: validationLocal.isValid,
      missing_sections: validationLocal.missingSections,
      warnings: validationLocal.warnings,
    });
    setIsEditingBlueprint(false);
    setLastSavedPath('Edits applied (not saved)');
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const renderValidation = () => {
    if (!latestValidation) return null;
    return (
      <div className="mt-3">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span
            className={`badge ${
              latestValidation.is_valid ? 'bg-success' : 'bg-warning text-dark'
            }`}
          >
            {latestValidation.is_valid ? 'Format Valid' : 'Needs Attention'}
          </span>
          {lastSavedPath && (
            <span className="badge bg-info text-dark">{lastSavedPath}</span>
          )}
        </div>
        {latestValidation.missing_sections?.length > 0 && (
          <div className="alert alert-warning mt-3 py-2 px-3">
            <strong>Missing Sections:</strong>{' '}
            {latestValidation.missing_sections.join(', ')}
          </div>
        )}
        {latestValidation.warnings?.length > 0 && (
          <div className="alert alert-info mt-2 py-2 px-3">
            <strong>Warnings:</strong>
            <ul className="mb-0 ps-3">
              {latestValidation.warnings.map((warning, idx) => (
                <li key={idx}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="card border-0 shadow-sm mt-4">
      <div className="card-header bg-dark text-white d-flex align-items-center justify-content-between">
        <div>
          <h5 className="card-title mb-0">
            <i className="bi bi-robot me-2" />
            AI Strategy Assistant
          </h5>
          <small className="text-white-50">
            Describe trading ideas in natural language and receive production-ready blueprints.
          </small>
        </div>
        {editingStrategy && (
          <span className="badge bg-primary">
            Editing: {editingStrategy.strategy_name || 'Selected Strategy'}
          </span>
        )}
        {loading && (
          <span className="badge bg-secondary">
            <span className="spinner-border spinner-border-sm me-2" role="status" />
            Generating...
          </span>
        )}
      </div>
      <div className="card-body">
        {error && (
          <div className="alert alert-danger d-flex align-items-center" role="alert">
            <i className="bi bi-exclamation-triangle-fill me-2" />
            <div>{error}</div>
          </div>
        )}
        <div className="row g-4">
          <div className="col-xl-4 col-lg-6 col-12">
            <div className="border rounded p-3 h-100 d-flex flex-column">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h6 className="mb-0">
                  <i className="bi bi-chat-text-fill me-2 text-primary" />
                  Conversation
                </h6>
                <span className="badge bg-light text-muted">
                  {messages.length} messages
                </span>
              </div>
              <div
                ref={chatBodyRef}
                className="flex-grow-1 overflow-auto bg-light rounded p-3"
                style={{ maxHeight: '420px' }}
              >
                {messages.length === 0 ? (
                  <div className="text-center text-muted py-5">
                    <i className="bi bi-stars fs-1 d-block mb-3" />
                    Ask the assistant to design a strategy. Example:
                    <div className="mt-3">
                      <code>
                        Build a BankNifty PE strategy when RSI crosses 70 on 5 minute candles.
                      </code>
                    </div>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`mb-3 d-flex ${
                        msg.role === 'user' ? 'justify-content-end' : 'justify-content-start'
                      }`}
                    >
                      <div
                        className={`p-3 rounded shadow-sm ${
                          msg.role === 'user'
                            ? 'bg-primary text-white'
                            : 'bg-white border'
                        }`}
                        style={{ maxWidth: '85%' }}
                      >
                        <div className="small text-muted mb-1">
                          {msg.role === 'user' ? 'You' : 'Assistant'} ·{' '}
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-3">
                <label htmlFor="ai-strategy-input" className="form-label fw-semibold">
                  Describe your strategy idea
                </label>
                <textarea
                  id="ai-strategy-input"
                  className="form-control"
                  placeholder="E.g., Create a momentum breakout strategy using 5m BankNifty candles with EMA and volume confirmation..."
                  rows={3}
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                />
                <div className="d-flex justify-content-end mt-2 gap-2">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setInputValue('')}
                    disabled={loading || inputValue.length === 0}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSend}
                    disabled={loading || inputValue.trim().length === 0}
                  >
                    <i className="bi bi-send-fill me-2" />
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="col-xl-4 col-lg-6 col-12">
            {/* Backdrop when maximized */}
            {blueprintMaximized && (
              <div
                className="position-fixed top-0 start-0 end-0 bottom-0 bg-dark"
                style={{ opacity: 0.5, zIndex: 1050 }}
              />
            )}
            <div
              className="border rounded p-3 d-flex flex-column bg-light"
              style={
                blueprintMaximized
                  ? {
                      position: 'fixed',
                      zIndex: 1060,
                      top: '4%',
                      left: '4%',
                      right: '4%',
                      bottom: '4%',
                      maxHeight: 'none',
                    }
                  : { height: '100%' }
              }
            >
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h6 className="mb-0">
                  <i className="bi bi-file-code-fill me-2 text-success" />
                  Generated Strategy Blueprint
                </h6>
                <div className="btn-group btn-group-sm">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={handleCopyStrategy}
                    disabled={!latestStrategy}
                  >
                    <i className="bi bi-clipboard me-2" />
                    Copy
                  </button>
                  {isEditingBlueprint ? (
                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={handleApplyEditsOnly}
                      disabled={!draftBlueprint}
                      title="Apply edits to the blueprint preview (does not save to database)"
                    >
                      <i className="bi bi-check2 me-2" />
                      Apply Edits
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={startEditing}
                      disabled={!latestStrategy}
                    >
                      <i className="bi bi-pencil-square me-2" />
                      Edit
                    </button>
                  )}
                  {isEditingBlueprint && (
                    <button
                      type="button"
                      className="btn btn-outline-dark"
                      onClick={() => setBlueprintMaximized((v) => !v)}
                      title={blueprintMaximized ? 'Exit full screen' : 'Full screen editor'}
                    >
                      <i className={`bi ${blueprintMaximized ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'} me-2`} />
                      {blueprintMaximized ? 'Exit' : 'Maximize'}
                    </button>
                  )}
                </div>
              </div>
              <div className="mb-2">
                <label htmlFor="strategy-name-input" className="form-label small mb-1">
                  Strategy Name
                </label>
                <input
                  id="strategy-name-input"
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="Enter a strategy name"
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                />
              </div>
              <div className="mb-2">
                <label htmlFor="strategy-visibility-select" className="form-label small mb-1">
                  Visibility
                </label>
                <select
                  id="strategy-visibility-select"
                  className="form-select form-select-sm"
                  value={visibilitySelection}
                  onChange={(e) => {
                    const nextVis = normalizeVisibility(e.target.value);
                    if (nextVis === 'public') {
                      const status = editingStrategy?.approval_status || 'draft';
                      if (status !== 'approved') {
                        setError('Only approved strategies can be made public. Please get approval first.');
                        setVisibilitySelection('private');
                        return;
                      }
                    }
                    setVisibilitySelection(nextVis);
                  }}
                  disabled={!editingStrategy && !latestStrategy}
                >
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
              </div>
              <div
                className="bg-white border rounded p-3 flex-grow-1 overflow-auto"
                style={
                  blueprintMaximized
                    ? { maxHeight: 'none' }
                    : { maxHeight: '420px' }
                }
              >
                {isEditingBlueprint ? (
                  <textarea
                    className="form-control"
                    style={
                      blueprintMaximized
                        ? {
                            fontFamily: 'monospace',
                            fontSize: '0.9rem',
                            height: 'calc(100vh - 280px)',
                          }
                        : {
                            fontFamily: 'monospace',
                            fontSize: '0.85rem',
                            height: '100%',
                          }
                    }
                    value={draftBlueprint}
                    onChange={(e) => setDraftBlueprint(e.target.value)}
                  />
                ) : latestStrategy ? (
                  <pre
                    className="mb-0"
                    style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem' }}
                  >
                    {latestStrategy}
                  </pre>
                ) : (
                  <div className="text-muted text-center py-5">
                    <i className="bi bi-journal-code fs-1 d-block mb-3" />
                    Generated strategy code will appear here once the assistant responds.
                  </div>
                )}
              </div>
              {renderValidation()}
              {!isEditingBlueprint && latestStrategy && (
                <div className="mt-2 d-flex justify-content-end">
                  <button
                    type="button"
                    className="btn btn-success"
                    onClick={handleSaveStrategy}
                    disabled={!latestStrategy || loading}
                    title="Save this blueprint directly without editing"
                  >
                    <i className="bi bi-save me-2" />
                    Save Blueprint
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="col-xl-4 col-12">
            <StrategyFlowDiagram nodes={flowNodes} />
          </div>
        </div>
      </div>
    </div>
  );
};

interface DashboardContentProps {
  onViewLiveStrategy: (strategyId: string) => void;
}

const DashboardContent: React.FC<DashboardContentProps> = ({ onViewLiveStrategy }) => {
  const [refreshStrategies, setRefreshStrategies] = useState(0);
  const [aiEditingStrategy, setAiEditingStrategy] = useState<Strategy | null>(null);
  const [savedOpen, setSavedOpen] = useState(true);
  const [incomingBlueprint, setIncomingBlueprint] = useState<string | null>(null);

  const handleStrategySaved = () => {
    setRefreshStrategies((prev) => prev + 1);
    setAiEditingStrategy(null);
    setSavedOpen(true);
    setIncomingBlueprint(null);
  };

  const handleEditStrategy = (strategy: Strategy) => {
    setAiEditingStrategy(strategy);
    setIncomingBlueprint(strategy.blueprint || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="pb-4" id="dashboard-content">
      <AIEnabledStrategyChat
        incomingBlueprint={incomingBlueprint}
        editingStrategy={aiEditingStrategy}
        onStrategySaved={handleStrategySaved}
        onBlueprintConsumed={() => setIncomingBlueprint(null)}
      />
      <div className="accordion mt-4" id="dashboardAccordion">
        <SavedStrategies
          onViewLive={onViewLiveStrategy}
          onStrategyUpdated={refreshStrategies}
          onEditStrategy={handleEditStrategy}
          isOpen={savedOpen}
          onToggle={setSavedOpen}
        />
      </div>
    </div>
  );
};

export default DashboardContent;
