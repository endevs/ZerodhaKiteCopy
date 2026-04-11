import os
import secrets
from dotenv import load_dotenv

load_dotenv()

# SMTP Configuration
SMTP_SERVER = os.getenv('SMTP_SERVER', 'smtp.gmail.com')
USERNAME_EMAIL = os.getenv('USERNAME_EMAIL', '')
PASSWORD_EMAIL = os.getenv('PASSWORD_EMAIL', '')
EMAIL_FROM = os.getenv('EMAIL_FROM', '')

# Flask Configuration
SECRET_KEY = os.getenv('SECRET_KEY', secrets.token_hex(32))

# Database Configuration
DATABASE_PATH = os.getenv('DATABASE_PATH', 'database.db')

# Server Configuration
SERVER_HOST = os.getenv('SERVER_HOST', '0.0.0.0')
SERVER_PORT = int(os.getenv('SERVER_PORT', 8003))
DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'

# CORS Configuration (Docker/local: 5175 + 8003; 3000 kept for optional `npm start` dev)
CORS_ORIGINS = [origin.strip() for origin in os.getenv(
    'CORS_ORIGINS',
    'http://localhost:5175,http://localhost:8003,http://localhost:3000,http://localhost:3001',
).split(',')]

# Frontend URL Configuration
FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:5175')

# Razorpay Configuration
RAZORPAY_KEY_ID = os.getenv('RAZORPAY_KEY_ID', '')
RAZORPAY_KEY_SECRET = os.getenv('RAZORPAY_KEY_SECRET', '')
RAZORPAY_WEBHOOK_SECRET = os.getenv('RAZORPAY_WEBHOOK_SECRET', '')

# Google OAuth Configuration
GOOGLE_CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.getenv('GOOGLE_CLIENT_SECRET', '')
# Full callback URL; must match Google Cloud Console. If empty, uses request host + /api/auth/google/callback
GOOGLE_REDIRECT_URI = (os.getenv('GOOGLE_REDIRECT_URI') or '').strip()