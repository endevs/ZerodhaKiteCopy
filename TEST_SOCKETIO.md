# Testing Socket.IO Connection

## Important Note

The warning "Method HEAD not supported" is **EXPECTED** when using `curl -I` because:
- `curl -I` sends a **HEAD** request
- Socket.IO polling transport uses **GET** requests
- Socket.IO doesn't support HEAD requests

## Correct Test Command

Use GET request instead of HEAD:

```bash
# Windows PowerShell:
Invoke-WebRequest -Uri "http://localhost:8000/socket.io/?EIO=4&transport=polling" -Method GET

# Or use actual curl (if installed):
curl.exe -X GET "http://localhost:8000/socket.io/?EIO=4&transport=polling"

# Or use Python:
python -c "import requests; r = requests.get('http://localhost:8000/socket.io/?EIO=4&transport=polling'); print(r.status_code, r.text[:200])"
```

## Expected Response

A successful Socket.IO handshake should return:
- Status: `200 OK`
- Content-Type: `text/plain` or `application/json`
- Body: Contains Socket.IO handshake data (usually starts with `0{"sid":"..."}` or similar)

## If Still Getting 405

1. **Verify backend is using eventlet:**
   - Check logs for: `Server initialized for eventlet`
   - If not, install: `pip install eventlet`

2. **Check Flask-SocketIO version:**
   ```bash
   pip show Flask-SocketIO
   ```
   Should be 4.x or 5.x

3. **Verify `socketio.run()` is being used:**
   - Check the startup code uses `socketio.run(app, ...)` not `app.run()`

4. **Test with Python requests:**
   ```python
   import requests
   r = requests.get('http://localhost:8000/socket.io/?EIO=4&transport=polling')
   print(r.status_code)
   print(r.text[:200])
   ```

## Frontend Connection

The frontend should connect automatically when the page loads. Check browser console for:
- Socket.IO connection messages
- Any error messages

If you see connection errors, check:
- Backend logs for connection attempts
- CORS configuration
- Socket.IO path matches between frontend and backend






