// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — sevkiyat.js  (Rev 11.2 — giriş noktası + arayüz)
// ═══════════════════════════════════════════════════════════════
//  Modüller:
//    sevkiyat-veri.js    Firestore / transaction / seri doğrulama (DOM yok)
//    sevkiyat-kamera.js  sürekli barkod tarama
//    sevkiyat-belge.js   Depo Fişi / Teslimat Belgesi / Yükleme Listesi / WhatsApp
//    sevkiyat-stil.js    tasarım sistemi (CSS) + SVG ikonlar
//    sevkiyat.js         arayüz + olaylar (bu dosya)
//  app.js ile tek temas noktası: window._svkBridge ve window.Sevkiyat.
//
//  Rev 11.11
//  · ÜRÜN BAZLI TESLİM ŞEKLİ: her ürün "Servis götürür" / "Müşteri alır"; iki grubun ayrı teslim kaydı (teslim alan, imza, zaman) → "Kısmi Teslim".
//  · Müşterinin kendisi aldığı ürünlerde de teslim alan + İMZA zorunlu; serili ürün seri okutulmadan teslim edilemez; serisiz ürünler açıkça listelenir.
//  · Teslim gruplara ayrıldığı için serisiz ürün, başka ürünün serisini beklemeden teslim edilebilir ("Beklemede" takılması giderildi).
//  Rev 11.10
//  · Satış personeli TÜM açık sevkiyatları görür (+ "Sadece benim satışlarım" filtresi); kapanmışlarda yalnız kendi kayıtları.
//  · Müşteri sorgula: telefon / ad / satış no ile sevkiyat + satış + teklif (gizli teklifler hariç); detaydan geri → sonuçlar.
//  · Satış personeli ürün deposunu seçebilir (seri / teslim yetkisi yine depo + yönetici).
//  Rev 11.9
//  · Ürün başına çıkış deposu (Ürünler ve seri numaraları); yeni kayıtlarda depo seçilmeden servise teslim edilemez.
//  · Yönetici Tanımlar: servis / depo / satış noktası listeleri (meta/sevkiyatTanimlar) + açık kayıtlarda toplu depo/servis değişimi.
//  · Kapanmış kayıtlar: son 7 gün (varsayılan) · 30 gün · arşiv tarih aralığı; 30'ar kayıt sayfalama. Liste ekranında depo filtresi.
//  · Servis mesajı: 📦 `Servis` … ürün kodu - depo biçimi.
//  Rev 11.8
//  · Teslimat saati: Gün içinde / 12:00 öncesi / 12:00-15:00 / 15:00-17:00 / 17:00 sonrası (liste sıralaması buna göre).
//  · “Servise mesaj (kopyala)”: WhatsApp'a yapıştırılacak servis bilgi metni (sevkiyat-belge.js › servisMesaji).
//  Rev 11.7
//  · Teslim edilmiş kayıt “Servis Teslim” / “Müşteriye Teslim” görünür (eski “Çıkış Bekliyor” kalktı).
//  · Seri takibi kalıcı: stoğu biten ürün seri takipli sayılmaya devam eder (seriKullanim/__takipliKodlar); yönetici gerekçeyle “seri gerekmez” yapabilir.
//  · Mobilde filtre alanı listeyi örtmez; kapanmış kartlarda ürün + seri + kapanış zamanı; otomatik kapanışta “Tamamlananları göster”.
//  Rev 11.6
//  · Yönetici: listede “seçerek sil” (toplu, gerekçeli, yumuşak silme; seri kilitleri serbest). Tamamlanmış kayıt silinmez.
//  · Her ürün satırında kamera ikonu; aynı üründen çok adet (toplu) varsa rozet + sıralı tarama.
//  · Rapor (Excel/CSV): teslimat tarihi aralığında müşteri ↔ ürün ↔ seri; tüm kullanıcılar.
//  · Çıkış doğrulama OTOMATİK: seriler.json'dan tüm seriler düşünce sevkiyat kendiliğinden kapanır (güvenlik: veri küçülürse durur).
//  · Seri iadesi: kapanmış sevkiyattaki seri stokta yeniden görününce yönetici o seriyi serbest bırakıp yeni sevkiyata alabilir.
//  Rev 11.2 (akış + seri kuralları)
//  · Süreç: Seri girişi → Teslim (servis yetkilisine / müşteriye) → Çıkış doğrulama ve kapanış.
//    "Onayla ve kilitle" kaldırıldı; kapanış, seriler.json'dan serilerin düştüğü doğrulanınca yapılır.
//  · Seri kuralı: Stok Kodu seriler.json'da varsa serisiz çıkış YOK; yoksa seri gerekmez.
//  · Seri beklerken ürün değiştirme / ek ürün ekleme / satır çıkarma (teslimden önce).
//  · İade: teslim edilmiş ürün depoya dönerse kayıt 'İade' olur, seri kilitleri serbest kalır.
//  · Aşağı çekip yenile, kartlarda ürün listesi, "Seri Bekliyor", form notu, müşteri bilgisi kopyala.
//  Rev 11.1 (tasarım + akış)
//  · Yeni liste ekranı: KPI şeridi, tarih filtresi (Geciken / Bugün / Yarın / 7 Gün /
//    Aralık), Servis Teslim ↔ Müşteri Teslim bölümleri, tarihe göre gruplama.
//  · GECİKEN sevkiyatlar her yerde kırmızı (kart, grup başlığı, KPI, detay uyarısı).
//  · İki ayrı teslim türü: SERVİS TESLİMİ (depo → servis → müşteri) ve
//    MÜŞTERİYE TESLİM (depo → müşteri). Detayda 3 ayrı işlem paneli + süreç adımları.
//  · İptal / silme: zorunlu neden, servise çıkmış ürün için geri-alım onayı,
//    seri kilitlerinin bırakılması, İPTALİ GERİ AL (kilitler yeniden alınır),
//    yalnızca iptal edilmişlerde yönetici onaylı SOFT silme (kayıt denetim için saklanır).
//  · Seri hatalarında kurumsal uyarı kartı (neden, karşılaştırma, ne yapmalı);
//    kamerada da kart çıkar, onaylanana kadar tarama durur.
//  Rev 11.0: transaction, seriKullanim kilidi, sürekli kamera, tahsilat, imza — bkz. V11-NOTLAR.md
// ═══════════════════════════════════════════════════════════════
import {
  SERVISLER, DEPOLAR, SAAT_DILIMLERI, saatSira, SATIS_NOKTALARI, tanimYukle, tanimKaydet, tanimDegisti, tanimTemizle, kalemDepoEksik, aralikListeyeYukle, musteriSorgula, DURUMLAR, FILTRELER, B, esc, bugun, yarin, tarihTR, zamanTR, tl,
  eposta, yonetici, depoYetkili, seriYetkili, kalemListe, kalemTamam, durumHesapla, teslimTuru, gecikmeGun, kalemTur, gruplar, grupTeslim, markaServisleri, tumServisAdlari, kalemMarka, servisAdlari, MARKA_SERVIS, kalemKilitli, kismiTeslim, hepsiTeslim, grupPartileri, TUR_AD, TUR_KISA,
  state, kancalar, seriState, seriYukle, seriDogrula, seriSahibi, kalemSerisiz, bilinenOgren, durumEtiket, normSeri, cikisDurumu, tekYenile,
  yukle, gecmisYukle, aralikYukle, guncelle, olustur as olusturKayit, yeniIsSayisi, yetimSatislar, seriKilitleriniEsitle, maskeKimlik, maskeEposta, saticiAdi
} from './sevkiyat-veri.js?v=V11.37-20261031-1042';
import { belgeAc, listeAc, waAc, waTeslimAc, servisMesaji, musteriMetni } from './sevkiyat-belge.js?v=V11.37-20261031-1042';
import { kameraTara } from './sevkiyat-kamera.js?v=V11.37-20261031-1042';
import { stilEkle, ic } from './sevkiyat-stil.js?v=V11.37-20261031-1042';
import * as Magaza from './sevkiyat-magaza.js?v=V11.37-20261031-1042';
import * as Talep from './sevkiyat-talep.js?v=V11.37-20261031-1042';

const $ = id => document.getElementById(id);
const SAYIM_MS = 4 * 60 * 1000;
const IPTAL_NEDENLERI = ['Müşteri vazgeçti', 'Mükerrer / hatalı kayıt', 'Stok veya ürün sorunu', 'Ödeme alınamadı', 'Diğer'];
const LOG_AD = {
  olusturuldu: 'Kayıt açıldı', yetim_satistan_olusturuldu: 'Yetim satıştan açıldı', seri_girildi: 'Seri girildi', seri_silindi: 'Seri silindi',
  kilitlendi: 'Depo onayı verildi (eski)', kilit_acildi: 'Depo onayı geri alındı (eski)',
  servise_teslim: 'Teslim edildi', kalem_teslim_sekli: 'Ürünün teslim şekli değişti', kalem_servis: 'Götüren servis seçildi', teslim_edildi: 'Çıkış doğrulandı · tamamlandı', teslim_geri_alindi: 'Teslim geri alındı',
  kalem_eklendi: 'Ürün eklendi', kalem_degisti: 'Ürün değiştirildi', kalem_cikarildi: 'Ürün satırı çıkarıldı', iade: 'İade / depoya döndü', not_degisti: 'Not güncellendi', iptal: 'İptal edildi', iptal_geri_alindi: 'İptal geri alındı',
  silindi: 'Kayıt silindi', servis_atandi: 'Servis atandı', teslim_turu_degisti: 'Teslim şekli değişti', teslimat_degisti: 'Teslimat tarihi değişti',
  tahsilat_alindi: 'Tahsilat alındı', seri_iade: 'Seri iade edildi / stokta yeniden göründü', seri_gerekmez: 'Yönetici: seri gerekmez', depo_degisti: 'Ürün deposu değişti', toplu_depo: 'Yönetici: toplu depo değişimi', toplu_servis: 'Yönetici: toplu servis değişimi', musteri_kopyalandi: 'Müşteri bilgisi kopyalandı'
};
const IADE_NEDENLERI = ['Müşteri teslimi iptal etti', 'Servis iade etti', 'Hatalı / arızalı ürün', 'Yanlış ürün gönderildi', 'Diğer'];

// Liste filtreleri ek durumu (veri modülündeki `state`e eklenir)
Object.assign(state, { tarih: 'tumu', t1: '', t2: '', tur: 'hepsi', secimModu: false, secim: new Set(), kapSure: 7, kT1: '', kT2: '', depo: '', sayfa: 30, benim: false, sorguEkrani: false, sorgu: { q: '', sonuc: null, hata: '', bekle: false }, magaza: true });
// Teslim formu taslağı (yeniden çizimde kaybolmasın)
// V11.11: her teslim grubunun (servis / müşteri) ayrı taslağı vardır
const bosTaslak = () => ({ alan: '', imza: '', imzaVar: false, hayir: new Set() });   // hayir: bu teslimde YOK seçilen ürün satırları (n)
const taslak = { id: null, g: { servis: bosTaslak(), musteri: bosTaslak() } };
const taslakSifirla = (id, tur) => { if (tur) { taslak.g[tur] = bosTaslak(); return; } taslak.id = id; taslak.g = { servis: bosTaslak(), musteri: bosTaslak() }; };

// ═══ Tarih yardımcıları ════════════════════════════════════════
const dIso = iso => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); };
const toIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const gunEkle = (iso, n) => { const d = dIso(iso); d.setDate(d.getDate() + n); return toIso(d); };
const gunAdi = iso => dIso(iso).toLocaleDateString('tr-TR', { weekday: 'long' });

// ═══ Satış formu: teslimat alanları (sale-extra-fields içine enjekte) ═══
function formEnjekte() {
  // V11.14: satış ekranında teslimat alanı yok — teslimat bilgileri sevkiyat detayında girilir (V11.36b: ulaşılamayan eski gövde silindi)
}
// Ürün başına çıkış deposu (Ürünler ve seri numaraları bölümü)
function depoSatiri(x, duzenle, zorunlu, kam) {
  // V11.19: etiket yok; kutu seri kutusuyla hizalı, boşken gri “Depo seçiniz”
  const liste = DEPOLAR.slice(); if (x.depo && !liste.includes(x.depo)) liste.push(x.depo);   // tanımdan silinmiş eski depo görünür kalır
  if (!duzenle) return '';
  return '<div class="svk-kin svk-kdepo' + (zorunlu && !x.depo ? ' eksik' : '') + (x.depo ? '' : ' bos') + '"><select class="svk-in svk-depo" aria-label="Depo" data-n="' + x.n + '"><option value="">Depo seçiniz</option>' +
    liste.map(d => '<option' + (x.depo === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select>' + (kam ? '<span class="sp40"></span>' : '') + '<span class="dur sp"></span></div>';
}
async function depoDegisti(s, t) {
  const n = t.dataset.n, yeni = t.value, eski = String((s.kalemler[n] || {}).depo || '');
  if (yeni === eski) return;
  const ad = (s.kalemler[n] || {}).urun || '';
  await guncelle(s, sunucu => {
    const e = (sunucu.kalemler || {})[n];
    if (sunucu.kapali || (e && kalemKilitli(sunucu, e))) return { hata: 'Bu ürün bu arada teslim edilmiş/kapanmış; depo değiştirilemez.', tur: 'kapali' };
    return { yaz: { ['kalemler.' + n + '.depo']: yeni } };
  }, 'depo_degisti', (n * 1 + 1) + '. ' + String(ad).slice(0, 40) + ': ' + (eski || '—') + ' → ' + (yeni || '—'));
  yenidenCiz();
}
function formSecenekleri() {
  const doldur = (id, ilk, liste) => { const e = $(id); if (!e) return; const eski = e.value; e.innerHTML = '<option value="">' + ilk + '</option>' + liste.map(x => '<option>' + esc(x) + '</option>').join(''); if (liste.includes(eski)) e.value = eski; };
  doldur('svk-servis', 'Sonra belirlenecek', SERVISLER); doldur('svk-nokta', '—', SATIS_NOKTALARI);
}
function formSifirla() {
  if ($('svk-tarih')) $('svk-tarih').value = bugun();
  ['svk-servis', 'svk-nokta', 'svk-not'].forEach(id => { if ($(id)) $(id).value = ''; });
  if ($('svk-saat')) $('svk-saat').value = SAAT_DILIMLERI[0];
  const r = document.querySelector('input[name="svk-tur"][value="servis"]'); if (r) r.checked = true;
  if ($('svk-servis-wrap')) $('svk-servis-wrap').style.display = '';
}
// app.js finalizeAksiyon satış bloğu bunu doğrulama için çağırır
function formOku() {
  // V11.14: form kalktı → varsayılanlar (bugün · servis götürür); ayrıntılar sevkiyat detayında düzenlenir
  let nokta = Magaza.nokta(); try { nokta = nokta || localStorage.getItem('svk_nokta') || ''; } catch (_) {}
  if (nokta && !SATIS_NOKTALARI.includes(nokta)) nokta = '';
  return { ok: true, veri: { tarih: bugun(), saat: SAAT_DILIMLERI[0] || '', tur: 'servis', servis: '', nokta, not: '' } };
}

// ── Kayıt oluştur (satış tamamlanınca) — app.js `.catch` zinciri için Promise döner ──
async function olustur(sale, v, not) {
  const { kayit } = olusturKayit(sale, v, not);
  sonOlusan = kayit;
  formSifirla();
  if (navigator.onLine === false) toast('Sevkiyat kaydı cihaza kaydedildi: <b>' + esc(sale.id) + '</b> — bağlantı gelince otomatik gönderilecek', []);
  return kayit;
}
kancalar.yazimHata = (id, e) => {
  console.error('sevkiyat yazım hatası:', id, e);
  toast('Sevkiyat kaydı sunucuya YAZILAMADI (' + esc(id) + '): ' + esc((e && e.message) || e) + '. Yönetici Araçları → “Sevkiyat kaydı olmayan satışlar”.', []);
};
kancalar.bekleyen = n => pillGuncelle(n);

// ═══ Toast / bekleyen yazma rozeti ═════════════════════════════
function toast(html, btns) {
  const eski = $('svk-toast'); if (eski) eski.remove();
  const t = document.createElement('div');
  t.id = 'svk-toast'; t.className = 'svk-toast';
  t.innerHTML = '<span>' + html + '</span>';
  (btns || []).forEach(([ad, fn]) => {
    const bt = document.createElement('button'); bt.textContent = ad;
    bt.onclick = () => { fn(); t.remove(); }; t.appendChild(bt);
  });
  const x = document.createElement('button'); x.textContent = '✕'; x.className = 'svk-x'; x.onclick = () => t.remove(); t.appendChild(x);
  document.body.appendChild(t);
  setTimeout(() => { if (t.parentNode) t.remove(); }, (btns && btns.length) ? 14000 : 5000);
}
function pillGuncelle(n, metin) {
  let p = $('svk-pill');
  if (!n && !metin) { if (p) p.remove(); return; }
  if (!p) { p = document.createElement('div'); p.id = 'svk-pill'; p.className = 'svk-pill'; document.body.appendChild(p); }
  p.textContent = metin || (n + ' sevkiyat kaydı gönderilmeyi bekliyor');
}
async function bekleyenKontrol() {
  const b = B(); if (!b || !b.waitForPendingWrites) return;
  let bitti = false;
  const p = b.waitForPendingWrites(b.db).then(() => { bitti = true; if (!state.bekleyen) pillGuncelle(0); }).catch(() => {});
  await Promise.race([p, new Promise(r => setTimeout(r, 1500))]);
  if (!bitti && !state.bekleyen) pillGuncelle(0, 'Cihazda gönderilmeyi bekleyen kayıtlar var');
}

// ═══ Kurumsal uyarı kartı + onay diyalogları ═══════════════════
// h: { tur, detay, message }  (SvkHata ile aynı biçim)
function uyariIcerik(h) {
  const d = h.detay || {}, m = h.message || h.mesaj || '';
  const seriKat = 'Seri doğrulama';
  switch (h.tur) {
    case 'yok':
      return { kat: seriKat, baslik: 'Seri numarası stok listesinde bulunamadı',
        ozet: 'Okutulan seri, SERI_STOK kayıtlarında yer almıyor; bu nedenle sevkiyata eklenemez.',
        satirlar: [['Okutulan seri', d.seri, 1]],
        oneri: 'Etiketi yeniden okutun veya numarayı elle kontrol edin. Seri daha önce başka bir işlemle stoktan çıkmış olabilir (çıkışı yapılan seriler listeden düşer). Emin değilseniz yöneticiye bildirin.' };
    case 'yanlis':
      return { kat: seriKat, baslik: 'Seri numarası bu ürünle eşleşmiyor',
        ozet: 'Okutulan seri başka bir ürüne ait. Yanlış ürünün sevkiyata girmesini önlemek için kayıt yapılmadı.',
        satirlar: [['Okutulan seri', d.seri, 1], ['Seri şu ürüne ait', (d.bulunanAd || '') + ' (' + (d.bulunanKod || '') + ')'], ['Bu satırdaki ürün', (d.beklenenAd || '') + ' (' + (d.beklenenKod || '') + ')']],
        oneri: 'Bu satırdaki ürünün etiketini okutun. Doğru ürünse ve yine de reddediliyorsa stok kaydını yöneticiye bildirin.' };
    case 'eslesme_yok':
      return { kat: seriKat, baslik: 'Bu sevkiyatta eşleşen boş satır yok',
        ozet: 'Okutulan seri geçerli bir ürüne ait ancak bu sevkiyatta o ürün için seri bekleyen satır bulunmuyor.',
        satirlar: [['Okutulan seri', d.seri, 1], ['Seri şu ürüne ait', (d.bulunanAd || '') + ' (' + (d.bulunanKod || '') + ')']],
        oneri: 'Doğru sevkiyatta olduğunuzu ve ürünün bu sevkiyata ait olduğunu kontrol edin.' };
    case 'cikis':
      return { kat: seriKat, baslik: 'Seri için stok çıkışı yapılmış',
        ozet: 'Bu seri numarası SERI_STOK kaydında çıkış yapılmış (Kalan sıfır) görünüyor.',
        satirlar: [['Okutulan seri', d.seri, 1], ['Kalan', String(d.kalan)], ['Ürün', d.ad || '']],
        oneri: 'Fiziksel cihazı ve etiketini kontrol edin. Cihaz doğruysa ve stok kaydı hatalıysa yöneticiye bildirin.' };
    case 'kullanilmis':
      return { kat: seriKat, baslik: 'Seri başka bir sevkiyatta kullanılmış',
        ozet: 'Bir seri numarası aynı anda yalnızca tek sevkiyatta yer alabilir.',
        satirlar: [['Okutulan seri', d.seri, 1], ['Kullanıldığı sevkiyat', d.saleNo || ''], ['Müşteri', d.musteri || '—']],
        oneri: 'Ürünün doğru olduğunu doğrulayın. Önceki sevkiyat iptal edildiyse yönetici seri kilidini o iptal ile serbest bırakır.' +
          ((d.seri && seriSahibi(d.seri) && seriSahibi(d.seri).kalan > 0) ? ' Bu seri şu an stokta görünüyor: önceki teslim iade edilmiş olabilir — yönetici seri numarasını yeniden girerek “seri iadesi” ile serbest bırakabilir.' : '') };
    case 'ayni_sevkiyat':
      return { kat: seriKat, baslik: 'Seri bu sevkiyatta zaten girilmiş',
        ozet: 'Aynı seri numarası aynı sevkiyatın başka bir satırında kayıtlı.',
        satirlar: [['Okutulan seri', d.seri, 1], ['Kayıtlı satır', d.n != null ? (Number(d.n) + 1) + '. satır' : '']],
        oneri: 'Her ürün için farklı bir cihazın etiketini okutun.' };
    case 'yolda':
      return { kat: seriKat, baslik: 'Bu seri şu an yolda', ikCls: 'amb',
        ozet: 'Seri, depodan mağazaya giden bir talepte görünüyor; teslim alınmadan satışa/sevkiyata girmez.',
        satirlar: [['Okutulan seri', d.seri, 1], ['Talep', (d.depo || '') + ' → ' + (d.magaza || '')]],
        oneri: 'Mağaza talebi “Teslim aldım” ile kapatınca seri kullanılabilir. Talep hatalıysa yönetici talebi iptal edebilir.' };
    case 'liste':
      return { kat: seriKat, baslik: 'Doğrulama listesi yüklenemedi', ozet: m,
        oneri: 'İnternet bağlantınızı kontrol edip tekrar deneyin. Liste yüklenmeden seri kaydedilemez.' };
    case 'kilitli': return { kat: 'İşlem uyarısı', baslik: 'Sevkiyat teslim edilmiş', ozet: m, oneri: 'Teslimden sonra ürün/seri değiştirilemez. Değişiklik gerekiyorsa yönetici teslimi geri alabilir.', ikCls: 'amb' };
    case 'cikis_bekliyor': return { kat: 'Çıkış doğrulama', baslik: 'Çıkışı görünmeyen seri var', ozet: m,
        satirlar: (d.seriler || []).map((x, i) => [i === 0 ? 'Henüz stokta görünen' : '', x, 1]),
        oneri: 'Ürünün diğer programda çıkışı yapıldıktan sonra seriler.json (günlük) güncellenir. Veri yenilenince tekrar deneyin.', ikCls: 'amb' };
    case 'kapali': return { kat: 'İşlem uyarısı', baslik: 'Sevkiyat kapanmış', ozet: m, ikCls: 'gri' };
    case 'cevrimdisi': return { kat: 'İşlem uyarısı', baslik: 'İnternet bağlantısı gerekli', ozet: m, ikCls: 'amb' };
    case 'eksik': return { kat: 'İşlem uyarısı', baslik: 'Eksik bilgi', ozet: m, ikCls: 'amb' };
    default: return { kat: 'İşlem uyarısı', baslik: 'İşlem tamamlanamadı', ozet: m, ikCls: 'gri' };
  }
}
const uyariKisa = h => uyariIcerik(h).baslik;

// Genel diyalog. Dönüş: onaylanırsa {alan:değer…} nesnesi, vazgeçilirse null
function diyalog(o) {
  return new Promise(res => {
    const m = document.createElement('div'); m.className = 'svk-mdl';
    const rows = (o.satirlar || []).filter(r => r[1] !== undefined && r[1] !== '')
      .map(r => '<div><dt>' + esc(r[0]) + '</dt><dd' + (r[2] ? ' class="mono"' : '') + '>' + esc(r[1]) + '</dd></div>').join('');
    m.innerHTML =
      '<div class="svk-dlg" role="dialog" aria-modal="true">' +
        '<div class="svk-dlg-ust"><span class="svk-dlg-ik ' + (o.ikCls || '') + '">' + ic(o.ikon || 'alert', 22) + '</span>' +
          '<div><div class="svk-dlg-kat ' + (o.katCls || '') + '">' + esc(o.kat || '') + '</div><div class="svk-dlg-bas">' + esc(o.baslik || '') + '</div></div></div>' +
        (o.ozet ? '<p class="svk-dlg-ozet">' + esc(o.ozet).replace(/\n/g, '<br>') + '</p>' : '') +
        (rows ? '<dl class="svk-dl">' + rows + '</dl>' : '') +
        (o.oneri ? '<div class="svk-oneri"><b>Ne yapmalı?</b> ' + esc(o.oneri) + '</div>' : '') +
        (o.govde ? '<div class="svk-dlg-gov">' + o.govde + '</div>' : '') +
        '<div class="svk-dlg-hata" style="display:none"></div>' +
        '<div class="svk-dlg-alt">' + (o.vazgec ? '<button class="svk-btn" data-d="vazgec">' + esc(o.vazgec) + '</button>' : '') +
          '<button class="svk-btn ' + (o.tehlike ? 'ana' : 'koyu') + '" data-d="tamam">' + esc(o.tamam || 'Tamam') + '</button></div>' +
      '</div>';
    document.body.appendChild(m);
    const kapat = v => { m.remove(); res(v); };
    const hata = m.querySelector('.svk-dlg-hata');
    const tamam = m.querySelector('[data-d="tamam"]'), vazgec = m.querySelector('[data-d="vazgec"]');
    tamam.onclick = () => {
      const vals = {};
      m.querySelectorAll('[data-f]').forEach(el => { vals[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; });
      if (o.dogrula) { const msg = o.dogrula(vals); if (msg) { hata.textContent = msg; hata.style.display = 'block'; return; } }
      kapat(o.vazgec ? vals : true);
    };
    if (vazgec) vazgec.onclick = () => kapat(null);
    m.addEventListener('keydown', e => { if (e.key === 'Escape') kapat(vazgec ? null : true); });
    setTimeout(() => { const f = m.querySelector('[data-f]:not([type=checkbox])') || tamam; f.focus(); }, 30);
  });
}
function uyariGoster(h) {
  const u = uyariIcerik(h);
  return diyalog({ ikon: u.ikCls === 'gri' ? 'info' : 'alert', ikCls: u.ikCls || '', kat: u.kat, katCls: u.ikCls ? 'gri' : '', baslik: u.baslik, ozet: u.ozet, satirlar: u.satirlar, oneri: u.oneri, tamam: 'Anladım' });
}
const onay = (baslik, ozet, tamam, tehlike) => diyalog({ ikon: tehlike ? 'alert' : 'info', ikCls: tehlike ? '' : 'gri', kat: 'Onay', katCls: tehlike ? '' : 'gri', baslik, ozet, tamam: tamam || 'Onayla', vazgec: 'Vazgeç', tehlike: !!tehlike });
kancalar.uyari = e => uyariGoster(e);

// ═══ Takip ekranı ══════════════════════════════════════════════
function kok() {
  let o = $('svk-overlay');
  if (o) return o;
  o = document.createElement('div'); o.id = 'svk-overlay'; o.className = 'svk-overlay';
  o.addEventListener('click', tikla);
  ptrBagla(o);
  o.addEventListener('change', degisti);
  o.addEventListener('input', e => {
    if (e.target.id === 'svk-ara') { state.ara = e.target.value; const l = o.querySelector('.svk-liste'); if (l) l.innerHTML = listeHtml(); }
    else if (e.target.id && e.target.id.indexOf('svk-alan-') === 0) taslak.g[e.target.id.slice(9)].alan = e.target.value;
  });
  // El terminali / okuyucu Enter'ı: değeri işle, sonra sıradaki boş satıra geç
  o.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('svk-seri')) {
      e.preventDefault(); e.target.dataset.enter = '1'; e.target.blur();
      setTimeout(() => { if (e.target) delete e.target.dataset.enter; }, 1500);
    }
  });
  document.body.appendChild(o);
  return o;
}
// ── Yenileme (düğme + aşağı çekme) ────────────────────────────
// Maliyet: liste yenileme = aktif kayıtlar kadar okuma; 15 sn soğuma (çekme hareketi için), tek kayıt = 1 okuma.
let sonYenile = 0;
async function yenileGenel(zorla) {
  if (!zorla && Date.now() - sonYenile < 15000) return false;
  sonYenile = Date.now();
  try {
    const s = state.acik && state.list.get(state.acik);
    if (s) await Promise.all([tekYenile(s.saleNo), seriYukle(true)]);
    else { await Promise.all([yukle(true), seriYukle(true)]); bilinenOgren(); await otomatikKapat(); if (kapaliFiltre()) await kapaliVeriYukle(true); yerelSayimiYansit(); }
  } catch (er) { await hataTekrar('Yenilenemedi: ' + (er.message || er)); }
  yenidenCiz();
  return true;
}
function ptrBagla(o) {
  const ESIK = 70;
  const p = { on: false, y: 0, d: 0, sc: null };
  const el = () => {
    let e = o.querySelector('#svk-ptr');
    if (!e) { e = document.createElement('div'); e.id = 'svk-ptr'; e.className = 'svk-ptr'; e.innerHTML = ic('refresh', 18); o.appendChild(e); }
    const h = o.querySelector('.svk-head'); e.style.top = (h ? h.getBoundingClientRect().bottom - o.getBoundingClientRect().top : 56) + 'px';
    return e;
  };
  const guncelle = d => { const e = el(); e.classList.toggle('on', d > 8); e.classList.toggle('hazir', d >= ESIK); e.style.transform = 'translate(-50%,' + (Math.min(d, 110) * 0.55 - 40) + 'px) rotate(' + Math.min(d * 3, 270) + 'deg)'; };
  const mesaj = m => { const e = document.createElement('div'); e.className = 'svk-ptr-m'; e.textContent = m; const h = o.querySelector('.svk-head'); e.style.top = ((h ? h.getBoundingClientRect().bottom : 56) + 8) + 'px'; o.appendChild(e); setTimeout(() => e.remove(), 1400); };
  o.addEventListener('touchstart', e => {
    const sc = e.target.closest && e.target.closest('.svk-scroll');
    p.on = !!sc && sc.scrollTop <= 0 && e.touches.length === 1 && !(e.target.closest && e.target.closest('canvas,input,textarea,select'));
    p.sc = sc; p.y = e.touches[0].clientY; p.d = 0;
  }, { passive: true });
  o.addEventListener('touchmove', e => {
    if (!p.on) return;
    const d = e.touches[0].clientY - p.y;
    if (d <= 0 || (p.sc && p.sc.scrollTop > 0)) { p.d = 0; guncelle(0); return; }
    p.d = d; guncelle(d);
  }, { passive: true });
  const bitir = async () => {
    if (!p.on) return;
    const d = p.d; p.on = false; p.d = 0;
    if (d < ESIK) { guncelle(0); return; }
    const e = el(); e.classList.add('on', 'don'); e.style.transform = 'translate(-50%,16px)';
    const yapildi = await yenileGenel(false);
    const e2 = o.querySelector('#svk-ptr'); if (e2) e2.remove();
    mesaj(yapildi ? 'Güncellendi' : 'Zaten güncel');
  };
  o.addEventListener('touchend', bitir); o.addEventListener('touchcancel', bitir);
}

