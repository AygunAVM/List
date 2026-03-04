// ═══════════════════════════════════════════════════════════════
//  GLOBAL STATE
// ═══════════════════════════════════════════════════════════════
let allProducts    = [];
let allRates       = [];
let basket         = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0, discountType = 'TRY';
let currentUser    = JSON.parse(localStorage.getItem('aygun_user')) || null;
let selectedPriceTypes = ['dk'];
let currentVersion = '...';
let showZeroStock  = false;
let abakusSelection = null;   // Seçilen taksit satırı — WA'ya gider

// Kart başına max taksit limiti (bu sayıdan fazlasını gösterme)
var KART_MAX_TAKSIT = {
  'Axess': 9, 'Bonus': 7, 'Maximum': 6, 'World': 9,
  'Vakifbank': 7, 'Vakıfbank': 7,
  'BanKKart': 7, 'Bankkart': 7,
  'Paraf': 7, 'QNB': 7, 'Finans': 6,
  'Sirket Kartlari': 4, 'Şirket Kartları': 4,
  'Aidatsiz Kartlar': 4, 'Aidatsız Kartlar': 4
};
var DEFAULT_MAX_TAKSIT = 9;
var KOMISYON_ESIGI     = 10.0;  // %10 altı = karlı

const GITHUB_TOKEN   = '';
const GITHUB_REPO    = 'AygunAVM/List';
const ANALYTICS_PATH = 'data/analytics.json';

// ═══════════════════════════════════════════════════════════════
//  HAPTIC
// ═══════════════════════════════════════════════════════════════
function haptic(ms) { if (navigator.vibrate) navigator.vibrate(ms || 18); }
document.addEventListener('click', function(e) {
  if (e.target.closest('.haptic-btn,.add-btn,.remove-btn,.btn-login,.cart-trigger,.admin-btn,.abakus-btn'))
    haptic();
}, { passive: true });

// ═══════════════════════════════════════════════════════════════
//  DOM HAZIR
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('pass-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') checkAuth();
  });
  if (currentUser) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-content').style.display  = 'block';
    var ab = document.getElementById('admin-btn');
    if (ab) ab.style.display = isAdmin() ? 'flex' : 'none';
    loadData();
  }
});

function safeJSON(text) {
  return JSON.parse(text.replace(/^\uFEFF/, '').trim());
}

// ═══════════════════════════════════════════════════════════════
//  GİRİŞ
// ═══════════════════════════════════════════════════════════════
async function checkAuth() {
  haptic(22);
  var u   = document.getElementById('user-input').value.trim().toLowerCase();
  var p   = document.getElementById('pass-input').value.trim();
  var err = document.getElementById('login-err');
  if (!u || !p) { err.textContent = 'E-mail ve sifre bos birakilamaz.'; err.style.display = 'block'; return; }
  try {
    var text = await (await fetch('data/kullanicilar.json?t=' + Date.now())).text();
    var users;
    try { users = safeJSON(text); }
    catch (pe) { err.textContent = 'Kullanici listesi okunamadi.'; err.style.display = 'block'; console.error(pe, text.slice(0,200)); return; }
    if (!Array.isArray(users)) users = users.data || [];
    var user = null;
    for (var i = 0; i < users.length; i++) {
      if (users[i].Email && users[i].Email.toLowerCase().trim() === u &&
          users[i].Sifre && users[i].Sifre.trim() === p) { user = users[i]; break; }
    }
    if (user) {
      currentUser = user;
      if (document.getElementById('remember-me').checked)
        localStorage.setItem('aygun_user', JSON.stringify(user));
      err.style.display = 'none';
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app-content').style.display  = 'block';
      var ab = document.getElementById('admin-btn');
      if (ab) ab.style.display = isAdmin() ? 'flex' : 'none';
      logAnalytics('login');
      loadData();
    } else {
      err.textContent = 'E-mail veya sifre hatali!';
      err.style.display = 'block';
      haptic(80);
      console.log('Bulunamadi. Toplam:', users.length, '| Email:', u);
    }
  } catch (e) {
    err.textContent = 'Baglanti hatasi: ' + e.message;
    err.style.display = 'block';
  }
}

function isAdmin() {
  if (!currentUser) return false;
  var mail = (currentUser.Email || '').toLowerCase();
  return currentUser.Rol === 'admin' || mail.indexOf('bilgi@') !== -1 || mail.indexOf('aygun@') !== -1;
}

// ═══════════════════════════════════════════════════════════════
//  VERİ YÜKLE
// ═══════════════════════════════════════════════════════════════
async function loadData() {
  try {
    var json = safeJSON(await (await fetch('data/urunler.json?v=' + Date.now())).text());
    allProducts = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
    if (json.metadata && json.metadata.v) currentVersion = json.metadata.v;
    var vt = document.getElementById('v-tag');
    if (vt) vt.innerText = currentVersion;
    checkChanges(json);
    renderTable();
    updateCartUI();
  } catch (e) { console.error('urunler:', e); alert('Urun listesi yuklenemedi: ' + e.message); }

  try {
    allRates = safeJSON(await (await fetch('data/oranlar.json?v=' + Date.now())).text());
    console.log('Oranlar yuklendi:', allRates.length, 'satir');
  } catch (e) { allRates = []; console.warn('oranlar.json:', e.message); }
}

