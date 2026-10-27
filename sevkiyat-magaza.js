// ═══════════════════════════════════════════════════════════════
//  V11.23 — MAĞAZA ÖN TANIMI
//  · İlk girişten sonra tek soru: "Hangi mağazadasınız?" (depo kullanıcısına: "Hangi depodasınız?"). Admin: soru yok (Tümü).
//  · Seçim kullanıcı + cihaz bazında localStorage'da; çıkışta silinmez. Üst bardaki "📍 Sp Mağaza ▾" etiketiyle değiştirilir.
//  · Liste, sevkiyat tanımlarındaki (admin düzenler) depo/mağaza adlarından gelir; "Depo" ile bitenler depo, diğerleri mağazadır.
//  · Mağaza adının ilk kelimesi (Sp, Nf, Vş, SÇ) satış noktası listesindeki kodla eşleşirse satış noktası otomatik dolar.
//  · Süzgeç düzen içindir; Firebase Auth olmadığından güvenlik değildir.
// ═══════════════════════════════════════════════════════════════
import { DEPOLAR, SATIS_NOKTALARI, tanimYukle, tanimDegisti, rol, eposta, esc } from './sevkiyat-veri.js?v=V11.31-20261026-2101';

const trU = s => String(s || '').toLocaleUpperCase('tr');
const depoMu = a => /depo\s*$/i.test(String(a));
const anahtar = () => 'svk_magaza_' + eposta().toLowerCase();
const dinleyiciler = [];
let soruAcik = false;

// 'magaza' | 'depo' | '' (admin / oturum yok → seçim yok)
export function kapsam() { const r = rol(); return r === 'satis' ? 'magaza' : r === 'destek' ? 'depo' : ''; }
export function liste() { const k = kapsam(); return k ? DEPOLAR.filter(d => (k === 'depo') === depoMu(d)) : []; }
export function secili() {
  if (!kapsam() || !eposta()) return '';
  let v = ''; try { v = localStorage.getItem(anahtar()) || ''; } catch (_e) { /* yoksay */ }
  return liste().includes(v) ? v : '';
}
// Seçili mağazanın satış noktası kodu (eşleşme yoksa '')
export function nokta() {
  const m = secili(); if (kapsam() !== 'magaza' || !m) return '';
  const ilk = trU(m.trim().split(/\s+/)[0]);
  return SATIS_NOKTALARI.find(x => trU(x) === ilk) || '';
}
export const onDegis = f => dinleyiciler.push(f);
const duyur = () => dinleyiciler.forEach(f => { try { f(); } catch (_e) { /* yoksay */ } });

function kaydet(ad) {
  try { localStorage.setItem(anahtar(), ad); } catch (_e) { /* yoksay */ }
  const nk = nokta(); if (nk) { try { localStorage.setItem('svk_nokta', nk); } catch (_e) { /* yoksay */ } }
  etiketGuncelle(); duyur();
}

const CSS = '#svk-mg-etiket{background:rgba(120,120,130,.18);color:inherit;border:0;border-radius:14px;padding:5px 10px;font:600 .78rem system-ui,sans-serif;cursor:pointer;margin-right:8px;white-space:nowrap}' +
  '#svk-mg-ov{position:fixed;inset:0;z-index:100000;background:rgba(15,16,20,.72);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif}' +
  '#svk-mg-ov .kt{background:#F2F3F6;border-radius:18px;width:100%;max-width:380px;max-height:90vh;overflow:auto;padding:20px 16px 16px;color:#16171B}' +
  '#svk-mg-ov h2{margin:0 0 4px;font-size:1.2rem}#svk-mg-ov p{margin:0 0 12px;color:#7B8394;font-size:.82rem}' +
  '#svk-mg-ov button.mg{display:block;width:100%;text-align:left;background:#fff;border:2px solid #E4E7ED;border-radius:14px;padding:16px;margin:8px 0;font:700 1.05rem system-ui,sans-serif;color:#16171B;cursor:pointer}' +
  '#svk-mg-ov button.mg.on{border-color:#C8102E;background:#fff1f3}' +
  '#svk-mg-ov button.vz{display:block;margin:10px auto 0;background:none;border:0;color:#7B8394;font:600 .85rem system-ui,sans-serif;padding:8px;cursor:pointer}';
function stil() {
  if (document.getElementById('svk-mg-stil')) return;
  const s = document.createElement('style'); s.id = 'svk-mg-stil'; s.textContent = CSS; document.head.appendChild(s);
}

export function sor(zorunlu) {
  const k = kapsam(), l = liste(); if (!k || !l.length || soruAcik) return;
  stil(); soruAcik = true;
  const ov = document.createElement('div'); ov.id = 'svk-mg-ov';
  const mevcut = secili();
  ov.innerHTML = '<div class="kt"><h2>' + (k === 'depo' ? 'Hangi depodasınız?' : 'Hangi mağazadasınız?') + '</h2><p>Bir kez seçin, bu cihazda hatırlanır. Üstteki 📍 etiketinden değiştirebilirsiniz.</p>' +
    l.map(d => '<button class="mg' + (d === mevcut ? ' on' : '') + '" data-d="' + esc(d) + '">' + (k === 'depo' ? '📦 ' : '🏬 ') + esc(d) + '</button>').join('') +
    (zorunlu ? '' : '<button class="vz" data-vz="1">Vazgeç</button>') + '</div>';
  const kapat = () => { ov.remove(); soruAcik = false; };
  ov.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) { if (!zorunlu && e.target === ov) kapat(); return; }
    if (b.dataset.vz) return kapat();
    if (b.dataset.d) { kapat(); kaydet(b.dataset.d); }
  });
  document.body.appendChild(ov);
}

function etiketGuncelle() {
  let e = document.getElementById('svk-mg-etiket');
  if (!kapsam() || !liste().length) { if (e) e.style.display = 'none'; return; }
  if (!e) {
    const hr = document.querySelector('header .header-right'); if (!hr) return;
    stil(); e = document.createElement('button'); e.id = 'svk-mg-etiket'; e.type = 'button';
    e.addEventListener('click', () => sor(false));
    hr.insertBefore(e, hr.firstChild);
  }
  e.style.display = '';
  e.textContent = '📍 ' + (secili() || (kapsam() === 'depo' ? 'Depo seç' : 'Mağaza seç')) + ' ▾';
}

// Giriş sonrası (ve açılışta oturum varsa) çağrılır; tekrar çağrılabilir
export async function baslat() {
  if (!eposta()) return;
  try { await tanimYukle(); } catch (_e) { /* yoksay */ }
  etiketGuncelle();
  if (kapsam() && liste().length && !secili()) sor(true);
  const nk = nokta(); if (nk) { try { localStorage.setItem('svk_nokta', nk); } catch (_e) { /* yoksay */ } }
  duyur();
}
tanimDegisti.push(() => { if (eposta()) { etiketGuncelle(); duyur(); } });