async function ac() {
  kok().style.display = 'flex';
  document.body.style.overflow = 'hidden';
  state.acik = null;
  kok().innerHTML = '<div class="svk-panel"><div class="svk-bos">Yükleniyor…</div></div>';
  try { await Promise.all([seriYukle(false), yukle(false), tanimYukle(false)]); if (kapaliFiltre()) await kapaliVeriYukle(false); } catch (e) {
    console.error('sevkiyat yukle:', e);
    kok().innerHTML = '<div class="svk-panel"><div class="svk-bos">Liste yüklenemedi: ' + esc(e.message || e) + '<br><br><button class="svk-btn" data-act="kapat">Kapat</button></div></div>'; return;
  }
  bilinenOgren();
  await otomatikKapat();
  yerelSayimiYansit();
  listeCiz();
}
function kapat() { const o = $('svk-overlay'); if (o) o.style.display = 'none'; document.body.style.overflow = ''; state.acik = null; state.yonetim = false; state.sorguEkrani = false; }
// Geri tuşu köprüsü (app.js): 0 kapalı · 1 liste · 2 detay / yönetici araçları
const derinlik = () => { const o = $('svk-overlay'); if (!o || o.style.display === 'none') return 0; if (state.acik && state.sorguEkrani) return 3; return (state.acik || state.yonetim || state.sorguEkrani) ? 2 : 1; };
function geri() {
  const d = derinlik();
  if (d >= 3) { state.acik = null; sorguCiz(); return true; }
  if (d >= 2) { state.acik = null; state.yonetim = false; listeCiz(); return true; }
  if (d === 1) { kapat(); return true; }
  return false;
}
const kapaliFiltre = () => ['teslim_edildi', 'iptal', 'iade'].includes(state.filtre);
// Kapanmış kayıtlar penceresi: son 7 gün (varsayılan) · son 30 gün · tarih aralığı (arşiv). Eski kayıtlar silinmez; yalnızca istenince yüklenir.
const kapanisMs = s => (s.iade && s.iade.t) || (s.iptalBilgi && s.iptalBilgi.t) || (s.teslimEdildi && s.teslimEdildi.t) || s.ts || 0;
function kapPencere(s) {
  if (!s.kapali) return true;
  if (state.kapSure === 'aralik') {
    const g = new Date(kapanisMs(s)), iso = toIso(g);
    return (!state.kT1 || iso >= state.kT1) && (!state.kT2 || iso <= state.kT2);
  }
  return kapanisMs(s) >= Date.now() - state.kapSure * 864e5;
}
async function kapaliVeriYukle(force) {
  if (state.kapSure === 'aralik') {
    if (state.kT1 && state.kT2) await aralikListeyeYukle(gunEkle(state.kT1, -45), gunEkle(state.kT2, 7));
    return;
  }
  await gecmisYukle(force, state.kapSure);
}

// ── Filtreleme ─────────────────────────────────────────────────
function tarihUygun(s) {
  const f = state.tarih, t = s.teslimTarihi, b = bugun();
  if (f === 'tumu') return true;
  if (f === 'geciken') return !s.kapali && t < b;
  if (f === 'bugun') return t === b;
  if (f === 'yarin') return t === yarin();
  if (f === 'hafta') return t >= b && t <= gunEkle(b, 6);
  if (f === 'aralik') return (!state.t1 || t >= state.t1) && (!state.t2 || t <= state.t2);
  return true;
}
function durumUygun(s) {
  const f = state.filtre;
  if (f === 'aktif') return !s.kapali;
  if (f === 'serviste') return s.durum === 'serviste' || s.durum === 'kismi';
  return s.durum === f;
}
function goruntulenen() {
  const q = state.ara.trim().toLowerCase();
  const sirala = kapaliFiltre() ? (a, b) => (b.ts || 0) - (a.ts || 0)
    : (a, b) => (a.teslimTarihi + saatSira(a.teslimSaati)).localeCompare(b.teslimTarihi + saatSira(b.teslimSaati));
  return [...state.list.values()].map(s => ({ ...s, durum: durumHesapla(s) })).filter(s => {
    if (s.silindi) return false;
    if (!durumUygun(s)) return false;
    if (state.tur !== 'hepsi' && !gruplar(s).includes(state.tur)) return false;
    if (kapaliFiltre() ? !kapPencere(s) : !tarihUygun(s)) return false;
    if (state.servis && !servisAdlari(s).includes(state.servis)) return false;
    if (state.depo && !kalemListe(s).some(k => k.depo === state.depo)) return false;
    if (state.benim && s.satici !== eposta()) return false;
    if (state.magaza && Magaza.kapsam() === 'magaza') { const nk = Magaza.nokta(); if (nk && s.satisNoktasi !== nk) return false; }   // V11.23: varsayılan “benim mağazam”
    if (!q) return true;
    const hay = [s.saleNo, s.musteri, s.telefon, s.adres, saticiAdi(s), servisAdlari(s).join(' '), ...kalemListe(s).map(k => k.seriNo + ' ' + k.urun + ' ' + k.kod), s.not].join(' ').toLowerCase();
    return hay.includes(q);
  }).sort(sirala);
}
const tarihEtiketi = () => ({ tumu: 'Tüm tarihler', geciken: 'Geciken teslimatlar', bugun: tarihTR(bugun()), yarin: tarihTR(yarin()),
  hafta: tarihTR(bugun()) + ' – ' + tarihTR(gunEkle(bugun(), 6)), aralik: (state.t1 ? tarihTR(state.t1) : '…') + ' – ' + (state.t2 ? tarihTR(state.t2) : '…') }[state.tarih]);

// ── Kart bileşenleri ───────────────────────────────────────────
function rozet(d, s) { const x = DURUMLAR[d] || DURUMLAR.barkod_bekliyor; return '<span class="svk-pill2" style="color:' + x.renk + ';background:' + x.bg + '">' + durumEtiket(d, s) + '</span>'; }

const silinebilir = s => !s.silindi && (!s.teslimEdildi || !!s.iade);
// V11.19: ürün satırı özeti — kod · depo · kim götürüyor / müşteri alır (liste kartı ve detay ortak)
const seriVar = x => !!(x.seriNo && String(x.seriNo).trim());
const kalemYesil = (s, x) => seriVar(x) || !!x.teslim || !!grupTeslim(s, kalemTur(s, x));    // yeşil: seri okutuldu ya da teslim edildi (serisiz ürün kendiliğinden yeşil olmaz)
function ozetHtml(s, x, kodGoster) {
  const tt = kalemTur(s, x), tg = grupTeslim(s, tt), p = [];
  if (kodGoster && x.kod) p.push('<span>' + esc(x.kod) + '</span>');
  p.push(x.depo ? '<span>' + esc(x.depo) + '</span>' : (s.kapali ? '' : '<span class="eksik">Depo seçilmedi</span>'));
  p.push(tt === 'musteri' ? '<span class="m">' + ic('user', 12) + 'Müşteri alır' + (tg ? ' ✓' : '') + '</span>'
    : '<span class="s">' + ic('truck', 12) + 'Servise' + (x.servis ? ' · ' + esc(x.servis) : '') + (tg ? ' ✓' : '') + '</span>');
  return '<span class="svk-oz">' + p.filter(Boolean).join('<i>·</i>') + '</span>';
}
function seriSayim(k) { const g = k.filter(x => !kalemSerisiz(x)); return { gerek: g.length, dolu: g.filter(seriVar).length }; }
function kartHtml(s) {
  const k = kalemListe(s), sy = seriSayim(k), tam = sy.dolu, gec = gecikmeGun(s);
  const G = gruplar(s), karma = G.length > 1, musteri = G.length === 1 && G[0] === 'musteri';
  const tah = Number(s.tahsilatTutari) > 0 && !s.tahsilatAlindi ? '<span class="svk-cp am">' + ic('wallet', 13) + esc(tl(s.tahsilatTutari)) + '</span>' : '';
  const yuzde = sy.gerek ? Math.round(tam * 100 / sy.gerek) : 100;
  const GOSTER = s.kapali ? 99 : 4;       // kapanmış kayıtta tüm ürünler + seri numaraları görünür
  const urunler = '<ul class="svk-ur">' + k.slice(0, GOSTER).map(x => {
    const ok = kalemYesil(s, x);
    return '<li class="' + (ok ? 'ok' : '') + '"><span class="ik">' + (ok ? ic('check', 12) : '') + '</span><span class="ad"><b>' + esc(x.urun || x.kod) + '</b>' + ozetHtml(s, x, true) + (s.kapali && x.seriNo ? '<small class="mono">' + esc(x.seriNo) + '</small>' : '') + '</span></li>';
  }).join('') + (k.length > GOSTER ? '<li class="d">+ ' + (k.length - GOSTER) + ' ürün daha</li>' : '') + '</ul>';
  const kapZ = s.iade ? ['İade', s.iade.t] : s.iptal ? ['İptal', (s.iptalBilgi || {}).t] : s.teslimEdildi ? ['Tamamlandı', s.teslimEdildi.t] : null;
  const kapChip = s.kapali && kapZ && kapZ[1] ? '<span class="svk-cp">' + ic('clock', 13) + kapZ[0] + ' · ' + zamanTR(kapZ[1]) + '</span>' : '';
  const cd = s.servisTeslim && !s.kapali ? cikisDurumu(s) : null;
  const cikis = cd ? (cd.hazir ? '<span class="svk-cp ok">' + ic('check', 13) + 'Çıkış doğrulandı · tamamlanabilir</span>'
    : '<span class="svk-cp">' + ic('clock', 13) + 'Çıkış: ' + cd.satirlar.filter(x => x.durum === 'cikti' || x.durum === 'serisiz').length + '/' + k.length + '</span>') : '';
  const depoChip = (!s.kapali && kalemDepoEksik(s)) ? '<span class="svk-cp am">' + ic('alert', 13) + 'Depo seçilmedi</span>' : '';
  const notChip = s.not ? '<span class="svk-cp am svk-notchip" title="' + esc(s.not) + '">' + ic('msg', 13) + esc(s.not.length > 34 ? s.not.slice(0, 34) + '…' : s.not) + '</span>' : '';
  const secMod = state.secimModu && yonetici(), sec = secMod && state.secim.has(s.saleNo), secilemez = secMod && !silinebilir(s);
  return '<div class="svk-kart t-' + (musteri ? 'musteri' : 'servis') + (karma ? ' karma' : '') + (gec ? ' gec' : '') + (s.iptal ? ' iptal' : '') + (sec ? ' secili' : '') + (secilemez ? ' secilemez' : '') + '" data-act="' + (secMod ? (secilemez ? 'secyok' : 'sec') : 'detay') + '" data-id="' + esc(s.saleNo) + '">' +
    '<div class="svk-r1">' + (secMod ? '<span class="svk-cb2' + (sec ? ' on' : '') + '">' + (sec ? ic('check', 13) : '') + '</span>' : '') + '<b>' + esc(s.musteri) + '</b>' + rozet(s.durum, s) + '</div>' +
    urunler +
    '<div class="svk-r3">' +
      '<span class="svk-cp' + (gec ? ' kzh' : '') + '">' + ic('calendar', 13) + tarihTR(s.teslimTarihi) + (s.teslimSaati ? ' · ' + esc(s.teslimSaati) : '') + '</span>' +
      (gec ? '<span class="svk-cp kz">' + ic('alert', 13) + gec + ' gün gecikti</span>' : '') +
      (karma
        ? '<span class="svk-cp mv">' + ic('truck', 13) + esc(servisAdlari(s).join(' · ') || 'Servis') + (grupTeslim(s, 'servis') ? ' ✓' : '') + '</span><span class="svk-cp yr">' + ic('user', 13) + 'Müşteri alır' + (grupTeslim(s, 'musteri') ? ' ✓' : '') + '</span>'
        : '<span class="svk-cp ' + (musteri ? 'yr' : 'mv') + '">' + ic(musteri ? 'user' : 'truck', 13) + (musteri ? 'Müşteriye teslim' : esc(servisAdlari(s).join(' · ') || 'Servise teslim')) + '</span>') +
      '<span class="svk-cp">' + ic('box', 13) + (sy.gerek ? tam + '/' + sy.gerek + ' seri' : 'Serisiz') + '</span>' + kapChip + cikis + depoChip + tah + notChip +
    '</div>' +
    '<div class="svk-r2">' + (s.telefon ? ic('phone', 12) + ' ' + esc(s.telefon) : '') + (s.satici ? ' <span class="svk-satici" title="Satışı yapan">' + ic('user', 12) + ' ' + esc(saticiAdi(s)) + '</span>' : '') + '</div>' +
    (s.iptal || s.kapali || s.servisTeslim ? '' : '<div class="svk-bar' + (gec ? ' kz' : '') + '"><i style="width:' + yuzde + '%"></i></div>') + '</div>';
}
function grupBasligi(t, say) {
  const b = bugun(), y = yarin(), g = gunAdi(t), n = gecikmeGun({ teslimTarihi: t, kapali: false });
  let cls = '', ic1 = '', html;
  if (t < b) { cls = 'kz'; ic1 = ic('alert', 15); html = 'Geciken <small>' + tarihTR(t) + ' · ' + g + ' · ' + n + ' gün</small>'; }
  else if (t === b) { cls = 'bg'; html = 'Bugün <small>' + tarihTR(t) + ' · ' + g + '</small>'; }
  else if (t === y) html = 'Yarın <small>' + tarihTR(t) + ' · ' + g + '</small>';
  else html = tarihTR(t) + ' <small>' + g + '</small>';
  return '<div class="svk-gbas ' + cls + '">' + ic1 + '<span>' + html + '</span><span class="say">' + say + '</span></div>';
}
function listeHtml() {
  const list = goruntulenen();
  if (!list.length) return '<div class="svk-bos">' + ic('box', 34) + 'Bu filtreyle eşleşen sevkiyat yok.</div>';
  const sayfaBtn = n => n > 0 ? '<button class="svk-btn tam" style="margin:10px 0" data-act="daha">Daha fazla göster (' + n + ' kayıt daha)</button>' : '';
  if (kapaliFiltre()) return '<div class="svk-bos" style="padding:6px 2px;text-align:left;font-size:.78rem">' + list.length + ' kayıt · ' +
      (state.kapSure === 'aralik' ? 'seçilen tarih aralığı' : 'son ' + state.kapSure + ' gün') + (state.kapSure === 'aralik' ? '' : ' (daha eski kayıtlar için “Arşiv: tarih aralığı”)') + '</div>' +
    list.slice(0, state.sayfa).map(kartHtml).join('') + sayfaBtn(list.length - state.sayfa);
  const gruplar = new Map();
  list.forEach(s => { if (!gruplar.has(s.teslimTarihi)) gruplar.set(s.teslimTarihi, []); gruplar.get(s.teslimTarihi).push(s); });
  let html = '', gosterilen = 0;
  for (const t of [...gruplar.keys()].sort()) {
    if (gosterilen >= state.sayfa) break;
    const g = gruplar.get(t); html += grupBasligi(t, g.length) + g.map(kartHtml).join(''); gosterilen += g.length;
  }
  return html + sayfaBtn(list.length - gosterilen);
}

