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
export const SERVISLER = ['Sm-Tv', 'Sm-Be', 'Sm-Kl', 'Sm-İlçe', 'Vs-Barel', 'Vs-Can', 'Vs-İlçe', 'Aygün Sevk'];
export const SATIS_NOKTALARI = ['SP', 'NF', 'VŞ', 'SÇ', 'Diğer'];
export const DURUMLAR = {
  // Kırmızı yalnızca GECİKME ve hata için ayrılmıştır (durum renkleri kırmızı kullanmaz)
  // Not: depolanan anahtar 'barkod_bekliyor' korunur (Firestore sorguları/kayıtlar); yalnızca etiket değişti.
  barkod_bekliyor: { label: 'Seri Bekliyor',         renk: '#475569', bg: '#EEF2F6' },
  hazirlaniyor:    { label: 'Hazırlanıyor',          renk: '#B45309', bg: '#FFF4DB' },
  depoda_hazir:    { label: 'Depoda Hazır',          renk: '#15803D', bg: '#E6F6EC' },
  serviste:        { label: 'Çıkış Bekliyor', renk: '#1D4ED8', bg: '#E7EFFE' },
  teslim_edildi:   { label: 'Tamamlandı',            renk: '#374151', bg: '#E5E7EB' },
  iade:            { label: 'İade / Depoya Döndü',   renk: '#7C3AED', bg: '#F1EBFE' },
  iptal:           { label: 'İptal Edildi',          renk: '#6B7280', bg: '#F1F2F5' }
};
export const FILTRELER = [
  ['aktif', 'Aktif'], ['barkod_bekliyor', 'Seri Bekliyor'], ['hazirlaniyor', 'Hazırlanıyor'],
  ['depoda_hazir', 'Depoda Hazır'], ['serviste', 'Çıkış Bekliyor'], ['teslim_edildi', 'Tamamlanan'], ['iade', 'İade'], ['iptal', 'İptal']
];
// Eski kayıtlarda teslimTuru yok: atananServis 'Müşteriye Teslim' ise müşteri teslimi sayılır
export const teslimTuru = s => s.teslimTuru || (s.atananServis === 'Müşteriye Teslim' ? 'musteri' : 'servis');
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

// Kalemler map olarak saklanır ({"0":{...}}) → noktalı yol güncellemesi (kalemler.0.seriNo)
export const kalemListe = s => Object.keys(s.kalemler || {}).sort((a, b) => a - b)
  .map(k => ({ ...s.kalemler[k], n: Number(k) })).filter(k => !k.cikarildi);   // cikarildi: V11.2 "satırı çıkar" (soft)
// SERI KURALI (V11.2): ürün kodu seriler.json'da (Stok Kodu) varsa seri ZORUNLUDUR — serisiz çıkış yapılamaz.
// Kod listede yoksa seri gerekmez (satır otomatik tamam sayılır). Liste yüklenemediyse güvenli taraf: seri gerekir.
export function seriGerekir(kod) {
  if (!seriState.kodlar) return true;
  return seriState.kodlar.has(String(kod == null ? '' : kod).trim());
}
export const kalemTamam = k => !!(k.seriNo && String(k.seriNo).trim()) || !seriGerekir(k.kod);

export function durumHesapla(s) {
  if (s.iptal) return 'iptal';
  if (s.iade) return 'iade';
  if (s.teslimEdildi) return 'teslim_edildi';
  if (s.servisTeslim) return 'serviste';
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
export const seriState = { seriToBilgi: null, kodToSeriler: null, kodlar: null, ts: 0, hata: false, satir: 0 };
export const normSeri = s => String(s || '').trim().toUpperCase();
export const seriDocId = s => encodeURIComponent(normSeri(s));

export async function seriYukle(force) {
  if (!force && seriState.seriToBilgi && Date.now() - seriState.ts < SERI_TTL_MS) return;
  try {
    const r = await fetch(B().dataUrl('seriler.json') + '?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
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
    seriState.seriToBilgi = s2b; seriState.kodToSeriler = k2s; seriState.kodlar = kodlar;
    seriState.ts = Date.now(); seriState.hata = false; seriState.satir = rows.length;
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
    if (!seri) return { k, durum: seriGerekir(k.kod) ? 'seri_yok' : 'serisiz', seri: '' };
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
  return { ok: true };
}

// ── Listeleme ──────────────────────────────────────────────────
export async function yukle(force) {
  const b = B();
  const c = b.collection(b.db, COL);
  if (!depoYetkili()) {
    if (!force && Date.now() - state.aktifTs < TTL_MS) return;
    const snap = await b.getDocs(b.query(c, b.where('satici', '==', eposta()), b.limit(300)));
    state.list.clear();
    snap.docs.forEach(d => { const v = d.data(); if (!v.silindi) state.list.set(d.id, { ...v, saleNo: d.id }); });
    state.aktifTs = state.gecmisTs = Date.now();
    return;
  }
  if (!force && Date.now() - state.aktifTs < TTL_MS) return;
  const snap = await b.getDocs(b.query(c, b.where('kapali', '==', false), b.limit(300)));
  for (const [k, v] of state.list) if (!v.kapali) state.list.delete(k);
  snap.docs.forEach(d => { const v = d.data(); if (!v.silindi) state.list.set(d.id, { ...v, saleNo: d.id }); });
  state.aktifTs = Date.now();
}
export async function gecmisYukle(force) {
  if (!depoYetkili()) return;
  if (!force && Date.now() - state.gecmisTs < TTL_MS) return;
  const b = B();
  const snap = await b.getDocs(b.query(b.collection(b.db, COL), b.orderBy('ts', 'desc'), b.limit(80)));
  snap.docs.forEach(d => { const v = d.data(); if (!v.silindi) state.list.set(d.id, { ...v, saleNo: d.id }); });
  state.gecmisTs = Date.now();
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
  if (typeof yazOrFn === 'function') { try { await seriYukle(false); } catch (e) {} } // durum hesabı için kod listesi

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
      const kapali = !!(g.teslimEdildi || g.iptal || g.iade);
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
  const kalemler = {};
  (sale.urunler || []).forEach((i, n) => {
    kalemler[String(n)] = { urun: i.urun || '', kod: i.kod || '', seriNo: '', seriGerekliDegil: false };
  });
  const tahsilat = Math.max(0, Number(v.tahsilat) || 0);
  const tur = v.tur === 'musteri' ? 'musteri' : 'servis';
  const kayit = {
    saleNo: sale.id, ts: now, createdAt: new Date(now).toISOString(),
    musteri: dec(sale.custName), telefon: sale.custPhone || '', telefon2: sale.custPhone2 || '',
    adres: sale.address || '', tc: sale.custTC || '', email: sale.custEmail || '', odemeYontemi: sale.method || '',
    satici: sale.user || eposta(),
    satisNoktasi: v.nokta || '', teslimTarihi: v.tarih, teslimSaati: v.saat || '',
    teslimTuru: tur, atananServis: tur === 'musteri' ? '' : (v.servis || ''), not: [dec(not || ''), v.not ? dec(v.not) : ''].filter(Boolean).join(' · '),
    tahsilatTutari: tahsilat, tahsilatAlindi: null,
    kalemler, kilitli: false, servisTeslim: null, teslimEdildi: null, iptal: false,
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
