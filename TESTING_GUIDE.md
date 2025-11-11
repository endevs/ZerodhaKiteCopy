# 🧪 Testing Guide - How to Run the Application

## Prerequisites Check

Before starting, ensure you have:
- ✅ Python 3.8+ installed
- ✅ Node.js 16+ installed
- ✅ Zerodha Kite Connect API credentials (API Key & Secret)

## Step-by-Step Setup & Testing

### Step 1: Setup Backend Environment

```powershell
# Navigate to backend directory
cd backend

# Create .env file (copy from example and edit with your credentials)
copy .env.example .env

# Edit .env file with your actual credentials:
# - SMTP credentials (for OTP emails)
# - Zerodha API Key & Secret (users will enter during signup)
```

**Important:** Edit `backend/.env` and add your:
- Gmail credentials for sending OTP emails
- Generate a new `SECRET_KEY` if needed

### Step 2: Install Backend Dependencies

```powershell
# If you don't have a virtual environment, create one:
python -m venv venv

# Activate virtual environment (Windows):
venv\Scripts\activate

# Install dependencies:
pip install -r requirements.txt
```

**Expected output:** All packages should install successfully.

### Step 3: Initialize Database (if needed)

```powershell
# If database.db doesn't exist or you want fresh tables:
python database.py
```

**Note:** This will recreate all tables. Only run if starting fresh.

### Step 4: Install Frontend Dependencies

```powershell
# Open a new terminal, navigate to frontend:
cd frontend

# Install dependencies:
npm install
```

**Expected output:** node_modules folder created with all dependencies.

### Step 5: Start Backend Server

```powershell
# In backend directory (with venv activated):
cd backend
python app.py
```

**Expected output:**
```
* Running on http://0.0.0.0:8000
* Restarting with reloader
```

**✅ Success indicators:**
- Server starts without errors
- No import errors
- Listening on port 8000

### Step 6: Start Frontend Server

```powershell
# In a NEW terminal, navigate to frontend:
cd frontend
npm start
```

**Expected output:**
```
Compiled successfully!
You can now view zerodhakite-frontend in the browser.
  Local:            http://localhost:3000
```

**✅ Success indicators:**
- React app compiles successfully
- Browser opens automatically to http://localhost:3000
- No compilation errors

### Step 7: Test the Application

#### 7.1 Test User Registration
1. Open browser: http://localhost:3000
2. Click "Sign Up"
3. Fill in:
   - Mobile number
   - Email address
   - Zerodha API Key
   - Zerodha API Secret
4. Click "Sign Up"
5. **Check email** for OTP code
6. Enter OTP and verify

**✅ Success:** Redirected to Welcome page

#### 7.2 Test User Login
1. Go to http://localhost:3000/login
2. Enter registered email
3. Check email for OTP
4. Enter OTP
5. **✅ Success:** Redirected to Dashboard

#### 7.3 Test Zerodha Connection
1. On Dashboard, click "Connect with Zerodha"
2. Login with Zerodha credentials
3. **✅ Success:** Redirected back to Dashboard with account balance visible

#### 7.4 Test Real-time Market Data
1. On Dashboard, check "Live Market Data" section
2. **✅ Success:** Nifty and BankNifty prices update in real-time

#### 7.5 Test Strategy Creation
1. Scroll to "Strategy Configuration"
2. Select a strategy (ORB or Capture Mountain Signal)
3. Fill in all parameters
4. Click "Save Strategy"
5. **✅ Success:** Strategy saved message appears

#### 7.6 Test Strategy Deployment
1. Find saved strategy in "Saved Strategies" section
2. Click "Deploy"
3. Choose paper trading option if desired
4. **✅ Success:** Strategy status changes to "Running"

## 🔍 Quick Verification Commands

### Check Backend is Running
```powershell
# Test backend health:
curl http://localhost:8000/

# Or open in browser:
# http://localhost:8000/
```

### Check Database
```powershell
cd backend
python query_db.py  # If this file exists
```

### Check Frontend Connection
```powershell
# Open browser console (F12) and check for:
# - No CORS errors
# - WebSocket connection successful
# - API calls returning data
```

## 🐛 Common Issues & Solutions

### Issue 1: "Module not found: python-dotenv"
**Solution:**
```powershell
cd backend
pip install python-dotenv
```

### Issue 2: "Port 8000 already in use"
**Solution:**
```powershell
# Option 1: Kill process on port 8000
netstat -ano | findstr :8000
taskkill /PID <PID_NUMBER> /F

# Option 2: Change port in .env
# Edit backend/.env: SERVER_PORT=8001
```

### Issue 3: "CORS errors in browser console"
**Solution:**
- Check `CORS_ORIGINS` in `backend/.env` matches frontend URL
- Restart backend server after changing .env

### Issue 4: "Database locked" error
**Solution:**
```powershell
# Close any other connections to database.db
# Restart backend server
```

### Issue 5: "OTP email not received"
**Solution:**
- Check spam folder
- Verify SMTP credentials in `.env`
- Ensure Gmail "Less secure app access" or App Password is enabled
- Check backend console for email sending errors

### Issue 6: "WebSocket connection failed"
**Solution:**
- Ensure backend is running
- Check SocketIO is properly configured
- Check browser console for specific errors

## ✅ Complete Testing Checklist

- [ ] Backend server starts without errors
- [ ] Frontend server starts without errors
- [ ] Can access frontend at http://localhost:3000
- [ ] Can register new user
- [ ] OTP email is received
- [ ] Can login with OTP
- [ ] Can connect to Zerodha
- [ ] Dashboard loads successfully
- [ ] Market data updates in real-time
- [ ] Can create and save strategy
- [ ] Can deploy strategy
- [ ] Can view strategy status
- [ ] Navigation works between tabs
- [ ] Backtest feature works
- [ ] Market replay works
- [ ] Tick data collection works

## 🚀 Performance Testing

### Test Real-time Data Updates
1. Deploy a strategy
2. Monitor WebSocket messages in browser console
3. Check tick data updates frequency
4. **Expected:** Updates every few seconds

### Test Strategy Execution
1. Deploy strategy during market hours
2. Monitor logs for trade signals
3. Check strategy status updates
4. **Expected:** Strategy executes based on conditions

## 📊 Monitoring

### Backend Logs
Watch backend terminal for:
- Strategy deployment messages
- Trade execution logs
- WebSocket connection logs
- Error messages

### Frontend Console
Open browser DevTools (F12) and check:
- Network tab for API calls
- Console for errors
- WebSocket messages

## 🎯 Next Steps After Testing

Once all tests pass:
1. Test with real Zerodha account (carefully!)
2. Test with paper trading first
3. Monitor performance
4. Review logs for any issues
5. Test edge cases (invalid inputs, network failures, etc.)

---

**Need Help?** Check the main README.md or troubleshoot specific errors in browser/backend console.