function secBarHtml() {
  if (!(state.secimModu && yonetici())) return '';
  const n = state.secim.size;
  return '<div class="svk-secbar"><span><b>' + n + '</b> kayıt seçildi</span><button class="svk-btn kucuk" data-act="sectum">Tümünü seç</button>' +
    '<button class="svk-btn kucuk tehlike" data-act="toplusil"' + (n ? '' : ' disabled') + '>' + ic('trash', 14) + ' Sil</button><button class="svk-btn kucuk" data-act="secmod">Vazgeç</button></div>';
}
function listeCiz(filtreyeGit) {
  state.yonetim = false; state.sorguEkrani = false;
  const eskiKay = kok().querySelector('.svk-scroll');
  const top = eskiKay ? eskiKay.scrollTop : 0;
  const hepsi = [...state.list.values()].filter(s => !s.silindi).map(s => ({ ...s, durum: durumHesapla(s) }));
  const aktif = hepsi.filter(s => !s.kapali);
  const b = bugun(), y = yarin();
  const say = {
    geciken: aktif.filter(s => s.teslimTarihi < b).length, bugun: aktif.filter(s => s.teslimTarihi === b).length, yarin: aktif.filter(s => s.teslimTarihi === y).length,
    hafta: aktif.filter(s => s.teslimTarihi >= b && s.teslimTarihi <= gunEkle(b, 6)).length,
    barkod: aktif.filter(s => s.durum === 'barkod_bekliyor').length, serviste: aktif.filter(s => s.durum === 'serviste' || s.durum === 'kismi').length,
    hepsi: aktif.length, servis: aktif.filter(s => gruplar(s).includes('servis')).length, musteri: aktif.filter(s => gruplar(s).includes('musteri')).length
  };
  const durumSay = {}; hepsi.forEach(s => { if (s.kapali && !kapPencere(s)) return; durumSay[s.durum] = (durumSay[s.durum] || 0) + 1; });
  durumSay.aktif = aktif.length;
  const kpi = (k, sayi, etiket, kz, on) => '<button class="svk-kpi' + (kz && sayi ? ' kirmizi' : '') + (on ? ' on' : '') + '" data-act="kpi" data-k="' + k + '"><b>' + sayi + '</b><span>' + etiket + '</span></button>';
  const filtreler = FILTRELER;
  const tchip = (k, l, cls) => '<button class="svk-chip' + (cls ? ' ' + cls : '') + (state.tarih === k ? ' on' : '') + '" data-act="tarih" data-k="' + k + '">' + l + (k === 'geciken' && say.geciken ? ' <i>' + say.geciken + '</i>' : '') + '</button>';
  const kchip = (k, l) => '<button class="svk-chip' + (state.kapSure === k ? ' on' : '') + '" data-act="kapsure" data-k="' + k + '">' + l + '</button>';
  kok().innerHTML =
    '<div class="svk-panel">' +
      '<div class="svk-head"><div class="svk-ht"><h1>' + ic('truck', 20) + ' Sevkiyat Yönetimi</h1>' +
        '<p><b>' + say.hepsi + '</b> aktif sevkiyat' + (say.geciken ? ' · <span class="kz">' + say.geciken + ' geciken</span>' : '') + ' · ' + new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', weekday: 'long' }) + '</p></div>' +
        '<div class="svk-hbtns">' + (yonetici() ? '<button class="svk-ib' + (state.secimModu ? ' on' : '') + '" data-act="secmod" title="Seçerek sil" aria-label="Seçerek sil">' + ic('check', 18) + '</button><button class="svk-ib" data-act="yonetim" title="Yönetici araçları" aria-label="Yönetici araçları">' + ic('tools', 18) + '</button>' : '') +
        '<button class="svk-ib" data-act="sorgu" title="Müşteri sorgula" aria-label="Müşteri sorgula">' + ic('search', 18) + '</button>' +
        '<button class="svk-ib" data-act="rapor" title="Seri / müşteri raporu (Excel)" aria-label="Rapor">' + ic('file', 18) + '</button>' +
        '<button class="svk-ib" data-act="yazdir" title="Yükleme listesi yazdır" aria-label="Yükleme listesi">' + ic('printer', 18) + '</button>' +
        '<button class="svk-ib" data-act="yenile" title="Yenile" aria-label="Yenile">' + ic('refresh', 18) + '</button>' +
        '<button class="svk-ib" data-act="kapat" title="Kapat" aria-label="Kapat">' + ic('x', 18) + '</button></div></div>' +
      '<div class="svk-scroll">' +
        '<div class="svk-kpis">' + kpi('geciken', say.geciken, 'Geciken', true, state.tarih === 'geciken') + kpi('bugun', say.bugun, 'Bugün', false, state.tarih === 'bugun') +
          kpi('yarin', say.yarin, 'Yarın', false, state.tarih === 'yarin') + kpi('barkod', say.barkod, 'Seri bekleyen', false, state.filtre === 'barkod_bekliyor') +
          kpi('serviste', say.serviste, 'Teslim edilen', false, state.filtre === 'serviste') + '</div>' +
        '<div class="svk-filt">' +
          '<div class="svk-seg">' +
            '<button class="' + (state.tur === 'hepsi' ? 'on' : '') + '" data-act="tur" data-k="hepsi">Tümü <i>' + say.hepsi + '</i></button>' +
            '<button class="' + (state.tur === 'servis' ? 'on' : '') + '" data-act="tur" data-k="servis">' + ic('truck', 14) + ' Servis Teslim <i>' + say.servis + '</i></button>' +
            '<button class="' + (state.tur === 'musteri' ? 'on' : '') + '" data-act="tur" data-k="musteri">' + ic('user', 14) + ' Müşteri Teslim <i>' + say.musteri + '</i></button></div>' +
          '<div class="svk-ara"><div class="svk-arakutu">' + ic('search', 16) + '<input id="svk-ara" placeholder="Müşteri, ürün, telefon, satış no, seri no ara…" value="' + esc(state.ara) + '" autocomplete="off"></div>' +
            '<select id="svk-fservis" aria-label="Servis"' + (state.tur === 'musteri' ? ' disabled' : '') + '><option value="">Tüm servisler</option>' +
              filtreServisleri().map(x => '<option' + (state.servis === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' +
              '<select id="svk-fdepo" aria-label="Depo"><option value="">Tüm depolar</option>' + DEPOLAR.map(x => '<option' + (state.depo === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' +
          (kapaliFiltre()
            ? '<div class="svk-etiket">' + ic('calendar', 12) + ' Kapanış tarihi</div>' +
              '<div class="svk-chips">' + kchip(7, 'Son 7 gün') + kchip(30, 'Son 30 gün') + kchip('aralik', 'Arşiv: tarih aralığı') + '</div>' +
              (state.kapSure === 'aralik' ? '<div class="svk-aralik"><input type="date" class="svk-in" id="svk-k1" value="' + esc(state.kT1) + '"><span>–</span><input type="date" class="svk-in" id="svk-k2" value="' + esc(state.kT2) + '"></div>' : '')
            : '<div class="svk-etiket">' + ic('calendar', 12) + ' Teslimat tarihi</div>' +
              '<div class="svk-chips">' + tchip('tumu', 'Tümü') + tchip('geciken', 'Geciken', 'kz') + tchip('bugun', 'Bugün') + tchip('yarin', 'Yarın') + tchip('hafta', 'Önümüzdeki 7 gün') + tchip('aralik', 'Tarih aralığı') + '</div>' +
              (state.tarih === 'aralik' ? '<div class="svk-aralik"><input type="date" class="svk-in" id="svk-t1" value="' + esc(state.t1) + '"><span>–</span><input type="date" class="svk-in" id="svk-t2" value="' + esc(state.t2) + '"></div>' : '')) +
          '<div class="svk-etiket" style="margin-top:6px">' + ic('list', 12) + ' Durum</div>' +
          '<div class="svk-chips">' + filtreler.map(([k, l]) => '<button class="svk-chip' + (state.filtre === k ? ' on' : '') + '" data-act="filtre" data-k="' + k + '">' + l + (durumSay[k] ? ' <i>' + durumSay[k] + '</i>' : '') + '</button>').join('') +
            (Magaza.kapsam() === 'magaza' && Magaza.nokta() ? '<button class="svk-chip' + (state.magaza ? ' on' : '') + '" data-act="magaza">📍 ' + esc(Magaza.secili()) + '</button>' : '') +
            '<button class="svk-chip' + (state.benim ? ' on' : '') + '" data-act="benim">' + ic('user', 12) + ' Sadece benim satışlarım</button></div>' +
        '</div>' +
        '<div class="svk-liste">' + listeHtml() + '</div>' +
      '</div>' + secBarHtml() + '</div>';
  const kay = kok().querySelector('.svk-scroll');
  if (kay) {
    kay.scrollTop = top;
    // Filtre (durum/tarih/tür) değişince küçük ekranda sonuçlar filtre alanının altında kalmasın: listenin başına git
    if (filtreyeGit && window.innerWidth < 700) {
      const l = kay.querySelector('.svk-liste');
      if (l) kay.scrollTop = Math.max(0, l.getBoundingClientRect().top - kay.getBoundingClientRect().top + kay.scrollTop - 8);
    }
  }
}

// ═══ Detay ekranı ══════════════════════════════════════════════
const siradakiMetin = s => {
  const k = kalemListe(s).find(x => !kalemTamam(x));
  return k ? 'Sıradaki: ' + (k.n + 1) + '. ' + k.urun : 'Tüm satırlar tamam';
};
function adimlar(s) {
  const G = gruplar(s), k = kalemListe(s), tSay = G.filter(g => grupTeslim(s, g)).length;
  const A = [['Seri girişi', k.length > 0 && k.every(kalemTamam)], [G.length > 1 ? 'Teslim (' + tSay + '/' + G.length + ')' : TUR_AD[G[0] || teslimTuru(s)], !!s.servisTeslim], ['Çıkış doğrulama', !!s.teslimEdildi && !s.iade]];
  const cur = (s.iptal || s.iade) ? -1 : A.findIndex(x => !x[1]);
  return '<div class="svk-steps' + (s.iptal || s.iade ? ' iptal' : '') + '">' + A.map(([ad, ok], i) =>
    '<div class="svk-st' + (ok ? ' ok' : '') + (i === cur ? ' cur' : '') + '"><i>' + (ok ? ic('check', 15) : i + 1) + '</i>' + esc(ad) + '</div>').join('') + '</div>';
}
const satir = (ikon, html) => '<div class="svk-satir">' + ic(ikon, 16) + '<div>' + html + '</div></div>';
const kim = u => esc(String(u || '').split('@')[0]);

function panel(no, baslik, durum, durumEt, icerik) {
  return '<div class="svk-pnl ' + durum + '"><div class="svk-pnl-h"><span class="svk-pnl-no">' + no + '</span><span class="svk-pnl-t">' + esc(baslik) + '</span>' +
    '<span class="svk-pnl-s">' + esc(durumEt) + '</span></div>' + (icerik ? '<div class="svk-pnl-b">' + icerik + '</div>' : '') + '</div>';
}

// V11.13: satış / fiyat bilgisi (personel ekranı; müşteri çıktılarında vade farkı yer almaz). V11.37: vade farkı / komisyon satırını yalnızca yönetici görür
const pesinAd = x => x === 'Teslimde' ? 'Teslimde nakit' : 'Peşin (' + (x || 'Nakit') + ')';
function odemeSatirlari(f) {
  const o = f.odeme || {}, L = [];
  if (o.pesin > 0) L.push([pesinAd(o.pesinSekli), tl(o.pesin)]);
  if (o.tip === 'nakit') { if (!(o.pesin > 0)) L.push(['Nakit', tl(o.toplam)]); }
  else if (o.tip === 'proje') L.push([o.kart || 'Kartlı ödeme', tl(o.toplam)]);
  else L.push([(o.kart || 'Kart') + (o.taksit > 1 ? ' · ' + o.taksit + ' taksit (' + o.taksit + ' × ' + tl(o.aylik) + ')' : ' · tek çekim'), tl(o.pesin > 0 ? o.kartTutar : o.toplam)]);
  return L;
}
function fiyatKartHtml(s) {
  const f = s.fiyat;
  if (!f) return s.odemeYontemi ? '<div class="svk-card"><div class="svk-ch">' + ic('wallet', 16) + ' Satış / fiyat</div><div class="svk-cb">' + esc(s.odemeYontemi) + '<div class="svk-not" style="margin-top:6px">Bu kayıt eski sürümde açıldı; ürün bazında fiyat ayrıntısı yok.</div></div></div>' : '';
  const sat = (a, b, ek) => '<div class="svk-fr' + (ek ? ' ' + ek : '') + '"><span>' + a + '</span><b>' + b + '</b></div>';
  const kal = (f.kalemler || []).map(k => '<div class="svk-fr"><span>' + esc(k.urun) + (k.kampanya ? '<small>🏷 ' + esc(k.kampanya) + '</small>' : '') + '</span><b>' +
    (k.indirim > 0 ? '<s>' + tl(k.liste) + '</s> ' : '') + tl(k.net) + '</b></div>').join('');
  const ind = (f.altIndirim > 0 ? sat('Ek indirim', '−' + tl(f.altIndirim)) : '') +
    (f.pazarlik > 0 ? sat('Pazarlık indirimi' + (f.pazarlikNotu ? ' <small>' + esc(f.pazarlikNotu) + '</small>' : ''), '−' + tl(f.pazarlik)) : '');
  const o = f.odeme || {};
  return '<div class="svk-card"><div class="svk-ch">' + ic('wallet', 16) + ' Satış / fiyat<span class="sg">' + esc(tl(o.toplam)) + '</span></div><div class="svk-cb">' +
    kal + ind + sat('Net nakit değeri', tl(f.netNakit), 'ara') + (f.urunIndirim > 0 ? '<div class="svk-not" style="margin:4px 0 0">Satır fiyatlarına yansıyan ürün indirimi: ' + tl(f.urunIndirim) + '</div>' : '') +
    '<div class="svk-fh">Ödeme</div>' + odemeSatirlari(f).map(x => sat(esc(x[0]), x[1])).join('') +
    sat('Müşterinin ödeyeceği toplam', tl(o.toplam), 'top') +
    (f.vadeFarki > 0 && yonetici() ? '<div class="svk-not" style="margin-top:6px">Vade farkı / komisyon: <b>' + tl(f.vadeFarki) + '</b> (yalnızca yönetici görür; müşteri belgelerinde yer almaz)</div>' : '') +
    '</div></div>';
}

// V11.17: yeni kalem için marka + ürün gamı (servis mesajı / servis seçimi)
function markaGam(kod) {
  const p = (B() && B().urunBul && B().urunBul(kod)) || {};
  return { marka: String(p['Marka'] || p.marka || '').trim(), gam: String(p['Ürün Gamı'] || p.gam || '').trim() };
}
// Liste filtresi: tanımlı tüm servis adları + açık kayıtlarda geçenler
function filtreServisleri() {
  const g = tumServisAdlari();
  state.list.forEach(s => servisAdlari(s).forEach(a => { if (!g.includes(a)) g.push(a); }));
  return g;
}
// V11.37: yönetici dışı kullanıcı bir sevkiyatın müşteri bilgisini YALNIZ BİR KEZ kopyalayabilir (kayıt sunucuda tutulur; kim/ne zaman hareket geçmişinde)
const kopyaAnahtar = e => String(e || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
const kopyaYapildi = s => !yonetici() && !!(s.kopya && s.kopya[kopyaAnahtar(eposta())]);
function kopyalaDugme(s) {
  return kopyaYapildi(s)
    ? '<button class="svk-btn kucuk" disabled title="Yeniden kopyalama yalnızca yönetici tarafından yapılabilir">' + ic('check', 13) + ' Müşteri bilgisi kopyalandı (tekrar kopyalanamaz)</button>'
    : '<button class="svk-btn kucuk" data-act="kopyala">' + ic('file', 13) + ' Müşteri + fiyat bilgisini kopyala' + (yonetici() ? '' : ' (1 kez)') + '</button>';
}
function detayHtml(s) {
  const d = durumHesapla(s), k = kalemListe(s);
  const G = gruplar(s), karma = G.length > 1, hepsiT = hepsiTeslim(s);
  const duz = seriYetkili(s) && !s.kapali;                 // V11.32: depo + kendi satışındaki satış personeli (seri, ürün, teslim, çıkış doğrulama). Tahsilat/iade/satır çıkar/açık yönetici işleri depoYetkili/yonetici'de kalır
  const pln = !s.kapali && seriYetkili(s);                 // V11.37: değişiklik (teslim şekli / tarih / not / depo / seri…) yalnızca satışı yapan personel + destek + yönetici; diğerleri salt okunur
  const kgir = x => duz && !kalemKilitli(s, x);          // seri / ürün değişikliği, ürünün TESLİM GRUBU teslim edilene kadar serbest
  const girilebilir = duz && !hepsiT;
  const tam = k.filter(kalemTamam).length, sy = seriSayim(k);
  const hepsiTam = k.length > 0 && tam === k.length;
  const gec = gecikmeGun(s);
  const kameraVar = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  // — Uyarı bantları
  let banner = '';
  if (s.iptal) {
    const ib = s.iptalBilgi || {};
    banner += '<div class="svk-banner gr">' + ic('ban', 20) + '<div><b>Bu sevkiyat iptal edildi</b>' + (ib.neden ? esc(ib.neden) + (ib.not ? ' — ' + esc(ib.not) : '') : 'İptal nedeni kayıtlı değil') +
      (ib.t ? '<br><small>' + kim(ib.u) + ' · ' + zamanTR(ib.t) + '</small>' : '') + '</div></div>';
  } else if (s.iade) {
    const ib = s.iade || {};
    banner += '<div class="svk-banner mr">' + ic('undo', 20) + '<div><b>Ürünler depoya iade edildi</b>' + esc(ib.neden || '') + (ib.not ? ' — ' + esc(ib.not) : '') +
      '<br><small>' + kim(ib.u) + ' · ' + zamanTR(ib.t) + ' · Stoğa dönüş diğer programda yapılmalıdır.</small></div></div>';
  } else if (gec) {
    banner += '<div class="svk-banner kz">' + ic('alert', 20) + '<div><b>Teslimat ' + gec + ' gün gecikti</b>Planlanan teslimat: ' + tarihTR(s.teslimTarihi) + (s.teslimSaati ? ' ' + esc(s.teslimSaati) : '') +
      '. Teslim tarihini güncelleyin veya sevkiyatı tamamlayın.</div></div>';
  }

  if (!s.kapali && !seriYetkili(s)) {   // V11.37: başkasının satışı → salt okunur uyarısı
    banner += '<div class="svk-banner gr">' + ic('info', 20) + '<div><b>Salt okunur</b>Bu satışı <b style="display:inline">' + esc(saticiAdi(s)) + '</b> yaptı. Değişiklik yalnızca satışı yapan personel, destek veya yönetici tarafından yapılabilir.</div></div>';
  }

  // Satır kamerası: aynı üründen birden fazla boş satır varsa (toplu ürün) rozet kalan adedi gösterir; tarama o ürünün satırlarını sırayla doldurur
  const kameraDugme = (x, tum, goster) => {
    if (!goster) return '';
    const bos = tum.filter(y => String(y.kod) === String(x.kod) && !(y.seriNo && String(y.seriNo).trim())).length;
    const dolu = !!(x.seriNo && String(x.seriNo).trim());
    return '<button class="svk-kcam" data-act="taraurun" data-n="' + x.n + '" title="' + (dolu ? 'Seriyi kamerayla yeniden oku' : (bos > 1 ? 'Kamerayla toplu tara (' + bos + ' adet)' : 'Kamerayla tara')) + '" aria-label="Kamerayla tara">' + ic('camera', 17) + (!dolu && bos > 1 ? '<b>' + bos + '</b>' : '') + '</button>';
  };

  // V11.11: ürün bazlı teslim şekli + ürünün teslim durumu (serisiz ürünler dahil hiçbir ürün durumsuz kalmaz)
  const turSatiri = x => {
    const tt = kalemTur(s, x), tg = grupTeslim(s, tt), kil = !pln || kalemKilitli(s, x), seri = !!(x.seriNo && String(x.seriNo).trim());
    const adlar = (tt === 'servis' && pln && !kil) ? markaServisleri(kalemMarka(x)) : [];
    const altSecim = adlar.length ? '<div class="svk-srv"><label>Götüren</label>' + adlar.map(a => '<button class="svk-sc' + (x.servis === a ? ' on' : '') + '" data-act="kalemsrv" data-n="' + x.n + '" data-v="' + esc(a) + '">' + esc(a) + '</button>').join('') + '<small>isteğe bağlı</small></div>'
      : (tt === 'servis' && x.servis ? '<div class="svk-srv"><label>Götüren</label><b>' + esc(x.servis) + '</b></div>' : '');
    return '<div class="svk-ktur"><label>Teslim</label><div class="svk-turseg k">' +
      '<button class="servis' + (tt === 'servis' ? ' on' : '') + '" data-act="kalemtur" data-n="' + x.n + '" data-k="servis"' + (kil ? ' disabled' : '') + '>' + ic('truck', 13) + ' Servis götürür</button>' +
      '<button class="musteri' + (tt === 'musteri' ? ' on' : '') + '" data-act="kalemtur" data-n="' + x.n + '" data-k="musteri"' + (kil ? ' disabled' : '') + '>' + ic('user', 13) + ' Müşteri alır</button></div>' + altSecim + '</div>';
  };
  const durumChip = x => {
    const tg = x.teslim || grupTeslim(s, kalemTur(s, x));
    return tg ? '<span class="svk-cp ok">' + ic('check', 13) + 'Teslim edildi' + (tg.alan ? ' · ' + esc(tg.alan) : '') + '</span>'
      : seriVar(x) ? '<span class="svk-cp ok">' + ic('check', 13) + 'Seri okutuldu · teslim bekliyor</span>'
      : kalemSerisiz(x) ? '<span class="svk-cp">' + ic('clock', 13) + 'Serisiz ürün · teslimde onaylanır</span>'
      : '<span class="svk-cp am">' + ic('alert', 13) + 'Seri okutulmadan teslim edilemez</span>';
  };

  // — Ürünler (seri zorunluluğu seriler.json'daki Stok Kodu'na göre)
  const kalemHtml = k.map(x => {
    const gerek = !kalemSerisiz(x), stokYok = gerek && !(x.seriNo && String(x.seriNo).trim()) && seriState.kodlar && !seriState.kodlar.has(String(x.kod).trim());
    const ipucu = !gerek
      ? '<div class="svk-ipucu nt">' + ic('info', 14) + '<span>' + (x.seriGerekliDegil ? 'Yönetici “seri gerekmez” olarak işaretledi' + (x.seriGerekliDegil.neden ? ': ' + esc(x.seriGerekliDegil.neden) : '') + '.' : 'Bu ürün stok listesinde (seriler.json) seri takipli değil — seri girişi gerekmez.') + '</span></div>'
      : (stokYok ? '<div class="svk-ipucu nt">' + ic('alert', 14) + '<span>Bu ürün seri takipli ancak stokta seri görünmüyor — stok girişi yapılınca seri okutulabilir; seri girilmeden teslim edilemez.' +
          (kgir(x) && yonetici() ? ' <button class="svk-btn kucuk" data-act="serisizyap" data-n="' + x.n + '">Seri gerekmez yap</button>' : '') + '</span></div>' : '');
    const rozetler = (x.ek ? '<div class="svk-ipucu nt">' + ic('info', 14) + '<span>Sonradan eklendi · ' + kim(x.ek.u) + ' · ' + zamanTR(x.ek.t) + '</span></div>' : '') +
      (x.degisti ? '<div class="svk-ipucu nt">' + ic('info', 14) + '<span>Ürün değiştirildi: <b>' + esc(x.degisti.eski && x.degisti.eski.urun) + '</b> → bu ürün · ' + kim(x.degisti.u) + ' · ' + zamanTR(x.degisti.t) + (x.degisti.neden ? ' · ' + esc(x.degisti.neden) : '') + '</span></div>' : '');
    const aksiyon = kgir(x)
      ? '<div class="svk-kaks"><button class="svk-btn kucuk" data-act="kalemdeg" data-n="' + x.n + '">' + ic('refresh', 13) + ' Ürünü değiştir</button>' +
        (k.length > 1 && depoYetkili() ? '<button class="svk-btn kucuk" data-act="kalemcikar" data-n="' + x.n + '">' + ic('trash', 13) + ' Satırı çıkar</button>' : '') + '</div>' : '';
    return '<div class="svk-kalem"><div class="svk-kad"><span class="no">' + (x.n + 1) + '</span><span class="nm">' + esc(x.urun) + '</span></div>' +
      '<div class="svk-ozr">' + ozetHtml(s, x, true) + '</div>' + turSatiri(x) + depoSatiri(x, pln && !kalemKilitli(s, x), s.depoZorunlu, kgir(x) && gerek && kameraVar) +
      '<div class="svk-kin"><input class="svk-in svk-seri" data-n="' + x.n + '" placeholder="' + (gerek ? 'Seri / barkod' : 'Seri gerekmez') + '" enterkeyhint="next" autocomplete="off" autocapitalize="characters" spellcheck="false" value="' + esc(x.seriNo || '') + '"' + (kgir(x) && gerek ? '' : ' disabled') + '>' +
      kameraDugme(x, k, kgir(x) && gerek && kameraVar) +
      '<span class="dur' + (kalemYesil(s, x) ? ' ok' : '') + '">' + (kalemYesil(s, x) ? ic('check', 14) : '') + '</span></div><div class="svk-dc">' + durumChip(x) + '</div>' + ipucu + rozetler + aksiyon + '</div>';
  }).join('');
  const taraBtn = (kameraVar && k.some(x => kgir(x) && !kalemTamam(x)))
    ? '<button class="svk-btn ana tam" style="margin-top:12px" data-act="tara">' + ic('camera', 16) + ' Kamera ile seri tara</button>' : '';
  const ekleBtn = girilebilir ? '<button class="svk-btn tam" style="margin-top:10px" data-act="kalemekle">' + ic('box', 15) + ' Ürün ekle</button>' : '';

  // — Teslimat bilgileri
    const servisSecim = (G.includes('servis') && s.atananServis) ? '<div style="font-weight:700">' + esc(s.atananServis) + '</div>' : '';   // V11.14: servis atama kalktı; eski kayıttaki ad salt okunur
  const tarihBlok = pln
    ? '<input type="date" class="svk-in tam" id="svk-d-tarih" value="' + esc(s.teslimTarihi) + '"></div><div><label class="svk-lbl">Saat</label><select class="svk-in tam" id="svk-d-saat">' +
        (s.teslimSaati && !SAAT_DILIMLERI.includes(s.teslimSaati) ? '<option selected>' + esc(s.teslimSaati) + '</option>' : '') +
        SAAT_DILIMLERI.map(x => '<option' + ((s.teslimSaati || 'Gün içinde') === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>'
    : tarihTR(s.teslimTarihi) + '</div><div><label class="svk-lbl">Saat</label>' + esc(s.teslimSaati || '—');
  const tahsilatVar = Number(s.tahsilatTutari) > 0;     // yalnızca eski kayıtlar (yeni kayıtlarda not alanı kullanılır)

  // — Süreç panelleri: 1) Seri girişi  2) Teslim  3) Çıkış doğrulama ve kapanış
  const serisizSay = k.filter(x => !(x.seriNo && String(x.seriNo).trim()) && kalemSerisiz(x)).length;
  const serisizNot = serisizSay ? ' Serisiz ürün: ' + serisizSay + ' (seri gerekmez; teslim kaydına ve çıkış doğrulamasına dahildir).' : '';
  const p1 = !sy.gerek
    ? panel(1, 'Seri girişi', 'pasif', 'Gerekmiyor', 'Bu kayıttaki ürünler serisiz; seri girişi gerekmez. Teslim, ilgili “Servise teslim / Müşteriye teslim” adımında onaylanır.')
    : hepsiTam
    ? panel(1, 'Seri girişi', 'tamam', 'Tamamlandı', 'Seri gereken tüm ürünler için seri/barkod girildi (' + tam + '/' + k.length + ').' + serisizNot + (girilebilir ? ' Ürünün teslimi yapılana kadar seri ve ürün değiştirilebilir.' : ''))
    : panel(1, 'Seri girişi', hepsiT ? 'pasif' : 'sirada', tam + '/' + k.length, 'Seri girişi sürüyor.' + serisizNot + ' Seri gerektiren ürünün serisi okutulmadan o ürünün teslimi yapılamaz. Ürün değişimi veya ek ürün için “Ürünler ve seri numaraları” bölümünü kullanın.');

  // V11.11: her teslim grubu (servis / müşteri) ayrı panel: kendi ürünleri, teslim alan, imza, zaman
  const teslimPanel = (tur, no) => {
    const gk = k.filter(x => kalemTur(s, x) === tur), te = grupTeslim(s, tur), ad = TUR_AD[tur];
    const teslimler = gk.filter(x => x.teslim), kalan = gk.filter(x => !x.teslim && !te);
    const hazir = kalan.filter(kalemTamam), eksik = kalan.filter(x => !kalemTamam(x));
    const td0 = taslak.g[tur], secili = hazir.filter(x => !td0.hayir.has(x.n));
    const secebilir = duz && hazir.length > 0 && kalan.length > 1;          // V11.21: birden çok ürün varsa hangilerinin teslim edildiği seçilir
    const satirlar = '<ul class="svk-cks svk-gk">' + gk.map(x => {
      const seri = x.seriNo && String(x.seriNo).trim(), tt = x.teslim || (te ? te : null);
      const d = tt ? ['ok', 'Teslim edildi'] : seri ? ['ok', 'Seri okutuldu'] : (kalemSerisiz(x) ? ['bk', 'Serisiz ürün'] : ['bk', 'Seri okutulmadı']);
      const kutu = secebilir && hazir.includes(x) ? '<input type="checkbox" class="svk-sec" data-g="' + tur + '" data-n="' + x.n + '"' + (td0.hayir.has(x.n) ? '' : ' checked') + ' aria-label="Bu teslimde">' : '';
      return '<li>' + kutu + '<span class="ad">' + esc(x.urun) + (seri ? '<small class="mono">' + esc(seri) + '</small>' : '') + (x.depo ? '<small>' + esc(x.depo) + '</small>' : '') +
        (x.teslim ? '<small>' + esc(x.teslim.alan || '') + ' · ' + zamanTR(x.teslim.t) + '</small>' : '') + '</span><span class="svk-cp ' + d[0] + '">' + d[1] + '</span></li>';
    }).join('') + '</ul>';
    const partiler = grupPartileri(s, tur);
    const partiHtml = partiler.map(pt => (pt.te.alan ? 'Teslim alan: <b>' + esc(pt.te.alan) + '</b>' + (partiler.length > 1 ? ' (' + pt.kalemler.length + ' ürün)' : '') + '<br>' : '') +
      '<small>' + kim(pt.te.u) + ' · ' + zamanTR(pt.te.t) + '</small>' +
      (pt.te.imza && /^data:image\/jpeg;base64,/.test(pt.te.imza) ? '<img class="svk-imzaresim" alt="İmza" src="' + pt.te.imza + '">' : '') + '<br>').join('');
    const geriAl = yonetici() && !s.kapali && (te || teslimler.length)
      ? '<div class="svk-eylem" style="margin-top:9px"><button class="svk-btn kucuk" data-act="teslimgeri" data-g="' + tur + '">' + ic('undo', 14) + ' Teslimi geri al</button></div>' : '';
    if (te) {
      return panel(no, ad, 'tamam', 'Teslim edildi',
        satirlar + (tur === 'servis' && servisAdlari(s).length ? 'Götüren: <b>' + esc(servisAdlari(s).join(', ')) + '</b><br>' : '') + partiHtml + geriAl);
    }
    if (hazir.length && duz) {
      const td = td0, kismiMi = teslimler.length > 0 || secili.length < kalan.length;
      const dugme = secili.length === kalan.length && !teslimler.length
        ? (tur === 'musteri' ? ' Müşteriye teslim edildi' : ' Servis yetkilisine teslim edildi')
        : ' Seçilenleri teslim et (' + secili.length + '/' + kalan.length + ')';
      return panel(no, ad, 'sirada', teslimler.length ? 'Kısmi ' + teslimler.length + '/' + gk.length : 'Sırada',
        satirlar + (partiHtml ? partiHtml : '') +
        (eksik.length ? '<div class="svk-not" style="margin:6px 0">' + eksik.length + ' ürünün seri numarası okutulmadı; bu ürünler sonraki teslime kalır.</div>' : '') +
        (secebilir ? '<div class="svk-not" style="margin:6px 0">Bu teslimde olan ürünleri işaretleyin; işaretsizler sonra teslim edilir.</div>' : '') +
        '<label class="svk-lbl">' + (tur === 'musteri' ? 'Teslim alan kişi (müşteri) *' : 'Teslim alan servis yetkilisi *') + '</label><input id="svk-alan-' + tur + '" class="svk-in tam" placeholder="Ad soyad" value="' + esc(td.alan) + '">' +
        '<div class="svk-imzaEt">İmza' + (tur === 'musteri' ? ' *' : ' (isteğe bağlı)') + '</div><canvas id="svk-imza-' + tur + '" data-g="' + tur + '" class="svk-imza" width="300" height="120"></canvas>' +
        '<div class="svk-eylem" style="margin-top:9px"><button class="svk-btn" data-act="imzatemizle" data-g="' + tur + '">Temizle</button>' +
        '<button class="svk-btn koyu" data-act="teslim" data-g="' + tur + '"' + (secili.length ? '' : ' disabled') + '>' + ic(tur === 'musteri' ? 'user' : 'truck', 15) + dugme + '</button></div>' + (kismiMi ? geriAl : ''));
    }
    return panel(no, ad, teslimler.length ? 'sirada' : 'pasif', teslimler.length ? 'Kısmi ' + teslimler.length + '/' + gk.length : 'Beklemede', satirlar + partiHtml + (hazir.length
      ? 'Bu gruptaki ürünler hazır; teslim işlemini depo yetkilisi yapar.'
      : '<b>' + eksik.length + ' ürünün seri numarası okutulmadı:</b> ' + esc(eksik.map(x => x.urun).join(', ')) + '. Seri gerektiren ürün, seri okutulmadan teslim edilemez.' +
        (duz && kameraVar ? '<div class="svk-eylem" style="margin-top:9px"><button class="svk-btn ana" data-act="tara">' + ic('camera', 15) + ' Seri okut</button></div>' : '')) + geriAl);
  };
  const p2 = G.map((tur, i) => teslimPanel(tur, 2 + i)).join('');
  const no3 = 2 + G.length;

  let p3;
  if (s.teslimEdildi) {
    const te = s.teslimEdildi;
    p3 = panel(no3, 'Çıkış doğrulama ve kapanış', 'tamam', s.iade ? 'Tamamlanmıştı' : 'Tamamlandı',
      (te.dogrulama === 'yonetici' ? 'Yönetici onayıyla tamamlandı' + (te.neden ? ': ' + esc(te.neden) : '') : 'Tüm seriler stok verisinden düştü; çıkış ' + (te.u === 'sistem' ? 'sistem tarafından otomatik ' : '') + 'doğrulandı. Seriler kalıcı olarak güvene alındı.') +
      '<br><small>' + kim(te.u) + ' · ' + zamanTR(te.t) + '</small>');
  } else if (s.servisTeslim) {
    const c = cikisDurumu(s);
    const dur = { cikti: ['ok', 'Çıkış yapıldı'], stokta: ['bk', 'Stokta görünüyor'], serisiz: ['ok', 'Seri gerekmez'], bilinmiyor: ['bk', 'Stok verisi yok'], seri_yok: ['bk', 'Seri girilmemiş'] };
    const sat = c.satirlar.map(x => '<li><span class="ad">' + esc(x.k.urun) + (x.seri ? '<small class="mono">' + esc(x.seri) + '</small>' : '') + '</span><span class="svk-cp ' + dur[x.durum][0] + '">' + dur[x.durum][1] + '</span></li>').join('');
    const veriNot = seriState.ts ? 'Stok verisi: ' + new Date(seriState.ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) + ' itibarıyla yüklendi (dosya günlük güncellenir).' : 'Stok verisi yüklenemedi.';
    p3 = panel(no3, 'Çıkış doğrulama ve kapanış', 'sirada', c.hazir ? 'Hazır' : c.bekleyen + ' seri bekliyor',
      '<p class="svk-not" style="margin:0 0 8px">Ürünün diğer programdan çıkışı yapılınca seri numarası stok verisinden (seriler.json, günlük) düşer. Tüm seriler düşünce sevkiyat <b>otomatik kapanır</b> ve seriler bir daha kullanılamaz; elle onay gerekmez.</p>' +
      '<ul class="svk-cks">' + sat + '</ul><div class="svk-not" style="margin:8px 0 0">' + veriNot + '</div>' +
      (duz ? '<div class="svk-banner ' + (c.hazir ? 'ok' : 'bk') + '" style="margin-top:9px">' + (c.hazir
          ? 'Tüm seriler stok verisinden düşmüş; çıkış doğrulanabilir.'
          : (c.veriVar ? c.bekleyen + ' seri stok verisinde hâlâ görünüyor — ürünün diğer programdan çıkışı yapılıp günlük veri güncellenince “Çıkışı doğrula ve tamamla” ile kapatabilirsiniz.' : 'Stok verisi yüklenemediği için çıkış doğrulanamıyor. “Stok verisini yenile” ile tekrar deneyin.')) + '</div>' +
        '<div class="svk-eylem" style="margin-top:9px"><button class="svk-btn ' + (c.hazir ? 'yesil' : 'koyu') + '" data-act="cikisdogrula">' + ic(c.hazir ? 'check' : 'refresh', 15) + (c.hazir ? ' Çıkışı doğrula ve tamamla' : ' Stok verisini şimdi kontrol et') + '</button></div>' +
        (otoDurdu ? '<div class="svk-banner bk" style="margin-top:9px">Stok verisi beklenmedik biçimde küçüldü; otomatik kapanış güvenlik için durduruldu. Çıkışı yapılmış olduğundan eminseniz yönetici onayıyla tamamlayın.</div>' : '') +
        (c.hazir ? '' : (yonetici()
          ? '<div class="svk-not" style="margin:10px 0 4px">Veri gecikmişse ve çıkışın yapıldığından eminseniz yönetici olarak beklemeden tamamlayabilirsiniz; gerekçe kayda geçer.</div><div class="svk-eylem"><button class="svk-btn kucuk" data-act="cikiszorla">Yönetici onayıyla tamamla</button></div>'
          : '<div class="svk-not" style="margin:10px 0 0">Seriler stoktan düşünce sevkiyat kendiliğinden kapanır. Çıkış yapıldığı hâlde kapanmadıysa yöneticiye başvurun.</div>')) : ''));
  } else {
    p3 = panel(no3, 'Çıkış doğrulama ve kapanış', 'pasif', 'Beklemede', (karma ? 'Tüm teslim grupları (servis ve müşteri) teslim edildikten sonra; seriler diğer programdan çıkış yapıp stok verisinden düşünce sevkiyat kapatılır.' : 'Teslimden sonra, seriler diğer programdan çıkış yapıp stok verisinden düşünce sevkiyat kapatılır.'));
  }

  // — Tahsilat (yalnızca eski kayıtlar)
  const tahsilatKart = tahsilatVar
    ? '<div class="svk-card"><div class="svk-ch">' + ic('wallet', 16) + ' Teslimde tahsilat<span class="sg">' + esc(tl(s.tahsilatTutari)) + '</span></div><div class="svk-cb">' +
      (s.tahsilatAlindi ? 'Tahsilat alındı — ' + kim(s.tahsilatAlindi.u) + ' · ' + zamanTR(s.tahsilatAlindi.t)
        : 'Henüz tahsil edilmedi.' + (depoYetkili() && !s.kapali ? '<div class="svk-eylem" style="margin-top:9px"><button class="svk-btn" data-act="tahsilat">' + ic('check', 15) + ' Tahsilat alındı</button></div>' : '')) +
      '</div></div>' : '';

  // — Teslim sonrası / riskli işlemler
  let risk = '';
  const iadeYap = depoYetkili() && !s.iptal && !s.iade && !!(s.servisTeslim || s.teslimEdildi);
  const silBtn = '<button class="svk-btn tehlike" data-act="sil">' + ic('trash', 15) + ' Kaydı sil</button>';
  const riskBtn = (yonetici() && silinebilir(s))
    ? (s.iptal ? '<button class="svk-btn" data-act="iptalgeri">' + ic('undo', 15) + ' İptali geri al</button>' + silBtn
      : s.iade ? silBtn
      : '<button class="svk-btn tehlike" data-act="iptal">' + ic('ban', 15) + ' Sevkiyatı iptal et</button>' + silBtn) : '';
  if (riskBtn || iadeYap) {
    risk = '<div class="svk-card svk-risk"><div class="svk-ch">' + ic('alert', 16) + ' Yönetici / iade işlemleri</div><div class="svk-cb svk-eylem">' +
      (iadeYap ? '<button class="svk-btn" data-act="iade">' + ic('undo', 15) + ' İade / depoya dönüş</button>' : '') + riskBtn + '</div></div>';
  }

  const log = (s.log || []).slice().reverse().map(l => '<li><time>' + zamanTR(l.t) + '</time><span><b>' + esc(LOG_AD[l.a] || l.a) + '</b> · ' + kim(l.u) + (l.e ? '<br><small>' + esc(l.e) + '</small>' : '') + '</span></li>').join('');
  const notBlok = pln
    ? '<label class="svk-lbl" style="margin-top:12px">Not</label><textarea class="svk-in tam" id="svk-d-not" rows="2" placeholder="Teslimat notu (tahsilat, kat/asansör, ulaşım…)">' + esc(s.not || '') + '</textarea>'
    : (s.not ? '<div style="margin-top:10px">' + satir('msg', esc(s.not)) + '</div>' : '');

  return '<div class="svk-panel">' +
    '<div class="svk-head"><button class="svk-ib" data-act="geri" aria-label="Listeye dön">' + ic('back', 18) + '</button>' +
      '<div class="svk-ht"><h1 style="font-size:1rem;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(s.musteri) + '</h1><p style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(k.map(x => x.urun).join(', ')) + ' · ' + tarihTR(s.teslimTarihi) + (s.teslimSaati ? ' ' + esc(s.teslimSaati) : '') + '</p></div>' + rozet(d, s) +
      '<button class="svk-ib" data-act="yenile" title="Yenile" aria-label="Yenile">' + ic('refresh', 18) + '</button></div>' +
    '<div class="svk-scroll svk-det">' + banner + adimlar(s) +
      '<div class="svk-card"><div class="svk-ch">' + ic('user', 16) + ' Müşteri</div><div class="svk-cb"><div class="svk-ad">' + esc(s.musteri) + '</div>' +
        satir('phone', '<a href="tel:' + esc(s.telefon) + '">' + esc(s.telefon) + '</a>' + (s.telefon2 ? ' · <a href="tel:' + esc(s.telefon2) + '">' + esc(s.telefon2) + '</a>' : '')) +
        satir('pin', esc(s.adres || 'Adres girilmemiş')) +
        (s.tc ? satir('shield', 'Kimlik: ' + esc(yonetici() ? s.tc : maskeKimlik(s.tc))) : '') + (s.email ? satir('msg', esc(yonetici() ? s.email : maskeEposta(s.email))) : '') +
        satir('user', 'Satışı yapan: <b>' + esc(saticiAdi(s)) + '</b>') +
        '<div class="svk-eylem" style="margin-top:10px">' + kopyalaDugme(s) + '</div></div></div>' +
      fiyatKartHtml(s) +
      '<div class="svk-card"><div class="svk-ch">' + ic('truck', 16) + ' Teslimat bilgileri</div><div class="svk-cb">' +
        '<div class="svk-alan" style="margin-top:12px">' + (servisSecim ? '<div class="tam"><label class="svk-lbl">Servis (eski kayıt)</label>' + servisSecim + '</div>' : '') +
          '<div><label class="svk-lbl">Tarih</label>' + tarihBlok + '</div></div>' + notBlok +
        (pln && SATIS_NOKTALARI.length
          ? '<label class="svk-lbl" style="margin-top:12px">Satış noktası</label><select class="svk-in tam" id="svk-d-nokta"><option value="">—</option>' + SATIS_NOKTALARI.map(x => '<option' + (s.satisNoktasi === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>'
          : '<div style="margin-top:10px;font-size:.78rem;color:var(--k-mut)">Satış noktası: <b style="color:var(--k-ink2)">' + esc(s.satisNoktasi || '—') + '</b></div>') + '</div></div>' +
      '<div class="svk-card"><div class="svk-ch">' + ic('box', 16) + ' Ürünler ve seri numaraları<span class="sg">' + (sy.gerek ? sy.dolu + '/' + sy.gerek + ' seri' : 'Seri yok') + '</span></div><div class="svk-cb">' +
        '<div class="svk-bhead"><div class="svk-bar' + (gec ? ' kz' : '') + '"><i style="width:' + (sy.gerek ? Math.round(sy.dolu * 100 / sy.gerek) : 100) + '%"></i></div></div>' + kalemHtml + taraBtn + ekleBtn + '</div></div>' +
      '<div class="svk-card"><div class="svk-ch">' + ic('list', 16) + ' Teslimat süreci</div><div class="svk-cb">' + p1 + p2 + p3 + '</div></div>' +
      tahsilatKart +
      '<div class="svk-card"><div class="svk-ch">' + ic('file', 16) + ' Belgeler ve iletişim</div><div class="svk-cb svk-eylem">' +
        '<button class="svk-btn" data-act="depofisi">' + ic('printer', 15) + ' Depo fişi</button><button class="svk-btn" data-act="teslimbelge">' + ic('printer', 15) + ' Teslimat belgesi</button>' +
        (B().satisPdfVar && B().satisPdfVar(s.saleNo) ? '<button class="svk-btn" data-act="satispdf">' + ic('file', 15) + ' Satış sözleşmesi (PDF)</button>' : '') +
        '<button class="svk-btn" data-act="waservis">' + ic('msg', 15) + ' Servise mesaj (kopyala)</button><button class="svk-btn" data-act="wa">' + ic('msg', 15) + ' Müşteriye WhatsApp</button>' + (s.teslimEdildi ? '<button class="svk-btn" data-act="watesl">' + ic('msg', 15) + ' Teşekkür mesajı</button>' : '') + '</div></div>' +
      '<div class="svk-card"><div class="svk-ch">' + ic('clock', 16) + ' Hareket geçmişi</div><div class="svk-cb"><ul class="svk-log">' + log + '</ul></div></div>' +
      risk +   // V11.36d: Yönetici / iade işlemleri en altta (nadir kullanılır)
    '</div></div>';
}

// Odak + kaydırma + yazılmakta olan alanlar yeniden çizimde korunur
function odakTanimi(el) {
  if (!el || !el.classList) return null;
  if (el.id) return '#' + el.id;
  if (el.dataset && el.dataset.n !== undefined) {
    if (el.classList.contains('svk-seri')) return '.svk-seri[data-n="' + el.dataset.n + '"]';
    if (el.classList.contains('svk-sz')) return '.svk-sz[data-n="' + el.dataset.n + '"]';
  }
  return null;
}
function detayCiz(s) {
  state.yonetim = false;
  const o = kok();
  const kay = o.querySelector('.svk-det');
  const top = kay ? kay.scrollTop : 0;
  const ae = document.activeElement;
  const hedef = ae && o.contains(ae) ? odakTanimi(ae) : null;
  const sec = hedef && ae.selectionStart != null && ae.type !== 'date' && ae.type !== 'time' ? [ae.selectionStart, ae.selectionEnd] : null;
  if (taslak.id !== s.saleNo) taslakSifirla(s.saleNo);
  o.innerHTML = detayHtml(s);
  const kay2 = o.querySelector('.svk-det');
  if (kay2) kay2.scrollTop = top;
  if (hedef) {
    const el = o.querySelector(hedef);
    if (el && !el.disabled) { el.focus({ preventScroll: true }); if (sec) { try { el.setSelectionRange(sec[0], sec[1]); } catch (e) { /* yoksay */ } } }
  }
  imzaBagla();
}
function sonrakiBosaOdaklan(n) {
  const o = kok();
  const bos = [...o.querySelectorAll('.svk-seri:not([disabled])')].filter(i => !i.value.trim());
  const sira = bos.find(i => Number(i.dataset.n) > Number(n)) || bos[0];
  if (sira) { sira.focus(); try { sira.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* yoksay */ } return; }
  const b = o.querySelector('[id^="svk-alan-"]') || o.querySelector('[data-act="teslim"]');
  if (b) { b.focus(); try { b.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* yoksay */ } }
}

// ── İmza paneli ────────────────────────────────────────────────
function imzaBagla() {
  [...kok().querySelectorAll('canvas.svk-imza[data-g]')].forEach(c => {
    const td = taslak.g[c.dataset.g]; if (!td) return;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    if (td.imza) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, c.width, c.height); im.src = td.imza; }
    let cizim = false, son = null;
    const nokta = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
    c.onpointerdown = e => { cizim = true; son = nokta(e); try { c.setPointerCapture(e.pointerId); } catch (er) { /* yoksay */ } e.preventDefault(); };
    c.onpointermove = e => {
      if (!cizim) return;
      const p = nokta(e); ctx.beginPath(); ctx.moveTo(son[0], son[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); son = p; td.imzaVar = true;
    };
    const bitir = () => { if (cizim) { cizim = false; if (td.imzaVar) td.imza = c.toDataURL('image/jpeg', 0.6); } };
    c.onpointerup = bitir; c.onpointercancel = bitir;
  });
}

// ═══ Seri kaydı (elle giriş + kamera ortak) ════════════════════
// Dönüş: { ok:true } | { ok:false, hata:{ tur, detay, message } }
async function seriKaydet(s, n, val) {
  val = String(val || '').trim();
  const kalem = (s.kalemler || {})[n];
  if (!kalem) return { ok: false, hata: { tur: 'genel', message: 'Kalem bulunamadı.' } };
  if (val) {
    try { await Talep.yoldaYukle(false); } catch (_e) { /* yoksay */ }   // V11.24: yoldaki seri satış/sevkiyatta kullanılamaz
    if (!seriState.seriToBilgi) await seriYukle(true);
    const dg = seriDogrula(val, kalem.kod);
    if (dg.dogrulanamadi) return { ok: false, hata: { tur: 'liste', message: 'SERI_STOK doğrulama listesi yüklenemedi (bağlantı sorunu olabilir).' } };
    if (!dg.ok) return { ok: false, hata: { tur: dg.tur, detay: dg.detay, message: dg.mesaj } };
    // Hızlı yerel ön kontrol (kesin ve atomik kontrol transaction içinde seriKullanim ile yapılır)
    const ayni = kalemListe(s).find(k => String(k.n) !== String(n) && k.seriNo && normSeri(k.seriNo) === normSeri(val));
    if (ayni) return { ok: false, hata: { tur: 'ayni_sevkiyat', detay: { seri: val, n: ayni.n }, message: 'Bu seri bu sevkiyatın başka bir satırında zaten girilmiş.' } };
    const cak = [...state.list.values()].find(o => o.saleNo !== s.saleNo && !o.iptal && !o.iade && !o.silindi && kalemListe(o).some(k => k.seriNo && !k.seriIade && normSeri(k.seriNo) === normSeri(val)));
    if (cak) return { ok: false, hata: { tur: 'kullanilmis', detay: { seri: val, saleNo: cak.saleNo, musteri: cak.musteri }, message: 'Bu seri sistemde zaten kullanılmış.' } };
  }
  let hata = null;
  const kod = kalem.kod;
  const ok = await guncelle(s, sunucu => {
    if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış; seri değiştirilemez.', tur: 'kapali' };
    const k = (sunucu.kalemler || {})[n];
    if (!k || k.cikarildi) return { hata: 'Kalem bulunamadı (başka bir cihazda çıkarılmış olabilir).' };
    if (kalemKilitli(sunucu, k)) return { hata: 'Bu ürün az önce teslim edildi; seri değiştirilemez.', tur: 'kilitli' };
    if (String(k.kod) !== String(kod)) return { hata: 'Bu satırdaki ürün başka bir cihazda değiştirilmiş. Ekran yenileniyor; seriyi yeniden okutun.', tur: 'eksik' };
    const eski = k.seriNo ? normSeri(k.seriNo) : '';
    const yeni = val ? normSeri(val) : '';
    return {
      yaz: { ['kalemler.' + n + '.seriNo']: val },
      seriEkle: yeni ? [{ seri: yeni, n, kod }] : [],
      seriSil: eski && eski !== yeni ? [eski] : []
    };
  }, val ? 'seri_girildi' : 'seri_silindi', 'kalem ' + (Number(n) + 1), { hata: (m, e) => { hata = e || { tur: 'genel', message: m }; } });
  return ok ? { ok: true } : { ok: false, hata: hata || { tur: 'genel', message: 'Kaydedilemedi.' } };
}

// Kameradan gelen kod: seri sahibi ürüne göre ilk boş satıra otomatik eşlenir (sıra önemli değil).
// ctx (satır kamerası): yalnızca o ürünün serisi kabul edilir; ilk okuma tıklanan satıra yazılır (doluysa değiştirilir),
// sonraki okumalar aynı ürünün sıradaki boş satırlarına gider (toplu ürün). Satırlar bitince kamera kapanır.
async function seriKodIsle(kod, ctx) {
  let s = aktif();
  const red = (h) => ({ ok: false, mesaj: uyariKisa(h), uyari: h });
  if (!s) return { ok: false, mesaj: 'Sevkiyat açık değil', bitti: true };
  if (hepsiTeslim(s) || s.kapali) return { ok: false, mesaj: 'Bu sevkiyat teslim edilmiş/kapalı — seri girilemez', bitti: true, uyari: { tur: s.kapali ? 'kapali' : 'kilitli', message: 'Bu sevkiyatta artık seri girişi yapılamıyor.' } };
  if (!seriState.seriToBilgi) await seriYukle(true);
  if (!seriState.seriToBilgi) return red({ tur: 'liste', message: 'SERI_STOK listesi yüklenemedi (bağlantı sorunu olabilir).' });
  const val = kod.trim();
  const bilgi = seriSahibi(val);
  if (!bilgi) return red({ tur: 'yok', detay: { seri: val } });
  if (!(bilgi.kalan > 0)) return red({ tur: 'cikis', detay: { seri: val, kalan: bilgi.kalan, ad: B().urunAdi(bilgi.kod) } });
  const kl = kalemListe(s);
  const zaten = kl.find(k => k.seriNo && normSeri(k.seriNo) === normSeri(val));
  if (zaten) return red({ tur: 'ayni_sevkiyat', detay: { seri: val, n: zaten.n } });
  const bos = k => !(k.seriNo && String(k.seriNo).trim()) && !kalemKilitli(s, k);   // teslim edilmiş grubun satırı hedef olmaz
  if (ctx && String(bilgi.kod) !== String(ctx.hedefKod)) {
    return red({ tur: 'yanlis', detay: { seri: val, bulunanKod: bilgi.kod, bulunanAd: B().urunAdi(bilgi.kod), beklenenKod: String(ctx.hedefKod), beklenenAd: B().urunAdi(ctx.hedefKod) } });
  }
  const ilkSatir = ctx && !ctx.ilkTamam ? kl.find(k => String(k.n) === String(ctx.ilkN)) : null;
  const hedef = ilkSatir || kl.find(k => bos(k) && String(k.kod) === String(bilgi.kod));
  if (!hedef) return red({ tur: 'eslesme_yok', detay: { seri: val, bulunanKod: bilgi.kod, bulunanAd: B().urunAdi(bilgi.kod) } });
  const degistirme = !!ilkSatir && !bos(ilkSatir);
  const r = await seriKaydet(s, hedef.n, val);
  s = aktif();
  if (!r.ok) return red(r.hata);
  if (ctx && ilkSatir) ctx.ilkTamam = true;
  if (s) detayCiz(s);
  const kalanKod = s ? kalemListe(s).filter(k => bos(k) && String(k.kod) === String(bilgi.kod)).length : 0;
  const bitti = !s || (ctx ? (degistirme || kalanKod === 0) : kalemListe(s).every(kalemTamam));
  return { ok: true, mesaj: (hedef.n + 1) + '. ' + hedef.urun + ' → ' + val, bitti, siradaki: s ? (ctx ? (kalanKod ? 'Aynı üründen ' + kalanKod + ' adet daha' : 'Bu ürün tamam') : siradakiMetin(s)) : '' };
}
function taraBaslat(n) {
  const s = aktif(); if (!s) return;
  let ctx = null;
  if (n !== undefined && s.kalemler && s.kalemler[n]) ctx = { hedefKod: String(s.kalemler[n].kod), ilkN: String(n), ilkTamam: false };
  const sira = () => {
    const g = aktif() || s;
    if (!ctx) return siradakiMetin(g);
    const k = (g.kalemler || {})[ctx.ilkN];
    const bos = kalemListe(g).filter(x => String(x.kod) === ctx.hedefKod && !(x.seriNo && String(x.seriNo).trim())).length;
    return (k ? k.urun : 'Ürün') + (bos > 1 ? ' · ' + bos + ' adet' : '');
  };
  kameraTara({
    siradaki: sira,
    onKod: kod => seriKodIsle(kod, ctx),
    uyariGoster,
    onKapat: () => { const g = aktif(); if (g) detayCiz(g); }
  });
}

// ═══ Olay yönetimi ═════════════════════════════════════════════
const aktif = () => state.acik && state.list.get(state.acik);
const yenidenCiz = () => { const s = aktif(); return s ? detayCiz(s) : listeCiz(); };
const hataTekrar = (m, t) => uyariGoster({ tur: t || 'genel', message: m });

async function tikla(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const s = aktif();
  if (act === 'kapat') return kapat();
  if (act === 'geri') { const d = derinlik(); state.acik = null; return d >= 3 ? sorguCiz() : listeCiz(); }
  if (act === 'yenile') { el.disabled = true; await yenileGenel(true); return; }
  if (act === 'tur') { state.sayfa = 30; state.tur = el.dataset.k; if (state.tur === 'musteri') state.servis = ''; return listeCiz(true); }
  if (act === 'tarih') { state.tarih = el.dataset.k; state.sayfa = 30; return listeCiz(true); }
  if (act === 'magaza') { state.magaza = !state.magaza; state.sayfa = 30; return listeCiz(true); }
  if (act === 'benim') { state.benim = !state.benim; state.sayfa = 30; return listeCiz(true); }
  if (act === 'sorgu') return sorguCiz();
  if (act === 'sorgula') return sorguCalistir(el);
  if (act === 'daha') { state.sayfa += 30; return listeCiz(); }
  if (act === 'kapsure') {
    const k = el.dataset.k; state.kapSure = k === 'aralik' ? 'aralik' : Number(k); state.sayfa = 30;
    if (state.kapSure === 'aralik' && !state.kT1) { state.kT2 = bugun(); state.kT1 = gunEkle(bugun(), -90); }
    try { await kapaliVeriYukle(false); bilinenOgren(); } catch (er) { console.warn(er); }
    return listeCiz(true);
  }
  if (act === 'kpi') {
    const k = el.dataset.k;
    if (k === 'geciken' || k === 'bugun' || k === 'yarin') { state.tarih = state.tarih === k ? 'tumu' : k; state.filtre = 'aktif'; }
    else if (k === 'barkod') { state.filtre = state.filtre === 'barkod_bekliyor' ? 'aktif' : 'barkod_bekliyor'; state.tarih = 'tumu'; }
    else if (k === 'serviste') { state.filtre = state.filtre === 'serviste' ? 'aktif' : 'serviste'; state.tarih = 'tumu'; }
    return listeCiz(true);
  }
  if (act === 'filtre') {
    state.filtre = el.dataset.k;
    state.sayfa = 30;
    if (kapaliFiltre()) { try { await kapaliVeriYukle(false); bilinenOgren(); } catch (er) { console.warn(er); } }
    return listeCiz(true);
  }
  if (act === 'detay') {
    state.acik = el.dataset.id; taslakSifirla(state.acik); detayCiz(state.list.get(state.acik));
    const g = state.list.get(state.acik);
    if (g && g.servisTeslim && !g.kapali) { const id = state.acik; seriYukle(false).then(() => { if (state.acik === id) detayCiz(state.list.get(id)); }); }
    return;
  }
  if (act === 'rapor') return raporAc();
  if (act === 'secmod') { if (!yonetici()) return; state.secimModu = !state.secimModu; state.secim.clear(); return listeCiz(); }
  if (act === 'sec') { const id = el.dataset.id; if (state.secim.has(id)) state.secim.delete(id); else state.secim.add(id); return listeCiz(); }
  if (act === 'secyok') return toast('Tamamlanmış kayıtlar silinemez; ürün geri döndüyse önce “İade” kaydı açılır.', []);
  if (act === 'sectum') { goruntulenen().filter(silinebilir).forEach(x => state.secim.add(x.saleNo)); return listeCiz(); }
  if (act === 'toplusil') return topluSil();
  if (act === 'taraurun') return taraBaslat(el.dataset.n);
  if (act === 'yazdir') {
    const liste = goruntulenen().filter(x => !x.kapali);
    return listeAc(liste, tarihEtiketi());
  }
  if (act === 'yonetim') { tanimTaslakHazirla(); return yonetimCiz(); }
  if (act === 'tmekle') { tanimTaslak.markalar.push(['', '']); return yonetimCiz(); }
  if (act === 'tmsil') { tanimTaslak.markalar.splice(Number(el.dataset.i), 1); return yonetimCiz(); }
  if (act === 'tekle') { tanimTaslak[el.dataset.l].push(''); return yonetimCiz(); }
  if (act === 'tsil') { tanimTaslak[el.dataset.l].splice(Number(el.dataset.i), 1); return yonetimCiz(); }
  if (act === 'tkaydet') return tanimKaydetAkis(el);
  if (act === 'toplu') return topluDegistir(el.dataset.t, el);
  if (act === 'yetim') return yetimTara(el);
  if (act === 'yetimac') return yetimAc(el.dataset.id, el);
  if (act === 'esitle') return esitleCalistir(el);
  if (!s) return;
  if (act === 'depofisi') return belgeAc('depo', s);
  if (act === 'teslimbelge') return belgeAc('teslim', s);
  if (act === 'satispdf') { if (!B().satisPdf(s.saleNo)) toast('Sözleşme verisi bu cihazda bulunamadı.', []); return; }
  if (act === 'waservis') {
    const m = servisMesaji(s);
    try { await navigator.clipboard.writeText(m); toast('Servis mesajı kopyalandı', [['WhatsApp\'ta aç', () => window.open('https://wa.me/?text=' + encodeURIComponent(m), '_blank')]]); }
    catch (er) { window.open('https://wa.me/?text=' + encodeURIComponent(m), '_blank'); }
    return;
  }
  if (act === 'wa') return waAc(s);
  if (act === 'watesl') return waTeslimAc(s);
  if (act === 'imzatemizle') { taslakSifirla(null, el.dataset.g); return yenidenCiz(); }
  if (act === 'kopyala') return musteriKopyala(s);   // V11.37: herkes basabilir; yönetici dışı için 1 kez sınırı musteriKopyala içinde
  if (!depoYetkili() && !(seriYetkili(s) && ['tara', 'kalemekle', 'kalemdeg', 'teslim', 'cikisdogrula', 'kalemtur', 'kalemsrv'].includes(act))) return;   // V11.32/37: satış personeli yalnız KENDİ satışında seri okut / ürün ekle / değiştir / teslim / çıkış doğrula / teslim şekli; başkasının satışı salt okunur
  if (act === 'tara') return taraBaslat();

  if (act === 'kalemtur') {
    const n = el.dataset.n, yeni = el.dataset.k;
    const kl = (s.kalemler || {})[n]; if (!kl || kalemTur(s, kl) === yeni) return;
    await guncelle(s, sunucu => {
      const e = (sunucu.kalemler || {})[n];
      if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış.', tur: 'kapali' };
      if (!e || e.cikarildi) return { hata: 'Satır bulunamadı (başka bir cihazda çıkarılmış olabilir).', tur: 'eksik' };
      if (e.teslim || grupTeslim(sunucu, kalemTur(sunucu, e)) || grupTeslim(sunucu, yeni)) return { hata: 'Bu ürünün ya da seçilen teslim grubunun teslimi yapılmış. Değiştirmek için yönetici önce “Teslimi geri al” yapmalıdır.', tur: 'kilitli' };
      return { yaz: { ['kalemler.' + n + '.teslimSekli']: yeni } };
    }, 'kalem_teslim_sekli', (n * 1 + 1) + '. ' + String(kl.urun).slice(0, 40) + ' → ' + TUR_KISA[yeni]);
    return yenidenCiz();
  }
  if (act === 'kalemsrv') {
    const n = el.dataset.n, ad = el.dataset.v; const kl = (s.kalemler || {})[n]; if (!kl) return;
    const yeni = kl.servis === ad ? '' : ad;     // aynı ada tekrar basınca seçim kalkar
    await guncelle(s, sunucu => {
      const e = (sunucu.kalemler || {})[n];
      if (sunucu.kapali || !e || e.cikarildi) return { hata: 'Sevkiyat kapanmış ya da satır bulunamadı.', tur: 'kapali' };
      if (e.teslim || grupTeslim(sunucu, kalemTur(sunucu, e))) return { hata: 'Bu ürünün teslimi yapılmış; servis adı değiştirilemez.', tur: 'kilitli' };
      return { yaz: { ['kalemler.' + n + '.servis']: yeni } };
    }, 'kalem_servis', (n * 1 + 1) + '. ' + String(kl.urun).slice(0, 40) + ' → ' + (yeni || '—'), { cevrimdisiOk: true });
    return yenidenCiz();
  }
  if (act === 'serisizyap') {
    if (!yonetici()) return;
    const n = el.dataset.n, kl = (s.kalemler || {})[n]; if (!kl) return;
    const v = await diyalog({ ikon: 'alert', kat: 'Yönetici işlemi', baslik: 'Bu ürün için seri gerekmesin mi?', tamam: 'Seri gerekmez yap', vazgec: 'Vazgeç', tehlike: true,
      ozet: (kl.urun || kl.kod) + ' seri takipli görünüyor ancak stokta seri yok. Yalnızca ürünün gerçekten seri numarasız olduğundan eminseniz işaretleyin; gerekçe kayda geçer.',
      govde: '<label class="svk-lbl">Gerekçe *</label><input class="svk-in" data-f="neden" placeholder="Örn: aksesuar, seri etiketi yok">', dogrula: x => !String(x.neden).trim() ? 'Gerekçe yazın.' : '' });
    if (!v) return;
    await guncelle(s, sunucu => (sunucu.kapali || sunucu.servisTeslim) ? { hata: 'Sevkiyat teslim edilmiş/kapanmış.', tur: 'kilitli' }
      : { yaz: { ['kalemler.' + n + '.seriGerekliDegil']: { t: Date.now(), u: eposta(), neden: String(v.neden).trim() } } }, 'seri_gerekmez', 'kalem ' + (Number(n) + 1) + ': ' + String(v.neden).trim());
    return yenidenCiz();
  }
  if (act === 'kalemekle') return kalemEkle(s);
  if (act === 'kalemdeg') return kalemDegistir(s, el.dataset.n);
  if (act === 'kalemcikar') return kalemCikar(s, el.dataset.n);
  if (act === 'teslim') {
    const tur = el.dataset.g === 'musteri' ? 'musteri' : 'servis', td = taslak.g[tur];
    const alan = (($('svk-alan-' + tur) || {}).value || '').trim();
    if (!alan) return hataTekrar(tur === 'musteri' ? 'Teslim alan kişinin (müşterinin) adını yazınız.' : 'Teslim alan servis yetkilisinin adını yazınız.', 'eksik');
    if (tur === 'musteri' && !(td.imzaVar && td.imza)) return hataTekrar('Müşterinin kendisi aldığı ürünler için imza zorunludur. Lütfen imza alın.', 'eksik');
    const gk = kalemListe(s).filter(x => kalemTur(s, x) === tur && !x.teslim);
    const sec = gk.filter(x => kalemTamam(x) && !td.hayir.has(x.n));
    if (!sec.length) return hataTekrar('Teslim edilecek ürün seçilmedi (ya da seçilenlerin seri numarası okutulmadı).', 'eksik');
    if (s.depoZorunlu && sec.some(x => !String(x.depo || '').trim())) return hataTekrar('Teslim etmeden önce bu ürünler için çıkış deposunu seçin (Ürünler ve seri numaraları bölümü).', 'eksik');
    const secN = sec.map(x => x.n);
    const simS = { ...s, kalemler: { ...s.kalemler } }; secN.forEach(n => { simS.kalemler[n] = { ...s.kalemler[n], teslim: { t: 1 } }; });
    const sonGrup = hepsiTeslim(simS);   // bu teslimle sevkiyatın tamamı bitiyor mu
    if (sonGrup && Number(s.tahsilatTutari) > 0 && !s.tahsilatAlindi &&
        !(await onay('Tahsilat işaretlenmedi', 'Teslimde tahsil edilecek ' + tl(s.tahsilatTutari) + ' henüz “alındı” olarak işaretlenmemiş. Yine de teslim edilsin mi?', 'Yine de teslim et', true))) return;
    const veri = { t: Date.now(), u: eposta(), alan, ...(tur === 'servis' && servisAdlari(s).length ? { srv: servisAdlari(s) } : {}) };
    if (td.imzaVar && td.imza) veri.imza = td.imza;
    const ok = await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat zaten kapanmış.', tur: 'kapali' };
      const kl = sunucu.kalemler || {};
      const sk = secN.map(n => ({ ...(kl[n] || {}), n })).filter(x => kl[x.n] && !x.cikarildi);
      if (sk.length !== secN.length) return { hata: 'Seçilen ürünlerden biri bu arada çıkarılmış/değiştirilmiş (başka bir cihazda).', tur: 'eksik' };
      if (sk.some(x => x.teslim) || sk.some(x => kalemTur(sunucu, x) !== tur)) return { hata: 'Seçilen ürünlerden biri zaten teslim edilmiş.', tur: 'kapali' };
      if (!sk.every(kalemTamam)) return { hata: 'Seri okutulmadan teslim edilemez (başka bir cihazda ürün eklenmiş / seri silinmiş olabilir).', tur: 'eksik' };
      if (sunucu.depoZorunlu && sk.some(x => !String(x.depo || '').trim())) return { hata: 'Her ürün için çıkış deposu seçilmeli.', tur: 'eksik' };
      const yaz = {}; const sim = { ...sunucu, kalemler: { ...kl } };
      secN.forEach(n => { yaz['kalemler.' + n + '.teslim'] = veri; sim.kalemler[n] = { ...kl[n], teslim: veri }; });
      if (grupTeslim(sim, tur)) yaz['teslimler.' + tur] = veri;               // grubun tamamı bitti
      if (hepsiTeslim(sim)) yaz.servisTeslim = veri;                         // tüm gruplar teslim → kapanış hattı (çıkış doğrulama)
      return { yaz };
    }, 'servise_teslim', TUR_KISA[tur] + ' · ' + alan + ' · ' + sec.map(x => x.urun).join(', ').slice(0, 80) + (sec.length < gk.length ? ' [KISMİ ' + sec.length + '/' + gk.length + ']' : ''));
    if (ok) taslakSifirla(null, tur);
    return yenidenCiz();
  }
  if (act === 'teslimgeri') {
    if (!yonetici()) return;
    const tur = el.dataset.g === 'musteri' ? 'musteri' : 'servis';
    if (!(await onay('Teslim geri alınsın mı?', TUR_AD[tur] + ' için kaydedilen TÜM teslimler silinir; bu ürünlerin seri ve ürün düzenlemesi yeniden açılır. Ürünler fiilen teslim edildiyse bunu yapmayın.', 'Teslimi geri al', true))) return;
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış; teslim geri alınamaz.', tur: 'kapali' };
      const gk = kalemListe(sunucu).filter(x => kalemTur(sunucu, x) === tur);
      if (!grupTeslim(sunucu, tur) && !gk.some(x => x.teslim)) return { hata: 'Bu ürünler zaten teslim edilmemiş.', tur: 'eksik' };
      const yaz = { ['teslimler.' + tur]: null, servisTeslim: null };
      gk.forEach(x => { if (x.teslim) yaz['kalemler.' + x.n + '.teslim'] = null; });
      return { yaz };
    }, 'teslim_geri_alindi', TUR_KISA[tur]);
    return yenidenCiz();
  }
  if (act === 'cikisdogrula') {
    await seriYukle(true);
    const c = cikisDurumu(s);
    if (!c.hazir) { yenidenCiz(); return toast(c.veriVar ? '<b>' + c.bekleyen + ' seri</b> stok verisinde hâlâ görünüyor — ürünün diğer programdan çıkışı yapılıp günlük veri güncellenince sevkiyat kendiliğinden kapanır.' : 'Stok verisi yüklenemedi; bağlantınızı kontrol edip tekrar deneyin.', []); }
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat zaten kapanmış.', tur: 'kapali' };
      if (!sunucu.servisTeslim) return { hata: 'Önce teslim kaydedilmeli.', tur: 'eksik' };
      const cs = cikisDurumu(sunucu);
      if (!cs.hazir) return { hata: 'Aşağıdaki seri(ler) stok verisinde hâlâ görünüyor.', tur: 'cikis_bekliyor', detay: { seriler: cs.satirlar.filter(x => x.durum === 'stokta' || x.durum === 'seri_yok' || x.durum === 'bilinmiyor').map(x => x.seri || ('(' + x.k.urun + ')')) } };
      return { yaz: { teslimEdildi: { t: Date.now(), u: eposta(), dogrulama: 'otomatik' } } };
    }, 'teslim_edildi', 'çıkış doğrulandı');
    return yenidenCiz();
  }
  if (act === 'cikiszorla') {
    if (!yonetici()) return;
    const v = await diyalog({
      ikon: 'alert', kat: 'Yönetici işlemi', baslik: 'Çıkış doğrulaması atlanarak tamamlansın mı?', tamam: 'Yine de tamamla', vazgec: 'Vazgeç', tehlike: true,
      ozet: 'Bazı seriler stok verisinde hâlâ görünüyor. Yalnızca çıkışın yapıldığından eminseniz (stok verisi gecikmiş olabilir) tamamlayın. Gerekçe kayda geçer.',
      govde: '<label class="svk-lbl">Gerekçe *</label><textarea class="svk-in" data-f="neden" placeholder="Örn: Çıkış yapıldı, günlük veri henüz güncellenmedi"></textarea>',
      dogrula: x => !String(x.neden).trim() ? 'Gerekçe yazın.' : ''
    });
    if (!v) return;
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat zaten kapanmış.', tur: 'kapali' };
      if (!sunucu.servisTeslim) return { hata: 'Önce teslim kaydedilmeli.', tur: 'eksik' };
      return { yaz: { teslimEdildi: { t: Date.now(), u: eposta(), dogrulama: 'yonetici', neden: String(v.neden).trim() } } };
    }, 'teslim_edildi', 'yönetici onayı: ' + String(v.neden).trim());
    return yenidenCiz();
  }
  if (act === 'tahsilat') {
    if (!(await onay('Tahsilat alındı mı?', tl(s.tahsilatTutari) + ' tahsil edildi olarak işaretlenecek.', 'Evet, alındı'))) return;
    await guncelle(s, sunucu => sunucu.tahsilatAlindi ? { hata: 'Tahsilat zaten işaretlenmiş.', tur: 'kapali' }
      : { yaz: { tahsilatAlindi: { t: Date.now(), u: eposta(), tutar: Number(sunucu.tahsilatTutari) || 0 } } }, 'tahsilat_alindi', tl(s.tahsilatTutari));
    return yenidenCiz();
  }
  if (act === 'iade') return iadeEt(s);
  if (act === 'iptal') return iptalEt(s);
  if (act === 'iptalgeri') return iptalGeriAl(s);
  if (act === 'sil') return kaydiSil(s);
}

