// ═══════════════════════════════════════════════════════════════
//  V12.0 — PRİM · ADMİN TARAFI  (Admin → 💰 Prim)
//   Hesap   : ay seç → teslim edilen satışlardan hesapla → personel özetlerini yayınla
//   Kapanış : mağaza kapanış noktaları (SP, NF → S-NF/V-NF, VŞ, SÇ, Diğer — ekle/çıkar) + günlük rapor/prim mesajı
//   Ayarlar : KDV, gam/ürün/sigorta oranları, ekstra prim, hedefler, dönem dağılımı, gölge mod
//  Firestore: meta/primAyarlar · meta/primHedefler (yalnız Admin) · primOzet/{ay__eposta} (personel kendi dokümanını okur)
// ═══════════════════════════════════════════════════════════════
import * as P from './prim.js?v=V12.2-20261118-2317';
import { esc, TL, TL2, PY, kopru, kullanici, yonetici, ayar, ayarYukle, ayarUygula, cssEkle } from './prim-personel.js?v=V12.2-20261118-2317';

const W = window, $ = id => document.getElementById(id);
const kok = () => $('admin-prim-body');
let alt = 'hesap', ay = P.ayStr(Date.now()), kapGun = P.gunStr(Date.now());
let taslak = null, hedefTaslak = {}, hedeflerYuklendi = false, kisiListesi = null;
let sonuc = null, sonKayitlar = [], mesaj = '', hata = '', acikKisi = '', denetim = null, denetimAcik = '';
const svkOnbellek = new Map();   // saleNo → sevkiyat kaydı | null
const saleOnbellek = new Map();   // saleNo → satış kaydı (oturum boyunca; her okuma 1 Firestore okuması)
const kopya = o => JSON.parse(JSON.stringify(o));
const sayi = P.sayiya;

// ── Firestore ──
async function hedefleriYukle() {
  const b = kopru(); try { const sn = await b.getDoc(b.doc(b.db, 'meta', 'primHedefler')); hedefTaslak = sn.exists() && sn.data().hedefler ? kopya(sn.data().hedefler) : {}; hedeflerYuklendi = true; }
  catch (e) { hata = 'Hedefler okunamadı: ' + (e && e.message); }
}
async function kisileriYukle() {
  if (kisiListesi) return;
  const b = kopru(); kisiListesi = [];
  try { const sn = await b.getDocs(b.collection(b.db, 'kullanicilar')); sn.docs.forEach(d => { const x = d.data(); if (x && x.Email && !x.Kilitli && ['satis', 'destek'].includes(String(x.Rol || '').toLowerCase())) kisiListesi.push({ email: String(x.Email).toLowerCase(), ad: String(x.Ad || String(x.Email).split('@')[0]) }); }); kisiListesi.sort((a, c) => a.ad.localeCompare(c.ad, 'tr')); }
  catch (e) { hata = 'Kullanıcı listesi okunamadı: ' + (e && e.message); }
}
async function ayarKaydetBelge(kismi) {   // meta/primAyarlar'a birleştirerek yazar
  const b = kopru(), yeni = { ...ayar(), ...kismi, surum: 1, guncelleme: Date.now(), guncelleyen: (kullanici() || {}).Email || '' };
  const temiz = kopya(yeni); await b.setDoc(b.doc(b.db, 'meta', 'primAyarlar'), temiz); ayarUygula(temiz);
}
const teslimAraligi = (bas, bit) => {   // teslim edilmiş (iptal/iade/silinmemiş) sevkiyatlar
  const b = kopru();
  return b.getDocs(b.query(b.collection(b.db, 'sevkiyatlar'), b.where('teslimEdildi.t', '>=', bas), b.where('teslimEdildi.t', '<', bit)))
    .then(sn => sn.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => !x.iptal && !x.iade && !x.silindi));
};
async function satisGetir(idler) {
  const b = kopru(), eksik = idler.filter(i => !saleOnbellek.has(i));
  for (let i = 0; i < eksik.length; i += 20) {
    await Promise.all(eksik.slice(i, i + 20).map(async id => { try { const sn = await b.getDoc(b.doc(b.db, 'sales', id)); saleOnbellek.set(id, sn.exists() ? { ...sn.data(), id } : null); } catch (_e) { saleOnbellek.set(id, null); } }));
  }
  return idler.map(i => saleOnbellek.get(i)).filter(Boolean);
}
async function ayKayitlari(a) {
  const { bas, bit } = P.ayAralik(a), sv = await teslimAraligi(bas, bit), sat = await satisGetir(sv.map(x => x.id));
  const t = {}; sv.forEach(x => { t[x.id] = x.teslimEdildi && x.teslimEdildi.t; });
  return sat.map(s => ({ sale: s, damga: s.prim && s.prim.v ? s.prim : null, teslimT: t[s.id] }));
}
async function svkGetir(idler) {
  const b = kopru(), eksik = idler.filter(i => !svkOnbellek.has(i));
  for (let i = 0; i < eksik.length; i += 20) await Promise.all(eksik.slice(i, i + 20).map(async id => { try { const sn = await b.getDoc(b.doc(b.db, 'sevkiyatlar', id)); svkOnbellek.set(id, sn.exists() ? sn.data() : null); } catch (_e) { svkOnbellek.set(id, undefined); } }));
}
// KAYIP DENETİMİ: ayda AÇILAN her satışın prim hesabına girip girmediği ve girmiyorsa NEDEN
async function ayDenetim(a) {
  const b = kopru(), { bas, bit } = P.ayAralik(a);
  const sn = await b.getDocs(b.query(b.collection(b.db, 'sales'), b.where('ts', '>=', new Date(bas).toISOString()), b.where('ts', '<', new Date(bit).toISOString())));
  const sat = sn.docs.map(d => ({ ...d.data(), id: d.id })).filter(s => !s.tip || s.tip === 'satis'); sat.forEach(s => saleOnbellek.set(s.id, s));
  await svkGetir(sat.map(s => s.id));
  return sat.map(s => {
    const sv = svkOnbellek.get(s.id); let durum;
    if (sv === undefined) durum = 'okunamadi'; else if (!sv) durum = 'sevkiyatsiz'; else if (sv.iptal || sv.iade || sv.silindi) durum = 'iptal';
    else if (sv.teslimEdildi && sv.teslimEdildi.t) durum = P.ayStr(sv.teslimEdildi.t) === a ? 'sayilan' : 'baskaAy'; else durum = 'bekleyen';
    return { sale: s, durum, damga: s.prim && s.prim.v ? s.prim : P.damga(s, ayar(), urunBul) };
  });
}
const urunBul = kod => { try { return kopru().urunBul(kod); } catch (_e) { return null; } };

