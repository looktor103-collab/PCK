/* Service worker ของแอป "Molecular Lab PCK" (ติดตั้งลงหน้าจอ iPhone / Android)
   ─────────────────────────────────────────────────────────────────────────
   • Network-first: ทุกหน้าโหลดเวอร์ชันล่าสุดจากเน็ตก่อนเสมอ แล้วเก็บสำเนาไว้
     ใช้เฉพาะตอนเน็ตหลุด — จึงไม่มีปัญหาเห็นหน้าเก่าค้างหลังอัพเดตเว็บ
   • ไม่แตะคำขอข้ามโดเมนเลย (Cloudflare API, Google Sheets/Apps Script, CDN, ฟอนต์)
     ข้อมูล IQC/สต็อก จึงเป็นข้อมูลสดเสมอ
   • ไม่เก็บไฟล์ใหญ่ (PDF, Excel ฯลฯ) ในแคช — เก็บแค่หน้าเว็บ สคริปต์ สไตล์ รูป
   • Inventory มี service worker ของตัวเอง (Inventory/sw.js) ที่ scope แคบกว่า
     หน้าในโฟลเดอร์นั้นจึงใช้ของ Inventory ตามเดิม */
const CACHE = 'pck-app-v1';
const CACHEABLE = /\.(html?|css|js|png|jpe?g|svg|ico|webmanifest|json)$/i;
const NEVER = /\.(pdf|xlsx?|csv|zip|rar|docx?|pptx?)$/i;   // เอกสาร/ไฟล์ใหญ่ ปล่อยผ่านเสมอ

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(['./index.html', './manifest.webmanifest']).catch(() => {})));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('pck-app-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || NEVER.test(url.pathname)) return;
  const isPage = req.mode === 'navigate';
  if (!isPage && !CACHEABLE.test(url.pathname)) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (isPage) return offlinePage();
        return Response.error();
      })
  );
});

function offlinePage() {
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ออฟไลน์ — Lab PCK</title>
<style>body{font-family:Sarabun,Tahoma,sans-serif;background:#fdf8f9;color:#2d2028;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
a{display:inline-block;margin-top:16px;padding:10px 20px;border-radius:99px;background:#8b3a52;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><div><h1 style="font-size:1.2rem">ไม่มีการเชื่อมต่ออินเทอร์เน็ต</h1>
<p>หน้านี้ยังไม่เคยเปิดบนเครื่องนี้ จึงไม่มีสำเนาเก็บไว้<br>เชื่อมต่อเน็ตแล้วลองใหม่อีกครั้ง</p>
<a href="./index.html">กลับ Dashboard</a></div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
