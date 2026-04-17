const GH_OWNER = 'martinechavarriaurrea-sys';
const GH_REPO  = 'ERP';
const GH_BRANCH = 'main';

module.exports = async function handler(req, res) {
  const token = process.env.GH_TOKEN;
  if (!token) return res.status(503).json({ error: 'GH_TOKEN env var not configured in Vercel' });

  const userId = String(req.query.userId || '').replace(/[^a-z0-9_-]/g, '');
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${userId}.json`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'erp-personal'
  };

  if (req.method === 'GET') {
    const r = await fetch(`${url}?ref=${GH_BRANCH}`, { headers });
    if (r.status === 404) return res.status(404).json({ notFound: true });
    if (!r.ok) return res.status(502).json({ error: `GitHub ${r.status}` });
    return res.status(200).json(await r.json());
  }

  if (req.method === 'PUT') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid body' }); }
    }
    const r = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ branch: GH_BRANCH, ...body })
    });
    const data = await r.json();
    return res.status(r.ok ? 200 : r.status).json(data);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
