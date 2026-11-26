// ═══════════════════════════════════════════════════════════════
//  V12.15 — PERFORMANSIM (satış / destek ekranı) · yeni düzen
//   Kaynak: yöneticinin yayınladığı tek doküman meta/analizPaylasim (açılışta 1 okuma, 10 dk önbellek).
//   İçerik: kendi satış adedi (bugün / hafta / 30 gün), ekip içindeki yeri, sepet; ürün & fiyat önerileri.
//   Not  : kişisel prim/ciro bu ekranda yok; ekip arkadaşlarının yalnız ilk adı ve satış adedi görünür.
// ═══════════════════════════════════════════════════════════════
const W = window, $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const N = v => Math.round(Number(v) || 0).toLocaleString('tr-TR');
const TL = v => '₺' + N(v);
const S = { dönem: 'hafta', veri: null, t: 0, hata: '', yuk: false, acik: {} };

async function yukle(zorla) {
  if (!zorla && S.veri && Date.now() - S.t < 600000) return;
  const b = W._svkBridge; if (!b) throw new Error('Bağlantı hazır değil');
  const sn = await b.getDoc(b.doc(b.db, 'meta', 'analizPaylasim'));
  S.veri = sn.exists() ? sn.data() : null; S.t = Date.now();
}
const ben = () => { try { return String((W._svkBridge.user() || {}).Email || '').toLowerCase(); } catch (_e) { return ''; } };
const sayi = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const kisiDeg = (k, d) => sayi(d === 'bugun' ? k.bugun : d === 'hafta' ? k.hafta : k.ay);
const oncekiDeg = (k, d) => d === 'hafta' ? sayi(k.haftaOnceki) : d === 'ay' ? sayi(k.onceki) : null;

function fark(a, b) { if (b == null) return ''; if (!b) return a ? '<span class="pf-d up">▲ yeni</span>' : ''; const p = Math.round((a - b) / b * 100); return '<span class="pf-d ' + (p >= 0 ? 'up' : 'dn') + '">' + (p >= 0 ? '▲' : '▼') + ' %' + Math.abs(p) + '</span>'; }
function liste(anahtar, arr, satir, ilk) { const ac = S.acik[anahtar]; const g = ac ? arr : arr.slice(0, ilk || 5); return g.map(satir).join('') + (arr.length > (ilk || 5) ? '<button class="pf-more" data-pf-ac="' + anahtar + '">' + (ac ? 'Daha az göster' : 'Tümünü göster (' + arr.length + ')') + '</button>' : ''); }
const kart = (bas, ic, not, n) => '<section class="pf-card"><div class="pf-ch">' + bas + (n != null ? '<b>' + n + '</b>' : '') + '</div>' + ic + (not ? '<div class="pf-not">' + not + '</div>' : '') + '</section>';
const sat = (ad, sag) => '<div class="pf-ur"><span>' + esc(ad) + '</span><span>' + sag + '</span></div>';

