// ═══════════════════════════════════════════════════════════════
//  V12.15 — ANALİZ (Admin → 📈 Analiz)  · yeni düzen
//   Kaynak  : CİRO / ADET = gerçek satışlar (sales + sevkiyat iptal/iade durumu)
//             Müşteri ilgisi (bakılan ürün, satışsız ayrılan, saat) = oturum kaydı (yalnız bu amaçla)
//   Sekmeler: Özet · Ürün & Fiyat · Personel · Zaman & Kaçan
//   Veri    : Firestore okuması tarih aralığı başına bir kez (15 dk önbellek); "Yenile" önbelleği atlar.
// ═══════════════════════════════════════════════════════════════
const W = window, $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const N = v => Math.round(Number(v) || 0).toLocaleString('tr-TR');
const TL = v => '₺' + N(v);
const r1 = v => Math.round(v * 10) / 10;
const kopru = () => W._svkBridge || null;
const Y = () => W.AnalizYardim || {};
const GUN = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const HAREKETSIZ = 'Hareketsizlik (Arka Plan)';

// ── tarih yardımcıları (İstanbul) ──
const bugunStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
const tarihEkle = (t, n) => { const d = new Date(t + 'T12:00:00+03:00'); d.setUTCDate(d.getUTCDate() + n); return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }); };
const gunFark = (a, b) => Math.round((new Date(b + 'T12:00:00+03:00') - new Date(a + 'T12:00:00+03:00')) / 86400000);
const tsTarih = ts => new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
const tsSaat = ts => (parseInt(new Date(ts).toLocaleString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false }), 10) || 0) % 24;
const haftaGunu = t => new Date(t + 'T12:00:00+03:00').getDay();
const tarihGoster = t => { const [y, m, d] = String(t).split('-'); return d + '.' + m + '.' + y; };

const D = { tip: '30', bas: '', bit: '', nokta: 'hepsi', sekme: 'ozet', gun: 'hepsi', stokEsik: 1000, acik: {} };
const onbellek = {};
let veri = null, yukleniyor = false, hata = '', istek = 0;

function aralikAyarla(tip) {
  const bg = bugunStr();
  D.tip = tip;
  if (tip === 'bugun') { D.bas = bg; D.bit = bg; }
  else if (tip === 'dun') { D.bas = tarihEkle(bg, -1); D.bit = D.bas; }
  else if (tip === 'ay') { D.bas = bg.slice(0, 8) + '01'; D.bit = bg; }
  else if (tip === 'tum') { D.bas = tarihEkle(bg, -364); D.bit = bg; }   // en fazla 1 yıl (okuma maliyeti)
  else if (tip !== 'ozel') { const n = parseInt(tip, 10) || 30; D.bas = tarihEkle(bg, -(n - 1)); D.bit = bg; }
}

// ── satış yardımcıları ──
const satisTutar = s => { const f = s && s.fiyat; if (f && f.odeme && Number(f.odeme.toplam) > 0) return Number(f.odeme.toplam) + (Number(f.disToplam) || 0); return Number(s && s.nakit) || 0; };
const kalemler = s => {
  const f = s && s.fiyat;
  if (f && Array.isArray(f.kalemler) && f.kalemler.length) return f.kalemler.map(k => ({ urun: String(k.urun || ''), kod: String(k.kod || ''), adet: Number(k.adet) > 0 ? Number(k.adet) : 1, liste: Number(k.liste) || 0, net: Number(k.net) || 0 }));
  return (s.urunler || []).map(u => { const l = Number(u.nakit || u.fiyat) || 0; return { urun: String(u.urun || ''), kod: String(u.kod || ''), adet: Number(u.adet) > 0 ? Number(u.adet) : 1, liste: l, net: Math.max(0, l - (Number(u.itemDisc) || 0)) }; });
};
const odemeTip = s => {
  const f = s.fiyat, t = f && f.odeme && f.odeme.tip ? String(f.odeme.tip) : '';
  const m = String(s.method || '').toLocaleLowerCase('tr-TR');
  if (t === 'nakit' || (!t && /nakit|havale|eft/.test(m))) return 'Nakit / Havale';
  if (/taksit|kredi|kart|vade/.test(t + ' ' + m)) return t === 'tek' || /tek çekim|tek cekim/.test(m) ? 'Kart · Tek çekim' : 'Kart · Taksit';
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Diğer';
};
const kisiAd = s => String(s.userAd || '').trim() || String(s.user || '—').split('@')[0];
const nokta = s => String(s.satisNoktasi || '').trim() || 'Belirtilmemiş';

// ── veri yükleme ──
async function yukle(force, C = D) {
  const b = kopru(); if (!b) throw new Error('Veri bağlantısı hazır değil');
  const uz = gunFark(C.bas, C.bit) + 1, oncBas = tarihEkle(C.bas, -uz), key = oncBas + '|' + C.bit;
  const o = onbellek[key];
  if (!force && o && Date.now() - o.t < 900000) return o;
  const bas = new Date(oncBas + 'T00:00:00+03:00'), son = new Date(tarihEkle(C.bit, 1) + 'T00:00:00+03:00');
  const [sn, sv] = await Promise.all([
    b.getDocs(b.query(b.collection(b.db, 'sales'), b.where('ts', '>=', bas.toISOString()), b.where('ts', '<', son.toISOString()))),
    b.getDocs(b.query(b.collection(b.db, 'sevkiyatlar'), b.where('ts', '>=', bas.getTime()), b.where('ts', '<', son.getTime()))).catch(() => null)
  ]);
  const svk = new Map(); if (sv) sv.docs.forEach(d => { const x = d.data(); svk.set(x.saleNo || d.id, x); });
  const hepsi = sn.docs.map(d => ({ ...d.data(), id: d.id })).filter(s => !s.tip || s.tip === 'satis');
  const gecerli = [], iptal = [];
  hepsi.forEach(s => { const x = svk.get(s.id); (x && (x.iptal || x.iade || x.silindi) ? iptal : gecerli).push(s); });
  let urunler = W._cachedUrunler || [];
  if (!urunler.length && Y().urunler) { try { urunler = await Y().urunler(); } catch (_e) { /* ürün listesi yok → stok/gam gösterilmez */ } }
  let oturum = [];
  if (Y().oturumlar) { try { oturum = await Y().oturumlar(C.bas, C.bit); } catch (_e) { oturum = []; } }
  const sonuc = { t: Date.now(), gecerli, iptal, urunler, oturum, oncBas };
  const ks = Object.keys(onbellek); if (ks.length >= 6) delete onbellek[ks.sort((x, y) => onbellek[x].t - onbellek[y].t)[0]];
  onbellek[key] = sonuc; return sonuc;
}

