# DRP Infotech Pvt Ltd - Algorithmic Trading Platform

A professional algorithmic trading platform integrated with Zerodha Kite Connect API, featuring real-time market data, strategy deployment, backtesting, and market replay capabilities.

**Developed by:** [DRP Infotech Pvt Ltd](https://www.drpinfotech.com)  
**Contact:** [contact@drpinfotech.com](mailto:contact@drpinfotech.com)

## 🚀 Features

- **Real-time Trading**: Live market data streaming via WebSocket (SocketIO)
- **Strategy Management**: Create, save, deploy, and manage trading strategies
- **Backtesting**: Test strategies on historical data
- **Market Replay**: Replay past market sessions with strategies
- **Tick Data Collection**: Automated collection and storage of tick-by-tick data
- **User Authentication**: Secure OTP-based authentication via email
- **Paper Trading**: Test strategies without real money
- **Modern UI**: Responsive React dashboard with Bootstrap 5

## 📋 Prerequisites

- Python 3.8+
- Node.js 16+
- Zerodha Kite Connect API credentials
- Gmail account for OTP emails (with app password)

## 🛠️ Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd ZerodhaKite
```

### 2. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install
```

### 4. Environment Configuration

Create a `.env` file in the `backend` directory:

```bash
cd backend
cp ../.env.example .env
```

Edit `.env` with your credentials:

```env
# SMTP Configuration for OTP emails
SMTP_SERVER=smtp.gmail.com
USERNAME_EMAIL=your_email@gmail.com
PASSWORD_EMAIL=your_app_password
EMAIL_FROM=your_email@gmail.com

# Flask Secret Key (generate using: python -c "import secrets; print(secrets.token_hex(32))")
SECRET_KEY=your_secret_key_here

# Database Configuration
DATABASE_PATH=database.db

# Server Configuration
SERVER_HOST=0.0.0.0
SERVER_PORT=8000
DEBUG=False

# CORS Configuration
CORS_ORIGINS=http://localhost:3000
```

### 5. Database Initialization

```bash
cd backend
python database.py
```

## 🚀 Running the Application

### Start Backend Server

```bash
cd backend
python app.py
```

The backend will run on `http://localhost:8000`

### Start Frontend Development Server

```bash
cd frontend
npm start
```

The frontend will run on `http://localhost:3000`

## 📁 Project Structure

```
ZerodhaKite/
├── backend/
│   ├── app.py                 # Main Flask application
│   ├── config.py              # Configuration management
│   ├── database.py            # Database connection and schema
│   ├── ticker.py              # WebSocket ticker handler
│   ├── chat.py                # Chat blueprint
│   ├── strategies/            # Trading strategies
│   │   ├── base_strategy.py
│   │   ├── orb.py
│   │   └── capture_mountain_signal.py
│   ├── templates/             # HTML templates
│   ├── static/                # Static files
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Navigation.tsx
│   │   │   ├── DashboardContent.tsx
│   │   │   └── ...
│   │   ├── DrpWelcome.tsx
│   │   └── index.tsx
│   └── package.json
└── README.md
```

## 🔐 Security Notes

- **Never commit `.env` file** - It contains sensitive credentials
- **Use environment variables** for all sensitive data
- **Change default secret key** in production
- **Restrict CORS origins** in production to your domain only
- **Use HTTPS** in production

## 📊 Available Strategies

### 1. Opening Range Breakout (ORB)
Identifies the high and low of the opening range and places trades on breakout.

### 2. Capture Mountain Signal
EMA-based strategy for Nifty & BankNifty ATM options.

## 🔧 API Endpoints

### Authentication
- `GET /login` - Login page
- `POST /login` - Submit login (OTP sent)
- `GET /signup` - Signup page
- `POST /signup` - Create account
- `GET /verify_otp` - Verify OTP
- `POST /verify_otp` - Submit OTP
- `GET /zerodha_login` - Redirect to Zerodha login
- `GET /callback` - Zerodha OAuth callback

### Dashboard & Strategies
- `GET /dashboard` - Main dashboard
- `POST /strategy/save` - Save strategy
- `POST /strategy/deploy/<id>` - Deploy strategy
- `POST /strategy/pause/<id>` - Pause strategy
- `POST /strategy/squareoff/<id>` - Square off strategy
- `GET /api/strategies` - Get all strategies
- `GET /strategy/status/<id>` - Get strategy status

### Backtesting & Replay
- `POST /backtest` - Run backtest
- `POST /market_replay` - Market replay

### Data
- `GET /tick_data/<token>` - Get tick data
- `GET /tick_data_status` - Get collection status
- `POST /tick_data/start` - Start collection
- `POST /tick_data/pause` - Pause collection

## 🧪 Testing

Ensure all functionality works:

1. User Registration & Login
2. Zerodha Connection
3. Strategy Creation & Deployment
4. Real-time Data Updates
5. Backtesting
6. Market Replay
7. Tick Data Collection

## 📝 License

This project is for educational and personal use. Ensure compliance with Zerodha's API usage terms.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## ⚠️ Disclaimer

This software is for educational purposes only. Trading involves risk. Always test strategies thoroughly before deploying with real money. The authors are not responsible for any financial losses.

