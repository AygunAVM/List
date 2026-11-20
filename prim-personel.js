// ═══════════════════════════════════════════════════════════════
//  V12.0 — PRİM · PERSONEL TARAFI
//   · Ayar yükleme (meta/primAyarlar, 30 dk önbellek) — Admin modülü de bunu kullanır
//   · "🏆 Puan Durumum" ekranı (tek özet doküman: primOzet/{ay__eposta}; başkasının tutarı yok)
//   · Sepette canlı koçluk, vitrinde ekstra prim rozeti
//   · Satışa damga (window.Prim.damga) — app.js yalnız bunu çağırır
//  CSS'ini kendi içine enjekte eder. Dil: personelin anlayacağı sade Türkçe.
// ═══════════════════════════════════════════════════════════════
import * as P from './prim.js?v=V12.4b-20261121-0027';
export { P };

const W = window;
const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const TL = v => '₺' + Math.round(Number(v) || 0).toLocaleString('tr-TR');
export const TL2 = v => '₺' + (Number(v) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const PY = v => '%' + (Math.round((Number(v) || 0) * 10) / 10).toLocaleString('tr-TR');
export const kopru = () => W._svkBridge || null;
export const kullanici = () => { try { const b = kopru(); return b && b.user ? b.user() : null; } catch (_e) { return null; } };
export const rol = () => String((kullanici() || {}).Rol || '').toLowerCase();
export const yonetici = () => rol() === 'admin';
const personelMi = () => rol() === 'satis' || rol() === 'destek';
const LS_AYAR = 'aygun_prim_ayar', LS_OZET = 'aygun_prim_ozet', TTL = 30 * 60 * 1000;
const lsOku = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_e) { return null; } };
const lsYaz = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_e) { /* yoksay */ } };

// ── Ayarlar ──
let AYAR = (() => { const o = lsOku(LS_AYAR); return P.ayarBirlestir(o && o.ayar); })();
let ayarZaman = (lsOku(LS_AYAR) || {}).ts || 0, ayarYukleniyor = null;
export const ayar = () => AYAR;
const noktaDagit = () => { try { if (AYAR.noktaKaynak === 'prim') { window._primNoktalarBekleyen = AYAR.noktalar; if (window.PrimNoktaUygula) window.PrimNoktaUygula(AYAR.noktalar); } } catch (_e) { /* yoksay */ } };   // V12.3: satış noktaları + mağaza harfleri tek kaynak = prim ayarı
export function ayarUygula(a) { AYAR = P.ayarBirlestir(a); ayarZaman = Date.now(); lsYaz(LS_AYAR, { ts: ayarZaman, ayar: a }); noktaDagit(); }
noktaDagit();
export async function ayarYukle(zorla) {
  if (!zorla && Date.now() - ayarZaman < TTL) return AYAR;
  if (ayarYukleniyor) return ayarYukleniyor;
  const b = kopru(); if (!b || !kullanici()) return AYAR;
  ayarYukleniyor = (async () => {
    try { const sn = await b.getDoc(b.doc(b.db, 'meta', 'primAyarlar')); ayarUygula(sn.exists() ? sn.data() : null); }
    catch (e) { console.warn('prim ayarı okunamadı:', e && e.message); }   // okunamazsa varsayılan/önbellek kullanılır
    finally { ayarYukleniyor = null; }
    return AYAR;
  })();
  return ayarYukleniyor;
}
const urunBul = kod => { try { const b = kopru(); return b && b.urunBul ? b.urunBul(kod) : null; } catch (_e) { return null; } };

// ── Satışa damga (app.js çağırır; hata satışı ASLA engellemez) ──
function damgala(sale) { try { return P.damga(sale, AYAR, urunBul); } catch (e) { console.warn('prim damgası:', e && e.message); return null; } }

