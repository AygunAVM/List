// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — sevkiyat-veri.js  (Rev 11.0 — veri / Firestore katmanı)
// ═══════════════════════════════════════════════════════════════
//  DOM'a dokunmaz (UI için `kancalar` üzerinden haber verir).
//
//  MALİYET DİSİPLİNİ: HİÇ onSnapshot YOK. Liste getDocs + 60 sn TTL.
//  Yazma maliyeti: her kritik işlem = 1 okuma (transaction içi tx.get).
//  Seri girişi = +1 okuma +1 yazma (seriKullanim kilidi). Bildirim sayacı
//  getCountFromServer (1000 eşleşmeye kadar 1 okuma).
//
//  FIRESTORE KURALI: 'sevkiyatlar' için kullandığınız kuralın AYNISI yeni
//  'seriKullanim' koleksiyonu için de konsoldan eklenmelidir.
// ═══════════════════════════════════════════════════════════════

export const COL = 'sevkiyatlar';
export const SERI_COL = 'seriKullanim';
export const TTL_MS = 60 * 1000;
// Rev 11.1: 'Müşteriye Teslim' artık servis değil, ayrı bir TESLİM TÜRÜ (teslimTuru: 'servis' | 'musteri')
// Tanımlar yönetici panelinden değiştirilebilir (meta/sevkiyatTanimlar). Diziler yerinde güncellenir → tüm içe aktarmalar yeni değeri görür.
export const VARSAYILAN_TANIM = {
  servisler: ['Sm-Tv', 'Sm-Be', 'Sm-Kl', 'Sm-İlçe', 'Vs-Barel', 'Vs-Can', 'Vs-İlçe', 'Aygün Sevk'],
  depolar: ['TÖ Depo', 'Nf Depo', 'Nf Mağaza', 'Sp Mağaza', 'Vş Mağaza', 'SÇ Mağaza'],
  noktalar: ['SP', 'NF', 'VŞ', 'SÇ', 'Diğer']
};
export const SERVISLER = [...VARSAYILAN_TANIM.servisler];   // eski (V11.15 öncesi) düz liste — yalnızca eski kayıt / tanım uyumu için
// V11.17: marka → servisler. Birden çok servisi olan markada ürün satırında isteğe bağlı servis seçimi çıkar.
export const MARKA_SERVIS = { Vestel: ['Barel', 'Can', 'Pazarcık'], Samsung: ['İl servisi', 'İlçe servisi'] };
const trK = x => String(x == null ? '' : x).trim().toLocaleLowerCase('tr');
export const markaServisleri = marka => { const k = trK(marka); if (!k) return []; const e = Object.keys(MARKA_SERVIS).find(m => trK(m) === k); return e ? MARKA_SERVIS[e].slice() : []; };
export const tumServisAdlari = () => { const g = []; Object.values(MARKA_SERVIS).forEach(l => l.forEach(x => { if (!g.includes(x)) g.push(x); })); return g; };
export const kalemMarka = k => { let m = String((k && k.marka) || '').trim(); if (!m) { const p = (B() && B().urunBul && B().urunBul(k && k.kod)) || null; m = p ? String(p['Marka'] || p.marka || '').trim() : ''; } return m; };
// Kayıttaki (servise giden ürünlerin) seçilmiş servis adları; eski kayıtta atananServis
export const servisAdlari = s => { const g = []; kalemListe(s).forEach(k => { if (kalemTur(s, k) === 'servis' && k.servis && !g.includes(k.servis)) g.push(k.servis); }); if (!g.length && s.atananServis) g.push(s.atananServis); return g; };
export const DEPOLAR = [...VARSAYILAN_TANIM.depolar];
export const SATIS_NOKTALARI = [...VARSAYILAN_TANIM.noktalar];
const TANIM_DOC = ['meta', 'sevkiyatTanimlar'], TANIM_LS = 'svk_tanimlar', TANIM_TTL = 30 * 60 * 1000;
export const tanimTemizle = a => { const g = []; (Array.isArray(a) ? a : []).forEach(x => { x = String(x == null ? '' : x).trim().replace(/\s+/g, ' ').slice(0, 40); if (x && !g.some(y => y.toLocaleLowerCase('tr') === x.toLocaleLowerCase('tr'))) g.push(x); }); return g.slice(0, 40); };
let NOKTA_PRIM = false;
// V12.3: Prim ayarındaki nokta listesi (kapanış noktaları) = satış noktaları. ayir (S-NF/V-NF gibi rapor bölünmeleri) mağaza değildir, listeye girmez.
export function noktaUygula(noktalar) {
  const ad = tanimTemizle((Array.isArray(noktalar) ? noktalar : []).map(n => n && n.ad));
  if (!ad.length) return;
  NOKTA_PRIM = true; SATIS_NOKTALARI.splice(0, SATIS_NOKTALARI.length, ...ad);
  try { if (window._primHarfUygula) window._primHarfUygula(noktalar); } catch (_e) { /* yoksay */ }
  tanimDegisti.forEach(f => { try { f(); } catch (_e) { /* yoksay */ } });
}
function tanimUygula(t) {
  if (!t) return;
  if (t.markaServis && typeof t.markaServis === 'object') {
    Object.keys(MARKA_SERVIS).forEach(k => delete MARKA_SERVIS[k]);
    Object.keys(t.markaServis).forEach(m => { const mm = String(m).trim().slice(0, 40), l = tanimTemizle(t.markaServis[m]); if (mm && l.length) MARKA_SERVIS[mm] = l; });
  }
  [['servisler', SERVISLER], ['depolar', DEPOLAR], ['noktalar', SATIS_NOKTALARI]].forEach(([k, dizi]) => {
    if (k === 'noktalar' && NOKTA_PRIM) return;   // V12.3: satış noktalarının tek kaynağı Admin → Prim → Kapanış noktaları
    const y = tanimTemizle(t[k]);
    if (y.length || Array.isArray(t[k])) dizi.splice(0, dizi.length, ...y);
  });
}
try { const o = JSON.parse(localStorage.getItem(TANIM_LS) || 'null'); if (o && o.veri) tanimUygula(o.veri); } catch (_e) { /* yoksay */ }
export const tanimDegisti = []; // dinleyiciler (form seçeneklerini yenilemek için)
try { window.PrimNoktaUygula = noktaUygula; if (window._primNoktalarBekleyen) noktaUygula(window._primNoktalarBekleyen); } catch (_e) { /* yoksay */ }
export async function tanimYukle(force) {
  try {
    const o = JSON.parse(localStorage.getItem(TANIM_LS) || 'null');
    if (!force && o && Date.now() - o.ts < TANIM_TTL) return;
    const b = B(); if (!b) return;
    const sn = await b.getDoc(b.doc(b.db, TANIM_DOC[0], TANIM_DOC[1]));
    const veri = sn.exists() ? sn.data() : null;
    if (veri) tanimUygula(veri);
    localStorage.setItem(TANIM_LS, JSON.stringify({ ts: Date.now(), veri: veri || null }));
    tanimDegisti.forEach(f => { try { f(); } catch (_e) { /* yoksay */ } });
  } catch (e) { console.warn('tanimYukle:', e); }
}
export async function tanimKaydet(yeni) {
  const b = B();
  const veri = { servisler: tanimTemizle(yeni.servisler), markaServis: yeni.markaServis || {}, depolar: tanimTemizle(yeni.depolar), noktalar: tanimTemizle(yeni.noktalar), guncelleyen: eposta(), ts: Date.now() };
  await b.setDoc(b.doc(b.db, TANIM_DOC[0], TANIM_DOC[1]), veri);
  tanimUygula(veri);
  try { localStorage.setItem(TANIM_LS, JSON.stringify({ ts: Date.now(), veri })); } catch (_e) { /* yoksay */ }
  tanimDegisti.forEach(f => { try { f(); } catch (_e) { /* yoksay */ } });
}
// Teslimat zaman dilimleri (saklanan değer = etiket metni; eski kayıtlardaki "14:30" gibi saatler de geçerli)
export const SAAT_DILIMLERI = ['Gün içinde', '12:00 öncesi', '12:00-15:00 arası', '15:00-17:00 arası', '17:00 sonrası'];
// Sıralama anahtarı: sabah → öğle → ikindi → akşam → "gün içinde"; belirli saat kendi yerine girer
export const saatSira = t => {
  t = String(t || '').trim();
  if (!t) return '9'; if (t === 'Gün içinde') return '8';
  if (t === '12:00 öncesi') return '0' + '11:59'; if (t === '12:00-15:00 arası') return '0' + '12:00';
  if (t === '15:00-17:00 arası') return '0' + '15:00'; if (t === '17:00 sonrası') return '0' + '17:00';
  return '0' + t;
};
export const DURUMLAR = {
  // Kırmızı yalnızca GECİKME ve hata için ayrılmıştır (durum renkleri kırmızı kullanmaz)
  // Not: depolanan anahtar 'barkod_bekliyor' korunur (Firestore sorguları/kayıtlar); yalnızca etiket değişti.
  barkod_bekliyor: { label: 'Seri Bekliyor',         renk: '#475569', bg: '#EEF2F6' },
  hazirlaniyor:    { label: 'Hazırlanıyor',          renk: '#B45309', bg: '#FFF4DB' },
  depoda_hazir:    { label: 'Depoda Hazır',          renk: '#15803D', bg: '#E6F6EC' },
  kismi:           { label: 'Kısmi Teslim',          renk: '#0F766E', bg: '#E0F5F2' },   // V11.11: ürünlerin bir bölümü teslim edildi, diğer bölüm bekliyor
  serviste:        { label: 'Servis Teslim',  renk: '#1D4ED8', bg: '#E7EFFE' },   // müşteri teslimi için durumEtiket() 'Müşteriye Teslim' döndürür
  teslim_edildi:   { label: 'Tamamlandı',            renk: '#374151', bg: '#E5E7EB' },
  iade:            { label: 'İade / Depoya Döndü',   renk: '#7C3AED', bg: '#F1EBFE' },
  iptal:           { label: 'İptal Edildi',          renk: '#6B7280', bg: '#F1F2F5' },
  silindi:         { label: 'Silindi',               renk: '#6B7280', bg: '#F1F2F5' }
};
export const FILTRELER = [
  ['aktif', 'Aktif'], ['barkod_bekliyor', 'Seri Bekliyor'], ['hazirlaniyor', 'Hazırlanıyor'],
  ['depoda_hazir', 'Depoda Hazır'], ['kismi', 'Kısmi Teslim'], ['serviste', 'Teslim Edilen'], ['teslim_edildi', 'Tamamlanan'], ['iade', 'İade'], ['iptal', 'İptal']
];
// Eski kayıtlarda teslimTuru yok: atananServis 'Müşteriye Teslim' ise müşteri teslimi sayılır
// Durum etiketi: teslim edilmiş kayıt, teslim şekline göre “Servis Teslim” / “Müşteriye Teslim” görünür
export const durumEtiket = (d, s) => (d === 'serviste' && s && gruplar(s).length === 1 && gruplar(s)[0] === 'musteri') ? 'Müşteriye Teslim' : ((DURUMLAR[d] || {}).label || d);
export const teslimTuru = s => s.teslimTuru || (s.atananServis === 'Müşteriye Teslim' ? 'musteri' : 'servis');
// ── V11.11: ÜRÜN BAZLI TESLİM ŞEKLİ ─────────────────────────────
// Her ürün satırının kendi teslim şekli vardır (kalem.teslimSekli: 'servis' | 'musteri'); yoksa kaydın teslimTuru'ne uyar.
// Aynı sevkiyat kaydında iki “teslim grubu” olabilir; her grubun kendi teslim kaydı (teslim alan, imza, zaman) vardır:
//   teslimler.servis / teslimler.musteri = { t, u, alan, imza? }
// Tüm gruplar teslim edilince eski alan 'servisTeslim' de yazılır (kapanış / çıkış doğrulama / raporlar bu alana dayanır).
export const kalemTur = (s, k) => (k && k.teslimSekli === 'musteri') ? 'musteri' : (k && k.teslimSekli === 'servis') ? 'servis' : teslimTuru(s);
export const TUR_AD = { servis: 'Servis yetkilisine teslim', musteri: 'Müşteriye teslim' };
export const TUR_KISA = { servis: 'Servis götürür', musteri: 'Müşteri alır' };
export function gruplar(s) { const t = new Set(kalemListe(s).map(k => kalemTur(s, k))); return ['servis', 'musteri'].filter(x => t.has(x)); }
// V11.21: ADET/ÜRÜN BAZLI KISMİ TESLİM — teslim edilen her ürün satırında kalem.teslim = { t, u, alan, imza? } bulunur.
// Bir grup, ancak (çıkarılmamış) tüm satırları teslim edilince “teslim edilmiş” sayılır; son teslim kaydı grubun kaydı olur.
export const kalemTeslimi = k => (k && k.teslim) || null;
export function grupTeslim(s, tur) {
  if (s.teslimler && s.teslimler[tur]) return s.teslimler[tur];
  if (s.kalemler) {   // satır bazlı teslimlerin hepsi tamamsa grup tamamdır (sanal kayıt = en son teslim)
    const gk = kalemListe(s).filter(x => kalemTur(s, x) === tur);
    if (gk.length && gk.every(x => x.teslim)) return gk.map(x => x.teslim).sort((a, b) => (b.t || 0) - (a.t || 0))[0];
  }
  if (s.teslimler) return null;
  return (s.servisTeslim && teslimTuru(s) === tur) ? s.servisTeslim : null;     // V11.10 ve öncesi: tek teslim kaydı
}
export const kalemKilitli = (s, k) => !!s.kapali || !!(k && k.teslim) || !!grupTeslim(s, kalemTur(s, k));
export const kismiTeslim = s => !s.servisTeslim && (gruplar(s).some(g => !!grupTeslim(s, g)) || kalemListe(s).some(x => x.teslim));
// Bir grubun teslim partileri (aynı anda teslim edilen ürünler tek parti): [{ te, kalemler:[...] }] — eski kayıtlarda tek parti
export function grupPartileri(s, tur) {
  const gk = kalemListe(s).filter(x => kalemTur(s, x) === tur), m = new Map();
  gk.filter(x => x.teslim).forEach(x => { const a = String(x.teslim.t); if (!m.has(a)) m.set(a, { te: x.teslim, kalemler: [] }); m.get(a).kalemler.push(x); });
  if (m.size) return [...m.values()].sort((a, b) => a.te.t - b.te.t);
  const te = grupTeslim(s, tur);
  return te ? [{ te, kalemler: gk }] : [];
}
export const hepsiTeslim = s => { const g = gruplar(s); return g.length > 0 && g.every(x => !!grupTeslim(s, x)); };
export const gecikmeGun = s => { // teslim günü geçmiş ve hâlâ açık ise kaç gün gecikti (yoksa 0)
  if (!s || s.kapali || !s.teslimTarihi) return 0;
  const [y, m, d] = String(s.teslimTarihi).split('-').map(Number);
  const [by, bm, bd] = bugun().split('-').map(Number);
  const fark = Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(y, m - 1, d)) / 864e5);
  return fark > 0 ? fark : 0;
};

