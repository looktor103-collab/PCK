/* Service worker — มีไว้เพื่อให้เบราว์เซอร์ยอม "ติดตั้ง" หน้านี้เป็นแอป (PWA)
   บนหน้าจอมือถือได้ (เปิดแบบเต็มจอ ไม่มีแถบที่อยู่ของ Chrome)
   ไม่ได้ทำ offline เต็มรูปแบบ — แค่แคชหน้าเปลือกไว้เผื่อเน็ตหลุดชั่วคราว
   ข้อมูลสต็อกจริง (D1 / Google Sheets) ยังต้องต่อเน็ตเพื่อดึงข้อมูลล่าสุดเสมอ
   ห้ามแคบคำขอไปยัง API ภายนอก (script.google.com, workers.dev) เด็ดขาด
   ไม่งั้นจะเห็นสต็อกเก่าค้างได้ */
const CACHE_NAME = 'inv2026-shell-v1';
const SHELL_URLS = ['./inventory.html', './manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // เฉพาะหน้าเปลือกของแอปเอง (same-origin, GET) เท่านั้นที่ทำ network-first + fallback แคช
  // คำขออื่นทั้งหมด (API, ฟอนต์, CDN) ปล่อยผ่านตามปกติ ไม่ยุ่ง
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (!SHELL_URLS.some((u) => req.url.endsWith(u.replace('./', '')))) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