// ── Ürün ekle / değiştir / çıkar (teslimden önce) ───────────
function urunSec(baslik, ozet, tamamEt) {
  const bulunan = { kod: '', urun: '' };
  const pr = diyalog({
    ikon: 'box', ikCls: 'gri', kat: 'Ürün seçimi', katCls: 'gri', baslik, ozet, tamam: tamamEt || 'Seç', vazgec: 'Vazgeç',
    govde: '<label class="svk-lbl">Ürün ara (ad veya kod)</label><input class="svk-in" id="svk-uara" placeholder="Örn: davlumbaz NK24" autocomplete="off">' +
      '<div class="svk-usonuc" id="svk-usonuc"><div class="svk-not">En az 2 karakter yazın.</div></div><input type="hidden" data-f="kod"><input type="hidden" data-f="urun">' +
      '<label class="svk-lbl">Neden / açıklama</label><input class="svk-in" data-f="neden" placeholder="İsteğe bağlı (ör. müşteri model değiştirdi)" autocomplete="off">',
    dogrula: x => !x.kod ? 'Listeden bir ürün seçin.' : ''
  });
  const m = [...document.querySelectorAll('.svk-mdl')].pop();
  const inp = m && m.querySelector('#svk-uara'), box = m && m.querySelector('#svk-usonuc');
  if (inp) {
    const ara = () => {
      const q = inp.value.trim();
      const liste = q.length >= 2 && B().urunAra ? B().urunAra(q, 30) : [];
      box.innerHTML = q.length < 2 ? '<div class="svk-not">En az 2 karakter yazın.</div>' : (liste.length ? liste.map(x =>
        '<button type="button" class="svk-uitem' + (x.kod === bulunan.kod ? ' on' : '') + '" data-kod="' + esc(x.kod) + '" data-urun="' + esc(x.urun) + '"><b>' + esc(x.urun) + '</b><small>' + esc(x.kod) + '</small></button>').join('') : '<div class="svk-not">Sonuç yok.</div>');
    };
    inp.addEventListener('input', ara);
    box.addEventListener('click', e => {
      const b = e.target.closest('.svk-uitem'); if (!b) return;
      m.querySelector('[data-f="kod"]').value = b.dataset.kod; m.querySelector('[data-f="urun"]').value = b.dataset.urun;
      bulunan.kod = b.dataset.kod; box.querySelectorAll('.svk-uitem').forEach(x => x.classList.toggle('on', x === b));
    });
  }
  return pr;
}
async function kalemEkle(s) {
  const v = await urunSec('Ek ürün ekle', 'Bu sevkiyata yeni bir ürün satırı eklenir; seri numarası sonradan girilir. Satış belgesi değişmez, değişiklik hareket geçmişine yazılır.', 'Ürünü ekle');
  if (!v) return;
  const ok = await guncelle(s, sunucu => {
    if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış.', tur: 'kapali' };
    if (hepsiTeslim(sunucu)) return { hata: 'Tüm ürünleri teslim edilmiş sevkiyata ürün eklenemez.', tur: 'kilitli' };
    const n = Math.max(-1, ...Object.keys(sunucu.kalemler || {}).map(Number)) + 1;
    // yeni ürün, teslimi yapılmamış bir gruba girer (kaydın varsayılanı teslim edilmişse diğer grup)
    const vars = teslimTuru(sunucu), tsl = grupTeslim(sunucu, vars) ? (vars === 'musteri' ? 'servis' : 'musteri') : vars;
    return { yaz: { ['kalemler.' + n]: { urun: v.urun, kod: v.kod, seriNo: '', seriGerekliDegil: false, teslimSekli: tsl, ...markaGam(v.kod), ek: { t: Date.now(), u: eposta(), neden: String(v.neden || '').trim() } } } };
  }, 'kalem_eklendi', v.urun + ' (' + v.kod + ')' + (v.neden ? ' — ' + v.neden : ''));
  if (ok) toast('Ürün eklendi: <b>' + esc(v.urun) + '</b>', []);
  yenidenCiz();
}
async function kalemDegistir(s, n) {
  const k = (s.kalemler || {})[n]; if (!k) return;
  const dolu = !!(k.seriNo && String(k.seriNo).trim());
  const v = await urunSec('Ürünü değiştir', (n * 1 + 1) + '. satır: ' + k.urun + ' (' + k.kod + ').' + (dolu ? ' Girilmiş seri (' + k.seriNo + ') silinir ve serbest bırakılır.' : '') + ' Yeni ürünün seri numarası sonradan girilir.', 'Ürünü değiştir');
  if (!v) return;
  if (String(v.kod) === String(k.kod)) return hataTekrar('Aynı ürün seçildi; değişiklik yapılmadı.', 'eksik');
  const ok = await guncelle(s, sunucu => {
    if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış.', tur: 'kapali' };
    const e = (sunucu.kalemler || {})[n];
    if (!e || e.cikarildi) return { hata: 'Satır bulunamadı (başka bir cihazda çıkarılmış olabilir).', tur: 'eksik' };
    if (kalemKilitli(sunucu, e)) return { hata: 'Teslim edilmiş ürün değiştirilemez.', tur: 'kilitli' };
    const eskiSeri = e.seriNo && String(e.seriNo).trim() ? normSeri(e.seriNo) : '';
    return {
      yaz: { ['kalemler.' + n + '.urun']: v.urun, ['kalemler.' + n + '.kod']: v.kod, ['kalemler.' + n + '.seriNo']: '', ['kalemler.' + n + '.seriGerekliDegil']: false, ['kalemler.' + n + '.servis']: '', ['kalemler.' + n + '.marka']: markaGam(v.kod).marka, ['kalemler.' + n + '.gam']: markaGam(v.kod).gam,
        ['kalemler.' + n + '.degisti']: { eski: { urun: e.urun || '', kod: e.kod || '', seriNo: e.seriNo || '' }, t: Date.now(), u: eposta(), neden: String(v.neden || '').trim() } },
      seriSil: eskiSeri ? [eskiSeri] : []
    };
  }, 'kalem_degisti', (n * 1 + 1) + '. satır: ' + k.urun + ' → ' + v.urun + (v.neden ? ' — ' + v.neden : ''));
  if (ok) toast('Ürün değiştirildi: <b>' + esc(v.urun) + '</b>', []);
  yenidenCiz();
}
async function kalemCikar(s, n) {
  const k = (s.kalemler || {})[n]; if (!k) return;
  if (kalemListe(s).length < 2) return hataTekrar('Sevkiyatta en az bir ürün satırı kalmalı. Tüm sevkiyat için “iptal”i kullanın.', 'eksik');
  const v = await diyalog({ ikon: 'trash', kat: 'Onay', baslik: 'Ürün satırı çıkarılsın mı?', tamam: 'Satırı çıkar', vazgec: 'Vazgeç', tehlike: true,
    ozet: (n * 1 + 1) + '. satır: ' + k.urun + ' (' + k.kod + ')' + (k.seriNo ? ' — girilmiş seri ' + k.seriNo + ' serbest bırakılır.' : '.'),
    govde: '<label class="svk-lbl">Neden</label><input class="svk-in" data-f="neden" placeholder="İsteğe bağlı" autocomplete="off">' });
  if (!v) return;
  await guncelle(s, sunucu => {
    if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış.', tur: 'kapali' };
    const aktifSay = kalemListe(sunucu).length;
    const e = (sunucu.kalemler || {})[n];
    if (!e || e.cikarildi) return { hata: 'Satır zaten çıkarılmış.', tur: 'eksik' };
    if (kalemKilitli(sunucu, e)) return { hata: 'Teslim edilmiş üründe satır çıkarılamaz.', tur: 'kilitli' };
    if (aktifSay < 2) return { hata: 'Sevkiyatta en az bir ürün satırı kalmalı.', tur: 'eksik' };
    const eskiSeri = e.seriNo && String(e.seriNo).trim() ? normSeri(e.seriNo) : '';
    const yaz = { ['kalemler.' + n + '.cikarildi']: { t: Date.now(), u: eposta(), neden: String(v.neden || '').trim() }, ['kalemler.' + n + '.seriNo']: '' };
    // kalan tüm teslim grupları zaten teslim edilmişse kayıt kapanış hattına (çıkış doğrulama) geçer
    const sim = { ...sunucu, kalemler: { ...sunucu.kalemler, [n]: { ...e, cikarildi: true } } };
    if (!sunucu.servisTeslim && hepsiTeslim(sim)) { const son = [...Object.values(sunucu.teslimler || {}), ...Object.values(sunucu.kalemler || {}).map(z => z && z.teslim)].filter(Boolean).sort((a, b) => b.t - a.t)[0]; if (son) yaz.servisTeslim = son; }
    return { yaz, seriSil: eskiSeri ? [eskiSeri] : [] };
  }, 'kalem_cikarildi', (n * 1 + 1) + '. satır: ' + k.urun + (v.neden ? ' — ' + v.neden : ''));
  yenidenCiz();
}