// ── Yardımcılar ────────────────────────────────────────────────
export const B = () => window._svkBridge;
export const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// finalizeAksiyon müşteri adını zaten HTML-escape ederek veriyor → çift escape olmasın
export const dec = s => String(s == null ? '' : s).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const bugun = () => iso(new Date());
export const yarin = () => { const d = new Date(); d.setDate(d.getDate() + 1); return iso(d); };
export const tarihTR = t => { const p = String(t || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : (t || '—'); };
export const zamanTR = ms => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
// V11.63: kullanıcıya gösterilen SATIŞ NO (AYG…); iç kayıt kimliği (saleNo) eski kayıtlarda SAT-… kalır, ek 'satisNo' alanı atanır
// ── V11.65: yeni Satış No (14 karakter) kuralı — app.js "SATIŞ NO (V11.65)" bölümüyle AYNI olmalı (test/satis-no-testi.js karşılaştırır) ──
const SN_VERI = '0123456789ABCDEFGHJKLMNPRSTUVXY', SN_KONTROL = SN_VERI, SN_HARF_HEPSI = 'ABCDEFGHJKLMNPRSTUVXY';
export function satisNoKontrol(g13) {
  let t = 0; const x = String(g13);
  if (x.length !== 13) return '';
  for (let i = 0; i < 13; i++) { const v = SN_VERI.indexOf(x[i]); if (v < 0) return ''; t += (i + 1) * v; }
  return SN_KONTROL[t % 31];
}
const SN_ESKI = /^AYG[KTNE]\d{4}[0-9A-Z]{2}$/, SN_13 = /^AYG[A-HJ-NPR-VXY][KTNE]\d{6}[0-9A-HJ-NPR-VXY]{2}$/, SN_14 = /^AYG[A-HJ-NPR-VXY][KTNE]\d{6}[0-9A-HJ-NPR-VXY]{2}[0-9A-HJ-NPR-VXY]$/, SN_SON4 = /^\d[0-9A-HJ-NPR-VXY]{2}[0-9A-HJ-NPR-VXY]$/;
// Yazılan metni çözer. tur: 'yeni' (tam / kontrol harfsiz → no tam 14 karakter) · 'eski' (10 karakter) · 'son4' · 'hatali' (hata metni) · 'yok' (numara değil)
export function satisNoCoz(girdi) {
  let u = String(girdi == null ? '' : girdi).trim().replace(/İ/g, 'I').toLocaleUpperCase('en-US').replace(/[\s.\-_]+/g, '');
  if (u.startsWith('AYG')) {
    if (u.length === 10 && SN_ESKI.test(u)) return { tur: 'eski', no: u };
    const d = u.slice(0, 3) + u.slice(3).replace(/O/g, '0').replace(/I/g, '1');   // yeni biçimde O/I kullanılmaz: karışanlar düzeltilir
    if (d.length === 13 && SN_13.test(d)) return { tur: 'yeni', no: d + satisNoKontrol(d) };
    if (d.length === 14 && SN_14.test(d)) return satisNoKontrol(d.slice(0, 13)) === d[13] ? { tur: 'yeni', no: d }
      : { tur: 'hatali', hata: 'Satış numarası hatalı yazılmış: son (kontrol) harfi tutmuyor. Numarayı belgeden tekrar okuyup yazın.' };
    if (u.length >= 11) return { tur: 'hatali', hata: 'Satış numarası geçersiz görünüyor. Yeni numaralar 14 karakterdir (örn. AYGFE26111001X); eskiler 10 karakterdir (örn. AYGE101101).' };
    return { tur: 'eski', no: u };   // kısa/eksik: eski yol (bulunamazsa “kayıt yok”)
  }
  const d4 = u.replace(/O/g, '0').replace(/I/g, '1');
  if (SN_SON4.test(d4)) return { tur: 'son4', son4: d4 };
  return { tur: 'yok' };
}
// Son 4 karakterden (gün son hanesi + sıra + kontrol) olası tam numaralar: son `gun` günde, bilinen mağaza harfleri × ödeme harfleri; kontrol harfi tutmayanlar elenir
export function satisNoSon4Adaylar(son4, harfler, gun, simdi) {
  const out = [], pad = n => String(n).padStart(2, '0'), hl = (harfler && harfler.length ? harfler : SN_HARF_HEPSI.split('')), sira = son4.slice(1, 3);
  for (let i = 0; i < (gun || 60); i++) {
    const d = new Date((simdi || new Date()).getTime() - i * 86400000);
    if (String(d.getDate() % 10) !== son4[0]) continue;
    const t = pad(d.getFullYear() % 100) + pad(d.getMonth() + 1) + pad(d.getDate());
    for (const m of hl) for (const o of 'KTNE') { const g = 'AYG' + m + o + t + sira; if (satisNoKontrol(g) === son4[3]) out.push(g + son4[3]); }
  }
  return out;
}
export function magazaHarfListesi() {   // app.js'in yüklediği / yerel kopyadaki mağaza harfleri + X
  let h = {}; try { h = (window._magazaHarfleri && Object.keys(window._magazaHarfleri).length) ? window._magazaHarfleri : ((JSON.parse(localStorage.getItem('aygun_mharf') || 'null') || {}).harfler || {}); } catch (_e) { h = {}; }
  const l = [...new Set(Object.values(h).map(x => String(x).toUpperCase()).filter(x => x.length === 1))];
  return l.length ? [...l, 'X'] : [];   // bilinmiyorsa tüm harfler denenir
}
export const svkNo = s => String((s && (s.satisNo || s.saleNo)) || '');
export const tl = n => Number(n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) + ' ₺';

export const kullanici = () => (B() && B().user && B().user()) || {};
export const rol = () => (kullanici().Rol || '').toLowerCase();
export const eposta = () => kullanici().Email || '';
// Yetki: admin + destek (depo) barkod/kilit/teslim işler; satış personeli sadece kendi satışlarını izler.
// NOT: Bu kontroller istemci tarafındadır (Firebase Auth geçişi ertelendi).
export const yonetici = () => rol() === 'admin';
export const depoYetkili = () => rol() === 'admin' || rol() === 'destek';
// V11.32: mağazadan teslimat yapan satış personeli KENDİ satışında seri girer, ürün değiştirir ve ürün ekler.
// Teslim, tahsilat, iade, satır çıkarma ve seri kilidi/yönetici işlemleri depoYetkili'de kalır.
// V11.49: satış personeli, KENDİ satışında her zaman; BAŞKASININ satışında yalnız satışın yapıldığı GÜN (takvim günü) içinde, teslimden önceki süreçleri yapabilir.
// Ertesi günden itibaren yalnız satışı yapan + destek + yönetici. (Yalnız istemci tarafı kuralıdır.)
export const ayniGunSatis = s => { const t = Number(s && s.ts); if (!t) return false; const a = new Date(t), b = new Date(); return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };
export const seriYetkili = s => depoYetkili() || (rol() === 'satis' && !!s && !!eposta() && (String(s.satici || '').toLowerCase() === eposta().toLowerCase() || ayniGunSatis(s)));

// V11.37: yönetici dışı kullanıcıda kimlik / e-posta maskeli görünür (kopyala düğmesi tam bilgiyi bir kez verir)
export const maskeKimlik = k => {
  const v = String(k == null ? '' : k).replace(/\s/g, '');
  if (!v) return '';
  const sayi = /^\d+$/.test(v), bas = sayi ? 3 : 2, son = sayi ? 2 : 1;
  return v.length <= bas + son ? '*'.repeat(v.length) : v.slice(0, bas) + '*'.repeat(v.length - bas - son) + v.slice(-son);
};
export const maskeEposta = e => {
  const v = String(e == null ? '' : e).trim(), at = v.lastIndexOf('@');
  if (at < 1) return v ? '*'.repeat(Math.min(v.length, 8)) : '';
  const yerel = v.slice(0, at), alan = v.slice(at);
  return yerel.slice(0, 1) + '*'.repeat(Math.max(2, Math.min(yerel.length - 1, 6))) + alan;
};
// V11.37: satışı yapan personelin görünen adı (yeni kayıtlarda saticiAd; eski kayıtlarda e-postanın @ öncesi)
export const saticiAdi = s => String((s && s.saticiAd) || '').trim() || (String((s && s.satici) || '').trim() === '-' ? '' : String((s && s.satici) || '').split('@')[0]);   // V11.53: '-' = e-posta kaydedilememiş eski satış

// Kalemler map olarak saklanır ({"0":{...}}) → noktalı yol güncellemesi (kalemler.0.seriNo)
export const kalemListe = s => Object.keys(s.kalemler || {}).sort((a, b) => a - b)
  .map(k => { const x = { ...s.kalemler[k], n: Number(k) }; if (!String(x.urun || '').trim() || String(x.urun).trim() === String(x.kod || '').trim()) { const ad = B() && B().urunAdi ? B().urunAdi(x.kod) : ''; if (ad && ad !== x.kod) x.urun = ad; } return x; })   // V11.18: ürün adı yerine kod yazılmış eski kayıtlar ekranda ürün adıyla görünür
  .filter(k => !k.cikarildi);   // cikarildi: V11.2 "satırı çıkar" (soft)
// SERI KURALI (V11.2): ürün kodu seriler.json'da (Stok Kodu) varsa seri ZORUNLUDUR — serisiz çıkış yapılamaz.
// Kod listede yoksa seri gerekmez (satır otomatik tamam sayılır). Liste yüklenemediyse güvenli taraf: seri gerekir.
// Seri takibi: (1) ürün tablosunda SeriTakip sütunu varsa o (E/H); (2) ürün kodu seriler.json'da şu an VAR ya da daha önce görülmüş
// (kalıcı kayıt: stoğu biten seri takipli ürün “seri gerekmez” sanılmasın); (3) hiç görülmemişse seri gerekmez.
// V11.41: kod anahtarı = Excel "Aygün Kısa Kod" kuralı (SM… → ilk 7 + ✦ + 11. karakter, diğerleri ilk 9). Ürün tablosunda tam kod,
// seriler.json'da kısa kod olabilir (VC07R302MVR/TR ↔ VC07R302M); iki taraf da aynı anahtara indirgenir. Zaten kısa olan kod değişmez.
export function kodAnahtar(kod) {
  const x = String(kod == null ? '' : kod).trim();
  if (x.includes('✦')) return x;
  if (x.slice(0, 2).toUpperCase() === 'SM') return x.slice(0, 7) + '✦' + x.slice(10, 11);
  return x.slice(0, 9);
}
export const kodEs = (a, b) => { const x = String(a == null ? '' : a).trim(), y = String(b == null ? '' : b).trim(); return x === y || (!!x && kodAnahtar(x) === kodAnahtar(y)); };
export const hizmetKalemi = k => /^SIG-/i.test(String((k && k.kod) == null ? '' : k.kod).trim());   // V11.89: SC+ Sigorta hizmet kalemi (stoksuz: depo/seri istemez)
export function seriGerekir(kod) {
  const k = String(kod == null ? '' : kod).trim();
  if (/^SIG-/i.test(k)) return false;
  try {
    const p = B() && B().urunBul && B().urunBul(k), st = p && String(p.SeriTakip ?? p.seriTakip ?? '').trim().toUpperCase();
    if (st === 'E') return true; if (st === 'H') return false;
  } catch (_e) { /* yoksay */ }
  if (!seriState.kodlar) return true;
  const ka = kodAnahtar(k);
  return seriState.kodlar.has(k) || seriState.kodlar.has(ka) || seriState.bilinen.has(k) || seriState.bilinen.has(ka);
}
export const kalemSerisiz = k => !!k.seriGerekliDegil || !seriGerekir(k.kod);
export const kalemDepoEksik = s => !!s.depoZorunlu && kalemListe(s).some(k => !hizmetKalemi(k) && !String(k.depo || '').trim());
export const kalemTamam = k => !!(k.seriNo && String(k.seriNo).trim()) || kalemSerisiz(k);

export function durumHesapla(s) {
  if (s.silindi) return 'silindi';
  if (s.iptal) return 'iptal';
  if (s.iade) return 'iade';
  if (s.teslimEdildi) return 'teslim_edildi';
  if (s.servisTeslim) return 'serviste';
  if (kismiTeslim(s)) return 'kismi';
  const k = kalemListe(s);
  const tamam = k.filter(kalemTamam).length;
  if (tamam === 0) return 'barkod_bekliyor';
  if (tamam < k.length) return 'hazirlaniyor';
  return 'depoda_hazir';
}
export function setPath(obj, path, val) {
  const p = path.split('.');
  let o = obj;
  for (let i = 0; i < p.length - 1; i++) { if (o[p[i]] == null || typeof o[p[i]] !== 'object') o[p[i]] = {}; o = o[p[i]]; }
  o[p[p.length - 1]] = val;
}
export const logGir = (a, ek) => ({ t: Date.now(), u: eposta(), a, ...(ek ? { e: ek } : {}) });

// Sunucu tarafı kural ihlali / iş kuralı hatası (kullanıcıya olduğu gibi gösterilir)
export class SvkHata extends Error {
  // tur: 'yok' | 'yanlis' | 'cikis' | 'kullanilmis' | 'ayni_sevkiyat' | 'kilitli' | 'kapali' | 'liste' | 'genel'
  constructor(mesaj, tur, detay) { super(mesaj); this.tur = tur || 'genel'; this.detay = detay || {}; }
}

// UI'nın bağlandığı kancalar (veri katmanı DOM bilmez)
export const kancalar = { bekleyen: null, yazimHata: null, yazildi: null, uyari: null };

// ── State ──────────────────────────────────────────────────────
export const state = { list: new Map(), aktifTs: 0, gecmisTs: 0, filtre: 'aktif', ara: '', servis: '', acik: null, bekleyen: 0 };

// V11.58: sevkiyat ekranlarında Ad Soyad, adres, not, firma ünvanı, vergi dairesi (ve fatura adresi) TAMAMI BÜYÜK harf (Türkçe: i→İ, ı→I).
// Küçük harfle girilmiş eski kayıtlar da kayıt listeye girerken büyütülür (tek geçit: state.list.set).
export const BUYUK_ALANLAR = ['musteri', 'adres', 'not', 'firmaUnvan', 'vergiDairesi', 'faturaAdres'];
export const buyukYaz = x => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().toLocaleUpperCase('tr-TR');
export const buyutYaz = y => { const o = { ...y }; BUYUK_ALANLAR.forEach(f => { if (typeof o[f] === 'string' && o[f]) o[f] = buyukYaz(o[f]); }); return o; };   // yazılacak alan haritası
export function buyutKayit(v) {
  if (v && typeof v === 'object') BUYUK_ALANLAR.forEach(f => { if (typeof v[f] === 'string' && v[f]) v[f] = buyukYaz(v[f]); });
  return v;
}
{ const _set = Map.prototype.set; state.list.set = function (k, v) { return _set.call(this, k, buyutKayit(v)); }; }

// ═══ SERI_STOK referans verisi (Excel push → data/seriler.json) ═══
// Satır: { "Stok Kodu", "Stok Adı", "Çeki Takip No", "Kalan" } (ya da kod/seri/kalan)
// Statik JSON — Firestore okuması DEĞİL.
const SERI_TTL_MS = 10 * 60 * 1000;
// V11.24: talep modülünde yoldaki (depodan mağazaya giden) seriler: seri → {id,magaza,depo}
export const yoldaSeri = new Map();
export const seriState = { seriToBilgi: null, kodToSeriler: null, kodlar: null, ts: 0, hata: false, satir: 0, bilinen: new Set(), bilinenUzak: false };
// Kalıcı “seri takipli ürün kodları” kaydı: cihazlar arası tutarlılık için seriKullanim/__takipliKodlar belgesi (+ yerel yedek).
const KOD_BELGE = '__takipliKodlar', KOD_YEREL = 'svk_takipli_kodlar';
try { JSON.parse(localStorage.getItem(KOD_YEREL) || '[]').forEach(k => seriState.bilinen.add(String(k))); } catch (_e) { /* yoksay */ }
async function bilinenUzakYukle() {
  if (seriState.bilinenUzak) return;
  try {
    const b = B(), snap = await b.getDoc(b.doc(b.db, SERI_COL, KOD_BELGE));
    if (snap.exists()) (snap.data().kodlar || []).forEach(k => seriState.bilinen.add(String(k)));
    seriState.bilinenUzak = true;
  } catch (e) { console.warn('takipli kodlar okunamadı:', e); }
}
function bilinenKaydet(yeniler) {
  try { localStorage.setItem(KOD_YEREL, JSON.stringify([...seriState.bilinen])); } catch (_e) { /* yoksay */ }
  if (!yeniler.length || !depoYetkili()) return;
  try { const b = B(); b.setDoc(b.doc(b.db, SERI_COL, KOD_BELGE), { kodlar: b.arrayUnion(...yeniler), t: Date.now() }, { merge: true }).catch(e => console.warn('takipli kodlar yazılamadı:', e)); } catch (_e) { /* yoksay */ }
}
// Sevkiyat kayıtlarında seri girilmiş ürünlerin kodları da seri takiplidir
export function bilinenOgren() {
  const yeni = [];
  state.list.forEach(s => kalemListe(s).forEach(k => {
    const kod = String(k.kod || '').trim();
    if (kod && k.seriNo && String(k.seriNo).trim() && !seriState.bilinen.has(kodAnahtar(kod))) { seriState.bilinen.add(kodAnahtar(kod)); yeni.push(kodAnahtar(kod)); }
  }));
  if (yeni.length) bilinenKaydet(yeni);
}
export const normSeri = s => String(s || '').trim().toUpperCase();
export const seriDocId = s => encodeURIComponent(normSeri(s));

export async function seriYukle(force) {
  if (!force && seriState.seriToBilgi && Date.now() - seriState.ts < SERI_TTL_MS) return;
  try {
    // V11.21: koşullu istek (304) — dosya değişmediyse 350 KB inmez ve yeniden ayrıştırılmaz
    // V11.64: yavaş/asılı mobil bağlantıda 1 dk beklenmesin: 12 sn'de keser, bir kez daha dener
    const getir = async () => { const ac = typeof AbortController !== 'undefined' ? new AbortController() : null, t = ac ? setTimeout(() => ac.abort(), 12000) : 0; try { return await fetch(B().dataUrl('seriler.json'), { cache: 'no-cache', signal: ac ? ac.signal : undefined }); } finally { if (t) clearTimeout(t); } };
    let r; try { r = await getir(); } catch (_e1) { r = await getir(); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const imza = r.headers.get('etag') || r.headers.get('last-modified') || '';
    if (imza && imza === seriState.imza && seriState.seriToBilgi) { seriState.ts = Date.now(); seriState.hata = false; return; }
    const j = await r.json();
    const rows = Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : []);
    const s2b = new Map(), k2s = new Map(), kodlar = new Set();
    rows.forEach(row => {
      const kod = kodAnahtar(row.kod ?? row.Kod ?? row['Stok Kodu'] ?? '');
      const seri = normSeri(row.seri ?? row.Seri ?? row['Çeki Takip No'] ?? '');
      if (!kod || !seri) return;
      const kr = row.Kalan ?? row.kalan;
      const kalan = (kr === undefined || kr === null || kr === '') ? 1 : Number(kr);
      s2b.set(seri, { kod, kalan: Number.isFinite(kalan) ? kalan : 1 });
      kodlar.add(kod);
      if (kalan > 0) { if (!k2s.has(kod)) k2s.set(kod, []); k2s.get(kod).push(seri); }
    });
    await bilinenUzakYukle();
    const yeni = [...kodlar].filter(k => !seriState.bilinen.has(k));
    yeni.forEach(k => seriState.bilinen.add(k));
    if (yeni.length || !seriState.bilinenUzak) bilinenKaydet(yeni);
    seriState.seriToBilgi = s2b; seriState.kodToSeriler = k2s; seriState.kodlar = kodlar;
    seriState.ts = Date.now(); seriState.hata = false; seriState.satir = rows.length; seriState.imza = imza;
  } catch (e) {
    console.warn('seriYukle:', e);
    seriState.hata = true;
  }
}
export const seriSahibi = seri => (seriState.seriToBilgi && seriState.seriToBilgi.get(normSeri(seri))) || null;

// Çıkış doğrulama: seriler.json günlük olarak diğer programdan beslenir; çıkışı yapılan seri listeden düşer
// (ya da Kalan ≤ 0 olur). Her satır için: 'cikti' | 'stokta' | 'serisiz' | 'bilinmiyor' (liste yok/boş)
export function cikisDurumu(s) {
  const veriVar = !!seriState.seriToBilgi && seriState.satir > 0;
  const satirlar = kalemListe(s).map(k => {
    const seri = k.seriNo && String(k.seriNo).trim() ? normSeri(k.seriNo) : '';
    if (!seri) return { k, durum: kalemSerisiz(k) ? 'serisiz' : 'seri_yok', seri: '' };
    if (!veriVar) return { k, durum: 'bilinmiyor', seri };
    const b = seriState.seriToBilgi.get(seri);
    return { k, seri, durum: (!b || !(b.kalan > 0)) ? 'cikti' : 'stokta' };
  });
  const bekleyen = satirlar.filter(x => x.durum !== 'cikti' && x.durum !== 'serisiz').length;
  return { satirlar, veriVar, bekleyen, hazir: veriVar && bekleyen === 0 };
}


// Dönüş: { ok:true } | { ok:true, dogrulanamadi:true } | { ok:false, tur, mesaj, detay }
// tur: 'yok' (SERI_STOK'ta yok) | 'yanlis' (başka ürüne ait) | 'cikis' (Kalan=0)
export function seriDogrula(seri, kod) {
  if (!seriState.seriToBilgi) return { ok: true, dogrulanamadi: true };
  const bilgi = seriSahibi(seri);
  const ad = k => (B().urunAdi ? B().urunAdi(k) : k);
  if (!bilgi) {
    return { ok: false, tur: 'yok', detay: { seri },
      mesaj: 'Bu seri (' + seri + ') SERI_STOK listesinde bulunamadı. Barkodu kontrol edin veya listenin güncel olduğundan emin olun.' };
  }
  if (!kodEs(bilgi.kod, kod)) {
    const beklenen = (seriState.kodToSeriler.get(kodAnahtar(kod)) || []);
    return { ok: false, tur: 'yanlis',
      detay: { seri, bulunanKod: bilgi.kod, bulunanAd: ad(bilgi.kod), beklenenKod: String(kod), beklenenAd: ad(kod), ornekSeriler: beklenen.slice(0, 5), toplamSeri: beklenen.length },
      mesaj: 'Bu seri "' + ad(bilgi.kod) + '" ürününe ait, bu satır için geçersiz.' };
  }
  if (!(bilgi.kalan > 0)) {
    return { ok: false, tur: 'cikis', detay: { seri, kalan: bilgi.kalan, kod: String(kod), ad: ad(kod) },
      mesaj: 'Bu seri (' + seri + ') SERI_STOK listesinde stok çıkışı yapılmış görünüyor (Kalan: ' + bilgi.kalan + ').' };
  }
  const yd = yoldaSeri.get(normSeri(seri));
  if (yd) return { ok: false, tur: 'yolda', detay: { seri, magaza: yd.magaza, depo: yd.depo, talepId: yd.id },
    mesaj: 'Bu seri (' + seri + ') ' + yd.depo + ' → ' + yd.magaza + ' talebiyle yolda görünüyor.' };
  return { ok: true };
}

// ── Listeleme ──────────────────────────────────────────────────
export async function yukle(force) {
  const b = B();
  const c = b.collection(b.db, COL);
  // Rev 11.10: satış personeli de TÜM açık sevkiyatları görür. V11.49: önbellek herkes için 60 sn (eskiden personelde 5 dk: yeni satış geç görünüyordu)
  if (!force && Date.now() - state.aktifTs < TTL_MS) return;
  const snap = await b.getDocs(b.query(c, b.where('kapali', '==', false), b.limit(300)));
  for (const [k, v] of state.list) if (!v.kapali) state.list.delete(k);
  snap.docs.forEach(d => { const v = d.data(); if (!v.silindi) state.list.set(d.id, { ...v, saleNo: d.id }); });
  state.aktifTs = Date.now();
}
// Kapanmış kayıtlar: varsayılan son 7 gün; "30 gün" seçilirse daha geniş pencere. Okuma = pencere içindeki kayıt sayısı (üst sınırlı).
const GECMIS_AYAR = { 7: { gun: 14, lim: 300 }, 30: { gun: 45, lim: 800 } };
export async function gecmisYukle(force, pencere) {
  const w = pencere === 30 ? 30 : 7;
  state.gecmisTsW = state.gecmisTsW || {};
  if (!force && Date.now() - (state.gecmisTsW[w] || 0) < (depoYetkili() ? TTL_MS : 5 * TTL_MS)) return;
  const b = B(), a = GECMIS_AYAR[w];
  if (!depoYetkili()) {   // personel: yalnızca kendi kapanmış kayıtları (diğerleri “Müşteri sorgula” ile)
    const sn = await b.getDocs(b.query(b.collection(b.db, COL), b.where('satici', '==', eposta()), b.limit(300)));
    sn.docs.forEach(d => { const v = d.data(); if (!v.silindi) state.list.set(d.id, { ...v, saleNo: d.id }); });
    state.gecmisTs = state.gecmisTsW[w] = Date.now();
    return;
  }
  const snap = await b.getDocs(b.query(b.collection(b.db, COL), b.where('ts', '>=', Date.now() - a.gun * 864e5), b.orderBy('ts', 'desc'), b.limit(a.lim)));
  snap.docs.forEach(d => { const v = d.data(); if (!v.silindi) state.list.set(d.id, { ...v, saleNo: d.id }); });
  state.gecmisTs = state.gecmisTsW[w] = Date.now();
}
// Rapor: teslimat tarihi aralığı (t1/t2 'YYYY-AA-GG', dahil). Tek sorgu; en çok 1500 kayıt. Tüm kullanıcılar çağırabilir.
export async function aralikYukle(t1, t2) {
  const b = B();
  const snap = await b.getDocs(b.query(b.collection(b.db, COL), b.where('teslimTarihi', '>=', t1), b.where('teslimTarihi', '<=', t2), b.orderBy('teslimTarihi', 'asc'), b.limit(1500)));
  return snap.docs.map(d => ({ ...d.data(), saleNo: d.id })).filter(v => !v.silindi);
}
// Liste ekranı için tarih aralığı (arşiv görünümü): sonuçlar state.list'e eklenir; satış personeli yalnızca kendi kayıtlarını görür
export async function aralikListeyeYukle(t1, t2) {
  const liste = await aralikYukle(t1, t2);
  liste.forEach(v => { if (depoYetkili() || v.satici === eposta()) state.list.set(v.saleNo, v); });
  return liste.length;
}
// ── Müşteri sorgula (telefon / ad / satış no) ──────────────────
export const telNorm = t => { const d = String(t == null ? '' : t).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
export function telVaryant(d) {
  const a = d.slice(0, 3), b = d.slice(3, 6), c = d.slice(6, 8), e = d.slice(8), f = d.slice(6);
  return [...new Set(['0' + d, d, '90' + d, '+90' + d, '0' + a + ' ' + b + ' ' + c + ' ' + e, '0' + a + ' ' + b + ' ' + f, '0 ' + a + ' ' + b + ' ' + c + ' ' + e,
    '0(' + a + ') ' + b + ' ' + c + ' ' + e, '(0' + a + ') ' + b + ' ' + c + ' ' + e, '0' + a + '-' + b + '-' + c + '-' + e, a + ' ' + b + ' ' + c + ' ' + e, '0' + a + b + ' ' + c + e])];
}
// Sonuç: { sevkiyat: [...], satis: [...sevkiyatı olmayan eski satışlar], teklif: [...] } — her sorgu yalnızca eşleşen belgeleri okur (≈ birkaç okuma)
export async function musteriSorgula(girdi) {
  const b = B(), q = String(girdi || '').trim();
  if (q.length < 3) throw new Error('En az 3 karakter yazın (telefon, ad ya da satış no).');
  const cz = satisNoCoz(q);
  if (cz.tur === 'hatali') throw new Error(cz.hata);
  const d = telNorm(q), harf = /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(q), satNo = /^sat[-\s]?\d+/i.test(q) || cz.tur !== 'yok';   // V11.65: AYG… (eski/yeni) · son 4 karakter · SAT-…
  const calis = async (col, ...w) => {
    try { const sn = await b.getDocs(b.query(b.collection(b.db, col), ...w, b.limit(25))); return sn.docs.map(x => ({ ...x.data(), _id: x.id })); }
    catch (e) { console.warn('musteriSorgula', col, e); return []; }
  };
  const duz = a => a.flat();
  let sv = [], sa = [], te = [];
  if (satNo) {
    if (cz.tur === 'son4') {   // son 4 karakter: kontrol harfiyle elenen birkaç olası tam numara doğrudan okunur
      const ad = satisNoSon4Adaylar(cz.son4, magazaHarfListesi(), 60);
      for (const no of ad) {
        try { const sn = await b.getDoc(b.doc(b.db, COL, no)); if (sn.exists()) sv.push({ ...sn.data(), _id: sn.id }); } catch (e) { console.warn(e); }
        try { const sn = await b.getDoc(b.doc(b.db, 'sales', no)); if (sn.exists()) sa.push({ ...sn.data(), _id: sn.id }); } catch (e) { console.warn(e); }
      }
    } else {
      const ayg = cz.tur === 'yeni' || cz.tur === 'eski', no = ayg ? cz.no : q.toUpperCase().replace(/\s+/g, '-').replace(/^SAT(\d)/, 'SAT-$1');
      try { const sn = await b.getDoc(b.doc(b.db, COL, no)); if (sn.exists()) sv = [{ ...sn.data(), _id: sn.id }]; } catch (e) { console.warn(e); }
      try { const sn = await b.getDoc(b.doc(b.db, 'sales', no)); if (sn.exists()) sa = [{ ...sn.data(), _id: sn.id }]; } catch (e) { console.warn(e); }
      if (ayg && !sv.length && !sa.length) { sv = await calis(COL, b.where('satisNo', '==', no)); sa = await calis('sales', b.where('satisNo', '==', no)); }   // eski kayıt: iç kimlik SAT-…, ek numara satisNo
    }
  } else if (!harf && d) {
    const v = telVaryant(d);
    [sv, sa, te] = await Promise.all([
      Promise.all([calis(COL, b.where('telNorm', '==', d)), calis(COL, b.where('telNorm2', '==', d)), calis(COL, b.where('telefon', 'in', v)), calis(COL, b.where('telefon2', 'in', v))]).then(duz),
      Promise.all([calis('sales', b.where('telNorm', '==', d)), calis('sales', b.where('custPhone', 'in', v))]).then(duz),
      Promise.all([calis('proposals', b.where('telNorm', '==', d)), calis('proposals', b.where('phone', 'in', v))]).then(duz)
    ]);
  } else if (harf) {
    const ad = [...new Set([q, q.toLocaleUpperCase('tr'), q.toLocaleLowerCase('tr').replace(/(^|\s)\S/g, m => m.toLocaleUpperCase('tr'))])];
    const aralik = (alan, x) => [b.where(alan, '>=', x), b.where(alan, '<=', x + '\uf8ff')];
    [sv, sa, te] = await Promise.all([
      Promise.all(ad.map(x => calis(COL, ...aralik('musteri', x)))).then(duz),
      Promise.all(ad.map(x => calis('sales', ...aralik('custName', x)))).then(duz),
      Promise.all(ad.map(x => calis('proposals', ...aralik('custName', x)))).then(duz)
    ]);
  } else throw new Error('Telefon numarasını (10-11 hane), müşteri adını ya da satış numarasını (AYG…, son 4 hane ya da SAT-…) yazın.');
  const tekil = (a, k) => { const m = new Map(); a.forEach(x => m.set(x[k] || x._id, x)); return [...m.values()]; };
  sv = tekil(sv, '_id').filter(x => !x.silindi).map(x => ({ ...x, saleNo: x._id }));
  const svIds = new Set(sv.map(x => x.saleNo));
  sa = tekil(sa, '_id').filter(x => !svIds.has(x._id) && (x.tip || 'satis') === 'satis');
  const ben = eposta();
  te = tekil(te, '_id').filter(x => x.gizlilik !== 'kapali' || x.user === ben || yonetici());
  const zamanMs = x => (x.ts && x.ts.toDate ? x.ts.toDate().getTime() : (Number(x.ts) || Date.parse(x.ts) || 0));
  sv.sort((x, y) => zamanMs(y) - zamanMs(x)); sa.sort((x, y) => zamanMs(y) - zamanMs(x)); te.sort((x, y) => zamanMs(y) - zamanMs(x));
  sv.forEach(x => state.list.set(x.saleNo, x));
  return { sevkiyat: sv, satis: sa, teklif: te };
}
// Tek belgeyi tazele (çakışma sonrası; tüm listeyi çekmekten çok daha ucuz)
export async function tekYenile(saleNo) {
  try {
    const b = B();
    const snap = await b.getDoc(b.doc(b.db, COL, saleNo));
    if (snap.exists()) state.list.set(saleNo, { ...snap.data(), saleNo });
  } catch (e) { console.warn('tekYenile:', e); }
}

// Bildirim sayacı: henüz hiç seri girilmemiş (yeni) sevkiyat sayısı. 1000 eşleşmeye kadar 1 okuma.
export async function yeniIsSayisi() {
  const b = B();
  const r = await b.getCountFromServer(b.query(b.collection(b.db, COL), b.where('durum', '==', 'barkod_bekliyor')));
  return r.data().count;
}

// ── Bekleyen yazma takibi (çevrimdışı kalıcılık zaten açık) ────
function bekleyenIzle(p, id, silinebilir) {
  state.bekleyen++;
  if (kancalar.bekleyen) kancalar.bekleyen(state.bekleyen);
  return p.then(() => {
    state.bekleyen = Math.max(0, state.bekleyen - 1);
    if (kancalar.bekleyen) kancalar.bekleyen(state.bekleyen);
    if (kancalar.yazildi) kancalar.yazildi(id);
  }).catch(e => {
    state.bekleyen = Math.max(0, state.bekleyen - 1);
    if (kancalar.bekleyen) kancalar.bekleyen(state.bekleyen);
    if (silinebilir) state.list.delete(id);
    if (kancalar.yazimHata) kancalar.yazimHata(id, e);
  });
}

// ── Güncelleme: transaction (taze veri + atomik seri kilidi + log) ──
//  yazOrFn: nesne  ya da  (sunucuDoc) => { yaz, hata?, seriEkle?: [{seri,n,kod}], seriSil?: [seri] }
//  secenek.cevrimdisiOk: true → çevrimdışıyken updateDoc + arrayUnion(log) ile kuyruğa alınır
//  (yalnızca servis/tarih gibi çakışması zararsız alanlar için; seri/kilit/teslim DEĞİL).
//  secenek.hata: (mesaj) => void  — verilirse hata, bloklayan uyarı yerine bu işleve iletilir.
const yetkiHatasi = e => !!e && (e.code === 'permission-denied' || /insufficient permissions|permission-denied/i.test(String(e.message || e)));
export async function guncelle(s, yazOrFn, aksiyon, ek, secenek) {
  const b = B();
  const opt = secenek || {};
  const ayAlertTemel = (window.ayAlert || (m => { console.warn(m); return Promise.resolve(); }));
  // opt.hata verilirse (ör. kamera ekranı) bloklayan uyarı yerine çağırana mesaj iletilir
  // Hata gösterimi: opt.hata(mesaj, hataNesnesi) → çağıran (ör. kamera) yönetir;
  // yoksa kurumsal uyarı kartı (kancalar.uyari); o da yoksa düz alert.
  const ayAlert = (m, e) => {
    if (opt.hata) { opt.hata(m, e); return Promise.resolve(); }
    if (kancalar.uyari && e) return kancalar.uyari(e);
    return ayAlertTemel(m);
  };
  const ref = b.doc(b.db, COL, s.saleNo);
  if (typeof yazOrFn === 'function') { try { await seriYukle(false); } catch (e) { /* yoksay */ } } // durum hesabı için kod listesi

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (!opt.cevrimdisiOk || typeof yazOrFn === 'function') {
      const g = new SvkHata('Bu işlem için internet bağlantısı gerekli (seri/kilit/teslim işlemleri sunucuda doğrulanır). Bağlantı gelince tekrar deneyin.', 'cevrimdisi');
      await ayAlert(g.message, g);
      return false;
    }
    const yaz = buyutYaz(yazOrFn);
    for (const k of Object.keys(yaz)) setPath(s, k, yaz[k]);
    const girdi = logGir(aksiyon, ek);
    s.log = [...(s.log || []), girdi].slice(-300);
    bekleyenIzle(b.updateDoc(ref, { ...yaz, log: b.arrayUnion(girdi) }), s.saleNo, false);
    return true;
  }

  try {
    const sonuc = await b.runTransaction(b.db, async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new SvkHata('Sevkiyat kaydı bulunamadı (silinmiş olabilir).');
      const sunucu = snap.data();
      const plan = typeof yazOrFn === 'function' ? (yazOrFn(sunucu) || {}) : { yaz: yazOrFn };
      if (plan.hata) throw new SvkHata(plan.hata, plan.tur, plan.detay);
      const yaz = buyutYaz(plan.yaz || {});
      const ekle = plan.seriEkle || [];
      const sil = plan.seriSil || [];

      // Firestore: transaction'da TÜM okumalar yazmalardan önce olmalı
      const ekleSnaps = await Promise.all(ekle.map(x => tx.get(b.doc(b.db, SERI_COL, seriDocId(x.seri)))));
      const silSnaps = await Promise.all(sil.map(x => tx.get(b.doc(b.db, SERI_COL, seriDocId(x)))));
      ekle.forEach((x, i) => {
        if (!ekleSnaps[i].exists()) return;
        const o = ekleSnaps[i].data();
        if (o.saleNo !== s.saleNo) {
          throw new SvkHata('Bu seri/barkod zaten kullanılmış (' + o.saleNo + (o.musteri ? ' · ' + o.musteri : '') + ').',
            'kullanilmis', { seri: x.seri, saleNo: o.saleNo, musteri: o.musteri || '' });
        }
        if (String(o.n) !== String(x.n)) throw new SvkHata('Bu seri bu sevkiyatın başka bir satırında zaten girilmiş.', 'ayni_sevkiyat', { seri: x.seri, n: Number(o.n) });
      });

      const g = { ...sunucu, saleNo: s.saleNo };
      for (const k of Object.keys(yaz)) setPath(g, k, yaz[k]);
      const durum = durumHesapla(g);
      const kapali = !!(g.teslimEdildi || g.iptal || g.iade || g.silindi);
      const log = [...(sunucu.log || []), logGir(aksiyon, ek)].slice(-300);

      sil.forEach((x, i) => {
        const sd = silSnaps[i];
        if (sd.exists() && sd.data().saleNo === s.saleNo) tx.delete(b.doc(b.db, SERI_COL, seriDocId(x)));
      });
      ekle.forEach(x => tx.set(b.doc(b.db, SERI_COL, seriDocId(x.seri)), {
        seri: normSeri(x.seri), saleNo: s.saleNo, n: Number(x.n), kod: String(x.kod || ''),
        musteri: sunucu.musteri || '', u: eposta(), t: Date.now()
      }));
      tx.update(ref, { ...yaz, durum, kapali, log });
      return { ...g, durum, kapali, log };
    });
    Object.assign(s, sonuc);
    state.list.set(s.saleNo, s);
    return true;
  } catch (e) {
    if (e instanceof SvkHata) {
      await ayAlert(e.message, e);
    } else if (yetkiHatasi(e) && !opt._yeniden && b.oturumYenile) {
      // V11.59: "Missing or insufficient permissions" — çoğu kez bayat/eksik oturum belirteci (çerez temizliği, uzun süre açık sekme). Belirteci yenile, bir kez daha dene.
      const d = await b.oturumYenile().catch(() => 'hata');
      if (d === 'ok') return guncelle(s, yazOrFn, aksiyon, ek, { ...opt, _yeniden: true });
      const g = new SvkHata(d === 'yok' ? 'Oturumunuz bulunamadı (çerez/site verisi temizlenmiş olabilir).\nÇıkış yapıp yeniden giriş yapın; sonra işlemi tekrarlayın.' : 'Yetki doğrulanamadı.\nÇıkış yapıp yeniden giriş yapın; sürerse yöneticiye bildirin.', 'genel', { teknik: false });
      await ayAlert(g.message, g);
    } else if (yetkiHatasi(e)) {
      const g = new SvkHata('Bu işlem için yetkiniz doğrulanamadı.\nÇıkış yapıp yeniden giriş yapın; sürerse yöneticiye (hangi satış / hangi işlem olduğunu) bildirin.', 'genel', { teknik: false });
      await ayAlert(g.message, g);
    } else {
      console.error('sevkiyat guncelle:', e);
      const g = new SvkHata('Kayıt başarısız: ' + (e.message || e) + '\nKayıt yenileniyor.', 'genel', { teknik: true });
      await ayAlert(g.message, g);
    }
    await tekYenile(s.saleNo);
    return false;
  }
}

