// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — gonderim.js  (V11.45 — Satış belgesi WhatsApp gönderim kuyruğu; V11.52: teslimat tazeleme)
//  Şirket telefonu (admin / destek) kuyruktaki satış belgesini müşteriye KVKK maskeli PDF olarak gönderir.
//  · Kuyruk: gonderimKuyrugu/{SAT-no}  { durum:'bekliyor'|'gonderildi'|'iptal', izin, pdf (snapshot), ... }
//    Yalnız müşteri onayları (KVKK aydınlatma + WhatsApp açık rızası) işaretli satışlar kuyruğa girer (app.js).
//  · PDF: mevcut maskeli satış sözleşmesi şablonu → vendor/html2pdf (yalnız bu ekranda, gerektiğinde yüklenir) → gerçek PDF dosyası.
//  · Gönderim 2 yoldur (birbirinin yedeği değil, FARKLI durumlar):
//      1) Paylaşım menüsü (navigator.share + PDF dosyası): müşteri WhatsApp'ta daha önce yazışılmış / rehberde kayıtlıysa seçilir.
//      2) Numarayla sohbet açma (wa.me / WhatsApp Business / WhatsApp Web) + PDF indirme: kayıtsız numara için; PDF elle eklenir.
//    Telefon bir numaranın rehberde olup olmadığını bilemez; bu yüzden paylaşım iptal edilirse ikinci yol önerilir.
//  · "Gönderildi" işareti DAİMA personel beyanıdır (paylaşımın başarısı kesin bilinemez). Çift gönderim işlemle engellenir.
//  · Kayıt gönderilince PDF snapshot'ı (kişisel veri) silinir; yalnız kim/ne zaman/hangi kanal kalır.
// ═══════════════════════════════════════════════════════════════
import { B, esc, dec, eposta, kullanici, depoYetkili, yonetici } from './sevkiyat-veri.js?v=V11.75-20261112-1920';

const COL = 'gonderimKuyrugu';
const LIB = new URL('./vendor/html2pdf.bundle.min.js', import.meta.url).href;
const OV = 'gnd-ov';
const BY = x => dec(x).replace(/\s+/g, ' ').trim().toLocaleUpperCase('tr-TR');   // V11.58: ekranda tamamı büyük harf (mesaj metni değişmez)
const durum = { liste: [], sureDolan: [], acik: null, dosya: null, dogru: false, adim: 'hazir', son: [], cik: [], sekme: 'bekleyen', hazir: 'yok', hazirHata: '', jeton: 0, secim: new Set() };
const IKI_GUN = 2 * 864e5;   // V11.53: gönderilenler 2 gün “Gönderilen” sekmesinde kalır, sonra Arşiv'e geçer (PDF kopyası da silinir)
const YEDI_GUN = 7 * 864e5;   // V11.66: gönderim kaydı gönderimden 7 gün sonra TAMAMEN silinir (ilk 2 gün Gönderilen, sonraki 5 gün Arşiv). Kural: firestore-kurallari-ASAMA-G.rules gonderimKuyrugu delete
const ON_BES_GUN = 15 * 864e5;   // V11.67: GÖNDERİLMEYEN (bekliyor) belge: 2 gün Bekleyen → 2–7 gün Çıkarılan → 7–15 gün Arşiv → 15. günde silinir (oluşturma anı = ts). Sürelere göre sekme istemcide türetilir (yazma yok).
const sureDoldu = k => Date.now() - (k.ts || 0) >= IKI_GUN;
const bekKalanGun = k => Math.max(1, Math.ceil(((k.ts || 0) + ON_BES_GUN - Date.now()) / 864e5));
const eskiMi = k => Date.now() - (k.gonderimT || 0) >= YEDI_GUN;
const kalanGun = k => Math.max(1, Math.ceil(((k.gonderimT || 0) + YEDI_GUN - Date.now()) / 864e5));
const yeniMi = k => Date.now() - (k.gonderimT || 0) < IKI_GUN;
const kayitBul = id => durum.liste.find(x => x.saleNo === id) || durum.son.find(x => x.saleNo === id);
let rozetTs = 0, rozetN = 0;

const $ = id => document.getElementById(id);
const tarihSaat = t => { try { return new Date(t).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_e) { return ''; } };
export const telE164 = n => { const d = String(n || '').replace(/\D/g, ''); return d.length >= 10 ? '90' + d.slice(-10) : ''; };
const telGoster = n => { const d = String(n || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? '0' + d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6, 8) + ' ' + d.slice(8) : String(n || ''); };

// Müşteriye gidecek mesaj (cinsiyet varsayımı yok)
export function mesajMetni(k) {
  const ad = dec(k.musteri || '').trim();
  return 'Sayın ' + (ad || 'Müşterimiz') + ',\n' +
    '* Satışınıza ilişkin belge ve sözleşmeniz ekte bilgilerinize sunulmuştur.\n' +
    '> Kişisel verileriniz, 6698 sayılı KVKK kapsamında korunmakta olup, bilgi güvenliğiniz ve gizliliğiniz esas alınarak gerekli hassasiyet gösterilmektedir.\n' +
    'Aygün AVM’yi tercih ettiğiniz için teşekkür eder, alışverişinizin hayırlı olmasını dileriz.';
}
export const izinTamam = k => !!(k && k.izin && k.izin.aydinlatma === true && k.izin.whatsapp === true);