// ═══════════════════════════════════════════════════════════════
//  TABLO + FİLTRE
// ═══════════════════════════════════════════════════════════════
function filterData() { renderTable(document.getElementById('search').value.trim()); }

function renderTable(searchVal) {
  var kws = norm(searchVal || '').split(' ').filter(function(k) { return k.length > 0; });
  var data = allProducts.filter(function(u) {
    if (!showZeroStock && (Number(u.Stok) || 0) === 0) return false;
    if (!kws.length) return true;
    return kws.every(function(kw) { return norm(Object.values(u).join(' ')).indexOf(kw) !== -1; });
  });
  var list = document.getElementById('product-list');
  list.innerHTML = '';
  var frag = document.createDocumentFragment();
  data.forEach(function(u) {
    var oi      = allProducts.indexOf(u);
    var stok    = Number(u.Stok) || 0;
    var sc      = stok === 0 ? 'stok-kritik' : stok > 10 ? 'stok-bol' : 'stok-orta';
    var keys    = Object.keys(u);
    var urunKey = keys.find(function(k) { return norm(k) === 'urun'; }) || '';
    var descKey = keys.find(function(k) { return norm(k) === 'aciklama'; }) || '';
    var kartKey = keys.find(function(k) { return k.indexOf('Kart') !== -1; }) || '';
    var cekKey  = keys.find(function(k) { return k.indexOf('ekim') !== -1; }) || '';
    var gamKey  = keys.find(function(k) { return norm(k).indexOf('gam') !== -1; }) || '';
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><button class="add-btn haptic-btn" onclick="addToBasket(' + oi + ')">+</button></td>' +
      '<td><span class="product-name">' + (u[urunKey]||'') + '</span>' +
        (u[descKey] ? '<span class="product-desc">' + u[descKey] + '</span>' : '') + '</td>' +
      '<td class="' + sc + '">' + stok + '</td>' +
      '<td class="td-price">' + fmt(u[kartKey])  + '</td>' +
      '<td class="td-price">' + fmt(u['4T AWM']) + '</td>' +
      '<td class="td-price">' + fmt(u[cekKey])   + '</td>' +
      '<td class="td-price">' + fmt(u.Nakit)     + '</td>' +
      '<td style="font-size:.67rem;color:#64748b">' + (u.Kod||'')    + '</td>' +
      '<td class="td-gam">'   + (u[gamKey]||'-') + '</td>' +
      '<td class="td-marka">' + (u.Marka||'-')   + '</td>';
    frag.appendChild(tr);
  });
  list.appendChild(frag);
}

function toggleZeroStock() {
  showZeroStock = !showZeroStock;
  var btn = document.getElementById('stock-filter-btn');
  if (btn) btn.classList.toggle('active', showZeroStock);
  filterData();
}

function norm(s) {
  return (s || '').toLowerCase()
    .replace(/[\u011f\u011e]/g,'g').replace(/[\u00fc\u00dc]/g,'u')
    .replace(/[\u015f\u015e]/g,'s').replace(/[\u0131\u0130]/g,'i')
    .replace(/[\u00f6\u00d6]/g,'o').replace(/[\u00e7\u00c7]/g,'c');
}

function fmt(val) {
  var n = parseFloat(val);
  return isNaN(n) ? (val||'-') : n.toLocaleString('tr-TR') + '\u00a0\u20ba';
}

// 250'nin katına yukarı yuvarla: 101.001 → 101.250
function yuvarlaCeyrek(n) {
  return Math.ceil(n / 250) * 250;
}

// ═══════════════════════════════════════════════════════════════
//  SEPET
// ═══════════════════════════════════════════════════════════════
function addToBasket(idx) {
  haptic(14);
  var p       = allProducts[idx];
  var keys    = Object.keys(p);
  var urunKey = keys.find(function(k) { return norm(k) === 'urun'; }) || '';
  var kartKey = keys.find(function(k) { return k.indexOf('Kart') !== -1; }) || '';
  var cekKey  = keys.find(function(k) { return k.indexOf('ekim') !== -1; }) || '';
  var descKey = keys.find(function(k) { return norm(k) === 'aciklama'; }) || '';
  basket.push({
    urun: p[urunKey]||'', stok: Number(p.Stok)||0,
    dk:    parseFloat(p[kartKey])||0,
    awm:   parseFloat(p['4T AWM'])||0,
    tek:   parseFloat(p[cekKey])||0,
    nakit: parseFloat(p.Nakit)||0,
    aciklama: p[descKey]||'-'
  });
  logAnalytics('addToBasket', p[urunKey]||'');
  saveBasket();
}

