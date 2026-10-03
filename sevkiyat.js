// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — sevkiyat.js  (Rev 11.0 — giriş noktası + arayüz)
// ═══════════════════════════════════════════════════════════════
//  Rev 11.0 — modüllere bölündü:
//    sevkiyat-veri.js    Firestore/transaction/seri doğrulama (DOM yok)
//    sevkiyat-kamera.js  sürekli barkod tarama
//    sevkiyat-belge.js   Depo Fişi / Teslimat Belgesi / Yükleme Listesi / WhatsApp
//    sevkiyat.js         arayüz + olaylar (bu dosya)
//  app.js ile tek temas noktası: window._svkBridge ve window.Sevkiyat.
//
//  Rev 11.0 DEĞİŞİKLİKLERİ
//  · VERİ BÜTÜNLÜĞÜ: tüm yazmalar transaction (taze sunucu verisi); log artık
//    sunucudaki diziye eklenir (eşzamanlı işlemde log kaybolmaz). Kilitle /
//    kilit aç / servise / teslim / iptal sunucudaki GÜNCEL duruma göre doğrulanır.
//  · SERİ KİLİDİ: seriKullanim/{seri} belgesi ile bir seri yalnızca TEK
//    sevkiyatta kullanılabilir (eski/kapanmış sevkiyatlar dahil, atomik).
//  · SERI_STOK: 'Kalan' alanı artık denetleniyor; hata mesajları ayrı:
//    "listede yok" / "başka ürüne ait" / "stok çıkışı yapılmış" / "sistemde kullanılmış".
//  · DEPO HIZI: odak + kaydırma korunur; seri girişi/okutma sonrası sıradaki
//    boş satıra otomatik geçilir; kamera SÜREKLİ tarar (bip/titreşim, tekrar
//    koruması, ürüne göre otomatik satır eşleme, fener, otofokus).
//  · İŞ LİSTESİ (bugün/yarın/geciken, servise göre) + yazdırılabilir yükleme listesi.
//  · Yeni sevkiyat sayacı (getCountFromServer, 4 dk, sekme arka plandayken durur).
//  · Teslimde tahsilat takibi, ekranda imza, serisiz önerisi + yönetici filtresi,
//    bekleyen yazma rozeti, yönetici araçları (yetim satışlar, seri kilidi eşitleme).
//
//  Önceki sürüm notları (10.x) için: sevkiyat.v10 yedeği / Git geçmişi.
// ═══════════════════════════════════════════════════════════════
import {
  SERVISLER, SATIS_NOKTALARI, DURUMLAR, FILTRELER, B, esc, bugun, yarin, tarihTR, zamanTR, tl,
  eposta, yonetici, depoYetkili, kalemListe, kalemTamam, durumHesapla,
  state, kancalar, seriState, seriYukle, seriDogrula, seriSahibi, seriGerekir, normSeri,
  yukle, gecmisYukle, guncelle, olustur as olusturKayit, yeniIsSayisi, yetimSatislar, seriKilitleriniEsitle
} from './sevkiyat-veri.js?v=V11.0-20261003-2321';
import { belgeAc, listeAc, waAc, waTeslimAc } from './sevkiyat-belge.js?v=V11.0-20261003-2321';
import { kameraTara } from './sevkiyat-kamera.js?v=V11.0-20261003-2321';

const $ = id => document.getElementById(id);
const SAYIM_MS = 4 * 60 * 1000;

const LOG_AD = {
  olusturuldu: 'Kayıt açıldı', yetim_satistan_olusturuldu: 'Yetim satıştan açıldı', seri_girildi: 'Seri girildi', seri_silindi: 'Seri silindi',
  serisiz_isaretlendi: 'Serisiz işaretlendi', serisiz_kaldirildi: 'Serisiz kaldırıldı', kilitlendi: 'Kilitlendi', kilit_acildi: 'Kilit açıldı',
  servise_teslim: 'Servise teslim', teslim_edildi: 'Müşteriye teslim', iptal: 'İptal', servis_atandi: 'Servis atandı',
  teslimat_degisti: 'Teslimat değişti', tahsilat_alindi: 'Tahsilat alındı'
};

// Teslim formu taslağı (yeniden çizimde kaybolmasın)
const taslak = { id: null, alan: '', imza: '', imzaVar: false };
function taslakSifirla(id) { taslak.id = id; taslak.alan = ''; taslak.imza = ''; taslak.imzaVar = false; }

// ── Satış formu: teslimat alanları (sale-extra-fields içine enjekte) ──
function formEnjekte() {
  const host = $('sale-extra-fields');
  if (!host || $('svk-fields')) return;
  const div = document.createElement('div');
  div.id = 'svk-fields';
  div.innerHTML =
    '<div class="wa-section-divider">🚚 Teslimat Bilgisi</div>' +
    '<div class="wa-grid">' +
      '<div class="footer-field"><label>Teslimat Tarihi *</label><input type="date" id="svk-tarih"></div>' +
      '<div class="footer-field"><label>Teslimat Saati</label><input type="time" id="svk-saat"></div>' +
      '<div class="footer-field"><label>Teslim Edecek Servis</label><select id="svk-servis">' +
        '<option value="">Sonra belirlenecek</option>' +
        SERVISLER.map(x => '<option>' + esc(x) + '</option>').join('') + '</select></div>' +
      '<div class="footer-field"><label>Satış Noktası</label><select id="svk-nokta">' +
        '<option value="">—</option>' + SATIS_NOKTALARI.map(x => '<option>' + esc(x) + '</option>').join('') + '</select></div>' +
      '<div class="footer-field full"><label>Teslimde Tahsil Edilecek Tutar (₺) <span class="ab-hint">(yoksa boş bırakın)</span></label>' +
        '<input type="number" id="svk-tahsilat" inputmode="decimal" min="0" placeholder="0"></div>' +
    '</div>';
  host.appendChild(div);
  $('svk-tarih').value = bugun();
}
function formSifirla() {
  if ($('svk-tarih')) $('svk-tarih').value = bugun();
  ['svk-saat', 'svk-servis', 'svk-nokta', 'svk-tahsilat'].forEach(id => { if ($(id)) $(id).value = ''; });
}
// app.js finalizeAksiyon satış bloğu bunu doğrulama için çağırır
function formOku() {
  const tarih = ($('svk-tarih') || {}).value || '';
  if (!tarih) return { ok: false, hata: 'Teslimat tarihini seçiniz.' };
  if (tarih < bugun()) return { ok: false, hata: 'Teslimat tarihi geçmişte olamaz.' };
  const tah = Number(($('svk-tahsilat') || {}).value || 0);
  if (!(tah >= 0)) return { ok: false, hata: 'Tahsilat tutarı geçersiz.' };
  return { ok: true, veri: {
    tarih, saat: ($('svk-saat') || {}).value || '',
    servis: ($('svk-servis') || {}).value || '', nokta: ($('svk-nokta') || {}).value || '', tahsilat: tah
  } };
}

