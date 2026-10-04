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
  SERVISLER, SATIS_NOKTALARI, DURUMLAR, FILTRELER, B, esc, bugun, yarin, tarihTR, zamanTR, tl,
  eposta, yonetici, depoYetkili, kalemListe, kalemTamam, durumHesapla, teslimTuru, gecikmeGun,
  state, kancalar, seriState, seriYukle, seriDogrula, seriSahibi, seriGerekir, normSeri, cikisDurumu, tekYenile,
  yukle, gecmisYukle, guncelle, olustur as olusturKayit, yeniIsSayisi, yetimSatislar, seriKilitleriniEsitle
} from './sevkiyat-veri.js?v=V11.2-20261004-1556';
import { belgeAc, listeAc, waAc, waTeslimAc } from './sevkiyat-belge.js?v=V11.2-20261004-1556';
import { kameraTara } from './sevkiyat-kamera.js?v=V11.2-20261004-1556';
import { stilEkle, ic } from './sevkiyat-stil.js?v=V11.2-20261004-1556';

const $ = id => document.getElementById(id);
const SAYIM_MS = 4 * 60 * 1000;
const IPTAL_NEDENLERI = ['Müşteri vazgeçti', 'Mükerrer / hatalı kayıt', 'Stok veya ürün sorunu', 'Ödeme alınamadı', 'Diğer'];
const LOG_AD = {
  olusturuldu: 'Kayıt açıldı', yetim_satistan_olusturuldu: 'Yetim satıştan açıldı', seri_girildi: 'Seri girildi', seri_silindi: 'Seri silindi',
  kilitlendi: 'Depo onayı verildi (eski)', kilit_acildi: 'Depo onayı geri alındı (eski)',
  servise_teslim: 'Teslim edildi', teslim_edildi: 'Çıkış doğrulandı · tamamlandı', teslim_geri_alindi: 'Teslim geri alındı',
  kalem_eklendi: 'Ürün eklendi', kalem_degisti: 'Ürün değiştirildi', kalem_cikarildi: 'Ürün satırı çıkarıldı', iade: 'İade / depoya döndü', not_degisti: 'Not güncellendi', iptal: 'İptal edildi', iptal_geri_alindi: 'İptal geri alındı',
  silindi: 'Kayıt silindi', servis_atandi: 'Servis atandı', teslim_turu_degisti: 'Teslim şekli değişti', teslimat_degisti: 'Teslimat tarihi değişti',
  tahsilat_alindi: 'Tahsilat alındı'
};
const IADE_NEDENLERI = ['Müşteri teslimi iptal etti', 'Servis iade etti', 'Hatalı / arızalı ürün', 'Yanlış ürün gönderildi', 'Diğer'];

// Liste filtreleri ek durumu (veri modülündeki `state`e eklenir)
Object.assign(state, { tarih: 'tumu', t1: '', t2: '', tur: 'hepsi' });
// Teslim formu taslağı (yeniden çizimde kaybolmasın)
const taslak = { id: null, alan: '', imza: '', imzaVar: false };
const taslakSifirla = id => { taslak.id = id; taslak.alan = ''; taslak.imza = ''; taslak.imzaVar = false; };

// ═══ Tarih yardımcıları ════════════════════════════════════════
const dIso = iso => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); };
const toIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const gunEkle = (iso, n) => { const d = dIso(iso); d.setDate(d.getDate() + n); return toIso(d); };
const gunAdi = iso => dIso(iso).toLocaleDateString('tr-TR', { weekday: 'long' });
const kisaSaat = s => s || '';

// ═══ Satış formu: teslimat alanları (sale-extra-fields içine enjekte) ═══
function formEnjekte() {
  const host = $('sale-extra-fields');
  if (!host || $('svk-fields')) return;
  const div = document.createElement('div');
  div.id = 'svk-fields';
  div.innerHTML =
    '<div class="wa-section-divider">Teslimat Bilgisi</div>' +
    '<div class="wa-grid">' +
      '<div class="footer-field full"><label>Teslim Şekli</label><div class="svk-formseg">' +
        '<label><input type="radio" name="svk-tur" value="servis" checked><span>' + ic('truck', 15) + ' Servis Teslimi</span></label>' +
        '<label><input type="radio" name="svk-tur" value="musteri"><span>' + ic('user', 15) + ' Müşteriye Teslim</span></label></div></div>' +
      '<div class="footer-field"><label>Teslimat Tarihi *</label><input type="date" id="svk-tarih"></div>' +
      '<div class="footer-field"><label>Teslimat Saati</label><input type="time" id="svk-saat"></div>' +
      '<div class="footer-field" id="svk-servis-wrap"><label>Teslim Edecek Servis</label><select id="svk-servis">' +
        '<option value="">Sonra belirlenecek</option>' + SERVISLER.map(x => '<option>' + esc(x) + '</option>').join('') + '</select></div>' +
      '<div class="footer-field"><label>Satış Noktası</label><select id="svk-nokta">' +
        '<option value="">—</option>' + SATIS_NOKTALARI.map(x => '<option>' + esc(x) + '</option>').join('') + '</select></div>' +
      '<div class="footer-field full"><label>Teslimat Notu <span class="ab-hint">(isteğe bağlı)</span></label>' +
        '<textarea id="svk-not" rows="2" placeholder="Örn: Teslimde 1.500 ₺ tahsil edilecek · 3. kat, asansör yok · aramadan gelmeyin"></textarea></div>' +
    '</div>';
  host.appendChild(div);
  $('svk-tarih').value = bugun();
  div.addEventListener('change', e => {
    if (e.target.name === 'svk-tur') $('svk-servis-wrap').style.display = e.target.value === 'musteri' ? 'none' : '';
  });
}
function formSifirla() {
  if ($('svk-tarih')) $('svk-tarih').value = bugun();
  ['svk-saat', 'svk-servis', 'svk-nokta', 'svk-not'].forEach(id => { if ($(id)) $(id).value = ''; });
  const r = document.querySelector('input[name="svk-tur"][value="servis"]'); if (r) r.checked = true;
  if ($('svk-servis-wrap')) $('svk-servis-wrap').style.display = '';
}
// app.js finalizeAksiyon satış bloğu bunu doğrulama için çağırır
function formOku() {
  const tarih = ($('svk-tarih') || {}).value || '';
  if (!tarih) return { ok: false, hata: 'Teslimat tarihini seçiniz.' };
  if (tarih < bugun()) return { ok: false, hata: 'Teslimat tarihi geçmişte olamaz.' };
  const sec = document.querySelector('input[name="svk-tur"]:checked');
  const tur = sec && sec.value === 'musteri' ? 'musteri' : 'servis';
  return { ok: true, veri: {
    tarih, saat: ($('svk-saat') || {}).value || '', tur,
    servis: tur === 'servis' ? (($('svk-servis') || {}).value || '') : '', nokta: ($('svk-nokta') || {}).value || '', not: (($('svk-not') || {}).value || '').trim()
  } };
}

