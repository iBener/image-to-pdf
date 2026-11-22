window.addEventListener('message', async e => {
  const d = e.data;
  if (!d || !d.rpHeic || !d.buf) return;
  try {
    let out = await heic2any({ blob: new Blob([d.buf]), toType: 'image/jpeg', quality: 0.92 });
    if (Array.isArray(out)) out = out[0];
    const buf = await out.arrayBuffer();
    e.source.postMessage({ rpHeic: true, id: d.id, buf }, '*', [buf]);
  } catch (err) {
    const msg = (err && (err.message || err.code)) || String(err);
    e.source.postMessage({ rpHeic: true, id: d.id, error: String(msg) }, '*');
  }
});
