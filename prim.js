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
// V12.3: İKİ KATMAN — (1) ürün gamı → kategori, (2) kategori → grup/oran/KDV. Ürün satırında yalnız ince "Ürün Gamı" (Blender, Ütü, Tv…) vardır;
// eski Excel sistemi oranı KATEGORİYE göre uyguluyordu (Aksesuar %11, Küçük Ev %0,9, Beyaz Eşya/Ankastre/Klima %0,7, Elektronik/IT %0,2).
const KATEGORILER = {
  'AKSESUAR': { grup: 'nitelikli', oran: 11 }, 'ANKASTRE': { grup: 'nitelikli', oran: 0.7 }, 'BEYAZ EŞYA': { grup: 'nitelikli', oran: 0.7 },
  'KLİMA': { grup: 'nitelikli', oran: 0.7 }, 'KÜÇÜK EV ALETLERİ': { grup: 'nitelikli', oran: 0.9 },
  'IT': { grup: 'verimsiz', kume: 'IT', oran: 0.2 }, 'ELEKTRONİK': { grup: 'verimsiz', kume: 'Elektronik', oran: 0.2 }
};
// gam-kategori-haritasi.csv (1.xls'ten çıkarıldı) + eski varsayılan gam adları. "Bulaşık Makinesi" Excel'de hem BEYAZ EŞYA hem ANKASTRE geçiyor; ikisi de %0,7 + nitelikli → prim etkilenmez.
const GAM_KATEGORI = {"Akıllı Priz": "AKSESUAR", "Askı Aparatı": "AKSESUAR", "Ekran Koruyucu": "AKSESUAR", "Ekran Temizleyici": "AKSESUAR", "Kulaklık": "AKSESUAR", "Kılıf": "AKSESUAR", "Süpürge Aparatı": "AKSESUAR", "Tablet Koruyucu": "AKSESUAR", "Tablet Kılıfı": "AKSESUAR", "Şarj Adaptörü": "AKSESUAR", "Şarj Cihazı": "AKSESUAR", "Şarj Kablosu": "AKSESUAR", "Ankastre Bulaşık Makinesi": "ANKASTRE", "Ankastre Davlumbaz": "ANKASTRE", "Ankastre Fırın": "ANKASTRE", "Ankastre Ocak": "ANKASTRE", "Bulaşık Makinesi": "BEYAZ EŞYA", "Buzdolabı": "BEYAZ EŞYA", "Dondurucu": "BEYAZ EŞYA", "Isıtıcı": "BEYAZ EŞYA", "Kurutma Makinesi": "BEYAZ EŞYA", "Mikrodalga": "BEYAZ EŞYA", "Çamaşır Makinesi": "BEYAZ EŞYA", "Tv": "ELEKTRONİK", "Akıllı Saat": "IT", "Cep Telefonu": "IT", "Tablet": "IT", "Klima": "KLİMA", "Blender": "KÜÇÜK EV ALETLERİ", "Blender Set": "KÜÇÜK EV ALETLERİ", "Dikey Süpürge": "KÜÇÜK EV ALETLERİ", "Doğrayıcı": "KÜÇÜK EV ALETLERİ", "Epilasyon": "KÜÇÜK EV ALETLERİ", "Erkek Bakım Seti": "KÜÇÜK EV ALETLERİ", "Süpürge": "KÜÇÜK EV ALETLERİ", "Tartı": "KÜÇÜK EV ALETLERİ", "Tost Makinesi": "KÜÇÜK EV ALETLERİ", "Çaycı": "KÜÇÜK EV ALETLERİ", "Ütü": "KÜÇÜK EV ALETLERİ", "BT Kulaklık": "IT", "Saat Kayışı": "IT", "Yazar Kasa": "ELEKTRONİK", "Araç Şarj": "ELEKTRONİK", "Projeksiyon": "ELEKTRONİK", "Ses Sistemi": "ELEKTRONİK", "Hoparlör": "ELEKTRONİK", "Monitör": "ELEKTRONİK", "Smart Monitör": "ELEKTRONİK"};
const OLD_DEF = { 'Aksesuar': 11, 'Ankastre': 0.7, 'Beyaz Eşya': 0.7, 'Klima': 0.7, 'Küçük Ev Aletleri': 0.7, 'Akıllı Saat': 0.2, 'BT Kulaklık': 0.2, 'Saat Kayışı': 0.2, 'Tablet': 0.2, 'Cep Telefonu': 0.2, 'Yazar Kasa': 0.2, 'Araç Şarj': 0.2, 'TV': 0.2, 'Projeksiyon': 0.2, 'Ses Sistemi': 0.2, 'Hoparlör': 0.2, 'Monitör': 0.2, 'Smart Monitör': 0.2 };
export function varsayilanAyar() {
  return {
    surum: 2,
    personelEkran: false,                          // true olunca personelde "Puan Durumum" + sepet koçluğu açılır (Admin → Ayarlar; varsayılan KAPALI = hiçbir görünür değişiklik yok)
    disSay: true,                                  // V12.4: dış ödeme (Samsung ❖ proje fiyatı / 3P) prim ve hedefe SEPET fiyatıyla sayılır
    selale: true,                                  // V12.4: indirim/eksik tutar EN YÜKSEK primli kalemden düşer (kalem en az 1 ₺'ye kadar); fazla tutar en yüksek primli kaleme eklenir. false → liste oranında (eski)
    sevkiyatsizSay: false,                         // true → sevkiyat kaydı HİÇ açılmamış satışlar (elden/aksesuar vb.) SATIŞ tarihiyle sayılır
    golge: true,                                   // ilk ay: indirim etkisi hak edişe UYGULANMAZ (yalnız Admin görür)
    kdv: 20,                                       // varsayılan KDV %
    kategoriler: JSON.parse(JSON.stringify(KATEGORILER)),   // { 'AKSESUAR': { grup, oran(%), kume?, kdv? } }
    gamKategori: { ...GAM_KATEGORI },              // { 'Blender': 'KÜÇÜK EV ALETLERİ' }
    gamlar: {},                                    // gama ÖZEL istisna (kategoriyi ezer): { 'Blender': { grup, oran(%), kdv? } }
    grupOran: { nitelikli: 0.7, verimsiz: 0.2 },   // gamı tanımsız ürünler için
    urunler: {},                                   // { 'KOD': { oran?, kdv? } }
    sigorta: { oran: 0, sabit: 0, kdv: 20 },       // oran % (KDV'siz tutar üzerinden) VEYA sabit ₺/adet (>0 ise o kullanılır)
    ekstra: [],                                    // [{ id, kod, ad, tutar, bas:'YYYY-MM-DD', bit:'YYYY-MM-DD', aktif:true }]
    // V12.6: verimlilik YÜZDESİ (0,4×hedef + 0,6×nitelikli) hesaplanır; ÖDENEN ORAN kademeli baremle belirlenir. mod: 'barem' | 'surekli' (oran = verimlilik %) | 'v85' (verimlilik/85, en çok %100)
    // hedefTaban: hedefi tutturan (hedef ≥ %100) kişide ödenen oran en az bu kadar (0 = kapalı)
    verimlilik: { hedef: 0.4, nitelikli: 0.6, mod: 'barem', baremler: [{ esik: 85, oran: 100 }, { esik: 75, oran: 85 }, { esik: 65, oran: 75 }, { esik: 50, oran: 70 }], hedefTaban: 90 },
    puanKatsayisi: 0.1,                            // V12.6: personel ekranında 1 ₺ hak ediş = 0,1 puan (₺ değil PUAN gösterilir)
    destek: { aktif: false, min: 85, max: 115, anketAgirlik: 40 },   // V12.11: destek ekibi puanı — satış ekibi ortalamasının %min–%max'ı; skoru anket (satış ekibi) + yönetici görünüm puanı belirler
    gorunum: { acik: true, tavan: 10, olumlu: false, bonusTavan: 5 },   // V12.6: görünüm / gizli müşteri çarpanı (admin girer; hak edişten düşer)
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
  o.gamlar = { ...(k.gamlar || {}) };
  if (!(Number(k.surum) >= 2)) Object.keys(o.gamlar).forEach(g => { const x = o.gamlar[g]; if (g in OLD_DEF && x && sayiya(x.oran) === OLD_DEF[g]) delete o.gamlar[g]; });   // V12.2'den kalan eski varsayılan gam satırları kategori kuralını ezmesin
  o.kategoriler = { ...v.kategoriler }; Object.keys(k.kategoriler || {}).forEach(c => { o.kategoriler[c] = { ...(v.kategoriler[c] || {}), ...k.kategoriler[c] }; });
  o.gamKategori = { ...v.gamKategori, ...(k.gamKategori || {}) };
  o.surum = 2;
  o.grupOran = { ...v.grupOran, ...(k.grupOran || {}) };
  o.sigorta = { ...v.sigorta, ...(k.sigorta || {}) };
  o.verimlilik = { ...v.verimlilik, ...(k.verimlilik || {}) };
  o.verimlilik.baremler = Array.isArray(o.verimlilik.baremler) && o.verimlilik.baremler.length ? o.verimlilik.baremler.map(b => ({ esik: Number(b.esik) || 0, oran: Number(b.oran) || 0 })).sort((a, b) => b.esik - a.esik) : v.verimlilik.baremler;
  o.gorunum = { ...v.gorunum, ...(k.gorunum || {}) };
  o.destek = { ...v.destek, ...(k.destek || {}) };
  o.puanKatsayisi = Number(k.puanKatsayisi) > 0 ? Number(k.puanKatsayisi) : v.puanKatsayisi;
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
  const n = norm(gam); let bulunan = null, ad = '', kategori = '';
  for (const g of Object.keys(ayar.gamlar)) if (norm(g) === n) { bulunan = ayar.gamlar[g]; ad = g; break; }   // 1) gama özel istisna
  if (!bulunan && n) {   // 2) gam → kategori → oran
    for (const g of Object.keys(ayar.gamKategori)) if (norm(g) === n) { kategori = ayar.gamKategori[g]; break; }
    if (!kategori) for (const c of Object.keys(ayar.kategoriler)) if (norm(c) === n) { kategori = c; break; }   // gam adı doğrudan kategori adıysa
    const kc = kategori ? Object.keys(ayar.kategoriler).find(c => norm(c) === norm(kategori)) : null;
    if (kc) { bulunan = ayar.kategoriler[kc]; ad = String(gam || kc); kategori = kc; }
  }
  if (bulunan) {
    const grup = bulunan.grup === 'verimsiz' ? 'verimsiz' : 'nitelikli';
    return { ad, kategori, grup, oran: sayiya(bulunan.oran ?? ayar.grupOran[grup]), kdv: bulunan.kdv != null && bulunan.kdv !== '' ? sayiya(bulunan.kdv) : null, bilinmiyor: false };
  }
  // Tanımsız gam: bilinmeyenler nitelikli sayılır; Admin ekranında "tanımsız gam" uyarısı çıkar
  return { ad: String(gam || ''), kategori: '', grup: 'nitelikli', oran: sayiya(ayar.grupOran.nitelikli), kdv: null, bilinmiyor: true };
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
    kdv: ur && ur.kdv != null && ur.kdv !== '' ? sayiya(ur.kdv) : (g.kdv != null ? g.kdv : sayiya(ayar.kdv)), gam: g.ad || String(kalem.gam || ''), kategori: g.kategori || '', bilinmiyor: g.bilinmiyor };
}
// V12.3: v:1 damgaları (V12.0–V12.2) gam→kategori hatasıyla damgalanmıştı (Aksesuar %0,7 vb.) → geçersiz sayılır, güncel ayarla yeniden hesaplanır
export const damgaGecerli = d => (d && Number(d.v) >= 10 ? d : null);   // V12.4: v:3 = şelale dağıtımı · V12.7: v:6 = dış ödeme ❖ farkı da kampanya · v:5 = kampanya işareti ürün açıklamasından da okunur · V12.6c: v:4 = kampanya fiyatlı kalem (❖/✦/⌗/⎇) kendi fiyatıyla sayılır → eski damgalar yeniden hesaplanır
export const kdvsizYap = (tutar, kdv) => r2(Number(tutar) / (1 + (Number(kdv) || 0) / 100));