// ── Kuyruk okuma (tek sorgu; ek indeks gerekmez) ──
async function bekleyenleriYukle() {
  const b = B();
  const snap = await b.getDocs(b.query(b.collection(b.db, COL), b.where('durum', '==', 'bekliyor'), b.limit(100)));
  let tum = snap.docs.map(d => ({ ...d.data(), saleNo: d.id })).sort((a, c) => (c.ts || 0) - (a.ts || 0));
  tum = await eskileriTemizle(tum, k => Date.now() - (k.ts || 0) >= ON_BES_GUN, false);   // V11.67: 15 günü dolan gönderilmemiş belge silinir
  durum.liste = tum.filter(k => !sureDoldu(k));
  durum.sureDolan = tum.filter(sureDoldu);   // 2–15 gün: Çıkarılan (2–7) / Arşiv (7–15) sekmelerinde görünür
  rozetN = durum.liste.length; rozetTs = Date.now(); rozetCiz();
  return durum.liste;
}
// V11.66: 7 günden eski gönderim kayıtlarını siler. Silmeden önce iz: sevkiyat kaydı yoksa gönderim bilgisi (t, u, kanal) sales/{no}.belgeGonderim'e yazılır (aynı batch).
// Yalnız depo yetkilisi (yönetici + destek) temizler; kural da bunu zorlar. Hata olursa kayıt kalır, sonraki açılışta yeniden denenir.
async function eskileriTemizle(liste, eskiFn, izYaz) {
  const b = B(); if (!depoYetkili() || !b.writeBatch) return liste;
  const eski = liste.filter(eskiFn || eskiMi); if (!eski.length) return liste;
  const silinen = new Set();
  for (let i = 0; i < eski.length; i += 100) {
    const dilim = eski.slice(i, i + 100);
    try {
      const wb = b.writeBatch(b.db);
      for (const k of dilim) {
        const sv = izYaz === false ? { exists: () => true } : await b.getDoc(b.doc(b.db, 'sevkiyatlar', k.saleNo));
        if (!sv.exists()) {
          const sl = await b.getDoc(b.doc(b.db, 'sales', k.saleNo));
          if (sl.exists() && !(sl.data() || {}).belgeGonderim) wb.update(b.doc(b.db, 'sales', k.saleNo), { belgeGonderim: { t: k.gonderimT || 0, u: k.gonderen || '', kanal: k.kanal || '' } });
        }
        wb.delete(b.doc(b.db, COL, k.saleNo));
      }
      await wb.commit();
      dilim.forEach(k => silinen.add(k.saleNo));
    } catch (e) { console.warn('kuyruk temizliği:', e && e.message); }
  }
  return liste.filter(k => !silinen.has(k.saleNo));
}
async function sonGonderilenler() {
  const b = B();
  const snap = await b.getDocs(b.query(b.collection(b.db, COL), b.where('durum', '==', 'gonderildi'), b.limit(150)));
  durum.son = snap.docs.map(d => ({ ...d.data(), saleNo: d.id })).sort((a, c) => (c.gonderimT || 0) - (a.gonderimT || 0));
  durum.son = await eskileriTemizle(durum.son, eskiMi, true);
  if (yonetici()) {   // arşive geçen kayıtlarda kişisel veri kopyası (pdf) kalmasın
    for (const k of durum.son.filter(x => x.pdf && !yeniMi(x))) {
      try { await b.updateDoc(b.doc(b.db, COL, k.saleNo), { pdf: b.deleteField(), arsiv: true }); delete k.pdf; } catch (_e) { /* sonraki açılışta yeniden denenir */ }
    }
  }
}
async function cikarilanlar() {
  const b = B();
  const snap = await b.getDocs(b.query(b.collection(b.db, COL), b.where('durum', '==', 'iptal'), b.limit(150)));
  durum.cik = snap.docs.map(d => ({ ...d.data(), saleNo: d.id })).sort((a, c) => (c.iptalT || 0) - (a.iptalT || 0));
}

// ── Rozet: ekran açılışında en fazla 2 dk'da bir tek "count" okuması ──
function rozetCiz() { const e = $('svk-gnd-rozet'); if (!e) return; e.textContent = rozetN > 99 ? '99+' : String(rozetN); e.style.display = rozetN > 0 ? 'block' : 'none'; }
export async function rozet() {
  if (!depoYetkili()) return;
  rozetCiz();
  if (Date.now() - rozetTs < 2 * 60 * 1000) return;
  rozetTs = Date.now();
  try {
    const b = B();
    const r = await b.getCountFromServer(b.query(b.collection(b.db, COL), b.where('durum', '==', 'bekliyor')));
    rozetN = Math.max(0, r.data().count - (durum.sureDolan || []).length); rozetCiz();   // V11.67: süresi dolanlar (2 günü geçen) Bekleyen sayısına girmez
  } catch (e) { console.warn('gönderim rozeti:', e && e.message); }
}

// ── PDF üretimi: izole iframe (uygulama CSS'ine karışmaz), dış yazı tipi beklenmez ──
export async function pdfUret(html, dosyaAdi) {
  const temiz = String(html)
    .replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '').replace(/@import\s+url\([^)]*googleapis[^)]*\)\s*;?/g, '')
    .replace('</head>', '<style>html,body{background:#fff!important;margin:0!important;padding:0!important}.page{max-width:none!important;width:794px!important;margin:0!important;box-shadow:none!important;border-radius:0!important}.print-btn{display:none!important}.pt-row,.taraflar,.odeme-wrap,.kosullar,.kosul-box,.footer,.kvkk-not,.sec-title{break-inside:avoid!important;page-break-inside:avoid!important}</style></head>')
    .replace('</body>', '<script src="' + LIB + '"><\/script></body>');
  const fr = document.createElement('iframe');
  fr.setAttribute('aria-hidden', 'true');
  fr.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;height:1123px;border:0;visibility:hidden';
  document.body.appendChild(fr);
  try {
    await new Promise((ok, no) => { const z = setTimeout(() => no(new Error('PDF kütüphanesi yüklenemedi (zaman aşımı). İnternet bağlantısını kontrol edin.')), 25000); fr.onload = () => { clearTimeout(z); ok(); }; fr.srcdoc = temiz; });
    const w = fr.contentWindow;
    for (let i = 0; i < 60 && !w.html2pdf; i++) await new Promise(r => setTimeout(r, 100));
    if (!w.html2pdf) throw new Error('PDF kütüphanesi yüklenemedi.');
    const blob = await Promise.race([
      w.html2pdf().set({ margin: 0, image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2, useCORS: true, windowWidth: 794, logging: false }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'] } })
        .from(w.document.body).outputPdf('blob'),
      new Promise((_, no) => setTimeout(() => no(new Error('PDF hazırlanamadı (zaman aşımı).')), 40000))
    ]);
    const buf = await blob.arrayBuffer();           // iframe silinmeden ana sayfaya kopyala
    return new File([buf], dosyaAdi, { type: 'application/pdf' });
  } finally { fr.remove(); }
}

