# Frontend Rebuild Instructions for Production

## Problem
The frontend build is using `localhost:8000` instead of `https://drpinfotech.com` because:
- Environment variables are embedded at **BUILD TIME**, not runtime
- The build was done without the correct `.env.production` file
- Or the build was done in development mode

## Quick Fix (Temporary)
I've added a runtime override that will automatically detect production and use the correct domain. However, you should still rebuild properly.

## Proper Fix: Rebuild Frontend on AWS EC2

### Step 1: Verify `.env.production` exists and is correct

```bash
cd /path/to/frontend
cat .env.production
```

Should show:
```
REACT_APP_API_BASE=https://drpinfotech.com
REACT_APP_SOCKET_BASE=https://drpinfotech.com
```

### Step 2: Remove old build

```bash
cd /path/to/frontend
rm -rf build
```

### Step 3: Rebuild with production environment

```bash
# Make sure you're in the frontend directory
cd /path/to/frontend

# Install dependencies if needed
npm install

# Build for production (this reads .env.production)
npm run build

# Verify build was created
ls -la build/
```

### Step 4: Verify build contains correct URLs

```bash
# Check that build doesn't contain localhost:8000
grep -r "localhost:8000" build/ || echo "✓ No localhost:8000 found - good!"

# Check that build contains drpinfotech.com
grep -r "drpinfotech.com" build/ | head -3
```

### Step 5: Deploy the new build

```bash
# Copy build to your web server directory (adjust path as needed)
# If using Nginx:
sudo cp -r build/* /var/www/html/  # or wherever Nginx serves from

# Or if using a different setup, deploy accordingly
```

### Step 6: Restart web server (if needed)

```bash
# If using Nginx:
sudo systemctl restart nginx

# Or restart your web server process
```

### Step 7: Clear browser cache

- Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
- Or open in incognito/private window to test

## Verification

After rebuilding and deploying:

1. Open `https://drpinfotech.com` in browser
2. Open browser console (F12)
3. Check that API calls go to `https://drpinfotech.com/api/*` not `http://localhost:8000/api/*`
4. Check Network tab - all requests should be to `drpinfotech.com`

## Common Issues

### Issue: Build still shows localhost:8000

**Cause:** `.env.production` not in the right location or build command not reading it

**Solution:**
```bash
# Make sure .env.production is in the frontend root directory
cd /path/to/frontend
ls -la .env.production

# Verify it's being read during build
NODE_ENV=production npm run build
```

### Issue: Environment variables not being picked up

**Cause:** React only reads `.env.production` when `NODE_ENV=production`

**Solution:**
```bash
# Explicitly set NODE_ENV during build
NODE_ENV=production npm run build

# Or use the build script which should set it automatically
npm run build
```

### Issue: Build works locally but not on server

**Cause:** Different Node.js versions or missing dependencies

**Solution:**
```bash
# Check Node.js version
node --version  # Should be compatible

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
npm run build
```

## Runtime Override (Already Implemented)

I've added a runtime check that will automatically override `localhost:8000` to use the current domain when in production. This is a safety net, but you should still rebuild properly for best performance.

The override checks:
- If hostname is NOT localhost/127.0.0.1 (i.e., production)
- AND API_BASE_URL contains localhost
- THEN override to use current domain

This means even if the build has localhost, it will work in production, but rebuilding is still recommended.



