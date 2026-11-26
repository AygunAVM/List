// ═══════════════════════════════════════════════════════════════
//  V12.0 — PRİM · ADMİN TARAFI  (Admin → 💰 Prim)
//   Hesap   : ay seç → teslim edilen satışlardan hesapla → personel özetlerini yayınla
//   Kapanış : mağaza kapanış noktaları (SP, NF → S-NF/V-NF, VŞ, SÇ, Diğer — ekle/çıkar) + günlük rapor/prim mesajı
//   Ayarlar : KDV, gam/ürün/sigorta oranları, ekstra prim, hedefler, dönem dağılımı, gölge mod
//  Firestore: meta/primAyarlar · meta/primHedefler (yalnız Admin) · primOzet/{ay__eposta} (personel kendi dokümanını okur)
// ═══════════════════════════════════════════════════════════════
import * as P from './prim.js?v=V12.18-20261126-1130';
import { esc, TL, TL2, PY, kopru, kullanici, yonetici, ayar, ayarYukle, ayarUygula, cssEkle } from './prim-personel.js?v=V12.18-20261126-1130';

const W = window, $ = id => document.getElementById(id);
const kok = () => $('admin-prim-body');
let destekListesi = [], destekVeri = null;
let alt = 'hesap', ay = P.ayStr(Date.now()), kapGun = P.gunStr(Date.now());
let taslak = null, hedefTaslak = {}, hedeflerYuklendi = false, kisiListesi = null;
const detAcik = new Set();
let duzeltmeler = {}, dzAcik = '', sorunFiltre = 'sorunlu', sorunAra = '', sorunKisi = '', sorunSira = 'onerilen', dzTaslak = null, dzHata = '';
let gorunumler = {}, bekleyenKayitlar = [];   // V12.6: görünüm çarpanları { 'YYYY-MM': { eposta: {kesintiYuzde, bonusYuzde, neden, kanit, u, t, gecmis} } } · teslim bekleyen satışlar (yalnız bekleyen puan için)
let ozelAcik = false, ozelBas = '', ozelBit = '', hesapDonem = null;   // V12.6: özel aralık (yalnız yönetici görür/Excel)
let sonuc = null, sonKayitlar = [], mesaj = '', hata = '', acikKisi = '', denetim = null, denetimAcik = '';
const svkOnbellek = new Map();   // saleNo → sevkiyat kaydı | null
const saleOnbellek = new Map();   // saleNo → satış kaydı (oturum boyunca; her okuma 1 Firestore okuması)
const kopya = o => JSON.parse(JSON.stringify(o));
const sayi = P.sayiya;

// ── Firestore ──
async function hedefleriYukle() {
  const b = kopru(); try { const sn = await b.getDoc(b.doc(b.db, 'meta', 'primHedefler')); hedefTaslak = sn.exists() && sn.data().hedefler ? kopya(sn.data().hedefler) : {}; duzeltmeler = sn.exists() && sn.data().duzeltmeler ? kopya(sn.data().duzeltmeler) : {}; gorunumler = sn.exists() && sn.data().gorunum ? kopya(sn.data().gorunum) : {}; hedeflerYuklendi = true; }
  catch (e) { hata = 'Hedefler okunamadı: ' + (e && e.message); }
}
async function kisileriYukle() {
  if (kisiListesi) return;
  const b = kopru(); kisiListesi = []; destekListesi = [];
  try { const sn = await b.getDocs(b.collection(b.db, 'kullanicilar')); sn.docs.forEach(d => { const x = d.data(); if (x && x.Email && !x.Kilitli && String(x.Rol || '').toLowerCase() === 'destek') destekListesi.push({ email: String(x.Email).toLowerCase(), ad: String(x.Ad || String(x.Email).split('@')[0]) }); if (x && x.Email && !x.Kilitli && String(x.Rol || '').toLowerCase() === 'satis') kisiListesi.push({ email: String(x.Email).toLowerCase(), ad: String(x.Ad || String(x.Email).split('@')[0]) }); }); kisiListesi.sort((a, c) => a.ad.localeCompare(c.ad, 'tr')); destekListesi.sort((a, c) => a.ad.localeCompare(c.ad, 'tr')); }
  catch (e) { hata = 'Kullanıcı listesi okunamadı: ' + (e && e.message); }
}
async function ayarKaydetBelge(kismi) {   // meta/primAyarlar'a birleştirerek yazar
  const b = kopru(), yeni = { ...ayar(), ...kismi, surum: 2, guncelleme: Date.now(), guncelleyen: (kullanici() || {}).Email || '' };
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
const gunBasMs = g => Date.parse(g + 'T00:00:00+03:00');
async function ayKayitlari(a, D) {
  const bas = D ? gunBasMs(D.bas) : P.ayAralik(a).bas, bit = D ? gunBasMs(D.bit) + 86400000 : P.ayAralik(a).bit, sv = await teslimAraligi(bas, bit), sat = await satisGetir(sv.map(x => x.id));
  const t = {}; sv.forEach(x => { t[x.id] = x.teslimEdildi && x.teslimEdildi.t; });
  return sat.map(s => ({ sale: s, damga: P.damgaGecerli(s.prim), teslimT: t[s.id] }));
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
    return { sale: s, durum, damga: P.damgaGecerli(s.prim) || P.damga(s, ayar(), urunBul) };
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
  if (alt === 'hesap') sigHesapla();
  const pills = [['hesap', '📊 Hesap'], ['sorun', '🛠 Sorunlu satışlar' + (sonuc && sorunSayisi() ? ' <i class="pa2-say">' + sorunSayisi() + '</i>' : '')], ['kapanis', '🏬 Kapanış'], ['ayar', '⚙️ Ayarlar']].map(([k, ad]) => '<button type="button" data-pa-alt="' + k + '" class="' + (alt === k ? 'on' : '') + '">' + ad + '</button>').join('');
  el.innerHTML = '<div class="pa-wrap pa2"><div class="pa-pill">' + pills + '</div>'
    + (ayar().golge ? '<div class="pa-uyari">🧪 <b>Gölge mod açık:</b> indirim kesintisi personelin hak edişine uygulanmaz; yalnız burada "olsaydı" olarak görünür. Eski yöntemle karşılaştırıp kapatın (Ayarlar → Genel).</div>' : '')
    + (hata ? '<div class="pa-hata">' + esc(hata) + '</div>' : '') + (mesaj ? '<div class="pa-ok">' + esc(mesaj) + '</div>' : '')
    + '<div id="pa-icerik">' + (alt === 'hesap' ? hesapHtml() : alt === 'sorun' ? sorunHtml() : alt === 'kapanis' ? kapanisHtml() : ayarHtml()) + '</div></div>';
  mesaj = ''; hata = '';
}
const yeniden = () => ciz();

// ═══ HESAP ═══
function uyarilar() {
  const u = [], A = ayar(); if (!sonuc) return u;
  const bilinmeyen = new Set(); let sigVar = false;
  sonKayitlar.forEach(r => { const d = P.damgaGecerli(r.damga); (d ? d.kalemler : []).forEach(k => { if (k.tur === 'sigorta') sigVar = true; else if (P.gamBul(A, k.gam).bilinmiyor && k.gam) bilinmeyen.add(k.gam); }); });
  sonKayitlar.forEach(r => { if (!P.damgaGecerli(r.damga)) P.damga(r.sale, A, urunBul).kalemler.forEach(k => { if (k.tur === 'sigorta') sigVar = true; else if (P.gamBul(A, k.gam).bilinmiyor && k.gam) bilinmeyen.add(k.gam); }); });
  if (bilinmeyen.size) u.push('Ayarlarda olmayan ürün gamı var: <b>' + esc([...bilinmeyen].join(', ')) + '</b> (şimdilik nitelikli sayıldı). Ayarlar → "Ürün gamı → kategori" bölümünden kategorisini seçin.');
  if (sigVar && !(sayi(A.sigorta.oran) > 0) && !(sayi(A.sigorta.sabit) > 0)) u.push('Sigortalı satış var ama <b>sigorta primi tanımlı değil</b> (şimdilik 0). Ayarlar → Sigorta bölümünden girin.');
  const hedefsiz = sonuc.kisiler.filter(k => !(k.hedef > 0) && k.satisSayisi > 0).map(k => k.ad);
  if (hedefsiz.length) u.push('Hedefi girilmeyen kişiler: <b>' + esc(hedefsiz.join(', ')) + '</b> (verimlilikte hedef payı 0 sayılır). Ayarlar → Hedefler.');
  const eski = sonKayitlar.filter(r => !P.damgaGecerli(r.damga)).length;
  if (eski) u.push(eski + ' satış eski/V12.2 damgalı: bugünkü ayarlarla (kategori oranlarıyla) yeniden hesaplandı.');
  return u;
}
let mhs = null;   // muhasebe karşılaştırma sonucu
function mhsKart() {
  let h = '<div class="pa-kart"><h4>📑 Muhasebe Excel ile karşılaştır</h4><p class="pa-not">Muhasebeden aldığınız "Alış/Satış İşlemleri" Excel\'ini seçin (.xls). Müşteri adına göre sistemdeki satışlarla eşleştirilir; <b>sistemde bulunamayanlar</b> ve <b>sayılmayanlar</b> listelenir. Seçili ay: <b>' + esc(P.ayAdi(ay)) + '</b> (önceki ayın satışları da aranır).</p>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input type="file" id="pa-mhs-dosya" accept=".xls,.xml,.xlsx" class="pa-giris" style="width:auto;max-width:100%"><button type="button" class="pa-btn" id="pa-mhs-git">Karşılaştır</button></div>';
  if (!mhs) return h + '</div>';
  const R = mhs.sonuc, kisi = {}; R.forEach(x => { (kisi[x.personel || '?'] = kisi[x.personel || '?'] || []).push(x); });
  const T = { tamam: ['✅ Sistemde, sayıldı', '#15803d'], durum: ['⚠️ Sistemde, sayılmıyor', '#b45309'], yok: ['❌ Sistemde yok', '#b91c1c'], firma: ['🏢 Firma carisi', '#52525b'], samsung: ['🧾 Samsung faturalı ↔ sistemde, sayıldı', '#15803d'], samsungDurum: ['🧾 Samsung faturalı ↔ sistemde, sayılmıyor', '#b45309'], samsungKismi: ['🧾 Samsung faturalı, kısmen eşleşti', '#b45309'] };
  h += '<div class="pa-not" style="margin-top:8px">' + mhs.satir + ' satır okundu (' + esc(P.ayAdi(ay)) + ' içi). Özet: ' + ['tamam', 'durum', 'yok', 'firma', 'samsung', 'samsungDurum', 'samsungKismi'].filter(k => R.some(x => x.sonuc === k)).map(k => T[k][0] + ' <b>' + R.filter(x => x.sonuc === k).length + '</b> (' + TL(R.filter(x => x.sonuc === k).reduce((a, x) => a + x.tutar, 0)) + ')').join(' · ') + '</div>';
  Object.keys(kisi).forEach(p => { const l = kisi[p]; h += '<h4 style="margin:12px 0 6px">' + esc(p) + ' <small style="color:#71717a">· Excel ' + TL(l.reduce((a, x) => a + x.tutar, 0)) + '</small></h4><div class="pa-kaydir"><table class="pa-tab"><thead><tr><th>Müşteri</th><th>Tarih</th><th>Excel (KDV\'li)</th><th>Sistem</th><th>Durum</th></tr></thead><tbody>'
    + l.filter(x => x.sonuc !== 'tamam' && x.sonuc !== 'samsung').map(x => '<tr><td style="white-space:normal;max-width:150px">' + esc(x.cari) + '<br><small style="color:#71717a">' + esc(x.belgeler.join(', ')) + '</small></td><td>' + esc(x.ilk.slice(8) + '.' + x.ilk.slice(5, 7)) + '</td><td>' + TL(x.tutar) + '<br><small>' + x.satir + ' kalem</small></td><td>' + (x.sistemde ? esc(x.sistemIdler.join(', ')) + '<br><small>' + TL(x.sistemOdenen) + '</small>' : '–') + '</td><td style="color:' + T[x.sonuc][1] + ';white-space:normal">' + T[x.sonuc][0] + (x.sonuc === 'durum' || x.sonuc === 'samsungDurum' ? '<br><small>' + esc(x.durumlar.map(d => (DURUM[d] || [d])[0]).join(', ')) + '</small>' : '') + (x.samEsles && x.samEsles.length ? '<br><small>' + esc(x.samEsles.map(m => m.musteri + ' (' + m.id + (m.isaretli ? '' : ', Samsung işareti yok') + ')').join('; ')) + '</small>' : '') + (x.samYok ? '<br><small>' + x.samYok + ' kalem sistemde bulunamadı</small>' : '') + '</td></tr>').join('')
    + '</tbody></table></div>' + (l.every(x => x.sonuc === 'tamam' || x.sonuc === 'samsung') ? '<div class="pa-ok">Bu kişinin tüm Excel satırları sistemde bulundu ve sayıldı.</div>' : ''); });
  if (mhs.excelPrimVar) {
    const sk = {}; (sonuc ? sonuc.kisiler : []).forEach(k => { sk[P.norm(k.ad)] = k; });
    const ek = {}; R.forEach(x => { const K = (ek[x.personel || '?'] = ek[x.personel || '?'] || { kz: 0, prim: 0 }); K.kz = P.r2(K.kz + x.kdvsiz); K.prim = P.r2(K.prim + x.excelPrim); });
    h += '<h4 style="margin:12px 0 6px">Prim: Excel ↔ Sistem</h4>' + (sonuc ? '' : '<div class="pa-uyari">Sistem tarafı için önce yukarıdan <b>Hesapla</b>ya basın.</div>')
      + '<div class="pa-kaydir"><table class="pa-tab"><thead><tr><th>Kişi</th><th>Excel KDV\'siz</th><th>Sistem KDV\'siz</th><th>Excel prim (satır toplamı)</th>' + (mhs.hak ? '<th>Excel hakedilen</th>' : '') + '<th>Sistem brüt prim</th><th>Fark</th></tr></thead><tbody>'
      + Object.keys(ek).map(a => { const k = sk[P.norm(a)]; return '<tr><td>' + esc(a) + '</td><td>' + TL(ek[a].kz) + '</td><td>' + (k ? TL(k.kdvsiz) : '–') + '</td><td>' + TL2(ek[a].prim) + '</td>' + (mhs.hak ? '<td>' + (mhs.hak[a] ? TL2(mhs.hak[a].hak) : '–') + '</td>' : '') + '<td>' + (k ? TL2(k.brutToplam) : '–') + '</td><td>' + (k ? TL2(P.r2(k.brutToplam - ek[a].prim)) : '–') + '</td></tr>'; }).join('') + '</tbody></table></div>'
      + '<p class="pa-not">Fark; Excel\'de olup sistemde teslimi olmayan (bekleyen/sevkiyatsız/adı eşleşmeyen) satışlardan ve hesaplanan özel ürün primlerinden gelir. Satır satır fark için karşılaştırma Excel\'ini indirin (her Excel satırı ↔ sistemdeki aynı kalem; ayrıca sistemde olup Excel\'de olmayan kalemler).</p><button type="button" class="pa-btn" id="pa-mhs-excel">📥 Satır satır karşılaştırma (Excel)</button>';
  }
  return h + '<p class="pa-not">Eşleştirme müşteri adına göredir (sonundaki rakamlar yok sayılır). <b>Samsung faturalı (❖)</b> satırlar ad yerine <b>personel + stok kodu + tarih</b> ile sistemdeki satışa eşlenir.</p></div>';
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
    mhs = { satir: excel.filter(e => e.tarih.slice(0, 7) === ay).length, sonuc, excelPrimVar: excel.some(e => e.excelPrim != null), sk: P.satirKarsilastir(excel, sistem, ay), hak: excel.hakedilen || null };
    if (!excel.length) hata = 'Dosyada satır bulunamadı (başlık: Cari Ünvanı / Belge No / Tarih / Stok Kodu / Toplam).';
  } catch (e) { hata = 'Excel okunamadı: ' + (e && e.message); mhs = null; }
  yeniden();
}
const DURUM = { sayilan: ['✅ Sayıldı', 'Teslim edildi, bu ayın hesabında'], baskaAy: ['📆 Başka ayda', 'Başka bir ay teslim edildi'], bekleyen: ['⏳ Teslim bekliyor', 'Sevkiyatı açık ama teslim edilmemiş'], sevkiyatsiz: ['❓ Sevkiyatsız', 'Sevkiyat kaydı hiç açılmamış (elden/aksesuar satışı olabilir)'], iptal: ['🚫 İptal/iade', 'Sevkiyat iptal veya iade'], okunamadi: ['⚠️ Okunamadı', 'Sevkiyat kaydı okunamadı'] };
// ── V12.6b: DENEME SATIŞI TEMİZLEME (sevkiyat kaydı olmayan satışlar; satır satır işaretlenir, silmeden önce kopyası "silinenSatislar"a yazılır) ──
let silSecim = new Set();
const supheliMi = s => { const m = [s.custName, s.not, s.notlar, ...(s.urunler || []).map(u => u && (u.urun || u.kod))].join(' ');
  return !String(s.custName || '').trim() || /test|deneme|dene\b|asdf|xxx|\bqwe/i.test(m) || !((s.fiyat && s.fiyat.netNakit) > 0); };
