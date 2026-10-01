// ═══════════════════════════════════════════════════════════════
//  Rev 10.3 DÜZELTMELERİ:
//  · Kamera: hint'siz varsayılan okuyucu yerine TRY_HARDER + geniş format
//    listesi (CODE_128/39/93/CODABAR/EAN/UPC/ITF/QR/DATA_MATRIX) ve daha
//    sık tarama (150ms) eklendi. Gerçek hatalar artık console'a yazılıyor
//    (önceden sessizce yutuluyordu — teşhis imkânsızdı). Otomatik döngü
//    yakalayamazsa kullanılabilecek manuel "📸 Kare Yakala" tek-atış
//    modu eklendi.
//  · SERI_STOK doğrulama listesi yüklenemezse ESKİDEN "doğrulanmadan
//    kaydedildi" diye UYARIP yine de kaydediyordu — bu, kontrolün amacını
//    (yanlış seriyi FİZİKEN engellemek) boşa çıkarıyordu. Artık liste
//    yoksa bir kez daha yüklemeyi zorluyor; yine yoksa seri KAYDEDİLMİYOR.
//
// ═══════════════════════════════════════════════════════════════
//  Rev 10.4 DÜZELTMESİ:
//  · "Kare Yakala" artık (Chrome/Android'de) ImageCapture API ile GERÇEK
//    yüksek çözünürlüklü bir fotoğraf çekip onu deniyor — video akışı
//    genelde ~720p'de kalıyor, yoğun/uzun barkodlar (18 haneli Code128
//    gibi) o çözünürlükte okunamayabiliyor. ImageCapture yoksa/başarısız
//    olursa eskisi gibi video karesine geri düşüyor.
//  · Sürekli tarama akışının ideal çözünürlüğü 1280x720 -> 1920x1080.
//  · <video autoplay> kaldırıldı — ZXing zaten play() çağırıyordu, ikisi
//    birlikte "already playing" konsol uyarısı üretiyordu (zararsız ama
//    gürültülüydü).
//  · Not: SERI_STOK "yüklenemedi" hatası bir bug değildi — data/seriler.json
//    henüz push edilmemiş (404 dönüyor), liste olmadan seri KAYDEDİLEMEZ
//    kuralı beklendiği gibi çalıştı.
//
// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — sevkiyat.js  (Rev 10.0 — Sevkiyat Çağrısı modülü)
// ═══════════════════════════════════════════════════════════════
//  app.js'i şişirmemek için AYRI dosya. app.js ile tek temas noktası:
//    · window._svkBridge  (app.js'in verdiği Firestore/yardımcı köprüsü)
//    · finalizeAksiyon() 'satis' bloğundaki 2 küçük kanca
//      (formOku → doğrulama, olustur → kayıt)
//
//  AKIŞ:  Satış Belgesi oluştur → teslimat bilgisi → sevkiyatlar/{SAT-xxx}
//         → depo/takip ekranında barkod-seri girişi → kilitle → servise
//         teslim → müşteriye teslim.  Belgeler: Depo Fişi + Teslimat Belgesi.
//
//  MALİYET DİSİPLİNİ (V9 dersi): HİÇ onSnapshot YOK. Liste ekran açılınca
//  getDocs ile çekilir, 60 sn TTL, "Yenile" ile zorlanır. Kendi yazmalarımız
//  yerel state'e de işlenir → yazdıktan sonra tekrar okuma yapılmaz.
//
//  FIRESTORE KURALI: 'sevkiyatlar' koleksiyonu için, 'sales' koleksiyonunda
//  kullandığınız kuralın aynısı konsoldan eklenmelidir (yoksa yazma reddedilir).
// ═══════════════════════════════════════════════════════════════

// ── Yapılandırma (gerekirse buradan değiştirin) ────────────────
const COL = 'sevkiyatlar';
const TTL_MS = 60 * 1000;
const SERVISLER = ['Sm-Tv', 'Sm-Be', 'Sm-Kl', 'Sm-İlçe', 'Vs-Barel', 'Vs-Can', 'Vs-İlçe', 'Müşteriye Teslim', 'Aygün Sevk'];
const SATIS_NOKTALARI = ['SP', 'NF', 'VŞ', 'SÇ', 'Diğer'];
const DURUMLAR = {
  barkod_bekliyor: { label: 'Barkod Bekliyor',       ico: '🔴', renk: '#D01F2E', bg: '#FEF2F2' },
  hazirlaniyor:    { label: 'Hazırlanıyor',          ico: '🟡', renk: '#B45309', bg: '#FFFBEB' },
  depoda_hazir:    { label: 'Depoda Hazır',          ico: '🟢', renk: '#16A34A', bg: '#F0FDF4' },
  serviste:        { label: 'Servise Teslim Edildi', ico: '🚚', renk: '#1D4ED8', bg: '#EFF6FF' },
  teslim_edildi:   { label: 'Teslim Edildi',         ico: '✅', renk: '#52525B', bg: '#F0F1F4' },
  iptal:           { label: 'İptal',                 ico: '⛔', renk: '#A1A1AA', bg: '#F0F1F4' }
};
const FILTRELER = [
  ['aktif', 'Aktif'], ['barkod_bekliyor', 'Barkod Bekliyor'], ['hazirlaniyor', 'Hazırlanıyor'],
  ['depoda_hazir', 'Depoda Hazır'], ['serviste', 'Serviste'], ['kapali', 'Teslim Edilenler']
];