// ── İade: teslim edilmiş ürünler depoya döndü ─────────────────
async function iadeEt(s) {
  if (!depoYetkili()) return;
  const v = await diyalog({
    ikon: 'undo', kat: 'İade / depoya dönüş', baslik: 'Ürünler depoya iade edilsin mi?', tamam: 'İadeyi kaydet', vazgec: 'Vazgeç', tehlike: true,
    ozet: s.saleNo + ' · ' + s.musteri + '. Sevkiyat “İade” olarak kapanır; seri numaraları bu sevkiyattan serbest kalır. Stoğa geri alma işlemini diğer programda da yapın — seri, günlük stok verisine döndüğünde yeniden satılabilir.',
    govde: '<label class="svk-lbl">İade nedeni *</label><select class="svk-in" data-f="neden"><option value="">Seçiniz</option>' + IADE_NEDENLERI.map(x => '<option>' + esc(x) + '</option>').join('') + '</select>' +
      '<label class="svk-lbl">Açıklama</label><textarea class="svk-in" data-f="not" placeholder="İsteğe bağlı (Diğer seçildiyse zorunlu)"></textarea>' +
      '<label class="onay"><input type="checkbox" data-f="geri"> Ürünlerin fiziksel olarak depoya geri teslim alındığını onaylıyorum.</label>',
    dogrula: x => !x.neden ? 'İade nedenini seçin.' : (x.neden === 'Diğer' && !String(x.not).trim()) ? '“Diğer” için açıklama yazın.' : !x.geri ? 'Ürünlerin depoya döndüğünü onaylayın.' : ''
  });
  if (!v) return;
  const bilgi = { t: Date.now(), u: eposta(), neden: v.neden, not: String(v.not || '').trim() };
  const ok = await guncelle(s, sunucu => {
    if (sunucu.iade) return { hata: 'Bu sevkiyat zaten iade edilmiş.', tur: 'kapali' };
    if (sunucu.iptal) return { hata: 'İptal edilmiş sevkiyat için iade kaydı açılamaz.', tur: 'kapali' };
    if (!sunucu.servisTeslim && !sunucu.teslimEdildi) return { hata: 'Henüz teslim edilmemiş sevkiyat için iade yerine “iptal” kullanılır.', tur: 'eksik' };
    const seriler = kalemListe(sunucu).filter(k => k.seriNo && String(k.seriNo).trim()).map(k => normSeri(k.seriNo));
    return { yaz: { iade: bilgi }, seriSil: seriler };
  }, 'iade', bilgi.neden + (bilgi.not ? ' — ' + bilgi.not : ''));
  if (ok) toast('İade kaydedildi: <b>' + esc(s.saleNo) + '</b>', []);
  yenidenCiz();
}

