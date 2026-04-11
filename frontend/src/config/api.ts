const DEFAULT_API_PORT = 8003;
const LOCALHOST = 'localhost';

const sanitizeBase = (input?: string | null): string | null => {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
};

const inferBaseFromWindow = (): string => {
  if (typeof window === 'undefined') {
    return `http://${LOCALHOST}:${DEFAULT_API_PORT}`;
  }

  const { protocol, hostname, port } = window.location;

  // Localhost: use same origin so /api and /socket.io hit the dev server (setupProxy) or Docker Nginx (:5175), not a bare :8003 on the host.
  if (hostname === LOCALHOST || hostname === '127.0.0.1') {
    return window.location.origin;
  }

  // For production (e.g., drpinfotech.com), use the same domain
  // Backend is typically on the same domain (via nginx reverse proxy) or same port
  // If backend is on a different port, it should be set via REACT_APP_API_BASE
  if (port && port !== '0' && port !== '443' && port !== '80') {
    // If there's a specific port, use it (but typically production uses 443/80)
    return `${protocol}//${hostname}:${port}`;
  }

  // Default: same domain, same protocol (backend should be proxied via nginx)
  return `${protocol}//${hostname}`;
};

// For production, prefer explicit env vars, otherwise infer from window location
// React appends REACT_APP_ prefix to env vars during build
// IMPORTANT: Environment variables are embedded at BUILD TIME, not runtime
let resolvedApiBase =
  sanitizeBase(process.env.REACT_APP_API_BASE) || inferBaseFromWindow();

// Runtime override: If we're in production (not localhost) but API_BASE_URL is localhost,
// override it to use the current domain (for cases where build didn't use .env.production)
if (typeof window !== 'undefined') {
  const { protocol, hostname } = window.location;
  const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1';
  const isLocalhostUrl = resolvedApiBase && (resolvedApiBase.includes('localhost') || resolvedApiBase.includes('127.0.0.1'));
  
  if (isProduction && isLocalhostUrl) {
    // Override: use current domain for production
    resolvedApiBase = `${protocol}//${hostname}`;
  }
}

// Socket.IO should use the same base as API, but ensure it uses the correct protocol
// For production, always use the same domain without any port
let resolvedSocketBase =
  sanitizeBase(process.env.REACT_APP_SOCKET_BASE) || resolvedApiBase;

// Runtime override for Socket.IO - ensure production uses correct URL
if (typeof window !== 'undefined') {
  const { protocol, hostname } = window.location;
  const isProduction = hostname !== 'localhost' && hostname !== '127.0.0.1';
  
  if (isProduction) {
    // For production, always use the same domain without port (CloudFront handles routing)
    // Use wss:// for secure connections, ws:// for non-secure
    const socketProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    resolvedSocketBase = `${socketProtocol}//${hostname}`;
  } else {
    // Localhost: Socket.IO follows API base (same origin + proxied /socket.io/).
    resolvedSocketBase = resolvedApiBase;
  }
}

// Final cleanup: remove any port numbers from production URLs
if (resolvedSocketBase && !resolvedSocketBase.includes('localhost') && !resolvedSocketBase.includes('127.0.0.1')) {
  // Remove any port number (3000, 8003, etc.) from production URLs
  resolvedSocketBase = resolvedSocketBase.replace(/:(\d+)(\/|$)/, '$2');
}

// Final cleanup: ensure no trailing slashes and proper format
if (resolvedSocketBase) {
  resolvedSocketBase = resolvedSocketBase.replace(/\/+$/, '');
}

export const API_BASE_URL = resolvedApiBase;
export const SOCKET_BASE_URL = resolvedSocketBase;

// Debug logging - show in both development and production for troubleshooting
if (typeof window !== 'undefined') {
  console.log('[API Config] API_BASE_URL:', API_BASE_URL);
  console.log('[API Config] SOCKET_BASE_URL:', SOCKET_BASE_URL);
  console.log('[API Config] Window location:', window.location.href);
  console.log('[API Config] Window protocol:', window.location.protocol);
  console.log('[API Config] Window hostname:', window.location.hostname);
  console.log('[API Config] Window port:', window.location.port);
}

export const apiUrl = (path: string): string => {
  if (!path.startsWith('/')) {
    return `${API_BASE_URL}/${path}`;
  }
  return `${API_BASE_URL}${path}`;
};

/**
 * Parse JSON from an API response. If the edge/origin returned HTML (index.html or
 * CloudFront error page), throw a message that points to routing/port misconfig.
 */
export async function parseResponseJson<T = unknown>(response: Response): Promise<T> {
  const ct = (response.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    return response.json() as Promise<T>;
  }
  const text = await response.text();
  const start = text.trimStart().slice(0, 80);
  if (start.startsWith('<!') || start.toLowerCase().startsWith('<html')) {
    throw new Error(
      'API returned HTML instead of JSON. Check CloudFront: route /api/* (and /socket.io/*) to the EC2 ' +
        'frontend on port 5175 (Nginx proxies to Flask), or to Flask directly on port 8003 — not 8000 or an S3/static-only origin.'
    );
  }
  throw new Error(
    `Expected JSON from API (HTTP ${response.status}), got ${ct || 'unknown content-type'}: ${start.slice(0, 120)}`
  );
}