// ── Adil pay: toplam ödemeyi kalemlere LİSTE oranında dağıt (son kalem kuruş farkını alır) ──
export function adilPaylar(listeler, netToplam) {
  const L = listeler.map(x => Math.max(0, Number(x) || 0)), T = L.reduce((a, b) => a + b, 0), n = L.length, net = Math.max(0, Number(netToplam) || 0);
  if (!n) return [];
  const pay = L.map(l => r2(T > 0 ? net * l / T : net / n));
  const fark = r2(net - pay.reduce((a, b) => a + b, 0)); pay[n - 1] = r2(pay[n - 1] + fark);
  return pay;
}

// ── V12.4 ŞELALE: toplam ödeme (net), kalemlere "en yüksek primli kalemden başlayarak" dağıtılır ──
// net < liste toplamı → eksik tutar en yüksek oranlı kalemden düşer (kalem en az min(1, liste) ₺'ye kadar), sonra sıradaki; net > liste → fazla en yüksek oranlı kaleme eklenir.
// sira: kalem başına öncelik (yüksek = önce düşer); eşitlikte yüksek liste önce. Sabit primli (sigorta) kalemler en sona konur (fiyatları kesinti emmez).
export function selalePaylar(listeler, oranlar, netToplam, sabitler) {
  const L = listeler.map(x => Math.max(0, Number(x) || 0)), n = L.length, net = Math.max(0, Number(netToplam) || 0);
  if (!n) return [];
  const T = L.reduce((a, b) => a + b, 0), pay = L.slice(), fark = r2(net - T);
  if (Math.abs(fark) < 0.005) return pay.map(r2);
  const sira = L.map((_l, i) => i).sort((a, b) => ((sabitler && sabitler[a] ? 1 : 0) - (sabitler && sabitler[b] ? 1 : 0)) || (Number(oranlar[b]) || 0) - (Number(oranlar[a]) || 0) || L[b] - L[a] || a - b);
  if (fark > 0) { pay[sira[0]] = r2(pay[sira[0]] + fark); return pay.map(r2); }
  let kalan = -fark;
  for (const i of sira) { if (kalan <= 0) break; const taban = Math.min(1, L[i]), al = Math.min(kalan, Math.max(0, pay[i] - taban)); pay[i] = r2(pay[i] - al); kalan = r2(kalan - al); }
  if (kalan > 0) for (const i of sira) { if (kalan <= 0) break; const al = Math.min(kalan, pay[i]); pay[i] = r2(pay[i] - al); kalan = r2(kalan - al); }   // hepsi taban 1 ₺'de: kalan tutar da düşer
  return pay.map(r2);
}

// ── DAMGA: satış kaydına yazılacak prim özeti (sonradan oran/gam değişse geçmiş KAYMAZ) ──
// sale: kaydedilmiş satış ({ fiyat:{kalemler,netNakit,...}, urunler, nakit }); urunBul(kod) → ürün satırı | null (marka için)
export function damga(sale, ayar0, urunBul) {
  const ayar = ayarBirlestir(ayar0), f = sale && sale.fiyat ? sale.fiyat : null;
  let ks = f && Array.isArray(f.kalemler) && f.kalemler.length ? f.kalemler.map(k => ({ kod: k.kod, urun: k.urun, adet: Number(k.adet) > 0 ? Number(k.adet) : 1, liste: Number(k.liste) || 0, dis: k.dis === true, net: Number(k.net) || 0 })) : null;
  const urunler = Array.isArray(sale && sale.urunler) ? sale.urunler : [];
  if (!ks) ks = urunler.map(u => ({ kod: u.kod, urun: u.urun, adet: Number(u.adet) > 0 ? Number(u.adet) : 1, liste: Number(u.nakit || u.fiyat) || 0 }));   // eski kayıt: sepetten
  const netToplam = f && f.netNakit != null ? Number(f.netNakit) : (sale && sale.nakit != null ? Number(sale.nakit) : ks.reduce((a, k) => a + k.liste, 0));
  const ozet = ks.map(k => { const u0 = urunler.find(x => String(x.kod) === String(k.kod)) || {}, pr0 = urunBul ? urunBul(k.kod) : null; return kalemSinifi(ayar, { kod: k.kod, gam: u0.gam || (pr0 && (pr0['Ürün Gamı'] || pr0['Urun Gami'] || pr0.gam)) || '', _hizmet: u0._hizmet }); });
  // V12.4: DIŞ ÖDEME (Samsung ❖ proje fiyatı / 3P tahsilat): müşteri bunu mağazaya değil firmaya öder → netNakit'te YOKTU, kalemin payı ~0 çıkıyordu (prim eksik).
  // Kullanıcı kararı: prim/hedef SEPET fiyatından. ❖ kalemler kendi proje fiyatıyla (k.net) sayılır; elle 3P tahsilatın nakit değeri de diğer kalemlere eklenir. ayar.disSay=false → eski.
  const disSay = ayar.disSay !== false && !!f, disKalem = ks.map(k => disSay && k.dis && k.net > 0);
  const elleDis = disSay && f && Array.isArray(f.dis) ? f.dis.filter(d => d && d.tur !== 'proje').reduce((a, d) => a + (Number(d.nakit != null ? d.nakit : d.tutar) || 0), 0) : 0;
  // V12.6c: KAMPANYA FİYATLI KALEM (❖ ✦ ⌗ ⎇ etiketli, ör. "❖ EA+SFS"): eski kayıtlarda fark kalem.indirim/urunIndirim olarak yazılmış, kampanyaIndirim ve dis işareti yok →
  // motor farkı PERSONEL indirimi sanıp en yüksek primli kalemden (aksesuar) düşüyordu. Kalem kendi kampanya fiyatıyla (net) sayılır; fark marka tarafından karşılanır, diğer kalemlerden düşülmez.
  const KAMP_ISARET = /[❖✦⌗⎇]/, kkKalem = (f && Array.isArray(f.kalemler) && f.kalemler.length === ks.length) ? ks.map((k, i) => !disKalem[i] && !!f.kalemler[i] && f.kalemler[i].dis !== true && KAMP_ISARET.test(String(f.kalemler[i].kampanya || '') + ' ' + String((urunler.find(x => String(x.kod) === String(k.kod)) || {}).aciklama || '')) && k.net > 0 && k.net < k.liste) : ks.map(() => false);
  const kkFark = ks.reduce((a2, k, i) => a2 + (kkKalem[i] ? k.liste - k.net : 0), 0), kkNet = ks.reduce((a2, k, i) => a2 + (kkKalem[i] ? k.net : 0), 0);
  const idx = ks.map((_k, i) => i).filter(i => !disKalem[i] && !kkKalem[i]), dagit = (l, o, n, sb) => (ayar.selale === false ? adilPaylar(l, n) : selalePaylar(l, o, n, sb));
  const paylar = new Array(ks.length).fill(0);
  disKalem.forEach((d, i) => { if (d) paylar[i] = r2(ks[i].net); });
  kkKalem.forEach((d, i) => { if (d) paylar[i] = r2(ks[i].net); });
  // V12.5: KAMPANYA indirimi (⌗/⎇/❖ — marka karşılar) şirkete zarar değildir → şelale onu "en yüksek primliden düşme" olarak görmez; kalemlere liste oranında yayılır.
  // Şelale yalnız ŞİRKETİN karşıladığı indirimi (satır/alt indirim, pazarlık, elle fiyat çekme) en yüksek primli kalemden düşer.
  const kampTop = f ? Math.max(0, Number(f.kampanyaIndirim) || 0) : 0, disFark = ks.reduce((a2, k, i) => a2 + (disKalem[i] ? Math.max(0, k.liste - k.net) : 0), 0);
  const kampKalan = Math.max(0, kampTop - disFark - kkFark), listeIdx = idx.map(i => ks[i].liste), listeTop = listeIdx.reduce((a2, b2) => a2 + b2, 0);
  const kampKat = listeTop > 0 && kampKalan > 0 && kampKalan < listeTop ? 1 - kampKalan / listeTop : 1;
  const kalanPay = dagit(listeIdx.map(x => x * kampKat), idx.map(i => ozet[i].oran), netToplam + elleDis - kkNet, idx.map(i => ozet[i].tur === 'sigorta' && ozet[i].sabit > 0));
  idx.forEach((i, j) => { paylar[i] = kalanPay[j]; });
  // V12.7: kampanya fiyatlı kalemlerin (kendi net fiyatı) toplamı, ödenen toplamı (netNakit + dış) AŞIYORSA → fark (elle fiyat çekme / pazarlık) bu kalemlerden de düşülür (şelale: en yüksek primli önce).
  // Aksi halde paylar toplamı ödenenden büyük kalır, aradaki fark "dış ödeme sepete eklendi" sanılırdı ve prim şişerdi.
  if (kkNet > 0 && kkNet > netToplam + elleDis + 0.5) {
    const hepsi = ks.map((_k, i) => i).filter(i => !disKalem[i]), taban = hepsi.map(i => kkKalem[i] ? ks[i].net : ks[i].liste * kampKat);
    const yeni = selalePaylar(taban, hepsi.map(i => ozet[i].oran), netToplam + elleDis, hepsi.map(i => ozet[i].tur === 'sigorta' && ozet[i].sabit > 0));
    hepsi.forEach((i, j) => { paylar[i] = yeni[j]; });
  }
  const disToplam = r2(paylar.reduce((a, b) => a + b, 0) - netToplam);   // sepete eklenen dış ödeme (bilgi)
  const kalemler = ks.map((k, i) => {
    const u = urunler[i] && String(urunler[i].kod) === String(k.kod) ? urunler[i] : (urunler.find(x => String(x.kod) === String(k.kod)) || {});
    const pr = urunBul ? urunBul(k.kod) : null, marka = String((pr && (pr.Marka || pr.marka)) || u.marka || u.Marka || '');
    const gam = u.gam || (pr && (pr['Ürün Gamı'] || pr['Urun Gami'] || pr.gam)) || '';
    const sn = kalemSinifi(ayar, { kod: k.kod, gam, _hizmet: u._hizmet });
    const netKdvsiz = kdvsizYap(paylar[i], sn.kdv), listeKdvsiz = kdvsizYap(k.liste, sn.kdv);
    const prim = sn.tur === 'sigorta' && sn.sabit > 0 ? r2(sn.sabit) : r2(netKdvsiz * sn.oran / 100);
    // V12.8: özel ürün primi indirim kesintisi — kalemin ÖDENEN payı, kampanya sonrası (marka karşıladığı indirim hariç) listesine göre; 1 = indirimsiz
    const kampListe = disKalem[i] || kkKalem[i] ? ks[i].net : ks[i].liste * kampKat, ozelKat = kampListe > 0 ? Math.max(0, Math.min(1, Math.round(paylar[i] / kampListe * 10000) / 10000)) : 1;
    return { kod: String(k.kod || ''), adet: k.adet || 1, ozelKat, ad: String(k.urun || u.urun || '').slice(0, 80), gam: sn.gam, kategori: sn.kategori || '', marka, tur: sn.tur, grup: sn.grup, liste: r2(k.liste), net: paylar[i], kdv: sn.kdv, listeKdvsiz, netKdvsiz, oran: sn.oran, prim };
  });
  const topla = (a, f2) => r2(a.reduce((s, x) => s + f2(x), 0));
  let personelInd = f ? (f.personelInisiyatifiIndirim != null ? Number(f.personelInisiyatifiIndirim) : (Number(f.urunIndirim) || 0) + (Number(f.altIndirim) || 0) + (Number(f.pazarlik) || 0)) : 0;
  let kampIndSon = f ? Number(f.kampanyaIndirim) || 0 : 0;
  // V12.7: DIŞ ÖDEME (proje/❖) kaleminin liste→net farkı da kampanya (marka sübvansiyonu) sayılır; kayıtta kampanyaIndirim yoksa personel indirimi sanılmaz
  const disKampFark = f && Array.isArray(f.kalemler) && f.kalemler.length === ks.length ? ks.reduce((a2, k, i) => {
    if (!disKalem[i]) return a2;
    const fk = f.kalemler[i] || {}, projeMi = Array.isArray(f.dis) && f.dis.some(d => d && d.tur === 'proje' && String(d.urun) === String(k.kod));
    return a2 + ((KAMP_ISARET.test(String(fk.kampanya || '') + ' ' + String((urunler.find(x => String(x.kod) === String(k.kod)) || {}).aciklama || '')) || projeMi) ? Math.max(0, k.liste - k.net) : 0);
  }, 0) : 0;
  const kampSecili = urunler.reduce((a2, u) => a2 + Math.max(0, Number(u && u._campDisc) || 0), 0);   // V12.7: sepette UYGULANMIŞ kampanya (⌗/⎇/❖) tutarı
  const kampToplam = Math.max(kkFark + disKampFark, kampSecili);
  if (kampToplam > kampIndSon) { const ek = kampToplam - kampIndSon; kampIndSon = kampToplam; if (f && f.personelInisiyatifiIndirim == null) personelInd = Math.max(0, personelInd - ek); }   // V12.6c: kampanya farkı personel indirimi sayılmaz
  // V12.4: ELLE FİYAT ÇEKME — satırın fiyatı elle düşürülmüş (yeni kayıt: kalem.elleFiyat) ya da eski kayıtta satırlar toplamı ≠ net nakit (satır eski liste fiyatında kalmış). Primde ve ekranda GÖRÜNÜR; personelin elle indirimine sayılır.
  let fiyatCekme = 0, cekmeDahil = false;
  if (f && Array.isArray(f.kalemler) && f.kalemler.length) {
    const ef = f.kalemler.reduce((a, k) => a + (Number(k.elleFiyat) || 0), 0);
    if (ef !== 0) fiyatCekme = r2(ef);
    else if (!(Array.isArray(f.dis) && f.dis.length)) {
      const bek = f.kalemler.reduce((a, k) => a + (Number(k.net) || 0), 0) - (Number(f.altIndirim) || 0) - (Number(f.pazarlik) || 0), fark = r2(bek - netToplam);
      if (fark >= 1) { fiyatCekme = fark; if (f.personelInisiyatifiIndirim != null) { personelInd += fark; cekmeDahil = true; } }
    } else {
      // V12.7: DIŞ ÖDEMELİ (❖ proje) satışta yanındaki mamuller bedelsiz/indirimli çıkmışsa (kalem fiyatları > ödenen) fark ŞİRKET zararıdır → indirim
      const bek = f.kalemler.reduce((a, k) => a + (k && k.dis !== true ? (Number(k.net) || 0) : 0), 0) - (Number(f.altIndirim) || 0) - (Number(f.pazarlik) || 0), fark = r2(bek - (netToplam + elleDis));
      if (fark >= 1) { fiyatCekme = fark; if (f.personelInisiyatifiIndirim != null) { personelInd += fark; cekmeDahil = true; } }
    }
  }
  const listeToplam = topla(ks, k => k.liste);
  return {
    v: 10, t: new Date().toISOString(), golgeKdv: ayar.kdv,
    kalemler, listeToplam, odenenToplam: r2(netToplam), sepetToplam: r2(paylar.reduce((a, b) => a + b, 0)), disSayilan: disToplam > 0.005 ? disToplam : 0,
    kampInd: f ? r2(kampIndSon) : 0, personelInd: r2(personelInd), fiyatCekme, cekmeDahil,
    toplamKdvsiz: topla(kalemler, x => x.netKdvsiz),
    nitelikliKdvsiz: topla(kalemler.filter(x => x.grup === 'nitelikli'), x => x.netKdvsiz),
    verimsizKdvsiz: topla(kalemler.filter(x => x.grup === 'verimsiz'), x => x.netKdvsiz),
    brutPrim: topla(kalemler, x => x.prim)
  };
}

