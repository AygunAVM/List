// ═══════════════════════════════════════════════════════════════
//  V12.0 — PRİM · PERSONEL TARAFI
//   · Ayar yükleme (meta/primAyarlar, 30 dk önbellek) — Admin modülü de bunu kullanır
//   · "🏆 Skor Kartım" ekranı (V12.6: personelde "prim" kelimesi YOK → SOZLUK) (tek özet doküman: primOzet/{ay__eposta}; başkasının tutarı yok)
//   · Sepette canlı koçluk, vitrinde ekstra prim rozeti
//   · Satışa damga (window.Prim.damga) — app.js yalnız bunu çağırır
//  CSS'ini kendi içine enjekte eder. Dil: personelin anlayacağı sade Türkçe.
// ═══════════════════════════════════════════════════════════════
import * as P from './prim.js?v=V12.6-20261121-1521';
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
.pm-ust{opacity:.5;font-weight:500;margin-right:4px}
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
/* V12.5 premium admin */
.pa2{--ink:#16161a;--mut:#6b6b76;--line:#e7e7ec;--card:#fff;--soft:#f4f4f8;--acc:#c8102e;--ok:#12805c;--warn:#b45309;--bad:#b91c1c;color:var(--ink)}
:root[data-theme="dark"] .pa2{--ink:#f4f4f6;--mut:#a1a1ad;--line:#2c2c34;--card:#1b1b21;--soft:#24242c}
.pa2 .pa-pill{position:sticky;top:0;z-index:6;background:var(--soft);border-radius:16px;padding:4px;gap:2px;flex-wrap:nowrap;overflow-x:auto;margin-bottom:14px;box-shadow:0 1px 0 var(--line)}
.pa2 .pa-pill button{flex:1 0 auto;border:0;background:transparent;color:var(--mut);border-radius:12px;padding:10px 12px;white-space:nowrap}
.pa2 .pa-pill button.on{background:var(--card);color:var(--ink);box-shadow:0 2px 8px rgba(0,0,0,.12)}
.pa2-say{font-style:normal;background:var(--acc);color:#fff;border-radius:99px;padding:1px 7px;font-size:.68rem;margin-left:4px}
.pa2 .pa-kart{background:var(--card);border-color:var(--line);border-radius:18px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.pa2 .pa-giris{background:var(--card);border-color:var(--line);color:var(--ink);border-radius:12px;padding:10px 12px}
.pa2 .pa-tab th,.pa2 .pa-tab td{border-color:var(--line)}.pa2 .pa-sel{border-color:var(--line)}.pa2 .pa-acik{background:var(--soft)}
.pa2-hero{background:linear-gradient(135deg,#111827 0%,#1f2937 55%,#7f1d1d 140%);color:#fff;border-radius:22px;padding:18px;margin-bottom:14px;box-shadow:0 10px 30px rgba(17,24,39,.25)}
.pa2-eyebrow{font-size:.66rem;letter-spacing:.14em;opacity:.65;font-weight:800}
.pa2-hero-b{font-size:1.6rem;font-weight:800;margin:2px 0}.pa2-hero-a{font-size:.78rem;opacity:.75}
.pa2-hero-ctl{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center}
.pa2-ay{border:0;border-radius:12px;padding:10px 12px;font:700 .85rem inherit;font-family:inherit;background:rgba(255,255,255,.14);color:#fff;color-scheme:dark}
.pa2-btn{border:0;background:var(--ink);color:var(--card);border-radius:12px;padding:10px 16px;font:700 .82rem inherit;font-family:inherit;cursor:pointer}
.pa2-btn.acik{background:#fff;color:#111827}.pa2-btn.cam{background:rgba(255,255,255,.16);color:#fff}.pa2-btn.kirmizi{background:var(--acc);color:#fff}
.pa2-btn.ikincil{background:var(--soft);color:var(--ink)}.pa2-btn.tehlike{background:#fee2e2;color:var(--bad)}.pa2-btn.kucuk{padding:8px 10px;font-size:.74rem;white-space:nowrap}
.pa2-btn:disabled{opacity:.5}
.pa2-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:16px}
.pa2-kpi div{background:rgba(255,255,255,.09);border-radius:14px;padding:10px 12px}.pa2-kpi span{display:block;font-size:.68rem;opacity:.7}.pa2-kpi b{font-size:1.15rem}
.pa2-uyaris{display:flex;gap:12px;align-items:center;width:100%;text-align:left;border:1px solid #fcd34d;background:linear-gradient(135deg,#fffbeb,#fef3c7);color:#78350f;border-radius:16px;padding:12px 14px;margin-bottom:12px;cursor:pointer;font-family:inherit}
.pa2-uyaris span{font-size:1.5rem}.pa2-uyaris div{flex:1}.pa2-uyaris b{display:block;font-size:.88rem}.pa2-uyaris small{font-size:.74rem;opacity:.85}.pa2-uyaris i{font-style:normal;font-size:1.4rem}
.pa2-bolum{font-weight:800;font-size:.9rem;margin:16px 2px 8px}.pa2-bolum small{font-weight:600;color:var(--mut)}.pa2-bolum.k{font-size:.8rem;margin-top:12px}
.pa2-kisiler{display:grid;gap:10px}
.pa2-kisi{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.pa2-kisi.acik{box-shadow:0 8px 24px rgba(0,0,0,.12)}
.pa2-kisi-ust{display:flex;align-items:center;gap:10px;cursor:pointer}
.pa2-sira{width:22px;text-align:center;font-weight:800;color:var(--mut);font-size:.82rem}
.pa2-av{width:40px;height:40px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;flex:none}
.pa2-kim{flex:1;min-width:0}.pa2-kim b{display:block;font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pa2-kim small,.pa2-hak small{color:var(--mut);font-size:.72rem}
.pa2-dzr{color:#7c3aed;font-weight:700}
.pa2-hak{text-align:right}.pa2-hak b{display:block;font-size:1.05rem;color:var(--ok)}
.pa2-bar{position:relative;height:8px;background:var(--soft);border-radius:99px;margin:12px 0 8px}
.pa2-bar i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#12805c,#34d399);border-radius:99px}
.pa2-bar u{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink);opacity:.6;border-radius:2px}
.pa2-cipler{display:flex;gap:6px;flex-wrap:wrap}.pa2-cipler span{background:var(--soft);border-radius:99px;padding:4px 10px;font-size:.72rem;color:var(--mut)}.pa2-cipler b{color:var(--ink)}
.pa2-detay{border-top:1px dashed var(--line);margin-top:12px;padding-top:10px}
.pa2-akis{background:var(--soft);border-radius:14px;padding:6px 12px}
.pa2-ak{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px dashed var(--line);font-size:.8rem}.pa2-ak:last-child{border:0}
.pa2-ak.eksi b{color:var(--bad)}.pa2-ak.son{font-size:.9rem}.pa2-ak small{color:var(--mut);font-weight:500}
.pa2-mini{display:flex;justify-content:space-between;gap:10px;padding:10px 2px;border-bottom:1px solid var(--line);font-size:.78rem}
.pa2-mini small,.pa2-alt{display:block;color:var(--mut);font-size:.72rem}.pa2-sag{text-align:right}
.pa2-lnk{border:0;background:none;color:var(--acc);font:700 .74rem inherit;font-family:inherit;cursor:pointer;padding:4px 0}
.pa2-rozetler{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}
.pa2-roz{border-radius:99px;padding:2px 9px;font-size:.68rem;font-weight:700;background:var(--soft);color:var(--mut)}
.pa2-roz.r2{background:#fee2e2;color:#991b1b}.pa2-roz.r0{background:#ede9fe;color:#5b21b6}.pa2-roz.r1{background:#e0f2fe;color:#075985}
.pa2-baslik h3{margin:0 0 4px;font-size:1.15rem}.pa2-baslik p{margin:0 0 12px;font-size:.8rem;color:var(--mut);line-height:1.5}
.pa2-fil-sat{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.pa2-fil{border:1px solid var(--line);background:var(--card);color:var(--mut);border-radius:99px;padding:8px 14px;font:700 .78rem inherit;font-family:inherit;cursor:pointer}.pa2-fil.on{background:var(--ink);color:var(--card);border-color:var(--ink)}
.pa2-ara{margin-bottom:12px}
.pa2-liste{display:grid;gap:10px}
.pa2-sat{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:12px 14px}.pa2-sat.dz{border-color:#c4b5fd}.pa2-sat.acik{box-shadow:0 8px 24px rgba(0,0,0,.14);border-color:var(--acc)}
.pa2-sat-ust{display:flex;justify-content:space-between;gap:10px}
.pa2-bno{font-weight:800;font-size:.9rem}.pa2-para{font-weight:800;font-size:1rem}
.pa2-dznot{margin-top:8px;background:#f5f3ff;color:#5b21b6;border-radius:10px;padding:6px 10px;font-size:.74rem}
:root[data-theme="dark"] .pa2-dznot{background:#2e1065;color:#ddd6fe}
.pa2-sat>.pa2-btn{margin-top:10px;width:100%}
.pa2-edit{border-top:1px dashed var(--line);margin-top:12px;padding-top:12px}.pa2-edit-b{font-weight:800;font-size:.8rem;margin-bottom:6px}.pa2-edit-b small{font-weight:600;color:var(--mut)}
.pa2-tutar{display:flex;gap:6px}.pa2-tutar .pa-giris{font-size:1.1rem;font-weight:800}
.pa2-sec{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:12px;padding:10px;margin-bottom:6px;cursor:pointer}.pa2-sec span{display:block;font-size:.8rem}.pa2-sec small{display:block;color:var(--mut);font-size:.72rem;margin-top:2px}
.pa2-hizli{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}.pa2-cip{border:1px solid var(--line);background:var(--soft);color:var(--ink);border-radius:99px;padding:5px 10px;font:600 .72rem inherit;font-family:inherit;cursor:pointer}
.pa2-islem{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.pa2-bos{text-align:center;padding:30px 16px;background:var(--card);border:1px dashed var(--line);border-radius:18px}.pa2-bos-i{font-size:2rem}.pa2-bos p{color:var(--mut);font-size:.8rem}
.pa2-det{background:var(--card);border:1px solid var(--line);border-radius:16px;margin-top:12px;padding:4px 12px}.pa2-det summary{cursor:pointer;font-weight:800;font-size:.84rem;padding:10px 0}
.pa2-det .pa-kart{border:0;box-shadow:none;padding:0 0 10px}
/* V12.5 ayarlar premium */
.pa2-ilke{background:linear-gradient(135deg,#eff6ff,#e0f2fe);border:1px solid #bae6fd;color:#0c4a6e;border-radius:16px;padding:12px 14px;margin-bottom:12px;font-size:.78rem;line-height:1.5}
.pa2-ilke ul{margin:6px 0 0;padding-left:18px}.pa2-ilke li{margin:3px 0}
:root[data-theme="dark"] .pa2-ilke{background:#0c2a3d;border-color:#155e75;color:#bae6fd}
.pa2 .pa-kart h4{display:flex;align-items:center;gap:10px;font-size:1rem;margin:0 0 10px;padding-bottom:10px;border-bottom:1px solid var(--line)}
.pa2-ik{width:32px;height:32px;border-radius:10px;background:var(--soft);display:inline-flex;align-items:center;justify-content:center;font-size:1rem;flex:none}
.pa2 .pa-sat{background:var(--soft);border-radius:12px;padding:8px 10px;margin-bottom:6px}
.pa2 .pa-sat>span{font-size:.8rem}
.pa2 .pa-tab thead th{font-size:.66rem;letter-spacing:.03em}
.pa2 .pa-tab tbody tr:hover{background:var(--soft)}
.pa2 select.pa-giris{background:var(--card);color:var(--ink)}
.pa2-sw{display:flex;gap:12px;align-items:flex-start;padding:10px;margin:6px 0;background:var(--soft);border-radius:12px;cursor:pointer;font-size:.8rem;line-height:1.45}
.pa2-sw input{position:absolute;opacity:0;pointer-events:none}
.pa2-sw i{flex:none;width:42px;height:24px;border-radius:99px;background:#c4c4cc;position:relative;transition:.2s;margin-top:1px}
.pa2-sw i:after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:.2s}
.pa2-sw input:checked+i{background:var(--ok)}.pa2-sw input:checked+i:after{left:21px}
.pa2-sw input:focus-visible+i{outline:2px solid var(--acc);outline-offset:2px}
.pa2-kaydet{position:sticky;bottom:0;z-index:5;padding:12px 0 8px;background:linear-gradient(180deg,transparent,var(--card) 35%)}
/* V12.6 skor kartı (personel) */
#prim-puan .pm-sheet,#prim-puan .pm-sheet *{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.pm-wm{position:absolute;inset:0;z-index:5;pointer-events:none;background-repeat:repeat;background-size:250px 150px}
.pm-ov.pm-blur .pm-sheet{filter:blur(18px);transition:filter .05s}
@media print{#prim-puan,#prim-kocluk{display:none!important}}
.pm-hero{position:relative;overflow:hidden;background:linear-gradient(150deg,#1e1b4b 0%,#4338ca 60%,#7c3aed 120%)}
.pm-hero:after{content:"";position:absolute;right:-40px;top:-40px;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.18),transparent 70%)}
.pm-bp{font-size:1rem;font-weight:700;opacity:.8;letter-spacing:0}
.pm-hbar{position:relative;height:12px;border-radius:99px;background:rgba(255,255,255,.2);margin:14px 0 6px}
.pm-hbar i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:linear-gradient(90deg,#34d399,#a7f3d0)}
.pm-hbar u{position:absolute;top:-4px;bottom:-4px;width:3px;background:#fff;border-radius:2px;text-decoration:none}
.pm-hb-yazi{display:flex;justify-content:space-between;gap:8px;font-size:.78rem;opacity:.95}
.pm-hiyi{color:#a7f3d0;font-weight:700}.pm-hkotu{color:#fde68a;font-weight:700}
.pm-kademe{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.pm-kademe div{background:rgba(255,255,255,.12);border-radius:12px;padding:8px 10px}.pm-kademe span{display:block;font-size:.68rem;opacity:.75}.pm-kademe b{font-size:1.1rem}
.pm-iyi2{color:#a7f3d0;font-weight:700}
.pm-bekle{background:repeating-linear-gradient(135deg,#fafaf9,#fafaf9 10px,#f5f5f4 10px,#f5f5f4 20px);border:1px dashed #d6d3d1;box-shadow:none;opacity:.92}
.pm-bb{font-size:1.5rem;font-weight:800;color:#78716c}.pm-bb small{font-size:.8rem;font-weight:600}
.pm-satlar{display:flex;flex-direction:column}
.pm-sat{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f0f0f2}
.pm-sat:last-child{border-bottom:0}.pm-sat.soluk{opacity:.7}
.pm-sat-s{min-width:0;display:flex;flex-direction:column;gap:2px}.pm-sat-s b{font-size:.92rem}.pm-sat-s small{font-size:.72rem;color:#71717a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pm-sat-p{font-weight:900;font-size:1.05rem;color:#15803d;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.pm-sat.soluk .pm-sat-p{color:#78716c}.pm-sat-p small{display:block;font-size:.62rem;font-weight:600;color:#71717a}
.pm-rzs{display:flex;gap:5px;flex-wrap:wrap}.pm-rz{border-radius:99px;padding:1px 8px;font-size:.66rem;font-weight:800;background:#f4f4f6;color:#52525b}
.pm-rz.ry{background:#ffedd5;color:#9a3412}.pm-rz.ro{background:#fef9c3;color:#854d0e}.pm-rz.rd{background:#ede9fe;color:#5b21b6}
.pm-dzn{color:#5b21b6!important;white-space:normal!important}
.pm-det{background:#fff;border-radius:18px;padding:4px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.pm-det summary{cursor:pointer;font-weight:800;font-size:.86rem;padding:12px 0}
.pm-alt2{font-size:.82rem;line-height:1.5;padding:8px 0;border-top:1px dashed #e4e4e7;color:#3f3f46}.pm-alt2 small{color:#71717a}
:root[data-theme="dark"] .pm-det,:root[data-theme="dark"] .pm-kart{background:#1b1b21;color:#f4f4f6}
:root[data-theme="dark"] .pm-sat{border-color:#2c2c34}
/* V12.6 admin: dönem / görünüm */
.pa2-donem{display:inline-block;margin:6px 0 2px;padding:4px 12px;border-radius:99px;background:rgba(255,255,255,.14);font-size:.78rem;font-weight:700}
.pa2-tarih{display:flex;flex-direction:column;gap:3px;font-size:.68rem;opacity:.9;font-weight:700}
.pa2-gor{border-top:1px dashed var(--line);margin-top:12px;padding-top:10px}
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

// ── V12.6: SÖZLÜK — personele dönük TÜM metinlerde "prim" yerine "puan / skor". Tek yerden değişir; admin ekranı ve Excel "prim" kalır. ──
export const SOZLUK = {
  ekran: 'Skor Kartım', menu: 'Skor', kazanilan: 'Kazanılan puan', bekleyen: 'Bekleyen puan', birim: 'puan',
  koc: 'Skor koçu', sepetTahmin: 'Bu sepetin tahmini puanı', ozelUrun: 'özel ürün puanı', yuksekUrun: 'Yüksek Puanlı Ürünler',
  rozet: (t, bit) => '⭐ +' + t + ' puan' + (bit ? ' · ' + bit + ' \'e kadar' : ''), rozetBaslik: 'Özel ürün puanı'
};
const puanKat = () => Number(AYAR.puanKatsayisi) > 0 ? Number(AYAR.puanKatsayisi) : 0.1;
export const PUAN = (v, k) => Math.round((Number(v) || 0) * (Number(k) > 0 ? Number(k) : puanKat()));   // ₺ → puan
const PN = v => (Math.round(Number(v) || 0)).toLocaleString('tr-TR');
const PNI = v => (v < 0 ? '−' : '+') + PN(Math.abs(v));
const gunAyKisa = t => { const d = new Date(Number(t) + 3 * 3600000); return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0'); };

// ── Puan Durumum → "Skor Kartım" ekranı ──
let seciliAy = null, yukleniyor = false;
const ROZET = { y: ['🔥', 'yüksek puanlı'], o: ['⭐', 'özel ürün'], d: ['🛠', 'yönetici düzeltmesi'] };
function satirHtml(x, soluk) {
  const r = (x.r || []).map(k => ROZET[k] ? '<span class="pm-rz r' + k + '" title="' + ROZET[k][1] + '">' + ROZET[k][0] + (k === 'd' ? ' düzeltme' : '') + '</span>' : '').join('');
  return '<div class="pm-sat' + (soluk ? ' soluk' : '') + '"><div class="pm-sat-s"><b>' + esc(x.ad) + '</b><small>' + esc(gunAyKisa(x.t)) + ' · ' + esc(x.u || '') + '</small>' + (r ? '<div class="pm-rzs">' + r + '</div>' : '') + (x.n ? '<small class="pm-dzn">🛠 ' + esc(x.n) + '</small>' : '') + '</div><div class="pm-sat-p">' + (soluk ? '≈ ' : '') + PNI(x.p) + '<small>puan</small></div></div>';
}
function ekranHtml(o, ay) {
  if (!o) return '<div class="pm-bos">📭<br><b>' + esc(P.ayAdi(ay)) + '</b> için henüz skor hesaplanmadı.<br>Yönetici hesapladığında burada görünür.</div>';
  const pk = o.puanKatsayisi > 0 ? o.puanKatsayisi : puanKat(), pu = v => PUAN(v, pk), golge = !!o.golge, hedefVar = o.hedef > 0, onde = o.konumFark >= 0;
  const toplam = o.puan != null ? o.puan : pu(o.hakEdis), orani = o.odemeOrani != null ? o.odemeOrani : o.verimlilik;
  const sk = o.sonrakiKademe, tabanAktif = o.hedefTaban > 0 && o.hedefYuzde >= 100;
  let h = '';
  // 1) ÜST ÖZET: toplam puan + hedef çubuğu + kademe
  h += '<div class="pm-kart pm-hero"><h4>' + esc(P.ayAdi(ay)) + ' · ' + SOZLUK.kazanilan + '</h4><div class="pm-buyuk">' + PN(toplam) + ' <span class="pm-bp">puan</span></div>'
    + '<div class="pm-alt">' + o.satisSayisi + ' teslim edilen satıştan' + (o.sira && o.kisiSayisi > 1 ? ' · ekipte <b>' + o.sira + '. sıra</b>' : '') + '</div>';
  if (hedefVar) {
    const yz = Math.min(100, o.hedefYuzde), bek = Math.min(100, o.beklenenKdvsiz / o.hedef * 100);
    h += '<div class="pm-hbar"><i style="width:' + yz + '%"></i><u style="left:calc(' + bek + '% - 1px)"></u></div>'
      + '<div class="pm-hb-yazi"><span>🎯 Hedef <b>' + PY(o.hedefYuzde) + '</b></span><span>' + (onde ? '<span class="pm-hiyi">' + TL(o.konumFark) + ' önde 👏</span>' : '<span class="pm-hkotu">' + TL(Math.abs(o.konumFark)) + ' geride</span>') + '</span></div>';
  }
  h += '<div class="pm-kademe"><div><span>⚡ Verimlilik</span><b>' + PY(o.verimlilik) + '</b></div><div><span>Puan çarpanın</span><b>' + PY(orani) + '</b></div></div>'
    + (tabanAktif ? '<div class="pm-alt pm-iyi2">🎉 Hedefini tamamladın: çarpanın en az ' + PY(o.hedefTaban) + ' kalır.</div>' : '')
    + (sk ? '<div class="pm-alt">👉 Bir sonraki kademeye <b>' + PY(sk.kalan) + '</b> kaldı: verimliliğin <b>' + PY(sk.esik) + '</b> olunca çarpanın <b>' + PY(sk.oran) + '</b> olur.</div>' : (o.verimlilik >= 1 && orani >= 100 ? '<div class="pm-alt pm-iyi2">🏆 En üst kademedesin!</div>' : ''))
    + (o.gorunumCarpani != null && Math.abs(o.gorunumCarpani - 100) > 0.05 ? '<div class="pm-alt">👁 Hizmet kalitesi performansı: <b>' + PY(o.gorunumCarpani) + '</b></div>' : '')
    + (golge ? '<div class="pm-rozet-golge">🧪 Deneme ayı: fazla indirim çarpanı bu ay uygulanmıyor, sadece bilgi için gösteriliyor.</div>' : '') + '</div>';
  // 2) BEKLEYEN PUAN (toplama KATILMAZ; soluk, ayrı)
  if (o.bekleyenAdet > 0 || o.bekleyenPuan > 0) {
    h += '<div class="pm-kart pm-bekle"><h4>⏳ ' + SOZLUK.bekleyen + '</h4><div class="pm-bb">≈ ' + PN(o.bekleyenPuan) + ' <small>puan</small></div>'
      + '<div class="pm-not">' + o.bekleyenAdet + ' satışın henüz teslim edilmedi. <b>Teslimden sonra kesinleşir</b>; toplam puanına ancak o zaman eklenir.</div>'
      + (o.bekleyenSatirlar && o.bekleyenSatirlar.length ? '<div class="pm-satlar">' + o.bekleyenSatirlar.map(x => satirHtml({ ...x, r: [] }, true)).join('') + '</div>' : '') + '</div>';
  }
  // 3) SATIŞ BAZLI SKOR ÖZETİ
  if (o.satirlar && o.satirlar.length) {
    h += '<div class="pm-kart"><h4>Satış satış skorun</h4><div class="pm-satlar">' + o.satirlar.map(x => satirHtml(x, false)).join('') + '</div>'
      + (o.satisSayisi > o.satirlar.length ? '<div class="pm-not">Son ' + o.satirlar.length + ' satış gösteriliyor.</div>' : '') + '<div class="pm-ipucu">Satır puanları, çarpanların uygulanmış halidir. 🔥 yüksek puanlı · ⭐ özel ürün · 🛠 yönetici düzeltmesi.</div></div>';
  } else if (o.satisSayisi > 0) h += '<div class="pm-kart"><h4>Satış satış skorun</h4><div class="pm-not">Satış listesi bir sonraki güncellemede görünecek.</div></div>';
  // 4) DETAYLAR (açılır)
  const b = pu(o.brutPrim), ind = pu(o.indirimEtkisi), gor = pu(o.onayKesinti), kes = pu(o.kesinPrim), ver = toplam - b - ind - gor - kes;
  const oranKayip = Math.round((b + ind) * (1 - Math.min(100, Math.max(0, Number(o.verimlilik) || 0)) / 100));   // verimlilik oranına göre kesilecek olan (barem yumuşatmadan önce) → üstü çizili gösterilir
  h += '<details class="pm-det"><summary>Puanım nasıl hesaplandı?</summary><div class="pm-sel">'
    + '<div><span>1. Satışlarından elde edilen</span><b>' + PN(b) + '</b></div>'
    + '<div class="' + (ind < 0 ? 'eksi' : '') + '"><span>2. İndirim aşımından kaybedilen' + (golge ? ' <small>(deneme: uygulanmıyor)</small>' : '') + '</span><b>' + PNI(ind) + '</b></div>'
    + '<div class="' + (ver < 0 ? 'eksi' : '') + '"><span>3. Verimlilik (' + PY(o.verimlilik) + ') kaybı</span><b>' + (oranKayip > Math.abs(ver) && ver < 0 ? '<s class="pm-ust">' + PNI(-oranKayip) + '</s> ' : '') + PNI(ver) + '</b></div>'
    + (gor ? '<div class="' + (gor < 0 ? 'eksi' : 'arti') + '"><span>4. Hizmet kalitesi performansı ' + PY(o.gorunumCarpani != null ? o.gorunumCarpani : 100) + '</span><b>' + PNI(gor) + '</b></div>' : '')
    + (kes > 0 ? '<div><span>Yönetici tarafından belirlenen (aynen eklenir)</span><b>' + PNI(kes) + '</b></div>' : '')
    + '<div class="son"><span>Toplam</span><b>' + PN(toplam) + ' puan</b></div></div>'
    + (o.duzeltmeSayisi > 0 ? '<div class="pm-ipucu">🛠 <b>' + o.duzeltmeSayisi + '</b> satışının puanı yönetici tarafından düzeltildi: ' + (o.duzeltmeler || []).map(x => esc(x.saleNo) + ' ' + PN(pu(x.once)) + ' → ' + PN(pu(x.yeni)) + (x.neden ? ' (' + esc(x.neden) + ')' : '')).join(' · ') + '</div>' : '')
    + (o.ekstraPrim > 0 ? '<div class="pm-ipucu">⭐ Puanına <b>' + PN(pu(o.ekstraPrim)) + '</b> özel ürün puanı dahil.</div>' : '') + '</details>';
  // 5) HEDEF + VERİMLİLİK + İNDİRİM + SIRA (açılır)
  let d2 = '';
  if (hedefVar) d2 += '<div class="pm-alt2"><b>Hedefin:</b> şu ana kadar ' + TL(o.kdvsiz) + ' / ' + TL(o.hedef) + ' (' + PY(o.hedefYuzde) + '). Bugün olman gereken ' + TL(o.beklenenKdvsiz) + '. '
    + (o.hedefYuzde < 100 ? 'Hedefe ulaşmak için günde yaklaşık <b>' + TL(o.gunlukGereken) + '</b> satış gerekiyor (' + o.kalanGun + ' gün kaldı).' : '<b class="pm-iyi">Hedefi tamamladın! 🎉</b>') + '<br><small>Tutarlar KDV hariç; satış, ürün müşteriye <b>teslim edildiğinde</b> sayılır.</small></div>';
  else d2 += '<div class="pm-alt2"><b>Hedefin:</b> bu ay için henüz girilmemiş. Teslim edilen satışın: ' + TL(o.kdvsiz) + ' (KDV hariç).</div>';
  const a = AYAR.verimlilik.hedef, b2 = AYAR.verimlilik.nitelikli, pa = Math.min(100, o.hedefYuzde) * a, pb = o.nitelikliYuzde * b2;
  d2 += '<div class="pm-alt2"><b>Verimliliğin ' + PY(o.verimlilik) + ':</b> hedef ' + PY(Math.min(100, o.hedefYuzde)) + ' × ' + String(a).replace('.', ',') + ' = ' + (Math.round(pa * 10) / 10).toLocaleString('tr-TR') + ' · nitelikli satış ' + PY(o.nitelikliYuzde) + ' × ' + String(b2).replace('.', ',') + ' = ' + (Math.round(pb * 10) / 10).toLocaleString('tr-TR') + '<br><small>💡 <b>Nitelikli</b> = beyaz eşya, klima, ankastre, küçük ev aletleri, aksesuar ve sigorta. Telefon/TV satarken yanına ekran koruyucu, aksesuar veya sigorta eklemek verimliliğini artırır.</small></div>';
  const ustte = o.indirimOrani > o.ekipIndirimOrani + 0.05;
  d2 += '<div class="pm-alt2"><b>İndirimin:</b> senin ' + PY(o.indirimOrani) + ' · ekip ortalaması ' + PY(o.ekipIndirimOrani) + '. ' + (ustte ? '<span class="pm-kotu">Ekip ortalamasının üstündesin;</span> puanların yaklaşık <b>×' + String(o.katsayi).replace('.', ',') + '</b> ile çarpılır' + (golge ? ' (deneme ayında uygulanmıyor).' : '.') : '<span class="pm-iyi">Ekip ortalamasının altındasın 👍</span>') + '<br><small>Yalnız senin verdiğin indirim sayılır; sistemin kampanya indirimleri hesabına yazılmaz.</small></div>';
  if (o.kisiSayisi > 1) d2 += '<div class="pm-alt2"><b>Ekipte yerin:</b> ' + o.sira + '. / ' + o.kisiSayisi + ' kişi · ekip ortalaması: hedef ' + PY(o.ekipOrtHedefYuzde) + ', verimlilik ' + PY(o.ekipOrtVerimlilik) + '. Lider (' + esc(o.liderBas || '—') + ') hedefinin ' + PY(o.liderHedefYuzde) + '\'ine ulaştı.<br><small>Kimsenin puanı görünmez; yalnız sıran ve ekip ortalaması gösterilir.</small></div>';
  h += '<details class="pm-det"><summary>Hedef, verimlilik ve indirim detayı</summary>' + d2 + '</details>';
  return h;
}
// ── Ekran görüntüsü CAYDIRMA (engellemez; "kimden çıktığı görünür" yapar) ──
let wmZ = null;
const wmMetin = () => { const u = kullanici() || {}, d = new Date(); return String(u.Ad || u.Email || '').slice(0, 28) + ' · ' + d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); };
function filigranYenile() {
  const m = $('prim-puan'); if (!m) return; let w = $('pm-wm');
  if (!w) { w = document.createElement('div'); w.id = 'pm-wm'; w.className = 'pm-wm'; w.setAttribute('aria-hidden', 'true'); m.appendChild(w); }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="150"><text x="125" y="75" transform="rotate(-24 125 75)" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="700" fill="#808080" fill-opacity="0.34">' + esc(wmMetin()) + '</text></svg>';
  w.style.backgroundImage = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
}
const bulaniklastir = v => { const m = $('prim-puan'); if (m) m.classList.toggle('pm-blur', !!v); };
function korumaBagla() {
  if (korumaBagla.ok) return; korumaBagla.ok = true;
  document.addEventListener('visibilitychange', () => bulaniklastir(document.hidden));
  W.addEventListener('blur', () => bulaniklastir(true)); W.addEventListener('focus', () => bulaniklastir(false)); W.addEventListener('pageshow', () => bulaniklastir(false));
  document.addEventListener('keydown', e => { const m = $('prim-puan'); if (m && m.classList.contains('on') && (e.key === 'PrintScreen' || (e.key === 'p' && (e.ctrlKey || e.metaKey)))) { bulaniklastir(true); setTimeout(() => bulaniklastir(false), 1800); } });
  document.addEventListener('contextmenu', e => { const m = $('prim-puan'); if (m && m.classList.contains('on') && m.contains(e.target)) e.preventDefault(); });
}
export async function ekranYenile(zorla) {
  const g = $('pm-icerik'); if (!g || yukleniyor) return; yukleniyor = true;
  const ay = seciliAy || bugunAy();
  g.innerHTML = '<div class="pm-bos">⏳ Yükleniyor…</div>';
  const o = await ozetYukle(ay, zorla); yukleniyor = false;
  const ust = '<div class="pm-ust"><span>' + (o && o.guncelleme ? 'Son güncelleme: ' + esc(new Date(o.guncelleme).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })) : 'Henüz hesap yok') + '</span><button type="button" id="pm-yenile">↻ Yenile</button></div>';
  g.innerHTML = ust + ekranHtml(o, ay); filigranYenile();
  const y = $('pm-yenile'); if (y) y.onclick = () => { if (Date.now() - (ekranYenile._son || 0) < 20000) return; ekranYenile._son = Date.now(); ekranYenile(true); };
  document.querySelectorAll('#pm-aylar button').forEach(bt => bt.classList.toggle('on', bt.dataset.ay === ay));
}
export function ac() {
  cssEkle(); ayarYukle(false); korumaBagla();
  let m = $('prim-puan');
  if (!m) {
    m = document.createElement('div'); m.id = 'prim-puan'; m.className = 'pm-ov';
    m.innerHTML = '<div class="pm-sheet"><div class="pm-head"><h3>🏆 ' + SOZLUK.ekran + '</h3><button type="button" class="pm-x" id="pm-kapat">✕</button></div><div class="pm-aylar" id="pm-aylar"></div><div class="pm-body" id="pm-icerik"></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) kapat(); });
    $('pm-kapat').onclick = kapat;
  }
  const b = bugunAy(), o = oncekiAy(b); seciliAy = b;
  $('pm-aylar').innerHTML = '<button type="button" data-ay="' + b + '">Bu ay</button><button type="button" data-ay="' + o + '">Geçen ay</button>';
  $('pm-aylar').querySelectorAll('button').forEach(bt => { bt.onclick = () => { seciliAy = bt.dataset.ay; ekranYenile(false); }; });
  m.classList.add('on'); document.body.style.overflow = 'hidden'; filigranYenile(); clearInterval(wmZ); wmZ = setInterval(filigranYenile, 30000);
  ekranYenile(false);
}
export function kapat() { const m = $('prim-puan'); if (m) { m.classList.remove('on'); m.classList.remove('pm-blur'); } document.body.style.overflow = ''; clearInterval(wmZ); }

// ── Alt çubuk düğmesi ──
function dugme() {
  const var_ = !!kullanici() && personelMi() && AYAR.personelEkran === true;
  let b = $('tab-btn-puan');
  if (!var_) { if (b) b.style.display = 'none'; return; }
  if (!b) {
    const ref = $('tab-btn-mystats') || $('tab-btn-teklifler'); if (!ref) return;
    b = document.createElement('button'); b.className = 'tab-btn'; b.id = 'tab-btn-puan'; b.title = SOZLUK.ekran;
    b.innerHTML = '<span class="tab-icon">🏆</span><span class="tab-label">' + SOZLUK.menu + '</span>'; b.onclick = () => ac();
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
  const pk = ozetSenkron() && ozetSenkron().puanKatsayisi > 0 ? ozetSenkron().puanKatsayisi : puanKat();
  let h = '<div class="pk-ust"><span>💡 ' + SOZLUK.koc + '</span><span>' + SOZLUK.sepetTahmin + ': <b>' + PN(PUAN(kc.brutPrim, pk)) + ' puan</b></span></div>'
    + '<div>Nitelikli satış oranı: <b>' + PY(kc.nitelikliYuzde) + '</b></div>';
  if (kc.ekstraPrim > 0) h += '<div>⭐ Bu sepette ' + SOZLUK.ozelUrun + ' var: <b>+' + PN(PUAN(kc.ekstraPrim, pk)) + ' puan</b></div>';
  if (kc.oneri) {
    const o = kc.oneri;
    h += '<div class="pk-oneri">Sepette telefon/TV gibi nitelikli sayılmayan ürün var. Yanına yaklaşık <b>' + TL(o.tutar) + '</b>\'lik ekran koruyucu, aksesuar veya sigorta eklersen nitelikli oran <b>' + PY(kc.nitelikliYuzde) + ' → ' + PY(o.nitelikliYuzdeSonra) + '</b> olur, '
      + (o.kaynak === 'ay' ? 'aylık verimliliğin' : 'verimliliğin') + ' <b>+' + (Math.round(o.verimlilikArtis * 10) / 10).toLocaleString('tr-TR') + ' yüzde puan</b> artar' + (o.primArtis > 0 ? ' (≈ +' + PN(PUAN(o.primArtis, pk)) + ' puan)' : '') + '.</div>';
  } else if (kc.nitelikliYuzde >= 99.5) h += '<div class="pk-iyi">Harika! Sepetin tamamen nitelikli ürünlerden oluşuyor ✅</div>';
  el.innerHTML = h;
}

// ── Vitrin rozeti: ürün satırında "⭐ +25 puan" ──
let rozetOnbellek = { gun: '', harita: {}, ayarZ: 0 };
const kisaTarih = g => { const m = String(g || '').match(/^\d{4}-(\d\d)-(\d\d)$/); return m ? Number(m[2]) + ' ' + ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'][Number(m[1]) - 1] : ''; };
export function rozet(kod) {
  if (!AYAR.ekstra || !AYAR.ekstra.length) return '';
  const gun = P.gunStr(Date.now());
  if (rozetOnbellek.gun !== gun || rozetOnbellek.ayarZ !== ayarZaman) rozetOnbellek = { gun, harita: P.aktifEkstralar(AYAR, gun), ayarZ: ayarZaman };
  const l = rozetOnbellek.harita[String(kod).trim()]; if (!l) return '';
  const t = l.reduce((a, x) => a + x.tutar, 0), bit = l.map(x => x.bit).filter(Boolean).sort()[0] || '';
  return '<span class="pm-rozet" title="' + esc(l.map(x => x.ad).filter(Boolean).join(', ') || SOZLUK.rozetBaslik) + '">' + esc(SOZLUK.rozet(PN(PUAN(t)), bit ? kisaTarih(bit) : '')) + '</span>';
}
// Vitrin ürün düğmesindeki sayı (Excel'deki ₺ değer → puan): app.js buradan çağırır; katsayı 1 yapılırsa eski görünüm
export const puanYaz = v => PUAN(v);

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

W.Prim = { damga: damgala, ayar, ayarYukle, baslat, sepetKocluk, rozet, ac, kapat, sozluk: SOZLUK, puan: puanYaz, versiyon: 'V12.6' };
// Modül yüklendiğinde oturum zaten açıksa (sayfa yenileme) otomatik başlat
setTimeout(() => { try { baslat(); } catch (_e) { /* yoksay */ } }, 2500);
