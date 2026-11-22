'use strict';
/* Resimden PDF — resimleri seç, sırala, kırp, PDF'e dönüştür. Her şey tarayıcıda, yerelde çalışır. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// mm cinsinden (dikey: kısa kenar, uzun kenar)
const SIZES = { A4: [210, 297], A3: [297, 420], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
const SIZE_LABEL = { A4: 'A4', A3: 'A3', A5: 'A5', Letter: 'Letter', Legal: 'Legal', image: 'Resim boyutunda' };
const THUMB_MAX = 640;     // kart önizlemesi için küçük kopya
const EDIT_MAX = 2400;     // kırpma penceresinde gösterilen kopya
const IMAGE_PAGE_LONG = 297; // "Resim boyutunda" sayfanın uzun kenarı (mm)
const IMG_EXT = /\.(jpe?g|jfif|pjpeg|png|webp|heic|heif|avif|gif|bmp)$/i;
const HEIC_RE = /\.(heic|heif)$/i;
const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
// Chrome eklentisi olarak mı çalışıyoruz? (Instagram desteği ve HEIC sandbox'ı buna bağlı)
const IS_EXT = location.protocol === 'chrome-extension:' && typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);

/* ---------------- Ayarlar ---------------- */
const DEFAULTS = { size: 'A4', orient: 'auto', fit: 'contain', margin: 10, dpi: 200, quality: 90, filename: 'belge' };
const S = { ...DEFAULTS };
try { Object.assign(S, JSON.parse(localStorage.getItem('resim-pdf-settings') || '{}')); } catch (_) {}
function saveSettings() { try { localStorage.setItem('resim-pdf-settings', JSON.stringify(S)); } catch (_) {} }

/* ---------------- Durum ---------------- */
let pages = [];
let uid = 0;

/* ---------------- Geometri ---------------- */
function rotDims(p, rot = p.rot) { return rot % 180 ? [p.h, p.w] : [p.w, p.h]; }
function fullCrop(p, rot = p.rot) { const [W, H] = rotDims(p, rot); return { x: 0, y: 0, w: W, h: H }; }
function cropOf(p) { return p.crop || fullCrop(p); }
function effOf(o) { return { orient: o.orient || S.orient, fit: o.fit || S.fit, margin: o.noMargin ? 0 : S.margin }; }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function pageBox(orient, margin) {
  const [a, b] = SIZES[S.size];
  const pw = orient === 'landscape' ? b : a;
  const ph = orient === 'landscape' ? a : b;
  const m = clamp(margin, 0, Math.min(pw, ph) / 2 - 10);
  return { pw, ph, area: { x: m, y: m, w: pw - 2 * m, h: ph - 2 * m } };
}
function contentRatio(orient, margin) { const { area } = pageBox(orient, margin); return area.w / area.h; }

/** Bir sayfanın PDF'teki yerleşimi: sayfa boyutu (mm), resmin konacağı alan (mm), resmin kullanılacak bölgesi (px). */
function layout(c, e) {
  if (S.size === 'image') {
    const k = (IMAGE_PAGE_LONG - 2 * e.margin) / Math.max(c.w, c.h);
    const w = c.w * k, h = c.h * k;
    const area = { x: e.margin, y: e.margin, w, h };
    return { pw: w + 2 * e.margin, ph: h + 2 * e.margin, dest: area, src: c, area, orient: w > h ? 'landscape' : 'portrait' };
  }
  const orient = e.orient === 'auto' ? (c.w > c.h ? 'landscape' : 'portrait') : e.orient;
  const { pw, ph, area: A } = pageBox(orient, e.margin);
  let dest, src;
  if (e.fit === 'cover') {
    const s = Math.max(A.w / c.w, A.h / c.h);
    const vw = A.w / s, vh = A.h / s;
    src = { x: c.x + (c.w - vw) / 2, y: c.y + (c.h - vh) / 2, w: vw, h: vh };
    dest = { ...A };
  } else {
    const s = Math.min(A.w / c.w, A.h / c.h);
    const w = c.w * s, h = c.h * s;
    dest = { x: A.x + (A.w - w) / 2, y: A.y + (A.h - h) / 2, w, h };
    src = c;
  }
  return { pw, ph, dest, src, area: A, orient };
}

/** Kırpma alanını 90° döndürür (dir: 1 = saat yönü, -1 = tersi). */
function rotateCrop(c, W, H, dir) {
  return dir === 1
    ? { x: H - (c.y + c.h), y: c.x, w: c.h, h: c.w }
    : { x: c.y, y: W - (c.x + c.w), w: c.h, h: c.w };
}

/** Kırpma alanını, alanını ve merkezini koruyarak yeni bir orana getirir. */
function refitRatio(c, r, W, H) {
  const A = c.w * c.h;
  let w = Math.sqrt(A * r), h = w / r;
  if (w > W) { w = W; h = w / r; }
  if (h > H) { h = H; w = h * r; }
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  return { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w, h };
}

function isFullCrop(c, W, H) {
  const tx = W * 0.004, ty = H * 0.004;
  return Math.abs(c.x) < tx && Math.abs(c.y) < ty && Math.abs(c.w - W) < tx && Math.abs(c.h - H) < ty;
}

