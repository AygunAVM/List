// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — gonderim.js  (V11.45 — Satış belgesi WhatsApp gönderim kuyruğu)
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
import { B, esc, dec, eposta, kullanici, depoYetkili } from './sevkiyat-veri.js?v=V11.48-20261105-1128';

const COL = 'gonderimKuyrugu';
const LIB = new URL('./vendor/html2pdf.bundle.min.js', import.meta.url).href;
const OV = 'gnd-ov';
const durum = { liste: [], acik: null, dosya: null, dogru: false, adim: 'hazir', son: [] };
let rozetTs = 0, rozetN = 0;

const $ = id => document.getElementById(id);
const tarihSaat = t => { try { return new Date(t).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (_e) { return ''; } };
export const telE164 = n => { const d = String(n || '').replace(/\D/g, ''); return d.length >= 10 ? '90' + d.slice(-10) : ''; };
const telGoster = n => { const d = String(n || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? '0' + d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6, 8) + ' ' + d.slice(8) : String(n || ''); };

// Müşteriye gidecek mesaj (cinsiyet varsayımı yok)
export function mesajMetni(k) {
  const ad = dec(k.musteri || '').trim();
  return 'Sayın ' + (ad || 'Müşterimiz') + ',\n' + k.saleNo + ' numaralı satış belgeniz ekte yer almaktadır. Kişisel verileriniz 6698 sayılı KVKK kapsamında maskelenmiştir.\nBizi tercih ettiğiniz için teşekkür ederiz.\nAygün AVM';
}
export const izinTamam = k => !!(k && k.izin && k.izin.aydinlatma === true && k.izin.whatsapp === true);

// ── Kuyruk okuma (tek sorgu; ek indeks gerekmez) ──
async function bekleyenleriYukle() {
  const b = B();
  const snap = await b.getDocs(b.query(b.collection(b.db, COL), b.where('durum', '==', 'bekliyor'), b.limit(100)));
  durum.liste = snap.docs.map(d => ({ ...d.data(), saleNo: d.id })).sort((a, c) => (c.ts || 0) - (a.ts || 0));
  rozetN = durum.liste.length; rozetTs = Date.now(); rozetCiz();
  return durum.liste;
}
async function sonGonderilenler() {
  const b = B();
  const snap = await b.getDocs(b.query(b.collection(b.db, COL), b.where('durum', '==', 'gonderildi'), b.limit(40)));
  durum.son = snap.docs.map(d => ({ ...d.data(), saleNo: d.id })).sort((a, c) => (c.gonderimT || 0) - (a.gonderimT || 0)).slice(0, 20);
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
    rozetN = r.data().count; rozetCiz();
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
  '#gnd-ov a.gx{display:flex;align-items:center;justify-content:center;text-decoration:none}';
function overlay() {
  if (!$('gnd-css')) { const s = document.createElement('style'); s.id = 'gnd-css'; s.textContent = CSS; document.head.appendChild(s); }
  let o = $(OV); if (!o) { o = document.createElement('div'); o.id = OV; document.body.appendChild(o); o.addEventListener('click', tikla); o.addEventListener('change', degis); }
  return o;
}
export function kapat() { const o = $(OV); if (o) o.remove(); durum.acik = null; durum.dosya = null; }
const baslik = (t, geri) => '<div class="gh">' + (geri ? '<button class="gx g" data-g="liste" style="min-height:36px;padding:4px 10px">‹</button>' : '') + '<h1>' + esc(t) + '</h1><button class="gx g" data-g="kapat" style="min-height:36px;padding:4px 10px" aria-label="Kapat">✕</button></div>';

export async function ac() {
  if (!depoYetkili()) return;
  const o = overlay(); o.innerHTML = baslik('Belge gönderimi (WhatsApp)') + '<div class="gb"><div class="gh2">Yükleniyor…</div></div>';
  try { await bekleyenleriYukle(); } catch (e) { o.innerHTML = baslik('Belge gönderimi') + '<div class="gb"><div class="gh2 e">Kuyruk okunamadı: ' + esc(e.message || String(e)) + '</div><button class="gx" data-g="yenile">Tekrar dene</button></div>'; return; }
  listeCiz();
}
function listeCiz(uyari) {
  const o = overlay(); durum.acik = null; durum.dosya = null; durum.dogru = false; durum.adim = 'hazir';
  const L = durum.liste;
  o.innerHTML = baslik('Belge gönderimi (WhatsApp)') + '<div class="gb">' +
    (uyari ? '<div class="gh2 e">' + esc(uyari) + '</div>' : '') +
    '<div class="gh2">Müşteri onayı (KVKK aydınlatma + WhatsApp izni) alınmış satışlar burada bekler. Belge <b>kişisel verileri maskeli</b> PDF olarak gider.</div>' +
    (L.length ? L.map(k => '<button class="gr" data-g="detay" data-id="' + esc(k.saleNo) + '"><span><b>' + esc(dec(k.musteri)) + '</b><small>' + esc(k.saleNo) + ' · ' + esc(k.urun || '') + ' · ' + esc(tarihSaat(k.ts)) + '</small></span>' +
      '<span class="gp' + (izinTamam(k) && telE164(k.telNorm || k.telefon) ? '' : '') + '">' + (!izinTamam(k) ? 'onay eksik' : (!telE164(k.telNorm || k.telefon) ? 'numara eksik' : 'bekliyor')) + '</span></button>').join('')
      : '<div class="gk" style="text-align:center;opacity:.8">Gönderilecek belge yok.</div>') +
    '<button class="gx g" data-g="yenile">↻ Yenile</button><button class="gx g" data-g="son">Son gönderilenler</button>' +
    (durum.son.length ? '<div class="gk">' + durum.son.map(k => '<div class="gf"><span>' + esc(dec(k.musteri)) + ' <small>' + esc(k.saleNo) + '</small></span><span>' + esc(tarihSaat(k.gonderimT)) + ' · ' + esc(String(k.gonderen || '').split('@')[0]) + '</span></div>').join('') + '</div>' : '') +
    '</div>';
}
function detayCiz(extra) {
  const k = durum.liste.find(x => x.saleNo === durum.acik); if (!k) return listeCiz(extra);   // kayıt başka cihazda gönderilmiş/çıkarılmış olabilir: açıklama listede gösterilir
  const o = overlay(), no = telE164(k.telNorm || k.telefon), tam = izinTamam(k), hazir = durum.adim;
  const izinSatir = tam
    ? '<div class="gh2">✓ KVKK aydınlatma sunuldu · ✓ WhatsApp ile gönderim izni alındı<br><small>' + esc(String((k.izin || {}).u || '').split('@')[0]) + ' · ' + esc(tarihSaat((k.izin || {}).t)) + '</small></div>'
    : '<div class="gh2 e"><b>Müşteri onayı eksik.</b> Bu belge gönderilemez.</div>';
  const kos = !tam || !no;
  let alt = '';
  if (hazir === 'hazir' || hazir === 'hazirlaniyor') {
    alt = '<label class="gc"><input type="checkbox" id="gnd-dogru"' + (durum.dogru ? ' checked' : '') + '><span>Yukarıdaki <b>numarayı</b> müşteriyle teyit ettim; belge bu numaraya gönderilecek.</span></label>' +
      '<button class="gx" data-g="numara"' + (kos || !durum.dogru || hazir === 'hazirlaniyor' ? ' disabled' : '') + '>' + (hazir === 'hazirlaniyor' ? '⏳ PDF hazırlanıyor…' : '💬 Bu numarayla gönder (rehbere kaydetmeden)') + '</button>' +
      '<button class="gx g" data-g="gonder"' + (kos || !durum.dogru || hazir === 'hazirlaniyor' ? ' disabled' : '') + '>📤 Paylaşım menüsüyle (müşteri rehberde kayıtlıysa)</button>' +
      (!no ? '<div class="gh2 u">Telefon numarası geçersiz/eksik; bu belge WhatsApp ile gönderilemez. Kuyruktan çıkarabilirsiniz.</div>' : '');
  } else if (hazir === 'soru') {
    alt = '<div class="gh2">Paylaşım menüsü kapandı. WhatsApp’ta <b>belgeyi gönderdiniz mi?</b></div>' +
      '<button class="gx" data-g="gonderildi" data-kanal="paylasim">✅ Evet, gönderildi</button>' +
      '<button class="gx g" data-g="tekrar">↩ Hayır, tekrar paylaş</button>' + yolIki(k, no);
  } else if (hazir === 'numara') {
    alt = '<div class="gh2"><b>✓ PDF hazır.</b> Sohbet <b>numarayla</b> açılır, müşteriyi rehbere kaydetmeniz gerekmez. Mesaj metni yazılı gelir; yalnız PDF’i sohbete ekleyin.</div>' + yolIki(k, no, true) +
      '<button class="gx g" data-g="tekrar">↩ Geri</button>';
  } else if (hazir === 'yol2') {
    alt = '<div class="gh2 u"><b>Müşteriyi paylaşım listesinde bulamadınız mı?</b> Numara rehberde / sohbetlerde kayıtlı değilse listede görünmez. O zaman numarayla sohbet açıp PDF’i elle ekleyin.</div>' + yolIki(k, no) +
      '<button class="gx g" data-g="tekrar">↩ Paylaşım menüsünü yeniden dene</button>';
  } else if (hazir === 'yol2son') {
    alt = '<div class="gh2">PDF’i sohbete ekleyip gönderdiyseniz işaretleyin.</div><button class="gx" data-g="gonderildi" data-kanal="sohbet">✅ Gönderildi olarak işaretle</button>' + yolIki(k, no);
  }
  o.innerHTML = baslik(dec(k.musteri), true) + '<div class="gb">' +
    '<div class="gk"><div class="gf"><span>Satış</span><span>' + esc(k.saleNo) + '</span></div><div class="gf"><span>Ürün</span><span>' + esc(k.urun || '') + '</span></div><div class="gf"><span>Satış tarihi</span><span>' + esc(tarihSaat(k.ts)) + '</span></div></div>' +
    '<div class="gk"><div style="opacity:.7;text-align:center">Gönderilecek numara</div><div class="gt" id="gnd-no">' + esc(no ? telGoster(k.telNorm || k.telefon) : '—') + '</div></div>' +
    izinSatir + (extra ? '<div class="gh2 e">' + esc(extra) + '</div>' : '') + alt +
    '<button class="gx g" data-g="iptal">Kuyruktan çıkar (gönderilmeyecek)</button></div>';
}
// 2. yol: numarayla sohbet + PDF indir (kayıtsız numara; PDF elle eklenir)
function yolIki(k, no, birincil) {
  if (!no) return '';
  const m = encodeURIComponent(mesajMetni(k));
  const android = /Android/i.test(navigator.userAgent || '');
  return '<div class="gk"><b>' + (birincil ? 'Rehbere kaydetmeden gönderim:' : 'Kayıtsız numara için:') + '</b><div style="margin:6px 0;font-size:.85rem;opacity:.85">1) PDF’i indirin · 2) Sohbeti numarayla açın · 3) Sohbette 📎 → Belge → en son indirilen PDF’i seçip gönderin.</div>' +
    '<button class="gx g" data-g="indir" style="width:100%;margin-bottom:6px">📥 PDF’i indir</button>' +
    (android ? '<a class="gx g" data-g="sohbet" style="margin-bottom:6px" href="intent://send?phone=' + no + '&text=' + m + '#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end">💬 WhatsApp Business’ta sohbeti aç</a>' : '') +
    '<a class="gx g" data-g="sohbet" target="_blank" rel="noopener" style="margin-bottom:6px" href="https://wa.me/' + no + '?text=' + m + '">💬 Sohbeti aç (wa.me)</a>' +
    '<a class="gx g" data-g="sohbet" target="_blank" rel="noopener" href="https://web.whatsapp.com/send?phone=' + no + '&text=' + m + '">🖥 WhatsApp Web’de aç</a></div>';
}

function degis(e) { const t = e.target; if (t && t.id === 'gnd-dogru') { durum.dogru = t.checked; detayCiz(); } }

async function tikla(e) {
  const el = e.target.closest('[data-g]'); if (!el) return;
  const g = el.dataset.g;
  if (g === 'sohbet') { durum.adim = 'yol2son'; setTimeout(() => detayCiz(), 400); return; }   // bağlantı kendi başına açılır; ekran "gönderildi mi?" adımına geçer
  e.preventDefault();
  if (g === 'kapat') return kapat();
  if (g === 'liste') { try { await bekleyenleriYukle(); } catch (_e) { /* eldekiyle devam */ } return listeCiz(); }
  if (g === 'yenile') return ac();
  if (g === 'son') { try { await sonGonderilenler(); } catch (er) { console.warn(er); } return listeCiz(); }
  if (g === 'detay') { durum.acik = el.dataset.id; durum.dosya = null; durum.dogru = false; durum.adim = 'hazir'; return detayCiz(); }
  if (g === 'tekrar') { durum.adim = 'hazir'; return detayCiz(); }   // hazırlanmış PDF yeniden kullanılır
  if (g === 'indir') return indir();
  if (g === 'gonder') return gonder('paylas');
  if (g === 'numara') return gonder('numara');
  if (g === 'gonderildi') return isaretle(el.dataset.kanal || 'diger');
  if (g === 'iptal') return iptalEt();
}

function indir() {
  if (!durum.dosya) return;
  const a = document.createElement('a'); a.href = URL.createObjectURL(durum.dosya); a.download = durum.dosya.name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}
async function gonder(mod) {
  const k = durum.liste.find(x => x.saleNo === durum.acik); if (!k) return;
  if (!izinTamam(k) || !telE164(k.telNorm || k.telefon) || !durum.dogru) return;
  durum.adim = 'hazirlaniyor'; detayCiz();
  const mesaj = mesajMetni(k);
  try { if (navigator.clipboard) await navigator.clipboard.writeText(mesaj); } catch (_e) { /* pano izni yoksa sessiz */ }   // paylaşım metni düşerse yapıştırılabilsin
  try {
    if (!durum.dosya) {
      if (!k.pdf) throw new Error('Belge verisi kuyrukta bulunamadı (silinmiş olabilir).');
      durum.dosya = await pdfUret(B().satisHtml(k.pdf), 'Satis-Belgesi-' + k.saleNo + '.pdf');
    }
  } catch (er) { durum.adim = 'hazir'; return detayCiz('PDF hazırlanamadı: ' + (er.message || er)); }
  if (mod === 'numara') { durum.adim = 'numara'; return detayCiz(); }   // numarayla sohbet: paylaşım menüsü hiç açılmaz
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [durum.dosya] })) {
    try { await navigator.share({ files: [durum.dosya], text: mesaj }); durum.adim = 'soru'; }
    catch (er) { durum.adim = 'yol2'; if (er && er.name !== 'AbortError') console.warn('paylaşım:', er); }   // iptal / hata → 2. yol önerilir (kayıtsız numara olabilir)
  } else { durum.adim = 'yol2'; }
  detayCiz();
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
      if (d.durum !== 'bekliyor') throw new Error('Bu belge zaten ' + (d.durum === 'gonderildi' ? 'gönderilmiş (' + String(d.gonderen || '').split('@')[0] + ' · ' + tarihSaat(d.gonderimT) + ')' : 'kuyruktan çıkarılmış') + '. İkinci kez gönderilmez.');
      const svRef = b.doc(b.db, 'sevkiyatlar', id), sv = await tx.get(svRef);
      const t = Date.now();
      tx.update(ref, { durum: 'gonderildi', gonderen: ben, gonderenAd: ad, gonderimT: t, kanal, pdf: b.deleteField() });
      if (sv.exists()) tx.update(svRef, { belgeGonderim: { t, u: ben, kanal }, log: b.arrayUnion({ t, u: ben, a: 'belge_gonderildi', e: kanal === 'paylasim' ? 'paylaşım menüsü' : 'sohbet + PDF' }) });
    });
  } catch (er) { await bekleyenleriYukle().catch(() => {}); durum.adim = 'hazir'; return detayCiz(er.message || String(er)); }
  durum.liste = durum.liste.filter(x => x.saleNo !== id); rozetN = durum.liste.length; rozetCiz();
  durum.acik = null; durum.dosya = null;
  try { if (typeof window.showToast === 'function') window.showToast('Gönderildi olarak işaretlendi', 'info'); } catch (_e) { /* yoksay */ }
  listeCiz();
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
