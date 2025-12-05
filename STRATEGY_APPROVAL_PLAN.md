# Strategy Approval Workflow - Implementation Plan

## Overview
Implement a comprehensive strategy approval system where users can create strategies, submit them for admin approval, and only approved strategies can be deployed/traded.

## Database Schema Changes

### Add to `strategies` table:
```sql
ALTER TABLE strategies ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE strategies ADD COLUMN submitted_for_approval_at DATETIME;
ALTER TABLE strategies ADD COLUMN approved_at DATETIME;
ALTER TABLE strategies ADD COLUMN approved_by INTEGER;  -- admin user_id
ALTER TABLE strategies ADD COLUMN rejected_at DATETIME;
ALTER TABLE strategies ADD COLUMN rejected_by INTEGER;  -- admin user_id
ALTER TABLE strategies ADD COLUMN rejection_reason TEXT;
```

### Approval Status Values:
- `draft` - Default when created, user can edit/delete
- `pending` - Submitted for approval, user can revoke
- `approved` - Admin approved, can be deployed/traded
- `rejected` - Admin rejected, user can resubmit

## User Workflow

### 1. Strategy Creation
- New strategies default to `approval_status = 'draft'`
- User can edit, delete, or send for approval
- Draft strategies are NOT visible in dropdowns

### 2. Send for Approval
- User clicks "Send for Approval" button
- Status changes: `draft` → `pending`
- `submitted_for_approval_at` = current timestamp
- Strategy becomes read-only for user (can only revoke)
- Appears in admin's pending approval list

### 3. Revoke from Approval
- Only available when status is `pending`
- Status changes: `pending` → `draft`
- Clears `submitted_for_approval_at`
- User can edit/delete again

### 4. Delete Strategy
- Only allowed if:
  - User is the owner (`user_id` matches)
  - Status is `draft` or `rejected`
  - NOT if status is `pending` or `approved` (need to revoke first)

### 5. Deploy/Paper Trade/Backtest
- Only allowed if `approval_status = 'approved'`
- Filter dropdowns to show only approved strategies

## Admin Workflow

### 1. View Pending Strategies
- New tab in Admin section: "Strategy Approvals"
- List all strategies with `approval_status = 'pending'`
- Show: Strategy name, user email, created date, submitted date

### 2. Approve Strategy
- Admin clicks "Approve" button
- Status changes: `pending` → `approved`
- `approved_at` = current timestamp
- `approved_by` = admin user_id
- Strategy becomes available for deployment

### 3. Reject Strategy
- Admin clicks "Reject" button
- Optional: Enter rejection reason
- Status changes: `pending` → `rejected`
- `rejected_at` = current timestamp
- `rejected_by` = admin user_id
- `rejection_reason` = admin's reason
- User can see rejection reason and resubmit

## Frontend Changes

### 1. Strategy List/Table
- Add "Approval Status" column with badges:
  - 🟡 Draft
  - 🟠 Pending Approval
  - 🟢 Approved
  - 🔴 Rejected
- Add action buttons based on status:
  - Draft: Edit, Delete, Send for Approval
  - Pending: Revoke, View
  - Approved: Deploy, Paper Trade, Backtest, View
  - Rejected: Edit, Delete, Resubmit, View (with rejection reason)

### 2. Strategy Dropdowns
- Filter to show only `approval_status = 'approved'`
- Apply to:
  - Deployment dropdown
  - Paper Trade dropdown
  - Backtest dropdown

### 3. Strategy Detail View
- Show approval status prominently
- Show approval/rejection history
- Disable actions based on status

### 4. Admin Panel - New Tab
- "Strategy Approvals" tab
- Table showing:
  - Strategy Name
  - User Email
  - Created Date
  - Submitted Date
  - Actions: Approve, Reject, View Details

## Backend API Changes

### New Endpoints:
1. `POST /api/strategy/<id>/submit-for-approval`
   - Changes status: draft → pending
   - Requires: user owns strategy, status is draft

2. `POST /api/strategy/<id>/revoke-approval`
   - Changes status: pending → draft
   - Requires: user owns strategy, status is pending

3. `POST /api/strategy/<id>/resubmit`
   - Changes status: rejected → pending
   - Requires: user owns strategy, status is rejected

4. `GET /api/admin/strategies/pending`
   - Returns all pending strategies
   - Admin only

5. `POST /api/admin/strategies/<id>/approve`
   - Approves strategy
   - Admin only, status must be pending

6. `POST /api/admin/strategies/<id>/reject`
   - Rejects strategy with optional reason
   - Admin only, status must be pending

### Modified Endpoints:
1. `GET /api/strategies`
   - Add filter parameter: `?approval_status=approved`
   - Default filter for deployment/paper trade dropdowns

2. `DELETE /api/strategy/<id>`
   - Add validation: only allow delete if draft or rejected
   - Prevent deletion of pending/approved strategies

3. `POST /api/strategy/deploy/<id>`
   - Add validation: only allow if approved

4. `POST /api/strategy/paper-trade/<id>`
   - Add validation: only allow if approved

## Implementation Steps

### Phase 1: Database Migration
1. Create migration script to add approval fields
2. Update existing strategies to `approved` (for backward compatibility)
3. Test migration

### Phase 2: Backend API
1. Add approval status fields to strategy model
2. Create new approval endpoints
3. Update existing endpoints with approval checks
4. Add admin approval endpoints
5. Test all endpoints

### Phase 3: Frontend - User Interface
1. Add approval status column to strategy list
2. Add action buttons (Send for Approval, Revoke, etc.)
3. Update strategy detail view
4. Add approval status badges
5. Filter dropdowns to approved only

### Phase 4: Frontend - Admin Interface
1. Create "Strategy Approvals" tab in Admin section
2. List pending strategies
3. Add Approve/Reject actions
4. Show rejection reason modal

### Phase 5: Testing
1. Test user workflow (draft → pending → approved)
2. Test admin workflow (approve/reject)
3. Test edge cases (revoke, resubmit, delete)
4. Test deployment restrictions

## UI/UX Considerations

1. **Clear Status Indicators**: Use color-coded badges for status
2. **Action Availability**: Disable unavailable actions with tooltips
3. **Confirmation Dialogs**: For critical actions (delete, revoke)
4. **Notifications**: Show success/error messages for all actions
5. **Rejection Feedback**: Display rejection reason prominently
6. **Pending Indicator**: Show "Pending Approval" badge on strategy cards

## Security Considerations

1. **Authorization**: Verify user owns strategy before actions
2. **Admin Only**: Strict admin checks for approval endpoints
3. **Status Validation**: Prevent invalid status transitions
4. **Audit Trail**: Log all approval/rejection actions

## Migration Strategy

1. **Existing Strategies**: Mark all existing as `approved` to maintain functionality
2. **New Strategies**: Default to `draft`
3. **Gradual Rollout**: Users can continue using approved strategies while new ones go through approval





