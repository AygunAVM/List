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
function tanimUygula(t) {
  if (!t) return;
  if (t.markaServis && typeof t.markaServis === 'object') {
    Object.keys(MARKA_SERVIS).forEach(k => delete MARKA_SERVIS[k]);
    Object.keys(t.markaServis).forEach(m => { const mm = String(m).trim().slice(0, 40), l = tanimTemizle(t.markaServis[m]); if (mm && l.length) MARKA_SERVIS[mm] = l; });
  }
  [['servisler', SERVISLER], ['depolar', DEPOLAR], ['noktalar', SATIS_NOKTALARI]].forEach(([k, dizi]) => {
    const y = tanimTemizle(t[k]);
    if (y.length || Array.isArray(t[k])) dizi.splice(0, dizi.length, ...y);
  });
}
try { const o = JSON.parse(localStorage.getItem(TANIM_LS) || 'null'); if (o && o.veri) tanimUygula(o.veri); } catch (_e) { /* yoksay */ }
export const tanimDegisti = []; // dinleyiciler (form seçeneklerini yenilemek için)
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
export const seriYetkili = s => depoYetkili() || (rol() === 'satis' && !!s && !!eposta() && String(s.satici || '').toLowerCase() === eposta().toLowerCase());

// Kalemler map olarak saklanır ({"0":{...}}) → noktalı yol güncellemesi (kalemler.0.seriNo)
export const kalemListe = s => Object.keys(s.kalemler || {}).sort((a, b) => a - b)
  .map(k => { const x = { ...s.kalemler[k], n: Number(k) }; if (!String(x.urun || '').trim() || String(x.urun).trim() === String(x.kod || '').trim()) { const ad = B() && B().urunAdi ? B().urunAdi(x.kod) : ''; if (ad && ad !== x.kod) x.urun = ad; } return x; })   // V11.18: ürün adı yerine kod yazılmış eski kayıtlar ekranda ürün adıyla görünür
  .filter(k => !k.cikarildi);   // cikarildi: V11.2 "satırı çıkar" (soft)
// SERI KURALI (V11.2): ürün kodu seriler.json'da (Stok Kodu) varsa seri ZORUNLUDUR — serisiz çıkış yapılamaz.
// Kod listede yoksa seri gerekmez (satır otomatik tamam sayılır). Liste yüklenemediyse güvenli taraf: seri gerekir.
// Seri takibi: (1) ürün tablosunda SeriTakip sütunu varsa o (E/H); (2) ürün kodu seriler.json'da şu an VAR ya da daha önce görülmüş
// (kalıcı kayıt: stoğu biten seri takipli ürün “seri gerekmez” sanılmasın); (3) hiç görülmemişse seri gerekmez.
export function seriGerekir(kod) {
  const k = String(kod == null ? '' : kod).trim();
  try {
    const p = B() && B().urunBul && B().urunBul(k), st = p && String(p.SeriTakip ?? p.seriTakip ?? '').trim().toUpperCase();
    if (st === 'E') return true; if (st === 'H') return false;
  } catch (_e) { /* yoksay */ }
  if (!seriState.kodlar) return true;
  return seriState.kodlar.has(k) || seriState.bilinen.has(k);
}
export const kalemSerisiz = k => !!k.seriGerekliDegil || !seriGerekir(k.kod);
export const kalemDepoEksik = s => !!s.depoZorunlu && kalemListe(s).some(k => !String(k.depo || '').trim());
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
    if (kod && k.seriNo && String(k.seriNo).trim() && !seriState.bilinen.has(kod)) { seriState.bilinen.add(kod); yeni.push(kod); }
  }));
  if (yeni.length) bilinenKaydet(yeni);
}
export const normSeri = s => String(s || '').trim().toUpperCase();
export const seriDocId = s => encodeURIComponent(normSeri(s));

