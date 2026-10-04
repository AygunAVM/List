// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — sevkiyat.js  (Rev 11.1 — giriş noktası + arayüz)
// ═══════════════════════════════════════════════════════════════
//  Modüller:
//    sevkiyat-veri.js    Firestore / transaction / seri doğrulama (DOM yok)
//    sevkiyat-kamera.js  sürekli barkod tarama
//    sevkiyat-belge.js   Depo Fişi / Teslimat Belgesi / Yükleme Listesi / WhatsApp
//    sevkiyat-stil.js    tasarım sistemi (CSS) + SVG ikonlar
//    sevkiyat.js         arayüz + olaylar (bu dosya)
//  app.js ile tek temas noktası: window._svkBridge ve window.Sevkiyat.
//
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
  state, kancalar, seriState, seriYukle, seriDogrula, seriSahibi, seriGerekir, normSeri,
  yukle, gecmisYukle, guncelle, olustur as olusturKayit, yeniIsSayisi, yetimSatislar, seriKilitleriniEsitle
} from './sevkiyat-veri.js?v=V11.1-20261004-0435';
import { belgeAc, listeAc, waAc, waTeslimAc } from './sevkiyat-belge.js?v=V11.1-20261004-0435';
import { kameraTara } from './sevkiyat-kamera.js?v=V11.1-20261004-0435';
import { stilEkle, ic } from './sevkiyat-stil.js?v=V11.1-20261004-0435';

