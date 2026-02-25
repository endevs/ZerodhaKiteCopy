# Fix for API Routes Returning HTML in Production

## Problem
API endpoints like `/api/payment/create-order` are returning HTML (React app's index.html) instead of JSON in production.

## Root Cause
Nginx reverse proxy is not correctly routing `/api/*` requests to the Flask backend. The `try_files` directive in the root location is catching all requests, including API routes.

## Solution: Update Nginx Configuration

The `/api` location block must come **BEFORE** the root location block that serves the React app. Nginx processes location blocks in order, and the first match wins.

### Correct Nginx Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name drpinfotech.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # CRITICAL: API routes MUST come BEFORE the root location
    # This ensures /api/* requests are proxied to Flask, not served as static files
    
    # Proxy Socket.IO (must come first)
    location /socket.io/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 86400;
    }

    # Proxy ALL API requests to Flask backend
    location /api/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        
        # Important for JSON responses
        proxy_set_header Accept application/json;
        proxy_set_header Content-Type application/json;
        
        # CORS headers (if not handled by Flask)
        add_header Access-Control-Allow-Origin $http_origin always;
        add_header Access-Control-Allow-Credentials true always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
        
        # Handle preflight
        if ($request_method = OPTIONS) {
            return 204;
        }
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

    # Serve React build (catch-all - must come LAST)
    location / {
        root /path/to/frontend/build;
        try_files $uri $uri/ /index.html;
    }
}
```

## Key Points

1. **Order Matters**: `/api/` location must come BEFORE the root `/` location
2. **Trailing Slash**: Use `/api/` (with trailing slash) to match all API routes
3. **proxy_pass**: Must point to `http://localhost:8000` (or your backend URL)
4. **Headers**: Ensure proper headers are forwarded to Flask

## Verification Steps

1. **Test the health check endpoint:**
   ```bash
   curl -I https://drpinfotech.com/api/health
   ```
   Should return: `Content-Type: application/json` (NOT `text/html`)

2. **Test the payment test endpoint:**
   ```bash
   curl -I https://drpinfotech.com/api/payment/test
   ```
   Should return: `Content-Type: application/json`

3. **Check Nginx error logs:**
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

4. **Check backend logs:**
   - Verify requests are reaching Flask
   - Look for "Payment create-order endpoint called" logs

## After Updating Nginx

1. **Test configuration:**
   ```bash
   sudo nginx -t
   ```

2. **Reload Nginx:**
   ```bash
   sudo systemctl reload nginx
   ```

3. **Verify backend is running:**
   ```bash
   curl http://localhost:8000/api/health
   ```

## Common Issues

### Issue: Still getting HTML
- Check Nginx config order (API routes must come first)
- Verify `proxy_pass` is correct
- Check if backend is running on port 8000
- Clear Nginx cache: `sudo nginx -s reload`

### Issue: 502 Bad Gateway
- Backend not running: `ps aux | grep python`
- Backend not on port 8000: `netstat -tlnp | grep 8000`
- Firewall blocking: Check `ufw` or `iptables`

### Issue: 404 Not Found
- Route not registered: Check backend logs for "Razorpay routes registered"
- Route path mismatch: Verify route is `/api/payment/create-order`