// ── CSS ──
export function cssEkle() {
  if ($('prim-css')) return;
  const s = document.createElement('style'); s.id = 'prim-css';
  s.textContent = `
.pm-ov{position:fixed;inset:0;z-index:99990;background:rgba(15,15,18,.55);display:none;align-items:flex-end;justify-content:center;-webkit-tap-highlight-color:transparent}
.pm-ov.on{display:flex}
.pm-sheet{width:100%;max-width:560px;max-height:94vh;overflow-y:auto;background:var(--bg,#f4f4f6);border-radius:22px 22px 0 0;padding:0 0 28px;box-shadow:0 -8px 40px rgba(0,0,0,.25);font-family:inherit;color:var(--text-1,#18181b)}
@media(min-width:700px){.pm-ov{align-items:center}.pm-sheet{border-radius:22px}}
.pm-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;padding:14px 16px;background:var(--bg,#f4f4f6);border-bottom:1px solid rgba(0,0,0,.06)}
.pm-head h3{flex:1;margin:0;font-size:1.02rem;font-weight:800;letter-spacing:-.01em}
.pm-x{border:0;background:#e4e4e7;color:#27272a;width:34px;height:34px;border-radius:50%;font-size:1rem;cursor:pointer}
.pm-aylar{display:flex;gap:6px;padding:10px 16px 0}
.pm-aylar button{flex:1;border:1px solid #d4d4d8;background:#fff;border-radius:12px;min-height:38px;font:700 .82rem inherit;font-family:inherit;cursor:pointer;color:#52525b}
.pm-aylar button.on{background:#18181b;color:#fff;border-color:#18181b}
.pm-body{padding:12px 16px 0;display:flex;flex-direction:column;gap:12px}
.pm-kart{background:#fff;border-radius:18px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.pm-kart h4{margin:0 0 8px;font-size:.78rem;letter-spacing:.05em;text-transform:uppercase;color:#71717a;font-weight:800}
.pm-hero{background:linear-gradient(150deg,#18181b 0%,#3a3a40 100%);color:#fff}
.pm-hero h4{color:rgba(255,255,255,.65)}
.pm-buyuk{font-size:2.3rem;font-weight:900;letter-spacing:-.03em;line-height:1.05;font-variant-numeric:tabular-nums}
.pm-alt{font-size:.82rem;opacity:.8;margin-top:4px;line-height:1.4}
.pm-rozet-golge{display:inline-block;margin-top:8px;padding:4px 10px;border-radius:99px;background:rgba(251,191,36,.18);color:#fde68a;font-size:.72rem;font-weight:700;line-height:1.3}
.pm-sel{display:flex;flex-direction:column}
.pm-sel div{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px dashed #e4e4e7;font-size:.88rem;line-height:1.35}
.pm-sel div:last-child{border-bottom:0}
.pm-sel b{font-variant-numeric:tabular-nums;white-space:nowrap}
.pm-sel .eksi b{color:#b91c1c}.pm-sel .arti b{color:#15803d}
.pm-sel .son{font-size:1rem;font-weight:800;border-top:2px solid #18181b;margin-top:2px;padding-top:10px}
.pm-bar{position:relative;height:14px;border-radius:99px;background:#e4e4e7;margin:10px 0 6px;overflow:visible}
.pm-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:linear-gradient(90deg,#16a34a,#22c55e)}
.pm-bar u{position:absolute;top:-4px;bottom:-4px;width:3px;background:#18181b;border-radius:2px;text-decoration:none}
.pm-not{font-size:.8rem;line-height:1.5;color:#52525b;margin-top:6px}
.pm-not b{color:#18181b}
.pm-iyi{color:#15803d;font-weight:700}.pm-kotu{color:#b91c1c;font-weight:700}
.pm-ipucu{font-size:.76rem;line-height:1.45;color:#71717a;background:#f4f4f6;border-radius:10px;padding:8px 10px;margin-top:8px}
.pm-bos{text-align:center;padding:30px 10px;color:#71717a;font-size:.92rem;line-height:1.5}
.pm-ust{display:flex;gap:10px;align-items:center;justify-content:space-between;font-size:.74rem;color:#71717a;padding:2px 4px}
.pm-ust button{border:1px solid #d4d4d8;background:#fff;border-radius:10px;padding:6px 12px;font:700 .76rem inherit;font-family:inherit;cursor:pointer}
.pm-satir3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center}
.pm-satir3 div{background:#f4f4f6;border-radius:12px;padding:10px 4px}
.pm-satir3 b{display:block;font-size:1.15rem;font-variant-numeric:tabular-nums}
.pm-satir3 span{font-size:.68rem;color:#71717a}
/* sepet koçluğu */
#prim-kocluk{margin:8px 12px 0;padding:10px 12px;border-radius:14px;background:linear-gradient(135deg,#f0fdf4 0%,#ecfeff 100%);border:1px solid #bbf7d0;font-size:.8rem;line-height:1.45;color:#14532d}
#prim-kocluk b{font-weight:800}
#prim-kocluk .pk-ust{display:flex;justify-content:space-between;gap:8px;align-items:center;font-weight:700}
#prim-kocluk .pk-oneri{margin-top:6px;padding:7px 9px;border-radius:10px;background:#fff;border:1px dashed #86efac;color:#166534}
#prim-kocluk .pk-iyi{margin-top:6px;color:#15803d;font-weight:700}
:root[data-theme="dark"] #prim-kocluk{background:#052e1b;border-color:#166534;color:#bbf7d0}
:root[data-theme="dark"] #prim-kocluk .pk-oneri{background:#0a3b25;border-color:#166534;color:#bbf7d0}
/* vitrin rozeti */
.pm-rozet{display:inline-block;margin:2px 0 0 4px;padding:1px 8px;border-radius:99px;font-size:.58rem;font-weight:800;letter-spacing:.02em;color:#78350f;background:linear-gradient(135deg,#fde68a,#fbbf24);box-shadow:0 1px 4px rgba(217,119,6,.35);white-space:nowrap;vertical-align:middle}
/* admin ortak */
.pa-wrap{font-family:inherit;color:var(--text-1,#18181b)}
.pa-pill{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}
.pa-pill button{border:1px solid #d4d4d8;background:#fff;border-radius:99px;padding:8px 14px;font:700 .82rem inherit;font-family:inherit;cursor:pointer;color:#52525b}
.pa-pill button.on{background:#18181b;color:#fff;border-color:#18181b}
.pa-kart{background:#fff;border:1px solid #e4e4e8;border-radius:14px;padding:12px 14px;margin-bottom:12px}
.pa-kart h4{margin:0 0 8px;font-size:.92rem}
.pa-not{font-size:.76rem;color:#71717a;line-height:1.45;margin:0 0 8px}
.pa-tab{width:100%;border-collapse:collapse;font-size:.78rem}
.pa-tab th{text-align:right;padding:6px 6px;color:#71717a;font-weight:700;border-bottom:1px solid #e4e4e8;white-space:nowrap}
.pa-tab th:first-child,.pa-tab td:first-child{text-align:left}
.pa-tab td{padding:7px 6px;text-align:right;border-bottom:1px solid #f0f0f2;font-variant-numeric:tabular-nums;white-space:nowrap}
.pa-tab tr.pa-tikla{cursor:pointer}.pa-tab tr.pa-tikla:hover{background:#fafafa}
.pa-kaydir{overflow-x:auto;-webkit-overflow-scrolling:touch}
.pa-btn{border:0;background:#18181b;color:#fff;border-radius:10px;padding:9px 14px;font:700 .82rem inherit;font-family:inherit;cursor:pointer}
.pa-btn.kirmizi{background:#c8102e}.pa-btn.gri{background:#e4e4e7;color:#27272a}
.pa-btn:disabled{opacity:.5}
.pa-giris{border:1px solid #d4d4d8;border-radius:9px;padding:7px 8px;font:600 .82rem inherit;font-family:inherit;background:#fff;color:inherit;min-width:0;width:100%;box-sizing:border-box}
.pa-sat{display:grid;gap:6px;align-items:center;margin-bottom:6px}
.pa-uyari{background:#fffbeb;border:1px solid #fde68a;color:#78350f;border-radius:10px;padding:8px 10px;font-size:.78rem;line-height:1.45;margin-bottom:10px}
.pa-ok{background:#ecfdf3;border:1px solid #bbf7d0;color:#166534;border-radius:10px;padding:8px 10px;font-size:.78rem;margin:8px 0}
.pa-hata{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:10px;padding:8px 10px;font-size:.78rem;margin:8px 0}
.pa-chip{display:inline-flex;align-items:center;gap:6px;background:#f4f4f6;border:1px solid #e4e4e8;border-radius:99px;padding:6px 6px 6px 12px;font-size:.82rem;font-weight:700;margin:0 6px 6px 0}
.pa-chip button{border:0;background:#e4e4e7;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:.7rem}
.pa-sel{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dashed #e4e4e8;font-size:.8rem}
.pa-acik{background:#fafafa;padding:8px 10px}
.pa-mesaj{white-space:pre-wrap;font:600 .8rem/1.5 inherit;font-family:inherit;background:#f4f4f6;border-radius:10px;padding:10px 12px}
`;
  document.head.appendChild(s);
}

