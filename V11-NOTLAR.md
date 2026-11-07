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

## V11.10 — Personel görünürlüğü, Müşteri sorgula, depo yetkisi
- **Personel tüm açık sevkiyatları görür** (önceden yalnız kendi satışları). Okuma: açık kayıt sayısı kadar, personel için 5 dk önbellek. Kapanmış listeler personelde yalnız kendi kayıtları; başkalarınınki "Müşteri sorgula" ile. "Sadece benim satışlarım" filtresi eklendi.
- **Müşteri sorgula** (sevkiyat başlığındaki 🔍): telefon (her biçim), ad (baş harfler) veya SAT-no → sevkiyat + sevkiyatsız eski satış + teklif. Gizli (🔒) teklifler gösterilmez. Yalnız eşleşen belgeler okunur (arama başına ≈ 5–30 okuma). Yeni kayıtlara `telNorm` (10 haneli telefon) eklenir; eski kayıtlar telefon biçim varyantlarıyla bulunur.
- **Depo seçimi** satış personeline açıldı (kendi/başkası; teslim edilmemiş kayıtta). Seri girişi, teslim, iptal yetkisi değişmedi.
- Firestore: `where(...,'in',...)`/aralık sorguları tek alan olduğundan yeni bileşik dizin gerekmez.

