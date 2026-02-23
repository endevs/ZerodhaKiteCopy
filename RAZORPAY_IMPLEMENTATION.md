# Razorpay Payment Integration - Implementation Guide

## Overview
This document outlines the complete Razorpay payment integration for subscription management in the trading platform.

## Architecture Thoughts & Recommendations

### ✅ **Why Razorpay is a Good Choice:**
1. **Widely Used in India**: Excellent support for Indian payment methods (UPI, cards, wallets)
2. **Easy Integration**: Well-documented APIs and SDKs
3. **Security**: Built-in signature verification and webhook support
4. **Compliance**: PCI-DSS compliant, handles sensitive payment data securely
5. **Developer-Friendly**: Good documentation and support

### 📋 **Database Schema:**
- **`subscriptions`**: Tracks user subscription plans, status, trial periods
- **`payments`**: Stores all payment transactions with Razorpay IDs
- **`payment_history`**: Audit trail for payment status changes

### 🔐 **Security Considerations:**
1. **Never store Razorpay secret key in frontend** - Only use in backend
2. **Always verify payment signatures** - Prevents tampering
3. **Use webhooks for payment status updates** - More reliable than frontend callbacks
4. **Store minimal payment data** - Only what's necessary for reconciliation

### 🎯 **Feature Restriction Strategy:**
The `subscription_manager.py` module provides:
- `check_feature_access(user_id, feature)` - Check if user can access a feature
- Feature flags per plan type
- Automatic trial expiration handling
- Subscription status management

### 📝 **Implementation Steps:**

#### 1. **Run Database Migration:**
```bash
python backend/migrate_subscriptions.py
```

#### 2. **Set Environment Variables:**
Add to your `.env` file:
```
RAZORPAY_KEY_ID=your_key_id_here
RAZORPAY_KEY_SECRET=your_key_secret_here
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here  # Optional but recommended
```

#### 3. **Install Dependencies:**
```bash
pip install razorpay cryptography
```

#### 4. **Frontend Integration:**
- Load Razorpay checkout script
- Create order via API
- Open Razorpay checkout
- Verify payment on success
- Handle errors gracefully

### 🔄 **Payment Flow:**
1. User clicks "Subscribe" → Frontend calls `/api/payment/create-order`
2. Backend creates Razorpay order → Returns order details
3. Frontend opens Razorpay checkout → User completes payment
4. Razorpay redirects back → Frontend calls `/api/payment/verify`
5. Backend verifies signature → Creates/activates subscription
6. Webhook confirms payment → Updates payment status (backup)

### 🛡️ **Feature Restriction Implementation:**
Use `check_feature_access()` before allowing:
- Live deployment
- Strategy optimization
- AI/ML customization
- Extended backtest periods
- Expert consultations

Example:
```python
if not check_feature_access(user_id, 'live_deployment'):
    return jsonify({'error': 'Premium subscription required'}), 403
```

### 📊 **Subscription Plans:**
- **Freemium**: Free, 7-day trial, basic features
- **Premium**: ₹1,499/month, all features except AI/ML customization
- **Super Premium**: ₹3,499/month, all features including AI/ML
- **Customization**: ₹4,899 one-time, custom strategy development

### 🔔 **Webhook Setup:**
1. Configure webhook URL in Razorpay dashboard: `https://yourdomain.com/api/payment/webhook`
2. Select events: `payment.captured`, `payment.failed`
3. Add webhook secret to environment variables
4. Implement signature verification (recommended)

### 📈 **Future Enhancements:**
1. **Auto-renewal**: Set up recurring payments for monthly subscriptions
2. **Upgrade/Downgrade**: Allow plan changes mid-cycle
3. **Prorated Billing**: Calculate partial charges for upgrades
4. **Invoice Generation**: Create invoices for payments
5. **Refund Handling**: Process refunds through Razorpay API
6. **Analytics Dashboard**: Track subscription metrics

### ⚠️ **Important Notes:**
1. **Test Mode**: Use Razorpay test keys during development
2. **Error Handling**: Always handle payment failures gracefully
3. **Idempotency**: Ensure payment verification is idempotent
4. **Logging**: Log all payment events for debugging
5. **Backup Verification**: Use webhooks as backup to frontend verification

### 🧪 **Testing:**
- Use Razorpay test cards: https://razorpay.com/docs/payments/test-cards/
- Test all payment scenarios: success, failure, cancellation
- Verify subscription activation after payment
- Test feature restrictions based on subscription

## Files Created:
1. `backend/migrate_subscriptions.py` - Database migration
2. `backend/subscription_manager.py` - Subscription logic
3. `backend/razorpay_routes.py` - Payment API endpoints
4. Frontend integration (to be added to SubscribeContent.tsx)

## Next Steps:
1. Run migration script
2. Add Razorpay keys to environment
3. Install dependencies
4. Test payment flow
5. Implement feature restrictions in protected endpoints
6. Set up webhooks in Razorpay dashboard






