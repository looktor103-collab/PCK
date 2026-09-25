/* ═══════════════════════════════════════════════════════════════════════════
   pck.js — App shell, theme, เมนู, ตัวช่วยรูปแบบ, และ client คุยกับ Google Sheet
   Molecular Lab · Phrachomklao Hospital
   ═══════════════════════════════════════════════════════════════════════════ */
window.PCK = (function () {
  'use strict';

  var BASE = '/PCK';

  /* ── 1 · เมนู — นิยามที่เดียว ใช้ร่วมกันทุกหน้า ────────────────────────── */
  var NAV = [
    { group: 'หน้าแรก', items: [
      { id:'home', icon:'🏠', label:'Dashboard', href: BASE + '/index.html' }
    ]},
    { group: 'IQC', items: [
      { id:'iqc-hpv',  icon:'🧬', label:'IQC — HPV DNA',  href: BASE + '/IQC/IQC_cobas_HPV.html' },
      { id:'iqc-hiv',  icon:'🧫', label:'IQC — HIV VL',   href: BASE + '/IQC/IQC_HIV_VL_Generator.html' },
      { id:'iqc-dash', icon:'📈', label:'HPV IQC Dashboard', href: BASE + '/IQC/HPV_IQC_Dashboard.html', live:true }
    ]},
    { group: 'คลังน้ำยา', items: [
      { id:'inventory', icon:'📦', label:'Inventory 2026', href: BASE + '/Inventory/inventory.html' },
      { id:'msds',      icon:'🧾', label:'Reagent / MSDS',  href: BASE + '/reagent_msds.html' }
    ]},
    { group: 'ประกันคุณภาพ', items: [
      { id:'calib', icon:'📐', label:'Calibration', href: BASE + '/calibrate/Calibration_Dashboard.html' },
      { id:'eqa',   icon:'📊', label:'EQA / PT',    href: BASE + '/EQA_Summary.html' },
      { id:'mt6800',icon:'🔧', label:'Maintenance — cobas 6800', href: BASE + '/FCP68030.html' },
      { id:'mtbsc', icon:'🛠️', label:'Maintenance — BSC',        href: BASE + '/FCP65602.html' }
    ]},
    { group: 'เอกสาร', items: [
      { id:'sop', icon:'📄', label:'SOP & Documents', href: BASE + '/sop.html' }
    ]}
  ];

  /* ── 2 · ธีม — auto / light / dark ────────────────────────────────────── */
  var theme = {
    KEY: 'pck-theme',
    get: function () { try { return localStorage.getItem(theme.KEY) || 'auto'; } catch (e) { return 'auto'; } },
    set: function (v) {
      try { localStorage.setItem(theme.KEY, v); } catch (e) {}
      theme.apply(v);
    },
    apply: function (v) {
      var r = document.documentElement;
      if (v === 'auto') r.removeAttribute('data-theme');
      else r.setAttribute('data-theme', v);
      var b = document.getElementById('pck-theme-btn');
      if (b) { b.textContent = v === 'dark' ? '🌙' : v === 'light' ? '☀️' : '🌗';
               b.title = 'ธีม: ' + (v === 'auto' ? 'ตามระบบ' : v === 'dark' ? 'มืด' : 'สว่าง'); }
    },
    cycle: function () {
      var order = ['auto', 'light', 'dark'];
      theme.set(order[(order.indexOf(theme.get()) + 1) % 3]);
    },
    init: function () { theme.apply(theme.get()); }
  };

  /* ── 3 · รูปแบบวันที่/เวลา แบบไทย ─────────────────────────────────────── */
  var fmt = {
    dateTH: function (d) {
      d = d || new Date();
      try {
        return new Intl.DateTimeFormat('th-TH', {
          weekday:'short', day:'numeric', month:'short', year:'numeric', calendar:'buddhist'
        }).format(d);
      } catch (e) { return d.toLocaleDateString('th-TH'); }
    },
    timeTH: function (d) {
      d = d || new Date();
      return d.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    },
    be: function (d) { return (d || new Date()).getFullYear() + 543; },
    short: function (iso) {
      if (!iso) return '—';
      var M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
      var p = String(iso).split('-');
      if (p.length !== 3) return iso;
      return Number(p[2]) + ' ' + M[Number(p[1]) - 1] + ' ' + String(Number(p[0]) + 543).slice(-2);
    },
    ago: function (iso) {
      var s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (isNaN(s)) return '—';
      if (s < 60) return 'เมื่อสักครู่';
      if (s < 3600) return 'เมื่อ ' + Math.floor(s / 60) + ' นาทีที่แล้ว';
      if (s < 86400) return 'เมื่อ ' + Math.floor(s / 3600) + ' ชม.ที่แล้ว';
      return 'เมื่อ ' + Math.floor(s / 86400) + ' วันที่แล้ว';
    },
    num: function (v, d) { return (v === null || v === undefined || isNaN(v)) ? '—' : Number(v).toFixed(d === undefined ? 2 : d); }
  };

  /* ── 4 · App shell — วาด rail + topbar ────────────────────────────────── */
  var shell = {
    KEY: 'pck-rail-collapsed',
    render: function (opts) {
      opts = opts || {};
      var page = document.body.getAttribute('data-page') || '';
      var host = document.getElementById('pck-shell');
      if (!host) return;

      var collapsed = '0';
      try { collapsed = localStorage.getItem(shell.KEY) || '0'; } catch (e) {}
      host.className = 'pck-shell';
      host.setAttribute('data-collapsed', collapsed);

      var nav = '';
      NAV.forEach(function (g) {
        nav += '<div class="pck-navgroup">' + g.group + '</div>';
        g.items.forEach(function (it) {
          nav += '<a class="pck-navitem" href="' + it.href + '"' +
                 (it.id === page ? ' aria-current="page"' : '') + '>' +
                 '<span class="pck-navicon" aria-hidden="true">' + it.icon + '</span>' +
                 '<span class="pck-navlabel">' + it.label + '</span>' +
                 (it.live ? '<span class="pck-live" id="pck-live-dot" data-state="off" title="สถานะการเชื่อมต่อข้อมูลสด"></span>' : '') +
                 '</a>';
        });
      });

      var rail = document.createElement('nav');
      rail.className = 'pck-rail';
      rail.setAttribute('aria-label', 'เมนูหลัก');
      rail.innerHTML =
        '<a class="pck-brand" href="' + BASE + '/index.html">' +
          '<img src="' + BASE + '/assets/logo.png" alt="" width="34" height="34" style="flex-shrink:0;display:block">' +
          '<span class="pck-brand-txt" style="min-width:0"><img src="' + BASE + '/assets/logo-text.png" alt="Molecular Lab PCK" style="width:100%;max-width:152px;height:auto;display:block"></span>' +
          '</a>' + nav;

      var main = document.createElement('div');
      main.className = 'pck-main';
      main.innerHTML =
        '<header class="pck-topbar">' +
          '<button class="pck-btn icon" id="pck-rail-btn" title="ย่อ/ขยายเมนู" aria-label="ย่อหรือขยายเมนู">☰</button>' +
          (page !== 'home' ? '<a class="pck-btn pck-back" href="' + BASE + '/index.html" style="text-decoration:none;white-space:nowrap;flex-shrink:0">← กลับ Dashboard</a>' : '') +
          '<div class="pck-crumb"><span>' + (opts.section || 'Dashboard') + '</span>' +
            (opts.title ? '<span aria-hidden="true">›</span><b>' + opts.title + '</b>' : '') + '</div>' +
          '<div class="pck-topbar-right">' +
            '<span class="pck-clock" id="pck-clock">—</span>' +
            '<button class="pck-btn icon" id="pck-theme-btn" title="สลับธีม" aria-label="สลับธีม">🌗</button>' +
          '</div>' +
        '</header>';

      var content = document.createElement('div');
      content.className = 'pck-content';
      while (host.firstChild) content.appendChild(host.firstChild);
      main.appendChild(content);

      host.appendChild(rail);
      host.appendChild(main);

      document.getElementById('pck-rail-btn').addEventListener('click', function () {
        var n = host.getAttribute('data-collapsed') === '1' ? '0' : '1';
        host.setAttribute('data-collapsed', n);
        try { localStorage.setItem(shell.KEY, n); } catch (e) {}
      });
      document.getElementById('pck-theme-btn').addEventListener('click', theme.cycle);
      theme.apply(theme.get());

      function tick() {
        var el = document.getElementById('pck-clock');
        if (el) el.textContent = fmt.timeTH();
      }
      tick(); setInterval(tick, 1000);
    }
  };

  /* ── 5 · Client คุยกับ Google Apps Script ─────────────────────────────── */
  var sheets = {
    URL: 'https://script.google.com/macros/s/AKfycbzcWl6q_L_TjJ34r8enZufcCAllMf8inHZvl4BuCv6U-0FaT2rKN0svvKKBe9sd1PBP/exec',
    CACHE_KEY: 'pck-iqc-cache',

    getIQC: function (params) {
      params = params || {};
      var qs = Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
      var url = sheets.URL + '?action=iqc' + (qs ? '&' + qs : '');

      return fetch(url, { redirect: 'follow' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || 'unknown');
          d.source = 'live';
          try { localStorage.setItem(sheets.CACHE_KEY, JSON.stringify(d)); } catch (e) {}
          return d;
        });
    },

    cached: function () {
      try {
        var s = localStorage.getItem(sheets.CACHE_KEY);
        if (!s) return null;
        var d = JSON.parse(s); d.source = 'cache'; return d;
      } catch (e) { return null; }
    },

    save: function (data) {
      return fetch(sheets.URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(data)
      }).then(function (r) { return r.json(); });
    },

    poll: function (everyMs, onData, onError) {
      var timer = null, busy = false;
      function run() {
        if (busy || document.hidden) return;
        busy = true;
        sheets.getIQC()
          .then(function (d) { ui.live('ok'); onData(d); })
          .catch(function (e) { ui.live('stale'); if (onError) onError(e); })
          .then(function () { busy = false; });
      }
      function start() { stop(); run(); timer = setInterval(run, everyMs || 60000); }
      function stop() { if (timer) { clearInterval(timer); timer = null; } }
      document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
      start();
      return { refresh: run, stop: stop };
    }
  };

  /* ── 6 · UI ช่วยเหลือ ─────────────────────────────────────────────────── */
  var ui = {
    live: function (state) {
      var d = document.getElementById('pck-live-dot');
      if (d) d.setAttribute('data-state', state === 'ok' ? '' : state);
    },
    toast: function (msg, kind) {
      var t = document.createElement('div');
      t.className = 'pck-note ' + (kind || 'info');
      t.setAttribute('role', 'status');
      t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99;box-shadow:var(--shadow-hover);max-width:90vw';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function () { t.remove(); }, 4200);
    }
  };

  theme.init();

  return { BASE: BASE, NAV: NAV, theme: theme, fmt: fmt, shell: shell, sheets: sheets, ui: ui };
})();