// ── Arayüz ──
const CSS = '#gnd-ov,#gnd-ov *{box-sizing:border-box}#gnd-ov{position:fixed;inset:0;z-index:99990;background:var(--bg,#f4f6f5);color:var(--text-1,#14201c);display:flex;flex-direction:column;font-family:inherit}' +
  '#gnd-ov .gh{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#0f1a2e;color:#fff}#gnd-ov .gh h1{flex:1;margin:0;font-size:1.02rem}' +
  '#gnd-ov .gb{flex:1;overflow:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;max-width:640px;width:100%;margin:0 auto}' +
  '#gnd-ov button{font:inherit}#gnd-ov .gx{min-height:44px;padding:10px 14px;border-radius:10px;border:0;background:#0f7a5a;color:#fff;font-weight:700;cursor:pointer}' +
  '#gnd-ov .gx.g{background:rgba(127,127,127,.16);color:inherit}#gnd-ov .gx.r{background:#b91c1c}#gnd-ov .gx[disabled]{opacity:.45;cursor:default}' +
  '#gnd-ov .gr{display:flex;justify-content:space-between;align-items:center;gap:10px;text-align:left;width:100%;padding:11px 12px;border:1px solid rgba(127,127,127,.3);border-radius:12px;background:var(--card,#fff);color:inherit;cursor:pointer}' +
  '#gnd-ov .gr small{display:block;opacity:.7}#gnd-ov .gp{font-size:.72rem;padding:3px 8px;border-radius:99px;background:#fbead9;color:#b4540a;white-space:nowrap}#gnd-ov .gp.ok{background:#dff1ea;color:#0f7a5a}' +
  '#gnd-ov .gk{background:var(--card,#fff);border:1px solid rgba(127,127,127,.3);border-radius:12px;padding:10px 12px}' +
  '#gnd-ov .gf{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid rgba(127,127,127,.2)}#gnd-ov .gf:last-child{border:0}#gnd-ov .gf span:first-child{opacity:.7}' +
  '#gnd-ov .gt{font-size:1.5rem;font-weight:800;letter-spacing:.5px;text-align:center;padding:8px 0}' +
  '#gnd-ov .gh2{background:#dff1ea;color:#14201c;border-radius:10px;padding:9px 11px;font-size:.86rem}#gnd-ov .gh2.u{background:#fbead9}#gnd-ov .gh2.e{background:#fde2e2}' +
  '#gnd-ov label.gc{display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid rgba(127,127,127,.3);border-radius:10px;cursor:pointer}#gnd-ov label.gc input{width:22px;height:22px;flex:none;margin:0}' +
  '#gnd-ov a.gx{display:flex;align-items:center;justify-content:center;text-decoration:none}' +
  '#gnd-ov .gt2{display:flex;gap:6px}#gnd-ov .gs{flex:1;min-height:40px;padding:6px 4px;border-radius:10px;border:1px solid rgba(127,127,127,.3);background:var(--card,#fff);color:inherit;font-weight:700;cursor:pointer}#gnd-ov .gs.on{background:#0f7a5a;color:#fff;border-color:#0f7a5a}' +
  '#gnd-ov .gl{display:block;text-align:center;background:none;border:0;color:inherit;opacity:.7;text-decoration:underline;padding:8px;min-height:36px;cursor:pointer;font-size:.82rem}#gnd-ov .gl[disabled]{opacity:.35;cursor:default}#gnd-ov .gl.r{color:#b91c1c;opacity:.9}';
function overlay() {
  if (!$('gnd-css')) { const s = document.createElement('style'); s.id = 'gnd-css'; s.textContent = CSS; document.head.appendChild(s); }
  let o = $(OV); if (!o) { o = document.createElement('div'); o.id = OV; document.body.appendChild(o); o.addEventListener('click', tikla); o.addEventListener('change', degis); }
  return o;
}
export function kapat() { const o = $(OV); if (o) o.remove(); durum.acik = null; durum.dosya = null; }
const baslik = (t, geri) => '<div class="gh">' + (geri ? '<button class="gx g" data-g="liste" style="min-height:36px;padding:4px 10px">‹</button>' : '') + '<h1>' + esc(t) + '</h1><button class="gx g" data-g="kapat" style="min-height:36px;padding:4px 10px" aria-label="Kapat">✕</button></div>';

