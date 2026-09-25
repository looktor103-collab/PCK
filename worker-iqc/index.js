/* ============================================================================
   IQC API — Cloudflare Worker + D1 for IQC/IQC_HIV_VL_Generator.html
   ----------------------------------------------------------------------------
   Separate from splab-pck on purpose (same reason as worker-api): splab-pck sits
   behind Cloudflare Access, so browser fetches without a login session would be
   redirected to the Access login page.

     GET  /api/iqc?lab=016&assay=HIV-1   → { ok, runs, peer, benchmark }
     POST /api/iqc  { lab, assay, sourceFile, reportDate, runs, peer, benchmark }

   The API key is embedded in the public page source so every computer works
   without typing it, so it is not a real secret. The Origin allow-list only stops
   other websites' scripts; a non-browser client can still send any Origin.
   ============================================================================ */

const ALLOWED_ORIGINS = [
  'https://looktor103-collab.github.io',
  'https://splab-pck.looktor103.workers.dev',
  'null', // page opened as a local file (file://)
];
const MAX_BODY_BYTES = 2_000_000;
const MAX_RUNS = 5000;
const MAX_BENCHMARK_ROWS = 5000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-API-Key',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

function authorized(request, env) {
  const key = request.headers.get('X-API-Key');
  if (!env.API_KEY || key !== env.API_KEY) return false;
  const origin = request.headers.get('Origin');
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

const str = (v, max = 64) => String(v ?? '').trim().slice(0, max);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (url.pathname !== '/api/iqc') return json({ ok: false, error: 'not found' }, 404);
    if (!authorized(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);

    try {
      if (request.method === 'GET') return await handleGet(url, env.DB);
      if (request.method === 'POST') return await handlePost(request, env.DB);
      return json({ ok: false, error: 'method not allowed' }, 405);
    } catch (err) {
      return json({ ok: false, error: String(err && err.message || err) }, 500);
    }
  },
};

async function handleGet(url, db) {
  const lab = str(url.searchParams.get('lab'));
  const assay = str(url.searchParams.get('assay'));
  if (!lab || !assay) return json({ ok: false, error: 'lab and assay are required' }, 400);

  const runs = await db.prepare(
    `SELECT level, reagent_lot AS reagentLot, control_lot AS controlLot, run_date AS date, value
       FROM iqc_runs WHERE lab_code = ? AND assay = ?
      ORDER BY run_date, id`
  ).bind(lab, assay).all();

  const peer = await db.prepare(
    `SELECT level, reagent_lot AS reagentLot, control_lot AS controlLot,
            peer_mean AS mean, peer_sd AS sd, peer_cv AS cv, peer_n AS n,
            report_date AS reportDate, source_file AS sourceFile
       FROM iqc_peer WHERE lab_code = ? AND assay = ?`
  ).bind(lab, assay).all();

  const bench = await db.prepare(
    `SELECT rows, report_date AS reportDate, source_file AS sourceFile
       FROM iqc_benchmark WHERE lab_code = ? AND assay = ?`
  ).bind(lab, assay).first();

  let benchmark = null;
  if (bench) {
    try { benchmark = { rows: JSON.parse(bench.rows), reportDate: bench.reportDate, sourceFile: bench.sourceFile }; }
    catch { benchmark = null; }
  }
  return json({ ok: true, runs: runs.results, peer: peer.results, benchmark });
}

async function handlePost(request, db) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ ok: false, error: 'payload too large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ ok: false, error: 'invalid JSON' }, 400); }

  const lab = str(body.lab), assay = str(body.assay);
  const sourceFile = str(body.sourceFile, 200) || null;
  const reportDate = ISO_DATE.test(body.reportDate) ? body.reportDate : new Date().toISOString().slice(0, 10);
  if (!lab || !assay) return json({ ok: false, error: 'lab and assay are required' }, 400);

  const runsIn = Array.isArray(body.runs) ? body.runs : [];
  const peerIn = Array.isArray(body.peer) ? body.peer : [];
  if (runsIn.length > MAX_RUNS) return json({ ok: false, error: `too many runs (max ${MAX_RUNS})` }, 400);

  const runStmt = db.prepare(
    `INSERT OR IGNORE INTO iqc_runs
       (lab_code, assay, level, reagent_lot, control_lot, run_date, value, source_file)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const runs = [];
  for (const r of runsIn) {
    const level = str(r && r.level).toUpperCase();
    const value = num(r && r.value);
    const reagentLot = str(r && r.reagentLot);
    if ((level !== 'HPC' && level !== 'LPC') || !reagentLot || !ISO_DATE.test(r.date) || value === null || value <= 0 || value > 12) continue;
    runs.push(runStmt.bind(lab, assay, level, reagentLot, str(r.controlLot), r.date,
      Math.round(value * 10000) / 10000, sourceFile));
  }

  let inserted = 0;
  for (let i = 0; i < runs.length; i += 100) {
    const res = await db.batch(runs.slice(i, i + 100));
    inserted += res.reduce((n, x) => n + (x.meta && x.meta.changes || 0), 0);
  }

  const now = new Date().toISOString();
  const peerStmt = db.prepare(
    `INSERT INTO iqc_peer
       (lab_code, assay, level, reagent_lot, control_lot, peer_mean, peer_sd, peer_cv, peer_n, report_date, source_file, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (lab_code, assay, level, reagent_lot, control_lot) DO UPDATE SET
       peer_mean = excluded.peer_mean, peer_sd = excluded.peer_sd, peer_cv = excluded.peer_cv,
       peer_n = excluded.peer_n, report_date = excluded.report_date,
       source_file = excluded.source_file, updated_at = excluded.updated_at
     WHERE excluded.report_date >= iqc_peer.report_date`
  );
  const peers = [];
  for (const p of peerIn) {
    const level = str(p && p.level).toUpperCase();
    const mean = num(p && p.mean), sd = num(p && p.sd);
    const reagentLot = str(p && p.reagentLot);
    if ((level !== 'HPC' && level !== 'LPC') || !reagentLot || mean === null || sd === null || sd <= 0) continue;
    peers.push(peerStmt.bind(lab, assay, level, reagentLot, str(p.controlLot), mean, sd,
      num(p.cv), num(p.n), reportDate, sourceFile, now));
  }
  let peerSaved = 0;
  if (peers.length) {
    const res = await db.batch(peers);
    peerSaved = res.reduce((n, x) => n + (x.meta && x.meta.changes || 0), 0);
  }

  let benchmarkSaved = false;
  if (Array.isArray(body.benchmark) && body.benchmark.length) {
    if (body.benchmark.length > MAX_BENCHMARK_ROWS)
      return json({ ok: false, error: `too many benchmark rows (max ${MAX_BENCHMARK_ROWS})` }, 400);
    const res = await db.prepare(
      `INSERT INTO iqc_benchmark (lab_code, assay, rows, report_date, source_file, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (lab_code, assay) DO UPDATE SET
         rows = excluded.rows, report_date = excluded.report_date,
         source_file = excluded.source_file, updated_at = excluded.updated_at
       WHERE excluded.report_date >= iqc_benchmark.report_date`
    ).bind(lab, assay, JSON.stringify(body.benchmark), reportDate, sourceFile, now).run();
    benchmarkSaved = (res.meta && res.meta.changes || 0) > 0;
  }

  return json({
    ok: true,
    runs: { received: runsIn.length, valid: runs.length, inserted },
    peer: { received: peerIn.length, saved: peerSaved },
    benchmark: benchmarkSaved,
  });
}