// ── Kayıt oluştur (satış tamamlanınca) — app.js `.catch` zinciri için Promise döner ──
async function olustur(sale, v, not) {
  const { kayit } = olusturKayit(sale, v, not);
  formSifirla();
  const cevrimici = navigator.onLine !== false;
  toast(cevrimici
    ? 'Sevkiyat kaydı açıldı: <b>' + esc(sale.id) + '</b>'
    : 'Sevkiyat kaydı cihaza kaydedildi: <b>' + esc(sale.id) + '</b> — bağlantı gelince otomatik gönderilecek',
  [['Depo Fişi', () => belgeAc('depo', kayit)]]);
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
        oneri: 'Ürünün doğru olduğunu doğrulayın. Önceki sevkiyat iptal edildiyse yönetici seri kilidini o iptal ile serbest bırakır.' };
    case 'ayni_sevkiyat':
      return { kat: seriKat, baslik: 'Seri bu sevkiyatta zaten girilmiş',
        ozet: 'Aynı seri numarası aynı sevkiyatın başka bir satırında kayıtlı.',
        satirlar: [['Okutulan seri', d.seri, 1], ['Kayıtlı satır', d.n != null ? (Number(d.n) + 1) + '. satır' : '']],
        oneri: 'Her ürün için farklı bir cihazın etiketini okutun.' };
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
    else if (e.target.id === 'svk-alan') taslak.alan = e.target.value;
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
    else { await Promise.all([yukle(true), seriYukle(true)]); if (kapaliFiltre()) await gecmisYukle(true); yerelSayimiYansit(); }
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
  try { await Promise.all([seriYukle(false), yukle(false)]); if (kapaliFiltre()) await gecmisYukle(false); } catch (e) {
    console.error('sevkiyat yukle:', e);
    kok().innerHTML = '<div class="svk-panel"><div class="svk-bos">Liste yüklenemedi: ' + esc(e.message || e) + '<br><br><button class="svk-btn" data-act="kapat">Kapat</button></div></div>'; return;
  }
  yerelSayimiYansit();
  listeCiz();
}
function kapat() { const o = $('svk-overlay'); if (o) o.style.display = 'none'; document.body.style.overflow = ''; }
const kapaliFiltre = () => ['teslim_edildi', 'iptal', 'iade'].includes(state.filtre);

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
  return s.durum === f;
}
function goruntulenen() {
  const q = state.ara.trim().toLowerCase();
  const sirala = kapaliFiltre() ? (a, b) => (b.ts || 0) - (a.ts || 0)
    : (a, b) => (a.teslimTarihi + (a.teslimSaati || '')).localeCompare(b.teslimTarihi + (b.teslimSaati || ''));
  return [...state.list.values()].map(s => ({ ...s, durum: durumHesapla(s) })).filter(s => {
    if (s.silindi) return false;
    if (!durumUygun(s)) return false;
    if (state.tur !== 'hepsi' && teslimTuru(s) !== state.tur) return false;
    if (!tarihUygun(s)) return false;
    if (state.servis && s.atananServis !== state.servis) return false;
    if (!q) return true;
    const hay = [s.saleNo, s.musteri, s.telefon, s.adres, s.atananServis, ...kalemListe(s).map(k => k.seriNo + ' ' + k.urun + ' ' + k.kod), s.not].join(' ').toLowerCase();
    return hay.includes(q);
  }).sort(sirala);
}
const tarihEtiketi = () => ({ tumu: 'Tüm tarihler', geciken: 'Geciken teslimatlar', bugun: tarihTR(bugun()), yarin: tarihTR(yarin()),
  hafta: tarihTR(bugun()) + ' – ' + tarihTR(gunEkle(bugun(), 6)), aralik: (state.t1 ? tarihTR(state.t1) : '…') + ' – ' + (state.t2 ? tarihTR(state.t2) : '…') }[state.tarih]);

// ── Kart bileşenleri ───────────────────────────────────────────
function rozet(d) { const x = DURUMLAR[d] || DURUMLAR.barkod_bekliyor; return '<span class="svk-pill2" style="color:' + x.renk + ';background:' + x.bg + '">' + x.label + '</span>'; }

function kartHtml(s) {
  const k = kalemListe(s), tam = k.filter(kalemTamam).length, gec = gecikmeGun(s);
  const musteri = teslimTuru(s) === 'musteri';
  const tah = Number(s.tahsilatTutari) > 0 && !s.tahsilatAlindi ? '<span class="svk-cp am">' + ic('wallet', 13) + esc(tl(s.tahsilatTutari)) + '</span>' : '';
  const yuzde = k.length ? Math.round(tam * 100 / k.length) : 0;
  const GOSTER = 3;
  const urunler = '<ul class="svk-ur">' + k.slice(0, GOSTER).map(x => {
    const ok = kalemTamam(x);
    return '<li class="' + (ok ? 'ok' : '') + '"><span class="ik">' + (ok ? ic('check', 12) : '') + '</span><span class="ad">' + esc(x.urun || x.kod) + '</span></li>';
  }).join('') + (k.length > GOSTER ? '<li class="d">+ ' + (k.length - GOSTER) + ' ürün daha</li>' : '') + '</ul>';
  const cd = s.servisTeslim && !s.kapali ? cikisDurumu(s) : null;
  const cikis = cd ? (cd.hazir ? '<span class="svk-cp ok">' + ic('check', 13) + 'Çıkış doğrulandı · tamamlanabilir</span>'
    : '<span class="svk-cp">' + ic('clock', 13) + 'Çıkış: ' + cd.satirlar.filter(x => x.durum === 'cikti' || x.durum === 'serisiz').length + '/' + k.length + '</span>') : '';
  const notChip = s.not ? '<span class="svk-cp am svk-notchip" title="' + esc(s.not) + '">' + ic('msg', 13) + esc(s.not.length > 34 ? s.not.slice(0, 34) + '…' : s.not) + '</span>' : '';
  return '<div class="svk-kart t-' + (musteri ? 'musteri' : 'servis') + (gec ? ' gec' : '') + (s.iptal ? ' iptal' : '') + '" data-act="detay" data-id="' + esc(s.saleNo) + '">' +
    '<div class="svk-r1"><b>' + esc(s.musteri) + '</b>' + rozet(s.durum) + '</div>' +
    urunler +
    '<div class="svk-r3">' +
      '<span class="svk-cp' + (gec ? ' kzh' : '') + '">' + ic('calendar', 13) + tarihTR(s.teslimTarihi) + (s.teslimSaati ? ' · ' + esc(s.teslimSaati) : '') + '</span>' +
      (gec ? '<span class="svk-cp kz">' + ic('alert', 13) + gec + ' gün gecikti</span>' : '') +
      '<span class="svk-cp ' + (musteri ? 'yr' : 'mv') + '">' + ic(musteri ? 'user' : 'truck', 13) + (musteri ? 'Müşteriye teslim' : esc(s.atananServis || 'Servis atanmadı')) + '</span>' +
      '<span class="svk-cp">' + ic('box', 13) + tam + '/' + k.length + ' seri</span>' + cikis + tah + notChip +
    '</div>' +
    '<div class="svk-r2">' + (s.telefon ? ic('phone', 12) + ' ' + esc(s.telefon) : '') + '</div>' +
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
  if (kapaliFiltre()) return list.map(kartHtml).join('') +
    '<div class="svk-bos" style="padding:14px">Son 80 kayıt gösterilir.</div>';
  const gruplar = new Map();
  list.forEach(s => { if (!gruplar.has(s.teslimTarihi)) gruplar.set(s.teslimTarihi, []); gruplar.get(s.teslimTarihi).push(s); });
  let html = '';
  [...gruplar.keys()].sort().forEach(t => { html += grupBasligi(t, gruplar.get(t).length) + gruplar.get(t).map(kartHtml).join(''); });
  return html;
}

