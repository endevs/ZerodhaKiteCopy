# Environment File Management Guide

## How React Knows Which .env File to Use

React (Create React App) automatically picks environment files based on the **build command**:

### Local Development (`npm start`)
- Uses: `.env.development.local` → `.env.local` → `.env.development` → `.env`
- Priority: `.env.development.local` (highest) → `.env` (lowest)

### Production Build (`npm run build`)
- Uses: `.env.production.local` → `.env.local` → `.env.production` → `.env`
- Priority: `.env.production.local` (highest) → `.env` (lowest)

### Important Notes:
1. **`.env.local`** is loaded in ALL environments (except test) and should be in `.gitignore`
2. **`.env.development.local`** and **`.env.production.local`** are for local overrides (should be in `.gitignore`)
3. Files are loaded in order, with later files overriding earlier ones

## Recommended File Structure

### Frontend Environment Files

```
frontend/
├── .env                    # Default values (can check in)
├── .env.development        # Development defaults (can check in)
├── .env.production         # Production defaults (can check in)
├── .env.example            # Template with placeholders (MUST check in)
├── .env.local              # Local overrides (NEVER check in - in .gitignore)
├── .env.development.local  # Local dev overrides (NEVER check in)
└── .env.production.local   # Local prod overrides (NEVER check in)
```

### Backend Environment Files

```
backend/
├── .env.example            # Template with placeholders (MUST check in)
└── .env                    # Actual secrets (NEVER check in - in .gitignore)
```

## What to Check Into GitHub

### ✅ SAFE to Check In:
- `.env.example` - Template files with placeholder values
- `.env.development` - Development defaults (no secrets)
- `.env.production` - Production structure (no actual secrets, use placeholders)

### ❌ NEVER Check In:
- `.env` - Contains actual API keys and secrets
- `.env.local` - Local overrides with secrets
- `.env.development.local` - Local dev secrets
- `.env.production.local` - Local prod secrets

## Best Practice Structure

### Frontend `.env.example` (Check into GitHub)
```env
# API Configuration
REACT_APP_API_BASE=http://localhost:8000
REACT_APP_SOCKET_BASE=http://localhost:8000
```

### Frontend `.env.development` (Check into GitHub - no secrets)
```env
# Development Environment
REACT_APP_API_BASE=http://localhost:8000
REACT_APP_SOCKET_BASE=http://localhost:8000
```

### Frontend `.env.production` (Check into GitHub - use placeholders)
```env
# Production Environment
# Replace with actual production URLs
REACT_APP_API_BASE=https://yourdomain.com
REACT_APP_SOCKET_BASE=https://yourdomain.com
```

### Frontend `.env.local` (NEVER check in - your local overrides)
```env
# Local overrides - this file is in .gitignore
REACT_APP_API_BASE=http://localhost:8000
REACT_APP_SOCKET_BASE=http://localhost:8000
```

### Backend `.env.example` (Check into GitHub)
```env
# Flask Configuration
SECRET_KEY=your-secret-key-here
DEBUG=False

# Server Configuration
SERVER_HOST=0.0.0.0
SERVER_PORT=8000

# CORS Configuration
CORS_ORIGINS=http://localhost:3000,https://yourdomain.com
FRONTEND_URL=https://yourdomain.com

# Database
DATABASE_PATH=database.db

# Email Configuration (optional)
SMTP_SERVER=smtp.gmail.com
USERNAME_EMAIL=your-email@gmail.com
PASSWORD_EMAIL=your-app-password
EMAIL_FROM=your-email@gmail.com
```

### Backend `.env` (NEVER check in - actual secrets)
```env
# Your actual API keys and secrets go here
# This file is in .gitignore
```

## AWS Production Setup

### Option 1: Single `.env` File (Recommended)
On AWS EC2, you only need **one** `.env` file with production values:

```bash
# On AWS EC2
backend/.env  # Contains actual production secrets
```

**Don't** create `.env.production` or `.env.localhost` on the server - just use `.env` with production values.

### Option 2: Use Environment Variables (More Secure)
Instead of `.env` file, set environment variables directly:

```bash
# On AWS EC2, set in systemd service or startup script:
export SECRET_KEY="your-secret-key"
export CORS_ORIGINS="https://drpinfotech.com"
export FRONTEND_URL="https://drpinfotech.com"
# ... etc
```

## Frontend Build Process

### Local Development:
```bash
npm start
# Uses: .env.development.local → .env.local → .env.development → .env
```

### Production Build (Local):
```bash
npm run build
# Uses: .env.production.local → .env.local → .env.production → .env
# Creates: build/ folder with environment variables EMBEDDED
```

### Production Build (AWS):
```bash
# On AWS EC2
cd frontend
npm run build
# Uses: .env.production (if exists) → .env
# The build folder contains the embedded values
```

## Security Best Practices

1. **Never commit secrets**: All `.env` files with actual values should be in `.gitignore`
2. **Use `.env.example`**: Create template files that show structure without secrets
3. **Rotate secrets**: If secrets are accidentally committed, rotate them immediately
4. **Use different secrets**: Use different API keys for development and production
5. **Review `.gitignore`**: Regularly check that sensitive files are excluded

## .gitignore Configuration

### Frontend `.gitignore` should include:
```
# Environment files with secrets
.env.local
.env.development.local
.env.production.local
.env
.env.*.local

# But allow example files
!.env.example
!.env.development.example
!.env.production.example
```

### Backend `.gitignore` should include:
```
# Environment files with secrets
.env
.env.local
.env.*.local

# But allow example files
!.env.example
```

## Quick Setup Commands

### Create Example Files:
```bash
# Frontend
cd frontend
cp .env.production .env.example
# Edit .env.example to remove secrets, add placeholders

# Backend
cd backend
cp .env .env.example
# Edit .env.example to remove secrets, add placeholders
```

### On AWS EC2 (First Time):
```bash
# Backend
cd backend
cp .env.example .env
# Edit .env with actual production values

# Frontend
cd frontend
# .env.production should already have production URLs
npm run build
```

## Summary

1. **Local Development**: Use `.env.development` (checked in) + `.env.local` (not checked in)
2. **Production Build**: Use `.env.production` (checked in with placeholders) 
3. **AWS Production**: Use single `.env` file (not checked in) with actual values
4. **GitHub**: Check in `.env.example` files, never check in `.env` with secrets
5. **Security**: All files with actual secrets go in `.gitignore`