// ── Kayıt oluştur (satış tamamlanınca) — app.js `.catch` zinciri için Promise döner ──
async function olustur(sale, v, not) {
  const { kayit } = olusturKayit(sale, v, not);
  formSifirla();
  const cevrimici = navigator.onLine !== false;
  toast(cevrimici
    ? '🚚 Sevkiyat kaydı açıldı: <b>' + esc(sale.id) + '</b>'
    : '⏳ Sevkiyat kaydı cihaza kaydedildi: <b>' + esc(sale.id) + '</b> — bağlantı gelince otomatik gönderilecek',
  [['Depo Fişi', () => belgeAc('depo', kayit)]]);
  return kayit;
}
kancalar.yazimHata = (id, e) => {
  console.error('sevkiyat yazım hatası:', id, e);
  toast('⚠️ Sevkiyat kaydı sunucuya YAZILAMADI (' + esc(id) + '): ' + esc((e && e.message) || e) + '. Yöneticiye bildirin / Yönetim → yetim satışlar.', []);
};
kancalar.bekleyen = n => pillGuncelle(n);

// ── Toast / bekleyen yazma rozeti ──────────────────────────────
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
  p.textContent = metin || ('⏳ ' + n + ' sevkiyat kaydı gönderilmeyi bekliyor');
}
// Sayfa açılışında önceki oturumdan kalan (IndexedDB'deki) bekleyen yazma var mı?
async function bekleyenKontrol() {
  const b = B(); if (!b || !b.waitForPendingWrites) return;
  let bitti = false;
  const p = b.waitForPendingWrites(b.db).then(() => { bitti = true; if (!state.bekleyen) pillGuncelle(0); }).catch(() => {});
  await Promise.race([p, new Promise(r => setTimeout(r, 1500))]);
  if (!bitti && !state.bekleyen) pillGuncelle(0, '⏳ Cihazda gönderilmeyi bekleyen kayıtlar var');
}