function flipAspect(a) {
  if (a === 'page-portrait') return 'page-landscape';
  if (a === 'page-landscape') return 'page-portrait';
  if (a === 'free') return a;
  const r = parseFloat(a);
  const known = { '1': '1', '1.3333': '0.75', '0.75': '1.3333', '1.7778': '0.5625', '0.5625': '1.7778' };
  return known[a] || String(Math.round((1 / r) * 10000) / 10000);
}

/* ---------------- Çizim ---------------- */
/** img'yi (natW×natH boyutundaymış gibi) rot kadar döndürüp, src bölgesini ctx üzerindeki dest dikdörtgenine çizer. */
function drawRegion(ctx, img, natW, natH, rot, src, dest) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(dest.x, dest.y, dest.w, dest.h);
  ctx.clip();
  ctx.translate(dest.x, dest.y);
  ctx.scale(dest.w / src.w, dest.h / src.h);
  ctx.translate(-src.x, -src.y);
  const RW = rot % 180 ? natH : natW, RH = rot % 180 ? natW : natH;
  ctx.translate(RW / 2, RH / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, -natW / 2, -natH / 2, natW, natH);
  ctx.restore();
}

/** Sayfanın küçük önizlemesini canvas'a çizer. */
function renderPagePreview(canvas, { crop, eff, source, maxW, maxH, guides }) {
  const L = layout(crop, eff);
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(maxW / L.pw, maxH / L.ph);
  const cw = Math.max(1, Math.round(L.pw * scale)), ch = Math.max(1, Math.round(L.ph * scale));
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  const d = { x: L.dest.x * scale, y: L.dest.y * scale, w: L.dest.w * scale, h: L.dest.h * scale };
  drawRegion(ctx, source.img, source.natW, source.natH, source.rot, L.src, d);
  if (guides && eff.margin > 0) {
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(59, 91, 253, .55)';
    ctx.lineWidth = 1;
    const a = L.area;
    ctx.strokeRect(a.x * scale + 0.5, a.y * scale + 0.5, a.w * scale - 1, a.h * scale - 1);
    ctx.restore();
  }
  return L;
}

/* ---------------- Yardımcılar ---------------- */
function loadImg(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Resim açılamadı'));
    img.src = url;
  });
}
async function tryLoadBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImg(url);
    if (!img.naturalWidth) throw new Error('boş');
    return { img, url };
  } catch (_) {
    URL.revokeObjectURL(url);
    return null;
  }
}
function canvasToBlob(canvas, type, q) {
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Canvas dönüştürülemedi'))), type, q));
}
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
let heicLoading = null;
function ensureHeic() {
  if (window.heic2any) return Promise.resolve();
  if (!heicLoading) {
    heicLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'lib/heic2any.min.js';
      s.onload = () => res();
      s.onerror = () => { heicLoading = null; rej(new Error('HEIC kütüphanesi yüklenemedi')); };
      document.head.appendChild(s);
    });
  }
  return heicLoading;
}
/* HEIC → JPEG. Dosya olarak açıldığında heic2any doğrudan; eklentide ise güvenlik kuralları
   gereği yalıtılmış sandbox sayfasında (ext/heic-sandbox.html) çalıştırılır. */
