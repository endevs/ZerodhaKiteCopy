# Fixing Socket.IO 405 Method Not Allowed Error

## Problem
Getting `405 Method Not Allowed` when accessing `https://drpinfotech.com/socket.io/?EIO=4&transport=polling`

The request reaches the Flask backend (we can see `Server: Werkzeug`), but Flask-SocketIO isn't handling the GET request properly.

## Root Cause
Flask-SocketIO should automatically handle `/socket.io/` paths, but the 405 error suggests the Socket.IO middleware isn't properly intercepting the request before Flask's routing system processes it.

## Solution

### Option 1: Use `socketio.run()` (Recommended)
Ensure you're using `socketio.run()` instead of `app.run()`:

```python
if __name__ == "__main__":
    socketio.run(
        app,
        debug=config.DEBUG,
        host=config.SERVER_HOST,
        port=config.SERVER_PORT,
        allow_unsafe_werkzeug=True
    )
```

**This is already in your code** - verify it's being used in production.

### Option 2: Use Gunicorn with eventlet/gevent
For production, use Gunicorn with an async worker:

```bash
pip install gunicorn eventlet

# Run with:
gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:8000 app:app
```

Or with gevent:
```bash
pip install gunicorn gevent

# Run with:
gunicorn --worker-class gevent --worker-connections 1000 --bind 0.0.0.0:8000 app:app
```

### Option 3: Use uWSGI with gevent
```bash
pip install uwsgi gevent

# Run with:
uwsgi --http :8000 --gevent 1000 --http-websockets --master --wsgi-file app.py --callable app
```

## Current Configuration Check

Your current code uses:
```python
socketio.run(app, ...)
```

This should work, but the 405 error suggests:
1. The server might not be running with `socketio.run()`
2. There might be a middleware conflict
3. The Socket.IO path might be getting intercepted

## Verification Steps

1. **Check how the server is running:**
   ```bash
   # On EC2, check the process:
   ps aux | grep python
   # Should see: python app.py (not gunicorn or uwsgi)
   ```

2. **Check backend logs:**
   Look for Socket.IO initialization messages when the server starts.

3. **Test directly on backend:**
   ```bash
   # On EC2, test directly:
   curl -I "http://localhost:8000/socket.io/?EIO=4&transport=polling"
   ```
   If this works but the public URL doesn't, it's an Nginx/CloudFront issue.

## Nginx Configuration

Ensure Nginx is properly configured (see `NGINX_SOCKETIO_CONFIG.md`):

```nginx
location /socket.io/ {
    proxy_pass http://localhost:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_buffering off;
}
```

## Quick Fix

If using `socketio.run()` and still getting 405:

1. **Restart the backend** to ensure changes are applied
2. **Check backend logs** for Socket.IO initialization
3. **Verify the server is actually using `socketio.run()`** and not `app.run()`

## Production Recommendation

For production, use Gunicorn with eventlet:

```bash
# Install
pip install gunicorn eventlet

# Run
gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:8000 --timeout 120 app:app
```

This ensures proper async handling of Socket.IO connections.