// ── Yardımcılar ────────────────────────────────────────────────
const B = () => window._svkBridge;
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// finalizeAksiyon müşteri adını zaten HTML-escape ederek veriyor → çift escape olmasın
const dec = s => String(s == null ? '' : s).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const $ = id => document.getElementById(id);
const bugun = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const tarihTR = iso => { const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : (iso || '—'); };
const zamanTR = ms => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const kullanici = () => (B() && B().user && B().user()) || {};
const rol = () => (kullanici().Rol || '').toLowerCase();
const eposta = () => kullanici().Email || '';
// Yetki: admin + destek (depo) barkod/kilit/teslim işler; satış personeli sadece kendi satışlarını izler.
const yonetici = () => rol() === 'admin';
const depoYetkili = () => rol() === 'admin' || rol() === 'destek';

// Kalemler map olarak saklanır ({"0":{...}}) → noktalı yol güncellemesi (kalemler.0.seriNo)
// iki kişi farklı kalemi aynı anda girse de birbirini ezmez.
const kalemListe = s => Object.keys(s.kalemler || {}).sort((a, b) => a - b)
  .map(k => ({ ...s.kalemler[k], n: Number(k) }));
const kalemTamam = k => !!k.seriGerekliDegil || !!(k.seriNo && String(k.seriNo).trim());

function durumHesapla(s) {
  if (s.iptal) return 'iptal';
  if (s.teslimEdildi) return 'teslim_edildi';
  if (s.servisTeslim) return 'serviste';
  const k = kalemListe(s);
  const tamam = k.filter(kalemTamam).length;
  if (tamam === 0) return 'barkod_bekliyor';
  if (tamam < k.length) return 'hazirlaniyor';
  return 'depoda_hazir';
}
function setPath(obj, path, val) {
  const p = path.split('.');
  let o = obj;
  for (let i = 0; i < p.length - 1; i++) { if (o[p[i]] == null || typeof o[p[i]] !== 'object') o[p[i]] = {}; o = o[p[i]]; }
  o[p[p.length - 1]] = val;
}
const logGir = (a, ek) => ({ t: Date.now(), u: eposta(), a, ...(ek ? { e: ek } : {}) });

// ── State ──────────────────────────────────────────────────────
const state = { list: new Map(), aktifTs: 0, gecmisTs: 0, filtre: 'aktif', ara: '', servis: '', acik: null };

// ── SERI_STOK referans verisi (Excel push → data/seriler.json) ──
// ✅ Rev 10.1: girilen serinin, o kalemin Stok Kodu'na (kalem.kod, aynı
// URUNLER!H ile eşleşir) gerçekten ait olup olmadığını buradan doğruluyoruz.
// Statik bir JSON dosyası — Firestore okuması DEĞİL, maliyete etkisi yok.
// Format: { "data": [ { "kod": "NK24M5070BG/UR", "seri": "B1KD79PJ600078" }, ... ] }
const SERI_TTL_MS = 10 * 60 * 1000;
const seriState = { seriToKod: null, kodToSeriler: null, ts: 0, hata: false };
const normSeri = s => String(s || '').trim().toUpperCase();

async function seriYukle(force) {
  if (!force && seriState.seriToKod && Date.now() - seriState.ts < SERI_TTL_MS) return;
  try {
    const r = await fetch(B().dataUrl('seriler.json') + '?v=' + Date.now(), { cache: 'no-store' });
    const j = await r.json();
    const rows = Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : []);
    const s2k = new Map(), k2s = new Map();
    rows.forEach(row => {
      const kod = String(row.kod ?? row.Kod ?? row['Stok Kodu'] ?? '').trim();
      const seri = normSeri(row.seri ?? row.Seri ?? row['Çeki Takip No'] ?? '');
      if (!kod || !seri) return;
      s2k.set(seri, kod);
      if (!k2s.has(kod)) k2s.set(kod, []);
      k2s.get(kod).push(seri);
    });
    seriState.seriToKod = s2k; seriState.kodToSeriler = k2s;
    seriState.ts = Date.now(); seriState.hata = false;
  } catch (e) {
    console.warn('seriYukle:', e);
    seriState.hata = true; // liste yoksa doğrulamayı atlayacağız, engellemeyeceğiz
  }
}
// Dönüş: { ok:true } | { ok:false, mesaj } | { ok:true, dogrulanamadi:true } (liste yoksa)
function seriDogrula(seri, kod) {
  if (!seriState.seriToKod) return { ok: true, dogrulanamadi: true };
  const s = normSeri(seri);
  const sahibi = seriState.seriToKod.get(s);
  if (sahibi === undefined) {
    return { ok: false, mesaj: 'Bu seri (' + seri + ') SERI_STOK listesinde bulunamadı. Barkodu kontrol edin veya listenin güncel olduğundan emin olun.' };
  }
  if (String(sahibi) !== String(kod)) {
    const beklenen = (seriState.kodToSeriler.get(kod) || []);
    const beklenenTxt = beklenen.length ? beklenen.join(', ') : '(SERI_STOK\'ta bu ürüne ait kayıtlı seri yok)';
    return { ok: false, mesaj: 'Bu seri "' + B().urunAdi(sahibi) + '" ürününe ait, bu satır için geçersiz.\nBeklenen seri: ' + beklenenTxt };
  }
  return { ok: true };
}