let sbFrame = null, sbReady = null, sbSeq = 0;
const sbWait = new Map();
function getSandbox() {
  if (!sbReady) {
    sbReady = new Promise((res, rej) => {
      sbFrame = document.createElement('iframe');
      sbFrame.src = 'ext/heic-sandbox.html';
      sbFrame.hidden = true;
      sbFrame.onload = () => res(sbFrame);
      sbFrame.onerror = () => { sbReady = null; rej(new Error('HEIC dönüştürücü açılamadı')); };
      document.body.appendChild(sbFrame);
    });
  }
  return sbReady;
}
window.addEventListener('message', e => {
  if (!sbFrame || e.source !== sbFrame.contentWindow || !e.data || !e.data.rpHeic) return;
  const w = sbWait.get(e.data.id);
  if (!w) return;
  sbWait.delete(e.data.id);
  if (e.data.error) w.rej(new Error(e.data.error));
  else w.res(new Blob([e.data.buf], { type: 'image/jpeg' }));
});
async function heicToJpeg(blob) {
  if (IS_EXT) {
    const f = await getSandbox();
    const buf = await blob.arrayBuffer();
    const id = ++sbSeq;
    return new Promise((res, rej) => {
      sbWait.set(id, { res, rej });
      f.contentWindow.postMessage({ rpHeic: true, id, buf }, '*', [buf]);
    });
  }
  await ensureHeic();
  let out = await window.heic2any({ blob, toType: 'image/jpeg', quality: 0.92 });
  if (Array.isArray(out)) out = out[0];
  return out;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------------- Dosya ekleme ---------------- */
async function addFiles(fileList) {
  const all = [...fileList];
  const files = all.filter(f => f.type.startsWith('image/') || IMG_EXT.test(f.name));
  if (all.length - files.length > 0) toast(`${all.length - files.length} dosya resim olmadığı için atlandı`);
  if (!files.length) return;
  files.sort((a, b) => collator.compare(a.name, b.name));
  const added = files.map(f => {
    const p = { id: ++uid, name: f.name, file: f, modified: f.lastModified, rot: 0, crop: null,
      orient: null, fit: null, noMargin: false, aspect: 'free', loading: true };
    pages.push(p);
    return p;
  });
  syncGrid();
  let failed = 0;
  for (const p of added) {
    if (!pages.includes(p)) continue; // yüklenirken silindiyse
    try {
      await loadPage(p);
    } catch (e) {
      console.error(p.name, e);
      failed++;
      toast(`"${p.name}" açılamadı${HEIC_RE.test(p.name) ? ' (HEIC çözümlenemedi)' : ''}`, 'error');
      removePage(p.id);
    }
  }
  if (added.length - failed > 0 && pages.length === added.length - failed) {
    // ilk ekleme: kullanıcıya ipucu
    toast('Sayfayı kırpmak/sayfaya oturtmak için üzerine tıklayın, sırayı sürükleyerek değiştirin');
  }
}

async function loadPage(p) {
  if (!p.file && p.remoteUrl) {
    setCardStatus(p, 'İndiriliyor…');
    const res = await fetch(p.remoteUrl, { credentials: 'omit' });
    if (!res.ok) throw new Error('İndirilemedi (HTTP ' + res.status + ')');
    const b = await res.blob();
    p.file = new File([b], p.name, { type: b.type || 'image/jpeg' });
  }
  let blob = p.file;
  let r = await tryLoadBlob(blob);
  if (!r && (HEIC_RE.test(p.name) || /hei[cf]/i.test(p.file.type))) {
    setCardStatus(p, 'HEIC dönüştürülüyor…');
    blob = await heicToJpeg(p.file);
    r = await tryLoadBlob(blob);
  }
  if (!r) throw new Error('Desteklenmeyen biçim');
  if (!pages.includes(p)) { URL.revokeObjectURL(r.url); return; }
  p.url = r.url;
  p.w = r.img.naturalWidth;
  p.h = r.img.naturalHeight;
  const k = Math.min(1, THUMB_MAX / Math.max(p.w, p.h));
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(p.w * k));
  t.height = Math.max(1, Math.round(p.h * k));
  const tc = t.getContext('2d');
  tc.imageSmoothingQuality = 'high';
  tc.drawImage(r.img, 0, 0, t.width, t.height);
  p.thumb = t;
  p.file = null;
  p.loading = false;
  updateCard(p);
  updateSummary();
}

function removePage(id) {
  const i = pages.findIndex(p => p.id === id);
  if (i < 0) return;
  const [p] = pages.splice(i, 1);
  if (p.url) URL.revokeObjectURL(p.url);
  syncGrid();
}

/* ---------------- Sayfa kartları ---------------- */
const grid = $('#grid');
const ICON_CROP = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M17 23v-4H7a2 2 0 0 1-2-2V7H1V5h4V1h2v16h16v2h-4v4h-2Zm0-8V7H9V5h8a2 2 0 0 1 2 2v8h-2Z"/></svg>';
const ICON_ROT = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 4V1l4 4-4 4V6a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8Z"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 21a2 2 0 0 1-2-2V6H4V4h5V3h6v1h5v2h-1v13a2 2 0 0 1-2 2H7Zm10-15H7v13h10V6ZM9 17h2V8H9v9Zm4 0h2V8h-2v9Z"/></svg>';

function cardEl(p) {
  let el = grid.querySelector(`.card[data-id="${p.id}"]`);
  if (el) return el;
  el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = p.id;
  el.innerHTML = `
    <div class="thumb" data-act="edit" title="Kırpmak / düzenlemek için tıklayın">
      <canvas></canvas>
      <div class="loading"><div class="spinner sm"></div><span>Yükleniyor…</span></div>
      <div class="edit-hint">Kırp / sayfaya oturt</div>
    </div>
    <div class="meta"><span class="num"></span><span class="name"></span></div>
    <div class="badges"></div>
    <div class="actions">
      <button class="btn sm" data-act="edit">${ICON_CROP} Kırp / Düzenle</button>
      <button class="icon-btn" data-act="rotate" title="90° sağa döndür">${ICON_ROT}</button>
      <button class="icon-btn danger" data-act="delete" title="Sayfayı kaldır">${ICON_DEL}</button>
    </div>`;
  const nm = el.querySelector('.name');
  nm.textContent = p.name;
  nm.title = p.name;
  return el;
}

function setCardStatus(p, text) {
  const el = cardEl(p);
  const span = el.querySelector('.loading span');
  if (span) span.textContent = text;
}

function updateCard(p) {
  const el = cardEl(p);
  const loading = el.querySelector('.loading');
  loading.hidden = !p.loading;
  if (p.loading) return;
  const box = el.querySelector('.thumb');
  const maxW = (box.clientWidth || 190) - 20;
  const maxH = (box.clientHeight || 240) - 20;
  renderPagePreview(el.querySelector('canvas'), {
    crop: cropOf(p), eff: effOf(p), maxW, maxH,
    source: { img: p.thumb, natW: p.w, natH: p.h, rot: p.rot },
  });
  const e = effOf(p);
  const L = layout(cropOf(p), e);
  const badges = [];
  if (p.crop) badges.push('<span class="badge crop">Kırpıldı</span>');
  if (p.rot) badges.push(`<span class="badge">${p.rot}°</span>`);
  if (S.size !== 'image') badges.push(`<span class="badge">${L.orient === 'landscape' ? 'Yatay' : 'Dikey'}</span>`);
  if (p.fit) badges.push(`<span class="badge">${p.fit === 'cover' ? 'Doldur' : 'Sığdır'}</span>`);
  if (p.noMargin) badges.push('<span class="badge">Tam sayfa</span>');
  el.querySelector('.badges').innerHTML = badges.join('');
}

