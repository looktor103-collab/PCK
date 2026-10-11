// แจ้งเตือนน้ำยาผ่าน LINE (push ถึงตัวเองคนเดียว) — รันจาก cron ทุกเช้า
// เตือนเมื่อ (1) สั่งด่วน/ต่ำกว่าจุดสั่งซื้อ หรือ (2) มี Lot ที่ใกล้หมดอายุแต่ยังไม่ได้เบิกออก
// ตรรกะคำนวณสต็อก/จุดสั่งซื้อ ย้ายมาจาก buildStock() ใน Inventory/inventory.html — ถ้าแก้สูตรหน้าเว็บ ต้องแก้ที่นี่ให้ตรงกัน
// ตั้งค่า secret: wrangler secret put LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID  (ใช้ชุดเดียวกับแดชบอร์ดได้)

const COVERAGE_WINDOW = 90;
const DEFAULT_LEAD_DAYS = 30;
const NEAR_EXP_DAYS = 60;
const RESEND_AFTER_DAYS = 3;     // รายการเดิมที่ยังค้างอยู่ จะเตือนซ้ำทุกกี่วัน
const MAX_LINES = 25;
const RECENT_DAYS = 30;          // เตือนเฉพาะรายการที่มีการรับเข้า/เบิกออก/ปรับยอดภายในกี่วันล่าสุด (สต็อกที่ยังไม่ได้อัปเดตจะไม่ถูกเตือน)
const APP_URL = 'https://splab-pck.looktor103.workers.dev/Inventory/inventory';

const num = v => { const n = parseFloat(v); return Number.isNaN(n) ? 0 : n; };
const normName = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const fmt = n => (Math.round(n * 10) / 10).toLocaleString('en-US');

// วันนี้ตามเวลาไทย (UTC+7) เป็น YYYY-MM-DD
function todayTH() { return new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dayDiff(iso, from) { return Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000); }

// รองรับ YYYY-MM-DD และ dd/mm/yyyy (พ.ศ. หรือ ค.ศ.)
function toISO(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) { const y = +m[3] > 2400 ? +m[3] - 543 : +m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return '';
}

function txnDelta(t) {
  const q = num(t.qty);
  if (t.type === 'OUT') return -Math.abs(q);
  if (t.type === 'IN') return Math.abs(q);
  return q;
}

async function loadTabs(db) {
  const { results } = await db.prepare(
    `SELECT tab, data FROM inv_rows WHERE tab IN ('ITEMS','TXN','PO_HEADERS','PO_ITEMS','PO_RECEIPTS')`).all();
  const t = { ITEMS: [], TXN: [], PO_HEADERS: [], PO_ITEMS: [], PO_RECEIPTS: [] };
  results.forEach(r => { try { t[r.tab].push(JSON.parse(r.data)); } catch { /* ข้ามแถวเสีย */ } });
  return t;
}

function openOrders(tabs) {
  const received = {};
  tabs.PO_RECEIPTS.forEach(r => { received[r.item_id] = (received[r.item_id] || 0) + num(r.received_qty); });
  const live = new Set(tabs.PO_HEADERS.filter(p => p.status !== 'ยกเลิก' && p.status !== 'ร่าง').map(p => p.id));
  const map = {};
  tabs.PO_ITEMS.forEach(l => {
    if (!live.has(l.po_id)) return;
    const rem = Math.max(0, num(l.quantity) - (received[l.id] || 0));
    if (rem > 0) { const k = normName(l.product_name); map[k] = (map[k] || 0) + rem; }
  });
  return map;
}

