// ═══════════════════════════════════════════════════════════════
//  V11.24 — MAĞAZA → DEPO TALEP MODÜLÜ
//  3 ekran, 3 durum:  Bekliyor → Yolda → Teslim alındı  (+ İptal)
//   1) Mağaza ister: ürün ara (veya sarf malzemeyi serbest yaz), +/− adet, Gönder.
//   2) Depo hazırlar: seri takipli kalemde seri okut/yaz; stok azsa adedi düşür; "Yola çıkar".
//   3) Mağaza teslim alır: kalemleri/serileri görür, eksik varsa işaretler/adet düşürür, "Teslim aldım".
//  Firestore: talepler/{id}. Belge kimliği zamanla TERS sıralıdır (en yeni önce) → orderBy/bileşik indeks gerekmez.
//  Seri kilidi YOK (seri satılmıyor); yoldaki seri satış/sevkiyatta kullanılmaya çalışılırsa kurumsal uyarıyla engellenir (yoldaSeri).
//  Resmi stok hareketi ana programda kalır; bu modül talep + hazırlık + teslim kanıtıdır. Süzgeç düzen içindir, güvenlik değildir.
// ═══════════════════════════════════════════════════════════════
import { B, esc, eposta, rol, yonetici, depoYetkili, DEPOLAR, normSeri, seriYukle, seriSahibi, seriDogrula, seriState, seriGerekir, zamanTR, yoldaSeri } from './sevkiyat-veri.js?v=V11.31-20261026-2101';
import { kameraTara } from './sevkiyat-kamera.js?v=V11.31-20261026-2101';
import * as Magaza from './sevkiyat-magaza.js?v=V11.31-20261026-2101';

const COL = 'talepler', TTL = 60 * 1000, YOLDA_TTL = 3 * 60 * 1000, SAYIM_MS = 2 * 60 * 1000;
const $ = id => document.getElementById(id);
const DURUM = { bekliyor: ['Bekliyor', 'amb'], yolda: ['Yolda', 'blu'], teslim: ['Teslim alındı', 'grn'], iptal: ['İptal', 'gry'] };
const depoMu = a => /depo\s*$/i.test(String(a));
const depoListesi = () => DEPOLAR.filter(depoMu);
const magazaListesi = () => DEPOLAR.filter(d => !depoMu(d));
let dep = { uyariGoster: h => { alert(h.message || h.mesaj || ''); return Promise.resolve(); }, onay: null, toast: null };
const state = { list: new Map(), ts: 0, ekran: 'liste', acik: null, filtre: 'aktif', yeni: null, hz: null, ta: null, mesgul: false, sonSayim: null, yoldaTs: 0, secimModu: false, secim: new Set(), rapor: null };

// ── Yetki ─────────────────────────────────────────────────────
const magazaKullanici = () => rol() === 'satis';
const olusturabilir = () => !!eposta();   // V11.25: satış, depo (mağaza adına) ve yönetici açabilir

// ── Veri ──────────────────────────────────────────────────────
function yeniId() { return 'T' + String(9e12 - Date.now()).padStart(13, '0') + Math.random().toString(36).slice(2, 5); }
function sorgu(lim) {
  const b = B(), c = b.collection(b.db, COL), m = Magaza.secili(), k = Magaza.kapsam();
  lim = lim || 100;
  if (yonetici()) return b.query(c, b.limit(lim));
  if (k === 'depo' && m) return b.query(c, b.where('depo', '==', m), b.limit(lim));
  if (k === 'magaza' && m) return b.query(c, b.where('magaza', '==', m), b.limit(lim));
  return null;
}
async function yukle(zorla) {
  if (!zorla && Date.now() - state.ts < TTL) return;
  const q = sorgu(), b = B();
  if (!q) { state.list = new Map(); state.ts = Date.now(); return; }
  const snap = await b.getDocs(q), m = new Map();
  snap.docs.forEach(d => { const v = { ...d.data(), id: d.id }; if (!v.silindi) m.set(d.id, v); });
  state.list = m; state.ts = Date.now();
}
// Yoldaki seriler (tüm talepler): sevkiyat/satış seri doğrulaması bunu kullanır
export async function yoldaYukle(zorla) {
  if (!zorla && Date.now() - state.yoldaTs < YOLDA_TTL) return;
  const b = B(); if (!b || !eposta()) return;
  try {
    const snap = await b.getDocs(b.query(b.collection(b.db, COL), b.where('durum', '==', 'yolda'), b.limit(300)));
    yoldaSeri.clear();
    snap.docs.forEach(d => { const t = d.data(); if (t.silindi) return; (t.kalemler || []).forEach(k => (k.seriler || []).forEach(s => { if (s) yoldaSeri.set(normSeri(s), { id: d.id, magaza: t.magaza, depo: t.depo }); })); });
    state.yoldaTs = Date.now();
  } catch (e) { console.warn('yoldaYukle:', e); }
}
function yoldaGuncelle(t) {
  [...yoldaSeri.entries()].forEach(([s, v]) => { if (v.id === t.id) yoldaSeri.delete(s); });
  if (t.durum === 'yolda' && !t.silindi) (t.kalemler || []).forEach(k => (k.seriler || []).forEach(s => { if (s) yoldaSeri.set(normSeri(s), { id: t.id, magaza: t.magaza, depo: t.depo }); }));
}
async function hata(m) { await dep.uyariGoster({ tur: 'genel', message: m }); }
// Sunucuda doğrulanan durum değişikliği (iki kişi aynı anda işlem yapamaz)
async function degistir(id, fn, aksiyon) {
  if (navigator.onLine === false) { await hata('Bu işlem için internet bağlantısı gerekli. Bağlantı gelince tekrar deneyin.'); return null; }
  const b = B(), ref = b.doc(b.db, COL, id); let sonuc = null;
  try {
    await b.runTransaction(b.db, async tx => {
      const sn = await tx.get(ref); if (!sn.exists()) throw new Error('Talep bulunamadı.');
      const t = sn.data(), y = fn(t);
      const log = [...(t.log || []), { t: Date.now(), u: eposta(), a: aksiyon }].slice(-40);
      tx.update(ref, { ...y, log }); sonuc = { ...t, ...y, log, id };
    });
  } catch (e) { await hata((e && e.message) || 'Kaydedilemedi.'); return null; }
  state.list.set(id, sonuc); yoldaGuncelle(sonuc); return sonuc;
}