function silmeKutusu() {
  const l = (denetim || []).filter(x => x.durum === 'sevkiyatsiz').sort((a, c) => String(c.sale.ts).localeCompare(String(a.sale.ts)));
  let h = '<div class="pa-kart" style="margin-top:12px"><h4>🧹 Deneme satışlarını temizle</h4>';
  if (!l.length) return h + '<p class="pa-not">Seçili ayda sevkiyat kaydı olmayan satış yok.</p></div>';
  h += '<p class="pa-not"><b>Dikkat:</b> bu listede gerçek elden/aksesuar satışlar da olabilir. Yalnız <b>deneme</b> olduğundan emin olduklarınızı işaretleyin. Silinen her satışın kopyası <b>silinenSatislar</b> koleksiyonuna yazılır (geri getirilebilir). ⚠️ işaretliler şüpheli: müşteri adı boş, "test/deneme" yazıyor ya da tutar yok.</p>'
    + '<div class="pa2-islem"><button type="button" class="pa-btn gri" id="pa-sil-supheli">⚠️ Şüphelileri işaretle</button><button type="button" class="pa-btn gri" id="pa-sil-temizle">İşaretleri kaldır</button></div>'
    + '<div class="pa-kaydir"><table class="pa-tab"><thead><tr><th></th><th>Satış no</th><th>Tarih</th><th>Müşteri / personel</th><th>Ürün</th><th>Tutar</th></tr></thead><tbody>'
    + l.map(x => { const s = x.sale, sp = supheliMi(s); return '<tr' + (sp ? ' style="background:#fffbeb"' : '') + '><td><input type="checkbox" data-pa-sil-sec="' + esc(s.id) + '"' + (silSecim.has(s.id) ? ' checked' : '') + '></td><td>' + (sp ? '⚠️ ' : '') + esc(s.id) + '</td><td>' + esc(new Date(s.ts).toLocaleDateString('tr-TR')) + '</td><td>' + esc(musteriAd(s) || '—') + '<br><small style="color:#71717a">' + esc(s.userAd || String(s.user || '').split('@')[0]) + '</small></td><td>' + esc((s.urunler || []).map(u => u && (u.urun || u.kod)).filter(Boolean).join(', ').slice(0, 60)) + '</td><td>' + TL((s.fiyat && s.fiyat.netNakit) || 0) + '</td></tr>'; }).join('')
    + '</tbody></table></div><button type="button" class="pa-btn kirmizi" id="pa-sil-yap" style="margin-top:8px">🗑 İşaretlileri sil (' + silSecim.size + ')</button></div>';
  return h;
}
async function denemeSil() {
  const idler = [...silSecim].filter(id => denetim && denetim.some(x => x.sale.id === id && x.durum === 'sevkiyatsiz'));
  if (!idler.length) { hata = 'Önce silinecek satırları işaretleyin.'; return yeniden(); }
  if (!(await onay(idler.length + ' satış KALICI olarak silinecek (kopyası "silinenSatislar"a yazılır).\n\n' + idler.slice(0, 12).join(', ') + (idler.length > 12 ? ' …' : '') + '\n\nDevam edilsin mi?'))) return;
  const b = kopru(), u = (kullanici() || {}).Email || '', silinen = [], basarisiz = [];
  for (const id of idler) {
    try {
      const s = saleOnbellek.get(id); if (!s) throw new Error('kayıt bellekte yok');
      const sv = await b.getDoc(b.doc(b.db, 'sevkiyatlar', id)); if (sv.exists()) throw new Error('sevkiyat kaydı sonradan açılmış');   // güvenlik: sevkiyatı olan satış silinmez
      await b.setDoc(b.doc(b.db, 'silinenSatislar', id), kopya({ sale: s, silen: u, t: Date.now(), neden: 'deneme satışı temizliği (prim kayıp denetimi)' }));
      await b.deleteDoc(b.doc(b.db, 'sales', id)); silinen.push(id);
    } catch (e) { basarisiz.push(id + ' (' + (e && e.message) + ')'); }
  }
  denetim = denetim.filter(x => !silinen.includes(x.sale.id)); silinen.forEach(id => { silSecim.delete(id); saleOnbellek.delete(id); svkOnbellek.delete(id); });
  sonKayitlar = sonKayitlar.filter(r => !(r.sale && silinen.includes(r.sale.id))); if (sonuc) yenidenHesapla();
  mesaj = '✓ ' + silinen.length + ' deneme satışı silindi' + (silinen.length ? ' (kopyalar: silinenSatislar). Personele yayınlanmış özet varsa "Personele yayınla"yı yeniden çalıştırın.' : '.'); if (basarisiz.length) hata = 'Silinemedi: ' + basarisiz.join('; ');
  yeniden();
}
function denetimKart() {
  let h = '<div class="pa-kart"><h4>🔍 Kayıp denetimi</h4><p class="pa-not">Ayda açılan her satışın prime girip girmediğini ve girmiyorsa nedenini gösterir. (Okuma: ayda açılan satış kadar.)</p><button type="button" class="pa-btn" id="pa-denetle">Seçili ayı denetle</button>';
  if (!denetim) return h + '</div>';
  const kisi = {}; denetim.forEach(x => { const em = String(x.sale.user || '?').toLowerCase(), K = (kisi[em] = kisi[em] || { ad: x.sale.userAd || em.split('@')[0], em, d: {} }), D = (K.d[x.durum] = K.d[x.durum] || { n: 0, kz: 0, prim: 0 }); D.n++; D.kz = P.r2(D.kz + x.damga.toplamKdvsiz); D.prim = P.r2(D.prim + x.damga.brutPrim); });
  const sutun = ['sayilan', 'baskaAy', 'bekleyen', 'sevkiyatsiz', 'iptal'];
  h += '<div class="pa-kaydir" style="margin-top:8px"><table class="pa-tab"><thead><tr><th>Kişi</th>' + sutun.map(s => '<th>' + DURUM[s][0] + '</th>').join('') + '</tr></thead><tbody>'
    + Object.values(kisi).sort((a, c) => a.ad.localeCompare(c.ad, 'tr')).map(K => '<tr class="pa-tikla" data-pa-den="' + esc(K.em) + '"><td>' + esc(K.ad) + '</td>' + sutun.map(s => { const D = K.d[s]; return '<td>' + (D ? D.n + ' · ' + TL(D.kz) + '<br><small style="color:#71717a">prim ' + TL(D.prim) + '</small>' : '–') + '</td>'; }).join('') + '</tr>'
      + (denetimAcik === K.em ? '<tr><td colspan="6" class="pa-acik">' + denetim.filter(x => String(x.sale.user || '?').toLowerCase() === K.em && x.durum !== 'sayilan').sort((a, c) => a.durum.localeCompare(c.durum)).map(x => '<div class="pa-sel"><span>' + esc(x.sale.id) + ' · ' + esc(String(x.sale.custName || '').replace(/&amp;/g, '&')) + ' · ' + esc((x.sale.ts || '').slice(0, 10)) + '</span><b>' + DURUM[x.durum][0] + ' · ' + TL(x.damga.toplamKdvsiz) + '</b></div>').join('') + '</td></tr>' : '')).join('')
    + '</tbody></table></div><p class="pa-not">Kişiye dokunun: sayılmayan satışlar tek tek listelenir. "Sevkiyatsız" satışlar prime girmemiştir; istersen Ayarlar → Genel\'den "sevkiyatsız satışları satış tarihiyle say" açılabilir.</p>';
  return h + '</div>' + silmeKutusu();
}
// ═══ V12.5 — PREMIUM GÖRÜNÜM + SORUNLU SATIŞ PRİM DÜZELTME ═══
const renkAl = ad => { let h = 0; String(ad || '?').split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) % 360; }); return 'hsl(' + h + ',55%,46%)'; };
const bas = ad => String(ad || '?').trim().charAt(0).toLocaleUpperCase('tr');
const satisBul = id => { const r = sonKayitlar.find(x => x.sale && (x.sale.id === id || x.sale.satisNo === id)); return r ? r.sale : {}; };
// V12.7: İNDİRİM = Teklif taslağında fiyatı düşürme (fiyat elle çekme) + Anlaşılan tutarda fiyatı düşürme (pazarlık) — ikisi de indirimdir; kampanya (❖ ✦ ⌗ ⎇) indirimi şirkete maliyet değildir, ayrı gösterilir.
const indToplam = d => Math.max(0, (Number(d.personelInd) || 0) + (d.cekmeDahil ? 0 : Number(d.fiyatCekme) || 0));   // cekmeDahil: elle çekme zaten personelInd içinde
const indKaynak = d => (d.personelInd > 0 && !(d.cekmeDahil && d.personelInd <= (Number(d.fiyatCekme) || 0)) ? 1 : 0) + (d.fiyatCekme > 0 ? 1 : 0);
const indirimMetni = d => 'Liste <b>' + TL(d.listeToplam) + '</b> → ödenen <b>' + TL(d.odenenToplam) + '</b>';
const IKON = { '🛠': '↘', '🔻': '↘', '🏷': '❖', '🧾': '⇄', '📉': '▲', '⚪': '○', '❓': '?', '✏️': '✎' };   // V12.7: rozetlerde sade, kurumsal simgeler (iç anahtar emoji kalır: filtreler bunlara bakar)
const rozetHtml = z => '<span class="pa2-roz r' + z[2] + (z[3] ? ' ' + z[3] : '') + '"><i>' + (IKON[z[0]] || z[0]) + '</i>' + esc(z[1]) + '</span>';
const musteriAd = s => String((s && s.custName) || '').replace(/&amp;/g, '&');
// Her satışın "sorun" işaretleri: [simge, kısa metin, ciddiyet]
// V12.13: "Gördüm" işareti — satırın durumu (prim + işaret türleri) değişmedikçe sorunlu listesinde tekrar çıkmaz; değişirse yeniden çıkar
const sorunImza = it => (((it.d.duzeltme ? it.d.duzeltme.prim : it.d.brutPrim) || 0).toFixed(2)) + '|' + it.u.map(z => z[0]).join('');
const gorulduMu = it => { const g = (ayar().sorunGorulen || {})[it.x.saleNo]; return !!g && g.s === sorunImza(it); };
const islenmis = it => !!it.d.duzeltme || gorulduMu(it);
let sonSorunListe = [];
async function gorulenYaz(ekle, sil) {
  const m = { ...(ayar().sorunGorulen || {}) }, simdi = Date.now(), em = (kullanici() || {}).Email || '';
  (ekle || []).forEach(it => { m[it.x.saleNo] = { s: sorunImza(it), t: simdi, u: em }; }); (sil || []).forEach(id => { delete m[id]; });
  Object.keys(m).forEach(k => { if (Number(m[k].t) < simdi - 150 * 864e5) delete m[k]; });
  try { await ayarKaydetBelge({ sorunGorulen: m }); mesaj = ''; hata = ''; } catch (e) { hata = 'Kaydedilemedi: ' + (e && e.message); }
  yeniden();
}
function sorunlar(x, k) {
  const d = x.d, A = ayar(), u = []; if (!d) return u;
  const yz = d.listeToplam > 0 ? indToplam(d) / d.listeToplam * 100 : 0;
  const lt = d.listeToplam > 0 ? d.listeToplam : 0, yp = v => lt ? '(' + PY(v / lt * 100) + ') ' : ' ';
  if (indToplam(d) > 0) u.push([d.fiyatCekme > 0 ? '🛠' : '🔻', (indKaynak(d) > 1 ? 'İndirimler' : 'İndirim') + yp(indToplam(d)) + '−' + TL(indToplam(d)), d.fiyatCekme > 0 ? 2 : 1, 'ri']);
  if (d.kampInd > 0) u.push(['🏷', 'Marka sübvansiyonu' + yp(d.kampInd) + '−' + TL(d.kampInd), 0, 'rk']);
  if (d.disSayilan > 0) u.push(['🧾', 'Samsung/3P dış ödeme +' + TL(d.disSayilan), 1]);
  const prim0 = d.duzeltme ? d.duzeltme.once : d.brutPrim;
  if (!(prim0 > 0)) u.push(['⚪', 'Prim çıkmadı (₺0)', 2]);
  if ((d.kalemler || []).some(l => l.gam && l.tur !== 'sigorta' && P.gamBul(A, l.gam).bilinmiyor)) u.push(['❓', 'Ürün gamı tanımsız', 2]);
  if (yz >= 10 && k && yz > k.ekipIndirimOrani + 3) u.push(['📉', 'Yüksek indirim düzeyi', 2]);
  if (d.duzeltme) u.push(['✏️', 'Yönetici düzeltti', 0]);
  return u;
}
function satisListesi() {
  const l = []; if (!sonuc) return l;
  sonuc.kisiler.forEach(k => k.kalemler.forEach(x => l.push({ k, x, d: x.d, sale: satisBul(x.saleNo), u: sorunlar(x, k) })));
  return l;
}
const sorunSayisi = () => satisListesi().filter(i => !islenmis(i) && i.u.some(z => z[2] >= 2)).length;   // V12.15: görülen/düzeltilen satırlar sayıdan düşer
function sorunSatiri(it) {
  const { k, x, d, sale, u } = it, acik = dzAcik === x.saleNo, dz = d.duzeltme, sistem = dz ? dz.once : d.brutPrim;
  const gor = gorulduMu(it); let h = '<div class="pa2-sat' + (acik ? ' acik' : '') + (dz ? ' dz' : '') + (gor && !dz ? ' gor' : '') + '"><div class="pa2-sat-ust"><div><div class="pa2-bno">' + esc(x.saleNo) + '</div><div class="pa2-alt">' + esc(musteriAd(sale) || '—') + ' · ' + esc(k.ad) + ' · ' + new Date(x.t).toLocaleDateString('tr-TR') + '</div></div>'
    + '<div class="pa2-sag"><div class="pa2-para">' + TL2(dz ? dz.prim : d.brutPrim) + '</div><div class="pa2-alt">' + (dz ? '<s>' + TL2(sistem) + '</s> · ' + (dz.mod === 'kesin' ? 'kesin' : 'brüt') : 'prim (KDV hariç)') + '</div></div></div>'
    + '<div class="pa2-alt" style="margin-top:6px">' + indirimMetni(d) + '</div>'
    + (u.length ? '<div class="pa2-rozetler">' + u.map(rozetHtml).join('') + '</div>' : '')
    + (dz ? '<div class="pa2-dznot">✏️ <b>' + esc(dz.neden || 'Neden yazılmadı') + '</b> — ' + esc(String(dz.u || '').split('@')[0]) + (dz.t ? ' · ' + new Date(dz.t).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '') + '</div>' : '');
  if (!acik) return h + (gor && !dz ? '<div class="pa2-gortag">✓ Görüldü</div>' : '') + '<div class="pa2-satbtn"><button type="button" class="pa2-btn ikincil" data-pa-dzac="' + esc(x.saleNo) + '">' + (dz ? '✏️ Düzeltmeyi değiştir' : '✏️ Primi düzelt') + '</button>' + (dz ? '' : gor ? '<button type="button" class="pa2-btn ikincil" data-pa-gorgeri="' + esc(x.saleNo) + '">↩ Geri al</button>' : '<button type="button" class="pa2-btn ikincil" data-pa-gor="' + esc(x.saleNo) + '">👁 Gördüm</button>') + '</div></div>';
  const tk = dzTaslak && dzTaslak.id === x.saleNo ? dzTaslak : null;   // V12.7: kayıt hatasında yazılanlar korunur
  const mod = tk ? tk.mod : dz ? dz.mod : 'brut', neden0 = tk ? tk.neden : dz ? dz.neden : '', tutar0 = tk ? tk.tutar : String(dz ? dz.prim : sistem).replace('.', ',');
  const indT = indToplam(d), oran = d.listeToplam > 0 ? indT / d.listeToplam : 0, oR = v => Math.max(0, Math.min(sistem, P.r2(v)));
  const oneriler = indT > 0 && sistem > 0 ? [['İndirim oranı kadar düşür (−%' + (oran * 100).toFixed(1).replace('.', ',') + ')', oR(sistem * (1 - oran))], ['Yarıya indir (−%50)', oR(sistem * 0.5)], ['Sembolik (%10)', oR(sistem * 0.1)]].filter((o, i, a) => o[1] < sistem && a.findIndex(z => z[1] === o[1]) === i) : [];
  h += '<div class="pa2-edit"><div class="pa2-edit-b">Sistemin hesabı</div>'
    + '<div class="pa-kaydir"><table class="pa-tab"><thead><tr><th>Ürün</th><th>KDV\'siz tutar</th><th>Oran</th><th>Prim</th></tr></thead><tbody>'
    + (d.kalemler || []).map(l => '<tr><td style="white-space:normal;max-width:170px">' + esc(l.ad || l.kod) + '</td><td>' + TL2(l.netKdvsiz) + '</td><td>' + PY(l.oran) + '</td><td>' + TL2(l.prim) + '</td></tr>').join('')
    + '<tr><td><b>Toplam</b></td><td><b>' + TL2(d.toplamKdvsiz) + '</b></td><td></td><td><b>' + TL2(sistem) + '</b></td></tr></tbody></table></div>'
    + '<div class="pa2-edit-b" style="margin-top:12px">1 · Bu satıştan personele yazılacak prim (₺)</div>'
    + '<div class="pa2-tutar"><input class="pa-giris" id="pa-dz-tutar" inputmode="decimal" value="' + esc(tutar0) + '" placeholder="örn. 175,00"><button type="button" class="pa2-btn ikincil kucuk" data-pa-dzsistem="' + esc(String(sistem)) + '">Sistem tutarı</button><button type="button" class="pa2-btn ikincil kucuk" data-pa-dzsifir="1">₺0</button></div>'
    + (oneriler.length ? '<div class="pa-not" style="margin-top:8px">💡 Önerilen (normal tutarın altında) — indirimli satışta prim indirimle orantılı düşürülür:</div><div class="pa2-oner">' + oneriler.map(o => '<button type="button" class="pa2-cip" data-pa-dzsistem="' + o[1] + '">' + esc(o[0]) + ' → <b>' + TL2(o[1]) + '</b></button>').join('') + '</div>' : '')
    + '<div class="pa2-sc"><div class="pa2-sc-b">🛡 SC+ sonradan eklendi mi?</div><div class="pa2-tutar"><input class="pa-giris" id="pa-dz-sc" inputmode="decimal" placeholder="SC+ bedeli (KDV dahil)"><button type="button" class="pa2-btn ikincil kucuk" data-pa-dzsc="' + esc(String(sistem)) + '">SC+ primini ekle</button></div><div class="pa-not">Mevcut prime SC+ primi (Ayarlar → Sigorta) eklenir, neden otomatik yazılır; satış rakamları değişmez.</div></div>'
    + '<div class="pa2-edit-b" style="margin-top:12px">2 · Bu tutar nasıl sayılsın?</div>'
    + '<label class="pa2-sec"><input type="radio" name="pa-dz-mod" value="brut"' + (mod !== 'kesin' ? ' checked' : '') + '><span><b>Satış primi olarak</b><small>Normal satış primi gibi işlenir; fazla indirim ve verimlilik kuralları yine uygulanır. <i>(Çoğu durumda bunu seçin.)</i></small></span></label>'
    + '<label class="pa2-sec"><input type="radio" name="pa-dz-mod" value="kesin"' + (mod === 'kesin' ? ' checked' : '') + '><span><b>Kesin tutar</b><small>Personele aynen bu kadar eklenir; hiçbir kesinti/çarpan uygulanmaz.</small></span></label>'
    + '<div class="pa2-edit-b" style="margin-top:12px">3 · Neden? <small>(zorunlu — personel ve kayıtlarda görünür)</small></div>'
    + '<div class="pa2-hizli">' + (indT > 0 ? ['Satış kârlılık düzeyi', 'Yüksek indirim düzeyi'] : ['Hatalı satış girişi', 'Yönetici kararı']).map(n => '<button type="button" class="pa2-cip" data-pa-dznedenyaz="' + esc(n) + '">' + esc(n) + '</button>').join('') + '</div>'
    + '<input class="pa-giris" id="pa-dz-neden" maxlength="120" value="' + esc(neden0) + '" placeholder="Gerekirse ayrıntı yazın (isteğe bağlı)">' + (acik && dzHata ? '<div class="pa2-dzhata" id="pa-dz-hata">⚠️ ' + esc(dzHata) + '</div>' : '')
    + '<div class="pa2-islem"><button type="button" class="pa2-btn" data-pa-dzkaydet="' + esc(x.saleNo) + '">💾 Kaydet</button>' + (dz ? '<button type="button" class="pa2-btn tehlike" data-pa-dzsil="' + esc(x.saleNo) + '">↩️ Sistem hesabına dön</button>' : '') + '<button type="button" class="pa2-btn ikincil" data-pa-dzkapat="1">Vazgeç</button></div>'
    + '<p class="pa-not" style="margin-top:8px">Kaydedince ay yeniden hesaplanır. Personelin ekranına <b>Personele yayınla</b> dediğinizde yansır. Değişiklik kim/ne zaman ile kayıt altında tutulur.</p></div></div>';
  return h;
}
function sorunHtml() {
  if (!sonuc) return '<div class="pa2-bos"><div class="pa2-bos-i">🛠</div><b>Önce ayı hesaplayın</b><p>"Hesap" sekmesinde ay seçip <b>Hesapla</b>ya basın; sorunlu satışlar burada listelenir.</p><button type="button" class="pa2-btn" data-pa-alt="hesap">Hesap sekmesine git</button></div>';
  const hepsi = satisListesi(), sor = hepsi.filter(i => i.u.some(z => z[2] >= 2)), dzl = hepsi.filter(i => i.d.duzeltme), q = P.norm(sorunAra || '');
  // V12.7: derin filtre — tür (sorun işareti) + personel + arama (belge no, müşteri, personel, ürün adı/kodu) + sıralama
  const vr = (i, simge) => i.u.some(z => z[0] === simge);
  const yeni = f => i => f(i) && !islenmis(i);   // görülen/düzeltilen satırlar türlerden düşer
  const turler = [['sorunlu', '⚠️ Sorunlu', yeni(i => i.u.some(z => z[2] >= 2))], ['cekilen', '🛠 Fiyat elle çekilen', yeni(i => vr(i, '🛠'))], ['primsiz', '⚪ Prim çıkmayan', yeni(i => vr(i, '⚪'))],
    ['gam', '❓ Gamı tanımsız', yeni(i => vr(i, '❓'))], ['indirim', '📉 Yüksek indirim', yeni(i => vr(i, '📉'))], ['dis', '🧾 Dış ödeme', yeni(i => vr(i, '🧾'))], ['gorulen', '👁 Görülen', i => gorulduMu(i) && !i.d.duzeltme], ['duzeltilen', '✏️ Düzeltilen', i => !!i.d.duzeltme], ['tumu', 'Tümü', () => true]];
  const tur = turler.find(t => t[0] === sorunFiltre) || turler[0];
  let l = hepsi.filter(tur[2]);
  if (sorunKisi) l = l.filter(i => i.k.email === sorunKisi);
  if (q) l = l.filter(i => P.norm([i.x.saleNo, musteriAd(i.sale), i.k.ad, ...(i.d.kalemler || []).map(z => (z.ad || '') + ' ' + (z.kod || ''))].join(' ')).includes(q));
  const agir = i => i.u.reduce((m, z) => Math.max(m, z[2]), 0), cek = i => Number(i.d.fiyatCekme) || 0, primi = i => (i.d.duzeltme ? i.d.duzeltme.prim : i.d.brutPrim) || 0;
  const sirala = { onerilen: (a, c) => (cek(c) > 0) - (cek(a) > 0) || cek(c) - cek(a) || agir(c) - agir(a) || c.x.t - a.x.t,   // fiyatı elle çekilenler en üstte (çekilen tutar büyükten küçüğe)
    cekme: (a, c) => cek(c) - cek(a) || c.x.t - a.x.t, tarih: (a, c) => c.x.t - a.x.t, prim: (a, c) => primi(c) - primi(a), kisi: (a, c) => String(a.k.ad).localeCompare(String(c.k.ad), 'tr') || c.x.t - a.x.t };
  l = l.slice().sort(sirala[sorunSira] || sirala.onerilen); sonSorunListe = l;
  const chip = (t) => '<button type="button" class="pa2-fil' + (sorunFiltre === t[0] ? ' on' : '') + '" data-pa-filtre="' + t[0] + '">' + t[1] + ' <b>' + (sorunKisi ? hepsi.filter(i => i.k.email === sorunKisi).filter(t[2]).length : hepsi.filter(t[2]).length) + '</b></button>';
  const kisiler = sonuc.kisiler.filter(k => k.kalemler && k.kalemler.length).slice().sort((a, c) => String(a.ad).localeCompare(String(c.ad), 'tr'));
  const opt = (v, ad, sec) => '<option value="' + esc(v) + '"' + (sec ? ' selected' : '') + '>' + esc(ad) + '</option>';
  const topCek = l.reduce((t, i) => t + cek(i), 0);
  let h = '<div class="pa2-baslik"><h3>Sorunlu satışlar</h3><p>Prim tutarı hatalı görünen satışı bulun, <b>doğru primi siz yazın</b>. ' + esc(P.ayAdi(ay)) + ' ayında teslim edilen satışlar taranır.</p></div>'
    + '<div class="pa2-fil-sat">' + turler.map(chip).join('') + '</div>'
    + '<div class="pa2-fil-ara"><select class="pa-giris" id="pa-sorun-kisi" aria-label="Personel">' + opt('', 'Tüm personel', !sorunKisi) + kisiler.map(k => opt(k.email, k.ad, k.email === sorunKisi)).join('') + '</select>'
    + '<select class="pa-giris" id="pa-sorun-sira" aria-label="Sıralama">' + [['onerilen', 'Sıralama: önerilen (çekilenler üstte)'], ['cekme', 'Çekilen tutar (çoktan aza)'], ['tarih', 'Tarih (yeni → eski)'], ['prim', 'Prim tutarı (çoktan aza)'], ['kisi', 'Personel adı']].map(o => opt(o[0], o[1], sorunSira === o[0])).join('') + '</select></div>'
    + '<input class="pa-giris pa2-ara" id="pa-sorun-ara" placeholder="🔎 Belge no, müşteri, personel veya ürün ara…" value="' + esc(sorunAra) + '">'
    + '<div class="pa-not" style="margin:6px 2px">' + l.length + ' satış' + (topCek > 0 ? ' · toplam elle çekilen <b>' + TL(topCek) + '</b>' : '') + (sorunKisi || q ? ' · <button type="button" class="pa2-cip" data-pa-filtretemizle="1">Filtreyi temizle</button>' : '') + '</div>';
  if (!l.length) return h + '<div class="pa2-bos"><div class="pa2-bos-i">✅</div><b>' + (q || sorunKisi ? 'Filtreye uyan satış yok' : sorunFiltre === 'duzeltilen' ? 'Henüz düzeltilmiş satış yok' : 'Bu türde satış yok') + '</b><p>' + (q || sorunKisi ? '' : 'Tüm satışlar için "Tümü"nü seçip istediğiniz satırı düzeltebilirsiniz.') + '</p></div>';
  if (['sorunlu', 'cekilen', 'primsiz', 'gam', 'indirim', 'dis'].includes(sorunFiltre) && l.length > 1) h += '<button type="button" class="pa2-btn ikincil pa2-gortum" data-pa-gortum="1">👁 Listedeki ' + l.length + ' satırı gördüm say</button>';
  h += '<div class="pa2-liste">' + l.slice(0, 120).map(sorunSatiri).join('') + '</div>' + (l.length > 120 ? '<p class="pa-not">İlk 120 satır gösterildi; aramayı daraltın.</p>' : '');
  h += '<details class="pa2-det"><summary>İşaretler ne anlama geliyor?</summary><p class="pa-not">🛠 satırın fiyatı elle düşürülmüş · 🧾 Samsung/3P dış ödeme sepete eklenmiş · ⚪ satıştan prim çıkmamış · ❓ ürün gamı Ayarlar\'da yok · 📉 şirketin karşıladığı indirim (satır/alt indirim, pazarlık) ekip ortalamasından çok yüksek · 🏷 kampanya indirimi (marka karşılar) sorun sayılmaz · ✏️ yönetici primi düzeltmiş. İşaretsiz satışlar da "Tümü" ile düzeltilebilir.</p></details>';
  return h;
}
async function hedefDocYaz(hd) {   // meta/primHedefler: hedefler + düzeltmeler + görünüm TEK belgede (her yazış hepsini korur)
  const b = kopru();
  await b.setDoc(b.doc(b.db, 'meta', 'primHedefler'), kopya({ hedefler: hd || hedefTaslak, duzeltmeler, gorunum: gorunumler, guncelleme: Date.now(), guncelleyen: (kullanici() || {}).Email || '' }));
}
const duzeltmeYaz = () => hedefDocYaz();
const aktifDonem = () => (ozelAcik && ozelBas && ozelBit && ozelBas <= ozelBit ? { bas: ozelBas, bit: ozelBit } : null);
function sonucHesapla(bek) { return P.aySonuc({ kayitlar: sonKayitlar, ayar: ayar(), hedefler: hedefTaslak, ay, bugun: Date.now(), urunBul, duzeltmeler, donem: hesapDonem, gorunum: gorunumler[ay] || {}, bekleyenler: bek || bekleyenKayitlar }); }
function yenidenHesapla() { sonuc = sonucHesapla(); }
async function duzeltmeKaydet(id) {
  const tut = $('pa-dz-tutar'), ned = $('pa-dz-neden'), modEl = document.querySelector('input[name="pa-dz-mod"]:checked');
  const prim = P.sayiya(tut && tut.value), neden = String(ned && ned.value || '').trim().slice(0, 120);
  if (!tut || !String(tut.value).trim() || !(prim >= 0)) { hata = 'Prim tutarını yazın (örn. 175,00).'; return yeniden(); }
  if (!neden) { hata = 'Lütfen düzeltme nedenini yazın (hızlı seçeneklerden birine dokunabilirsiniz).'; return yeniden(); }
  const eski = duzeltmeler[id], it = satisListesi().find(i => i.x.saleNo === id), once = it ? (it.d.duzeltme ? it.d.duzeltme.once : it.d.brutPrim) : 0;
  const yeni = { prim: P.r2(prim), mod: modEl && modEl.value === 'kesin' ? 'kesin' : 'brut', neden, once: P.r2(once), u: (kullanici() || {}).Email || '', t: Date.now(), ay };
  duzeltmeler[id] = { ...yeni, gecmis: [...(eski ? [{ prim: eski.prim, mod: eski.mod, neden: eski.neden, u: eski.u, t: eski.t }] : []), ...((eski && eski.gecmis) || [])].slice(0, 5) };
  dzHata = ''; dzTaslak = null;
  try { await Promise.race([duzeltmeYaz(), new Promise((_, ret) => setTimeout(() => ret(new Error('Sunucu yanıt vermedi (bağlantı yavaş/yok). Birkaç saniye sonra tekrar deneyin.')), 20000))]); yenidenHesapla(); dzAcik = ''; mesaj = '✓ ' + id + ' primi ' + TL2(yeni.prim) + ' olarak kaydedildi. Personele yansıtmak için "Hesap → Personele yayınla".'; }
  catch (e) { if (eski) duzeltmeler[id] = eski; else delete duzeltmeler[id]; dzTaslak = { id, tutar: String(tut.value), mod: yeni.mod, neden }; dzHata = 'Kaydedilemedi: ' + ((e && (e.code ? e.code + ' — ' : '') + e.message) || 'bilinmeyen hata') + (/permission/i.test(String(e && e.message)) ? ' — yetki/Firestore kuralları. Yönetici oturumunuzu yenileyip tekrar deneyin.' : ''); }
  yeniden(); { const he = document.getElementById('pa-dz-hata'); if (he && he.scrollIntoView) he.scrollIntoView({ block: 'center' }); }
}
async function duzeltmeSil(id) {
  if (!duzeltmeler[id] || !(await onay(id + ' için yönetici düzeltmesi kaldırılsın mı? Prim sistemin hesabına döner.'))) return;
  const eski = duzeltmeler[id]; delete duzeltmeler[id];
  try { await duzeltmeYaz(); yenidenHesapla(); dzAcik = ''; mesaj = '✓ ' + id + ' sistem hesabına döndürüldü.'; }
  catch (e) { duzeltmeler[id] = eski; hata = 'Kaydedilemedi: ' + (e && e.message); }
  yeniden();
}