/** คืนรายการที่ต้องเตือน [{key, kind:'order'|'expiry', name, text}] */
export function computeAlerts(tabs, today = todayTH()) {
  const from = addDays(today, -COVERAGE_WINDOW);
  const key = v => normName(v).toLowerCase();
  const master = {};
  tabs.ITEMS.forEach(i => { master[key(i.name)] = i; });

  const stock = {};
  tabs.TXN.forEach(t => {
    const name = normName(t.item); if (!name) return;
    const lot = String(t.lot ?? '').trim() || '(ไม่ระบุ Lot)';
    const s = stock[name] || (stock[name] = { name, unit: t.unit || '', lots: {}, last: '' });
    const td = toISO(t.date) || String(t.ts || '').slice(0, 10);
    if (td && td > s.last) s.last = td;
    if (t.unit && !s.unit) s.unit = t.unit;
    const L = s.lots[lot] || (s.lots[lot] = { lot, exp: '', qty: 0 });
    L.qty += txnDelta(t);
    if (t.exp && !L.exp) L.exp = toISO(t.exp);
  });
  tabs.ITEMS.forEach(i => { const n = normName(i.name); if (n && !stock[n]) stock[n] = { name: n, unit: i.unit || '', lots: {} }; });

  const used = {};
  tabs.TXN.forEach(t => {
    if (t.type !== 'OUT') return;
    const name = normName(t.item); if (!name) return;
    const d = toISO(t.date);
    if (!d || d >= from) used[name] = (used[name] || 0) + Math.abs(num(t.qty));
  });
  const oo = openOrders(tabs);

  const alerts = [];
  Object.values(stock).forEach(s => {
    const m = master[key(s.name)] || {};
    const lots = Object.values(s.lots).filter(l => Math.abs(l.qty) > 0.0001);
    const total = lots.reduce((x, l) => x + l.qty, 0);
    const min = num(m.minQty), lead = num(m.lead_time), safety = num(m.safety_stock), usage = num(m.planned_monthly_usage);
    const rop = (usage > 0 && lead > 0) ? (usage / 30 * lead + safety) : (safety > 0 ? safety : 0);
    const reorderAt = Math.max(min, rop);
    const onOrder = oo[s.name] || 0;
    const unit = s.unit || m.unit || '';

    const avgDaily = (used[s.name] || 0) / COVERAGE_WINDOW || (usage > 0 ? usage / 30 : 0);
    const leadDays = lead > 0 ? lead : DEFAULT_LEAD_DAYS;
    const triggerDays = leadDays + ((avgDaily > 0 && safety > 0) ? safety / avgDaily : 0);
    const coverDays = avgDaily > 0 ? total / avgDaily : null;
    const coverIncoming = avgDaily > 0 ? (total + onOrder) / avgDaily : null;

    const critical = avgDaily > 0 && (total <= 0 || coverDays <= leadDays);
    const belowReorder = reorderAt > 0 && total <= reorderAt;
    const alreadyCovered = coverIncoming !== null && coverIncoming > triggerDays;
    // ข้ามรายการที่ยังไม่เคยมีประวัติรับเข้า/เบิกเลย (ยังไม่ได้อัปเดตสต็อก) ไม่งั้นเตือนว่า "เหลือ 0" ทั้งที่เป็นแค่ยังไม่ได้กรอก
    // เตือนเฉพาะรายการที่ถูกอัปเดตล่าสุด (ภายใน RECENT_DAYS วัน)
    const recent = !!s.last && dayDiff(today, s.last) <= RECENT_DAYS;
    if (!recent) return;
    if ((critical || belowReorder) && !alreadyCovered) {
      const needQty = avgDaily > 0 ? Math.max(0, avgDaily * (leadDays + 60) - total - onOrder) : 0;
      const parts = [`เหลือ ${fmt(Math.max(total, 0))} ${unit}`.trim()];
      if (reorderAt > 0) parts.push(`จุดสั่งซื้อ ${fmt(reorderAt)}`);
      if (coverDays !== null && total > 0) parts.push(`ใช้ได้อีก ~${Math.floor(coverDays)} วัน`);
      if (needQty > 0) parts.push(`ควรสั่ง ${Math.ceil(needQty)}`);
      alerts.push({ key: `order:${s.name}`, kind: 'order', name: s.name, urgent: critical, text: `${critical ? '🔴' : '🟠'} ${s.name} — ${parts.join(' · ')}` });
    }

    lots.filter(l => l.qty > 0.0001 && l.exp).forEach(l => {
      const dd = dayDiff(l.exp, today);
      if (dd < NEAR_EXP_DAYS) {
        const when = dd < 0 ? `หมดอายุแล้ว ${-dd} วัน` : `อีก ${dd} วัน`;
        alerts.push({ key: `exp:${s.name}|${l.lot}`, kind: 'expiry', name: s.name, urgent: dd < 30, text: `⏳ ${s.name} Lot ${l.lot} — เหลือ ${fmt(l.qty)} ${unit} หมดอายุ ${l.exp} (${when})`.replace('  ', ' ') });
      }
    });
  });
  return alerts;
}

function buildMessage(alerts, today) {
  const orders = alerts.filter(a => a.kind === 'order');
  const exps = alerts.filter(a => a.kind === 'expiry');
  const lines = [`📦 แจ้งเตือนคลังน้ำยา ${today}`];
  const section = (title, list) => {
    if (!list.length) return;
    lines.push('', title);
    list.slice(0, MAX_LINES).forEach(a => lines.push(a.text));
    if (list.length > MAX_LINES) lines.push(`…และอีก ${list.length - MAX_LINES} รายการ`);
  };
  section(`🛒 ต้องสั่งซื้อ (${orders.length})`, orders);
  section(`⏳ Lot ใกล้หมดอายุ ยังไม่ได้เบิกออก (${exps.length})`, exps);
  lines.push('', APP_URL);
  return lines.join('\n').slice(0, 4900);
}

async function linePush(env, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ to: env.LINE_USER_ID, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) throw new Error(`LINE ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** options: { force } ข้ามการกันเตือนซ้ำ · { dry } ไม่ส่งจริง คืนข้อความให้ดู */
export async function runInvAlerts(env, { force = false, dry = false } = {}) {
  const today = todayTH();
  const alerts = computeAlerts(await loadTabs(env.DB), today);

  const row = await env.DB.prepare(`SELECT value FROM inv_meta WHERE key = 'line_alert_state'`).first();
  let state = {};
  try { state = row ? JSON.parse(row.value) : {}; } catch { state = {}; }

  // เตือนเฉพาะรายการที่ยังไม่เคยแจ้ง หรือแจ้งไปนานเกิน RESEND_AFTER_DAYS วัน
  const due = force ? alerts : alerts.filter(a => !state[a.key] || dayDiff(today, state[a.key]) >= RESEND_AFTER_DAYS);
  const message = due.length ? buildMessage(due, today) : '';
  if (dry || !due.length) return { ok: true, total: alerts.length, sent: 0, message };

  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_USER_ID) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID');
  await linePush(env, message);

  const next = {};
  alerts.forEach(a => { next[a.key] = (due.includes(a) ? today : state[a.key]) || today; }); // รายการที่หายไปแล้วถูกล้างทิ้งเอง
  await env.DB.prepare(
    `INSERT INTO inv_meta (key, value) VALUES ('line_alert_state', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).bind(JSON.stringify(next)).run();
  return { ok: true, total: alerts.length, sent: due.length, message };
}