async function yukle(force) {
  const b = B();
  const c = b.collection(b.db, COL);
  if (!depoYetkili()) {
    // Satış personeli: sadece kendi kayıtları (tek sorgu, eşitlik → composite index gerekmez)
    if (!force && Date.now() - state.aktifTs < TTL_MS) return;
    const snap = await b.getDocs(b.query(c, b.where('satici', '==', eposta()), b.limit(300)));
    state.list.clear();
    snap.docs.forEach(d => state.list.set(d.id, { ...d.data(), saleNo: d.id }));
    state.aktifTs = state.gecmisTs = Date.now();
    return;
  }
  if (!force && Date.now() - state.aktifTs < TTL_MS) return;
  const snap = await b.getDocs(b.query(c, b.where('kapali', '==', false), b.limit(300)));
  for (const [k, v] of state.list) if (!v.kapali) state.list.delete(k);
  snap.docs.forEach(d => state.list.set(d.id, { ...d.data(), saleNo: d.id }));
  state.aktifTs = Date.now();
}
async function gecmisYukle(force) {
  if (!depoYetkili()) return; // satış personelinde zaten hepsi yüklü
  if (!force && Date.now() - state.gecmisTs < TTL_MS) return;
  const b = B();
  const snap = await b.getDocs(b.query(b.collection(b.db, COL), b.orderBy('ts', 'desc'), b.limit(80)));
  snap.docs.forEach(d => state.list.set(d.id, { ...d.data(), saleNo: d.id }));
  state.gecmisTs = Date.now();
}

async function guncelle(s, yaz, aksiyon, ek) {
  const b = B();
  for (const k of Object.keys(yaz)) setPath(s, k, yaz[k]);
  s.durum = durumHesapla(s);
  s.kapali = !!(s.teslimEdildi || s.iptal);
  s.log = [...(s.log || []), logGir(aksiyon, ek)].slice(-40);
  try {
    await b.updateDoc(b.doc(b.db, COL, s.saleNo), { ...yaz, durum: s.durum, kapali: s.kapali, log: s.log });
    return true;
  } catch (e) {
    console.error('sevkiyat guncelle:', e);
    await window.ayAlert('Kayıt başarısız: ' + (e.message || e) + '\nListe yenileniyor.');
    try { await yukle(true); } catch (e2) {}
    return false;
  }
}

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
    '</div>';
  host.appendChild(div);
  $('svk-tarih').value = bugun();
}
function formSifirla() {
  if ($('svk-tarih')) $('svk-tarih').value = bugun();
  ['svk-saat', 'svk-servis', 'svk-nokta'].forEach(id => { if ($(id)) $(id).value = ''; });
}
// app.js finalizeAksiyon satış bloğu bunu doğrulama için çağırır
function formOku() {
  const tarih = ($('svk-tarih') || {}).value || '';
  if (!tarih) return { ok: false, hata: 'Teslimat tarihini seçiniz.' };
  if (tarih < bugun()) return { ok: false, hata: 'Teslimat tarihi geçmişte olamaz.' };
  return { ok: true, veri: {
    tarih, saat: ($('svk-saat') || {}).value || '',
    servis: ($('svk-servis') || {}).value || '', nokta: ($('svk-nokta') || {}).value || ''
  } };
}

// ── Kayıt oluştur (satış tamamlanınca) ─────────────────────────
async function olustur(sale, v, not) {
  const b = B();
  const now = Date.now();
  const kalemler = {};
  (sale.urunler || []).forEach((i, n) => {
    kalemler[String(n)] = { urun: i.urun || '', kod: i.kod || '', seriNo: '', seriGerekliDegil: false };
  });
  const kayit = {
    saleNo: sale.id, ts: now, createdAt: new Date(now).toISOString(),
    musteri: dec(sale.custName), telefon: sale.custPhone || '', telefon2: sale.custPhone2 || '',
    adres: sale.address || '', satici: sale.user || eposta(),
    satisNoktasi: v.nokta || '', teslimTarihi: v.tarih, teslimSaati: v.saat || '',
    atananServis: v.servis || '', not: dec(not || ''),
    kalemler, kilitli: false, servisTeslim: null, teslimEdildi: null, iptal: false,
    durum: 'barkod_bekliyor', kapali: false, log: [logGir('olusturuldu')]
  };
  try {
    await b.setDoc(b.doc(b.db, COL, sale.id), kayit);
    state.list.set(sale.id, kayit);
    formSifirla();
    toast('🚚 Sevkiyat kaydı açıldı: <b>' + esc(sale.id) + '</b>', [['Depo Fişi', () => belgeAc('depo', kayit)]]);
    return kayit;
  } catch (e) {
    console.error('sevkiyat olustur:', e);
    toast('⚠️ Sevkiyat kaydı açılamadı (' + esc(sale.id) + '). Ekrandan tekrar deneyin veya yöneticiye bildirin.', []);
    return null;
  }
}

// ── Toast ──────────────────────────────────────────────────────
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