// ── V12.6: dönem yazısı "1 Kas – 30 Kas · bugün 21. gün" ──
const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const kisaGun = g => Number(g.slice(8)) + ' ' + AY_KISA[Number(g.slice(5, 7)) - 1];
function donemYazi() {
  const D = P.donemBilgi(ay, aktifDonem()), bg = P.gunStr(Date.now()), n = D.gunSayisi, gun = bg < D.bas ? 0 : bg > D.bit ? n : P.gunFark(D.bas, bg) + 1;
  return kisaGun(D.bas) + ' – ' + kisaGun(D.bit) + ' · ' + (gun === 0 ? 'henüz başlamadı' : bg > D.bit ? 'tamamlandı (' + n + ' gün)' : 'bugün ' + gun + '. gün (' + n + ' günlük dönem)') + (D.tamAy ? '' : ' · özel aralık');
}
// ── V12.6: GÖRÜNÜM / gizli müşteri çarpanı (kişi detayında) ──
function gorunumKutusu(k) {
  const A = ayar().gorunum || {}; if (A.acik === false) return '<div class="pa2-gor"><div class="pa2-edit-b">👁 Hizmet kalitesi <small>· Ayarlar → Hizmet kalitesi\'den kapalı</small></div></div>';
  const g = (gorunumler[ay] || {})[k.email], tavan = Number(A.tavan) || 0;
  let h = '<div class="pa2-gor"><div class="pa2-edit-b">👁 Hizmet kalitesi / gizli müşteri <small>· hak edişten düşer, en çok %' + tavan + '</small></div>';
  if (g && (g.kesintiYuzde > 0 || g.bonusYuzde > 0)) h += '<div class="pa2-dznot">Şu an: ' + (g.kesintiYuzde > 0 ? '<b>−%' + g.kesintiYuzde + '</b>' : '') + (g.bonusYuzde > 0 && A.olumlu ? ' <b>+%' + g.bonusYuzde + '</b>' : '') + ' · ' + esc(g.neden || '—') + (g.kanit ? ' · kanıt: ' + esc(g.kanit) : '') + '<br><small>' + esc(g.u || '') + ' · ' + (g.t ? new Date(g.t).toLocaleString('tr-TR') : '') + '</small></div>';
  h += '<div class="pa2-tutar" style="margin-top:8px"><input class="pa-giris" id="pa-gor-yuzde" inputmode="decimal" placeholder="Kesinti % (0–' + tavan + ')" value="' + esc(g && g.kesintiYuzde ? String(g.kesintiYuzde).replace('.', ',') : '') + '">'
    + (A.olumlu ? '<input class="pa-giris" id="pa-gor-bonus" inputmode="decimal" placeholder="Ek % (0–' + (Number(A.bonusTavan) || 0) + ')" value="' + esc(g && g.bonusYuzde ? String(g.bonusYuzde).replace('.', ',') : '') + '">' : '') + '</div>'
    + '<input class="pa-giris" id="pa-gor-neden" style="margin-top:6px" maxlength="120" placeholder="Neden (zorunlu) — örn. gizli müşteri ziyareti 12 Kas, karşılama eksik" value="' + esc(g ? g.neden || '' : '') + '">'
    + '<input class="pa-giris" id="pa-gor-kanit" style="margin-top:6px" maxlength="120" placeholder="Kanıt / not (isteğe bağlı: rapor no, tarih)" value="' + esc(g ? g.kanit || '' : '') + '">'
    + '<div class="pa2-islem"><button type="button" class="pa2-btn kucuk" data-pa-gor-kaydet="' + esc(k.email) + '">Kaydet</button>' + (g ? '<button type="button" class="pa2-btn kucuk tehlike" data-pa-gor-sil="' + esc(k.email) + '">Kaldır</button>' : '') + '</div>'
    + (g && g.gecmis && g.gecmis.length ? '<small class="pa2-alt">Önceki girişler: ' + g.gecmis.map(x => '−%' + (x.kesintiYuzde || 0) + (x.bonusYuzde ? ' +%' + x.bonusYuzde : '') + ' (' + esc(x.u || '') + ', ' + new Date(x.t || 0).toLocaleDateString('tr-TR') + ')').join(' · ') + '</small>' : '') + '</div>';
  return h;
}
async function gorunumKaydet(email) {
  const A = ayar().gorunum || {}, tavan = Number(A.tavan) || 0, bTavan = Number(A.bonusTavan) || 0;
  const y = P.sayiya(($('pa-gor-yuzde') || {}).value), b = A.olumlu && $('pa-gor-bonus') ? P.sayiya($('pa-gor-bonus').value) : 0, neden = String(($('pa-gor-neden') || {}).value || '').trim().slice(0, 120), kanit = String(($('pa-gor-kanit') || {}).value || '').trim().slice(0, 120);
  if (!(y > 0 || b > 0)) { hata = 'Bir yüzde girin (kaldırmak için "Kaldır").'; return yeniden(); }
  if (y > tavan || b > bTavan || y < 0 || b < 0) { hata = 'Kesinti en çok %' + tavan + (A.olumlu ? ', ek en çok %' + bTavan : '') + ' olabilir.'; return yeniden(); }
  if (!neden) { hata = 'Lütfen nedenini yazın (kimden, neden, ne zaman).'; return yeniden(); }
  const havuz = (gorunumler[ay] = gorunumler[ay] || {}), eski = havuz[email];
  havuz[email] = { kesintiYuzde: P.r2(y), ...(b > 0 ? { bonusYuzde: P.r2(b) } : {}), neden, ...(kanit ? { kanit } : {}), u: (kullanici() || {}).Email || '', t: Date.now(), gecmis: [...(eski ? [{ kesintiYuzde: eski.kesintiYuzde || 0, bonusYuzde: eski.bonusYuzde || 0, neden: eski.neden, u: eski.u, t: eski.t }] : []), ...((eski && eski.gecmis) || [])].slice(0, 5) };
  try { await hedefDocYaz(); yenidenHesapla(); mesaj = '✓ Hizmet kalitesi kaydı yazıldı. Personele yansıtmak için "Hesap → Personele yayınla".'; }
  catch (e) { if (eski) havuz[email] = eski; else delete havuz[email]; hata = 'Kaydedilemedi: ' + (e && e.message); }
  yeniden();
}
async function gorunumSil(email) {
  const havuz = gorunumler[ay] || {}, eski = havuz[email]; if (!eski || !(await onay('Bu kişinin görünüm kaydı kaldırılsın mı?'))) return;
  delete havuz[email];
  try { await hedefDocYaz(); yenidenHesapla(); mesaj = '✓ Hizmet kalitesi kaydı kaldırıldı.'; } catch (e) { havuz[email] = eski; hata = 'Kaydedilemedi: ' + (e && e.message); }
  yeniden();
}

// ── HESAP (premium) ──
// ═══ V12.8: PRİM SİGORTASI (aykırı değer koruması) + EKİP NABZI ═══
let sigListe = [], sigNabiz = [], sigAcik = false, otoHesap = false, haftaOz = null;
const haftaAnahtar = () => { const d = new Date(Date.now() + 3 * 3600e3), t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const dow = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dow); return t.toISOString().slice(0, 10); };
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_e) { /* */ } };
// Onaylanan uyarı kalıcı gizlenir; yalnız uyarının METNİ (rakamları) değişirse yeniden çıkar. Eski kayıtlar (metinsiz) 7 gün geçerli.
const susturulmus = (id, msg) => { const m = (ayar().uyariSustur || {})[id]; if (!m) return false; if (m.m === undefined) return Number(m.t) > Date.now() - 7 * 864e5; return m.m === String(msg || ''); };
function sigHesapla() {
  const A = ayar(), L = [];
  try { P.ayarKontrol(A, urunListesi(), P.gunStr(Date.now())).forEach(x => L.push({ id: 'ayar:' + x.m.slice(0, 60), s: x.s, t: 'ayar', b: 'Ayar', m: x.m })); } catch (_e) { /* */ }
  try {
    const gun = P.gunStr(Date.now()), sk = lsGet('prim-vitrin-snap') || {}, onceki = sk.gun === gun ? sk.prev : sk.map;
    const v = P.vitrinDenetim(A, urunListesi(), onceki, gun); v.uyarilar.forEach(x => L.push(x));
    if (urunListesi().length && sk.gun !== gun) lsSet('prim-vitrin-snap', { gun, map: v.snap, prev: sk.map || null });
  } catch (_e) { /* */ }
  if (sonuc) { try { P.denetle(sonuc, A).forEach(x => L.push(x)); } catch (_e) { /* */ } }
  sigListe = L.filter(x => !susturulmus(x.id, x.m));
  sigNabiz = [];
  if (sonuc) { try { sigNabiz = sonuc.kisiler.map(k => ({ k, a: P.anekdot(k, sonuc.ekip, Date.now()) })).filter(x => x.a.ton !== 'n' && x.a.yonetici).sort((a, b) => (a.a.ton === 'kotu' ? 0 : 1) - (b.a.ton === 'kotu' ? 0 : 1)); } catch (_e) { /* */ } }
  haftaOz = null; if (sonuc && lsGet('prim-hafta-kapat') !== haftaAnahtar()) { try { haftaOz = P.haftaOzeti(sonuc, Date.now()); } catch (_e) { /* */ } }
  sigRozet();
  return sigListe;
}
const sigSayi = () => sigListe.filter(x => x.s === 'k' || x.s === 's').length;
function sigRozet() {
  try { const b = document.querySelector('.admin-tab[data-tab="prim"]'); if (!b) return; const n = sigSayi(), kk = sigListe.some(x => x.s === 'k'); b.innerHTML = '💰 Prim' + (n ? ' <i class="pa2-say" style="' + (kk ? '' : 'background:#f59e0b') + '">' + n + '</i>' : ''); } catch (_e) { /* */ }
}
function haftaKart() {
  const o = haftaOz; if (!o || !(o.son > 0 || o.onceki > 0)) return '';
  const adlar = l => l.map(x => esc(String(x.ad).split(/\s+/)[0]) + ' (' + (x.d > 0 ? '+' : '') + Math.round(x.d) + '%)').join(', ');
  let g = '<div class="pa2-hafta"><div class="pa2-hafta-ust"><b>📅 Haftalık özet</b><button type="button" class="pa2-sig-ok" data-pa-hafta-ok="1" title="Bu haftaki özeti kapat">✕</button></div>';
  g += '<div class="pa2-hafta-s">Son 7 gün: <b>' + TL(o.son) + '</b> (KDV hariç)' + (o.degisim !== null ? ' · geçen haftaya göre <b class="' + (o.degisim >= 0 ? 'iyi' : 'kotu') + '">' + (o.degisim >= 0 ? '+' : '') + Math.round(o.degisim) + '%</b>' : ' · karşılaştırma için ay biraz ilerlemeli') + '</div>';
  if (o.yuk.length) g += '<div class="pa2-hafta-s">🌟 Yükselenler: ' + adlar(o.yuk) + ' — tebrik edin.</div>';
  if (o.dus.length) g += '<div class="pa2-hafta-s">🤔 Düşenler: ' + adlar(o.dus) + ' — “Hayırdır, ne oldu?” diye sorun.</div>';
  if (o.sessiz.length) g += '<div class="pa2-hafta-s">💤 Son 7 gün satışsız: ' + o.sessiz.map(x => esc(String(x).split(/\s+/)[0])).join(', ') + '</div>';
  return g + '</div>';
}
function sigKart() {
  const L = sigListe, kk = L.filter(x => x.s === 'k'), ss = L.filter(x => x.s === 's');
  const dur = kk.length ? 'k' : ss.length ? 's' : 'ok', sus = Object.keys(ayar().uyariSustur || {}).length;
  const pill = kk.length ? kk.length + ' kritik' + (ss.length ? ' · ' + ss.length + ' dikkat' : '') : ss.length ? ss.length + ' dikkat' : 'Her şey yolunda';
  let h = '<div class="pa3-sig ' + dur + '"><div class="pa3-ust"><span class="pa3-kalkan">🛡</span><div class="pa3-bas"><b>Prim Sigortası</b><small>' + (sonuc ? 'Ayar, vitrin ve satış verisi denetlendi' : 'Satış denetimi için önce Hesapla') + '</small></div><span class="pa3-pill ' + dur + '">' + pill + '</span></div>';
  const goster = (sigAcik ? L : L.filter(x => x.s !== 'b').slice(0, 4));
  if (!L.length) h += '<div class="pa3-temiz">Aykırı bir durum görünmüyor. Onayladığınız uyarılar tekrar gösterilmez.</div>';
  h += goster.map(x => '<div class="pa3-s ' + x.s + '"><span class="pa3-ray"></span><div class="pa3-m"><em>' + (x.s === 'k' ? 'KRİTİK' : x.s === 's' ? 'DİKKAT' : 'BİLGİ') + (x.b ? ' · ' + esc(x.b) : '') + '</em>' + esc(x.m) + '</div><div class="pa3-btn">' + (x.kisi ? '<button type="button" class="pa3-git" data-pa-sig-git="' + esc(x.kisi) + '">İncele</button>' : '') + '<button type="button" class="pa3-onay" data-pa-sig-ok="' + esc(x.id) + '" title="Bu uyarı bir daha gösterilmez (rakamları değişirse yeniden çıkar)">✓ Onayladım</button></div></div>').join('');
  const kalan = L.length - goster.length; if (kalan > 0 || sigAcik && L.length > 4) h += '<button type="button" class="pa3-daha" data-pa-sig-daha="1">' + (sigAcik ? 'Daha az göster' : '+' + kalan + ' uyarı daha') + '</button>';
  if (sus) h += '<button type="button" class="pa3-sifirla" data-pa-sig-sifirla="1">↺ Onayladıklarımı yeniden göster (' + sus + ')</button>';
  h += '</div>';
  h += haftaKart();
  if (sigNabiz.length) h += '<div class="pa2-nabiz"><div class="pa2-nabiz-b">💬 Ekip nabzı</div>' + sigNabiz.slice(0, 5).map(x => '<div class="pa2-nabiz-s ' + x.a.ton + '"><span>' + (x.a.ton === 'iyi' ? '🌟' : '🤔') + '</span><div><b>' + esc(x.k.ad) + '</b> ' + esc(x.a.yonetici.replace(/^[^,:]+[,:] ?/, '')) + '</div></div>').join('') + '</div>';
  return h;
}
async function sigSifirla() {
  if (!(await onay('Onayladığınız tüm uyarılar yeniden gösterilsin mi?'))) return;
  try { await ayarKaydetBelge({ uyariSustur: {} }); } catch (e) { hata = 'Kaydedilemedi: ' + (e && e.message); }
  yeniden();
}
async function sigSustur(id) {
  const m = { ...(ayar().uyariSustur || {}) }, x = sigListe.find(z => z.id === id);
  m[id] = { u: (kullanici() || {}).Email || '', t: Date.now(), m: x ? String(x.m) : '' };
  Object.keys(m).forEach(k => { if (Number(m[k].t) < Date.now() - 365 * 864e5) delete m[k]; });
  try { await ayarKaydetBelge({ uyariSustur: m }); } catch (e) { hata = 'Kaydedilemedi: ' + (e && e.message); }
  yeniden();
}
// Admin panel açılınca günde bir kez: arka planda ayı hesapla + denetle; ciddi bir şey varsa tek uyarı
async function arkaPlan() {
  try {
    if (!yonetici()) return; const gun = P.gunStr(Date.now()), son = lsGet('prim-sig-gun');
    await ayarYukle(false); if (!hedeflerYuklendi) await hedefleriYukle(); await kisileriYukle();
    if (son === gun) { sigHesapla(); return; }
    ay = P.ayStr(Date.now()); hesapDonem = null; sonKayitlar = await ayKayitlari(ay, null); bekleyenKayitlar = []; sonuc = sonucHesapla(); otoHesap = true;
    lsSet('prim-sig-gun', gun); sigHesapla();
    const k = sigListe.filter(x => x.s === 'k').length, y = sigListe.filter(x => x.s === 's').length;
    if (k > 0 || y >= 3) { const msg = '🛡 Prim Sigortası: ' + (k ? k + ' kırmızı' : '') + (k && y ? ' · ' : '') + (y ? y + ' dikkat' : '') + ' uyarı var — Prim sekmesine bakın.'; if (typeof W.showToast === 'function') W.showToast(msg, k ? 'danger' : 'warning'); }
  } catch (e) { console.warn('prim sigortası arka plan:', e && e.message); }
}