export async function ac() {
  if (!depoYetkili()) return;
  durum.sekme = 'bekleyen'; durum.sonYuk = false; durum.cikYuk = false;
  const o = overlay(); o.innerHTML = baslik('Belge gönderimi (WhatsApp)') + '<div class="gb"><div class="gh2">Yükleniyor…</div></div>';
  try { await bekleyenleriYukle(); } catch (e) { o.innerHTML = baslik('Belge gönderimi') + '<div class="gb"><div class="gh2 e">Kuyruk okunamadı: ' + esc(e.message || String(e)) + '</div><button class="gx" data-g="yenile">Tekrar dene</button></div>'; return; }
  listeCiz();
}
const KANAL = { paylasim: 'paylaşım menüsü', sohbet: 'WhatsApp (sohbet + PDF)' };
const sekmeBtn = (k, et, n) => '<button class="gs' + (durum.sekme === k ? ' on' : '') + '" data-g="sekme" data-s="' + k + '">' + et + (n == null ? '' : ' (' + n + ')') + '</button>';
function listeCiz(uyari) {
  const o = overlay(); durum.acik = null; durum.dosya = null; durum.dogru = false; durum.adim = 'hazir'; durum.hazir = 'yok'; durum.jeton++;
  const yon = yonetici(), L = durum.liste, sm = yon;   // V11.55: yöneticide onay kutuları her zaman açık (ayrı "seç" düğmesi yok)
  const sil = id => yon && !sm ? '<button class="gl r" data-g="sil" data-id="' + esc(id) + '">🗑 Kaydı sil (yönetici)</button>' : '';
  const cb = id => sm ? '<input type="checkbox" class="gcb" data-g="sec" data-id="' + esc(id) + '"' + (durum.secim.has(id) ? ' checked' : '') + ' style="width:22px;height:22px;flex:none;margin-right:10px" aria-label="Seç">' : '';
  const sonY = durum.son.filter(yeniMi), arsiv = durum.son.filter(k => !yeniMi(k));
  const otoCik = durum.sureDolan.filter(k => Date.now() - (k.ts || 0) < YEDI_GUN), otoArsiv = durum.sureDolan.filter(k => Date.now() - (k.ts || 0) >= YEDI_GUN);   // V11.67
  const sureSatir = k => '<div class="gk"><div class="gf">' + cb(k.saleNo) + '<span style="flex:1"><b>' + esc(BY(k.musteri)) + '</b><small style="display:block;opacity:.7">' + esc(k.saleNo) + ' · ' + esc(k.urun || '') + '</small></span>' +
    '<span style="text-align:right">' + esc(tarihSaat(k.ts)) + '<small style="display:block;opacity:.7">gönderilmedi</small></span></div><div class="gh2 u" style="margin-top:6px">2 gün içinde gönderilmedi · ' + bekKalanGun(k) + ' gün sonra silinir</div>' +
    (yon ? '<button class="gl" data-g="geriAl" data-id="' + esc(k.saleNo) + '">↩ Bekleyene geri al (yönetici)</button>' : '') + '</div>';
  const gonderilenSatir = (k, tekrar) => '<div class="gk"><div class="gf">' + cb(k.saleNo) + '<span style="flex:1"><b>' + esc(BY(k.musteri)) + '</b><small style="display:block;opacity:.7">' + esc(k.saleNo) + ' · ' + esc(k.urun || '') + '</small></span>' +
    '<span style="text-align:right">' + esc(tarihSaat(k.gonderimT)) + '<small style="display:block;opacity:.7">' + esc(String(k.gonderenAd || k.gonderen || '').split('@')[0]) + ' · ' + esc(KANAL[k.kanal] || k.kanal || '') + (k.tekrarSayisi ? ' · ' + (k.tekrarSayisi + 1) + '. gönderim' : '') + '</small></span></div>' +
    (tekrar ? '' : '<div class="gh2 u" style="margin-top:6px">' + kalanGun(k) + ' gün sonra silinir</div>') +
    (tekrar && yon && k.pdf && izinTamam(k) ? '<button class="gl" data-g="tekrar" data-id="' + esc(k.saleNo) + '">↻ Yeniden gönder (yönetici)</button>' : '') + sil(k.saleNo) + '</div>';
  let ic, idler;
  if (durum.sekme === 'gonderilen') {
    idler = sonY.map(k => k.saleNo);
    ic = '<div class="gh2">Gönderilenler 2 gün burada kalır, sonra arşive geçer. Yönetici dışındaki kullanıcılar bir belgeyi yalnız <b>1 kez</b> gönderebilir.</div>' +
      (sonY.length ? sonY.map(k => gonderilenSatir(k, true)).join('') : '<div class="gk" style="text-align:center;opacity:.8">Son 2 günde gönderilen belge yok.</div>');
  } else if (durum.sekme === 'arsiv') {
    idler = arsiv.map(k => k.saleNo).concat(otoArsiv.map(k => k.saleNo));
    ic = '<div class="gh2">2–7 gün önceki gönderimler (belge kopyası silinmiştir; yeniden gönderilemez). <b>Gönderimden 7 gün sonra kayıt tamamen silinir</b>; gönderim izi sevkiyat kaydında kalır.</div>' + (arsiv.length ? arsiv.map(k => gonderilenSatir(k, false)).join('') : '<div class="gk" style="text-align:center;opacity:.8">Gönderilmiş arşiv kaydı yok.</div>') +
      '<div class="gh2" style="margin-top:10px"><b>Gönderilmeyen belgeler</b> (7–15 gün; 15. günde silinir)</div>' + (otoArsiv.length ? otoArsiv.map(sureSatir).join('') : '<div class="gk" style="text-align:center;opacity:.8">Yok.</div>');
  } else if (durum.sekme === 'cikarilan') {
    idler = durum.cik.map(k => k.saleNo).concat(otoCik.map(k => k.saleNo));
    const elle = k => '<div class="gk"><div class="gf">' + cb(k.saleNo) + '<span style="flex:1"><b>' + esc(BY(k.musteri)) + '</b><small style="display:block;opacity:.7">' + esc(k.saleNo) + ' · ' + esc(k.urun || '') + '</small></span>' +
      '<span style="text-align:right">' + esc(tarihSaat(k.iptalT)) + '<small style="display:block;opacity:.7">' + esc(String(k.iptalEden || '').split('@')[0]) + '</small></span></div><div class="gh2 u" style="margin-top:6px">Neden: ' + esc(k.iptalNeden || '—') + '</div>' + sil(k.saleNo) + '</div>';
    ic = (otoCik.length ? '<div class="gh2"><b>2 gündür gönderilmeyenler</b> (7. günde Arşiv\'e geçer, 15. günde silinir)</div>' + otoCik.map(sureSatir).join('') : '') +
      (durum.cik.length ? (otoCik.length ? '<div class="gh2" style="margin-top:6px"><b>Elle çıkarılanlar</b></div>' : '') + durum.cik.map(elle).join('') : '') +
      (!otoCik.length && !durum.cik.length ? '<div class="gk" style="text-align:center;opacity:.8">Kuyruktan çıkarılan belge yok.</div>' : '');
  } else {
    idler = L.map(k => k.saleNo);
    const durumYazi = k => (!izinTamam(k) ? 'onay eksik' : (!telE164(k.telNorm || k.telefon) ? 'numara eksik' : 'bekliyor'));
    ic = L.length ? L.map(k => sm
      ? '<div style="display:flex;align-items:center;gap:8px">' + cb(k.saleNo).replace('margin-right:10px', 'margin-right:0') + '<button class="gr" data-g="detay" data-id="' + esc(k.saleNo) + '" style="flex:1"><span><b>' + esc(BY(k.musteri)) + '</b><small>' + esc(k.saleNo) + ' · ' + esc(k.urun || '') + ' · ' + esc(tarihSaat(k.ts)) + '</small></span><span class="gp">' + durumYazi(k) + '</span></button></div>'
      : '<button class="gr" data-g="detay" data-id="' + esc(k.saleNo) + '"><span><b>' + esc(BY(k.musteri)) + '</b><small>' + esc(k.saleNo) + ' · ' + esc(k.urun || '') + ' · ' + esc(tarihSaat(k.ts)) + '</small></span>' +
      '<span class="gp">' + durumYazi(k) + '</span></button>').join('')
      : '<div class="gk" style="text-align:center;opacity:.8">Gönderilecek belge yok.</div>';
  }
  durum.gorunenIdler = idler;
  const hepsi = idler.length > 0 && idler.every(x => durum.secim.has(x));
  const secBar = !yon || !idler.length ? ''
    : '<div class="gh2" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;position:sticky;top:0;z-index:2"><button class="gx g" data-g="sectum" style="min-height:38px;padding:6px 12px">' + (hepsi ? '☐ Seçimi kaldır' : '☑ Tümünü seç') + '</button><button class="gx r" data-g="topluSil" style="min-height:38px;padding:6px 12px">🗑 Seçilenleri sil (<span id="gnd-secn">' + durum.secim.size + '</span>)</button></div>';
  o.innerHTML = baslik('Belge gönderimi (WhatsApp)') + '<div class="gb">' +
    '<div class="gt2">' + sekmeBtn('bekleyen', 'Bekleyen', L.length) + sekmeBtn('gonderilen', 'Gönderilen', durum.sonYuk ? sonY.length : null) + sekmeBtn('cikarilan', 'Çıkarılan', durum.cikYuk ? durum.cik.length + otoCik.length : (otoCik.length || null)) + (yon ? sekmeBtn('arsiv', 'Arşiv', durum.sonYuk ? arsiv.length + otoArsiv.length : (otoArsiv.length || null)) : '') + '</div>' +
    (uyari ? '<div class="gh2 e">' + esc(uyari) + '</div>' : '') +
    (durum.sekme === 'bekleyen' ? '<div class="gh2">Müşteri onayı (KVKK aydınlatma + WhatsApp izni) alınmış satışlar burada bekler. Belge <b>kişisel verileri maskeli</b> PDF olarak gider. <b>2 gün içinde gönderilmeyen belge Çıkarılan\'a geçer</b> (7. günde Arşiv, 15. günde silinir).</div>' : '') +
    secBar + ic + '<button class="gx g" data-g="yenile">↻ Yenile</button></div>';
}
function detayCiz(extra) {
  const k = kayitBul(durum.acik); if (!k) return listeCiz(extra);   // kayıt başka cihazda gönderilmiş/çıkarılmış olabilir
  const o = overlay(), no = telE164(k.telNorm || k.telefon), tam = izinTamam(k), a = durum.adim, hz = durum.hazir;
  const izinSatir = tam
    ? '<div class="gh2">✓ KVKK aydınlatma sunuldu · ✓ WhatsApp ile gönderim izni alındı<br><small>' + esc(String((k.izin || {}).u || '').split('@')[0]) + ' · ' + esc(tarihSaat((k.izin || {}).t)) + '</small></div>'
    : '<div class="gh2 e"><b>Müşteri onayı eksik.</b> Bu belge gönderilemez.</div>';
  const m = encodeURIComponent(mesajMetni(k));
  const android = /Android/i.test(navigator.userAgent || '');
  const href = no ? (android ? 'intent://send?phone=' + no + '&text=' + m + '#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end' : 'https://wa.me/' + no + '?text=' + m) : '#';
  const hedef = android ? '' : ' target="_blank" rel="noopener"';
  const paylasilir = !!(durum.dosya && navigator.canShare && navigator.share && navigator.canShare({ files: [durum.dosya] }));
  const pdfSatir = hz === 'hazirlaniyor' ? '<div class="gh2 u">⏳ PDF arka planda hazırlanıyor…</div>'
    : hz === 'hata' ? '<div class="gh2 e">PDF hazırlanamadı: ' + esc(durum.hazirHata) + '</div><button class="gx g" data-g="pdftekrar">↻ PDF’i tekrar hazırla</button>' : '';
  let alt = '';
  if (!tam) alt = '';
  else if (!no) alt = '<div class="gh2 u">Telefon numarası geçersiz/eksik; bu belge WhatsApp ile gönderilemez. Kuyruktan çıkarabilirsiniz.</div>';
  else if (a === 'hazir') {
    alt = '<label class="gc"><input type="checkbox" id="gnd-dogru"' + (durum.dogru ? ' checked' : '') + '><span>Yukarıdaki <b>numarayı</b> müşteriyle teyit ettim; belge bu numaraya gönderilecek.</span></label>' + pdfSatir +
      (durum.dogru ? '<a class="gx" data-g="sohbet" href="' + href + '"' + hedef + '>💬 1) Sohbeti aç ve hazır mesajı gönderin</a>' : '<button class="gx" data-g="sohbet0" disabled>💬 1) Sohbeti aç ve hazır mesajı gönderin</button>') +
      '<button class="gl" data-g="dogrudan"' + (durum.dogru ? '' : ' disabled') + '>Sohbet zaten açık / müşteri rehberde kayıtlı → doğrudan PDF’i paylaş</button>';
  } else if (a === 'sohbet') {
    alt = '<div class="gh2">Sohbette hazır mesajı gönderdiyseniz şimdi <b>PDF’i gönderin</b>: WhatsApp Business → <b>listenin en üstündeki</b> müşteriyi seçin.</div>' + pdfSatir +
      (paylasilir || hz !== 'hazir'
        ? '<button class="gx" data-g="paylas2"' + (hz === 'hazir' && paylasilir ? '' : ' disabled') + '>📤 2) PDF’i gönder</button>'
        : '<div class="gh2 u">Bu cihazda paylaşım menüsü yok: PDF’i indirip sohbette 📎 → Belge ile ekleyin.</div><button class="gx" data-g="indir">📥 PDF’i indir</button><button class="gx g" data-g="gonderildi" data-kanal="sohbet">✅ Gönderildi olarak işaretle</button>') +
      '<a class="gl" data-g="sohbet" href="' + href + '"' + hedef + '>↩ Sohbeti yeniden aç</a>' +
      (paylasilir ? '<button class="gl" data-g="indir">📥 PDF’i indir (paylaşım çıkmazsa: sohbette 📎 → Belge)</button>' : '');
  } else if (a === 'soru') {
    alt = '<div class="gh2">Paylaşım menüsü kapandı. PDF’i müşteriye <b>gönderdiniz mi?</b></div>' +
      '<button class="gx" data-g="gonderildi" data-kanal="sohbet">✅ Evet, gönderildi</button>' +
      '<button class="gx g" data-g="paylas2">↩ Hayır, tekrar paylaş</button>';
  }
  o.innerHTML = baslik(BY(k.musteri), true) + '<div class="gb">' +
    '<div class="gk"><div class="gf"><span>Satış</span><span>' + esc(k.saleNo) + '</span></div><div class="gf"><span>Ürün</span><span>' + esc(k.urun || '') + '</span></div><div class="gf"><span>Satış tarihi</span><span>' + esc(tarihSaat(k.ts)) + '</span></div></div>' +
    '<div class="gk"><div style="opacity:.7;text-align:center">Gönderilecek numara</div><div class="gt" id="gnd-no">' + esc(no ? telGoster(k.telNorm || k.telefon) : '—') + '</div></div>' +
    izinSatir + (extra ? '<div class="gh2 e">' + esc(extra) + '</div>' : '') + alt +
    (k.durum === 'gonderildi' ? '<div class="gh2 u">Bu belge daha önce gönderilmiş (yönetici tekrar gönderimi).</div>' : '<button class="gl" data-g="iptal">Kuyruktan çıkar (gönderilmeyecek)</button>') +
    (yonetici() ? '<button class="gl r" data-g="sil" data-id="' + esc(k.saleNo) + '">🗑 Kaydı sil (yönetici)</button>' : '') + '</div>';
}
// V11.52: belgedeki teslimat bölümü satış anındaki varsayılan değil, sevkiyat kaydındaki GÜNCEL teslim şekli/tarihi olsun (okunamazsa satış anındaki değer kalır)
async function teslimTazele(k) {
  const pdf = { ...k.pdf };
  try {
    const b = B(), sn = await b.getDoc(b.doc(b.db, 'sevkiyatlar', k.saleNo));
    if (sn && sn.exists()) {
      const sv = sn.data() || {}, turler = [...new Set(Object.values(sv.kalemler || {}).map(x => x && x.teslimSekli).filter(Boolean))];
      const sekil = turler.length > 1 ? 'karma' : (turler[0] || sv.teslimTuru || (pdf.teslimat && pdf.teslimat.sekil) || '');
      if (sekil) pdf.teslimat = { sekil: sekil === 'musteri' ? 'musteri' : sekil === 'karma' ? 'karma' : 'servis', tarih: sv.teslimTarihi || (pdf.teslimat && pdf.teslimat.tarih) || '', saat: sv.teslimSaati || (pdf.teslimat && pdf.teslimat.saat) || '' };
    }
  } catch (e) { console.warn('teslimat tazeleme:', e && e.message); }
  return pdf;
}
// PDF'i detay açılır açılmaz arka planda hazırla (dokunuşlar beklemesin)
async function hazirla(k) {
  if (durum.dosya || durum.hazir === 'hazirlaniyor') return;
  if (!k.pdf) { durum.hazir = 'hata'; durum.hazirHata = 'Belge verisi kuyrukta bulunamadı (silinmiş olabilir).'; return; }
  const jt = ++durum.jeton; durum.hazir = 'hazirlaniyor'; durum.hazirHata = '';
  try {
    const f = await pdfUret(B().satisHtml(await teslimTazele(k)), 'Satis-Belgesi-' + k.saleNo + '.pdf');
    if (jt !== durum.jeton) return;
    durum.dosya = f; durum.hazir = 'hazir';
  } catch (er) { if (jt !== durum.jeton) return; durum.hazir = 'hata'; durum.hazirHata = er.message || String(er); }
  if (durum.acik === k.saleNo) detayCiz();
}