// ── Müşteri bilgisi panoya (diğer programa yapıştırmak için) ──
async function panoya(metin) {
  try { await navigator.clipboard.writeText(metin); return true; } catch (e) { /* yoksay */ }
  try {
    const t = document.createElement('textarea'); t.value = metin; t.style.cssText = 'position:fixed;opacity:0;top:0;left:0'; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch (e) { return false; }
}
async function musteriKopyala(s) {
  const metin = musteriMetni(s);   // V11.37: tamamı büyük harf · T.C. + e-posta dahil
  if (yonetici()) { toast((await panoya(metin)) ? 'Müşteri bilgileri panoya kopyalandı.' : 'Kopyalanamadı — tarayıcı izin vermedi.', []); return; }
  // Yönetici dışı: sevkiyat başına yalnız 1 kez. Önce kullanım sunucuda işlenir (başka cihazdan da tekrar edilemez), sonra panoya yazılır.
  if (kopyaYapildi(s)) return toast('Bu sevkiyatın müşteri bilgisini daha önce kopyaladınız. Yeniden kopyalama yalnızca yönetici tarafından yapılabilir.', []);
  const anahtar = kopyaAnahtar(eposta());
  if (!anahtar) return;
  const ok = await guncelle(s, sunucu => (sunucu.kopya && sunucu.kopya[anahtar])
    ? { hata: 'Bu sevkiyatın müşteri bilgisi daha önce kopyalanmış. Yeniden kopyalama yalnızca yönetici tarafından yapılabilir.', tur: 'kilitli' }
    : { yaz: { ['kopya.' + anahtar]: Date.now() } }, 'musteri_kopyalandi', '');
  if (!ok) return yenidenCiz();
  if (await panoya(metin)) toast('Müşteri bilgileri panoya kopyalandı. (Bu sevkiyat için tek seferlik hak kullanıldı.)', []);
  else await diyalog({ ikon: 'file', ikCls: 'gri', kat: 'Müşteri bilgisi', katCls: 'gri', baslik: 'Metni elle kopyalayın', tamam: 'Kapat',
    ozet: 'Tarayıcı otomatik kopyalamaya izin vermedi. Aşağıdaki metni seçip kopyalayın (bu pencere kapanınca yeniden kopyalanamaz).',
    govde: '<textarea class="svk-in" rows="12" readonly style="width:100%" onfocus="this.select()">' + esc(metin) + '</textarea>' });
  yenidenCiz();
}

// ── İptal / geri alma / silme (yalnızca yönetici) ─────────────
async function iptalEt(s) {
  if (!yonetici()) return;
  const serviste = !!s.servisTeslim || kismiTeslim(s);
  const kalemSayisi = kalemListe(s).filter(k => k.seriNo && String(k.seriNo).trim()).length;
  const v = await diyalog({
    ikon: 'ban', kat: 'Yönetici işlemi', baslik: 'Sevkiyat iptal edilsin mi?', tamam: 'Sevkiyatı iptal et', vazgec: 'Vazgeç', tehlike: true,
    ozet: s.saleNo + ' · ' + s.musteri + '. İptal edilen sevkiyatta okutulmuş ' + kalemSayisi + ' seri numarası tekrar kullanılabilir hâle gelir. İşlem geri alınabilir.',
    govde:
      '<label class="svk-lbl">İptal nedeni *</label><select class="svk-in" data-f="neden"><option value="">Seçiniz</option>' + IPTAL_NEDENLERI.map(x => '<option>' + esc(x) + '</option>').join('') + '</select>' +
      '<label class="svk-lbl">Açıklama</label><textarea class="svk-in" data-f="not" placeholder="İsteğe bağlı not (Diğer seçildiyse zorunlu)"></textarea>' +
      (serviste ? '<label class="onay"><input type="checkbox" data-f="geri"> Ürünler servise teslim edilmişti; ürünlerin geri alındığını / durumunun netleştiğini onaylıyorum.</label>' : ''),
    dogrula: x => !x.neden ? 'Lütfen iptal nedenini seçin.' : (x.neden === 'Diğer' && !String(x.not).trim()) ? '“Diğer” için açıklama yazın.' : (serviste && !x.geri) ? 'Servise teslim edilmiş ürünler için onay kutusunu işaretleyin.' : ''
  });
  if (!v) return;
  const bilgi = { t: Date.now(), u: eposta(), neden: v.neden, not: String(v.not || '').trim() };
  await guncelle(s, sunucu => {
    if (sunucu.silindi) return { hata: 'Kayıt silinmiş.', tur: 'kapali' };
    if (sunucu.iptal) return { hata: 'Sevkiyat zaten iptal edilmiş.', tur: 'kapali' };
    if (sunucu.teslimEdildi || sunucu.iade) return { hata: 'Tamamlanmış / iade edilmiş sevkiyat iptal edilemez. Ürün geri döndüyse “İade / depoya dönüş” kullanılır.', tur: 'kapali' };
    const seriler = kalemListe(sunucu).filter(k => k.seriNo && String(k.seriNo).trim()).map(k => normSeri(k.seriNo));
    return { yaz: { iptal: true, iptalBilgi: bilgi }, seriSil: seriler };
  }, 'iptal', bilgi.neden + (bilgi.not ? ' — ' + bilgi.not : ''));
  yenidenCiz();
}
async function iptalGeriAl(s) {
  if (!yonetici()) return;
  if (!(await onay('İptal geri alınsın mı?', s.saleNo + ' yeniden aktif hâle gelir; seri numaraları bu sevkiyata yeniden bağlanır. Başka bir sevkiyatta kullanılmışsa işlem reddedilir.', 'İptali geri al'))) return;
  await guncelle(s, sunucu => {
    if (sunucu.silindi) return { hata: 'Silinmiş kayıt geri alınamaz.', tur: 'kapali' };
    if (!sunucu.iptal) return { hata: 'Sevkiyat iptal durumunda değil.', tur: 'eksik' };
    const ekle = kalemListe(sunucu).filter(k => k.seriNo && String(k.seriNo).trim()).map(k => ({ seri: normSeri(k.seriNo), n: k.n, kod: k.kod }));
    return { yaz: { iptal: false, iptalBilgi: null }, seriEkle: ekle };
  }, 'iptal_geri_alindi');
  yenidenCiz();
}
const SIL_NEDENLERI = ['Hatalı / test kaydı', 'Mükerrer kayıt', 'Müşteri vazgeçti', 'Satış iptal edildi', 'Diğer'];
// Kaydı listeden kaldırır (denetim için veritabanında saklanır) ve seri kilitlerini serbest bırakır.
// Tamamlanmış (çıkışı doğrulanmış) kayıtlar silinmez — ürün geri döndüyse “İade” kullanılır.
function silPlani(bilgi) {
  return sunucu => {
    if (sunucu.silindi) return { hata: 'Kayıt zaten silinmiş.', tur: 'kapali' };
    if (sunucu.teslimEdildi && !sunucu.iade) return { hata: 'Tamamlanmış kayıt silinemez. Ürün geri döndüyse “İade / depoya dönüş” kullanın.', tur: 'kapali' };
    const seriler = kalemListe(sunucu).filter(k => k.seriNo && String(k.seriNo).trim()).map(k => normSeri(k.seriNo));
    return { yaz: { silindi: bilgi }, seriSil: seriler };
  };
}
const silGovde = (teslimliSay) => '<label class="svk-lbl">Silme nedeni *</label><select class="svk-in" data-f="neden"><option value="">Seçiniz</option>' + SIL_NEDENLERI.map(x => '<option>' + esc(x) + '</option>').join('') + '</select>' +
  '<label class="svk-lbl">Açıklama</label><textarea class="svk-in" data-f="not" placeholder="İsteğe bağlı (Diğer seçildiyse zorunlu)"></textarea>' +
  (teslimliSay ? '<label class="onay"><input type="checkbox" data-f="teslimli"> ' + teslimliSay + ' kayıt servise/müşteriye teslim edilmişti; ürünlerin durumunun netleştiğini onaylıyorum.</label>' : '');
const silDogrula = teslimliSay => x => !x.neden ? 'Silme nedenini seçin.' : (x.neden === 'Diğer' && !String(x.not).trim()) ? '“Diğer” için açıklama yazın.' : (teslimliSay && !x.teslimli) ? 'Teslim edilmiş kayıtlar için onay kutusunu işaretleyin.' : '';

async function kaydiSil(s) {
  if (!yonetici() || !silinebilir(s)) return;
  const tes = s.servisTeslim && !s.iade ? 1 : 0;
  const v = await diyalog({
    ikon: 'trash', kat: 'Yönetici işlemi', baslik: 'Kayıt silinsin mi?', tamam: 'Kaydı sil', vazgec: 'Vazgeç', tehlike: true,
    ozet: s.saleNo + ' · ' + s.musteri + '. Kayıt listelerden kaldırılır, seri numaraları serbest kalır; denetim için veritabanında saklanır.',
    govde: silGovde(tes), dogrula: silDogrula(tes)
  });
  if (!v) return;
  const bilgi = { t: Date.now(), u: eposta(), neden: v.neden, not: String(v.not || '').trim() };
  const ok = await guncelle(s, silPlani(bilgi), 'silindi', bilgi.neden + (bilgi.not ? ' — ' + bilgi.not : ''));
  if (ok) { state.list.delete(s.saleNo); state.acik = null; listeCiz(); toast('Kayıt silindi: <b>' + esc(s.saleNo) + '</b>', []); }
}
async function topluSil() {
  if (!yonetici()) return;
  const secilen = [...state.secim].map(id => state.list.get(id)).filter(x => x && silinebilir(x));
  if (!secilen.length) return;
  const tes = secilen.filter(x => x.servisTeslim && !x.iade).length;
  const v = await diyalog({
    ikon: 'trash', kat: 'Yönetici işlemi', baslik: secilen.length + ' kayıt silinsin mi?', tamam: 'Seçilenleri sil', vazgec: 'Vazgeç', tehlike: true,
    ozet: 'Seçilen kayıtlar listelerden kaldırılır, okutulmuş seri numaraları serbest kalır; denetim için veritabanında saklanır. Tamamlanmış kayıtlar silinemez.',
    satirlar: secilen.slice(0, 6).map(x => [x.saleNo, x.musteri]).concat(secilen.length > 6 ? [['…', '+ ' + (secilen.length - 6) + ' kayıt daha']] : []),
    govde: silGovde(tes), dogrula: silDogrula(tes)
  });
  if (!v) return;
  const bilgi = { t: Date.now(), u: eposta(), neden: v.neden, not: String(v.not || '').trim() };
  let basarili = 0; const hatalar = [];
  for (const x of secilen) {
    const ok = await guncelle(x, silPlani(bilgi), 'silindi', bilgi.neden + (bilgi.not ? ' — ' + bilgi.not : ''), { hata: m => hatalar.push(x.saleNo + ': ' + m) });
    if (ok) { basarili++; state.list.delete(x.saleNo); }
  }
  state.secim.clear(); state.secimModu = false; listeCiz();
  toast('<b>' + basarili + '</b> kayıt silindi' + (hatalar.length ? ' · <b>' + hatalar.length + '</b> kayıt silinemedi' : '') + '.', []);
  if (hatalar.length) await uyariGoster({ tur: 'genel', message: 'Silinemeyen kayıtlar:\n' + hatalar.join('\n') });
}

let seriIsleniyor = false;
async function degisti(e) {
  const t = e.target;
  if (t.id === 'svk-fservis') { state.servis = t.value; state.sayfa = 30; return listeCiz(); }
  if (t.classList.contains('svk-tm')) { tanimTaslak.markalar[Number(t.dataset.i)][Number(t.dataset.f)] = t.value; return; }
  if (t.classList.contains('svk-tn')) { tanimTaslak[t.dataset.l][Number(t.dataset.i)] = t.value; return; }
  if (t.id === 'svk-fdepo') { state.depo = t.value; state.sayfa = 30; return listeCiz(); }
  if (t.id === 'svk-k1' || t.id === 'svk-k2') {
    state[t.id === 'svk-k1' ? 'kT1' : 'kT2'] = t.value; state.sayfa = 30;
    if (state.kT1 && state.kT2) { try { await kapaliVeriYukle(true); } catch (er) { console.warn(er); } }
    return listeCiz();
  }
  if (t.id === 'svk-t1' || t.id === 'svk-t2') { state[t.id === 'svk-t1' ? 't1' : 't2'] = t.value; return listeCiz(); }
  const s = aktif();
  if (t.classList.contains('svk-sec') && s) { const tur = t.dataset.g === 'musteri' ? 'musteri' : 'servis', n = Number(t.dataset.n); if (t.checked) taslak.g[tur].hayir.delete(n); else taslak.g[tur].hayir.add(n); return yenidenCiz(); }
  if (s && !s.kapali && seriYetkili(s) && t.classList.contains('svk-depo')) return depoDegisti(s, t);
  const planAlani = ['svk-d-not', 'svk-d-servis', 'svk-d-tarih', 'svk-d-saat', 'svk-d-nokta'].includes(t.id);
  if (!s || s.kapali || !seriYetkili(s)) return;   // V11.37: değişiklik yalnızca satışı yapan + destek + yönetici
  if (!depoYetkili() && !planAlani && !t.classList.contains('svk-seri')) return;
  if (t.classList.contains('svk-seri')) {
    const n = t.dataset.n, val = t.value.trim();
    const once = String((s.kalemler[n] || {}).seriNo || '').trim();
    if (val === once || kalemKilitli(s, s.kalemler[n] || {})) return;
    const ilerlet = t.dataset.enter === '1';
    if (seriIsleniyor) return;           // aynı girişin ikinci 'change' olayı (ör. odak kaybı) çift diyalog açmasın
    seriIsleniyor = true;
    try {
      const r = await seriKaydet(s, n, val);
      if (!r.ok) { if (await seriIadeIcinDene(s, n, val, r.hata)) return; await uyariGoster(r.hata); return yenidenCiz(); }
    } finally { seriIsleniyor = false; }
    yenidenCiz();
    if (ilerlet && val) sonrakiBosaOdaklan(n);
  } else if (t.id === 'svk-d-not') {
    const yeni = t.value.trim();
    if (yeni === String(s.not || '').trim()) return;
    await guncelle(s, { not: yeni }, 'not_degisti', yeni.slice(0, 80), { cevrimdisiOk: true });
    yenidenCiz();
  } else if (t.id === 'svk-d-nokta') {
    try { localStorage.setItem('svk_nokta', t.value); } catch (_) {}
    await guncelle(s, { satisNoktasi: t.value }, 'teslimat_degisti', 'Satış noktası: ' + (t.value || '—'), { cevrimdisiOk: true });
    yenidenCiz();
  } else if (t.id === 'svk-d-servis') {
    await guncelle(s, { atananServis: t.value }, 'servis_atandi', t.value, { cevrimdisiOk: true });
    yenidenCiz();
  } else if (t.id === 'svk-d-tarih' || t.id === 'svk-d-saat') {
    const tarih = ($('svk-d-tarih') || {}).value || s.teslimTarihi;
    if (!tarih) return;
    await guncelle(s, { teslimTarihi: tarih, teslimSaati: ($('svk-d-saat') || {}).value || '' }, 'teslimat_degisti', tarihTR(tarih), { cevrimdisiOk: true });
    yenidenCiz();
  }
}

// ═══ Seri / müşteri raporu (Excel) ═════════════════════════════
// Akşam kontrolü: seçilen teslimat tarihi aralığında hangi müşteriye hangi ürün (hangi seriyle) verildi.
// Tüm kullanıcılar alabilir. Tek sorgu (en çok 1500 kayıt); yalnızca düğmeye basılınca çalışır.
const csvHucre = v => { const t = String(v == null ? '' : v).replace(/"/g, '""'); return /[;"\n\r]/.test(t) ? '"' + t + '"' : t; };
const metinHucre = v => (v === '' || v == null) ? '' : '="' + String(v).replace(/"/g, '""') + '"';   // uzun sayı/kod Excel'de bozulmasın
async function raporAc() {
  const bg = bugun();
  const v = await diyalog({
    ikon: 'file', ikCls: 'gri', kat: 'Rapor', katCls: 'gri', baslik: 'Seri / müşteri raporu (Excel)', tamam: 'Excel indir', vazgec: 'Vazgeç',
    ozet: 'Seçilen teslimat tarihi aralığında hangi müşteriye hangi ürün, hangi seri numarasıyla verildi. Dosya Excel ile açılır.',
    govde: '<div class="svk-aralik"><input type="date" class="svk-in" data-f="t1" value="' + bg + '"><span>–</span><input type="date" class="svk-in" data-f="t2" value="' + bg + '"></div>' +
      '<label class="onay"><input type="checkbox" data-f="serisiz"> Seri girilmemiş satırları da göster</label>' +
      '<label class="onay"><input type="checkbox" data-f="iptal"> İptal / iade edilenleri de göster</label>',
    dogrula: x => !x.t1 || !x.t2 ? 'Başlangıç ve bitiş tarihini seçin.' : x.t1 > x.t2 ? 'Başlangıç tarihi bitişten sonra olamaz.' : (new Date(x.t2) - new Date(x.t1)) / 864e5 > 62 ? 'En fazla 62 günlük aralık seçilebilir.' : ''
  });
  if (!v) return;
  let liste;
  try { liste = await aralikYukle(v.t1, v.t2); } catch (e) { return hataTekrar('Rapor alınamadı: ' + (e.message || e)); }
  const baslik = ['Teslimat Tarihi', 'Saat', 'Satış No', 'Müşteri', 'Telefon', 'Satış Noktası', 'Teslim Şekli', 'Servis', 'Ürün Kodu', 'Ürün Adı', 'Seri No', 'Durum', 'Teslim Eden', 'Teslim Alan', 'Teslim Zamanı', 'Çıkış Doğrulama', 'Not'];
  const satirlar = [];
  liste.sort((a, b) => (a.teslimTarihi + saatSira(a.teslimSaati)).localeCompare(b.teslimTarihi + saatSira(b.teslimSaati)) || String(a.musteri).localeCompare(String(b.musteri), 'tr'));
  liste.forEach(x => {
    const durum = durumHesapla(x);
    if (!v.iptal && (x.iptal || x.iade)) return;
    kalemListe(x).forEach(k => {
      const seri = k.seriNo && String(k.seriNo).trim() ? normSeri(k.seriNo) : '';
      if (!seri && !v.serisiz) return;
      const tt = kalemTur(x, k), st = grupTeslim(x, tt) || x.servisTeslim, te = x.teslimEdildi;
      satirlar.push([tarihTR(x.teslimTarihi), x.teslimSaati || '', x.saleNo, x.musteri, metinHucre(x.telefon), x.satisNoktasi || '', tt === 'musteri' ? 'Müşteri aldı/alacak' : 'Servis teslimi', tt === 'musteri' ? '' : (servisAdlari(x).join(' / ')),
        metinHucre(k.kod), k.urun || '', metinHucre(seri), durumEtiket(durum, x) + (k.seriIade ? ' · seri iade' : ''),
        st ? String(st.u || '').split('@')[0] : '', st ? (st.alan || '') : '', st ? new Date(st.t).toLocaleString('tr-TR') : '',
        te ? (te.dogrulama === 'yonetici' ? 'Yönetici onayı' : 'Otomatik (stoktan düştü)') + ' · ' + new Date(te.t).toLocaleString('tr-TR') : (st ? 'Bekliyor' : ''), x.not || '']);
    });
  });
  if (!satirlar.length) return uyariGoster({ tur: 'eksik', message: tarihTR(v.t1) + ' – ' + tarihTR(v.t2) + ' aralığında rapora girecek kayıt bulunamadı.' });
  const csv = '﻿' + [baslik].concat(satirlar).map(r => r.map(csvHucre).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = 'sevkiyat-seri-raporu_' + v.t1 + (v.t1 === v.t2 ? '' : '_' + v.t2) + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('<b>' + satirlar.length + '</b> satır indirildi (' + tarihTR(v.t1) + (v.t1 === v.t2 ? '' : ' – ' + tarihTR(v.t2)) + ')' + (liste.length >= 1500 ? ' · 1500 kayıt sınırına ulaşıldı, aralığı daraltın' : '') + '.', []);
}

// ═══ Otomatik çıkış doğrulama / kapanış ═════════════════════════
// Seriler.json günlük beslenir; çıkışı yapılan seri listeden düşer. Teslim edilmiş bir sevkiyatın TÜM serileri listeden düştüyse
// çıkış yapılmıştır: kayıt otomatik kapatılır (seri kilidi kalıcı), elle onay gerekmez. Liste açılışında / yenilemede çalışır.
// Güvenlik: stok verisi beklenmedik biçimde küçüldüyse (boş/yarım dosya) otomatik kapanış DURUR.
let otoCalisiyor = false, otoDurdu = false;
function seriVeriGuvenli() {
  try {
    const onceki = Number(localStorage.getItem('svk_seri_satir')) || 0;
    if (onceki > 20 && seriState.satir < onceki * 0.5) return false;
    localStorage.setItem('svk_seri_satir', String(seriState.satir));
  } catch (e) { /* yoksay */ }
  return true;
}
async function otomatikKapat() {
  if (!depoYetkili() || otoCalisiyor || !seriState.seriToBilgi || seriState.hata || !(seriState.satir > 0)) return 0;
  otoCalisiyor = true;
  try {
    otoDurdu = !seriVeriGuvenli();
    if (otoDurdu) { console.warn('otomatik kapanış durdu: stok verisi beklenmedik biçimde küçüldü'); return 0; }
    const adaylar = [...state.list.values()].filter(x => x.servisTeslim && !x.kapali && !x.iptal && !x.iade && !x.silindi && cikisDurumu(x).hazir).slice(0, 25);
    let n = 0;
    for (const x of adaylar) {
      const ok = await guncelle(x, sunucu => {
        if (sunucu.kapali) return { hata: 'zaten kapalı', tur: 'kapali' };
        if (!sunucu.servisTeslim || !cikisDurumu(sunucu).hazir) return { hata: 'hazır değil', tur: 'eksik' };
        return { yaz: { teslimEdildi: { t: Date.now(), u: 'sistem', dogrulama: 'otomatik', tetikleyen: eposta() } } };
      }, 'teslim_edildi', 'otomatik çıkış doğrulaması', { hata: () => { /* sessiz: bir sonraki açılışta yeniden denenir */ } });
      if (ok) n++;
    }
    if (n) toast('<b>' + n + '</b> sevkiyatın çıkışı stok verisinden doğrulanıp otomatik kapatıldı; <b>Tamamlanan</b> listesine taşındı.', [['Tamamlananları göster', async () => { state.filtre = 'teslim_edildi'; state.tarih = 'tumu'; state.kapSure = 7; state.sayfa = 30; try { await kapaliVeriYukle(true); } catch (_e) { /* yoksay */ } listeCiz(true); }]]);
    return n;
  } catch (e) { console.warn('otomatikKapat:', e); return 0; }
  finally { otoCalisiyor = false; }
}

// ═══ Seri iadesi: kapanmış sevkiyattaki seri stokta yeniden göründüğünde (iade/transfer) ═══
// Yalnızca o seri serbest bırakılır; sevkiyatın kendisi ve diğer seriler olduğu gibi kalır (kısmi iade mümkün).
async function seriIadeIcinDene(s, n, val, hata) {
  if (!hata || hata.tur !== 'kullanilmis' || !yonetici()) return false;
  const st = seriSahibi(val);
  if (!st || !(st.kalan > 0)) return false;                       // stokta yoksa iade değil, gerçek çakışma
  const oncekiNo = hata.detay && hata.detay.saleNo; if (!oncekiNo) return false;
  await tekYenile(oncekiNo);
  const onceki = state.list.get(oncekiNo);
  if (!onceki || !(onceki.servisTeslim || onceki.teslimEdildi) || onceki.iptal || onceki.silindi) return false;
  const kalem = kalemListe(onceki).find(k => k.seriNo && normSeri(k.seriNo) === normSeri(val) && !k.seriIade);
  if (!kalem) return false;
  const v = await diyalog({
    ikon: 'undo', ikCls: 'gri', kat: 'Seri iadesi', katCls: 'gri', baslik: 'Seri stokta yeniden göründü', tamam: 'İade et ve bu sevkiyata al', vazgec: 'Vazgeç', tehlike: true,
    ozet: 'Bu seri daha önce ' + onceki.saleNo + ' · ' + onceki.musteri + ' sevkiyatında teslim edilmişti; şimdi stok verisinde yeniden görünüyor (iade veya transfer olabilir). Onaylarsanız yalnızca bu seri önceki sevkiyattan “iade” olarak serbest bırakılır ve bu sevkiyata alınır.',
    satirlar: [['Seri', normSeri(val), 1], ['Önceki sevkiyat', onceki.saleNo + ' · ' + onceki.musteri], ['Ürün', kalem.urun || '']],
    govde: '<label class="svk-lbl">Açıklama</label><input class="svk-in" data-f="not" placeholder="Örn: müşteri iade etti, depoya girdi">' +
      '<label class="onay"><input type="checkbox" data-f="fiziksel"> Ürünün fiziksel olarak depoya döndüğünü doğruladım.</label>',
    dogrula: x => !x.fiziksel ? 'Ürünün depoya döndüğünü onaylayın.' : ''
  });
  if (!v) return true;                                            // iptal: uyarıyı tekrar gösterme
  const bilgi = { t: Date.now(), u: eposta(), seri: normSeri(val), neden: 'Stokta yeniden göründü', not: String(v.not || '').trim() };
  const ok = await guncelle(onceki, sunucu => {
    const k = kalemListe(sunucu).find(x => x.seriNo && normSeri(x.seriNo) === normSeri(val) && !x.seriIade);
    if (!k) return { hata: 'Seri önceki sevkiyatta bulunamadı (başka bir cihazda işlenmiş olabilir).', tur: 'eksik' };
    return { yaz: { ['kalemler.' + k.n + '.seriIade']: bilgi }, seriSil: [normSeri(val)] };
  }, 'seri_iade', normSeri(val) + (bilgi.not ? ' — ' + bilgi.not : ''));
  if (!ok) return true;
  const r = await seriKaydet(s, n, val);
  if (!r.ok) await uyariGoster(r.hata);
  yenidenCiz();
  return true;
}

// ═══ Müşteri sorgula ═══════════════════════════════════════════
function sorguCiz() {
  state.sorguEkrani = true; state.yonetim = false; state.acik = null;
  const q = state.sorgu;
  const r = q.sonuc;
  const kisa = e => String(e || '').split('@')[0];
  const tarih = x => { const ms = x.ts && x.ts.toDate ? x.ts.toDate().getTime() : (Number(x.ts) || Date.parse(x.ts) || 0); return ms ? new Date(ms).toLocaleDateString('tr-TR') : ''; };
  const urunMetin = x => (x.urunler || []).map(u => u.urun).filter(Boolean).slice(0, 4).join(', ');
  const bolum = (baslik, n, govde) => '<div class="svk-tbas" style="margin-top:14px">' + baslik + ' <small style="color:#71717a">(' + n + ')</small></div>' + (n ? govde : '<p class="svk-not">Kayıt yok.</p>');
  const sonucHtml = !r ? '' :
    bolum('Sevkiyat / teslimat', r.sevkiyat.length, r.sevkiyat.map(x => kartHtml({ ...x, durum: durumHesapla(x) })).join('')) +
    (r.satis.length ? bolum('Satış (sevkiyat kaydı yok)', r.satis.length, r.satis.map(x => '<div class="svk-card" style="margin-bottom:8px"><div class="svk-cb"><b>' + esc(String(x.custName || '').replace(/&amp;/g, '&')) + '</b> · ' + esc(x._id) + '<br><small>' + esc(tarih(x)) + ' · ' + esc(kisa(x.user)) + '</small><div class="svk-not">' + esc(urunMetin(x)) + '</div></div></div>').join('')) : '') +
    bolum('Teklifler', r.teklif.length, r.teklif.map(x => '<div class="svk-card" style="margin-bottom:8px"><div class="svk-cb"><b>' + esc(String(x.custName || '').replace(/&amp;/g, '&')) + '</b> · <span class="svk-cp">' + esc(x.durum || '') + '</span><br><small>' + esc(tarih(x)) + ' · ' + esc(kisa(x.user)) + (x.odeme ? ' · ' + esc(x.odeme) : '') + '</small><div class="svk-not">' + esc(urunMetin(x)) + '</div></div></div>').join(''));
  kok().innerHTML =
    '<div class="svk-panel"><div class="svk-head"><button class="svk-ib" data-act="geri" aria-label="Listeye dön">' + ic('back', 18) + '</button>' +
    '<div class="svk-ht"><h1>' + ic('search', 19) + ' Müşteri sorgula</h1><p>Telefon, ad ya da satış no ile tüm mağazalar</p></div></div><div class="svk-scroll svk-det">' +
    '<div class="svk-card"><div class="svk-cb"><div style="display:flex;gap:6px"><input class="svk-in" id="svk-sorgu-q" style="flex:1;min-width:0" placeholder="05xx xxx xx xx · Ad Soyad · SAT-0123" value="' + esc(q.q) + '" autocomplete="off" inputmode="search">' +
    '<button class="svk-btn koyu" data-act="sorgula"' + (q.bekle ? ' disabled' : '') + '>' + (q.bekle ? 'Aranıyor…' : 'Sorgula') + '</button></div>' +
    '<p class="svk-not" style="margin-top:6px">Sevkiyat, satış ve teklif kayıtlarında arar. Gizli (🔒) teklifler gösterilmez.</p>' +
    (q.hata ? '<div class="svk-ipucu nt">' + ic('alert', 14) + '<span>' + esc(q.hata) + '</span></div>' : '') + '</div></div>' + sonucHtml + '</div></div>';
  const inp = $('svk-sorgu-q');
  if (inp) inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); sorguCalistir(); } };
}
async function sorguCalistir() {
  const q = state.sorgu, inp = $('svk-sorgu-q');
  q.q = inp ? inp.value.trim() : q.q; q.hata = ''; q.bekle = true; sorguCiz();
  try { q.sonuc = await musteriSorgula(q.q); }
  catch (e) { q.sonuc = null; q.hata = e.message || String(e); }
  q.bekle = false; sorguCiz();
}