// ── Ana çizim ──
async function acIc() {
  cssEkle(); const el = kok(); if (!el) return;
  if (!yonetici()) { el.innerHTML = '<div class="admin-empty">Bu ekran yalnız yöneticiler içindir.</div>'; return; }
  el.className = ''; el.innerHTML = '<div class="admin-empty">Yükleniyor…</div>';
  await ayarYukle(true); if (!hedeflerYuklendi) await hedefleriYukle(); await kisileriYukle();
  if (!taslak) taslak = kopya(ayar());
  ciz();
}
function ciz() {
  const el = kok(); if (!el) return;
  const pills = [['hesap', '📊 Hesap'], ['kapanis', '🏬 Kapanış'], ['ayar', '⚙️ Ayarlar']].map(([k, ad]) => '<button type="button" data-pa-alt="' + k + '" class="' + (alt === k ? 'on' : '') + '">' + ad + '</button>').join('');
  el.innerHTML = '<div class="pa-wrap"><div class="pa-pill">' + pills + '</div>'
    + (ayar().golge ? '<div class="pa-uyari">🧪 <b>Gölge mod açık:</b> indirim kesintisi personelin hak edişine uygulanmaz; yalnız burada "olsaydı" olarak görünür. Eski yöntemle karşılaştırıp kapatın (Ayarlar → Genel).</div>' : '')
    + (hata ? '<div class="pa-hata">' + esc(hata) + '</div>' : '') + (mesaj ? '<div class="pa-ok">' + esc(mesaj) + '</div>' : '')
    + '<div id="pa-icerik">' + (alt === 'hesap' ? hesapHtml() : alt === 'kapanis' ? kapanisHtml() : ayarHtml()) + '</div></div>';
  mesaj = ''; hata = '';
}
const yeniden = () => ciz();

