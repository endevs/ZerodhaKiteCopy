# Production Deployment Configuration Guide

## Issues Fixed

1. ✅ Frontend `.env.production` updated to use `https://drpinfotech.com`
2. ✅ Backend `/api/login` now handles CORS preflight and JSON parsing better
3. ✅ Backend `/callback` route now auto-detects production vs localhost
4. ✅ Frontend API config improved for production domain inference

## Required Backend Configuration on AWS EC2

Create or update `backend/.env` on your EC2 instance with:

```env
# CORS Configuration - Allow production domain
CORS_ORIGINS=https://drpinfotech.com,http://localhost:3000

# Frontend URL for redirects
FRONTEND_URL=https://drpinfotech.com

# Database (adjust path as needed)
DATABASE_PATH=/path/to/your/database.db

# Secret Key (generate a new one for production)
SECRET_KEY=your-secret-key-here

# Server Configuration
SERVER_HOST=0.0.0.0
SERVER_PORT=8000
DEBUG=False
```

## Nginx Configuration (if using reverse proxy)

If you're using Nginx to proxy requests, ensure it's configured to:

1. **Proxy API requests** from `https://drpinfotech.com/api/*` to `http://localhost:8000/api/*`
2. **Proxy WebSocket** from `wss://drpinfotech.com/socket.io/*` to `ws://localhost:8000/socket.io/*`
3. **Serve React build** from `https://drpinfotech.com/*` (static files)

Example Nginx config:

```nginx
server {
    listen 443 ssl http2;
    server_name drpinfotech.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Serve React build
    location / {
        root /path/to/frontend/build;
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests
    location /api {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Proxy WebSocket (Socket.IO)
    location /socket.io {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Proxy callback route
    location /callback {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Zerodha Kite App Configuration

You need **TWO separate Kite Connect apps**:

1. **Local Development App:**
   - Redirect URL: `http://localhost:8000/callback`
   - Use this app's API key/secret in your local `backend/.env`

2. **Production App:**
   - Redirect URL: `https://drpinfotech.com/callback`
   - Use this app's API key/secret in your AWS EC2 `backend/.env`

## Frontend Build Steps

1. **Update `.env.production`** (already done):
   ```
   REACT_APP_API_BASE=https://drpinfotech.com
   REACT_APP_SOCKET_BASE=https://drpinfotech.com
   ```

2. **Rebuild the frontend:**
   ```bash
   cd frontend
   npm run build
   ```

3. **Deploy the build folder** to your web server (Nginx or similar)

## Testing Checklist

- [ ] Backend `.env` has correct `CORS_ORIGINS` and `FRONTEND_URL`
- [ ] Frontend `.env.production` has `https://drpinfotech.com`
- [ ] Frontend rebuilt with `npm run build`
- [ ] Nginx configured to proxy `/api` and `/socket.io`
- [ ] Zerodha production app has redirect URL `https://drpinfotech.com/callback`
- [ ] Backend restarted after `.env` changes
- [ ] Test login from `https://drpinfotech.com/login`
- [ ] Test Zerodha authorization callback
- [ ] Verify WebSocket connection in browser console

## Troubleshooting

### 400 Bad Request on `/api/login`

**Symptoms:** Browser console shows `400 Bad Request` when trying to login

**Solutions:**
1. **Check backend `.env` file:**
   ```bash
   # On EC2, verify these are set:
   CORS_ORIGINS=https://drpinfotech.com,http://localhost:3000
   FRONTEND_URL=https://drpinfotech.com
   ```

2. **Check backend logs:**
   ```bash
   # Look for login request logs to see what's being received
   tail -f /path/to/backend/logs/app.log
   # Or if running in terminal, check the console output
   ```

3. **Verify CORS headers:**
   - Open browser DevTools → Network tab
   - Try login again
   - Check the `/api/login` request
   - Look for `Access-Control-Allow-Origin` header in response
   - Should be `https://drpinfotech.com`

4. **Test backend directly:**
   ```bash
   curl -X POST https://drpinfotech.com/api/login \
     -H "Content-Type: application/json" \
     -H "Origin: https://drpinfotech.com" \
     -d '{"email":"test@example.com"}' \
     -v
   ```

5. **Common issues:**
   - Backend `.env` not updated → Restart backend after updating
   - Nginx not proxying correctly → Check Nginx config
   - Backend not running → Check process status

### WebSocket connection fails (`wss://drpinfotech.com:3000/ws`)

**Symptoms:** Browser console shows WebSocket trying to connect to port 3000

**Root Cause:** Frontend build is using old environment variables or not rebuilt

**Solutions:**
1. **Verify `.env.production` exists and is correct:**
   ```bash
   cd frontend
   cat .env.production
   # Should show:
   # REACT_APP_API_BASE=https://drpinfotech.com
   # REACT_APP_SOCKET_BASE=https://drpinfotech.com
   ```

2. **Rebuild frontend (CRITICAL):**
   ```bash
   cd frontend
   # Remove old build
   rm -rf build
   # Rebuild with production environment
   npm run build
   # Verify build was created
   ls -la build/
   ```

3. **Check built files contain correct URLs:**
   ```bash
   # Search for any hardcoded localhost:3000 in build
   grep -r "localhost:3000" build/ || echo "No localhost:3000 found - good!"
   grep -r "drpinfotech.com" build/ | head -5
   ```

4. **Verify Nginx is serving the new build:**
   ```bash
   # Check Nginx is pointing to the correct build directory
   # Restart Nginx after deploying new build
   sudo systemctl restart nginx
   ```

5. **Clear browser cache:**
   - Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
   - Or open in incognito/private window

### Debugging Steps

1. **Check what URLs the frontend is using:**
   - Open browser console on `https://drpinfotech.com`
   - In console, type: `window.location`
   - Check Network tab for actual API calls

2. **Verify environment variables in build:**
   ```bash
   # On EC2, after building:
   cd frontend/build/static/js
   # Find the main JS file and check its contents
   grep -o "REACT_APP.*" *.js | head -5
   ```

3. **Test API endpoint directly:**
   ```bash
   # Should return CORS headers
   curl -I -X OPTIONS https://drpinfotech.com/api/login \
     -H "Origin: https://drpinfotech.com" \
     -H "Access-Control-Request-Method: POST"
   ```

4. **Check backend is receiving requests:**
   - Look at backend logs when making login request
   - Should see "Login request - Content-Type: ..." logs
   - If no logs, Nginx might not be proxying correctly

### `/api/zerodha_login` returns "Route not found"

**Symptoms:** Accessing `https://drpinfotech.com/api/zerodha_login` returns `{"message":"Route not found","status":"error"}`

**Solutions:**
1. **Restart backend after code update:**
   ```bash
   # The route was added, so backend needs restart
   # Stop the current backend process
   # Then restart it with the updated code
   ```

2. **Verify route is registered:**
   - The route should be accessible at both `/zerodha_login` and `/api/zerodha_login`
   - Check backend logs to see if the request is reaching Flask

3. **Check Nginx configuration:**
   - Ensure Nginx is proxying `/api/*` routes to the backend
   - Verify the backend is running on the expected port

4. **Test the route:**
   ```bash
   # Should redirect to Zerodha login (if session exists)
   curl -I https://drpinfotech.com/api/zerodha_login \
     -H "Cookie: session=..." \
     -L
   ```

### Callback redirects to wrong URL
- Backend auto-detects from request headers
- Can also set `FRONTEND_URL=https://drpinfotech.com` in backend `.env`

