const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // All LLM calls → OpenRouter
  app.use('/api/openrouter', createProxyMiddleware({
    target: 'https://openrouter.ai',
    changeOrigin: true,
    pathRewrite: { '^/api/openrouter': '/api/v1/chat/completions' },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('Authorization', `Bearer ${process.env.OPENROUTER_API_KEY}`);
        proxyReq.removeHeader('origin');
      }
    }
  }));
};