// ═══ V12.11: DESTEK EKİBİ (satış ekibi ortalaması × skor; skor = anket + görünüm) ═══
async function destekYukle() {
  const A = ayar().destek; if (!A || !A.aktif || !sonuc) { destekVeri = null; return; }
  await kisileriYukle(); const b = kopru(); let anketler = [], yon = {};
  try { const sn = await b.getDocs(b.query(b.collection(b.db, 'destekAnket'), b.where('ay', '==', ay))); anketler = sn.docs.map(d => d.data()); } catch (e) { hata = 'Destek anketi okunamadı: ' + (e && e.message); }
  for (const d of destekListesi) { try { const s = await b.getDoc(b.doc(b.db, 'primOzet', P.destekYonId(ay, d.email))); if (s.exists()) yon[d.email] = s.data(); } catch (_e) { /* yok */ } }
  destekVeri = { ay, anketler, yon };
}
const destekHesap = () => (destekVeri && sonuc) ? P.destekPrimleri(sonuc, ayar(), destekListesi, destekVeri.anketler, destekVeri.yon) : [];
async function destekGorunum(v) {
  const [em, n] = String(v).split('|'), g = Number(n); if (!em || !(g >= 1 && g <= 5) || !destekVeri) return;
  const b = kopru(), kay = { email: em, ay, gorunum: g, u: (kullanici() || {}).Email || '', t: Date.now(), tur: 'destekYon' };
  try { await b.setDoc(b.doc(b.db, 'primOzet', P.destekYonId(ay, em)), kay); destekVeri.yon[em] = kay; mesaj = '✓ Görünüm puanı kaydedildi.'; hata = ''; }
  catch (e) { hata = 'Kaydedilemedi: ' + (e && e.message); }
  yeniden();
}
function destekKart() {
  const A = ayar().destek; if (!A || !A.aktif || !sonuc) return '';
  const bas = '<div class="pa4-destek"><div class="pa4-ust"><span class="pa4-ik">🤝</span><div><b>Destek ekibi</b><small>Satış ekibi ortalamasının %' + A.min + '–%' + A.max + '\'i' + ' · skor: anket %' + A.anketAgirlik + ' + görünüm %' + (100 - A.anketAgirlik) + '</small></div></div>';
  if (!destekVeri) return bas + '<p class="pa-not">Yükleniyor…</p></div>';
  if (!destekListesi.length) return bas + '<p class="pa-not">Rolü “destek” olan kullanıcı yok.</p></div>';
  const L = destekHesap();
  return bas + L.map(d => '<div class="pa4-kisi"><div class="pa4-s1"><b>' + esc(d.ad) + '</b><span class="pa4-tut">' + TL(d.tutar) + '</span></div>'
    + '<div class="pa4-chips"><span>Skor <b>' + Math.round(d.skor) + '</b>/100</span><span>%' + Math.round(d.yuzde) + ' oran</span><span>' + (d.anketN ? 'Anket: ' + d.anketN + ' kişi · ' + String(d.anketOrt).replace('.', ',') + '/5' : 'Anket yok') + '</span>' + (d.sinirli ? '<span class="uy">satış ekibi sınırına takıldı</span>' : '') + (d.kaynak === 'varsayilan' ? '<span class="uy">veri yok → nötr skor</span>' : '') + '</div>'
    + '<div class="pa4-gor"><small>Görünüm · kılık kıyafet · düzen</small><div class="pa4-pil">' + [1, 2, 3, 4, 5].map(n => '<button type="button" class="' + (d.gorunum === n ? 'on' : '') + '" data-pa-dgor="' + esc(d.email) + '|' + n + '">' + n + '</button>').join('') + '</div></div>'
    + (d.anketN ? '<div class="pa4-sor">' + P.DESTEK_SORU.map(s => esc(s.ad) + ' <b>' + (d.sorular[s.k] != null ? String(d.sorular[s.k]).replace('.', ',') : '—') + '</b>').join(' · ') + '</div>' : '') + '</div>').join('')
    + '<p class="pa-not" style="margin-top:8px">Hak ediş = satış ekibi ortalaması (' + TL(L[0] ? L[0].havuzOrt : 0) + ') × oran; satış ekibinin en düşüğünden düşük, en yükseğinden yüksek olamaz. Anket sonuçları anonimdir. ' + 'Personele <b>Yayınla</b> ile gider.' + '</p></div>';
}
function destekAyarHtml(T) {
  const D = T.destek || {};
  return '<div class="pa-kart"><h4>🤝 Destek ekibi puanı</h4><p class="pa-not">Rolü “destek” olanlar için: hak ediş = satış ekibi ortalaması × oran. Oran, <b>skora</b> göre alt-üst sınır arasında değişir; sonuç satış ekibinin en düşük/en yüksek hak edişini aşmaz. Skoru satış ekibinin anonim anketi ve yöneticinin görünüm (kılık kıyafet, düzen) puanı belirler.</p>'
    + onoff(['destek', 'aktif'], D.aktif === true, '<b>Destek puanı açık</b> (kapalıyken hiçbir şey değişmez)')
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>En düşük oran (%)</span>' + gir(['destek', 'min'], D.min) + '</div>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>En yüksek oran (%)</span>' + gir(['destek', 'max'], D.max) + '</div>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>Anket ağırlığı (%) <small>(kalanı görünüm)</small></span>' + gir(['destek', 'anketAgirlik'], D.anketAgirlik) + '</div></div>';
}
function hesapHtml() {
  const E = sonuc && sonuc.ekip;
  let h = '<div class="pa2-hero"><div class="pa2-hero-ust"><div><div class="pa2-eyebrow">PRİM YÖNETİMİ</div><div class="pa2-hero-b">' + esc(P.ayAdi(ay)) + '</div>'
    + '<div class="pa2-donem">📅 ' + esc(donemYazi()) + '</div><div class="pa2-hero-a">' + (E ? E.kisiSayisi + ' kişi · ' + sonKayitlar.length + ' teslim edilen satış · tutarlar KDV hariç · prim bazı: nakit fiyat' : 'Ay seçip hesaplayın; sonra personele yayınlayın.') + '</div></div></div>'
    + '<div class="pa2-hero-ctl"><input type="month" id="pa-ay" class="pa2-ay" value="' + esc(ay) + '"><button type="button" class="pa2-btn cam" id="pa-ozel-ac">' + (ozelAcik ? '✕ Tam ay' : '📅 Özel aralık') + '</button><button type="button" class="pa2-btn acik" id="pa-hesapla">' + (sonuc ? '↻ Yeniden hesapla' : 'Hesapla') + '</button>'
    + (sonuc ? '<button type="button" class="pa2-btn cam" id="pa-excel">📥 Excel</button>' + (E && E.donem && E.donem.tamAy === false ? '' : '<button type="button" class="pa2-btn kirmizi" id="pa-yayinla">📣 Personele yayınla</button>') : '') + '</div>'
    + (ozelAcik ? '<div class="pa2-hero-ctl" style="margin-top:8px"><label class="pa2-tarih">Başlangıç<input type="date" id="pa-ozel-bas" class="pa2-ay" value="' + esc(ozelBas || P.donemBilgi(ay).bas) + '"></label><label class="pa2-tarih">Bitiş<input type="date" id="pa-ozel-bit" class="pa2-ay" value="' + esc(ozelBit || P.donemBilgi(ay).bit) + '"></label></div><div class="pa2-hero-a" style="margin-top:6px">Hedefler aralık gününe göre küçülür (hedef × aralık günü ÷ ay günü). Teslim tarihi aralıkta olan satışlar sayılır. <b>Özel aralık personele yayınlanmaz</b>; yalnız burada ve Excel\'de görünür.</div>' : '')
    + (sonuc && E && E.donem && E.donem.tamAy === false ? '<div class="pa2-hero-a" style="margin-top:6px">⚠️ Sonuç <b>özel aralık</b> içindir; "Personele yayınla" gizlendi. Yayın için "✕ Tam ay"a dönüp yeniden hesaplayın.</div>' : '');
  if (E) {
    const topBrut = topla(k => k.brutToplam), topHak = topla(k => k.hakEdis), hy = E.toplamHedef > 0 ? E.toplamKdvsiz / E.toplamHedef * 100 : 0;
    h += '<div class="pa2-kpi"><div><span>Teslim satış</span><b>' + TL(E.toplamKdvsiz) + '</b></div><div><span>Hedefe göre</span><b>' + (E.toplamHedef > 0 ? PY(hy) : '—') + '</b></div><div><span>Brüt prim</span><b>' + TL(topBrut) + '</b></div><div><span>Toplam hak ediş</span><b>' + TL(topHak) + '</b></div></div>';
  }
  h += '</div>' + sigKart() + destekKart();
  if (!sonuc) return h + '<div class="pa2-bos"><div class="pa2-bos-i">💰</div><b>Henüz hesap yok</b><p>Ay seçip <b>Hesapla</b>ya basın. (Okuma: ayda teslim edilen satış sayısı kadar.)</p></div>' + aracKartlari();
  const sn = sorunSayisi(), dn = satisListesi().filter(i => i.d.duzeltme).length;
  if (sn || dn) h += '<button type="button" class="pa2-uyaris" data-pa-alt="sorun"><span>🛠</span><div><b>' + (sn ? sn + ' satışta dikkat edilmesi gereken durum var' : dn + ' satışın primi düzeltilmiş') + '</b><small>' + (sn ? 'Fiyatı elle çekilen, primi çıkmayan, gamı tanımsız satışlar → primi buradan düzeltebilirsiniz' : 'Düzeltmeleri görmek ve değiştirmek için dokunun') + '</small></div><i>›</i></button>';
  h += uyarilar().map(x => '<div class="pa-uyari">⚠️ ' + x + '</div>').join('');
  h += '<div class="pa2-bolum">Personel sıralaması <small>· dokunun, nasıl hesaplandığını görün</small></div><div class="pa2-kisiler">'
    + sonuc.kisiler.map(k => { const yz = Math.min(100, k.hedefYuzde), bek = E.beklenenOran; return '<div class="pa2-kisi' + (acikKisi === k.email ? ' acik' : '') + '"><div class="pa2-kisi-ust" data-pa-kisi="' + esc(k.email) + '" role="button">'
      + '<div class="pa2-sira">' + k.sira + '</div><div class="pa2-av" style="background:' + renkAl(k.ad) + '">' + esc(bas(k.ad)) + '</div>'
      + '<div class="pa2-kim"><b>' + esc(k.ad) + '</b><small>' + k.satisSayisi + ' satış · ' + TL(k.kdvsiz) + (k.duzeltmeSayisi ? ' · <span class="pa2-dzr">✏️ ' + k.duzeltmeSayisi + ' düzeltme</span>' : '') + '</small></div>'
      + '<div class="pa2-hak"><b>' + TL(k.hakEdis) + '</b><small>hak ediş</small></div></div>'
      + '<div class="pa2-bar"><i style="width:' + yz + '%"></i>' + (k.hedef > 0 ? '<u style="left:calc(' + Math.min(100, bek) + '% - 1px)" title="Bugün olması gereken"></u>' : '') + '</div>'
      + '<div class="pa2-cipler"><span>🎯 Hedef <b>' + (k.hedef > 0 ? PY(k.hedefYuzde) : '—') + '</b></span><span>⚡ Verimlilik <b>' + PY(k.verimlilik) + '</b></span><span>💎 Nitelikli <b>' + PY(k.nitelikliYuzde) + '</b></span><span>🏷 İndirim <b>' + PY(k.indirimOrani) + '</b></span></div>'
      + (acikKisi === k.email ? '<div class="pa2-detay">' + kisiDetay(k) + '</div>' : '') + '</div>'; }).join('') + '</div>'
    + '<div class="pa-not" style="margin-top:6px">Hedef çubuğundaki ince çizgi "bugün olması gereken" noktadır (ekip: ' + PY(E.beklenenOran) + ' · ekip indirim ort. ' + PY(E.indirimOrani) + ' · ort. verimlilik ' + PY(E.ortVerimlilik) + ').</div>';
  return h + aracKartlari();
}
function topla(f) { return sonuc ? P.r2(sonuc.kisiler.reduce((a, k) => a + f(k), 0)) : 0; }
function aracKartlari() {
  return '<details class="pa2-det" data-pa-det="den"' + (detAcik.has('den') ? ' open' : '') + '><summary>🔍 Kayıp denetimi — prime girmeyen satışlar</summary>' + denetimKart() + '</details>'
    + '<details class="pa2-det" data-pa-det="mhs"' + (detAcik.has('mhs') ? ' open' : '') + '><summary>📑 Muhasebe Excel ile karşılaştır</summary>' + mhsKart() + '</details>';
}
function kisiDetay(k) {
  const E = sonuc.ekip, satir = (ad, v, ek) => '<div class="pa2-ak' + (ek || '') + '"><span>' + ad + '</span><b>' + v + '</b></div>';
  const bazVer = k.brutToplam + k.indirimEtkisi, oranKayip = P.r2(bazVer * (1 - Math.min(100, Math.max(0, Number(k.verimlilik) || 0)) / 100));
  const an = (() => { try { return P.anekdot(k, sonuc.ekip, Date.now()); } catch (_e) { return null; } })();
  let h = (an && an.yonetici ? '<div class="pa2-nabiz-s ' + an.ton + '" style="margin:0 0 8px"><span>' + (an.ton === 'iyi' ? '🌟' : an.ton === 'kotu' ? '🤔' : '💬') + '</span><div>' + esc(an.yonetici) + '</div></div>' : '') + '<div class="pa2-akis">' + satir('1. Satışlarından elde edilen', TL2(k.brutToplam - (k.ekstra || 0)))
    + (k.ekstra > 0 || k.ekstraKesinti > 0 ? satir('⭐ Özel ürün puanı' + (k.ekstraKesinti > 0 ? ' <small>· indirim nedeniyle ' + TL2(k.ekstraKesinti) + ' düştü</small>' : ''), TL2(k.ekstra), ' arti') : '')
    + satir('İndirim aşımından kaybedilen' + (E.golge ? ' <small>(gölge: uygulanmıyor)</small>' : ''), TL2(k.indirimEtkisi), k.indirimEtkisi < 0 ? ' eksi' : '')
    + satir('Verimlilik (' + PY(k.verimlilik) + ') kaybı', (oranKayip > Math.abs(k.verimlilikEtkisi) && k.verimlilikEtkisi < 0 ? '<s style="opacity:.5;font-weight:500">' + TL2(-oranKayip) + '</s> ' : '') + TL2(k.verimlilikEtkisi), k.verimlilikEtkisi < 0 ? ' eksi' : '')
    + (k.onayKesinti ? satir('Hizmet kalitesi performansı ' + PY(Number(k.gorunumCarpani) * 100) + (k.gorunumNeden ? ' <small>· ' + esc(k.gorunumNeden) + '</small>' : ''), TL2(k.onayKesinti), k.onayKesinti < 0 ? ' eksi' : '') : '') + (k.kesin > 0 ? satir('✏️ Yönetici kesin primi', TL2(k.kesin)) : '')
    + satir('<b>Hak ediş</b>' + (E.golge ? ' <small>gölge: ' + TL2(k.golgeHakEdis) + '</small>' : ''), TL2(k.hakEdis), ' son') + '</div>'
    + gorunumKutusu(k) + '<div class="pa2-bolum k">Satışlar <small>· kişinin indirimi ' + PY(k.indirimOrani) + ' · ekip ' + PY(k.ekipIndirimOrani) + '</small></div>';
  h += k.kalemler.map(x => { const d = x.d, sale = satisBul(x.saleNo), u = sorunlar(x, k);
    return '<div class="pa2-mini"><div><b>' + esc(x.saleNo) + '</b><small>' + esc(musteriAd(sale) || '—') + ' · ' + new Date(x.t).toLocaleDateString('tr-TR') + '</small>'
      + (u.length ? '<div class="pa2-rozetler">' + u.map(rozetHtml).join('') + '</div>' : '') + '</div>'
      + '<div class="pa2-sag"><b>' + TL(d.listeToplam) + ' → ' + TL(d.odenenToplam) + '</b><small>' + '' + 'prim ' + (d.duzeltme ? '<s>' + TL2(d.duzeltme.once) + '</s> ' : '') + TL2(d.duzeltme ? d.duzeltme.prim : d.brutPrim) + '</small><button type="button" class="pa2-lnk" data-pa-dzgit="' + esc(x.saleNo) + '">✏️ Primi düzelt</button></div></div>'; }).join('');
  return h;
}
async function hesapla() {
  const d = $('pa-hesapla'); if (d) { d.disabled = true; d.textContent = 'Hesaplanıyor…'; }
  try {
    const ad = aktifDonem(); hesapDonem = ad; if (ad) ay = ad.bas.slice(0, 7);
    sonKayitlar = await ayKayitlari(ay, ad ? P.donemBilgi(ay, ad) : null); let ek = 0; bekleyenKayitlar = [];
    if (ayar().sevkiyatsizSay && !ad) { const dn = await ayDenetim(ay); dn.filter(x => x.durum === 'sevkiyatsiz').forEach(x => { sonKayitlar.push({ sale: x.sale, damga: P.damgaGecerli(x.sale.prim), teslimT: Date.parse(x.sale.ts) }); ek++; }); }
    sonuc = sonucHesapla(); dzAcik = ''; destekVeri = null; try { await destekYukle(); } catch (_e) { /* */ }
    mesaj = (sonKayitlar.length - ek) + ' teslim edilmiş satış okundu' + (ek ? ' + ' + ek + ' sevkiyatsız satış (satış tarihiyle)' : '') + '.';
  } catch (e) { hata = 'Hesap yapılamadı: ' + (e && e.message); sonuc = null; }
  yeniden();
}

// V12.3: Excel'e aktar — "Kişi özeti" + "Satır detayı" (1.xls ile aynı sütunlar → eski sistemle yan yana karşılaştırılır). Excel XML (.xls) olarak iner.