// ═══ HESAP ═══
function uyarilar() {
  const u = [], A = ayar(); if (!sonuc) return u;
  const bilinmeyen = new Set(); let sigVar = false;
  sonKayitlar.forEach(r => { const d = r.damga && r.damga.v ? r.damga : null; (d ? d.kalemler : []).forEach(k => { if (k.tur === 'sigorta') sigVar = true; else if (P.gamBul(A, k.gam).bilinmiyor && k.gam) bilinmeyen.add(k.gam); }); });
  sonKayitlar.forEach(r => { if (!(r.damga && r.damga.v)) P.damga(r.sale, A, urunBul).kalemler.forEach(k => { if (k.tur === 'sigorta') sigVar = true; else if (P.gamBul(A, k.gam).bilinmiyor && k.gam) bilinmeyen.add(k.gam); }); });
  if (bilinmeyen.size) u.push('Ayarlarda olmayan ürün gamı var: <b>' + esc([...bilinmeyen].join(', ')) + '</b> (şimdilik nitelikli sayıldı). Ayarlar → Gam oranları bölümünden ekleyin.');
  if (sigVar && !(sayi(A.sigorta.oran) > 0) && !(sayi(A.sigorta.sabit) > 0)) u.push('Sigortalı satış var ama <b>sigorta primi tanımlı değil</b> (şimdilik 0). Ayarlar → Sigorta bölümünden girin.');
  const hedefsiz = sonuc.kisiler.filter(k => !(k.hedef > 0) && k.satisSayisi > 0).map(k => k.ad);
  if (hedefsiz.length) u.push('Hedefi girilmeyen kişiler: <b>' + esc(hedefsiz.join(', ')) + '</b> (verimlilikte hedef payı 0 sayılır). Ayarlar → Hedefler.');
  const eski = sonKayitlar.filter(r => !(r.damga && r.damga.v)).length;
  if (eski) u.push(eski + ' satış V12 öncesi (damgasız): bugünkü ayarlarla hesaplandı.');
  return u;
}
let mhs = null;   // muhasebe karşılaştırma sonucu
function mhsKart() {
  let h = '<div class="pa-kart"><h4>📑 Muhasebe Excel ile karşılaştır</h4><p class="pa-not">Muhasebeden aldığınız "Alış/Satış İşlemleri" Excel\'ini seçin (.xls). Müşteri adına göre sistemdeki satışlarla eşleştirilir; <b>sistemde bulunamayanlar</b> ve <b>sayılmayanlar</b> listelenir. Seçili ay: <b>' + esc(P.ayAdi(ay)) + '</b> (önceki ayın satışları da aranır).</p>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input type="file" id="pa-mhs-dosya" accept=".xls,.xml,.xlsx" class="pa-giris" style="width:auto;max-width:100%"><button type="button" class="pa-btn" id="pa-mhs-git">Karşılaştır</button></div>';
  if (!mhs) return h + '</div>';
  const R = mhs.sonuc, kisi = {}; R.forEach(x => { (kisi[x.personel || '?'] = kisi[x.personel || '?'] || []).push(x); });
  const T = { tamam: ['✅ Sistemde, sayıldı', '#15803d'], durum: ['⚠️ Sistemde, sayılmıyor', '#b45309'], yok: ['❌ Sistemde yok', '#b91c1c'], firma: ['🏢 Firma carisi', '#52525b'] };
  h += '<div class="pa-not" style="margin-top:8px">' + mhs.satir + ' satır okundu (' + esc(P.ayAdi(ay)) + ' içi). Özet: ' + ['tamam', 'durum', 'yok', 'firma'].map(k => T[k][0] + ' <b>' + R.filter(x => x.sonuc === k).length + '</b> (' + TL(R.filter(x => x.sonuc === k).reduce((a, x) => a + x.tutar, 0)) + ')').join(' · ') + '</div>';
  Object.keys(kisi).forEach(p => { const l = kisi[p]; h += '<h4 style="margin:12px 0 6px">' + esc(p) + ' <small style="color:#71717a">· Excel ' + TL(l.reduce((a, x) => a + x.tutar, 0)) + '</small></h4><div class="pa-kaydir"><table class="pa-tab"><thead><tr><th>Müşteri</th><th>Tarih</th><th>Excel (KDV\'li)</th><th>Sistem</th><th>Durum</th></tr></thead><tbody>'
    + l.filter(x => x.sonuc !== 'tamam').map(x => '<tr><td style="white-space:normal;max-width:150px">' + esc(x.cari) + '<br><small style="color:#71717a">' + esc(x.belgeler.join(', ')) + '</small></td><td>' + esc(x.ilk.slice(8) + '.' + x.ilk.slice(5, 7)) + '</td><td>' + TL(x.tutar) + '<br><small>' + x.satir + ' kalem</small></td><td>' + (x.sistemde ? esc(x.sistemIdler.join(', ')) + '<br><small>' + TL(x.sistemOdenen) + '</small>' : '–') + '</td><td style="color:' + T[x.sonuc][1] + ';white-space:normal">' + T[x.sonuc][0] + (x.sonuc === 'durum' ? '<br><small>' + esc(x.durumlar.map(d => (DURUM[d] || [d])[0]).join(', ')) + '</small>' : '') + '</td></tr>').join('')
    + '</tbody></table></div>' + (l.every(x => x.sonuc === 'tamam') ? '<div class="pa-ok">Bu kişinin tüm Excel satırları sistemde bulundu ve sayıldı.</div>' : ''); });
  return h + '<p class="pa-not">Eşleştirme müşteri adına göredir (sonundaki rakamlar yok sayılır); adı farklı yazılmışsa "yok" görünebilir. Firma carileri (örn. Samsung) uygulamaya girilmeyen satışlar olabilir.</p></div>';
}
function xmlSatirlari(metin) {
  const doc = new W.DOMParser().parseFromString(metin, 'application/xml'), ns = 'urn:schemas-microsoft-com:office:spreadsheet', satirlar = [];
  Array.from(doc.getElementsByTagNameNS(ns, 'Row')).forEach(r => { const row = []; let kol = 0; Array.from(r.getElementsByTagNameNS(ns, 'Cell')).forEach(c => { const ix = c.getAttributeNS(ns, 'Index'); if (ix) while (kol < Number(ix) - 1) { row.push(''); kol++; } const d = c.getElementsByTagNameNS(ns, 'Data')[0]; row.push(d ? d.textContent : ''); kol++; }); satirlar.push(row); });
  return satirlar;
}
async function mhsKarsilastir() {
  const f = $('pa-mhs-dosya') && $('pa-mhs-dosya').files[0]; if (!f) { hata = 'Önce Excel dosyasını seçin.'; return yeniden(); }
  const btn = $('pa-mhs-git'); if (btn) { btn.disabled = true; btn.textContent = 'Okunuyor…'; }
  try {
    const metin = await f.text(); if (!/urn:schemas-microsoft-com:office:spreadsheet/.test(metin)) throw new Error('Bu dosya "Excel XML (.xls)" biçiminde değil. Muhasebe programından .xls olarak alınan dosya gerekir.');
    const excel = P.muhasebeSatirlari(xmlSatirlari(metin));
    const [yil, ayn] = ay.split('-').map(Number), onceki = new Date(Date.UTC(yil, ayn - 2, 1)).toISOString().slice(0, 7);
    const sistem = [...(await ayDenetim(ay)), ...(await ayDenetim(onceki))];
    const sonuc = P.muhasebeKarsilastir(excel, sistem, ay);
    mhs = { satir: excel.filter(e => e.tarih.slice(0, 7) === ay).length, sonuc };
    if (!excel.length) hata = 'Dosyada satır bulunamadı (başlık: Cari Ünvanı / Belge No / Tarih / Stok Kodu / Toplam).';
  } catch (e) { hata = 'Excel okunamadı: ' + (e && e.message); mhs = null; }
  yeniden();
}
const DURUM = { sayilan: ['✅ Sayıldı', 'Teslim edildi, bu ayın hesabında'], baskaAy: ['📆 Başka ayda', 'Başka bir ay teslim edildi'], bekleyen: ['⏳ Teslim bekliyor', 'Sevkiyatı açık ama teslim edilmemiş'], sevkiyatsiz: ['❓ Sevkiyatsız', 'Sevkiyat kaydı hiç açılmamış (elden/aksesuar satışı olabilir)'], iptal: ['🚫 İptal/iade', 'Sevkiyat iptal veya iade'], okunamadi: ['⚠️ Okunamadı', 'Sevkiyat kaydı okunamadı'] };
function denetimKart() {
  let h = '<div class="pa-kart"><h4>🔍 Kayıp denetimi</h4><p class="pa-not">Ayda açılan her satışın prime girip girmediğini ve girmiyorsa nedenini gösterir. (Okuma: ayda açılan satış kadar.)</p><button type="button" class="pa-btn" id="pa-denetle">Seçili ayı denetle</button>';
  if (!denetim) return h + '</div>';
  const kisi = {}; denetim.forEach(x => { const em = String(x.sale.user || '?').toLowerCase(), K = (kisi[em] = kisi[em] || { ad: x.sale.userAd || em.split('@')[0], em, d: {} }), D = (K.d[x.durum] = K.d[x.durum] || { n: 0, kz: 0, prim: 0 }); D.n++; D.kz = P.r2(D.kz + x.damga.toplamKdvsiz); D.prim = P.r2(D.prim + x.damga.brutPrim); });
  const sutun = ['sayilan', 'baskaAy', 'bekleyen', 'sevkiyatsiz', 'iptal'];
  h += '<div class="pa-kaydir" style="margin-top:8px"><table class="pa-tab"><thead><tr><th>Kişi</th>' + sutun.map(s => '<th>' + DURUM[s][0] + '</th>').join('') + '</tr></thead><tbody>'
    + Object.values(kisi).sort((a, c) => a.ad.localeCompare(c.ad, 'tr')).map(K => '<tr class="pa-tikla" data-pa-den="' + esc(K.em) + '"><td>' + esc(K.ad) + '</td>' + sutun.map(s => { const D = K.d[s]; return '<td>' + (D ? D.n + ' · ' + TL(D.kz) + '<br><small style="color:#71717a">prim ' + TL(D.prim) + '</small>' : '–') + '</td>'; }).join('') + '</tr>'
      + (denetimAcik === K.em ? '<tr><td colspan="6" class="pa-acik">' + denetim.filter(x => String(x.sale.user || '?').toLowerCase() === K.em && x.durum !== 'sayilan').sort((a, c) => a.durum.localeCompare(c.durum)).map(x => '<div class="pa-sel"><span>' + esc(x.sale.id) + ' · ' + esc(String(x.sale.custName || '').replace(/&amp;/g, '&')) + ' · ' + esc((x.sale.ts || '').slice(0, 10)) + '</span><b>' + DURUM[x.durum][0] + ' · ' + TL(x.damga.toplamKdvsiz) + '</b></div>').join('') + '</td></tr>' : '')).join('')
    + '</tbody></table></div><p class="pa-not">Kişiye dokunun: sayılmayan satışlar tek tek listelenir. "Sevkiyatsız" satışlar prime girmemiştir; istersen Ayarlar → Genel\'den "sevkiyatsız satışları satış tarihiyle say" açılabilir.</p>';
  return h + '</div>';
}
function hesapHtml() {
  let h = '<div class="pa-kart"><h4>Prim hesabı</h4><p class="pa-not">Hedef ve verimlilik <b>teslim tarihine</b> göre, tutarlar <b>KDV hariç</b>. Ay seçip hesaplayın; sonra personele yayınlayın.</p>'
    + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input type="month" id="pa-ay" class="pa-giris" style="width:auto" value="' + esc(ay) + '"><button type="button" class="pa-btn" id="pa-hesapla">Hesapla</button>'
    + (sonuc ? '<button type="button" class="pa-btn kirmizi" id="pa-yayinla">Personele yayınla</button>' : '') + '</div></div>';
  if (!sonuc) return h + denetimKart() + mhsKart() + '<div class="admin-empty">Ay seçip <b>Hesapla</b>ya basın. (Okuma: ayda teslim edilen satış sayısı kadar.)</div>';
  const E = sonuc.ekip;
  h += denetimKart() + mhsKart();
  h += uyarilar().map(x => '<div class="pa-uyari">⚠️ ' + x + '</div>').join('');
  h += '<div class="pa-kart"><h4>' + esc(P.ayAdi(E.ay)) + ' · ekip özeti</h4><div class="pa-sel"><span>Teslim edilen satış (KDV\'siz)</span><b>' + TL(E.toplamKdvsiz) + '</b></div><div class="pa-sel"><span>Toplam hedef</span><b>' + TL(E.toplamHedef) + '</b></div>'
    + '<div class="pa-sel"><span>Bugün olması gereken oran</span><b>' + PY(E.beklenenOran) + '</b></div><div class="pa-sel"><span>Ekip indirim ortalaması</span><b>' + PY(E.indirimOrani) + '</b></div><div class="pa-sel"><span>Ortalama verimlilik</span><b>' + PY(E.ortVerimlilik) + '</b></div></div>';
  h += '<div class="pa-kart pa-kaydir"><table class="pa-tab"><thead><tr><th>Kişi</th><th>Satış</th><th>Hedef%</th><th>Nitelikli%</th><th>Verim.</th><th>Brüt</th><th>İnd.%</th><th>İnd. etkisi</th><th>Hak ediş</th></tr></thead><tbody>'
    + sonuc.kisiler.map(k => '<tr class="pa-tikla" data-pa-kisi="' + esc(k.email) + '"><td>' + k.sira + '. ' + esc(k.ad) + '</td><td>' + TL(k.kdvsiz) + '</td><td>' + PY(k.hedefYuzde) + '</td><td>' + PY(k.nitelikliYuzde) + '</td><td>' + PY(k.verimlilik) + '</td><td>' + TL(k.brutToplam) + '</td><td>' + PY(k.indirimOrani) + '</td><td>' + (E.golge ? '<small style="color:#a16207">olsaydı ' + TL(k.golgeHakEdis - (k.brutToplam * k.verimlilik / 100)) + '</small>' : TL(k.indirimEtkisi)) + '</td><td><b>' + TL(k.hakEdis) + '</b></td></tr>'
      + (acikKisi === k.email ? '<tr><td colspan="9" class="pa-acik">' + kisiDetay(k) + '</td></tr>' : '')).join('') + '</tbody></table></div>'
    + '<p class="pa-not">Bir kişiye dokunup nasıl hesaplandığını ve indirimlerin "nereden nereye" olduğunu görün. Onay / askı (düzelt, prim kes, onayla) bir sonraki aşamada (Faz 4) eklenecek.</p>';
  return h;
}
function kisiDetay(k) {
  const E = sonuc.ekip; let h = '<div class="pa-sel"><span>Brüt prim (özel ürün primi dahil ' + TL2(k.ekstra) + ')</span><b>' + TL2(k.brutToplam) + '</b></div>'
    + '<div class="pa-sel"><span>İndirim etkisi' + (E.golge ? ' (gölge: uygulanmıyor; katsayı ×' + String(k.katsayi).replace('.', ',') + ')' : ' (×' + String(k.katsayi).replace('.', ',') + ')') + '</span><b>' + TL2(k.indirimEtkisi) + '</b></div>'
    + '<div class="pa-sel"><span>Verimlilik etkisi (' + PY(k.verimlilik) + ')</span><b>' + TL2(k.verimlilikEtkisi) + '</b></div><div class="pa-sel"><span>Onay kesintisi</span><b>' + TL2(k.onayKesinti) + '</b></div>'
    + '<div class="pa-sel"><span><b>Hak ediş</b>' + (E.golge ? ' · gölge katsayı uygulansaydı: ' + TL2(k.golgeHakEdis) : '') + '</span><b>' + TL2(k.hakEdis) + '</b></div>'
    + '<div class="pa-not" style="margin-top:8px">Kişinin indirimi ' + PY(k.indirimOrani) + ' · ekip ortalaması ' + PY(k.ekipIndirimOrani) + ' · <b>Satışlar (liste → ödenen):</b></div>';
  h += k.kalemler.map(x => { const d = x.d, yz = d.listeToplam > 0 ? d.personelInd / d.listeToplam * 100 : 0; return '<div class="pa-sel"><span>' + esc(x.saleNo) + ' · ' + new Date(x.t).toLocaleDateString('tr-TR') + '</span><b>' + TL(d.listeToplam) + ' → ' + TL(d.odenenToplam) + (d.personelInd > 0 ? ' <small style="color:' + (yz > k.ekipIndirimOrani + 0.05 ? '#b91c1c' : '#71717a') + '">(elle −' + TL(d.personelInd) + ' · ' + PY(yz) + ')</small>' : '') + '</b></div>'; }).join('');
  return h;
}
async function hesapla() {
  const d = $('pa-hesapla'); if (d) { d.disabled = true; d.textContent = 'Hesaplanıyor…'; }
  try {
    sonKayitlar = await ayKayitlari(ay); let ek = 0;
    if (ayar().sevkiyatsizSay) { const dn = await ayDenetim(ay); dn.filter(x => x.durum === 'sevkiyatsiz').forEach(x => { sonKayitlar.push({ sale: x.sale, damga: x.sale.prim && x.sale.prim.v ? x.sale.prim : null, teslimT: Date.parse(x.sale.ts) }); ek++; }); }
    sonuc = P.aySonuc({ kayitlar: sonKayitlar, ayar: ayar(), hedefler: hedefTaslak, ay, bugun: Date.now(), urunBul });
    mesaj = (sonKayitlar.length - ek) + ' teslim edilmiş satış okundu' + (ek ? ' + ' + ek + ' sevkiyatsız satış (satış tarihiyle)' : '') + '.';
  } catch (e) { hata = 'Hesap yapılamadı: ' + (e && e.message); sonuc = null; }
  yeniden();
}
async function yayinla() {
  if (!sonuc || !(await onay('Personele yayınlansın mı?\n\n' + sonuc.kisiler.length + ' kişinin ' + P.ayAdi(ay) + ' özeti yazılır. Kişi yalnız kendi özetini görür.' + (ayar().golge ? '\n(Gölge mod: indirim kesintisi uygulanmıyor.)' : '')))) return;
  const b = kopru(); try {
    const simdi = Date.now(), liste = sonuc.kisiler;
    for (let i = 0; i < liste.length; i += 400) { const bt = b.writeBatch(b.db); liste.slice(i, i + 400).forEach(k => bt.set(b.doc(b.db, 'primOzet', P.ozetDocId(ay, k.email)), kopya(P.kisiOzeti(sonuc, k, simdi)))); await bt.commit(); }
    mesaj = '✓ ' + liste.length + ' kişinin özeti yayınlandı.';
  } catch (e) { hata = 'Yayınlanamadı: ' + (e && e.message) + (/permission/i.test(String(e && e.message)) ? ' — Firestore kuralları (Aşama H) yayınlanmamış olabilir.' : ''); }
  yeniden();
}
const onay = m => (typeof W.ayConfirm === 'function' ? W.ayConfirm(m) : Promise.resolve(confirm(m)));