export async function seriYukle(force) {
  if (!force && seriState.seriToBilgi && Date.now() - seriState.ts < SERI_TTL_MS) return;
  try {
    // V11.21: koşullu istek (304) — dosya değişmediyse 350 KB inmez ve yeniden ayrıştırılmaz
    const r = await fetch(B().dataUrl('seriler.json'), { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const imza = r.headers.get('etag') || r.headers.get('last-modified') || '';
    if (imza && imza === seriState.imza && seriState.seriToBilgi) { seriState.ts = Date.now(); seriState.hata = false; return; }
    const j = await r.json();
    const rows = Array.isArray(j.data) ? j.data : (Array.isArray(j) ? j : []);
    const s2b = new Map(), k2s = new Map(), kodlar = new Set();
    rows.forEach(row => {
      const kod = String(row.kod ?? row.Kod ?? row['Stok Kodu'] ?? '').trim();
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
  if (String(bilgi.kod) !== String(kod)) {
    const beklenen = (seriState.kodToSeriler.get(String(kod)) || []);
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
  // Rev 11.10: satış personeli de TÜM açık sevkiyatları görür (müşteriye süreç bilgisi verebilmek için); önbellek süresi 5 dk
  if (!force && Date.now() - state.aktifTs < (depoYetkili() ? TTL_MS : 5 * TTL_MS)) return;
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
  const d = telNorm(q), harf = /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(q), satNo = /^sat[-\s]?\d+/i.test(q);
  const calis = async (col, ...w) => {
    try { const sn = await b.getDocs(b.query(b.collection(b.db, col), ...w, b.limit(25))); return sn.docs.map(x => ({ ...x.data(), _id: x.id })); }
    catch (e) { console.warn('musteriSorgula', col, e); return []; }
  };
  const duz = a => a.flat();
  let sv = [], sa = [], te = [];
  if (satNo) {
    const no = q.toUpperCase().replace(/\s+/g, '-').replace(/^SAT(\d)/, 'SAT-$1');
    try { const sn = await b.getDoc(b.doc(b.db, COL, no)); if (sn.exists()) sv = [{ ...sn.data(), _id: sn.id }]; } catch (e) { console.warn(e); }
    try { const sn = await b.getDoc(b.doc(b.db, 'sales', no)); if (sn.exists()) sa = [{ ...sn.data(), _id: sn.id }]; } catch (e) { console.warn(e); }
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
  } else throw new Error('Telefon numarasını (10-11 hane), müşteri adını ya da SAT-numarasını yazın.');
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
    const yaz = yazOrFn;
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
      const yaz = plan.yaz || {};
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
export function olustur(sale, v, not) {
  const b = B();
  const now = Date.now();
  const fo = sale.fiyat && sale.fiyat.odeme;
  const teslimdeNot = fo && fo.pesinSekli === 'Teslimde' && Number(fo.pesin) > 0 ? 'Teslimde nakit tahsil edilecek: ' + tl(fo.pesin) : '';   // peşin “teslimde alınacak” ise servis/teslim notu otomatik
  const tahsilat = Math.max(0, Number(v.tahsilat) || 0);
  const tur = v.tur === 'musteri' ? 'musteri' : 'servis';
  const kalemler = {};
  (sale.urunler || []).forEach((i, n) => {
    const pb = (b.urunBul && b.urunBul(i.kod)) || {};   // V11.14: servis mesajı markaya göre bloklanır
    kalemler[String(n)] = { urun: i.urun || '', kod: i.kod || '', seriNo: '', seriGerekliDegil: false, depo: '', teslimSekli: tur,
      marka: String(pb['Marka'] || pb.marka || '').trim(), gam: String(i.gam || pb['Ürün Gamı'] || pb.gam || '').trim() };
  });
  const kayit = {
    saleNo: sale.id, ts: now, createdAt: new Date(now).toISOString(), telNorm: telNorm(sale.custPhone), telNorm2: telNorm(sale.custPhone2),
    musteri: dec(sale.custName), telefon: sale.custPhone || '', telefon2: sale.custPhone2 || '',
    adres: sale.address || '', tc: sale.custTC || '', email: sale.custEmail || '', odemeYontemi: sale.method || '',
    satici: sale.user || eposta(),
    satisNoktasi: v.nokta || '', teslimTarihi: v.tarih, teslimSaati: v.saat || '',
    teslimTuru: tur, atananServis: tur === 'musteri' ? '' : (v.servis || ''), not: [teslimdeNot, dec(not || ''), v.not ? dec(v.not) : ''].filter(Boolean).join(' · '),
    fiyat: sale.fiyat || null,
    tahsilatTutari: tahsilat, tahsilatAlindi: null,
    kalemler, depoZorunlu: !v.yetim && DEPOLAR.length > 0, kilitli: false, servisTeslim: null, teslimEdildi: null, iptal: false,
    durum: 'barkod_bekliyor', kapali: false, log: [logGir(v.yetim ? 'yetim_satistan_olusturuldu' : 'olusturuldu')]
  };
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
