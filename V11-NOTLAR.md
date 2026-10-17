# V11.3 — Ödeme özeti, PDF ürün gamı, anında en iyi fiyat önerisi (+ V11.2 sevkiyat akışı)

## Yüklenecek dosyalar (hepsi aynı klasöre)
app.js, index.html, service-worker.js, version.json, bump-version.sh  
**YENİ:** sevkiyat-veri.js, sevkiyat-kamera.js, sevkiyat-belge.js, **sevkiyat-stil.js**  
sevkiyat.js (yeniden yazıldı). style.css, data/*, Excel makrosu DEĞİŞMEDİ.

Sonra admin panel → Personel → "Eskileri Güncelle".

## Firebase Console'da yapılacak (tek seferlik)
1. Firestore kuralları: `sevkiyatlar` için kullandığınız kuralın aynısını yeni
   **`seriKullanim`** koleksiyonuna da ekleyin (yoksa seri girişi reddedilir).
2. Sevkiyat → 🛠 Yönetici Araçları → "Seri kilitlerini eşitle" butonunu BİR KEZ çalıştırın
   (V10'da girilmiş serileri tek-kullanım kilidine aktarır).

## Excel (isteğe bağlı)
tblUrunler tablosuna **SeriTakip** sütunu ekleyin (E = seri gerekir, H = gerekmez).
Makro tüm sütunları otomatik aktarır, VBA değişikliği gerekmez. Sütun yoksa sistem
SERI_STOK'taki ürün kodlarına bakıp "serisiz olabilir" önerisi gösterir.

## V11.3 — Teklif / ödeme düzeltmeleri
- **Ödeme özeti tek kaynak:** `odemeOzeti()` (app.js) — nakit / proje (❖) / tek çekim / taksit. WhatsApp (ilk gönderim + "yeniden gönder"), satış sözleşmesi, teklif PDF'leri (tekli + toplu), Excel (fatura fiyatları) bunu kullanır. Proje fiyatı (EA+SFS vb.) artık "x undefined Taksit" üretmez; WhatsApp'ta **"Kartlı Ödeme" + Toplam** yazar (kampanya kodu müşteriye gösterilmez). Eski hata: kayıtlı proje teklifi "yeniden gönder"de "Nakit" yazıyordu, Excel toplamı boş çıkabiliyordu.
- **PDF:** ürün kodunun yanında **ürün gamı** ("20300847 · Tv"). Gam sepet satırından alınır; eski tekliflerde ürün listesinden, kod metin olarak karşılaştırılarak bulunur.
- **💳 Anında en iyi fiyat önerisi:** Abaküs panelinin üstünde, sepette ⎇/🔒 kampanyası varsa mevcut "✨ En İyi" motoru önizleme modunda çalışır ve sepet geri yüklenir; daha düşük net nakit mümkünse öneri kutusu çıkar (kazanç, satır bazında indirim). **Öneriyi uygula** ile gerçek seçim yapılır, **Geri al** ile önceki seçimlere dönülür; uygulanana kadar sepet değişmez. Proje (❖) fiyatı motorun kapsamı dışındadır (öneri yalnızca daha düşük net fiyatta çıkar). Firestore okuması/yazması yoktur.

## V11.2 — Yeni akış ve kurallar
**Süreç:** Seri girişi → Teslim (servis yetkilisine / müşteriye) → Çıkış doğrulama ve kapanış.
- "Onayla ve kilitle" kaldırıldı. Seri/ürün düzenlemesi teslim edilene kadar açık; teslimle birlikte kapanır (yönetici "Teslimi geri al" yapabilir).
- **Kapanış** (`teslimEdildi`): seriler.json'dan (diğer programdan günlük push) tüm seriler düştüğünde "Çıkışı doğrula ve tamamla" aktif olur. Seri, Kalan ≤ 0 ya da listede yoksa "çıkış yapıldı" sayılır. Liste yüklenemediyse/boşsa çıkış sayılmaz. Stok verisi gecikmişse yönetici gerekçe yazarak "Yönetici onayıyla tamamla" diyebilir.
- Seri tek-kullanım kilidi (`seriKullanim`) seri girildiği anda alınır (iki sevkiyatın aynı seriyi almasını önler) ve kapanışta kalıcı kalır; yalnızca seri değişirse, ürün değişirse, iptalde veya iadede serbest kalır.
- "Müşteri teslim" adımı: servis teslimlerinde artık "Servis yetkilisine teslim" (teslim alan adı + isteğe bağlı imza). Doğrudan müşteri teslimi planlananlarda "Müşteriye teslim". İmza/ad `servisTeslim` kaydındadır; teslimat belgesi onu basar (eski kayıtlar `teslimEdildi`den okunur).
- Durum adları: **Seri Bekliyor** (depolanan anahtar `barkod_bekliyor` değişmedi), Hazırlanıyor, Depoda Hazır, **Çıkış Bekliyor**, **Tamamlandı**, **İade**, İptal.

**Seri zorunluluğu:** Ürün kodu seriler.json'daki "Stok Kodu"nda varsa serisiz çıkış YAPILAMAZ (serisiz kutusu kaldırıldı; eski "serisiz" işaretleri geçersiz). Kod listede yoksa seri gerekmez, satır otomatik tamam sayılır. Bilinen sınır: bir ürünün tüm seri satırları stoktan düşmüşse kodu da listeden kaybolur ve "serisiz" sayılır.

**Ürün değişimi / ek ürün (teslimden önce):** "Ürünü değiştir" (girilmiş seri silinir ve serbest kalır), "Ürün ekle", "Satırı çıkar" (en az 1 satır kalır). Satış belgesi değişmez; tüm değişiklikler hareket geçmişine ve satırın `degisti` / `ek` / `cikarildi` alanlarına yazılır. Ürün arama ürün listesinden yapılır.

**İade:** Teslim edilmiş (çıkış bekleyen veya tamamlanmış) sevkiyat için "İade / depoya dönüş" (admin + destek): neden zorunlu, depoya geri alındığı onayı; kayıt `iade` durumuna geçer, seri kilitleri serbest kalır. Stoğa geri alma diğer programda yapılır; seri günlük veriyle listeye dönünce yeniden kullanılabilir.

**Liste:** Kartlarda satış no yerine ürünler (seri tamam işareti), not ve çıkış durumu; **aşağı çekince yenileme** (15 sn soğuma; liste = aktif kayıt kadar okuma, detay = 1 okuma); satış formundaki tahsilat alanı **"Teslimat Notu"** oldu (eski kayıtlardaki tahsilat kartı durur); detayda not düzenlenebilir.

**Excel ve müşteri bilgisi:** Sepetteki Excel düğmeleri önce müşteri bilgi formunu açar (ad, TC/pasaport, telefon, telefon 2, e-posta, adres); CSV'nin üstüne "MÜŞTERİ BİLGİLERİ" bloğu yazılır (telefon/TC baştaki sıfır bozulmasın diye `="…"` biçimindedir) ve aynı bilgiler Aksiyon penceresindeki kutulara da işlenir. Sevkiyat detayında "Müşteri bilgilerini kopyala" düğmesi, bilgileri düz metin olarak panoya alır. Sevkiyat kaydına TC, e-posta ve ödeme yöntemi de eklendi (yeni kayıtlarda).

**Değişen dosyalar:** app.js, index.html, service-worker.js, version.json, bump-version.sh, sevkiyat.js, sevkiyat-veri.js, sevkiyat-belge.js, sevkiyat-stil.js. Yeni Firestore alanları: `iade`, kalemlerde `ek`/`degisti`/`cikarildi`; kural değişikliği gerekmez.

## V11.1 — Arayüz ve akış yenilemesi
- **Liste ekranı:** KPI şeridi (Geciken / Bugün / Yarın / Barkod bekleyen / Serviste; dokununca filtreler), arama, servis filtresi, **tarih filtresi** (Tümü, Geciken, Bugün, Yarın, Önümüzdeki 7 gün, Tarih aralığı), durum çipleri, tarihe göre gruplu liste.
- **Geciken = kırmızı:** gecikmiş (teslim tarihi geçmiş, kapanmamış) kartlar kırmızı vurgulu, "N gün gecikti" rozeti, detayda uyarı bandı. Kırmızı yalnızca gecikme / hata / ana eylem için kullanılır.
- **Servis Teslimi / Müşteriye Teslim:** liste sekmeleri ve kayıt başına teslim türü (`teslimTuru`). Eski kayıtlarda atananServis = "Müşteriye Teslim" olanlar müşteri teslimi sayılır. Süreç adımları türe göre değişir (Seri → Depo onayı → [Servis teslimi] → Müşteri teslimi). Tür, detaydan değiştirilebilir.
- **İptal / silme:** iptal yalnızca yönetici; neden zorunlu ("Diğer" için açıklama), servise teslim edilmişse ek onay; iptalde seri kilitleri serbest kalır, **geri alınabilir** (seriler yeniden kilitlenir; başkası kullandıysa reddedilir). Silme yalnızca iptal edilmiş kayıtta, satış no yazdırılarak onaylanır ve **soft-delete**'tir (`silindi` alanı; kayıt veritabanında denetim için kalır, listelerde görünmez). Teslim edilmiş kayıt iptal/silinemez.
- **Seri hatası:** tek satırlık uyarı yerine kurumsal uyarı kartı (kategori, başlık, okunan seri / ait olduğu ürün / satırdaki ürün, "Ne yapmalı?" önerisi). Kamera taramada kart, kullanıcı "Anladım" diyene kadar taramayı durdurur.
- Yeni alanlar: `teslimTuru`, `iptalBilgi {t,u,neden,not}`, `silindi {t,u}` — Firestore kuralı/şeması değişikliği gerekmez.

## V11.0'da değişenler
- Tüm yazmalar transaction: log kaybı yok, kilit/teslim sunucudaki güncel duruma göre doğrulanır.
- seriKullanim kilidi: bir seri yalnızca tek sevkiyatta kullanılabilir (kapanmış olanlar dahil, atomik).
- SERI_STOK `Kalan` denetimi; ayrı hata mesajları (listede yok / başka ürün / çıkışı yapılmış / sistemde kullanılmış).
- Odak + kaydırma korunur; Enter / okutma sonrası sıradaki boş satıra otomatik geçiş.
- Sürekli kamera taramayı: bip + titreşim, tekrar koruması, seriyi ürüne göre doğru satıra otomatik yerleştirme, fener, otofokus, 2x.
- Chrome/Android'de yerel BarcodeDetector; Safari/iOS'ta ZXing (doğrudan canvas).
- 📅 İş Listesi (geciken/bugün/yarın, servise göre) + yazdırılabilir yükleme listesi.
- Yeni sevkiyat sayacı: 4 dakikada bir tek `getCountFromServer` (≈1 okuma), sekme arka plandayken durur.
- Teslimde tahsilat alanı ve "Tahsilat Alındı"; ekranda imza (teslimat belgesine basılır).
- "Serisiz" işaretleyen kişi/zaman kaydı + yönetici filtresi "Serisiz İşaretli".
- Bekleyen yazma rozeti (çevrimdışı kayıtlar için), sevkiyatı olmayan satışlar raporu.

## Bilinen sınırlar
- Seri girişi, kilit, teslim, iptal İNTERNET GEREKTİRİR (sunucuda doğrulanır). Servis/tarih değişikliği çevrimdışı kuyruğa alınır.
- Yetkiler (admin/destek) hâlâ istemci tarafında; Firebase Auth geçişi ertelendi. kullanicilar.json'daki düz metin şifreler açıkta.
- Sepette adet alanı yok (her satır 1 adet); kısmi teslimat/adet ayrı iş olarak bırakıldı.

## Tahmini ek Firestore maliyeti (Spark limitleri içinde)
Seri girişi: +1 okuma +1–2 yazma. Kilit/teslim/iptal: +1 okuma. Sayaç: 4 dk'da 1 okuma/cihaz (yalnızca admin+destek).

## V11.4 — ÜRÜNLER 💳 (Quick Finance) anında en iyi fiyat
- Ürün sepete girmeden, tek başına alınırsa uygulanabilecek en düşük nakit fiyat hesaplanır (sanal sepet + mevcut "En İyi" motoru; gerçek sepete dokunulmaz). ❖ proje fiyatı (eşik=1) daha düşükse o gösterilir.
- Öneri kutusu: "Bu fiyatla hesapla" → tek çekim/taksit/kredi tabloları kampanyalı fiyattan hesaplanır; "Liste fiyatı" ile geri dönülür.
- Sepete ekle / ödeme ekranı: öneri uygulanmışsa seçilen kampanya yeni satıra otomatik işlenir.
- Grup kampanyaları (eşik≥2) tek ürünle oluşmaz → "Birlikte alınırsa: IKILI (2 ürün) −12.500 ₺" bilgi notu.

## V11.5 — Geri tuşu, kod temizliği, çıkış doğrulama
- **Geri tuşu (tüm uygulama):** artık uygulamadan çıkmaz. Sıra: diyalog/kamera → sevkiyat detayı → sevkiyat listesi → açık pencere (sepet, abaküs, teklifler, admin, 💳…) → Trendler → Ürünler. Ana ekranda geri: "Çıkmak için tekrar geri basın"; 2 sn içinde ikinci geri çıkışa izin verir. (app.js sonundaki "GERİ TUŞU YÖNETİCİSİ"; sevkiyat.js `Sevkiyat.geri()/derinlik()` köprüsü.)
- **Çıkış doğrulama:** "Çıkışı doğrula ve tamamla" artık pasif değil; basınca stok verisini yeniler, hazırsa tamamlar, değilse hangi serilerin hâlâ stokta göründüğünü uyarıyla gösterir. Yöneticiye "Yönetici onayıyla tamamla" (gerekçeli), diğer kullanıcıya "yöneticiye başvurun" notu.
- **Kod temizliği:** 18 kullanılmayan fonksiyon silindi; 16 kullanılmayan değişken, çift anahtarlar (son7Logs, gosterimLabel) kaldırıldı; boş catch bloklarına açıklama eklendi.
- **Hata düzeltmeleri:** `liderSatis` tanımsız referansı (Performansım → Tam sıralama); `renderStokUyari`, `refreshProposals`, `refreshAdminPanel`, `adminRunJanitor` HTML'den çağrılıyordu ama window'a açık değildi (tıklayınca hata verirdi).

## V11.6 — Sevkiyat: silme, satır kamerası, rapor, otomatik kapanış, seri iadesi
- **Seçerek sil (yönetici):** listede ✓ düğmesi → kartları işaretle → "Sil" (neden zorunlu). Kayıt `silindi` olur (durum=silindi, kapali=true), seri kilitleri serbest kalır, denetim için saklanır. Tamamlanmış (çıkışı doğrulanmış) kayıt silinemez; iade kaydı açılır. Detay ekranındaki "Kaydı sil" artık iptal şartı aramaz.
- **Satır kamerası:** her seri satırında 📷. Aynı üründen birden fazla boş satır varsa rozet (adet) gösterilir; tarama tıklanan satırdan başlar, aynı ürünün boş satırlarını sırayla doldurur, bitince kapanır. Başka ürünün serisi reddedilir. Dolu satırda 📷 seriyi yeniden okuyup değiştirir.
- **Rapor:** liste başlığındaki 📄 → teslimat tarihi aralığı (en çok 62 gün, tek sorgu ≤1500 kayıt) → CSV (Excel ile açılır): tarih, müşteri, telefon, ürün, seri, durum, teslim eden/alan, çıkış doğrulama. Tüm kullanıcılar alabilir.
- **Otomatik çıkış doğrulama:** liste açılışında/yenilemede, teslim edilmiş sevkiyatların tüm serileri seriler.json'dan düşmüşse kayıt otomatik kapanır (teslimEdildi.dogrulama='otomatik', u='sistem'); elle onay gerekmez. Güvenlik: stok verisi önceki yüklemenin %50'sinden fazla küçülürse otomatik kapanış durur (uyarı gösterilir). Elle yol: "Stok verisini şimdi kontrol et" / yönetici onayı.
- **Seri iadesi:** kapanmış sevkiyattaki seri stokta yeniden görünürse (iade/transfer), yönetici seriyi başka sevkiyata girerken "Seri stokta yeniden göründü" diyaloğuyla yalnızca o seriyi iade edip serbest bırakabilir (`kalemler.N.seriIade`); önceki sevkiyat ve diğer seriler değişmez. İade/silinmiş kayıtlar ve iade edilmiş seriler artık yerel çakışma kontrolüne takılmaz.

## V11.7 — Sevkiyat düzeltmeleri (saha geri bildirimi)
- **Durum etiketi:** teslim edilmiş kayıt artık "Servis Teslim" (müşteri teslimi: "Müşteriye Teslim"); "Çıkış Bekliyor" kaldırıldı. Filtre: "Teslim Edilen". Çıkış doğrulama süreç adımı olarak kalır (otomatik).
- **Hata (kritik): birden fazla üründe biri stoktan bitince diğerine seri girişi kapanıyor, kayıt "1/2" ile tamamlanıyordu.** Neden: "seri gerekir" kararı yalnızca anlık seriler.json'a bakıyordu; stoğu biten seri takipli ürünün kodu listeden kaybolunca ürün "serisiz" sanılıyordu. Çözüm: ürün kodları kalıcı kaydedilir (`seriKullanim/__takipliKodlar` + yerel yedek; ayrıca seri girilmiş her kalemin kodu öğrenilir). Ürün tablosuna `SeriTakip` (E/H) sütunu eklenirse o öncelikli olur. Stokta seri görünmeyen takipli ürün satırında uyarı çıkar, seri girilmeden teslim edilemez; yönetici gerekçeyle "Seri gerekmez yap" diyebilir.
- **Mobil:** filtre alanı küçük ekranda listeyi örtüyordu (İptal/İade/Tamamlanan "boş" görünüyordu). Filtre artık mobilde sabit değil ve filtre seçilince liste başına kaydırılır. Üst başlık düğmeleri küçültüldü.
- **Kapanmış kartlar:** tüm ürünler + seri numaraları + kapanış zamanı (Tamamlandı/İade/İptal · tarih saat). Otomatik kapanışta bildirim "Tamamlananları göster" düğmesiyle ilgili listeye götürür.

## V11.8 — Okuma tasarrufu + teslimat saati + servis mesajı
- **Firestore okuma (günlük ~35-45K → hedef <20K):** önbellek 4→15 dk; personel için `sales` hiç çekilmez (yalnız yönetici istatistiği kullanıyor); personel teklif/sipariş `limit 150` (yönetici 300); analytics yönetici 45 gün / personel 30 gün; `fiyat_bakislari` limit 1500; `vitrin` canlı dinleyici yerine 30 dk önbellekli çekim (ekle/sil/aç-kapa sonrası anında yenilenir).
- **Teslimat saati:** serbest saat yerine dilimler. Eski kayıtlardaki "14:30" gibi değerler korunur ve görünür.
- **Servis mesajı:** detay › Belgeler ve iletişim › "Servise mesaj (kopyala)". Panoya kopyalar, "WhatsApp'ta aç" düğmesi verir. Biçim: 📦 servis / MÜŞTERİ / telefonlar ⎇ / 📍 adres / > tarih, dilim - satış noktası Satışıdır / 🛍️ / ürün kodları.

## V11.9 — Depo, tanımlar, arşiv penceresi
- **Ürün başına depo:** detay › Ürünler ve seri numaraları › her ürünün altında "Depo" seçimi (TÖ Depo, Nf Depo, Nf Mağaza, Sp Mağaza, Vş Mağaza, SÇ Mağaza varsayılanları). Yeni kayıtlarda (`depoZorunlu`) depo seçilmeden servise teslim edilemez; eski kayıtlar etkilenmez. Değişiklik hareket geçmişine yazılır; kartlarda ürün yanında depo görünür, listede "Tüm depolar" filtresi var; depo fişinde Depo sütunu, yükleme listesinde [depo] etiketi.
- **Tanımlar (yönetici araçları):** servis, depo, satış noktası listeleri ekle/yeniden adlandır/sil. Belge: `meta/sevkiyatTanimlar` (Firestore kuralı: giriş yapmış herkes okur, yalnız yönetici yazar). Cihazlarda 30 dk önbellek. Eski kayıtlar eski adı korur.
- **Toplu değiştir:** teslim edilmemiş açık kayıtlarda depo A → B veya servis A → B (kayıt başına log).
- **Tamamlanan / İptal / İade:** artık "son 7 gün" (varsayılan), "son 30 gün" veya "Arşiv: tarih aralığı"; 30'ar kayıt sayfalama. Silme/taşıma yok; eski kayıtlar yalnız istenince okunur.
- **Servis mesajı:** servis adı `…` içinde, ürün satırı "kod - depo".