function degis(e) { const t = e.target; if (t && t.id === 'gnd-dogru') { durum.dogru = t.checked; detayCiz(); } }

async function sekmeYenile(sek) {
  durum.sekme = sek; durum.secim.clear();
  try {
    if (sek === 'gonderilen') { await sonGonderilenler(); durum.sonYuk = true; }
    else if (sek === 'arsiv') { await sonGonderilenler(); durum.sonYuk = true; await bekleyenleriYukle(); }
    else if (sek === 'cikarilan') { await cikarilanlar(); durum.cikYuk = true; await bekleyenleriYukle(); }
    else await bekleyenleriYukle();
  } catch (er) { return listeCiz('Okunamadı: ' + (er.message || er)); }
  listeCiz();
}
async function tikla(e) {
  const el = e.target.closest('[data-g]'); if (!el) return;
  const g = el.dataset.g;
  if (g === 'sohbet') {   // bağlantı kendi başına açılır; mesaj panoya da kopyalanır (WhatsApp ek metnini bazen düşürür); ekran PDF adımına geçer
    const k = kayitBul(durum.acik);
    try { if (k && navigator.clipboard) navigator.clipboard.writeText(mesajMetni(k)).catch(() => {}); } catch (_e) { /* yoksay */ }
    durum.adim = 'sohbet'; setTimeout(() => detayCiz(), 400); return;
  }
  if (g === 'sec') {   // onay kutusu: yeniden çizim yok (kaydırma kaybolmasın)
    const id = el.dataset.id; if (el.checked) durum.secim.add(id); else durum.secim.delete(id);
    const n = $('gnd-secn'); if (n) n.textContent = String(durum.secim.size); return;
  }
  if (g === 'paylas2') return paylas2();   // kullanıcı dokunuşundan hemen çağrılır (paylaşım menüsü için gerekli)
  e.preventDefault();
  if (g === 'kapat') return kapat();
  if (g === 'liste') return sekmeYenile(durum.sekme);
  if (g === 'yenile') return sekmeYenile(durum.sekme);
  if (g === 'sekme') return sekmeYenile(el.dataset.s);
  if (g === 'detay') {
    durum.acik = el.dataset.id; durum.dosya = null; durum.dogru = false; durum.adim = 'hazir'; durum.hazir = 'yok'; durum.jeton++;
    const k = kayitBul(durum.acik);
    if (k && izinTamam(k) && telE164(k.telNorm || k.telefon)) hazirla(k);
    return detayCiz();
  }
  if (g === 'tekrar') {   // yönetici: son 2 gündeki gönderilmiş belgeyi yeniden gönder
    if (!yonetici()) return;
    durum.acik = el.dataset.id; durum.dosya = null; durum.dogru = false; durum.adim = 'hazir'; durum.hazir = 'yok'; durum.jeton++;
    const k = kayitBul(durum.acik); if (k && k.pdf) hazirla(k);
    return detayCiz();
  }
    if (g === 'sectum') { const ids = durum.gorunenIdler || []; if (ids.length && ids.every(x => durum.secim.has(x))) ids.forEach(x => durum.secim.delete(x)); else ids.forEach(x => durum.secim.add(x)); return listeCiz(); }
  if (g === 'topluSil') return topluSil();
  if (g === 'dogrudan') { durum.adim = 'sohbet'; return detayCiz(); }
  if (g === 'pdftekrar') { const k = kayitBul(durum.acik); durum.hazir = 'yok'; if (k) hazirla(k); return detayCiz(); }
  if (g === 'indir') return indir();
  if (g === 'gonderildi') return isaretle(el.dataset.kanal || 'sohbet');
  if (g === 'iptal') return iptalEt();
  if (g === 'geriAl') return geriAl(el.dataset.id);
  if (g === 'sil') return sil(el.dataset.id || durum.acik);
}