function syncGrid() {
  const ids = new Set(pages.map(p => String(p.id)));
  $$('.card', grid).forEach(el => { if (!ids.has(el.dataset.id)) el.remove(); });
  pages.forEach((p, i) => {
    const el = cardEl(p);
    if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
    el.querySelector('.num').textContent = i + 1;
    if (!el.dataset.rendered || p.loading) { updateCard(p); el.dataset.rendered = p.loading ? '' : '1'; }
  });
  const empty = pages.length === 0;
  $('#dropzone').hidden = !empty;
  grid.hidden = empty;
  $('#gridHint').hidden = empty;
  updateSummary();
}
function renumber() { pages.forEach((p, i) => { cardEl(p).querySelector('.num').textContent = i + 1; }); }
function renderAllCards() { pages.forEach(p => { if (!p.loading) updateCard(p); }); }

function updateSummary() {
  const n = pages.length;
  const loading = pages.filter(p => p.loading).length;
  const btn = $('#makePdf');
  btn.disabled = n === 0 || loading > 0;
  if (!n) { $('#summary').textContent = 'Henüz sayfa yok'; return; }
  const cropped = pages.filter(p => p.crop).length;
  let t = `${n} sayfa · ${SIZE_LABEL[S.size]}`;
  if (cropped) t += ` · ${cropped} kırpılmış`;
  if (loading) t += ` · ${loading} yükleniyor…`;
  $('#summary').textContent = t;
}

grid.addEventListener('click', e => {
  const actEl = e.target.closest('[data-act]');
  const card = e.target.closest('.card');
  if (!actEl || !card) return;
  const id = +card.dataset.id;
  const idx = pages.findIndex(p => p.id === id);
  const p = pages[idx];
  if (!p) return;
  const act = actEl.dataset.act;
  if (act === 'delete') removePage(id);
  else if (p.loading) toast('Bu sayfa hâlâ yükleniyor');
  else if (act === 'edit') openEditor(idx);
  else if (act === 'rotate') { rotatePage(p, 1); updateCard(p); updateSummary(); }
});

function rotatePage(o, dir) {
  // o: sayfa veya düzenleyicideki geçici kopya ({rot, crop, aspect, orient})
  const [W, H] = rotDims(ed.p && o === ed.t ? ed.p : o, o.rot);
  if (o.crop) o.crop = rotateCrop(o.crop, W, H, dir);
  o.rot = (o.rot + dir * 90 + 360) % 360;
  if (o.aspect && o.aspect !== 'free') {
    o.aspect = flipAspect(o.aspect);
    if (o.aspect.startsWith('page-')) o.orient = o.aspect === 'page-landscape' ? 'landscape' : 'portrait';
  }
}

new Sortable(grid, {
  animation: 160,
  ghostClass: 'sortable-ghost',
  chosenClass: 'sortable-chosen',
  filter: 'button',
  preventOnFilter: false,
  delayOnTouchOnly: true,
  delay: 150,
  onEnd() {
    const order = $$('.card', grid).map(el => +el.dataset.id);
    pages.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    renumber();
  },
});

/* ---------------- Üst çubuk ---------------- */
for (const id of ['#fileInput', '#fileInput2']) {
  $(id).addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
}
$('#clearBtn').addEventListener('click', () => {
  if (!pages.length) return;
  if (!confirm(`${pages.length} sayfanın tamamı kaldırılsın mı?`)) return;
  pages.forEach(p => p.url && URL.revokeObjectURL(p.url));
  pages = [];
  syncGrid();
});
$('#sortSelect').addEventListener('change', e => {
  const v = e.target.value;
  e.target.value = '';
  if (!v || !pages.length) return;
  if (v === 'name-asc') pages.sort((a, b) => collator.compare(a.name, b.name));
  if (v === 'name-desc') pages.sort((a, b) => collator.compare(b.name, a.name));
  if (v === 'date-asc') pages.sort((a, b) => a.modified - b.modified);
  if (v === 'date-desc') pages.sort((a, b) => b.modified - a.modified);
  if (v === 'reverse') pages.reverse();
  syncGrid();
});

/* Sürükle-bırak ile dosya ekleme */
let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#dropOverlay').hidden = false; });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; } });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropOverlay').hidden = true;
  if (!$('#editor').hidden) return;
  addFiles(e.dataTransfer.files);
});

/* ---------------- Genel ayarlar paneli ---------------- */
function setupSegmented(el, key) {
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    S[key] = b.dataset.v;
    onSettingsChanged();
  });
}
setupSegmented($('#sOrient'), 'orient');
setupSegmented($('#sFit'), 'fit');
$('#sSize').addEventListener('change', e => { S.size = e.target.value; onSettingsChanged(); });
$('#sMargin').addEventListener('input', e => { S.margin = +e.target.value; onSettingsChanged(); });
$('#sDpi').addEventListener('change', e => { S.dpi = +e.target.value; saveSettings(); });
$('#sQuality').addEventListener('input', e => { S.quality = +e.target.value; $('#qualityVal').textContent = S.quality + '%'; saveSettings(); });
$('#sFilename').addEventListener('input', e => { S.filename = e.target.value; saveSettings(); });

