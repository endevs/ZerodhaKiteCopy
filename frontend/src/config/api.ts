const DEFAULT_API_PORT = 8000;
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

  if (hostname === LOCALHOST || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:${DEFAULT_API_PORT}`;
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
const resolvedApiBase =
  sanitizeBase(process.env.REACT_APP_API_BASE) || inferBaseFromWindow();

// Socket.IO should use the same base as API, but ensure it uses the correct protocol
const resolvedSocketBase =
  sanitizeBase(process.env.REACT_APP_SOCKET_BASE) || resolvedApiBase;

export const API_BASE_URL = resolvedApiBase;
export const SOCKET_BASE_URL = resolvedSocketBase;

export const apiUrl = (path: string): string => {
  if (!path.startsWith('/')) {
    return `${API_BASE_URL}/${path}`;
  }
  return `${API_BASE_URL}${path}`;
};