// ── Özet (tek doküman) ──
let ozetKaydi = lsOku(LS_OZET) || {};   // { id: { ts, veri } }
const bugunAy = () => P.ayStr(Date.now());
const oncekiAy = ay => { const [y, m] = ay.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };
export async function ozetYukle(ay, zorla) {
  const u = kullanici(), b = kopru(); if (!u || !b) return null;
  const id = P.ozetDocId(ay, u.Email), k = ozetKaydi[id];
  if (!zorla && k && Date.now() - k.ts < TTL) return k.veri;
  try {
    const sn = await b.getDoc(b.doc(b.db, 'primOzet', id));
    const veri = sn.exists() ? sn.data() : null;
    ozetKaydi[id] = { ts: Date.now(), veri }; lsYaz(LS_OZET, ozetKaydi);
    return veri;
  } catch (e) { console.warn('prim özeti okunamadı:', e && e.message); return k ? k.veri : null; }
}
const ozetSenkron = () => { const u = kullanici(); if (!u) return null; const k = ozetKaydi[P.ozetDocId(bugunAy(), u.Email)]; return k ? k.veri : null; };

// ── Puan Durumum ekranı ──
let seciliAy = null, yukleniyor = false;
function ekranHtml(o, ay) {
  if (!o) return '<div class="pm-bos">📭<br><b>' + esc(P.ayAdi(ay)) + '</b> için henüz hesap yapılmadı.<br>Yönetici hesapladığında burada görünür.</div>';
  const golge = !!o.golge, kalan = o.kalanGun, hedefVar = o.hedef > 0;
  const onde = o.konumFark >= 0;
  const eksiYaz = v => (v < 0 ? '−' : '+') + TL(Math.abs(v));
  let h = '';
  h += '<div class="pm-kart pm-hero"><h4>' + esc(P.ayAdi(ay)) + ' · senin payın</h4><div class="pm-buyuk">' + TL(o.hakEdis) + '</div>'
    + '<div class="pm-alt">Satışlarından doğan prim <b>' + TL(o.brutPrim) + '</b> × verimliliğin <b>' + PY(o.verimlilik) + '</b>'
    + (golge ? '' : (o.indirimEtkisi < 0 ? ', fazla indirim kesintisi dahil' : '')) + '</div>'
    + (golge ? '<div class="pm-rozet-golge">🧪 Deneme ayı: fazla indirim kesintisi bu ay uygulanmıyor, sadece bilgi için gösteriliyor.</div>' : '') + '</div>';
  // şelale
  h += '<div class="pm-kart"><h4>Primin nasıl hesaplandı?</h4><div class="pm-sel">'
    + '<div><span>1. Satışlarından doğan prim</span><b>' + TL(o.brutPrim) + '</b></div>'
    + '<div class="' + (o.indirimEtkisi < 0 ? 'eksi' : '') + '"><span>2. Fazla indirim yüzünden' + (golge ? ' <small>(deneme: uygulanmıyor)</small>' : '') + '</span><b>' + eksiYaz(o.indirimEtkisi) + '</b></div>'
    + '<div class="' + (o.verimlilikEtkisi < 0 ? 'eksi' : '') + '"><span>3. Verimlilik (' + PY(o.verimlilik) + ') yüzünden</span><b>' + eksiYaz(o.verimlilikEtkisi) + '</b></div>'
    + (o.onayKesinti ? '<div class="eksi"><span>4. Onay kesintisi</span><b>' + eksiYaz(o.onayKesinti) + '</b></div>' : '')
    + '<div class="son"><span>Senin payın</span><b>' + TL(o.hakEdis) + '</b></div></div>'
    + (o.ekstraPrim > 0 ? '<div class="pm-ipucu">⭐ Primine <b>' + TL(o.ekstraPrim) + '</b> özel ürün primi dahil.</div>' : '') + '</div>';
  // hedef
  if (hedefVar) {
    const yz = Math.min(100, o.hedefYuzde), bek = Math.min(100, o.beklenenKdvsiz / o.hedef * 100);
    h += '<div class="pm-kart"><h4>Hedefin</h4><div class="pm-satir3"><div><b>' + TL(o.kdvsiz) + '</b><span>şu ana kadar</span></div><div><b>' + TL(o.hedef) + '</b><span>aylık hedef</span></div><div><b>' + PY(o.hedefYuzde) + '</b><span>gerçekleşen</span></div></div>'
      + '<div class="pm-bar"><i style="width:' + yz + '%"></i><u style="left:calc(' + bek + '% - 1px)"></u></div>'
      + '<div class="pm-not">Siyah çizgi: <b>bugün olman gereken yer</b> (' + TL(o.beklenenKdvsiz) + '). '
      + (onde ? '<span class="pm-iyi">Şu an ' + TL(o.konumFark) + ' öndesin 👏</span>' : '<span class="pm-kotu">Şu an ' + TL(Math.abs(o.konumFark)) + ' gerideysin.</span>') + '</div>'
      + (o.hedefYuzde < 100 ? '<div class="pm-not">Hedefe ulaşmak için günde yaklaşık <b>' + TL(o.gunlukGereken) + '</b> satış gerekiyor (' + kalan + ' gün kaldı).</div>' : '<div class="pm-not pm-iyi">Hedefi tamamladın! 🎉</div>')
      + '<div class="pm-ipucu">Tüm tutarlar KDV hariç. Hedef, ürün müşteriye <b>teslim edildiğinde</b> sayılır. Ay sonunda gerçekleşenle kesinleşir.</div></div>';
  } else {
    h += '<div class="pm-kart"><h4>Hedefin</h4><div class="pm-not">Bu ay için hedefin henüz girilmemiş. Şu ana kadar teslim edilen satışın: <b>' + TL(o.kdvsiz) + '</b> (KDV hariç).</div></div>';
  }
  // verimlilik
  const a = AYAR.verimlilik.hedef, b2 = AYAR.verimlilik.nitelikli, pa = Math.min(100, o.hedefYuzde) * a, pb = o.nitelikliYuzde * b2;
  h += '<div class="pm-kart"><h4>Verimliliğin</h4><div class="pm-buyuk" style="font-size:1.8rem">' + PY(o.verimlilik) + '</div>'
    + '<div class="pm-not">Hedef %' + (Math.round(Math.min(100, o.hedefYuzde) * 10) / 10).toLocaleString('tr-TR') + ' × ' + String(a).replace('.', ',') + ' = <b>' + (Math.round(pa * 10) / 10).toLocaleString('tr-TR') + '</b><br>'
    + 'Nitelikli satış ' + PY(o.nitelikliYuzde) + ' × ' + String(b2).replace('.', ',') + ' = <b>' + (Math.round(pb * 10) / 10).toLocaleString('tr-TR') + '</b></div>'
    + '<div class="pm-ipucu">💡 <b>Nitelikli</b> = beyaz eşya, klima, ankastre, küçük ev aletleri, aksesuar ve sigorta. Telefon, TV, tablet gibi ürünler nitelikli sayılmaz. Telefon/TV satarken yanına ekran koruyucu, aksesuar veya sigorta eklemek verimliliğini artırır.</div></div>';
  // indirim
  const ustte = o.indirimOrani > o.ekipIndirimOrani + 0.05;
  h += '<div class="pm-kart"><h4>İndirimin</h4><div class="pm-satir3" style="grid-template-columns:1fr 1fr"><div><b>' + PY(o.indirimOrani) + '</b><span>senin indirimin</span></div><div><b>' + PY(o.ekipIndirimOrani) + '</b><span>ekip ortalaması</span></div></div>'
    + '<div class="pm-not">' + (ustte ? '<span class="pm-kotu">Ekip ortalamasının üstündesin.</span> Böyle devam edersen primin yaklaşık <b>×' + String(o.katsayi).replace('.', ',') + '</b> ile çarpılır' + (golge ? ' (deneme ayında uygulanmıyor).' : '.') : '<span class="pm-iyi">Ekip ortalamasının altındasın, kesinti yok 👍</span>') + '</div>'
    + '<div class="pm-ipucu">Burada yalnız senin verdiğin indirim sayılır. Sistemin kampanya indirimleri senin hesabına yazılmaz.</div></div>';
  // sıra
  if (o.kisiSayisi > 1) {
    h += '<div class="pm-kart"><h4>Ekipte yerin</h4><div class="pm-buyuk" style="font-size:1.8rem">' + o.sira + '. <span style="font-size:1rem;font-weight:700;color:#71717a">/ ' + o.kisiSayisi + ' kişi</span></div>'
      + '<div class="pm-not">Ekip ortalaması: hedef <b>' + PY(o.ekipOrtHedefYuzde) + '</b> · verimlilik <b>' + PY(o.ekipOrtVerimlilik) + '</b><br>Lider (' + esc(o.liderBas || '—') + ') hedefinin <b>' + PY(o.liderHedefYuzde) + '</b>\'ine ulaştı.</div>'
      + '<div class="pm-ipucu">Kimsenin prim tutarı görünmez; yalnız sıran ve ekip ortalaması gösterilir.</div></div>';
  }
  return h;
}
export async function ekranYenile(zorla) {
  const g = $('pm-icerik'); if (!g || yukleniyor) return; yukleniyor = true;
  const ay = seciliAy || bugunAy();
  g.innerHTML = '<div class="pm-bos">⏳ Yükleniyor…</div>';
  const o = await ozetYukle(ay, zorla); yukleniyor = false;
  const ust = '<div class="pm-ust"><span>' + (o && o.guncelleme ? 'Son güncelleme: ' + esc(new Date(o.guncelleme).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) : 'Henüz hesap yok') + '</span><button type="button" id="pm-yenile">↻ Yenile</button></div>';
  g.innerHTML = ust + ekranHtml(o, ay);
  const y = $('pm-yenile'); if (y) y.onclick = () => { if (Date.now() - (ekranYenile._son || 0) < 20000) return; ekranYenile._son = Date.now(); ekranYenile(true); };
  document.querySelectorAll('#pm-aylar button').forEach(bt => bt.classList.toggle('on', bt.dataset.ay === ay));
}
export function ac() {
  cssEkle(); ayarYukle(false);
  let m = $('prim-puan');
  if (!m) {
    m = document.createElement('div'); m.id = 'prim-puan'; m.className = 'pm-ov';
    m.innerHTML = '<div class="pm-sheet"><div class="pm-head"><h3>🏆 Puan Durumum</h3><button type="button" class="pm-x" id="pm-kapat">✕</button></div><div class="pm-aylar" id="pm-aylar"></div><div class="pm-body" id="pm-icerik"></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) kapat(); });
    $('pm-kapat').onclick = kapat;
  }
  const b = bugunAy(), o = oncekiAy(b); seciliAy = b;
  $('pm-aylar').innerHTML = '<button type="button" data-ay="' + b + '">Bu ay</button><button type="button" data-ay="' + o + '">Geçen ay</button>';
  $('pm-aylar').querySelectorAll('button').forEach(bt => { bt.onclick = () => { seciliAy = bt.dataset.ay; ekranYenile(false); }; });
  m.classList.add('on'); document.body.style.overflow = 'hidden';
  ekranYenile(false);
}
export function kapat() { const m = $('prim-puan'); if (m) m.classList.remove('on'); document.body.style.overflow = ''; }