// ═══ Yönetici araçları ═════════════════════════════════════════
let yetimListe = [];
// ── Tanımlar (servis · depo · satış noktası) ──────────────────
let tanimTaslak = { markalar: [], depolar: [], noktalar: [] };
function tanimTaslakHazirla() { tanimTaslak = { markalar: Object.keys(MARKA_SERVIS).map(m => [m, MARKA_SERVIS[m].join(', ')]), depolar: DEPOLAR.slice(), noktalar: SATIS_NOKTALARI.slice() }; }
function tanimKartHtml() {
  const blok = (l, baslik, ipucu) => '<div class="svk-tbas">' + baslik + '</div><p class="svk-not" style="margin:0 0 6px">' + ipucu + '</p>' +
    tanimTaslak[l].map((v, i) => '<div class="svk-tanim"><input class="svk-in svk-tn" data-l="' + l + '" data-i="' + i + '" value="' + esc(v) + '" maxlength="40" placeholder="Ad" autocomplete="off">' +
      '<button class="svk-btn kucuk tehlike" data-act="tsil" data-l="' + l + '" data-i="' + i + '" aria-label="Sil">' + ic('trash', 14) + '</button></div>').join('') +
    '<button class="svk-btn kucuk" data-act="tekle" data-l="' + l + '">+ Ekle</button>';
  return '<div class="svk-card"><div class="svk-ch">' + ic('tools', 16) + ' Tanımlar</div><div class="svk-cb">' +
    '<p class="svk-not">Burada yapılan değişiklik tüm cihazlarda en geç 30 dakika içinde (ya da cihaz yenilenince) geçerli olur. Silinen/yeniden adlandırılan bir adın geçtiği eski kayıtlar olduğu gibi kalır; açık kayıtları aşağıdaki “Toplu değiştir” ile yeni ada taşıyabilirsiniz.</p>' +
    '<div class="svk-tbas">Markalar ve servisleri</div><p class="svk-not" style="margin:0 0 6px">Sevkiyatta, ürünün markasının servisleri “Götüren” seçeneği olarak çıkar (isteğe bağlı). Servisleri virgülle ayırın.</p>' +
    tanimTaslak.markalar.map((r, i) => '<div class="svk-tanim ms"><input class="svk-in svk-tm" data-i="' + i + '" data-f="0" value="' + esc(r[0]) + '" maxlength="40" placeholder="Marka (Vestel)" autocomplete="off">' +
      '<input class="svk-in svk-tm" data-i="' + i + '" data-f="1" value="' + esc(r[1]) + '" maxlength="120" placeholder="Servisler (Barel, Can, Pazarcık)" autocomplete="off">' +
      '<button class="svk-btn kucuk tehlike" data-act="tmsil" data-i="' + i + '" aria-label="Sil">' + ic('trash', 14) + '</button></div>').join('') +
    '<button class="svk-btn kucuk" data-act="tmekle">+ Marka ekle</button>' +
    blok('depolar', 'Depolar (ürünün çıktığı yer)', 'Her ürün için seçilir; depo fişinde ve servis mesajında görünür.') +
    blok('noktalar', 'Satış noktaları', 'Satış formundaki “Satış Noktası” listesi.') +
    '<div style="margin-top:12px"><button class="svk-btn koyu" data-act="tkaydet">Tanımları kaydet</button></div></div></div>';
}
function acikKayitlar() { return [...state.list.values()].filter(x => !x.silindi && !x.kapali && !x.servisTeslim); }
function topluKartHtml() {
  const dep = [...new Set(acikKayitlar().flatMap(x => kalemListe(x).map(k => k.depo)).filter(Boolean))];
  const srv = [...new Set(acikKayitlar().flatMap(x => servisAdlari(x)).filter(Boolean))];
  const sec = (id, liste) => '<select class="svk-in" id="' + id + '">' + liste.map(x => '<option>' + esc(x) + '</option>').join('') + '</select>';
  const sat = (t, ad, kay, hedef) => '<div class="svk-tbas">' + ad + '</div>' + (kay.length
    ? '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' + sec('svk-' + t + '-k', kay) + '<span>→</span>' + sec('svk-' + t + '-h', hedef) + '<button class="svk-btn kucuk koyu" data-act="toplu" data-t="' + t + '">Taşı</button></div>'
    : '<p class="svk-not">Değiştirilebilecek açık kayıt yok.</p>');
  return '<div class="svk-card"><div class="svk-ch">' + ic('refresh', 16) + ' Toplu değiştir (açık kayıtlar)</div><div class="svk-cb">' +
    '<p class="svk-not">Bir depo kapandı ya da ürünler başka yerden çıkacaksa; henüz servise teslim edilmemiş açık kayıtlardaki depo/servis tek seferde değiştirilir. Her kayıtta hareket geçmişine yazılır.</p>' +
    sat('depo', 'Depo', dep, DEPOLAR) + sat('servis', 'Servis', srv, tumServisAdlari()) + '</div></div>';
}
async function tanimKaydetAkis(btn) {
  const markaServis = {};
  tanimTaslak.markalar.forEach(([m, l]) => { const mm = String(m).trim().replace(/\s+/g, ' ').slice(0, 40), ls = tanimTemizle(String(l).split(/[,;\n]/)); if (mm && ls.length) markaServis[mm] = ls; });
  const yeni = { servisler: SERVISLER.slice(), markaServis, depolar: tanimTemizle(tanimTaslak.depolar), noktalar: tanimTemizle(tanimTaslak.noktalar) };
  if (!yeni.depolar.length) return hataTekrar('Depo listesi boş olamaz.', 'eksik');
  const kalkan = [];
  [['depolar', DEPOLAR, 'depo']].forEach(([k, eski, ad]) => eski.filter(x => !yeni[k].includes(x)).forEach(x => {
    const n = acikKayitlar().filter(r => kalemListe(r).some(z => z.depo === x)).length;
    kalkan.push('“' + x + '” (' + ad + ')' + (n ? ' — ' + n + ' açık kayıtta kullanılıyor' : ''));
  }));
  if (kalkan.length && !(await onay('Listeden çıkarılacaklar', kalkan.join('\n') + '\n\nEski kayıtlar bu adla görünmeye devam eder.', 'Kaydet', true))) return;
  btn.disabled = true;
  try { await tanimKaydet(yeni); tanimTaslakHazirla(); toast('Tanımlar kaydedildi', []); }
  catch (e) { await hataTekrar('Kaydedilemedi: ' + (e.message || e) + ' — Firestore kuralları meta/sevkiyatTanimlar belgesine yazmaya izin vermeli.', 'genel'); }
  yonetimCiz();
}
async function topluDegistir(t, btn) {
  const kay = ($('svk-' + t + '-k') || {}).value, hedef = ($('svk-' + t + '-h') || {}).value;
  if (!kay || !hedef || kay === hedef) return hataTekrar('Farklı bir kaynak ve hedef seçin.', 'eksik');
  btn.disabled = true;
  try { await yukle(true); } catch (_e) { /* yoksay */ }
  const hedefler = acikKayitlar().filter(r => t === 'depo' ? kalemListe(r).some(k => k.depo === kay) : (servisAdlari(r).includes(kay)));
  if (!hedefler.length) { btn.disabled = false; return toast('Değiştirilecek açık kayıt kalmadı.', []); }
  if (!(await onay('Toplu değişiklik', hedefler.length + ' açık kayıtta ' + (t === 'depo' ? 'depo' : 'servis') + ' “' + kay + '” → “' + hedef + '” olarak değiştirilecek.', 'Değiştir'))) { btn.disabled = false; return; }
  const hatalar = []; let n = 0;
  for (const r of hedefler) {
    const ok = await guncelle(r, sunucu => {
      if (sunucu.kapali || sunucu.servisTeslim) return { hata: r.saleNo + ': kayıt bu arada teslim edilmiş/kapanmış, atlandı.', tur: 'kapali' };
      const yaz = {};
      if (t === 'depo') kalemListe(sunucu).forEach(k => { if (k.depo === kay) yaz['kalemler.' + k.n + '.depo'] = hedef; });
      else { kalemListe(sunucu).forEach(k => { if (k.servis === kay) yaz['kalemler.' + k.n + '.servis'] = hedef; }); if (sunucu.atananServis === kay) yaz.atananServis = hedef; }
      return { yaz };
    }, t === 'depo' ? 'toplu_depo' : 'toplu_servis', kay + ' → ' + hedef, { hata: m => hatalar.push(m) });
    if (ok) n++;
  }
  toast('<b>' + n + '</b> kayıt güncellendi' + (hatalar.length ? ' · ' + hatalar.length + ' atlandı' : ''), []);
  yonetimCiz();
}
function yonetimCiz() {
  if (!yonetici()) return;
  state.yonetim = true;
  kok().innerHTML =
    '<div class="svk-panel"><div class="svk-head"><button class="svk-ib" data-act="geri" aria-label="Listeye dön">' + ic('back', 18) + '</button>' +
    '<div class="svk-ht"><h1>' + ic('tools', 19) + ' Yönetici Araçları</h1><p>Veri bütünlüğü ve denetim</p></div></div><div class="svk-scroll svk-det">' +
    tanimKartHtml() + topluKartHtml() +
    '<div class="svk-card"><div class="svk-ch">' + ic('alert', 16) + ' Sevkiyat kaydı olmayan satışlar</div><div class="svk-cb"><p class="svk-not">Son 14 gündeki satış belgeleri taranır (≤150 + ≤300 okuma). ' +
    'Sevkiyat kaydı yazılamamış satışları (cihaz kaybı, depolama temizliği vb.) yakalar.</p>' +
    '<button class="svk-btn koyu" data-act="yetim">Tara</button><div id="svk-yetim" style="margin-top:8px"></div></div></div>' +
    '<div class="svk-card"><div class="svk-ch">' + ic('lock', 16) + ' Seri kilitlerini eşitle (bir kerelik)</div><div class="svk-cb"><p class="svk-not">V10\'da girilmiş serileri “tek kullanım” kilidine aktarır (son 500 sevkiyat). ' +
    'Aynı seri iki sevkiyatta varsa listelenir.</p>' +
    '<button class="svk-btn" data-act="esitle">Çalıştır</button><div id="svk-esitle" style="margin-top:8px;font-size:.8rem"></div></div></div></div></div>';
}
async function yetimTara(btn) {
  const out = $('svk-yetim'); btn.disabled = true; out.textContent = 'Taranıyor…';
  try {
    yetimListe = await yetimSatislar(14);
    out.innerHTML = yetimListe.length
      ? yetimListe.map(x => '<div class="svk-yetim"><span><b>' + esc(x.id) + '</b> · ' + esc(String(x.custName || '').replace(/&amp;/g, '&')) + ' · ' + esc((x.ts || '').slice(0, 10)) + '</span>' +
          '<button class="svk-btn kucuk" data-act="yetimac" data-id="' + esc(x.id) + '">Sevkiyat aç</button></div>').join('')
      : 'Sevkiyat kaydı olmayan satış bulunmadı.';
  } catch (er) { out.textContent = 'Hata: ' + (er.message || er); }
  btn.disabled = false;
}
async function yetimAc(id, btn) {
  const sale = yetimListe.find(x => x.id === id); if (!sale) return;
  if (!(await onay('Sevkiyat kaydı açılsın mı?', id + ' için bugünün tarihiyle servis teslimi kaydı açılacak. Tarih ve teslim şekli sonradan düzenlenebilir.', 'Kaydı aç'))) return;
  btn.disabled = true;
  olusturKayit(sale, { tarih: bugun(), saat: '', servis: '', nokta: '', tur: 'servis', tahsilat: 0, yetim: true }, sale.not || '');
  btn.textContent = 'Açıldı';
}
async function esitleCalistir(btn) {
  if (!(await onay('Seri kilitleri eşitlensin mi?', 'Son 500 sevkiyat okunacak ve her seri için bir kilit belgesi yazılacak.', 'Çalıştır'))) return;
  const out = $('svk-esitle'); btn.disabled = true; out.textContent = 'Çalışıyor…';
  try {
    const r = await seriKilitleriniEsitle();
    out.innerHTML = r.yazilan + ' seri kilidi yazıldı.' + (r.cakisan.length
      ? '<br><b style="color:var(--k-red)">Çakışan seriler (elle kontrol edin):</b><br>' + r.cakisan.map(c => esc(c.seri) + ' → ' + esc(c.satislar.join(', '))).join('<br>') : '');
  } catch (er) { out.textContent = 'Hata: ' + (er.message || er); }
  btn.disabled = false;
}