function saveBasket()        { localStorage.setItem('aygun_basket', JSON.stringify(basket)); updateCartUI(); }
function removeFromBasket(i) { haptic(12); basket.splice(i,1); saveBasket(); }
function clearBasket() {
  haptic(30); if (!confirm('Sepeti temizle?')) return;
  basket = []; discountAmount = 0;
  var di = document.getElementById('discount-input'); if (di) di.value = '';
  saveBasket();
}
function applyDiscount() {
  discountAmount = parseFloat(document.getElementById('discount-input').value)||0;
  discountType   = document.getElementById('discount-type').value||'TRY';
  updateCartUI();
}
function getDisc(t) { return discountType === 'TRY' ? discountAmount : t*discountAmount/100; }
function basketTotals() {
  var t = {dk:0,awm:0,tek:0,nakit:0};
  basket.forEach(function(i) { t.dk+=i.dk; t.awm+=i.awm; t.tek+=i.tek; t.nakit+=i.nakit; });
  return t;
}

// ═══════════════════════════════════════════════════════════════
//  SEPET UI
// ═══════════════════════════════════════════════════════════════
function updateCartUI() {
  var ce = document.getElementById('cart-count'); if (ce) ce.innerText = basket.length;
  var badge = document.getElementById('cart-modal-count'); if (badge) badge.textContent = basket.length + ' urun';
  var area  = document.getElementById('cart-table-area'); if (!area) return;
  if (!basket.length) { area.innerHTML = '<div class="empty-cart"><span class="empty-cart-icon">\ud83d\uded2</span>Sepetiniz bos</div>'; return; }
  var t    = basketTotals();
  var rows = '';
  basket.forEach(function(item, idx) {
    rows +=
      '<tr>' +
      '<td><span class="product-name" style="font-size:.75rem">' + item.urun + '</span></td>' +
      '<td class="' + (item.stok===0?'cart-stok-0':'') + '">' + item.stok + '</td>' +
      '<td style="font-size:.65rem;color:#64748b;max-width:90px;word-break:break-word">' + item.aciklama + '</td>' +
      '<td class="cart-price">' + fmt(item.dk)    + '</td>' +
      '<td class="cart-price">' + fmt(item.awm)   + '</td>' +
      '<td class="cart-price">' + fmt(item.tek)   + '</td>' +
      '<td class="cart-price">' + fmt(item.nakit) + '</td>' +
      '<td><button class="remove-btn haptic-btn" onclick="removeFromBasket(' + idx + ')">\u00d7</button></td></tr>';
  });
  var dr = '';
  if (discountAmount > 0) {
    dr = '<tr class="discount-row"><td colspan="3" style="text-align:right;font-size:.69rem">\u0130ndirim ' +
      (discountType==='PERCENT'?'%'+discountAmount:fmt(discountAmount)) + '</td>' +
      '<td class="cart-price">-'+fmt(getDisc(t.dk))+'</td><td class="cart-price">-'+fmt(getDisc(t.awm))+'</td>' +
      '<td class="cart-price">-'+fmt(getDisc(t.tek))+'</td><td class="cart-price">-'+fmt(getDisc(t.nakit))+'</td><td></td></tr>';
  }
  var tot = '<tr class="total-row"><td colspan="3" style="text-align:right">NET TOPLAM</td>' +
    '<td class="cart-price">'+fmt(t.dk-getDisc(t.dk))+'</td><td class="cart-price">'+fmt(t.awm-getDisc(t.awm))+'</td>' +
    '<td class="cart-price">'+fmt(t.tek-getDisc(t.tek))+'</td><td class="cart-price">'+fmt(t.nakit-getDisc(t.nakit))+'</td><td></td></tr>';
  area.innerHTML = '<table class="cart-table"><thead><tr><th>Urun</th><th>Stok</th><th>Aciklama</th><th>D.Kart</th><th>4T AWM</th><th>Tek Cekim</th><th>Nakit</th><th></th></tr></thead><tbody>'+rows+dr+tot+'</tbody></table>';
}

// ═══════════════════════════════════════════════════════════════
//  MODAL KONTROL
// ═══════════════════════════════════════════════════════════════
function toggleCart() {
  haptic(16);
  var m = document.getElementById('cart-modal'); if (!m) return;
  if (m.classList.contains('open')) { m.classList.remove('open'); m.style.display='none'; }
  else { m.style.display='flex'; m.classList.add('open'); updateCartUI(); }
}

