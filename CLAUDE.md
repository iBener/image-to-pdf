# Resimden PDF

Resimleri seçip sıralayan, sayfa sayfa kırpan ve PDF'e dönüştüren yerel bir web uygulaması; aynı klasör bir Chrome eklentisi (Manifest V3) olarak da yüklenir ve Instagram gönderilerinden resim alabilir. Kullanıcıyla Türkçe konuşulur; arayüz metinleri Türkçedir.

## Temel kararlar
- Derleme adımı yok, sunucu yok. İki çalışma biçimi var, ikisi de korunmalı:
  - **Eklenti** (`chrome-extension://…/index.html`, `IS_EXT === true`): tam özellik, Instagram dahil.
  - **Dosya** (`index.html` çift tıklama, `file://`): Instagram hariç her şey; Instagram penceresi kurulum adımlarını gösterir.
- Kütüphaneler `lib/` içinde yerel kopya (internetsiz çalışsın diye): Cropper.js 1.6.2, jsPDF 2.5.1, SortableJS 1.15.2, heic2any 0.0.4.
- **HEIC**: heic2any blob worker ve `new Function` kullanır; MV3 eklenti sayfası CSP'si buna izin vermez. Eklentide dönüşüm `ext/heic-sandbox.html` (manifest `sandbox`, gevşetilmiş CSP) içinde, postMessage ile yapılır (`heicToJpeg`). Dosya modunda heic2any doğrudan, gerektiğinde yüklenir.
- **Instagram**: sunucu tarafında çekmek mümkün değil (giriş yapılmamış isteklere gönderi verisi gelmiyor) ve Instagram'ın korumalarını tarayıcı taklidiyle aşmak reddedildi; bu yapılmamalı. Bunun yerine eklenti, kullanıcının kendi tarayıcısında açılan Instagram sayfasının zaten yüklediği veriyi okur.
- Resimler hiçbir yere yüklenmez. Ayarlar `localStorage`'da (`resim-pdf-settings`); sayfalar kalıcı değil.

## Eklenti yapısı (`manifest.json`, `ext/`)
- `ext/background.js` (service worker): simge → uygulama sekmesini aç/öne getir; Instagram'dan gelen listeleri `chrome.storage.session` içindeki `pending` kuyruğuna koyar (kilitli `enqueue`/`takeAll`); uygulamanın açtırdığı geçici sekmeleri `captureTabs` içinde tutar, iş bitince kapatır.
  Mesajlar: `rp-add`, `rp-take`, `rp-is-capture`, `rp-capture-open`, `rp-capture-failed`, `rp-open-app`.
- `ext/ig-main.js` (MAIN world, document_start): sayfadaki `script[type="application/json"]` ile Instagram'ın kendi `/graphql` ve `/api/v1/` fetch/XHR yanıtlarını salt okur; iki veri biçimini çözer (v1: `code` + `carousel_media`/`image_versions2.candidates`; graph: `shortcode` + `edge_sidecar_to_children`/`display_resources`). Her karenin en geniş adayını seçer, `window.postMessage({__rpMedia})` ile iletir; `__rpQuery` ile önbelleği yeniden yollar.
- `ext/ig-content.js` (+ `.css`): gönderi sayfalarında sağ altta "PDF'e ekle" düğmesi; veri yoksa yedek olarak karuseli ilerletip DOM'daki resimleri toplar (`domCollect`, aria-label'lar İngilizce/Türkçe). Geçici sekmede (`rp-is-capture`) kendiliğinden toplar ve gönderir; başarısızsa `login`/`notfound`/`nopost`/`video` uyarısı kuyruğa girer.
- `host_permissions` yalnızca Instagram CDN'leri (`*.cdninstagram.com`, `*.fbcdn.net`): uygulama sayfası resimleri CORS'a takılmadan `fetch` eder (`p.remoteUrl` → `loadPage`).

## Kod yapısı (`app.js`)
- Sayfa nesnesi: `{ id, name, url, w, h, thumb, rot, crop, orient, fit, noMargin, aspect, modified, loading, remoteUrl? }`.
  - `w`, `h`: döndürülmemiş orijinal piksel boyutu. `rot`: 0/90/180/270.
  - `crop`: **döndürülmüş** resmin piksel koordinatlarında `{x, y, w, h}`; `null` = resmin tamamı.
  - `orient` / `fit` / `noMargin`: sayfaya özel ayar; `null` ise genel ayar (`S`) kullanılır (`effOf`).
  - `aspect`: `'free'`, sayı metni (`'1.3333'`) ya da `'page-portrait'` / `'page-landscape'` ("sayfaya oturt").
- `layout(crop, eff)`: sayfa boyutu (mm), resmin yerleşeceği alan `dest` (mm) ve kullanılacak kaynak bölge `src` (px). Kart önizlemesi, düzenleyici önizlemesi ve PDF çıktısı aynı fonksiyonu kullanır.
- `drawRegion(ctx, img, natW, natH, rot, src, dest)`: döndürme + kırpma + ölçeklemeyi tek seferde çizer.
- Kırpma penceresi: Cropper'a **önceden döndürülmüş** en fazla 2400 px'lik bir kopya verilir (Cropper'ın kendi döndürmesi kullanılmaz); `ed.k` ile orijinal koordinatlara çevrilir.
- Genel sayfa boyutu/kenar boşluğu değişince "sayfaya oturt" ile kırpılmış sayfalar `refitRatio` ile yeni orana uyarlanır.
- PDF: her sayfa için yalnızca görünen bölge, seçilen DPI'da (asla büyütmeden) canvas'a çizilip JPEG olarak jsPDF'e eklenir (`buildPdf`).
- Yapıştırma (Ctrl+V): resim → sayfa; Instagram bağlantısı → `captureInstagram`.

## Test
`puppeteer-core` (≥ 24.x, `enableExtensions: true`, `pipe: true`, `browser.installExtension(klasör)`) ile bilgisayardaki Chrome kullanılır; Chrome 137+ `--load-extension` bayrağını desteklemez. Dosyalar `#fileInput`'a yüklenir, `pages` / `ed` globalleri `page.evaluate` ile okunur. `ig-main.js` yerel sahte `/graphql` yanıtlarıyla sınanabilir. Test araçları proje klasörüne kurulmaz.
