// ═══════════════════════════════════════════════════════════════
//  V12.0 — PRİM / VERİMLİLİK HESAP MOTORU (saf hesap: DOM yok, Firestore yok, test edilir)
//  Kurallar (kullanıcı kararları, bkz. V12-NOTLAR.md):
//   · Tüm hedef/satış/prim KDV'SİZ tutar üzerinden. Hedef ve verimlilik TESLİM tarihine göre.
//   · Prim = KDV'siz satış × oran (oran Admin'den: gam / ürün / sigorta). Ürüne özgü tarihli ekstra prim eklenir.
//   · Verimlilik = 0,4 × Hedef% (en çok 100) + 0,6 × Nitelikli%.  Hak ediş = brüt prim × verimlilik.
//   · Adil pay: sepetin ödenen toplamı kalemlere LİSTE oranında dağıtılır (kalem fiyatı kaydırılsa prim kaymaz).
//   · İndirim: kişinin elle verdiği indirim oranı EKİP ORTALAMASINDAN fazlaysa katsayı düşer (eşik yok). İlk ay "gölge": uygulanmaz.
// ═══════════════════════════════════════════════════════════════

export const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
export const sayiya = v => { const n = Number(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };

// Karşılaştırma anahtarı: küçük harf (tr), aksansız, boşluk/noktalama yok  ("Küçük Ev Aletleri" → "kucukevaletleri")
export const norm = s => String(s ?? '').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// ── Varsayılan ayarlar (Admin → Prim ekranından değişir; Firestore: meta/primAyarlar) ──
const NIT = ['Aksesuar', 'Ankastre', 'Beyaz Eşya', 'Klima', 'Küçük Ev Aletleri'];
const IT = ['Akıllı Saat', 'BT Kulaklık', 'Saat Kayışı', 'Tablet', 'Cep Telefonu'];
const ELK = ['Yazar Kasa', 'Araç Şarj', 'TV', 'Projeksiyon', 'Ses Sistemi', 'Hoparlör', 'Monitör', 'Smart Monitör'];
export function varsayilanAyar() {
  const gamlar = {};
  NIT.forEach(g => { gamlar[g] = { grup: 'nitelikli', oran: g === 'Aksesuar' ? 11 : 0.7 }; });
  IT.forEach(g => { gamlar[g] = { grup: 'verimsiz', kume: 'IT', oran: 0.2 }; });
  ELK.forEach(g => { gamlar[g] = { grup: 'verimsiz', kume: 'Elektronik', oran: 0.2 }; });
  return {
    surum: 1,
    personelEkran: false,                          // true olunca personelde "Puan Durumum" + sepet koçluğu açılır (Admin → Ayarlar; varsayılan KAPALI = hiçbir görünür değişiklik yok)
    golge: true,                                   // ilk ay: indirim etkisi hak edişe UYGULANMAZ (yalnız Admin görür)
    kdv: 20,                                       // varsayılan KDV %
    gamlar,                                        // { 'Aksesuar': { grup, oran(%), kdv? } }
    grupOran: { nitelikli: 0.7, verimsiz: 0.2 },   // gamı tanımsız ürünler için
    urunler: {},                                   // { 'KOD': { oran?, kdv? } }
    sigorta: { oran: 0, sabit: 0, kdv: 20 },       // oran % (KDV'siz tutar üzerinden) VEYA sabit ₺/adet (>0 ise o kullanılır)
    ekstra: [],                                    // [{ id, kod, ad, tutar, bas:'YYYY-MM-DD', bit:'YYYY-MM-DD', aktif:true }]
    verimlilik: { hedef: 0.4, nitelikli: 0.6 },
    indirim: { k: 2, alt: 0.7 },                   // ekip ortalamasının 1 puan üstü = prim −%k; katsayı en az "alt"
    noktalar: [
      { ad: 'SP' },
      { ad: 'NF', ayir: [{ ad: 'S-NF', markalar: ['Samsung'] }, { ad: 'V-NF', markalar: ['Vestel'] }] },
      { ad: 'VŞ' }, { ad: 'SÇ' }, { ad: 'Diğer' }
    ],
    donem: [{ bitis: 10, pay: 20 }, { bitis: 20, pay: 30 }, { bitis: 31, pay: 50 }],   // ay içi hedef dağılımı (%): 1–10, 11–20, 21–son
    gunluk: null                                   // ileride: Excel 2026 günlük satış serisinden { 'AA': [gün ağırlıkları] }
  };
}
// Kayıtlı ayarı varsayılanla birleştirir (eksik alan asla hata vermez)
export function ayarBirlestir(k) {
  const v = varsayilanAyar(); if (!k || typeof k !== 'object') return v;
  const o = { ...v, ...k };
  o.gamlar = { ...v.gamlar, ...(k.gamlar || {}) };
  o.grupOran = { ...v.grupOran, ...(k.grupOran || {}) };
  o.sigorta = { ...v.sigorta, ...(k.sigorta || {}) };
  o.verimlilik = { ...v.verimlilik, ...(k.verimlilik || {}) };
  o.indirim = { ...v.indirim, ...(k.indirim || {}) };
  o.urunler = k.urunler && typeof k.urunler === 'object' ? k.urunler : {};
  o.ekstra = Array.isArray(k.ekstra) ? k.ekstra : [];
  o.noktalar = Array.isArray(k.noktalar) && k.noktalar.length ? k.noktalar : v.noktalar;
  o.donem = Array.isArray(k.donem) && k.donem.length ? k.donem : v.donem;
  return o;
}

// ── Tarih yardımcıları (Türkiye UTC+3, yaz saati yok) ──
const TR_MS = 3 * 3600 * 1000;
export const gunStr = t => { const d = new Date(Number(t) + TR_MS); return d.toISOString().slice(0, 10); };   // 'YYYY-MM-DD'
export const ayStr = t => gunStr(t).slice(0, 7);
export const ayGunSayisi = ay => { const [y, m] = ay.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const ayAralik = ay => { const [y, m] = ay.split('-').map(Number); return { bas: Date.UTC(y, m - 1, 1) - TR_MS, bit: Date.UTC(y, m, 1) - TR_MS }; };   // [bas, bit) ms
export const ayAdi = ay => { const [y, m] = ay.split('-').map(Number); return ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][m - 1] + ' ' + y; };
export const gunAraliktaMi = (g, bas, bit) => (!bas || g >= bas) && (!bit || g <= bit);

// ── Ürün sınıflama ──
export const hizmetMi = k => !!(k && (k._hizmet || /^SIG-/i.test(String(k.kod || '')) || norm(k.gam) === 'sigorta'));
export function gamBul(ayar, gam) {
  const n = norm(gam); let bulunan = null, ad = '';
  for (const g of Object.keys(ayar.gamlar)) if (norm(g) === n) { bulunan = ayar.gamlar[g]; ad = g; break; }
  if (bulunan) {
    const grup = bulunan.grup === 'verimsiz' ? 'verimsiz' : 'nitelikli';
    return { ad, grup, oran: sayiya(bulunan.oran ?? ayar.grupOran[grup]), kdv: bulunan.kdv != null && bulunan.kdv !== '' ? sayiya(bulunan.kdv) : null, bilinmiyor: false };
  }
  // Tanımsız gam: verimsiz listesi KAPALI bir liste olduğundan bilinmeyenler nitelikli sayılır; Admin ekranında "tanımsız gam" uyarısı çıkar
  return { ad: String(gam || ''), grup: 'nitelikli', oran: sayiya(ayar.grupOran.nitelikli), kdv: null, bilinmiyor: true };
}
// Bir kalemin sınıfı + oranı + KDV'si (ürün > sigorta > gam > varsayılan)
export function kalemSinifi(ayar, kalem) {
  const kod = String(kalem.kod || ''), ur = ayar.urunler[kod] || null;
  if (hizmetMi(kalem)) {
    const s = ayar.sigorta;
    return { tur: 'sigorta', grup: 'nitelikli', oran: ur && ur.oran != null && ur.oran !== '' ? sayiya(ur.oran) : sayiya(s.oran), sabit: sayiya(s.sabit), kdv: ur && ur.kdv != null && ur.kdv !== '' ? sayiya(ur.kdv) : (s.kdv != null && s.kdv !== '' ? sayiya(s.kdv) : sayiya(ayar.kdv)), gam: 'Sigorta', bilinmiyor: false };
  }
  const g = gamBul(ayar, kalem.gam);
  return { tur: 'urun', grup: g.grup, oran: ur && ur.oran != null && ur.oran !== '' ? sayiya(ur.oran) : g.oran, sabit: 0,
    kdv: ur && ur.kdv != null && ur.kdv !== '' ? sayiya(ur.kdv) : (g.kdv != null ? g.kdv : sayiya(ayar.kdv)), gam: g.ad || String(kalem.gam || ''), bilinmiyor: g.bilinmiyor };
}
export const kdvsizYap = (tutar, kdv) => r2(Number(tutar) / (1 + (Number(kdv) || 0) / 100));

// ── Adil pay: toplam ödemeyi kalemlere LİSTE oranında dağıt (son kalem kuruş farkını alır) ──
export function adilPaylar(listeler, netToplam) {
  const L = listeler.map(x => Math.max(0, Number(x) || 0)), T = L.reduce((a, b) => a + b, 0), n = L.length, net = Math.max(0, Number(netToplam) || 0);
  if (!n) return [];
  const pay = L.map(l => r2(T > 0 ? net * l / T : net / n));
  const fark = r2(net - pay.reduce((a, b) => a + b, 0)); pay[n - 1] = r2(pay[n - 1] + fark);
  return pay;
}

// ── DAMGA: satış kaydına yazılacak prim özeti (sonradan oran/gam değişse geçmiş KAYMAZ) ──
// sale: kaydedilmiş satış ({ fiyat:{kalemler,netNakit,...}, urunler, nakit }); urunBul(kod) → ürün satırı | null (marka için)
export function damga(sale, ayar0, urunBul) {
  const ayar = ayarBirlestir(ayar0), f = sale && sale.fiyat ? sale.fiyat : null;
  let ks = f && Array.isArray(f.kalemler) && f.kalemler.length ? f.kalemler.map(k => ({ kod: k.kod, urun: k.urun, liste: Number(k.liste) || 0 })) : null;
  const urunler = Array.isArray(sale && sale.urunler) ? sale.urunler : [];
  if (!ks) ks = urunler.map(u => ({ kod: u.kod, urun: u.urun, liste: Number(u.nakit || u.fiyat) || 0 }));   // eski kayıt: sepetten
  const netToplam = f && f.netNakit != null ? Number(f.netNakit) : (sale && sale.nakit != null ? Number(sale.nakit) : ks.reduce((a, k) => a + k.liste, 0));
  const paylar = adilPaylar(ks.map(k => k.liste), netToplam);
  const kalemler = ks.map((k, i) => {
    const u = urunler[i] && String(urunler[i].kod) === String(k.kod) ? urunler[i] : (urunler.find(x => String(x.kod) === String(k.kod)) || {});
    const pr = urunBul ? urunBul(k.kod) : null, marka = String((pr && (pr.Marka || pr.marka)) || u.marka || u.Marka || '');
    const gam = u.gam || (pr && (pr['Ürün Gamı'] || pr['Urun Gami'] || pr.gam)) || '';
    const sn = kalemSinifi(ayar, { kod: k.kod, gam, _hizmet: u._hizmet });
    const netKdvsiz = kdvsizYap(paylar[i], sn.kdv), listeKdvsiz = kdvsizYap(k.liste, sn.kdv);
    const prim = sn.tur === 'sigorta' && sn.sabit > 0 ? r2(sn.sabit) : r2(netKdvsiz * sn.oran / 100);
    return { kod: String(k.kod || ''), ad: String(k.urun || u.urun || '').slice(0, 80), gam: sn.gam, marka, tur: sn.tur, grup: sn.grup, liste: r2(k.liste), net: paylar[i], kdv: sn.kdv, listeKdvsiz, netKdvsiz, oran: sn.oran, prim };
  });
  const topla = (a, f2) => r2(a.reduce((s, x) => s + f2(x), 0));
  const personelInd = f ? (f.personelInisiyatifiIndirim != null ? Number(f.personelInisiyatifiIndirim) : (Number(f.urunIndirim) || 0) + (Number(f.altIndirim) || 0) + (Number(f.pazarlik) || 0)) : 0;
  const listeToplam = topla(ks, k => k.liste);
  return {
    v: 1, t: new Date().toISOString(), golgeKdv: ayar.kdv,
    kalemler, listeToplam, odenenToplam: r2(netToplam),
    kampInd: f ? r2(f.kampanyaIndirim || 0) : 0, personelInd: r2(personelInd),
    toplamKdvsiz: topla(kalemler, x => x.netKdvsiz),
    nitelikliKdvsiz: topla(kalemler.filter(x => x.grup === 'nitelikli'), x => x.netKdvsiz),
    verimsizKdvsiz: topla(kalemler.filter(x => x.grup === 'verimsiz'), x => x.netKdvsiz),
    brutPrim: topla(kalemler, x => x.prim)
  };
}

// ── Ekstra (ürüne özgü, tarihli) prim: o kalemin teslim gününe göre ──
export function ekstraTutar(ayar, kod, gun) {
  let t = 0; const liste = [];
  for (const e of ayar.ekstra || []) {
    if (e.aktif === false || String(e.kod).trim() !== String(kod).trim()) continue;
    if (!gunAraliktaMi(gun, e.bas, e.bit)) continue;
    t += sayiya(e.tutar); liste.push(e);
  }
  return { tutar: r2(t), liste };
}
// Bugün geçerli ekstra primler (vitrin rozeti için): kod → [{ad, tutar, bit}]
export function aktifEkstralar(ayar, gun) {
  const o = {};
  for (const e of ayar.ekstra || []) {
    if (e.aktif === false || !String(e.kod || '').trim() || !(sayiya(e.tutar) > 0) || !gunAraliktaMi(gun, e.bas, e.bit)) continue;
    (o[String(e.kod).trim()] = o[String(e.kod).trim()] || []).push({ ad: e.ad || '', tutar: sayiya(e.tutar), bit: e.bit || '' });
  }
  return o;
}

// ── Dönem eğrisi: ay içinde "şu ana kadar olması gereken" hedef oranı (0–1) ──
export function gunAgirliklari(ayar, ay) {
  const n = ayGunSayisi(ay);
  if (ayar.gunluk && Array.isArray(ayar.gunluk[ay.slice(5)]) && ayar.gunluk[ay.slice(5)].length === n) {   // Excel günlük satış serisi gelirse onunla beslenir
    const a = ayar.gunluk[ay.slice(5)].map(x => Math.max(0, Number(x) || 0)), T = a.reduce((s, x) => s + x, 0);
    if (T > 0) return a.map(x => x / T);
  }
  const w = new Array(n).fill(0); let onceki = 0, topPay = 0;
  const dilim = ayar.donem.slice().sort((x, y) => x.bitis - y.bitis);
  dilim.forEach((d, i) => {
    const bit = i === dilim.length - 1 ? n : Math.min(n, d.bitis), gun = bit - onceki;
    if (gun > 0) for (let g = onceki; g < bit; g++) w[g] = (Number(d.pay) || 0) / gun;
    topPay += Number(d.pay) || 0; onceki = Math.max(onceki, bit);
  });
  const T = w.reduce((s, x) => s + x, 0) || topPay || 1;
  return w.map(x => x / T);
}
export function beklenenOran(ayar, ay, gun) {   // gun: ayın kaçıncı günü (bugün dahil)
  const w = gunAgirliklari(ayar, ay), n = w.length, g = Math.max(0, Math.min(n, gun));
  return w.slice(0, g).reduce((s, x) => s + x, 0);
}

// ── Katsayı / verimlilik ──
export function indirimKatsayisi(ayar, kisiOran, ekipOran) {
  const fark = Math.max(0, (Number(kisiOran) || 0) - (Number(ekipOran) || 0));   // yüzde puan
  const k = Number(ayar.indirim.k) || 0, alt = Number(ayar.indirim.alt);
  return Math.min(1, Math.max(isFinite(alt) ? alt : 0.7, 1 - k * fark / 100));
}
export function verimlilikHesapla(ayar, hedefYuzde, nitelikliYuzde) {
  const a = Number(ayar.verimlilik.hedef), b = Number(ayar.verimlilik.nitelikli);
  return Math.max(0, Math.min(100, (a * Math.min(100, Math.max(0, hedefYuzde)) + b * Math.min(100, Math.max(0, nitelikliYuzde)))));
}

// ── AY HESABI ──
// kayitlar: [{ sale, damga?, teslimT }]  (damga yoksa o an hesaplanır → eski satışlar da hesaba girer)
// hedefler: { 'eposta': { ad, tutar, aylik:{'YYYY-MM':tutar} } }   bugun: ms (hesap anı)
export function aySonuc({ kayitlar, ayar: ayar0, hedefler, ay, bugun, urunBul }) {
  const ayar = ayarBirlestir(ayar0), H = hedefler || {}, n = ayGunSayisi(ay), simdi = bugun || Date.now();
  const bugunAy = ayStr(simdi), gun = bugunAy === ay ? Number(gunStr(simdi).slice(8, 10)) : (bugunAy > ay ? n : 0);
  const kisiler = {};
  const kisi = (em, ad) => (kisiler[em] = kisiler[em] || { email: em, ad: ad || em.split('@')[0], satisSayisi: 0, kdvsiz: 0, nitelikli: 0, verimsiz: 0, brut: 0, ekstra: 0, liste: 0, ind: 0, kalemler: [] });
  Object.keys(H).forEach(em => kisi(em.toLowerCase(), H[em].ad));
  for (const r of kayitlar || []) {
    const s = r.sale || {}, em = String(s.user || '').toLowerCase().trim(); if (!em) continue;
    const t = Number(r.teslimT) || Date.parse(s.ts) || 0; if (ayStr(t) !== ay) continue;
    const d = r.damga && r.damga.v ? r.damga : damga(s, ayar, urunBul), K = kisi(em, s.userAd);
    if (s.userAd && !H[em]) K.ad = s.userAd;
    K.satisSayisi++; K.kdvsiz = r2(K.kdvsiz + d.toplamKdvsiz); K.nitelikli = r2(K.nitelikli + d.nitelikliKdvsiz); K.verimsiz = r2(K.verimsiz + d.verimsizKdvsiz);
    K.brut = r2(K.brut + d.brutPrim); K.liste = r2(K.liste + d.listeToplam); K.ind = r2(K.ind + d.personelInd);
    for (const k of d.kalemler) { const e = ekstraTutar(ayar, k.kod, gunStr(t)); if (e.tutar > 0) { K.ekstra = r2(K.ekstra + e.tutar); } }
    K.kalemler.push({ saleNo: s.id || s.satisNo || '', t, d });
  }
  const liste = Object.values(kisiler);
  const topListe = liste.reduce((a, k) => a + k.liste, 0), topInd = liste.reduce((a, k) => a + k.ind, 0);
  const ekipInd = topListe > 0 ? topInd / topListe * 100 : 0;
  const bek = beklenenOran(ayar, ay, gun), kalanGun = Math.max(1, n - Math.max(gun, 1) + 1);
  for (const K of liste) {
    const h = H[K.email] || {}, hedef = sayiya(h.aylik && h.aylik[ay] != null ? h.aylik[ay] : h.tutar);
    K.hedef = hedef; K.hedefYuzde = hedef > 0 ? r2(K.kdvsiz / hedef * 100) : 0;
    K.nitelikliYuzde = K.kdvsiz > 0 ? r2(K.nitelikli / K.kdvsiz * 100) : 0;
    K.verimlilik = r2(verimlilikHesapla(ayar, K.hedefYuzde, K.nitelikliYuzde));
    K.indirimOrani = K.liste > 0 ? r2(K.ind / K.liste * 100) : 0; K.ekipIndirimOrani = r2(ekipInd);
    K.katsayi = r2(indirimKatsayisi(ayar, K.indirimOrani, ekipInd) * 1000) / 1000;
    const uygulanan = ayar.golge ? 1 : K.katsayi, brut = r2(K.brut + K.ekstra);
    K.brutToplam = brut;
    K.indirimEtkisi = r2(brut * (uygulanan - 1));
    const sonra = brut + K.indirimEtkisi;
    K.verimlilikEtkisi = r2(sonra * (K.verimlilik / 100) - sonra);
    K.onayKesinti = 0;   // Faz 4 (onay/askı) buraya yazacak
    K.hakEdis = r2(sonra + K.verimlilikEtkisi + K.onayKesinti);
    K.golgeHakEdis = r2(brut * K.katsayi * K.verimlilik / 100);   // gölge ay: indirim etkisi UYGULANSAYDI
    K.beklenenKdvsiz = r2(hedef * bek); K.konumFark = r2(K.kdvsiz - K.beklenenKdvsiz);
    K.gunlukGereken = hedef > 0 ? r2(Math.max(0, hedef - K.kdvsiz) / kalanGun) : 0;
  }
  liste.sort((a, b) => b.hakEdis - a.hakEdis || b.kdvsiz - a.kdvsiz);
  const aktif = liste.filter(k => k.hedef > 0 || k.satisSayisi > 0), N = aktif.length || 1;
  const ort = f2 => r2(aktif.reduce((s, k) => s + f2(k), 0) / N);
  aktif.forEach((k, i) => { k.sira = i + 1; });
  const ekip = { ay, gun, gunSayisi: n, kalanGun, beklenenOran: r2(bek * 100), kisiSayisi: aktif.length, indirimOrani: r2(ekipInd),
    ortVerimlilik: ort(k => k.verimlilik), ortHedefYuzde: ort(k => k.hedefYuzde), ortNitelikliYuzde: ort(k => k.nitelikliYuzde), golge: !!ayar.golge,
    toplamKdvsiz: r2(liste.reduce((a, k) => a + k.kdvsiz, 0)), toplamHedef: r2(liste.reduce((a, k) => a + k.hedef, 0)) };
  return { ekip, kisiler: aktif };
}

// ── Personelin okuyacağı TEK ÖZET doküman (başkasının TUTARI yok: yalnız sıra, ekip ortalaması %, lider baş harfi + %) ──
export function kisiOzeti(sonuc, k, simdi) {
  const E = sonuc.ekip, lider = sonuc.kisiler.slice().sort((a, b) => b.hedefYuzde - a.hedefYuzde)[0] || null;
  return {
    v: 1, email: k.email, ad: k.ad, ay: E.ay, guncelleme: simdi || Date.now(), golge: E.golge,
    kdvsiz: k.kdvsiz, nitelikliKdvsiz: k.nitelikli, verimsizKdvsiz: k.verimsiz, hedef: k.hedef, hedefYuzde: k.hedefYuzde, nitelikliYuzde: k.nitelikliYuzde, verimlilik: k.verimlilik,
    satisSayisi: k.satisSayisi, brutPrim: k.brutToplam, ekstraPrim: k.ekstra,
    indirimOrani: k.indirimOrani, ekipIndirimOrani: k.ekipIndirimOrani, katsayi: k.katsayi,
    indirimEtkisi: k.indirimEtkisi, verimlilikEtkisi: k.verimlilikEtkisi, onayKesinti: k.onayKesinti, hakEdis: k.hakEdis,
    beklenenKdvsiz: k.beklenenKdvsiz, konumFark: k.konumFark, gunlukGereken: k.gunlukGereken, kalanGun: E.kalanGun, gun: E.gun, gunSayisi: E.gunSayisi,
    sira: k.sira || 0, kisiSayisi: E.kisiSayisi, ekipOrtVerimlilik: E.ortVerimlilik, ekipOrtHedefYuzde: E.ortHedefYuzde, ekipOrtNitelikliYuzde: E.ortNitelikliYuzde,
    liderBas: lider ? String(lider.ad || '?').trim().charAt(0).toLocaleUpperCase('tr') + '.' : '', liderHedefYuzde: lider ? lider.hedefYuzde : 0
  };
}
export const ozetDocId = (ay, email) => ay + '__' + String(email).toLowerCase().replace(/[^a-z0-9]/g, '_');

// ── SEPET CANLI KOÇLUĞU ──
// sepet: [{kod, gam, nakit, itemDisc, _projeNakit, _hizmet}]. ozet: personelin ay özeti (opsiyonel; yoksa yalnız sepet).
export function sepetKocluk(sepet, ayar0, ozet, urunBul) {
  const ayar = ayarBirlestir(ayar0), liste = (sepet || []).filter(x => x && x.kod !== undefined);
  if (!liste.length) return null;
  let ciro = 0, nit = 0, vsz = 0, prim = 0, ekstra = 0; const bugun = gunStr(Date.now());
  for (const u of liste) {
    const pr = urunBul ? urunBul(u.kod) : null, gam = u.gam || (pr && (pr['Ürün Gamı'] || pr['Urun Gami'])) || '';
    const sn = kalemSinifi(ayar, { kod: u.kod, gam, _hizmet: u._hizmet }), l = Number(u.nakit || u.fiyat) || 0;
    const net = u._projeNakit !== undefined ? Number(u._projeNakit) || 0 : Math.max(0, l - (Number(u.itemDisc) || 0));
    const kz = kdvsizYap(net, sn.kdv); ciro += kz; if (sn.grup === 'nitelikli') nit += kz; else vsz += kz;
    prim += sn.tur === 'sigorta' && sn.sabit > 0 ? sn.sabit : kz * sn.oran / 100; ekstra += ekstraTutar(ayar, u.kod, bugun).tutar;
  }
  const yuzde = ciro > 0 ? nit / ciro * 100 : 0;
  const o = { ciro: r2(ciro), nitelikli: r2(nit), verimsiz: r2(vsz), nitelikliYuzde: r2(yuzde), brutPrim: r2(prim + ekstra), ekstraPrim: r2(ekstra), oneri: null };
  if (vsz > 0 && yuzde < 100) {   // IT/Elektronik var → ekran koruyucu / sigorta / aksesuar önerisi
    const ekle = Math.max(300, r2(vsz * 0.1)), aks = ayar.gamlar.Aksesuar ? sayiya(ayar.gamlar.Aksesuar.oran) : 11, ekleKz = kdvsizYap(ekle, ayar.kdv);
    const yeni = (nit + ekleKz) / (ciro + ekleKz) * 100;
    let artis = r2(ayar.verimlilik.nitelikli * (yeni - yuzde)), kaynak = 'sepet';
    if (ozet && Number(ozet.kdvsiz) >= 0) {   // ay toplamına göre gerçek etki
      const eskiA = ozet.kdvsiz + ciro > 0 ? (ozet.nitelikliKdvsiz + nit) / (ozet.kdvsiz + ciro) * 100 : 0, yeniA = (ozet.nitelikliKdvsiz + nit + ekleKz) / (ozet.kdvsiz + ciro + ekleKz) * 100;
      artis = r2(ayar.verimlilik.nitelikli * (yeniA - eskiA)); kaynak = 'ay';
    }
    o.oneri = { tutar: ekle, nitelikliYuzdeSonra: r2(yeni), verimlilikArtis: artis, kaynak, primArtis: r2(ekleKz * aks / 100) };
  }
  return o;
}

// ── KAPANIŞ RAPORU (mağaza kapanış noktaları) ──
// Satış noktası: satış kaydının satisNoktasi'ı; markaya göre ayrılan noktalarda (örn. NF → S-NF / V-NF) KALEM markasına göre bölünür.
export function noktaAdlari(ayar0) { const a = ayarBirlestir(ayar0), o = []; a.noktalar.forEach(n => { o.push(n.ad); (n.ayir || []).forEach(x => o.push(x.ad)); }); return o; }
export function kalemNoktasi(ayar, noktaAd, marka) {
  const tanimli = ayar.noktalar.find(n => norm(n.ad) === norm(noktaAd));
  if (!tanimli) return 'Diğer';
  for (const x of tanimli.ayir || []) if ((x.markalar || []).some(m => norm(m) === norm(marka))) return x.ad;
  return tanimli.ad;
}
export function kapanisRaporu(kayitlar, ayar0, gun, urunBul, tarihAlani) {
  const ayar = ayarBirlestir(ayar0), noktalar = {}, kisiToplam = {};
  const al = (ad) => (noktalar[ad] = noktalar[ad] || { nokta: ad, kdvsiz: 0, adet: 0, brutPrim: 0, saleler: new Set(), kisiler: {} });
  noktaAdlari(ayar).forEach(al);
  for (const r of kayitlar || []) {
    const s = r.sale || {}, t = tarihAlani === 'satis' ? Date.parse(s.ts) : (Number(r.teslimT) || Date.parse(s.ts)); if (!t || gunStr(t) !== gun) continue;
    const d = r.damga && r.damga.v ? r.damga : damga(s, ayar, urunBul), ad = String(s.userAd || (s.user || '').split('@')[0] || '?');
    for (const k of d.kalemler) {
      const N = al(kalemNoktasi(ayar, s.satisNoktasi || 'Diğer', k.marka));
      N.kdvsiz = r2(N.kdvsiz + k.netKdvsiz); N.brutPrim = r2(N.brutPrim + k.prim); N.adet++; N.saleler.add(s.id || s.satisNo);
      N.kisiler[ad] = r2((N.kisiler[ad] || 0) + k.netKdvsiz);
      const T = (kisiToplam[ad] = kisiToplam[ad] || { ad, kdvsiz: 0, brutPrim: 0 }); T.kdvsiz = r2(T.kdvsiz + k.netKdvsiz); T.brutPrim = r2(T.brutPrim + k.prim);
    }
  }
  const liste = Object.values(noktalar).map(n => ({ nokta: n.nokta, kdvsiz: n.kdvsiz, adet: n.adet, satisSayisi: n.saleler.size, brutPrim: n.brutPrim, kisiler: n.kisiler }));
  return { gun, noktalar: liste, kisiler: Object.values(kisiToplam).sort((a, b) => b.kdvsiz - a.kdvsiz), toplam: r2(liste.reduce((a, n) => a + n.kdvsiz, 0)) };
}
