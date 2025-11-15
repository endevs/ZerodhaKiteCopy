# Nginx Configuration for Socket.IO

## Problem
The Socket.IO endpoint is returning HTML instead of the Socket.IO handshake, which means Nginx (or CloudFront) is serving a static file instead of proxying to the backend.

## Solution: Proper Nginx Configuration

### Complete Nginx Configuration for Socket.IO

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

    # CRITICAL: Socket.IO must be proxied BEFORE the general /api location
    # Socket.IO uses /socket.io/ path
    location /socket.io/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        
        # WebSocket upgrade headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Important for Socket.IO
        proxy_buffering off;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        
        # CORS headers (if needed)
        add_header Access-Control-Allow-Origin $http_origin always;
        add_header Access-Control-Allow-Credentials true always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
        
        # Handle preflight
        if ($request_method = OPTIONS) {
            return 204;
        }
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

## Key Points

1. **Socket.IO location must come BEFORE `/api`**: Nginx processes locations in order, so `/socket.io/` must be defined before the general `/api` location.

2. **WebSocket upgrade headers**: Critical for Socket.IO to work:
   ```
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   ```

3. **Disable buffering**: `proxy_buffering off;` is essential for real-time communication.

4. **Long timeouts**: Socket.IO connections are long-lived, so set long timeouts.

5. **Path matching**: Use `/socket.io/` (with trailing slash) to match Socket.IO's default path.

## CloudFront/CDN Configuration

If you're using CloudFront or another CDN:

1. **Don't cache Socket.IO requests**: Add a cache behavior that:
   - Path pattern: `/socket.io/*`
   - Cache policy: Disable caching
   - Origin request policy: Include all headers

2. **WebSocket support**: Ensure CloudFront supports WebSocket (it does, but verify the configuration).

3. **Origin**: Point CloudFront origin to your Nginx server, not directly to the backend.

## Testing

After updating Nginx configuration:

1. **Reload Nginx**:
   ```bash
   sudo nginx -t  # Test configuration
   sudo systemctl reload nginx  # Reload if test passes
   ```

2. **Test Socket.IO endpoint**:
   ```bash
   curl -I "https://drpinfotech.com/socket.io/?EIO=4&transport=polling"
   ```
   
   Should return:
   - `Content-Type: text/plain` or `application/json` (NOT `text/html`)
   - Status: `200 OK`
   - Should NOT have `X-Powered-By: Express`

3. **Check Nginx error logs**:
   ```bash
   sudo tail -f /var/log/nginx/error.log
   ```

4. **Check backend logs**: Verify requests are reaching the backend.

## Troubleshooting

### Issue: Still getting HTML response

**Check:**
- Nginx configuration syntax: `sudo nginx -t`
- Nginx is actually running: `sudo systemctl status nginx`
- Backend is running on port 8000: `netstat -tlnp | grep 8000`
- Nginx is proxying correctly: Check access logs

### Issue: 502 Bad Gateway

**Check:**
- Backend is running: `ps aux | grep python`
- Backend is listening on correct port: `netstat -tlnp | grep 8000`
- Firewall allows connections: `sudo ufw status`

### Issue: Connection timeout

**Check:**
- Backend is accessible: `curl http://localhost:8000/socket.io/?EIO=4&transport=polling`
- Nginx can reach backend: Check Nginx error logs
- Timeout settings in Nginx config

## Verification Checklist

- [ ] Nginx configuration includes `/socket.io/` location block
- [ ] `/socket.io/` location comes BEFORE `/api` location
- [ ] WebSocket upgrade headers are set
- [ ] `proxy_buffering off;` is set
- [ ] Long timeouts are configured
- [ ] Nginx configuration test passes: `sudo nginx -t`
- [ ] Nginx reloaded: `sudo systemctl reload nginx`
- [ ] Backend is running on port 8000
- [ ] Socket.IO endpoint returns correct content type (not HTML)
- [ ] No errors in Nginx error logs
- [ ] Backend logs show Socket.IO connection attempts

