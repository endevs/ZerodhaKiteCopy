# Razorpay API Keys Setup Guide

## Where to Add API Keys

Yes, you should add the Razorpay API keys to a `.env` file in the `backend` directory.

## Steps to Setup:

### 1. Create `.env` file in `backend` directory

Create a file named `.env` in the `backend` folder:
```
D:\WorkSpace\ZerodhaKiteGit\backend\.env
```

### 2. Add Razorpay Keys

Add the following lines to your `.env` file in the `backend` directory:

```env
# Razorpay Payment Gateway Configuration
RAZORPAY_KEY_ID=your_key_id_here
RAZORPAY_KEY_SECRET=your_key_secret_here
RAZORPAY_WEBHOOK_SECRET=
```

**Note**: 
- Replace `your_key_id_here` with your actual **key_id** from Razorpay
- Replace `your_key_secret_here` with your actual **key_secret** from Razorpay
- `RAZORPAY_WEBHOOK_SECRET` is optional - leave it empty for now, you can add it later when setting up webhooks
- No spaces around the `=` sign
- No quotes needed around the values

### 3. Get Your Razorpay Keys

1. **Sign up/Login** to Razorpay Dashboard: https://dashboard.razorpay.com/
2. **Go to Settings** → **API Keys**
3. **Generate Test Keys** (for development) or use **Live Keys** (for production)
4. Copy the **Key ID** and **Key Secret**

### 4. Test vs Live Keys

- **Test Mode**: Use keys starting with `rzp_test_`
  - Use for development and testing
  - No real money transactions
  - Test cards: https://razorpay.com/docs/payments/test-cards/

- **Live Mode**: Use keys starting with `rzp_live_`
  - Use for production
  - Real money transactions
  - Requires account activation and KYC

### 5. Webhook Secret (Optional but Recommended)

1. Go to **Settings** → **Webhooks** in Razorpay Dashboard
2. Add webhook URL: `https://yourdomain.com/api/payment/webhook`
3. Select events: `payment.captured`, `payment.failed`
4. Copy the **Webhook Secret**

### 6. Example `.env` File

Your complete `.env` file should look like this:

```env
# Existing configurations...
SMTP_SERVER=smtp.gmail.com
USERNAME_EMAIL=your_email@gmail.com
PASSWORD_EMAIL=your_app_password
EMAIL_FROM=your_email@gmail.com
SECRET_KEY=your_secret_key_here
DEBUG=False
DATABASE_PATH=database.db
SERVER_HOST=0.0.0.0
SERVER_PORT=8000
CORS_ORIGINS=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# Razorpay Configuration
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_secret_key_here
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
```

### 7. Security Notes

⚠️ **IMPORTANT:**
- **Never commit `.env` file to Git** - It's already in `.gitignore`
- **Never share your secret keys** publicly
- **Use test keys** during development
- **Rotate keys** if accidentally exposed
- **Use different keys** for test and production environments

### 8. Verify Setup

After adding keys, restart your backend server. Check the logs for:
```
Razorpay client initialized successfully
Razorpay routes registered successfully
```

If you see errors, verify:
- Keys are correct (no extra spaces)
- Keys match your Razorpay account mode (test/live)
- `.env` file is in the `backend` directory
- Backend server has been restarted

### 9. Testing

Once keys are added, you can test the payment flow:
1. Go to Subscribe page
2. Click on Premium or Super Premium plan
3. Use Razorpay test cards for testing
4. Verify subscription activation after payment

## Troubleshooting

**Issue**: "Payment gateway not configured"
- **Solution**: Check if keys are in `.env` file and server is restarted

**Issue**: "Invalid payment signature"
- **Solution**: Verify keys are correct and match (test keys with test mode, live keys with live mode)

**Issue**: Keys not loading
- **Solution**: Ensure `.env` file is in `backend` directory, not root directory

