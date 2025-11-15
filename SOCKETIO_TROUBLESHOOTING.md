# Socket.IO Connection Troubleshooting

## Error: "WebSocket connection error: Error: server error"

This error indicates that Socket.IO is trying to connect but the server is rejecting the connection or there's a configuration issue.

## Fixes Applied

1. **Enhanced CORS Configuration**: Socket.IO now automatically adds the production domain from `FRONTEND_URL` to allowed origins
2. **Better Error Logging**: Enabled Socket.IO and EngineIO logging to help debug connection issues
3. **Improved Error Handling**: Better exception handling in the connect handler with full tracebacks
4. **Ping Configuration**: Added ping_timeout and ping_interval for better connection stability

## Required Backend Configuration on AWS EC2

### 1. Update `backend/.env` file:

```env
# CORS Configuration - MUST include production domain
CORS_ORIGINS=https://drpinfotech.com,http://localhost:3000

# Frontend URL - Used to auto-add to Socket.IO CORS
FRONTEND_URL=https://drpinfotech.com
```

### 2. Restart Backend

After updating `.env`, restart the backend to apply changes:

```bash
# Stop the current backend process
# Then restart it
```

### 3. Check Backend Logs

After restarting, check the logs for:

```
SocketIO: Added production origin to CORS: https://drpinfotech.com
```

This confirms the production domain was added to Socket.IO CORS.

## Nginx Configuration

Ensure Nginx is properly proxying Socket.IO:

```nginx
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
    
    # Important for Socket.IO
    proxy_buffering off;
    proxy_read_timeout 86400;
}
```

## Testing

1. **Check Socket.IO endpoint:**
   ```bash
   curl -I https://drpinfotech.com/socket.io/?EIO=4&transport=polling
   ```
   Should return 200 OK, not 404 or 403.

2. **Check browser console:**
   - Open `https://drpinfotech.com`
   - Open browser DevTools → Network tab
   - Filter by "WS" or "socket.io"
   - Look for connection attempts
   - Check for CORS errors

3. **Check backend logs:**
   - Look for "SocketIO: Connection accepted" messages
   - Check for any error messages related to Socket.IO
   - Verify CORS origin is being accepted

## Common Issues

### Issue: CORS Error in Browser Console

**Solution:**
- Verify `CORS_ORIGINS` in backend `.env` includes `https://drpinfotech.com`
- Restart backend after updating `.env`
- Check that Socket.IO logs show the origin was added

### Issue: 404 Not Found for /socket.io/

**Solution:**
- Check Nginx configuration is proxying `/socket.io` correctly
- Verify backend is running on port 8000
- Check Nginx error logs: `sudo tail -f /var/log/nginx/error.log`

### Issue: Connection Timeout

**Solution:**
- Check firewall rules allow WebSocket connections
- Verify ping_timeout and ping_interval settings
- Check network connectivity between frontend and backend

### Issue: "server error" from Socket.IO

**Possible Causes:**
1. **CORS origin not allowed**: Check backend logs for CORS rejection
2. **Connect handler throwing exception**: Check backend logs for full error traceback
3. **Session access issues**: Check if session is accessible during Socket.IO handshake
4. **Nginx not proxying correctly**: Check Nginx configuration and logs

**Debug Steps:**
1. Enable Socket.IO logging (already done in code)
2. Check backend logs when connection attempt is made
3. Look for the full error traceback in logs
4. Verify Nginx is proxying correctly

## Verification Checklist

- [ ] Backend `.env` has `CORS_ORIGINS=https://drpinfotech.com,http://localhost:3000`
- [ ] Backend `.env` has `FRONTEND_URL=https://drpinfotech.com`
- [ ] Backend restarted after `.env` changes
- [ ] Backend logs show "SocketIO: Added production origin to CORS"
- [ ] Nginx configured to proxy `/socket.io` to backend
- [ ] Nginx restarted after configuration changes
- [ ] Socket.IO endpoint accessible: `curl -I https://drpinfotech.com/socket.io/?EIO=4&transport=polling`
- [ ] No CORS errors in browser console
- [ ] Backend logs show "SocketIO: Connection accepted" when frontend connects

## Next Steps

1. Update backend `.env` with correct CORS_ORIGINS and FRONTEND_URL
2. Restart backend
3. Check backend logs for Socket.IO connection attempts
4. Verify Nginx is proxying correctly
5. Test connection from browser and check console/network tabs