function indir() {
  if (!durum.dosya) return;
  const a = document.createElement('a'); a.href = URL.createObjectURL(durum.dosya); a.download = durum.dosya.name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}
// Sohbet numarayla açılıp mesaj gönderildikten sonra: PDF'i paylaşım menüsünden (listenin başındaki o sohbete) gönder
async function paylas2() {
  if (!durum.dosya || !navigator.share) return;
  try { await navigator.share({ files: [durum.dosya] }); durum.adim = 'soru'; detayCiz(); }
  catch (er) { if (er && er.name === 'AbortError') return; detayCiz('Paylaşım menüsü açılamadı: ' + (er.message || er) + ' — PDF’i indirip sohbette 📎 → Belge ile ekleyin.'); }
}
// Yönetici: kuyruk kaydını kalıcı siler (bekleyen / gönderilen / çıkarılan). Sevkiyat kaydındaki gönderim geçmişi korunur.
async function sil(id) {
  if (!id || !yonetici()) return;
  if (!window.confirm('Bu kuyruk kaydı KALICI olarak silinsin mi?\n' + id + '\n(Sevkiyat kaydındaki gönderim geçmişi silinmez.)')) return;
  try { const b = B(); await b.deleteDoc(b.doc(b.db, COL, id)); }
  catch (er) { return detayCiz('Silinemedi: ' + (er.message || er)); }
  durum.liste = durum.liste.filter(x => x.saleNo !== id); durum.son = durum.son.filter(x => x.saleNo !== id); durum.cik = durum.cik.filter(x => x.saleNo !== id);
  rozetN = durum.liste.length; rozetCiz(); durum.acik = null; durum.dosya = null; listeCiz();
}