// ── Küçük yardımcılar ─────────────────────────────────────────
const ad = e => String(e || '').split('@')[0];
const pill = d => { const x = DURUM[d] || [d, 'gry']; return '<span class="tl-pill ' + x[1] + '">' + esc(x[0]) + '</span>'; };
const toplam = t => (t.kalemler || []).reduce((a, k) => a + (Number(k.adet) || 0), 0);
function kok() {
  let o = $('svk-talep'); if (o) return o;
  o = document.createElement('div'); o.id = 'svk-talep'; o.className = 'svk-overlay';
  o.addEventListener('click', tikla); o.addEventListener('input', girdi); o.addEventListener('change', degisti);
  document.body.appendChild(o); return o;
}
const baslikHtml = (b, alt, geri) => '<div class="svk-head"><button class="svk-ib" data-a="' + (geri ? 'geri' : 'kapat') + '" aria-label="' + (geri ? 'Geri' : 'Kapat') + '">' + (geri ? '←' : '✕') + '</button><div class="svk-ht"><h1>' + esc(b) + '</h1><p>' + alt + '</p></div></div>';
const konum = () => { const m = Magaza.secili(); return m ? '📍 ' + esc(m) : (yonetici() ? 'Yönetici · tüm talepler' : ''); };
function goster(html) { const o = kok(); o.innerHTML = '<div class="svk-panel">' + html + '</div>'; o.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
export function derinlik() { const o = $('svk-talep'); if (!o || o.style.display === 'none') return 0; return state.ekran === 'liste' ? 1 : 2; }
export function kapat() { state.secimModu = false; state.secim.clear(); const o = $('svk-talep'); if (o) o.style.display = 'none'; document.body.style.overflow = ''; state.ekran = 'liste'; state.acik = null; }
export function geri() { if (derinlik() >= 2) { state.ekran = 'liste'; state.acik = null; return listeCiz(); } kapat(); return true; }

// ── 1) Liste ──────────────────────────────────────────────────
export async function ac() {
  state.ekran = 'liste'; state.acik = null; listeCiz(true);
  try { await yukle(true); } catch (e) { console.warn(e); }
  if (derinlik() === 1) listeCiz(); sayim(true);
}
function listeCiz(yukleniyor) {
  const hepsi = [...state.list.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const aktif = hepsi.filter(t => t.durum === 'bekliyor' || t.durum === 'yolda'), bitti = hepsi.filter(t => !(t.durum === 'bekliyor' || t.durum === 'yolda')).slice(0, 40);
  const l = state.filtre === 'aktif' ? aktif : bitti;
  const secMod = state.secimModu && yonetici();
  const kart = t => '<div class="svk-kart tl-kart' + (secMod && state.secim.has(t.id) ? ' tl-sec' : '') + '" data-a="' + (secMod ? 'sec' : 'ac') + '" data-id="' + esc(t.id) + '"><div class="tl-r1"><b>' + (secMod ? '<span class="tl-cb">' + (state.secim.has(t.id) ? '☑' : '☐') + '</span> ' : '')  + esc(t.magaza) + ' → ' + esc(t.depo) + '</b>' + pill(t.durum) + '</div>' +
    '<div class="tl-r2">' + (t.kalemler || []).slice(0, 3).map(k => esc(k.ad) + ' ×' + k.adet).join(' · ') + ((t.kalemler || []).length > 3 ? ' …' : '') + '</div>' +
    '<div class="tl-r3">' + zamanTR(t.ts) + ' · ' + esc(ad(t.olusturan)) + '</div></div>';
  goster(baslikHtml('Talepler', konum()) +
    '<div style="padding:12px 14px 4px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
    (olusturabilir() ? '<button class="svk-btn ana" data-a="yeni">＋ Yeni talep</button>' : '') +
    '<button class="svk-chip' + (state.filtre === 'aktif' ? ' on' : '') + '" data-a="filtre" data-k="aktif">Aktif <i>' + aktif.length + '</i></button>' +
    '<button class="svk-chip' + (state.filtre === 'bitti' ? ' on' : '') + '" data-a="filtre" data-k="bitti">Tamamlanan</button>' +
    '<span style="margin-left:auto;display:flex;gap:6px">' + (yonetici() ? '<button class="svk-ib tl-ib' + (secMod ? ' on' : '') + '" data-a="secmod" aria-label="Seçerek sil" title="Seçerek sil">☑</button>' : '') +
    '<button class="svk-ib tl-ib" data-a="rapor" aria-label="Rapor" title="Talep raporu (Excel)">📄</button>' +
    '<button class="svk-ib tl-ib" data-a="yenile" aria-label="Yenile">⟳</button></span></div>' +
    (secMod ? '<div class="tl-secbar"><b>' + state.secim.size + ' seçili</b><button class="svk-btn kucuk" data-a="tumsec">Tümünü seç</button><button class="svk-btn kucuk tehlike" data-a="toplusil"' + (state.secim.size ? '' : ' disabled') + '>🗑 Sil</button><button class="svk-btn kucuk" data-a="secmod">Vazgeç</button></div>' : '') +
    '<div class="svk-liste" style="overflow:auto;flex:1;padding-top:8px">' + (l.length ? l.map(kart).join('') :
      '<div class="svk-bos">' + (yukleniyor ? 'Yükleniyor…' : (state.filtre === 'aktif' ? 'Aktif talep yok.' : 'Tamamlanan talep yok.')) + '</div>') + '</div>');
}

// ── 2) Yeni talep (mağaza ister) ──────────────────────────────
function yeniAc() {
  let depo = ''; try { depo = localStorage.getItem('svk_talep_depo') || ''; } catch (_e) { /* yoksay */ }
  const dl = depoListesi(); if (Magaza.kapsam() === 'depo' && dl.includes(Magaza.secili())) depo = Magaza.secili();   // depo kullanıcısı: kendi deposu varsayılan
  if (!dl.includes(depo)) depo = dl[0] || '';
  state.yeni = { depo, magaza: magazaKullanici() ? (Magaza.secili() || '') : '', kalemler: [] };
  state.ekran = 'yeni'; yeniCiz();
}
function yeniCiz() {
  const y = state.yeni, dl = depoListesi();
  goster(baslikHtml('Yeni talep', konum(), true) +
    '<div style="overflow:auto;flex:1;padding:12px 14px">' +
    (magazaKullanici() && Magaza.secili() ? '' : '<label class="svk-lbl">Hangi mağaza adına?</label><select class="svk-in tam" data-i="magaza" style="width:100%;margin-bottom:10px"><option value="">Seçiniz</option>' + magazaListesi().map(m => '<option' + (y.magaza === m ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select>') +
    '<label class="svk-lbl">Hangi depodan istiyorsunuz?</label><select class="svk-in" data-i="depo" style="width:100%;margin-bottom:12px">' + dl.map(d => '<option' + (y.depo === d ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select>' +
    '<label class="svk-lbl">Ürün veya sarf malzeme</label><input id="tl-ara" class="svk-in" data-i="ara" style="width:100%" placeholder="Ürün adı/kodu yazın…" autocomplete="off" inputmode="search">' +
    '<div id="tl-sonuc"></div><div id="tl-kalemler"></div></div>' +
    '<div style="padding:12px 14px;border-top:1px solid var(--k-line);background:#fff"><button id="tl-gonder" class="svk-btn ana tam" data-a="gonder">Gönder</button></div>');
  yeniKalemCiz();
}
function yeniKalemCiz() {
  const y = state.yeni, e = $('tl-kalemler'); if (!e) return;
  e.innerHTML = y.kalemler.length ? '<div class="svk-lbl" style="margin-top:14px">İstenenler</div>' + y.kalemler.map((k, i) =>
    '<div class="tl-k"><div class="tl-kad"><b>' + esc(k.ad) + '</b>' + (k.sarf ? '<small>sarf / serbest</small>' : '<small>' + esc(k.kod) + '</small>') + '</div>' + stepper(i, k.adet) + '<button class="tl-x" data-a="sil" data-i="' + i + '" aria-label="Çıkar">✕</button></div>').join('') : '';
  const g = $('tl-gonder'); if (g) g.disabled = !y.kalemler.length;
}
const stepper = (i, n, a) => '<div class="tl-st"><button data-a="' + (a || 'eksi') + '" data-i="' + i + '" data-d="-1">−</button><b>' + n + '</b><button data-a="' + (a || 'arti') + '" data-i="' + i + '" data-d="1">+</button></div>';
function aramaCiz(q) {
  const e = $('tl-sonuc'); if (!e) return; q = q.trim();
  if (q.length < 2) { e.innerHTML = ''; return; }
  let r = []; try { r = (B().urunAra ? B().urunAra(q, 8) : []); } catch (_e) { /* yoksay */ }
  e.innerHTML = '<div class="tl-sonuc">' + r.map(x => '<button data-a="ekle" data-kod="' + esc(x.kod) + '" data-ad="' + esc(x.urun) + '"><b>' + esc(x.urun) + '</b><small>' + esc(x.kod) + '</small></button>').join('') +
    '<button class="tl-serbest" data-a="serbest" data-ad="' + esc(q) + '">✏️ “' + esc(q) + '” — serbest yaz (sarf malzeme)</button></div>';
}
function kalemEkle(k) {
  const y = state.yeni, v = y.kalemler.find(x => (k.kod && x.kod === k.kod) || (!k.kod && !x.kod && x.ad.toLocaleLowerCase('tr') === k.ad.toLocaleLowerCase('tr')));
  if (v) v.adet = Math.min(999, v.adet + 1); else y.kalemler.push({ ...k, adet: 1 });
  const a = $('tl-ara'); if (a) { a.value = ''; a.focus(); } aramaCiz(''); yeniKalemCiz();
}
async function gonder() {
  const y = state.yeni; if (state.mesgul) return;
  if (!y.magaza) return hata('Mağazayı seçiniz.');
  if (!y.depo) return hata('Depo seçiniz.');
  if (!y.kalemler.length) return hata('En az bir ürün ekleyin.');
  state.mesgul = true;
  try {
    const id = yeniId(), b = B();
    const t = { id, magaza: y.magaza, depo: y.depo, olusturan: eposta(), ts: Date.now(), durum: 'bekliyor',
      kalemler: y.kalemler.map(k => ({ ad: k.ad, kod: k.kod || '', sarf: !!k.sarf, adet: k.adet })), log: [{ t: Date.now(), u: eposta(), a: 'olusturuldu' }] };
    await b.setDoc(b.doc(b.db, COL, id), t);
    try { localStorage.setItem('svk_talep_depo', y.depo); } catch (_e) { /* yoksay */ }
    state.list.set(id, t); state.ekran = 'liste'; state.filtre = 'aktif'; listeCiz();
    if (dep.toast) dep.toast('Talep <b>' + esc(y.depo) + '</b> deposuna gönderildi.', []);
  } catch (e) { await hata('Talep gönderilemedi: ' + ((e && e.message) || e)); } finally { state.mesgul = false; }
}

// ── 3) Detay ──────────────────────────────────────────────────
async function detayAc(id) {
  const t = state.list.get(id); if (!t) return;
  state.acik = id; state.ekran = 'detay'; state.hz = null; state.ta = null;
  if (t.durum === 'bekliyor' && depoYetkili()) {
    try { await seriYukle(false); await yoldaYukle(false); } catch (_e) { /* yoksay */ }
    state.hz = { id, k: t.kalemler.map(k => ({ hazir: k.adet, seriler: [] })) };
  } else if (t.durum === 'yolda') {   // V11.26: talebi gören herkes (mağaza çalışanı, gönderen depo, yönetici) teslim alabilir
    state.ta = { id, k: t.kalemler.map(k => ({ n: k.hazir == null ? k.adet : k.hazir, sec: (k.seriler || []).map(() => true) })) };
  }
  detayCiz();
}
const serili = k => !k.sarf && !!k.kod && seriGerekir(k.kod);
function eksikSeri() {
  const t = state.list.get(state.hz.id); let n = 0;
  t.kalemler.forEach((k, i) => { if (!serili(k)) return; const h = state.hz.k[i]; for (let j = 0; j < h.hazir; j++) if (!h.seriler[j]) n++; });
  return n;
}
function detayCiz() {
  const t = state.list.get(state.acik); if (!t) return listeCiz();
  const ust = '<div class="svk-card" style="padding:12px 14px"><div class="tl-r1"><b>' + esc(t.magaza) + ' → ' + esc(t.depo) + '</b>' + pill(t.durum) + '</div><div class="tl-r3">' + zamanTR(t.ts) + ' · isteyen: ' + esc(ad(t.olusturan)) +
    (t.yolda ? '<br>Yola çıkaran: ' + esc(ad(t.yolda.u)) + ' · ' + zamanTR(t.yolda.t) : '') + (t.teslim ? '<br>Teslim alan: ' + esc(ad(t.teslim.u)) + ' · ' + zamanTR(t.teslim.t) : '') + '</div></div>';
  let govde = '', alt = '';
  if (state.hz && t.durum === 'bekliyor') {
    const ek = eksikSeri(), hic = state.hz.k.every(h => h.hazir === 0), varSeri = t.kalemler.some(serili);
    govde = (varSeri ? '<div style="padding:12px 14px 0"><button class="svk-btn koyu tam" data-a="kamera">📷 Seri okut (kamera)</button></div>' : '') +
      t.kalemler.map((k, i) => { const h = state.hz.k[i], s = serili(k);
        return '<div class="svk-card tl-hz" style="padding:12px 14px"><div class="tl-k" style="border:0;padding:0"><div class="tl-kad"><b>' + esc(k.ad) + '</b><small>istenen: ' + k.adet + (s ? ' · seri gerekli' : k.sarf ? ' · sarf' : '') + '</small></div>' + stepper(i, h.hazir, 'hz') + '</div>' +
          (h.hazir < k.adet ? '<div class="tl-uy">Stok az: ' + h.hazir + ' / ' + k.adet + ' gönderilecek</div>' : '') +
          (s ? Array.from({ length: h.hazir }, (_, j) => '<input class="svk-in tl-seri" data-i="' + i + '" data-j="' + j + '" placeholder="Seri ' + (j + 1) + '" value="' + esc(h.seriler[j] || '') + '" autocomplete="off" autocapitalize="characters">').join('') : '') + '</div>'; }).join('');
    alt = '<button class="svk-btn ana tam" data-a="yola"' + (ek || hic ? ' disabled' : '') + '>🚚 Gönder' + (ek ? ' (' + ek + ' seri eksik)' : '') + '</button>';
  } else if (state.ta && t.durum === 'yolda') {
    govde = t.kalemler.map((k, i) => { const h = state.ta.k[i], gonder = k.hazir == null ? k.adet : k.hazir, ser = k.seriler || [];
      return '<div class="svk-card" style="padding:12px 14px"><div class="tl-k" style="border:0;padding:0"><div class="tl-kad"><b>' + esc(k.ad) + '</b><small>gönderilen: ' + gonder + (gonder < k.adet ? ' (istenen ' + k.adet + ')' : '') + '</small></div>' + (ser.length ? '' : stepper(i, h.n, 'ta')) + '</div>' +
        ser.map((s, j) => '<label class="tl-chk"><input type="checkbox" data-i="' + i + '" data-j="' + j + '"' + (h.sec[j] ? ' checked' : '') + '> <span>' + esc(s) + '</span></label>').join('') + '</div>'; }).join('');
    alt = '<button class="svk-btn yesil tam" data-a="teslimal">✓ Teslim aldım</button>';
  } else {
    govde = t.kalemler.map(k => { const ser = t.durum === 'teslim' ? (k.tSeriler || []) : (k.seriler || []), g = k.hazir == null ? k.adet : k.hazir, tn = t.durum === 'teslim' ? (k.tAdet == null ? g : k.tAdet) : g;
      return '<div class="svk-card" style="padding:12px 14px"><div class="tl-r1"><b>' + esc(k.ad) + '</b><span>' + (t.durum === 'bekliyor' ? 'istenen ' + k.adet : t.durum === 'teslim' ? 'teslim ' + tn + ' / ' + k.adet : 'gönderilen ' + g + ' / ' + k.adet) + '</span></div>' +
        (ser.length ? '<div class="tl-r3 mono">' + ser.map(esc).join(' · ') + '</div>' : '') + '</div>'; }).join('');
    if (t.durum === 'yolda') alt = '<div class="tl-r3" style="text-align:center">Mağaza teslim aldığında kapanır.</div>';
  }
  const ayrac = () => (alt ? '<div style="height:8px"></div>' : '');
  if ((t.durum === 'bekliyor' && (t.olusturan === eposta() || yonetici())) || (t.durum === 'yolda' && yonetici())) alt += ayrac() + '<button class="svk-btn tehlike tam" data-a="iptal">Talebi iptal et</button>';
  if (yonetici()) alt += ayrac() + '<button class="svk-btn tehlike tam" data-a="sil">Yönetici: sil</button>';
  const sc = (document.querySelector('#svk-talep .tl-sc') || {}).scrollTop || 0;
  goster(baslikHtml('Talep', konum(), true) + '<div class="tl-sc" style="overflow:auto;flex:1;padding-bottom:12px">' + ust + govde + '</div>' + (alt ? '<div style="padding:12px 14px;border-top:1px solid var(--k-line);background:#fff">' + alt + '</div>' : ''));
  const e = document.querySelector('#svk-talep .tl-sc'); if (e) e.scrollTop = sc;
}

// ── Seri doğrulama (hazırlık) ─────────────────────────────────
function seriKontrol(seri, kod, i, j) {
  const v = normSeri(seri);
  if (seriState.seriToBilgi) { const r = seriDogrula(v, kod); if (!r.ok) return { tur: r.tur, detay: r.detay, message: r.mesaj }; }
  const h = state.hz;
  for (let a = 0; a < h.k.length; a++) for (let b = 0; b < h.k[a].seriler.length; b++) if (!(a === i && b === j) && h.k[a].seriler[b] && normSeri(h.k[a].seriler[b]) === v) return { tur: 'genel', message: 'Bu seri (' + v + ') bu talepte zaten girilmiş.' };
  return null;
}
async function seriGirildi(i, j, deger) {
  const t = state.list.get(state.acik), h = state.hz; if (!t || !h) return;
  const v = normSeri(deger);
  if (!v) { h.k[i].seriler[j] = ''; return detayCiz(); }
  await seriYukle(false); await yoldaYukle(false);
  const u = seriKontrol(v, t.kalemler[i].kod, i, j);
  if (u) { h.k[i].seriler[j] = ''; detayCiz(); await dep.uyariGoster(u); return; }
  h.k[i].seriler[j] = v; detayCiz();
}
const kisa = u => ({ yok: 'Stok listesinde yok', cikis: 'Stok çıkışı yapılmış', yanlis: 'Başka ürüne ait', yolda: 'Bu seri yolda' }[u.tur] || String(u.message || 'Reddedildi').slice(0, 70));
async function kameraKod(kod) {
  const t = state.list.get(state.acik), h = state.hz, v = normSeri(kod);
  const red = u => ({ ok: false, mesaj: kisa(u), uyari: u });
  if (!t || !h) return { ok: false, mesaj: 'Talep açık değil', bitti: true };
  await seriYukle(false); await yoldaYukle(false);
  if (!seriState.seriToBilgi) return red({ tur: 'liste', message: 'SERI_STOK listesi yüklenemedi (bağlantı sorunu olabilir).' });
  const bilgi = seriSahibi(v);
  if (!bilgi) return red({ tur: 'yok', detay: { seri: v } });
  let hi = -1, hj = -1;
  t.kalemler.forEach((k, i) => { if (hi >= 0 || !serili(k) || String(k.kod) !== String(bilgi.kod)) return; for (let j = 0; j < h.k[i].hazir; j++) if (!h.k[i].seriler[j]) { hi = i; hj = j; return; } });
  if (hi < 0) return red({ tur: 'genel', message: 'Bu seri, talepteki bir ürünün boş seri satırıyla eşleşmiyor (başka ürüne ait ya da o ürünün serileri tamam).' });
  const u = seriKontrol(v, t.kalemler[hi].kod, hi, hj); if (u) return red(u);
  h.k[hi].seriler[hj] = v; detayCiz();
  const e = eksikSeri();
  return { ok: true, mesaj: t.kalemler[hi].ad + ' → ' + v, bitti: e === 0, siradaki: e ? e + ' seri kaldı' : 'Tamam' };
}

// ── Olaylar ───────────────────────────────────────────────────
function girdi(e) {
  const t = e.target;
  if (t.id === 'tl-ara') aramaCiz(t.value);
}
async function degisti(e) {
  const t = e.target;
  if (state.ekran === 'yeni' && t.dataset.i === 'depo') state.yeni.depo = t.value;
  else if (state.ekran === 'yeni' && t.dataset.i === 'magaza') state.yeni.magaza = t.value;
  else if (t.classList.contains('tl-seri')) await seriGirildi(Number(t.dataset.i), Number(t.dataset.j), t.value);
  else if (t.type === 'checkbox' && state.ta) { state.ta.k[Number(t.dataset.i)].sec[Number(t.dataset.j)] = t.checked; }
}
async function tikla(e) {
  const el = e.target.closest('[data-a]'); if (!el || el.disabled) return;
  const a = el.dataset.a, i = Number(el.dataset.i), d = Number(el.dataset.d);
  if (a === 'kapat') return kapat();
  if (a === 'geri') return geri();
  if (a === 'filtre') { state.filtre = el.dataset.k; return listeCiz(); }
  if (a === 'yenile') { el.disabled = true; try { await yukle(true); } catch (er) { console.warn(er); } return listeCiz(); }
  if (a === 'ac') return detayAc(el.dataset.id);
  if (a === 'secmod') { if (!yonetici()) return; state.secimModu = !state.secimModu; state.secim.clear(); return listeCiz(); }
  if (a === 'sec') { const id = el.dataset.id; if (state.secim.has(id)) state.secim.delete(id); else state.secim.add(id); return listeCiz(); }
  if (a === 'tumsec') { const g = [...state.list.values()].filter(x => state.filtre === 'aktif' ? (x.durum === 'bekliyor' || x.durum === 'yolda') : !(x.durum === 'bekliyor' || x.durum === 'yolda')); const hepsi = g.every(x => state.secim.has(x.id)); g.forEach(x => hepsi ? state.secim.delete(x.id) : state.secim.add(x.id)); return listeCiz(); }
  if (a === 'toplusil') return silTalepler([...state.secim]);
  if (a === 'rapor') return raporCiz();
  if (a === 'raporindir') return raporIndir();
  if (a === 'yeni') return yeniAc();
  if (a === 'ekle') return kalemEkle({ kod: el.dataset.kod, ad: el.dataset.ad, sarf: false });
  if (a === 'serbest') return kalemEkle({ kod: '', ad: el.dataset.ad.slice(0, 80), sarf: true });
  if (a === 'sil' && state.ekran === 'yeni') { state.yeni.kalemler.splice(i, 1); return yeniKalemCiz(); }
  if (a === 'eksi' || a === 'arti') { const k = state.yeni.kalemler[i]; k.adet = Math.max(1, Math.min(999, k.adet + d)); return yeniKalemCiz(); }
  if (a === 'gonder') return gonder();
  if (a === 'hz') { const t = state.list.get(state.acik), h = state.hz.k[i]; h.hazir = Math.max(0, Math.min(t.kalemler[i].adet, h.hazir + d)); h.seriler.length = Math.min(h.seriler.length, h.hazir); return detayCiz(); }
  if (a === 'ta') { const t = state.list.get(state.acik), h = state.ta.k[i], mx = t.kalemler[i].hazir == null ? t.kalemler[i].adet : t.kalemler[i].hazir; h.n = Math.max(0, Math.min(mx, h.n + d)); return detayCiz(); }
  if (a === 'kamera') return kameraTara({ siradaki: () => { const n = eksikSeri(); return n ? n + ' seri kaldı' : 'Tamam'; }, onKod: kameraKod, uyariGoster: dep.uyariGoster, onKapat: () => { if (state.hz) detayCiz(); } });
  if (a === 'yola') return yolaCikar();
  if (a === 'teslimal') return teslimAl();
  if (a === 'sil') return silTalepler([state.acik]);
  if (a === 'iptal') return iptalSil('iptal');
}
async function yolaCikar() {
  const t0 = state.list.get(state.acik), h = state.hz; if (!t0 || !h || state.mesgul) return;
  if (eksikSeri()) return hata('Tüm ürünlerin serilerini girin (veya stok azsa adedi düşürün).');
  const kalemler = t0.kalemler.map((k, i) => ({ ...k, hazir: h.k[i].hazir, seriler: serili(k) ? h.k[i].seriler.slice(0, h.k[i].hazir).map(normSeri) : [] }));
  if (kalemler.every(k => !k.hazir)) return hata('Gönderilecek ürün yok.');
  const eksikK = kalemler.filter(k => k.hazir < k.adet).length;   // V11.27: yalnızca eksik gönderimde onay sorulur
  if (eksikK && dep.onay) { const ok = await dep.onay('Eksik gönderim', eksikK + ' kalemde istenenden az gönderiliyor. Devam edilsin mi?', 'Gönder'); if (!ok) return; }
  state.mesgul = true;
  try {
    const t = await degistir(state.acik, s => { if (s.durum !== 'bekliyor') throw new Error('Bu talep bu arada başka bir cihazda işlem görmüş (durum: ' + ((DURUM[s.durum] || [s.durum])[0]) + '). Liste yenileniyor.'); return { durum: 'yolda', kalemler, yolda: { u: eposta(), t: Date.now() } }; }, 'yola_cikti');
    if (t) { state.hz = null; state.ekran = 'liste'; state.acik = null; listeCiz(); if (dep.toast) dep.toast('Talep gönderildi; mağaza teslim alınca kapanır.', []); } else { try { await yukle(true); } catch (_e) { /* yoksay */ } listeCiz(); }
  } finally { state.mesgul = false; }
}
async function teslimAl() {
  const t0 = state.list.get(state.acik), h = state.ta; if (!t0 || !h || state.mesgul) return;
  const kalemler = t0.kalemler.map((k, i) => { const ser = k.seriler || [], x = h.k[i]; const ts = ser.filter((_, j) => x.sec[j]); return { ...k, tAdet: ser.length ? ts.length : x.n, tSeriler: ts }; });
  const eksik = kalemler.some(k => k.tAdet < (k.hazir == null ? k.adet : k.hazir));
  if (eksik && dep.onay) { const ok = await dep.onay('Eksik teslim', 'Eksik gelen ürün var; eksikler kayda geçecek. Devam edilsin mi?', 'Teslim aldım'); if (!ok) return; }
  state.mesgul = true;
  try {
    const t = await degistir(state.acik, s => { if (s.durum !== 'yolda') throw new Error('Bu talep zaten işlem görmüş (durum: ' + ((DURUM[s.durum] || [s.durum])[0]) + ').'); return { durum: 'teslim', kalemler, teslim: { u: eposta(), t: Date.now() } }; }, 'teslim_alindi');
    if (t) { state.ta = null; state.ekran = 'liste'; state.acik = null; listeCiz(); if (dep.toast) dep.toast('Teslim alındı olarak kaydedildi.', []); } else { try { await yukle(true); } catch (_e) { /* yoksay */ } listeCiz(); }
  } finally { state.mesgul = false; }
}
async function iptalSil(tur) {
  const t0 = state.list.get(state.acik); if (!t0 || state.mesgul) return;
  if (dep.onay) { const ok = await dep.onay(tur === 'sil' ? 'Talep silinsin mi?' : 'Talep iptal edilsin mi?', tur === 'sil' ? 'Talep listeden kaldırılır.' : 'Talep iptal edilir; yoldaki seriler serbest kalır.', tur === 'sil' ? 'Sil' : 'İptal et', true); if (!ok) return; }
  state.mesgul = true;
  try {
    const t = await degistir(state.acik, s => { if (tur === 'sil') return { silindi: true }; if (s.durum === 'teslim' || s.durum === 'iptal') throw new Error('Bu talep artık iptal edilemez (durum: ' + ((DURUM[s.durum] || [s.durum])[0]) + ').'); if (s.durum === 'yolda' && !yonetici()) throw new Error('Yoldaki talebi yalnızca yönetici iptal edebilir.'); return { durum: 'iptal', iptalEden: eposta() }; }, tur === 'sil' ? 'silindi' : 'iptal');
    if (t) { if (tur === 'sil') state.list.delete(state.acik); state.ekran = 'liste'; state.acik = null; listeCiz(); }
  } finally { state.mesgul = false; }
}

// ── Seçerek / tek tek silme (yönetici): kalıcı silme ──────────
async function silTalepler(idler) {
  if (!yonetici() || !idler.length || state.mesgul) return;
  if (navigator.onLine === false) return hata('Silmek için internet bağlantısı gerekli.');
  if (dep.onay) { const ok = await dep.onay(idler.length + ' talep silinsin mi?', 'Seçilen talepler kalıcı olarak silinir (geri alınamaz). Yoldaki seriler serbest kalır.', 'Sil', true); if (!ok) return; }
  state.mesgul = true; const b = B(); let n = 0; const hatalar = [];
  try {
    for (let i = 0; i < idler.length; i += 400) {
      const parca = idler.slice(i, i + 400), batch = b.writeBatch(b.db);
      parca.forEach(id => batch.delete(b.doc(b.db, COL, id)));
      try { await batch.commit(); parca.forEach(id => { state.list.delete(id); state.secim.delete(id); [...yoldaSeri.entries()].forEach(([s, v]) => { if (v.id === id) yoldaSeri.delete(s); }); }); n += parca.length; }
      catch (e) { hatalar.push((e && e.message) || String(e)); }
    }
  } finally { state.mesgul = false; }
  state.secimModu = false; state.secim.clear(); state.ekran = 'liste'; state.acik = null; listeCiz();
  if (dep.toast) dep.toast('<b>' + n + '</b> talep silindi' + (hatalar.length ? ' · bazıları silinemedi' : '') + '.', []);
  if (hatalar.length) await hata('Silinemedi: ' + hatalar[0]);
}

// ── Excel (CSV) raporu: her satır bir ürün kalemi ─────────────
const csvHucre = v => { const s = String(v == null ? '' : v).replace(/"/g, '""'); return /[;"\n\r]/.test(s) ? '"' + s + '"' : s; };
const metinHucre = v => (v === '' || v == null) ? '' : '="' + String(v).replace(/"/g, '""') + '"';
const isoGun = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const trZaman = ms => ms ? new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const sure = (a, b) => { if (!a || !b || b < a) return ''; const dk = Math.round((b - a) / 60000); return dk < 60 ? dk + ' dk' : (dk >= 1440 ? Math.floor(dk / 1440) + ' g ' : '') + Math.floor((dk % 1440) / 60) + ' sa ' + (dk % 60) + ' dk'; };
function raporCiz() {
  state.ekran = 'rapor'; const bg = new Date(), ba = new Date(); ba.setDate(ba.getDate() - 30);
  state.rapor = state.rapor || { t1: isoGun(ba), t2: isoGun(bg), iptal: false };
  const r = state.rapor;
  goster(baslikHtml('Talep raporu', konum(), true) + '<div class="svk-card" style="padding:14px"><label class="svk-lbl">Başlangıç</label><input type="date" class="svk-in" id="tl-t1" value="' + r.t1 + '" style="width:100%;margin-bottom:10px">' +
    '<label class="svk-lbl">Bitiş</label><input type="date" class="svk-in" id="tl-t2" value="' + r.t2 + '" style="width:100%;margin-bottom:12px">' +
    '<label class="tl-chk" style="font-family:inherit;border:0"><input type="checkbox" id="tl-ipt"' + (r.iptal ? ' checked' : '') + '> <span>İptal edilenleri de ekle</span></label>' +
    '<button class="svk-btn ana tam" data-a="raporindir" style="margin-top:8px">📄 Excel olarak indir</button>' +
    '<div class="tl-r3" style="margin-top:10px">Her satır bir ürün kalemidir: istenen / gönderilen / teslim edilen adet, seri numaraları, gönderen, teslim alan ve süreler.</div></div>');
}
async function raporIndir() {
  const r = state.rapor, b = B(); if (!r || state.mesgul) return;
  r.t1 = ($('tl-t1') || {}).value || r.t1; r.t2 = ($('tl-t2') || {}).value || r.t2; r.iptal = !!($('tl-ipt') || {}).checked;
  if (r.t1 > r.t2) return hata('Başlangıç tarihi bitişten sonra olamaz.');
  state.mesgul = true; let docs = [];
  try { const q = sorgu(1000); if (q) docs = (await b.getDocs(q)).docs.map(d => ({ ...d.data(), id: d.id })); }
  catch (e) { state.mesgul = false; return hata('Rapor alınamadı: ' + ((e && e.message) || e)); }
  state.mesgul = false;
  const bas = new Date(r.t1 + 'T00:00:00').getTime(), son = new Date(r.t2 + 'T23:59:59').getTime();
  const liste = docs.filter(x => !x.silindi && x.ts >= bas && x.ts <= son && (r.iptal || x.durum !== 'iptal')).sort((a, c) => a.ts - c.ts);
  const baslik = ['Talep Tarihi', 'Mağaza', 'Depo', 'İsteyen', 'Durum', 'Ürün Kodu', 'Ürün / Sarf', 'Tür', 'İstenen Adet', 'Gönderilen Adet', 'Teslim Edilen Adet', 'Seri No', 'Gönderen', 'Gönderim Zamanı', 'Teslim Alan', 'Teslim Zamanı', 'Hazırlama Süresi', 'Toplam Süre'];
  const satir = [];
  liste.forEach(x => (x.kalemler || []).forEach(k => {
    const g = x.durum === 'bekliyor' || x.durum === 'iptal' ? '' : (k.hazir == null ? k.adet : k.hazir), tn = x.durum === 'teslim' ? (k.tAdet == null ? g : k.tAdet) : '';
    const sr = x.durum === 'teslim' ? (k.tSeriler || []) : (k.seriler || []);
    satir.push([trZaman(x.ts), x.magaza, x.depo, ad(x.olusturan), (DURUM[x.durum] || [x.durum])[0], metinHucre(k.kod), k.ad, k.sarf ? 'Sarf / serbest' : 'Ürün', k.adet, g, tn, metinHucre(sr.join(' / ')),
      x.yolda ? ad(x.yolda.u) : '', x.yolda ? trZaman(x.yolda.t) : '', x.teslim ? ad(x.teslim.u) : '', x.teslim ? trZaman(x.teslim.t) : '', x.yolda ? sure(x.ts, x.yolda.t) : '', x.teslim ? sure(x.ts, x.teslim.t) : '']);
  }));
  if (!satir.length) return hata(r.t1.split('-').reverse().join('.') + ' – ' + r.t2.split('-').reverse().join('.') + ' aralığında rapora girecek talep bulunamadı.');
  const csv = '\ufeff' + [baslik].concat(satir).map(s => s.map(csvHucre).join(';')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = 'talep-raporu_' + r.t1 + (r.t1 === r.t2 ? '' : '_' + r.t2) + '.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  if (dep.toast) dep.toast('<b>' + satir.length + '</b> satır indirildi (' + liste.length + ' talep)' + (docs.length >= 1000 ? ' · en yeni 1000 talep tarandı, aralığı daraltın' : '') + '.', []);
}

// ── Sekme + rozet ─────────────────────────────────────────────
function rozet(n) { const e = $('talep-tab-rozet'); if (!e) return; e.textContent = n > 0 ? (n > 99 ? '99+' : n) : ''; e.style.display = n > 0 ? '' : 'none'; }
// Depo: bekleyen talep sayısı · Mağaza: yoldaki (teslim alınacak) talep sayısı · Yönetici: bekleyen
async function sayim(zorla) {
  if (document.hidden || !eposta()) return;
  const b = B(), c = b.collection(b.db, COL), m = Magaza.secili(), k = Magaza.kapsam(); let q = null;
  if (yonetici()) q = b.query(c, b.where('durum', '==', 'bekliyor'));
  else if (k === 'depo' && m) q = b.query(c, b.where('depo', '==', m), b.where('durum', '==', 'bekliyor'));
  else if (k === 'magaza' && m) q = b.query(c, b.where('magaza', '==', m), b.where('durum', '==', 'yolda'));
  if (!q) return rozet(0);
  try {
    const n = (await b.getCountFromServer(q)).data().count;
    if (state.sonSayim !== null && n > state.sonSayim && !zorla && dep.toast) {
      dep.toast(k === 'magaza' ? 'Yolda talebiniz var: teslim alabilirsiniz.' : 'Yeni talep bekliyor (' + n + ')', [['Aç', ac]]);
      try { if (navigator.vibrate) navigator.vibrate([80, 40, 80]); } catch (_e) { /* yoksay */ }
    }
    state.sonSayim = n; rozet(n);
  } catch (e) { console.warn('talep sayim:', e); }
}
function navEkle() {
  if ($('tab-btn-talep')) return;
  const ref = $('tab-btn-sevkiyat') || $('tab-btn-teklifler'); if (!ref) return;
  const btn = document.createElement('button');
  btn.className = 'tab-btn'; btn.id = 'tab-btn-talep'; btn.style.display = 'flex';
  btn.innerHTML = '<span class="tab-icon">📦</span><span class="tab-label">Talepler</span><span class="svk-tabrozet" id="talep-tab-rozet" style="display:none"></span>';
  btn.onclick = ac; ref.insertAdjacentElement('afterend', btn);
}
const CSS = '.tl-pill{font-size:.68rem;font-weight:800;padding:3px 9px;border-radius:99px;white-space:nowrap}.tl-pill.amb{background:#FEF3C7;color:#B45309}.tl-pill.blu{background:#DBEAFE;color:#1D4ED8}.tl-pill.grn{background:#DCFCE7;color:#15803D}.tl-pill.gry{background:#E5E7EB;color:#6B7280}' +
  '.tl-r1{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:.92rem}.tl-r2{margin-top:6px;font-size:.8rem;color:var(--k-ink2)}.tl-r3{margin-top:5px;font-size:.72rem;color:var(--k-mut)}.tl-r3.mono{font-family:ui-monospace,monospace;word-break:break-all}' +
  '.tl-k{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--k-line)}.tl-kad{flex:1;min-width:0}.tl-kad b{display:block;font-size:.88rem}.tl-kad small{color:var(--k-mut);font-size:.7rem}' +
  '.tl-st{display:inline-flex;align-items:center;gap:2px}.tl-st button{width:36px;height:36px;border-radius:10px;border:1px solid #D0D4DD;background:#fff;font:700 1.1rem system-ui;cursor:pointer;color:var(--k-ink)}.tl-st b{min-width:34px;text-align:center;font-size:1rem}' +
  '.tl-x{border:0;background:none;color:var(--k-mut);font-size:1rem;cursor:pointer;padding:6px}' +
  '.tl-sonuc{margin-top:6px;background:#fff;border:1px solid var(--k-line);border-radius:12px;overflow:hidden}.tl-sonuc button{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--k-line);padding:11px 12px;font:inherit;cursor:pointer;color:var(--k-ink)}.tl-sonuc button b{display:block;font-size:.84rem}.tl-sonuc button small{color:var(--k-mut);font-size:.7rem}.tl-sonuc .tl-serbest{color:var(--k-blu);font-weight:700;font-size:.82rem}' +
  '.tl-ib{background:#fff;color:#16171B;border-color:#D5D9E2}.tl-ib.on{background:#16171B;color:#fff}.tl-secbar{display:flex;gap:8px;align-items:center;padding:6px 14px;flex-wrap:wrap}.tl-secbar b{margin-right:auto;font-size:.8rem}.tl-kart.tl-sec{border-color:var(--k-red);background:#FFF7F8}.tl-cb{font-size:1.05rem}.tl-seri{width:100%;margin-top:8px;box-sizing:border-box;font-family:ui-monospace,monospace}.tl-uy{margin-top:6px;font-size:.74rem;font-weight:700;color:var(--k-amb)}.tl-chk{display:flex;align-items:center;gap:10px;padding:10px 2px;font-family:ui-monospace,monospace;font-size:.85rem;border-top:1px solid var(--k-line)}.tl-chk input{width:20px;height:20px}';
export function init(d) {
  dep = { ...dep, ...d };
  if (!$('svk-talep-stil')) { const s = document.createElement('style'); s.id = 'svk-talep-stil'; s.textContent = CSS; document.head.appendChild(s); }
  navEkle();
  Magaza.onDegis(() => { state.ts = 0; state.sonSayim = null; sayim(true); if (derinlik() === 1) { yukle(true).then(listeCiz).catch(() => {}); } });
  setInterval(() => sayim(false), SAYIM_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sayim(false); });
  setTimeout(() => sayim(true), 6000);
}