function syncSettingsUI() {
  $('#sSize').value = S.size;
  $$('#sOrient button').forEach(b => b.classList.toggle('active', b.dataset.v === S.orient));
  $$('#sFit button').forEach(b => b.classList.toggle('active', b.dataset.v === S.fit));
  $('#sMargin').value = S.margin;
  $('#marginVal').textContent = S.margin + ' mm';
  $('#sDpi').value = String(S.dpi);
  $('#sQuality').value = S.quality;
  $('#qualityVal').textContent = S.quality + '%';
  $('#sFilename').value = S.filename;
  const img = S.size === 'image';
  $('#orientField').classList.toggle('disabled', img);
  $('#fitField').classList.toggle('disabled', img);
}

let renderTimer = 0;
function onSettingsChanged() {
  saveSettings();
  syncSettingsUI();
  // "Sayfaya oturt" ile kırpılmış sayfaları yeni sayfa oranına uyarla
  if (S.size !== 'image') {
    pages.forEach(p => {
      if (p.loading || !p.aspect || !p.aspect.startsWith('page-')) return;
      const orient = p.aspect === 'page-landscape' ? 'landscape' : 'portrait';
      const [W, H] = rotDims(p);
      p.crop = refitRatio(cropOf(p), contentRatio(orient, effOf(p).margin), W, H);
      if (isFullCrop(p.crop, W, H)) p.crop = null;
    });
  }
  cancelAnimationFrame(renderTimer);
  renderTimer = requestAnimationFrame(() => { renderAllCards(); updateSummary(); });
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderAllCards();
    if (!$('#editor').hidden) { renderEdPreview(); }
  }, 150);
});

/* ---------------- Kırpma / düzenleme penceresi ---------------- */
const ed = { idx: -1, p: null, t: null, cropper: null, disp: null, dispUrl: null, k: 1, ready: false, token: 0 };
const edImg = $('#edImg');

function aspectValue(a, t) {
  if (!a || a === 'free') return NaN;
  if (a.startsWith('page-')) {
    if (S.size === 'image') return NaN;
    return contentRatio(a === 'page-landscape' ? 'landscape' : 'portrait', effOf(t).margin);
  }
  return parseFloat(a);
}

function openEditor(idx) {
  const p = pages[idx];
  if (!p || p.loading) return;
  ed.idx = idx;
  ed.p = p;
  ed.t = { rot: p.rot, crop: p.crop ? { ...p.crop } : null, orient: p.orient, fit: p.fit, noMargin: p.noMargin, aspect: p.aspect || 'free' };
  $('#editor').hidden = false;
  document.body.classList.add('modal-open');
  $('#edTitle').textContent = `Sayfa ${idx + 1} / ${pages.length}`;
  $('#edSub').textContent = p.name;
  $('#edPrev').disabled = idx === 0;
  $('#edNext').disabled = idx === pages.length - 1;
  syncEditorControls();
  buildCropper();
}

function destroyCropper() {
  if (ed.cropper) { ed.cropper.destroy(); ed.cropper = null; }
  if (ed.dispUrl) { URL.revokeObjectURL(ed.dispUrl); ed.dispUrl = null; }
  ed.ready = false;
}

async function buildCropper() {
  const token = ++ed.token;
  destroyCropper();
  const { p, t } = ed;
  $('#cropLoading').hidden = false;
  edImg.removeAttribute('src');
  try {
    const img = await loadImg(p.url);
    if (token !== ed.token) return;
    const [RW, RH] = rotDims(p, t.rot);
    const k = Math.min(1, EDIT_MAX / Math.max(RW, RH));
    const dw = Math.max(1, Math.round(RW * k)), dh = Math.max(1, Math.round(RH * k));
    const c = document.createElement('canvas');
    c.width = dw; c.height = dh;
    const cx = c.getContext('2d');
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, dw, dh);
    drawRegion(cx, img, p.w, p.h, t.rot, { x: 0, y: 0, w: RW, h: RH }, { x: 0, y: 0, w: dw, h: dh });
    ed.disp = c;
    ed.k = RW / dw;
    ed.RW = RW; ed.RH = RH;
    renderEdPreview();
    const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
    if (token !== ed.token) return;
    ed.dispUrl = URL.createObjectURL(blob);
    edImg.src = ed.dispUrl;
    await edImg.decode().catch(() => {});
    if (token !== ed.token) return;
    const k2 = ed.k;
    ed.cropper = new Cropper(edImg, {
      viewMode: 1,
      dragMode: 'crop',
      autoCropArea: 1,
      checkOrientation: false,
      toggleDragModeOnDblclick: false,
      background: true,
      guides: true,
      zoomOnWheel: true,
      wheelZoomRatio: 0.1,
      aspectRatio: aspectValue(t.aspect, t),
      data: t.crop ? { x: t.crop.x / k2, y: t.crop.y / k2, width: t.crop.w / k2, height: t.crop.h / k2 } : undefined,
      ready() {
        if (token !== ed.token) return;
        ed.ready = true;
        $('#cropLoading').hidden = true;
        readCrop();
      },
      crop(e) {
        if (!ed.ready || token !== ed.token) return;
        readCrop(e.detail);
      },
    });
  } catch (e) {
    console.error(e);
    toast('Resim düzenleyicide açılamadı', 'error');
  }
}