// ── hesaplar ──
function hesapla(ham, C = D) {
  const aralikta = (s, bas, bit) => { const t = tsTarih(s.ts); return t >= bas && t <= bit; };
  const nk = s => C.nokta === 'hepsi' || nokta(s) === C.nokta;
  const cur = ham.gecerli.filter(s => aralikta(s, C.bas, C.bit) && nk(s));
  const onc = ham.gecerli.filter(s => aralikta(s, ham.oncBas, tarihEkle(C.bas, -1)) && nk(s));
  const iptal = ham.iptal.filter(s => aralikta(s, C.bas, C.bit) && nk(s));
  const ozet = l => { const ciro = l.reduce((a, s) => a + satisTutar(s), 0), kalem = l.reduce((a, s) => a + kalemler(s).reduce((x, k) => x + k.adet, 0), 0); return { adet: l.length, ciro, sepet: l.length ? ciro / l.length : 0, kalem, kalemOrt: l.length ? kalem / l.length : 0 }; };
  const A = ozet(cur), B = ozet(onc);
  const noktalar = [...new Set(ham.gecerli.filter(s => aralikta(s, C.bas, C.bit)).map(nokta))].sort();
  const grup = (l, fn) => { const m = {}; l.forEach(s => { const k = fn(s); (m[k] = m[k] || []).push(s); }); return Object.entries(m).map(([k, v]) => ({ ad: k, ...ozet(v), liste: v })).sort((a, b) => b.ciro - a.ciro); };
  const odeme = grup(cur, odemeTip), mag = grup(cur, nokta), kisi = grup(cur, s => String(s.user || '—').toLowerCase());
  kisi.forEach(k => { k.gorunen = kisiAd(k.liste[0]); k.eposta = k.ad; });
  // günlük
  const gunluk = {}; for (let t = C.bas, i = 0; t <= C.bit && i < 800; t = tarihEkle(t, 1), i++) gunluk[t] = 0;
  cur.forEach(s => { const t = tsTarih(s.ts); gunluk[t] = (gunluk[t] || 0) + satisTutar(s); });
  // ürün
  const urunBilgi = {}; (ham.urunler || []).forEach(p => { const kod = String(p.Kod || p.kod || ''); if (kod) urunBilgi[kod] = { ad: p.Ürün || p.Urun || p['Ürün Adı'] || '', gam: p['Ürün Gamı'] || p['Urun Gami'] || '', stok: Number(p.Stok || p.stok || 0), nakit: parseFloat(p.Nakit || p.nakit || 0) || 0 }; });
  const urunAd = (ham.urunler || []).reduce((m, p) => { const keys = Object.keys(p), uk = keys.find(k => /^[uü]r[uü]n$/i.test(k)); const kod = String(p.Kod || p.kod || ''); if (uk && p[uk] && kod) m[kod] = p[uk]; return m; }, {});
  const urun = {}; let topListe = 0, topNet = 0;
  cur.forEach(s => kalemler(s).forEach(k => {
    const key = k.urun || k.kod; if (!key) return;
    const u = urun[key] = urun[key] || { ad: key, kod: k.kod, adet: 0, ciro: 0, liste: 0, blur: 0 };
    u.adet += k.adet; u.ciro += k.net; u.liste += k.liste; topListe += k.liste; topNet += k.net;
  }));
  const gamOf = kod => (urunBilgi[kod] && urunBilgi[kod].gam) || '';
  const gam = {}; cur.forEach(s => kalemler(s).forEach(k => { const g = gamOf(k.kod) || 'Diğer'; gam[g] = gam[g] || { ad: g, adet: 0, ciro: 0 }; gam[g].adet += k.adet; gam[g].ciro += k.net; }));
  // oturum (yalnız saha/satış rolü)
  const hr = Y().haric ? Y().haric() : [], hariciMi = ad => Y().haricMi ? Y().haricMi(ad, hr) : false;
  const logs = (ham.oturum || []).filter(l => (l.funnelRol || 'saha') === 'saha');
  let oturumN = 0, satissiz = 0; const nedenler = {}; let nedenYok = 0;
  logs.forEach(l => {
    if (l._isAggregate) {
      oturumN += l._oturumSayisi || 0; satissiz += l._kacti || 0;
      let say = 0; Object.entries(l._kacisNedenleri || {}).forEach(([n, c]) => { say += c; if (n !== 'Belirtilmedi' && n !== HAREKETSIZ) nedenler[n] = (nedenler[n] || 0) + c; else nedenYok += c; });
      nedenYok += Math.max(0, (l._kacti || 0) - say);
      (l._topBlurUrunler || []).forEach(x => { if (x && x.urun) { const u = urun[x.urun] = urun[x.urun] || { ad: x.urun, kod: '', adet: 0, ciro: 0, liste: 0, blur: 0 }; u.blur += Number(x.sayi || x.blur || x.n || 1) || 1; } });
    } else {
      oturumN++;
      const hareketsiz = l.sonuc === 'kacti' && l.neden === HAREKETSIZ;
      if (l.sonuc === 'kacti' && !hareketsiz) { satissiz++; if (l.neden && l.neden !== 'Belirtilmedi') nedenler[l.neden] = (nedenler[l.neden] || 0) + 1; else nedenYok++; }
      (l.blurUrunListesi || l.bakilanFiyatlar || []).forEach(a => { if (!a) return; const u = urun[a] = urun[a] || { ad: a, kod: '', adet: 0, ciro: 0, liste: 0, blur: 0 }; u.blur++; });
    }
  });
  // ürün karar grupları
  const liste = Object.values(urun).filter(u => !hariciMi(u.ad));
  const blurler = liste.map(u => u.blur).filter(v => v > 0).sort((a, b) => a - b), satisl = liste.map(u => u.adet).filter(v => v > 0).sort((a, b) => a - b);
  const blurMed = blurler.length ? blurler[Math.floor(blurler.length / 2)] : 1, satisMed = satisl.length ? satisl[Math.floor(satisl.length / 2)] : 1;
  const bilgi = u => urunBilgi[u.kod] || Object.values(urunBilgi).find(x => x.ad === u.ad) || {};
  const vitrin = liste.filter(u => u.blur >= Math.max(3, blurMed) && u.adet >= Math.max(1, satisMed)).sort((a, b) => b.adet - a.adet);
  const donen = liste.filter(u => u.blur >= Math.max(3, blurMed) && u.adet < Math.max(1, satisMed)).sort((a, b) => b.blur - a.blur);
  const sessiz = liste.filter(u => u.blur < Math.max(3, blurMed) && u.adet >= Math.max(2, satisMed)).sort((a, b) => b.adet - a.adet);
  const aktifAd = new Set(liste.filter(u => u.adet > 0 || u.blur > 0).flatMap(u => [u.ad, u.kod]));
  const olu = Object.entries(urunBilgi).filter(([kod, p]) => p.stok > 0 && p.nakit >= C.stokEsik && !aktifAd.has(kod) && !aktifAd.has(urunAd[kod] || '\u0000') && !hariciMi(urunAd[kod] || ''))
    .map(([kod, p]) => ({ kod, ad: urunAd[kod] || kod, stok: p.stok, nakit: p.nakit, deger: p.stok * p.nakit })).sort((a, b) => b.deger - a.deger);
  // fiyat disiplini
  const indirimli = Object.values(urun).filter(u => u.adet >= 3 && u.liste > 0).map(u => ({ ...u, oran: Math.max(0, (u.liste - u.ciro) / u.liste * 100) })).sort((a, b) => b.oran - a.oran).slice(0, 10);
  const birlikte = Y().birlikte ? Y().birlikte(cur, u => gamOf(u.kod), 8) : [];
  // saat / gün
  const gunUygun = t => C.gun === 'hepsi' || (C.gun === 'haftaici' && haftaGunu(t) >= 1 && haftaGunu(t) <= 5) || (C.gun === 'haftasonu' && (haftaGunu(t) === 0 || haftaGunu(t) === 6));
  const saatSatis = Array(24).fill(0); cur.forEach(s => { if (gunUygun(tsTarih(s.ts))) saatSatis[tsSaat(s.ts)]++; });
  const sd = Y().saatDagilim ? Y().saatDagilim(logs, { gun: C.gun, geceHaric: false }) : { oturum: Array(24).fill(0), kacti: Array(24).fill(0) };
  const gunCiro = Array(7).fill(0), gunAdet = Array(7).fill(0); cur.forEach(s => { const g = haftaGunu(tsTarih(s.ts)); gunCiro[g] += satisTutar(s); gunAdet[g]++; });
  const vardiya = Y().vardiya ? Y().vardiya({ oturum: sd.oturum, kacti: sd.kacti }) : '';
  return { A, B, cur, iptal, noktalar, odeme, mag, kisi, gunluk, urun, gam: Object.values(gam).sort((a, b) => b.ciro - a.ciro), topListe, topNet, vitrin, donen, sessiz, olu, indirimli, birlikte, bilgi,
    oturumN, satissiz, nedenler: Object.entries(nedenler).sort((a, b) => b[1] - a[1]), nedenYok, saatSatis, saatKacti: sd.kacti, gunCiro, gunAdet, vardiya, logs };
}