// ── Kayıt oluştur (satış tamamlanınca) ─────────────────────────
// setDoc beklenmez (çevrimdışıyken sunucu onayı gelene dek askıda kalırdı);
// yerel state hemen güncellenir, bekleyen yazma sayacı + hata kancası izler.
// V11.63: kayıt üretimi ayrıldı — yazımı yapmaz (SDK takılırsa app.js doğrudan REST ile yazar)
export function kayitUret(sale, v, not) {
  const b = B();
  const now = Date.now();
  const fo = sale.fiyat && sale.fiyat.odeme;
  const teslimdeNot = fo && fo.pesinSekli === 'Teslimde' && Number(fo.pesin) > 0 ? 'Teslimde nakit tahsil edilecek: ' + tl(fo.pesin) : '';   // peşin “teslimde alınacak” ise servis/teslim notu otomatik
  const tahsilat = Math.max(0, Number(v.tahsilat) || 0);
  const tur = v.tur === 'musteri' ? 'musteri' : 'servis';
  const kalemler = {};
  (sale.urunler || []).forEach((i, n) => {
    const pb = (b.urunBul && b.urunBul(i.kod)) || {};   // V11.14: servis mesajı markaya göre bloklanır
    kalemler[String(n)] = { urun: i.urun || '', kod: i.kod || '', seriNo: '', seriGerekliDegil: /^SIG-/i.test(String(i.kod || '')), depo: '', teslimSekli: tur,
      marka: String(pb['Marka'] || pb.marka || '').trim(), gam: String(i.gam || pb['Ürün Gamı'] || pb.gam || '').trim() };
  });
  const kayit = {
    saleNo: sale.id, ts: now, createdAt: new Date(now).toISOString(), telNorm: telNorm(sale.custPhone), telNorm2: telNorm(sale.custPhone2),
    musteri: buyukYaz(dec(sale.custName)), telefon: sale.custPhone || '', telefon2: sale.custPhone2 || '',
    adres: buyukYaz(sale.address), tc: sale.custTC || '', email: sale.custEmail || '', odemeYontemi: sale.method || '',
    kurumsal: sale.kurumsal === true, firmaUnvan: buyukYaz(sale.firmaUnvan), vergiDairesi: buyukYaz(sale.vergiDairesi), vergiNo: sale.vergiNo || '', faturaAdres: buyukYaz(sale.faturaAdres),
    satici: sale.user || eposta(),
    saticiAd: (!sale.user || String(sale.user).toLowerCase() === String(eposta()).toLowerCase()) ? String(kullanici().Ad || '').trim() : '',   // V11.37: yetim satışı yönetici açıyorsa satıcının adı bilinmez → e-posta gösterilir
    satisNoktasi: v.nokta || '', teslimTarihi: v.tarih, teslimSaati: v.saat || '',
    teslimTuru: tur, atananServis: tur === 'musteri' ? '' : (v.servis || ''), not: buyukYaz([teslimdeNot, dec(not || ''), v.not ? dec(v.not) : ''].filter(Boolean).join(' · ')),
    fiyat: sale.fiyat || null,
    faturaKesen: sale.faturaKesen || '', samsungKod: sale.samsungKod || '',   // V12.3: 'samsung' → fatura Samsung şirketine kesildi
    tahsilatTutari: tahsilat, tahsilatAlindi: null,
    kalemler, depoZorunlu: !v.yetim && DEPOLAR.length > 0, kilitli: false, servisTeslim: null, teslimEdildi: null, iptal: false,
    durum: 'barkod_bekliyor', kapali: false, log: [logGir(v.yetim ? 'yetim_satistan_olusturuldu' : 'olusturuldu')]
  };
  return kayit;
}
export function olustur(sale, v, not) {
  const b = B();
  const kayit = kayitUret(sale, v, not);
  const p = b.setDoc(b.doc(b.db, COL, sale.id), kayit);
  state.list.set(sale.id, kayit);
  const izleyen = bekleyenIzle(p, sale.id, true);
  return { kayit, izleyen };
}