function toDisp(c) { const k = ed.k; return { x: c.x / k, y: c.y / k, width: c.w / k, height: c.h / k }; }

function readCrop(d) {
  if (!ed.cropper) return;
  d = d || ed.cropper.getData();
  const k = ed.k, W = ed.RW, H = ed.RH;
  let x = clamp(d.x * k, 0, W), y = clamp(d.y * k, 0, H);
  let w = clamp(d.width * k, 1, W - x), h = clamp(d.height * k, 1, H - y);
  ed.t.crop = { x, y, w, h };
  scheduleEdPreview();
}

let edPrevRaf = 0;
function scheduleEdPreview() {
  cancelAnimationFrame(edPrevRaf);
  edPrevRaf = requestAnimationFrame(renderEdPreview);
}
function renderEdPreview() {
  if (!ed.disp || !ed.t) return;
  const box = $('#edPreviewBox');
  const crop = ed.t.crop || { x: 0, y: 0, w: ed.RW, h: ed.RH };
  const eff = effOf(ed.t);
  const L = renderPagePreview($('#edCanvas'), {
    crop, eff, guides: true,
    maxW: (box.clientWidth || 300) - 24, maxH: (box.clientHeight || 290) - 24,
    source: { img: ed.disp, natW: ed.RW, natH: ed.RH, rot: 0 },
  });
  const parts = [SIZE_LABEL[S.size]];
  if (S.size !== 'image') {
    parts.push(L.orient === 'landscape' ? 'Yatay' : 'Dikey');
    parts.push(eff.fit === 'cover' ? 'Doldur' : 'Sığdır');
  }
  parts.push(eff.margin ? `${eff.margin} mm kenar` : 'kenar boşluksuz');
  parts.push(`${Math.round(crop.w)} × ${Math.round(crop.h)} px`);
  $('#edInfo').textContent = parts.join(' · ');
}

function syncEditorControls() {
  const t = ed.t;
  $('#aspectChips').classList.toggle('no-page', S.size === 'image');
  $$('#aspectChips .chip').forEach(b => b.classList.toggle('active', b.dataset.aspect === t.aspect));
  $('#edOrient').value = t.orient || '';
  $('#edFit').value = t.fit || '';
  $('#edNoMargin').checked = !!t.noMargin;
  $('#edOrient').disabled = S.size === 'image';
  $('#edFit').disabled = S.size === 'image';
}

/** Seçili oranı kırpıcıya uygular; mevcut kırpma alanının merkezini ve büyüklüğünü mümkün olduğunca korur. */
function applyAspect(keepFull = false) {
  const t = ed.t;
  syncEditorControls();
  if (!ed.cropper || !ed.ready) { scheduleEdPreview(); return; }
  const prev = t.crop;
  const r = aspectValue(t.aspect, t);
  ed.cropper.setAspectRatio(r);
  if (prev && !keepFull) {
    const c = isNaN(r) ? prev : refitRatio(prev, r, ed.RW, ed.RH);
    ed.cropper.setData(toDisp(c));
  }
  readCrop();
}

$('#aspectChips').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  const t = ed.t;
  t.aspect = b.dataset.aspect;
  if (t.aspect.startsWith('page-')) {
    t.orient = t.aspect === 'page-landscape' ? 'landscape' : 'portrait';
    // "Sayfaya oturt": resim sayfanın içerik alanını tam doldursun
    const W = ed.RW, H = ed.RH;
    const r = aspectValue(t.aspect, t);
    syncEditorControls();
    if (ed.cropper && ed.ready && !isNaN(r)) {
      ed.cropper.setAspectRatio(r);
      // Mevcut kırpmayı yeni orana uydur; kırpma yoksa olabilecek en büyük alanı seç
      const base = t.crop && !isFullCrop(t.crop, W, H) ? t.crop : { x: 0, y: 0, w: W, h: H };
      const grow = { x: 0, y: 0, w: W, h: H };
      const c = isFullCrop(base, W, H) ? refitRatio(grow, r, W, H) : refitRatio(base, r, W, H);
      ed.cropper.setData(toDisp(c));
      readCrop();
    }
    return;
  }
  applyAspect();
});

$('#edReset').addEventListener('click', () => {
  ed.t.aspect = 'free';
  ed.t.crop = null;
  syncEditorControls();
  if (ed.cropper && ed.ready) {
    ed.cropper.setAspectRatio(NaN);
    ed.cropper.setData({ x: 0, y: 0, width: ed.RW / ed.k, height: ed.RH / ed.k });
    readCrop();
  }
});
$('#edRotL').addEventListener('click', () => { rotatePage(ed.t, -1); syncEditorControls(); buildCropper(); });
$('#edRotR').addEventListener('click', () => { rotatePage(ed.t, 1); syncEditorControls(); buildCropper(); });
$('#edOrient').addEventListener('change', e => {
  const t = ed.t;
  t.orient = e.target.value || null;
  if (t.aspect.startsWith('page-') && (t.orient === 'portrait' || t.orient === 'landscape')) {
    t.aspect = 'page-' + t.orient;
    applyAspect();
  } else {
    syncEditorControls();
    scheduleEdPreview();
  }
});
$('#edFit').addEventListener('change', e => { ed.t.fit = e.target.value || null; scheduleEdPreview(); });
$('#edNoMargin').addEventListener('change', e => {
  ed.t.noMargin = e.target.checked;
  if (ed.t.aspect.startsWith('page-')) applyAspect(); else scheduleEdPreview();
});

