const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Anthropic: /api/claude → https://api.anthropic.com/v1/messages
  app.use('/api/claude', createProxyMiddleware({
    target: 'https://api.anthropic.com',
    changeOrigin: true,
    pathRewrite: { '^/api/claude': '/v1/messages' },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('x-api-key', process.env.REACT_APP_ANTHROPIC_KEY);
        proxyReq.setHeader('anthropic-version', '2023-06-01');
        proxyReq.removeHeader('origin');
      }
    }
  }));

  // OpenAI: /api/openai → https://api.openai.com/v1/chat/completions
  app.use('/api/openai', createProxyMiddleware({
    target: 'https://api.openai.com',
    changeOrigin: true,
    pathRewrite: { '^/api/openai': '/v1/chat/completions' },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('Authorization', `Bearer ${process.env.OPENAI_API_KEY}`);
        proxyReq.removeHeader('origin');
      }
    }
  }));

  // Gemini: /api/gemini — dynamic model path, handled via custom middleware
  app.use('/api/gemini', (req, res) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', async () => {
      try {
        const { model, ...body } = JSON.parse(raw);
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'x-goog-api-key': process.env.GEMINI_API_KEY,
              'content-type': 'application/json',
            },
            body: JSON.stringify(body),
          }
        );
        const data = await response.json();
        res.status(response.status).json(data);
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });
  });
};