// Normal WA açılışı (nakit/fiyat listesi modunda)
function openWaModal() {
  haptic(16);
  if (!basket.length) { alert('Sepet bos!'); return; }
  abakusSelection = null;   // nakit modu
  var m = document.getElementById('wa-modal'); if (!m) return;
  // Başlık güncelle — normal mod
  var title = document.getElementById('wa-modal-title');
  if (title) title.textContent = '\ud83d\udcf2 WhatsApp Teklifi';
  var abakusInfo = document.getElementById('wa-abakus-info');
  if (abakusInfo) abakusInfo.style.display = 'none';
  // Chip'leri göster (nakit modda fiyat tipi seçilir)
  var chipArea = document.getElementById('wa-chip-area');
  if (chipArea) chipArea.style.display = 'block';
  m.style.display='flex'; m.classList.add('open');
}

// Abaküs'ten WA açılışı — seçili taksit enjekte edilmiş
function openWaFromAbakus() {
  haptic(22);
  if (!abakusSelection) { alert('Once bir satira tiklayin!'); return; }
  var m = document.getElementById('wa-modal'); if (!m) return;
  // Başlık güncelle — taksit modu
  var title = document.getElementById('wa-modal-title');
  if (title) title.textContent = '\ud83d\udcf2 Taksitli Teklif — ' + abakusSelection.label;
  // Abaküs bilgi kutusunu göster
  var abakusInfo = document.getElementById('wa-abakus-info');
  if (abakusInfo) {
    abakusInfo.style.display = 'block';
    abakusInfo.innerHTML =
      '<div class="wa-ab-info-box">' +
      '<span class="wa-ab-chip">' + abakusSelection.label + '</span>' +
      '<span class="wa-ab-chip">' + abakusSelection.zincir + ' POS</span>' +
      '<span class="wa-ab-chip wa-ab-oran">%' + abakusSelection.oran.toFixed(2) + '</span>' +
      '<span class="wa-ab-chip wa-ab-tahsilat">' + fmt(abakusSelection.tahsilat) + ' tahsilat</span>' +
      '<span class="wa-ab-chip wa-ab-aylik">Aylık ' + fmt(abakusSelection.aylik) + '</span>' +
      '</div>';
  }
  // Chip'leri gizle (taksit modunda fiyat tipi mantıklı değil)
  var chipArea = document.getElementById('wa-chip-area');
  if (chipArea) chipArea.style.display = 'none';
  m.style.display='flex'; m.classList.add('open');
}

function closeWaModal() {
  var m = document.getElementById('wa-modal');
  if (m) { m.classList.remove('open'); m.style.display='none'; }
}

function togglePriceType(type) {
  var chip = document.querySelector('.price-type-chip[data-type="'+type+'"]'); if (!chip) return;
  chip.classList.toggle('active');
  if (chip.classList.contains('active')) {
    if (selectedPriceTypes.indexOf(type) === -1) selectedPriceTypes.push(type);
  } else {
    selectedPriceTypes = selectedPriceTypes.filter(function(x) { return x !== type; });
  }
}

// ═══════════════════════════════════════════════════════════════
//  WHATSAPP GÖNDER
// ═══════════════════════════════════════════════════════════════
function finalizeProposal() {
  haptic(22);
  if (!basket.length) { alert('Sepet bos!'); return; }
  var phone = document.getElementById('cust-phone').value.trim();
  if (!phone || phone.length !== 11 || phone[0] !== '0') { alert('0 ile baslayan 11 haneli telefon giriniz'); haptic(80); return; }
  var custName  = document.getElementById('cust-name').value.trim() || '-';
  var extraNote = document.getElementById('extra-info').value.trim();
  var userEmail = currentUser ? currentUser.Email : '-';
  var exp = new Date(); exp.setDate(exp.getDate()+3);
  var expDate   = exp.toISOString().split('T')[0];
  var t         = basketTotals();
  var urunList  = basket.map(function(i) { return '  - '+i.urun; }).join('\n');
  var dn        = discountAmount > 0 ? '( '+(discountType==='PERCENT'?'%'+discountAmount:fmt(discountAmount))+' indirim )\n' : '';

  var od = '';

  if (abakusSelection) {
    // TAKSİT MODU — abaküs seçimi
    od += abakusSelection.label + ' (' + abakusSelection.zincir + ' POS): ' + fmt(abakusSelection.tahsilat) + '\n';
    od += 'Aylik taksit: ' + fmt(abakusSelection.aylik) + '\n';
    od += 'Komisyon orani: %' + abakusSelection.oran.toFixed(2) + '\n';
  } else {
    // NAKİT/FİYAT MODU — chip seçimi
    if (selectedPriceTypes.indexOf('awm')   !== -1) od += '4T AWM: '    + fmt(t.awm   - getDisc(t.awm))   + '\n';
    if (selectedPriceTypes.indexOf('dk')    !== -1) od += 'D. Kart: '   + fmt(t.dk    - getDisc(t.dk))    + '\n';
    if (selectedPriceTypes.indexOf('tek')   !== -1) od += 'Tek Cekim: ' + fmt(t.tek   - getDisc(t.tek))   + '\n';
    if (selectedPriceTypes.indexOf('nakit') !== -1) od += 'Nakit: '     + fmt(t.nakit - getDisc(t.nakit)) + '\n';
    if (!od) od = 'D. Kart: ' + fmt(t.dk - getDisc(t.dk)) + '\n';
  }

  var msg =
    '*aygun\u00ae TEKLIF*\n---\n' +
    'Musteri: ' + custName + '\n' +
    'Teklif veren: ' + userEmail + '\n' +
    'Telefon: ' + phone + '\n' +
    'Gecerlilik: ' + expDate + '\n\n' +
    '*Urunler:*\n' + urunList + '\n\n' +
    '*Odeme:*\n' + od + dn +
    (extraNote ? '\nNot: ' + extraNote : '') +
    '\n> Satis beklenmektedir.';

  window.open('https://wa.me/9'+phone+'?text='+encodeURIComponent(msg), '_blank');
  logAnalytics('whatsapp', custName);
  closeWaModal();
}