// ── Alt çubuk düğmesi ──
function dugme() {
  const var_ = !!kullanici() && personelMi() && AYAR.personelEkran === true;
  let b = $('tab-btn-puan');
  if (!var_) { if (b) b.style.display = 'none'; return; }
  if (!b) {
    const ref = $('tab-btn-mystats') || $('tab-btn-teklifler'); if (!ref) return;
    b = document.createElement('button'); b.className = 'tab-btn'; b.id = 'tab-btn-puan'; b.title = 'Puan Durumum';
    b.innerHTML = '<span class="tab-icon">🏆</span><span class="tab-label">Puan</span>'; b.onclick = () => ac();
    ref.insertAdjacentElement('afterend', b);
  }
  b.style.display = 'flex';
}

// ── Sepet canlı koçluğu ──
export function sepetKocluk() {
  const alan = $('cart-table-area'); if (!alan) return;
  let el = $('prim-kocluk');
  if (!personelMi() || AYAR.personelEkran !== true) { if (el) el.remove(); return; }
  const sepet = W._primBridge && W._primBridge.sepet ? W._primBridge.sepet() : [];
  const kc = P.sepetKocluk(sepet, AYAR, ozetSenkron(), urunBul);
  if (!kc) { if (el) el.remove(); return; }
  cssEkle();
  if (!el) { el = document.createElement('div'); el.id = 'prim-kocluk'; alan.insertAdjacentElement('afterend', el); }
  let h = '<div class="pk-ust"><span>💡 Prim koçu</span><span>Bu sepetin tahmini primi: <b>' + TL(kc.brutPrim) + '</b></span></div>'
    + '<div>Nitelikli satış oranı: <b>' + PY(kc.nitelikliYuzde) + '</b></div>';
  if (kc.ekstraPrim > 0) h += '<div>⭐ Bu sepette özel ürün primi var: <b>+' + TL(kc.ekstraPrim) + '</b></div>';
  if (kc.oneri) {
    const o = kc.oneri;
    h += '<div class="pk-oneri">Sepette telefon/TV gibi nitelikli sayılmayan ürün var. Yanına yaklaşık <b>' + TL(o.tutar) + '</b>\'lik ekran koruyucu, aksesuar veya sigorta eklersen nitelikli oran <b>' + PY(kc.nitelikliYuzde) + ' → ' + PY(o.nitelikliYuzdeSonra) + '</b> olur, '
      + (o.kaynak === 'ay' ? 'aylık verimliliğin' : 'verimlilik puanın') + ' <b>+' + (Math.round(o.verimlilikArtis * 10) / 10).toLocaleString('tr-TR') + ' puan</b> artar' + (o.primArtis > 0 ? ' (ek prim ≈ ' + TL(o.primArtis) + ')' : '') + '.</div>';
  } else if (kc.nitelikliYuzde >= 99.5) h += '<div class="pk-iyi">Harika! Sepetin tamamen nitelikli ürünlerden oluşuyor ✅</div>';
  el.innerHTML = h;
}

