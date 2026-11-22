/* Resimden PDF — Instagram sayfasındaki içerik betiği.
   Gönderi sayfalarında sağ altta "PDF'e ekle" düğmesi gösterir; tıklanınca gönderideki resimleri uygulamaya gönderir.
   Uygulamanın "bağlantıdan ekle" ile açtığı sekmelerde bunu kendiliğinden yapar. */
(() => {
  if (window.__rpContentInstalled) return;
  window.__rpContentInstalled = true;

  const media = new Map(); // gönderi kodu -> { code, username, items: [{url, w, h, isVideo}] }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const codeFromPath = () => {
    const m = location.pathname.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  };
  const isLoginPage = () => /^\/accounts\/login|^\/challenge/.test(location.pathname);
  const totalW = m => m.items.reduce((s, i) => s + (i.w || 0), 0);

  function store(m) {
    const prev = media.get(m.code);
    if (!prev || m.items.length > prev.items.length || (m.items.length === prev.items.length && totalW(m) > totalW(prev))) {
      media.set(m.code, { ...m, username: m.username || (prev && prev.username) || '' });
    }
  }
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || !Array.isArray(e.data.__rpMedia)) return;
    e.data.__rpMedia.forEach(store);
    refresh();
  });
  const query = () => window.postMessage({ __rpQuery: true }, location.origin);
  query();

  /* ---------- Yedek yol: sayfada görünen resimlerden topla ---------- */
  async function domCollect(code) {
    const srcOf = img => img.currentSrc || img.src || '';
    const isCdn = img => /cdninstagram\.com|fbcdn\.net/.test(srcOf(img));
    const all = () => [...document.querySelectorAll('main img, article img')].filter(isCdn);
    const largest = () => {
      let b = null, ba = 0;
      for (const img of all()) {
        const r = img.getBoundingClientRect();
        const a = r.width * r.height;
        if (a > ba) { b = img; ba = a; }
      }
      return b;
    };
    const pick = img => {
      let best = { url: srcOf(img), w: img.naturalWidth || 0, h: img.naturalHeight || 0 };
      const ss = img.getAttribute('srcset');
      if (ss) ss.split(',').forEach(part => {
        const [u, d] = part.trim().split(/\s+/);
        const w = parseInt(d, 10) || 0;
        if (u && w > best.w) best = { url: u, w, h: 0 };
      });
      return best;
    };
    let main = largest();
    if (!main || main.getBoundingClientRect().width < 150) return null;
    const NEXT = ['Next', 'İleri', 'Sonraki'];
    const PREV = ['Go back', 'Go Back', 'Geri', 'Geri dön', 'Önceki'];
    const container = () => { const m = largest(); return (m && (m.closest('ul') || m.parentElement)) || document.body; };
    const navBtn = labels => {
      let el = container();
      for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
        const b = [...el.querySelectorAll('button[aria-label]')].find(x => labels.includes(x.getAttribute('aria-label')) && x.offsetParent);
        if (b) return b;
      }
      return null;
    };
    const seen = new Map();
    const grab = () => {
      const m = largest();
      if (!m) return;
      const ref = m.getBoundingClientRect().width;
      const ul = m.closest('ul');
      const imgs = ul ? [...ul.querySelectorAll('img')].filter(isCdn) : [m];
      for (const img of imgs) {
        if (img.getBoundingClientRect().width < ref * 0.6) continue;
        const b = pick(img);
        const key = b.url.split('?')[0];
        if (b.url && !seen.has(key)) seen.set(key, { ...b, isVideo: false });
      }
    };
    for (let i = 0; i < 25; i++) { const b = navBtn(PREV); if (!b) break; b.click(); await sleep(250); }
    grab();
    for (let i = 0; i < 25; i++) { const b = navBtn(NEXT); if (!b) break; b.click(); await sleep(450); grab(); }
    if (!seen.size) return null;
    const user = (document.querySelector('header a[href^="/"][role="link"]') || {}).textContent || '';
    return { code, username: user.trim(), items: [...seen.values()], fromDom: true };
  }

  async function collect(code) {
    let m = media.get(code);
    if (!m) { query(); await sleep(400); m = media.get(code); }
    if (!m || !m.items.some(i => !i.isVideo)) {
      const d = await domCollect(code);
      if (d && (!m || d.items.length > m.items.filter(i => !i.isVideo).length)) m = d;
    }
    return m || null;
  }

  async function send(code, m) {
    const images = m.items.filter(i => !i.isVideo);
    const batch = {
      source: 'instagram',
      code,
      username: m.username || '',
      url: `https://www.instagram.com/p/${code}/`,
      items: images.map(i => ({ url: i.url, w: i.w, h: i.h })),
      skippedVideos: m.items.length - images.length,
    };
    return chrome.runtime.sendMessage({ type: 'rp-add', batch });
  }

  /* ---------- Düğme ---------- */
  let wrap = null, btn = null, note = null, busy = false, lastCode = null;
  function ensureUi() {
    if (wrap) return;
    wrap = document.createElement('div');
    wrap.id = 'rp-ig';
    wrap.innerHTML = `
      <div class="rp-note" hidden></div>
      <button type="button" class="rp-btn" title="Bu gönderideki resimleri Resimden PDF uygulamasına ekle">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V9h5.5L13 3.5ZM7 18h10l-3.2-4.3-2.5 3.2-1.8-2.2L7 18Z"/></svg>
        <span class="rp-label">PDF'e ekle</span>
      </button>`;
    btn = wrap.querySelector('.rp-btn');
    note = wrap.querySelector('.rp-note');
    btn.addEventListener('click', onClick);
    note.addEventListener('click', e => {
      if (e.target.closest('[data-open-app]')) {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: 'rp-open-app' }).catch(() => {});
      }
    });
    document.documentElement.appendChild(wrap);
  }
  function setLabel(t) { if (btn) btn.querySelector('.rp-label').textContent = t; }
  function showNote(html, kind = '', ms = 6000) {
    if (!note) return;
    note.className = 'rp-note ' + kind;
    note.innerHTML = html;
    note.hidden = false;
    clearTimeout(showNote.t);
    if (ms) showNote.t = setTimeout(() => { note.hidden = true; }, ms);
  }
  function refresh() {
    const code = codeFromPath();
    if (!code) { if (wrap) wrap.hidden = true; return; }
    ensureUi();
    wrap.hidden = false;
    if (code !== lastCode) { lastCode = code; if (note) note.hidden = true; }
    if (busy) return;
    const m = media.get(code);
    const n = m ? m.items.filter(i => !i.isVideo).length : 0;
    setLabel(n ? `PDF'e ekle · ${n} resim` : "PDF'e ekle");
  }

  async function onClick() {
    const code = codeFromPath();
    if (!code || busy) return;
    busy = true;
    btn.disabled = true;
    setLabel('Resimler alınıyor…');
    try {
      const m = await collect(code);
      if (!m) { showNote('Bu gönderide resim bulunamadı. Sayfayı yenileyip tekrar deneyin.', 'err'); return; }
      const n = m.items.filter(i => !i.isVideo).length;
      if (!n) { showNote('Bu gönderide resim yok, yalnızca video var.', 'err'); return; }
      await send(code, m);
      const skip = m.items.length - n;
      showNote(`✓ ${n} resim eklendi${skip ? ` (${skip} video atlandı)` : ''}. <a href="#" data-open-app>Uygulamayı aç</a>`, 'ok', 8000);
    } catch (e) {
      const msg = String((e && e.message) || e);
      showNote(/context invalidated/i.test(msg)
        ? 'Eklenti güncellendi; lütfen bu sayfayı yenileyin.'
        : 'Gönderilemedi: ' + msg.replace(/</g, '&lt;'), 'err');
    } finally {
      busy = false;
      btn.disabled = false;
      refresh();
    }
  }

  /* ---------- Uygulamanın "bağlantıdan ekle" ile açtığı sekme ---------- */
  async function isCaptureTab() {
    for (let i = 0; i < 4; i++) {
      try {
        const r = await chrome.runtime.sendMessage({ type: 'rp-is-capture' });
        if (r && r.capture) return true;
      } catch (_) { return false; }
      await sleep(300);
    }
    return false;
  }
  async function autoCapture() {
    ensureUi();
    busy = true;
    setLabel('Resimler alınıyor…');
    const t0 = Date.now();
    let found = null, foundAt = 0;
    while (Date.now() - t0 < 20000) {
      if (isLoginPage()) break;
      const code = codeFromPath();
      if (code) {
        query();
        const m = media.get(code);
        if (m && m.items.length) {
          if (!found) foundAt = Date.now();
          found = m;
          if (Date.now() - foundAt > 1200) break; // daha zengin veri gelme ihtimaline karşı kısa bekleme
        }
      }
      await sleep(400);
    }
    const code = codeFromPath();
    if (code && !isLoginPage()) {
      let m = media.get(code) || found;
      if (!m || !m.items.some(i => !i.isVideo)) m = (await domCollect(code)) || m;
      if (m && m.items.some(i => !i.isVideo)) {
        busy = false;
        await send(code, m).catch(() => {});
        return;
      }
      if (m && m.items.length) return fail('video');
    }
    busy = false;
    refresh();
    fail(isLoginPage() ? 'login' : code ? 'notfound' : 'nopost');
  }
  function fail(reason) {
    busy = false;
    refresh();
    chrome.runtime.sendMessage({ type: 'rp-capture-failed', reason }).catch(() => {});
  }

  // Instagram tek sayfalık bir uygulama: adres değişimini izle
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) { lastPath = location.pathname; query(); }
    refresh();
  }, 700);
  refresh();
  isCaptureTab().then(yes => { if (yes) autoCapture(); });
})();
