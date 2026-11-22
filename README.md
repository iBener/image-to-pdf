# Resimden PDF

Resimleri seçip sıralayan, sayfa sayfa kırpan ve tek bir PDF'e dönüştüren küçük bir uygulama.
Bilgisayardaki resimlerin yanında Instagram gönderilerindeki resimleri de alabilir.
Resimler hiçbir sunucuya yüklenmez, her şey kendi tarayıcınızda işlenir.

## Kurulum (Chrome eklentisi olarak, önerilen)
1. Chrome'da adres çubuğuna `chrome://extensions` yazın.
2. Sağ üstteki **Geliştirici modu**nu açın.
3. **Paketlenmemiş öğe yükle**'ye tıklayın ve bu `resim-pdf` klasörünü seçin.
4. Araç çubuğundaki yapboz simgesinden **Resimden PDF**'i sabitleyin. Simgeye tıklayınca uygulama açılır.

Kodda değişiklik olursa `chrome://extensions` sayfasında eklentinin **yenile** (↻) düğmesine basın ve açık Instagram sekmelerini yenileyin.

Eklenti olmadan da kullanılabilir: `index.html` dosyasına çift tıklayın. Bu şekilde Instagram dışındaki her şey çalışır.

## Kullanım
1. **Resim ekle**, sürükle-bırak ya da Ctrl+V (kopyalanmış resim) ile resim ekleyin (JPG, PNG, WEBP, HEIC/HEIF, AVIF, GIF, BMP).
2. **Instagram'dan ekle**:
   - Uygulamada **Instagram'dan ekle**'ye basıp gönderi bağlantısını yapıştırın (ya da uygulamanın herhangi bir yerinde Ctrl+V ile bağlantıyı yapıştırın). Gönderi arka planda açılır, resimler alınır, sekme kapanır.
   - Ya da Instagram'da bir gönderiye bakarken sağ alttaki **PDF'e ekle** düğmesine basın.
   - Çoklu gönderilerde tüm kareler alınır; videolar atlanır. Yalnızca sizin görebildiğiniz gönderiler alınabilir.
3. Sırayı değiştirmek için kartları sürükleyin veya **Sırala…** menüsünü kullanın.
4. Bir sayfaya tıklayınca kırpma penceresi açılır:
   - **Dikey / Yatay sayfaya oturt**: kırpma alanı sayfa oranına kilitlenir, resim sayfayı tam doldurur.
   - Serbest, 1:1, 4:3, 3:4, 16:9 oranları; 90° döndürme; kırpmayı sıfırlama.
   - Sağdaki önizleme, sayfanın PDF'te nasıl görüneceğini anlık gösterir.
   - Sayfaya özel yön, yerleşim (Sığdır/Doldur) ve "kenar boşluğu olmasın" seçenekleri.
5. Sağ panelden sayfa boyutu, yön, yerleşim, kenar boşluğu, çözünürlük ve kaliteyi seçip **PDF oluştur**'a basın.

## Dosyalar
- `index.html`, `styles.css`, `app.js`: uygulama
- `manifest.json`, `ext/`: Chrome eklentisi (arka plan, Instagram betikleri, HEIC sandbox sayfası)
- `icons/`: eklenti simgeleri
- `lib/`: Cropper.js (kırpma), jsPDF (PDF), SortableJS (sürükle-bırak), heic2any (HEIC dönüşümü)