// ═══ Yeni sevkiyat sayacı (hafif sorgu, onSnapshot yok) ════════
let sonSayim = null, sonKontrol = 0;
function rozetGuncelle(n) {
  const r = $('svk-tab-rozet'); if (!r) return;
  r.textContent = n > 99 ? '99+' : String(n);
  r.style.display = n > 0 ? 'flex' : 'none';
}
function yerelSayimiYansit() {
  if (!depoYetkili()) return;
  const n = [...state.list.values()].filter(s => !s.kapali && !s.silindi && durumHesapla(s) === 'barkod_bekliyor').length;
  sonSayim = n; sonKontrol = Date.now(); rozetGuncelle(n);
}
async function sayimKontrol() {
  if (document.hidden || !depoYetkili()) return;
  if (Date.now() - sonKontrol < SAYIM_MS - 5000) return;
  sonKontrol = Date.now();
  try {
    const n = await yeniIsSayisi();
    if (sonSayim !== null && n > sonSayim) {
      toast('Yeni sevkiyat bekliyor (' + n + ' adet barkod bekleyen)', [['Aç', ac]]);
      try { if (navigator.vibrate) navigator.vibrate([80, 40, 80]); } catch (e) { /* yoksay */ }
    }
    sonSayim = n; rozetGuncelle(n);
  } catch (e) { console.warn('sayim:', e); }
}

// ═══ Başlat ════════════════════════════════════════════════════
function navEkle() {
  if ($('tab-btn-sevkiyat')) return;
  const ref = $('tab-btn-teklifler');
  if (!ref) return;
  const btn = document.createElement('button');
  btn.className = 'tab-btn'; btn.id = 'tab-btn-sevkiyat'; btn.style.display = 'flex';
  btn.innerHTML = '<span class="tab-icon">🚚</span><span class="tab-label">Sevkiyat</span><span class="svk-tabrozet" id="svk-tab-rozet"></span>';
  btn.onclick = ac;
  ref.insertAdjacentElement('afterend', btn);
}
function init() {
  stilEkle(); formEnjekte(); navEkle();
  setTimeout(bekleyenKontrol, 2500);
  window.addEventListener('online', () => { if (state.bekleyen) pillGuncelle(state.bekleyen); else bekleyenKontrol(); });
  // V11.23: mağaza/depo seçimi değişince liste süzgeci güncellenir (depo kullanıcısında depo filtresi seçili gelir)
  Magaza.onDegis(() => { state.magaza = true; if (Magaza.kapsam() === 'depo') state.depo = Magaza.secili(); if (derinlik() === 1 && state.list && !state.yonetim && !state.sorguEkrani) listeCiz(); });
  Magaza.baslat();
  Talep.init({ uyariGoster, onay, toast });   // V11.24: Mağaza→Depo talep modülü
  setInterval(sayimKontrol, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sayimKontrol(); });
  setTimeout(sayimKontrol, 15000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

// V11.14: satış onayından sonra doğrudan ilgili sevkiyatın detayı
let sonOlusan = null;   // yazma henüz sunucuya ulaşmadan liste yeniden çekilirse kayıt kaybolmasın
async function detayAc(id) {
  await ac();
  if (!state.list.has(id) && sonOlusan && sonOlusan.saleNo === id) state.list.set(id, sonOlusan);
  if (!state.list.has(id)) return false;
  state.acik = id; taslakSifirla(id); detayCiz(state.list.get(id));
  return true;
}
window.Magaza = Magaza; window.Talep = Talep;
window.Sevkiyat = { detayAc, ac, kapat, geri, derinlik, formOku, olustur, belgeAc, durumHesapla, seriYukle, seriDogrula };