## V11.11 — Ürün bazlı teslim, imza, serisiz ürün netliği
- **Ürün bazlı teslim şekli:** her ürün satırında "Servis götürür / Müşteri alır". Aynı sevkiyat kaydında iki teslim grubu olabilir; her grubun kendi teslim paneli, **teslim alan**, **imza**, zaman ve "Teslimi geri al" (yönetici) düğmesi vardır. Veri: `kalemler.N.teslimSekli`, `teslimler.servis|musteri = {t,u,alan,imza}`. Tüm gruplar teslim edilince eski `servisTeslim` alanı da yazılır; çıkış doğrulama / otomatik kapanış / raporlar bu alanla aynen çalışır. V11.10 ve öncesi kayıtlar (tek `servisTeslim`) değişmeden doğru okunur.
- **Yeni durum "Kısmi Teslim":** bir grup teslim edildi, diğeri bekliyor. Liste kartında iki rozet (servis ✓ / müşteri alır), filtre "Teslim Edilen" altında da görünür.
- **Müşteri alır → imza zorunlu** (+ teslim alan adı). Servis grubunda imza isteğe bağlı kalır.
- **Seri anında alınır:** serili ürünün serisi okutulmadan o ürünün grubu teslim edilemez (hem ekranda hem sunucu tarafı transaction'da). Panelde eksik ürünler adıyla listelenir, "Seri okut" düğmesi kamerayı açar.
- **Serisiz ürünler göz ardı edilmez:** her ürün satırında durum rozeti ("Serisiz ürün · teslim bekliyor" / "Teslim edildi · ad"), teslim panelinde ayrı satır, seri girişi panelinde adedi.
- **Düzeltilen hata ("Müşteriye teslim: Beklemede"):** teslim paneli tüm kayda tek idi; başka bir ürünün serisi eksikken serisiz ürün de "Beklemede" kalıyordu. Artık her grubun kendi ürünleri hazır olunca teslim edilebilir; hazır değilse nedeni ürün adlarıyla yazılır. Teslim edilen ürünün satırı kilitlenir (seri, depo, değiştirme).
- **Ürün değişimi / ek ürün:** yeni ürün seri aramaya devam eder (seri sıfırlanır, eski seri serbest kalır; ürün seri-takipliyse yeniden seri ister). Seri-takip kararı kod `seriler.json`'da (ya da daha önce görüldüyse / `SeriTakip=E`) ise "gerekir"; hiç görülmemiş koda sahip ürün serisiz sayılır (yönetici "Seri gerekmez yap" / ürün tablosunda `SeriTakip` E/H ile kontrol edilir). Teslim edilmiş grubun ürünü değiştirilemez / çıkarılamaz. Yeni eklenen ürün, teslimi yapılmamış bir gruba girer.
- **Çıktılar:** servis mesajı yalnız servisin götüreceği ürünleri içerir, müşteri alacaklar için `⚠️ Müşteri kendisi alacak` satırı eklenir; yükleme listesinde karma kayıt iki yerde (servis / "Müşteriye Teslim") görünür; depo fişi ve teslimat belgesinde "Teslim" sütunu, her grup için ayrı teslim alan + imza bloğu; raporda ürün satırı kendi teslim şeklini ve teslim alanı yazar.
- **Hata düzeltme:** satış personelinin depo seçme yetkisi bu sürümde korunur.


## V11.12 — Sadeleştirme
- "Teslimat bilgileri › Tüm ürünler için teslim şekli" kaldırıldı; teslim şekli yalnız "Ürünler ve seri numaraları" içinde her ürün için seçilir (yeni kayıtlar form seçimiyle başlar).
- Servis mesajındaki müşteri satırı: "Müşteriye teslim edilmiştir: <ürün kodları>".

## V11.13 — Peşin + parçalı ödeme, fiyat bilgisi, PDF avantajları
- **Ödeme Seçenekleri (Abaküs):** yeni "Peşin ödenen (nakit / EFT · komisyonsuz)" kutusu + Nakit / EFT / Teslimde alınacak seçimi + %25 / %50 / Temizle. Peşin düşüldükten sonra yalnızca kalan tutara kart komisyonu / kredi vade farkı uygulanır; "en iyi fiyat" ve kart/kredi tabloları kalan tutarı gösterir ("Kart Tutarı"). Kutu boşsa davranış eskisi gibidir.
- **Müşteri çıktıları (PDF, WhatsApp, teklif):** peşin + kart/taksit ayrı satırlar; **nakit eşdeğeri ve vade farkı hiçbir müşteri belgesinde yer almaz** (ürün fiyatları eskisi gibi komisyon yedirilmiş dağıtılır; peşinli satışta ürün başı taksit sütunu gizlenir).
- **PDF "Size Sağlanan Avantajlar" kutusu:** uygulanan kampanyalar (ürün pill'leri, ❖ proje fiyatı) + ürün / ek / pazarlık indirimleri + toplam indirim.
- **Satış kaydı:** `fiyat` bloğu (ürün başına liste / indirim / net / kampanya, net nakit değeri, ödeme, **vade farkı**) satışa ve sevkiyat kaydına yazılır. Sevkiyat detayında "Satış / fiyat" kartı (yalnız personel); "Müşteri + fiyat bilgisini kopyala" artık fiyat ve ödeme satırlarını da verir. Peşin "Teslimde alınacak" ise sevkiyat notuna otomatik "Teslimde nakit tahsil edilecek: X" yazılır. Eski kayıtlarda yalnızca ödeme metni görünür.

## V11.14
1. **Satışı onayla → sevkiyat detayı.** Sepet sonrası satış ekranından "Teslimat Bilgisi" bölümü kalktı; buton "✅ Satışı Onayla". PDF penceresi açılmaz; sevkiyat kaydı varsayılanlarla (bugün · servis götürür) açılır ve doğrudan o sevkiyatın detayına gidilir. Tarih/saat/servis/satış noktası/not detaydaki "Teslimat bilgileri"nden girilir. Satış sözleşmesi PDF'i detaydaki "Belgeler" bölümünde (bu cihazda üretilen satışlar için).
2. **Yetki düzeltmesi.** "Servis götürür / Müşteri alır" seçimi ve teslimat planı (tarih, saat, servis, satış noktası, not) satış personeli dahil herkes için açık; seri girişi, depo, teslim ve diğer depo işlemleri yine admin/destek.
3. **Peşin ödenen kutusu** yeniden tasarlandı (CSS artık index.html içinde — önceki sürümde stil pakete girmemişti).
4. **En İyi uyarısı.** Teklif Taslağı'nda en iyilenecek kampanya varken uygulanmadıysa sarı uyarı bandı + "En İyi" düğmesi vurgusu; "Ödeme Seçenekleri"ne basınca "En İyi'yi uygula ve devam / Yine de devam / Vazgeç" penceresi. Optimize edilecek bir şey yoksa uyarı çıkmaz.

## V11.15
- Peşin ödenen kutusu varsayılan olarak tek satır ("Peşin ödeme var mı? ＋"); dokununca açılır, peşin girilince/%25-%50 seçilince kendiliğinden açık kalır, Temizle ile kapanır. Kapalıyken özet satırı peşin tutarı ve kalanı gösterir.

## V11.16
- **Servise mesaj (kopyala)** markaya göre bloklanır: `VESTEL` / `SAMSUNG` … Her blokta müşteri, telefon, adres, teslim satırı, `_not_` ve 📦 altında ürün gamı + "• Kod - Depo". Seri girilmesi gerekmez (buton zaten her zaman aktif). Müşterinin kendisi aldığı ürünler mesajda yer almaz (“Müşteriye teslim edilmiştir” satırı kaldırıldı).
- Marka ve ürün gamı sevkiyat kaydı açılırken ürün kalemine yazılır; eski kayıtlarda mesaj anında ürün listesinden okunur.
- **"Teslim edecek servis" (atanan servis) kaldırıldı**; teslim için servis seçimi zorunlu değil. Eski kayıtlarda atanmış servis adı salt okunur görünür.

## V11.17
- **Marka → servisler tanımı** (Yönetici Araçları → Tanımlar → "Markalar ve servisleri"): örn. Vestel: Barel, Can, Pazarcık · Samsung: İl servisi, İlçe servisi. Servisleri virgülle ayırın; marka ekle/sil.
- **Ürün satırında isteğe bağlı "Götüren"**: ürün "Servis götürür" iken, ürünün markasının servisleri küçük seçenekler olarak çıkar (aynı ada tekrar basınca seçim kalkar). Müşteri alır / markada servis tanımı yoksa gösterilmez. Seçilmezse uyarı vermez; teslim şekli ve imza akışı değişmez. Satış personeli de seçebilir.
- Kayıt kartında servis adları etiket olarak görünür; liste filtresindeki "Tüm servisler" listesi tanımlı servisleri kullanır ve kayıtlardaki servis adına göre süzer. Toplu değiştir → Servis de ürün bazlı servis adlarını taşır.
- Servis teslim kaydına götüren servis adları (`srv`) yazılır; depo fişinde "Teslim" sütununda servis adı görünür; yükleme listesi servis adına göre gruplanır.
- Sonradan eklenen / değiştirilen ürünlerde marka ve ürün gamı da kayda yazılır (servis mesajı ve servis seçimi için).

## V11.18
- **Hata düzeltmesi:** "Ürünü değiştir / Ürün ekle" aramasında ürün adı yerine kod yazılıyordu (ürün listesindeki "Ürün" sütunu bulunamıyordu). Düzeltildi. Kodla kaydedilmiş eski kalemler de ekranda ürün adıyla görünür (kayıt değişmez).

## V11.19
- **Ürün satırı yeniden düzenlendi (detay):** büyük ürün adı → tek özet satırı (`kod · depo · 🚚 Servise · Barel` / `👤 Müşteri alır`) → Teslim düğmeleri + Götüren → Depo kutusu → Seri kutusu → durum etiketi. Götüren ve teslim şekli seri girilmeden önce seçilebilir.
- **Depo kutusu:** "Depo *" etiketi kalktı; kutu seri kutusuyla hizalı, boşken gri "Depo seçiniz" yazar (zorunluyken sarı çerçeve).
- **Yeşil onay:** yalnızca seri okutulunca ya da ürünün grubu teslim edilince yeşil olur; serisiz ürün gri "Serisiz ürün · teslimde onaylanır" etiketi alır. Sayaç "x/y seri" (serili ürün yoksa "Seri yok"); "Seri girişi" adımı serisiz kayıtlarda "Gerekmiyor" görünür.
- **Sevkiyat Yönetimi liste kartı:** her ürünün altında aynı özet satırı (kod · depo · servis/müşteri); 4 ürüne kadar gösterilir.

## V11.20 — Performans ve kaynak temizliği (denetim)
- Ürün arama: her ürünün arama metni bir kez normalize edilip saklanıyor (eskiden her tuşta 828 ürün × kelime sayısı kez yeniden). Satır çiziminde `indexOf` yerine tek geçişli indeks haritası, sütun anahtarı önbelleği; Android'de 90 ms gecikme.
- `urunBul` (seri kuralı her kalem/ekran çiziminde çağırıyor): doğrusal tarama yerine Map.
- Çıkışta kapanmayan dinleyiciler kapatıldı (live_baskets, kendi oturum belgesi, admin oturum listesi); heartbeat ve MOTD zamanlayıcısı durduruluyor.
- Admin oturum dinleyicisi tekrar girişte çoğalmıyor.
- Oturum heartbeat: 60 sn → 3 dk, arka planda yazmıyor (eşik 2 dk → 6 dk).
- urunler.json yoklaması arka plandaki sekmede çalışmıyor.
- Sekmeye dönünce Firestore bağlantısı yalnızca 60 sn'den uzun arka plandan sonra yenileniyor.
- Greedy kampanya döngüsüne 500 tur emniyet sınırı.

## V11.21 — Kısmi teslim + hafif veri yoklaması
- **Ürün/adet bazlı kısmi teslim:** her ürün satırı (aynı üründen çok adet = ayrı satırlar) ayrı teslim edilebilir. Teslim panelinde "bu teslimde olanlar" işaretlenir; seri okutulmamış satırlar sonraki teslime kalır. Her parti kendi teslim alan/imza/zaman kaydını taşır (Teslimat Belgesi'nde parti başına imza bloğu). Grubun tüm satırları bitince grup, tüm gruplar bitince çıkış doğrulama hattı otomatik açılır. Teslim edilen satır kilitlenir; yönetici "Teslimi geri al" ile açabilir. Eski (grup bazlı) kayıtlar aynen çalışır.
- **json yoklaması:** `urunler.json` ve `seriler.json` artık cache-buster'sız `no-cache` ile istenir (service worker `no-store`→`no-cache`). Dosya değişmediyse sunucu 304 döner, gövde inmez; ETag/Last-Modified aynıysa ayrıştırma da atlanır. Değişince tam iner (veri her zaman taze).

## V11.22 — Admin paneli
- **Sipariş notları:** "Tamamlandı" ve silme artık anında (iyimser) yansır; Firestore yazması arkada biter, hata olursa geri alınır ve uyarı verilir. Neden: canlı dinleyici kaldırıldığından yazma başarılı olsa da ekran 15 dk önbellekten eski görünüyordu. "Tümünü sil" sıralı silme yerine 400'lük toplu yazma. Sipariş sekmesi önbellek 2 dk'dan eskiyse otomatik tazelenir.
- **Personel performansı / kullanıcı listesi / indirim raporu:** kullanicilar.json'daki güncel e-postalarla süzülür (kaldırılan kişinin eski teklif/satış/analytics kayıtları artık listede görünmez; kayıtlar silinmez, sadece gizlenir).
- **Excel'den kaldırılan kullanıcı:** "Beni hatırla" ile açık kalmış oturum, uygulama açılışında kullanıcı listesinde yoksa sonlandırılır.
- Admin özet ekranındaki sabit 1,2 sn bekleme kaldırıldı (gerçek yüklemeyi bekler). oranlar.json koşullu istekle (304) çekilir.

## V11.23 — Mağaza ön tanımı
- Yeni dosya `sevkiyat-magaza.js` (bump-version.sh ve service worker listesine eklendi).
- Giriş sonrası tek soru: satış → "Hangi mağazadasınız?", destek (depo) → "Hangi depodasınız?", admin → soru yok. Liste, sevkiyat tanımlarındaki depo adlarından gelir ("Depo" ile bitenler depo, diğerleri mağaza); ekleme/çıkarma mevcut tanım ekranından.
- Seçim kullanıcı+cihaz bazında localStorage (`svk_magaza_<eposta>`), çıkışta silinmez. Üst barda "📍 Sp Mağaza ▾" etiketi; dokununca değiştirilir.
- Mağaza adının ilk kelimesi satış noktası koduyla eşleşirse (Sp→SP, Vş→VŞ…) yeni sevkiyatın satış noktası otomatik dolar.
- Sevkiyat listesi: mağaza kullanıcısında "📍 Sp Mağaza" çipi (varsayılan açık; kapatınca Tümü). Satış noktası boş eski kayıtlar süzgeçle gizlenir, Tümü'de görünür. Depo kullanıcısında "Tüm depolar" filtresi seçili depoyla açılır.
- Süzgeç düzen içindir, güvenlik değildir (Firebase Auth yok).
- Test: Playwright ile seçim akışı, rol farkları, hatırlama, satış noktası eşleşmesi, liste süzgeci (taklit veriyle). Gerçek sunucuda doğrulanacak.

## V11.24 — Mağaza → Depo Talep modülü
- Yeni dosya `sevkiyat-talep.js` (bump-version.sh + service worker listesine eklendi). Alt barda yeni **📦 Talepler** sekmesi + rozet (depo: bekleyen, mağaza: yoldaki, yönetici: bekleyen; 2 dk'da bir `getCountFromServer`).
- Akış: **Bekliyor → Yolda → Teslim alındı** (+ İptal). Firestore koleksiyonu `talepler`; belge kimliği zamanla ters sıralı (en yeni önce) → bileşik indeks gerekmez. Liste `getDocs` (limit 100, 60 sn TTL), canlı dinleyici yok. Durum değişiklikleri `runTransaction` ile (iki kişi aynı anda işlem yapamaz).
- Mağaza: depo seç (son seçim hatırlanır), ürün ara ya da **serbest yaz (sarf)**, +/− adet, Gönder. Mağaza seçili değilse (yönetici) mağaza listeden seçilir.
- Depo: seri takipli kalemde seri yaz/kamerayla okut (`seriDogrula`: stokta yok / başka ürün / çıkmış / aynı talepte tekrar); stok azsa adedi düşür; tüm seriler girilmeden "Yola çıkar" açılmaz.
- Mağaza teslim alır: serili kalemde seri başına onay kutusu, serisizde adet −/+; eksik kayda geçer.
- **Yoldaki seri kuralı:** yolda bir talepte olan seri sevkiyatta/satışta kullanılırsa "Bu seri şu an yolda" uyarısıyla engellenir (`yoldaSeri`, 3 dk TTL; talep kapanınca serbest). Seri kilidi (seriKullanim) kullanılmaz.
- Yetki: mağaza kendi mağazasının taleplerini (arkadaşlarınkini de) görür; yalnızca kendi açtığı bekleyen talebi iptal eder. Depo yalnızca kendi deposunu görür. Yönetici hepsini görür, iptal/sil. (İstemci tarafı süzgeç; güvenlik değildir.)
- **Firestore kuralları:** `talepler` koleksiyonu için okuma/yazma izni konsoldan eklenmelidir (`seriKullanim` gibi).
- Bilerek yok: tarih, not, imza, çift doğrulama, kısmi teslim ekranı, onay basamakları, talep raporu (Excel).
- Test: Playwright + bellek içi Firestore taklidiyle uçtan uca (iste→hazırla→yola çıkar→teslim al, yanlış/tekrar seri, stok az, yoldaki seri engeli, teslimden sonra serbest kalma). Gerçek sunucuda doğrulanacak.

## V11.25 — Talep: tüm roller talep açabilir
- "＋ Yeni talep" yalnızca admin'e görünüyordu (depo/destek kullanıcıda yoktu); artık satış, destek (depo) ve yönetici açabilir.
- Depo kullanıcısı mağaza adına açar: "Hangi mağaza adına?" listesinden seçer, hedef depo varsayılan olarak kendi deposudur. Satış kullanıcısında mağaza seçili mağazadır (seçili değilse listeden seçer).
- Test: destek ile talep açma (mağaza seçmeden gönderim engeli dahil) eklendi; önceki 16 kontrol de geçti.

## V11.26 — Talep: teslim alma tüm kullanıcılara açık
- "Teslim aldım" yalnızca satış rolü + yöneticiye çıkıyordu; depo (destek) kullanıcısı göremiyordu. Artık yolda olan talebi gören herkes (mağaza çalışanları, gönderen depo, yönetici) teslim alabilir; kayıtta teslim alan e-posta + zaman tutulur.
- "＋ Yeni talep" da rol şartından bağımsız (oturum açmış herkes).
- Test: gönderen depo kullanıcısında "Teslim aldım" görünür (toplam 21 kontrol geçti).

## V11.27 — Talep: tek dokunuş
- "Yola çıkar" → **"Gönder"**; "Yola çıkarılsın mı?" ve "Teslim alındı mı?" onay kutuları kaldırıldı. Yalnızca eksik gönderim/eksik teslimde tek satırlık onay sorulur.
- Seri takipli kalemde seri girişi depoda zorunlu kalır (ana programda işlem için). Yolda durumu, seri kaydı ve rozet aynen duruyor.

## V11.28 — Talep: seçerek silme + Excel raporu
- **Seçerek silme (yalnızca yönetici):** Talepler listesinde ☑ düğmesi → kartlara dokunarak seç, "Tümünü seç", "🗑 Sil". Kalıcı silme (`writeBatch`, 400'lük parçalar); silinen talebin yoldaki serileri serbest kalır. Detaydaki "Yönetici: sil" da aynı kalıcı silmeyi kullanır. (Köprüye `deleteDoc`, `writeBatch` eklendi.)
- **Talep raporu (📄):** tarih aralığı (varsayılan son 30 gün) + "iptalleri ekle"; Excel'de açılan CSV (`;` ayraçlı, UTF-8 BOM). Her satır bir kalem: talep tarihi, mağaza, depo, isteyen, durum, ürün kodu/adı, tür (ürün/sarf), istenen/gönderilen/teslim edilen adet, seri no, gönderen+zamanı, teslim alan+zamanı, hazırlama ve toplam süre. Herkes kendi görebildiği talepleri raporlar (mağaza→mağazası, depo→deposu, yönetici→hepsi); en yeni 1000 talep taranır.
- **Firestore kuralları:** `talepler` için `delete` izni de gerekir (yalnızca yönetici için daraltılabilir; kurallar kullanıcı kimliğini bilmediği için istemci süzgecidir).
- Test: Playwright + bellek içi Firestore taklidi (seçerek silme, yetki görünürlüğü, rapor içeriği).

## V11.29 — Güvenlik Aşama 1: Firebase Auth (paralel)
- **Giriş:** önce `signInWithEmailAndPassword`; başarılıysa şifre Auth'ta doğrulanır (profil/rol yine `kullanicilar.json`'dan). Auth'ta kullanıcı yoksa/şifre uymazsa **eski giriş aynen çalışır** (geçiş dönemi; V9 ve henüz aktarılmamış kullanıcılar etkilenmez). "Beni hatırla" işaretliyse Auth oturumu kalıcı, değilse oturum sekmesiyle sınırlı. `localStorage.aygun_authmode=1` Auth ile girildiğini işaretler; Auth belirteci kaybolursa yeniden giriş istenir. Çıkışta ve "listeden kaldırılan kullanıcı"da `signOut`.
- **İlk giriş şifresi:** `kullanicilar/{eposta}.sifreDegistir === true` ise giriş sonrası "Yeni şifrenizi belirleyin" penceresi (en az 8 karakter, `updatePassword`), sonra bayrak `false`.
- **`guvenlik/kullanici-esitle.js`** (Admin SDK, kendi bilgisayarda): json → Auth + `kullanicilar/{eposta}` (yeni kullanıcıya rastgele geçici şifre → `sifreler-gizli.csv`; `--kapat` listede olmayanları devre dışı bırakır; `--sifirla e-posta` tek kişiye yeni geçici şifre).
- **`guvenlik/firestore-kurallari-ASAMA-A.rules`** (taslak, canlıya alınmadı): yeni koleksiyonlar (sevkiyatlar, seriKullanim, talepler, meta/sevkiyatTanimlar) girişli+rollü; V9'un kullandığı eski koleksiyonlar geçici açık (ay sonunda kapatılacak). Rules Playground'da denenmeden yayınlanmamalı.
- Sınır: mağaza bilgisi şu an kullanıcı seçimi (localStorage); "mağaza yalnız kendi talebi" kuralı için sunucuda profilde `Magaza` tutulması Aşama B'de.
- Test: sevkiyat/talep testleri geçti, eslint temiz. Giriş akışı gerçek Firebase gerektirdiği için canlıda doğrulanacak.

## V11.30 — Şifre alanları bellekten/localStorage'dan çıkarıldı
- `currentUser` ve `localStorage.aygun_user` içinden `Sifre`, `SifreHash`, `Hash` silinir (mevcut kayıtlar açılışta temizlenir); doğrulama yalnız giriş anında listeden yapılır. Admin paneli konsol logu artık yalnız e-posta yazar.
- Kural taslağı (Aşama A) güncellendi: korunan koleksiyonlar (kullanicilar, sevkiyatlar, seriKullanim, talepler, meta/sevkiyatTanimlar) DIŞINDAKİ her şey bugünkü gibi açık kalır → V9 hangi koleksiyonu kullanırsa kullansın bozulmaz.

## V11.31 — Güvenlik Aşama B1: yalnız Firebase Auth girişi (V9 emekli)
- **Eski giriş kaldırıldı:** giriş yalnız `signInWithEmailAndPassword`; hata mesajları (hatalı şifre / çok deneme / hesap kapalı / bağlantı yok). Profil/rol `kullanicilar.json`'dan (şifresiz) alınır; listede yoksa "yetki tanımlı değil". Auth'suz kalan eski oturumlar (`aygun_authmode`≠1) açılışta sonlandırılır.
- **`MakroExcell-V11.31.vba`:** `tblKullanicilar` dışa aktarımında Sifre/SifreHash/Hash sütunları yazılmaz; JSON'da şifre kalmışsa gönderim durur.
- **Kural B (`firestore-kurallari-ASAMA-B.rules`):** girişsiz erişim yok; giriş+profil olan herkes okur/yazar; yönetici: kullanıcı profilleri, talep silme, sevkiyat tanımları, vitrin, kayan yazı.
- **Betikler:** `yedek-al.js` (Firestore yedeği), `kullanici-esitle.js --tumunu-sifirla`. Kılavuz: `GECIS-KILAVUZU-V11.31.md`.
- Test: sevkiyat/talep testleri + eslint. Giriş ve kurallar gerçek Firebase gerektirdiği için canlıda doğrulanacak.

## V11.32 — Satış personeli kendi satışında seri / ürün / TESLİM işleri
- Neden: mağazadan teslimat yapan satış personeli seri girip teslim edebilmeli (V11.31'de yalnız admin+destek yapıyordu; tasarım gereğiydi).
- `sevkiyat-veri.js`: yeni `seriYetkili(s)` = `depoYetkili()` VEYA (rol `satis` ve `s.satici` == kendi e-postası). `depoYetkili` değişmedi.
- `sevkiyat.js`: `duz = seriYetkili(s) && !s.kapali` (seri girişi, ürün değiştir, ürün ekle, seri okut, teslim, çıkış doğrula). Tıklama koruması: satış için yalnız `tara`, `kalemekle`, `kalemdeg`, `teslim`, `cikisdogrula` geçer; seri kutusu `change` olayı `seriYetkili`ye açık; "Satırı çıkar" düğmesi yalnız depoYetkili'de görünür.
- Satış için KAPALI kalanlar: tahsilat, iade, satırı çıkar, otomatik kapanış, teslimi geri al / çıkış zorla / "Seri gerekmez yap" (yönetici). Çıkış doğrulama zaten seriler.json verisine bağlı (seri stoktan düşmeden tamamlanmaz).
- Firestore Kural B sevkiyatlar/seriKullanim yazımına profili olan herkese izin verdiği için kural değişikliği gerekmedi. Satış personeli yalnız kendi satışlarını görür (`satici`), başkasının satışında yetki yok.
- Test: eslint no-undef temiz, `test/run.js` 10/10, `seriYetkili` birim testi geçti. Ekran düzeyinde canlı doğrulama bekliyor (özellikle satış hesabıyla: seri gir → teslim → çıkış doğrula).
- Değişen dosyalar: app.js, index.html, service-worker.js, version.json, sevkiyat.js, sevkiyat-veri.js, sevkiyat-belge.js, sevkiyat-magaza.js, sevkiyat-talep.js (sürüm damgası).

## V11.33 — Kullanıcı profili Firestore'dan + panelde kullanıcı yönetimi
- **Tek doğruluk kaynağı:** `kullanicilar/{eposta}` (Rol, MagazaTipi [AVM|CARSI], SepetTipi [NakitFiyat|CokluFiyat], Istisna, Ad, Kilitli, sifreDegistir). Giriş sonrası profil Firestore'dan okunur (1 okuma); `kullanicilar.json` artık uygulamada KULLANILMAZ (giriş, yenileme, aktif kullanıcı süzgeci).
- **Canlı profil:** `_profilDinle()` kendi belgesini dinler (ilk okuma 1, değişiklik başına 1). Rol/MagazaTipi/SepetTipi değişirse "beni hatırla" açıksa sayfa yenilenir, değilse çıkış-giriş uyarısı; Istisna/Ad anında geçerli. Profil silinir veya Kilitli=true olursa oturum kapanır.
- **Admin panel → Personel → 👥 Kullanıcı Yönetimi:** liste (5 dk önbellek, 🔄 ile zorla), ✏️ Düzenle (ad, rol, mağaza tipi, sepet tipi, marka kutucukları, hesabı kapat), ➕ Yeni (profil + `sifreDegistir:true`). Kendi rolünü düşüremez/kendini kapatamaz.
- **Kural C** (`guvenlik/firestore-kurallari-ASAMA-C.rules`, test: `ASAMA-C-TEST.md`): Kilitli profil hiçbir şey okuyamaz/yazamaz; admin profil oluşturur/günceller (izinli alanlar, geçerli enum'lar, kendini koruma); silme yok. V11.32 ile uyumlu.
- **`kullanici-esitle.js --profilden`:** panelde eklenen kişiye Auth hesabı + geçici şifre açar; Kilitli olanın hesabını devre dışı bırakır; profil alanlarına dokunmaz. Eski `--liste` kipi artık kullanılmamalı (panel düzenlemelerinin üzerine yazar).
- **Makro `MakroExcell-V11.33.vba`:** kullanıcı tablosu artık gönderilmez (`tblKullanicilar` sayfası gerekmez). Kural C ve V11.33 canlı olduktan SONRA uygula.
- Maliyet: ek altyapı yok; giriş başına +0 (json yerine 1 belge okuması), panel açılışında ≤ kullanıcı sayısı kadar okuma (5 dk önbellek).
- Test: eslint no-undef temiz, run.js 10/10, yetki-testi, `test/kullanici-yonetim-testi.js` (panel arayüzü, izole). Giriş/dinleyici/kurallar gerçek Firebase gerektirdiği için canlıda doğrulanacak.

## V11.34 — Kullanıcı hesabı işlemleri panelden (Cloud Function)
- Neden: V11.33'te panel yalnız Firestore profilini yazıyordu; giriş hesabı (Firebase Auth) açma/kapatma/silme için `kullanici-esitle.js --profilden` gerekiyordu. İstek: tüm süreç admin panelinden.
- **`fonksiyon/functions` (`kullaniciYonet`, europe-west1, callable):** `olustur` (Auth hesabı + profil + geçici şifre), `sifreSifirla` (hesap yoksa açar), `kapat` (Auth disabled + `Kilitli`, oturum belirteçleri iptal), `sil` (Auth + profil + sessions/live_baskets; geçmiş teklif/satış KORUNUR). Çağıranın yönetici olduğu sunucuda doğrulanır; kendini kapatma/silme ve son yöneticiyi kapatma/silme engeli; her işlem `kullaniciLog`'a yazılır. Çekirdek mantık `kullanici.js` (21 taklit test: `node kullanici.test.js`).
- **Panel:** ➕ Yeni (işlev oluşturur, geçici şifre penceresi: Kopyala / WhatsApp, bir kez gösterilir); Düzenle içinde 🔑 Şifre sıfırla / hesabı aç, 🗑️ Sil, "Hesabı kapat" (işlev üzerinden). Ad/rol/mağaza/sepet/marka istisnası doğrudan Firestore'a (kural D).
- **Kural D (`firestore-kurallari-ASAMA-D.rules`):** istemciden profil oluşturma ve `Kilitli` yazma kapalı; `kullaniciLog` yalnız yönetici okur.
- Kurulum: `fonksiyon/KURULUM.md`. Sıra: (1) `firebase deploy --only functions`, (2) V11.34 dosyaları, (3) Kural D. Eski `kullanici-esitle.js` artık gerekmez (C:\esitle kaldırılabilir; önce canlıda doğrula).
- Maliyet: çağrı ayda birkaç kez; ücretsiz kotanın çok altında. Deploy sırasında "image saklama" sorusuna 1 gün.
- Test: eslint no-undef, run.js 10/10, yetki testi, panel testi (26), işlev testi (21). Gerçek Auth/Functions canlıda doğrulanacak.
- **V11.34 yama (sürüm damgası aynı, yalnız app.js):** şifre penceresinde Kopyala geri bildirimi düğmenin üstünde (bildirim pencerenin arkasında kalıyordu) + yedek kopyalama yöntemi; kapalı hesapta "Şifre sıfırla" için açıklayıcı uyarı. Canlıda doğrulandı: işlev yüklü (europe-west1), hesap açma / şifre sıfırlama / silme / yeni kullanıcı çalışıyor.
- **Kural D düzeltmesi:** Excel'den gelen eski profillerde `Kilitli` = "" (string) olduğu için kural boolean istiyordu → eski kullanıcılar düzenlenemiyordu. `gecerliProfil` artık boolean VEYA boş metin kabul eder. Canlıda doğrulandı.

## V11.35 — Teklif → Satışa Döndü artık satış + sevkiyat akışına gidiyor
- Önceden "Satışa Döndü" yalnız teklif durumunu işaretliyordu (satış/sevkiyat oluşmuyordu). Şimdi: onay → teklif güncel fiyatla sepete alınır (mevcut `teklifSepeteEkle`; sepet doluysa sorar, fiyat değişimini gösterir) → Abaküs açılır → **fiyat değişmediyse** teklifteki ödeme satırı otomatik seçilir ve "Satışı Onayla" ekranı açılır (müşteri adı/telefon önceden dolu; adres/teslimat tarihi orada girilir, sevkiyat mevcut akışla oluşur). **Fiyat değiştiyse** otomatik seçim yapılmaz; kullanıcı ödemeyi yeniden seçer.
- Satışı Onayla ekranına **"↩ Sepeti / ödemeyi düzenle"** düğmesi (`satisGeriDon`): sepete döner (fiyat/ürün düzeltmek için).
- Satış onaylanınca teklif otomatik "Satışa Döndü" olur (`satisNo` kaydedilir): mevcut isim/telefon eşleşmesine ek olarak, müşteri adı değişse bile dönüştürülen teklif kapanır (sepette teklifin ürünü varsa; 4 saat içinde).
- Herkes kullanabilir (rol kısıtı yok). `teklifSepeteEkle` artık başarı/iptal için true/false döndürür.
- Test: `test/satisa-donustur-testi.js` (11 kontrol, taklit ortamda). Gerçek Abaküs/sevkiyat ekranı canlıda doğrulanacak.

## V11.36 — Satışı Onayla formu yeniden düzenlendi
- **Sıra (satış):** Müşteri Adı Soyadı* · Telefon* · Tel 2 · Kimlik No · Adres (İl › İlçe › Mahalle › Açık adres) · E-Mail · Not · Satış Yöntemi · 🏢 Kurumsal fatura (Vergi Dairesi*, Vergi No*).
- **Neden "Teklif Geçerlilik Tarihi" görünüyordu:** hata. Alan teklif/WhatsApp modunda açılıyor ve satış modu kapatmıyordu. Artık satışta teklif geçerlilik tarihi ve görünürlük **gizli** (`.not-satis`).
- **Doğrulama (`satisFormDogrula`, saf fonksiyon):** ad en az iki kelime (rakam yok); telefon 11 hane/0 ile; Tel 2 geçerli ve telefondan farklı; **T.C. kimlik no algoritması** (11 hane, ilk hane≠0, 10. ve 11. hane kontrolü) — girilmişse geçersiz kabul edilmez (boş bırakılabilir); pasaport seçeneği (yabancı uyruklu); **Vergi No**: 10 hane GİB algoritması (veya şahıs firması için geçerli 11 haneli T.C.); kurumsalda T.C. istenmez, vergi dairesi + vergi no + tam adres zorunlu; e-posta biçimi; adres girilmişse il+ilçe+açık adres.
- **Boşluk kuralları:** yazarken başta boşluk ve art arda iki boşluk engellenir; alandan çıkınca/kayıtta kenar boşlukları silinir; kimlik/vergi no alanları yalnız rakam; e-posta boşluksuz.
- **Seçmeli adres:** `data/adres/iller.json` + `data/adres/{plaka}.json` (PTT posta kodu verisi, `turkey-neighbourhoods` MIT; 81 il, 973 ilçe, ~73 bin mahalle, toplam ~1,5 MB; il başına ~20 KB, yalnız seçilen il indirilir). Mahalle listeden seçilir veya yazılır (PTT listesinde olmayan yeni mahalle yazılabilir). Liste yüklenemezse il/ilçe zorunlu olmaz, adres serbest yazılır. Satış kaydına `adresYapi{il,ilce,mahalle,acik}`, `kimlikTipi`, `kurumsal`, `vergiDairesi`, `vergiNo` eklendi; sözleşmede "Vergi Dairesi" satırı.
- Test: `test/satis-formu-testi.js` (65 kontrol (V11.36 denetim yaması): algoritmalar + ekran + adres zinciri + liste yüklenemezse). Veri klasörü: `data/adres` (List ve Aygun depolarında `data/` içine konur).

## V11.36 denetim yaması (List'e yüklenmeden önce yapılan kod taraması)
Tüm dosyalar elle + araçla tarandı (sözdizimi, no-undef, ulaşılamayan kod, sonsuz döngü, boş catch, mantık). Kampanya/eşik döngülerinde sonsuz döngü riski **yok** (eşik `||1` korumalı, döngüler kısalıyor veya `break` ediyor). Bulunan ve düzeltilenler:
- **Çift dokunma (app.js):** "Satışı Onayla" yavaş ağda iki kez basılırsa iki satış + iki sevkiyat oluşabiliyordu → `finalizeAksiyon` artık tek seferde çalışır (`_finalizeMesgul`; gerçek işi `_finalizeAksiyonIc` yapar).
- **Ad kesme işareti (app.js):** ad HTML-kaçışlı saklanıyor; `O'Neil` sözleşme PDF'inde `O&#39;Neil` görünüyordu (çift kaçış). Düz `'` → `’` çevrilir; WhatsApp mesajı artık kaçışsız düz ad kullanır.
- **Yabancı müşteri adı (app.js):** pasaport seçeneği var ama ad yalnız Türkçe harf kabul ediyordu (José, Müller, Иван reddediliyordu) → `\p{L}` (her dilin harfi); rakam/simge hâlâ red.
- **Telefon (app.js):** `0abcdefghij` geçiyordu → `^0\d{10}$`.
- **Stok 0 (app.js `teklifSepeteEkle`):** güncel stok 0 ise eski teklifteki stok geri geliyordu (`Number(0)||eski`) → 0 korunur.
- **Mağaza tipi (app.js `getMagazaTipi`):** eski yazımlar ('Çarşı', 'ÇARŞI') 'CARSI' ile eşleşmiyordu → `_kyMagazaNorm` ile normalize.
- **Admin özet (app.js):** analiz verisi yokken "En yüksek giriş: -Infinity" → `Math.max(0, …)`.
- **Satış kaydı (app.js):** `aygun_sales` yerel yazımı depolama dolunca hata verip satışı yarıda kesebilirdi → try/catch. Sevkiyat kaydı oluşturulamazsa artık kullanıcıya uyarı gösterilir (önceden sessiz).
- **sevkiyat.js:** `formEnjekte` içindeki `return` sonrası ulaşılamayan ~25 satır silindi (davranış aynı).
- **Cloud Function `olustur` (fonksiyon/functions/kullanici.js):** Auth hesabı açılıp profil yazımı düşerse yetim hesap kalıyor, tekrar denenince "hesap zaten var" çıkıyordu → hata olursa Auth hesabı geri alınır. **Bu dosya için `firebase deploy --only functions` gerekir (acil değil; yalnız nadir hata yolunu etkiler).**
- Test: no-undef temiz, run.js 10/10, yetki, panel, satisa-donustur, satis-formu **65** (+5), işlev **22** (+1).
- Bilinen, dokunulmadı: ürün adlarının yönetici panelinde kaçışsız basılması (veri yönetici Excel'inden gelir); B2 (hassas JSON'lar herkese açık) hâlâ açık.

## V11.36c — Satışı Onayla: Kahramanmaraş varsayılanı, Kurumsal fatura, KVKK maskeli PDF
- **Adres:** form açılınca İl = Kahramanmaraş, İlçe = Onikişubat hazır gelir (`_ADRES_VARSAYILAN`); Kahramanmaraş ilçe listesinde Onikişubat ve Dulkadiroğlu en üstte (`_ADRES_ILCE_ONCELIK`), sonra alfabetik. **Mahalle artık açılır listeden seçilir** (Onikişubat 138, Dulkadiroğlu 103 mahalle); listede yoksa "Listede yok — elle yazın". Varsayılan il/ilçe tek başına adres sayılmaz: mahalle/açık adres girilmediyse adres boş kaydedilir (bireysel satışta adres hâlâ opsiyonel).
- **Kurumsal fatura:** etiket "🏢 Kurumsal fatura". İşaretlenince: Firma Ünvanı* · Vergi Dairesi* · Vergi No* (10 hane GİB algoritması; şahıs firması: geçerli T.C.) · "Şirket (fatura) adresi teslimat adresiyle aynı" kutusu (varsayılan işaretli; kaldırılırsa ayrı il/ilçe/mahalle/açık adres açılır, zorunlu). Ad alanı "Yetkili / İrtibat Adı Soyadı" olur. Kayıtta: `firmaUnvan, vergiDairesi, vergiNo, faturaAdres, faturaAdresYapi, faturaAdresAyni`.
- **Excel → "Müşteri Bilgileri" (kopyalanan müşteri + fiyat bloğu):** "🏢 Kurumsal fatura" kutusu; işaretliyse Firma Ünvanı, Vergi Dairesi, Vergi No, Şirket Adresi zorunlu; blokta **FATURA TİPİ: KURUMSAL FATURA** (bireyselde "Bireysel") açıkça yazılır. Adres, formdaki il/ilçe/mahalle ile birleşik gelir.
- **KVKK — satış sözleşmesi PDF'i (yalnız "SATIŞ" belgeleri; teklif PDF'i müşterinin kendisine gittiği için açık):** Ad `A** V***`, telefon `0532 *** ** 33`, T.C./vergi no `100******46` (pasaport: ilk 2 + son 1), adres yalnız `İlçe/İl` açık, gerisi yıldız. Kurumsalda firma ünvanı ve vergi dairesi açık (tüzel kişi bilgisi); yetkili adı, vergi no ve adresler maskeli. Belgede "Fatura Tipi", "Fatura (Şirket) Adresi", "Teslimat Adresi" satırları ve 🔒 KVKK notu var. **Sevkiyat belgeleri (depo fişi, teslimat listesi) maskelenmedi:** teslimat için gerçek ad/telefon/adres gerekir.
- Test: satis-formu **88**, yeni `pdf-maskeleme-testi.js` (PDF + Excel bloğu), diğerleri aynı; no-undef temiz.

## V11.36d — Kopyala biçimi, pencere konumu, Peşin kutusu, adres isteğe bağlı, prestijli PDF
- **Müşteri + fiyat bilgisini kopyala** (Sevkiyat detayı → Müşteri kartı; `musteriKopyala`, metin `sevkiyat-belge.js › musteriMetni`): *Kişi Bilgisi* (ad · telefon · Tel 2 · adres · tarih, saat) → *Kurumsal Fatura* (yalnız kurumsal kayıtta: ünvan · vergi no · vergi dairesi · şirket adresi) → *Ürün ve Fiyat* (her ürün: `N-Ürün (Kod): ödeyeceği tutar [· kampanya]` + altında `Peşin X ₺ + 4 Taksit / Vestel POS: Y ₺`). Vade farkı/komisyon/indirim yazılmaz. Ürün payı = toplam ödeme × net oranı; peşin büyük üründen başlayarak yuvarlak tutarla düşülür. TC, e-posta ve not bu metne **girmez** (istenen kısa biçim). Kayıtlara `kurumsal, firmaUnvan, vergiDairesi, vergiNo, faturaAdres` ve ödeme bloğuna `zincir` eklendi (eski kayıtlarda kurumsal bilgi yoktur; zincir yoksa kart adı yazılır).
- **Pencereler en üstten açılır:** Abaküs ve Satışı Onayla pencereleri dikey ortalanıyordu, içerik uzunsa üstü (Kart/Manuel nakit; Ad/T.C./Telefon) kesiliyordu → `index.html` içinde `#v1136d-css` (üste hizalı, kaydırılabilir) + açılışta `scrollTop=0`. **style.css pakette olmadığı için düzeltme index.html'dedir; gerçek style.css'teki modal kuralları farklıysa gerekirse ayarlanır.**
- **Peşin ödenen kutusu** Abaküs'te en üste taşındı (Kart / Manuel nakit satırından önce) ve küçültüldü (tek satır başlık).
- **Adres isteğe bağlı:** bireysel satışta mahalle, açık adres, il/ilçe hiçbiri zorunlu değil (peşin satışlarda adres alınmayabilir). Yalnız **kurumsal fatura**da şirket adresi (il, ilçe, açık adres) zorunludur.
- **Satış sözleşmesi PDF'i:** "SATICI / ALICI" taraflar kartları, altın çizgili başlık, büyük belge başlığı. KVKK maskesinde adresin kelime baş harfleri görünür (`A**** M** S**** C** N*** Onikişubat/Kahramanmaraş`); ad, telefon, T.C./vergi no önceki gibi.
- **Sevkiyat detayı:** "Yönetici / iade işlemleri" kartı en alta (Hareket geçmişinin altına) taşındı.
- Testler: satis-formu 88, pdf-maskeleme (PDF + Excel), `kopyala-testi.js` (12), `yerlesim-testi.js` (5); diğerleri aynı.

## V11.36e — yama: `satisMahDegisti is not defined`
- Mahalle açılır listesinin `onchange` işlevi (`satisMahDegisti`) window'a açılmamıştı → mahalle seçince F12'de ReferenceError. Eklendi. Testler işlevleri sayfaya doğrudan koyduğu için bunu yakalamıyordu; `satis-formu-testi.js`'e "Satışı Onayla satır içi çağrılarının hepsi window'a açık" kontrolü eklendi (eski hâlde başarısız olduğu doğrulandı). Tüm index.html + app.js satır içi çağrıları ayrıca tarandı: başka eksik yok.

## V11.37 — Alt bar sadeleştirme, sevkiyat yetki/maskeleme, satışçı görünürlüğü
1. **Alt bar:** Trendler düğmesi ve `#tab-trend` içeriği kaldırıldı (ürünler ana sayfa üstünde zaten var; admin panelindeki "Popüler Ürünler" yerinde). Sıra: Ürünler · Sepet · Teklifler · Sevkiyat · Talepler · (Admin) · Performans · Stok · Çıkış. `renderTrendFullList`/`switchMainTab('trend')` kodu null-güvenli olduğu için dokunulmadı (ulaşılamaz).
2. **Kopyala metni** (`sevkiyat-belge.js › musteriMetni`): TAMAMI büyük harf (`tr-TR`; e-posta ve ürün kodu `toUpperCase` — Türkçe İ bozmasın). Kişi bölümüne `T.C.:` ve `E-POSTA:` eklendi (doluysa).
3. **Yönetici dışı (satış + destek) kısıtları:** detayda Kimlik ve e-posta maskeli (`maskeKimlik`/`maskeEposta`, sevkiyat-veri.js); ad, telefon(lar), adres açık. "Müşteri + fiyat bilgisini kopyala" sevkiyat başına **kullanıcı başına 1 kez**: kullanım Firestore'a `kopya.<eposta_>` alanı + hareket geçmişi `musteri_kopyalandi` olarak yazılır (başka cihazdan da tekrar edilemez); pano izni verilmezse metin pencerede gösterilir. Yönetici sınırsız. (Eski hata düzeltildi: `kopyala` işlemi yetki süzgecinin ARKASINDA kalıyordu → satış kullanıcıları hiç kopyalayamıyordu.)
4. **Satışı yapan personel:** detayda Müşteri kartında "Satışı yapan", liste kartında telefonun yanında, aramada da bulunur. Yeni kayıtlarda `saticiAd` (profil Adı) yazılır; eski kayıtlarda e-posta @ öncesi gösterilir.
5. **Vade farkı / komisyon satırı** yalnızca yönetici görür (destek dahil diğerlerinde yok).
6. **Yetki:** sevkiyatta değişiklik (tarih/saat, not, satış noktası, depo, teslim şekli, servis adı, seri, ürün ekle/değiştir, teslim, çıkış doğrulama) yalnızca **satışı yapan + destek + yönetici** (`seriYetkili`). Diğerleri herkesin satışını görür (liste + detay) ama detay "Salt okunur" bandı ve pasif alanlarla gelir; kapılar hem çizimde hem olay işleyicilerinde (`tikla`/`degisti`). Not: bu istemci tarafıdır; Firestore kuralı sevkiyatlar koleksiyonunda hâlâ her girişli profile yazma izni verir (bkz. öneri).
- Testler: yeni `test/gorunum-testi.js` + `t2.html` (32 kontrol; tam sevkiyat.js ile detay ekranı), `kopyala-testi.js` (16). Diğerleri aynı.

## V11.38 — "Cihazda gönderilmeyi bekleyen kayıtlar var" rozeti
- Rozet 1,5 sn'de çıkıyordu; mobil bağlantıda normal yazmalar bile bundan uzun sürüyor. Artık çevrimiçiyse 10 sn sonra, çevrimdışıysa hemen çıkar; dokununca kapanır.
- Teşhis (1 Kas): Firestore kuralı doğru yayında (ASAMA-D). `motd` / sayaç 403 hataları, aynı bilgisayarda List ve Aygun'un aynı anda açık olmasından: iki site aynı kaynağı (aygunavm.github.io) paylaşır → Firebase oturumu ve localStorage ortaktır; birinde çıkış/farklı hesapla giriş diğerini oturumsuz bırakır. Tek sitede hata yok. Gerçek kullanıcılar yalnız Aygun'u kullandığı için etkilenmez.

## V11.39 — dokunma hassasiyeti + titreşim
- Fold7 / Android'de "Müşteriye teslim edildi" düğmesinin sol kısmına basınca işlem olmuyordu (düğmenin biraz sağına basınca çalışıyordu). Neden kesinleşmedi; en olası: yan yana duran "Temizle" düğmesi / dokunma payı. Önlem: "Temizle" imza başlığının sağına taşındı; teslim düğmesi kendi satırında tam genişlik ve 50 px yükseklik; dokunmatik cihazlarda tüm sevkiyat düğmeleri en az 44 px.
- Titreşim geri bildirimi: sevkiyat ekranındaki her düğmeye dokunuşta 12 ms (teslim düğmesinde 25 ms) `navigator.vibrate`. (Sevkiyat düğmeleri `haptic-btn` sınıfı taşımadığı için ana uygulamadaki titreşim onlara gelmiyordu.) iPhone/Safari titreşim API'sini desteklemez.

## V11.40 — İndirim sistemi toparlandı: tek alan, Abaküs'te "Anlaştığımız Tutar"
- **Sepetteki "İndirim" kutusu kaldırıldı** (`index.html` cart-footer-row, `applyDiscount`). Eski sorun (indirimin sonraki ürünlere taşınması) kökten bitti. `discountAmount/discountType` değişkenleri hep 0/TRY kalır (eski kayıtları okuyan kodlar için); satır indirimi (`itemDisc`) ve kampanyalar aynen sürer.
- **Abaküs → 🤝 Anlaştığımız Tutar** (eski "Pazarlık İndirimi" paneli yerine). Üç giriş: **Toplam tutar** · **Aylık taksit** · **İndirim** (₺ veya %, % net nakit üzerinden). Toplam/aylık, tabloda seçili satıra göre TL indirime çevrilir; eskisi gibi tüm kart satırlarından aynı TL düşülür (`_abAnlasCoz`, `_abKartHesap`). Satır seçilince hedef (`window._abHedef`) belirlenir; satır değişirse tutar yeni satıra göre yeniden hesaplanır.
- **Yuvarlama yok:** anlaşma girilince aylık 100/250/500 kademesine yukarı yuvarlanmaz. Aylık × taksit = toplam; bölünmeyenlerde (23.500 ÷ 6) taksitler 3.916,66, **son taksit 3.916,70** (`_abTaksitBol`). Kuruş yalnız gerektiğinde görünür (`fmtK`; `fmt` aynen tam sayı).
- Panel: standart → anlaşılan tutar, aylık × taksit (+ son taksit), **nakit karşılığı** (anlaşılan × nakit/standart; örnek 19.545 ₺), %7 sınırı uyarısı (nakit karşılığına göre). Anlaşma yoksa her şey eski (standart) davranış.
- Teklif / WhatsApp / PDF / sevkiyat fiyat bloğu: `ekIndirim` ve `pazarlikNotu` aynen taşınır; WA ve PDF'te kuruşlu aylık + "(son taksit …)" notu; PDF "Toplam Ödenecek" aylık×taksitten değil gerçek toplamdan yazılır.
- Anlaşma durumu `openAbakus` ve sepet temizlenince sıfırlanır (`_abAnlasSifirla`).
- Admin → Özet → İndirim Kullanım Raporu (personel bazında pazarlık) `ekIndirim` üzerinden aynen çalışır.
- Test: `test/anlasma-testi.js` (24 kontrol: 20.000→21.500, aylık 4.300, 300 ₺ → 4.340, 23.500 ÷ 6, modlar, uyarılar, render).

## V11.41 — Serili ürün sevkiyatta "serisiz" görünüyordu (VC07R302MVR/TR)
- **Kök neden:** seriler.json'da `Kod` kısa (VC07R302M, ilk 9 karakter), ürün tablosundaki (urunler.json) `Kod` ise bu ürün için TAM kod (VC07R302MVR/TR). Sevkiyat kalemi tam kodu taşıdığından `seriState.kodlar` içinde bulunamadı → "seri gerekmez". (Kısa kod tasarımı doğru; sorun, urunler.json'da ~270 üründe Kod'un kısa kurala uymaması. Eldeki dosyalarda 460 seri kodunun 151'i ürün listesiyle birebir eşleşmiyordu.)
- **Çözüm (uygulama):** `kodAnahtar(kod)` = Excel "Aygün Kısa Kod" kuralı (SM… → ilk 7 + ✦ + 11. karakter; diğerleri ilk 9; ✦ içeren zaten kısa kalır). `kodEs(a,b)` iki kodu aynı anahtara indirger. `seriYukle`, `seriGerekir`, `bilinenOgren`, `seriDogrula`, sevkiyat.js tarama/eşleştirme ve talep eşleştirmesi bunu kullanır. Tam ya da kısa, ikisi de çalışır.
- Kabul edilen çakışma (önceden de vardı): aynı ilk 9 karakterli farklı renk/model kodları (örn. VC07R302MVR/MVP) aynı ürün sayılır.
- Etki: bu nedenle serisiz görünen açık sevkiyatlar "Seri Bekliyor"a döner (beklenen).
- Test: `test/kisakod-testi.js` (16 kontrol).
- Devam belgesi: `DEVAM-PROMPT-V11.41.md` (proje kökü).

## V11.42 — Yönetici düzeltme: kapanmış sevkiyatta değişiklik + stok kontrolünü gerekçeyle aşma
- **İstek:** Sevkiyat Yönetimi'nde süreç kapanmış olsa bile admin değişiklik yapabilmeli (örn. "Müşteri alır" seçilmiş ama "Servis götürür" olmalıydı); seri yanlış girilmiş ya da başka sistemden düşülmüş/geç girilmiş olduğu için okutulamıyorsa admin tam yetkiyle girip kapatabilmeli.
- **Düzeltme modu (`duzeltme(s)` — sevkiyat.js):** yalnız **yönetici** + kapanmış (`teslimEdildi`) + iptal/iade/silinmemiş kayıt. Detayda "Yönetici düzeltme modu" bandı çıkar. Düzenlenebilenler: ürün bazlı **teslim şekli** (müşteri alır ↔ servis götürür) ve götüren servis adı, **seri numarası** (değiştir/sil), **ürün deposu**, teslimat tarihi/saat, not, satış noktası. Ürün değiştir / satır çıkar / ürün ekle / kamera bu modda yok (kapanmış kayıtta yapısal değişiklik yapılmaz).
- **Teslim şekli değişince teslim kaydı korunur:** ürünün kendi `teslim` kaydı yoksa eski grubun kaydı ürüne işlenir; yeni grubun `teslimler.<tür>` kaydı yoksa oluşturulur; eski grupta ürün kalmadıysa eski grup kaydı silinir. Kayıt kapalı/tamamlanan kalır. "Müşteri alır"a geçince eski "götüren servis" adı temizlenir.
- **Seri zorla kaydet (`seriZorlaDene`):** yönetici bir seriyi girerken "stok listesinde yok / başka ürüne ait / stoktan çıkış yapılmış / yolda" uyarısı alırsa "Yine de kaydet" penceresi çıkar; **gerekçe zorunlu**, hareket geçmişine `[yönetici: stok kontrolü aşıldı (…) — gerekçe]` yazılır. Açık sevkiyatta da çalışır (geç girilen seri). **Aşılamayanlar:** başka sevkiyatta kullanılmış seri ve aynı sevkiyatta başka satırdaki seri (çift kayıt koruması). Destek/satış bu kontrolü aşamaz.
- Seri değişince eski seri `seriKullanim`'dan serbest kalır, yenisi bu sevkiyata bağlanır. Her değişiklik hareket geçmişine "[yönetici düzeltme]" / "[kapanmış kayıtta düzeltme]" ekiyle yazılır.
- **Yetki yine istemci tarafında** (kural: profili olan herkes yazabilir). Satış/destek kapanmış kayıtta eskisi gibi salt okunur; zorla olay gönderilse de transaction içinde (`duzeltme(sunucu)`) reddedilir.
- Test: yeni `test/duzeltme-testi.js` (33 kontrol) + `t2.html` sahte veritabanına `tx.set/tx.delete` eklendi. Diğer testler aynı (run 10, yetki 7, görünüm 33, kısa kod 16, kopyala 16, anlaşma 24, satış formu 89, yerleşim 5); lint temiz.
- Dosyalar: sevkiyat.js (+ damga değişen 11 dosya).

## V11.43 — Toplu içe aktarma (CSV): depoda bekleyen, sepetten geçmemiş satışlar
- **İhtiyaç:** Başka sistemde satılıp seri numaraları alınmış, depoda servis/müşteri teslimini bekleyen birkaç satışı tek tek sepetten girmeden sevkiyata almak.
- **Yer:** Sevkiyat → Yönetici Araçları → "Toplu içe aktar (CSV / Excel)" (yalnız yönetici). "Boş şablonu indir" + dosya seçimi → **önizleme** (satış satış ✓/✗, uyarılar) → gerekçe + "N satışı içe aktar" → onay.
- **Dosya:** Excel'den "CSV (noktalı virgül)" kaydı; UTF-8 ve Windows-1254 (Türkçe ANSI) otomatik tanınır. Sütunlar (başlıkla eşleşir, sıra serbest, bilinmeyenler yok sayılır → Seri Raporu dışa aktarımı da okunur): Teslimat Tarihi · Saat · **Satış No** · **Müşteri** · Telefon · Satış Noktası · **Teslim Şekli** (Müşteri alır / Servis götürür) · Servis · **Ürün Kodu** · Ürün Adı · Seri No · Depo · Not. Kalın = zorunlu (Satış No boşsa `ICE-yyAAgg-001…` otomatik verilir; aynı Satış No = aynı satışın ürünleri). Tarih: GG.AA.YYYY / YYYY-AA-GG / Excel seri no; boşsa bugün. Telefon başındaki 0 eksikse eklenir.
- **Doğrulama (yalnız okuma):** müşteri/ürün kodu/teslim şekli boş, tarih anlaşılmaz, Satış No geçersiz ("/" içeremez), aynı Satış No'da farklı müşteri, **sistemde zaten kayıtlı Satış No (üzerine yazılmaz, atlanır)**, dosyada tekrar eden seri, **başka sevkiyatta kullanılmış seri** → ilgili SATIŞ atlanır (diğerleri yazılır). Uyarı (engellemez): ürün listesinde yok, seri başka ürüne ait görünüyor, tarih boş.
- **Stok kontrolü bilerek yapılmaz** (ürün başka sistemden zaten düşülmüştür; "listede yok / çıkış yapılmış" yalnız bilgi olarak gösterilir). Çift kayıt koruması (seriKullanim kilidi) sürer.
- **Yazma:** her satış kendi transaction'ında (kayıt + seri kilitleri birlikte, `saleNo` zaten varsa durur). Kayıt: açık, ürün bazlı teslim şekli/servis adı, `depoZorunlu:false`, `fiyat:null` (eski kayıt gibi çalışır), `iceAktarma:{t,u,gerekce}`, hareket geçmişi `toplu_ice_aktarma`. Seriler girilmişse durum "Depoda Hazır"; sonrası normal süreç (teslim → çıkış doğrulama). Satışı yapan: içe aktaran yönetici.
- **Hata düzeltildi (test yakaladı):** `05.12.2026` tarihi 2020 okunuyordu (yıl düzenli ifadesi).
- Test: yeni `test/ice-aktarma-testi.js` + `ice-ornek.csv` (24 kontrol). Diğer testler aynı; lint temiz. Dosyalar: sevkiyat.js, sevkiyat-veri.js (+ damga değişen dosyalar).

## V11.44 — İçe aktarma: "Failed to get document because the client is offline" yaması
- Denetim okumaları (Satış No var mı, otomatik no, seri kilidi) Firestore bağlantısı henüz kurulmamışken "client is offline" verebiliyordu (soğuk açılış, mobil veri, iki sekme). `okuDene`: offline/unavailable hatasında 4 kez, 1,5–6 sn aralıkla yeniden dener; yine olmazsa hata mesajı "internet / sunucu bağlantısı yok" der ve o satış atlanır (yanlışlıkla yazılmaz).
- Test: `ice-aktarma-testi.js` 25 kontrol (ilk iki okuma offline hatası verir, yine de geçer). Dosyalar: sevkiyat-veri.js (+ damga).

## V11.45–11.46 — Satış belgesi WhatsApp gönderim kuyruğu (şirket telefonu) + müşteri onayları
- **Akış:** Satışı Onayla formunda iki yeni zorunlu-olmayan ama **kuyruk için şart** onay kutusu: (1) KVKK Aydınlatma Metni sunuldu, (2) Müşteri belgenin (maskeli) şirket WhatsApp hattından gönderilmesine açık rıza verdi. **İkisi işaretli + geçerli telefon varsa** satış, `gonderimKuyrugu/{SAT-no}` kuyruğuna girer (satış kaydına `izin:{aydinlatma,whatsapp,t,u,surum}` da yazılır). Biri eksikse satış yine kaydolur, kuyruğa alınmaz (kısa uyarı toast'ı). Aydınlatma/rıza metinlerinin hukuki yeterliliği şirketin hukuk danışmanıyla netleştirilmelidir (bu yazılım hukuki görüş değildir).
- **Şirket telefonu (admin/destek):** Sevkiyat başlığında 💬 düğmesi (+ bekleyen sayısı rozeti; ekran açılışında en çok 2 dk'da bir tek `getCountFromServer`). Kuyruk → satış → **büyük numara + "numarayı müşteriyle teyit ettim" kutusu** (işaretlenmeden gönder pasif; onay eksik/numara eksik kayıt hiç gönderilemez) → "PDF'i hazırla ve gönder".
- **PDF:** uygulama şimdiye dek PDF dosyası üretmiyordu (HTML yazdırma penceresi). Kuyruktaki satış verisi (snapshot) mevcut **KVKK maskeli satış sözleşmesi şablonundan** `vendor/html2pdf.bundle.min.js` (html2pdf 0.10.2, kendi sunucumuzda; yalnız bu ekranda ve gerektiğinde yüklenir, ~900 KB) ile izole bir iframe içinde gerçek A4 PDF'e çevrilir (düğme gizlenir, bölümler sayfa sonunda bölünmez, dış yazı tipi beklenmez). Çıktı görüntü tabanlıdır (metin seçilemez), ~300–400 KB.
- **İki gönderim yolu (birbirinin yedeği değil, farklı durumlar):** (1) *Paylaşım menüsü* (`navigator.share` + PDF dosyası; Android) → WhatsApp Business → müşteriyi **listeden** seçersiniz: yalnız rehberde/sohbetlerde kayıtlı müşteri için. (2) *Kayıtsız numara:* paylaşım iptal edilirse ya da desteklenmiyorsa ekran "listede bulamadınız mı?" der ve numarayla sohbet açma (Android'de WhatsApp Business `intent://`, `wa.me`, WhatsApp Web) + PDF indirme sunar; PDF sohbette 📎 → Belge ile elle eklenir. Telefon numaranın rehberde olup olmadığını önceden bilemez; seçim operatöre bırakılmıştır (paylaşım penceresinin iptali de aynı sonucu verir). Mesaj metni (Sayın Ad Soyad, belge no, KVKK maskeleme notu) panoya da kopyalanır (WhatsApp ek metnini bazen düşürür). Android'de `intent://…package=com.whatsapp.w4b` bağlantısı gerçek cihazda denenmelidir; olmazsa `wa.me` bağlantısı kullanılır.
- **"Gönderildi" daima personel beyanıdır** (paylaşım menüsünün başarısı kesin bilinemez): paylaşımdan sonra "Gönderdiniz mi?" sorulur. İşaretleme **transaction**'dır: başka cihaz önce işaretlediyse "zaten gönderilmiş (kim · saat)" uyarısı verir, üzerine yazmaz. İşaretlenince PDF snapshot'ı (kişisel veri) **silinir**; kim/saat/kanal kalır, sevkiyat kaydına `belgeGonderim` + hareket geçmişi "Satış belgesi müşteriye WhatsApp ile gönderildi" yazılır. "Kuyruktan çıkar" gerekçe ister, snapshot'ı siler.
- **Bilinen sınırlar:** (a) Yeniden gönderim için snapshot yok (silindi) — şimdilik yeni satış kaydından yeniden kuyruğa alma yok; gerekirse sonraki sürüm. (b) Çevrimdışıyken PDF kütüphanesi ilk kez yüklenemez (sonra önbellekten çalışır). (c) PDF görüntü tabanlı. (d) Eski satışların onay kaydı yoktur, kuyruğa alınamaz.
- **Firestore kuralları (isteğe bağlı sıkılaştırma):** `guvenlik/firestore-kurallari-ASAMA-E.rules` (= D + `gonderimKuyrugu`: oluşturma herkes, okuma/güncelleme yalnız admin+destek, silme yok). Yayınlanmasa da özellik D'nin genel kuralıyla çalışır; E yayınlanırsa satış personeli kuyruğu okuyamaz.
- Test: yeni `test/gonderim-testi.js` (26: gerçek PDF üretimi %PDF, paylaşım/iptal/desteksiz ayrımı, onay ve numara kapıları, çift gönderim, snapshot silme, rozet, yetki), `test/izin-testi.js` (11), `t3.html`, `belge-ornek.html`. Diğerleri aynı; lint temiz.
- Dosyalar: **yeni** gonderim.js, vendor/html2pdf.bundle.min.js (+ LICENSE), guvenlik/…ASAMA-E.rules; değişen app.js, index.html, sevkiyat.js, service-worker.js, bump-version.sh (+ damgalı dosyalar).

## V11.47 — Oranlar: Tip = "İptal" olan POS satırları Abaküs'te görünmez
- **İhtiyaç:** Kapatılan POS cihazlarının satırları tblOranlar'da arşiv olarak dursun (silinmesin), ama Abaküs/oran hesabında çıkmasın.
- **Kullanım (Excel):** tblOranlar → ilgili satırın **Tip** hücresine `İptal` yaz → günlük push (makro). Geri açmak için Tip'i `Kart` / `Kredi` yap (ya da boşalt). Makro değişmedi; JSON'da satır kalır.
- **Kod:** `oranlariSuz` (app.js), `oranlar.json` yüklenirken Tip'i "iptal" ile başlayan satırları eler (İptal/IPTAL/iptal/"İptal edildi", baştaki-sondaki boşluk fark etmez). `allRates` tek kaynak olduğundan Abaküs kart listesi, kredi kurumları, taksit tabloları, satış formu ve sepet hesapları iptal POS'u hiç görmez.
- Test: yeni `test/oran-iptal-testi.js` (23). Diğer testler aynı; lint temiz. Dosyalar: app.js (+ damga değişen dosyalar).

## V11.48 — Belge gönderimi: "Bu numarayla gönder" (rehbere kaydetmeden) birincil yol
- **Sorun:** Paylaşım menüsü yalnız WhatsApp'ın tanıdığı (rehber/sohbet) kişileri listeler; numarayı kaydetmeden seçmek mümkün değil.
- **Çözüm:** Kuyruk detayında iki düğme: **💬 Bu numarayla gönder (rehbere kaydetmeden)** (birincil) ve 📤 Paylaşım menüsüyle (rehberde kayıtlıysa). Numarayla yol: PDF hazırlanır → paylaşım menüsü açılmaz → "1) PDF'i indir 2) WhatsApp Business'ta sohbeti aç (numara + mesaj metni hazır) 3) sohbette 📎 → Belge → PDF". Sohbet bağlantısına dokunulunca "Gönderildi olarak işaretle" adımı gelir. Aynı teyit/onay kapıları geçerli.
- **Sınır (WhatsApp'tan):** bağlantıyla sohbete dosya otomatik eklenemez; PDF'i sohbette bir kez elle eklemek gerekir. Tam otomatik gönderim ancak WhatsApp Business Platform (API; Meta doğrulaması, ücretli şablon mesaj, sunucu tarafı) ile mümkündür — şimdilik kapsam dışı.
- Pakete vendor/html2pdf dosyaları da eklendi (List'te yoksa "PDF kütüphanesi yüklenemedi" hatası verir).
- Test: gonderim-testi 33 (7 yeni: numara düğmesi kapıları/sıra, paylaşım açılmaz, wa.me bağlantısı, gönderildi adımı). Diğerleri aynı; lint temiz. Dosyalar: gonderim.js (+ damga değişen dosyalar).

## V11.49 — Aynı gün başkasının satışında işlem + liste tazeliği
- **Yetki (`seriYetkili`, `ayniGunSatis`):** satış personeli KENDİ satışında her zaman; BAŞKASININ satışında satışın yapıldığı **takvim günü** boyunca teslim öncesi tüm süreçleri (teslim şekli müşteri alır/servis götürür, tarih/not/depo, seri, ürün, çıkış doğrulama, teslim) yapabilir. Ertesi günden itibaren yalnız satışı yapan + destek + yönetici (başkasının satışı salt okunur). Maskeleme (T.C./e-posta/vade farkı) ve tahsilat/iade/satır çıkarma/yönetici işleri değişmedi. Kural yalnız istemci tarafı. Salt okunur uyarı metni güncellendi.
- **Liste tazeliği:** açık sevkiyat listesi önbelleği satış personelinde 5 dk → **60 sn** (admin/destekle aynı). Kapanmış kayıt geçmişi personelde 5 dk kaldı. Maliyet: panel açılışı başına ≤ açık kayıt sayısı kadar okuma; yenile düğmesi/aşağı çekme hâlâ 15 sn aralıkla anlık.
- Test: gorunum-testi 38 (5 yeni: aynı gün düzenlenebilir, teslim şekli değişti, maskeleme sürer, ayniGunSatis); eski "başkasının satışı salt okunur" testleri artık önceki günün kaydıyla. Diğerleri aynı; lint temiz. Dosyalar: sevkiyat-veri.js, sevkiyat.js (+ damga değişen dosyalar).

## V11.50 — Belge gönderimi: numarayla sohbet + PDF paylaşımı (rehbere kaydetmeden, ücretsiz) · Abaküs artış yönü uyarısı
- **Yöntem (ücretsiz, rehbere kayıt gerekmez):** "Bu numarayla gönder" → 1) sohbeti numarayla açıp hazır mesajı gönderin (numara WhatsApp sohbet listesine girer) 2) geri gelip **📤 PDF'i paylaş** → WhatsApp Business → listenin en üstündeki müşteriyi seçin → PDF dosyası gider (link/indirme yok). Paylaşım menüsü yoksa/çıkmazsa yedek: PDF indir + sohbette 📎 → Belge. **Gerçek cihazda ilk kez denenecek varsayım:** paylaşım listesinin başında az önce mesajlaşılan kayıtsız numaranın görünmesi.
- Tam otomatik (kullanıcı dokunuşsuz) gönderim yalnız WhatsApp Business Platform API (ücretli) veya yerel uygulama ile mümkündür; kapsam dışı.
- **Abaküs 🤝 Anlaştığımız Tutar, artış yönü:** standardın ÜSTÜNDE tutar (toplam/aylık modunda) ya da indirim kutusunda eksi değer artık sessiz/belirsiz değil: "standart tutarın ÜSTÜNDE (+X)… tutar uygulanmadı, standart fiyat geçerli" uyarısı. Fiyat artışı hesaplanıp uygulanmaz (politika kararı bekliyor: engelle / işaretleyerek izin ver / yönetici onayı).
- Test: gonderim-testi 36, anlasma-testi 27 (yeni artış/eksi senaryoları). Dosyalar: gonderim.js, app.js (+ damgalı dosyalar).

## V11.51 — Belge gönderimi sadeleştirme + sekmeler + yönetici silme + yeni mesaj
- **Karar:** Abaküs "fiyat üstü (artış) satışa yazılsın" değişikliği YAPILMADI. V11.50 davranışı kalır: standart tutarın üstündeki anlaşma tutarı uygulanmaz, açık uyarı verilir.
- **Ekran (gonderim.js):** 3 sekme: **Bekleyen (n) / Gönderilen / Çıkarılan**. "Son gönderilenler" düğmesi kaldırıldı (görünür hata/boş durum yoktu); Gönderilen sekmesi müşteri, satış no, ürün, saat, gönderen, kanal listeler. Gönderildi işaretlenince kayıt Bekleyen'den Gönderilen'e geçer; kalanlar Bekleyen sayacında.
- **Yönetici (admin):** Gönderilen / Çıkarılan / Bekleyen her kayıtta 🗑 kalıcı silme (onaylı). Destek yalnız görür. Sevkiyat kaydındaki gönderim geçmişi silinmez. **Kural:** ASAMA-E'de `gonderimKuyrugu` `allow delete: if admin()` (E yayınlanmadıysa D'nin genel kuralı zaten izin verir).
- **Tek ana düğme akışı:** detay açılınca PDF arka planda hazırlanır. Teyit → **💬 1) Sohbeti aç ve hazır mesajı gönderin** (numara + mesaj; rehberde kayıtlı/kayıtsız fark etmez) → **📤 2) PDF'i gönder** (paylaşım menüsü; listenin en üstündeki müşteri) → "gönderdiniz mi?" → ✅. Eski "Bu numarayla gönder / Paylaşım menüsüyle" düğmeleri kalktı. "Kuyruktan çıkar" küçük bağlantıya indi. Sohbet zaten açıksa "doğrudan PDF'i paylaş" bağlantısı. Paylaşım menüsü yoksa: PDF indir + 📎 → Belge + gönderildi işareti.
- **Mesaj:** "Sayın …, * Satışınıza ilişkin belge ve sözleşmeniz ekte bilgilerinize sunulmuştur. > Kişisel verileriniz, 6698 sayılı KVKK kapsamında korunmakta olup … Aygün AVM’yi tercih ettiğiniz için teşekkür eder, alışverişinizin hayırlı olmasını dileriz." (WhatsApp'ta * madde, > alıntı biçimi). Satış no mesajdan çıktı.
- **Gerçek cihazda doğrulanacak:** kayıtsız numarada mesaj gönderildikten sonra paylaşım listesinin başında sohbetin görünmesi.
- Test: gonderim-testi 30 (yeniden yazıldı). Diğerleri aynı; lint temiz. Dosyalar: gonderim.js, guvenlik/firestore-kurallari-ASAMA-E.rules (+ damgalı dosyalar).

## V11.52 — Satış ve Teslimat Bilgilendirme Belgesi (premium, müşteriye WhatsApp ile giden PDF) + güçlendirilmiş onay metinleri
- **Belge (app.js `_satisBelgesiHtml`, `buildPremiumPDF` satış dalı):** eski "Satış Sözleşmesi" PDF'i yerine, örnek docx'e (AYGÜN AVM – SATIŞ VE TESLİMAT BİLGİLENDİRME BELGESİ) uygun 6 bölümlü premium A4 düzen: 1 Taraflar · 2 Satın alınan ürünler ve ödeme · 3 Teslimat · 4 Garanti ve yetkili servis · 5 İade ve seçimlik haklar (6502 md. 11, 4 hak) · 6 KVKK bilgilendirmesi + **Müşteri onay kaydı** (iki onay + tarih/saat + satış danışmanı + metin sürümü). Teklif formu eski düzende kalır. Sistem yazı tipleri (dış yazı tipi beklenmez); 1–2 ürünlü satış 2 sayfa, çok ürünlü 3 sayfa; ~1 MB.
- **Teslimat bölümü:** satışta `pdfData.teslimat` (varsayılan) yazılır; PDF hazırlanırken `gonderim.js teslimTazele` sevkiyat kaydındaki GÜNCEL teslim şekli/tarih/saati okur (ürünlerde farklıysa "karma"; kayıt yoksa satış anındaki değer kalır). Adres KVKK maskeli; "müşteri alır" ise "Aygün AVM mağazası".
- **SATICI_BILGI (app.js):** ticaret ünvanı dolu; adres / telefon / vergi dairesi-no / Mersis / web / KEP **boş** — doldurulunca belgede görünür, boşsa hiç görünmez. (Şirket bilgisi uydurulmadı.)
- **Metin değişiklikleri (docx'e göre, hukuki risk azaltma — hukuk danışmanı onaylamalı):** (a) Garanti: "muhatabınız doğrudan üretici ve yetkili servistir" → yetkili servis ile iletişim + "yasal haklarınız bakımından Aygün AVM'ye de başvurabilirsiniz" (satıcının ayıp sorumluluğunu daraltıyor görünmesin); (b) KVKK: WhatsApp'ın yurt dışı merkezli hizmet olduğu, rızanın geri alınabileceği, md. 11 hakları için başvuru yolu eklendi; (c) "Genel koşullar / kampanyalar birleştirilemez" bloğu kaldırıldı.
- **Onay kutuları (index.html):** metinler genişletildi (aydınlatmada işleme amacı/aktarım/haklar; rızada WhatsApp'ın yurt dışı merkezli olduğu + geri alma). Satış kaydındaki `izin` artık `surum:'2'` ve `tel` (rıza verilen numara) içerir; aynı kayıt PDF'e de yazılır.
- Test: yeni `test/satis-belgesi-testi.js` (20: başlık/bölümler, maskeleme, teslimat varyantları, onay kaydı, satıcı alanları, XSS, kurumsal, teklif etkilenmez; `--yaz klasor` örnek HTML üretir), `gonderim-testi` 33 (3 yeni teslimat tazeleme; rozet beklentisi 4), `izin-testi` 11 (sürüm 2 + tel), `t3.html` (satisHtml argümanı kaydeder). Diğerleri aynı; lint temiz.
- Dosyalar: app.js, index.html, gonderim.js (+ damgalı dosyalar). Firestore kuralı/Cloud Function değişmedi.

## V11.53 — kampanya &, sevkiyat ekranı düzeltmeleri, belge gönderim kuyruğu, PDF teslimat notu
- **Kampanya &:** `_buildCampObj` yeniFormat + bağımsız tip regex'lerine ve kampanya süzgeci regex'ine (app.js ~2294) `&` eklendi. "M&G -1,6k(2/A)" artık grup M&G / eşik 2 / rol A okunur (eskiden DIGER/1/ANY → her üründe eşiksiz indirim). `&` içeren grup adı data-grup özniteliğinde ve görünen metinlerde `_esc` ile kaçırılır. Test: test/kampanya-and-testi.js (7).
- **Sevkiyat ekranı:**
  - *Kopyalandı işareti:* "Müşteri + fiyat bilgisini kopyala"ya basılmış açık kayıt = beyaz zemin + yeşil ✓ müşteri adı; basılmamış açık kayıt = kırmızı zemin. Yönetici kopyası da işaret bırakır (hak tüketmez). Kapanmış/iptal kayıtta zemin rengi yok. `kopyalandi(s)` = `s.kopya` dolu.
  - *Sayaç ≠ liste:* çip sayıları (Aktif, Hazırlanıyor…) tüm kayıtları sayıyordu; liste ise mağaza (📍) / servis / depo / arama / tür / tarih süzgeçlerini uyguluyordu. Artık `kapsamUygun` + `turUygun` + `tarihUygun` ortak; çip = listede görünen.
  - *Kenar rengi = durum:* seri bekliyor kırmızı, hazırlanıyor turuncu, depoda hazır mavi, kısmi turkuaz, servis/müşteriye teslim yeşil, tamamlandı gri, iade mor. (Gecikme hâlâ kırmızı çerçeve/zemin.) CSS: sevkiyat-stil.js (`d-<durum>`, `kp-var`, `kp-yok`).
  - *"Satışı yapan: -":* satışta kullanıcı e-postası kaydedilememişse `sales.user = '-'` yazılmış (app.js `currentUser?.Email || '-'`); sevkiyat kaydına `satici:'-'` geçiyor. Artık "Belirtilmemiş (eski kayıt)" gösterilir, listede satıcı etiketi çıkmaz.
- **Belge gönderimi (WhatsApp):** admin toplu silme (☑ Seç / toplu sil → Tümünü seç → Seçilenleri sil); Gönderilen sekmesi yalnız son 2 günü gösterir, daha eskisi yalnız admine görünen **Arşiv** sekmesine geçer (belge kopyası/pdf admin açınca silinir, `arsiv:true`); yönetici dışı kullanıcı belgeyi 1 kez gönderir (gönderince kopya hemen silinir); yönetici gönderince kopya 2 gün saklanır → Gönderilen'de "↻ Yeniden gönder (yönetici)" (`tekrarSayisi`, sevkiyat geçmişine "(tekrar)"). Arşivleme istemci tarafı tembel (kayıt taşınmaz; Cloud Function yok → ek maliyet yok).
- **PDF Teslimat Notu:** metin "Ürün(ler), yukarıda belirtilen adrese teslim edilecektir. Lütfen teslimat anında ürünün dış ambalajını ve kutusunu kontrol ediniz. Görünür bir hasar/problem tespit etmeniz hâlinde teslimat görevlisine tutanak tutturunuz."; sarı kutu kaldırıldı (nötr kutu).
- Test: yeni yonetim-ekrani-testi (15), kampanya-and-testi (7); gonderim-testi 49 (eski SAT-3 artık arşivde; rozet 4); satis-belgesi-testi 21. Test düzeltmesi dışında kodda hata çıkan: kp-yok `border-color` kısayolu durum kenar rengini eziyordu → yalnız üst/sağ/alt renk (kod düzeltildi).

## V11.54 — "Satışı Onayla" donma/ölü düğme sertleştirmesi
- Belirti: Satışı Onayla'ya basınca bir şey olmuyor, sevkiyat ekranına geçilmiyor. Kök neden kesinleşmedi; en olası: satış sonrası zincirdeki `await logSessionResult('satis')` (Firestore onayı bekler) çevrimdışı/"client is offline"/iki site açıkken sonsuz bekleyebilir → `_finalizeMesgul` kilidi açılmaz, sonraki basışlar sessizce yutulur.
- Düzeltme (app.js): istatistik yazımı en çok 2,5 sn beklenir; `Sevkiyat.detayAc` beklenmez; kilit 25 sn sonra kendiliğinden açılır; kilitliyken basış "Satış kaydediliyor, lütfen bekleyin…" bildirimi verir. Satış/sevkiyat kaydı mantığı değişmedi.

## V11.55 (7 Kasım 2026)
- WhatsApp belge kuyruğu (gonderim.js): yönetici için her satırda onay kutusu HER ZAMAN açık (ayrı "Seç / toplu sil" düğmesi kaldırıldı). Üstte "☑ Tümünü seç / ☐ Seçimi kaldır" + "🗑 Seçilenleri sil (n)". Bekleyen / Gönderilen / Çıkarılan / Arşiv sekmelerinde geçerli. Satır adına dokununca detay yine açılır. Destek/satış: onay kutusu yok. Gönderilen sekmesinde "↻ Yeniden gönder (yönetici)" artık her zaman görünür.
- Üst bildirimler (app.js + index.html <style id="v1136d-css">): #change-toast okunaklı (koyu zemin, beyaz 0,95rem yazı, üstte ortada); herhangi bir kod metin/.show/toast-item yazsa da son değişiklikten 3 sn sonra temizlenir (MutationObserver güvenlik ağı). "… aktif oturumu yok" bildirimi tamamen kaldırıldı. showToast 2,5 → 3 sn.
- Testler: gonderim-testi 50 (yeni onay kutusu senaryosu), lint temiz.

## V11.56–V11.57 (7 Kasım 2026)
- Satış sonrası düzeltme: Sevkiyat detayı → "Belgeler ve iletişim" → **"Müşteri bilgisi / onayı düzelt"** (satışı yapan, destek, yönetici; teslim edilmemiş + iptal olmayan kayıt; yöneticide kapalı kayıt da). Seri hatasındaki şık kart (diyalog) görünümünde. Alanlar: Ad Soyad, Telefon, Telefon 2, T.C./pasaport (kurumsalda firma/vergi dairesi/vergi no), e-posta, adres + KVKK/WhatsApp onay kutuları. Doğrulamalar satış formuyla AYNI (app.js `_musteriAlanDogrula`). Hata olursa kart gösterilir, yazılanlar korunur.
- Maskeli kullanıcıda (yönetici dışı) T.C./e-posta/vergi no kutusu BOŞ gelir; boş bırakılırsa DEĞİŞMEZ. Yönetici mevcut değeri görür, boşaltırsa temizlenir.
- Yazılanlar: sales/{no}, sevkiyatlar/{no} (hareket: "Müşteri bilgisi / onay düzeltildi"), gonderimKuyrugu (bekleyen kayıt güncellenir; yoksa ve onay varsa YENİ eklenir, PDF verisi cihazdaki kayıttan, yoksa satış kaydından kurulur; gönderilmiş/çıkarılmış kayda dokunulmaz). Sonradan onay: `izin.sonradan:true` + kullanıcı + saat. Telefon değişirse eski rıza geçersiz → yeniden onay şart.
- Tutar/ürün/ödeme bu ekrandan DEĞİŞMEZ (stok-seri-fiyat sonuçları nedeniyle): gerekirse iade/iptal + yeni satış.
- V11.57: Satışı Onayla'da iki onay kutusu eksik/telefon geçersizse kalıcı uyarı kartı ("Müşteri onayı eksik": Geri dön / Yine de onayla). Adres serbest metin (il/ilçe/mahalle listesi bu ekranda yok).
- V11.55 (önceki): kuyrukta her satırda onay kutusu + toplu sil; üst bildirimler okunaklı ve 3 sn.
- Testler: musteri-duzelt-testi 19, musteri-duzelt-ui-testi 13 (t/ klasöründe; pencere açıldıktan 30 ms sonra autofocus var → testte 120 ms bekle), gonderim 50, satış formu 89, lint temiz.
