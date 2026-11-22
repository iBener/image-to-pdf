/* Resimden PDF — Instagram sayfasının kendi bağlamında (MAIN world) çalışır.
   Sayfanın zaten yüklediği gönderi verisini (sayfa içi JSON ve Instagram'ın kendi istek yanıtları) yalnızca OKUR,
   gönderi koduna göre resim listesini çıkarır ve içerik betiğine (ig-content.js) iletir. Hiçbir istek değiştirilmez. */
(() => {
  if (window.__rpMainInstalled) return;
  window.__rpMainInstalled = true;

  const MARK = /"(image_versions2|display_resources|display_url|carousel_media|edge_sidecar_to_children)"/;
  const cache = new Map(); // code -> media

  function best(c) {
    if (!Array.isArray(c) || !c.length) return null;
    let b = null, bw = -1;
    for (const x of c) {
      if (!x) continue;
      const w = x.width || x.config_width || 0;
      if (w > bw) { b = x; bw = w; }
    }
    if (!b) return null;
    const url = b.url || b.src;
    return url ? { url, w: b.width || b.config_width || 0, h: b.height || b.config_height || 0 } : null;
  }
  function itemV1(m) {
    if (!m) return null;
    const b = best(m.image_versions2 && m.image_versions2.candidates);
    return b && { ...b, isVideo: m.media_type === 2 || !!(m.video_versions && m.video_versions.length) };
  }
  function itemGraph(n) {
    if (!n) return null;
    let b = best(n.display_resources);
    if (!b && n.display_url) b = { url: n.display_url, w: (n.dimensions || {}).width || 0, h: (n.dimensions || {}).height || 0 };
    return b && { ...b, isVideo: !!n.is_video };
  }
  function normalize(o) {
    const code = typeof o.code === 'string' ? o.code : typeof o.shortcode === 'string' ? o.shortcode : null;
    if (!code) return null;
    let items = null;
    if (Array.isArray(o.carousel_media) && o.carousel_media.length) items = o.carousel_media.map(itemV1);
    else if (o.edge_sidecar_to_children && Array.isArray(o.edge_sidecar_to_children.edges)) items = o.edge_sidecar_to_children.edges.map(e => e && itemGraph(e.node));
    else if (o.image_versions2) items = [itemV1(o)];
    else if (o.display_url || o.display_resources) items = [itemGraph(o)];
    if (!items) return null;
    items = items.filter(i => i && i.url);
    if (!items.length) return null;
    const username = (o.user && o.user.username) || (o.owner && o.owner.username) || '';
    return { code, username, items };
  }
  function scan(root) {
    const found = [];
    const stack = [root];
    let n = 0;
    while (stack.length && n < 300000) {
      const o = stack.pop();
      n++;
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o)) { for (let i = o.length - 1; i >= 0; i--) if (o[i] && typeof o[i] === 'object') stack.push(o[i]); continue; }
      const m = normalize(o);
      if (m) found.push(m);
      for (const k in o) { const v = o[k]; if (v && typeof v === 'object') stack.push(v); }
    }
    return found;
  }
  function better(a, b) { // a, b'den daha iyi mi?
    if (!b) return true;
    if (a.items.length !== b.items.length) return a.items.length > b.items.length;
    const wa = a.items.reduce((s, i) => s + (i.w || 0), 0), wb = b.items.reduce((s, i) => s + (i.w || 0), 0);
    return wa > wb;
  }
  function publish(list) {
    const fresh = [];
    for (const m of list) {
      const prev = cache.get(m.code);
      if (better(m, prev)) {
        if (!m.username && prev) m.username = prev.username;
        cache.set(m.code, m);
        fresh.push(m);
      }
    }
    if (fresh.length) window.postMessage({ __rpMedia: fresh }, location.origin);
  }
  function parseAll(text) {
    const out = [];
    const t = text.replace(/^\s*for \(;;\);/, '');
    try { out.push(JSON.parse(t)); return out; } catch (_) {}
    // Akış halinde gelen (satır satır) JSON yanıtlar
    for (const line of t.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || (s[0] !== '{' && s[0] !== '[')) continue;
      try { out.push(JSON.parse(s)); } catch (_) {}
    }
    return out;
  }
  function handleText(text) {
    if (!text || !MARK.test(text)) return;
    for (const obj of parseAll(text)) publish(scan(obj));
  }
  function scanScripts() {
    document.querySelectorAll('script[type="application/json"]').forEach(s => {
      if (s.__rpSeen) return;
      s.__rpSeen = true;
      try { handleText(s.textContent); } catch (_) {}
    });
  }

  const interesting = u => /\/graphql|\/api\/v1\//.test(u || '');

  // fetch yanıtlarını oku (kopyası üzerinden; sayfanın kendi akışı etkilenmez)
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (interesting(url)) p.then(r => { r.clone().text().then(handleText).catch(() => {}); }).catch(() => {});
      } catch (_) {}
      return p;
    };
  }

  // XHR yanıtlarını oku
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__rpUrl = String(url); } catch (_) {}
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (interesting(this.__rpUrl)) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') handleText(this.responseText);
          else if (this.responseType === 'json' && this.response) publish(scan(this.response));
        } catch (_) {}
      });
    }
    return XS.apply(this, arguments);
  };

  // İçerik betiği geç yüklendiğinde önbellekteki her şeyi yeniden gönder
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || !e.data.__rpQuery) return;
    scanScripts();
    if (cache.size) window.postMessage({ __rpMedia: [...cache.values()] }, location.origin);
  });

  document.addEventListener('DOMContentLoaded', scanScripts);
  window.addEventListener('load', scanScripts);
})();