// ── Belgeler (Depo Fişi / Teslimat Belgesi) ────────────────────
function belgeAc(tip, s) { B().openPdf(belgeHtml(tip, s)); }
function belgeHtml(tip, s) {
  const depo = tip === 'depo';
  const baslik = depo ? 'DEPO SEVKİYAT FİŞİ' : 'TESLİMAT BELGESİ';
  const satirlar = kalemListe(s).map((k, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + esc(k.urun) + '</td><td>' + esc(k.kod) + '</td><td class="seri">' +
    (k.seriGerekliDegil ? '<i>Serisiz ürün</i>' : esc(k.seriNo || '')) + '</td>' +
    (depo ? '<td class="chk">☐</td>' : '') + '</tr>').join('');
  const bilgi = depo
    ? [['Satış No', s.saleNo], ['Müşteri', s.musteri], ['Telefon', s.telefon], ['Teslimat', tarihTR(s.teslimTarihi) + ' ' + (s.teslimSaati || '')],
       ['Servis', s.atananServis || 'Belirlenmedi'], ['Satış Noktası', s.satisNoktasi || '—'], ['Not', s.not || '—']]
    : [['Satış No', s.saleNo], ['Müşteri', s.musteri], ['Telefon', s.telefon], ['Adres', s.adres || '—'],
       ['Teslimat', tarihTR(s.teslimTarihi) + ' ' + (s.teslimSaati || '')]];
  const alt = depo
    ? '<div class="imza"><div>Hazırlayan (Depo)<span></span></div><div>Teslim Alan (Servis)<span></span></div></div>'
    : '<p class="kabul">Yukarıda cinsi, seri numarası belirtilen ürünleri eksiksiz ve çalışır durumda teslim aldım.</p>' +
      '<div class="imza"><div>Teslim Alan Ad Soyad<span></span></div><div>Tarih / İmza<span></span></div></div>';
  return '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>' + baslik + ' ' + esc(s.saleNo) + '</title><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#1c1c1e;margin:24px;font-size:13px}' +
    'h1{font-size:18px;margin:0 0 2px}.sub{color:#71717a;font-size:11px;margin-bottom:14px}' +
    '.bilgi{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin-bottom:14px}' +
    '.bilgi div{border-bottom:1px solid #e4e4e7;padding:3px 0}.bilgi b{display:inline-block;min-width:86px;color:#52525b}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:18px}th,td{border:1px solid #d4d4d8;padding:7px 8px;text-align:left}' +
    'th{background:#f4f4f5;font-size:11px}td.seri{font-family:monospace;min-width:150px}td.chk{width:34px;text-align:center;font-size:16px}' +
    '.imza{display:flex;gap:40px;margin-top:34px}.imza div{flex:1;font-size:11px;color:#52525b}.imza span{display:block;border-bottom:1px solid #1c1c1e;height:34px}' +
    '.kabul{font-size:11px;color:#52525b}.pbtn{position:fixed;top:10px;right:10px;padding:8px 16px;border:0;border-radius:6px;background:#D01F2E;color:#fff;font-weight:700;cursor:pointer}' +
    '@media print{.pbtn{display:none}body{margin:10mm}}</style></head><body>' +
    '<button class="pbtn" onclick="window.print()">Yazdır</button>' +
    '<h1>AYGÜN AVM — ' + baslik + '</h1><div class="sub">Düzenlenme: ' + esc(new Date().toLocaleString('tr-TR')) + '</div>' +
    '<div class="bilgi">' + bilgi.map(([a, b]) => '<div><b>' + esc(a) + '</b>' + esc(b) + '</div>').join('') + '</div>' +
    '<table><thead><tr><th>#</th><th>Ürün</th><th>Kod</th><th>Seri / Barkod</th>' + (depo ? '<th>✓</th>' : '') + '</tr></thead><tbody>' +
    satirlar + '</tbody></table>' + alt + '</body></html>';
}
function waAc(s) {
  const msg = 'Sn ' + s.musteri + ',\nAygün AVM siparişiniz (' + s.saleNo + ') ' + tarihTR(s.teslimTarihi) +
    (s.teslimSaati ? ' ' + s.teslimSaati : '') + ' tarihinde teslim edilecektir.\nBilgilerinize sunar, iyi günler dileriz.';
  window.open('https://wa.me/9' + s.telefon + '?text=' + encodeURIComponent(msg), '_blank');
}

// ── Kamera ile barkod okuma ──────────────────────────────────────
// ✅ Rev 10.1: eskiden window.BarcodeDetector kullanıyordu — bu API
// sadece Chrome/Android'de var, Safari (iOS/macOS dahil) ve çoğu
// tarayıcıda HİÇ yok. O yüzden kamera "okuma yapmıyordu". ZXing-js'e
// geçildi: canvas tabanlı, tüm tarayıcılarda (Safari dahil) çalışır.
async function kameraTara(cb) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    await window.ayAlert('Bu cihaz/tarayıcı kamera erişimini desteklemiyor. El terminali/klavye ile girin.'); return;
  }
  if (!window.ZXing) {
    await window.ayAlert('Barkod okuyucu kütüphanesi yüklenemedi (bağlantı sorunu olabilir). El terminali/klavye ile girin.'); return;
  }
  const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat, NotFoundException } = window.ZXing;
  const ov = document.createElement('div'); ov.className = 'svk-cam';
  ov.innerHTML =
    '<video playsinline muted></video>' +
    '<button class="svk-cam-close">Kapat ✕</button>' +
    '<button class="svk-cam-shot">📸 Kare Yakala</button>' +
    '<div class="svk-cam-hint">Barkodu çerçeveye getirin — otomatik bulunmazsa "Kare Yakala"ya basın</div>';
  document.body.appendChild(ov);
  const video = ov.querySelector('video');
  // ✅ Rev 10.3: eskiden hint'siz (varsayılan) bir okuyucu kullanıyordu.
  // Şimdi TRY_HARDER + geniş format listesi açıkça veriliyor (ürün
  // barkodları genelde CODE_128/EAN_13/UPC-A oluyor) ve tarama aralığı
  // sıklaştırıldı (150ms). Ayrıca gerçek hatalar artık console'a yazılıyor
  // (önceki sürüm HER hatayı sessizce yutuyordu — teşhis imkânsızdı).
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.CODABAR,
    BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
    BarcodeFormat.ITF, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX
  ]);
  const reader = new BrowserMultiFormatReader(hints, 150);
  let kapandi = false;
  const kapat = () => {
    if (kapandi) return; kapandi = true;
    try { reader.reset(); } catch (e) {}
    ov.remove();
  };
  ov.querySelector('.svk-cam-close').onclick = kapat;
  // Manuel tek-kare deneme: otomatik döngü bir sebeple (odak/ışık/cihaz
  // uyumsuzluğu) yakalayamazsa, kullanıcı doğru anı kendi seçip zorlayabilir.
  // ✅ Rev 10.4: video akışı çoğu telefonda 720p civarında düşük çözünürlüklü
  // — yoğun/uzun barkodlar (18 haneli Code128 gibi) bu çözünürlükte
  // okunamayabiliyor, telefonun fotoğraf modu çok daha yüksek çözünürlük
  // yakalayabilse bile. ImageCapture destekleniyorsa (Chrome/Android) önce
  // GERÇEK yüksek çözünürlüklü bir fotoğraf çekip onu deniyoruz; olmazsa
  // video karesine geri düşüyoruz.
  ov.querySelector('.svk-cam-shot').onclick = async () => {
    if (kapandi) return;
    const track = video.srcObject && video.srcObject.getVideoTracks && video.srcObject.getVideoTracks()[0];
    if (track && window.ImageCapture) {
      let url;
      try {
        const cap = new window.ImageCapture(track);
        const blob = await cap.takePhoto();
        url = URL.createObjectURL(blob);
        const sonuc = await reader.decodeFromImageUrl(url);
        URL.revokeObjectURL(url);
        kapat(); cb(sonuc.getText()); return;
      } catch (e) {
        if (url) URL.revokeObjectURL(url);
        console.warn('yüksek çözünürlük kare:', e && e.name, e && e.message);
        // devam et, aşağıdaki video-karesi yedeğini dene
      }
    }
    try {
      const sonuc = reader.decode(video);
      kapat(); cb(sonuc.getText());
    } catch (e) {
      console.warn('kare yakala (video):', e && e.name, e && e.message);
      window.ayAlert('Barkod bu karede okunamadı. Kamerayı barkoda yaklaştırıp/odaklayıp tekrar deneyin.').catch(() => {});
    }
  };
  try {
    await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
      video,
      (result, err) => {
        if (kapandi) return;
        if (result) { const v = result.getText(); kapat(); cb(v); return; }
        if (err && !(err instanceof NotFoundException)) {
          // NotFoundException her karede normal (henüz barkod görünmüyor).
          // Başka bir hata tekrarlıyorsa teşhis için konsola düşsün.
          console.warn('barkod tarama:', err.name, err.message);
        }
      }
    );
  } catch (e) {
    kapat();
    await window.ayAlert('Kamera açılamadı: ' + (e.message || e) + '\nEl terminali/klavye ile girebilirsiniz.');
  }
}