// ── arayüz parçaları ──
const fark = (a, b) => { if (!b) return a ? '<span class="an-d up">yeni</span>' : ''; const p = (a - b) / b * 100; return '<span class="an-d ' + (p >= 0 ? 'up' : 'dn') + '">' + (p >= 0 ? '▲' : '▼') + ' %' + Math.abs(Math.round(p)) + '</span>'; };
const kpi = (et, deg, alt, f) => '<div class="an-kpi"><div class="an-kl">' + et + '</div><div class="an-kv">' + deg + '</div><div class="an-ks">' + (f || '') + (alt ? '<span>' + alt + '</span>' : '') + '</div></div>';
const kart = (bas, ic, not) => '<section class="an-card"><div class="an-ch">' + bas + '</div>' + ic + (not ? '<div class="an-not">' + not + '</div>' : '') + '</section>';
const bar = (ad, deg, maks, sag, renk) => '<div class="an-br"><div class="an-bn">' + ad + '</div><div class="an-bt"><i style="width:' + Math.max(2, maks ? Math.round(deg / maks * 100) : 0) + '%;' + (renk ? 'background:' + renk : '') + '"></i></div><div class="an-bv">' + sag + '</div></div>';
const bos = m => '<div class="an-bos">' + m + '</div>';
const sirala = (acKey, arr, fn, ilk) => { const ac = D.acik[acKey]; const g = ac ? arr : arr.slice(0, ilk || 8); return g.map(fn).join('') + (arr.length > (ilk || 8) ? '<button class="an-more" data-an-ac="' + acKey + '">' + (ac ? 'Daha az göster' : 'Tümünü göster (' + arr.length + ')') + '</button>' : ''); };

function filtrePanel(H) {
  const tipler = [['bugun', 'Bugün'], ['dun', 'Dün'], ['7', '7 gün'], ['30', '30 gün'], ['ay', 'Bu ay'], ['90', '90 gün'], ['tum', '1 yıl']];
  const ch = tipler.map(([k, e]) => '<button class="an-chip' + (D.tip === k ? ' on' : '') + '" data-an-tip="' + k + '">' + e + '</button>').join('');
  const mg = H && H.noktalar.length > 1 ? '<div class="an-row"><span class="an-lb">Mağaza</span>' + ['hepsi', ...H.noktalar].map(n => '<button class="an-chip' + (D.nokta === n ? ' on' : '') + '" data-an-nk="' + esc(n) + '">' + (n === 'hepsi' ? 'Tümü' : esc(n)) + '</button>').join('') + '</div>' : '';
  return '<div class="an-filtre"><div class="an-row">' + ch + '</div><div class="an-row"><span class="an-lb">Özel</span><input type="date" id="an-bas" value="' + D.bas + '"><span>→</span><input type="date" id="an-bit" value="' + D.bit + '"><button class="an-chip" data-an-ozel="1">Uygula</button><button class="an-chip an-yenile" data-an-yenile="1">⟳ Yenile</button></div>' + mg + '</div>';
}
function sekmeler() {
  return '<div class="an-tabs">' + [['ozet', 'Özet'], ['urun', 'Ürün & Fiyat'], ['personel', 'Personel'], ['zaman', 'Zaman & Kaçan']].map(([k, e]) => '<button class="an-tab' + (D.sekme === k ? ' on' : '') + '" data-an-sk="' + k + '">' + e + '</button>').join('') + '</div>';
}