// ── Yönetici araçları ──────────────────────────────────────────
// Sevkiyat kaydı olmayan satışlar (son N gün). Manuel tetiklenir: ≤150 + ≤300 okuma.
export async function yetimSatislar(gun) {
  const b = B();
  const kesIso = new Date(Date.now() - (gun || 14) * 864e5).toISOString();
  const satSnap = await b.getDocs(b.query(b.collection(b.db, 'sales'), b.where('ts', '>=', kesIso), b.orderBy('ts', 'desc'), b.limit(150)));
  const svkSnap = await b.getDocs(b.query(b.collection(b.db, COL), b.where('ts', '>=', Date.now() - (gun || 14) * 864e5 - 864e5), b.orderBy('ts', 'desc'), b.limit(300)));
  const var_ = new Set(svkSnap.docs.map(d => d.id));
  return satSnap.docs.map(d => ({ ...d.data(), id: d.id })).filter(x => (x.tip || 'satis') === 'satis' && !var_.has(x.id));
}

// Bir kerelik: V10'da girilmiş serileri seriKullanim kilitlerine aktarır.
// Dönüş: { yazilan, cakisan:[{seri, satislar}] }
export async function seriKilitleriniEsitle() {
  const b = B();
  const snap = await b.getDocs(b.query(b.collection(b.db, COL), b.orderBy('ts', 'desc'), b.limit(500)));
  const harita = new Map();
  snap.docs.forEach(d => {
    const s = { ...d.data(), saleNo: d.id };
    if (s.iptal || s.silindi) return;
    kalemListe(s).forEach(k => {
      if (!k.seriNo || !String(k.seriNo).trim()) return;
      const key = normSeri(k.seriNo);
      if (!harita.has(key)) harita.set(key, []);
      harita.get(key).push({ saleNo: s.saleNo, n: k.n, kod: k.kod, musteri: s.musteri });
    });
  });
  let yazilan = 0; const cakisan = [];
  const isler = [];
  for (const [seri, liste] of harita) {
    if (liste.length > 1) { cakisan.push({ seri, satislar: liste.map(x => x.saleNo) }); continue; }
    const x = liste[0];
    isler.push(b.setDoc(b.doc(b.db, SERI_COL, seriDocId(seri)), { seri, saleNo: x.saleNo, n: x.n, kod: String(x.kod || ''), musteri: x.musteri || '', u: eposta(), t: Date.now() }).then(() => { yazilan++; }));
  }
  await Promise.all(isler);
  return { yazilan, cakisan };
}