// V12.3c: GERÇEK .xlsx üretici (bağımlılıksız; ZIP "store"). Eski Excel-XML (.xls) bazı cihazlarda "bozuk" açılıyordu.
const XC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const xcrc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = XC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const xtemiz = v => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xkol = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
function xlsxBaytlar(sayfalar) {
  const enc = new TextEncoder(), dosyalar = [];
  const ekle = (ad, icerik) => dosyalar.push({ ad, veri: enc.encode(icerik) });
  const adlar = sayfalar.map((sf, i) => (String(sf.ad).replace(/[\\/?*\[\]:]/g, '-').replace(/^'+|'+$/g, '').slice(0, 31) || 'Sayfa' + (i + 1)));
  ekle('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sayfalar.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>');
  ekle('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  ekle('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + adlar.map((a, i) => '<sheet name="' + xtemiz(a).replace(/"/g, '&quot;') + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>');
  ekle('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sayfalar.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sayfalar.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  ekle('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  sayfalar.forEach((sf, si) => {
    const sat = sf.satirlar, genis = []; sat.forEach(r => r.forEach((v, c) => { genis[c] = Math.min(48, Math.max(genis[c] || 8, String(v == null ? '' : v).length + 2)); }));
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' + genis.map((g, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + g + '" customWidth="1"/>').join('') + '</cols><sheetData>'
      + sat.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, c) => { const ref = xkol(c) + (ri + 1); if (v === '' || v == null) return ''; if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + (ri ? ' s="2"' : ' s="1"') + '><v>' + v + '</v></c>'; return '<c r="' + ref + '" t="inlineStr"' + (ri ? '' : ' s="1"') + '><is><t xml:space="preserve">' + xtemiz(v) + '</t></is></c>'; }).join('') + '</row>').join('') + '</sheetData></worksheet>';
    ekle('xl/worksheets/sheet' + (si + 1) + '.xml', xml);
  });
  // ZIP (store)
  const parcalar = [], merkez = []; let ofs = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  dosyalar.forEach(f => {
    const ad = enc.encode(f.ad), crc = xcrc(f.veri), n = f.veri.length;
    const yerel = new Uint8Array([0x50, 0x4B, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(n), ...u32(n), ...u16(ad.length), 0, 0, ...ad]);
    parcalar.push(yerel, f.veri);
    merkez.push(new Uint8Array([0x50, 0x4B, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0, ...u32(crc), ...u32(n), ...u32(n), ...u16(ad.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(ofs), ...ad]));
    ofs += yerel.length + n;
  });
  const mb = merkez.reduce((t, m) => t + m.length, 0);
  const son = new Uint8Array([0x50, 0x4B, 5, 6, 0, 0, 0, 0, ...u16(dosyalar.length), ...u16(dosyalar.length), ...u32(mb), ...u32(ofs), 0, 0]);
  const tum = [...parcalar, ...merkez, son], boy = tum.reduce((t, p) => t + p.length, 0), out = new Uint8Array(boy); let o = 0; tum.forEach(p => { out.set(p, o); o += p.length; });
  return out;
}
function xlsxIndir(dosyaAdi, sayfalar) {
  const url = W.URL.createObjectURL(new W.Blob([xlsxBaytlar(sayfalar)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })), a = document.createElement('a');
  a.href = url; a.download = dosyaAdi; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => W.URL.revokeObjectURL(url), 4000);
}
const gunTr = t => { const d = new Date(Number(t) + 3 * 3600000); return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear(); };
function mhsExcel() {
  if (!mhs || !mhs.sk) return;
  const K = [['Cari Ünvanı (Excel)', 'Personel (Excel)', 'Tarih', 'Stok Kodu', 'Excel gam', 'Excel kategori', 'Excel çarpan', 'Excel KDV\'siz', 'Excel PRİM', 'Sistem satış no', 'Sistem durumu', 'Sistemde satışı yapan', 'Sistem gam', 'Sistem kategori', 'Sistem oran %', 'Sistem KDV\'siz', 'Sistem PRİM', 'Fark (Sistem − Excel)', 'Not']];
  mhs.sk.satirlar.forEach(r => K.push([r.cari, r.personel, r.tarih, r.stok, r.gam, r.kategori, r.carpan == null ? '' : r.carpan, r.kdvsiz == null ? '' : r.kdvsiz, r.excelPrim == null ? '' : r.excelPrim, r.saleId, (DURUM[r.durum] || [r.durum || ''])[0], r.sistemKisi, r.sGam, r.sKategori, r.sOran == null ? '' : r.sOran, r.sKdvsiz == null ? '' : r.sKdvsiz, r.sPrim == null ? '' : r.sPrim, r.fark == null ? '' : r.fark, r.not]));
  const F = [['Sistem satış no', 'Satışı yapan', 'Müşteri', 'Stok Kodu', 'Gam', 'Kategori', 'Oran %', 'KDV\'siz', 'Sistem PRİM']];
  mhs.sk.fazla.forEach(r => F.push([r.saleId, r.kisi, r.musteri, r.kod, r.gam, r.kategori, r.oran, r.kdvsiz, r.prim]));
  xlsxIndir('prim-karsilastirma-' + ay + '.xlsx', [{ ad: 'Excel-Sistem satir', satirlar: K }, { ad: 'Sistemde var Excelde yok', satirlar: F }]);
  mesaj = '✓ Karşılaştırma Excel\'i indirildi (' + (K.length - 1) + ' Excel satırı, ' + (F.length - 1) + ' fazla sistem kalemi).'; yeniden();
}

function excelAktar() {
  if (!sonuc) return;
  const sat = {}; sonKayitlar.forEach(r => { sat[r.sale.id] = r.sale; });
  const ozet = [['Sıra', 'Personel', 'E-posta', 'Satış adedi', 'KDV\'siz satış', 'Hedef', 'Hedef %', 'Nitelikli %', 'Verimlilik', 'Ödenen oran %', 'Brüt prim', 'İndirim etkisi', 'Verimlilik etkisi', 'Hizmet kalitesi etkisi', 'Yönetici kesin primi', 'Hak ediş']];
  sonuc.kisiler.forEach(k => ozet.push([k.sira, k.ad, k.email, k.satisSayisi, k.kdvsiz, k.hedef || 0, P.r2(k.hedefYuzde), P.r2(k.nitelikliYuzde), P.r2(k.verimlilik), k.odemeOrani, k.brutToplam, k.indirimEtkisi, k.verimlilikEtkisi, k.onayKesinti, k.kesin || 0, k.hakEdis]));
  const det = [['Cari Ünvanı', 'Personel', 'Belge No', 'Tarih (teslim)', 'Stok Kodu', 'Ürün', 'Ürün Gamı', 'Kategori', 'Kategori Çarpanı', 'Miktar', 'KDV\'siz Br Fiyat', 'KDV\'li Toplam', 'Prim', 'Grup', 'Teslim durumu', 'Sayılma nedeni', 'Fatura kesen', 'Elle fiyat çekme (satış)', 'Yönetici prim düzeltmesi']];
  sonuc.kisiler.forEach(k => k.kalemler.forEach(x => { const s0 = sat[x.saleNo] || {}; x.d.kalemler.forEach(l => det.push([s0.custName || '', k.ad, x.saleNo, gunTr(x.t), l.kod, l.ad, l.gam, l.kategori || '', P.r2(l.oran / 100 * 1000) / 1000, 1, l.netKdvsiz, l.net, l.prim, l.grup === 'verimsiz' ? 'Verimsiz' : (l.tur === 'sigorta' ? 'Sigorta' : 'Nitelikli'), 'Teslim edildi', 'Bu ayın hesabında', s0.faturaKesen === 'samsung' ? 'Samsung' : '', x.d.fiyatCekme > 0 ? x.d.fiyatCekme : '', x.d.duzeltme ? 'Sistem ' + x.d.duzeltme.once + ' → ' + x.d.duzeltme.prim + ' (' + (x.d.duzeltme.mod === 'kesin' ? 'kesin' : 'brüt') + ') · ' + x.d.duzeltme.neden : ''])); }));
  (denetim || []).filter(x => x.durum !== 'sayilan').forEach(x => (x.damga.kalemler || []).forEach(l => det.push([x.sale.custName || '', x.sale.userAd || String(x.sale.user || '').split('@')[0], x.sale.id, gunTr(Date.parse(x.sale.ts)), l.kod, l.ad, l.gam, l.kategori || '', P.r2(l.oran / 100 * 1000) / 1000, 1, l.netKdvsiz, l.net, l.prim, l.grup === 'verimsiz' ? 'Verimsiz' : 'Nitelikli', (DURUM[x.durum] || [x.durum])[0], (DURUM[x.durum] || ['', ''])[1] + ' (prime girmedi; tarih = satış tarihi)', x.sale.faturaKesen === 'samsung' ? 'Samsung' : ''])));
  xlsxIndir('prim-' + (sonuc.ekip.donem && !sonuc.ekip.donem.tamAy ? sonuc.ekip.donem.bas + '_' + sonuc.ekip.donem.bit : ay) + '.xlsx', [{ ad: 'Kisi ozeti', satirlar: ozet }, { ad: 'Satir detayi', satirlar: det }]);
  mesaj = '✓ Excel indirildi (' + (det.length - 1) + ' satır' + (denetim ? '' : '; sayılmayan satırlar için önce "Seçili ayı denetle"yi çalıştırın') + ').'; yeniden();
}
async function bekleyenleriTopla() {   // teslim edilmemiş satışlar (bu ay + geçen ay açılanlar): personele "bekleyen puan" için
  if (ay !== P.ayStr(Date.now())) return [];
  const [y, m] = ay.split('-').map(Number), onceki = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7), gor = new Set(), l = [];
  [...(await ayDenetim(ay)), ...(await ayDenetim(onceki))].forEach(x => { if (x.durum === 'bekleyen' && !gor.has(x.sale.id)) { gor.add(x.sale.id); l.push({ sale: x.sale, damga: P.damgaGecerli(x.sale.prim) }); } });
  return l;
}
async function yayinla() {
  if (!sonuc) return;
  if (sonuc.ekip.donem && sonuc.ekip.donem.tamAy === false) { hata = 'Özel aralık personele yayınlanmaz. "✕ Tam ay"a dönüp yeniden hesaplayın.'; return yeniden(); }
  sigHesapla(); const kirm = sigListe.filter(x => x.s === 'k');
  if (kirm.length && !(await onay('⚠️ Yayınlamadan önce ' + kirm.length + ' kırmızı uyarı var:\n\n' + kirm.slice(0, 5).map(x => '• ' + (x.b ? x.b + ': ' : '') + x.m).join('\n') + (kirm.length > 5 ? '\n… ve ' + (kirm.length - 5) + ' uyarı daha' : '') + '\n\nYine de personele yayınlansın mı?'))) return;
  if (!(await onay('Personele yayınlansın mı?\n\n' + sonuc.kisiler.length + ' kişinin ' + P.ayAdi(ay) + ' skor özeti yazılır (puan olarak). Kişi yalnız kendi özetini görür.' + (ay === P.ayStr(Date.now()) ? '\nTeslim bekleyen satışlar "bekleyen puan" olarak eklenir (ek okuma yapılır).' : '') + (ayar().golge ? '\n(Gölge mod: indirim kesintisi uygulanmıyor.)' : '')))) return;
  const b = kopru(); try {
    try { bekleyenKayitlar = await bekleyenleriTopla(); } catch (e2) { bekleyenKayitlar = []; mesaj = 'Bekleyen satışlar okunamadı (' + (e2 && e2.message) + '); özet bekleyen puan olmadan yazıldı. '; }
    yenidenHesapla();
    const simdi = Date.now(), liste = sonuc.kisiler;
    for (let i = 0; i < liste.length; i += 400) { const bt = b.writeBatch(b.db); liste.slice(i, i + 400).forEach(k => bt.set(b.doc(b.db, 'primOzet', P.ozetDocId(ay, k.email)), kopya(P.kisiOzeti(sonuc, k, simdi, ayar())))); await bt.commit(); }
    let dN = 0; if (ayar().destek && ayar().destek.aktif) { try { await destekYukle(); const dl = destekHesap(), bt = b.writeBatch(b.db); dl.forEach(x => bt.set(b.doc(b.db, 'primOzet', P.ozetDocId(ay, x.email)), kopya(P.destekOzeti(x, ay, simdi, ayar())))); if (dl.length) await bt.commit(); dN = dl.length; } catch (e3) { mesaj += 'Destek özeti yazılamadı (' + (e3 && e3.message) + '). '; } }
    mesaj += '✓ ' + liste.length + ' kişinin özeti yayınlandı' + (dN ? ' + ' + dN + ' destek' : '') + (bekleyenKayitlar.length ? ' (' + bekleyenKayitlar.length + ' bekleyen satış dahil)' : '') + '.';
  } catch (e) { hata = 'Yayınlanamadı: ' + (e && e.message) + (/permission/i.test(String(e && e.message)) ? ' — Firestore kuralları (Aşama H) yayınlanmamış olabilir.' : ''); }
  yeniden();
}
const onay = m => (typeof W.ayConfirm === 'function' ? W.ayConfirm(m) : Promise.resolve(confirm(m)));

// ═══ KAPANIŞ ═══
let kapRapor = null;
// V12.3: TEK KAYNAK — satış noktaları + mağaza harfi + marka ayrımı. Eski kayıtlarda (noktaKaynak yok) sevkiyat noktaları ve eski harfler gösterilir, kaydedince buraya taşınır.
function noktaListesi() {
  const A = ayar(), l = kopya(A.noktalar);
  if (A.noktaKaynak !== 'prim') { try { (W.Sevkiyat && W.Sevkiyat.noktalar ? W.Sevkiyat.noktalar() : []).forEach(ad => { if (!l.some(n => P.norm(n.ad) === P.norm(ad))) l.push({ ad }); }); } catch (_e) { /* yoksay */ } }
  const eski = W._magazaHarfleri || {}; l.forEach(n => { if (!n.harf && eski[n.ad]) n.harf = eski[n.ad]; });
  return l;
}
function kapanisHtml() {
  const A = ayar(), L = noktaTaslak || noktaListesi();
  let h = '<div class="pa-kart"><h4>Satış / kapanış noktaları (tek kaynak)</h4><p class="pa-not">Mağaza açılır/kapanırsa buradan ekleyin veya çıkarın; <b>satış formu, sevkiyat ve satış numarası</b> bu listeyi kullanır. <b>Harf</b>: satış numarasının 4. harfi (her noktaya farklı). "Marka ayrımı" olan noktada satış kalemleri markaya göre bölünür (örn. NF mağazasında Samsung → S-NF, Vestel → V-NF).</p>';
  h += L.map((n, i) => '<div class="pa-sat" style="grid-template-columns:70px 44px 1fr auto"><b>' + esc(n.ad) + '</b><input class="pa-giris" style="text-align:center;text-transform:uppercase" maxlength="1" data-pa-nokta-harf="' + i + '" placeholder="Harf" value="' + esc(n.harf || '') + '"><input class="pa-giris" data-pa-nokta-ayir="' + i + '" placeholder="Marka ayrımı (boş bırakılabilir): S-NF=Samsung, V-NF=Vestel" value="' + esc((n.ayir || []).map(x => x.ad + '=' + (x.markalar || []).join('|')).join(', ')) + '"><button type="button" class="pa-btn gri" style="padding:4px 9px" data-pa-nokta-sil="' + i + '">✕</button></div>').join('');
  noktaTaslak = L;
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
    kapRapor = { satilan: P.kapanisRaporu(sat.map(s => ({ sale: s, damga: P.damgaGecerli(s.prim), teslimT: Date.parse(s.ts) })), A, kapGun, urunBul, 'satis'),
      teslim: P.kapanisRaporu(tsat.map(s => ({ sale: s, damga: P.damgaGecerli(s.prim), teslimT: t[s.id] })), A, kapGun, urunBul, 'teslim') };
  } catch (e) { hata = 'Rapor alınamadı: ' + (e && e.message); kapRapor = null; }
  yeniden();
}
function noktaAyirParse(m) {
  return String(m || '').split(',').map(x => x.trim()).filter(Boolean).map(x => { const [ad, mk] = x.split('='); return { ad: String(ad || '').trim(), markalar: String(mk || '').split('|').map(y => y.trim()).filter(Boolean) }; }).filter(x => x.ad && x.markalar.length);
}
let noktaTaslak = null;
function noktaDomOku(liste) {
  document.querySelectorAll('[data-pa-nokta-ayir]').forEach(i => { const n = liste[Number(i.dataset.paNoktaAyir)]; if (n) { const a = noktaAyirParse(i.value); if (a.length) n.ayir = a; else delete n.ayir; } });
  document.querySelectorAll('[data-pa-nokta-harf]').forEach(i => { const n = liste[Number(i.dataset.paNoktaHarf)]; if (n) { const h = String(i.value || '').trim().toLocaleUpperCase('en-US'); if (h) n.harf = h; else delete n.harf; } });
}
async function noktaKaydet(domOku) {
  const liste = noktaTaslak || noktaListesi(); if (domOku !== false) noktaDomOku(liste);
  const adlar = liste.map(n => P.norm(n.ad)); if (new Set(adlar).size !== adlar.length) { hata = 'Aynı isimde iki nokta olamaz.'; return yeniden(); }
  const izinli = W._SN_HARFLER || 'ABCDEFGHJKLMNPRSTUVY', gor = {};
  for (const n of liste) { if (!n.harf) continue; if (!(n.harf.length === 1 && izinli.includes(n.harf))) { hata = n.ad + ': "' + n.harf + '" harfi kullanılamaz. Geçerli: ' + izinli.split('').join(' ') + ' (0, 1, I, O, Q, W, Z, X yasak).'; return yeniden(); } if (gor[n.harf]) { hata = '"' + n.harf + '" harfi iki noktaya verilmiş (' + gor[n.harf] + ', ' + n.ad + ').'; return yeniden(); } gor[n.harf] = n.ad; }
  try {
    await ayarKaydetBelge({ noktalar: liste, noktaKaynak: 'prim' }); taslak.noktalar = kopya(liste); taslak.noktaKaynak = 'prim'; noktaTaslak = null;
    // Eski sürümler (V11.95 canlı) aynı bilgiyi eski belgelerden okur → aynala (meta/magazaHarfleri, meta/sevkiyatTanimlar.noktalar)
    const b = kopru(), harfler = {}; liste.forEach(n => { if (n.harf) harfler[n.ad] = n.harf; });
    try { await b.setDoc(b.doc(b.db, 'meta', 'magazaHarfleri'), { harfler, ts: Date.now(), guncelleyen: (kullanici() || {}).Email || '' }); W._magazaHarfleri = harfler; try { localStorage.setItem('aygun_mharf', JSON.stringify({ ts: Date.now(), harfler })); } catch (_e) { /* yoksay */ } } catch (e) { console.warn('harf aynası:', e && e.message); }
    try { await b.setDoc(b.doc(b.db, 'meta', 'sevkiyatTanimlar'), { noktalar: liste.map(n => n.ad), ts: Date.now() }, { merge: true }); } catch (e) { console.warn('nokta aynası:', e && e.message); }
    mesaj = '✓ Noktalar ve harfler kaydedildi (satış formu, sevkiyat ve satış numarası aynı listeyi kullanır).';
  } catch (e) { hata = 'Kaydedilemedi: ' + (e && e.message); }
  yeniden();
}

// ═══ AYARLAR ═══
const yolAl = (o, y) => y.reduce((a, k) => (a == null ? a : a[k]), o);
const yolYaz = (o, y, v) => { let a = o; for (let i = 0; i < y.length - 1; i++) { if (a[y[i]] == null) a[y[i]] = {}; a = a[y[i]]; } a[y[y.length - 1]] = v; };
const gir = (yol, v, ek) => '<input class="pa-giris" inputmode="decimal" data-pa-yol="' + esc(JSON.stringify(yol)) + '" value="' + esc(v ?? '') + '"' + (ek || '') + '>';
const metin = (yol, v, ph, tip) => '<input class="pa-giris" type="' + (tip || 'text') + '" data-pa-yol="' + esc(JSON.stringify(yol)) + '" data-pa-metin="1" placeholder="' + esc(ph || '') + '" value="' + esc(v ?? '') + '">';
const onoff = (yol, v, ad) => '<label class="pa2-sw"><input type="checkbox" data-pa-yol="' + esc(JSON.stringify(yol)) + '" data-pa-kutu="1"' + (v ? ' checked' : '') + '><i></i><span>' + ad + '</span></label>';
// ── V12.6: SİMÜLASYON (kaydetmeden): aynı ay verisiyle farklı verimlilik kuralları → kim ne alır ──
function simulasyonHtml() {
  let h = '<div class="pa-kart pa-kaydir"><h4>Simülasyon: ödeme etkisi</h4>';
  if (!sonuc) return h + '<p class="pa-not">Önce <b>Hesap</b> sekmesinde bir ayı hesaplayın. Sonra burada, <b>kaydetmeden</b>, barem değişikliğinin toplam ödemeyi ve kişileri nasıl etkilediğini görürsünüz.</p></div>';
  let tv; try { tv = ayarTemizle(taslak).verimlilik; } catch (_e) { tv = {}; }
  const sc = [{ ad: 'Şu an kayıtlı', verimlilik: {} }, { ad: 'Taslak (ekrandaki)', verimlilik: tv }, { ad: 'Eski: sürekli çarpan', verimlilik: { mod: 'surekli', hedefTaban: 0 } }, { ad: 'Alternatif: verimlilik ÷ 85', verimlilik: { mod: 'v85', hedefTaban: 0 } }];
  const R = P.simulasyon({ kayitlar: sonKayitlar, ayar: ayar(), hedefler: hedefTaslak, ay, bugun: Date.now(), urunBul, duzeltmeler, donem: hesapDonem, gorunum: gorunumler[ay] || {} }, sc), taban = R.senaryolar[2].toplam;
  h += '<p class="pa-not"><b>' + esc(P.ayAdi(ay)) + '</b> verisiyle hesaplandı. "Eski" sütunu kıyas içindir: <b>eskiye göre</b> fark, taslağın maliyetini gösterir.</p>'
    + '<table class="pa-tab"><thead><tr><th>Kişi</th><th>Verim.</th><th>Hedef</th>' + sc.map(x => '<th>' + esc(x.ad) + '</th>').join('') + '</tr></thead><tbody>'
    + R.kisiler.map(k => '<tr><td>' + esc(k.ad) + '</td><td>' + PY(k.verimlilik) + '</td><td>' + (k.hedefYuzde > 0 ? PY(k.hedefYuzde) : '—') + '</td>' + k.hakedis.map((v, i) => '<td>' + TL(v) + '<br><small style="color:#71717a">oran %' + String(k.oran[i]).replace('.', ',') + (i > 0 && k.hakedis[2] ? ' · ' + (v - k.hakedis[2] >= 0 ? '+' : '−') + TL(Math.abs(v - k.hakedis[2])) : '') + '</small></td>').join('') + '</tr>').join('')
    + '<tr style="font-weight:800"><td>TOPLAM</td><td></td><td></td>' + R.senaryolar.map((x, i) => '<td>' + TL(x.toplam) + (i > 0 && taban > 0 ? '<br><small>eskiye göre ' + (x.toplam >= taban ? '+' : '−') + PY(Math.abs(x.toplam - taban) / taban * 100) + '</small>' : '') + '</td>').join('') + '</tr></tbody></table>'
    + '<p class="pa-not">Ayarlardaki değişiklikler <b>Ayarları kaydet</b> denene kadar uygulanmaz. Tabloyu yenilemek için: <button type="button" class="pa-btn gri" style="padding:4px 10px" data-pa-sim="1">↻ Güncelle</button></p></div>';
  return h;
}
function baremHtml(T) {
  const V = T.verimlilik, bl = V.baremler || [];
  let h = '<div class="pa-kart"><h4>Verimlilik ödemesi (barem)</h4><p class="pa-not">Verimlilik % (0,4×hedef + 0,6×nitelikli) hesaplanmaya devam eder; <b>barem</b> bu yüzdeyi <b>ödenen orana</b> çevirir. En alt eşiğin altı = ödeme yok.</p>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 150px"><span>Yöntem</span><select class="pa-giris" data-pa-yol="' + esc(JSON.stringify(['verimlilik', 'mod'])) + '" data-pa-metin="1" data-pa-yeniden="1"><option value="barem"' + (V.mod === 'barem' || !V.mod ? ' selected' : '') + '>Kademeli barem</option><option value="surekli"' + (V.mod === 'surekli' ? ' selected' : '') + '>Sürekli (oran = verimlilik %)</option><option value="v85"' + (V.mod === 'v85' ? ' selected' : '') + '>Verimlilik ÷ 85</option></select></div>';
  if (V.mod === 'barem' || !V.mod) h += '<table class="pa-tab"><thead><tr><th>Verimlilik en az (%)</th><th>Ödenen oran (%)</th><th></th></tr></thead><tbody>' + bl.map((b, i) => '<tr><td style="width:110px">' + gir(['verimlilik', 'baremler', i, 'esik'], b.esik) + '</td><td style="width:110px">' + gir(['verimlilik', 'baremler', i, 'oran'], b.oran) + '</td><td><button type="button" class="pa-btn gri" style="padding:4px 9px" data-pa-barem-sil="' + i + '">✕</button></td></tr>').join('') + '</tbody></table><button type="button" class="pa-btn gri" style="margin-top:6px" id="pa-barem-ekle">＋ Kademe ekle</button>';
  h += '<div class="pa-sat" style="grid-template-columns:1fr 90px;margin-top:10px"><span>Hedefi tutturana en az ödenen oran (%) <small>0 = kapalı</small></span>' + gir(['verimlilik', 'hedefTaban'], V.hedefTaban) + '</div>'
    + '<p class="pa-not">Örn. taban 90: hedefini %100 ve üstü tamamlayan kişide verimlilik düşük çıksa bile ödeme en az %90 olur.</p></div>';
  return h;
}
function gorunumAyarHtml(T) {
  const G = T.gorunum || {};
  return '<div class="pa-kart"><h4>Hizmet kalitesi</h4><p class="pa-not">Gizli müşteri / görünüm değerlendirmesi: yönetici <b>Hesap → kişi detayı</b>nda yüzde girer, hak edişten düşer. Her giriş kim/ne zaman ile kaydedilir, nedeni zorunludur, geri alınabilir. Personel yalnız "Hizmet kalitesi %95" görür.</p>'
    + onoff(['gorunum', 'acik'], G.acik !== false, '<b>Hizmet kalitesi açık</b>')
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>En çok kesinti (%)</span>' + gir(['gorunum', 'tavan'], G.tavan) + '</div>'
    + onoff(['gorunum', 'olumlu'], G.olumlu === true, 'Olumlu mod: uyumlu olana <b>ek %</b> verilebilsin')
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>En çok ek (%)</span>' + gir(['gorunum', 'bonusTavan'], G.bonusTavan) + '</div></div>';
}

