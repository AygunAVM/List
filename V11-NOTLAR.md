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