// ═══ V11.42: TOPLU İÇE AKTARMA (CSV) — sepetten geçmemiş, depoda bekleyen satışlar ═══
// Yönetici bir CSV (Excel'den "CSV (noktalı virgül)" olarak kaydedilmiş) yükler; her SATIŞ NO bir sevkiyat kaydı olur (aynı numaralı satırlar = aynı satışın ürünleri).
// Seri stok kontrolü bilerek yapılmaz (ürün başka sistemden zaten düşülmüştür); çakışma kontrolleri (başka sevkiyatta kullanılmış seri) sürer.
export function csvAyristir(metin) {
  metin = String(metin == null ? '' : metin).replace(/^﻿/, '');
  const ilk = metin.split(/\r?\n/)[0] || '';
  const ay = [';', '\t', ','].map(c => [c, ilk.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const sat = []; let r = [], h = '', q = false;
  const bitir = () => { r.push(h); h = ''; if (r.some(x => String(x).trim() !== '')) sat.push(r); r = []; };
  for (let i = 0; i < metin.length; i++) {
    const c = metin[i];
    if (q) { if (c === '"') { if (metin[i + 1] === '"') { h += '"'; i++; } else q = false; } else h += c; }
    else if (c === '"') q = true;
    else if (c === ay) { r.push(h); h = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && metin[i + 1] === '\n') i++; bitir(); }
    else h += c;
  }
  if (h !== '' || r.length) bitir();
  return sat;
}
// ── V12.4: .xlsx okuyucu (bağımlılıksız): ZIP → sharedStrings + ilk sayfa → satır dizisi (hücreler metin) ──
/* global DecompressionStream */
async function zipAc(u8) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Bu tarayıcı .xlsx açamıyor; dosyayı CSV olarak kaydedin.');
  const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(); w.write(u8); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
const xmlCoz = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&');
export async function xlsxOku(buf) {
  const u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (u.length > 4 && u[0] === 0xD0 && u[1] === 0xCF) throw new Error('Bu eski biçimli .xls dosyası. Excel\'de “Farklı kaydet → Excel Çalışma Kitabı (.xlsx)” ya da CSV yapıp seçin.');
  let e = -1; for (let i = u.length - 22; i >= Math.max(0, u.length - 65600); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Geçerli bir .xlsx dosyası değil.');
  const say = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const dosyalar = new Map();
  for (let n = 0; n < say; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const yon = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    dosyalar.set(new TextDecoder().decode(u.subarray(p + 46, p + 46 + nl)), { yon, csz, lo }); p += 46 + nl + el + cl;
  }
  const oku = async ad => { const f = dosyalar.get(ad); if (!f) return null; const ln = dv.getUint16(f.lo + 26, true), le = dv.getUint16(f.lo + 28, true), bas = f.lo + 30 + ln + le, ham = u.subarray(bas, bas + f.csz); return new TextDecoder('utf-8').decode(f.yon === 0 ? ham : await zipAc(ham)); };
  const sayfaAd = dosyalar.has('xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml' : [...dosyalar.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sayfaAd) throw new Error('Excel dosyasında sayfa bulunamadı.');
  const sst = await oku('xl/sharedStrings.xml'), ss = [];
  if (sst) (sst.match(/<si\b[\s\S]*?<\/si>/g) || []).forEach(si => ss.push(xmlCoz((si.replace(/<t\s*\/>/g, '').match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''))));
  const xml = await oku(sayfaAd), sat = [];
  (xml.match(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g) || []).forEach(rx => {
    const r = [];
    (rx.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach(cx => {
      const at = (cx.match(/^<c\b([^>]*?)\/?>/) || [])[1] || '', ref = (at.match(/\br="([A-Z]+)\d+"/) || [])[1], tip = (at.match(/\bt="(\w+)"/) || [])[1];
      if (!ref) return; let ci = 0; for (const ch of ref) ci = ci * 26 + ch.charCodeAt(0) - 64; ci--;
      let v = ''; const vm = cx.match(/<v>([\s\S]*?)<\/v>/), im = cx.match(/<is>([\s\S]*?)<\/is>/);
      if (tip === 's' && vm) v = ss[+vm[1]] || ''; else if (im) v = xmlCoz((im[1].match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')); else if (vm) v = xmlCoz(vm[1]);
      while (r.length < ci) r.push(''); r[ci] = v;
    });
    if (r.some(x => String(x).trim() !== '')) sat.push(r);
  });
  return sat;
}
// Dosya baytları → satırlar (xlsx = "PK" ile başlar; aksi hâlde CSV/metin, UTF-8 ya da Türkçe ANSI)
export async function dosyaSatirlari(buf) {
  const u = new Uint8Array(buf);
  if ((u[0] === 0x50 && u[1] === 0x4B) || (u[0] === 0xD0 && u[1] === 0xCF)) return xlsxOku(buf);
  let metin; try { metin = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_e) { metin = new TextDecoder('windows-1254').decode(buf); }
  return csvAyristir(metin);
}

// Başlık adı (aksan/boşluk duyarsız) → alan. "Satış No" ve "Belge No" aynı şeydir (kayıt kimliği + görünen numara).
const ICE_ANAHTAR = { teslimattarihi: 'tarih', teslimtarihi: 'tarih', tarih: 'tarih', saat: 'saat', satisno: 'saleNo', belgeno: 'saleNo', musteri: 'musteri', telefon: 'telefon', satisnoktasi: 'nokta', nokta: 'nokta', teslimsekli: 'tur', servis: 'servis',
  urunkodu: 'kod', kod: 'kod', urunadi: 'urun', serino: 'seri', depo: 'depo', not: 'not',
  satistarihi: 'satisTarihi', personel: 'personel', satisdanismani: 'personel', satici: 'personel', adet: 'adet', listefiyati: 'liste', listefiyat: 'liste', satisfiyati: 'net', netfiyat: 'net', tutar: 'net',
  toplamtutar: 'toplam', odenentutar: 'toplam', odeme: 'odeme', odemesekli: 'odeme', teslimedildi: 'teslimEdildi', samsungfaturali: 'samsung', adres: 'adres' };
export const ICE_BASLIK = ['Belge No', 'Satış Tarihi', 'Teslimat Tarihi', 'Saat', 'Müşteri', 'Telefon', 'Personel', 'Satış Noktası', 'Teslim Şekli', 'Teslim Edildi', 'Servis', 'Ürün Kodu', 'Ürün Adı', 'Adet', 'Liste Fiyatı', 'Satış Fiyatı', 'Toplam Tutar', 'Ödeme', 'Samsung Faturalı', 'Seri No', 'Depo', 'Not'];
const ICE_KATLA = s => String(s || '').toLocaleLowerCase('tr-TR').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/[^a-z0-9]/g, '');
const iceHucre = v => { let s = String(v == null ? '' : v).trim(); const m = s.match(/^=\s*"(.*)"$/); if (m) s = m[1]; return s.trim(); };
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
export function iceTarih(v) {
  const s = iceHucre(v); if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/), y, a, g;
  if (m) { y = +m[1]; a = +m[2]; g = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/))) { g = +m[1]; a = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  else if (/^\d{5}(\.\d+)?$/.test(s) && +s > 40000 && +s < 60000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5); y = d.getUTCFullYear(); a = d.getUTCMonth() + 1; g = d.getUTCDate(); }
  else return null;
  const d = new Date(y, a - 1, g);
  if (d.getFullYear() !== y || d.getMonth() !== a - 1 || d.getDate() !== g) return null;
  return y + '-' + String(a).padStart(2, '0') + '-' + String(g).padStart(2, '0');
}
export function iceTur(v) {
  const s = ICE_KATLA(iceHucre(v));
  if (!s) return '';
  if (s.includes('musteri')) return 'musteri';
  if (s.includes('servis')) return 'servis';
  return null;
}
// "1.234,50" · "1234,5" · "1,234.50" · "₺ 28.400" → sayı; boş → null; sayı değilse NaN
export function iceSayi(v) {
  let s = iceHucre(v).replace(/[₺\s]|TL/gi, ''); if (!s) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  const n = Number(s); return isFinite(n) ? r2(n) : NaN;
}
const iceEvet = v => /^(e|evet|x|1|var|tamam|teslimedildi|teslim)$/.test(ICE_KATLA(iceHucre(v)));
const iceTel = v => { const d = iceHucre(v).replace(/\D/g, ''); return d.length === 10 && d[0] === '5' ? '0' + d : iceHucre(v); };
const iceTs = iso => { const [y, a, g] = String(iso).split('-').map(Number); return Date.UTC(y, a - 1, g, 9, 0, 0); };   // 12:00 TR
// Kişi listesi (satış kullanıcıları) — Personel sütununu eşlemek için
let _kisiOnbellek = null;
export async function kisileriGetir(zorla) {
  if (_kisiOnbellek && !zorla) return _kisiOnbellek;
  const b = B(), l = [];
  try { const sn = await b.getDocs(b.collection(b.db, 'kullanicilar')); sn.docs.forEach(d => { const x = d.data(); if (x && x.Email && !x.Kilitli) l.push({ email: String(x.Email).toLowerCase(), ad: String(x.Ad || '').trim() || String(x.Email).split('@')[0], rol: String(x.Rol || '').toLowerCase() }); }); } catch (_e) { /* kişi listesi okunamazsa personel elle seçilir */ }
  l.sort((a, c) => a.ad.localeCompare(c.ad, 'tr')); _kisiOnbellek = l; return l;
}
export function kisiBul(metin, liste) {
  const m = String(metin || '').trim(); if (!m) return null;
  if (m.includes('@')) return liste.find(x => x.email === m.toLowerCase()) || null;
  const k = ICE_KATLA(m), ek = x => ICE_KATLA(x.email.split('@')[0]);
  const tam = liste.find(x => ICE_KATLA(x.ad) === k || ek(x) === k); if (tam) return tam;
  const ad = liste.filter(x => { const a = ICE_KATLA(x.ad), e = ek(x); return k.length >= 5 && ((a.length >= 5 && (a.includes(k) || k.includes(a))) || (e.length >= 5 && (e.includes(k) || k.includes(e)))); });
  return ad.length === 1 ? ad[0] : null;
}
const adilDagit = (listeler, toplam) => { const T = listeler.reduce((a, b) => a + b, 0), n = listeler.length, p = listeler.map(l => r2(T > 0 ? toplam * l / T : toplam / n)); p[n - 1] = r2(p[n - 1] + toplam - p.reduce((a, b) => a + b, 0)); return p; };
const idGecersiz = id => !id || /[\/\\]/.test(id) || id === '.' || id === '..' || id.length > 100;

// ── Bir satış grubunun SENKRON doğrulaması + fiyat bloğu (önizlemede her düzenlemede yeniden çalışır; yazmaz, okumaz) ──
export function iceGrupDogrula(g) {
  const h = [...g.hSabit], u = [...g.uSabit], bugunIso = bugun();
  if (!g.musteri) h.push('Müşteri adı boş');
  if (idGecersiz(g.id)) h.push('Belge No geçersiz (boş olamaz, “/” içeremez)');
  // tarihler
  const st = g.satisTarihi === '' ? '' : iceTarih(g.satisTarihi); if (st === null) h.push('Satış Tarihi anlaşılamadı (' + g.satisTarihi + ') — GG.AA.YYYY yazın');
  const tt = g.tarih === '' ? '' : iceTarih(g.tarih); if (tt === null) h.push('Teslimat Tarihi anlaşılamadı (' + g.tarih + ') — GG.AA.YYYY yazın');
  const teslimKolon = g.teslimEdildi === '' || g.teslimEdildi == null ? '' : (iceTarih(g.teslimEdildi) || (iceEvet(g.teslimEdildi) ? 'evet' : null));
  if (teslimKolon === null && g.teslimEdildi) u.push('“Teslim Edildi” anlaşılamadı (' + g.teslimEdildi + ') → açık sevkiyat olarak aç');
  g.satisIso = st || tt || bugunIso; g.tarihIso = tt || st || bugunIso;
  if (!st) u.push('Satış Tarihi boş → ' + (tt ? 'teslimat tarihi' : 'bugünün tarihi') + ' (' + tarihTR(g.satisIso) + ') yazılacak');
  g.teslimIso = teslimKolon ? (teslimKolon === 'evet' ? g.tarihIso : teslimKolon) : '';
  // fiyat
  g.fiyat = null; const kal = g.kalemler;
  const fiyatVar = kal.some(k => k.listeBirim != null || k.netSatir != null) || g.toplam != null;
  if (!fiyatVar) u.push('Fiyat yok → satış prim ve hedef hesabına GİRMEZ (sonradan “Mevcut kayıtları güncelle” ile fiyat eklenebilir)');
  else if (!h.some(x => x.startsWith('Satır') && /fiyat/.test(x))) {
    const listeler = [];
    kal.forEach(k => {
      let l = k.listeBirim != null ? r2(k.listeBirim * k.adet) : (k.netSatir != null ? k.netSatir : null);
      if (l == null && g.toplam != null) { const pb = (B().urunBul && B().urunBul(k.kod)) || null, nk = pb ? Number(String(pb.Nakit || pb.nakit || '').replace(',', '.')) : 0; l = nk > 0 ? r2(nk * k.adet) : null; }
      listeler.push(l);
    });
    const eksikIdx = listeler.map((l, i) => (l == null ? i : -1)).filter(i => i >= 0);
    if (eksikIdx.length && g.toplam != null && eksikIdx.length < kal.length) { const ort = r2(listeler.filter(x => x != null).reduce((a, b) => a + b, 0) / (kal.length - eksikIdx.length)); eksikIdx.forEach(i => { listeler[i] = ort; }); u.push('Bazı satırlarda fiyat yok → Toplam Tutar satırlara paylaştırıldı (ortalama liste ile)'); }
    else if (eksikIdx.length && g.toplam != null) { eksikIdx.forEach(i => { listeler[i] = 1; }); u.push('Satır fiyatı yok → Toplam Tutar ürünlere eşit paylaştırıldı (prim oranı ürün gamına göre; fiyatları yazmanız daha doğru olur)'); }
    else if (eksikIdx.length) eksikIdx.forEach(i => h.push('Satır ' + kal[i].no + ': fiyat yok (Liste Fiyatı ya da Satış Fiyatı yazın; ya da Toplam Tutar verin)'));
    if (!eksikIdx.length || g.toplam != null) {
      let nets;
      if (g.toplam != null) {
        nets = adilDagit(listeler, g.toplam);
        if (kal.every(k => k.netSatir != null)) { const s = r2(kal.reduce((a, k) => a + k.netSatir, 0)); if (Math.abs(s - g.toplam) > 1) u.push('Satış Fiyatı toplamı (' + s + ') ≠ Toplam Tutar (' + g.toplam + ') → Toplam Tutar esas alındı'); }
      } else nets = kal.map((k, i) => (k.netSatir != null ? k.netSatir : listeler[i]));
      const lt = r2(listeler.reduce((a, b) => a + b, 0)), nt = r2(nets.reduce((a, b) => a + b, 0)), ind = Math.max(0, r2(lt - nt));
      if (nt > lt * 1.001 + 1) u.push('Satış fiyatı (' + nt + ') liste fiyatından (' + lt + ') yüksek');
      if (lt > 0 && nt < lt * 0.3) u.push('Satış fiyatı liste fiyatının %30\'undan az (' + nt + ' / ' + lt + ') — fiyatı kontrol edin');
      g.fiyat = { kampanyaIndirim: g.samsung ? ind : 0, personelInisiyatifiIndirim: g.samsung ? 0 : ind,
        kalemler: kal.map((k, i) => ({ urun: k.urun, kod: k.kod, adet: k.adet, liste: listeler[i], indirim: Math.max(0, r2(listeler[i] - nets[i])), net: nets[i], kampanya: g.samsung ? 'Samsung faturalı' : '' })),
        listeToplam: lt, urunIndirim: ind, altIndirim: 0, pazarlik: 0, pazarlikNotu: '', netNakit: nt, vadeFarki: 0,
        odeme: { tip: 'nakit', kart: '', taksit: 0, aylik: 0, pesin: 0, pesinSekli: '', kartTutar: 0, zincir: '', sekil: g.odeme || 'Nakit', banka: null, toplam: nt } };
    }
  }
  // personel
  if (g.fiyat && !g.satici) h.push(g.personelMetin ? 'Personel bulunamadı: “' + g.personelMetin + '” (listeden seçin)' : 'Personel seçilmedi (fiyatlı satış primi için gerekli)');
  else if (!g.fiyat && g.personelMetin && !g.satici) u.push('Personel bulunamadı: “' + g.personelMetin + '” → satıcı olarak sizin hesabınız yazılır');
  if (g.satici && !g.fiyat) u.push('Personel var ama fiyat yok → prime girmesi için fiyat gerekir');
  // belge no çakışması (sunucuda denetlenmiş sonuçlar)
  (g.hAsenk || []).forEach(x => h.push(x)); (g.uAsenk || []).forEach(x => u.push(x));
  g.hatalar = h; g.uyarilar = u;
  return g;
}
// Önizleme listesinde aynı Belge No'nun birden çok satışta olması
export function iceCakisma(gruplar) {
  const say = new Map(); gruplar.forEach(g => { if (g.id) say.set(g.id, (say.get(g.id) || 0) + 1); });
  gruplar.forEach(g => { g.hAsenk = (g.hAsenk || []).filter(x => !x.includes('birden çok satışta')); if (g.id && say.get(g.id) > 1) g.hAsenk.push('Belge No “' + g.id + '” önizlemede birden çok satışta — her satışın numarası farklı olmalı'); });
}
// Sunucu denetimi: Belge No kayıtlı mı (güncelleme modunda içe aktarılmış kayıt olabilir) + seri kilitleri
export async function iceSunucuDenetim(g, sec) {
  const b = B(); g.hAsenk = []; g.uAsenk = []; g.mevcut = null;
  if (idGecersiz(g.id)) return g;
  try {
    const sn = await okuDene(() => b.getDoc(b.doc(b.db, COL, g.id)));
    if (sn.exists()) {
      const d = sn.data();
      if (sec && sec.guncelle && d.iceAktarma) { g.mevcut = d; g.uAsenk.push('Bu Belge No içe aktarılmış bir kayıt → bilgileri (fiyat, personel, tarih) GÜNCELLENİR; ürünler/seri değişmez'); if (kalemListe(d).length !== g.kalemler.length) g.hAsenk.push('Ürün sayısı kayıttakiyle farklı (' + g.kalemler.length + ' ≠ ' + kalemListe(d).length + ') — güncelleme yapılamaz'); }
      else g.hAsenk.push(d.iceAktarma ? 'Bu Belge No içe aktarılmış bir kayıt (' + g.id + ') — fiyat/personel eklemek için “Mevcut içe aktarılmış kayıtları güncelle”yi işaretleyin' : 'Bu Belge No sistemde zaten kayıtlı (' + g.id + ') — gerçek satış kayıtlarının üzerine yazılmaz');
    } else {
      const sa = await okuDene(() => b.getDoc(b.doc(b.db, 'sales', g.id)));
      if (sa.exists()) g.hAsenk.push('Bu Belge No satış kayıtlarında var (' + g.id + ') — başka bir numara verin');
      else { const rz = await okuDene(() => b.getDoc(b.doc(b.db, 'satisNoRez', g.id))); if (rz.exists()) g.hAsenk.push('Bu Belge No daha önce kullanılmış/ayrılmış (' + g.id + ')'); }
    }
  } catch (e) { g.hAsenk.push('Belge No denetlenemedi (internet / sunucu bağlantısı yok; bağlantıyı kontrol edip dosyayı yeniden seçin): ' + (e.message || e)); }
  for (const k of g.kalemler) {
    if (!k.seri) continue;
    try { const sn = await okuDene(() => b.getDoc(b.doc(b.db, SERI_COL, seriDocId(k.seri)))); if (sn.exists() && sn.data().saleNo !== g.id) g.hAsenk.push('Satır ' + k.no + ': ' + k.seri + ' seri numarası başka sevkiyatta kullanılmış (' + sn.data().saleNo + (sn.data().musteri ? ' · ' + sn.data().musteri : '') + ')'); }
    catch (e) { g.hAsenk.push('Satır ' + k.no + ': seri kilidi denetlenemedi (' + (e.message || e) + ')'); }
  }
  return g;
}
async function iceIdUret(g, kullanilan) {
  const b = B(), gunKod = bugun().slice(2).replace(/-/g, ''); let sayac = 0;
  for (;;) {
    sayac++; const id = 'ICE-' + gunKod + '-' + String(sayac).padStart(3, '0');
    if (kullanilan.has(id)) continue;
    let var_ = false; try { var_ = (await okuDene(() => b.getDoc(b.doc(b.db, COL, id)))).exists(); } catch (_e) { /* iceSunucuDenetim bağlantı hatasını raporlar */ }
    if (!var_) { g.id = id; kullanilan.add(id); return; }
  }
}
// Satırlar → satış grupları + doğrulama. Hiçbir şey yazmaz (yalnız okur). sec: { guncelle, personel (varsayılan e-posta), satisTarihi (varsayılan GG.AA.YYYY) }
export async function iceAktarPlan(satirlar, sec) {
  const b = B(); sec = sec || {};
  if (!satirlar.length) return { hata: 'Dosya boş.' };
  const kolon = {}; satirlar[0].forEach((h, i) => { const k = ICE_ANAHTAR[ICE_KATLA(h)]; if (k && !(k in kolon)) kolon[k] = i; });
  const eksik = ['musteri', 'kod'].filter(k => !(k in kolon));
  if (eksik.length) return { hata: 'Başlık satırı tanınmadı; şu sütunlar gerekli: Müşteri, Ürün Kodu (ayrıca Belge No, Satış Tarihi, Personel, Adet, Liste Fiyatı, Satış Fiyatı, Teslim Şekli, Seri No…). “Boş şablonu indir” ile başlık adlarını görebilirsiniz.' };
  const kisiler = await kisileriGetir();
  const al = (r, k) => (k in kolon ? iceHucre(r[kolon[k]]) : '');
  const gruplar = new Map(), sira = [], dosyaSeri = new Map();
  satirlar.slice(1).forEach((r, i) => {
    const no = i + 2;   // Excel satır numarası
    if (!r.some(x => iceHucre(x) !== '')) return;
    const musteri = al(r, 'musteri'), tel = iceTel(al(r, 'telefon')), kod = al(r, 'kod'), seri = normSeri(al(r, 'seri'));
    let saleNo = al(r, 'saleNo'), uretildi = false;
    if (!saleNo) { saleNo = '\u0000' + ICE_KATLA(musteri) + '|' + tel + '|' + al(r, 'satisTarihi') + '|' + al(r, 'tarih'); uretildi = true; }
    if (!gruplar.has(saleNo)) {
      const pm = al(r, 'personel') || sec.personel || '', kisi = pm ? kisiBul(pm, kisiler) : null;
      const ph = al(r, 'toplam'), top = ph === '' ? null : iceSayi(ph);
      gruplar.set(saleNo, { anahtar: saleNo, id: uretildi ? '' : saleNo, uretildi, musteri, telefon: tel, tarih: al(r, 'tarih'), satisTarihi: al(r, 'satisTarihi') || sec.satisTarihi || '', saat: al(r, 'saat'), nokta: al(r, 'nokta'), not: al(r, 'not'), adres: al(r, 'adres'),
        personelMetin: pm, satici: kisi ? { email: kisi.email, ad: kisi.ad } : null, toplam: Number.isNaN(top) ? null : top, odeme: al(r, 'odeme'), teslimEdildi: al(r, 'teslimEdildi'), samsung: iceEvet(al(r, 'samsung')),
        ilkSatir: no, kalemler: [], hSabit: Number.isNaN(top) ? ['Satır ' + no + ': Toplam Tutar sayı değil (' + ph + ')'] : [], uSabit: [], hatalar: [], uyarilar: [], hAsenk: [], uAsenk: [] });
      sira.push(saleNo);
    }
    const g = gruplar.get(saleNo);
    if (musteri && g.musteri && ICE_KATLA(musteri) !== ICE_KATLA(g.musteri)) g.hSabit.push('Satır ' + no + ': aynı Belge No\'da farklı müşteri adı (' + musteri + ' ≠ ' + g.musteri + ')');
    if (!g.musteri && musteri) g.musteri = musteri;
    if (!g.telefon && tel) g.telefon = tel;
    if (!g.personelMetin && al(r, 'personel')) { g.personelMetin = al(r, 'personel'); const kk = kisiBul(g.personelMetin, kisiler); if (kk) g.satici = { email: kk.email, ad: kk.ad }; }
    if (!g.satisTarihi && al(r, 'satisTarihi')) g.satisTarihi = al(r, 'satisTarihi');
    if (g.toplam == null && al(r, 'toplam') !== '') { const t2 = iceSayi(al(r, 'toplam')); if (!Number.isNaN(t2)) g.toplam = t2; }
    if (!g.teslimEdildi && al(r, 'teslimEdildi')) g.teslimEdildi = al(r, 'teslimEdildi');
    if (iceEvet(al(r, 'samsung'))) g.samsung = true;
    const tur = iceTur(al(r, 'tur')), teslimli = !!(g.teslimEdildi || al(r, 'teslimEdildi'));
    if ((tur === '' && !teslimli) || tur === null) g.hSabit.push('Satır ' + no + ': Teslim Şekli ' + (tur === null ? 'anlaşılamadı (“Müşteri alır” ya da “Servis götürür” yazın)' : 'boş (“Müşteri alır” ya da “Servis götürür” yazın)'));
    if (!kod) { g.hSabit.push('Satır ' + no + ': Ürün kodu boş'); return; }
    const pb = (b.urunBul && b.urunBul(kod)) || null;
    let urun = al(r, 'urun');
    if (!urun) { urun = pb ? String(pb['Ürün Adı'] || pb['Urun Adi'] || pb.urun || '') : ''; if (!urun && b.urunAdi) { const a = b.urunAdi(kod); if (a && a !== kod) urun = a; } }
    if (!urun) g.hSabit.push('Satır ' + no + ': ' + kod + ' ürün listesinde yok ve Ürün Adı boş');
    else if (!pb) g.uSabit.push('Satır ' + no + ': ' + kod + ' ürün listesinde bulunamadı (adı dosyadan alındı' + (b.urunBul ? '; gamı bilinmediği için prim oranı varsayılan olur' : '') + ')');
    const adetH = al(r, 'adet'), adet = adetH === '' ? 1 : iceSayi(adetH), lH = al(r, 'liste'), nH = al(r, 'net'), liste = lH === '' ? null : iceSayi(lH), net = nH === '' ? null : iceSayi(nH);
    if (Number.isNaN(adet) || (adet != null && (adet < 1 || adet !== Math.floor(adet)))) g.hSabit.push('Satır ' + no + ': Adet geçersiz (' + adetH + ')');
    if (Number.isNaN(liste) || Number.isNaN(net) || (liste != null && liste < 0) || (net != null && net < 0)) g.hSabit.push('Satır ' + no + ': fiyat sayı değil (Liste: ' + lH + ' · Satış: ' + nH + ')');
    const k = { no, kod, urun, seri, tur: tur || (teslimli ? 'musteri' : 'servis'), servis: al(r, 'servis'), depo: al(r, 'depo'), marka: pb ? String(pb['Marka'] || pb.marka || '').trim() : '', gam: pb ? String(pb['Ürün Gamı'] || pb.gam || '').trim() : '', stok: '',
      adet: Number.isNaN(adet) ? 1 : (adet || 1), listeBirim: Number.isNaN(liste) ? null : liste, netSatir: Number.isNaN(net) ? null : net };
    if (seri) {
      if (dosyaSeri.has(seri)) g.hSabit.push('Satır ' + no + ': ' + seri + ' dosyada başka satırda da var (satır ' + dosyaSeri.get(seri) + ')');
      else dosyaSeri.set(seri, no);
      const bi = seriSahibi(seri);
      if (!bi) k.stok = 'listede yok'; else if (!kodEs(bi.kod, kod)) { k.stok = 'başka ürüne ait'; g.uSabit.push('Satır ' + no + ': ' + seri + ' stok listesinde başka bir ürüne (' + bi.kod + ') ait görünüyor — seri/ürün kodunu kontrol edin'); }
      else if (!(bi.kalan > 0)) k.stok = 'çıkış yapılmış';
    }
    g.kalemler.push(k);
  });
  const hedefler = sira.map(k => gruplar.get(k));
  hedefler.forEach(g => { if (!g.kalemler.length && !g.hSabit.length) g.hSabit.push('Ürün satırı yok'); });
  const kullanilan = new Set(hedefler.filter(g => g.id).map(g => g.id));
  for (const g of hedefler) if (!g.id) await iceIdUret(g, kullanilan);
  for (const g of hedefler) await iceSunucuDenetim(g, sec);
  iceCakisma(hedefler); hedefler.forEach(iceGrupDogrula);
  return { gruplar: hedefler, kisiler };
}
// Firestore "client is offline" / "unavailable": bağlantı henüz kurulmamış olabilir → kısa aralıklarla yeniden dener (yalnız okuma için)
async function okuDene(fn) {
  let son;
  for (let i = 0; i < 4; i++) {
    try { return await fn(); } catch (e) {
      son = e;
      if (!/offline|unavailable/i.test(String((e && (e.code || '')) + ' ' + (e && e.message)))) throw e;
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw son;
}
// Plan → yazma. Her satış kendi transaction'ında yazılır (sevkiyat kaydı + seri kilitleri + Belge No ayrımı + [fiyat+personel varsa] satış kaydı birlikte); biri başarısız olursa diğerleri etkilenmez.
export async function iceAktarYaz(gruplar, gerekce) {
  const b = B();
  const sonuc = { yazilan: 0, guncellenen: 0, atlanan: 0, seri: 0, satisKaydi: 0, hatalar: [] };
  for (const g of gruplar) {
    if (g.hatalar.length) { sonuc.atlanan++; continue; }
    const now = Date.now(), satisTs = iceTs(g.satisIso), teslimTs = g.teslimIso ? iceTs(g.teslimIso) : 0;
    const saticiEmail = g.satici ? g.satici.email : eposta(), saticiAd = g.satici ? g.satici.ad : String(kullanici().Ad || '').trim();
    const kalemler = {};
    g.kalemler.forEach((k, n) => { kalemler[String(n)] = { urun: k.urun, kod: k.kod, seriNo: k.seri || '', seriGerekliDegil: false, depo: k.depo || '', teslimSekli: k.tur, ...(k.tur === 'servis' && k.servis ? { servis: k.servis } : {}), marka: k.marka, gam: k.gam }; });
    const turler = g.kalemler.map(k => k.tur), tur = turler.filter(x => x === 'musteri').length > turler.length / 2 ? 'musteri' : 'servis';
    const srv = (g.kalemler.find(k => k.tur === 'servis' && k.servis) || {}).servis || '';
    const seriSay = g.kalemler.filter(k => k.seri).length, asilan = g.kalemler.filter(k => k.seri && k.stok).length;
    const satisYaz = !!(g.fiyat && g.satici);   // fiyat + personel varsa prim/hedef için 'sales' kaydı da yazılır
    const kayit = {
      saleNo: g.id, satisNo: g.id, ts: satisTs, createdAt: new Date(satisTs).toISOString(), telNorm: telNorm(g.telefon), telNorm2: '',
      musteri: g.musteri, telefon: g.telefon || '', telefon2: '', adres: g.adres || '', tc: '', email: '', odemeYontemi: g.odeme || '',
      kurumsal: false, firmaUnvan: '', vergiDairesi: '', vergiNo: '', faturaAdres: '',
      satici: saticiEmail, saticiAd,
      satisNoktasi: g.nokta || '', teslimTarihi: g.tarihIso, teslimSaati: g.saat || '',
      teslimTuru: tur, atananServis: tur === 'musteri' ? '' : srv, not: g.not || '',
      fiyat: g.fiyat || null, tahsilatTutari: 0, tahsilatAlindi: null,
      kalemler, depoZorunlu: false, kilitli: false, servisTeslim: null, teslimEdildi: teslimTs ? { t: teslimTs, u: eposta(), dogrulama: 'iceAktarma' } : null, iptal: false,
      ...(g.samsung ? { faturaKesen: 'samsung' } : {}),
      iceAktarma: { t: now, u: eposta(), gerekce: String(gerekce || '') },
      kapali: false
    };
    kayit.durum = durumHesapla(kayit); kayit.kapali = !!kayit.teslimEdildi;
    kayit.log = [logGir('toplu_ice_aktarma', g.kalemler.length + ' ürün · ' + seriSay + ' seri' + (g.fiyat ? ' · fiyat ' + g.fiyat.netNakit : '') + (g.satici ? ' · ' + g.satici.ad : '') + (asilan ? ' (' + asilan + ' serinin stok kontrolü aşıldı)' : '') + ' · ' + String(gerekce || '').slice(0, 80))];
    const satis = !satisYaz ? null : {
      id: g.id, satisNo: g.id, satisNoktasi: g.nokta || '', ts: new Date(satisTs).toISOString(), custName: g.musteri, custTC: '', kurumsal: false, firmaUnvan: '', vergiDairesi: '', vergiNo: '', faturaAdres: '',
      custPhone: g.telefon || '', custPhone2: '', telNorm: telNorm(g.telefon), telNorm2: '', custEmail: '', address: g.adres || '', method: g.odeme || 'Nakit',
      fiyat: g.fiyat, urunler: g.fiyat.kalemler.map((f, i) => ({ urun: f.urun, kod: f.kod, adet: f.adet, nakit: r2(f.liste / (f.adet || 1)), fiyat: r2(f.liste / (f.adet || 1)), gam: g.kalemler[i].gam, marka: g.kalemler[i].marka })),
      nakit: g.fiyat.netNakit, indirim: g.fiyat.urunIndirim, user: saticiEmail, userAd: saticiAd, tip: 'satis', ...(g.samsung ? { faturaKesen: 'samsung' } : {}), iceAktarma: { t: now, u: eposta(), gerekce: String(gerekce || '') }
    };
    try {
      if (g.mevcut) {   // GÜNCELLE: yalnız bilgi alanları (ürün/seri/teslim sürecine dokunulmaz); teslim işareti yalnız henüz teslim edilmemişse
        const yaz = { satisNo: g.id, ts: satisTs, createdAt: kayit.createdAt, ...(g.fiyat ? { fiyat: g.fiyat } : {}), ...(g.satici ? { satici: saticiEmail, saticiAd } : {}), ...(g.nokta ? { satisNoktasi: g.nokta } : {}), ...(g.odeme ? { odemeYontemi: g.odeme } : {}), ...(g.samsung ? { faturaKesen: 'samsung' } : {}) };
        const ref = b.doc(b.db, COL, g.id);
        await b.runTransaction(b.db, async tx => {
          const snap = await tx.get(ref); if (!snap.exists()) throw new SvkHata('Kayıt bulunamadı: ' + g.id);
          const sunucu = snap.data(); if (!sunucu.iceAktarma) throw new SvkHata('İçe aktarılmış kayıt değil: ' + g.id);
          const sref = b.doc(b.db, 'sales', g.id), ssn = satis ? await tx.get(sref) : null;
          const yeni = { ...yaz }; if (teslimTs && !sunucu.teslimEdildi) { yeni.teslimEdildi = kayit.teslimEdildi; yeni.durum = 'teslim_edildi'; yeni.kapali = true; }
          tx.update(ref, { ...yeni, log: [...(sunucu.log || []), logGir('ice_guncellendi', (g.fiyat ? 'fiyat ' + g.fiyat.netNakit + ' · ' : '') + (g.satici ? g.satici.ad + ' · ' : '') + String(gerekce || '').slice(0, 60))].slice(-300) });
          if (satis && !(ssn && ssn.exists() && !ssn.data().iceAktarma)) tx.set(sref, satis);   // gerçek (sepetten) satış kaydının üzerine yazılmaz
        });
        const guncel = { ...g.mevcut, ...yaz, saleNo: g.id }; state.list.set(g.id, guncel);
        sonuc.guncellenen++; if (satis) sonuc.satisKaydi++;
        continue;
      }
      await b.runTransaction(b.db, async tx => {
        const ref = b.doc(b.db, COL, g.id), sref = b.doc(b.db, 'sales', g.id), rref = b.doc(b.db, 'satisNoRez', g.id);
        const snap = await tx.get(ref);
        if (snap.exists()) throw new SvkHata('Belge No zaten kayıtlı: ' + g.id, 'kullanilmis');
        const ssn = await tx.get(sref), rsn = await tx.get(rref);
        if (ssn.exists()) throw new SvkHata('Belge No satış kayıtlarında var: ' + g.id, 'kullanilmis');
        const kilitler = g.kalemler.map((k, n) => ({ k, n })).filter(x => x.k.seri);
        const snaps = await Promise.all(kilitler.map(x => tx.get(b.doc(b.db, SERI_COL, seriDocId(x.k.seri)))));
        snaps.forEach((sn, i) => { if (sn.exists() && sn.data().saleNo !== g.id) throw new SvkHata(kilitler[i].k.seri + ' başka sevkiyatta kullanılmış (' + sn.data().saleNo + ')', 'kullanilmis'); });
        tx.set(ref, kayit);
        if (satis) tx.set(sref, satis);
        if (!rsn.exists()) tx.set(rref, { ts: now, u: eposta(), ice: true });
        kilitler.forEach(x => tx.set(b.doc(b.db, SERI_COL, seriDocId(x.k.seri)), { seri: normSeri(x.k.seri), saleNo: g.id, n: x.n, kod: String(x.k.kod || ''), musteri: g.musteri || '', u: eposta(), t: now }));
      });
      state.list.set(g.id, kayit);
      sonuc.yazilan++; sonuc.seri += seriSay; if (satis) sonuc.satisKaydi++;
    } catch (e) { sonuc.hatalar.push(g.id + ': ' + (e.message || e)); }
  }
  return sonuc;
}
// İçe aktarılmış mevcut kayıtlar → şablon biçiminde satırlar (eksik fiyat/personel/tarihi Excel'de doldurup "güncelle" ile geri yüklemek için)
export async function iceMevcutSatirlar() {
  const b = B(), sn = await b.getDocs(b.query(b.collection(b.db, COL), b.where('iceAktarma.t', '>', 0), b.limit(1000)));
  const satirlar = [ICE_BASLIK.slice()], tr = ms => { const d = new Date(Number(ms) + 3 * 3600 * 1000); return tarihTR(d.toISOString().slice(0, 10)); };
  sn.docs.map(d => ({ ...d.data(), saleNo: d.id })).filter(s => !s.silindi && !s.iptal).sort((a, c) => (a.ts || 0) - (c.ts || 0)).forEach(s => {
    const f = s.fiyat, kal = kalemListe(s);
    kal.forEach((k, i) => { const fk = f && f.kalemler && f.kalemler[i]; satirlar.push([s.saleNo, s.ts ? tr(s.ts) : '', tarihTR(s.teslimTarihi), s.teslimSaati || '', s.musteri || '', s.telefon || '', s.saticiAd && s.satici !== eposta() ? s.saticiAd : '', s.satisNoktasi || '', s.teslimTuru === 'musteri' ? 'Müşteri alır' : 'Servis götürür', s.teslimEdildi ? tr(s.teslimEdildi.t) : '', k.servis || '', k.kod || '', k.urun || '', fk ? fk.adet : '', fk ? r2(fk.liste / (fk.adet || 1)) : '', fk ? fk.net : '', i === 0 && f ? f.netNakit : '', s.odemeYontemi || '', s.faturaKesen === 'samsung' ? 'Evet' : '', k.seriNo || '', k.depo || '', s.not || '']); });
  });
  return satirlar;
}
// Mevcut kayıt için Belge No değiştirme (iç kimlik DEĞİŞMEZ; görünen 'satisNo' alanı sevkiyat + satış kaydında güncellenir). Dönüş: { ok } | { hata }
export async function belgeNoDegistir(s, yeniNo) {
  const b = B(), no = String(yeniNo || '').trim().toUpperCase();
  if (!no) return { hata: 'Belge No boş olamaz.' };
  if (idGecersiz(no) || /\s/.test(no)) return { hata: 'Belge No geçersiz (boşluk ve “/” içeremez).' };
  if (no === svkNo(s)) return { hata: 'Belge No zaten bu.' };
  try {
    const bul = async (col, alan) => (await b.getDocs(b.query(b.collection(b.db, col), b.where(alan, '==', no), b.limit(3)))).docs.filter(d => d.id !== s.saleNo);
    const kayitli = (await Promise.all([b.getDoc(b.doc(b.db, COL, no)), b.getDoc(b.doc(b.db, 'sales', no))])).some(x => x.exists() && x.id !== s.saleNo);
    if (kayitli || (await bul(COL, 'satisNo')).length || (await bul('sales', 'satisNo')).length) return { hata: 'Bu Belge No başka bir satışta kullanılıyor (' + no + ').' };
    const rz = await b.getDoc(b.doc(b.db, 'satisNoRez', no)); if (rz.exists()) return { hata: 'Bu Belge No daha önce ayrılmış/kullanılmış (' + no + ').' };
  } catch (e) { return { hata: 'Denetlenemedi (bağlantı?): ' + (e.message || e) }; }
  const eski = svkNo(s);
  const ok = await guncelle(s, () => ({ yaz: { satisNo: no } }), 'belge_no_degisti', eski + ' → ' + no, { hata: () => { /* aşağıda raporlanır */ } });
  if (!ok) return { hata: 'Kayıt güncellenemedi (internet / yetki).' };
  try { await b.setDoc(b.doc(b.db, 'satisNoRez', no), { ts: Date.now(), u: eposta(), saleNo: s.saleNo, elle: true }); } catch (_e) { /* ayırma yazılamazsa kayıt yine geçerli */ }
  try { const sr = b.doc(b.db, 'sales', s.saleNo), sn = await b.getDoc(sr); if (sn.exists()) await b.updateDoc(sr, { satisNo: no }); } catch (_e) { /* satış kaydı yoksa (içe aktarma) sorun değil */ }
  return { ok: true, eski, yeni: no };
}

// V12.7: YÖNETİCİ — satışın personelini ve/veya satış noktasını düzelt (yanlış girilmiş satışlar). Sevkiyat kaydı + satış kaydı (sales) birlikte güncellenir; hareket geçmişine eski → yeni yazılır.
//  Prim bu değişikliği satış kaydındaki user/userAd'dan okur → ay yeniden hesaplanıp "Personele yayınla" yapılmalıdır. Belge No (mağaza harfi) DEĞİŞMEZ.
export async function saticiNoktaDegistir(s, yeni) {
  const b = B(), yaz = {}, not = [], sy = {};
  const eskiEm = String(s.satici || '').toLowerCase().trim();
  if (yeni && yeni.email && String(yeni.email).toLowerCase() !== eskiEm) {
    const em = String(yeni.email).toLowerCase().trim(), ad = String(yeni.ad || '').trim() || em.split('@')[0];
    yaz.satici = em; yaz.saticiAd = ad; sy.user = em; sy.userAd = ad; not.push('Satıcı: ' + (saticiAdi(s) || '—') + ' → ' + ad);
  }
  if (yeni && yeni.nokta !== undefined && String(yeni.nokta) !== String(s.satisNoktasi || '')) {
    yaz.satisNoktasi = String(yeni.nokta); sy.satisNoktasi = String(yeni.nokta); not.push('Satış noktası: ' + (s.satisNoktasi || '—') + ' → ' + (yeni.nokta || '—'));
  }
  if (!not.length) return { degisti: false };
  const ok = await guncelle(s, () => ({ yaz }), 'satici_nokta_degisti', not.join(' · '), { hata: () => { /* aşağıda raporlanır */ } });
  if (!ok) return { hata: 'Sevkiyat kaydı güncellenemedi (internet / yetki).' };
  let satis = 'yok';
  try { const sr = b.doc(b.db, 'sales', s.saleNo), sn = await b.getDoc(sr); if (sn.exists()) { await b.updateDoc(sr, sy); satis = 'guncellendi'; } } catch (_e) { satis = 'hata'; }
  return { ok: true, degisti: true, not, satis };
}
