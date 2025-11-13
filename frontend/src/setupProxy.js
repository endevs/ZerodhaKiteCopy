const { createProxyMiddleware } = require('http-proxy-middleware');

const sanitizeTarget = (value) => {
  if (!value) return null;
  return value.replace(/\/+$/, '');
};

const DEFAULT_TARGET = 'http://localhost:8000';
const target = sanitizeTarget(process.env.REACT_APP_API_BASE) || DEFAULT_TARGET;

module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target,
      changeOrigin: true,
    })
  );
};