// Yönetici: seçilen kuyruk kayıtlarını toplu siler (Sevkiyat kaydındaki gönderim geçmişi korunur)
async function topluSil() {
  if (!yonetici()) return;
  const idler = [...durum.secim]; if (!idler.length) return listeCiz('Önce silinecek kayıtları seçin.');
  if (!window.confirm(idler.length + ' kuyruk kaydı KALICI olarak silinsin mi?\n(Sevkiyat kaydındaki gönderim geçmişi silinmez.)')) return;
  const b = B(), basarili = [], hatali = [];
  for (const id of idler) { try { await b.deleteDoc(b.doc(b.db, COL, id)); basarili.push(id); } catch (_e) { hatali.push(id); } }
  const git = new Set(basarili);
  durum.liste = durum.liste.filter(x => !git.has(x.saleNo)); durum.son = durum.son.filter(x => !git.has(x.saleNo)); durum.cik = durum.cik.filter(x => !git.has(x.saleNo));
  rozetN = durum.liste.length; rozetCiz(); durum.secim = new Set(hatali);
  listeCiz(hatali.length ? basarili.length + ' kayıt silindi, ' + hatali.length + ' kayıt silinemedi (seçili kaldı).' : '');
  if (!hatali.length) { try { if (typeof window.showToast === 'function') window.showToast(basarili.length + ' kayıt silindi', 'info'); } catch (_e) { /* yoksay */ } }
}