// ── V12.8: ürün seçici (alttan açılan liste) — özel ürün primi için kod elle yazılmaz ──
const urunListesi = () => { try { return (W._primBridge && W._primBridge.urunler && W._primBridge.urunler()) || []; } catch (_e) { return []; } };
const uAlan = (u, ad) => { const k = Object.keys(u).find(x => P.norm(x) === ad); return k ? u[k] : ''; };
const uKod = u => String(u.Kod != null ? u.Kod : (u.kod != null ? u.kod : ''));
const uAd = u => String(uAlan(u, 'urun') || ''), uGam = u => String(Object.keys(u).filter(x => P.norm(x).includes('gam')).map(x => u[x])[0] || '');
function urunAdi(kod) { const u = urunListesi().find(x => uKod(x) === String(kod).trim()); return u ? uAd(u) : ''; }
function normalPrimYazi(kod) { const u = urunListesi().find(x => uKod(x) === String(kod).trim()); if (!u) return ''; try { const x = P.urunPrimi(taslakAyar(), u, '1900-01-01'); return 'Normal prim ' + TL2(x.prim); } catch (_e) { return ''; } }
const taslakAyar = () => ayar();
function urunSecAc(idx) {
  const eski = document.getElementById('pa-urunsec-sheet'); if (eski) eski.remove();
  const liste = urunListesi(), kok = document.createElement('div'); kok.id = 'pa-urunsec-sheet'; kok.className = 'pa2-sheet';
  kok.innerHTML = '<div class="pa2-sheet-ic"><div class="pa2-sheet-tut"></div><div class="pa2-sheet-bas"><b>Ürün seç</b><button type="button" class="pa2-sheet-kapat" aria-label="Kapat">✕</button></div><input type="search" class="pa-giris pa2-sheet-ara" placeholder="Kod, ürün adı veya gam yazın…" autocomplete="off"><div class="pa2-sheet-liste"></div></div>';
  document.body.appendChild(kok);
  const ara = kok.querySelector('.pa2-sheet-ara'), lst = kok.querySelector('.pa2-sheet-liste'), kapat = () => kok.remove();
  const ciz = () => {
    const q = P.norm(ara.value), pr = q.split(/\s+/).filter(Boolean);
    const sonuc = (pr.length ? liste.filter(u => { const m = P.norm(uKod(u) + ' ' + uAd(u) + ' ' + uGam(u)); return pr.every(x => m.includes(x)); }) : liste).slice(0, 60);
    lst.innerHTML = sonuc.length ? sonuc.map(u => '<button type="button" class="pa2-sheet-u" data-kod="' + esc(uKod(u)) + '"><span class="pa2-su-ad">' + esc(uAd(u)) + '</span><span class="pa2-su-alt">' + esc(uKod(u)) + ' · ' + esc(uGam(u)) + ' · ' + TL(Number(u.Nakit) || 0) + '</span></button>').join('') : '<div class="pa-not" style="padding:18px;text-align:center">Ürün bulunamadı</div>';
  };
  ara.addEventListener('input', ciz); ciz(); setTimeout(() => { try { ara.focus(); } catch (_e) { /* */ } }, 60);
  kok.addEventListener('click', ev => {
    if (ev.target === kok || ev.target.closest('.pa2-sheet-kapat')) return kapat();
    const b = ev.target.closest('.pa2-sheet-u'); if (!b) return;
    const e = taslak && taslak.ekstra[idx]; if (!e) return kapat();
    e.kod = b.dataset.kod; kapat(); yeniden();
  });
}

