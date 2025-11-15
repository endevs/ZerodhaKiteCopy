const { createProxyMiddleware } = require('http-proxy-middleware');

const sanitizeTarget = (value) => {
  if (!value) return null;
  return value.replace(/\/+$/, '');
};

// Use environment variable or default to localhost for development
// In production, this should be set via REACT_APP_API_BASE
const DEFAULT_TARGET = 'http://localhost:8000';
const target = sanitizeTarget(process.env.REACT_APP_API_BASE) || DEFAULT_TARGET;

// Log in development only
if (process.env.NODE_ENV === 'development') {
  console.log('Proxy target:', target);
}

module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target,
      changeOrigin: true,
    })
  );
};
