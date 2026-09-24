/* ============================================================================
   Inventory API — standalone Cloudflare Worker + D1
   ----------------------------------------------------------------------------
   แยกเป็น Worker คนละตัวจาก splab-pck (ที่โฮสต์หน้าเว็บ Dashboard) โดยตั้งใจ —
   splab-pck มี Cloudflare Access ป้องกันทั้งโดเมนอยู่ ถ้าเอา API มาไว้ที่เดียวกัน
   จะโดน Access เด้งไป login ก่อนถึงจะยิง API ได้ ทำให้ inventory.html (ที่ fetch
   จากเบราว์เซอร์โดยไม่มี session login) เรียกใช้ไม่ได้เลย — Worker แยกตัวนี้ไม่มี
   Access ผูกไว้ จึงเรียกได้ตรงๆ

   Endpoints (ตรงกับรูปแบบเดิมของ Apps Script ทุกประการ — inventory.html ไม่ต้อง
   แก้โค้ดฝั่ง client เพิ่ม แค่เปลี่ยน URL ที่ตั้งค่าไว้):
     GET  /?api=1        → { ok:true, data:{ ITEMS:[...], ... } }
     GET  /?tab=ITEMS    → { ok:true, tab:'ITEMS', rows:[...] }
     POST /  { action:'save',    tab, rows }
     POST /  { action:'saveAll', data }

   ทุกครั้งที่บันทึก จะยิงสำรองขึ้น Google Sheets (Apps Script เดิม) ต่อแบบ
   best-effort ผ่าน env.SHEETS_BACKUP_URL — ถ้ายิงไม่สำเร็จไม่กระทบการบันทึกหลัก
   ============================================================================ */

const ALL_TABS = [
  'overview','JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC',
  'ITEMS','TXN','BILLS','SUPPLIERS','PO_HEADERS','PO_ITEMS','PO_RECEIPTS',
];

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function readTab(db, tab) {
  const row = await db.prepare('SELECT data FROM tabs WHERE tab = ?').bind(tab).first();
  if (!row) return [];
  try { return JSON.parse(row.data) || []; } catch (e) { return []; }
}

async function writeTab(db, tab, rows) {
  const data = JSON.stringify(rows || []);
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO tabs (tab, data, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(tab) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
  ).bind(tab, data, now).run();
}

async function getAllData(db) {
  const all = {};
  for (const t of ALL_TABS) all[t] = await readTab(db, t);
  return all;
}

function backupToSheets(env, body) {
  if (!env.SHEETS_BACKUP_URL) return Promise.resolve();
  return fetch(env.SHEETS_BACKUP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return json({ ok: true });

    const db = env.DB;

    if (request.method === 'GET') {
      try {
        const p = url.searchParams;
        if (p.get('tab')) {
          const tab = p.get('tab');
          return json({ ok: true, tab, rows: await readTab(db, tab) });
        }
        return json({ ok: true, data: await getAllData(db) });
      } catch (err) {
        return json({ ok: false, error: String(err) }, 500);
      }
    }

    if (request.method === 'POST') {
      try {
        const body = await request.json();
        if (body.action === 'save') {
          await writeTab(db, body.tab, body.rows);
          ctx.waitUntil(backupToSheets(env, body));
          return json({ ok: true });
        }
        if (body.action === 'saveAll') {
          for (const t of Object.keys(body.data || {})) {
            await writeTab(db, t, body.data[t]);
          }
          ctx.waitUntil(backupToSheets(env, body));
          return json({ ok: true });
        }
        return json({ ok: false, error: 'unknown action' }, 400);
      } catch (err) {
        return json({ ok: false, error: String(err) }, 500);
      }
    }

    return json({ ok: false, error: 'method not allowed' }, 405);
  },
};