function ozetHtml(H) {
  const { A, B } = H, uz = gunFark(D.bas, D.bit) + 1;
  let h = '<div class="an-kpis">' + kpi('Ciro', TL(A.ciro), '', fark(A.ciro, B.ciro)) + kpi('Satış', N(A.adet), N(A.kalem) + ' ürün adedi', fark(A.adet, B.adet)) + kpi('Ortalama sepet', TL(A.sepet), r1(A.kalemOrt) + ' ürün / satış', fark(A.sepet, B.sepet)) + kpi('Günlük ortalama', TL(A.ciro / uz), r1(A.adet / uz) + ' satış / gün') + '</div>';
  h += '<div class="an-pn">Karşılaştırma: önceki ' + uz + ' gün (' + tarihGoster(tarihEkle(D.bas, -uz)) + ' – ' + tarihGoster(tarihEkle(D.bas, -1)) + '). Tutarlar müşterinin ödediği toplamdır; iptal/iade edilen satışlar dahil değildir.</div>';
  const mx = Math.max(1, ...Object.values(H.gunluk));
  const gk = Object.entries(H.gunluk); const adim = Math.max(1, Math.ceil(gk.length / 60));
  const grup = []; for (let i = 0; i < gk.length; i += adim) { const p = gk.slice(i, i + adim); grup.push([p[0][0], p.reduce((a, x) => a + x[1], 0)]); }
  const gmx = Math.max(1, ...grup.map(x => x[1]));
  h += kart('📈 Ciro seyri', grup.length > 1 ? '<div class="an-spark">' + grup.map(([t, v]) => '<i title="' + tarihGoster(t) + ' · ' + TL(v) + '" style="height:' + Math.max(3, Math.round(v / gmx * 100)) + '%"></i>').join('') + '</div>' : bos('Tek gün seçili'), adim > 1 ? 'Her çubuk ' + adim + ' günü gösterir.' : '');
  const om = Math.max(1, ...H.odeme.map(x => x.ciro));
  h += kart('💳 Ödeme biçimi', H.odeme.length ? H.odeme.map(x => bar(esc(x.ad), x.ciro, om, TL(x.ciro) + ' <small>· ' + x.adet + ' satış · %' + Math.round(x.ciro / (A.ciro || 1) * 100) + '</small>')).join('') : bos('Bu aralıkta satış yok'));
  if (H.mag.length > 1 || (H.mag[0] && H.mag[0].ad !== 'Belirtilmemiş')) { const mm = Math.max(1, ...H.mag.map(x => x.ciro)); h += kart('🏬 Mağaza', H.mag.map(x => bar(esc(x.ad), x.ciro, mm, TL(x.ciro) + ' <small>· ' + x.adet + ' satış · ort. ' + TL(x.sepet) + '</small>', '#2563eb')).join('')); }
  const iT = H.iptal.reduce((a, s) => a + satisTutar(s), 0);
  h += kart('↩️ İptal / İade', H.iptal.length ? '<div class="an-big">' + H.iptal.length + ' satış · ' + TL(iT) + '</div>' : bos('İptal veya iade yok'), H.iptal.length ? 'Bu tutarlar yukarıdaki ciroya dahil değildir.' : '');
  h += kart('👥 Müşteri ilgisi', H.oturumN ? '<div class="an-kpis two">' + kpi('Mağazada bakılan müşteri', N(H.oturumN), 'oturum kaydı') + kpi('Satışsız ayrılan', N(H.satissiz), 'sistem temizliği hariç') + '</div>' : bos('Bu aralıkta oturum kaydı yok'), 'Oturum kaydı yalnız “bakıp almayanı” ve ürün ilgisini ölçer; ciro ve satış adedi gerçek satıştan gelir.');
  return h;
}

function urunKarar(baslik, ic, not, n) { return '<section class="an-card"><div class="an-ch">' + baslik + '<b>' + n + '</b></div>' + ic + '<div class="an-not">' + not + '</div></section>'; }
function urunHtml(H) {
  const sat = Object.values(H.urun).filter(u => u.adet > 0).sort((a, b) => b.ciro - a.ciro);
  const sm = Math.max(1, ...sat.map(u => u.ciro));
  let h = kart('🏆 En çok ciro getiren ürünler', sat.length ? sirala('urun', sat, u => bar(esc(u.ad), u.ciro, sm, TL(u.ciro) + ' <small>· ' + u.adet + ' adet</small>'), 10) : bos('Satış yok'));
  const gm = Math.max(1, ...H.gam.map(x => x.ciro));
  if (H.gam.length && !(H.gam.length === 1 && H.gam[0].ad === 'Diğer')) h += kart('🗂 Ürün gamı', H.gam.slice(0, 10).map(x => bar(esc(x.ad), x.ciro, gm, TL(x.ciro) + ' <small>· ' + x.adet + ' adet</small>', '#0d9488')).join(''));
  const ind = H.topListe ? Math.round((H.topListe - H.topNet) / H.topListe * 1000) / 10 : 0;
  h += kart('🏷 Fiyat disiplini', '<div class="an-big">Liste fiyatından ortalama %' + ind + ' indirimle satıldı</div>' + (H.indirimli.length ? '<div class="an-sub">En çok indirim verilen ürünler (en az 3 satış)</div>' + H.indirimli.map(u => bar(esc(u.ad), u.oran, H.indirimli[0].oran || 1, '%' + r1(u.oran) + ' <small>· ' + u.adet + ' adet</small>', '#dc2626')).join('') : ''), 'Sürekli yüksek indirim verilen ürünün liste fiyatı piyasaya göre yüksek olabilir: fiyat listesini gözden geçirme adayıdır. Kampanya (marka destekli) fiyatlar liste farkı olarak görünebilir.');
  const satir = (u, sag) => '<div class="an-ur"><span>' + esc(u.ad) + '</span><span>' + sag + '</span></div>';
  h += urunKarar('🔥 Çok bakılıyor, az satılıyor', H.donen.length ? sirala('donen', H.donen, u => { const b = H.bilgi(u); return satir(u, '👁 ' + u.blur + ' · ✅ ' + u.adet + (b.nakit ? ' · ' + TL(b.nakit) : '')); }) : bos('Bu grupta ürün yok'), 'Müşteri ilgisi yüksek ama satışa dönmüyor → fiyat, taksit seçeneği veya kampanya gözden geçirilmeli.', H.donen.length);
  h += urunKarar('🏆 Vitrin şampiyonları', H.vitrin.length ? sirala('vitrin', H.vitrin, u => satir(u, '👁 ' + u.blur + ' · ✅ ' + u.adet + ' · ' + TL(u.ciro))) : bos('Bu grupta ürün yok'), 'Hem ilgi hem satış yüksek → stoğu eksik bırakmayın, vitrinde tutun.', H.vitrin.length);
  h += urunKarar('💎 Sessiz değerler', H.sessiz.length ? sirala('sessiz', H.sessiz, u => satir(u, '👁 ' + u.blur + ' · ✅ ' + u.adet + ' · ' + TL(u.ciro))) : bos('Bu grupta ürün yok'), 'Az bakılıyor ama bakan alıyor → görünürlüğünü artırın, öne çıkarın.', H.sessiz.length);
  const esikler = [0, 1000, 5000, 10000, 25000].map(v => '<option value="' + v + '"' + (D.stokEsik === v ? ' selected' : '') + '>' + (v ? '≥ ' + N(v) + ' ₺' : 'Tümü') + '</option>').join('');
  const oluTop = H.olu.reduce((a, u) => a + u.deger, 0), kisa = gunFark(D.bas, D.bit) + 1 < 60;
  h += urunKarar('🧊 Hareketsiz stok', '<div class="an-row"><span class="an-lb">Fiyat eşiği</span><select id="an-esik">' + esikler + '</select></div>' + (H.olu.length ? '<div class="an-big">' + H.olu.length + ' ürün · ' + TL(oluTop) + ' stok değeri</div>' + sirala('olu', H.olu, u => satir(u, 'Stok ' + u.stok + ' · ' + TL(u.nakit)), 10) : bos((W._cachedUrunler || []).length === 0 ? 'Ürün listesi yüklenemedi' : 'Bu eşikte hareketsiz stok yok')), 'Seçili aralıkta hiç bakılmamış ve hiç satılmamış, stoğu olan ürünler (stok değeri sırasıyla).' + (kisa ? ' <b>Güvenilir sonuç için 90 gün veya “Tümü” seçin.</b>' : ''), H.olu.length);
  if (H.birlikte.length) h += kart('🧺 Birlikte satılanlar', H.birlikte.map(([k, n]) => '<div class="an-ur"><span>' + esc(k) + '</span><b>' + n + ' satış</b></div>').join(''), 'Aynı satışta görülen ürün gamı çiftleri.');
  return h;
}

