# Coding Standards: Environment-Aware Development

## Core Principle

**Always write code that works in BOTH local and production environments without modification.**

## Commitment

From now on, all code written will:
- ✅ Work seamlessly in both localhost and production
- ✅ Use environment variables and config helpers
- ✅ Never hardcode URLs, IPs, or environment-specific paths
- ✅ Use helper functions like `_get_frontend_url()` for environment detection
- ✅ Test in both environments before committing

## Checklist Before Writing Code

### ✅ Environment Configuration
- [ ] Use environment variables, never hardcode URLs/IPs
- [ ] Use `apiUrl()` helper from `frontend/src/config/api.ts` for API calls
- [ ] Use `SOCKET_BASE_URL` from config for Socket.IO connections
- [ ] Never hardcode `localhost:8000` or `localhost:3000`
- [ ] Never hardcode production URLs like `https://drpinfotech.com`

### ✅ Backend API Endpoints
- [ ] Use `config.FRONTEND_URL` for redirects, not hardcoded URLs
- [ ] Auto-detect frontend URL from request headers when possible
- [ ] Support both `/api/*` and non-`/api/*` routes for consistency
- [ ] Handle CORS for both localhost and production domains

### ✅ Database & File Paths
- [ ] Use relative paths or `config.DATABASE_PATH`
- [ ] Never hardcode absolute paths like `C:\Users\...` or `/home/user/...`
- [ ] Use `os.path.join()` for cross-platform compatibility

### ✅ Logging & Debugging
- [ ] Use `logging` module, not `print()` statements
- [ ] Check `config.DEBUG` before verbose logging
- [ ] Don't log sensitive information (API keys, passwords)
- [ ] Use appropriate log levels (DEBUG, INFO, WARNING, ERROR)

### ✅ Error Handling
- [ ] Handle both development and production error scenarios
- [ ] Return user-friendly error messages (don't expose stack traces in production)
- [ ] Log detailed errors server-side, send generic messages to client

### ✅ Frontend Code
- [ ] Always use `apiUrl()` helper, never hardcode API URLs
- [ ] Use `SOCKET_BASE_URL` for Socket.IO, never hardcode
- [ ] Check `window.location.hostname` for environment detection if needed
- [ ] Don't assume port 3000 or 8000 exists

### ✅ Testing
- [ ] Test code works with both localhost and production URLs
- [ ] Verify CORS works in both environments
- [ ] Test Socket.IO connections in both environments

## Common Pitfalls to Avoid

### ❌ DON'T:
```python
# Backend - BAD
return redirect('http://localhost:3000/dashboard')
return jsonify({'url': 'http://localhost:8000/api/data'})

# Frontend - BAD
fetch('http://localhost:8000/api/login')
const socket = io('http://localhost:8000')
```

### ✅ DO:
```python
# Backend - GOOD
frontend_url = config.FRONTEND_URL
if not frontend_url or frontend_url == 'http://localhost:3000':
    origin = request.headers.get('Origin', '')
    if origin and 'localhost' not in origin:
        frontend_url = origin
return redirect(f"{frontend_url}/dashboard")
```

```typescript
// Frontend - GOOD
import { apiUrl, SOCKET_BASE_URL } from '../config/api';
fetch(apiUrl('/api/login'))
const socket = io(SOCKET_BASE_URL, { path: '/socket.io/' })
```

## Environment Detection Patterns

### Backend Pattern:
```python
# Detect production vs localhost
def get_frontend_url():
    frontend_url = config.FRONTEND_URL
    if not frontend_url or frontend_url == 'http://localhost:3000':
        # Try to infer from request
        origin = request.headers.get('Origin', '')
        if origin and 'localhost' not in origin:
            return origin
        return 'http://localhost:3000'
    return frontend_url
```

### Frontend Pattern:
```typescript
// Runtime environment detection
const isProduction = window.location.hostname !== 'localhost' && 
                     window.location.hostname !== '127.0.0.1';

// Use config values (already set at build time)
const apiBase = API_BASE_URL; // From config/api.ts
```

## Code Review Checklist

Before committing code, verify:

1. **No hardcoded URLs**: Search for `localhost`, `127.0.0.1`, `drpinfotech.com`
2. **Uses config helpers**: All API calls use `apiUrl()`, Socket.IO uses `SOCKET_BASE_URL`
3. **Environment variables**: All environment-specific values come from config/env
4. **Cross-platform paths**: No Windows/Mac/Linux specific paths
5. **Error messages**: User-friendly, no stack traces exposed
6. **CORS handling**: Works for both localhost and production domains

## Testing Both Environments

### Local Testing:
```bash
# Frontend
npm start  # Uses .env.development

# Backend
python app.py  # Uses backend/.env
```

### Production Testing:
```bash
# Frontend
npm run build  # Uses .env.production

# Backend
# Uses backend/.env on AWS EC2
```

## Quick Reference

| What | Local | Production |
|------|-------|------------|
| Frontend API | `http://localhost:8000` | `https://drpinfotech.com` |
| Frontend URL | `http://localhost:3000` | `https://drpinfotech.com` |
| Socket.IO | `http://localhost:8000` | `https://drpinfotech.com` |
| Backend Port | `8000` | `8000` (proxied via Nginx) |
| CORS Origins | `http://localhost:3000` | `https://drpinfotech.com` |

**Solution**: Use environment variables and config helpers, never hardcode!

