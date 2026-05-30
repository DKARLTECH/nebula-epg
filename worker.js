/**
 * StatusVault Cloudflare Worker
 * ─────────────────────────────
 * Endpoints:
 *   POST /ping          — count a new install  (requires X-App-Secret)
 *   GET  /stats         — read install count   (requires X-App-Secret)
 *   GET  /version       — read version config  (public — called by the app)
 *   POST /version       — update version config (requires X-App-Secret)
 *
 * /version response includes: min_version, latest_version, store_url, apk_url
 * The app uses apk_url (direct APK link) when store_url is empty.
 *
 * KV namespace binding: COUNTER
 * Secret:               APP_SECRET  (set as a Worker env variable in Cloudflare dashboard)
 *
 * Deploy:
 *   1. Create a KV namespace called COUNTER in Cloudflare dashboard
 *   2. Bind it to this Worker as "COUNTER"
 *   3. Add an environment variable: APP_SECRET = <your chosen password>
 *   4. Deploy with `wrangler deploy` or paste into the online editor
 */

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // ── CORS: allow the admin HTML page to call from any origin ──────────
    const corsHeaders = {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Secret',
    };
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── Auth helper ───────────────────────────────────────────────────────
    const isAuthed = () =>
      request.headers.get('X-App-Secret') === env.APP_SECRET;

    // ── POST /ping — record a new install ─────────────────────────────────
    if (method === 'POST' && path === '/ping') {
      if (!isAuthed()) return deny(corsHeaders);
      const current = parseInt((await env.COUNTER.get('installs')) ?? '0');
      await env.COUNTER.put('installs', String(current + 1));
      return json({ ok: true, installs: current + 1 }, 200, corsHeaders);
    }

    // ── GET /stats — read install count ──────────────────────────────────
    if (method === 'GET' && path === '/stats') {
      if (!isAuthed()) return deny(corsHeaders);
      const installs = parseInt((await env.COUNTER.get('installs')) ?? '0');
      return json({ installs }, 200, corsHeaders);
    }

    // ── GET /version — public; app calls this on every launch ────────────
    if (method === 'GET' && path === '/version') {
      const [minVersion, latestVersion, storeUrl, apkUrl] = await Promise.all([
        env.COUNTER.get('min_version'),
        env.COUNTER.get('latest_version'),
        env.COUNTER.get('store_url'),
        env.COUNTER.get('apk_url'),
      ]);
      return json({
        min_version:    minVersion    ?? '1.0.0',
        latest_version: latestVersion ?? '1.0.0',
        store_url:      storeUrl      ?? '',
        apk_url:        apkUrl        ?? '',
      }, 200, corsHeaders);
    }

    // ── POST /version — update version config from admin page ─────────────
    if (method === 'POST' && path === '/version') {
      if (!isAuthed()) return deny(corsHeaders);
      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'Invalid JSON' }, 400, corsHeaders); }

      const puts = [];
      if (body.min_version    != null) puts.push(env.COUNTER.put('min_version',    body.min_version));
      if (body.latest_version != null) puts.push(env.COUNTER.put('latest_version', body.latest_version));
      if (body.store_url      != null) puts.push(env.COUNTER.put('store_url',      body.store_url));
      if (body.apk_url        != null) puts.push(env.COUNTER.put('apk_url',        body.apk_url));
      await Promise.all(puts);
      return json({ ok: true }, 200, corsHeaders);
    }

    return json({ error: 'Not found' }, 404, corsHeaders);
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function deny(extra = {}) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}
