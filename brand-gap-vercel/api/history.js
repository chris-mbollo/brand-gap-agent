/**
 * /api/history.js
 *
 * Save and retrieve brand gap runs using Vercel KV (Redis).
 * Free tier: 256MB storage, 3,000 requests/day.
 *
 * Setup (one-time):
 *   vercel kv create brand-gap-memory
 *   vercel env pull  (pulls KV_REST_API_URL and KV_REST_API_TOKEN into .env.local)
 *
 * Routes:
 *   POST /api/history         — save a completed run
 *   GET  /api/history         — list all past runs (summary only)
 *   GET  /api/history?id=xxx  — get full run by ID
 *   DELETE /api/history?id=xxx — delete a run
 */

// Vercel KV REST client (edge-compatible, no SDK needed)
const kv = {
  async get(key) {
    const res = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result ? JSON.parse(data.result) : null;
  },

  async set(key, value, exSeconds) {
    const body = exSeconds
      ? { value: JSON.stringify(value), ex: exSeconds }
      : { value: JSON.stringify(value) };
    const res = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    return res.ok;
  },

  async del(key) {
    const res = await fetch(`${process.env.KV_REST_API_URL}/del/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
    });
    return res.ok;
  },

  async lrange(key, start, end) {
    const res = await fetch(`${process.env.KV_REST_API_URL}/lrange/${encodeURIComponent(key)}/${start}/${end}`, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.result || [];
  },

  async lpush(key, ...values) {
    const res = await fetch(`${process.env.KV_REST_API_URL}/lpush/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(values.map(v => JSON.stringify(v)))
    });
    return res.ok;
  }
};

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // Check KV is configured
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return new Response(JSON.stringify({
      error: 'Vercel KV not configured',
      setup: 'Run: vercel kv create brand-gap-memory && vercel env pull'
    }), { status: 503, headers: CORS });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  // ── GET: fetch run by ID or list all ──────────────────────────────────────
  if (req.method === 'GET') {
    if (id) {
      const run = await kv.get(`run:${id}`);
      if (!run) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: CORS });
      return new Response(JSON.stringify(run), { headers: CORS });
    }

    // List all runs (index stored as a list of summaries)
    const indexRaw = await kv.lrange('runs:index', 0, 49); // last 50 runs
    const index = indexRaw.map(item => {
      try { return typeof item === 'string' ? JSON.parse(item) : item; } catch { return null; }
    }).filter(Boolean);

    return new Response(JSON.stringify({ runs: index, count: index.length }), { headers: CORS });
  }

  // ── POST: save a completed run ────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS });
    }

    const { results, market } = body;
    if (!results || !market) {
      return new Response(JSON.stringify({ error: 'results and market required' }), { status: 400, headers: CORS });
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // Full run data (stored for 90 days)
    const runData = {
      id,
      market,
      createdAt: now,
      results,
      summary: {
        brand:      results.brand?.winner,
        tagline:    results.brand?.tagline,
        product:    results.gap?.winnerProduct,
        subCommunity: results.gap?.winnerSubCommunity,
        gapScore:   results.gap?.gapScore,
        verdict:    results.validate?.verdict,
        timing:     results.validate?.verdict,
        retailPrice: results.validate?.suggestedRetailPrice,
        totalBudget: results.supplier?.estimatedBudget?.total,
        competitorVerdict: results.competitors?.verdict,
        verificationPassed: results.verify?.passed,
        dataSource: results.mine?.dataSource
      }
    };

    // Save full run
    await kv.set(`run:${id}`, runData, 60 * 60 * 24 * 90); // 90 days TTL

    // Update index (lightweight summary only)
    await kv.lpush('runs:index', {
      id,
      market,
      createdAt: now,
      brand:      runData.summary.brand,
      product:    runData.summary.product,
      gapScore:   runData.summary.gapScore,
      verdict:    runData.summary.verdict,
      competitorVerdict: runData.summary.competitorVerdict,
      verified:   runData.summary.verificationPassed
    });

    // Also track explored opportunities to avoid re-finding same gaps
    const exploredKey = `explored:${market.toLowerCase().replace(/\s+/g, '-')}`;
    const existing = await kv.get(exploredKey) || [];
    const updated = [...existing, {
      product:      results.gap?.winnerProduct,
      subCommunity: results.gap?.winnerSubCommunity,
      gapScore:     results.gap?.gapScore,
      exploredAt:   now
    }].slice(-20); // keep last 20 per market
    await kv.set(exploredKey, updated);

    return new Response(JSON.stringify({ id, saved: true, summary: runData.summary }), {
      status: 201, headers: CORS
    });
  }

  // ── DELETE: remove a run ──────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: CORS });
    await kv.del(`run:${id}`);
    return new Response(JSON.stringify({ deleted: true }), { headers: CORS });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
}