// Gönderildi işareti: transaction ile çift gönderim engellenir; snapshot (kişisel veri) silinir; sevkiyat hareket geçmişine yazılır
async function isaretle(kanal) {
  const b = B(), id = durum.acik; if (!id) return;
  const ben = eposta(), ad = String(kullanici().Ad || '').trim();
  try {
    await b.runTransaction(b.db, async tx => {
      const ref = b.doc(b.db, COL, id), sn = await tx.get(ref);
      if (!sn.exists()) throw new Error('Kayıt bulunamadı.');
      const d = sn.data();
      const tekrar = d.durum === 'gonderildi' && yonetici() && !!d.pdf;   // V11.53: yalnız yönetici, 2 gün içinde, belge kopyası duruyorsa tekrar gönderebilir
      if (d.durum !== 'bekliyor' && !tekrar) throw new Error('Bu belge zaten ' + (d.durum === 'gonderildi' ? 'gönderilmiş (' + String(d.gonderen || '').split('@')[0] + ' · ' + tarihSaat(d.gonderimT) + ')' : 'kuyruktan çıkarılmış') + '. İkinci kez gönderilmez.');
      const svRef = b.doc(b.db, 'sevkiyatlar', id), sv = await tx.get(svRef);
      const t = Date.now();
      // Yönetici dışı: belge kopyası (kişisel veri) hemen silinir → 1 kez. Yönetici: 2 gün saklanır (tekrar gönderebilsin), sonra arşivde silinir.
      tx.update(ref, { durum: 'gonderildi', gonderen: ben, gonderenAd: ad, gonderimT: t, kanal, ...(tekrar ? { tekrarSayisi: (d.tekrarSayisi || 0) + 1 } : {}), ...(yonetici() ? {} : { pdf: b.deleteField() }) });
      if (sv.exists()) tx.update(svRef, { belgeGonderim: { t, u: ben, kanal }, log: b.arrayUnion({ t, u: ben, a: 'belge_gonderildi', e: (KANAL[kanal] || kanal) + (tekrar ? ' (tekrar)' : '') }) });
    });
  } catch (er) { await bekleyenleriYukle().catch(() => {}); durum.adim = 'hazir'; return detayCiz(er.message || String(er)); }
  durum.liste = durum.liste.filter(x => x.saleNo !== id); rozetN = durum.liste.length; rozetCiz();
  durum.acik = null; durum.dosya = null; durum.sonYuk = false; durum.son = [];
  try { if (typeof window.showToast === 'function') window.showToast('Gönderildi olarak işaretlendi', 'info'); } catch (_e) { /* yoksay */ }
  listeCiz();
}
// V11.67 (yönetici): süresi dolan, gönderilmemiş belgeyi tekrar Bekleyen'e alır (oluşturma zamanı şimdiye çekilir → 2 gün yeniden başlar)
async function geriAl(id) {
  if (!yonetici() || !id) return;
  const b = B();
  try { await b.updateDoc(b.doc(b.db, COL, id), { ts: Date.now() }); } catch (er) { return listeCiz('Geri alınamadı: ' + (er.message || er)); }
  return sekmeYenile(durum.sekme);
}
async function iptalEt() {
  const id = durum.acik; if (!id) return;
  const neden = (window.prompt('Bu belge neden gönderilmeyecek? (zorunlu)') || '').trim();
  if (!neden) return;
  const b = B();
  try {
    await b.runTransaction(b.db, async tx => {
      const ref = b.doc(b.db, COL, id), sn = await tx.get(ref);
      if (!sn.exists() || sn.data().durum !== 'bekliyor') throw new Error('Bu kayıt artık beklemiyor.');
      tx.update(ref, { durum: 'iptal', iptalNeden: neden.slice(0, 200), iptalEden: eposta(), iptalT: Date.now(), pdf: b.deleteField() });
    });
  } catch (er) { await bekleyenleriYukle().catch(() => {}); return detayCiz(er.message || String(er)); }
  durum.liste = durum.liste.filter(x => x.saleNo !== id); rozetN = durum.liste.length; rozetCiz();
  durum.acik = null; durum.dosya = null; listeCiz();
}

window.Gonderim = { ac, kapat, rozet, mesajMetni, pdfUret, telE164 };