// ── Takip ekranı ───────────────────────────────────────────────
function kok() {
  let o = $('svk-overlay');
  if (o) return o;
  o = document.createElement('div'); o.id = 'svk-overlay'; o.className = 'svk-overlay';
  o.addEventListener('click', tikla);
  o.addEventListener('change', degisti);
  o.addEventListener('input', e => { if (e.target.id === 'svk-ara') { state.ara = e.target.value; const l = o.querySelector('.svk-liste'); if (l) l.innerHTML = kartlarHtml(); } });
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
  listeCiz();
}
function kapat() { const o = $('svk-overlay'); if (o) o.style.display = 'none'; document.body.style.overflow = ''; }

function goruntulenen() {
  const q = state.ara.trim().toLowerCase();
  return [...state.list.values()].map(s => ({ ...s, durum: durumHesapla(s) })).filter(s => {
    if (state.filtre === 'aktif' ? s.kapali : state.filtre === 'kapali' ? !s.kapali : s.durum !== state.filtre) return false;
    if (state.servis && s.atananServis !== state.servis) return false;
    if (!q) return true;
    const hay = [s.saleNo, s.musteri, s.telefon, s.adres, ...kalemListe(s).map(k => k.seriNo + ' ' + k.urun)].join(' ').toLowerCase();
    return hay.includes(q);
  }).sort((a, b) => (a.teslimTarihi + (a.teslimSaati || '')).localeCompare(b.teslimTarihi + (b.teslimSaati || '')));
}
function rozet(d) { const x = DURUMLAR[d] || DURUMLAR.barkod_bekliyor; return '<span class="svk-rozet" style="color:' + x.renk + ';background:' + x.bg + '">' + x.ico + ' ' + x.label + '</span>'; }

function kartlarHtml() {
  const list = goruntulenen();
  const bugunStr = bugun();
  return list.map(s => {
    const k = kalemListe(s), tam = k.filter(kalemTamam).length;
    const gecikti = !s.kapali && s.teslimTarihi < bugunStr;
    return '<div class="svk-kart" data-act="detay" data-id="' + esc(s.saleNo) + '">' +
      '<div class="svk-r1"><b>' + esc(s.musteri) + '</b>' + rozet(s.durum) + '</div>' +
      '<div class="svk-r2">' + esc(s.saleNo) + ' · ' + esc(s.telefon) + '</div>' +
      '<div class="svk-r3"><span' + (gecikti ? ' style="color:#D01F2E;font-weight:700"' : '') + '>📅 ' + tarihTR(s.teslimTarihi) + ' ' + esc(s.teslimSaati || '') + (gecikti ? ' (gecikti)' : '') + '</span>' +
      '<span>🚚 ' + esc(s.atananServis || 'Servis atanmadı') + '</span><span>🏷️ ' + tam + '/' + k.length + ' barkod</span></div></div>';
  }).join('') || '<div class="svk-bos">Kayıt yok</div>';
}