function commitEditor() {
  const { p, t } = ed;
  if (!p || !pages.includes(p)) return;
  p.rot = t.rot;
  const [W, H] = rotDims(p, t.rot);
  p.crop = t.crop && !isFullCrop(t.crop, W, H) ? { ...t.crop } : null;
  p.orient = t.orient || null;
  p.fit = t.fit || null;
  p.noMargin = !!t.noMargin;
  p.aspect = t.aspect;
  updateCard(p);
  updateSummary();
}
function closeEditor() {
  ed.token++;
  destroyCropper();
  ed.disp = null; ed.p = null; ed.t = null;
  $('#editor').hidden = true;
  document.body.classList.remove('modal-open');
}
$('#edApply').addEventListener('click', () => { commitEditor(); closeEditor(); });
$('#edCancel').addEventListener('click', closeEditor);
$('#edClose').addEventListener('click', closeEditor);
$('#edPrev').addEventListener('click', () => { const i = pages.indexOf(ed.p); commitEditor(); if (i > 0) openEditor(i - 1); });
$('#edNext').addEventListener('click', () => { const i = pages.indexOf(ed.p); commitEditor(); if (i < pages.length - 1) openEditor(i + 1); });
$('#editor').addEventListener('mousedown', e => { if (e.target.id === 'editor') closeEditor(); });
document.addEventListener('keydown', e => {
  if ($('#editor').hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
  else if (e.key === 'Enter' && !['SELECT', 'INPUT', 'BUTTON'].includes(document.activeElement.tagName)) {
    e.preventDefault(); commitEditor(); closeEditor();
  }
});

/* ---------------- PDF oluşturma ---------------- */
function showBusy(text, frac) {
  $('#busy').hidden = false;
  $('#busyText').textContent = text;
  $('#busyBar').style.width = Math.round((frac || 0) * 100) + '%';
}
function hideBusy() { $('#busy').hidden = true; }

async function buildPdf(onProgress) {
  const { jsPDF } = window.jspdf;
  let doc = null;
  const n = pages.length;
  for (let i = 0; i < n; i++) {
    const p = pages[i];
    onProgress && onProgress(i, n);
    await nextFrame();
    const L = layout(cropOf(p), effOf(p));
    const img = await loadImg(p.url);
    const pxPerMm = S.dpi / 25.4;
    let tw = L.dest.w * pxPerMm, th = L.dest.h * pxPerMm;
    if (L.src.w < tw) { tw = L.src.w; th = L.src.h; } // büyütme yapma
    tw = Math.max(1, Math.round(tw));
    th = Math.max(1, Math.round(th));
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    const cx = c.getContext('2d');
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, tw, th);
    drawRegion(cx, img, p.w, p.h, p.rot, L.src, { x: 0, y: 0, w: tw, h: th });
    const blob = await canvasToBlob(c, 'image/jpeg', S.quality / 100);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    c.width = c.height = 0;
    const orient = L.pw > L.ph ? 'landscape' : 'portrait';
    if (!doc) doc = new jsPDF({ unit: 'mm', format: [L.pw, L.ph], orientation: orient, compress: true });
    else doc.addPage([L.pw, L.ph], orient);
    doc.addImage(bytes, 'JPEG', L.dest.x, L.dest.y, L.dest.w, L.dest.h, 'img' + p.id + '_' + i, 'NONE');
  }
  return doc;
}

function pdfFileName() {
  let name = (S.filename || '').trim().replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-');
  return (name || 'belge') + '.pdf';
}

$('#makePdf').addEventListener('click', async () => {
  if (!pages.length) return toast('Önce resim ekleyin');
  if (pages.some(p => p.loading)) return toast('Bazı resimler hâlâ yükleniyor, lütfen bekleyin');
  try {
    showBusy('PDF hazırlanıyor…', 0);
    const doc = await buildPdf((i, n) => showBusy(`Sayfa ${i + 1} / ${n} hazırlanıyor…`, i / n));
    showBusy('PDF kaydediliyor…', 1);
    await nextFrame();
    const fname = pdfFileName();
    doc.setProperties({ title: fname.replace(/\.pdf$/i, ''), creator: 'Resimden PDF' });
    doc.save(fname);
    toast(`"${fname}" oluşturuldu (${pages.length} sayfa)`, 'success');
  } catch (e) {
    console.error(e);
    toast('PDF oluşturulamadı: ' + (e.message || e), 'error');
  } finally {
    hideBusy();
  }
});

