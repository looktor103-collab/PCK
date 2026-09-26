/* ============================================================================
   IQC API — Cloudflare Worker + D1 for IQC/IQC_HIV_VL_Generator.html
   ----------------------------------------------------------------------------
   Separate from splab-pck on purpose (same reason as worker-api): splab-pck sits
   behind Cloudflare Access, so browser fetches without a login session would be
   redirected to the Access login page.

     GET  /api/iqc?lab=016&assay=HIV-1   → { ok, runs, peer, benchmark }
     POST /api/iqc  { lab, assay, sourceFile, reportDate, runs, peer, benchmark }

   EQA Summary (EQA_Summary.html) — one row per programme/provider/year/round:
     GET    /api/eqa                        → { ok, rounds }
     POST   /api/eqa  { id?, program, ... } → create or update a round → { ok, id }
     DELETE /api/eqa?id=12                  → delete a round and its PDF
     PUT    /api/eqa/pdf?id=12&name=x.pdf   (body = PDF bytes) → store the original report in KV
     GET    /api/eqa/pdf?id=12&key=…        → the stored PDF (key in the URL so a plain link can open it)

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
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-API-Key',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

function authorized(request, env, url) {
  const key = request.headers.get('X-API-Key') || url.searchParams.get('key');
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
    const route = url.pathname;
    if (!['/api/iqc', '/api/eqa', '/api/eqa/pdf'].includes(route)) return json({ ok: false, error: 'not found' }, 404);
    if (!authorized(request, env, url)) return json({ ok: false, error: 'unauthorized' }, 401);

    try {
      const m = request.method;
      if (route === '/api/iqc' && m === 'GET') return await handleGet(url, env.DB);
      if (route === '/api/iqc' && m === 'POST') return await handlePost(request, env.DB);
      if (route === '/api/eqa' && m === 'GET') return await eqaList(env.DB);
      if (route === '/api/eqa' && m === 'POST') return await eqaSave(request, env.DB);
      if (route === '/api/eqa' && m === 'DELETE') return await eqaDelete(url, env);
      if (route === '/api/eqa/pdf' && m === 'PUT') return await eqaPdfPut(request, url, env);
      if (route === '/api/eqa/pdf' && m === 'GET') return await eqaPdfGet(url, env);
      return json({ ok: false, error: 'method not allowed' }, 405);
    } catch (err) {
      return json({ ok: false, error: String(err && err.message || err) }, 500);
    }
  },
};

/* ── EQA ─────────────────────────────────────────────────────────────────── */
const EQA_PROGRAMS = ['CD4', 'HIVVL', 'HPV', 'COVID'];
const EQA_RESULTS = ['PASS', 'FAIL', 'PENDING'];
const MAX_PDF_BYTES = 20 * 1024 * 1024; // KV values can be up to 25 MiB
const EQA_COLS = `id, program, provider, year_be AS yearBE, round, report_date AS reportDate, lab_id AS labId,
  score, max_score AS maxScore, grade, result, details, note, pdf_name AS pdfName, pdf_size AS pdfSize, updated_at AS updatedAt`;

async function eqaList(db) {
  const { results } = await db.prepare(`SELECT ${EQA_COLS} FROM eqa_rounds ORDER BY year_be DESC, program, round`).all();
  return json({ ok: true, rounds: results });
}

