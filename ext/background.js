'use strict';
/* Resimden PDF — arka plan (service worker).
   - Araç çubuğu simgesi: uygulama sekmesini açar / öne getirir.
   - Instagram sayfasından gelen resim listelerini kuyruğa koyar (chrome.storage.session); uygulama sekmesi kuyruğu alır.
   - Uygulamadan gelen "bu bağlantıdan resim al" isteği için gönderiyi arka planda bir sekmede açar. */

const APP_URL = chrome.runtime.getURL('index.html');

// storage işlemleri araya girmesin diye basit kilit
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn);
  lock = run.catch(() => {});
  return run;
}

async function getCaptures() {
  return (await chrome.storage.session.get('captureTabs')).captureTabs || {};
}
function setCaptures(c) {
  return chrome.storage.session.set({ captureTabs: c });
}

function enqueue(batch) {
  return withLock(async () => {
    const { pending = [] } = await chrome.storage.session.get('pending');
    pending.push({ ...batch, id: Date.now() + '-' + Math.random().toString(36).slice(2) });
    await chrome.storage.session.set({ pending });
  });
}
function takeAll() {
  return withLock(async () => {
    const { pending = [] } = await chrome.storage.session.get('pending');
    if (pending.length) await chrome.storage.session.set({ pending: [] });
    return pending;
  });
}

async function findAppTab() {
  try {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [APP_URL] });
    if (ctx.length && ctx[0].tabId >= 0) return ctx[0].tabId;
  } catch (_) {}
  return null;
}

async function focusTab(tabId) {
  const t = await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(t.windowId, { focused: true });
}

async function openApp() {
  const id = await findAppTab();
  if (id != null) { await focusTab(id); return id; }
  const t = await chrome.tabs.create({ url: APP_URL });
  return t.id;
}

chrome.action.onClicked.addListener(() => { openApp(); });

chrome.tabs.onRemoved.addListener(tabId => withLock(async () => {
  const c = await getCaptures();
  if (c[tabId]) { delete c[tabId]; await setCaptures(c); }
}));

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  handle(msg, sender).then(reply, e => reply({ ok: false, error: String((e && e.message) || e) }));
  return true; // yanıt asenkron
});

async function handle(msg, sender) {
  const tabId = sender.tab ? sender.tab.id : null;
  switch (msg && msg.type) {
    case 'rp-is-capture': {
      const c = await getCaptures();
      return { capture: tabId != null && !!c[tabId] };
    }
    case 'rp-add': {
      await enqueue(msg.batch);
      const c = await getCaptures();
      if (tabId != null && c[tabId]) {
        // Uygulamanın açtığı geçici sekme: işini bitirdi, kapat ve uygulamaya dön
        await withLock(async () => { const cc = await getCaptures(); delete cc[tabId]; await setCaptures(cc); });
        await openApp();
        chrome.tabs.remove(tabId).catch(() => {});
      }
      return { ok: true };
    }
    case 'rp-capture-failed': {
      await withLock(async () => { const c = await getCaptures(); delete c[tabId]; await setCaptures(c); });
      await enqueue({ notice: msg.reason || 'notfound' });
      if (tabId != null) await focusTab(tabId).catch(() => {});
      return { ok: true };
    }
    case 'rp-capture-open': {
      const t = await chrome.tabs.create({ url: msg.url, active: false });
      await withLock(async () => { const c = await getCaptures(); c[t.id] = { url: msg.url, at: Date.now() }; await setCaptures(c); });
      return { ok: true };
    }
    case 'rp-take':
      return { pending: await takeAll() };
    case 'rp-open-app':
      await openApp();
      return { ok: true };
    default:
      return { ok: false, error: 'bilinmeyen mesaj' };
  }
}