function personelHtml(H) {
  if (!H.kisi.length) return kart('👤 Personel', bos('Bu aralıkta satış yok'));
  const mx = Math.max(1, ...H.kisi.map(k => k.ciro)), toplam = H.A.ciro || 1;
  let h = '<div class="an-grid">';
  H.kisi.forEach((k, i) => {
    let tl = 0, tn = 0; k.liste.forEach(s => kalemler(s).forEach(x => { tl += x.liste; tn += x.net; }));
    const ind = tl ? Math.max(0, (tl - tn) / tl * 100) : 0;
    const pay = Math.round(k.ciro / toplam * 100), az = k.adet < 5;
    const nk = {}; k.liste.forEach(s => { const n = nokta(s); nk[n] = (nk[n] || 0) + 1; }); const nkTop = Object.entries(nk).sort((a, b) => b[1] - a[1])[0];
    const ots = H.logs.filter(l => String(l.personelId || '').toLowerCase() === k.eposta || String(l.personelAd || '').trim() === k.gorunen);
    const on = ots.reduce((a, l) => a + (l._isAggregate ? l._oturumSayisi || 0 : 1), 0);
    h += '<div class="an-pc"><div class="an-ph"><span class="an-rk">' + (i + 1) + '</span><div><b>' + esc(k.gorunen) + '</b><small>' + (nkTop ? esc(nkTop[0]) : '') + (az ? ' · az veri' : '') + '</small></div><span class="an-pp">%' + pay + '</span></div>' +
      '<div class="an-pb"><i style="width:' + Math.max(3, Math.round(k.ciro / mx * 100)) + '%"></i></div>' +
      '<div class="an-pg"><div><small>Ciro</small><b>' + TL(k.ciro) + '</b></div><div><small>Satış</small><b>' + k.adet + '</b></div><div><small>Ort. sepet</small><b>' + TL(k.sepet) + '</b></div><div><small>Ürün / satış</small><b>' + r1(k.kalemOrt) + '</b></div><div><small>İndirim</small><b>%' + r1(ind) + '</b></div>' + (on ? '<div><small>Müşteri oturumu</small><b>' + on + '</b></div>' : '') + '</div></div>';
  });
  return h + '</div><div class="an-pn">Sıralama ciroya göredir. “İndirim”, liste fiyatına göre verilen ortalama indirimdir; marka kampanyası farkı da içerebilir. 5’ten az satışı olanlar “az veri” olarak işaretlenir.</div>';
}

function zamanHtml(H) {
  const gunSec = '<div class="an-row">' + [['hepsi', 'Tüm günler'], ['haftaici', 'Hafta içi'], ['haftasonu', 'Hafta sonu']].map(([k, e]) => '<button class="an-chip' + (D.gun === k ? ' on' : '') + '" data-an-gun="' + k + '">' + e + '</button>').join('') + '</div>';
  const mx = Math.max(1, ...H.saatSatis, ...H.saatKacti);
  let sat = ''; for (let s = 8; s <= 22; s++) sat += '<div class="an-hr"><span>' + String(s).padStart(2, '0') + '</span><div class="an-ht"><i class="g" style="width:' + Math.round(H.saatSatis[s] / mx * 100) + '%"></i><i class="r" style="width:' + Math.round((H.saatKacti[s] || 0) / mx * 100) + '%"></i></div><b>' + H.saatSatis[s] + ' <em>/ ' + (H.saatKacti[s] || 0) + '</em></b></div>';
  let h = kart('⏰ Saatlere göre satış ve kaçan', gunSec + '<div class="an-lg"><i class="g"></i> Satış (gerçek) <i class="r"></i> Satışsız ayrılan (oturum)</div>' + sat + (H.vardiya ? '<div class="an-tip">💡 ' + esc(H.vardiya) + '</div>' : ''), 'Sağdaki sayılar: satış / satışsız ayrılan. Satışsız sayısı oturum kaydından gelir.');
  const gm = Math.max(1, ...H.gunCiro);
  h += kart('📅 Haftanın günleri', [1, 2, 3, 4, 5, 6, 0].map(g => bar(GUN[g], H.gunCiro[g], gm, TL(H.gunCiro[g]) + ' <small>· ' + H.gunAdet[g] + ' satış</small>', '#7c3aed')).join(''));
  const nm = Math.max(1, ...H.nedenler.map(x => x[1]));
  h += kart('🚪 Satışsız ayrılma nedeni', H.nedenler.length ? H.nedenler.map(([n, c]) => bar(esc(n), c, nm, c + ' kişi', '#dc2626')).join('') : bos('Neden girilen kayıt yok'), H.nedenYok ? H.nedenYok + ' kayıtta neden belirtilmemiş; bu yüzden nedenler yön gösterir, kesin sonuç değildir. Kaçan ciro tahmini yapılmaz.' : '');
  return h;
}