// ═══ KAPANIŞ ═══
let kapRapor = null;
function kapanisHtml() {
  const A = ayar();
  let h = '<div class="pa-kart"><h4>Kapanış noktaları</h4><p class="pa-not">Mağaza açılır/kapanırsa buradan ekleyin veya çıkarın. "Marka ayrımı" olan noktada satış kalemleri markaya göre bölünür (örn. NF mağazasında Samsung → S-NF, Vestel → V-NF).</p>';
  h += A.noktalar.map((n, i) => '<div class="pa-sat" style="grid-template-columns:90px 1fr auto"><b>' + esc(n.ad) + '</b><input class="pa-giris" data-pa-nokta-ayir="' + i + '" placeholder="Marka ayrımı (boş bırakılabilir): S-NF=Samsung, V-NF=Vestel" value="' + esc((n.ayir || []).map(x => x.ad + '=' + (x.markalar || []).join('|')).join(', ')) + '"><button type="button" class="pa-btn gri" data-pa-nokta-sil="' + i + '">Çıkar</button></div>').join('');
  h += '<div class="pa-sat" style="grid-template-columns:1fr auto auto"><input class="pa-giris" id="pa-nokta-yeni" placeholder="Yeni nokta adı (örn. AV)"><button type="button" class="pa-btn" id="pa-nokta-ekle">＋ Ekle</button><button type="button" class="pa-btn kirmizi" id="pa-nokta-kaydet">Kaydet</button></div></div>';
  h += '<div class="pa-kart"><h4>Günlük kapanış raporu</h4><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input type="date" id="pa-kap-gun" class="pa-giris" style="width:auto" value="' + esc(kapGun) + '"><button type="button" class="pa-btn" id="pa-kap-goster">Raporu getir</button></div></div>';
  if (kapRapor) h += kapRaporHtml();
  return h;
}
function kapTablo(r, baslik, not) {
  const dolu = r.noktalar.filter(n => n.adet > 0 || n.kdvsiz > 0);
  return '<div class="pa-kart pa-kaydir"><h4>' + baslik + '</h4><p class="pa-not">' + not + '</p>' + (dolu.length ? '<table class="pa-tab"><thead><tr><th>Nokta</th><th>Satış</th><th>Kalem</th><th>KDV\'siz</th><th>Brüt prim</th></tr></thead><tbody>'
    + dolu.map(n => '<tr><td>' + esc(n.nokta) + '</td><td>' + n.satisSayisi + '</td><td>' + n.adet + '</td><td>' + TL(n.kdvsiz) + '</td><td>' + TL(n.brutPrim) + '</td></tr>').join('') + '<tr><td><b>Toplam</b></td><td></td><td></td><td><b>' + TL(r.toplam) + '</b></td><td></td></tr></tbody></table>'
    : '<div class="admin-empty">Bu gün kayıt yok.</div>') + '</div>';
}
function kapRaporHtml() {
  const { satilan, teslim } = kapRapor, ad = new Date(kapGun + 'T12:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  let msg = '📋 KAPANIŞ — ' + ad + '\n';
  const satir = r => r.noktalar.filter(n => n.kdvsiz > 0).map(n => '• ' + n.nokta + ': ' + TL(n.kdvsiz) + ' (' + n.satisSayisi + ' satış)').join('\n') || '• Kayıt yok';
  msg += '\nSATILAN (KDV hariç)\n' + satir(satilan) + '\nToplam: ' + TL(satilan.toplam) + '\n\nTESLİM EDİLEN (primli, KDV hariç)\n' + satir(teslim) + '\nToplam: ' + TL(teslim.toplam);
  if (teslim.kisiler.length) msg += '\n\n💰 GÜNLÜK PRİM (tahmini brüt)\n' + teslim.kisiler.map(k => '• ' + k.ad + ': satış ' + TL(k.kdvsiz) + ' → prim ' + TL(k.brutPrim)).join('\n');
  return kapTablo(satilan, 'Bugün satılan', 'Satış kaydı bu gün açılanlar (kasa/kapanış mantığı).') + kapTablo(teslim, 'Bugün teslim edilen', 'Ürün bu gün müşteriye gidenler — prim bunlara göre hesaplanır.')
    + '<div class="pa-kart"><h4>Günlük mesaj</h4><div class="pa-mesaj">' + esc(msg) + '</div></div>';
}
async function kapGetir() {
  const b = kopru(), bas = Date.parse(kapGun + 'T00:00:00+03:00'), bit = bas + 86400000;
  try {
    const sn = await b.getDocs(b.query(b.collection(b.db, 'sales'), b.where('ts', '>=', new Date(bas).toISOString()), b.where('ts', '<', new Date(bit).toISOString())));
    const sat = sn.docs.map(d => ({ ...d.data(), id: d.id })); sat.forEach(s => saleOnbellek.set(s.id, s));
    const sv = await teslimAraligi(bas, bit), tsat = await satisGetir(sv.map(x => x.id)), t = {}; sv.forEach(x => { t[x.id] = x.teslimEdildi && x.teslimEdildi.t; });
    const A = ayar();
    kapRapor = { satilan: P.kapanisRaporu(sat.map(s => ({ sale: s, damga: s.prim && s.prim.v ? s.prim : null, teslimT: Date.parse(s.ts) })), A, kapGun, urunBul, 'satis'),
      teslim: P.kapanisRaporu(tsat.map(s => ({ sale: s, damga: s.prim && s.prim.v ? s.prim : null, teslimT: t[s.id] })), A, kapGun, urunBul, 'teslim') };
  } catch (e) { hata = 'Rapor alınamadı: ' + (e && e.message); kapRapor = null; }
  yeniden();
}
function noktaAyirParse(m) {
  return String(m || '').split(',').map(x => x.trim()).filter(Boolean).map(x => { const [ad, mk] = x.split('='); return { ad: String(ad || '').trim(), markalar: String(mk || '').split('|').map(y => y.trim()).filter(Boolean) }; }).filter(x => x.ad && x.markalar.length);
}
let noktaTaslak = null;
async function noktaKaydet() {
  const liste = noktaTaslak || kopya(ayar().noktalar);
  document.querySelectorAll('[data-pa-nokta-ayir]').forEach(i => { const n = liste[Number(i.dataset.paNoktaAyir)]; if (n) { const a = noktaAyirParse(i.value); if (a.length) n.ayir = a; else delete n.ayir; } });
  const adlar = liste.map(n => P.norm(n.ad)); if (new Set(adlar).size !== adlar.length) { hata = 'Aynı isimde iki nokta olamaz.'; return yeniden(); }
  try { await ayarKaydetBelge({ noktalar: liste }); taslak.noktalar = kopya(liste); noktaTaslak = null; mesaj = '✓ Kapanış noktaları kaydedildi.'; } catch (e) { hata = 'Kaydedilemedi: ' + (e && e.message); }
  yeniden();
}

// ═══ AYARLAR ═══
const yolAl = (o, y) => y.reduce((a, k) => (a == null ? a : a[k]), o);
const yolYaz = (o, y, v) => { let a = o; for (let i = 0; i < y.length - 1; i++) { if (a[y[i]] == null) a[y[i]] = {}; a = a[y[i]]; } a[y[y.length - 1]] = v; };
const gir = (yol, v, ek) => '<input class="pa-giris" inputmode="decimal" data-pa-yol="' + esc(JSON.stringify(yol)) + '" value="' + esc(v ?? '') + '"' + (ek || '') + '>';
const metin = (yol, v, ph, tip) => '<input class="pa-giris" type="' + (tip || 'text') + '" data-pa-yol="' + esc(JSON.stringify(yol)) + '" data-pa-metin="1" placeholder="' + esc(ph || '') + '" value="' + esc(v ?? '') + '">';
const onoff = (yol, v, ad) => '<label style="display:flex;gap:8px;align-items:center;font-size:.84rem;margin:4px 0"><input type="checkbox" data-pa-yol="' + esc(JSON.stringify(yol)) + '" data-pa-kutu="1"' + (v ? ' checked' : '') + '> ' + ad + '</label>';
function ayarHtml() {
  const T = taslak, urunGamlari = (() => { try { const l = (W._primBridge && W._primBridge.urunler && W._primBridge.urunler()) || []; const s = new Set(); l.forEach(p => { const k = Object.keys(p).find(x => P.norm(x).includes('gam')); if (k && p[k]) s.add(String(p[k]).trim()); }); return [...s]; } catch (_e) { return []; } })();
  const tanimsiz = urunGamlari.filter(g => !Object.keys(T.gamlar).some(x => P.norm(x) === P.norm(g)) && P.norm(g) !== 'sigorta');
  let h = '<div class="pa-kart"><h4>Genel</h4>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>Varsayılan KDV (%)</span>' + gir(['kdv'], T.kdv) + '</div>'
    + onoff(['golge'], T.golge, '<b>Gölge mod</b> (indirim kesintisi personele uygulanmaz; ilk ay)') + onoff(['sevkiyatsizSay'], T.sevkiyatsizSay === true, 'Sevkiyat kaydı <b>hiç açılmamış</b> satışları (elden/aksesuar) satış tarihiyle <b>say</b>') + onoff(['personelEkran'], T.personelEkran === true, 'Personelde <b>Puan Durumum</b> ve sepet koçluğu <b>açık</b> (kapalıyken personel hiçbir şey görmez)')
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>İndirim: ekip ortalamasının her 1 puan üstü, prim kesintisi (%)</span>' + gir(['indirim', 'k'], T.indirim.k) + '</div>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>İndirim katsayısı en az (0–1)</span>' + gir(['indirim', 'alt'], T.indirim.alt) + '</div>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>Verimlilikte hedef payı</span>' + gir(['verimlilik', 'hedef'], T.verimlilik.hedef) + '</div>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>Verimlilikte nitelikli payı</span>' + gir(['verimlilik', 'nitelikli'], T.verimlilik.nitelikli) + '</div>'
    + '<p class="pa-not">Ay içi hedef dağılımı (%): 1–10. gün · 11–20. gün · 21–son gün</p><div class="pa-sat" style="grid-template-columns:1fr 1fr 1fr">' + [0, 1, 2].map(i => gir(['donem', i, 'pay'], T.donem[i] ? T.donem[i].pay : '')).join('') + '</div></div>';
  h += '<div class="pa-kart pa-kaydir"><h4>Gam oranları</h4><p class="pa-not">Prim = KDV\'siz satış × oran. <b>Nitelikli</b> gamlar verimlilikte sayılır; <b>verimsiz</b> (IT/Elektronik) sayılmaz. KDV boşsa varsayılan kullanılır.</p>'
    + (tanimsiz.length ? '<div class="pa-uyari">Ürün listesinde olup tanımlı olmayan gamlar: ' + tanimsiz.map(g => '<button type="button" class="pa-btn gri" style="padding:4px 10px;margin:2px" data-pa-gam-ekle="' + esc(g) + '">＋ ' + esc(g) + '</button>').join('') + '</div>' : '')
    + '<table class="pa-tab"><thead><tr><th>Gam</th><th>Grup</th><th>Oran %</th><th>KDV %</th><th></th></tr></thead><tbody>'
    + Object.keys(T.gamlar).map(g => { const x = T.gamlar[g]; return '<tr><td>' + esc(g) + '</td><td><select class="pa-giris" style="width:auto" data-pa-yol="' + esc(JSON.stringify(['gamlar', g, 'grup'])) + '" data-pa-metin="1"><option value="nitelikli"' + (x.grup !== 'verimsiz' ? ' selected' : '') + '>Nitelikli</option><option value="verimsiz"' + (x.grup === 'verimsiz' ? ' selected' : '') + '>Verimsiz</option></select></td><td style="width:70px">' + gir(['gamlar', g, 'oran'], x.oran) + '</td><td style="width:60px">' + gir(['gamlar', g, 'kdv'], x.kdv ?? '') + '</td><td><button type="button" class="pa-btn gri" style="padding:4px 9px" data-pa-gam-sil="' + esc(g) + '">✕</button></td></tr>'; }).join('')
    + '</tbody></table><div class="pa-sat" style="grid-template-columns:1fr auto;margin-top:8px"><input class="pa-giris" id="pa-gam-yeni" placeholder="Yeni gam adı"><button type="button" class="pa-btn" id="pa-gam-yeni-ekle">＋ Gam ekle</button></div>'
    + '<p class="pa-not">Gamı olmayan/tanımsız ürünler için varsayılan oran: nitelikli %</p><div class="pa-sat" style="grid-template-columns:1fr 70px 1fr 70px"><span>Nitelikli %</span>' + gir(['grupOran', 'nitelikli'], T.grupOran.nitelikli) + '<span>Verimsiz %</span>' + gir(['grupOran', 'verimsiz'], T.grupOran.verimsiz) + '</div></div>';
  h += '<div class="pa-kart"><h4>Sigorta / kasko / hizmet</h4><p class="pa-not">SC+ sigorta gibi hizmetler <b>nitelikli</b> sayılır. Prim: oran (%) <b>veya</b> sabit tutar (₺ / adet; sabit doluysa o kullanılır). Girilmezse sigorta primi 0 olur.</p>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>Oran (%)</span>' + gir(['sigorta', 'oran'], T.sigorta.oran) + '</div><div class="pa-sat" style="grid-template-columns:1fr 90px"><span>Sabit tutar (₺ / adet)</span>' + gir(['sigorta', 'sabit'], T.sigorta.sabit) + '</div><div class="pa-sat" style="grid-template-columns:1fr 90px"><span>KDV (%)</span>' + gir(['sigorta', 'kdv'], T.sigorta.kdv) + '</div></div>';
  h += '<div class="pa-kart pa-kaydir"><h4>Ürüne özel oran / KDV</h4><p class="pa-not">Gam kuralını ezer. Boş bırakılan alan gam değerini kullanır.</p><table class="pa-tab"><thead><tr><th>Ürün kodu</th><th>Oran %</th><th>KDV %</th><th></th></tr></thead><tbody>'
    + Object.keys(T.urunler).map(k => '<tr><td>' + esc(k) + '</td><td style="width:70px">' + gir(['urunler', k, 'oran'], T.urunler[k].oran ?? '') + '</td><td style="width:60px">' + gir(['urunler', k, 'kdv'], T.urunler[k].kdv ?? '') + '</td><td><button type="button" class="pa-btn gri" style="padding:4px 9px" data-pa-urun-sil="' + esc(k) + '">✕</button></td></tr>').join('')
    + '</tbody></table><div class="pa-sat" style="grid-template-columns:1fr auto;margin-top:8px"><input class="pa-giris" id="pa-urun-yeni" placeholder="Ürün kodu"><button type="button" class="pa-btn" id="pa-urun-ekle">＋ Ekle</button></div></div>';
  h += '<div class="pa-kart pa-kaydir"><h4>Özel ürün primi (tarihli, vitrinde ⭐ rozet)</h4><p class="pa-not">Örn. KM97402, 17–23 Kasım, +250 ₺ / adet. Teslim tarihi aralıktaysa brüt primin üstüne eklenir; sepette ve vitrinde görünür.</p>'
    + T.ekstra.map((e, i) => '<div class="pa-sat" style="grid-template-columns:1fr 1fr 70px;border-bottom:1px dashed #e4e4e8;padding-bottom:8px">' + metin(['ekstra', i, 'kod'], e.kod, 'Ürün kodu') + metin(['ekstra', i, 'ad'], e.ad, 'Açıklama') + gir(['ekstra', i, 'tutar'], e.tutar, ' placeholder="₺"')
      + metin(['ekstra', i, 'bas'], e.bas, '', 'date') + metin(['ekstra', i, 'bit'], e.bit, '', 'date') + '<div style="display:flex;gap:6px;align-items:center">' + onoff(['ekstra', i, 'aktif'], e.aktif !== false, 'Aktif') + '<button type="button" class="pa-btn gri" style="padding:4px 9px" data-pa-ekstra-sil="' + i + '">✕</button></div></div>').join('')
    + '<button type="button" class="pa-btn" id="pa-ekstra-ekle">＋ Özel prim ekle</button></div>';
  const kisiler = (kisiListesi || []).slice(); Object.keys(hedefTaslak).forEach(em => { if (!kisiler.some(k => k.email === em)) kisiler.push({ email: em, ad: hedefTaslak[em].ad || em }); });
  h += '<div class="pa-kart"><h4>Aylık hedefler (KDV hariç ₺)</h4><p class="pa-not">"Her ay" varsayılan hedeftir; "' + esc(P.ayAdi(ay)) + '" doldurulursa yalnız o ay için geçerli olur (örn. yeni başlayan, yer değiştiren).</p><table class="pa-tab"><thead><tr><th>Kişi</th><th>Her ay</th><th>' + esc(P.ayAdi(ay)) + '</th></tr></thead><tbody>'
    + kisiler.map(k => { const x = hedefTaslak[k.email] || {}; return '<tr><td>' + esc(k.ad) + '</td><td style="width:110px"><input class="pa-giris" inputmode="decimal" data-pa-hedef="' + esc(k.email) + '" data-pa-ad="' + esc(k.ad) + '" value="' + esc(x.tutar ?? '') + '"></td><td style="width:110px"><input class="pa-giris" inputmode="decimal" data-pa-hedef-ay="' + esc(k.email) + '" data-pa-ad="' + esc(k.ad) + '" value="' + esc(x.aylik && x.aylik[ay] != null ? x.aylik[ay] : '') + '"></td></tr>'; }).join('') + '</tbody></table></div>';
  h += '<div style="position:sticky;bottom:0;background:var(--bg,#f4f4f6);padding:10px 0"><button type="button" class="pa-btn kirmizi" id="pa-ayar-kaydet" style="width:100%;min-height:44px">💾 Ayarları kaydet</button></div>';
  return h;
}
function ayarTemizle(T) {
  const o = {};
  o.kdv = sayi(T.kdv) || 20; o.golge = !!T.golge; o.personelEkran = T.personelEkran === true; o.sevkiyatsizSay = T.sevkiyatsizSay === true;
  o.indirim = { k: sayi(T.indirim.k), alt: Math.min(1, Math.max(0, sayi(T.indirim.alt))) };
  o.verimlilik = { hedef: sayi(T.verimlilik.hedef), nitelikli: sayi(T.verimlilik.nitelikli) };
  const bit = [10, 20, 31]; o.donem = [0, 1, 2].map(i => ({ bitis: bit[i], pay: sayi(T.donem[i] && T.donem[i].pay) }));
  o.gamlar = {}; Object.keys(T.gamlar).forEach(g => { const n = String(g).trim(); if (!n) return; const x = T.gamlar[g]; o.gamlar[n] = { grup: x.grup === 'verimsiz' ? 'verimsiz' : 'nitelikli', oran: sayi(x.oran), ...(String(x.kdv ?? '').trim() !== '' ? { kdv: sayi(x.kdv) } : {}), ...(x.kume ? { kume: x.kume } : {}) }; });
  o.grupOran = { nitelikli: sayi(T.grupOran.nitelikli), verimsiz: sayi(T.grupOran.verimsiz) };
  o.sigorta = { oran: sayi(T.sigorta.oran), sabit: sayi(T.sigorta.sabit), kdv: sayi(T.sigorta.kdv) || o.kdv };
  o.urunler = {}; Object.keys(T.urunler).forEach(k => { const x = T.urunler[k], t = {}; if (String(x.oran ?? '').trim() !== '') t.oran = sayi(x.oran); if (String(x.kdv ?? '').trim() !== '') t.kdv = sayi(x.kdv); if (k.trim()) o.urunler[k.trim()] = t; });
  o.ekstra = T.ekstra.filter(e => String(e.kod || '').trim()).map((e, i) => ({ id: e.id || ('e' + Date.now().toString(36) + i), kod: String(e.kod).trim(), ad: String(e.ad || '').trim(), tutar: sayi(e.tutar), bas: e.bas || '', bit: e.bit || '', aktif: e.aktif !== false }));
  return o;
}
async function ayarKaydet() {
  const hz = [];
  if (!(sayi(taslak.verimlilik.hedef) + sayi(taslak.verimlilik.nitelikli) > 0)) hz.push('Verimlilik payları toplamı 0 olamaz.');
  const dp = [0, 1, 2].reduce((a, i) => a + sayi(taslak.donem[i] && taslak.donem[i].pay), 0); if (Math.abs(dp - 100) > 0.01) hz.push('Ay içi dağılım toplamı %100 olmalı (şu an %' + dp + ').');
  if (hz.length) { hata = hz.join(' '); return yeniden(); }
  try {
    const t = ayarTemizle(taslak); await ayarKaydetBelge(t);
    const hd = {}; const emails = new Set([...Object.keys(hedefTaslak)]);
    emails.forEach(em => { const x = hedefTaslak[em] || {}, tut = sayi(x.tutar), ak = {}; Object.keys(x.aylik || {}).forEach(a => { const v = sayi(x.aylik[a]); if (v > 0) ak[a] = v; }); if (tut > 0 || Object.keys(ak).length) hd[em.toLowerCase()] = { ad: x.ad || em, tutar: tut, ...(Object.keys(ak).length ? { aylik: ak } : {}) }; });
    const b = kopru(); await b.setDoc(b.doc(b.db, 'meta', 'primHedefler'), { hedefler: hd, guncelleme: Date.now(), guncelleyen: (kullanici() || {}).Email || '' }); hedefTaslak = hd;
    taslak = kopya(ayar()); mesaj = '✓ Ayarlar ve hedefler kaydedildi. Personel ekranlarına en geç 30 dk içinde yansır.';
  } catch (e) { hata = 'Kaydedilemedi: ' + (e && e.message) + (/permission/i.test(String(e && e.message)) ? ' — Firestore kuralları (Aşama H) yayınlanmamış olabilir.' : ''); }
  yeniden();
}

// ── Olaylar (tek dinleyici, kök üzerinde) ──
let baglandi = false;
function olayBagla() {
  if (baglandi) return; const el = kok(); if (!el) return; baglandi = true;
  el.addEventListener('click', async ev => {
    const t = ev.target.closest('button,tr[data-pa-kisi],tr[data-pa-den]'); if (!t) return;
    const d = t.dataset;
    if (d.paAlt) { alt = d.paAlt; return yeniden(); }
    if (t.id === 'pa-hesapla') { const v = $('pa-ay'); if (v && v.value) ay = v.value; return hesapla(); }
    if (t.id === 'pa-yayinla') return yayinla();
    if (t.id === 'pa-denetle') { const v = $('pa-ay'); if (v && v.value) ay = v.value; t.disabled = true; t.textContent = 'Denetleniyor…'; try { denetim = await ayDenetim(ay); denetimAcik = ''; } catch (e) { hata = 'Denetim yapılamadı: ' + (e && e.message); } return yeniden(); }
    if (t.id === 'pa-mhs-git') return mhsKarsilastir();
    if (d.paDen !== undefined) { denetimAcik = denetimAcik === d.paDen ? '' : d.paDen; return yeniden(); }
    if (d.paKisi !== undefined) { acikKisi = acikKisi === d.paKisi ? '' : d.paKisi; return yeniden(); }
    if (t.id === 'pa-kap-goster') { const v = $('pa-kap-gun'); if (v && v.value) kapGun = v.value; return kapGetir(); }
    if (t.id === 'pa-nokta-ekle') { const v = $('pa-nokta-yeni'), ad = v ? v.value.trim() : ''; if (!ad) return; noktaTaslak = noktaTaslak || kopya(ayar().noktalar); if (noktaTaslak.some(n => P.norm(n.ad) === P.norm(ad))) { hata = 'Bu nokta zaten var.'; return yeniden(); } noktaTaslak.push({ ad }); await noktaKaydet(); return; }
    if (d.paNoktaSil !== undefined) { const i = Number(d.paNoktaSil), l = ayar().noktalar; if (!(await onay('"' + l[i].ad + '" noktası çıkarılsın mı? (Eski satışlar bozulmaz; yeni raporda "Diğer" altında görünür.)'))) return; noktaTaslak = kopya(l); noktaTaslak.splice(i, 1); await noktaKaydet(); return; }
    if (t.id === 'pa-nokta-kaydet') return noktaKaydet();
    if (d.paGamEkle) { taslak.gamlar[d.paGamEkle] = { grup: 'nitelikli', oran: taslak.grupOran.nitelikli }; return yeniden(); }
    if (d.paGamSil) { delete taslak.gamlar[d.paGamSil]; return yeniden(); }
    if (t.id === 'pa-gam-yeni-ekle') { const v = $('pa-gam-yeni'), ad = v ? v.value.trim() : ''; if (ad) taslak.gamlar[ad] = { grup: 'nitelikli', oran: taslak.grupOran.nitelikli }; return yeniden(); }
    if (t.id === 'pa-urun-ekle') { const v = $('pa-urun-yeni'), k = v ? v.value.trim() : ''; if (k && !taslak.urunler[k]) taslak.urunler[k] = {}; return yeniden(); }
    if (d.paUrunSil) { delete taslak.urunler[d.paUrunSil]; return yeniden(); }
    if (t.id === 'pa-ekstra-ekle') { taslak.ekstra.push({ kod: '', ad: '', tutar: '', bas: P.gunStr(Date.now()), bit: '', aktif: true }); return yeniden(); }
    if (d.paEkstraSil !== undefined) { taslak.ekstra.splice(Number(d.paEkstraSil), 1); return yeniden(); }
    if (t.id === 'pa-ayar-kaydet') return ayarKaydet();
  });
  const degisti = ev => {
    const t = ev.target; if (!t || !t.dataset) return;
    if (t.dataset.paYol) { const y = JSON.parse(t.dataset.paYol), v = t.dataset.paKutu ? t.checked : t.value; if (y[0] === 'donem' && !taslak.donem[y[1]]) taslak.donem[y[1]] = { bitis: [10, 20, 31][y[1]], pay: '' }; yolYaz(taslak, y, v); }
    else if (t.dataset.paHedef !== undefined) { const em = t.dataset.paHedef; hedefTaslak[em] = hedefTaslak[em] || { ad: t.dataset.paAd }; hedefTaslak[em].tutar = t.value; }
    else if (t.dataset.paHedefAy !== undefined) { const em = t.dataset.paHedefAy; hedefTaslak[em] = hedefTaslak[em] || { ad: t.dataset.paAd }; hedefTaslak[em].aylik = hedefTaslak[em].aylik || {}; hedefTaslak[em].aylik[ay] = t.value; }
  };
  el.addEventListener('input', degisti); el.addEventListener('change', degisti);
}
async function ac() { await acIc(); olayBagla(); }
W.PrimAdmin = { ac, yenile: () => { taslak = null; return ac(); }, versiyon: 'V12.0' };