// ═══════════════════════════════════════════════════════════════
//  ABAKÜS — TAKSİT HESAPLAMA
//  Formül: Tahsilat = Nakit / (1 - Oran/100)
//  Yuvarlama: 250'nin katına yukarı (1.001 → 1.250, 1.250 → 1.250)
// ═══════════════════════════════════════════════════════════════
function openAbakus() {
  haptic(18);
  if (!basket.length) { alert('Once sepete urun ekleyin!'); return; }
  abakusSelection = null;
  var m = document.getElementById('abakus-modal');
  m.style.display='flex'; m.classList.add('open');
  buildAbakusKartlar();
  calcAbakus();
}

function closeAbakus() {
  var m = document.getElementById('abakus-modal');
  m.classList.remove('open'); m.style.display='none';
}

function buildAbakusKartlar() {
  if (!allRates.length) return;
  var kartlar = [];
  allRates.forEach(function(r) {
    if (r.Kart && kartlar.indexOf(r.Kart) === -1) kartlar.push(r.Kart);
  });
  var ks = document.getElementById('ab-kart'); if (!ks) return;
  ks.innerHTML = kartlar.map(function(k) { return '<option value="'+k+'">'+k+'</option>'; }).join('');
}

function calcAbakus() {
  abakusSelection = null;
  var waBtn = document.getElementById('ab-wa-btn');
  if (waBtn) { waBtn.style.display='none'; waBtn.textContent=''; }

  // Baz nakit
  var t     = basketTotals();
  var nakit = t.nakit - getDisc(t.nakit);
  var manEl = document.getElementById('ab-nakit');
  if (manEl && manEl.value !== '') {
    var mn = parseFloat(manEl.value.replace(',','.'));
    if (!isNaN(mn) && mn > 0) nakit = mn;
  }

  var ks = document.getElementById('ab-kart'); if (!ks) return;
  var secKart = ks.value;
  var maxT    = KART_MAX_TAKSIT[secKart] || DEFAULT_MAX_TAKSIT;

  // Bu karta ait tüm zincir satırları
  var zRows = allRates.filter(function(r) { return r.Kart === secKart; });
  var resEl = document.getElementById('ab-result'); if (!resEl) return;

  if (!zRows.length) { resEl.innerHTML = '<div class="ab-no-data">Bu kart icin oran bulunamadi.</div>'; return; }

  // Taksit tanımları (öncelik sırası: 4,5,6,7,8,9,3,2,1 — yüksek taksit öne çıkar)
  var TAK = [
    {label:'Tek Cekim', n:1,  key:'Tek',      oncelik:9},
    {label:'2 Taksit',  n:2,  key:'2Taksit',  oncelik:8},
    {label:'3 Taksit',  n:3,  key:'3Taksit',  oncelik:7},
    {label:'4 Taksit',  n:4,  key:'4Taksit',  oncelik:1},  // 4T en önemli
    {label:'5 Taksit',  n:5,  key:'5Taksit',  oncelik:2},
    {label:'6 Taksit',  n:6,  key:'6Taksit',  oncelik:3},
    {label:'7 Taksit',  n:7,  key:'7Taksit',  oncelik:4},  // 7-9T kritik
    {label:'8 Taksit',  n:8,  key:'8Taksit',  oncelik:5},
    {label:'9 Taksit',  n:9,  key:'9Taksit',  oncelik:6},
  ];

  // Her taksit için en karlı zinciri bul (en düşük oran)
  // Sonuç: { taksit_n → { ...secenek, zincir, oran, tahsilat, aylik, karli } }
  var enKarliMap = {};
  zRows.forEach(function(satir) {
    TAK.forEach(function(td) {
      if (td.n > maxT) return;
      var oran = parseFloat(satir[td.key]);
      if (isNaN(oran) || oran <= 0) return;
      var mevcut = enKarliMap[td.n];
      if (!mevcut || oran < mevcut.oran) {
        var tahsilatHam = nakit / (1 - oran / 100);
        var tahsilat    = yuvarlaCeyrek(tahsilatHam);
        var aylik       = yuvarlaCeyrek(tahsilatHam / td.n);
        enKarliMap[td.n] = {
          label:    td.label,
          taksit:   td.n,
          oncelik:  td.oncelik,
          key:      td.key,
          zincir:   satir.Zincir,
          oran:     oran,
          tahsilat: tahsilat,
          aylik:    aylik,
          karli:    oran < KOMISYON_ESIGI   // %10 altı
        };
      }
    });
  });

  // Öncelik sırasına göre sırala (4T öne çıkar, sonra 5-9T, sonra 3-1T)
  var liste = Object.values(enKarliMap).sort(function(a,b) { return a.oncelik - b.oncelik; });

  if (!liste.length) { resEl.innerHTML = '<div class="ab-no-data">Hesaplanacak oran bulunamadi.</div>'; return; }

  // Mutlak en karlı (en düşük oran — hangi taksit olursa olsun)
  var mutlakEnKarli = liste.slice().sort(function(a,b) { return a.oran - b.oran; })[0];

  var html = '';

  // Baz nakit göster
  html += '<div class="ab-nakit-row">' +
    '<span>Baz Nakit</span>' +
    '<strong>' + fmt(nakit) + '</strong>' +
    '<span class="ab-kart-badge">' + secKart + ' · max ' + maxT + 'T</span>' +
    '</div>';

  // Ana tablo — tıklanabilir satırlar
  html += '<div class="ab-table-wrap"><table class="ab-table">';
  html += '<thead><tr>' +
    '<th>Taksit</th>' +
    '<th>Zincir&nbsp;POS</th>' +
    '<th>Oran</th>' +
    '<th>Aylık Taksit</th>' +
    '<th>Toplam&nbsp;Tahsilat</th>' +
    '<th></th>' +
    '</tr></thead><tbody>';

  liste.forEach(function(s) {
    var isEnKarli = (s === mutlakEnKarli);
    var rowCls    = isEnKarli ? 'ab-row-best ab-row-sel' : (s.karli ? 'ab-row-good ab-row-sel' : 'ab-row-sel');
    var vurgu     = s.taksit >= 4 ? ' <span class="ab-taksit-dot"></span>' : '';
    var badge     = isEnKarli
      ? '<span class="ab-badge-best">\u2605 EN KARLI</span>'
      : (s.karli ? '<span class="ab-badge-good">\u2713 UYGUN</span>' : '');
    var oranCls   = s.karli ? 'ab-oran-good' : 'ab-oran-high';
    var safeJson  = JSON.stringify(s).replace(/'/g, "&#39;");

    html += '<tr class="' + rowCls + '" onclick="selectAbakusRow(this,\'' + safeJson.replace(/\\/g,'\\\\').replace(/'/g,"\\'") + '\')">' +
      '<td><strong>' + s.label + '</strong>' + vurgu + '</td>' +
      '<td class="ab-zincir-cell">' + s.zincir + '</td>' +
      '<td class="' + oranCls + '">%' + s.oran.toFixed(2) + '</td>' +
      '<td class="ab-mono">' + fmt(s.aylik) + '</td>' +
      '<td class="ab-mono ab-tahsilat-cell">' + fmt(s.tahsilat) + '</td>' +
      '<td class="ab-badge-cell">' + badge + '</td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';

  // Tüm zincirler karşılaştırma (details — açılır)
  html += '<details class="ab-all-zincir" style="margin-top:12px;">';
  html += '<summary class="ab-all-zincir-summary">Tüm Zincir Detayları</summary>';
  html += '<div class="ab-zincir-grid">';

  zRows.forEach(function(satir) {
    html += '<div class="ab-zincir-card"><div class="ab-zincir-card-title">' + satir.Zincir + '</div>';
    html += '<table class="ab-table ab-table-sm"><tbody>';
    TAK.forEach(function(td) {
      if (td.n > maxT) return;
      var oran = parseFloat(satir[td.key]);
      if (isNaN(oran) || oran <= 0) return;
      var tahsilat = yuvarlaCeyrek(nakit / (1 - oran/100));
      var aylik    = yuvarlaCeyrek(nakit / (1 - oran/100) / td.n);
      var karli    = oran < KOMISYON_ESIGI;
      html += '<tr class="' + (karli?'ab-row-good':'') + '">' +
        '<td>' + td.label + '</td>' +
        '<td class="' + (karli?'ab-oran-good':'ab-oran-high') + '">%' + oran.toFixed(2) + '</td>' +
        '<td class="ab-mono">' + fmt(aylik) + '</td>' +
        '<td class="ab-mono">' + fmt(tahsilat) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
  });

  html += '</div></details>';

  resEl.innerHTML = html;
}

function selectAbakusRow(rowEl, jsonStr) {
  haptic(14);
  // Önceki seçimi temizle
  document.querySelectorAll('.ab-row-selected').forEach(function(r) { r.classList.remove('ab-row-selected'); });
  rowEl.classList.add('ab-row-selected');

  try { abakusSelection = JSON.parse(jsonStr); }
  catch(e) { console.error('selectAbakusRow parse:', e); return; }

  // WA butonunu göster
  var waBtn = document.getElementById('ab-wa-btn');
  if (waBtn) {
    waBtn.style.display = 'flex';
    waBtn.innerHTML =
      '<span>\ud83d\udcf2</span>' +
      '<span>' + abakusSelection.label + ' · ' + abakusSelection.zincir + ' POS</span>' +
      '<strong>' + fmt(abakusSelection.tahsilat) + '</strong>' +
      '<span class="ab-wa-oran">%' + abakusSelection.oran.toFixed(2) + '</span>';
  }
}

// ═══════════════════════════════════════════════════════════════
//  DEĞİŞİKLİK KONTROLÜ
// ═══════════════════════════════════════════════════════════════
function checkChanges(json) {
  var sk = 'last_json_'+(currentUser?currentUser.Email:'guest');
  var vk = 'seen_ver_' +(currentUser?currentUser.Email:'guest');
  var last = JSON.parse(localStorage.getItem(sk))||{};
  var changes = [];
  if (last.data && Array.isArray(json.data)) {
    json.data.forEach(function(p) {
      var old = null;
      for (var i=0;i<last.data.length;i++){if(last.data[i].Kod===p.Kod){old=last.data[i];break;}}
      if (!old) return;
      Object.keys(p).forEach(function(f) {
        if (String(p[f])===String(old[f])) return;
        var fn=norm(f); var note;
        if (fn==='stok') { var d=Number(p[f])-Number(old[f]); note='Stok '+(d>0?d+' artti':Math.abs(d)+' azaldi')+'('+old[f]+'->'+p[f]+')'; }
        else if (fn==='aciklama') { note='Aciklama guncellendi'; }
        else if (fn==='nakit'||f==='4T AWM'||f.indexOf('Kart')!==-1||f.indexOf('ekim')!==-1) {
          var d2=parseFloat(p[f])-parseFloat(old[f]);
          if (!isNaN(d2)) note=f+' '+(d2>0?'+'+fmt(d2)+' artti':fmt(Math.abs(d2))+' azaldi');
        }
        if (note) { var uk=Object.keys(p).find(function(k){return norm(k)==='urun';})||'Kod'; changes.push((p[uk]||p.Kod)+': '+note); }
      });
    });
  }
  localStorage.setItem(sk,JSON.stringify(json));
  if (!changes.length) return;
  var vKey=(json.metadata&&json.metadata.v)||'v?';
  var seen=JSON.parse(localStorage.getItem(vk))||[];
  if (seen.indexOf(vKey)!==-1) return;
  seen.push(vKey); if(seen.length>2)seen.splice(0,seen.length-2);
  localStorage.setItem(vk,JSON.stringify(seen));
  showChangePopup(changes);
  showChangeToasts(changes.slice(0,3));
}
function showChangePopup(changes) {
  document.getElementById('change-list').innerHTML=changes.map(function(c){return '<div class="change-item"><span class="change-dot"></span><span>'+c+'</span></div>';}).join('');
  var p=document.getElementById('change-popup'); p.style.display='flex'; p.classList.add('open');
}
function closeChangePopup() { var p=document.getElementById('change-popup'); p.style.display='none'; p.classList.remove('open'); }
function showChangeToasts(changes) {
  var ct=document.getElementById('change-toast'); if(!ct)return;
  changes.forEach(function(msg,i){
    setTimeout(function(){
      var el=document.createElement('div'); el.className='toast-item';
      el.innerHTML='<span>\ud83d\udd14</span><span style="flex:1">'+msg+'</span><button class="toast-close" onclick="this.parentElement.remove()">\u00d7</button>';
      ct.appendChild(el); setTimeout(function(){el.remove();},6000);
    },i*700);
  });
}

// ═══════════════════════════════════════════════════════════════
//  ANALİTİK
// ═══════════════════════════════════════════════════════════════
function logAnalytics(action,detail) {
  if(!currentUser)return;
  var today=new Date().toISOString().split('T')[0];
  var email=currentUser.Email;
  var local=JSON.parse(localStorage.getItem('analytics_local'))||{};
  if(!local[today])local[today]={};
  if(!local[today][email])local[today][email]={logins:0,proposals:0,basketAdds:0,products:{}};
  var rec=local[today][email];
  if(action==='login')rec.logins++;
  if(action==='whatsapp')rec.proposals++;
  if(action==='addToBasket'){rec.basketAdds++;if(detail)rec.products[detail]=(rec.products[detail]||0)+1;}
  localStorage.setItem('analytics_local',JSON.stringify(local));
  if((action==='login'||action==='whatsapp')&&GITHUB_TOKEN)pushAnalytics(local);
}
async function pushAnalytics(data) {
  if(!GITHUB_TOKEN)return;
  try {
    var url='https://api.github.com/repos/'+GITHUB_REPO+'/contents/'+ANALYTICS_PATH;
    var gr=await fetch(url,{headers:{Authorization:'token '+GITHUB_TOKEN}});
    var sha=''; if(gr.ok){var j=await gr.json();sha=j.sha||'';}
    var content=btoa(unescape(encodeURIComponent(JSON.stringify(data,null,2))));
    var body={message:'analytics update',content:content,branch:'main'};
    if(sha)body.sha=sha;
    await fetch(url,{method:'PUT',headers:{Authorization:'token '+GITHUB_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)});
  }catch(e){}
}
async function loadAnalyticsData(){return JSON.parse(localStorage.getItem('analytics_local'))||{};}

// ═══════════════════════════════════════════════════════════════
//  ADMİN
// ═══════════════════════════════════════════════════════════════
async function openAdmin(){
  if(!isAdmin()){alert('Yetkisiz erisim.');return;}
  haptic(18);
  var m=document.getElementById('admin-modal'); m.style.display='flex'; m.classList.add('open');
  renderAdminPanel();
}
function closeAdmin(){var m=document.getElementById('admin-modal');m.classList.remove('open');m.style.display='none';}
function switchAdminTab(tab){
  document.querySelectorAll('.admin-tab').forEach(function(t){t.classList.toggle('active',t.dataset.tab===tab);});
  document.querySelectorAll('.admin-tab-content').forEach(function(c){c.classList.toggle('active',c.id==='tab-'+tab);});
}
async function renderAdminPanel(){
  var data=await loadAnalyticsData();
  var dates=Object.keys(data).sort().slice(-7);
  var today=new Date().toISOString().split('T')[0];
  var tL=0,tP=0,tA=0;var au=new Set(),us={},pm={};
  Object.entries(data).forEach(function(de){
    var date=de[0],byUser=de[1];
    Object.entries(byUser).forEach(function(ue){
      var email=ue[0],rec=ue[1];
      tL+=rec.logins||0;tP+=rec.proposals||0;tA+=rec.basketAdds||0;
      if((rec.logins||0)>0)au.add(email);
      if(!us[email])us[email]={logins:0,proposals:0,adds:0,lastSeen:''};
      us[email].logins+=rec.logins||0;us[email].proposals+=rec.proposals||0;us[email].adds+=rec.basketAdds||0;
      if(date>us[email].lastSeen)us[email].lastSeen=date;
      Object.entries(rec.products||{}).forEach(function(pe){pm[pe[0]]=(pm[pe[0]]||0)+pe[1];});
    });
  });
  document.getElementById('stat-logins').textContent=tL;
  document.getElementById('stat-proposals').textContent=tP;
  document.getElementById('stat-adds').textContent=tA;
  document.getElementById('stat-users').textContent=au.size;
  var su=Object.entries(us).sort(function(a,b){return b[1].logins-a[1].logins;});
  document.getElementById('admin-user-list').innerHTML=su.map(function(e){
    var email=e[0],s=e[1];var ini=email.split('@')[0].slice(0,2).toUpperCase();
    return '<div class="user-row"><div class="user-avatar">'+ini+'</div><div class="user-info"><div class="user-email">'+email+'</div><div class="user-meta">Son giris: '+(s.lastSeen||'-')+'</div></div><div class="user-badges"><span class="badge badge-green">'+s.logins+' giris</span><span class="badge badge-blue">'+s.proposals+' teklif</span><span class="badge badge-orange">'+s.adds+' ekle</span></div></div>';
  }).join('')||'<div style="padding:16px;color:#94a3b8;font-size:.80rem">Henuz veri yok</div>';
  var tp=Object.entries(pm).sort(function(a,b){return b[1]-a[1];}).slice(0,10);
  var mx=tp.length?tp[0][1]:1;
  document.getElementById('admin-product-list').innerHTML=tp.map(function(e,i){
    return '<div class="product-row"><span class="product-rank">'+(i+1)+'</span><div class="product-bar-wrap"><div class="product-bar-name">'+e[0]+'</div><div class="product-bar-track"><div class="product-bar-fill" style="width:'+Math.round(e[1]/mx*100)+'%"></div></div></div><span class="product-bar-count">'+e[1]+'x</span></div>';
  }).join('')||'<div style="padding:16px;color:#94a3b8;font-size:.80rem">Henuz veri yok</div>';
  var dc=dates.map(function(date){var c=0;Object.values(data[date]||{}).forEach(function(r){c+=r.logins||0;});return{date:date,c:c};});
  var md=1;dc.forEach(function(d){if(d.c>md)md=d.c;});
  document.getElementById('admin-daily-chart').innerHTML=dc.map(function(d){
    return '<div class="chart-bar-wrap"><div class="chart-bar '+(d.date===today?'today':'')+'" style="height:'+Math.round(d.c/md*100)+'%"></div><span class="chart-label">'+d.date.slice(5)+'</span></div>';
  }).join('');
}