function paylasMetin(H) {
  const uz = gunFark(D.bas, D.bit) + 1;
  const s = ['Aygün AVM · Satış Özeti', tarihGoster(D.bas) + ' – ' + tarihGoster(D.bit) + (D.nokta !== 'hepsi' ? ' · ' + D.nokta : ''), '',
    'Ciro: ' + TL(H.A.ciro) + ' · Satış: ' + H.A.adet + ' · Ort. sepet: ' + TL(H.A.sepet), 'Günlük ortalama: ' + TL(H.A.ciro / uz), ''];
  H.kisi.slice(0, 10).forEach((k, i) => s.push((i + 1) + '. ' + k.gorunen + ' — ' + TL(k.ciro) + ' (' + k.adet + ' satış)'));
  return s.join('\n');
}


// ═══ PERSONELE YAYIN (Performansım ekranı) — tek doküman: meta/analizPaylasim (personel 1 okuma yapar) ═══
const adsiz = k => String(k || '').trim().split(/\s+/)[0];
async function paylasimYayinla(sessiz) {
  const b = kopru(); if (!b) throw new Error('Veri bağlantısı yok');
  const bg = bugunStr(), C = { tip: '30', bas: tarihEkle(bg, -29), bit: bg, nokta: 'hepsi', gun: 'hepsi', stokEsik: 5000, sekme: 'urun', acik: {} };
  const ham = await yukle(false, C), H = hesapla(ham, C);
  const hf = tarihEkle(bg, -6), kisiler = H.kisi.map(k => {
    const l = k.liste, say = (f) => l.filter(s => f(tsTarih(s.ts))).length;
    const onc = ham.gecerli.filter(s => String(s.user || '').toLowerCase() === k.eposta && tsTarih(s.ts) >= tarihEkle(bg, -59) && tsTarih(s.ts) < C.bas).length;
    const kal = l.reduce((a, s) => a + kalemler(s).reduce((x, y) => x + y.adet, 0), 0);
    return { e: k.eposta, a: adsiz(k.gorunen), bugun: say(t => t === bg), hafta: say(t => t >= hf), ay: l.length, onceki: onc, sepet: Math.round(k.sepet), kalem: r1(l.length ? kal / l.length : 0) };
  });
  const hfOnc = tarihEkle(bg, -13);
  kisiler.forEach(k => { k.haftaOnceki = ham.gecerli.filter(s => String(s.user || '').toLowerCase() === k.e && tsTarih(s.ts) >= hfOnc && tsTarih(s.ts) < hf).length; });
  const bs = H.bilgi, kes = (arr, n) => arr.slice(0, n);
  const doc = { v: 1, t: Date.now(), bas: C.bas, bit: C.bit, kisiler,
    cok: kes(Object.values(H.urun).filter(u => u.adet > 0).sort((a, b) => b.adet - a.adet), 8).map(u => ({ ad: u.ad, adet: u.adet })),
    vitrin: kes(H.vitrin, 8).map(u => ({ ad: u.ad, blur: u.blur, adet: u.adet })),
    sessiz: kes(H.sessiz, 8).map(u => ({ ad: u.ad, blur: u.blur, adet: u.adet })),
    donen: kes(H.donen, 8).map(u => ({ ad: u.ad, blur: u.blur, adet: u.adet, nakit: Math.round((bs(u) || {}).nakit || 0) })),
    olu: kes(H.olu, 12).map(u => ({ ad: u.ad, stok: u.stok, nakit: Math.round(u.nakit) })), oluToplam: H.olu.length };
  await b.setDoc(b.doc(b.db, 'meta', 'analizPaylasim'), JSON.parse(JSON.stringify(doc)));
  return doc;
}
let sonYayin = 0;
async function otoYayin() {
  const b = kopru(); if (!b || D.tip !== '30' || Date.now() - sonYayin < 3 * 3600e3) return;
  try { const sn = await b.getDoc(b.doc(b.db, 'meta', 'analizPaylasim')); sonYayin = Date.now(); const t = sn.exists() ? Number((sn.data() || {}).t) || 0 : 0; if (Date.now() - t > 3 * 3600e3) await paylasimYayinla(true); } catch (_e) { /* sessiz */ }
}


// ═══ ÖZET SEKMESİ — "Bugün" kartı (gerçek satış; dün ile karşılaştırma) ═══
async function bugunKart(elId) {
  const el = $(elId), b = kopru(); if (!el || !b) return;
  stil();
  try {
    const bg = bugunStr(), dn = tarihEkle(bg, -1);
    const bas = new Date(dn + 'T00:00:00+03:00'), son = new Date(tarihEkle(bg, 1) + 'T00:00:00+03:00');
    const [sn, sv] = await Promise.all([
      b.getDocs(b.query(b.collection(b.db, 'sales'), b.where('ts', '>=', bas.toISOString()), b.where('ts', '<', son.toISOString()))),
      b.getDocs(b.query(b.collection(b.db, 'sevkiyatlar'), b.where('ts', '>=', bas.getTime()), b.where('ts', '<', son.getTime()))).catch(() => null)
    ]);
    const bad = new Set(); if (sv) sv.docs.forEach(d => { const x = d.data(); if (x.iptal || x.iade || x.silindi) bad.add(x.saleNo || d.id); });
    const l = sn.docs.map(d => ({ ...d.data(), id: d.id })).filter(s => (!s.tip || s.tip === 'satis') && !bad.has(s.id));
    const ozet = t => { const x = l.filter(s => tsTarih(s.ts) === t), c = x.reduce((a, s) => a + satisTutar(s), 0); return { adet: x.length, ciro: c, sepet: x.length ? c / x.length : 0 }; };
    const A = ozet(bg), B = ozet(dn);
    el.innerHTML = '<div id="analiz-yeni-bugun" class="an-card" style="margin:0"><div class="an-ch">📈 Bugün <button class="an-chip" onclick="switchAdminTab(\'analiz\')">Detaylı analiz →</button></div><div class="an-kpis">' +
      kpi('Ciro', TL(A.ciro), '', fark(A.ciro, B.ciro)) + kpi('Satış', N(A.adet), '', fark(A.adet, B.adet)) + '</div><div class="an-not">Dün: ' + TL(B.ciro) + ' · ' + B.adet + ' satış. Gerçek satış kayıtlarından; iptal/iade dahil değil.</div></div>';
  } catch (e) { el.innerHTML = '<div class="admin-empty" style="padding:12px">Bugünün özeti okunamadı: ' + esc(e && e.message) + '</div>'; }
}

