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

  if (hostname === LOCALHOST) {
    return `${protocol}//${hostname}:${DEFAULT_API_PORT}`;
  }

  const inferredPort =
    port && port !== '0'
      ? port === '3000'
        ? String(DEFAULT_API_PORT)
        : port
      : '';

  return inferredPort
    ? `${protocol}//${hostname}:${inferredPort}`
    : `${protocol}//${hostname}`;
};

const resolvedApiBase =
  sanitizeBase(process.env.REACT_APP_API_BASE) || inferBaseFromWindow();

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