// ── Vitrin rozeti: ürün satırında "⭐ +250 ₺ prim" ──
let rozetOnbellek = { gun: '', harita: {}, ayarZ: 0 };
const kisaTarih = g => { const m = String(g || '').match(/^\d{4}-(\d\d)-(\d\d)$/); return m ? Number(m[2]) + ' ' + ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'][Number(m[1]) - 1] : ''; };
export function rozet(kod) {
  if (!AYAR.ekstra || !AYAR.ekstra.length) return '';
  const gun = P.gunStr(Date.now());
  if (rozetOnbellek.gun !== gun || rozetOnbellek.ayarZ !== ayarZaman) rozetOnbellek = { gun, harita: P.aktifEkstralar(AYAR, gun), ayarZ: ayarZaman };
  const l = rozetOnbellek.harita[String(kod).trim()]; if (!l) return '';
  const t = l.reduce((a, x) => a + x.tutar, 0), bit = l.map(x => x.bit).filter(Boolean).sort()[0] || '';
  return '<span class="pm-rozet" title="' + esc(l.map(x => x.ad).filter(Boolean).join(', ') || 'Özel ürün primi') + '">⭐ +' + TL(t) + ' prim' + (bit ? ' · ' + esc(kisaTarih(bit)) + ' \'e kadar' : '') + '</span>';
}

// ── Başlat (giriş sonrası; birden çok kez çağrılabilir) ──
let kuruldu = false;
export function baslat() {
  if (!kullanici()) return;
  cssEkle();
  ayarYukle(false).then(() => { dugme(); try { sepetKocluk(); } catch (_e) { /* yoksay */ } });
  if (personelMi()) ozetYukle(bugunAy(), false).then(() => { try { sepetKocluk(); } catch (_e) { /* yoksay */ } });
  dugme();
  if (!kuruldu) { kuruldu = true; setTimeout(dugme, 1500); setTimeout(dugme, 6000); }
}

W.Prim = { damga: damgala, ayar, ayarYukle, baslat, sepetKocluk, rozet, ac, kapat, versiyon: 'V12.0' };
// Modül yüklendiğinde oturum zaten açıksa (sayfa yenileme) otomatik başlat
setTimeout(() => { try { baslat(); } catch (_e) { /* yoksay */ } }, 2500);
