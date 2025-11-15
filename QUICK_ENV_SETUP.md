# Quick Environment File Setup Guide

## Answers to Your Questions

### 1. How does the system know which .env file to pick?

**React (Frontend):**
- `npm start` (development) → Uses `.env.development` → `.env`
- `npm run build` (production) → Uses `.env.production` → `.env`
- Files are loaded in priority order (later files override earlier ones)

**Flask (Backend):**
- Always uses `.env` file (no automatic switching)
- You manually manage different `.env` files for different environments

### 2. Can I have both .env.production and .env.localhost in AWS production?

**Answer: NO - You don't need both!**

On AWS production, you only need:
- **Backend**: One `.env` file with production values
- **Frontend**: `.env.production` file (used during `npm run build`)

**Don't create `.env.localhost` on AWS** - that's only for local development.

### 3. What files should I check into GitHub?

#### ✅ SAFE to Check In (No Secrets):
- `frontend/.env.example` - Template
- `frontend/.env.development.example` - Dev template  
- `frontend/.env.production.example` - Prod template
- `backend/.env.example` - Backend template

#### ❌ NEVER Check In (Contains Secrets):
- `frontend/.env` - Any file with actual values
- `frontend/.env.local` - Local overrides
- `frontend/.env.production` - If it has real production URLs (use placeholders)
- `backend/.env` - Contains API keys and secrets

## Recommended File Structure

### On Your Local Machine:

```
frontend/
├── .env.example              ✅ Check in
├── .env.development          ✅ Check in (no secrets, just structure)
├── .env.production           ✅ Check in (use placeholders like https://drpinfotech.com)
├── .env.local                ❌ Don't check in (your local overrides)
└── .env                      ❌ Don't check in (if you use it)

backend/
├── .env.example              ✅ Check in
└── .env                      ❌ Don't check in (your actual API keys)
```

### On AWS Production:

```
frontend/
├── .env.production           ✅ Use this (with actual production URLs)
└── (no .env.local needed)

backend/
└── .env                      ✅ Use this (with actual production secrets)
```

## Step-by-Step Setup

### Step 1: Create Example Files (Safe to Commit)

I've created these files for you:
- `frontend/.env.example`
- `frontend/.env.development.example`
- `frontend/.env.production.example`
- `backend/.env.example`

### Step 2: Update Your Local Files

**Frontend - Local Development:**
```bash
cd frontend
# Copy example to local (if you want local overrides)
cp .env.example .env.local
# Edit .env.local with your local values
```

**Backend - Local:**
```bash
cd backend
# Copy example to actual .env
cp .env.example .env
# Edit .env with your actual API keys (NEVER commit this)
```

### Step 3: Update Production Files

**Frontend - Production:**
```bash
# On AWS EC2
cd frontend
# Edit .env.production with actual production URLs
# This file can be checked in if it only has URLs (no secrets)
```

**Backend - Production:**
```bash
# On AWS EC2
cd backend
# Create .env with actual production secrets
# This file should NEVER be checked in
```

## How React Picks Files During Build

### Local Development (`npm start`):
```
1. .env.development.local (if exists) - highest priority
2. .env.local (if exists)
3. .env.development (if exists)
4. .env (if exists) - lowest priority
```

### Production Build (`npm run build`):
```
1. .env.production.local (if exists) - highest priority
2. .env.local (if exists)
3. .env.production (if exists)
4. .env (if exists) - lowest priority
```

**Important:** Values are embedded at BUILD TIME, not runtime!

## Security Checklist

- [ ] `.env` files with secrets are in `.gitignore`
- [ ] `.env.example` files are created and checked in
- [ ] No API keys or secrets in committed files
- [ ] Different API keys for development and production
- [ ] `.gitignore` is properly configured

## Quick Commands

### Check what's being ignored:
```bash
git status --ignored
```

### Verify .env files won't be committed:
```bash
git check-ignore -v frontend/.env
git check-ignore -v backend/.env
```

### Create production .env from example:
```bash
# On AWS EC2
cd backend
cp .env.example .env
# Edit .env with actual values
```

## Summary

1. **Local**: Use `.env.development` + `.env.local` (local not checked in)
2. **Production Build**: Use `.env.production` (can check in with placeholders)
3. **AWS Production**: Use single `.env` file (never check in)
4. **GitHub**: Only check in `.env.example` files
5. **Security**: All files with secrets are in `.gitignore`

