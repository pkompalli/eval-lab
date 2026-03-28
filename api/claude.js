export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const key = process.env.ANTHROPIC_KEY || process.env.REACT_APP_ANTHROPIC_KEY;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(req.body),
  });
  const data = await response.json();
  return res.status(response.status).json(data);
}