const $ = id => document.getElementById(id);
const SAYIM_MS = 4 * 60 * 1000;
const IPTAL_NEDENLERI = ['Müşteri vazgeçti', 'Mükerrer / hatalı kayıt', 'Stok veya ürün sorunu', 'Ödeme alınamadı', 'Diğer'];
const LOG_AD = {
  olusturuldu: 'Kayıt açıldı', yetim_satistan_olusturuldu: 'Yetim satıştan açıldı', seri_girildi: 'Seri girildi', seri_silindi: 'Seri silindi',
  serisiz_isaretlendi: 'Serisiz işaretlendi', serisiz_kaldirildi: 'Serisiz kaldırıldı', kilitlendi: 'Depo onayı verildi', kilit_acildi: 'Depo onayı geri alındı',
  servise_teslim: 'Servise teslim edildi', teslim_edildi: 'Müşteriye teslim edildi', iptal: 'İptal edildi', iptal_geri_alindi: 'İptal geri alındı',
  silindi: 'Kayıt silindi', servis_atandi: 'Servis atandı', teslim_turu_degisti: 'Teslim şekli değişti', teslimat_degisti: 'Teslimat tarihi değişti',
  tahsilat_alindi: 'Tahsilat alındı'
};

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
      '<div class="footer-field full"><label>Teslimde Tahsil Edilecek Tutar (₺) <span class="ab-hint">(yoksa boş bırakın)</span></label>' +
        '<input type="number" id="svk-tahsilat" inputmode="decimal" min="0" placeholder="0"></div>' +
    '</div>';
  host.appendChild(div);
  $('svk-tarih').value = bugun();
  div.addEventListener('change', e => {
    if (e.target.name === 'svk-tur') $('svk-servis-wrap').style.display = e.target.value === 'musteri' ? 'none' : '';
  });
}
function formSifirla() {
  if ($('svk-tarih')) $('svk-tarih').value = bugun();
  ['svk-saat', 'svk-servis', 'svk-nokta', 'svk-tahsilat'].forEach(id => { if ($(id)) $(id).value = ''; });
  const r = document.querySelector('input[name="svk-tur"][value="servis"]'); if (r) r.checked = true;
  if ($('svk-servis-wrap')) $('svk-servis-wrap').style.display = '';
}
// app.js finalizeAksiyon satış bloğu bunu doğrulama için çağırır
function formOku() {
  const tarih = ($('svk-tarih') || {}).value || '';
  if (!tarih) return { ok: false, hata: 'Teslimat tarihini seçiniz.' };
  if (tarih < bugun()) return { ok: false, hata: 'Teslimat tarihi geçmişte olamaz.' };
  const tah = Number(($('svk-tahsilat') || {}).value || 0);
  if (!(tah >= 0)) return { ok: false, hata: 'Tahsilat tutarı geçersiz.' };
  const sec = document.querySelector('input[name="svk-tur"]:checked');
  const tur = sec && sec.value === 'musteri' ? 'musteri' : 'servis';
  return { ok: true, veri: {
    tarih, saat: ($('svk-saat') || {}).value || '', tur,
    servis: tur === 'servis' ? (($('svk-servis') || {}).value || '') : '', nokta: ($('svk-nokta') || {}).value || '', tahsilat: tah
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
  setTimeout(() => { if (t.parentNode) t.remove(); }, 14000);
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
        oneri: 'Etiketi yeniden okutun veya numarayı elle kontrol edin. Ürünün doğru olduğundan eminseniz stok listesinin güncel olup olmadığını yöneticiye bildirin.' };
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
    case 'kilitli': return { kat: 'İşlem uyarısı', baslik: 'Sevkiyat depo onayı almış', ozet: m, oneri: 'Değişiklik gerekiyorsa yönetici depo onayını geri alabilir.', ikCls: 'amb' };
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
async function ac() {
  kok().style.display = 'flex';
  document.body.style.overflow = 'hidden';
  state.acik = null;
  kok().innerHTML = '<div class="svk-panel"><div class="svk-bos">Yükleniyor…</div></div>';
  seriYukle(false).catch(() => {});
  try { await yukle(false); if (kapaliFiltre()) await gecmisYukle(false); } catch (e) {
    console.error('sevkiyat yukle:', e);
    kok().innerHTML = '<div class="svk-panel"><div class="svk-bos">Liste yüklenemedi: ' + esc(e.message || e) + '<br><br><button class="svk-btn" data-act="kapat">Kapat</button></div></div>'; return;
  }
  yerelSayimiYansit();
  listeCiz();
}
function kapat() { const o = $('svk-overlay'); if (o) o.style.display = 'none'; document.body.style.overflow = ''; }
const kapaliFiltre = () => ['teslim_edildi', 'iptal', 'serisiz'].includes(state.filtre);

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
  if (f === 'serisiz') return kalemListe(s).some(k => k.seriGerekliDegil);
  return s.durum === f;
}
function goruntulenen() {
  const q = state.ara.trim().toLowerCase();
  const sirala = kapaliFiltre() && state.filtre !== 'serisiz' ? (a, b) => (b.ts || 0) - (a.ts || 0)
    : (a, b) => (a.teslimTarihi + (a.teslimSaati || '')).localeCompare(b.teslimTarihi + (b.teslimSaati || ''));
  return [...state.list.values()].map(s => ({ ...s, durum: durumHesapla(s) })).filter(s => {
    if (s.silindi) return false;
    if (!durumUygun(s)) return false;
    if (state.tur !== 'hepsi' && teslimTuru(s) !== state.tur) return false;
    if (!tarihUygun(s)) return false;
    if (state.servis && s.atananServis !== state.servis) return false;
    if (!q) return true;
    const hay = [s.saleNo, s.musteri, s.telefon, s.adres, s.atananServis, ...kalemListe(s).map(k => k.seriNo + ' ' + k.urun)].join(' ').toLowerCase();
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
  return '<div class="svk-kart t-' + (musteri ? 'musteri' : 'servis') + (gec ? ' gec' : '') + (s.iptal ? ' iptal' : '') + '" data-act="detay" data-id="' + esc(s.saleNo) + '">' +
    '<div class="svk-r1"><b>' + esc(s.musteri) + '</b>' + rozet(s.durum) + '</div>' +
    '<div class="svk-r2">' + esc(s.saleNo) + (s.telefon ? ' · ' + esc(s.telefon) : '') + '</div>' +
    '<div class="svk-r3">' +
      '<span class="svk-cp' + (gec ? ' kzh' : '') + '">' + ic('calendar', 13) + tarihTR(s.teslimTarihi) + (s.teslimSaati ? ' · ' + esc(s.teslimSaati) : '') + '</span>' +
      (gec ? '<span class="svk-cp kz">' + ic('alert', 13) + gec + ' gün gecikti</span>' : '') +
      '<span class="svk-cp ' + (musteri ? 'yr' : 'mv') + '">' + ic(musteri ? 'user' : 'truck', 13) + (musteri ? 'Müşteriye teslim' : esc(s.atananServis || 'Servis atanmadı')) + '</span>' +
      '<span class="svk-cp">' + ic('box', 13) + tam + '/' + k.length + ' seri</span>' + tah +
    '</div>' +
    (s.iptal || s.kapali ? '' : '<div class="svk-bar' + (gec ? ' kz' : '') + '"><i style="width:' + yuzde + '%"></i></div>') + '</div>';
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
  if (kapaliFiltre() && state.filtre !== 'serisiz') return list.map(kartHtml).join('') +
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
  const filtreler = FILTRELER.concat(yonetici() ? [['serisiz', 'Serisiz İşaretli']] : []);
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
          kpi('yarin', say.yarin, 'Yarın', false, state.tarih === 'yarin') + kpi('barkod', say.barkod, 'Barkod bekleyen', false, state.filtre === 'barkod_bekliyor') +
          kpi('serviste', say.serviste, 'Serviste', false, state.filtre === 'serviste') + '</div>' +
        '<div class="svk-filt">' +
          '<div class="svk-seg">' +
            '<button class="' + (state.tur === 'hepsi' ? 'on' : '') + '" data-act="tur" data-k="hepsi">Tümü <i>' + say.hepsi + '</i></button>' +
            '<button class="' + (state.tur === 'servis' ? 'on' : '') + '" data-act="tur" data-k="servis">' + ic('truck', 14) + ' Servis Teslim <i>' + say.servis + '</i></button>' +
            '<button class="' + (state.tur === 'musteri' ? 'on' : '') + '" data-act="tur" data-k="musteri">' + ic('user', 14) + ' Müşteri Teslim <i>' + say.musteri + '</i></button></div>' +
          '<div class="svk-ara"><div class="svk-arakutu">' + ic('search', 16) + '<input id="svk-ara" placeholder="Müşteri, telefon, satış no, seri no ara…" value="' + esc(state.ara) + '" autocomplete="off"></div>' +
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
  const A = [['Seri / Barkod', k.length > 0 && k.every(kalemTamam)], ['Depo Onayı', !!s.kilitli]];
  if (!musteri) A.push(['Servis Teslimi', !!s.servisTeslim]);
  A.push(['Müşteri Teslimi', !!s.teslimEdildi]);
  const cur = s.iptal ? -1 : A.findIndex(x => !x[1]);
  return '<div class="svk-steps' + (s.iptal ? ' iptal' : '') + '">' + A.map(([ad, ok], i) =>
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
  const kilitli = !!s.kilitli;
  const girilebilir = duz && !kilitli;
  const tam = k.filter(kalemTamam).length;
  const gec = gecikmeGun(s);
  const kameraVar = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  // — Uyarı bantları
  let banner = '';
  if (s.iptal) {
    const ib = s.iptalBilgi || {};
    banner += '<div class="svk-banner gr">' + ic('ban', 20) + '<div><b>Bu sevkiyat iptal edildi</b>' + (ib.neden ? esc(ib.neden) + (ib.not ? ' — ' + esc(ib.not) : '') : 'İptal nedeni kayıtlı değil') +
      (ib.t ? '<br><small>' + kim(ib.u) + ' · ' + zamanTR(ib.t) + '</small>' : '') + '</div></div>';
  } else if (gec) {
    banner += '<div class="svk-banner kz">' + ic('alert', 20) + '<div><b>Teslimat ' + gec + ' gün gecikti</b>Planlanan teslimat: ' + tarihTR(s.teslimTarihi) + (s.teslimSaati ? ' ' + esc(s.teslimSaati) : '') +
      '. Teslim tarihini güncelleyin veya sevkiyatı tamamlayın.</div></div>';
  }

  // — Ürünler
  const kalemHtml = k.map(x => {
    const gerek = (girilebilir && !x.seriGerekliDegil && !kalemTamam(x)) ? seriGerekir(x.kod) : true;
    const ipucu = gerek === null
      ? '<div class="svk-ipucu">' + ic('info', 14) + '<span>SERI_STOK\'ta bu ürüne ait kayıt yok — seri gerekmiyorsa “serisiz” işaretleyin.</span></div>'
      : gerek === false ? '<div class="svk-ipucu">' + ic('info', 14) + '<span>Ürün listesinde “SeriTakip = Hayır” — seri gerekmiyor, “serisiz” işaretleyebilirsiniz.</span></div>' : '';
    const sz = x.seriGerekliDegil && x.serisizKim
      ? '<div class="svk-ipucu nt">' + ic('info', 14) + '<span>Serisiz işaretleyen: ' + kim(x.serisizKim) + ' · ' + zamanTR(x.serisizTs) + '</span></div>' : '';
    return '<div class="svk-kalem"><div class="svk-kad"><span class="no">' + (x.n + 1) + '</span><span>' + esc(x.urun) + '</span><small>' + esc(x.kod) + '</small></div>' +
      '<div class="svk-kin"><input class="svk-in svk-seri" data-n="' + x.n + '" placeholder="Seri / barkod" enterkeyhint="next" autocomplete="off" autocapitalize="characters" spellcheck="false" value="' + esc(x.seriNo || '') + '"' + (girilebilir && !x.seriGerekliDegil ? '' : ' disabled') + '>' +
      '<label class="svk-serisiz"><input type="checkbox" class="svk-sz" data-n="' + x.n + '"' + (x.seriGerekliDegil ? ' checked' : '') + (girilebilir ? '' : ' disabled') + '> Serisiz</label>' +
      '<span class="dur' + (kalemTamam(x) ? ' ok' : '') + '">' + (kalemTamam(x) ? ic('check', 14) : '') + '</span></div>' + ipucu + sz + '</div>';
  }).join('');
  const taraBtn = (girilebilir && kameraVar && k.some(x => !kalemTamam(x)))
    ? '<button class="svk-btn ana tam" style="margin-top:12px" data-act="tara">' + ic('camera', 16) + ' Kamera ile seri tara</button>' : '';

  // — Teslimat bilgileri
  const turDeg = duz && !s.servisTeslim;
  const servisSecim = !musteri
    ? (duz && !s.servisTeslim
        ? '<select class="svk-in tam" id="svk-d-servis"><option value="">Servis seçiniz</option>' + SERVISLER.map(x => '<option' + (s.atananServis === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>'
        : '<div style="font-weight:700">' + esc(s.atananServis || 'Belirlenmedi') + '</div>')
    : '';
  const tarihBlok = duz
    ? '<input type="date" class="svk-in tam" id="svk-d-tarih" value="' + esc(s.teslimTarihi) + '"></div><div><label class="svk-lbl">Saat</label><input type="time" class="svk-in tam" id="svk-d-saat" value="' + esc(s.teslimSaati || '') + '">'
    : tarihTR(s.teslimTarihi) + '</div><div><label class="svk-lbl">Saat</label>' + esc(s.teslimSaati || '—');
  const tahsilatVar = Number(s.tahsilatTutari) > 0;

  // — Süreç panelleri
  const teslimeHazir = kilitli && (musteri || !!s.servisTeslim);
  const p1 = (() => {
    if (kilitli) return panel(1, 'Depo Onayı', 'tamam', 'Onaylandı',
      'Tüm seri/barkodlar doğrulanıp kilitlendi.' + (depoYetkili() && !s.kapali && yonetici() && !s.servisTeslim ? '<div class="svk-eylem" style="margin-top:9px"><button class="svk-btn kucuk" data-act="kilitac">' + ic('unlock', 14) + ' Onayı geri al</button></div>' : ''));
    const hazir = d === 'depoda_hazir';
    return panel(1, 'Depo Onayı', hazir ? 'sirada' : 'pasif', hazir ? 'Sırada' : 'Seri bekleniyor',
      hazir ? 'Tüm ürünlerin seri/barkodu girildi. Onaylandığında seri bilgileri kilitlenir.' + (duz ? '<div class="svk-eylem" style="margin-top:9px"><button class="svk-btn koyu" data-act="kilitle">' + ic('lock', 15) + ' Onayla ve kilitle</button></div>' : '')
      : 'Önce tüm ürünler için seri/barkod girilmelidir (' + tam + '/' + k.length + ').');
  })();
  let p2 = '';
  if (!musteri) {
    if (s.servisTeslim) p2 = panel(2, 'Servis Teslimi', 'tamam', 'Teslim edildi', 'Servis: <b>' + esc(s.atananServis || '—') + '</b><br><small>' + kim(s.servisTeslim.u) + ' · ' + zamanTR(s.servisTeslim.t) + '</small>');
    else if (kilitli) p2 = panel(2, 'Servis Teslimi', 'sirada', 'Sırada',
      'Ürünleri teslim edeceğiniz servis: <b>' + esc(s.atananServis || 'seçilmedi') + '</b>' +
      (duz ? '<div class="svk-eylem" style="margin-top:9px"><button class="svk-btn koyu" data-act="servise">' + ic('truck', 15) + ' Servise teslim et</button></div>' : ''));
    else p2 = panel(2, 'Servis Teslimi', 'pasif', 'Beklemede', 'Depo onayından sonra servise teslim edilebilir.');
  }
  const no3 = musteri ? 2 : 3;
  let p3;
  if (s.teslimEdildi) {
    const te = s.teslimEdildi;
    p3 = panel(no3, 'Müşteri Teslimi', 'tamam', 'Teslim edildi', 'Teslim alan: <b>' + esc(te.alan || '') + '</b><br><small>' + kim(te.u) + ' · ' + zamanTR(te.t) + '</small>' +
      (te.imza && /^data:image\/jpeg;base64,/.test(te.imza) ? '<img class="svk-imzaresim" alt="İmza" src="' + te.imza + '">' : ''));
  } else if (teslimeHazir && duz) {
    p3 = panel(no3, 'Müşteri Teslimi', 'sirada', 'Sırada',
      '<label class="svk-lbl">Teslim alan kişi *</label><input id="svk-alan" class="svk-in tam" placeholder="Ad soyad" value="' + esc(taslak.alan) + '">' +
      '<div class="svk-imzaEt">İmza (isteğe bağlı)</div><canvas id="svk-imza" class="svk-imza" width="300" height="120"></canvas>' +
      '<div class="svk-eylem" style="margin-top:9px"><button class="svk-btn" data-act="imzatemizle">Temizle</button>' +
      '<button class="svk-btn yesil" data-act="teslim">' + ic('check', 15) + ' Müşteriye teslim edildi</button></div>');
  } else {
    p3 = panel(no3, 'Müşteri Teslimi', 'pasif', 'Beklemede', musteri ? 'Depo onayından sonra müşteriye teslim edilebilir.' : 'Servise teslim edildikten sonra müşteri teslimi kaydedilir.');
  }

  // — Tahsilat
  const tahsilatKart = tahsilatVar
    ? '<div class="svk-card"><div class="svk-ch">' + ic('wallet', 16) + ' Teslimde tahsilat<span class="sg">' + esc(tl(s.tahsilatTutari)) + '</span></div><div class="svk-cb">' +
      (s.tahsilatAlindi ? 'Tahsilat alındı — ' + kim(s.tahsilatAlindi.u) + ' · ' + zamanTR(s.tahsilatAlindi.t)
        : 'Henüz tahsil edilmedi.' + (depoYetkili() && !s.kapali ? '<div class="svk-eylem" style="margin-top:9px"><button class="svk-btn" data-act="tahsilat">' + ic('check', 15) + ' Tahsilat alındı</button></div>' : '')) +
      '</div></div>' : '';

  // — Yönetici riskli işlemler
  let risk = '';
  if (yonetici() && !s.silindi && (s.iptal || !s.kapali)) {
    risk = '<div class="svk-card svk-risk"><div class="svk-ch">' + ic('alert', 16) + ' Yönetici işlemleri</div><div class="svk-cb svk-eylem">' +
      (s.iptal ? '<button class="svk-btn" data-act="iptalgeri">' + ic('undo', 15) + ' İptali geri al</button><button class="svk-btn tehlike" data-act="sil">' + ic('trash', 15) + ' Kaydı sil</button>'
               : '<button class="svk-btn tehlike" data-act="iptal">' + ic('ban', 15) + ' Sevkiyatı iptal et</button>') + '</div></div>';
  }

  const log = (s.log || []).slice().reverse().map(l => '<li><time>' + zamanTR(l.t) + '</time><span><b>' + esc(LOG_AD[l.a] || l.a) + '</b> · ' + kim(l.u) + (l.e ? '<br><small>' + esc(l.e) + '</small>' : '') + '</span></li>').join('');

  return '<div class="svk-panel">' +
    '<div class="svk-head"><button class="svk-ib" data-act="geri" aria-label="Listeye dön">' + ic('back', 18) + '</button>' +
      '<div class="svk-ht"><h1>' + esc(s.saleNo) + '</h1><p>' + (musteri ? 'Müşteriye teslim' : 'Servis teslimi') + ' · ' + tarihTR(s.teslimTarihi) + (s.teslimSaati ? ' ' + esc(s.teslimSaati) : '') + '</p></div>' + rozet(d) + '</div>' +
    '<div class="svk-scroll svk-det">' + banner + adimlar(s) +
      '<div class="svk-card"><div class="svk-ch">' + ic('user', 16) + ' Müşteri</div><div class="svk-cb"><div class="svk-ad">' + esc(s.musteri) + '</div>' +
        satir('phone', '<a href="tel:' + esc(s.telefon) + '">' + esc(s.telefon) + '</a>' + (s.telefon2 ? ' · <a href="tel:' + esc(s.telefon2) + '">' + esc(s.telefon2) + '</a>' : '')) +
        satir('pin', esc(s.adres || 'Adres girilmemiş')) + (s.not ? satir('msg', esc(s.not)) : '') + '</div></div>' +
      '<div class="svk-card"><div class="svk-ch">' + ic('truck', 16) + ' Teslimat bilgileri</div><div class="svk-cb">' +
        '<label class="svk-lbl">Teslim şekli</label><div class="svk-turseg">' +
          '<button class="servis' + (!musteri ? ' on' : '') + '" data-act="turdeg" data-k="servis"' + (turDeg ? '' : ' disabled') + '>' + ic('truck', 15) + ' Servis Teslimi</button>' +
          '<button class="musteri' + (musteri ? ' on' : '') + '" data-act="turdeg" data-k="musteri"' + (turDeg ? '' : ' disabled') + '>' + ic('user', 15) + ' Müşteriye Teslim</button></div>' +
        '<div class="svk-alan" style="margin-top:12px">' + (!musteri ? '<div class="tam"><label class="svk-lbl">Teslim edecek servis</label>' + servisSecim + '</div>' : '') +
          '<div><label class="svk-lbl">Tarih</label>' + tarihBlok + '</div></div>' +
        '<div style="margin-top:10px;font-size:.78rem;color:var(--k-mut)">Satış noktası: <b style="color:var(--k-ink2)">' + esc(s.satisNoktasi || '—') + '</b></div></div></div>' +
      '<div class="svk-card"><div class="svk-ch">' + ic('box', 16) + ' Ürünler ve seri numaraları<span class="sg">' + tam + '/' + k.length + '</span></div><div class="svk-cb">' +
        '<div class="svk-bhead"><div class="svk-bar' + (gec ? ' kz' : '') + '"><i style="width:' + (k.length ? Math.round(tam * 100 / k.length) : 0) + '%"></i></div></div>' + kalemHtml + taraBtn + '</div></div>' +
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
  const b = o.querySelector('[data-act="kilitle"]');
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
    if (sunucu.kilitli) return { hata: 'Bu sevkiyat az önce depo onayı aldı; seri değiştirilemez.', tur: 'kilitli' };
    const k = (sunucu.kalemler || {})[n];
    if (!k) return { hata: 'Kalem bulunamadı.' };
    const eski = k.seriNo ? normSeri(k.seriNo) : '';
    const yeni = val ? normSeri(val) : '';
    return {
      yaz: { ['kalemler.' + n + '.seriNo']: val, ['kalemler.' + n + '.seriGerekliDegil']: false },
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
  if (s.kilitli || s.kapali) return { ok: false, mesaj: 'Bu sevkiyat kilitli/kapalı — seri girilemez', bitti: true, uyari: { tur: s.kapali ? 'kapali' : 'kilitli', message: 'Bu sevkiyatta artık seri girişi yapılamıyor.' } };
  if (!seriState.seriToBilgi) await seriYukle(true);
  if (!seriState.seriToBilgi) return red({ tur: 'liste', message: 'SERI_STOK listesi yüklenemedi (bağlantı sorunu olabilir).' });
  const val = kod.trim();
  const bilgi = seriSahibi(val);
  if (!bilgi) return red({ tur: 'yok', detay: { seri: val } });
  if (!(bilgi.kalan > 0)) return red({ tur: 'cikis', detay: { seri: val, kalan: bilgi.kalan, ad: B().urunAdi(bilgi.kod) } });
  const kl = kalemListe(s);
  const zaten = kl.find(k => k.seriNo && normSeri(k.seriNo) === normSeri(val));
  if (zaten) return red({ tur: 'ayni_sevkiyat', detay: { seri: val, n: zaten.n } });
  const hedef = kl.find(k => !k.seriGerekliDegil && !(k.seriNo && String(k.seriNo).trim()) && String(k.kod) === String(bilgi.kod));
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
  if (act === 'yenile') {
    el.disabled = true;
    try { await yukle(true); if (kapaliFiltre()) await gecmisYukle(true); yerelSayimiYansit(); } catch (er) { await hataTekrar('Yenilenemedi: ' + (er.message || er)); }
    return yenidenCiz();
  }
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
  if (act === 'detay') { state.acik = el.dataset.id; taslakSifirla(state.acik); return detayCiz(state.list.get(state.acik)); }
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
      if (sunucu.servisTeslim) return { hata: 'Servise teslim edildikten sonra teslim şekli değiştirilemez.', tur: 'kilitli' };
      return { yaz: { teslimTuru: yeni, atananServis: yeni === 'musteri' ? '' : (sunucu.atananServis === 'Müşteriye Teslim' ? '' : (sunucu.atananServis || '')) } };
    }, 'teslim_turu_degisti', yeni === 'musteri' ? 'Müşteriye teslim' : 'Servis teslimi');
    return yenidenCiz();
  }
  if (act === 'kilitle') {
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış.', tur: 'kapali' };
      if (sunucu.kilitli) return { hata: 'Bu sevkiyat az önce başka biri tarafından onaylandı.', tur: 'kilitli' };
      if (durumHesapla(sunucu) !== 'depoda_hazir') return { hata: 'Onay için tüm ürünlere seri girilmeli (başka bir cihazda değişmiş olabilir).', tur: 'eksik' };
      return { yaz: { kilitli: true } };
    }, 'kilitlendi');
    return yenidenCiz();
  }
  if (act === 'kilitac') {
    if (!yonetici()) return;
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış.', tur: 'kapali' };
      if (!sunucu.kilitli) return { hata: 'Sevkiyat zaten onaylı değil.', tur: 'eksik' };
      if (sunucu.servisTeslim) return { hata: 'Servise teslim edilmiş; depo onayı geri alınamaz.', tur: 'kilitli' };
      return { yaz: { kilitli: false } };
    }, 'kilit_acildi');
    return yenidenCiz();
  }
  if (act === 'servise') {
    if (!s.atananServis || s.atananServis === 'Müşteriye Teslim') { await hataTekrar('Servise teslim etmeden önce “Teslimat bilgileri” bölümünden teslim edecek servisi seçin.', 'eksik'); return; }
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış.', tur: 'kapali' };
      if (teslimTuru(sunucu) === 'musteri') return { hata: 'Bu sevkiyat müşteriye doğrudan teslim olarak planlanmış.', tur: 'eksik' };
      if (!sunucu.kilitli) return { hata: 'Önce depo onayı verilmeli.', tur: 'eksik' };
      if (sunucu.servisTeslim) return { hata: 'Zaten servise teslim edilmiş.', tur: 'kapali' };
      if (!sunucu.atananServis) return { hata: 'Teslim edecek servis seçilmemiş.', tur: 'eksik' };
      return { yaz: { servisTeslim: { t: Date.now(), u: eposta() } } };
    }, 'servise_teslim', s.atananServis || '');
    return yenidenCiz();
  }
  if (act === 'tahsilat') {
    if (!(await onay('Tahsilat alındı mı?', tl(s.tahsilatTutari) + ' tahsil edildi olarak işaretlenecek.', 'Evet, alındı'))) return;
    await guncelle(s, sunucu => sunucu.tahsilatAlindi ? { hata: 'Tahsilat zaten işaretlenmiş.', tur: 'kapali' }
      : { yaz: { tahsilatAlindi: { t: Date.now(), u: eposta(), tutar: Number(sunucu.tahsilatTutari) || 0 } } }, 'tahsilat_alindi', tl(s.tahsilatTutari));
    return yenidenCiz();
  }
  if (act === 'teslim') {
    const alan = (($('svk-alan') || {}).value || '').trim();
    if (!alan) return hataTekrar('Teslim alan kişinin adını yazınız.', 'eksik');
    if (Number(s.tahsilatTutari) > 0 && !s.tahsilatAlindi &&
        !(await onay('Tahsilat işaretlenmedi', 'Teslimde tahsil edilecek ' + tl(s.tahsilatTutari) + ' henüz “alındı” olarak işaretlenmemiş. Yine de teslim edilsin mi?', 'Yine de teslim et', true))) return;
    const veri = { t: Date.now(), u: eposta(), alan };
    if (taslak.imzaVar && taslak.imza) veri.imza = taslak.imza;
    const ok = await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat zaten kapanmış (teslim edilmiş veya iptal).', tur: 'kapali' };
      if (!sunucu.kilitli) return { hata: 'Önce depo onayı verilmeli.', tur: 'eksik' };
      if (teslimTuru(sunucu) === 'servis' && !sunucu.servisTeslim) return { hata: 'Önce servise teslim edilmeli.', tur: 'eksik' };
      return { yaz: { teslimEdildi: veri } };
    }, 'teslim_edildi', alan);
    if (ok) taslakSifirla(s.saleNo);
    return yenidenCiz();
  }
  if (act === 'iptal') return iptalEt(s);
  if (act === 'iptalgeri') return iptalGeriAl(s);
  if (act === 'sil') return kaydiSil(s);
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
    if (sunucu.teslimEdildi) return { hata: 'Müşteriye teslim edilmiş sevkiyat iptal edilemez.', tur: 'kapali' };
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
    if (val === once || s.kilitli) return;
    const ilerlet = t.dataset.enter === '1';
    const r = await seriKaydet(s, n, val);
    if (!r.ok) { await uyariGoster(r.hata); return yenidenCiz(); }
    yenidenCiz();
    if (ilerlet && val) sonrakiBosaOdaklan(n);
  } else if (t.classList.contains('svk-sz')) {
    const n = t.dataset.n, isaret = t.checked;
    const kalem = (s.kalemler || {})[n] || {};
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış.', tur: 'kapali' };
      if (sunucu.kilitli) return { hata: 'Bu sevkiyat az önce depo onayı aldı; değiştirilemez.', tur: 'kilitli' };
      const k = (sunucu.kalemler || {})[n] || {};
      const eski = k.seriNo ? normSeri(k.seriNo) : '';
      const yaz = { ['kalemler.' + n + '.seriGerekliDegil']: isaret };
      if (isaret) {
        yaz['kalemler.' + n + '.seriNo'] = '';
        yaz['kalemler.' + n + '.serisizKim'] = eposta();
        yaz['kalemler.' + n + '.serisizTs'] = Date.now();
      }
      return { yaz, seriSil: isaret && eski ? [eski] : [] };
    }, isaret ? 'serisiz_isaretlendi' : 'serisiz_kaldirildi', 'kalem ' + (Number(n) + 1) + ' · ' + (kalem.kod || '') + ' · ' + (kalem.urun || ''));
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