function listeCiz() {
  const eskiKay = kok().querySelector('.svk-scroll');
  const top = eskiKay ? eskiKay.scrollTop : 0;
  const hepsi = [...state.list.values()].filter(s => !s.silindi).map(s => ({ ...s, durum: durumHesapla(s) }));
  const aktif = hepsi.filter(s => !s.kapali);
  const b = bugun(), y = yarin();
  const say = {
    geciken: aktif.filter(s => s.teslimTarihi < b).length, bugun: aktif.filter(s => s.teslimTarihi === b).length, yarin: aktif.filter(s => s.teslimTarihi === y).length,
    hafta: aktif.filter(s => s.teslimTarihi >= b && s.teslimTarihi <= gunEkle(b, 6)).length,
    barkod: aktif.filter(s => s.durum === 'barkod_bekliyor').length, serviste: aktif.filter(s => s.durum === 'serviste').length,
    hepsi: aktif.length, servis: aktif.filter(s => teslimTuru(s) === 'servis').length, musteri: aktif.filter(s => teslimTuru(s) === 'musteri').length
  };
  const durumSay = {}; hepsi.forEach(s => { durumSay[s.durum] = (durumSay[s.durum] || 0) + 1; });
  durumSay.aktif = aktif.length;
  const kpi = (k, sayi, etiket, kz, on) => '<button class="svk-kpi' + (kz && sayi ? ' kirmizi' : '') + (on ? ' on' : '') + '" data-act="kpi" data-k="' + k + '"><b>' + sayi + '</b><span>' + etiket + '</span></button>';
  const filtreler = FILTRELER;
  const tchip = (k, l, cls) => '<button class="svk-chip' + (cls ? ' ' + cls : '') + (state.tarih === k ? ' on' : '') + '" data-act="tarih" data-k="' + k + '">' + l + (k === 'geciken' && say.geciken ? ' <i>' + say.geciken + '</i>' : '') + '</button>';
  kok().innerHTML =
    '<div class="svk-panel">' +
      '<div class="svk-head"><div class="svk-ht"><h1>' + ic('truck', 20) + ' Sevkiyat Yönetimi</h1>' +
        '<p><b>' + say.hepsi + '</b> aktif sevkiyat' + (say.geciken ? ' · <span class="kz">' + say.geciken + ' geciken</span>' : '') + ' · ' + new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', weekday: 'long' }) + '</p></div>' +
        '<div class="svk-hbtns">' + (yonetici() ? '<button class="svk-ib" data-act="yonetim" title="Yönetici araçları" aria-label="Yönetici araçları">' + ic('tools', 18) + '</button>' : '') +
        '<button class="svk-ib" data-act="yazdir" title="Yükleme listesi yazdır" aria-label="Yükleme listesi">' + ic('printer', 18) + '</button>' +
        '<button class="svk-ib" data-act="yenile" title="Yenile" aria-label="Yenile">' + ic('refresh', 18) + '</button>' +
        '<button class="svk-ib" data-act="kapat" title="Kapat" aria-label="Kapat">' + ic('x', 18) + '</button></div></div>' +
      '<div class="svk-scroll">' +
        '<div class="svk-kpis">' + kpi('geciken', say.geciken, 'Geciken', true, state.tarih === 'geciken') + kpi('bugun', say.bugun, 'Bugün', false, state.tarih === 'bugun') +
          kpi('yarin', say.yarin, 'Yarın', false, state.tarih === 'yarin') + kpi('barkod', say.barkod, 'Seri bekleyen', false, state.filtre === 'barkod_bekliyor') +
          kpi('serviste', say.serviste, 'Çıkış bekleyen', false, state.filtre === 'serviste') + '</div>' +
        '<div class="svk-filt">' +
          '<div class="svk-seg">' +
            '<button class="' + (state.tur === 'hepsi' ? 'on' : '') + '" data-act="tur" data-k="hepsi">Tümü <i>' + say.hepsi + '</i></button>' +
            '<button class="' + (state.tur === 'servis' ? 'on' : '') + '" data-act="tur" data-k="servis">' + ic('truck', 14) + ' Servis Teslim <i>' + say.servis + '</i></button>' +
            '<button class="' + (state.tur === 'musteri' ? 'on' : '') + '" data-act="tur" data-k="musteri">' + ic('user', 14) + ' Müşteri Teslim <i>' + say.musteri + '</i></button></div>' +
          '<div class="svk-ara"><div class="svk-arakutu">' + ic('search', 16) + '<input id="svk-ara" placeholder="Müşteri, ürün, telefon, satış no, seri no ara…" value="' + esc(state.ara) + '" autocomplete="off"></div>' +
            '<select id="svk-fservis" aria-label="Servis"' + (state.tur === 'musteri' ? ' disabled' : '') + '><option value="">Tüm servisler</option>' +
              SERVISLER.map(x => '<option' + (state.servis === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' +
          '<div class="svk-etiket">' + ic('calendar', 12) + ' Teslimat tarihi</div>' +
          '<div class="svk-chips">' + tchip('tumu', 'Tümü') + tchip('geciken', 'Geciken', 'kz') + tchip('bugun', 'Bugün') + tchip('yarin', 'Yarın') + tchip('hafta', 'Önümüzdeki 7 gün') + tchip('aralik', 'Tarih aralığı') + '</div>' +
          (state.tarih === 'aralik' ? '<div class="svk-aralik"><input type="date" class="svk-in" id="svk-t1" value="' + esc(state.t1) + '"><span>–</span><input type="date" class="svk-in" id="svk-t2" value="' + esc(state.t2) + '"></div>' : '') +
          '<div class="svk-etiket" style="margin-top:6px">' + ic('list', 12) + ' Durum</div>' +
          '<div class="svk-chips">' + filtreler.map(([k, l]) => '<button class="svk-chip' + (state.filtre === k ? ' on' : '') + '" data-act="filtre" data-k="' + k + '">' + l + (durumSay[k] ? ' <i>' + durumSay[k] + '</i>' : '') + '</button>').join('') + '</div>' +
        '</div>' +
        '<div class="svk-liste">' + listeHtml() + '</div>' +
      '</div></div>';
  const kay = kok().querySelector('.svk-scroll'); if (kay) kay.scrollTop = top;
}

// ═══ Detay ekranı ══════════════════════════════════════════════
const siradakiMetin = s => {
  const k = kalemListe(s).find(x => !kalemTamam(x));
  return k ? 'Sıradaki: ' + (k.n + 1) + '. ' + k.urun : 'Tüm satırlar tamam';
};
function adimlar(s) {
  const musteri = teslimTuru(s) === 'musteri', k = kalemListe(s);
  const A = [['Seri girişi', k.length > 0 && k.every(kalemTamam)], [musteri ? 'Müşteriye teslim' : 'Servis yetkilisine teslim', !!s.servisTeslim], ['Çıkış doğrulama', !!s.teslimEdildi && !s.iade]];
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

function detayHtml(s) {
  const d = durumHesapla(s), k = kalemListe(s);
  const musteri = teslimTuru(s) === 'musteri';
  const duz = depoYetkili() && !s.kapali;
  const girilebilir = duz && !s.servisTeslim;           // seri / ürün değişikliği teslimden önce serbest
  const tam = k.filter(kalemTamam).length;
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

  // — Ürünler (seri zorunluluğu seriler.json'daki Stok Kodu'na göre)
  const kalemHtml = k.map(x => {
    const gerek = seriGerekir(x.kod), dolu = !!(x.seriNo && String(x.seriNo).trim());
    const ipucu = !gerek
      ? '<div class="svk-ipucu nt">' + ic('info', 14) + '<span>Bu ürün stok listesinde (seriler.json) seri takipli değil — seri girişi gerekmez.</span></div>' : '';
    const rozetler = (x.ek ? '<div class="svk-ipucu nt">' + ic('info', 14) + '<span>Sonradan eklendi · ' + kim(x.ek.u) + ' · ' + zamanTR(x.ek.t) + '</span></div>' : '') +
      (x.degisti ? '<div class="svk-ipucu nt">' + ic('info', 14) + '<span>Ürün değiştirildi: <b>' + esc(x.degisti.eski && x.degisti.eski.urun) + '</b> → bu ürün · ' + kim(x.degisti.u) + ' · ' + zamanTR(x.degisti.t) + (x.degisti.neden ? ' · ' + esc(x.degisti.neden) : '') + '</span></div>' : '');
    const aksiyon = girilebilir
      ? '<div class="svk-kaks"><button class="svk-btn kucuk" data-act="kalemdeg" data-n="' + x.n + '">' + ic('refresh', 13) + ' Ürünü değiştir</button>' +
        (k.length > 1 ? '<button class="svk-btn kucuk" data-act="kalemcikar" data-n="' + x.n + '">' + ic('trash', 13) + ' Satırı çıkar</button>' : '') + '</div>' : '';
    return '<div class="svk-kalem"><div class="svk-kad"><span class="no">' + (x.n + 1) + '</span><span>' + esc(x.urun) + '</span><small>' + esc(x.kod) + '</small></div>' +
      '<div class="svk-kin"><input class="svk-in svk-seri" data-n="' + x.n + '" placeholder="' + (gerek ? 'Seri / barkod' : 'Seri gerekmez') + '" enterkeyhint="next" autocomplete="off" autocapitalize="characters" spellcheck="false" value="' + esc(x.seriNo || '') + '"' + (girilebilir && gerek ? '' : ' disabled') + '>' +
      '<span class="dur' + (kalemTamam(x) ? ' ok' : '') + '">' + (kalemTamam(x) ? ic('check', 14) : '') + '</span></div>' + ipucu + rozetler + aksiyon + '</div>';
  }).join('');
  const taraBtn = (girilebilir && kameraVar && k.some(x => !kalemTamam(x)))
    ? '<button class="svk-btn ana tam" style="margin-top:12px" data-act="tara">' + ic('camera', 16) + ' Kamera ile seri tara</button>' : '';
  const ekleBtn = girilebilir ? '<button class="svk-btn tam" style="margin-top:10px" data-act="kalemekle">' + ic('box', 15) + ' Ürün ekle</button>' : '';

  // — Teslimat bilgileri
  const turDeg = duz && !s.servisTeslim;
  const servisSecim = !musteri
    ? (turDeg
        ? '<select class="svk-in tam" id="svk-d-servis"><option value="">Servis seçiniz</option>' + SERVISLER.map(x => '<option' + (s.atananServis === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>'
        : '<div style="font-weight:700">' + esc(s.atananServis || 'Belirlenmedi') + '</div>')
    : '';
  const tarihBlok = duz
    ? '<input type="date" class="svk-in tam" id="svk-d-tarih" value="' + esc(s.teslimTarihi) + '"></div><div><label class="svk-lbl">Saat</label><input type="time" class="svk-in tam" id="svk-d-saat" value="' + esc(s.teslimSaati || '') + '">'
    : tarihTR(s.teslimTarihi) + '</div><div><label class="svk-lbl">Saat</label>' + esc(s.teslimSaati || '—');
  const tahsilatVar = Number(s.tahsilatTutari) > 0;     // yalnızca eski kayıtlar (yeni kayıtlarda not alanı kullanılır)

  // — Süreç panelleri: 1) Seri girişi  2) Teslim  3) Çıkış doğrulama ve kapanış
  const p1 = hepsiTam
    ? panel(1, 'Seri girişi', 'tamam', 'Tamamlandı', 'Tüm ürünler için seri/barkod girildi (' + tam + '/' + k.length + ').' + (girilebilir ? ' Teslim edilene kadar seri ve ürün değiştirilebilir.' : ''))
    : panel(1, 'Seri girişi', s.servisTeslim ? 'pasif' : 'sirada', tam + '/' + k.length, 'Seri girişi sürüyor. Ürün değişimi veya ek ürün için “Ürünler ve seri numaraları” bölümünü kullanın.');

  let p2;
  const alanEt = musteri ? 'Teslim alan kişi (müşteri) *' : 'Teslim alan servis yetkilisi *';
  if (s.servisTeslim) {
    const st = s.servisTeslim;
    p2 = panel(2, musteri ? 'Müşteriye teslim' : 'Servis yetkilisine teslim', 'tamam', 'Teslim edildi',
      (st.alan ? 'Teslim alan: <b>' + esc(st.alan) + '</b><br>' : '') + (musteri ? '' : 'Servis: <b>' + esc(s.atananServis || '—') + '</b><br>') +
      '<small>' + kim(st.u) + ' · ' + zamanTR(st.t) + '</small>' +
      (st.imza && /^data:image\/jpeg;base64,/.test(st.imza) ? '<img class="svk-imzaresim" alt="İmza" src="' + st.imza + '">' : '') +
      (yonetici() && !s.kapali ? '<div class="svk-eylem" style="margin-top:9px"><button class="svk-btn kucuk" data-act="teslimgeri">' + ic('undo', 14) + ' Teslimi geri al</button></div>' : ''));
  } else if (hepsiTam && duz) {
    p2 = panel(2, musteri ? 'Müşteriye teslim' : 'Servis yetkilisine teslim', 'sirada', 'Sırada',
      (!musteri ? 'Teslim edilecek servis: <b>' + esc(s.atananServis || 'seçilmedi') + '</b>' + (s.atananServis ? '' : ' — “Teslimat bilgileri”nden servisi seçin.') + '<br>' : '') +
      '<label class="svk-lbl">' + alanEt + '</label><input id="svk-alan" class="svk-in tam" placeholder="Ad soyad" value="' + esc(taslak.alan) + '">' +
      '<div class="svk-imzaEt">İmza (isteğe bağlı)</div><canvas id="svk-imza" class="svk-imza" width="300" height="120"></canvas>' +
      '<div class="svk-eylem" style="margin-top:9px"><button class="svk-btn" data-act="imzatemizle">Temizle</button>' +
      '<button class="svk-btn koyu" data-act="teslim">' + ic('truck', 15) + (musteri ? ' Müşteriye teslim edildi' : ' Servis yetkilisine teslim edildi') + '</button></div>');
  } else {
    p2 = panel(2, musteri ? 'Müşteriye teslim' : 'Servis yetkilisine teslim', 'pasif', 'Beklemede', 'Önce tüm ürünler için seri/barkod girilmelidir (' + tam + '/' + k.length + ').');
  }

  let p3;
  if (s.teslimEdildi) {
    const te = s.teslimEdildi;
    p3 = panel(3, 'Çıkış doğrulama ve kapanış', 'tamam', s.iade ? 'Tamamlanmıştı' : 'Tamamlandı',
      (te.dogrulama === 'yonetici' ? 'Yönetici onayıyla tamamlandı' + (te.neden ? ': ' + esc(te.neden) : '') : 'Tüm seriler stok verisinden düştü; çıkış doğrulandı.') +
      '<br><small>' + kim(te.u) + ' · ' + zamanTR(te.t) + '</small>');
  } else if (s.servisTeslim) {
    const c = cikisDurumu(s);
    const dur = { cikti: ['ok', 'Çıkış yapıldı'], stokta: ['bk', 'Stokta görünüyor'], serisiz: ['ok', 'Seri gerekmez'], bilinmiyor: ['bk', 'Stok verisi yok'], seri_yok: ['bk', 'Seri girilmemiş'] };
    const sat = c.satirlar.map(x => '<li><span class="ad">' + esc(x.k.urun) + (x.seri ? '<small class="mono">' + esc(x.seri) + '</small>' : '') + '</span><span class="svk-cp ' + dur[x.durum][0] + '">' + dur[x.durum][1] + '</span></li>').join('');
    const veriNot = seriState.ts ? 'Stok verisi: ' + new Date(seriState.ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) + ' itibarıyla yüklendi (dosya günlük güncellenir).' : 'Stok verisi yüklenemedi.';
    p3 = panel(3, 'Çıkış doğrulama ve kapanış', 'sirada', c.hazir ? 'Hazır' : c.bekleyen + ' seri bekliyor',
      '<p class="svk-not" style="margin:0 0 8px">Ürünün diğer programdan çıkışı yapılınca seri numarası stok verisinden (seriler.json) düşer. Tüm seriler çıkış yapınca sevkiyat kapatılır; seriler bir daha kullanılamaz.</p>' +
      '<ul class="svk-cks">' + sat + '</ul><div class="svk-not" style="margin:8px 0 0">' + veriNot + '</div>' +
      (duz ? '<div class="svk-eylem" style="margin-top:9px"><button class="svk-btn" data-act="cikisyenile">' + ic('refresh', 15) + ' Stok verisini yenile</button>' +
        '<button class="svk-btn yesil" data-act="cikisdogrula"' + (c.hazir ? '' : ' disabled') + '>' + ic('check', 15) + ' Çıkışı doğrula ve tamamla</button>' +
        (yonetici() && !c.hazir ? '<button class="svk-btn kucuk" data-act="cikiszorla">Yönetici onayıyla tamamla</button>' : '') + '</div>' : ''));
  } else {
    p3 = panel(3, 'Çıkış doğrulama ve kapanış', 'pasif', 'Beklemede', 'Teslimden sonra, seriler diğer programdan çıkış yapıp stok verisinden düşünce sevkiyat kapatılır.');
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
  const riskBtn = (yonetici() && !s.silindi && (s.iptal || !s.kapali))
    ? (s.iptal ? '<button class="svk-btn" data-act="iptalgeri">' + ic('undo', 15) + ' İptali geri al</button><button class="svk-btn tehlike" data-act="sil">' + ic('trash', 15) + ' Kaydı sil</button>'
               : '<button class="svk-btn tehlike" data-act="iptal">' + ic('ban', 15) + ' Sevkiyatı iptal et</button>') : '';
  if (riskBtn || iadeYap) {
    risk = '<div class="svk-card svk-risk"><div class="svk-ch">' + ic('alert', 16) + ' Yönetici / iade işlemleri</div><div class="svk-cb svk-eylem">' +
      (iadeYap ? '<button class="svk-btn" data-act="iade">' + ic('undo', 15) + ' İade / depoya dönüş</button>' : '') + riskBtn + '</div></div>';
  }

  const log = (s.log || []).slice().reverse().map(l => '<li><time>' + zamanTR(l.t) + '</time><span><b>' + esc(LOG_AD[l.a] || l.a) + '</b> · ' + kim(l.u) + (l.e ? '<br><small>' + esc(l.e) + '</small>' : '') + '</span></li>').join('');
  const notBlok = duz
    ? '<label class="svk-lbl" style="margin-top:12px">Not</label><textarea class="svk-in tam" id="svk-d-not" rows="2" placeholder="Teslimat notu (tahsilat, kat/asansör, ulaşım…)">' + esc(s.not || '') + '</textarea>'
    : (s.not ? '<div style="margin-top:10px">' + satir('msg', esc(s.not)) + '</div>' : '');

  return '<div class="svk-panel">' +
    '<div class="svk-head"><button class="svk-ib" data-act="geri" aria-label="Listeye dön">' + ic('back', 18) + '</button>' +
      '<div class="svk-ht"><h1 style="font-size:1rem;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(s.musteri) + '</h1><p style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(k.map(x => x.urun).join(', ')) + ' · ' + tarihTR(s.teslimTarihi) + (s.teslimSaati ? ' ' + esc(s.teslimSaati) : '') + '</p></div>' + rozet(d) +
      '<button class="svk-ib" data-act="yenile" title="Yenile" aria-label="Yenile">' + ic('refresh', 18) + '</button></div>' +
    '<div class="svk-scroll svk-det">' + banner + adimlar(s) +
      '<div class="svk-card"><div class="svk-ch">' + ic('user', 16) + ' Müşteri</div><div class="svk-cb"><div class="svk-ad">' + esc(s.musteri) + '</div>' +
        satir('phone', '<a href="tel:' + esc(s.telefon) + '">' + esc(s.telefon) + '</a>' + (s.telefon2 ? ' · <a href="tel:' + esc(s.telefon2) + '">' + esc(s.telefon2) + '</a>' : '')) +
        satir('pin', esc(s.adres || 'Adres girilmemiş')) +
        (s.tc ? satir('shield', 'Kimlik: ' + esc(s.tc)) : '') + (s.email ? satir('msg', esc(s.email)) : '') +
        '<div class="svk-eylem" style="margin-top:10px"><button class="svk-btn kucuk" data-act="kopyala">' + ic('file', 13) + ' Müşteri bilgilerini kopyala</button></div></div></div>' +
      '<div class="svk-card"><div class="svk-ch">' + ic('truck', 16) + ' Teslimat bilgileri</div><div class="svk-cb">' +
        '<label class="svk-lbl">Teslim şekli</label><div class="svk-turseg">' +
          '<button class="servis' + (!musteri ? ' on' : '') + '" data-act="turdeg" data-k="servis"' + (turDeg ? '' : ' disabled') + '>' + ic('truck', 15) + ' Servis Teslimi</button>' +
          '<button class="musteri' + (musteri ? ' on' : '') + '" data-act="turdeg" data-k="musteri"' + (turDeg ? '' : ' disabled') + '>' + ic('user', 15) + ' Müşteriye Teslim</button></div>' +
        '<div class="svk-alan" style="margin-top:12px">' + (!musteri ? '<div class="tam"><label class="svk-lbl">Teslim edecek servis</label>' + servisSecim + '</div>' : '') +
          '<div><label class="svk-lbl">Tarih</label>' + tarihBlok + '</div></div>' + notBlok +
        '<div style="margin-top:10px;font-size:.78rem;color:var(--k-mut)">Satış noktası: <b style="color:var(--k-ink2)">' + esc(s.satisNoktasi || '—') + '</b></div></div></div>' +
      '<div class="svk-card"><div class="svk-ch">' + ic('box', 16) + ' Ürünler ve seri numaraları<span class="sg">' + tam + '/' + k.length + '</span></div><div class="svk-cb">' +
        '<div class="svk-bhead"><div class="svk-bar' + (gec ? ' kz' : '') + '"><i style="width:' + (k.length ? Math.round(tam * 100 / k.length) : 0) + '%"></i></div></div>' + kalemHtml + taraBtn + ekleBtn + '</div></div>' +
      '<div class="svk-card"><div class="svk-ch">' + ic('list', 16) + ' Teslimat süreci</div><div class="svk-cb">' + p1 + p2 + p3 + '</div></div>' +
      tahsilatKart + risk +
      '<div class="svk-card"><div class="svk-ch">' + ic('file', 16) + ' Belgeler ve iletişim</div><div class="svk-cb svk-eylem">' +
        '<button class="svk-btn" data-act="depofisi">' + ic('printer', 15) + ' Depo fişi</button><button class="svk-btn" data-act="teslimbelge">' + ic('printer', 15) + ' Teslimat belgesi</button>' +
        '<button class="svk-btn" data-act="wa">' + ic('msg', 15) + ' WhatsApp</button>' + (s.teslimEdildi ? '<button class="svk-btn" data-act="watesl">' + ic('msg', 15) + ' Teşekkür mesajı</button>' : '') + '</div></div>' +
      '<div class="svk-card"><div class="svk-ch">' + ic('clock', 16) + ' Hareket geçmişi</div><div class="svk-cb"><ul class="svk-log">' + log + '</ul></div></div>' +
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
    if (el && !el.disabled) { el.focus({ preventScroll: true }); if (sec) { try { el.setSelectionRange(sec[0], sec[1]); } catch (e) {} } }
  }
  imzaBagla();
}
function sonrakiBosaOdaklan(n) {
  const o = kok();
  const bos = [...o.querySelectorAll('.svk-seri:not([disabled])')].filter(i => !i.value.trim());
  const sira = bos.find(i => Number(i.dataset.n) > Number(n)) || bos[0];
  if (sira) { sira.focus(); try { sira.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} return; }
  const b = o.querySelector('#svk-alan') || o.querySelector('[data-act="teslim"]');
  if (b) { b.focus(); try { b.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }
}

// ── İmza paneli ────────────────────────────────────────────────
function imzaBagla() {
  const c = $('svk-imza'); if (!c) return;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  if (taslak.imza) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, c.width, c.height); im.src = taslak.imza; }
  let cizim = false, son = null;
  const nokta = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
  c.onpointerdown = e => { cizim = true; son = nokta(e); try { c.setPointerCapture(e.pointerId); } catch (er) {} e.preventDefault(); };
  c.onpointermove = e => {
    if (!cizim) return;
    const p = nokta(e); ctx.beginPath(); ctx.moveTo(son[0], son[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); son = p; taslak.imzaVar = true;
  };
  const bitir = () => { if (cizim) { cizim = false; if (taslak.imzaVar) taslak.imza = c.toDataURL('image/jpeg', 0.6); } };
  c.onpointerup = bitir; c.onpointercancel = bitir;
}

// ═══ Seri kaydı (elle giriş + kamera ortak) ════════════════════
// Dönüş: { ok:true } | { ok:false, hata:{ tur, detay, message } }
async function seriKaydet(s, n, val) {
  val = String(val || '').trim();
  const kalem = (s.kalemler || {})[n];
  if (!kalem) return { ok: false, hata: { tur: 'genel', message: 'Kalem bulunamadı.' } };
  if (val) {
    if (!seriState.seriToBilgi) await seriYukle(true);
    const dg = seriDogrula(val, kalem.kod);
    if (dg.dogrulanamadi) return { ok: false, hata: { tur: 'liste', message: 'SERI_STOK doğrulama listesi yüklenemedi (bağlantı sorunu olabilir).' } };
    if (!dg.ok) return { ok: false, hata: { tur: dg.tur, detay: dg.detay, message: dg.mesaj } };
    // Hızlı yerel ön kontrol (kesin ve atomik kontrol transaction içinde seriKullanim ile yapılır)
    const ayni = kalemListe(s).find(k => String(k.n) !== String(n) && k.seriNo && normSeri(k.seriNo) === normSeri(val));
    if (ayni) return { ok: false, hata: { tur: 'ayni_sevkiyat', detay: { seri: val, n: ayni.n }, message: 'Bu seri bu sevkiyatın başka bir satırında zaten girilmiş.' } };
    const cak = [...state.list.values()].find(o => o.saleNo !== s.saleNo && !o.iptal && kalemListe(o).some(k => k.seriNo && normSeri(k.seriNo) === normSeri(val)));
    if (cak) return { ok: false, hata: { tur: 'kullanilmis', detay: { seri: val, saleNo: cak.saleNo, musteri: cak.musteri }, message: 'Bu seri sistemde zaten kullanılmış.' } };
  }
  let hata = null;
  const kod = kalem.kod;
  const ok = await guncelle(s, sunucu => {
    if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış; seri değiştirilemez.', tur: 'kapali' };
    if (sunucu.servisTeslim) return { hata: 'Bu sevkiyat az önce teslim edildi; seri değiştirilemez.', tur: 'kilitli' };
    const k = (sunucu.kalemler || {})[n];
    if (!k || k.cikarildi) return { hata: 'Kalem bulunamadı (başka bir cihazda çıkarılmış olabilir).' };
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

// Kameradan gelen kod: seri sahibi ürüne göre ilk boş satıra otomatik eşlenir (sıra önemli değil)
async function seriKodIsle(kod) {
  let s = aktif();
  const red = (h) => ({ ok: false, mesaj: uyariKisa(h), uyari: h });
  if (!s) return { ok: false, mesaj: 'Sevkiyat açık değil', bitti: true };
  if (s.servisTeslim || s.kapali) return { ok: false, mesaj: 'Bu sevkiyat teslim edilmiş/kapalı — seri girilemez', bitti: true, uyari: { tur: s.kapali ? 'kapali' : 'kilitli', message: 'Bu sevkiyatta artık seri girişi yapılamıyor.' } };
  if (!seriState.seriToBilgi) await seriYukle(true);
  if (!seriState.seriToBilgi) return red({ tur: 'liste', message: 'SERI_STOK listesi yüklenemedi (bağlantı sorunu olabilir).' });
  const val = kod.trim();
  const bilgi = seriSahibi(val);
  if (!bilgi) return red({ tur: 'yok', detay: { seri: val } });
  if (!(bilgi.kalan > 0)) return red({ tur: 'cikis', detay: { seri: val, kalan: bilgi.kalan, ad: B().urunAdi(bilgi.kod) } });
  const kl = kalemListe(s);
  const zaten = kl.find(k => k.seriNo && normSeri(k.seriNo) === normSeri(val));
  if (zaten) return red({ tur: 'ayni_sevkiyat', detay: { seri: val, n: zaten.n } });
  const hedef = kl.find(k => !(k.seriNo && String(k.seriNo).trim()) && String(k.kod) === String(bilgi.kod));
  if (!hedef) return red({ tur: 'eslesme_yok', detay: { seri: val, bulunanKod: bilgi.kod, bulunanAd: B().urunAdi(bilgi.kod) } });
  const r = await seriKaydet(s, hedef.n, val);
  s = aktif();
  if (!r.ok) return red(r.hata);
  if (s) detayCiz(s);
  return { ok: true, mesaj: (hedef.n + 1) + '. ' + hedef.urun + ' → ' + val, bitti: s ? kalemListe(s).every(kalemTamam) : true, siradaki: s ? siradakiMetin(s) : '' };
}
function taraBaslat() {
  const s = aktif(); if (!s) return;
  kameraTara({
    siradaki: () => siradakiMetin(aktif() || s),
    onKod: seriKodIsle,
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
  if (act === 'geri') { state.acik = null; return listeCiz(); }
  if (act === 'yenile') { el.disabled = true; await yenileGenel(true); return; }
  if (act === 'tur') { state.tur = el.dataset.k; if (state.tur === 'musteri') state.servis = ''; return listeCiz(); }
  if (act === 'tarih') { state.tarih = el.dataset.k; return listeCiz(); }
  if (act === 'kpi') {
    const k = el.dataset.k;
    if (k === 'geciken' || k === 'bugun' || k === 'yarin') { state.tarih = state.tarih === k ? 'tumu' : k; state.filtre = 'aktif'; }
    else if (k === 'barkod') { state.filtre = state.filtre === 'barkod_bekliyor' ? 'aktif' : 'barkod_bekliyor'; state.tarih = 'tumu'; }
    else if (k === 'serviste') { state.filtre = state.filtre === 'serviste' ? 'aktif' : 'serviste'; state.tarih = 'tumu'; }
    return listeCiz();
  }
  if (act === 'filtre') {
    state.filtre = el.dataset.k;
    if (kapaliFiltre()) { try { await gecmisYukle(false); } catch (er) { console.warn(er); } }
    return listeCiz();
  }
  if (act === 'detay') {
    state.acik = el.dataset.id; taslakSifirla(state.acik); detayCiz(state.list.get(state.acik));
    const g = state.list.get(state.acik);
    if (g && g.servisTeslim && !g.kapali) { const id = state.acik; seriYukle(false).then(() => { if (state.acik === id) detayCiz(state.list.get(id)); }); }
    return;
  }
  if (act === 'yazdir') {
    const liste = goruntulenen().filter(x => !x.kapali);
    return listeAc(liste, tarihEtiketi());
  }
  if (act === 'yonetim') return yonetimCiz();
  if (act === 'yetim') return yetimTara(el);
  if (act === 'yetimac') return yetimAc(el.dataset.id, el);
  if (act === 'esitle') return esitleCalistir(el);
  if (!s) return;
  if (act === 'depofisi') return belgeAc('depo', s);
  if (act === 'teslimbelge') return belgeAc('teslim', s);
  if (act === 'wa') return waAc(s);
  if (act === 'watesl') return waTeslimAc(s);
  if (act === 'imzatemizle') { taslak.imza = ''; taslak.imzaVar = false; return imzaBagla(); }
  if (!depoYetkili()) return;
  if (act === 'tara') return taraBaslat();

  if (act === 'turdeg') {
    const yeni = el.dataset.k;
    if (yeni === teslimTuru(s)) return;
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış.', tur: 'kapali' };
      if (sunucu.servisTeslim) return { hata: 'Teslim edildikten sonra teslim şekli değiştirilemez.', tur: 'kilitli' };
      return { yaz: { teslimTuru: yeni, atananServis: yeni === 'musteri' ? '' : (sunucu.atananServis === 'Müşteriye Teslim' ? '' : (sunucu.atananServis || '')) } };
    }, 'teslim_turu_degisti', yeni === 'musteri' ? 'Müşteriye teslim' : 'Servis teslimi');
    return yenidenCiz();
  }
  if (act === 'kopyala') return musteriKopyala(s);
  if (act === 'kalemekle') return kalemEkle(s);
  if (act === 'kalemdeg') return kalemDegistir(s, el.dataset.n);
  if (act === 'kalemcikar') return kalemCikar(s, el.dataset.n);
  if (act === 'teslim') {
    const alan = (($('svk-alan') || {}).value || '').trim();
    if (!alan) return hataTekrar(teslimTuru(s) === 'musteri' ? 'Teslim alan kişinin adını yazınız.' : 'Teslim alan servis yetkilisinin adını yazınız.', 'eksik');
    if (teslimTuru(s) === 'servis' && !s.atananServis) return hataTekrar('Teslim etmeden önce “Teslimat bilgileri” bölümünden servisi seçin.', 'eksik');
    if (Number(s.tahsilatTutari) > 0 && !s.tahsilatAlindi &&
        !(await onay('Tahsilat işaretlenmedi', 'Teslimde tahsil edilecek ' + tl(s.tahsilatTutari) + ' henüz “alındı” olarak işaretlenmemiş. Yine de teslim edilsin mi?', 'Yine de teslim et', true))) return;
    const veri = { t: Date.now(), u: eposta(), alan };
    if (taslak.imzaVar && taslak.imza) veri.imza = taslak.imza;
    const ok = await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat zaten kapanmış.', tur: 'kapali' };
      if (sunucu.servisTeslim) return { hata: 'Bu sevkiyat zaten teslim edilmiş.', tur: 'kapali' };
      if (!kalemListe(sunucu).every(kalemTamam)) return { hata: 'Teslim için tüm ürünlerin seri numarası girilmeli (başka bir cihazda ürün eklenmiş / seri silinmiş olabilir).', tur: 'eksik' };
      if (teslimTuru(sunucu) === 'servis' && !sunucu.atananServis) return { hata: 'Teslim edecek servis seçilmemiş.', tur: 'eksik' };
      return { yaz: { servisTeslim: veri } };
    }, 'servise_teslim', alan + (teslimTuru(s) === 'servis' ? ' · ' + (s.atananServis || '') : ''));
    if (ok) taslakSifirla(s.saleNo);
    return yenidenCiz();
  }
  if (act === 'teslimgeri') {
    if (!yonetici()) return;
    if (!(await onay('Teslim geri alınsın mı?', 'Teslim kaydı silinir; seri ve ürün düzenlemesi yeniden açılır. Ürünler fiilen teslim edildiyse bunu yapmayın.', 'Teslimi geri al', true))) return;
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış; teslim geri alınamaz.', tur: 'kapali' };
      if (!sunucu.servisTeslim) return { hata: 'Sevkiyat zaten teslim edilmemiş.', tur: 'eksik' };
      return { yaz: { servisTeslim: null } };
    }, 'teslim_geri_alindi');
    return yenidenCiz();
  }
  if (act === 'cikisyenile') {
    el.disabled = true;
    await seriYukle(true);
    if (seriState.hata) await hataTekrar('Stok verisi (seriler.json) yüklenemedi. Bağlantınızı kontrol edin.', 'liste');
    return yenidenCiz();
  }
  if (act === 'cikisdogrula') {
    await seriYukle(true);
    const c = cikisDurumu(s);
    if (!c.hazir) { yenidenCiz(); return uyariGoster({ tur: 'cikis_bekliyor', message: c.veriVar ? 'Aşağıdaki seri(ler) stok verisinde hâlâ görünüyor; diğer programda çıkış yapılmamış olabilir.' : 'Stok verisi yüklenemedi.', detay: { seriler: c.satirlar.filter(x => x.durum === 'stokta').map(x => x.seri) } }); }
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
    if (sunucu.servisTeslim) return { hata: 'Teslim edilmiş sevkiyata ürün eklenemez.', tur: 'kilitli' };
    const n = Math.max(-1, ...Object.keys(sunucu.kalemler || {}).map(Number)) + 1;
    return { yaz: { ['kalemler.' + n]: { urun: v.urun, kod: v.kod, seriNo: '', seriGerekliDegil: false, ek: { t: Date.now(), u: eposta(), neden: String(v.neden || '').trim() } } } };
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
    if (sunucu.servisTeslim) return { hata: 'Teslim edilmiş sevkiyatta ürün değiştirilemez.', tur: 'kilitli' };
    const e = (sunucu.kalemler || {})[n];
    if (!e || e.cikarildi) return { hata: 'Satır bulunamadı (başka bir cihazda çıkarılmış olabilir).', tur: 'eksik' };
    const eskiSeri = e.seriNo && String(e.seriNo).trim() ? normSeri(e.seriNo) : '';
    return {
      yaz: { ['kalemler.' + n + '.urun']: v.urun, ['kalemler.' + n + '.kod']: v.kod, ['kalemler.' + n + '.seriNo']: '', ['kalemler.' + n + '.seriGerekliDegil']: false,
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
    if (sunucu.servisTeslim) return { hata: 'Teslim edilmiş sevkiyatta satır çıkarılamaz.', tur: 'kilitli' };
    const aktifSay = kalemListe(sunucu).length;
    const e = (sunucu.kalemler || {})[n];
    if (!e || e.cikarildi) return { hata: 'Satır zaten çıkarılmış.', tur: 'eksik' };
    if (aktifSay < 2) return { hata: 'Sevkiyatta en az bir ürün satırı kalmalı.', tur: 'eksik' };
    const eskiSeri = e.seriNo && String(e.seriNo).trim() ? normSeri(e.seriNo) : '';
    return { yaz: { ['kalemler.' + n + '.cikarildi']: { t: Date.now(), u: eposta(), neden: String(v.neden || '').trim() }, ['kalemler.' + n + '.seriNo']: '' }, seriSil: eskiSeri ? [eskiSeri] : [] };
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
  try { await navigator.clipboard.writeText(metin); return true; } catch (e) {}
  try {
    const t = document.createElement('textarea'); t.value = metin; t.style.cssText = 'position:fixed;opacity:0;top:0;left:0'; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch (e) { return false; }
}
async function musteriKopyala(s) {
  const satirlar = [['Müşteri', s.musteri], ['Kimlik No (TC / Pasaport)', s.tc], ['Telefon', s.telefon], ['Telefon 2', s.telefon2], ['E-posta', s.email], ['Adres', s.adres],
    ['Teslimat', tarihTR(s.teslimTarihi) + (s.teslimSaati ? ' ' + s.teslimSaati : '')], ['Ürünler', kalemListe(s).map(k => k.urun + (k.seriNo ? ' [' + k.seriNo + ']' : '')).join('; ')], ['Not', s.not]];
  const metin = satirlar.filter(x => x[1]).map(x => x[0] + ': ' + x[1]).join('\n');
  toast((await panoya(metin)) ? 'Müşteri bilgileri panoya kopyalandı.' : 'Kopyalanamadı — tarayıcı izin vermedi.', []);
}

// ── İptal / geri alma / silme (yalnızca yönetici) ─────────────
async function iptalEt(s) {
  if (!yonetici()) return;
  const serviste = !!s.servisTeslim;
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
async function kaydiSil(s) {
  if (!yonetici()) return;
  const v = await diyalog({
    ikon: 'trash', kat: 'Yönetici işlemi', baslik: 'Kayıt listeden kaldırılsın mı?', tamam: 'Kaydı sil', vazgec: 'Vazgeç', tehlike: true,
    ozet: 'Yalnızca iptal edilmiş sevkiyatlar silinebilir. Kayıt listelerden kaldırılır ancak denetim için veritabanında saklanır. Onaylamak için satış numarasını yazın.',
    govde: '<label class="svk-lbl">Satış no: ' + esc(s.saleNo) + '</label><input class="svk-in" data-f="no" placeholder="' + esc(s.saleNo) + '" autocomplete="off">',
    dogrula: x => String(x.no).trim().toUpperCase() !== String(s.saleNo).toUpperCase() ? 'Satış numarası eşleşmiyor.' : ''
  });
  if (!v) return;
  const ok = await guncelle(s, sunucu => {
    if (!sunucu.iptal) return { hata: 'Yalnızca iptal edilmiş kayıtlar silinebilir. Önce sevkiyatı iptal edin.', tur: 'eksik' };
    if (sunucu.silindi) return { hata: 'Kayıt zaten silinmiş.', tur: 'kapali' };
    return { yaz: { silindi: { t: Date.now(), u: eposta() } } };
  }, 'silindi');
  if (ok) { state.list.delete(s.saleNo); state.acik = null; listeCiz(); toast('Kayıt listeden kaldırıldı: <b>' + esc(s.saleNo) + '</b>', []); }
}

async function degisti(e) {
  const t = e.target;
  if (t.id === 'svk-fservis') { state.servis = t.value; return listeCiz(); }
  if (t.id === 'svk-t1' || t.id === 'svk-t2') { state[t.id === 'svk-t1' ? 't1' : 't2'] = t.value; return listeCiz(); }
  const s = aktif();
  if (!s || !depoYetkili() || s.kapali) return;
  if (t.classList.contains('svk-seri')) {
    const n = t.dataset.n, val = t.value.trim();
    const once = String((s.kalemler[n] || {}).seriNo || '').trim();
    if (val === once || s.servisTeslim) return;
    const ilerlet = t.dataset.enter === '1';
    const r = await seriKaydet(s, n, val);
    if (!r.ok) { await uyariGoster(r.hata); return yenidenCiz(); }
    yenidenCiz();
    if (ilerlet && val) sonrakiBosaOdaklan(n);
  } else if (t.id === 'svk-d-not') {
    const yeni = t.value.trim();
    if (yeni === String(s.not || '').trim()) return;
    await guncelle(s, { not: yeni }, 'not_degisti', yeni.slice(0, 80), { cevrimdisiOk: true });
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

// ═══ Yönetici araçları ═════════════════════════════════════════
let yetimListe = [];
function yonetimCiz() {
  if (!yonetici()) return;
  kok().innerHTML =
    '<div class="svk-panel"><div class="svk-head"><button class="svk-ib" data-act="geri" aria-label="Listeye dön">' + ic('back', 18) + '</button>' +
    '<div class="svk-ht"><h1>' + ic('tools', 19) + ' Yönetici Araçları</h1><p>Veri bütünlüğü ve denetim</p></div></div><div class="svk-scroll svk-det">' +
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
      try { if (navigator.vibrate) navigator.vibrate([80, 40, 80]); } catch (e) {}
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
  setInterval(sayimKontrol, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sayimKontrol(); });
  setTimeout(sayimKontrol, 15000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

window.Sevkiyat = { ac, kapat, formOku, olustur, belgeAc, durumHesapla, seriYukle, seriDogrula };
