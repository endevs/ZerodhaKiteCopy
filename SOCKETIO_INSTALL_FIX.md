# Fixing Socket.IO 405 Error - Installation Guide

## Problem
Getting `405 Method Not Allowed` for `/socket.io/` even on localhost, which means Flask-SocketIO isn't properly handling Socket.IO requests.

## Root Cause
Flask-SocketIO requires an async framework (eventlet or gevent) for proper operation. The `threading` mode doesn't work well for Socket.IO connections.

## Solution

### Step 1: Install eventlet

On your local machine and AWS EC2:

```bash
cd backend
pip install eventlet
```

Or update requirements.txt (already done) and install:

```bash
pip install -r requirements.txt
```

### Step 2: Restart Backend

After installing eventlet, restart your backend:

```bash
# Stop current backend
# Then restart:
python app.py
```

### Step 3: Verify

Check backend logs - you should see:
```
SocketIO: Using eventlet async mode
```

### Step 4: Test

```bash
curl -I "http://localhost:8000/socket.io/?EIO=4&transport=polling"
```

Should now return `200 OK` instead of `405 Method Not Allowed`.

## What Changed

1. **Added eventlet to requirements.txt**
2. **Updated Socket.IO initialization** to:
   - Try eventlet first (best for Socket.IO)
   - Fallback to gevent if eventlet not available
   - Fallback to threading only if neither is available
3. **Added `always_connect=True`** to Socket.IO config

## Why eventlet?

- Flask-SocketIO works best with eventlet or gevent
- `threading` mode has limitations with WebSocket/polling transports
- eventlet provides proper async I/O for Socket.IO connections

## Alternative: Use gevent

If you prefer gevent:

```bash
pip install gevent
```

The code will automatically detect and use gevent if eventlet is not available.

## Production Recommendation

For production on AWS EC2:

1. **Install eventlet:**
   ```bash
   pip install eventlet
   ```

2. **Or use Gunicorn with eventlet:**
   ```bash
   pip install gunicorn eventlet
   gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:8000 app:app
   ```

## Verification

After installing eventlet and restarting:

1. Check logs for: `SocketIO: Using eventlet async mode`
2. Test endpoint: `curl -I "http://localhost:8000/socket.io/?EIO=4&transport=polling"`
3. Should return `200 OK` with proper Socket.IO response