// ── render ──
function cizim() {
  const kok = $('analiz-yeni'); if (!kok) return;
  let h = '<div class="an-bas"><div><div class="an-t">Satış Analizi</div><div class="an-s">Gerçek satış kayıtlarından · ' + tarihGoster(D.bas) + ' – ' + tarihGoster(D.bit) + '</div></div>' + (veri ? '<span style="display:flex;gap:6px"><button class="an-chip" data-an-yayin="1" title="Son 30 gün özetini ve ürün listelerini personelin Performansım ekranına yazar">📤 Personele yayınla</button><button class="an-chip" data-an-kopya="1">📋 Kopyala</button></span>' : '') + '</div>';
  let H = null;
  if (veri) { try { H = hesapla(veri); } catch (e) { hata = 'Hesaplama hatası: ' + e.message; console.error('Analiz:', e); } }
  h += filtrePanel(H);
  if (yukleniyor && !veri) h += '<div class="an-bos">⏳ Analiz yükleniyor…</div>';
  else if (hata) h += '<div class="an-bos" style="color:#dc2626">⚠️ ' + esc(hata) + '</div>';
  else if (H) {
    H._metin = paylasMetin(H); W.__analizMetin = H._metin;
    h += sekmeler() + (yukleniyor ? '<div class="an-pn">⏳ Güncelleniyor…</div>' : '') + (D.sekme === 'ozet' ? ozetHtml(H) : D.sekme === 'urun' ? urunHtml(H) : D.sekme === 'personel' ? personelHtml(H) : zamanHtml(H));
  }
  kok.innerHTML = h;
}

async function yenile(force) {
  const my = ++istek; yukleniyor = true; hata = ''; cizim();
  try { const v = await yukle(!!force); if (my !== istek) return; veri = v; }
  catch (e) { if (my !== istek) return; hata = 'Veri çekilemedi: ' + (e && e.message); veri = null; }
  yukleniyor = false; cizim(); otoYayin();
}

function olay(e) {
  const t = e.target.closest('[data-an-tip],[data-an-nk],[data-an-sk],[data-an-gun],[data-an-ac],[data-an-ozel],[data-an-yenile],[data-an-kopya],[data-an-yayin]'); if (!t) return;
  const d = t.dataset;
  if (d.anTip) { aralikAyarla(d.anTip); D.nokta = 'hepsi'; yenile(false); }
  else if (d.anNk) { D.nokta = d.anNk; cizim(); }
  else if (d.anSk) { D.sekme = d.anSk; cizim(); }
  else if (d.anGun) { D.gun = d.anGun; cizim(); }
  else if (d.anAc) { D.acik[d.anAc] = !D.acik[d.anAc]; cizim(); }
  else if (d.anOzel) { const b = $('an-bas'), s = $('an-bit'); if (b && s && /^\d{4}-\d{2}-\d{2}$/.test(b.value) && /^\d{4}-\d{2}-\d{2}$/.test(s.value) && b.value <= s.value && gunFark(b.value, s.value) <= 365) { D.tip = 'ozel'; D.bas = b.value; D.bit = s.value; yenile(false); } else { alert('Tarih aralığı geçersiz (en fazla 1 yıl).'); } }
  else if (d.anYenile) yenile(true);
  else if (d.anYayin) { t.disabled = true; t.textContent = '⏳ Yazılıyor…'; paylasimYayinla().then(() => { sonYayin = Date.now(); t.textContent = '✓ Yayınlandı'; }).catch(e => { t.textContent = '⚠️ ' + (e && e.message || 'Hata'); }).finally(() => setTimeout(() => { t.disabled = false; t.textContent = '📤 Personele yayınla'; }, 2500)); }
  else if (d.anKopya) { try { navigator.clipboard.writeText(W.__analizMetin || ''); t.textContent = '✓ Kopyalandı'; setTimeout(() => { t.textContent = '📋 Kopyala'; }, 1500); } catch (_e) { /* yoksay */ } }
}