// ── Takip ekranı ───────────────────────────────────────────────
function kok() {
  let o = $('svk-overlay');
  if (o) return o;
  o = document.createElement('div'); o.id = 'svk-overlay'; o.className = 'svk-overlay';
  o.addEventListener('click', tikla);
  o.addEventListener('change', degisti);
  o.addEventListener('input', e => {
    if (e.target.id === 'svk-ara') { state.ara = e.target.value; const l = o.querySelector('.svk-liste'); if (l) l.innerHTML = kartlarHtml(); }
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
  kok().innerHTML = '<div class="svk-bos">Yükleniyor…</div>';
  seriYukle(false).catch(() => {}); // arka planda; sevkiyat listesini bloklamasın
  try { await yukle(false); if (state.filtre === 'kapali') await gecmisYukle(false); } catch (e) {
    console.error('sevkiyat yukle:', e);
    kok().innerHTML = '<div class="svk-bos">Liste yüklenemedi: ' + esc(e.message || e) + '<br><button class="svk-btn" data-act="kapat">Kapat</button></div>'; return;
  }
  yerelSayimiYansit();
  listeCiz();
}
function kapat() { const o = $('svk-overlay'); if (o) o.style.display = 'none'; document.body.style.overflow = ''; }

function goruntulenen() {
  const q = state.ara.trim().toLowerCase();
  const f = state.filtre, yr = yarin();
  return [...state.list.values()].map(s => ({ ...s, durum: durumHesapla(s) })).filter(s => {
    if (f === 'aktif') { if (s.kapali) return false; }
    else if (f === 'gunluk') { if (s.kapali || s.teslimTarihi > yr) return false; }
    else if (f === 'kapali') { if (!s.kapali) return false; }
    else if (f === 'serisiz') { if (!kalemListe(s).some(k => k.seriGerekliDegil)) return false; }
    else if (s.durum !== f) return false;
    if (state.servis && s.atananServis !== state.servis) return false;
    if (!q) return true;
    const hay = [s.saleNo, s.musteri, s.telefon, s.adres, ...kalemListe(s).map(k => k.seriNo + ' ' + k.urun)].join(' ').toLowerCase();
    return hay.includes(q);
  }).sort((a, b) => (a.teslimTarihi + (a.teslimSaati || '')).localeCompare(b.teslimTarihi + (b.teslimSaati || '')));
}
function rozet(d) { const x = DURUMLAR[d] || DURUMLAR.barkod_bekliyor; return '<span class="svk-rozet" style="color:' + x.renk + ';background:' + x.bg + '">' + x.ico + ' ' + x.label + '</span>'; }

function kartHtml(s, bugunStr) {
  const k = kalemListe(s), tam = k.filter(kalemTamam).length;
  const gecikti = !s.kapali && s.teslimTarihi < bugunStr;
  const tah = Number(s.tahsilatTutari) > 0 && !s.tahsilatAlindi ? '<span class="svk-tah">💵 ' + esc(tl(s.tahsilatTutari)) + '</span>' : '';
  return '<div class="svk-kart" data-act="detay" data-id="' + esc(s.saleNo) + '">' +
    '<div class="svk-r1"><b>' + esc(s.musteri) + '</b>' + rozet(s.durum) + '</div>' +
    '<div class="svk-r2">' + esc(s.saleNo) + ' · ' + esc(s.telefon) + '</div>' +
    '<div class="svk-r3"><span' + (gecikti ? ' style="color:#D01F2E;font-weight:700"' : '') + '>📅 ' + tarihTR(s.teslimTarihi) + ' ' + esc(s.teslimSaati || '') + (gecikti ? ' (gecikti)' : '') + '</span>' +
    '<span>🚚 ' + esc(s.atananServis || 'Servis atanmadı') + '</span><span>🏷️ ' + tam + '/' + k.length + ' barkod</span>' + tah + '</div></div>';
}
function gunlukHtml() {
  const list = goruntulenen(), b = bugun(), y = yarin();
  const kovalar = [
    ['⚠️ Gecikenler', s => s.teslimTarihi < b],
    ['Bugün — ' + tarihTR(b), s => s.teslimTarihi === b],
    ['Yarın — ' + tarihTR(y), s => s.teslimTarihi === y]
  ];
  let html = '<div class="svk-gunbar"><button class="svk-btn" data-act="liste" data-t="' + b + '">🖨️ Bugün Yükleme Listesi</button>' +
    '<button class="svk-btn" data-act="liste" data-t="' + y + '">🖨️ Yarın Listesi</button></div>';
  let hic = true;
  kovalar.forEach(([baslik, fn]) => {
    const grup = list.filter(fn);
    if (!grup.length) return;
    hic = false;
    html += '<div class="svk-gbas">' + esc(baslik) + ' <i>' + grup.length + '</i></div>';
    const servisler = [...new Set(grup.map(s => s.atananServis || ''))].sort((p, q) => (p || '~').localeCompare(q || '~', 'tr'));
    servisler.forEach(sv => {
      html += '<div class="svk-sbas">🚚 ' + esc(sv || 'Servis atanmadı') + '</div>' + grup.filter(s => (s.atananServis || '') === sv).map(s => kartHtml(s, b)).join('');
    });
  });
  return hic ? '<div class="svk-bos">Bugün / yarın için aktif sevkiyat yok 🎉</div>' : html;
}
function kartlarHtml() {
  if (state.filtre === 'gunluk') return gunlukHtml();
  const b = bugun();
  return goruntulenen().map(s => kartHtml(s, b)).join('') || '<div class="svk-bos">Kayıt yok</div>';
}

function listeCiz() {
  const sayac = { aktif: 0, kapali: 0, gunluk: 0 }, yr = yarin();
  [...state.list.values()].forEach(s => {
    const d = durumHesapla(s);
    sayac[d] = (sayac[d] || 0) + 1;
    if (s.kapali) sayac.kapali++; else { sayac.aktif++; if (s.teslimTarihi <= yr) sayac.gunluk++; }
  });
  const filtreler = FILTRELER.concat(yonetici() ? [['serisiz', 'Serisiz İşaretli']] : []);
  kok().innerHTML =
    '<div class="svk-panel"><div class="svk-head"><b>🚚 Sevkiyat Takip</b>' +
    '<span>' + (yonetici() ? '<button class="svk-btn" data-act="yonetim" title="Yönetici araçları">🛠</button>' : '') +
    '<button class="svk-btn" data-act="yenile">↻ Yenile</button><button class="svk-btn" data-act="kapat">✕</button></span></div>' +
    '<div class="svk-tools"><input id="svk-ara" placeholder="Müşteri, telefon, satış no, seri no ara…" value="' + esc(state.ara) + '">' +
    '<select id="svk-fservis"><option value="">Tüm servisler</option>' + SERVISLER.map(x => '<option' + (state.servis === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' +
    '<div class="svk-chips">' + filtreler.map(([k, l]) => '<button class="svk-chip' + (state.filtre === k ? ' on' : '') + '" data-act="filtre" data-k="' + k + '">' + l +
      (sayac[k] ? ' <i>' + sayac[k] + '</i>' : '') + '</button>').join('') + '</div>' +
    '<div class="svk-liste">' + kartlarHtml() + '</div></div>';
}

// ── Detay ekranı ───────────────────────────────────────────────
const siradakiMetin = s => {
  const k = kalemListe(s).find(x => !kalemTamam(x));
  return k ? 'Sıradaki: ' + (k.n + 1) + '. ' + k.urun : 'Tüm satırlar tamam ✅';
};

function detayHtml(s) {
  const d = durumHesapla(s), k = kalemListe(s);
  const duz = depoYetkili() && !s.kapali;
  const kilitli = !!s.kilitli;
  const girilebilir = duz && !kilitli;
  const tam = k.filter(kalemTamam).length;
  const kameraVar = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const kalemHtml = k.map(x => {
    const gerek = (girilebilir && !x.seriGerekliDegil && !kalemTamam(x)) ? seriGerekir(x.kod) : true;
    const ipucu = gerek === null
      ? '<div class="svk-ipucu">ℹ️ SERI_STOK\'ta bu ürüne ait kayıt yok — seri gerekmiyorsa “serisiz” işaretleyin.</div>'
      : gerek === false ? '<div class="svk-ipucu">ℹ️ Ürün listesinde “SeriTakip = Hayır” — seri gerekmiyor, “serisiz” işaretleyebilirsiniz.</div>' : '';
    const sz = x.seriGerekliDegil && x.serisizKim
      ? '<div class="svk-ipucu">serisiz işaretleyen: ' + esc(String(x.serisizKim).split('@')[0]) + ' · ' + zamanTR(x.serisizTs) + '</div>' : '';
    return '<div class="svk-kalem" data-kn="' + x.n + '"><div class="svk-kad">' + (x.n + 1) + '. ' + esc(x.urun) + ' <small>' + esc(x.kod) + '</small></div>' +
      '<div class="svk-kin"><input class="svk-seri" data-n="' + x.n + '" placeholder="Seri / barkod" enterkeyhint="next" autocomplete="off" autocapitalize="characters" spellcheck="false" value="' + esc(x.seriNo || '') + '"' + (girilebilir && !x.seriGerekliDegil ? '' : ' disabled') + '>' +
      '<label class="svk-serisiz"><input type="checkbox" class="svk-sz" data-n="' + x.n + '"' + (x.seriGerekliDegil ? ' checked' : '') + (girilebilir ? '' : ' disabled') + '> serisiz</label>' +
      '<span>' + (kalemTamam(x) ? '✅' : '⬜') + '</span></div>' + ipucu + sz + '</div>';
  }).join('');
  const servisSel = duz
    ? '<select id="svk-d-servis"><option value="">Belirlenmedi</option>' + SERVISLER.map(x => '<option' + (s.atananServis === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>'
    : esc(s.atananServis || 'Belirlenmedi');
  const tarihInp = duz
    ? '<input type="date" id="svk-d-tarih" value="' + esc(s.teslimTarihi) + '"> <input type="time" id="svk-d-saat" value="' + esc(s.teslimSaati || '') + '">'
    : tarihTR(s.teslimTarihi) + ' ' + esc(s.teslimSaati || '');
  const tahsilatVar = Number(s.tahsilatTutari) > 0;
  const tahsilatSatir = tahsilatVar
    ? '<div>💵 Teslimde tahsilat: <b>' + esc(tl(s.tahsilatTutari)) + '</b> — ' + (s.tahsilatAlindi
        ? '✅ alındı (' + esc(String(s.tahsilatAlindi.u || '').split('@')[0]) + ' · ' + zamanTR(s.tahsilatAlindi.t) + ')' : '⏳ bekliyor') + '</div>' : '';

  let eylem = '', teslimBlok = '';
  const teslimeHazir = kilitli && (s.servisTeslim || s.atananServis === 'Müşteriye Teslim');
  if (depoYetkili() && !s.kapali) {
    if (!kilitli && d === 'depoda_hazir') eylem += '<button class="svk-btn ana" data-act="kilitle">🔒 Onayla ve Kilitle</button>';
    if (kilitli && yonetici() && !s.servisTeslim) eylem += '<button class="svk-btn" data-act="kilitac">🔓 Kilidi Aç</button>';
    if (tahsilatVar && !s.tahsilatAlindi) eylem += '<button class="svk-btn" data-act="tahsilat">💵 Tahsilat Alındı</button>';
    if (kilitli && !s.servisTeslim && s.atananServis !== 'Müşteriye Teslim') eylem += '<button class="svk-btn ana" data-act="servise">🚚 Servise Teslim Et</button>';
    if (yonetici()) eylem += '<button class="svk-btn tehlike" data-act="iptal">⛔ İptal Et</button>';
    if (teslimeHazir) {
      teslimBlok = '<div class="svk-blok"><b>Müşteriye Teslim</b>' +
        '<input id="svk-alan" class="svk-tam" placeholder="Teslim alan ad soyad" value="' + esc(taslak.alan) + '">' +
        '<div class="svk-imzaEtiket">İmza (isteğe bağlı)</div>' +
        '<canvas id="svk-imza" class="svk-imza" width="300" height="120"></canvas>' +
        '<div class="svk-eylem"><button class="svk-btn" data-act="imzatemizle">Temizle</button>' +
        '<button class="svk-btn ana" data-act="teslim">✅ Müşteriye Teslim Edildi</button></div></div>';
    }
  }
  const log = (s.log || []).slice().reverse().map(l => '<li>' + zamanTR(l.t) + ' · ' + esc((l.u || '').split('@')[0]) + ' · ' +
    esc(LOG_AD[l.a] || l.a) + (l.e ? ' (' + esc(l.e) + ')' : '') + '</li>').join('');
  const taraBtn = (girilebilir && kameraVar && k.some(x => !kalemTamam(x)))
    ? '<button class="svk-btn ana svk-tara" data-act="tara">📷 Seri Tara (sürekli)</button>' : '';
  return '<div class="svk-panel"><div class="svk-head"><span><button class="svk-btn" data-act="geri">← Liste</button></span><b>' + esc(s.saleNo) + '</b>' + rozet(d) + '</div>' +
    '<div class="svk-det">' +
    '<div class="svk-blok"><b>' + esc(s.musteri) + '</b><br>📞 ' + esc(s.telefon) + (s.telefon2 ? ' / ' + esc(s.telefon2) : '') + '<br>📍 ' + esc(s.adres || '—') +
    (s.not ? '<br>📝 ' + esc(s.not) : '') + '</div>' +
    '<div class="svk-blok"><div>📅 Teslimat: ' + tarihInp + '</div><div>🚚 Servis: ' + servisSel + '</div><div>🏬 Nokta: ' + esc(s.satisNoktasi || '—') + '</div>' +
    tahsilatSatir + (kilitli ? '<div>🔒 Kilitli</div>' : '') +
    (s.teslimEdildi ? '<div>✅ Teslim alan: ' + esc(s.teslimEdildi.alan || '') + ' · ' + zamanTR(s.teslimEdildi.t) + '</div>' : '') + '</div>' +
    '<div class="svk-blok"><div class="svk-bhead"><b>Ürünler / Seri (' + tam + '/' + k.length + ')</b>' + taraBtn + '</div>' + kalemHtml + '</div>' +
    '<div class="svk-eylem">' + eylem + '</div>' + teslimBlok +
    '<div class="svk-eylem"><button class="svk-btn" data-act="depofisi">🖨️ Depo Fişi</button><button class="svk-btn" data-act="teslimbelge">🖨️ Teslimat Belgesi</button>' +
    '<button class="svk-btn" data-act="wa">💬 WhatsApp</button>' + (s.teslimEdildi ? '<button class="svk-btn" data-act="watesl">💬 Teşekkür Mesajı</button>' : '') + '</div>' +
    '<ul class="svk-log">' + log + '</ul></div></div>';
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
  const kay = o.querySelector('.svk-det, .svk-liste');
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

// ── Seri kaydı (elle giriş + kamera ortak) ─────────────────────
// Dönüş: { ok:true } | { ok:false, mesaj }
async function seriKaydet(s, n, val) {
  val = String(val || '').trim();
  const kalem = (s.kalemler || {})[n];
  if (!kalem) return { ok: false, mesaj: 'Kalem bulunamadı.' };
  if (val) {
    if (!seriState.seriToBilgi) await seriYukle(true);
    const dg = seriDogrula(val, kalem.kod);
    if (dg.dogrulanamadi) return { ok: false, mesaj: 'SERI_STOK doğrulama listesi yüklenemedi (bağlantı sorunu olabilir).\nListe yüklenmeden seri KAYDEDİLEMEZ — internet bağlantısını kontrol edip tekrar deneyin.' };
    if (!dg.ok) return { ok: false, mesaj: dg.mesaj };
    // Hızlı yerel ön kontrol (kesin ve atomik kontrol transaction içinde seriKullanim ile yapılır)
    if (kalemListe(s).some(k => String(k.n) !== String(n) && k.seriNo && normSeri(k.seriNo) === normSeri(val)))
      return { ok: false, mesaj: 'Bu seri bu sevkiyatın başka bir satırında zaten girilmiş.' };
    const cak = [...state.list.values()].find(o => o.saleNo !== s.saleNo && !o.iptal && kalemListe(o).some(k => k.seriNo && normSeri(k.seriNo) === normSeri(val)));
    if (cak) return { ok: false, mesaj: 'Bu seri/barkod sistemde zaten kullanılmış (' + cak.saleNo + ' · ' + cak.musteri + ').' };
  }
  let hata = null;
  const kod = kalem.kod;
  const ok = await guncelle(s, sunucu => {
    if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış; seri değiştirilemez.' };
    if (sunucu.kilitli) return { hata: 'Bu sevkiyat az önce kilitlendi; seri değiştirilemez.' };
    const k = (sunucu.kalemler || {})[n];
    if (!k) return { hata: 'Kalem bulunamadı.' };
    const eski = k.seriNo ? normSeri(k.seriNo) : '';
    const yeni = val ? normSeri(val) : '';
    return {
      yaz: { ['kalemler.' + n + '.seriNo']: val, ['kalemler.' + n + '.seriGerekliDegil']: false },
      seriEkle: yeni ? [{ seri: yeni, n, kod }] : [],
      seriSil: eski && eski !== yeni ? [eski] : []
    };
  }, val ? 'seri_girildi' : 'seri_silindi', 'kalem ' + (Number(n) + 1), { hata: m => { hata = m; } });
  return ok ? { ok: true } : { ok: false, mesaj: hata || 'Kaydedilemedi.' };
}

// Kameradan gelen kod: seri sahibi ürüne göre ilk boş satıra otomatik eşlenir (sıra önemli değil)
async function seriKodIsle(kod) {
  let s = aktif();
  if (!s) return { ok: false, mesaj: '⛔ Sevkiyat açık değil', bitti: true };
  if (s.kilitli || s.kapali) return { ok: false, mesaj: '⛔ Bu sevkiyat kilitli/kapalı — seri girilemez', bitti: true };
  if (!seriState.seriToBilgi) await seriYukle(true);
  if (!seriState.seriToBilgi) return { ok: false, mesaj: '⛔ SERI_STOK listesi yüklenemedi (bağlantı?)' };
  const val = kod.trim();
  const bilgi = seriSahibi(val);
  if (!bilgi) return { ok: false, mesaj: '⛔ ' + val + ' — SERI_STOK listesinde bulunamadı' };
  if (!(bilgi.kalan > 0)) return { ok: false, mesaj: '⛔ ' + val + ' — stok çıkışı yapılmış görünüyor (Kalan: ' + bilgi.kalan + ')' };
  const kl = kalemListe(s);
  const zaten = kl.find(k => k.seriNo && normSeri(k.seriNo) === normSeri(val));
  if (zaten) return { ok: false, mesaj: '⚠️ Bu seri zaten ' + (zaten.n + 1) + '. satırda girilmiş' };
  const hedef = kl.find(k => !k.seriGerekliDegil && !(k.seriNo && String(k.seriNo).trim()) && String(k.kod) === String(bilgi.kod));
  if (!hedef) return { ok: false, mesaj: '⛔ ' + val + ' — “' + B().urunAdi(bilgi.kod) + '” ürününe ait; bu sevkiyatta bu ürün için boş satır yok' };
  const r = await seriKaydet(s, hedef.n, val);
  s = aktif();
  if (!r.ok) return { ok: false, mesaj: '⛔ ' + String(r.mesaj || 'Kaydedilemedi').split('\n')[0] };
  if (s) detayCiz(s);
  return { ok: true, mesaj: '✅ ' + (hedef.n + 1) + '. ' + hedef.urun + ' → ' + val, bitti: s ? kalemListe(s).every(kalemTamam) : true, siradaki: s ? siradakiMetin(s) : '' };
}
function taraBaslat() {
  const s = aktif(); if (!s) return;
  kameraTara({
    siradaki: () => siradakiMetin(aktif() || s),
    onKod: seriKodIsle,
    onKapat: () => { const g = aktif(); if (g) detayCiz(g); }
  });
}

// ── Olay yönetimi ──────────────────────────────────────────────
const aktif = () => state.acik && state.list.get(state.acik);
const yenidenCiz = () => { const s = aktif(); return s ? detayCiz(s) : listeCiz(); };

async function tikla(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const s = aktif();
  if (act === 'kapat') return kapat();
  if (act === 'geri') { state.acik = null; return listeCiz(); }
  if (act === 'yenile') {
    el.textContent = '…';
    try { await yukle(true); if (state.filtre === 'kapali') await gecmisYukle(true); yerelSayimiYansit(); } catch (er) { await window.ayAlert('Yenilenemedi: ' + (er.message || er)); }
    return yenidenCiz();
  }
  if (act === 'filtre') {
    state.filtre = el.dataset.k;
    if (state.filtre === 'kapali' || state.filtre === 'serisiz') { try { await gecmisYukle(false); } catch (er) { console.warn(er); } }
    return listeCiz();
  }
  if (act === 'detay') { state.acik = el.dataset.id; taslakSifirla(state.acik); return detayCiz(state.list.get(state.acik)); }
  if (act === 'liste') {
    const t = el.dataset.t, bg = bugun();
    const liste = [...state.list.values()].filter(x => !x.kapali && (x.teslimTarihi === t || (t === bg && x.teslimTarihi < t)) && (!state.servis || x.atananServis === state.servis));
    return listeAc(liste, t);
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
  if (act === 'kilitle') {
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış.' };
      if (sunucu.kilitli) return { hata: 'Bu sevkiyat az önce başka biri tarafından kilitlendi.' };
      if (durumHesapla(sunucu) !== 'depoda_hazir') return { hata: 'Kilitlemek için tüm ürünlere seri girilmeli (başka bir cihazda değişmiş olabilir).' };
      return { yaz: { kilitli: true } };
    }, 'kilitlendi');
    return yenidenCiz();
  } else if (act === 'kilitac') {
    if (!yonetici()) return;
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış.' };
      if (!sunucu.kilitli) return { hata: 'Sevkiyat zaten kilitli değil.' };
      if (sunucu.servisTeslim) return { hata: 'Servise teslim edilmiş; kilit açılamaz.' };
      return { yaz: { kilitli: false } };
    }, 'kilit_acildi');
    return yenidenCiz();
  } else if (act === 'servise') {
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış.' };
      if (!sunucu.kilitli) return { hata: 'Önce kilitlenmeli.' };
      if (sunucu.servisTeslim) return { hata: 'Zaten servise teslim edilmiş.' };
      return { yaz: { servisTeslim: { t: Date.now(), u: eposta() } } };
    }, 'servise_teslim', s.atananServis || '');
    return yenidenCiz();
  } else if (act === 'tahsilat') {
    if (!(await window.ayConfirm(tl(s.tahsilatTutari) + ' tahsil edildi olarak işaretlensin mi?'))) return;
    await guncelle(s, sunucu => sunucu.tahsilatAlindi ? { hata: 'Tahsilat zaten işaretlenmiş.' }
      : { yaz: { tahsilatAlindi: { t: Date.now(), u: eposta(), tutar: Number(sunucu.tahsilatTutari) || 0 } } }, 'tahsilat_alindi', tl(s.tahsilatTutari));
    return yenidenCiz();
  } else if (act === 'teslim') {
    const alan = (($('svk-alan') || {}).value || '').trim();
    if (!alan) return window.ayAlert('Teslim alan kişinin adını yazınız.');
    if (Number(s.tahsilatTutari) > 0 && !s.tahsilatAlindi &&
        !(await window.ayConfirm('Teslimde tahsil edilecek ' + tl(s.tahsilatTutari) + ' henüz “alındı” işaretlenmedi. Yine de teslim edilsin mi?'))) return;
    const veri = { t: Date.now(), u: eposta(), alan };
    if (taslak.imzaVar && taslak.imza) veri.imza = taslak.imza;
    const ok = await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat zaten kapanmış (teslim edilmiş veya iptal).' };
      if (!sunucu.kilitli) return { hata: 'Sevkiyat kilitli değil.' };
      if (!(sunucu.servisTeslim || sunucu.atananServis === 'Müşteriye Teslim')) return { hata: 'Önce servise teslim edilmeli.' };
      return { yaz: { teslimEdildi: veri } };
    }, 'teslim_edildi', alan);
    if (ok) taslakSifirla(s.saleNo);
    return yenidenCiz();
  } else if (act === 'iptal') {
    if (!yonetici() || !(await window.ayConfirm('Bu sevkiyat iptal edilsin mi?'))) return;
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat zaten kapanmış.' };
      // iptalde bu sevkiyatın seri kilitleri serbest bırakılır
      const seriler = kalemListe(sunucu).filter(k => k.seriNo && String(k.seriNo).trim()).map(k => normSeri(k.seriNo));
      return { yaz: { iptal: true }, seriSil: seriler };
    }, 'iptal');
    return yenidenCiz();
  }
}