function listeCiz() {
  const sayac = {};
  [...state.list.values()].forEach(s => { const d = durumHesapla(s); sayac[d] = (sayac[d] || 0) + 1; });
  kok().innerHTML =
    '<div class="svk-panel"><div class="svk-head"><b>🚚 Sevkiyat Takip</b>' +
    '<span><button class="svk-btn" data-act="yenile">↻ Yenile</button><button class="svk-btn" data-act="kapat">✕</button></span></div>' +
    '<div class="svk-tools"><input id="svk-ara" placeholder="Müşteri, telefon, satış no, seri no ara…" value="' + esc(state.ara) + '">' +
    '<select id="svk-fservis"><option value="">Tüm servisler</option>' + SERVISLER.map(x => '<option' + (state.servis === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' +
    '<div class="svk-chips">' + FILTRELER.map(([k, l]) => '<button class="svk-chip' + (state.filtre === k ? ' on' : '') + '" data-act="filtre" data-k="' + k + '">' + l +
      (sayac[k] ? ' <i>' + sayac[k] + '</i>' : '') + '</button>').join('') + '</div>' +
    '<div class="svk-liste">' + kartlarHtml() + '</div></div>';
}

function detayCiz(s) {
  const d = durumHesapla(s), k = kalemListe(s);
  const duz = depoYetkili() && !s.kapali;
  const kilitli = !!s.kilitli;
  const girilebilir = duz && !kilitli;
  const tam = k.filter(kalemTamam).length;
  const kalemHtml = k.map(x =>
    '<div class="svk-kalem"><div class="svk-kad">' + (x.n + 1) + '. ' + esc(x.urun) + ' <small>' + esc(x.kod) + '</small></div>' +
    '<div class="svk-kin"><input class="svk-seri" data-n="' + x.n + '" placeholder="Seri / barkod" value="' + esc(x.seriNo || '') + '"' + (girilebilir && !x.seriGerekliDegil ? '' : ' disabled') + '>' +
    (girilebilir && !x.seriGerekliDegil && navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? '<button class="svk-btn" data-act="tara" data-n="' + x.n + '">📷</button>' : '') +
    '<label class="svk-serisiz"><input type="checkbox" class="svk-sz" data-n="' + x.n + '"' + (x.seriGerekliDegil ? ' checked' : '') + (girilebilir ? '' : ' disabled') + '> serisiz</label>' +
    '<span>' + (kalemTamam(x) ? '✅' : '⬜') + '</span></div></div>').join('');
  const servisSel = duz
    ? '<select id="svk-d-servis"><option value="">Belirlenmedi</option>' + SERVISLER.map(x => '<option' + (s.atananServis === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>'
    : esc(s.atananServis || 'Belirlenmedi');
  const tarihInp = duz
    ? '<input type="date" id="svk-d-tarih" value="' + esc(s.teslimTarihi) + '"> <input type="time" id="svk-d-saat" value="' + esc(s.teslimSaati || '') + '">'
    : tarihTR(s.teslimTarihi) + ' ' + esc(s.teslimSaati || '');
  let eylem = '';
  if (depoYetkili() && !s.kapali) {
    if (!kilitli && d === 'depoda_hazir') eylem += '<button class="svk-btn ana" data-act="kilitle">🔒 Onayla ve Kilitle</button>';
    if (kilitli && yonetici() && !s.servisTeslim) eylem += '<button class="svk-btn" data-act="kilitac">🔓 Kilidi Aç</button>';
    if (kilitli && !s.servisTeslim && s.atananServis !== 'Müşteriye Teslim') eylem += '<button class="svk-btn ana" data-act="servise">🚚 Servise Teslim Et</button>';
    if (kilitli && (s.servisTeslim || s.atananServis === 'Müşteriye Teslim'))
      eylem += '<input id="svk-alan" placeholder="Teslim alan ad soyad"><button class="svk-btn ana" data-act="teslim">✅ Müşteriye Teslim Edildi</button>';
    if (yonetici()) eylem += '<button class="svk-btn tehlike" data-act="iptal">⛔ İptal Et</button>';
  }
  const log = (s.log || []).slice().reverse().slice(0, 8).map(l => '<li>' + zamanTR(l.t) + ' · ' + esc((l.u || '').split('@')[0]) + ' · ' + esc(l.a) + (l.e ? ' (' + esc(l.e) + ')' : '') + '</li>').join('');
  kok().innerHTML =
    '<div class="svk-panel"><div class="svk-head"><span><button class="svk-btn" data-act="geri">← Liste</button></span><b>' + esc(s.saleNo) + '</b>' + rozet(d) + '</div>' +
    '<div class="svk-det">' +
    '<div class="svk-blok"><b>' + esc(s.musteri) + '</b><br>📞 ' + esc(s.telefon) + (s.telefon2 ? ' / ' + esc(s.telefon2) : '') + '<br>📍 ' + esc(s.adres || '—') +
    (s.not ? '<br>📝 ' + esc(s.not) : '') + '</div>' +
    '<div class="svk-blok"><div>📅 Teslimat: ' + tarihInp + '</div><div>🚚 Servis: ' + servisSel + '</div><div>🏬 Nokta: ' + esc(s.satisNoktasi || '—') + '</div>' +
    (kilitli ? '<div>🔒 Kilitli</div>' : '') +
    (s.teslimEdildi ? '<div>✅ Teslim alan: ' + esc(s.teslimEdildi.alan || '') + ' · ' + zamanTR(s.teslimEdildi.t) + '</div>' : '') + '</div>' +
    '<div class="svk-blok"><b>Ürünler / Seri (' + tam + '/' + k.length + ')</b>' + kalemHtml + '</div>' +
    '<div class="svk-eylem">' + eylem + '</div>' +
    '<div class="svk-eylem"><button class="svk-btn" data-act="depofisi">🖨️ Depo Fişi</button><button class="svk-btn" data-act="teslimbelge">🖨️ Teslimat Belgesi</button>' +
    '<button class="svk-btn" data-act="wa">💬 WhatsApp</button></div>' +
    '<ul class="svk-log">' + log + '</ul></div></div>';
}

// ── Olay yönetimi ──────────────────────────────────────────────
const aktif = () => state.acik && state.list.get(state.acik);

async function tikla(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const s = aktif();
  if (act === 'kapat') return kapat();
  if (act === 'geri') { state.acik = null; return listeCiz(); }
  if (act === 'yenile') {
    el.textContent = '…';
    try { await yukle(true); if (state.filtre === 'kapali') await gecmisYukle(true); } catch (er) { await window.ayAlert('Yenilenemedi: ' + (er.message || er)); }
    return s ? detayCiz(s) : listeCiz();
  }
  if (act === 'filtre') {
    state.filtre = el.dataset.k;
    if (state.filtre === 'kapali') { try { await gecmisYukle(false); } catch (er) { console.warn(er); } }
    return listeCiz();
  }
  if (act === 'detay') { state.acik = el.dataset.id; return detayCiz(state.list.get(state.acik)); }
  if (!s) return;
  if (act === 'depofisi') return belgeAc('depo', s);
  if (act === 'teslimbelge') return belgeAc('teslim', s);
  if (act === 'wa') return waAc(s);
  if (act === 'tara') {
    const n = el.dataset.n;
    return kameraTara(v => { const i = kok().querySelector('.svk-seri[data-n="' + n + '"]'); if (i) { i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); } });
  }
  if (!depoYetkili()) return;
  if (act === 'kilitle') {
    if (durumHesapla(s) !== 'depoda_hazir') return window.ayAlert('Kilitlemek için tüm ürünlere barkod girilmeli.');
    if (await guncelle(s, { kilitli: true }, 'kilitlendi')) detayCiz(s);
  } else if (act === 'kilitac') {
    if (!yonetici()) return;
    if (await guncelle(s, { kilitli: false }, 'kilit_acildi')) detayCiz(s);
  } else if (act === 'servise') {
    if (await guncelle(s, { servisTeslim: { t: Date.now(), u: eposta() } }, 'servise_teslim', s.atananServis || '')) detayCiz(s);
  } else if (act === 'teslim') {
    const alan = ($('svk-alan') || {}).value || '';
    if (!alan.trim()) return window.ayAlert('Teslim alan kişinin adını yazınız.');
    if (await guncelle(s, { teslimEdildi: { t: Date.now(), u: eposta(), alan: alan.trim() } }, 'teslim_edildi', alan.trim())) detayCiz(s);
  } else if (act === 'iptal') {
    if (!yonetici() || !(await window.ayConfirm('Bu sevkiyat iptal edilsin mi?'))) return;
    if (await guncelle(s, { iptal: true }, 'iptal')) detayCiz(s);
  }
}

async function degisti(e) {
  const t = e.target;
  if (t.id === 'svk-fservis') { state.servis = t.value; return listeCiz(); }
  const s = aktif();
  if (!s || !depoYetkili() || s.kapali) return;
  if (t.classList.contains('svk-seri')) {
    const n = t.dataset.n, val = t.value.trim();
    if (s.kilitli) return;
    if (val) {
      // ✅ Rev 10.3: eskiden liste yüklenemezse "doğrulanmadan kaydedildi"
      // diye UYARIYIP yine de kaydediyordu — bu, kontrolün amacını
      // (yanlış seri girişini FİZİKEN engellemek) boşa çıkarıyordu. Artık
      // liste yoksa bir kez daha yüklemeyi zorluyor; yine yoksa KAYDETMİYOR.
      if (!seriState.seriToKod) await seriYukle(true);
      const dg = seriDogrula(val, s.kalemler[n].kod);
      if (dg.dogrulanamadi) {
        await window.ayAlert('SERI_STOK doğrulama listesi yüklenemedi (bağlantı sorunu olabilir).\nListe yüklenmeden seri KAYDEDİLEMEZ — internet bağlantısını kontrol edip tekrar deneyin.');
        t.value = (s.kalemler[n] || {}).seriNo || ''; return;
      }
      if (!dg.ok) {
        await window.ayAlert(dg.mesaj);
        t.value = (s.kalemler[n] || {}).seriNo || ''; return;
      }
      const cakisma = [...state.list.values()].find(o => o.saleNo !== s.saleNo && !o.iptal &&
        kalemListe(o).some(k => k.seriNo && k.seriNo.trim().toLowerCase() === val.toLowerCase()));
      const ayni = kalemListe(s).some(k => String(k.n) !== n && k.seriNo && k.seriNo.trim().toLowerCase() === val.toLowerCase());
      if (cakisma || ayni) {
        await window.ayAlert('Bu seri/barkod zaten kullanılmış' + (cakisma ? ' (' + cakisma.saleNo + ' · ' + cakisma.musteri + ')' : ' (bu sevkiyatta)') + '.');
        t.value = (s.kalemler[n] || {}).seriNo || ''; return;
      }
    }
    if (await guncelle(s, { ['kalemler.' + n + '.seriNo']: val }, 'seri_girildi', 'kalem ' + (Number(n) + 1))) detayCiz(s);
  } else if (t.classList.contains('svk-sz')) {
    const n = t.dataset.n;
    const yaz = { ['kalemler.' + n + '.seriGerekliDegil']: t.checked };
    if (t.checked) yaz['kalemler.' + n + '.seriNo'] = '';
    if (await guncelle(s, yaz, t.checked ? 'serisiz_isaretlendi' : 'serisiz_kaldirildi', 'kalem ' + (Number(n) + 1))) detayCiz(s);
  } else if (t.id === 'svk-d-servis') {
    await guncelle(s, { atananServis: t.value }, 'servis_atandi', t.value);
  } else if (t.id === 'svk-d-tarih' || t.id === 'svk-d-saat') {
    const tarih = ($('svk-d-tarih') || {}).value || s.teslimTarihi;
    if (!tarih) return;
    await guncelle(s, { teslimTarihi: tarih, teslimSaati: ($('svk-d-saat') || {}).value || '' }, 'teslimat_degisti', tarihTR(tarih));
  }
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
    '.svk-r3{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:.76rem;color:var(--text-2,#52525B)}' +
    '.svk-rozet{font-size:.68rem;font-weight:700;padding:3px 8px;border-radius:99px;white-space:nowrap}' +
    '.svk-btn{padding:7px 12px;border:1px solid var(--border-2,#C9CDD8);background:var(--surface,#fff);border-radius:8px;font-size:.8rem;font-weight:600;cursor:pointer;margin-left:6px}' +
    '.svk-btn.ana{background:var(--red,#D01F2E);color:#fff;border-color:var(--red,#D01F2E)}.svk-btn.tehlike{color:#D01F2E}' +
    '.svk-eylem{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;align-items:center}.svk-eylem .svk-btn{margin-left:0}' +
    '.svk-kalem{padding:8px 0;border-top:1px solid var(--border,#DDE1EA)}.svk-kad{font-size:.84rem;font-weight:600}.svk-kad small{color:var(--text-3,#A1A1AA);font-weight:400}' +
    '.svk-kin{display:flex;gap:6px;align-items:center;margin-top:5px}.svk-kin .svk-seri{flex:1;font-family:monospace}.svk-serisiz{font-size:.72rem;white-space:nowrap}' +
    '.svk-log{font-size:.7rem;color:var(--text-3,#A1A1AA);padding-left:16px}.svk-bos{padding:30px;text-align:center;color:var(--text-2,#52525B)}' +
    '.svk-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(74px + env(safe-area-inset-bottom));z-index:9500;background:#1C1C1E;color:#fff;padding:10px 14px;border-radius:12px;display:flex;gap:10px;align-items:center;font-size:.8rem;max-width:92vw;box-shadow:0 8px 24px rgba(0,0,0,.3)}' +
    '.svk-toast button{background:#fff;color:#1C1C1E;border:0;border-radius:8px;padding:6px 10px;font-weight:700;cursor:pointer}.svk-toast .svk-x{background:transparent;color:#fff}' +
    '.svk-cam{position:fixed;inset:0;z-index:9600;background:#000;display:flex;flex-direction:column;align-items:center}.svk-cam video{flex:1;width:100%;object-fit:cover}' +
    '.svk-cam-close{position:absolute;top:max(12px,env(safe-area-inset-top));right:12px;padding:8px 14px;border:0;border-radius:8px;font-weight:700;z-index:1}' +
    '.svk-cam-shot{position:absolute;bottom:max(64px,calc(env(safe-area-inset-bottom) + 52px));left:50%;transform:translateX(-50%);padding:12px 22px;border:0;border-radius:99px;font-weight:700;background:#D01F2E;color:#fff;z-index:1;font-size:.9rem}' +
    '.svk-cam-hint{position:absolute;bottom:max(24px,env(safe-area-inset-bottom));left:0;right:0;text-align:center;color:#fff;font-size:.8rem;opacity:.85;text-shadow:0 1px 3px rgba(0,0,0,.6)}';
  document.head.appendChild(st);
}

// ── Başlat ─────────────────────────────────────────────────────
function navEkle() {
  if ($('tab-btn-sevkiyat')) return;
  const ref = $('tab-btn-teklifler');
  if (!ref) return;
  const btn = document.createElement('button');
  btn.className = 'tab-btn'; btn.id = 'tab-btn-sevkiyat'; btn.style.display = 'flex';
  btn.innerHTML = '<span class="tab-icon">🚚</span><span class="tab-label">Sevkiyat</span>';
  btn.onclick = ac;
  ref.insertAdjacentElement('afterend', btn);
}
function init() { stilEkle(); formEnjekte(); navEkle(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

window.Sevkiyat = { ac, kapat, formOku, olustur, belgeAc, durumHesapla, seriYukle, seriDogrula };