const CSS0 = `
#analiz-yeni{--an-ink:var(--text,#0f172a);padding:2px 0 24px}
#analiz-yeni .an-bas{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:4px 0 12px}
#analiz-yeni .an-t{font-size:1.05rem;font-weight:800;letter-spacing:-.01em}
#analiz-yeni .an-s{font-size:.68rem;color:var(--text-3,#64748b);margin-top:2px}
#analiz-yeni .an-filtre{background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:14px;padding:10px 12px;margin-bottom:12px}
#analiz-yeni .an-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0}
#analiz-yeni .an-lb{font-size:.62rem;font-weight:700;color:var(--text-3,#64748b);text-transform:uppercase;letter-spacing:.04em;margin-right:2px}
#analiz-yeni .an-chip{border:1px solid var(--border,#e2e8f0);background:var(--surface,#fff);color:var(--text-2,#334155);border-radius:999px;padding:6px 12px;font-size:.7rem;font-weight:600;cursor:pointer}
#analiz-yeni .an-chip.on{background:#0f172a;border-color:#0f172a;color:#fbbf24}
#analiz-yeni .an-yenile{margin-left:auto}
#analiz-yeni input[type=date],#analiz-yeni select{border:1px solid var(--border,#e2e8f0);border-radius:8px;padding:5px 8px;font-size:.72rem;background:var(--surface,#fff);color:var(--text,#0f172a)}
#analiz-yeni .an-tabs{display:flex;gap:4px;background:var(--bg-2,#f1f5f9);padding:4px;border-radius:12px;margin-bottom:12px;overflow-x:auto}
#analiz-yeni .an-tab{flex:1;white-space:nowrap;border:0;background:transparent;border-radius:9px;padding:8px 10px;font-size:.74rem;font-weight:700;color:var(--text-3,#64748b);cursor:pointer}
#analiz-yeni .an-tab.on{background:var(--surface,#fff);color:var(--text,#0f172a);box-shadow:0 1px 4px rgba(15,23,42,.12)}
#analiz-yeni .an-kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px}
#analiz-yeni .an-kpis.two{margin-bottom:0}
#analiz-yeni .an-kpi{background:linear-gradient(160deg,#0f172a,#1e293b);color:#fff;border-radius:14px;padding:12px 14px}
#analiz-yeni .an-kpis.two .an-kpi{background:var(--bg-2,#f1f5f9);color:var(--text,#0f172a)}
#analiz-yeni .an-kl{font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;opacity:.7;font-weight:700}
#analiz-yeni .an-kv{font-size:1.3rem;font-weight:800;margin:3px 0;letter-spacing:-.02em}
#analiz-yeni .an-ks{font-size:.62rem;opacity:.85;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
#analiz-yeni .an-d{font-weight:800;padding:1px 6px;border-radius:6px;font-size:.6rem}
#analiz-yeni .an-d.up{background:rgba(34,197,94,.2);color:#16a34a}
#analiz-yeni .an-d.dn{background:rgba(239,68,68,.2);color:#ef4444}
#analiz-yeni .an-card{background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:14px;padding:12px 14px;margin-bottom:10px}
#analiz-yeni .an-ch{display:flex;justify-content:space-between;align-items:center;font-size:.76rem;font-weight:800;margin-bottom:8px}
#analiz-yeni .an-ch b{background:var(--bg-2,#f1f5f9);border-radius:999px;padding:1px 9px;font-size:.66rem;color:var(--text-2,#334155)}
#analiz-yeni .an-not,#analiz-yeni .an-pn{font-size:.62rem;color:var(--text-3,#64748b);margin-top:8px;line-height:1.45}
#analiz-yeni .an-pn{margin:0 2px 10px}
#analiz-yeni .an-bos{text-align:center;color:var(--text-3,#64748b);font-size:.72rem;padding:14px 6px}
#analiz-yeni .an-big{font-size:.86rem;font-weight:800;margin:2px 0 8px}
#analiz-yeni .an-sub{font-size:.62rem;font-weight:700;color:var(--text-3,#64748b);margin:6px 0}
#analiz-yeni .an-br{display:grid;grid-template-columns:minmax(80px,32%) 1fr auto;gap:8px;align-items:center;padding:4px 0;font-size:.7rem}
#analiz-yeni .an-bn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
#analiz-yeni .an-bt{height:8px;background:var(--bg-2,#f1f5f9);border-radius:999px;overflow:hidden}
#analiz-yeni .an-bt i{display:block;height:100%;background:#d4a017;border-radius:999px}
#analiz-yeni .an-bv{font-weight:800;text-align:right;white-space:nowrap}
#analiz-yeni .an-bv small{font-weight:500;color:var(--text-3,#64748b)}
#analiz-yeni .an-ur{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border,#e2e8f0);font-size:.7rem}
#analiz-yeni .an-ur span:first-child{font-weight:600;overflow:hidden;text-overflow:ellipsis}
#analiz-yeni .an-ur span:last-child,#analiz-yeni .an-ur b{white-space:nowrap;color:var(--text-2,#334155)}
#analiz-yeni .an-more{margin-top:8px;border:0;background:none;color:#2563eb;font-size:.68rem;font-weight:700;cursor:pointer;padding:4px 0}
#analiz-yeni .an-spark{display:flex;align-items:flex-end;gap:2px;height:84px}
#analiz-yeni .an-spark i{flex:1;background:linear-gradient(#d4a017,#b45309);border-radius:3px 3px 0 0;min-width:2px}
#analiz-yeni .an-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;margin-bottom:10px}
#analiz-yeni .an-pc{background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:14px;padding:12px}
#analiz-yeni .an-ph{display:flex;align-items:center;gap:10px}
#analiz-yeni .an-ph small{display:block;font-size:.6rem;color:var(--text-3,#64748b)}
#analiz-yeni .an-rk{width:24px;height:24px;border-radius:50%;background:#0f172a;color:#fbbf24;font-weight:800;font-size:.68rem;display:flex;align-items:center;justify-content:center}
#analiz-yeni .an-pp{margin-left:auto;font-weight:800;font-size:.8rem}
#analiz-yeni .an-pb{height:6px;background:var(--bg-2,#f1f5f9);border-radius:999px;overflow:hidden;margin:9px 0}
#analiz-yeni .an-pb i{display:block;height:100%;background:#d4a017}
#analiz-yeni .an-pg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
#analiz-yeni .an-pg small{display:block;font-size:.56rem;color:var(--text-3,#64748b);text-transform:uppercase;letter-spacing:.03em}
#analiz-yeni .an-pg b{font-size:.76rem}
#analiz-yeni .an-hr{display:grid;grid-template-columns:22px 1fr 64px;gap:8px;align-items:center;font-size:.64rem;padding:2px 0}
#analiz-yeni .an-ht{display:flex;flex-direction:column;gap:2px}
#analiz-yeni .an-ht i{display:block;height:6px;border-radius:999px}
#analiz-yeni .g{background:#16a34a}
#analiz-yeni .r{background:#dc2626}
#analiz-yeni .an-hr b{text-align:right}
#analiz-yeni .an-hr em{font-style:normal;color:#dc2626}
#analiz-yeni .an-lg{font-size:.62rem;color:var(--text-3,#64748b);margin:4px 0 8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
#analiz-yeni .an-lg i{width:9px;height:9px;border-radius:50%;display:inline-block}
#analiz-yeni .an-tip{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:10px;padding:8px 10px;font-size:.66rem;margin-top:10px}
`;
const CSS = CSS0.replace(/#analiz-yeni(?=[ {])/g, ':is(#analiz-yeni,#analiz-bugun)');
function stil() { /* #analiz-yeni ve #analiz-bugun kapsamı */ if ($('analiz-yeni-css')) return; const s = document.createElement('style'); s.id = 'analiz-yeni-css'; s.textContent = CSS; document.head.appendChild(s); }

function ac(force) {
  const kok = $('analiz-yeni'); if (!kok) return false;
  stil();
  if (!kok.dataset.bagli) { kok.addEventListener('click', olay); kok.addEventListener('change', e => { if (e.target && e.target.id === 'an-esik') { D.stokEsik = Number(e.target.value) || 0; cizim(); } }); kok.dataset.bagli = '1'; }
  if (!D.bas) aralikAyarla('30');
  yenile(!!force);
  return true;
}

W.Analiz = { ac, bugunKart, versiyon: 'V12.15' };