function ayarHtml() {
  const T = taslak, urunGamlari = (() => { try { const l = (W._primBridge && W._primBridge.urunler && W._primBridge.urunler()) || []; const s = new Set(); l.forEach(p => { const k = Object.keys(p).find(x => P.norm(x).includes('gam')); if (k && p[k]) s.add(String(p[k]).trim()); }); return [...s]; } catch (_e) { return []; } })();
  const tanimsiz = urunGamlari.filter(g => !Object.keys(T.gamlar).some(x => P.norm(x) === P.norm(g)) && !Object.keys(T.gamKategori).some(x => P.norm(x) === P.norm(g) && T.gamKategori[x]) && !Object.keys(T.kategoriler).some(x => P.norm(x) === P.norm(g)) && P.norm(g) !== 'sigorta');
  let h = '<div class="pa2-baslik"><h3>Ayarlar</h3><p>Oranlar, kurallar ve hedefler. Değişiklikler en altta <b>Ayarları kaydet</b> ile uygulanır.</p></div>'
    + '<div class="pa2-ilke"><b>💡 Hesap ilkeleri</b><ul><li><b>Prim bazı: nakit satış fiyatı</b> (vade farkı / komisyon prim bazına girmez).</li><li><b>Kampanya indirimleri</b> (⌗ ⎇ ❖ — marka karşılar) şirkete zarar sayılmaz; fazla-indirim kesintisine ve "sorunlu" işaretine <b>girmez</b>.</li><li><b>Şirkete zarar veren indirim</b> = satır indirimi + alt indirim + pazarlık + elle fiyat çekme (teklif taslağındaki düşüşler). Şelale yalnız bu tutarı en yüksek primli kalemden düşer.</li></ul></div>'
    + '<div class="pa-kart"><h4>Genel</h4>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>Varsayılan KDV (%)</span>' + gir(['kdv'], T.kdv) + '</div>'
    + onoff(['golge'], T.golge, '<b>Gölge mod</b> (indirim kesintisi personele uygulanmaz; ilk ay)') + onoff(['disSay'], T.disSay !== false, '<b>Dış ödeme (Samsung ❖ / 3P) sepet fiyatıyla sayılır</b> (müşteri firmaya ödese de prim ve hedef sepet tutarından)') + onoff(['selale'], T.selale !== false, '<b>Şelale dağıtımı</b> (indirim/eksik tutar <b>en yüksek primli kalemden</b> düşer, kalem en az 1 ₺; fazla tutar en yüksek primli kaleme eklenir). Kapalı: liste oranında paylaşım') + onoff(['sevkiyatsizSay'], T.sevkiyatsizSay === true, 'Sevkiyat kaydı <b>hiç açılmamış</b> satışları (elden/aksesuar) satış tarihiyle <b>say</b>') + onoff(['personelEkran'], T.personelEkran === true, 'Personelde <b>Skor Kartım</b> ve sepet koçluğu <b>açık</b> (kapalıyken personel hiçbir şey görmez)')
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>Personel ekranında puan katsayısı <small>(1 ₺ hak ediş = kaç puan; örn. 0,1)</small></span>' + gir(['puanKatsayisi'], T.puanKatsayisi) + '</div>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>İndirim: ekip ortalamasının her 1 puan üstü, prim kesintisi (%)</span>' + gir(['indirim', 'k'], T.indirim.k) + '</div>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>İndirim katsayısı en az (0–1)</span>' + gir(['indirim', 'alt'], T.indirim.alt) + '</div>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>Verimlilikte hedef payı</span>' + gir(['verimlilik', 'hedef'], T.verimlilik.hedef) + '</div>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>Verimlilikte nitelikli payı</span>' + gir(['verimlilik', 'nitelikli'], T.verimlilik.nitelikli) + '</div>'
    + '<p class="pa-not">Ay içi hedef dağılımı (%): 1–10. gün · 11–20. gün · 21–son gün</p><div class="pa-sat" style="grid-template-columns:1fr 1fr 1fr">' + [0, 1, 2].map(i => gir(['donem', i, 'pay'], T.donem[i] ? T.donem[i].pay : '')).join('') + '</div></div>';
  h += baremHtml(T) + gorunumAyarHtml(T) + destekAyarHtml(T) + simulasyonHtml();
  const katAdlari = Object.keys(T.kategoriler), secKat = (yol, v) => '<select class="pa-giris" style="width:auto" data-pa-yol="' + esc(JSON.stringify(yol)) + '" data-pa-metin="1"><option value="">— kategori seçin —</option>' + katAdlari.map(c => '<option value="' + esc(c) + '"' + (c === v ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>';
  h += '<div class="pa-kart pa-kaydir"><h4>Kategori oranları</h4><p class="pa-not">Prim = KDV\'siz satış × oran. Oran <b>kategoriye</b> göre uygulanır (eski Excel ile aynı). <b>Nitelikli</b> kategoriler verimlilikte sayılır; <b>verimsiz</b> (IT/Elektronik) sayılmaz. KDV boşsa varsayılan kullanılır.</p>'
    + '<table class="pa-tab"><thead><tr><th>Kategori</th><th>Grup</th><th>Oran %</th><th>KDV %</th></tr></thead><tbody>'
    + katAdlari.map(c => { const x = T.kategoriler[c]; return '<tr><td>' + esc(c) + '</td><td><select class="pa-giris" style="width:auto" data-pa-yol="' + esc(JSON.stringify(['kategoriler', c, 'grup'])) + '" data-pa-metin="1"><option value="nitelikli"' + (x.grup !== 'verimsiz' ? ' selected' : '') + '>Nitelikli</option><option value="verimsiz"' + (x.grup === 'verimsiz' ? ' selected' : '') + '>Verimsiz</option></select></td><td style="width:70px">' + gir(['kategoriler', c, 'oran'], x.oran) + '</td><td style="width:60px">' + gir(['kategoriler', c, 'kdv'], x.kdv ?? '') + '</td></tr>'; }).join('')
    + '</tbody></table></div>';
  h += '<div class="pa-kart pa-kaydir"><h4>Ürün gamı → kategori</h4><p class="pa-not">Üründe yazan <b>Ürün Gamı</b> (Blender, Ütü, Tv…) hangi kategoriye giriyor. Yeni bir gam gelirse aşağıdaki düğmeyle ekleyip kategorisini seçin; seçilmezse "tanımsız" uyarısı çıkar.</p>'
    + (tanimsiz.length ? '<div class="pa-uyari">Ürün listesinde olup kategorisi olmayan gamlar: ' + tanimsiz.map(g => '<button type="button" class="pa-btn gri" style="padding:4px 10px;margin:2px" data-pa-gam-ekle="' + esc(g) + '">＋ ' + esc(g) + '</button>').join('') + '</div>' : '')
    + '<table class="pa-tab"><thead><tr><th>Gam</th><th>Kategori</th><th></th></tr></thead><tbody>'
    + Object.keys(T.gamKategori).sort((a, b) => a.localeCompare(b, 'tr')).map(g => '<tr><td>' + esc(g) + '</td><td>' + secKat(['gamKategori', g], T.gamKategori[g]) + '</td><td><button type="button" class="pa-btn gri" style="padding:4px 9px" data-pa-gam-sil="' + esc(g) + '">✕</button></td></tr>').join('')
    + '</tbody></table><div class="pa-sat" style="grid-template-columns:1fr auto;margin-top:8px"><input class="pa-giris" id="pa-gam-yeni" placeholder="Yeni gam adı"><button type="button" class="pa-btn" id="pa-gam-yeni-ekle">＋ Gam ekle</button></div>'
    + (Object.keys(T.gamlar).length ? '<p class="pa-not">Gama özel istisnalar (kategori oranını ezer):</p><table class="pa-tab"><tbody>' + Object.keys(T.gamlar).map(g => '<tr><td>' + esc(g) + '</td><td style="width:70px">' + gir(['gamlar', g, 'oran'], T.gamlar[g].oran) + '</td><td><button type="button" class="pa-btn gri" style="padding:4px 9px" data-pa-gamozel-sil="' + esc(g) + '">✕</button></td></tr>').join('') + '</tbody></table>' : '')
    + '<p class="pa-not">Hiç tanımı bulunamayan ürünler için varsayılan oran:</p><div class="pa-sat" style="grid-template-columns:1fr 70px 1fr 70px"><span>Nitelikli %</span>' + gir(['grupOran', 'nitelikli'], T.grupOran.nitelikli) + '<span>Verimsiz %</span>' + gir(['grupOran', 'verimsiz'], T.grupOran.verimsiz) + '</div></div>';
  h += '<div class="pa-kart"><h4>Sigorta / kasko / hizmet</h4><p class="pa-not">SC+ sigorta gibi hizmetler <b>nitelikli</b> sayılır. Prim: oran (%) <b>veya</b> sabit tutar (₺ / adet; sabit doluysa o kullanılır). Girilmezse sigorta primi 0 olur.</p>'
    + '<div class="pa-sat" style="grid-template-columns:1fr 90px"><span>Oran (%)</span>' + gir(['sigorta', 'oran'], T.sigorta.oran) + '</div><div class="pa-sat" style="grid-template-columns:1fr 90px"><span>Sabit tutar (₺ / adet)</span>' + gir(['sigorta', 'sabit'], T.sigorta.sabit) + '</div><div class="pa-sat" style="grid-template-columns:1fr 90px"><span>KDV (%)</span>' + gir(['sigorta', 'kdv'], T.sigorta.kdv) + '</div></div>';
  h += '<div class="pa-kart pa-kaydir"><h4>Ürüne özel oran / KDV</h4><p class="pa-not">Gam kuralını ezer. Boş bırakılan alan gam değerini kullanır.</p><table class="pa-tab"><thead><tr><th>Ürün kodu</th><th>Oran %</th><th>KDV %</th><th></th></tr></thead><tbody>'
    + Object.keys(T.urunler).map(k => '<tr><td>' + esc(k) + '</td><td style="width:70px">' + gir(['urunler', k, 'oran'], T.urunler[k].oran ?? '') + '</td><td style="width:60px">' + gir(['urunler', k, 'kdv'], T.urunler[k].kdv ?? '') + '</td><td><button type="button" class="pa-btn gri" style="padding:4px 9px" data-pa-urun-sil="' + esc(k) + '">✕</button></td></tr>').join('')
    + '</tbody></table><div class="pa-sat" style="grid-template-columns:1fr auto;margin-top:8px"><input class="pa-giris" id="pa-urun-yeni" placeholder="Ürün kodu"><button type="button" class="pa-btn" id="pa-urun-ekle">＋ Ekle</button></div></div>';
  const ozelH = '<div class="pa-kart pa-kaydir pa2-ozel"><h4>Özel ürün primi (tarihli, vitrinde ⭐ rozet)</h4><p class="pa-not">Seçilen tarih aralığında <b>teslim edilen</b> satışlara uygulanır; vitrinde ⭐ rozetiyle görünür. Tutar <b>adet başına</b>dır. Satış indirimli yapılmışsa özel prim de aynı oranda düşer.</p>'
    + T.ekstra.map((e, i) => '<div class="pa2-oz-k"><div class="pa2-oz-ust"><span class="pa2-oz-yildiz">⭐</span>' + onoff(['ekstra', i, 'aktif'], e.aktif !== false, 'Aktif') + '<button type="button" class="pa-btn gri pa2-oz-sil" data-pa-ekstra-sil="' + i + '" title="Sil">✕</button></div>'
      + '<button type="button" class="pa2-urunsec" data-pa-urunsec="' + i + '">' + (e.kod ? '<span class="pa2-us-kod">' + esc(e.kod) + '</span><span class="pa2-us-ad">' + esc(urunAdi(e.kod) || 'Ürün listede yok') + '</span><span class="pa2-us-prim">' + (normalPrimYazi(e.kod)) + '</span>' : '<span class="pa2-us-bos">🔎 Ürün seç (kod, ad veya gam ile ara)</span>') + '<span class="pa2-us-ok">›</span></button>'
      + '<div class="pa2-oz-g" style="grid-template-columns:1fr"><label><small>Açıklama (opsiyonel)</small>' + metin(['ekstra', i, 'ad'], e.ad, 'Kampanya adı') + '</label></div>'
      + '<div class="pa2-oz-g"><label><small>Başlangıç</small>' + metin(['ekstra', i, 'bas'], e.bas, '', 'date') + '</label><label><small>Bitiş</small>' + metin(['ekstra', i, 'bit'], e.bit, '', 'date') + '</label></div>'
      + '<div class="pa2-oz-g pa2-oz-2"><label><small>Tutar (₺ / adet)</small>' + gir(['ekstra', i, 'tutar'], e.tutar, ' placeholder="250"') + '</label><label><small>Uygulama şekli</small><select class="pa-giris" data-pa-yol="' + esc(JSON.stringify(['ekstra', i, 'mod'])) + '"><option value="ek"' + (e.mod !== 'tekil' ? ' selected' : '') + '>➕ Normal primin ÜSTÜNE ekle</option><option value="tekil"' + (e.mod === 'tekil' ? ' selected' : '') + '>🎯 Normal prim YERİNE (tekil)</option></select></label></div>'
      + '<div class="pa2-oz-ip">' + (e.mod === 'tekil' ? '<b>Tekil:</b> ürünün normal primi yok sayılır; satış yalnız <b>' + esc(e.tutar || 0) + ' ₺ / adet</b> prim getirir.' : '<b>Ek:</b> ürünün normal primi + <b>' + esc(e.tutar || 0) + ' ₺ / adet</b> verilir.') + '</div></div>').join('')
    + '<button type="button" class="pa-btn" id="pa-ekstra-ekle">＋ Özel prim ekle</button></div>';
  const kisiler = (kisiListesi || []).slice();   // V12.3: yalnız rolü 'satis' olanlar (destek/admin ve eski hedefli kişiler listelenmez; kayıtlı hedefleri silinmez)
  const hedefH = '<div class="pa-kart"><h4>Aylık hedefler (KDV hariç ₺)</h4><p class="pa-not">"Her ay" varsayılan hedeftir; "' + esc(P.ayAdi(ay)) + '" doldurulursa yalnız o ay için geçerli olur (örn. yeni başlayan, yer değiştiren).</p><table class="pa-tab"><thead><tr><th>Kişi</th><th>Her ay</th><th>' + esc(P.ayAdi(ay)) + '</th></tr></thead><tbody>'
    + kisiler.map(k => { const x = hedefTaslak[k.email] || {}; return '<tr><td>' + esc(k.ad) + '</td><td style="width:110px"><input class="pa-giris" inputmode="decimal" data-pa-hedef="' + esc(k.email) + '" data-pa-ad="' + esc(k.ad) + '" value="' + esc(x.tutar ?? '') + '"></td><td style="width:110px"><input class="pa-giris" inputmode="decimal" data-pa-hedef-ay="' + esc(k.email) + '" data-pa-ad="' + esc(k.ad) + '" value="' + esc(x.aylik && x.aylik[ay] != null ? x.aylik[ay] : '') + '"></td></tr>'; }).join('') + '</tbody></table></div>';
  h += '<div class="pa2-kaydet"><button type="button" class="pa2-btn kirmizi" id="pa-ayar-kaydet" style="width:100%;min-height:48px">💾 Ayarları kaydet</button></div>';
  const IK = { 'Genel': '⚙️', 'Kategori oranları': '📊', 'Ürün gamı → kategori': '🧩', 'Sigorta / kasko / hizmet': '🛡️', 'Ürüne özel oran / KDV': '🎯', 'Özel ürün primi (tarihli, vitrinde ⭐ rozet)': '⭐', 'Aylık hedefler (KDV hariç ₺)': '🏁', 'Verimlilik ödemesi (barem)': '⚡', 'Hizmet kalitesi': '👁', 'Simülasyon: ödeme etkisi': '🧮' };
  h = h.replace('<div class="pa-kart"><h4>Genel</h4>', hedefH + ozelH + '<div class="pa-kart"><h4>Genel</h4>');   // V12.10: hedefler + özel ürün primi en üstte   // V12.8: özel ürün primi en üstte
  return h.replace(/<h4>([^<]+)<\/h4>/g, (m, a) => IK[a] ? '<h4><span class="pa2-ik">' + IK[a] + '</span>' + a + '</h4>' : m);
}
function ayarTemizle(T) {
  const o = {};
  o.kdv = sayi(T.kdv) || 20; o.golge = !!T.golge; o.personelEkran = T.personelEkran === true; o.sevkiyatsizSay = T.sevkiyatsizSay === true; o.selale = T.selale !== false; o.disSay = T.disSay !== false;
  o.indirim = { k: sayi(T.indirim.k), alt: Math.min(1, Math.max(0, sayi(T.indirim.alt))) };
  const V = T.verimlilik || {}, kisit = (x, a, b) => Math.min(b, Math.max(a, sayi(x)));
  o.verimlilik = { hedef: sayi(V.hedef), nitelikli: sayi(V.nitelikli), mod: ['barem', 'surekli', 'v85'].includes(V.mod) ? V.mod : 'barem', hedefTaban: kisit(V.hedefTaban, 0, 100),
    baremler: (V.baremler || []).map(b => ({ esik: kisit(b.esik, 0, 100), oran: kisit(b.oran, 0, 100) })).filter(b => b.esik > 0).sort((a, b) => b.esik - a.esik) };
  if (!o.verimlilik.baremler.length) o.verimlilik.baremler = P.varsayilanAyar().verimlilik.baremler;
  o.puanKatsayisi = sayi(T.puanKatsayisi) > 0 ? sayi(T.puanKatsayisi) : 0.1;
  const G = T.gorunum || {}; o.gorunum = { acik: G.acik !== false, tavan: kisit(G.tavan, 0, 100), olumlu: G.olumlu === true, bonusTavan: kisit(G.bonusTavan, 0, 100) };
  const bit = [10, 20, 31]; o.donem = [0, 1, 2].map(i => ({ bitis: bit[i], pay: sayi(T.donem[i] && T.donem[i].pay) }));
  o.gamlar = {}; Object.keys(T.gamlar).forEach(g => { const n = String(g).trim(); if (!n) return; const x = T.gamlar[g]; o.gamlar[n] = { grup: x.grup === 'verimsiz' ? 'verimsiz' : 'nitelikli', oran: sayi(x.oran), ...(String(x.kdv ?? '').trim() !== '' ? { kdv: sayi(x.kdv) } : {}), ...(x.kume ? { kume: x.kume } : {}) }; });
  const DE = T.destek || {}; o.destek = { aktif: DE.aktif === true, min: kisit(DE.min, 0, 300), max: kisit(DE.max, 0, 300), anketAgirlik: kisit(DE.anketAgirlik, 0, 100), liste: (destekListesi && destekListesi.length ? destekListesi : (DE.liste || [])).map(x => ({ email: x.email, ad: x.ad })) };   // personel anketi için destek kişi listesi (personel kullanıcı listesini okuyamaz)
  o.surum = 2;
  o.kategoriler = {}; Object.keys(T.kategoriler).forEach(c => { const x = T.kategoriler[c]; o.kategoriler[c] = { grup: x.grup === 'verimsiz' ? 'verimsiz' : 'nitelikli', oran: sayi(x.oran), ...(String(x.kdv ?? '').trim() !== '' ? { kdv: sayi(x.kdv) } : {}), ...(x.kume ? { kume: x.kume } : {}) }; });
  o.gamKategori = {}; Object.keys(T.gamKategori).forEach(g => { const n = String(g).trim(); if (n) o.gamKategori[n] = String(T.gamKategori[g] || ''); });
  o.grupOran = { nitelikli: sayi(T.grupOran.nitelikli), verimsiz: sayi(T.grupOran.verimsiz) };
  o.sigorta = { oran: sayi(T.sigorta.oran), sabit: sayi(T.sigorta.sabit), kdv: sayi(T.sigorta.kdv) || o.kdv };
  o.urunler = {}; Object.keys(T.urunler).forEach(k => { const x = T.urunler[k], t = {}; if (String(x.oran ?? '').trim() !== '') t.oran = sayi(x.oran); if (String(x.kdv ?? '').trim() !== '') t.kdv = sayi(x.kdv); if (k.trim()) o.urunler[k.trim()] = t; });
  o.ekstra = T.ekstra.filter(e => String(e.kod || '').trim()).map((e, i) => ({ id: e.id || ('e' + Date.now().toString(36) + i), kod: String(e.kod).trim(), ad: String(e.ad || '').trim(), tutar: sayi(e.tutar), bas: e.bas || '', bit: e.bit || '', aktif: e.aktif !== false, mod: e.mod === 'tekil' ? 'tekil' : 'ek' }));
  return o;
}
// Kayıttan sonra sayfayı en üste al (mesaj/uyarı orada görünür): kaydırılabilen tüm üst kapları sıfırla
function enUste() {
  const git = () => { try { let e = kok(); while (e && e !== document.body) { if (e.scrollTop) e.scrollTop = 0; e = e.parentElement; } window.scrollTo({ top: 0, behavior: 'smooth' }); const m = document.getElementById('admin-modal'); if (m) { m.scrollTop = 0; m.querySelectorAll('.admin-body,.admin-content,[class*=scroll]').forEach(x => { x.scrollTop = 0; }); } const k = kok(); if (k && k.scrollIntoView) k.scrollIntoView({ block: 'start' }); } catch (_e) { /* */ } };
  git(); setTimeout(git, 60); setTimeout(git, 250);
}
async function ayarKaydet() {
  try { await kisileriYukle(); } catch (_e) { /* destek listesi okunamazsa mevcut liste korunur */ }
  const hz = [];
  if (!(sayi(taslak.verimlilik.hedef) + sayi(taslak.verimlilik.nitelikli) > 0)) hz.push('Verimlilik payları toplamı 0 olamaz.');
  const dp = [0, 1, 2].reduce((a, i) => a + sayi(taslak.donem[i] && taslak.donem[i].pay), 0); if (Math.abs(dp - 100) > 0.01) hz.push('Ay içi dağılım toplamı %100 olmalı (şu an %' + dp + ').');
  const bm = (taslak.verimlilik.baremler || []).filter(b => String(b.esik ?? '').trim() !== ''); if (bm.length && new Set(bm.map(b => sayi(b.esik))).size !== bm.length) hz.push('Barem tablosunda aynı eşik iki kez yazılmış.');
  if (hz.length) { hata = hz.join(' '); return (yeniden(), enUste()); }
  try {
    const t = ayarTemizle(taslak), eskiA = ayar(), yeniA = P.ayarBirlestir({ ...eskiA, ...t }), kon = P.ayarKontrol(yeniA, urunListesi(), P.gunStr(Date.now()));
    let etki = null; try { if (!sonKayitlar.length) sonKayitlar = await ayKayitlari(ay, null); if (sonKayitlar.length) etki = P.ayarEtkisi(eskiA, yeniA, { kayitlar: sonKayitlar, hedefler: hedefTaslak, ay, bugun: Date.now(), urunBul, duzeltmeler, donem: hesapDonem, gorunum: gorunumler[ay] || {} }); } catch (_e) { etki = null; }
    const kirm = kon.filter(x => x.s === 'k' && !susturulmus('ayar:' + x.m.slice(0, 60), x.m)), buyuk = etki && ((Math.abs(etki.yuzde) >= 15 && Math.abs(etki.fark) >= 500) || etki.kisiler.some(x => Math.abs(x.yuzde) >= 30 && Math.abs(x.yeni - x.eski) >= 500));
    if (kirm.length || buyuk || (etki && Math.abs(etki.fark) >= 5000)) {
      const satirlar = []; if (kirm.length) satirlar.push('🔴 ' + kirm.map(x => x.m).slice(0, 4).join('\n🔴 '));
      if (etki) satirlar.push('📊 ' + P.ayAdi(ay) + ' satışları (' + etki.satisSayisi + ') bu ayarla hesaplansaydı toplam hak ediş ' + TL(etki.eski) + ' → ' + TL(etki.yeni) + ' (' + (etki.yuzde > 0 ? '+' : '') + PY(etki.yuzde) + ').' + (etki.kisiler.length ? '\nEn çok etkilenen: ' + etki.kisiler.slice(0, 3).map(x => x.ad + ' ' + TL(x.eski) + ' → ' + TL(x.yeni)).join(' · ') : ''));
      if (!(await onay('🛡 Prim Sigortası: kaydetmeden önce kontrol edin\n\n' + satirlar.join('\n\n') + '\n\nYine de kaydedilsin mi?'))) { mesaj = 'Kaydedilmedi; ayarları gözden geçirebilirsiniz.'; return (yeniden(), enUste()); }
    }
    await ayarKaydetBelge(t);
    const hd = {}; const emails = new Set([...Object.keys(hedefTaslak)]);
    emails.forEach(em => { const x = hedefTaslak[em] || {}, tut = sayi(x.tutar), ak = {}; Object.keys(x.aylik || {}).forEach(a => { const v = sayi(x.aylik[a]); if (v > 0) ak[a] = v; }); if (tut > 0 || Object.keys(ak).length) hd[em.toLowerCase()] = { ad: x.ad || em, tutar: tut, ...(Object.keys(ak).length ? { aylik: ak } : {}) }; });
    await hedefDocYaz(hd); hedefTaslak = hd;
    taslak = kopya(ayar()); mesaj = '✓ Ayarlar ve hedefler kaydedildi. Personel ekranlarına en geç 30 dk içinde yansır.';
  } catch (e) { hata = 'Kaydedilemedi: ' + (e && e.message) + (/permission/i.test(String(e && e.message)) ? ' — Firestore kuralları (Aşama H) yayınlanmamış olabilir.' : ''); }
  yeniden(); enUste();
}

// ── Olaylar (tek dinleyici, kök üzerinde) ──
let baglandi = false;
function olayBagla() {
  if (baglandi) return; const el = kok(); if (!el) return; baglandi = true;
  el.addEventListener('click', async ev => {
    const t = ev.target.closest('button,tr[data-pa-kisi],tr[data-pa-den],div[data-pa-kisi]'); if (!t) return;
    const d = t.dataset;
    if (d.paAlt) { alt = d.paAlt; return yeniden(); }
    if (d.paFiltre) { sorunFiltre = d.paFiltre; dzAcik = ''; return yeniden(); }
    if (d.paFiltretemizle) { sorunKisi = ''; sorunAra = ''; dzAcik = ''; return yeniden(); }
    if (d.paDzac !== undefined) { dzAcik = d.paDzac; dzHata = ''; dzTaslak = null; return yeniden(); }
    if (d.paDzkapat) { dzAcik = ''; dzHata = ''; dzTaslak = null; return yeniden(); }
    if (d.paDzgit !== undefined) { alt = 'sorun'; sorunFiltre = 'tumu'; sorunKisi = ''; sorunAra = d.paDzgit; dzAcik = d.paDzgit; return yeniden(); }
    if (d.paDzsistem !== undefined) { const i = $('pa-dz-tutar'); if (i) i.value = String(d.paDzsistem).replace('.', ','); return; }
    if (d.paDzsc !== undefined) { const b = P.sayiya(($('pa-dz-sc') || {}).value), sp = P.scPrimi(ayar(), b); if (!(b > 0)) { hata = 'SC+ bedelini yazın (örn. 4999).'; return yeniden(); } if (!(sp > 0)) { hata = 'Ayarlar → Sigorta bölümünde SC+ prim oranı/sabiti tanımlı değil; önce onu girin.'; return yeniden(); } const i = $('pa-dz-tutar'), n = $('pa-dz-neden'); if (i) i.value = String(P.r2(P.sayiya(d.paDzsc) + sp)).replace('.', ','); if (n) n.value = 'SC+ sonradan eklendi (' + b + ' ₺) +' + sp + ' ₺'; return; }
    if (d.paDzsifir) { const i = $('pa-dz-tutar'); if (i) i.value = '0'; return; }
    if (d.paDznedenyaz !== undefined) { const i = $('pa-dz-neden'); if (i) { i.value = d.paDznedenyaz; i.focus(); } return; }
    if (d.paDzkaydet !== undefined) return duzeltmeKaydet(d.paDzkaydet);
    if (d.paDzsil !== undefined) return duzeltmeSil(d.paDzsil);
    if (t.id === 'pa-ozel-ac') { ozelAcik = !ozelAcik; if (ozelAcik) { const D0 = P.donemBilgi(ay); ozelBas = D0.bas; ozelBit = D0.bit; } else { ozelBas = ''; ozelBit = ''; } return yeniden(); }
    if (d.paGorKaydet !== undefined) return gorunumKaydet(d.paGorKaydet);
    if (d.paGorSil !== undefined) return gorunumSil(d.paGorSil);
    if (t.id === 'pa-hesapla') { const v = $('pa-ay'); if (v && v.value) ay = v.value; if (ozelAcik) { const b1 = $('pa-ozel-bas'), b2 = $('pa-ozel-bit'); ozelBas = b1 ? b1.value : ozelBas; ozelBit = b2 ? b2.value : ozelBit; if (!ozelBas || !ozelBit || ozelBas > ozelBit) { hata = 'Özel aralık: başlangıç ve bitiş tarihini doğru girin (başlangıç ≤ bitiş).'; return yeniden(); } } return hesapla(); }
    if (t.id === 'pa-yayinla') return yayinla();
    if (t.id === 'pa-denetle') { const v = $('pa-ay'); if (v && v.value) ay = v.value; t.disabled = true; t.textContent = 'Denetleniyor…'; try { denetim = await ayDenetim(ay); denetimAcik = ''; } catch (e) { hata = 'Denetim yapılamadı: ' + (e && e.message); } return yeniden(); }
    if (t.id === 'pa-sil-supheli') { (denetim || []).filter(x => x.durum === 'sevkiyatsiz' && supheliMi(x.sale)).forEach(x => silSecim.add(x.sale.id)); return yeniden(); }
    if (t.id === 'pa-sil-temizle') { silSecim.clear(); return yeniden(); }
    if (t.id === 'pa-sil-yap') return denemeSil();
    if (t.id === 'pa-mhs-git') return mhsKarsilastir();
    if (t.id === 'pa-excel') return excelAktar();
    if (t.id === 'pa-mhs-excel') return mhsExcel();
    if (d.paDen !== undefined) { denetimAcik = denetimAcik === d.paDen ? '' : d.paDen; return yeniden(); }
    if (d.paKisi !== undefined) { acikKisi = acikKisi === d.paKisi ? '' : d.paKisi; return yeniden(); }
    if (t.id === 'pa-kap-goster') { const v = $('pa-kap-gun'); if (v && v.value) kapGun = v.value; return kapGetir(); }
    if (t.id === 'pa-nokta-ekle') { const v = $('pa-nokta-yeni'), ad = v ? v.value.trim() : ''; if (!ad) return; noktaTaslak = noktaTaslak || noktaListesi(); noktaDomOku(noktaTaslak); if (noktaTaslak.some(n => P.norm(n.ad) === P.norm(ad))) { hata = 'Bu nokta zaten var.'; return yeniden(); } noktaTaslak.push({ ad }); await noktaKaydet(true); return; }
    if (d.paNoktaSil !== undefined) { const i = Number(d.paNoktaSil), l = noktaTaslak || noktaListesi(); noktaDomOku(l); if (!l[i]) return; if (!(await onay('"' + l[i].ad + '" noktası çıkarılsın mı? (Eski satışlar bozulmaz; yeni raporda "Diğer" altında görünür.)'))) return; noktaTaslak = l; noktaTaslak.splice(i, 1); await noktaKaydet(false); return; }
    if (t.id === 'pa-nokta-kaydet') return noktaKaydet(true);
    if (d.paGamEkle) { taslak.gamKategori[d.paGamEkle] = taslak.gamKategori[d.paGamEkle] || ''; return yeniden(); }
    if (d.paGamSil) { delete taslak.gamKategori[d.paGamSil]; return yeniden(); }
    if (d.paGamozelSil) { delete taslak.gamlar[d.paGamozelSil]; return yeniden(); }
    if (t.id === 'pa-gam-yeni-ekle') { const v = $('pa-gam-yeni'), ad = v ? v.value.trim() : ''; if (ad && !(ad in taslak.gamKategori)) taslak.gamKategori[ad] = ''; return yeniden(); }
    if (t.id === 'pa-urun-ekle') { const v = $('pa-urun-yeni'), k = v ? v.value.trim() : ''; if (k && !taslak.urunler[k]) taslak.urunler[k] = {}; return yeniden(); }
    if (d.paUrunSil) { delete taslak.urunler[d.paUrunSil]; return yeniden(); }
    if (d.paHaftaOk) { lsSet('prim-hafta-kapat', haftaAnahtar()); haftaOz = null; return yeniden(); }
    if (d.paGor) { const it = sonSorunListe.find(z => z.x.saleNo === d.paGor); return it ? gorulenYaz([it]) : undefined; }
    if (d.paGorgeri) return gorulenYaz([], [d.paGorgeri]);
    if (d.paGortum) { if (!(await onay(sonSorunListe.length + ' satır "görüldü" olarak işaretlensin mi?\n\nListeden kalkarlar; durumları (prim/işaret) değişirse yeniden çıkarlar. "👁 Görülen" filtresinden geri alabilirsiniz.'))) return; return gorulenYaz(sonSorunListe.slice()); }
    if (d.paDgor) return destekGorunum(d.paDgor);
    if (d.paSigSifirla) return sigSifirla();
    if (d.paSigOk) return sigSustur(d.paSigOk);
    if (d.paSigDaha) { sigAcik = !sigAcik; return yeniden(); }
    if (d.paSigGit) { acikKisi = d.paSigGit; alt = 'hesap'; yeniden(); const e2 = document.querySelector('.pa2-kisi.acik'); if (e2 && e2.scrollIntoView) e2.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (d.paUrunsec !== undefined) return urunSecAc(Number(d.paUrunsec));
    if (t.id === 'pa-ekstra-ekle') { taslak.ekstra.push({ kod: '', ad: '', tutar: '', bas: P.gunStr(Date.now()), bit: '', aktif: true, mod: 'ek' }); return yeniden(); }
    if (d.paEkstraSil !== undefined) { taslak.ekstra.splice(Number(d.paEkstraSil), 1); return yeniden(); }
    if (t.id === 'pa-barem-ekle') { taslak.verimlilik.baremler = taslak.verimlilik.baremler || []; taslak.verimlilik.baremler.push({ esik: '', oran: '' }); return yeniden(); }
    if (d.paBaremSil !== undefined) { taslak.verimlilik.baremler.splice(Number(d.paBaremSil), 1); return yeniden(); }
    if (d.paSim) return yeniden();
    if (t.id === 'pa-ayar-kaydet') return ayarKaydet();
  });
  const degisti = ev => {
    const t = ev.target; if (!t || !t.dataset) return;
    if (t.dataset.paSilSec !== undefined) { if (t.checked) silSecim.add(t.dataset.paSilSec); else silSecim.delete(t.dataset.paSilSec); const by = $('pa-sil-yap'); if (by) by.textContent = '🗑 İşaretlileri sil (' + silSecim.size + ')'; return; }
    if (t.id === 'pa-ay' && ev.type === 'change' && t.value) { ay = t.value; ozelBas = ''; ozelBit = ''; if (ozelAcik) { const D0 = P.donemBilgi(ay); ozelBas = D0.bas; ozelBit = D0.bit; } sonuc = null; sonKayitlar = []; bekleyenKayitlar = []; return yeniden(); }
    if ((t.id === 'pa-sorun-kisi' || t.id === 'pa-sorun-sira') && ev.type === 'change') { if (t.id === 'pa-sorun-kisi') sorunKisi = t.value; else sorunSira = t.value; dzAcik = ''; return yeniden(); }
    if (t.id === 'pa-ozel-bas') { ozelBas = t.value; return; } if (t.id === 'pa-ozel-bit') { ozelBit = t.value; return; }
    if (t.dataset.paYol) { const y = JSON.parse(t.dataset.paYol), v = t.dataset.paKutu ? t.checked : t.value; if (t.dataset.paKutu && t.blur) { try { t.blur(); } catch (_e) { /* */ } } if (y[0] === 'donem' && !taslak.donem[y[1]]) taslak.donem[y[1]] = { bitis: [10, 20, 31][y[1]], pay: '' }; yolYaz(taslak, y, v); if (t.dataset.paYeniden) yeniden(); }
    else if (t.dataset.paHedef !== undefined) { const em = t.dataset.paHedef; hedefTaslak[em] = hedefTaslak[em] || { ad: t.dataset.paAd }; hedefTaslak[em].tutar = t.value; }
    else if (t.dataset.paHedefAy !== undefined) { const em = t.dataset.paHedefAy; hedefTaslak[em] = hedefTaslak[em] || { ad: t.dataset.paAd }; hedefTaslak[em].aylik = hedefTaslak[em].aylik || {}; hedefTaslak[em].aylik[ay] = t.value; }
  };
  el.addEventListener('toggle', ev => { const n = ev.target && ev.target.dataset && ev.target.dataset.paDet; if (n) { if (ev.target.open) detAcik.add(n); else detAcik.delete(n); } }, true);
  el.addEventListener('input', ev => { if (ev.target && ev.target.id === 'pa-sorun-ara') { sorunAra = ev.target.value; clearTimeout(olayBagla._z); olayBagla._z = setTimeout(() => { const pos = ev.target.selectionStart; yeniden(); const n = $('pa-sorun-ara'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_e) { /* yoksay */ } } }, 350); } });
  el.addEventListener('input', degisti); el.addEventListener('change', degisti);
}
async function ac() { await acIc(); olayBagla(); if (yonetici() && !sonuc && !otoHesap && alt === 'hesap') { otoHesap = true; hesapla(); } }
W.PrimAdmin = { arkaPlan, ac, yenile: () => { taslak = null; return ac(); }, versiyon: 'V12.11' };

// ── V12.7: Premium admin teması (tüm admin paneli) ───────────────────────────
(function premiumTema() {
  if (typeof document === 'undefined' || document.getElementById('admin-premium-css')) return;
  const s = document.createElement('style'); s.id = 'admin-premium-css';
  s.textContent = `
#admin-modal{--pr-ink:#14161C;--pr-ink2:#232733;--pr-gold:#C9A24B;--pr-gold2:#E6C77A;--pr-card:#fff;--pr-line:rgba(20,22,28,.08);--pr-bg:#F4F5F8;--pr-sh:0 1px 2px rgba(20,22,28,.04),0 6px 20px rgba(20,22,28,.06)}
#admin-modal.admin-modal-overlay{background:rgba(10,12,18,.62);backdrop-filter:blur(10px) saturate(1.2)}
#admin-modal .admin-modal-content{background:var(--pr-bg);border-radius:22px 22px 0 0;box-shadow:0 -12px 48px rgba(0,0,0,.35);max-width:640px}
#admin-modal .admin-header{background:linear-gradient(135deg,var(--pr-ink) 0%,var(--pr-ink2) 100%);padding:16px 18px 14px;position:relative;border-bottom:1px solid rgba(201,162,75,.35)}
#admin-modal .admin-header::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1px;background:linear-gradient(90deg,transparent,var(--pr-gold),transparent);opacity:.8}
#admin-modal .admin-header-icon{width:38px;height:38px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(145deg,var(--pr-gold2),var(--pr-gold));color:#241a05;box-shadow:0 4px 14px rgba(201,162,75,.4);font-size:1.05rem}
#admin-modal .admin-header-name{color:#fff;font-weight:800;font-size:1rem;letter-spacing:.01em}
#admin-modal .admin-header-sub{color:rgba(255,255,255,.55);font-size:.7rem;margin-top:2px}
#admin-modal .admin-refresh-btn,#admin-modal .admin-logout-btn,#admin-modal .close-modal-btn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:11px;transition:background .15s,transform .1s}
#admin-modal .admin-refresh-btn:hover,#admin-modal .admin-logout-btn:hover,#admin-modal .close-modal-btn:hover{background:rgba(255,255,255,.16)}
#admin-modal .admin-refresh-btn:active,#admin-modal .admin-logout-btn:active,#admin-modal .close-modal-btn:active{transform:scale(.96)}
#admin-modal .admin-tabs{gap:4px;padding:10px 12px;background:var(--pr-bg);border-bottom:none}
#admin-modal .admin-tab{flex:0 0 auto;min-width:0;padding:8px 14px;border:1px solid var(--pr-line);border-radius:999px;background:#fff;color:#5b6272;font-weight:700;font-size:.74rem;box-shadow:0 1px 2px rgba(20,22,28,.04)}
#admin-modal .admin-tab:hover{color:var(--pr-ink)}
#admin-modal .admin-tab.active{background:linear-gradient(135deg,var(--pr-ink),var(--pr-ink2));color:var(--pr-gold2);border-color:var(--pr-ink);box-shadow:0 4px 12px rgba(20,22,28,.25)}
#admin-modal .admin-body{background:var(--pr-bg);padding-bottom:24px}
#admin-modal .admin-stats-grid{gap:10px;padding:4px 12px 8px}
#admin-modal .stat-card{background:var(--pr-card);border:1px solid var(--pr-line);border-radius:16px;box-shadow:var(--pr-sh);padding:14px 10px;position:relative;overflow:hidden}
#admin-modal .stat-card::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--pr-gold),var(--pr-gold2));opacity:.85}
#admin-modal .stat-card-val{color:var(--pr-ink);font-weight:800;letter-spacing:-.02em}
#admin-modal .stat-card-lbl{color:#7a8190;letter-spacing:.06em}
#admin-modal .stat-card-clickable{transition:transform .15s,box-shadow .15s}
#admin-modal .stat-card-clickable:hover{transform:translateY(-2px);box-shadow:0 2px 4px rgba(20,22,28,.05),0 12px 28px rgba(20,22,28,.12)}
#admin-modal .pa2-fil-ara{display:flex;gap:8px;margin:8px 0}#admin-modal .pa2-fil-ara select{flex:1;min-width:0}
#admin-modal .pa2-oner{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}#admin-modal .pa2-oner button{font-size:.72rem}#admin-modal .pa2-dzhata{background:#fee2e2;color:#991b1b;border-radius:12px;padding:9px 12px;margin-top:10px;font-size:.78rem;font-weight:600}
#admin-modal .pa2-sat{position:relative;background:var(--pr-card);border:1px solid var(--pr-line);border-radius:18px;box-shadow:var(--pr-sh);padding:14px 14px 12px 18px;overflow:hidden;margin-bottom:10px}
#admin-modal .pa2-sat::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(var(--pr-gold2),var(--pr-gold))}
#admin-modal .pa2-sat.dz::before{background:linear-gradient(#a78bfa,#7c3aed)}
#admin-modal .pa2-bno{font-weight:800;letter-spacing:.02em;font-size:.95rem;color:var(--pr-ink)}
#admin-modal .pa2-sat .pa2-alt{color:#7a8190;font-size:.74rem}
#admin-modal .pa2-sat .pa2-para{font-size:1.25rem;font-weight:800;letter-spacing:-.02em;color:var(--pr-ink)}
#admin-modal .pa2-rozetler{gap:6px;margin-top:9px}
#admin-modal .pa2-roz{display:inline-flex;align-items:center;gap:6px;padding:4px 11px 4px 6px;border-radius:999px;font-size:.7rem;font-weight:700;border:1px solid transparent;box-shadow:0 1px 2px rgba(20,22,28,.05);background:#f1f5f9;color:#334155;border-color:#e2e8f0}
#admin-modal .pa2-roz i{font-style:normal;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(20,22,28,.08);font-size:.68rem;font-weight:800}
#admin-modal .pa2-roz.r2{background:linear-gradient(#fff5f5,#fee2e2);color:#991b1b;border-color:#fecaca}
#admin-modal .pa2-roz.r2 i{background:#fecaca}
#admin-modal .pa2-roz.ri{background:linear-gradient(#fff5f5,#fee2e2);color:#b91c1c;border-color:#fca5a5}
#admin-modal .pa2-roz.ri i{background:#ef4444;color:#fff}
#admin-modal .pa2-roz.rk{background:linear-gradient(#ecfdf5,#d1fae5);color:#065f46;border-color:#a7f3d0}
#admin-modal .pa2-roz.rk i{background:#10b981;color:#fff}
#admin-modal .pa2-roz.r0:not(.rk){background:linear-gradient(#f5f3ff,#ede9fe);color:#5b21b6;border-color:#ddd6fe}
#admin-modal .pa2-sat .pa2-btn.ikincil{border-radius:12px;background:#f4f5f8;border:1px solid var(--pr-line);font-weight:700}
#admin-modal .admin-section{padding:0 12px 14px}
#admin-modal .admin-section-header{display:flex;align-items:center;gap:8px;color:var(--pr-ink);font-size:.7rem;font-weight:800;letter-spacing:.09em;padding:14px 2px 8px}
#admin-modal .admin-section-header::before{content:"";width:3px;height:12px;border-radius:2px;background:linear-gradient(var(--pr-gold2),var(--pr-gold));flex:0 0 auto}
#admin-modal .daily-chart,#admin-modal .user-row{background:var(--pr-card);border:1px solid var(--pr-line);border-radius:16px;box-shadow:var(--pr-sh)}
#admin-modal .user-row{padding:11px 12px;margin-bottom:8px;border-bottom:1px solid var(--pr-line)}
#admin-modal .chart-bar{background:linear-gradient(#d8dbe3,#eceef3)}
#admin-modal .chart-bar.today{background:linear-gradient(var(--pr-gold2),var(--pr-gold))}
#admin-modal .admin-empty{color:#8a91a0}
#admin-modal .admin-quickmsg-box,#admin-modal .admin-msg-row{background:var(--pr-card);border:1px solid var(--pr-line);border-radius:14px}
#admin-modal .admin-body input[type=text],#admin-modal .admin-body input[type=number],#admin-modal .admin-body input[type=date],#admin-modal .admin-body input[type=search],#admin-modal .admin-body select,#admin-modal .admin-body textarea{border:1px solid var(--pr-line);border-radius:11px;background:#fff;transition:border-color .15s,box-shadow .15s}
#admin-modal .admin-body input:focus,#admin-modal .admin-body select:focus,#admin-modal .admin-body textarea:focus{outline:none;border-color:var(--pr-gold);box-shadow:0 0 0 3px rgba(201,162,75,.22)}
#admin-modal .admin-body table{border-collapse:separate;border-spacing:0;background:var(--pr-card);border-radius:14px;overflow:hidden;border:1px solid var(--pr-line)}
#admin-modal .admin-body th{background:#f0f1f5;color:#5b6272;font-size:.66rem;text-transform:uppercase;letter-spacing:.06em}
#admin-modal .admin-body td{border-top:1px solid var(--pr-line)}
@media(prefers-color-scheme:dark){
#admin-modal{--pr-card:#1B1E27;--pr-line:rgba(255,255,255,.08);--pr-bg:#0F1117;--pr-sh:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35)}
#admin-modal .admin-tab{background:#1B1E27;color:#9aa1b2}
#admin-modal .stat-card-val,#admin-modal .admin-section-header{color:#F2F3F7}
#admin-modal .stat-card-lbl,#admin-modal .admin-empty{color:#8e95a6}
#admin-modal .admin-body input,#admin-modal .admin-body select,#admin-modal .admin-body textarea{background:#14171F;color:#F2F3F7}
#admin-modal .admin-body th{background:#232733;color:#aab0bf}
#admin-modal .chart-bar{background:linear-gradient(#3a3f4d,#2a2e3a)}
#admin-modal .pa2-bno,#admin-modal .pa2-sat .pa2-para{color:#F2F3F7}
#admin-modal .pa2-roz,#admin-modal .pa2-roz.r2,#admin-modal .pa2-roz.ri,#admin-modal .pa2-roz.rk,#admin-modal .pa2-roz.r0:not(.rk){background:#232733;color:#d7dbe6;border-color:rgba(255,255,255,.1)}
#admin-modal .pa2-roz.rk{color:#6ee7b7}#admin-modal .pa2-roz.r2{color:#fca5a5}#admin-modal .pa2-roz.ri{color:#fca5a5}
#admin-modal .pa2-sat .pa2-btn.ikincil{background:#232733;color:#e5e7ee}
}
@media(min-width:700px){#admin-modal.admin-modal-overlay{align-items:center}#admin-modal .admin-modal-content{border-radius:22px;height:88vh}}

.pa2-ak.arti b{color:#1b7f3b}
#admin-modal .pa2-ozel .pa2-oz-k{background:linear-gradient(180deg,#fff 0%,#FBF8EF 100%);border:1px solid rgba(201,162,75,.38);border-radius:18px;padding:14px;margin:12px 0;box-shadow:0 1px 2px rgba(20,22,28,.04),0 10px 26px rgba(201,162,75,.12)}
#admin-modal .pa2-ozel .pa2-oz-ust{display:flex;align-items:center;gap:10px;margin:0 0 12px}
#admin-modal .pa2-ozel .pa2-oz-yildiz{flex:none;width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:1.05rem;background:linear-gradient(145deg,#E6C77A,#C9A24B);box-shadow:0 3px 10px rgba(201,162,75,.45)}
#admin-modal .pa2-sw{position:relative}#admin-modal .pa2-sw input{left:0;top:0;width:1px;height:1px}
#admin-modal .pa2-ozel .pa2-oz-ust .pa2-sw{flex:1;min-width:0;margin:0;padding:8px 12px;background:rgba(20,22,28,.04);border-radius:12px}
#admin-modal .pa2-ozel .pa2-oz-sil{flex:none;width:34px;height:34px;padding:0;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:.9rem;line-height:1}
#admin-modal .pa2-ozel .pa2-urunsec{display:grid;grid-template-columns:1fr auto;gap:6px 10px;align-items:center;width:100%;box-sizing:border-box;text-align:left;border:1.5px solid rgba(201,162,75,.55);background:#fff;border-radius:14px;padding:11px 12px;margin:0 0 10px;cursor:pointer;font:inherit;color:inherit;-webkit-appearance:none;appearance:none;box-shadow:0 2px 8px rgba(201,162,75,.12)}
#admin-modal .pa2-ozel .pa2-urunsec:active{transform:scale(.99)}
#admin-modal .pa2-ozel .pa2-us-kod{grid-column:1;justify-self:start;font-weight:800;font-size:.72rem;letter-spacing:.04em;background:#14161C;color:#E6C77A;border-radius:8px;padding:3px 9px}
#admin-modal .pa2-ozel .pa2-us-prim{grid-column:2;grid-row:1;font-size:.68rem;font-weight:700;color:#6b5a1f;background:rgba(201,162,75,.18);border-radius:8px;padding:3px 8px;white-space:nowrap}
#admin-modal .pa2-ozel .pa2-us-ad{grid-column:1 / -1;font-size:.88rem;font-weight:700;line-height:1.25;color:#14161C}
#admin-modal .pa2-ozel .pa2-us-ok{display:none}
#admin-modal .pa2-ozel .pa2-us-bos{grid-column:1 / -1;font-size:.9rem;font-weight:700;color:#8a6d1f;text-align:center;padding:6px 0}
#admin-modal .pa2-ozel .pa2-oz-g{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 10px}
#admin-modal .pa2-ozel .pa2-oz-g label{display:block;min-width:0;margin:0}
#admin-modal .pa2-ozel .pa2-oz-g small{display:block;font-size:.64rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#8a8a90;margin:0 0 4px 2px}
#admin-modal .pa2-ozel .pa2-oz-g .pa-giris,#admin-modal .pa2-ozel .pa2-oz-g select{width:100%;box-sizing:border-box;min-width:0}
#admin-modal .pa2-ozel .pa2-oz-ip{font-size:.76rem;line-height:1.45;color:#6b5a1f;background:rgba(201,162,75,.13);border-radius:12px;padding:9px 12px}
#admin-modal .pa2-ozel #pa-ekstra-ekle{width:100%;margin-top:4px;padding:12px;border-radius:14px;font-weight:700}
@media (max-width:520px){#admin-modal .pa2-ozel .pa2-oz-g.pa2-oz-2{grid-template-columns:1fr}}
.pa2-sheet{position:fixed;left:0;right:0;top:0;bottom:0;z-index:2147483000;background:rgba(10,12,18,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center}
.pa2-sheet-ic{width:100%;max-width:560px;max-height:86vh;background:#fff;color:#14161C;border-radius:24px 24px 0 0;padding:8px 14px calc(14px + env(safe-area-inset-bottom));display:flex;flex-direction:column;box-shadow:0 -14px 48px rgba(0,0,0,.35);animation:pa2sh .22s ease-out}
@keyframes pa2sh{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}
.pa2-sheet-tut{width:42px;height:4px;border-radius:4px;background:#d4d4da;margin:2px auto 10px}
.pa2-sheet-bas{display:flex;justify-content:space-between;align-items:center;margin:0 0 10px;font-size:1.05rem}
.pa2-sheet-kapat{border:0;background:#f0f1f4;color:#14161C;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:.9rem}
.pa2-sheet-ara{width:100%;box-sizing:border-box;margin:0 0 8px;padding:12px 14px;border:1.5px solid rgba(201,162,75,.55);border-radius:14px;font:inherit;font-size:1rem;background:#fff;color:#14161C}
.pa2-sheet-liste{overflow:auto;-webkit-overflow-scrolling:touch;flex:1;min-height:120px}
.pa2-sheet-u{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid rgba(20,22,28,.07);background:none;padding:12px 6px;cursor:pointer;font:inherit;color:inherit}
.pa2-sheet-u:active{background:rgba(201,162,75,.16)}
.pa2-su-ad{display:block;font-weight:700;font-size:.9rem;line-height:1.25}.pa2-su-alt{display:block;font-size:.74rem;color:#8a8a90;margin-top:3px}
@media (prefers-color-scheme:dark){.pa2-sheet-ic{background:#1d2028;color:#eee}.pa2-sheet-ara{background:#14161C;color:#eee}.pa2-su-ad{color:#eee}.pa2-sheet-kapat{background:#2b2f3d;color:#eee}#admin-modal .pa2-ozel .pa2-oz-k{background:#1d2028}#admin-modal .pa2-ozel .pa2-urunsec{background:#14161C}#admin-modal .pa2-ozel .pa2-us-ad{color:#eee}}

.pa2-sig{border-radius:18px;padding:12px 14px;margin:12px 0;border:1px solid rgba(20,22,28,.08);background:#fff;box-shadow:0 1px 2px rgba(20,22,28,.04),0 6px 20px rgba(20,22,28,.05)}
.pa2-sig.ok{background:linear-gradient(180deg,#F3FBF5,#fff);border-color:rgba(27,127,59,.25)}.pa2-sig.s{background:linear-gradient(180deg,#FFF9E8,#fff);border-color:rgba(245,158,11,.4)}.pa2-sig.k{background:linear-gradient(180deg,#FFF1F1,#fff);border-color:rgba(220,38,38,.4)}
.pa2-sig-ust{display:flex;gap:10px;align-items:center;margin-bottom:6px}.pa2-sig-ik{font-size:1.4rem}.pa2-sig-ust b{display:block;font-size:.95rem}.pa2-sig-ust small{color:#6b6b72;font-size:.74rem}
.pa2-sig-s{display:flex;gap:8px;align-items:flex-start;padding:9px 0;border-top:1px dashed rgba(20,22,28,.1);font-size:.8rem;line-height:1.35}.pa2-sig-s>div{flex:1;min-width:0}.pa2-sig-d{flex:none}
.pa2-sig-b{flex:none;display:flex;gap:6px}.pa2-sig-git,.pa2-sig-ok{border:1px solid rgba(20,22,28,.15);background:#fff;border-radius:9px;padding:4px 9px;font:inherit;font-size:.72rem;font-weight:700;cursor:pointer}.pa2-sig-ok{color:#1b7f3b}
.pa2-sig-daha{width:100%;margin-top:6px;border:0;background:rgba(20,22,28,.05);border-radius:10px;padding:8px;font:inherit;font-size:.76rem;font-weight:700;cursor:pointer}
.pa2-sc{margin-top:12px;padding:10px 12px;border-radius:14px;background:linear-gradient(180deg,#FBF8EF,#fff);border:1px solid rgba(201,162,75,.4)}.pa2-sc-b{font-weight:800;font-size:.82rem;margin-bottom:6px}
.pa2-hafta{border-radius:18px;padding:12px 14px;margin:12px 0;background:linear-gradient(135deg,#14161C,#232733);color:#fff;border:1px solid rgba(201,162,75,.45)}.pa2-hafta-ust{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;color:#E6C77A}.pa2-hafta-s{font-size:.8rem;line-height:1.4;padding:5px 0;border-top:1px dashed rgba(255,255,255,.14)}.pa2-hafta-s b.iyi{color:#6ee7a0}.pa2-hafta-s b.kotu{color:#fca5a5}
.pa2-nabiz{border-radius:18px;padding:12px 14px;margin:12px 0;background:linear-gradient(180deg,#FBF8EF,#fff);border:1px solid rgba(201,162,75,.35)}.pa2-nabiz-b{font-weight:800;font-size:.9rem;margin-bottom:6px}
.pa2-nabiz-s{display:flex;gap:8px;align-items:flex-start;padding:7px 0;font-size:.8rem;line-height:1.35;border-top:1px dashed rgba(20,22,28,.08)}.pa2-nabiz-s:first-of-type{border-top:0}
.pa2-nabiz-s.kotu{color:#7a3b00}.pa2-nabiz-s.iyi{color:#14532d}
@media (prefers-color-scheme:dark){.pa2-sig,.pa2-nabiz{background:#1d2028;color:#eee}.pa2-sig-git,.pa2-sig-ok{background:#14161C;color:#eee}}
.pa3-sig{position:relative;border-radius:22px;padding:16px 16px 14px;margin:14px 0;color:#F4F1E8;background:radial-gradient(120% 140% at 0% 0%,#262B38 0%,#14161C 60%);border:1px solid rgba(201,162,75,.45);box-shadow:0 10px 30px rgba(20,22,28,.28),inset 0 1px 0 rgba(255,255,255,.06);overflow:hidden}
.pa3-sig:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#E6C77A,#C9A24B)}
.pa3-sig.k:before{background:linear-gradient(180deg,#ff8a8a,#dc2626)}.pa3-sig.s:before{background:linear-gradient(180deg,#fcd34d,#f59e0b)}.pa3-sig.ok:before{background:linear-gradient(180deg,#86efac,#16a34a)}
.pa3-ust{display:flex;gap:12px;align-items:center;margin-bottom:10px}
.pa3-kalkan{flex:none;width:42px;height:42px;border-radius:14px;display:grid;place-items:center;font-size:1.3rem;background:linear-gradient(135deg,#E6C77A,#C9A24B);box-shadow:0 4px 14px rgba(201,162,75,.4)}
.pa3-bas{flex:1;min-width:0}.pa3-bas b{display:block;font-size:1rem;letter-spacing:.2px;color:#fff}.pa3-bas small{display:block;font-size:.72rem;color:rgba(244,241,232,.62);margin-top:1px}
.pa3-pill{flex:none;font-size:.7rem;font-weight:800;padding:5px 10px;border-radius:99px;letter-spacing:.3px;background:rgba(22,163,74,.2);color:#86efac;border:1px solid rgba(134,239,172,.35)}
.pa3-pill.k{background:rgba(220,38,38,.22);color:#fecaca;border-color:rgba(252,165,165,.45)}.pa3-pill.s{background:rgba(245,158,11,.2);color:#fde68a;border-color:rgba(252,211,77,.4)}
.pa3-temiz{font-size:.8rem;color:rgba(244,241,232,.75);padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05)}
.pa3-s{position:relative;display:flex;gap:10px;align-items:center;margin-top:8px;padding:10px 10px 10px 16px;border-radius:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.07);flex-wrap:wrap}
.pa3-ray{position:absolute;left:6px;top:10px;bottom:10px;width:3px;border-radius:3px;background:#94a3b8}.pa3-s.k .pa3-ray{background:#f87171}.pa3-s.s .pa3-ray{background:#fbbf24}
.pa3-m{flex:1 1 200px;min-width:0;font-size:.8rem;line-height:1.4;color:#F4F1E8}.pa3-m em{display:block;font-style:normal;font-size:.62rem;font-weight:800;letter-spacing:.9px;color:rgba(244,241,232,.55);margin-bottom:2px}
.pa3-s.k .pa3-m em{color:#fca5a5}.pa3-s.s .pa3-m em{color:#fcd34d}
.pa3-btn{display:flex;gap:6px;flex:none;margin-left:auto}
.pa3-git,.pa3-onay{font:inherit;font-size:.72rem;font-weight:800;border-radius:99px;padding:7px 12px;cursor:pointer;white-space:nowrap}
.pa3-git{background:transparent;color:#F4F1E8;border:1px solid rgba(255,255,255,.28)}.pa3-onay{border:0;color:#14161C;background:linear-gradient(135deg,#E6C77A,#C9A24B);box-shadow:0 3px 10px rgba(201,162,75,.35)}
.pa3-daha,.pa3-sifirla{display:block;width:100%;margin-top:8px;border:0;border-radius:12px;padding:9px;font:inherit;font-size:.74rem;font-weight:700;cursor:pointer;background:rgba(255,255,255,.07);color:rgba(244,241,232,.8)}.pa3-sifirla{background:transparent;font-weight:600;color:rgba(244,241,232,.5)}
.pa4-destek{border-radius:22px;padding:14px 14px 12px;margin:14px 0;background:linear-gradient(180deg,#FFFDF7,#F7F2E4);border:1px solid rgba(201,162,75,.5);box-shadow:0 8px 24px rgba(20,22,28,.08)}
.pa4-ust{display:flex;gap:12px;align-items:center;margin-bottom:8px}.pa4-ik{width:40px;height:40px;border-radius:13px;display:grid;place-items:center;font-size:1.2rem;background:linear-gradient(135deg,#14161C,#2B3040)}
.pa4-ust b{display:block;font-size:1rem}.pa4-ust small{display:block;font-size:.7rem;color:#6b6350;margin-top:1px}
.pa4-kisi{margin-top:10px;padding:12px;border-radius:16px;background:#fff;border:1px solid rgba(20,22,28,.07)}
.pa4-s1{display:flex;justify-content:space-between;align-items:baseline;gap:8px}.pa4-tut{font-size:1.15rem;font-weight:800;color:#14161C}
.pa4-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.pa4-chips span{font-size:.7rem;padding:4px 9px;border-radius:99px;background:#F1EEE4;color:#3d3a2e}.pa4-chips span.uy{background:#FEF3C7;color:#92400e}
.pa4-gor small{display:block;font-size:.7rem;color:#6b6350;margin-bottom:5px}.pa4-pil{display:flex;gap:6px}.pa4-pil button{flex:1;border:1px solid rgba(20,22,28,.15);background:#fff;border-radius:12px;padding:9px 0;font:inherit;font-weight:800;cursor:pointer}.pa4-pil button.on{background:linear-gradient(135deg,#E6C77A,#C9A24B);border-color:#C9A24B;color:#14161C}
.pa4-sor{margin-top:8px;font-size:.68rem;line-height:1.5;color:#6b6350}
.pa2-sat.gor{opacity:.6;background:#F3F7F3}.pa2-sat.gor .pa2-bno{text-decoration:line-through;text-decoration-thickness:1.5px}.pa2-gortag{display:inline-block;margin-top:6px;font-size:.7rem;font-weight:800;color:#166534;background:#DCFCE7;border-radius:99px;padding:3px 10px}.pa2-satbtn{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.pa2-satbtn .pa2-btn{flex:1;min-width:120px;margin:0}.pa2-gortum{margin:8px 0;width:100%}
@media print{#admin-modal{display:none}}`;
  document.head.appendChild(s);
})();
