const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Anthropic
  app.use('/api', createProxyMiddleware({
    target: 'https://api.anthropic.com',
    changeOrigin: true,
    pathRewrite: { '^/api': '' },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('x-api-key', process.env.REACT_APP_ANTHROPIC_KEY);
        proxyReq.setHeader('anthropic-version', '2023-06-01');
        proxyReq.setHeader('anthropic-dangerous-direct-browser-access', 'true');
        proxyReq.removeHeader('origin');
      }
    }
  }));

  // OpenAI
  app.use('/openai', createProxyMiddleware({
    target: 'https://api.openai.com',
    changeOrigin: true,
    pathRewrite: { '^/openai': '' },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('Authorization', `Bearer ${process.env.OPENAI_API_KEY}`);
        proxyReq.removeHeader('origin');
      }
    }
  }));

  // Gemini
  app.use('/gemini', createProxyMiddleware({
    target: 'https://generativelanguage.googleapis.com',
    changeOrigin: true,
    pathRewrite: { '^/gemini': '' },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('x-goog-api-key', process.env.GEMINI_API_KEY);
        proxyReq.removeHeader('origin');
      }
    }
  }));
};
