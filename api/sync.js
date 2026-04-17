const GH_OWNER = 'martinechavarriaurrea-sys';
const GH_REPO  = 'ERP';
const GH_BRANCH = 'main';

function sendJson(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

async function getCurrentFile(url, headers) {
  const response = await fetch(`${url}?ref=${GH_BRANCH}`, { headers, cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

async function pushFile(url, headers, body) {
  return fetch(url, {
    method: 'PUT',
    headers,
    cache: 'no-store',
    body: JSON.stringify(body)
  });
}

module.exports = async function handler(req, res) {
  const token = process.env.GH_TOKEN;
  if (!token) return sendJson(res, 503, { error: 'GH_TOKEN env var not configured in Vercel' });

  const userId = String(req.query.userId || '').replace(/[^a-z0-9_-]/g, '');
  if (!userId) return sendJson(res, 400, { error: 'userId required' });

  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${userId}.json`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'erp-personal'
  };

  if (req.method === 'GET') {
    const r = await fetch(`${url}?ref=${GH_BRANCH}`, { headers, cache: 'no-store' });
    if (r.status === 404) return sendJson(res, 404, { notFound: true });
    if (!r.ok) {
      const detail = await r.text();
      console.error('[sync][GET] GitHub error', { userId, status: r.status, detail: detail.slice(0, 300) });
      return sendJson(res, 502, { error: `GitHub ${r.status}` });
    }
    return sendJson(res, 200, await r.json());
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    let body = req.body;
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return sendJson(res, 400, { error: 'Invalid body' }); }
    }
    if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'Invalid body' });

    // Guard: reject pushes that would lose data compared to what's already in GitHub
    try {
      const current = await getCurrentFile(url, headers);
      if (current?.content) {
        const existingRaw = Buffer.from(current.content.replace(/\s/g, ''), 'base64').toString('utf-8');
        const existing = JSON.parse(existingRaw);
        const existingState = typeof existing.data === 'string' ? JSON.parse(existing.data) : existing;
        const newContent = body.content ? Buffer.from(body.content.replace(/\s/g, ''), 'base64').toString('utf-8') : null;
        if (newContent) {
          const newWrapper = JSON.parse(newContent);
          const newState = typeof newWrapper.data === 'string' ? JSON.parse(newWrapper.data) : newWrapper;
          const existingScore = (existingState.deudas?.length || 0) + (existingState.cobrar?.length || 0) + (existingState.movimientos?.length || 0);
          const newScore = (newState.deudas?.length || 0) + (newState.cobrar?.length || 0) + (newState.movimientos?.length || 0);
          if (existingScore > 0 && newScore < existingScore * 0.5) {
            console.error('[sync][GUARD] Rejected data-loss push', { userId, existingScore, newScore });
            return sendJson(res, 409, { error: 'Push rejected: would lose data', existingScore, newScore });
          }
        }
        if (!body.sha && current.sha) body.sha = current.sha;
      }
    } catch (error) {
      console.error('[sync][GUARD] Error reading current file', { userId, message: String(error?.message || error) });
    }

    const payload = { branch: GH_BRANCH, ...body };
    if (!payload.sha) {
      try {
        const current = await getCurrentFile(url, headers);
        if (current?.sha) payload.sha = current.sha;
      } catch (error) {
        console.error('[sync][PREP] GitHub read error', { userId, message: String(error?.message || error) });
      }
    }

    let r = await pushFile(url, headers, payload);
    if (r.status === 409 || r.status === 422) {
      try {
        const current = await getCurrentFile(url, headers);
        if (current?.sha) {
          payload.sha = current.sha;
          r = await pushFile(url, headers, payload);
        }
      } catch (error) {
        console.error('[sync][RETRY] GitHub read error', { userId, message: String(error?.message || error) });
      }
    }

    const raw = await r.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
    if (!r.ok) {
      console.error('[sync][PUT] GitHub error', { userId, status: r.status, detail: raw.slice(0, 300) });
    }
    return sendJson(res, r.ok ? 200 : r.status, data);
  }

  res.setHeader('Allow', 'GET, PUT, POST');
  return sendJson(res, 405, { error: 'Method not allowed' });
};