async function eqaSave(request, db) {
  const text = await request.text();
  if (text.length > 200_000) return json({ ok: false, error: 'payload too large' }, 413);
  let b;
  try { b = JSON.parse(text); } catch { return json({ ok: false, error: 'invalid JSON' }, 400); }

  const program = str(b.program).toUpperCase();
  const provider = str(b.provider, 40);
  const yearBE = Number.isInteger(b.yearBE) ? b.yearBE : null;
  const round = str(b.round, 20);
  const result = str(b.result).toUpperCase();
  if (!EQA_PROGRAMS.includes(program)) return json({ ok: false, error: 'program must be one of ' + EQA_PROGRAMS.join(', ') }, 400);
  if (!provider || !round) return json({ ok: false, error: 'provider and round are required' }, 400);
  if (!yearBE || yearBE < 2540 || yearBE > 2650) return json({ ok: false, error: 'yearBE must be a Buddhist year, e.g. 2569' }, 400);
  if (!EQA_RESULTS.includes(result)) return json({ ok: false, error: 'result must be PASS, FAIL or PENDING' }, 400);
  const reportDate = ISO_DATE.test(b.reportDate) ? b.reportDate : null;
  const details = b.details == null ? null : JSON.stringify(b.details).slice(0, 100_000);
  const now = new Date().toISOString();
  const vals = [program, provider, yearBE, round, reportDate, str(b.labId, 40) || null, num(b.score), num(b.maxScore),
    str(b.grade, 40) || null, result, details, str(b.note, 1000) || null];

  const dup = await db.prepare('SELECT id FROM eqa_rounds WHERE program=? AND provider=? AND year_be=? AND round=?')
    .bind(program, provider, yearBE, round).first();
  const id = Number.isInteger(b.id) ? b.id : null;
  if (dup && dup.id !== id)
    return json({ ok: false, error: `มีรอบนี้อยู่แล้ว (${program} ${provider} ${yearBE} ${round})`, existingId: dup.id }, 409);

  if (id) {
    const res = await db.prepare(
      `UPDATE eqa_rounds SET program=?, provider=?, year_be=?, round=?, report_date=?, lab_id=?, score=?, max_score=?,
         grade=?, result=?, details=?, note=?, updated_at=? WHERE id=?`
    ).bind(...vals, now, id).run();
    if (!res.meta.changes) return json({ ok: false, error: 'round not found' }, 404);
    return json({ ok: true, id });
  }
  const res = await db.prepare(
    `INSERT INTO eqa_rounds (program, provider, year_be, round, report_date, lab_id, score, max_score, grade, result,
       details, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(...vals, now, now).run();
  return json({ ok: true, id: res.meta.last_row_id });
}

async function eqaDelete(url, env) {
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: 'id is required' }, 400);
  const res = await env.DB.prepare('DELETE FROM eqa_rounds WHERE id=?').bind(id).run();
  await env.EQA_PDF.delete('pdf:' + id);
  return json({ ok: true, deleted: res.meta.changes });
}

async function eqaPdfPut(request, url, env) {
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: 'id is required' }, 400);
  const row = await env.DB.prepare('SELECT id FROM eqa_rounds WHERE id=?').bind(id).first();
  if (!row) return json({ ok: false, error: 'round not found' }, 404);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json({ ok: false, error: 'empty file' }, 400);
  if (buf.byteLength > MAX_PDF_BYTES) return json({ ok: false, error: 'ไฟล์ใหญ่เกิน 20 MB' }, 413);
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(5, buf.byteLength)));
  if (head !== '%PDF-') return json({ ok: false, error: 'ไฟล์นี้ไม่ใช่ PDF' }, 400);
  const name = str(url.searchParams.get('name'), 200) || `eqa-${id}.pdf`;
  await env.EQA_PDF.put('pdf:' + id, buf, { metadata: { name } });
  await env.DB.prepare('UPDATE eqa_rounds SET pdf_name=?, pdf_size=?, updated_at=? WHERE id=?')
    .bind(name, buf.byteLength, new Date().toISOString(), id).run();
  return json({ ok: true, id, size: buf.byteLength });
}

async function eqaPdfGet(url, env) {
  const id = Number(url.searchParams.get('id'));
  const { value, metadata } = await env.EQA_PDF.getWithMetadata('pdf:' + id, { type: 'arrayBuffer' });
  if (!value) return json({ ok: false, error: 'ไม่พบไฟล์ PDF ของรอบนี้' }, 404);
  const name = (metadata && metadata.name) || `eqa-${id}.pdf`;
  return new Response(value, {
    headers: {
      ...CORS,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="eqa-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}

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
