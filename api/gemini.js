export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { model, ...body } = req.body;
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
  return res.status(response.status).json(data);
}