function cizim() {
  const kok = $('mystats-body'); if (!kok) return;
  if (S.yuk && !S.veri) { kok.innerHTML = '<div class="mystats-loading">⏳ Yükleniyor…</div>'; return; }
  if (S.hata) { kok.innerHTML = '<div class="pf-bos">⚠️ ' + esc(S.hata) + '<br><button class="pf-chip" data-pf-yenile="1">Tekrar dene</button></div>'; return; }
  const V = S.veri;
  if (!V) { kok.innerHTML = '<div class="pf-bos">📊 Performans özeti henüz yayınlanmadı.<br><small>Yönetici analizi yayınlayınca burada görünür.</small></div>'; return; }
  const me = ben(), d = S.dönem, kisiler = (V.kisiler || []).slice();
  const k = kisiler.find(x => x.e === me) || { a: '', bugun: 0, hafta: 0, ay: 0, onceki: 0, haftaOnceki: 0, sepet: 0, kalem: 0 };
  const sirali = kisiler.slice().sort((a, b) => kisiDeg(b, d) - kisiDeg(a, d));
  const sira = sirali.findIndex(x => x.e === me) + 1, n = sirali.length;
  const ort = n ? sirali.reduce((a, x) => a + kisiDeg(x, d), 0) / n : 0, mx = Math.max(1, ...sirali.map(x => kisiDeg(x, d)));
  const dl = { bugun: 'Bugün', hafta: 'Son 7 gün', ay: 'Son 30 gün' }[d];
  let h = '<div class="pf-seg">' + [['bugun', 'Bugün'], ['hafta', 'Hafta'], ['ay', '30 gün']].map(([a, e]) => '<button class="pf-chip' + (d === a ? ' on' : '') + '" data-pf-d="' + a + '">' + e + '</button>').join('') + '</div>';
  h += '<div class="pf-hero"><div class="pf-hl">' + dl + ' · satış adedim</div><div class="pf-hv">' + N(kisiDeg(k, d)) + '</div><div class="pf-hs">' + fark(kisiDeg(k, d), oncekiDeg(k, d)) + (oncekiDeg(k, d) != null ? '<span>önceki dönem: ' + N(oncekiDeg(k, d)) + '</span>' : '') + '</div></div>';
  h += '<div class="pf-grid"><div class="pf-k"><small>Sıram</small><b>' + (sira ? N(sira) + ' / ' + N(n) : '—') + '</b></div><div class="pf-k"><small>Ekip ortalaması</small><b>' + (Math.round(ort * 10) / 10) + '</b></div><div class="pf-k"><small>Ort. sepet (30 gün)</small><b>' + (k.sepet ? TL(k.sepet) : '—') + '</b></div><div class="pf-k"><small>Ürün / satış</small><b>' + (sayi(k.kalem) || '—') + '</b></div></div>';
  h += kart('👥 Ekipte durumum', sirali.slice(0, 6).map((x, i) => '<div class="pf-br' + (x.e === me ? ' me' : '') + '"><span class="pf-bn">' + (i + 1) + '. ' + esc(x.a) + (x.e === me ? ' (ben)' : '') + '</span><div class="pf-bt"><i style="width:' + Math.max(3, Math.round(kisiDeg(x, d) / mx * 100)) + '%"></i></div><b>' + kisiDeg(x, d) + '</b></div>').join(''), 'Satış adedine göre. Tutar ve prim bilgisi ekip içinde paylaşılmaz.');
  const dz = a => (Array.isArray(a) ? a : []).slice(0, 20), sess = dz(V.sessiz), don = dz(V.donen), olu = dz(V.olu), cok = dz(V.cok);
  h += '<div class="pf-bas">Bu dönemde neyi öne çıkarmalıyım?</div>';
  h += kart('🧊 Önce bunları öner (hareketsiz stok)', olu.length ? liste('olu', olu, u => sat(u.ad, 'Stok ' + N(u.stok) + ' · ' + TL(u.nakit)), 5) : '<div class="pf-bos s">Şu an öne çıkan hareketsiz stok yok</div>', 'Uzun süredir ne bakılmış ne satılmış, stoğu duran ürünler. Müşteriye alternatif olarak sen göster.', sayi(V.oluToplam) || olu.length);
  h += kart('💎 Az bakılıyor ama alan memnun', sess.length ? liste('sessiz', sess, u => sat(u.ad, '✅ ' + N(u.adet) + ' satış'), 5) : '<div class="pf-bos s">—</div>', 'Müşteri kendiliğinden sormuyor; sen önerirsen satılıyor.', sess.length);
  h += kart('🔥 Çok bakılıyor, az satılıyor', don.length ? liste('donen', don, u => sat(u.ad, '👁 ' + N(u.blur) + ' · ✅ ' + N(u.adet) + (u.nakit ? ' · ' + TL(u.nakit) : '')), 5) : '<div class="pf-bos s">—</div>', 'İlgi var, ikna eksik: taksit, hediye veya benzer ürünle konuşmayı ilerlet.', don.length);
  h += kart('🏆 Çok satanlar', cok.length ? liste('cok', cok, u => sat(u.ad, '✅ ' + N(u.adet)), 5) : '<div class="pf-bos s">—</div>', 'Stoğu ve fiyatı hazır tut; yanında aksesuar öner.');
  const dt = sayi(V.t) ? new Date(sayi(V.t)).toLocaleString('tr-TR', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
  h += '<div class="pf-not" style="text-align:center;margin-top:10px">Güncelleme: ' + esc(dt) + ' · ' + esc(String(V.bas || '').slice(0, 10)) + ' – ' + esc(String(V.bit || '').slice(0, 10)) + '</div>';
  kok.innerHTML = h;
}

const CSS = `
#mystats-body .pf-seg{display:flex;gap:6px;margin-bottom:12px}
#mystats-body .pf-chip{flex:1;border:1px solid #e2e8f0;background:#fff;color:#334155;border-radius:999px;padding:8px 10px;font-size:.74rem;font-weight:700;cursor:pointer}
#mystats-body .pf-chip.on{background:#0f172a;border-color:#0f172a;color:#fbbf24}
#mystats-body .pf-hero{background:linear-gradient(160deg,#0f172a,#1e293b);color:#fff;border-radius:16px;padding:16px 18px;margin-bottom:10px}
#mystats-body .pf-hl{font-size:.64rem;text-transform:uppercase;letter-spacing:.05em;opacity:.7;font-weight:700}
#mystats-body .pf-hv{font-size:2.4rem;font-weight:800;line-height:1.1;margin:4px 0;color:#fbbf24}
#mystats-body .pf-hs{font-size:.68rem;display:flex;gap:8px;align-items:center;opacity:.9}
#mystats-body .pf-d{font-weight:800;padding:1px 7px;border-radius:6px;font-size:.64rem}
#mystats-body .pf-d.up{background:rgba(34,197,94,.22);color:#4ade80}
#mystats-body .pf-d.dn{background:rgba(239,68,68,.25);color:#f87171}
#mystats-body .pf-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px}
#mystats-body .pf-k{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px}
#mystats-body .pf-k small{display:block;font-size:.58rem;text-transform:uppercase;letter-spacing:.04em;color:#64748b;font-weight:700}
#mystats-body .pf-k b{font-size:1.05rem;color:#0f172a}
#mystats-body .pf-bas{font-size:.8rem;font-weight:800;margin:14px 2px 8px;color:#0f172a}
#mystats-body .pf-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px 14px;margin-bottom:10px}
#mystats-body .pf-ch{display:flex;justify-content:space-between;align-items:center;font-size:.76rem;font-weight:800;margin-bottom:8px;color:#0f172a}
#mystats-body .pf-ch b{background:#f1f5f9;border-radius:999px;padding:1px 9px;font-size:.66rem;color:#334155}
#mystats-body .pf-not{font-size:.62rem;color:#64748b;margin-top:8px;line-height:1.45}
#mystats-body .pf-ur{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:.7rem}
#mystats-body .pf-ur span:first-child{font-weight:600;color:#0f172a}
#mystats-body .pf-ur span:last-child{white-space:nowrap;color:#475569}
#mystats-body .pf-more{margin-top:6px;border:0;background:none;color:#2563eb;font-size:.68rem;font-weight:700;cursor:pointer;padding:4px 0}
#mystats-body .pf-bos{text-align:center;color:#64748b;font-size:.76rem;padding:22px 8px;line-height:1.6}
#mystats-body .pf-bos.s{padding:6px;font-size:.7rem}
#mystats-body .pf-br{display:grid;grid-template-columns:minmax(90px,36%) 1fr 28px;gap:8px;align-items:center;font-size:.7rem;padding:4px 0}
#mystats-body .pf-br.me .pf-bn{font-weight:800;color:#b45309}
#mystats-body .pf-bn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#mystats-body .pf-bt{height:8px;background:#f1f5f9;border-radius:999px;overflow:hidden}
#mystats-body .pf-bt i{display:block;height:100%;background:#d4a017;border-radius:999px}
#mystats-body .pf-br.me .pf-bt i{background:#0f172a}
#mystats-body .pf-br b{text-align:right}
`;
function stil() { if ($('pf-css')) return; const s = document.createElement('style'); s.id = 'pf-css'; s.textContent = CSS; document.head.appendChild(s); }

function olay(e) {
  const t = e.target.closest('[data-pf-d],[data-pf-ac],[data-pf-yenile]'); if (!t) return; const d = t.dataset;
  if (d.pfD) { S.dönem = d.pfD; cizim(); }
  else if (d.pfAc) { S.acik[d.pfAc] = !S.acik[d.pfAc]; cizim(); }
  else if (d.pfYenile) ac(true);
}
async function ac(zorla) {
  const kok = $('mystats-body'); if (!kok) return false;
  stil();
  if (!kok.dataset.pfBagli) { kok.addEventListener('click', olay); kok.dataset.pfBagli = '1'; }
  S.hata = ''; S.yuk = true; cizim();
  try { await yukle(!!zorla); } catch (e) { S.hata = 'Veri çekilemedi: ' + (e && e.message); }
  S.yuk = false; cizim(); return true;
}
W.Performans = { ac, versiyon: 'V12.15' };