/* ---------------- Instagram (yalnızca eklenti olarak çalışırken) ---------------- */
const IG_RE = /(?:^|\/\/|\s)(?:www\.|m\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/i;
const igModal = $('#igModal');

function openIgModal(prefill = '') {
  $('#igExt').hidden = !IS_EXT;
  $('#igNoExt').hidden = IS_EXT;
  igModal.hidden = false;
  document.body.classList.add('modal-open');
  if (IS_EXT) {
    const inp = $('#igUrl');
    inp.value = prefill;
    setTimeout(() => inp.focus(), 0);
  }
}
function closeIgModal() {
  igModal.hidden = true;
  if ($('#editor').hidden) document.body.classList.remove('modal-open');
}

async function captureInstagram(text) {
  const m = String(text || '').match(IG_RE);
  if (!m) { toast('Bu bir Instagram gönderi bağlantısı gibi görünmüyor', 'error'); return false; }
  if (!IS_EXT) { openIgModal(); return false; }
  // Takip/paylaşım parametrelerini atıp sade gönderi adresini kullan
  const url = `https://www.instagram.com/p/${m[1]}/`;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'rp-capture-open', url });
    if (!r || !r.ok) throw new Error((r && r.error) || 'yanıt yok');
    toast('Instagram gönderisi arka planda açılıyor, resimler alınıyor…');
    return true;
  } catch (e) {
    toast('Instagram gönderisi açılamadı: ' + (e.message || e), 'error');
    return false;
  }
}

/** Eklentinin kuyruğa koyduğu Instagram resimlerini sayfa olarak ekler. */
function addRemoteBatch(b) {
  const who = (b.username || 'instagram').replace(/[^A-Za-z0-9._-]/g, '');
  const now = Date.now();
  const added = (b.items || []).map((it, i) => {
    const p = {
      id: ++uid, name: `${who}_${b.code}_${String(i + 1).padStart(2, '0')}.jpg`, file: null, remoteUrl: it.url,
      modified: now + i, rot: 0, crop: null, orient: null, fit: null, noMargin: false, aspect: 'free', loading: true,
    };
    pages.push(p);
    return p;
  });
  if (!added.length) return;
  syncGrid();
  toast(`Instagram: ${added.length} resim ekleniyor${b.skippedVideos ? ` (${b.skippedVideos} video atlandı)` : ''}`, 'success');
  (async () => {
    let failed = 0;
    for (const p of added) {
      if (!pages.includes(p)) continue;
      try { await loadPage(p); } catch (e) { console.error(p.name, e); failed++; removePage(p.id); }
    }
    if (failed) toast(`${failed} Instagram resmi indirilemedi. Bağlantının süresi dolmuş olabilir; gönderiyi tekrar ekleyin.`, 'error');
  })();
}

const IG_NOTICES = {
  login: "Instagram bu gönderi için giriş istiyor. Açılan sekmede giriş yapın, sonra gönderideki “PDF'e ekle” düğmesine basın.",
  notfound: "Gönderideki resimler otomatik alınamadı. Açılan sekmede gönderideki “PDF'e ekle” düğmesine basmayı deneyin.",
  nopost: 'Bağlantı bir Instagram gönderisine ait görünmüyor.',
  video: 'Bu gönderide resim yok, yalnızca video var.',
};

let takingPending = false;
async function takePending() {
  if (!IS_EXT || takingPending) return;
  takingPending = true;
  try {
    for (let guard = 0; guard < 5; guard++) {
      const r = await chrome.runtime.sendMessage({ type: 'rp-take' });
      const list = (r && r.pending) || [];
      if (!list.length) break;
      for (const b of list) {
        if (b.notice) toast(IG_NOTICES[b.notice] || IG_NOTICES.notfound, 'error');
        else addRemoteBatch(b);
      }
    }
  } catch (e) {
    console.error('Kuyruk alınamadı', e);
  } finally {
    takingPending = false;
  }
}

$('#igBtn').addEventListener('click', () => openIgModal());
$('#igBtn2').addEventListener('click', () => openIgModal());
$('#igClose').addEventListener('click', closeIgModal);
igModal.addEventListener('mousedown', e => { if (e.target === igModal) closeIgModal(); });
$('#igForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (await captureInstagram($('#igUrl').value)) closeIgModal();
});
document.addEventListener('keydown', e => { if (!igModal.hidden && e.key === 'Escape') { e.preventDefault(); closeIgModal(); } });

// Yapıştırma: kopyalanmış resimler doğrudan sayfa olur; Instagram bağlantısı ise gönderiden resim alınır
document.addEventListener('paste', e => {
  if (!$('#editor').hidden) return;
  const t = e.target;
  const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
  const files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith('image/'));
  if (files.length && !inField) {
    e.preventDefault();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    addFiles(files.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `yapistirilan_${stamp}_${i + 1}.${(f.type.split('/')[1] || 'png')}`, { type: f.type, lastModified: Date.now() })));
    return;
  }
  const text = e.clipboardData ? e.clipboardData.getData('text') : '';
  if (!inField && IG_RE.test(text)) {
    e.preventDefault();
    captureInstagram(text);
  }
});

if (IS_EXT) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.pending && (changes.pending.newValue || []).length) takePending();
  });
  takePending();
  document.title = 'Resimden PDF';
}

/* ---------------- Başlangıç ---------------- */
syncSettingsUI();
syncGrid();