async function degisti(e) {
  const t = e.target;
  if (t.id === 'svk-fservis') { state.servis = t.value; return listeCiz(); }
  const s = aktif();
  if (!s || !depoYetkili() || s.kapali) return;
  if (t.classList.contains('svk-seri')) {
    const n = t.dataset.n, val = t.value.trim();
    const once = String((s.kalemler[n] || {}).seriNo || '').trim();
    if (val === once || s.kilitli) return;
    const ilerlet = t.dataset.enter === '1';
    const r = await seriKaydet(s, n, val);
    if (!r.ok) { await window.ayAlert(r.mesaj || 'Kaydedilemedi.'); return yenidenCiz(); }
    yenidenCiz();
    if (ilerlet && val) sonrakiBosaOdaklan(n);
  } else if (t.classList.contains('svk-sz')) {
    const n = t.dataset.n, isaret = t.checked;
    const kalem = (s.kalemler || {})[n] || {};
    await guncelle(s, sunucu => {
      if (sunucu.kapali) return { hata: 'Sevkiyat kapanmış.' };
      if (sunucu.kilitli) return { hata: 'Bu sevkiyat az önce kilitlendi; değiştirilemez.' };
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

// ── Yönetici araçları ──────────────────────────────────────────
let yetimListe = [];
function yonetimCiz() {
  if (!yonetici()) return;
  kok().innerHTML =
    '<div class="svk-panel"><div class="svk-head"><span><button class="svk-btn" data-act="geri">← Liste</button></span><b>🛠 Yönetici Araçları</b><span></span></div><div class="svk-det">' +
    '<div class="svk-blok"><b>Sevkiyat kaydı olmayan satışlar</b><p class="svk-not">Son 14 gündeki satış belgeleri taranır (≤150 + ≤300 okuma). ' +
    'Sevkiyat kaydı yazılamamış (cihaz kaybı, depolama temizliği vb.) satışları yakalar.</p>' +
    '<button class="svk-btn ana" data-act="yetim">Tara</button><div id="svk-yetim"></div></div>' +
    '<div class="svk-blok"><b>Seri kilitlerini eşitle (bir kerelik)</b><p class="svk-not">V10\'da girilmiş serileri “tek kullanım” kilidine aktarır (son 500 sevkiyat). ' +
    'Çakışan (aynı seri iki sevkiyatta) kayıtlar listelenir.</p>' +
    '<button class="svk-btn" data-act="esitle">Çalıştır</button><div id="svk-esitle"></div></div></div></div>';
}
async function yetimTara(btn) {
  const out = $('svk-yetim'); btn.disabled = true; out.textContent = 'Taranıyor…';
  try {
    yetimListe = await yetimSatislar(14);
    out.innerHTML = yetimListe.length
      ? yetimListe.map(x => '<div class="svk-yetim"><span><b>' + esc(x.id) + '</b> · ' + esc(String(x.custName || '').replace(/&amp;/g, '&')) + ' · ' + esc((x.ts || '').slice(0, 10)) + '</span>' +
          '<button class="svk-btn" data-act="yetimac" data-id="' + esc(x.id) + '">Sevkiyat aç</button></div>').join('')
      : '✅ Sevkiyat kaydı olmayan satış yok.';
  } catch (er) { out.textContent = 'Hata: ' + (er.message || er); }
  btn.disabled = false;
}
async function yetimAc(id, btn) {
  const sale = yetimListe.find(x => x.id === id); if (!sale) return;
  if (!(await window.ayConfirm(id + ' için bugünün tarihiyle sevkiyat kaydı açılsın mı? (Tarih/servis sonradan düzenlenebilir.)'))) return;
  btn.disabled = true;
  olusturKayit(sale, { tarih: bugun(), saat: '', servis: '', nokta: '', tahsilat: 0, yetim: true }, sale.not || '');
  btn.textContent = '✓ açıldı';
}
async function esitleCalistir(btn) {
  if (!(await window.ayConfirm('Son 500 sevkiyat okunacak ve her seri için bir kilit belgesi yazılacak. Devam edilsin mi?'))) return;
  const out = $('svk-esitle'); btn.disabled = true; out.textContent = 'Çalışıyor…';
  try {
    const r = await seriKilitleriniEsitle();
    out.innerHTML = '✅ ' + r.yazilan + ' seri kilidi yazıldı.' + (r.cakisan.length
      ? '<br>⚠️ Çakışan seriler (elle kontrol edin):<br>' + r.cakisan.map(c => esc(c.seri) + ' → ' + esc(c.satislar.join(', '))).join('<br>') : '');
  } catch (er) { out.textContent = 'Hata: ' + (er.message || er); }
  btn.disabled = false;
}

// ── Yeni sevkiyat sayacı (hafif sorgu, onSnapshot yok) ─────────
let sonSayim = null, sonKontrol = 0;
function rozetGuncelle(n) {
  const r = $('svk-tab-rozet'); if (!r) return;
  r.textContent = n > 99 ? '99+' : String(n);
  r.style.display = n > 0 ? 'flex' : 'none';
}
function yerelSayimiYansit() { // liste zaten çekildiyse ek okuma yapmadan sayacı güncelle
  if (!depoYetkili()) return;
  const n = [...state.list.values()].filter(s => !s.kapali && durumHesapla(s) === 'barkod_bekliyor').length;
  sonSayim = n; sonKontrol = Date.now(); rozetGuncelle(n);
}
async function sayimKontrol() {
  if (document.hidden || !depoYetkili()) return;
  if (Date.now() - sonKontrol < SAYIM_MS - 5000) return;
  sonKontrol = Date.now();
  try {
    const n = await yeniIsSayisi();
    if (sonSayim !== null && n > sonSayim) {
      toast('🚚 Yeni sevkiyat bekliyor (' + n + ' adet barkod bekleyen)', [['Aç', ac]]);
      try { if (navigator.vibrate) navigator.vibrate([80, 40, 80]); } catch (e) {}
    }
    sonSayim = n; rozetGuncelle(n);
  } catch (e) { console.warn('sayim:', e); }
}

// ── Stil (style.css'i şişirmemek için modülden enjekte) ─────────
function stilEkle() {
  if ($('svk-style')) return;
  const st = document.createElement('style'); st.id = 'svk-style';
  st.textContent =
    '.svk-overlay{display:none;position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.45);align-items:stretch;justify-content:center}' +
    '.svk-panel{background:var(--bg,#F5F6F8);width:100%;max-width:760px;display:flex;flex-direction:column;overflow:hidden}' +
    '.svk-head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 14px;background:var(--surface,#fff);border-bottom:1px solid var(--border,#DDE1EA);padding-top:max(12px,env(safe-area-inset-top))}' +
    '.svk-tools{display:flex;gap:8px;padding:10px 12px 4px}.svk-tools input{flex:1}.svk-tools input,.svk-tools select,.svk-det input,.svk-det select{padding:8px;border:1px solid var(--border-2,#C9CDD8);border-radius:8px;font-size:.85rem;background:var(--surface,#fff)}' +
    '.svk-chips{display:flex;gap:6px;padding:6px 12px;overflow-x:auto}.svk-chip{white-space:nowrap;padding:6px 11px;border-radius:99px;border:1px solid var(--border-2,#C9CDD8);background:var(--surface,#fff);font-size:.75rem;cursor:pointer}' +
    '.svk-chip.on{background:var(--black,#1C1C1E);color:#fff;border-color:var(--black,#1C1C1E)}.svk-chip i{font-style:normal;opacity:.7;margin-left:3px}' +
    '.svk-liste,.svk-det{flex:1;overflow-y:auto;padding:10px 12px;padding-bottom:max(16px,env(safe-area-inset-bottom))}' +
    '.svk-kart,.svk-blok{background:var(--surface,#fff);border:1px solid var(--border,#DDE1EA);border-radius:12px;padding:11px 12px;margin-bottom:9px}.svk-kart{cursor:pointer}' +
    '.svk-r1{display:flex;justify-content:space-between;gap:8px;align-items:center}.svk-r2{font-size:.74rem;color:var(--text-2,#52525B);margin:3px 0 6px}' +
    '.svk-r3{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:.76rem;color:var(--text-2,#52525B)}.svk-tah{color:#B45309;font-weight:700}' +
    '.svk-rozet{font-size:.68rem;font-weight:700;padding:3px 8px;border-radius:99px;white-space:nowrap}' +
    '.svk-btn{padding:7px 12px;border:1px solid var(--border-2,#C9CDD8);background:var(--surface,#fff);border-radius:8px;font-size:.8rem;font-weight:600;cursor:pointer;margin-left:6px}' +
    '.svk-btn.ana{background:var(--red,#D01F2E);color:#fff;border-color:var(--red,#D01F2E)}.svk-btn.tehlike{color:#D01F2E}.svk-btn:disabled{opacity:.5}' +
    '.svk-eylem{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;align-items:center}.svk-eylem .svk-btn{margin-left:0}' +
    '.svk-gunbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}.svk-gunbar .svk-btn{margin-left:0}' +
    '.svk-gbas{font-weight:800;font-size:.9rem;margin:12px 0 4px}.svk-gbas i{font-style:normal;font-weight:600;color:var(--text-3,#A1A1AA);margin-left:4px}' +
    '.svk-sbas{font-size:.76rem;font-weight:700;color:var(--text-2,#52525B);margin:8px 0 4px}' +
    '.svk-bhead{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap}.svk-bhead .svk-btn{margin-left:0}' +
    '.svk-kalem{padding:8px 0;border-top:1px solid var(--border,#DDE1EA)}.svk-kad{font-size:.84rem;font-weight:600}.svk-kad small{color:var(--text-3,#A1A1AA);font-weight:400}' +
    '.svk-kin{display:flex;gap:6px;align-items:center;margin-top:5px}.svk-kin .svk-seri{flex:1;font-family:monospace}.svk-serisiz{font-size:.72rem;white-space:nowrap}' +
    '.svk-ipucu{font-size:.7rem;color:#B45309;margin-top:4px}.svk-not{font-size:.74rem;color:var(--text-2,#52525B);margin:4px 0 8px}' +
    '.svk-tam{width:100%;box-sizing:border-box;margin:6px 0}.svk-imzaEtiket{font-size:.72rem;color:var(--text-2,#52525B);margin-top:4px}' +
    '.svk-imza{width:100%;max-width:340px;height:120px;border:1px dashed var(--border-2,#C9CDD8);border-radius:8px;background:#fff;touch-action:none;display:block;margin:4px 0 8px}' +
    '.svk-yetim{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--border,#DDE1EA);font-size:.78rem}' +
    '.svk-log{font-size:.7rem;color:var(--text-3,#A1A1AA);padding-left:16px;max-height:200px;overflow-y:auto}.svk-bos{padding:30px;text-align:center;color:var(--text-2,#52525B)}' +
    '.svk-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(74px + env(safe-area-inset-bottom));z-index:9500;background:#1C1C1E;color:#fff;padding:10px 14px;border-radius:12px;display:flex;gap:10px;align-items:center;font-size:.8rem;max-width:92vw;box-shadow:0 8px 24px rgba(0,0,0,.3)}' +
    '.svk-toast button{background:#fff;color:#1C1C1E;border:0;border-radius:8px;padding:6px 10px;font-weight:700;cursor:pointer}.svk-toast .svk-x{background:transparent;color:#fff}' +
    '.svk-pill{position:fixed;left:10px;bottom:calc(78px + env(safe-area-inset-bottom));z-index:9400;background:#B45309;color:#fff;font-size:.72rem;font-weight:700;padding:6px 11px;border-radius:99px;box-shadow:0 4px 14px rgba(0,0,0,.25)}' +
    '#tab-btn-sevkiyat{position:relative}.svk-tabrozet{position:absolute;top:2px;right:10px;min-width:15px;height:15px;padding:0 3px;border-radius:99px;background:var(--red,#D01F2E);color:#fff;font-size:.55rem;font-weight:900;align-items:center;justify-content:center;display:none}' +
    '.svk-cam{position:fixed;inset:0;z-index:9600;background:#000;display:flex;flex-direction:column;align-items:center}.svk-cam video{flex:1;width:100%;object-fit:cover}' +
    // Hedef kare — sevkiyat-kamera.js'teki _CROP ile aynı yüzdeler (x:10% y:38% w:80% h:24%).
    '.svk-cam-frame{position:absolute;left:10%;top:38%;width:80%;height:24%;z-index:1;pointer-events:none}' +
    '.svk-cam-frame i{position:absolute;width:26px;height:26px;border:3px solid #fff}' +
    '.svk-cam-frame i.tl{top:0;left:0;border-right:0;border-bottom:0}' +
    '.svk-cam-frame i.tr{top:0;right:0;border-left:0;border-bottom:0}' +
    '.svk-cam-frame i.bl{bottom:0;left:0;border-right:0;border-top:0}' +
    '.svk-cam-frame i.br{bottom:0;right:0;border-left:0;border-top:0}' +
    '.svk-cam-top{position:absolute;top:max(10px,env(safe-area-inset-top));left:10px;right:10px;display:flex;justify-content:space-between;align-items:center;gap:8px;z-index:2}' +
    '.svk-cam-sira{color:#fff;font-size:.82rem;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,.8);background:rgba(0,0,0,.45);padding:5px 10px;border-radius:8px;max-width:60%}' +
    '.svk-cam-sira:empty{display:none}.svk-cam-araclar{display:flex;gap:6px;margin-left:auto}' +
    '.svk-cam-araclar button{padding:8px 12px;border:0;border-radius:8px;font-weight:700;background:rgba(255,255,255,.92)}.svk-cam-araclar .on{background:#FDE047}' +
    '.svk-cam-durum{position:absolute;left:10px;right:10px;bottom:max(112px,calc(env(safe-area-inset-bottom) + 100px));z-index:2;color:#fff;font-size:.9rem;font-weight:700;text-align:center;padding:9px 12px;border-radius:10px;background:rgba(0,0,0,.5)}' +
    '.svk-cam-durum:empty{display:none}.svk-cam-durum.ok{background:rgba(22,163,74,.92)}.svk-cam-durum.hata{background:rgba(208,31,46,.94)}.svk-cam-durum.bekle{background:rgba(29,78,216,.9)}' +
    '.svk-cam-shot{position:absolute;bottom:max(64px,calc(env(safe-area-inset-bottom) + 52px));left:50%;transform:translateX(-50%);padding:10px 20px;border:0;border-radius:99px;font-weight:700;background:#D01F2E;color:#fff;z-index:2;font-size:.82rem}' +
    '.svk-cam-hint{position:absolute;bottom:max(24px,env(safe-area-inset-bottom));left:0;right:0;text-align:center;color:#fff;font-size:.8rem;opacity:.85;text-shadow:0 1px 3px rgba(0,0,0,.6);z-index:1}';
  document.head.appendChild(st);
}

// ── Başlat ─────────────────────────────────────────────────────
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