// ── Ekstra (ürüne özgü, tarihli) prim: o kalemin teslim gününe göre ──
export function ekstraTutar(ayar, kod, gun) {
  // V12.8: mod 'ek' (varsayılan) = normal primin ÜSTÜNE eklenir · mod 'tekil' = normal prim yerine yalnız bu tutar (₺ / adet) verilir
  let t = 0, tekil = 0; const liste = [];
  for (const e of ayar.ekstra || []) {
    if (e.aktif === false || String(e.kod).trim() !== String(kod).trim()) continue;
    if (!gunAraliktaMi(gun, e.bas, e.bit)) continue;
    if (e.mod === 'tekil') tekil = Math.max(tekil, sayiya(e.tutar)); else t += sayiya(e.tutar);
    liste.push(e);
  }
  return { tutar: r2(t), tekil: r2(tekil), liste };
}
// V12.8: bir satışın (damga) özel ürün primi — adet ile çarpılır, kalem indirimliyse aynı oranda (ozelKat) düşer; tekil modda normal kalem primi düşülür.
export function ozelHesap(ayar, d, gun) {
  let ek = 0, ham = 0, dus = 0;
  for (const k of (d && d.kalemler) || []) {
    const e = ekstraTutar(ayar, k.kod, gun), adet = Number(k.adet) > 0 ? Number(k.adet) : 1, kat = k.ozelKat != null ? Number(k.ozelKat) : 1;
    const toplam = (e.tutar + e.tekil) * adet; if (!(toplam > 0)) continue;
    ham += toplam; ek += toplam * kat; if (e.tekil > 0) dus += Number(k.prim) || 0;
  }
  return { ek: r2(ek), ham: r2(ham), dus: r2(dus) };
}
// V12.8: vitrin / sepet için ÜRÜN primi (₺, KDV'siz nakit × gam oranı) — Excel'deki Prim sütunu yerine PWA kendi hesaplar. Aktif tekil özel prim varsa o geçerlidir.
export function urunPrimi(ayar0, u, gun) {
  const ayar = ayarBirlestir(ayar0), kod = u && (u.Kod != null ? u.Kod : u.kod), gam = (u && (u['Ürün Gamı'] || u['Urun Gami'] || u.gam)) || '', nakit = Number(u && (u.Nakit != null ? u.Nakit : (u.nakit != null ? u.nakit : u.fiyat))) || 0;
  const e = ekstraTutar(ayar, kod, gun || gunStr(Date.now()));
  if (e.tekil > 0) return { prim: e.tekil, tekil: true };
  const sn = kalemSinifi(ayar, { kod, gam, _hizmet: false });
  return { prim: sn.tur === 'sigorta' && sn.sabit > 0 ? r2(sn.sabit) : r2(kdvsizYap(nakit, sn.kdv) * sn.oran / 100), tekil: false };
}
// Bugün geçerli ekstra primler (vitrin rozeti için): kod → [{ad, tutar, bit}]
export function aktifEkstralar(ayar, gun) {
  const o = {};
  for (const e of ayar.ekstra || []) {
    if (e.aktif === false || !String(e.kod || '').trim() || !(sayiya(e.tutar) > 0) || !gunAraliktaMi(gun, e.bas, e.bit)) continue;
    (o[String(e.kod).trim()] = o[String(e.kod).trim()] || []).push({ ad: e.ad || '', tutar: sayiya(e.tutar), bit: e.bit || '', mod: e.mod === 'tekil' ? 'tekil' : 'ek' });
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

// V12.6: verimlilik % → ÖDENEN ORAN %. v: verimlilik yüzdesi, hedefYuzde: hedefin gerçekleşme %'si. mod verilmezse ayardan okunur.
export function odemeOrani(ayar0, v, hedefYuzde, modZorla, baremZorla, tabanZorla) {
  const ayar = ayarBirlestir(ayar0), V = ayar.verimlilik, mod = modZorla || V.mod || 'barem', x = Math.max(0, Number(v) || 0);
  let oran;
  if (mod === 'surekli') oran = Math.min(100, x);
  else if (mod === 'v85') oran = Math.min(100, x / 85 * 100);
  else { const bl = (baremZorla || V.baremler).slice().sort((a, b) => b.esik - a.esik), b = bl.find(e => x >= e.esik); oran = b ? b.oran : 0; }
  const taban = tabanZorla != null ? Number(tabanZorla) : Number(V.hedefTaban);
  if (taban > 0 && (Number(hedefYuzde) || 0) >= 100) oran = Math.max(oran, taban);
  return r2(Math.max(0, Math.min(100, oran)));
}
// V12.6: aralıkta "bugüne kadar olması gereken" oran (0–1): tek ayın içindeyse gün ağırlıklarıyla, ay aşıyorsa düz oranla
export function donemBeklenen(ayar, D, gun) {
  if (D.tamAy) return beklenenOran(ayar, D.ay, gun);
  if (D.bas.slice(0, 7) === D.bit.slice(0, 7)) {
    const w = gunAgirliklari(ayar, D.ay).slice(Number(D.bas.slice(8)) - 1, Number(D.bit.slice(8))), T = w.reduce((a, x) => a + x, 0);
    if (T > 0) return w.slice(0, Math.max(0, Math.min(w.length, gun))).reduce((a, x) => a + x, 0) / T;
  }
  return Math.max(0, Math.min(1, gun / (D.gunSayisi || 1)));
}
// V12.6: dönem yardımcıları (gün = 'YYYY-MM-DD', iki uç DAHİL)
const gunMs = g => Date.parse(g + 'T00:00:00Z');
export const gunFark = (a, b) => Math.round((gunMs(b) - gunMs(a)) / 86400000);   // b − a (gün)
export function donemBilgi(ay, donem) {
  if (donem && donem.bas && donem.bit && donem.bas <= donem.bit) {
    const n = gunFark(donem.bas, donem.bit) + 1, tam = donem.bas === ay + '-01' && donem.bit === ay + '-' + String(ayGunSayisi(ay)).padStart(2, '0');
    return { bas: donem.bas, bit: donem.bit, gunSayisi: n, tamAy: tam, ay: donem.bas.slice(0, 7) };
  }
  const n = ayGunSayisi(ay); return { bas: ay + '-01', bit: ay + '-' + String(n).padStart(2, '0'), gunSayisi: n, tamAy: true, ay };
}
// Aralığa düşen hedef: her ay için aylık hedef × (aralıktaki o ay günü / ay günü)
export function donemHedef(h, bas, bit) {
  let top = 0; const hh = h || {};
  for (let g = bas; g <= bit;) {
    const ay = g.slice(0, 7), ayBit = ay + '-' + String(ayGunSayisi(ay)).padStart(2, '0'), son = bit < ayBit ? bit : ayBit, gun = gunFark(g, son) + 1;
    const aylik = sayiya(hh.aylik && hh.aylik[ay] != null ? hh.aylik[ay] : hh.tutar);
    top += aylik * gun / ayGunSayisi(ay);
    g = new Date(gunMs(son) + 86400000).toISOString().slice(0, 10);
  }
  return r2(top);
}

// ── AY HESABI ──
// kayitlar: [{ sale, damga?, teslimT }]  (damga yoksa o an hesaplanır → eski satışlar da hesaba girer)
// hedefler: { 'eposta': { ad, tutar, aylik:{'YYYY-MM':tutar} } }   bugun: ms (hesap anı)
// V12.5: duzeltmeler = { [satisNo]: { prim, mod: 'brut'|'kesin', neden, u, t } } — yönetici, SORUNLU satışın prim tutarını belirler.
//   brut  : satışın brüt primi bu tutar olur (indirim katsayısı + verimlilik normal uygulanır)
//   kesin : bu tutar personele AYNEN eklenir (katsayı/verimlilik uygulanmaz); satışın hesaplanan primi sayılmaz
// V12.6: donem = { bas:'YYYY-MM-DD', bit:'YYYY-MM-DD' } (özel aralık; verilmezse tam ay). Hedef aralık günü oranında küçülür; teslim tarihi aralıkta olan satışlar sayılır.
//   gorunum = { [eposta]: { kesintiYuzde, bonusYuzde?, neden } } (bu ay için) → hak edişe çarpan. bekleyenler = [{ sale, damga? }] teslim edilmemiş satışlar (yalnız "bekleyen puan" için).
export function aySonuc({ kayitlar, ayar: ayar0, hedefler, ay, bugun, urunBul, duzeltmeler, donem, gorunum, bekleyenler }) {
  const ayar = ayarBirlestir(ayar0), H = hedefler || {}, D = donemBilgi(ay, donem), n = D.gunSayisi, simdi = bugun || Date.now(), GR = gorunum || {};
  const bugunG = gunStr(simdi), gun = bugunG < D.bas ? 0 : bugunG > D.bit ? n : gunFark(D.bas, bugunG) + 1;
  const kisiler = {};
  const DZ = duzeltmeler || {};
  const kisi = (em, ad) => (kisiler[em] = kisiler[em] || { email: em, ad: ad || em.split('@')[0], kesin: 0, duzeltmeSayisi: 0, duzeltmeFark: 0, satisSayisi: 0, kdvsiz: 0, nitelikli: 0, verimsiz: 0, brut: 0, ekstra: 0, ekstraKesinti: 0, liste: 0, ind: 0, kalemler: [] });
  Object.keys(H).forEach(em => kisi(em.toLowerCase(), H[em].ad));
  for (const r of kayitlar || []) {
    const s = r.sale || {}, em = String(s.user || '').toLowerCase().trim(); if (!em) continue;
    const t = Number(r.teslimT) || Date.parse(s.ts) || 0, tg = gunStr(t); if (tg < D.bas || tg > D.bit) continue;
    let d = damgaGecerli(r.damga) || damga(s, ayar, urunBul); const K = kisi(em, s.userAd);
    const dz = DZ[s.id || s.satisNo || ''] || DZ[s.satisNo || ''];
    if (dz && dz.prim != null && isFinite(Number(dz.prim))) {
      const yeni = r2(Math.max(0, Number(dz.prim))), kesin = dz.mod === 'kesin';
      d = { ...d, orijinalPrim: d.brutPrim, brutPrim: kesin ? 0 : yeni, kesinPrim: kesin ? yeni : 0, duzeltme: { prim: yeni, mod: kesin ? 'kesin' : 'brut', neden: String(dz.neden || ''), u: dz.u || '', t: dz.t || 0, once: d.brutPrim } };
      K.duzeltmeSayisi++; K.duzeltmeFark = r2(K.duzeltmeFark + yeni - d.orijinalPrim); K.kesin = r2(K.kesin + (kesin ? yeni : 0));
    }
    if (s.userAd && !H[em]) K.ad = s.userAd;
    K.satisSayisi++; K.kdvsiz = r2(K.kdvsiz + d.toplamKdvsiz); K.nitelikli = r2(K.nitelikli + d.nitelikliKdvsiz); K.verimsiz = r2(K.verimsiz + d.verimsizKdvsiz);
    K.brut = r2(K.brut + d.brutPrim); K.liste = r2(K.liste + d.listeToplam); K.ind = r2(K.ind + d.personelInd);
    const oz = ozelHesap(ayar, d, gunStr(t)), dus = dz && dz.prim != null && isFinite(Number(dz.prim)) ? 0 : Math.min(oz.dus, d.brutPrim);   // yönetici düzeltmesi varsa normal prim düşülmez
    K.ekstra = r2(K.ekstra + oz.ek); K.ekstraKesinti = r2((K.ekstraKesinti || 0) + (oz.ham - oz.ek)); K.brut = r2(K.brut - dus);
    K.kalemler.push({ saleNo: s.id || s.satisNo || '', t, d, ekstra: oz.ek, ekDus: dus, musteri: String(s.custName || '').replace(/&amp;/g, '&') });
  }
  // V12.6: teslim BEKLEYEN satışlar (yalnız personele "bekleyen puan" göstermek için; hak ediş/hedefe KATILMAZ)
  for (const r of bekleyenler || []) {
    const s = r.sale || {}, em = String(s.user || '').toLowerCase().trim(); if (!em) continue;
    const K = kisi(em, s.userAd), d = damgaGecerli(r.damga) || damga(s, ayar, urunBul), oz = ozelHesap(ayar, d, bugunG), ek = oz.ek - Math.min(oz.dus, d.brutPrim);
    K.bekleyen = K.bekleyen || { adet: 0, brut: 0, satirlar: [] }; K.bekleyen.adet++; K.bekleyen.brut = r2(K.bekleyen.brut + d.brutPrim + ek);
    K.bekleyen.satirlar.push({ saleNo: s.id || s.satisNo || '', t: Date.parse(s.ts) || 0, musteri: String(s.custName || '').replace(/&amp;/g, '&'), urun: (d.kalemler[0] && d.kalemler[0].ad || '') + (d.kalemler.length > 1 ? ' +' + (d.kalemler.length - 1) : ''), brut: r2(d.brutPrim + ek) });
  }
  const liste = Object.values(kisiler);
  const topListe = liste.reduce((a, k) => a + k.liste, 0), topInd = liste.reduce((a, k) => a + k.ind, 0);
  const ekipInd = topListe > 0 ? topInd / topListe * 100 : 0;
  const bek = donemBeklenen(ayar, D, gun), kalanGun = Math.max(1, n - Math.max(gun, 1) + 1);
  for (const K of liste) {
    const h = H[K.email] || {}, hedef = donemHedef(h, D.bas, D.bit);
    K.hedef = hedef; K.hedefYuzde = hedef > 0 ? r2(K.kdvsiz / hedef * 100) : 0;
    K.nitelikliYuzde = K.kdvsiz > 0 ? r2(K.nitelikli / K.kdvsiz * 100) : 0;
    K.verimlilik = r2(verimlilikHesapla(ayar, K.hedefYuzde, K.nitelikliYuzde));
    K.hedefYok = !(hedef > 0);   // V12.8: hedefi girilmemiş kişi verimlilik baremine tabi tutulmaz (hedef yokken verimlilik anlamsız)
    K.odemeOrani = K.hedefYok ? 100 : odemeOrani(ayar, K.verimlilik, K.hedefYuzde);   // V12.6: verimlilik % → ödenen oran (barem + hedef tabanı)
    K.indirimOrani = K.liste > 0 ? r2(K.ind / K.liste * 100) : 0; K.ekipIndirimOrani = r2(ekipInd);
    K.katsayi = r2(indirimKatsayisi(ayar, K.indirimOrani, ekipInd) * 1000) / 1000;
    const uygulanan = ayar.golge ? 1 : K.katsayi, brut = r2(K.brut + K.ekstra);
    K.brutToplam = brut;
    K.indirimEtkisi = r2(brut * (uygulanan - 1));
    const sonra = brut + K.indirimEtkisi;
    K.verimlilikEtkisi = r2(sonra * (K.odemeOrani / 100) - sonra);
    // V12.6: görünüm / gizli müşteri çarpanı (yönetici girer; tavanlı). Kesinti hak edişten düşer, olumlu mod açıksa bonus eklenir.
    const G = ayar.gorunum.acik !== false ? GR[K.email] : null, tavan = Math.max(0, Number(ayar.gorunum.tavan) || 0), bTavan = Math.max(0, Number(ayar.gorunum.bonusTavan) || 0);
    K.gorunumKesinti = G ? Math.min(tavan, Math.max(0, sayiya(G.kesintiYuzde))) : 0;
    K.gorunumBonus = G && ayar.gorunum.olumlu ? Math.min(bTavan, Math.max(0, sayiya(G.bonusYuzde))) : 0;
    K.gorunumCarpani = r2(100 - K.gorunumKesinti + K.gorunumBonus) / 100; K.gorunumNeden = G ? String(G.neden || '') : '';
    K.onayKesinti = r2((sonra + K.verimlilikEtkisi) * (K.gorunumBonus - K.gorunumKesinti) / 100);
    K.hakEdis = r2(sonra + K.verimlilikEtkisi + K.onayKesinti + K.kesin);
    K.golgeHakEdis = r2(brut * K.katsayi * K.odemeOrani / 100 * K.gorunumCarpani + K.kesin);   // gölge ay: indirim etkisi UYGULANSAYDI
    K.beklenenKdvsiz = r2(hedef * bek); K.konumFark = r2(K.kdvsiz - K.beklenenKdvsiz);
    K.gunlukGereken = hedef > 0 ? r2(Math.max(0, hedef - K.kdvsiz) / kalanGun) : 0;
  }
  liste.sort((a, b) => b.hakEdis - a.hakEdis || b.kdvsiz - a.kdvsiz);
  const aktif = liste.filter(k => k.hedef > 0 || k.satisSayisi > 0), N = aktif.length || 1;
  const ort = f2 => r2(aktif.reduce((s, k) => s + f2(k), 0) / N);
  aktif.forEach((k, i) => { k.sira = i + 1; });
  const ekip = { ay, gun, gunSayisi: n, kalanGun, donem: { bas: D.bas, bit: D.bit, tamAy: D.tamAy }, beklenenOran: r2(bek * 100), kisiSayisi: aktif.length, indirimOrani: r2(ekipInd),
    ortVerimlilik: ort(k => k.verimlilik), ortHedefYuzde: ort(k => k.hedefYuzde), ortNitelikliYuzde: ort(k => k.nitelikliYuzde), golge: !!ayar.golge,
    toplamKdvsiz: r2(liste.reduce((a, k) => a + k.kdvsiz, 0)), toplamHedef: r2(liste.reduce((a, k) => a + k.hedef, 0)) };
  return { ekip, kisiler: aktif };
}

// ═══ V12.8: PRİM SİGORTASI — aykırı / uçuk değerleri yönetici ÖNCEDEN yakalasın (saf fonksiyonlar; ekran prim-admin.js'de) ═══
// seviye: 'k' = kırmızı (kaydetmeden / yayınlamadan önce durdurur) · 's' = sarı (dikkat) · 'b' = bilgi (rozet saymaz)
const TLy = v => '₺' + Math.round(Number(v) || 0).toLocaleString('tr-TR');
const yz = v => '%' + (Math.round(Number(v) * 10) / 10).toString().replace('.', ',');
// (1) Ayar sağduyu kontrolü: yeni ayarda mantıksız oran / tutar / tarih var mı?
export function ayarKontrol(ayar0, urunler, bugun) {
  const ayar = ayarBirlestir(ayar0), u = [], gun = bugun || gunStr(Date.now());
  Object.keys(ayar.kategoriler || {}).forEach(c => { const o = Number(ayar.kategoriler[c].oran); if (o > 15) u.push({ s: 'k', m: '“' + c + '” kategorisinin oranı ' + yz(o) + ' — virgül/nokta hatası olabilir (ör. 0,8 yerine 8).' }); else if (o < 0) u.push({ s: 'k', m: '“' + c + '” kategorisinin oranı negatif.' }); });
  Object.keys(ayar.gamlar || {}).forEach(g => { const o = Number((ayar.gamlar[g] || {}).oran); if (o > 15) u.push({ s: 'k', m: '“' + g + '” gamının oranı ' + yz(o) + ' — çok yüksek.' }); });
  Object.keys(ayar.urunler || {}).forEach(k => { const o = Number((ayar.urunler[k] || {}).oran); if (o > 25) u.push({ s: 'k', m: 'Ürün ' + k + ' için özel oran ' + yz(o) + ' — çok yüksek.' }); });
  const kdv = Number(ayar.kdv); if (!(kdv >= 0 && kdv <= 30)) u.push({ s: 'k', m: 'Varsayılan KDV ' + yz(kdv) + ' — beklenen aralık dışında.' });
  if (Number(ayar.sigorta.oran) > 15) u.push({ s: 'k', m: 'Sigorta prim oranı ' + yz(ayar.sigorta.oran) + ' — çok yüksek.' });
  if (Number(ayar.sigorta.sabit) > 1500) u.push({ s: 's', m: 'Sigorta sabit primi ' + TLy(ayar.sigorta.sabit) + ' / adet — yüksek.' });
  const ub = kod => (urunler || []).find(x => String(x.Kod != null ? x.Kod : x.kod) === String(kod).trim());
  (ayar.ekstra || []).forEach(e => {
    if (e.aktif === false) return; const ad = (e.kod || '?') + (e.ad ? ' (' + e.ad + ')' : ''), t = Number(e.tutar) || 0;
    if (!String(e.kod || '').trim()) u.push({ s: 'k', m: 'Özel prim satırında ürün seçilmemiş.' });
    if (!(t > 0)) u.push({ s: 'k', m: 'Özel prim ' + ad + ': tutar girilmemiş.' });
    if (e.bas && e.bit && e.bit < e.bas) u.push({ s: 'k', m: 'Özel prim ' + ad + ': bitiş tarihi başlangıçtan önce.' });
    if (!e.bit) u.push({ s: 's', m: 'Özel prim ' + ad + ': bitiş tarihi yok, süresiz çalışır.' });
    else if (e.bit < gun) u.push({ s: 'b', m: 'Özel prim ' + ad + ': süresi dolmuş (' + e.bit + '), pasife alabilirsiniz.' });
    if (e.bas && e.bit && gunFark(e.bas, e.bit) > 60) u.push({ s: 's', m: 'Özel prim ' + ad + ': ' + (gunFark(e.bas, e.bit) + 1) + ' günlük aralık — uzun.' });
    const x = ub(e.kod);
    if (x && t > 0) { try { const np = urunPrimi({ ...ayar, ekstra: [] }, x, gun).prim, nakit = Number(x.Nakit) || 0; if (np > 0 && t > np * 3 && t > 200) u.push({ s: 's', m: 'Özel prim ' + ad + ': ' + TLy(t) + ' / adet, ürünün normal priminin (' + TLy(np) + ') ' + Math.round(t / np) + ' katı.' }); if (nakit > 0 && t > nakit * 0.10) u.push({ s: 'k', m: 'Özel prim ' + ad + ': ' + TLy(t) + ', ürün fiyatının (' + TLy(nakit) + ') %10\'undan fazla.' }); } catch (_e) { /* */ } }
  });
  return u;
}
// (2) Etki önizlemesi: aynı satışlar eski ve yeni ayarla (damgalar yok sayılarak) yeniden hesaplanır → toplam / kişi farkı
export function ayarEtkisi(eskiAyar, yeniAyar, girdi) {
  const kay = (girdi.kayitlar || []).map(r => ({ ...r, damga: null }));
  const h = a => aySonuc({ ...girdi, kayitlar: kay, ayar: a, bekleyenler: [] }).kisiler;
  const E = h(eskiAyar), Y = h(yeniAyar), em = new Map(E.map(k => [k.email, k]));
  const eT = r2(E.reduce((a, k) => a + k.hakEdis, 0)), yT = r2(Y.reduce((a, k) => a + k.hakEdis, 0));
  const kisiler = Y.map(k => { const e = em.get(k.email), eski = e ? e.hakEdis : 0; return { ad: k.ad, eski, yeni: k.hakEdis, yuzde: eski > 0 ? r2((k.hakEdis - eski) / eski * 100) : (k.hakEdis > 0 ? 100 : 0) }; }).sort((a, b) => Math.abs(b.yeni - b.eski) - Math.abs(a.yeni - a.eski));
  return { eski: eT, yeni: yT, fark: r2(yT - eT), yuzde: eT > 0 ? r2((yT - eT) / eT * 100) : (yT > 0 ? 100 : 0), kisiler, satisSayisi: kay.length };
}
const medyan = l => { const a = l.slice().sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : 0; };
// (3) Sürekli denetim: hesaplanmış ay sonucunda uçuk satış / kişi / ekip
export function denetle(sonuc, ayar0) {
  const u = [], K = (sonuc && sonuc.kisiler) || []; if (!K.length) return u;
  const satirlar = [];
  K.forEach(k => (k.kalemler || []).forEach(x => { const d = x.d || {}, pay = (d.brutPrim || 0) - (x.ekDus || 0) + (x.ekstra || 0), kz = d.toplamKdvsiz || 0; if (d.duzeltme) return; satirlar.push({ k, x, pay, kz, oran: kz > 0 ? pay / kz : (pay > 0 ? 9 : 0) }); }));
  const med = medyan(satirlar.map(a => a.pay).filter(v => v > 0));
  satirlar.forEach(a => {
    const no = a.x.saleNo; let sv = '', m = '';
    if (a.pay < -0.005) { sv = 'k'; m = 'prim negatif (' + TLy(a.pay) + ')'; }
    else if (a.kz <= 0 && a.pay > 0.5) { sv = 'k'; m = TLy(a.pay) + ' prim var ama KDV\'siz satış tutarı 0'; }
    else if (a.oran > 0.30) { sv = 'k'; m = 'prim satışın ' + yz(a.oran * 100) + '\'i (' + TLy(a.pay) + ')'; }
    else if (a.oran > 0.15) { sv = 's'; m = 'prim satışın ' + yz(a.oran * 100) + '\'i (' + TLy(a.pay) + ') — yüksek'; }
    else if (med > 0 && a.pay > med * 6 && a.pay > 500) { sv = 's'; m = TLy(a.pay) + ' prim, ekip medyanının ' + Math.round(a.pay / med) + ' katı'; }
    if (sv) u.push({ id: 'satis:' + no, s: sv, t: 'satis', ref: no, kisi: a.k.email, b: no + ' · ' + a.k.ad, m });
  });
  const hed = K.filter(k => k.satisSayisi > 0).map(k => k.hakEdis), medH = medyan(hed);
  if (K.length >= 4) K.forEach(k => { if (medH > 0 && k.hakEdis > medH * 3 && k.hakEdis > 3000) u.push({ id: 'kisi:' + k.email + ':yuksek', s: 's', t: 'kisi', kisi: k.email, b: k.ad, m: 'hak edişi ' + TLy(k.hakEdis) + ', ekip medyanının ' + Math.round(k.hakEdis / medH) + ' katı' }); });
  K.forEach(k => { if (!(k.hedef > 0) && k.kdvsiz >= 50000) u.push({ id: 'kisi:' + k.email + ':hedefsiz', s: 's', t: 'kisi', kisi: k.email, b: k.ad, m: TLy(k.kdvsiz) + ' satış yapmış ama hedefi girilmemiş (verimlilik kesintisinden muaf)' }); });
  const tB = K.reduce((a, k) => a + k.brutToplam, 0), tK = K.reduce((a, k) => a + k.kdvsiz, 0);
  if (tK > 0 && tB / tK > 0.15) u.push({ id: 'ekip:oran', s: tB / tK > 0.25 ? 'k' : 's', t: 'ekip', b: 'Ekip', m: 'toplam prim, KDV\'siz satışın ' + yz(tB / tK * 100) + '\'i — normalin üstünde' });
  return u.sort((a, b) => (a.s === 'k' ? 0 : 1) - (b.s === 'k' ? 0 : 1));
}
// (4) Vitrin denetimi: ürün listesindeki prim değerleri (snap = önceki gün {kod: prim})
export function vitrinDenetim(ayar0, urunler, snap, bugun) {
  const ayar = ayarBirlestir(ayar0), gun = bugun || gunStr(Date.now()), u = [], yeni = {}; let gamsiz = 0, sifir = 0, degisen = 0, excelFark = [];
  const uc = [];
  (urunler || []).forEach(x => {
    const kod = String(x.Kod != null ? x.Kod : x.kod || ''), gam = x['Ürün Gamı'] || x.gam || '', nakit = Number(x.Nakit) || 0; if (!kod || !(nakit > 0)) return;
    let pr; try { pr = urunPrimi(ayar, x, gun).prim; } catch (_e) { return; } yeni[kod] = pr;
    if (gam && gamBul(ayar, gam).bilinmiyor) gamsiz++;
    if (!(pr > 0)) sifir++;
    const kz = nakit / (1 + (Number(ayar.kdv) || 20) / 100); if (kz > 0 && pr / kz > 0.15) uc.push((x['Ürün'] || kod) + ' (' + TLy(pr) + ')');
    if (snap && snap[kod] != null && snap[kod] > 0 && Math.abs(pr - snap[kod]) / snap[kod] > 0.3) degisen++;
    const ex = Number(x.Prim); if (ex > 0 && Math.abs(pr - ex) > 3 && Math.abs(pr - ex) / ex > 0.25) excelFark.push((x['Ürün'] || kod) + ': Excel ' + TLy(ex) + ' · sistem ' + TLy(pr));
  });
  if (uc.length) u.push({ id: 'vitrin:uclu', s: 'k', t: 'vitrin', b: 'Vitrin', m: uc.length + ' ürünün primi fiyatının %15\'ini aşıyor: ' + uc.slice(0, 3).join(', ') });
  if (gamsiz > 0) u.push({ id: 'vitrin:gamsiz', s: 's', t: 'vitrin', b: 'Vitrin', m: gamsiz + ' ürünün gamı ayarlarda tanımlı değil (nitelikli oranla hesaplandı).' });
  if (snap && degisen >= 3) u.push({ id: 'vitrin:degisim', s: 's', t: 'vitrin', b: 'Vitrin', m: degisen + ' ürünün vitrin primi önceki kontrole göre %30\'dan fazla değişti (oran/ayar değişikliği sonrası beklenir; beklemiyorsanız ayarlara bakın).' });
  if (excelFark.length >= 3) u.push({ id: 'vitrin:excel', s: 'b', t: 'vitrin', b: 'Vitrin', m: excelFark.length + ' üründe Excel\'deki Prim ile sistem primi farklı. Örn. ' + excelFark.slice(0, 2).join(' · ') });
  return { uyarilar: u, snap: yeni, sifir };
}
// V12.9: Sonradan eklenen SC+ için prim (sabit ₺ varsa o; yoksa KDV'siz bedel × oran). bedel KDV dahil SC+ tutarı.
export function scPrimi(ayar0, bedel) {
  const A = ayarBirlestir(ayar0), s = A.sigorta, b = Number(bedel) || 0; if (!(b > 0)) return 0;
  return Number(s.sabit) > 0 ? r2(s.sabit) : r2(kdvsizYap(b, s.kdv != null && s.kdv !== '' ? s.kdv : A.kdv) * (Number(s.oran) || 0) / 100);
}
// (5) Anekdot: bu hafta / geçen hafta + hedef temposu → personele nazik, yöneticiye konuşma önerisi
export function haftaHesap(k, simdi) {
  const g = 864e5; let son = 0, once = 0;
  for (const x of k.kalemler || []) { const v = (x.d && x.d.toplamKdvsiz) || 0; if (x.t >= simdi - 7 * g) son += v; else if (x.t >= simdi - 14 * g) once += v; }
  return { son: r2(son), onceki: r2(once) };
}
export function anekdot(k, E, simdi) {
  const hf = haftaHesap(k, simdi || Date.now()), ad = String(k.ad || '').trim().split(/\s+/)[0] || 'Kişi', yeterli = (E.gun || 0) >= 14, o = { ton: 'n', personel: '', yonetici: '', hafta: hf };
  if (!(k.satisSayisi > 0) && !(E.gun >= 10)) return o;
  let d = null; if (yeterli && hf.onceki > 0) d = (hf.son - hf.onceki) / hf.onceki * 100;
  const fark = k.hedef > 0 ? k.hedefYuzde - (E.beklenenOran || 0) : null, ind = (k.indirimOrani || 0) - (k.ekipIndirimOrani || 0);
  if (d !== null && d >= 15) { o.ton = 'iyi'; o.personel = 'Geçen haftaya göre satışların ' + yz(d) + ' artmış — çok verimli bir hafta geçiriyorsun! 👏'; o.yonetici = ad + ', geçen haftaya göre ' + yz(d) + ' yukarıda. Tebrik edin. 👏'; }
  else if (d !== null && d <= -25) { o.ton = 'kotu'; o.personel = 'Bu hafta geçen haftanın biraz gerisinde kaldın (' + yz(d) + '). Takıldığın bir konu varsa yöneticinle konuşabilirsin.'; o.yonetici = ad + ', geçen haftaya göre ' + yz(d) + ' düşüşte. “Hayırdır, bu hafta ne oldu?” diye sorun, destek lazım mı bakın.'; }
  else if (yeterli && hf.onceki > 0 && hf.son === 0) { o.ton = 'kotu'; o.personel = 'Son 7 günde kayıtlı satışın görünmüyor. Bir sorun varsa yöneticinle konuşabilirsin.'; o.yonetici = ad + ' son 7 gündür satış yapmamış (önceki hafta ' + TLy(hf.onceki) + '). Hayırdır, durum nedir?'; }
  else if (fark !== null && fark >= 10) { o.ton = 'iyi'; o.personel = 'Hedef temposunun ' + yz(fark) + ' önündesin, böyle devam! 🚀'; o.yonetici = ad + ' hedef temposunun ' + yz(fark) + ' önünde — iyi gidiyor.'; }
  else if (fark !== null && fark <= -20 && (E.gun || 0) >= 10) { o.ton = 'kotu'; o.personel = 'Hedef temposunun ' + yz(-fark) + ' gerisindesin; birkaç güçlü satışla hızla kapanır. Desteğe ihtiyacın olursa söyle.'; o.yonetici = ad + ' hedef temposunun ' + yz(-fark) + ' gerisinde. “Hayırdır, ne oldu?” — engel var mı, konuşun.'; }
  if (ind >= 3 && o.ton !== 'kotu') { o.yonetici += (o.yonetici ? ' ' : ad + ': ') + 'İndirim oranı ekibin ' + yz(ind) + ' üstünde, dikkat.'; }
  return o;
}

// ═══ V12.11: DESTEK EKİBİ ═══
// Hak ediş = satış ekibi ortalaması × yüzde. Yüzde = min + (max−min) × skor/100; sonuç satış ekibinin EN DÜŞÜĞÜNDEN düşük, EN YÜKSEĞİNDEN yüksek olamaz.
// Skor (0–100) = anket (satış ekibinin anonim puanları, 1–5) × ağırlık + yönetici görünüm/düzen puanı (1–5) × (100−ağırlık).
export const DESTEK_SORU = [
  { k: 'hiz', ad: 'Hız ve ulaşılabilirlik', ipucu: 'İhtiyacım olduğunda çabuk ilgilendi mi?' },
  { k: 'isb', ad: 'Yardımseverlik ve işbirliği', ipucu: 'İşimi kolaylaştırdı, destek oldu mu?' },
  { k: 'kalite', ad: 'İş kalitesi ve doğruluk', ipucu: 'Stok, teslimat, evrak işleri doğru ve eksiksiz mi?' },
  { k: 'tutum', ad: 'İletişim ve tutum', ipucu: 'Güler yüzlü, saygılı ve çözüm odaklı mı?' },
  { k: 'durust', ad: 'Doğru bilgi, net duruş', ipucu: 'Stok, indirim, teslim konusunda gerekirse “hayır” diyerek doğruyu söyledi mi?' }
];
export const destekAnketId = (ay, degerlendiren, destek) => ay + '__' + String(degerlendiren).toLowerCase() + '__' + String(destek).toLowerCase();
export const destekYonId = (ay, destek) => 'yon__' + ay + '__' + String(destek).toLowerCase();
const puan15 = v => { const n = Number(v); return n >= 1 && n <= 5 ? n : 0; };
export function destekSkor(anketler, yon, ayar0) {
  const A = ayarBirlestir(ayar0).destek, w = Math.min(100, Math.max(0, Number(A.anketAgirlik) || 0)) / 100;
  const son = {}; (anketler || []).forEach(x => { if (x && x.e) son[String(x.e).toLowerCase()] = x; });   // değerlendiren başına son kayıt
  const rs = [], sor = {}; DESTEK_SORU.forEach(s => { sor[s.k] = { t: 0, n: 0 }; });
  Object.values(son).forEach(x => { const v = DESTEK_SORU.map(s => puan15(x.p && x.p[s.k])).filter(Boolean); if (!v.length) return; rs.push(v.reduce((a, c) => a + c, 0) / v.length); DESTEK_SORU.forEach(s => { const q = puan15(x.p && x.p[s.k]); if (q) { sor[s.k].t += q; sor[s.k].n++; } }); });
  rs.sort((a, b) => a - b); const kes = rs.length >= 5 ? rs.slice(1, -1) : rs;   // 5+ kişide en yüksek ve en düşük puan atılır (tek kişinin etkisi kalmasın)
  const n = rs.length, ort = kes.length ? kes.reduce((a, c) => a + c, 0) / kes.length : 0, anketSkor = n ? (ort - 1) / 4 * 100 : null;
  const g = yon && puan15(yon.gorunum), yonSkor = g ? (g - 1) / 4 * 100 : null;
  let skor, kaynak;
  if (anketSkor === null && yonSkor === null) { skor = 70; kaynak = 'varsayilan'; }
  else if (anketSkor === null) { skor = yonSkor; kaynak = 'yonetici'; }
  else if (yonSkor === null) { skor = anketSkor; kaynak = 'anket'; }
  else { const wa = n < 3 ? w * 0.5 : w; skor = (anketSkor * wa + yonSkor * (1 - w)) / (wa + (1 - w)); kaynak = 'karma'; }   // az kişi (1–2) puanladıysa anketin ağırlığı yarıya iner
  const sorular = {}; DESTEK_SORU.forEach(s => { sorular[s.k] = sor[s.k].n ? r2(sor[s.k].t / sor[s.k].n) : null; });
  return { skor: r2(skor), anketSkor: anketSkor === null ? null : r2(anketSkor), anketN: n, anketOrt: n ? r2(ort) : null, yonSkor: yonSkor === null ? null : r2(yonSkor), gorunum: g || null, kaynak, sorular };
}
// destekler: [{email, ad}] · anketler: tüm ay kayıtları [{d, e, p}] · yonMap: { [email]: { gorunum } }
export function destekPrimleri(sonuc, ayar0, destekler, anketler, yonMap) {
  const A = ayarBirlestir(ayar0).destek, K = (sonuc && sonuc.kisiler) || [];
  let havuz = K.filter(k => Number(k.hakEdis) > 0); if (!havuz.length) havuz = K;
  const v = havuz.map(k => Number(k.hakEdis) || 0), ort = v.length ? v.reduce((a, c) => a + c, 0) / v.length : 0, mn = v.length ? Math.min(...v) : 0, mx = v.length ? Math.max(...v) : 0;
  const lo = Math.min(Number(A.min) || 0, Number(A.max) || 0), hi = Math.max(Number(A.min) || 0, Number(A.max) || 0);
  return (destekler || []).map(d => {
    const em = String(d.email).toLowerCase(), S = destekSkor((anketler || []).filter(x => String(x.d || '').toLowerCase() === em), (yonMap || {})[em], ayar0);
    const yuzde = lo + (hi - lo) * S.skor / 100, ham = ort * yuzde / 100, tutar = r2(Math.min(mx, Math.max(mn, ham)));
    return { email: em, ad: d.ad, ...S, yuzde: r2(yuzde), tutar, havuzOrt: r2(ort), havuzMin: r2(mn), havuzMax: r2(mx), sinirli: tutar !== r2(ham) };
  });
}
export function destekOzeti(d, ay, simdi, ayar0) {
  const pk = ayarBirlestir(ayar0).puanKatsayisi;
  return { v: 1, destek: true, email: d.email, ad: d.ad, ay, guncelleme: simdi || Date.now(), hakEdis: d.tutar, puan: Math.round(d.tutar * pk), puanKatsayisi: pk,
    skor: d.skor, anketSkor: d.anketSkor, anketN: d.anketN, yonSkor: d.yonSkor, gorunum: d.gorunum, kaynak: d.kaynak, sorular: d.sorular, yuzde: d.yuzde };
}

// V12.9: Haftalık ekip özeti (yönetici): son 7 gün / önceki 7 gün, yükselen-düşen kişiler
export function haftaOzeti(sonuc, simdi) {
  const E = sonuc.ekip, yeterli = (E.gun || 0) >= 14; let son = 0, once = 0; const liste = [];
  for (const k of sonuc.kisiler) { const h = haftaHesap(k, simdi); son += h.son; once += h.onceki; liste.push({ ad: k.ad, email: k.email, son: h.son, onceki: h.onceki, d: yeterli && h.onceki > 0 ? (h.son - h.onceki) / h.onceki * 100 : null }); }
  const dl = liste.filter(x => x.d !== null);
  const yuk = dl.filter(x => x.d >= 15).sort((a, b) => b.d - a.d).slice(0, 3), dus = dl.filter(x => x.d <= -25).sort((a, b) => a.d - b.d).slice(0, 3);
  const sessiz = yeterli ? liste.filter(x => x.onceki > 0 && x.son === 0).map(x => x.ad) : [];
  return { son: r2(son), onceki: r2(once), degisim: yeterli && once > 0 ? r2((son - once) / once * 100) : null, yeterli, yuk, dus, sessiz };
}
// ── Personelin okuyacağı TEK ÖZET doküman (başkasının TUTARI yok: yalnız sıra, ekip ortalaması %, lider baş harfi + %) ──
const bashBasHarfler = ad => String(ad || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).map(x => x.charAt(0).toLocaleUpperCase('tr')).join('.') + (String(ad || '').trim() ? '.' : '');
// V12.6: verimlilik barem tablosunda bir üst kademe (yoksa null): { esik, oran, kalan }
export function sonrakiKademe(ayar0, v) {
  const ayar = ayarBirlestir(ayar0), x = Number(v) || 0; if ((ayar.verimlilik.mod || 'barem') !== 'barem') return null;
  const ust = ayar.verimlilik.baremler.filter(b => b.esik > x).sort((a, b) => a.esik - b.esik)[0];
  return ust ? { esik: ust.esik, oran: ust.oran, kalan: r2(ust.esik - x) } : null;
}
export function kisiOzeti(sonuc, k, simdi, ayar0) {
  const ayar = ayarBirlestir(ayar0), pk = ayar.puanKatsayisi, puan = v => Math.round((Number(v) || 0) * pk), E = sonuc.ekip, lider = sonuc.kisiler.slice().sort((a, b) => b.hedefYuzde - a.hedefYuzde)[0] || null;
  return {
    v: 1, email: k.email, ad: k.ad, ay: E.ay, guncelleme: simdi || Date.now(), golge: E.golge,
    kdvsiz: k.kdvsiz, nitelikliKdvsiz: k.nitelikli, verimsizKdvsiz: k.verimsiz, hedef: k.hedef, hedefYuzde: k.hedefYuzde, nitelikliYuzde: k.nitelikliYuzde, verimlilik: k.verimlilik,
    satisSayisi: k.satisSayisi, brutPrim: k.brutToplam, hedefYok: !!k.hedefYok, ekstraPrim: k.ekstra, ekstraKesinti: k.ekstraKesinti || 0, kesinPrim: k.kesin || 0, duzeltmeSayisi: k.duzeltmeSayisi || 0,
    duzeltmeler: (k.kalemler || []).filter(x => x.d && x.d.duzeltme).slice(0, 40).map(x => ({ saleNo: String(x.saleNo), once: x.d.duzeltme.once, yeni: x.d.duzeltme.prim, mod: x.d.duzeltme.mod, neden: String(x.d.duzeltme.neden || '').slice(0, 160) })),
    indirimOrani: k.indirimOrani, ekipIndirimOrani: k.ekipIndirimOrani, katsayi: k.katsayi,
    indirimEtkisi: k.indirimEtkisi, verimlilikEtkisi: k.verimlilikEtkisi, onayKesinti: k.onayKesinti, hakEdis: k.hakEdis,
    beklenenKdvsiz: k.beklenenKdvsiz, konumFark: k.konumFark, gunlukGereken: k.gunlukGereken, kalanGun: E.kalanGun, gun: E.gun, gunSayisi: E.gunSayisi,
    sira: k.sira || 0, kisiSayisi: E.kisiSayisi, ekipOrtVerimlilik: E.ortVerimlilik, ekipOrtHedefYuzde: E.ortHedefYuzde, ekipOrtNitelikliYuzde: E.ortNitelikliYuzde,
    liderBas: lider ? String(lider.ad || '?').trim().charAt(0).toLocaleUpperCase('tr') + '.' : '', liderHedefYuzde: lider ? lider.hedefYuzde : 0,
    // ── V12.6: personele PUAN olarak (₺ değil) ──
    anekdot: (() => { const a = anekdot(k, E, simdi || Date.now()); return { ton: a.ton, m: a.personel, son: a.hafta.son, onceki: a.hafta.onceki }; })(),
    puanKatsayisi: pk, puan: puan(k.hakEdis), odemeOrani: k.odemeOrani, gorunumCarpani: Math.round((k.gorunumCarpani || 1) * 1000) / 10,
    sonrakiKademe: sonrakiKademe(ayar, k.verimlilik), hedefTaban: Number(ayar.verimlilik.hedefTaban) || 0, tamAy: !E.donem || E.donem.tamAy !== false,
    bekleyenPuan: k.bekleyen ? puan(k.bekleyen.brut) : 0, bekleyenAdet: k.bekleyen ? k.bekleyen.adet : 0,
    bekleyenSatirlar: k.bekleyen ? k.bekleyen.satirlar.slice().sort((a, b) => b.t - a.t).slice(0, 30).map(x => ({ s: String(x.saleNo), t: x.t, ad: bashBasHarfler(x.musteri) || String(x.saleNo), u: String(x.urun || '').slice(0, 40), p: puan(x.brut) })) : [],
    satirlar: (() => {
      const f = k.brutToplam > 0 ? (k.hakEdis - (k.kesin || 0)) / k.brutToplam : 0;
      const l = (k.kalemler || []).map(x => { const d = x.d || {}, kal = d.kalemler || [], pay = (d.brutPrim || 0) - (x.ekDus || 0) + (x.ekstra || 0), p = puan(pay * f + (d.kesinPrim || 0)), r = [];
        if (x.ekstra > 0) r.push('o'); if (d.duzeltme) r.push('d');
        return { s: String(x.saleNo), t: x.t, ad: bashBasHarfler(x.musteri) || String(x.saleNo), u: String((kal[0] && kal[0].ad) || '').slice(0, 40) + (kal.length > 1 ? ' +' + (kal.length - 1) : ''), p, r, n: d.duzeltme ? String(d.duzeltme.neden || '').slice(0, 80) : '' }; });
      const ort = l.length ? l.reduce((a, x) => a + x.p, 0) / l.length : 0;
      l.forEach(x => { if (l.length >= 3 && x.p >= 2 * ort && x.p >= 5) x.r.unshift('y'); });
      return l.sort((a, b) => b.t - a.t).slice(0, 60);
    })()
  };
}

// V12.6: SİMÜLASYON — aynı ay verisiyle farklı verimlilik kurallarının toplam ödemeye etkisi (kaydetmeden).
// senaryolar: [{ ad, verimlilik: { mod?, baremler?, hedefTaban? } }]; dönüş: { senaryolar:[{ad,toplam}], kisiler:[{ad,email,hakedis:[...] , verimlilik, hedefYuzde}] }
export function simulasyon(girdi, senaryolar) {
  const sonuclar = senaryolar.map(sc => { const a = ayarBirlestir(girdi.ayar); a.verimlilik = { ...a.verimlilik, ...(sc.verimlilik || {}) }; return aySonuc({ ...girdi, ayar: a }); });
  const ilk = sonuclar[0], kisiler = ilk.kisiler.map(k => ({ ad: k.ad, email: k.email, verimlilik: k.verimlilik, hedefYuzde: k.hedefYuzde, hakedis: sonuclar.map(r => { const x = r.kisiler.find(y => y.email === k.email); return x ? x.hakEdis : 0; }), oran: sonuclar.map(r => { const x = r.kisiler.find(y => y.email === k.email); return x ? x.odemeOrani : 0; }) }));
  return { senaryolar: senaryolar.map((sc, i) => ({ ad: sc.ad, toplam: r2(kisiler.reduce((a, k) => a + k.hakedis[i], 0)) })), kisiler };
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
    const adetS = Number(u.adet) > 0 ? Number(u.adet) : 1, eS = ekstraTutar(ayar, u.kod, bugun);
    prim += eS.tekil > 0 ? 0 : (sn.tur === 'sigorta' && sn.sabit > 0 ? sn.sabit : kz * sn.oran / 100); ekstra += (eS.tutar + eS.tekil) * adetS;
  }
  const yuzde = ciro > 0 ? nit / ciro * 100 : 0;
  const o = { ciro: r2(ciro), nitelikli: r2(nit), verimsiz: r2(vsz), nitelikliYuzde: r2(yuzde), brutPrim: r2(prim + ekstra), ekstraPrim: r2(ekstra), oneri: null };
  if (vsz > 0 && yuzde < 100) {   // IT/Elektronik var → ekran koruyucu / sigorta / aksesuar önerisi
    const ekle = Math.max(300, r2(vsz * 0.1)), aks = ayar.kategoriler && ayar.kategoriler['AKSESUAR'] ? sayiya(ayar.kategoriler['AKSESUAR'].oran) : 11, ekleKz = kdvsizYap(ekle, ayar.kdv);
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
    const d = damgaGecerli(r.damga) || damga(s, ayar, urunBul), ad = String(s.userAd || (s.user || '').split('@')[0] || '?');
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

// ── MUHASEBE EXCEL (FastReport "ALIŞ/SATIŞ İŞLEMLERİ" – SpreadsheetML) ayrıştırma + sistemle karşılaştırma ──
const mTarih = t => { const m = String(t || '').match(/^(\d\d)\.(\d\d)\.(\d{4})$/); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; };
export const musteriAnahtari = s => norm(String(s || '').replace(/&amp;/g, '&')).replace(/\d+$/, '');
// satirlar: [[hücre,...],...] (boş hücreler '' ile korunmuş). Başlık satırı 'Cari Ünvanı' ile bulunur; tekrar eden başlıklar atlanır.
// V12.3: sütunlar BAŞLIK ADIYLA tanınır → iki biçim desteklenir: (a) muhasebe dökümü: ... Toplam | personel (başlıksız, sonda)  (b) 1.xls: Personel önde, "KDV'li Toplam", Ürün Gamı, Kategori, Kategori Çarpanı, KDV'siz Br Fiyat, Prim.
export function muhasebeSatirlari(satirlar) {
  const out = []; let kol = null;
  for (const r of satirlar || []) {
    const h = r.map(x => String(x == null ? '' : x).trim());
    if (norm(h[0]) === 'cariunvani') { kol = {}; h.forEach((x, i) => { if (x && kol[norm(x)] === undefined) kol[norm(x)] = i; }); continue; }   // V12.3b: aynı başlık tekrarlanırsa (yan tablo: Personel/Hakedilen/Brüt) İLK sütun geçerli
    if (!kol || kol.cariunvani === undefined && kol.belgeno === undefined) continue;
    if (kol.hakedilen !== undefined && h[kol.hakedilen] !== '' && h[kol.hakedilen - 1]) { out.hakedilen = out.hakedilen || {}; out.hakedilen[h[kol.hakedilen - 1]] = { hak: sayiya(h[kol.hakedilen]), brut: kol.brut !== undefined ? sayiya(h[kol.brut]) : null }; }   // yan tablo: kişi başına Excel hakedilen
    const tarih = mTarih(h[kol.tarih]); if (!tarih) continue;
    const topI = kol.kdvlitoplam !== undefined ? kol.kdvlitoplam : kol.toplam, tutar = sayiya(h[topI]);
    let personel = kol.personel !== undefined ? h[kol.personel] : '';
    if (!personel) for (let i = (topI === undefined ? 0 : topI) + 1; i < h.length; i++) if (h[i] && kol.prim !== i) { personel = h[i]; break; }
    const miktar = sayiya(h[kol.miktar]) || 1, brut = kol.kdvsizbrfiyat !== undefined ? sayiya(h[kol.kdvsizbrfiyat]) : null;
    out.push({ cari: h[kol.cariunvani || 0], belge: h[kol.belgeno], tarih, seri: h[kol.serino] || '', stok: h[kol.stokkodu] || '', miktar, tutar, personel,
      gam: kol.urungami !== undefined ? h[kol.urungami] : '', kategori: kol.kategori !== undefined ? h[kol.kategori] : '', carpan: kol.kategoricarpani !== undefined ? sayiya(h[kol.kategoricarpani]) : null,
      kdvsiz: brut !== null ? r2(brut * miktar) : null, excelPrim: kol.prim !== undefined && h[kol.prim] !== '' ? sayiya(h[kol.prim]) : null });
  }
  return out;
}
export const firmaCarisiMi = c => /\b(A\.?\s?Ş|LTD|ŞTİ|SAN\.|TİC\.|ELECTRONICS|PAZ\.)/i.test(String(c || '').toLocaleUpperCase('tr'));
export const samsungCarisiMi = c => /SAMSUNG/i.test(String(c || '').toLocaleUpperCase('tr'));
const kisiAnahtar = x => norm(x);
const kisiEsles = (excelAd, sale) => {   // Excel'deki tam ad ↔ satışı yapan (Ad ya da e-posta başı); biri diğerini içerebilir (≥5 harf)
  const e = kisiAnahtar(excelAd); if (!e) return false;
  return [sale.userAd, String(sale.user || '').split('@')[0]].some(v => { const k = kisiAnahtar(v); return k && (k === e || (k.length >= 5 && e.length >= 5 && (e.includes(k) || k.includes(e)))); });
};
// V12.3: ❖ kampanya → fatura SAMSUNG'a kesilir; muhasebede cari "SAMSUNG ELECTRONICS…" görünür ama ürün gerçek müşteriye gider (ad tutmaz).
// Bu yüzden Samsung satırları MÜŞTERİ ADIYLA değil  personel + stok kodu (ya da seri) + tarih ile sistemdeki satışa eşlenir. Aynı satış kalemi iki kez eşlenmez.
export function samsungEsle(excelSatirlari, sistem) {
  const kullanildi = new Map(), sonuc = new Map();
  const kalemKodlari = x => ((x.damga && x.damga.kalemler && x.damga.kalemler.length ? x.damga.kalemler : (x.sale.urunler || [])).map(k => String(k.kod || '')));
  for (const e of excelSatirlari) {
    const aday = (sistem || []).filter(x => x.durum !== 'iptal' && kisiEsles(e.personel, x.sale)).map(x => ({ x, kalemler: kalemKodlari(x) })).filter(c => c.kalemler.includes(String(e.stok)));
    const et = Date.parse(e.tarih + 'T12:00:00Z');
    const puan = c => { const st = Date.parse(String(c.x.sale.ts).slice(0, 10) + 'T12:00:00Z'), gun = (et - st) / 86400000; return (c.x.sale.faturaKesen === 'samsung' ? 0 : 1000) + (gun < -3 ? 500 + Math.abs(gun) : gun > 45 ? 200 + gun : Math.abs(gun)); };
    const anah = c => c.x.sale.id + '|' + e.stok, kap = c => c.kalemler.filter(k => k === String(e.stok)).length;
    const secilen = aday.map(c => ({ ...c, puan: puan(c) })).filter(c => c.puan < 1500 && (kullanildi.get(anah(c)) || 0) < kap(c)).sort((a, b) => a.puan - b.puan)[0];
    if (secilen) { kullanildi.set(anah(secilen), (kullanildi.get(anah(secilen)) || 0) + 1); sonuc.set(e, { sale: secilen.x.sale, durum: secilen.x.durum, isaretli: secilen.x.sale.faturaKesen === 'samsung' }); }
  }
  return sonuc;
}
// excel: muhasebeSatirlari çıktısı; sistem: [{sale, durum}]  → müşteri bazında eşleştirme (Samsung satırları ayrı: personel + stok + tarih)
export function muhasebeKarsilastir(excel, sistem, ay) {
  const sis = {}; for (const x of sistem || []) { const k = musteriAnahtari(x.sale.custName); if (k) (sis[k] = sis[k] || []).push(x); }
  const bul = k => { if (sis[k]) return sis[k]; if (k.length < 6) return []; const o = []; for (const a of Object.keys(sis)) if (a.length >= 6 && (a.includes(k) || k.includes(a))) o.push(...sis[a]); return o; };
  const aySatir = (excel || []).filter(e => !ay || e.tarih.slice(0, 7) === ay);
  const sam = samsungEsle(aySatir.filter(e => samsungCarisiMi(e.cari)), sistem);
  const grup = {};
  for (const e of aySatir) {
    const k = musteriAnahtari(e.cari) + '|' + norm(e.personel), G = (grup[k] = grup[k] || { cari: e.cari, personel: e.personel, firma: firmaCarisiMi(e.cari), samsung: samsungCarisiMi(e.cari), satir: 0, tutar: 0, kdvsiz: 0, excelPrim: 0, belgeler: new Set(), tarihler: [], samEsles: [], samYok: 0 });
    G.satir++; G.tutar = r2(G.tutar + e.tutar); G.kdvsiz = r2(G.kdvsiz + (e.kdvsiz != null ? e.kdvsiz : 0)); G.excelPrim = r2(G.excelPrim + (e.excelPrim || 0)); G.belgeler.add(e.belge); G.tarihler.push(e.tarih);
    if (G.samsung) { const m = sam.get(e); if (m) G.samEsles.push({ id: m.sale.id, durum: m.durum, isaretli: m.isaretli, stok: e.stok, musteri: m.sale.custName }); else G.samYok++; }
  }
  return Object.values(grup).map(G => {
    if (G.samsung) {   // Samsung faturalı satış ↔ sistem satışı (ad değil, personel+stok+tarih)
      const ids = [...new Set(G.samEsles.map(m => m.id))], durumlar = [...new Set(G.samEsles.map(m => m.durum))];
      const sonuc = !G.samEsles.length ? 'firma' : (G.samYok ? 'samsungKismi' : (durumlar.every(d => d === 'sayilan') ? 'samsung' : 'samsungDurum'));
      return { ...G, belgeler: [...G.belgeler], ilk: G.tarihler.sort()[0], sistemde: ids.length, sistemIdler: ids, durumlar, samEsles: G.samEsles, sistemOdenen: 0, sonuc };
    }
    const es = bul(musteriAnahtari(G.cari)), durumlar = [...new Set(es.map(x => x.durum))];
    return { ...G, belgeler: [...G.belgeler], ilk: G.tarihler.sort()[0], sistemde: es.length, sistemIdler: [...new Set(es.map(x => x.sale.id))], durumlar, sistemOdenen: r2(es.reduce((a, x) => a + (x.damga ? (x.damga.sepetToplam != null ? x.damga.sepetToplam : x.damga.odenenToplam) : 0), 0)), sonuc: !es.length ? (G.firma ? 'firma' : 'yok') : (durumlar.every(d => d === 'sayilan') ? 'tamam' : 'durum') };
  }).sort((a, b) => b.tutar - a.tutar);
}

// V12.3b: SATIR SATIR prim karşılaştırması — her Excel satırı (kişi, ürün, tarih) için sistemdeki aynı kalemin primi yan yana; sistemde olup Excel'de olmayan sayılan kalemler ayrıca.
export function satirKarsilastir(excel, sistem, ay) {
  const sis = {}; for (const x of sistem || []) { const k = musteriAnahtari(x.sale.custName); if (k) (sis[k] = sis[k] || []).push(x); }
  const bul = k => { if (sis[k]) return sis[k]; if (k.length < 6) return []; const o = []; for (const a of Object.keys(sis)) if (a.length >= 6 && (a.includes(k) || k.includes(a))) o.push(...sis[a]); return o; };
  const aySatir = (excel || []).filter(e => !ay || e.tarih.slice(0, 7) === ay), sam = samsungEsle(aySatir.filter(e => samsungCarisiMi(e.cari)), sistem);
  const kul = new Map(), satirlar = [];
  const lineAl = (x, stok) => { const L = ((x.damga && x.damga.kalemler) || []).map((l, i) => ({ l, i })).filter(o => String(o.l.kod) === String(stok) && !kul.has(x.sale.id + '|' + o.i)); return L[0] || null; };
  for (const e of aySatir) {
    let x = null, line = null, not = '';
    if (samsungCarisiMi(e.cari)) { const m = sam.get(e); if (m) { x = (sistem || []).find(z => z.sale === m.sale); line = x && lineAl(x, e.stok); if (!m.isaretli) not = 'Samsung işareti yok'; } }
    else { const adaylar = bul(musteriAnahtari(e.cari)).filter(z => z.durum !== 'iptal'); for (const z of adaylar) { const o = lineAl(z, e.stok); if (o) { x = z; line = o; break; } } if (!x && adaylar.length) { x = adaylar[0]; not = 'Stok kodu satışta yok'; } }
    if (x && line) kul.set(x.sale.id + '|' + line.i, 1);
    const l = line && line.l;
    satirlar.push({ cari: e.cari, personel: e.personel, tarih: e.tarih, stok: e.stok, gam: e.gam, kategori: e.kategori, carpan: e.carpan, kdvsiz: e.kdvsiz, excelPrim: e.excelPrim, saleId: x ? x.sale.id : '', durum: x ? x.durum : '', sistemKisi: x ? (x.sale.userAd || String(x.sale.user || '').split('@')[0]) : '',
      sGam: l ? l.gam : '', sKategori: l ? (l.kategori || '') : '', sOran: l ? l.oran : null, sKdvsiz: l ? l.netKdvsiz : null, sPrim: l ? l.prim : null, fark: l && e.excelPrim != null ? r2(l.prim - e.excelPrim) : null,
      not: not || (!x ? 'Sistemde yok' : (!l ? 'Kalem eşleşmedi' : '')) });
  }
  const fazla = [];   // sistemde SAYILAN ama Excel'de karşılığı olmayan kalemler (örn. başkasının satışı, kopya satış, yanlış kişi)
  for (const x of sistem || []) { if (x.durum !== 'sayilan') continue; ((x.damga && x.damga.kalemler) || []).forEach((l, i) => { if (!kul.has(x.sale.id + '|' + i)) fazla.push({ saleId: x.sale.id, kisi: x.sale.userAd || String(x.sale.user || '').split('@')[0], musteri: x.sale.custName, kod: l.kod, gam: l.gam, kategori: l.kategori || '', oran: l.oran, kdvsiz: l.netKdvsiz, prim: l.prim }); }); }
  return { satirlar, fazla: fazla.sort((a, b) => b.prim - a.prim) };
}
