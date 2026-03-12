// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — app.js  (Rev 3.0 — Firebase Firestore)
//  Teklifler ve Satışlar artık Firebase'de — cihazlar arası senkron
// ═══════════════════════════════════════════════════════════════

// ─── FİREBASE BAŞLATMA ──────────────────────────────────────────
import { initializeApp }                           from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
import { getFirestore, collection, doc, deleteDoc,
         addDoc, setDoc, updateDoc, onSnapshot,
         query, orderBy, serverTimestamp,
         getDoc }                                  from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const _FB_CFG = {
  apiKey:            "AIzaSyB6ng3XtLONcTlmBXW83gBVQTJGGt9xFII",
  authDomain:        "aygun-teklif.firebaseapp.com",
  projectId:         "aygun-teklif",
  storageBucket:     "aygun-teklif.firebasestorage.app",
  messagingSenderId: "765946162646",
  appId:             "1:765946162646:web:f173e0694a26d36cd10877"
};
const _fbApp = initializeApp(_FB_CFG);
const _db    = getFirestore(_fbApp);
const _colProp      = () => collection(_db, 'proposals');
const _colSales     = () => collection(_db, 'sales');
const _colSiparis   = () => collection(_db, 'siparis');
const _colAnalytics = () => collection(_db, 'analytics');

// ─── FİRESTORE YARDIMCI FONKSİYONLAR ───────────────────────────
// Firestore'a teklif kaydet
async function fbSaveProp(prop) {
  try {
    const ref = doc(_db, 'proposals', prop.id);
    await setDoc(ref, _fbSerialize(prop));
  } catch(e) { console.error('fbSaveProp:', e); }
}
// Firestore'a satış kaydet
async function fbSaveSale(sale) {
  try {
    const ref = doc(_db, 'sales', sale.id);
    await setDoc(ref, _fbSerialize(sale));
  } catch(e) { console.error('fbSaveSale:', e); }
}
// Teklife not/durum güncelle
async function fbUpdateProp(id, fields) {
  try {
    await updateDoc(doc(_db, 'proposals', id), fields);
  } catch(e) { console.error('fbUpdateProp:', e); }
}
// undefined değerleri null'a çevir (Firestore kabul etmez)
function _fbSerialize(obj) {
  return JSON.parse(JSON.stringify(obj, (k,v) => v===undefined ? null : v));
}
// Realtime listeners — uygulama açıkken veriyi canlı günceller
window._propUnsub = null; window._saleUnsub = null;
function startFirebaseListeners() {
  // Proposals
  if(window._propUnsub) window._propUnsub();
  window._propUnsub = onSnapshot(
    query(_colProp(), orderBy('ts', 'desc')),
    snap => {
      proposals = snap.docs.map(d => d.data());
      // localStorage'ı da güncelle (offline fallback)
      localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
      updateProposalBadge();
      // Açık modalları yenile
      if(document.getElementById('proposals-modal')?.classList.contains('open')) renderProposals();
      // Admin paneli açıksa ilgili sekmeleri güncelle
      const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
      if(adminOpen) {
        const activeTab = document.querySelector('.admin-tab.active')?.dataset?.tab;
        if(activeTab === 'overview') { renderSepetDurum(); renderAdminPanel(); }
        if(activeTab === 'sepetler') { renderSepetDetay(); }
        if(activeTab === 'personel') { renderAdminUsers(); }
      }
    },
    err => console.error('proposals listener:', err)
  );
  // Sales
  if(window._saleUnsub) window._saleUnsub();
  window._saleUnsub = onSnapshot(
    query(_colSales(), orderBy('ts', 'desc')),
    snap => {
      sales = snap.docs.map(d => d.data());
      localStorage.setItem('aygun_sales', JSON.stringify(sales));
    },
    err => console.error('sales listener:', err)
  );
  // Sipariş notları listener
  if(window._siparisUnsub) window._siparisUnsub();
  window._siparisUnsub = onSnapshot(
    query(_colSiparis(), orderBy('ts', 'desc')),
    snap => {
      window._siparisData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Admin paneli sepetler sekmesi açıksa güncelle
      const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
      if(adminOpen) {
        const activeTab = document.querySelector('.admin-tab.active')?.dataset?.tab;
        if(activeTab === 'siparis') renderSiparisPanel();
        updateSiparisBadge();
      }
    },
    err => console.warn('siparis listener:', err)
  );
  // Analytics listener — tüm kullanıcı verilerini çek
  if(window._analyticsUnsub) window._analyticsUnsub();
  window._analyticsUnsub = onSnapshot(
    collection(_db, 'analytics'),
    snap => {
      window._fbAnalytics = {};
      snap.docs.forEach(d => { window._fbAnalytics[d.id] = d.data(); });
    },
    err => console.warn('analytics listener:', err)
  );
}


// ─── VERİ YOLU ─────────────────────────────────────────────────
function dataUrl(file) {
  // index.html'in bulunduğu klasöre göre Data/ klasörünü bul
  // document.baseURI veya location en güvenilir yöntemdir
  const base = document.baseURI
    ? document.baseURI.replace(/\/[^\/]*$/, '/')
    : (window.location.href.replace(/\/[^\/]*$/, '/'));
  return base + 'data/' + file;
}

// ─── GLOBAL STATE ───────────────────────────────────────────────
let allProducts     = [];
let allRates        = [];
let basket          = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount  = 0, discountType = 'TRY';
let currentUser     = JSON.parse(localStorage.getItem('aygun_user')) || null;
let currentVersion  = '...';
let showZeroStock   = false;
let abakusSelection = null;   // null → Nakit, obje → Taksit bilgisi

// Yerel depolar — Firebase listener gelene kadar localStorage'dan yükle
let proposals = JSON.parse(localStorage.getItem('aygun_proposals')) || [];
let sales     = JSON.parse(localStorage.getItem('aygun_sales'))     || [];
let messages  = [];

// Kart max taksit
const KART_MAX_TAKSIT = {
  'Axess':9,'Bonus':9,'Maximum':9,'World':9,'Vakifbank':9,'Vakıfbank':9,
  'BanKKart':9,'Bankkart':9,'Paraf':9,'QNB':9,'Finans':9,
  'Sirket Kartlari':9,'Şirket Kartları':9,'Aidatsiz Kartlar':9,'Aidatsız Kartlar':9
};
const KOMISYON_ESIGI = 10.0;

// ─── HAPTIC ─────────────────────────────────────────────────────
function haptic(ms) { if (navigator.vibrate) navigator.vibrate(ms||18); }
document.addEventListener('click', e => {
  if (e.target.closest('.haptic-btn,.add-btn,.remove-btn,.btn-login,.cart-trigger'))
    haptic();
}, { passive:true });

// ─── DOM HAZIR ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const passInput = document.getElementById('pass-input');
  if (passInput) passInput.addEventListener('keydown', e => {
    if (e.key==='Enter') checkAuth();
  });
  if (currentUser) {
    showApp();
    loadData();
  }
});

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-content').style.display  = 'block';
  const ab = document.getElementById('admin-btn');
  if(ab) ab.style.display = isAdmin() ? 'flex' : 'none';
  // Çıkış: satış kullanıcıları header'dan çıkış yapar
  const lb = document.getElementById('logout-btn');
  if(lb) lb.style.display = isAdmin() ? 'none' : 'flex';
  updateProposalBadge();
  startFirebaseListeners();
}

function safeJSON(text) {
  return JSON.parse(text.replace(/^\uFEFF/,'').trim());
}

// ─── HASH TABANLI GİRİŞ ─────────────────────────────────────────
async function sha256hex(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function checkAuth() {
  haptic(22);
  const u   = document.getElementById('user-input').value.trim().toLowerCase();
  const p   = document.getElementById('pass-input').value.trim();
  const err = document.getElementById('login-err');
  if (!u||!p) { err.textContent='E-mail ve şifre boş bırakılamaz.'; err.style.display='block'; return; }

  const btn = document.querySelector('.btn-login');
  if(btn) { btn.textContent='Giriş yapılıyor...'; btn.disabled=true; }

  try {
    const resp = await fetch(dataUrl('kullanicilar.json')+'?t='+Date.now());
    const text = await resp.text();
    let users;
    try { users = safeJSON(text); } catch(pe) {
      err.textContent='Kullanıcı listesi okunamadı: '+pe.message; err.style.display='block';
      if(btn) { btn.textContent='Giriş Yap →'; btn.disabled=false; }
      return;
    }
    if (!Array.isArray(users)) users = users.data||[];

    const pHash = await sha256hex(p);
    let user = null;
    for (const u2 of users) {
      const emailMatch = u2.Email && u2.Email.toLowerCase().trim()===u;
      // Şifre düz metin veya Hash (kısa hash) veya SifreHash (tam hash) ile karşılaştır
      const plainMatch = u2.Sifre && u2.Sifre.trim()===p;
      const hashMatch  = (u2.SifreHash && u2.SifreHash===pHash) ||
                         (u2.Hash && pHash.startsWith(u2.Hash));
      if (emailMatch && (plainMatch || hashMatch)) { user=u2; break; }
    }

    if (user) {
      currentUser = user;
      if (document.getElementById('remember-me').checked)
        localStorage.setItem('aygun_user', JSON.stringify(user));
      err.style.display='none';
      showApp();
      logAnalytics('login');
      loadData();
    } else {
      err.textContent='E-mail veya şifre hatalı!';
      err.style.display='block';
      haptic(80);
      document.getElementById('pass-input').value='';
      document.getElementById('pass-input').focus();
    }
  } catch(e) {
    err.textContent='Veri dosyası yüklenemedi. Sunucu üzerinden açın. ('+e.message+')';
    err.style.display='block';
  }

  if(btn) { btn.textContent='Giriş Yap →'; btn.disabled=false; }
}

function isAdmin() {
  if (!currentUser) return false;
  return currentUser.Rol === 'admin';
}

// ─── VERİ YÜKLE ─────────────────────────────────────────────────
async function loadData() {
  const urunUrl = dataUrl('urunler.json')+'?v='+Date.now();
  // Global cache — admin stok uyarısı ve uyuyan stok için
  console.log('[loadData] Fetching:', urunUrl);
  try {
    const resp = await fetch(urunUrl);
    if(!resp.ok) throw new Error('HTTP '+resp.status+' — '+urunUrl);
    const json = safeJSON(await resp.text());
    allProducts = Array.isArray(json.data)?json.data:(Array.isArray(json)?json:[]);
    window._cachedUrunler = allProducts; // admin stok için
    if (json.metadata?.v) currentVersion=json.metadata.v;
    const vt=document.getElementById('v-tag'); if(vt) vt.innerText=currentVersion;
    checkChanges(json);
    renderTable();
    updateCartUI();
  } catch(e) { console.error('urunler:',e); alert('Ürün listesi yüklenemedi.\nURL: '+urunUrl+'\nHata: '+e.message); }

  const oranUrl = dataUrl('oranlar.json')+'?v='+Date.now();
  try {
    const resp2 = await fetch(oranUrl);
    if(!resp2.ok) throw new Error('HTTP '+resp2.status);
    allRates = safeJSON(await resp2.text());
  } catch(e) { allRates=[]; console.warn('oranlar.json:', e.message); }
}

// ─── TABLO ──────────────────────────────────────────────────────
function filterData() { renderTable(document.getElementById('search').value.trim()); }

function renderTable(searchVal) {
  const kws = norm(searchVal||'').split(' ').filter(k=>k.length>0);
  const data = allProducts.filter(u => {
    if (!showZeroStock && (Number(u.Stok)||0)===0) return false;
    if (!kws.length) return true;
    return kws.every(kw => norm(Object.values(u).join(' ')).includes(kw));
  });
  const list = document.getElementById('product-list');
  list.innerHTML='';
  const frag = document.createDocumentFragment();
  data.forEach(u => {
    const oi      = allProducts.indexOf(u);
    const stok    = Number(u.Stok)||0;
    const sc      = stok===0?'stok-kritik':stok>10?'stok-bol':'stok-orta';
    const keys    = Object.keys(u);
    const urunKey = keys.find(k=>norm(k)==='urun')||'';
    const descKey = keys.find(k=>norm(k)==='aciklama')||'';
    const kartKey = keys.find(k=>k.includes('Kart'))||'';
    const cekKey  = keys.find(k=>k.includes('ekim'))||'';
    const gamKey  = keys.find(k=>norm(k).includes('gam'))||'';
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td><button class="add-btn haptic-btn" onclick="addToBasket(${oi})">+</button></td>`+
      `<td><span class="product-name">${u[urunKey]||''}</span>${u[descKey]?`<span class="product-desc">${u[descKey]}</span>`:''}</td>`+
      `<td class="${sc}">${stok}</td>`+
      `<td class="td-price">${fmt(u[kartKey])}</td>`+
      `<td class="td-price">${fmt(u['4T AWM'])}</td>`+
      `<td class="td-price">${fmt(u[cekKey])}</td>`+
      `<td class="td-price">${fmt(u.Nakit)}</td>`+
      `<td style="font-size:.67rem;color:var(--text-3)">${u.Kod||''}</td>`+
      `<td class="td-gam">${u[gamKey]||'-'}</td>`+
      `<td class="td-marka">${u.Marka||'-'}</td>`+
      `<td class="td-etiket">${u['Etiket Fiyatı']?fmt(u['Etiket Fiyatı']):'-'}</td>`+
      `<td><button class="siparis-btn haptic-btn" onclick="openSiparisNot('${(u[urunKey]||'').replace(/'/g,"&#39;")}',${oi})" title="Sipariş Notu Ekle">📦</button></td>`;
    frag.appendChild(tr);
  });
  list.appendChild(frag);
}

function toggleZeroStock() {
  showZeroStock=!showZeroStock;
  const btn=document.getElementById('stock-filter-btn');
  if(btn) btn.classList.toggle('active', showZeroStock);
  filterData();
}

function norm(s) {
  return (s||'').toLowerCase()
    .replace(/[ğĞ]/g,'g').replace(/[üÜ]/g,'u').replace(/[şŞ]/g,'s')
    .replace(/[ıİ]/g,'i').replace(/[öÖ]/g,'o').replace(/[çÇ]/g,'c');
}
function fmt(val) {
  const n=parseFloat(val);
  return isNaN(n)?(val||'-'):n.toLocaleString('tr-TR')+'\u00a0₺';
}
function yuvarlaCeyrek(n) { return Math.ceil(n/250)*250; }
function fmtDate(iso) { return new Date(iso).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}); }
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

// ─── SEPET ──────────────────────────────────────────────────────
function addToBasket(idx) {
  haptic(14);
  const p=allProducts[idx];
  const keys=Object.keys(p);
  const urunKey=keys.find(k=>norm(k)==='urun')||'';
  const kartKey=keys.find(k=>k.includes('Kart'))||'';
  const cekKey =keys.find(k=>k.includes('ekim'))||'';
  const descKey=keys.find(k=>norm(k)==='aciklama')||'';
  basket.push({
    urun:p[urunKey]||'', stok:Number(p.Stok)||0,
    dk:parseFloat(p[kartKey])||0, awm:parseFloat(p['4T AWM'])||0,
    tek:parseFloat(p[cekKey])||0, nakit:parseFloat(p.Nakit)||0,
    aciklama:p[descKey]||'-', kod:p.Kod||''
  });
  logAnalytics('addToBasket', p[urunKey]||'');
  saveBasket();
}
function saveBasket()        { localStorage.setItem('aygun_basket',JSON.stringify(basket)); updateCartUI(); }
function removeFromBasket(i) { haptic(12); basket.splice(i,1); saveBasket(); }
function clearBasket() {
  haptic(30); if(!confirm('Sepeti temizle?')) return;
  basket=[]; discountAmount=0;
  const di=document.getElementById('discount-input'); if(di) di.value='';
  saveBasket();
}
function applyDiscount() {
  const raw = (document.getElementById('discount-input').value||'').trim();
  // "500+400+300" gibi toplam ifadelerini hesapla
  if(raw && /^[\d\s\+\-\.]+$/.test(raw)) {
    try {
      const parts = raw.split('+').map(s=>parseFloat(s.trim())||0);
      discountAmount = parts.reduce((a,b)=>a+b, 0);
      if(raw.includes('+')) {
        // Toplamı input'a yaz
        document.getElementById('discount-input').value = discountAmount;
      }
    } catch(e) { discountAmount = parseFloat(raw)||0; }
  } else {
    discountAmount = parseFloat(raw)||0;
  }
  discountType=document.getElementById('discount-type').value||'TRY';
  updateCartUI();
}
function getDisc(t) { return discountType==='TRY'?discountAmount:t*discountAmount/100; }
function basketTotals() {
  const t={dk:0,awm:0,tek:0,nakit:0};
  basket.forEach(i=>{t.dk+=i.dk;t.awm+=i.awm;t.tek+=i.tek;t.nakit+=i.nakit;});
  return t;
}

// ─── SEPET UI ───────────────────────────────────────────────────
function updateCartUI() {
  const ce=document.getElementById('cart-count'); if(ce) ce.innerText=basket.length;
  const badge=document.getElementById('cart-modal-count'); if(badge) badge.textContent=basket.length+' ürün';
  const area=document.getElementById('cart-table-area'); if(!area) return;
  if(!basket.length) { area.innerHTML='<div class="empty-cart"><span class="empty-cart-icon">🛒</span>Sepetiniz boş</div>'; return; }
  const t=basketTotals();
  let rows='';
  basket.forEach((item,idx) => {
    rows+=`<tr>`+
      `<td><span class="product-name" style="font-size:.75rem">${item.urun}</span></td>`+
      `<td class="${item.stok===0?'cart-stok-0':''}">${item.stok}</td>`+
      `<td style="font-size:.65rem;color:var(--text-3);max-width:90px;word-break:break-word">${item.aciklama}</td>`+
      `<td class="cart-price">${fmt(item.dk)}</td>`+
      `<td class="cart-price">${fmt(item.awm)}</td>`+
      `<td class="cart-price">${fmt(item.tek)}</td>`+
      `<td class="cart-price">${fmt(item.nakit)}</td>`+
      `<td><button class="remove-btn haptic-btn" onclick="removeFromBasket(${idx})">×</button></td></tr>`;
  });
  let dr='';
  if(discountAmount>0) {
    dr=`<tr class="discount-row"><td colspan="3" style="text-align:right;font-size:.69rem">İndirim ${discountType==='PERCENT'?'%'+discountAmount:fmt(discountAmount)}</td>`+
      `<td class="cart-price">-${fmt(getDisc(t.dk))}</td><td class="cart-price">-${fmt(getDisc(t.awm))}</td>`+
      `<td class="cart-price">-${fmt(getDisc(t.tek))}</td><td class="cart-price">-${fmt(getDisc(t.nakit))}</td><td></td></tr>`;
  }
  const tot=`<tr class="total-row"><td colspan="3" style="text-align:right;font-weight:700">NET TOPLAM</td>`+
    `<td class="cart-price">${fmt(t.dk-getDisc(t.dk))}</td><td class="cart-price">${fmt(t.awm-getDisc(t.awm))}</td>`+
    `<td class="cart-price">${fmt(t.tek-getDisc(t.tek))}</td><td class="cart-price">${fmt(t.nakit-getDisc(t.nakit))}</td><td></td></tr>`;
  area.innerHTML=`<table class="cart-table"><thead><tr><th>Ürün</th><th>Stok</th><th>Açıklama</th><th>D.Kart</th><th>4T AWM</th><th>Tek Çekim</th><th>Nakit</th><th></th></tr></thead><tbody>${rows}${dr}${tot}</tbody></table>`;
}

// ─── MODAL KONTROL ──────────────────────────────────────────────
function toggleCart() {
  haptic(16);
  const m=document.getElementById('cart-modal');
  if(!m) return;
  if(m.classList.contains('open')) { m.classList.remove('open'); m.style.display='none'; }
  else { m.style.display='flex'; m.classList.add('open'); updateCartUI(); }
}

// ─── KARŞILAMA / BİLGİLENDİRME EKRANI ──────────────────────────
function openWelcomeInfo() {
  haptic(16);
  const m = document.getElementById('welcome-info-modal');
  if(m) { m.style.display='flex'; m.classList.add('open'); }
}
function closeWelcomeInfo() {
  const m = document.getElementById('welcome-info-modal');
  if(m) { m.classList.remove('open'); m.style.display='none'; }
}

// ─── ABAKÜS ─────────────────────────────────────────────────────
function openAbakus() {
  haptic(18);
  if(!basket.length) { alert('Önce sepete ürün ekleyin!'); return; }
  abakusSelection = null; // null = Nakit seçili
  const m=document.getElementById('abakus-modal');
  m.style.display='flex'; m.classList.add('open');
  buildAbakusKartlar(); calcAbakus();
}
function closeAbakus() {
  const m=document.getElementById('abakus-modal');
  m.classList.remove('open'); m.style.display='none';
}
function buildAbakusKartlar() {
  if(!allRates.length) return;
  const kartlar=[];
  allRates.forEach(r=>{ if(r.Kart && !kartlar.includes(r.Kart)) kartlar.push(r.Kart); });
  const ks=document.getElementById('ab-kart'); if(!ks) return;
  ks.innerHTML=kartlar.map(k=>`<option value="${k}">${k}</option>`).join('');
}

function calcAbakus() {
  abakusSelection = null; // sıfırla
  // Aksiyon panelini gizle
  const actDiv=document.getElementById('ab-actions');
  if(actDiv) actDiv.style.display='none';
  const waBtn=document.getElementById('ab-wa-btn');
  if(waBtn) { waBtn.style.display='none'; }

  const t=basketTotals();
  let nakit=t.nakit-getDisc(t.nakit);
  const manEl=document.getElementById('ab-nakit');
  if(manEl && manEl.value!=='') { const mn=parseFloat(manEl.value.replace(',','.')); if(!isNaN(mn)&&mn>0) nakit=mn; }

  const ks=document.getElementById('ab-kart'); if(!ks) return;
  const secKart=ks.value;
  const maxT=KART_MAX_TAKSIT[secKart]||9;
  const zRows=allRates.filter(r=>r.Kart===secKart);
  const resEl=document.getElementById('ab-result'); if(!resEl) return;

  if(!zRows.length) { resEl.innerHTML='<div class="ab-no-data">Bu kart için oran bulunamadı.</div>'; return; }

  const TAK=[
    {label:'Tek Çekim',n:1,key:'Tek',oncelik:9},
    {label:'2 Taksit', n:2,key:'2Taksit',oncelik:8},
    {label:'3 Taksit', n:3,key:'3Taksit',oncelik:7},
    {label:'4 Taksit', n:4,key:'4Taksit',oncelik:1},
    {label:'5 Taksit', n:5,key:'5Taksit',oncelik:2},
    {label:'6 Taksit', n:6,key:'6Taksit',oncelik:3},
    {label:'7 Taksit', n:7,key:'7Taksit',oncelik:4},
    {label:'8 Taksit', n:8,key:'8Taksit',oncelik:5},
    {label:'9 Taksit', n:9,key:'9Taksit',oncelik:6},
  ];

  const enKarliMap={};
  zRows.forEach(satir => {
    TAK.forEach(td => {
      if(td.n>maxT) return;
      const oran=parseFloat(satir[td.key]);
      if(isNaN(oran)||oran<=0) return;
      // Toplam tahsilat 250 ve katlarına yuvarlanır
      const tahsilat = yuvarlaCeyrek(nakit/(1-oran/100));
      // Aylık taksit = Toplam tahsilat / Taksit sayısı (tam bölüm, yuvarlama yok)
      const aylik = td.n === 1 ? tahsilat : Math.round(tahsilat / td.n);
      if(!enKarliMap[td.n]||oran<enKarliMap[td.n].oran) {
        enKarliMap[td.n]={
          label:td.label, taksit:td.n, oncelik:td.oncelik,
          zincir:satir.Zincir, oran,
          tahsilat, aylik,
          karli:oran<KOMISYON_ESIGI
        };
      }
    });
  });

  const liste=Object.values(enKarliMap).sort((a,b)=>a.oncelik-b.oncelik);
  if(!liste.length) { resEl.innerHTML='<div class="ab-no-data">Hesaplanacak oran bulunamadı.</div>'; return; }

  const mutlakEnKarli=liste.slice().sort((a,b)=>a.oran-b.oran)[0];
  let html='';
  html+=`<div class="ab-nakit-row"><span>Baz Nakit</span><strong>${fmt(nakit)}</strong><span class="ab-kart-badge">${secKart} · max ${maxT}T</span></div>`;

  // NAKİT SEÇENEĞİ — işaretlenebilir satır olarak
  html+=`<div class="ab-table-wrap">
    <table class="ab-table">
      <thead><tr>
        <th>Taksit</th>
        <th>Zincir POS</th>
        <th>Aylık Taksit</th>
        <th>Toplam Tahsilat</th>
        <th></th>
      </tr></thead>
      <tbody>`;

  // Nakit satırı — data attribute ile (JSON alıntı sorunu yok)
  html+=`<tr class="ab-row-nakit ab-row-sel" id="ab-row-nakit-tr" onclick="selectAbakusRow(this)">
    <td><strong>💵 Nakit</strong></td>
    <td class="ab-zincir-cell">—</td>
    <td class="ab-mono">—</td>
    <td class="ab-mono ab-tahsilat-cell">${fmt(nakit)}</td>
    <td class="ab-badge-cell"><span class="ab-badge-nakit">NAKİT</span></td>
  </tr>`;

  liste.forEach(s => {
    const isEK=s===mutlakEnKarli;
    const rowCls=isEK?'ab-row-best ab-row-sel':(s.karli?'ab-row-good ab-row-sel':'ab-row-sel');
    const vurgu=s.taksit>=4?'<span class="ab-taksit-dot"></span>':'';
    const badge=isEK?'<span class="ab-badge-best">★ EN KARLI</span>':(s.karli?'<span class="ab-badge-good">✓ UYGUN</span>':'');
    html+=`<tr class="${rowCls}" onclick="selectAbakusRow(this)">
      <td><strong>${s.label}</strong>${vurgu}</td>
      <td class="ab-zincir-cell">${s.zincir}</td>
      <td class="ab-mono">${fmt(s.aylik)}</td>
      <td class="ab-mono ab-tahsilat-cell">${fmt(s.tahsilat)}</td>
      <td class="ab-badge-cell">${badge}</td>
    </tr>`;
  });

  html+=`</tbody></table></div>`;

  // Zincir detayları
  html+=`<details class="ab-all-zincir"><summary class="ab-all-zincir-summary">Tüm Zincir Detayları</summary><div class="ab-zincir-grid">`;
  zRows.forEach(satir => {
    html+=`<div class="ab-zincir-card"><div class="ab-zincir-card-title">${satir.Zincir}</div><table class="ab-table ab-table-sm"><tbody>`;
    TAK.forEach(td => {
      if(td.n>maxT) return;
      const oran=parseFloat(satir[td.key]);
      if(isNaN(oran)||oran<=0) return;
      const tahsilat=yuvarlaCeyrek(nakit/(1-oran/100));
      const aylik = td.n === 1 ? tahsilat : Math.round(tahsilat / td.n);
      const karli=oran<KOMISYON_ESIGI;
      html+=`<tr class="${karli?'ab-row-good':''}"><td>${td.label}</td><td class="ab-mono">${fmt(aylik)}</td><td class="ab-mono">${fmt(tahsilat)}</td></tr>`;
    });
    html+=`</tbody></table></div>`;
  });
  html+=`</div></details>`;
  resEl.innerHTML=html;

  // data-abrow attribute'larını DOM'a yaz (innerHTML set edildikten sonra)
  const nakitRow = resEl.querySelector('#ab-row-nakit-tr');
  if(nakitRow) nakitRow.dataset.abrow = JSON.stringify({type:'nakit', nakit});
  const allRows = resEl.querySelectorAll('tr.ab-row-sel:not(#ab-row-nakit-tr)');
  let li=0;
  allRows.forEach(tr => {
    if(li < liste.length) { tr.dataset.abrow = JSON.stringify(liste[li]); li++; }
  });
}

function selectAbakusRow(rowEl) {
  haptic(14);
  document.querySelectorAll('.ab-row-selected').forEach(r=>r.classList.remove('ab-row-selected'));
  rowEl.classList.add('ab-row-selected');
  try {
    const raw = rowEl.dataset.abrow || '{}';
    const parsed = JSON.parse(raw);
    abakusSelection = (parsed.type === 'nakit') ? null : parsed;
  } catch(e) { console.error('selectAbakusRow:', e); return; }

  // Aksiyon panelini göster
  const actDiv = document.getElementById('ab-actions');
  const infoDiv = document.getElementById('ab-selection-info');
  if(actDiv) {
    actDiv.style.display = 'block';
    if(infoDiv) {
      if(abakusSelection === null) {
        const t=basketTotals();
        let nakit=t.nakit-getDisc(t.nakit);
        const manEl=document.getElementById('ab-nakit');
        if(manEl && manEl.value!=='') { const mn=parseFloat(manEl.value.replace(',','.')); if(!isNaN(mn)&&mn>0) nakit=mn; }
        infoDiv.innerHTML = `<span class="ab-sel-chip ab-sel-nakit">💵 Nakit — ${fmt(nakit)}</span>`;
      } else {
        infoDiv.innerHTML = `<span class="ab-sel-chip">${abakusSelection.label}</span><span class="ab-sel-chip">${abakusSelection.zincir} POS</span><span class="ab-sel-chip ab-sel-tahsilat">${fmt(abakusSelection.tahsilat)}</span><span class="ab-sel-chip ab-sel-aylik">Aylık ${fmt(abakusSelection.aylik)}</span>`;
      }
    }
  }
  // Eski wa-btn uyumluluğu
  const waBtn=document.getElementById('ab-wa-btn');
  if(waBtn) waBtn.style.display='none';
}

// ─── WA / TEKLİF / SATIŞ AKSİYON MODAL ─────────────────────────
let _aksiyonMode = 'wa'; // 'wa' | 'teklif' | 'satis'

function openAbakusAction(mode) {
  haptic(20);
  if(!document.querySelector('.ab-row-selected')) {
    const ct=document.getElementById('change-toast');
    if(ct){ ct.textContent='Önce bir ödeme yöntemi seçin!'; ct.classList.add('show'); setTimeout(()=>ct.classList.remove('show'),2200); }
    return;
  }
  _aksiyonMode = mode;

  const t=basketTotals();
  let nakit=t.nakit-getDisc(t.nakit);
  const manEl=document.getElementById('ab-nakit');
  if(manEl && manEl.value!=='') { const mn=parseFloat(manEl.value.replace(',','.')); if(!isNaN(mn)&&mn>0) nakit=mn; }

  // Ödeme metni
  let odemeMetni = '';
  if(abakusSelection===null) {
    odemeMetni = 'Nakit — '+fmt(nakit);
  } else {
    odemeMetni = abakusSelection.label+' / '+abakusSelection.zincir+' POS — Toplam: '+fmt(abakusSelection.tahsilat)+' / Aylık: '+fmt(abakusSelection.aylik);
  }

  closeAbakus();

  setTimeout(()=>{
    const m=document.getElementById('wa-modal'); if(!m) return;

    const title=document.getElementById('wa-modal-title');
    const info=document.getElementById('wa-abakus-info');
    const saleFields=document.getElementById('sale-extra-fields');
    const sendBtn=document.getElementById('aksiyon-send-btn');
    const phoneLabel=document.getElementById('phone-req-label');

    // Seçilen ödeme bilgisini göster
    if(info) {
      info.style.display='block';
      if(abakusSelection===null) {
        info.innerHTML='<div class="wa-ab-info-box"><span class="wa-ab-chip wa-ab-nakit">💵 Nakit</span><span class="wa-ab-chip wa-ab-tahsilat">'+fmt(nakit)+'</span></div>';
      } else {
        info.innerHTML='<div class="wa-ab-info-box"><span class="wa-ab-chip">'+abakusSelection.label+'</span><span class="wa-ab-chip">'+abakusSelection.zincir+' POS</span><span class="wa-ab-chip wa-ab-tahsilat">'+fmt(abakusSelection.tahsilat)+'</span><span class="wa-ab-chip wa-ab-aylik">Aylık '+fmt(abakusSelection.aylik)+'</span></div>';
      }
    }

    // Moda göre başlık, alanlar, buton
    const sureField = document.getElementById('sure-field');
    if(mode==='wa') {
      if(title) title.textContent='📲 WhatsApp Teklif';
      if(saleFields) saleFields.style.display='none';
      if(sureField) sureField.style.display='block';
      const gizlilikFldWa = document.getElementById('gizlilik-field');
      if(gizlilikFldWa) gizlilikFldWa.style.display='block';
      if(sendBtn) sendBtn.innerHTML='📲 WhatsApp\'ta Gönder';
      if(phoneLabel) phoneLabel.textContent='(WhatsApp için zorunlu)';
    } else if(mode==='teklif') {
      if(title) title.textContent='📋 Teklif Oluştur';
      if(saleFields) saleFields.style.display='none';
      if(sureField) sureField.style.display='block';
      const gizlilikFld2 = document.getElementById('gizlilik-field');
      if(gizlilikFld2) gizlilikFld2.style.display='block';
      if(sendBtn) sendBtn.innerHTML='📋 Teklifi Kaydet';
      if(phoneLabel) phoneLabel.textContent='(opsiyonel)';
    } else if(mode==='satis') {
      if(title) title.textContent='🧾 Satış Belgesi';
      if(saleFields) saleFields.style.display='block';
      if(sendBtn) sendBtn.innerHTML='🧾 Satış Belgesi Oluştur';
      if(phoneLabel) phoneLabel.textContent='(zorunlu)';
      // Satış yöntemini otomatik doldur
      const smEl=document.getElementById('cust-sale-method');
      if(smEl) smEl.value = odemeMetni;
    }

    m.style.display='flex';
    requestAnimationFrame(()=>m.classList.add('open'));
  }, 150);
}

// Geriye dönük uyumluluk
function openWaFromAbakus() { openAbakusAction('wa'); }
function openWaDirect() {}
function saveProposalDirect() {}

function closeWaModal() {
  const m=document.getElementById('wa-modal'); if(m){ m.classList.remove('open'); m.style.display='none'; }
  const info=document.getElementById('wa-abakus-info');
  if(info) { info.style.display='none'; info.innerHTML=''; }
  const saleFields=document.getElementById('sale-extra-fields');
  if(saleFields) saleFields.style.display='none';
}

function _clearAksiyonForm() {
  ['cust-name','cust-phone','cust-phone2','extra-info','cust-tc','cust-email','cust-address','cust-sale-method','teklif-sure-bitis']
    .forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
}

function finalizeAksiyon() {
  haptic(22);
  if(!basket.length) { alert('Sepet boş!'); return; }

  const custName  = (document.getElementById('cust-name')?.value||'').trim() || '-';
  const phone     = (document.getElementById('cust-phone')?.value||'').trim();
  const extraNote = (document.getElementById('extra-info')?.value||'').trim();
  const t=basketTotals();
  const nakit=t.nakit-getDisc(t.nakit);

  // Ödeme metni
  let od='', odText='', tahsilat=nakit;
  if(abakusSelection) {
    tahsilat = abakusSelection.tahsilat;
    od  = abakusSelection.label+' ('+abakusSelection.zincir+' POS): '+fmt(tahsilat)+'\nAylık taksit: '+fmt(abakusSelection.aylik);
    odText = abakusSelection.label+' / '+abakusSelection.zincir+' POS — '+fmt(tahsilat);
  } else {
    od     = 'Nakit: '+fmt(nakit);
    odText = 'Nakit — '+fmt(nakit);
  }

  // ── WA MODU ──────────────────────────────────────────────────
  if(_aksiyonMode === 'wa') {
    if(!phone || phone.length!==11 || phone[0]!=='0') {
      alert('WhatsApp için 0 ile başlayan 11 haneli telefon giriniz.'); haptic(80); return;
    }
    const exp=new Date(); exp.setDate(exp.getDate()+3);
    const expDate=exp.toISOString().split('T')[0];
    const urunList=basket.map(i=>'  - '+i.urun).join('\n');
    const dn=discountAmount>0?'( '+(discountType==='PERCENT'?'%'+discountAmount:fmt(discountAmount))+' indirim )\n':'';
    const msg='*aygün\u00ae TEKLİF*\n---\nMüşteri: '+custName+'\nTeklif veren: '+(currentUser?.Email||'-')+'\nTelefon: '+phone+'\nGeçerlilik: '+expDate+'\n\n*Ürünler:*\n'+urunList+'\n\n*Ödeme:*\n'+od+'\n'+dn+(extraNote?'\nNot: '+extraNote:'')+'\n> Satış beklenmektedir.';
    window.open('https://wa.me/9'+phone+'?text='+encodeURIComponent(msg),'_blank');
    const sureBitisElWa = document.getElementById('teklif-sure-bitis');
    const sureBitisWa = sureBitisElWa?.value ? new Date(sureBitisElWa.value).toISOString() : null;
    const gizlilikElWa = document.querySelector('input[name="teklif-gizlilik"]:checked');
    _kaydetTeklif(custName, phone, odText, tahsilat, extraNote, sureBitisWa, gizlilikElWa?.value||'acik');
    closeWaModal(); _clearAksiyonForm(); abakusSelection=null;
    return;
  }

  // ── TEKLİF MODU ──────────────────────────────────────────────
  if(_aksiyonMode === 'teklif') {
    if(!custName || custName==='-') { alert('Müşteri adı giriniz.'); haptic(80); return; }
    const sureBitisEl = document.getElementById('teklif-sure-bitis');
    const sureBitis = sureBitisEl?.value ? new Date(sureBitisEl.value).toISOString() : null;
    const gizlilikEl = document.querySelector('input[name="teklif-gizlilik"]:checked');
    const gizlilik = gizlilikEl?.value || 'acik';
    _kaydetTeklif(custName, phone||'—', odText, tahsilat, extraNote, sureBitis, gizlilik);
    closeWaModal(); _clearAksiyonForm(); abakusSelection=null;
    return;
  }

  // ── SATIŞ BELGESİ MODU ──────────────────────────────────────
  if(_aksiyonMode === 'satis') {
    if(!custName || custName==='-') { alert('Müşteri adı zorunludur.'); haptic(80); return; }
    if(!phone || phone.length!==11 || phone[0]!=='0') { alert('Geçerli telefon giriniz.'); haptic(80); return; }
    const tc      = (document.getElementById('cust-tc')?.value||'').trim();
    const email   = (document.getElementById('cust-email')?.value||'').trim();
    const address = (document.getElementById('cust-address')?.value||'').trim();
    const phone2  = (document.getElementById('cust-phone2')?.value||'').trim();
    const method  = odText;

    const today=new Date().toLocaleDateString('tr-TR');
    const saleNo='SAT-'+uid().toUpperCase().slice(0,8);
    const logoEl=document.querySelector('.header-logo img');
    const logoSrc=logoEl?logoEl.src:'';

    const win=window.open('','_blank','width=800,height=1000');
    if(!win) { alert('Popup engellenmiş. Lütfen popup iznini açın.'); return; }
    win.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>Satış Belgesi ${saleNo}</title><style>
    body{font-family:'DM Sans',Arial,sans-serif;color:#1C1C1E;margin:0;padding:32px;font-size:13px;background:#fff;}
    .header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;border-bottom:2px solid #D01F2E;padding-bottom:16px;}
    .header img{height:52px;} .header-right{text-align:right;}
    .title{font-size:1.4rem;font-weight:900;color:#1C1C1E;} .sub{font-size:.78rem;color:#888;margin-top:4px;}
    .section{margin:16px 0;} .section-title{font-size:.70rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#888;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:8px;}
    .row{display:flex;justify-content:space-between;padding:4px 0;font-size:.84rem;} .row span:first-child{color:#666;} .row span:last-child{font-weight:600;}
    .products{border:1px solid #eee;border-radius:8px;overflow:hidden;}
    .prod-row{display:flex;justify-content:space-between;padding:7px 12px;border-bottom:1px solid #eee;font-size:.82rem;} .prod-row:last-child{border-bottom:none;}
    .total{background:#1C1C1E;color:#fff;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;margin-top:12px;}
    .total .amount{font-size:1.1rem;font-weight:900;color:#D01F2E;}
    .footer{margin-top:36px;border-top:1px solid #eee;padding-top:14px;font-size:.72rem;color:#aaa;text-align:center;}
    .sig-area{display:flex;justify-content:space-between;margin-top:32px;}
    .sig-box{text-align:center;width:180px;} .sig-line{border-bottom:1px solid #ccc;height:40px;margin-bottom:6px;} .sig-lbl{font-size:.70rem;color:#888;}
    @media print{body{padding:16px;}@page{margin:12mm;}}
    </style></head><body>
    <div class="header">
      ${logoSrc?`<img src="${logoSrc}" alt="Aygün AVM">`:'<div style="font-size:1.5rem;font-weight:900;color:#D01F2E">aygün® AVM</div>'}
      <div class="header-right"><div class="title">SATIŞ BELGESİ</div><div class="sub">No: ${saleNo}</div><div class="sub">Tarih: ${today}</div><div class="sub">Satıcı: ${currentUser?.Email||'-'}</div></div>
    </div>
    <div class="section"><div class="section-title">Müşteri Bilgileri</div>
      ${[['Ad Soyad',custName],['TC / Pasaport',tc],['Adres',address],['Telefon',phone],['Tel 2',phone2],['E-Mail',email]].filter(r=>r[1]).map(r=>`<div class="row"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}
    </div>
    <div class="section"><div class="section-title">Ürünler</div>
      <div class="products">
        ${basket.map(i=>`<div class="prod-row"><span>${i.urun}</span><span>${fmt(i.nakit)}</span></div>`).join('')}
        ${discountAmount>0?`<div class="prod-row" style="color:green"><span>İndirim</span><span>-${fmt(getDisc(t.nakit))}</span></div>`:''}
      </div>
    </div>
    <div class="total"><span>${method}</span><span class="amount">${fmt(tahsilat)}</span></div>
    ${extraNote?`<div class="section"><div class="section-title">Not</div><div style="font-size:.82rem">${extraNote}</div></div>`:''}
    <div class="sig-area">
      <div class="sig-box"><div class="sig-line"></div><div class="sig-lbl">Satıcı İmzası</div></div>
      <div class="sig-box"><div class="sig-line"></div><div class="sig-lbl">Müşteri İmzası</div></div>
    </div>
    <div class="footer">Aygün AVM · Bu belge satış kaydı olarak düzenlenmiştir. · ${today}</div>
    <script>window.onload=()=>{ setTimeout(()=>window.print(),300); }<\/script>
    </body></html>`);
    win.document.close();

    // Satışı kaydet
    const saleRecord = {
      id:saleNo, ts:new Date().toISOString(),
      custName, custTC:tc, custPhone:phone, custPhone2:phone2, custEmail:email,
      address, method,
      urunler:basket.map(i=>({...i})), nakit:tahsilat, indirim:discountAmount,
      user:currentUser?.Email||'-', tip:'satis'
    };
    sales.unshift(saleRecord);
    localStorage.setItem('aygun_sales', JSON.stringify(sales));
    logAnalytics('sale', custName);

    closeWaModal(); _clearAksiyonForm(); abakusSelection=null;
    return;
  }
}

function _kaydetTeklif(custName, phone, odText, tahsilat, extraNote, sureBitis, gizlilik) {
  const prop = {
    id:uid(), ts:new Date().toISOString(),
    custName, phone, urunler:basket.map(i=>({...i})),
    odeme:odText, nakit:tahsilat, indirim:discountAmount, indirimTip:discountType,
    abakus: abakusSelection ? {...abakusSelection} : null,
    user:currentUser?.Email||'-', durum:'bekliyor', not:extraNote, tip:'teklif',
    sureBitis: sureBitis || null,
    gizlilik: gizlilik || 'acik'
  };
  proposals.unshift(prop);
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  updateProposalBadge();
  logAnalytics('proposal', custName);
  // Firebase'e kaydet (realtime listener array'i güncelleyecek)
  fbSaveProp(prop);
}

// Eski fonksiyon adı — geriye dönük uyumluluk
function finalizeProposal() { finalizeAksiyon(); }

// ─── TEKLİFLER ──────────────────────────────────────────────────
let currentPropFilter = 'all'; // all | bekliyor | satisDondu | iptal | sureDoldu

function openProposals() {
  // Her açılışta Firestore&#39;dan tazele (gizlilik filtresinin güncel çalışması için)
  renderProposals();
  haptic(16);
  const m=document.getElementById('proposals-modal'); if(!m) return;
  m.style.display='flex'; m.classList.add('open');
  currentPropFilter = 'all';
  // Reset filter buttons
  document.querySelectorAll('.pseg-btn').forEach(b=>b.classList.toggle('active', b.dataset.filter==='all'));
  renderProposals();
}
function closeProposals() {
  const m=document.getElementById('proposals-modal');
  m.classList.remove('open'); m.style.display='none';
}
function filterProposals(filter) {
  if(filter !== undefined) {
    currentPropFilter = filter;
    haptic(12);
  }
  document.querySelectorAll('.pseg-btn').forEach(b=>b.classList.toggle('active', b.dataset.filter===currentPropFilter));
  const q = (document.getElementById('prop-search-input')?.value||'').toLowerCase().trim();
  const clearBtn = document.getElementById('prop-search-clear');
  if(clearBtn) clearBtn.style.display = q ? 'flex' : 'none';
  renderProposals(null, false, q);
}

function clearPropSearch() {
  const inp = document.getElementById('prop-search-input');
  if(inp) inp.value = '';
  const clearBtn = document.getElementById('prop-search-clear');
  if(clearBtn) clearBtn.style.display = 'none';
  renderProposals();
}
function renderProposals(container, forceAll, searchQ) {
  const target = container || document.getElementById('proposals-body');
  if(!target) return;

  // Admin tüm teklifleri görür; satis: kendi + herkese açık
  let myProps = isAdmin()
    ? proposals
    : proposals.filter(p =>
        p.user === (currentUser?.Email||'') ||
        p.gizlilik === 'acik' ||
        !p.gizlilik   // eski teklifler gizlilik alanı olmayabilir → açık say
      );

  // Filtre uygula
  if(!forceAll && currentPropFilter !== 'all') {
    myProps = myProps.filter(p => p.durum === currentPropFilter);
  }
  // Arama filtresi
  if(searchQ) {
    const sq = searchQ.toLowerCase();
    myProps = myProps.filter(p => {
      const urunler = (p.urunler||[]).map(u=>u.urun||'').join(' ').toLowerCase();
      return (p.custName||'').toLowerCase().includes(sq) ||
             (p.phone||'').includes(sq) ||
             (p.user||'').toLowerCase().includes(sq) ||
             (p.odeme||'').toLowerCase().includes(sq) ||
             (p.not||'').toLowerCase().includes(sq) ||
             urunler.includes(sq);
    });
  }

  const badge=document.getElementById('prop-modal-count');
  if(badge) {
    const bek = myProps.filter(p=>p.durum==='bekliyor'||p.durum==='sureDoldu').length;
    badge.textContent = myProps.length + ' teklif' + (bek>0 ? ' · ' + bek + ' bekliyor' : '');
  }
  const propBadge=document.getElementById('prop-badge');
  if(propBadge) {
    const allProps = isAdmin() ? proposals : proposals.filter(p=>p.user===(currentUser?.Email||''));
    const waiting = allProps.filter(p=>p.durum==='bekliyor').length;
    propBadge.style.display = waiting>0 ? 'flex' : 'none';
    propBadge.textContent = waiting;
  }

  if(!myProps.length) {
    target.innerHTML = '<div class="empty-cart" style="height:160px;"><span class="empty-cart-icon">📋</span>Teklif yok</div>';
    return;
  }
  const statusMap = {bekliyor:'⏳ Bekliyor', satisDondu:'✅ Satışa Döndü', iptal:'✕ İptal', sureDoldu:'⌛ Süresi Doldu'};
  const statusCls = {bekliyor:'status-bekliyor', satisDondu:'status-satis-dondu', iptal:'status-iptal', sureDoldu:'status-sure-doldu'};

  target.innerHTML = myProps.map(p => {
    const me = currentUser?.Email||'';
    const canAct = isAdmin() || p.user===me;
    const propDate = p.ts ? p.ts.split('T')[0] : '';
    const todayStr = new Date().toISOString().split('T')[0];
    const salesCanEdit = propDate === todayStr;
    const canEdit = isAdmin() || (p.user===me && salesCanEdit);

    // Süre kontrolü
    const now = new Date();
    const expDate = p.sureBitis ? new Date(p.sureBitis) : null;
    if(expDate && now > expDate && p.durum==='bekliyor') p.durum='sureDoldu';

    const isActive = p.durum==='bekliyor'||p.durum==='sureDoldu';

    // Not göstergesi
    const noteCount = (p.adminNot||[]).length;
    const noteDot = noteCount ? `<span class="note-dot">${noteCount}</span>` : '';

    // Buton grubu — ikon tabanlı pill tasarım
    const btns = [];
    if(canAct && isActive) {
      btns.push(`<button class="pact-btn pact-green haptic-btn" onclick="updatePropStatus('${p.id}','satisDondu')" title="Satışa Döndü"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="pact-label"> Satışa Döndü</span></button>`);
      btns.push(`<button class="pact-btn pact-red haptic-btn" onclick="updatePropStatus('${p.id}','iptal')" title="İptal Et"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><span class="pact-label"> İptal</span></button>`);
    }
    if(p.phone && p.phone!=='—') {
      btns.push(`<button class="pact-btn pact-wa haptic-btn" onclick="resendProposalWa('${p.id}')" title="WhatsApp"><svg width="13" height="13" viewBox="0 0 32 32" fill="currentColor"><path d="M16 2C8.27 2 2 8.27 2 16c0 2.44.65 4.72 1.78 6.7L2 30l7.53-1.74A13.94 13.94 0 0016 30c7.73 0 14-6.27 14-14S23.73 2 16 2zm0 25.5a11.44 11.44 0 01-5.86-1.6l-.42-.25-4.47 1.03 1.06-4.34-.27-.44A11.5 11.5 0 1116 27.5zm6.3-8.6c-.34-.17-2.02-.99-2.33-1.1-.31-.12-.54-.17-.76.17-.23.34-.88 1.1-1.08 1.33-.2.23-.4.25-.74.08-.34-.17-1.43-.52-2.73-1.66-1.01-.9-1.69-2-1.89-2.34-.2-.34-.02-.52.15-.69.15-.15.34-.4.51-.6.17-.2.23-.34.34-.57.12-.23.06-.43-.03-.6-.08-.17-.76-1.83-1.04-2.5-.27-.65-.55-.56-.76-.57h-.65c-.22 0-.57.08-.87.4s-1.14 1.11-1.14 2.7 1.17 3.13 1.33 3.35c.17.22 2.3 3.5 5.57 4.77.78.34 1.39.54 1.86.69.78.25 1.49.21 2.05.13.63-.09 1.93-.79 2.2-1.55.28-.76.28-1.41.2-1.55-.09-.13-.32-.2-.65-.36z"/></svg></button>`);
    }
    if(canEdit) {
      // Herkes not ekleyebilir (kendi notu olarak kaydedilir)
      if(true) btns.push(`<button class="pact-btn pact-note haptic-btn" onclick="openPropNote('${p.id}')" title="Not Ekle"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 12V14h2l7.5-7.5-2-2L2 12zm12.7-7.3a1 1 0 000-1.4l-1-1a1 1 0 00-1.4 0L11 3.6l2.4 2.4 1.3-1.3z" fill="currentColor"/></svg>${noteDot}</button>`);
      if(isAdmin()) btns.push(`<button class="pact-btn pact-edit haptic-btn" onclick="openEditProp('${p.id}')" title="Düzenle"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1" y="11" width="14" height="1.5" rx=".75" fill="currentColor"/><path d="M10.5 2.5l2 2-7 7-2.5.5.5-2.5 7-7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></button>`);
      if(isAdmin()) btns.push(`<button class="pact-btn pact-del haptic-btn" onclick="deleteProp('${p.id}')" title="Sil"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l.5 9h5L11 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`);
    }

    const userTag = `<span class="proposal-tag prop-user-tag" style="${p.user===me?'background:#dcfce7;color:#15803d':''}">👤 ${p.user.split('@')[0]}</span>`;
    const gizliTag = p.gizlilik==='kapali' ? `<span class="proposal-tag" style="background:#f3e8ff;color:#7c3aed">🔒</span>` : '';
    const sureTag = p.sureBitis ? `<span class="proposal-tag" style="background:#fff7ed;color:#c2410c">⏰ ${new Date(p.sureBitis).toLocaleDateString('tr-TR')}</span>` : '';
    const adminNotes = (p.adminNot||[]).length
      ? `<div class="prop-admin-notes">${(p.adminNot||[]).map(n=>`<div class="prop-admin-note"><span class="prop-note-who">${n.who.split('@')[0]}</span><span class="prop-note-text">${n.text}</span><span class="prop-note-time">${fmtDate(n.ts)}</span></div>`).join('')}</div>`
      : '';

    return `<div class="proposal-card status-card-${p.durum||'bekliyor'}" id="pcard-${p.id}">
      <div class="proposal-card-header">
        <span class="proposal-status ${statusCls[p.durum]||'status-bekliyor'}">${statusMap[p.durum]||p.durum}</span>
        <span class="proposal-name">${p.custName}</span>
        <span class="proposal-meta">${fmtDate(p.ts)}</span>
      </div>
      <div class="proposal-body">
        <div class="proposal-row">
          <span class="proposal-tag">📞 ${p.phone}</span>
          <span class="proposal-tag">💳 ${p.odeme||'—'}</span>
          ${userTag}${gizliTag}${sureTag}
          ${p.not?`<span class="proposal-tag prop-note-inline">💬 ${p.not}</span>`:''}
        </div>
        <div class="proposal-products">${(p.urunler||[]).map(u=>`• ${u.urun}`).join('<br>')}</div>
        ${adminNotes}
      </div>
      ${btns.length ? `<div class="proposal-action-bar">${btns.join('')}</div>` : ''}
    </div>`;
  }).join('');
}

function updatePropStatus(id, durum) {
  const idx=proposals.findIndex(p=>p.id===id);
  if(idx===-1) return;
  proposals[idx].durum=durum;
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  renderProposals();
  const adminList=document.getElementById('admin-proposals-list');
  if(adminList) renderProposals(adminList, true);
  fbUpdateProp(proposals[idx].id, { durum });
}

async function deleteProp(id) {
  if(!isAdmin()) return;
  if(!confirm('Bu teklif kalıcı olarak silinsin mi?')) return;
  haptic(30);
  const idx = proposals.findIndex(p=>p.id===id);
  if(idx===-1) return;
  proposals.splice(idx, 1);
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  renderProposals();
  const adminList=document.getElementById('admin-proposals-list');
  if(adminList) renderProposals(adminList, true);
  // Firestore&#39;dan kalıcı sil
  try {
    await deleteDoc(doc(_db, 'proposals', id));
  } catch(e) { console.warn('FB delete:', e); }
  updateProposalBadge();
}

// ─── TEKLİFE NOT EKLE (sadece admin) ────────────────────────────
function openPropNote(id) {
  haptic(14);
  const p = proposals.find(pr=>pr.id===id); if(!p) return;
  const existingNotes = (p.adminNot||[]).map(n=>
    `• ${fmtDate(n.ts)} [${n.who}]: ${n.text}`
  ).join('\n');
  const hint = existingNotes ? 'Mevcut notlar:\n'+existingNotes+'\n\nYeni not:' : 'Not girin:';
  const text = prompt(hint, '');
  if(text === null || text.trim() === '') return;
  const idx = proposals.findIndex(pr=>pr.id===id);
  if(idx===-1) return;
  if(!proposals[idx].adminNot) proposals[idx].adminNot = [];
  proposals[idx].adminNot.unshift({
    ts: new Date().toISOString(),
    who: currentUser?.Email||'admin',
    text: text.trim()
  });
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  renderProposals();
  const adminList=document.getElementById('admin-proposals-list');
  if(adminList) renderProposals(adminList, true);
  // Firebase güncelle
  fbUpdateProp(proposals[idx].id, { adminNot: proposals[idx].adminNot });
}

function resendProposalWa(id) {
  haptic(18);
  const p=proposals.find(pr=>pr.id===id); if(!p) return;
  const exp=new Date(); exp.setDate(exp.getDate()+3);
  const expDate=exp.toISOString().split('T')[0];
  const urunList=(p.urunler||[]).map(i=>`  - ${i.urun}`).join('\n');
  const dn=p.indirim>0?`( ${p.indirimTip==='PERCENT'?'%'+p.indirim:fmt(p.indirim)} indirim )\n`:'';
  const msg=`*aygün® TEKLİF (Yeniden)*\n---\nMüşteri: ${p.custName}\nTeklif veren: ${p.user||currentUser?.Email||'-'}\nTelefon: ${p.phone}\nGeçerlilik: ${expDate}\n\n*Ürünler:*\n${urunList}\n\n*Ödeme:*\n${p.odeme}\n${dn}${p.not?'\nNot: '+p.not:''}\n> Satış beklenmektedir.`;
  window.open('https://wa.me/9'+p.phone+'?text='+encodeURIComponent(msg),'_blank');
}

function updateProposalBadge() {
  const myProps=isAdmin()?proposals:proposals.filter(p=>p.user===(currentUser?.Email||''));
  const waiting=myProps.filter(p=>p.durum==='bekliyor').length;
  const badge=document.getElementById('prop-badge');
  if(badge) { badge.style.display=waiting>0?'flex':'none'; badge.textContent=waiting; }
}

// ─── SATIŞ BELGESİ ──────────────────────────────────────────────
function openSaleDoc() {
  if(!basket.length) { alert('Sepet boş!'); return; }
  haptic(16);
  const m=document.getElementById('sale-modal'); if(!m) return;
  m.style.display='flex'; m.classList.add('open');
  updateSalePreview();
}
function closeSaleDoc() {
  const m=document.getElementById('sale-modal');
  m.classList.remove('open'); m.style.display='none';
}

document.addEventListener('DOMContentLoaded', () => {
  ['sale-name','sale-tc','sale-address','sale-phone','sale-phone2','sale-email','sale-method'].forEach(id => {
    const el=document.getElementById(id);
    if(el) el.addEventListener('input', updateSalePreview);
  });
});

function updateSalePreview() {
  const get=id=>(document.getElementById(id)||{}).value||'';
  const t=basketTotals();
  const nakit=t.nakit-getDisc(t.nakit);
  const today=new Date().toLocaleDateString('tr-TR');
  const saleNo='SAT-'+Date.now().toString(36).toUpperCase();
  const logoEl = document.querySelector('.header-logo img');
  const logoSrc = logoEl ? logoEl.src : '';
  const preview=document.getElementById('sale-preview'); if(!preview) return;
  preview.innerHTML=`
    <div class="sale-preview-logo">${logoSrc?`<img src="${logoSrc}" alt="Aygün AVM" style="height:40px">`:'<div style="font-weight:900;font-size:1.2rem;color:var(--red)">aygün® AVM</div>'}</div>
    <div class="sale-preview-title">SATIŞ BELGESİ</div>
    <div class="sale-preview-sub">No: ${saleNo} · Tarih: ${today}</div>
    <div class="sale-preview-section">
      <div class="sale-preview-section-title">Müşteri Bilgileri</div>
      ${[['Ad Soyad',get('sale-name')],['TC / Pasaport',get('sale-tc')],['Adres',get('sale-address')],['Telefon',get('sale-phone')],['Tel 2',get('sale-phone2')],['E-Mail',get('sale-email')]].filter(r=>r[1]).map(r=>`<div class="sale-preview-row"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}
    </div>
    <div class="sale-preview-section">
      <div class="sale-preview-section-title">Ürünler</div>
      ${basket.map(i=>`<div class="sale-preview-row"><span>${i.urun}</span><span>${fmt(i.nakit)}</span></div>`).join('')}
      ${discountAmount>0?`<div class="sale-preview-row"><span>İndirim</span><span style="color:var(--green)">-${fmt(getDisc(nakit))}</span></div>`:''}
    </div>
    <div class="sale-total-row"><span>${get('sale-method')||'Ödeme Yöntemi'}</span><span>${fmt(nakit)}</span></div>
  `;
  preview.dataset.saleNo=saleNo;
}

function generateSalePDF() {
  haptic(22);
  const get=id=>(document.getElementById(id)||{}).value||'';
  if(!get('sale-name')) { alert('Müşteri adı zorunludur.'); return; }
  const t=basketTotals();
  const nakit=t.nakit-getDisc(t.nakit);
  const today=new Date().toLocaleDateString('tr-TR');
  const saleNo=document.getElementById('sale-preview')?.dataset.saleNo||'SAT-'+uid().toUpperCase();
  const logoEl=document.querySelector('.header-logo img');
  const logoSrc=logoEl?logoEl.src:'';

  const win=window.open('','_blank','width=800,height=1000');
  if(!win) { alert('Popup engellenmiş. Lütfen popup iznini açın.'); return; }
  win.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>Satış Belgesi ${saleNo}</title><style>
    body{font-family:'DM Sans',Arial,sans-serif;color:#1C1C1E;margin:0;padding:32px;font-size:13px;background:#fff;}
    .header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;border-bottom:2px solid #D01F2E;padding-bottom:16px;}
    .header img{height:52px;}
    .header-right{text-align:right;}
    .title{font-size:1.4rem;font-weight:900;color:#1C1C1E;}
    .sub{font-size:.78rem;color:#888;margin-top:4px;}
    .section{margin:16px 0;}
    .section-title{font-size:.70rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#888;border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:8px;}
    .row{display:flex;justify-content:space-between;padding:4px 0;font-size:.84rem;}
    .row span:first-child{color:#666;}
    .row span:last-child{font-weight:600;}
    .products{border:1px solid #eee;border-radius:8px;overflow:hidden;}
    .prod-row{display:flex;justify-content:space-between;padding:7px 12px;border-bottom:1px solid #eee;font-size:.82rem;}
    .prod-row:last-child{border-bottom:none;}
    .total{background:#1C1C1E;color:#fff;border-radius:8px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;margin-top:12px;}
    .total .amount{font-size:1.1rem;font-weight:900;color:#D01F2E;}
    .footer{margin-top:36px;border-top:1px solid #eee;padding-top:14px;font-size:.72rem;color:#aaa;text-align:center;}
    .sig-area{display:flex;justify-content:space-between;margin-top:32px;}
    .sig-box{text-align:center;width:180px;}
    .sig-line{border-bottom:1px solid #ccc;height:40px;margin-bottom:6px;}
    .sig-lbl{font-size:.70rem;color:#888;}
    @media print{body{padding:16px;}@page{margin:12mm;}}
  </style></head><body>
  <div class="header">
    ${logoSrc?`<img src="${logoSrc}" alt="Aygün AVM">`:'<div style="font-size:1.5rem;font-weight:900;color:#D01F2E">aygün® AVM</div>'}
    <div class="header-right"><div class="title">SATIŞ BELGESİ</div><div class="sub">No: ${saleNo}</div><div class="sub">Tarih: ${today}</div><div class="sub">Satıcı: ${currentUser?.Email||'-'}</div></div>
  </div>
  <div class="section"><div class="section-title">Müşteri Bilgileri</div>
    ${[['Ad Soyad',get('sale-name')],['TC / Pasaport',get('sale-tc')],['Adres',get('sale-address')],['Telefon',get('sale-phone')],['Tel 2',get('sale-phone2')],['E-Mail',get('sale-email')]].filter(r=>r[1]).map(r=>`<div class="row"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}
  </div>
  <div class="section"><div class="section-title">Ürünler</div>
    <div class="products">
      ${basket.map(i=>`<div class="prod-row"><span>${i.urun}</span><span>${fmt(i.nakit)}</span></div>`).join('')}
      ${discountAmount>0?`<div class="prod-row" style="color:green"><span>İndirim</span><span>-${fmt(getDisc(t.nakit))}</span></div>`:''}
    </div>
  </div>
  <div class="total"><span>${get('sale-method')||'Toplam Tutar'}</span><span class="amount">${fmt(nakit)}</span></div>
  <div class="sig-area">
    <div class="sig-box"><div class="sig-line"></div><div class="sig-lbl">Satıcı İmzası</div></div>
    <div class="sig-box"><div class="sig-line"></div><div class="sig-lbl">Müşteri İmzası</div></div>
  </div>
  <div class="footer">Aygün AVM · Bu belge satış kaydı olarak düzenlenmiştir. · ${today}</div>
  <script>window.onload=()=>{ setTimeout(()=>window.print(),300); }<\/script>
  </body></html>`);
  win.document.close();

  // Satışı kaydet
  const saleRecord = {
    id: saleNo, ts: new Date().toISOString(),
    custName: get('sale-name'), custTC: get('sale-tc'),
    custPhone: get('sale-phone'), custEmail: get('sale-email'),
    address: get('sale-address'), method: get('sale-method'),
    urunler: basket.map(i=>({...i})), nakit, indirim: discountAmount,
    user: currentUser?.Email||'-', tip: 'satis'
  };
  sales.unshift(saleRecord);
  localStorage.setItem('aygun_sales', JSON.stringify(sales));
  logAnalytics('sale', get('sale-name'));
  closeSaleDoc();
}

// ─── DEĞİŞİKLİK KONTROLÜ ────────────────────────────────────────
function checkChanges(json) {
  const sk='last_json_'+(currentUser?.Email||'guest');
  const vk='seen_ver_' +(currentUser?.Email||'guest');
  const last=JSON.parse(localStorage.getItem(sk)||'{}');
  const changes=[];
  if(last.data && Array.isArray(json.data)) {
    json.data.forEach(p => {
      let old=null;
      for(const ld of (last.data||[])) { if(ld.Kod===p.Kod){ old=ld; break; } }
      if(!old) return;
      const keys=Object.keys(p);
      const urunKey=keys.find(k=>norm(k)==='urun')||'Kod';
      const urunAdi=p[urunKey]||p.Kod||'?';
      const kartKey=keys.find(k=>k.includes('Kart'))||'';
      const cekKey =keys.find(k=>k.includes('ekim'))||'';
      const descKey=keys.find(k=>norm(k)==='aciklama')||'';
      // Sadece Nakit fiyatı takip et (D.Kart, 4T AWM, Tek Çekim gösterme)
      const nakitNv=parseFloat(p['Nakit']), nakitOv=parseFloat(old['Nakit']);
      if(!isNaN(nakitNv)&&!isNaN(nakitOv)&&nakitNv!==nakitOv) {
        const diff=nakitNv-nakitOv; const pct=((diff/nakitOv)*100).toFixed(1);
        changes.push({ type:'price', urun:urunAdi, field:'Nakit', old:nakitOv, new:nakitNv, diff, pct });
      }
      // Ürün adı değişimi
      if(old[urunKey] && p[urunKey] && old[urunKey]!==p[urunKey]) {
        changes.push({ type:'urunadi', urun:p[urunKey], old:old[urunKey], new:p[urunKey] });
      }
      const ns=Number(p.Stok), os=Number(old.Stok);
      if(!isNaN(ns)&&!isNaN(os)&&ns!==os) {
        changes.push({ type:'stok', urun:urunAdi, old:os, new:ns, diff:ns-os });
      }
      if(descKey && p[descKey]!==old[descKey]) {
        changes.push({ type:'aciklama', urun:urunAdi, old:old[descKey]||'', new:p[descKey]||'' });
      }
    });
  }
  localStorage.setItem(sk, JSON.stringify(json));
  if(!changes.length) return;
  const vKey=(json.metadata?.v)||'v?';
  const seen=JSON.parse(localStorage.getItem(vk)||'[]');
  if(seen.includes(vKey)) return;
  seen.push(vKey); if(seen.length>3) seen.splice(0,seen.length-3);
  localStorage.setItem(vk, JSON.stringify(seen));
  showChangePopup(changes);
}

function showChangePopup(changes) {
  const list=document.getElementById('change-list'); if(!list) return;
  list.innerHTML=changes.map(c => {
    if(c.type==='price') {
      const up=c.diff>0;
      const icon=up?'📈':'📉';
      const badgeCls=up?'badge-price-up':'badge-price-down';
      const sign=up?'+':'';
      return `<div class="change-item"><span class="change-icon">${icon}</span><div style="flex:1"><span class="change-product">${c.urun}</span><span class="change-detail">${c.field}: ${fmt(c.old)} → <strong>${fmt(c.new)}</strong></span></div><span class="change-badge ${badgeCls}">${sign}${c.pct}% (${sign}${fmt(Math.abs(c.diff))})</span></div>`;
    }
    if(c.type==='stok') {
      const up=c.diff>0;
      const icon=up?'📦':'⚠️';
      const badgeCls=up?'badge-stok-up':'badge-stok-down';
      const sign=up?'+':'';
      return `<div class="change-item"><span class="change-icon">${icon}</span><div style="flex:1"><span class="change-product">${c.urun}</span><span class="change-detail">Stok: ${c.old} → <strong>${c.new}</strong></span></div><span class="change-badge ${badgeCls}">Stok ${sign}${c.diff}</span></div>`;
    }
    if(c.type==='aciklama') {
      return `<div class="change-item"><span class="change-icon">📝</span><div style="flex:1"><span class="change-product">${c.urun}</span><span class="change-detail">Açıklama → <em>${c.new||'(boş)'}</em></span></div><span class="change-badge badge-desc">Açıklama</span></div>`;
    }
    if(c.type==='urunadi') {
      return `<div class="change-item"><span class="change-icon">🏷️</span><div style="flex:1"><span class="change-product">${c.new}</span><span class="change-detail">Ürün adı güncellendi</span></div><span class="change-badge badge-desc">Ad</span></div>`;
    }
    return '';
  }).join('');
  const p=document.getElementById('change-popup');
  p.style.display='flex'; p.classList.add('open');
}
function closeChangePopup() {
  const p=document.getElementById('change-popup'); p.style.display='none'; p.classList.remove('open');
}
function showChangeToasts(changes) {
  const ct=document.getElementById('change-toast'); if(!ct) return;
  changes.forEach((c,i) => {
    setTimeout(()=>{
      let txt='';
      if(c.type==='price') txt=`${c.urun}: ${c.field} ${c.diff>0?'+':''}${c.pct}%`;
      else if(c.type==='stok') txt=`${c.urun}: Stok ${c.diff>0?'+':''}${c.diff}`;
      else if(c.type==='aciklama') txt=`${c.urun}: Açıklama değişti`;
      const el=document.createElement('div'); el.className='toast-item';
      el.innerHTML=`<span>🔔</span><span style="flex:1">${txt}</span><button class="toast-close" onclick="this.parentElement.remove()">×</button>`;
      ct.appendChild(el); setTimeout(()=>el.remove(), 6000);
    }, i*700);
  });
}

// ─── ANALİTİK ───────────────────────────────────────────────────
function logAnalytics(action, detail) {
  if(!currentUser) return;
  const today=new Date().toISOString().split('T')[0];
  const email=currentUser.Email;
  const local=JSON.parse(localStorage.getItem('analytics_local')||'{}');
  if(!local[today]) local[today]={};
  if(!local[today][email]) local[today][email]={logins:0,proposals:0,basketAdds:0,sales:0,products:{}};
  const rec=local[today][email];
  if(action==='login') {
    rec.logins++;
    // Giriş saatini kaydet
    if(!rec.loginTimes) rec.loginTimes = [];
    rec.loginTimes.push(new Date().getHours());
    if(rec.loginTimes.length > 20) rec.loginTimes = rec.loginTimes.slice(-20);
  }
  if(action==='proposal') rec.proposals++;
  if(action==='sale')     rec.sales++;
  if(action==='addToBasket') { rec.basketAdds++; if(detail) rec.products[detail]=(rec.products[detail]||0)+1; }
  localStorage.setItem('analytics_local', JSON.stringify(local));
}
async function loadAnalyticsData() { return JSON.parse(localStorage.getItem('analytics_local')||'{}'); }

// ─── ADMİN ──────────────────────────────────────────────────────
async function openAdmin() {
  // Header'a kullanıcı adını yaz
  const hdrUser = document.getElementById('admin-header-user');
  if(hdrUser) hdrUser.textContent = currentUser?.Email?.split('@')[0] || '—';
  if(!isAdmin()) { alert('Yetkisiz erişim.'); return; }
  haptic(18);
  const m=document.getElementById('admin-modal');
  m.style.display='flex'; m.classList.add('open');
  renderAdminPanel();
}
function closeAdmin() {
  const m=document.getElementById('admin-modal');
  m.classList.remove('open'); m.style.display='none';
}
function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  document.querySelectorAll('.admin-tab-content').forEach(c=>c.classList.toggle('active',c.id==='tab-'+tab));
  if(tab==='proposals') renderProposals(document.getElementById('admin-proposals-list'), true);
  if(tab==='siparis')   { renderSiparisPanel(); updateSiparisBadge(); }
  if(tab==='sepetler')  { renderSepetDetay(); }
  if(tab==='personel')  { renderAdminUsers(); }
  if(tab==='products')  {
    renderAdminProducts();
    // Uyuyan stok — allProducts her zaman hazır olmalı (loadData çalışmış)
    const urunList = (allProducts&&allProducts.length) ? allProducts
                   : (window._cachedUrunler&&window._cachedUrunler.length) ? window._cachedUrunler
                   : [];
    if(urunList.length) {
      renderUyuyanStok(urunList);
    } else {
      // Yüklenmemişse fetch et
      const uyuEl = document.getElementById('admin-uyuyan-stok');
      if(uyuEl) uyuEl.innerHTML='<div class="admin-empty">Yükleniyor...</div>';
      fetch(dataUrl('urunler.json')+'?t='+Date.now())
        .then(r=>r.json())
        .then(j=>{
          const rows=Array.isArray(j.data)?j.data:(Array.isArray(j)?j:[]);
          window._cachedUrunler=rows;
          if(!allProducts.length) allProducts=rows;
          renderUyuyanStok(rows);
        }).catch(e=>{
          const uyuEl2=document.getElementById('admin-uyuyan-stok');
          if(uyuEl2) uyuEl2.innerHTML='<div class="admin-empty" style="color:#dc2626">⚠️ Yüklenemedi</div>';
        });
    }
  }
}

async function renderAdminPanel() {
  const data=await loadAnalyticsData();
  const dates=Object.keys(data).sort().slice(-7);
  const today=new Date().toISOString().split('T')[0];

  // Tüm kullanıcı verilerini proposals + sales + analytics'ten topla
  const allUsers = new Set();

  // proposals ve sales'dan kullanıcıları çıkar
  proposals.forEach(p=>{ if(p.user && p.user!=='-') allUsers.add(p.user); });
  sales.forEach(s=>{ if(s.user && s.user!=='-') allUsers.add(s.user); });

  // analytics'ten de ekle
  Object.values(data).forEach(byUser => {
    Object.keys(byUser).forEach(email => allUsers.add(email));
  });

  // Toplam logins analytics'ten
  let tL=0;
  Object.values(data).forEach(byUser => {
    Object.values(byUser).forEach(rec => { tL+=rec.logins||0; });
  });

  const pendingProps = proposals.filter(p=>p.durum==='bekliyor'||p.durum==='sureDoldu').length;

  // Bugünkü login sayısı
  const todayData=data[today]||{};
  let todayLogins=0; Object.values(todayData).forEach(r=>todayLogins+=r.logins||0);

  // Bugün aktif kullanıcı (login yapan)
  const todayActive=Object.keys(todayData).filter(u=>(todayData[u].logins||0)>0).length;

  document.getElementById('stat-logins').innerHTML    = `${tL}<span class="stat-today">+${todayLogins} bugün</span>`;
  document.getElementById('stat-proposals').innerHTML = `${proposals.length}<span class="stat-today">${pendingProps} bekliyor</span>`;
  const siparisCount = getSiparisNotlari().filter(s=>s.durum==='bekliyor').length;
  const siparisEl = document.getElementById('stat-siparis');
  if(siparisEl) siparisEl.innerHTML = `${siparisCount}<span class="stat-today">${siparisCount>0?siparisCount+' bekliyor':'Temiz'}</span>`;
  // Kart tıklama navigasyonu
  const scProp = document.getElementById('stat-card-proposals');
  if(scProp) scProp.onclick = () => { closeAdmin(); openProposals(); };
  const scSiparis = document.getElementById('stat-card-siparis');
  if(scSiparis) scSiparis.onclick = () => switchAdminTab('siparis');
  const scUsers = document.getElementById('stat-card-users');
  if(scUsers) scUsers.onclick = () => switchAdminTab('personel');
  document.getElementById('stat-users').innerHTML     = `${allUsers.size}<span class="stat-today">${todayActive} aktif</span>`;

  // Kullanıcı başına teklif/satış sayısı özeti (proposals/sales'dan)
  const perUser={};
  allUsers.forEach(u=>{ perUser[u]={proposals:0,sales:0}; });
  proposals.forEach(p=>{ if(p.user && perUser[p.user]) perUser[p.user].proposals++; });
  sales.forEach(s=>{ if(s.user && perUser[s.user]) perUser[s.user].sales++; });

  const dc=dates.map(date=>{ let c=0; Object.values(data[date]||{}).forEach(r=>c+=r.logins||0); return{date,c}; });
  const md=Math.max(1,...dc.map(d=>d.c));
  const dcEl=document.getElementById('admin-daily-chart');
  if(dcEl) dcEl.innerHTML=dc.map(d=>
    `<div class="chart-bar-wrap"><div class="chart-bar ${d.date===today?'today':''}" style="height:${Math.max(4,Math.round(d.c/md*100))}%"><span class="chart-bar-val">${d.c||''}</span></div><span class="chart-label">${d.date.slice(5)}</span></div>`
  ).join('');

  // Kritik Stok — sadece bir kez buton göster (flag ile)
  const _stokEl = document.getElementById('admin-stok-uyari');
  if(_stokEl && !_stokEl.dataset.initialized) {
    _stokEl.dataset.initialized = '1';
    _stokEl.innerHTML='<button class="btn-stok-load haptic-btn" onclick="renderStokUyari()">🔍 Stok Durumunu Kontrol Et</button>';
  }
  // Kullanıcı sepet durumu
  renderSepetDurum();
  // Personel bugün
  renderPersonelBugun(data, today);
}

function renderStokUyari() {
  const el = document.getElementById('admin-stok-uyari');
  if(!el) return;
  // allProducts zaten loadData() ile yüklü olmalı
  const rows = (allProducts && allProducts.length) ? allProducts
             : (window._cachedUrunler && window._cachedUrunler.length) ? window._cachedUrunler
             : null;
  if(rows) { window._cachedUrunler = rows; _doStokUyari(el, rows); return; }
  // Yoksa fetch et
  el.innerHTML = '<div class="admin-empty">Yükleniyor...</div>';
  fetch(dataUrl('urunler.json') + '?t=' + Date.now())
    .then(r => { if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(json => {
      const fetched = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
      if(!fetched.length) throw new Error('Veri boş');
      window._cachedUrunler = fetched;
      allProducts = fetched;
      _doStokUyari(el, fetched);
    })
    .catch(err => {
      el.innerHTML = '<div class="admin-empty" style="color:#dc2626">⚠️ ' + err.message + ' — <button class="btn-stok-load" onclick="renderStokUyari()">Tekrar Dene</button></div>';
    });
}

function _getUrunAdi(r) {
  const k = Object.keys(r).find(k=>{
    const n=k.toLowerCase().replace(/\s/g,'');
    return n==='ürün'||n==='urun'||n==='urunadi'||n==='ürünadi'||n==='product'||n==='name';
  });
  return k ? r[k] : (r.urun||r['Ürün']||r.Urun||Object.values(r)[0]||'?');
}
function _getStok(r) {
  const k = Object.keys(r).find(k=>k.toLowerCase().replace(/\s/g,'').includes('stok')||k.toLowerCase()==='stock');
  return k ? Number(r[k])||0 : Number(r.Stok||r.stok||0);
}
function _doStokUyari(el, rows) {
  const stokSifir  = rows.filter(r => _getStok(r)===0);
  const stokKritik = rows.filter(r => { const s=_getStok(r); return s>=1&&s<=3; });
  if(!stokSifir.length && !stokKritik.length) {
    el.innerHTML='<div class="stok-ok">✅ Tüm ürünlerde stok normal</div>'; return;
  }
  const html = [
    ...stokSifir.map(r=>`<div class="stok-alert stok-0"><span class="stok-dot red"></span><span class="stok-urun">${_getUrunAdi(r)}</span><span class="stok-badge s0">Stok Yok</span></div>`),
    ...stokKritik.map(r=>`<div class="stok-alert stok-kritik"><span class="stok-dot orange"></span><span class="stok-urun">${_getUrunAdi(r)}</span><span class="stok-badge sk">${_getStok(r)} adet</span></div>`)
  ].join('');
  el.innerHTML = html;
}

function renderSepetDurum() {
  const el = document.getElementById('admin-sepet-durum');
  if(!el) return;
  // Firestore&#39;dan tüm aktif sepetleri oku (baskets koleksiyonu yoksa proposals'dan bekliyor olanları göster)
  const bekleyenProps = proposals.filter(p=>p.durum==='bekliyor'||p.durum==='sureDoldu');
  const byUser = {};
  bekleyenProps.forEach(p=>{
    if(!byUser[p.user]) byUser[p.user]={count:0,urunler:[]};
    byUser[p.user].count++;
    (p.urunler||[]).forEach(u=>byUser[p.user].urunler.push(u.urun||'?'));
  });
  const entries = Object.entries(byUser);
  if(!entries.length){ el.innerHTML='<div class="admin-empty">Bekleyen teklif yok — veriler Firestore&#39;dan geliyor</div>'; return; }
  el.innerHTML = entries.map(([user,d])=>`
    <div class="sepet-row">
      <div class="user-avatar" style="width:30px;height:30px;font-size:.7rem">${user.split('@')[0].slice(0,2).toUpperCase()}</div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:.8rem">${user.split('@')[0]}</div>
        <div style="font-size:.72rem;color:var(--text-2)">${d.urunler.slice(0,3).join(', ')}${d.urunler.length>3?' +'+( d.urunler.length-3)+' daha':''}</div>
      </div>
      <span class="stok-badge sk" style="background:#dbeafe;color:#1e40af">${d.count} teklif</span>
    </div>`).join('');
}

function renderPersonelBugun(data, today) {
  const el = document.getElementById('admin-personel-bugun');
  if(!el) return;
  const todayData = data[today]||{};
  if(!Object.keys(todayData).length){ el.innerHTML='<div class="admin-empty">Bugün giriş yok</div>'; return; }
  el.innerHTML = `<div class="admin-section-header" style="margin-bottom:8px">🌅 Bugünkü Girişler</div>` +
    Object.entries(todayData).map(([email,rec])=>`
      <div class="sepet-row">
        <div class="user-avatar" style="width:30px;height:30px;font-size:.7rem">${email.split('@')[0].slice(0,2).toUpperCase()}</div>
        <div style="flex:1"><div style="font-weight:600;font-size:.8rem">${email.split('@')[0]}</div></div>
        <span class="stok-badge sk" style="background:#f0fdf4;color:#15803d">${rec.logins||0} giriş</span>
        <span class="stok-badge sk" style="background:#eff6ff;color:#1d4ed8">${rec.proposals||0} teklif</span>
      </div>`).join('');
}

function renderAdminUsers() {
  // Firestore verilerinden (proposals + sales) personel istatistiği oluştur
  const us = {};
  proposals.forEach(p => {
    const u = p.user||'-'; if(!u||u==='-') return;
    if(!us[u]) us[u]={proposals:0, sales:0, lastSeen:''};
    us[u].proposals++;
    const d = p.ts?p.ts.split('T')[0]:'';
    if(d > us[u].lastSeen) us[u].lastSeen = d;
  });
  sales.forEach(s => {
    const u = s.user||'-'; if(!u||u==='-') return;
    if(!us[u]) us[u]={proposals:0, sales:0, lastSeen:''};
    us[u].sales++;
    const d = s.ts?s.ts.split('T')[0]:'';
    if(d > us[u].lastSeen) us[u].lastSeen = d;
  });
  // Analytics'ten login bilgisi de ekle (varsa)
  const analData = JSON.parse(localStorage.getItem('analytics_local')||'{}');
  Object.entries(analData).forEach(([date,byUser])=>{
    Object.entries(byUser).forEach(([email,rec])=>{
      if(!us[email]) us[email]={proposals:0,sales:0,lastSeen:''};
      if(!us[email].logins) us[email].logins=0;
      us[email].logins+=rec.logins||0;
      if(date>us[email].lastSeen) us[email].lastSeen=date;
    });
  });
  const su = Object.entries(us).sort((a,b)=>(b[1].proposals+b[1].sales)-(a[1].proposals+a[1].sales));
  const el = document.getElementById('admin-user-list');
  if(!el) return;
  if(!su.length) { el.innerHTML='<div class="admin-empty">Firestore&#39;dan veri bekleniyor</div>'; return; }
  el.innerHTML = su.map(([email,s])=>{
    const ini = email.split('@')[0].slice(0,2).toUpperCase();
    const pending = proposals.filter(p=>p.user===email&&p.durum==='bekliyor').length;
    return `<div class="user-row">
      <div class="user-avatar">${ini}</div>
      <div class="user-info">
        <div class="user-email">${email.split('@')[0]}</div>
        <div class="user-meta">Son: ${s.lastSeen||'-'}</div>
      </div>
      <div class="user-badges">
        ${s.logins?`<span class="badge badge-green" title="Giriş">${s.logins}G</span>`:''}
        <span class="badge badge-blue" title="Teklif">${s.proposals}T</span>
        <span class="badge badge-orange" title="Satış">${s.sales}S</span>
        ${pending?`<span class="badge" style="background:#fef3c7;color:#92400e" title="Bekleyen">${pending}⏳</span>`:''}
      </div>
    </div>`;
  }).join('');
}

function renderAdminProducts() {
  const pm={};
  // 1. Firebase analytics — tüm kullanıcılar (en güvenilir)
  if(window._fbAnalytics) {
    Object.values(window._fbAnalytics).forEach(rec => {
      Object.entries(rec.products||{}).forEach(([p,c]) => pm[p]=(pm[p]||0)+Number(c));
    });
  }
  // 2. localStorage analytics (bu cihaz — Firebase yoksa fallback)
  const localData=JSON.parse(localStorage.getItem('analytics_local')||'{}');
  Object.values(localData).forEach(byUser=>Object.values(byUser).forEach(rec=>
    Object.entries(rec.products||{}).forEach(([p,c])=>{ if(!pm[p]) pm[p]=(pm[p]||0)+c; })
  ));
  // 3. Firestore proposals — gerçek kullanım verisi
  proposals.forEach(prop=>(prop.urunler||[]).forEach(u=>{ if(u.urun) pm[u.urun]=(pm[u.urun]||0)+1; }));
  // 4. Firestore sales
  sales.forEach(s=>(s.urunler||[]).forEach(u=>{ if(u.urun) pm[u.urun]=(pm[u.urun]||0)+2; })); // satış daha değerli
  const tp=Object.entries(pm).sort((a,b)=>b[1]-a[1]).slice(0,15);
  const mx=tp.length?tp[0][1]:1;
  const el=document.getElementById('admin-product-list');
  if(!el) return;
  el.innerHTML=tp.map(([p,c],i)=>
    `<div class="product-row"><span class="product-rank">${i+1}</span><div class="product-bar-wrap"><div class="product-bar-name">${p}</div><div class="product-bar-track"><div class="product-bar-fill" style="width:${Math.round(c/mx*100)}%"></div></div></div><span class="product-bar-count">${c}x</span></div>`
  ).join('')||'<div class="admin-empty">Veri yok</div>';
}

function clearAllPendingProps() {
  if(!isAdmin()) return;
  const pending = proposals.filter(p=>p.durum==='bekliyor'||p.durum==='sureDoldu');
  if(!pending.length) { alert('Bekleyen teklif yok'); return; }
  if(!confirm(pending.length+' bekleyen teklif silinsin mi?')) return;
  haptic(30);
  pending.forEach(async p=>{
    const idx=proposals.findIndex(pr=>pr.id===p.id);
    if(idx>-1) proposals.splice(idx,1);
    try { await deleteDoc(doc(_db,'proposals',p.id)); } catch(e){}
  });
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  renderSepetDetay();
  renderSepetDurum();
  updateProposalBadge();
}

function renderSepetDetay() {
  const el = document.getElementById('admin-sepet-detay');
  if(!el) return;

  // Tüm kullanıcıların sepetlerini topla:
  // Her kullanıcının basket localStorage'da kendi cihazında.
  // Admin panelinde göstereceğimiz: tüm kullanıcılara ait
  // proposals içindeki "bekliyor" tekliflerindeki ürünleri sepet olarak sun
  // + mevcut admin cihazındaki basket varsa onu da göster

  const html_parts = [];

  // 1. Mevcut oturumun sepeti (basket localStorage)
  const myBasket = JSON.parse(localStorage.getItem('aygun_basket')||'[]');
  if(myBasket.length > 0) {
    const myEmail = currentUser?.Email||'Ben';
    const ini = myEmail.split('@')[0].slice(0,2).toUpperCase();
    const rows = myBasket.map(item =>
      '<div class="sepet-item-row">' +
      '<span class="sepet-item-urun">' + (item.urun||item.ad||'?') + '</span>' +
      '<span class="sepet-item-qty">x' + (item.qty||item.adet||1) + '</span>' +
      '<span class="sepet-item-price">' + fmt(item.nakit||item.fiyat||0) + '</span>' +
      '</div>'
    ).join('');
    html_parts.push(
      '<div class="sepet-user-block">' +
      '<div class="sepet-user-header">' +
      '<div class="user-avatar" style="width:32px;height:32px;font-size:.75rem;background:var(--red)">' + ini + '</div>' +
      '<span style="font-weight:700">' + myEmail.split('@')[0] + '</span>' +
      '<span class="stok-badge sk" style="background:#dcfce7;color:#166534">' + myBasket.length + ' ürün</span>' +
      '<button class="btn-reset haptic-btn" onclick="clearBasket()" style="margin-left:auto;font-size:.65rem;padding:3px 8px">Boşalt</button>' +
      '</div>' +
      rows +
      '</div>'
    );
  }

  // 2. Firestore proposals'dan her kullanıcının bekleyen ürünleri (diğer cihazlar)
  if(proposals && proposals.length > 0) {
    const bekliyor = proposals.filter(p => p.durum==='bekliyor' || p.durum==='sureDoldu');
    const byUser = {};
    bekliyor.forEach(p => {
      if(!byUser[p.user]) byUser[p.user] = { items: new Map() };
      (p.urunler||[]).forEach(u => {
        if(!u.urun) return;
        const cur = byUser[p.user].items.get(u.urun) || { qty:0, price: u.nakit||u.fiyat||0 };
        cur.qty++;
        byUser[p.user].items.set(u.urun, cur);
      });
    });

    Object.entries(byUser).forEach(([user, d]) => {
      if(!d.items.size) return;
      const ini = user.split('@')[0].slice(0,2).toUpperCase();
      const rows = Array.from(d.items.entries()).map(([urun, v]) =>
        '<div class="sepet-item-row">' +
        '<span class="sepet-item-urun">' + urun + '</span>' +
        '<span class="sepet-item-qty">x' + v.qty + '</span>' +
        '<span class="sepet-item-price">' + fmt(v.price) + '</span>' +
        '</div>'
      ).join('');
      html_parts.push(
        '<div class="sepet-user-block">' +
        '<div class="sepet-user-header">' +
        '<div class="user-avatar" style="width:32px;height:32px;font-size:.75rem">' + ini + '</div>' +
        '<span style="font-weight:700">' + user.split('@')[0] + '</span>' +
        '<span class="stok-badge sk" style="background:#dbeafe;color:#1e40af">' + d.items.size + ' ürün (tekliften)</span>' +
        '</div>' + rows + '</div>'
      );
    });
  }

  if(!html_parts.length) {
    el.innerHTML = '<div class="admin-empty">Aktif sepet bulunamadı</div>';
    return;
  }
  const clearBtn = isAdmin()
    ? '<div style="display:flex;justify-content:flex-end;margin-bottom:10px">' +
      '<button class="btn-reset haptic-btn" onclick="clearAllPendingProps()" style="background:#fee2e2;color:#dc2626;border-color:#fca5a5">🗑 Tüm Bekleyenleri Sil</button>' +
      '</div>'
    : '';
  el.innerHTML = clearBtn + html_parts.join('');
}

function renderUyuyanStok(urunler) {
  urunler = urunler || window._cachedUrunler || allProducts || [];
  if(!Array.isArray(urunler) || !urunler.length) {
    const el2 = document.getElementById('admin-uyuyan-stok');
    if(el2) el2.innerHTML='<div class="admin-empty">Ürün listesi yükleniyor...</div>';
    return;
  }
  const el = document.getElementById('admin-uyuyan-stok');
  if(!el) return;
  // Analytics + proposals + sales'tan sepete giren ürünler
  const data=JSON.parse(localStorage.getItem('analytics_local')||'{}');
  const eklenen = new Set();
  Object.values(data).forEach(byUser=>Object.values(byUser).forEach(rec=>Object.keys(rec.products||{}).forEach(p=>eklenen.add(p))));
  proposals.forEach(p=>(p.urunler||[]).forEach(u=>{ if(u.urun) eklenen.add(u.urun); }));
  sales.forEach(s=>(s.urunler||[]).forEach(u=>{ if(u.urun) eklenen.add(u.urun); }));

  const uyuyan = urunler.filter(r=>{
    const stok = _getStok(r);
    const ad = _getUrunAdi(r);
    return stok > 0 && !eklenen.has(ad);
  });
  if(!uyuyan.length){ el.innerHTML='<div class="stok-ok">✅ Uyuyan stok yok</div>'; return; }
  el.innerHTML = uyuyan.slice(0,20).map(r=>{
    const ad = _getUrunAdi(r);
    const stok = _getStok(r);
    return `<div class="stok-alert"><span class="stok-dot" style="background:#a78bfa"></span><span class="stok-urun">${ad}</span><span class="stok-badge sk" style="background:#f3e8ff;color:#7c3aed">${stok} adet</span></div>`;
  }).join('');
}

function resetProductStats() {
  if(!confirm('Ürün popülerlik verileri sıfırlansın mı?')) return;
  const data=JSON.parse(localStorage.getItem('analytics_local')||'{}');
  Object.values(data).forEach(byUser=>Object.values(byUser).forEach(rec=>rec.products={}));
  localStorage.setItem('analytics_local', JSON.stringify(data));
  renderAdminProducts();
  haptic(30);
}

function renderAdminSales() {
  const el=document.getElementById('admin-sales-list');
  if(!el) return;
  el.innerHTML=sales.length?sales.map(s=>
    `<div class="sale-row">
      <div class="sale-row-header">
        <span class="sale-customer">${s.custName}</span>
        <span class="badge badge-green">${s.method||'-'}</span>
        <span class="sale-amount">${fmt(s.nakit)}</span>
      </div>
      <div class="sale-detail">${fmtDate(s.ts)} · ${s.user} · ${s.custPhone||'-'}</div>
    </div>`
  ).join(''):'<div class="admin-empty">Satış yok</div>';
}


// ─── EXCEL'E AKTAR (Sepet) ────────────────────────────────────
function exportBasketToExcel() {
  if(!basket.length) { alert('Sepet boş!'); return; }
  haptic(18);
  const t = basketTotals();
  const disc = discountAmount > 0
    ? (discountType==='PERCENT' ? '%'+discountAmount : fmt(discountAmount)+' TL')
    : '-';

  // CSV içeriği oluştur
  const rows = [
    ['Ürün', 'Stok', 'Açıklama', 'D.Kart (₺)', '4T AWM (₺)', 'Tek Çekim (₺)', 'Nakit (₺)', 'Kod']
  ];
  basket.forEach(item => {
    rows.push([
      item.urun, item.stok, item.aciklama,
      item.dk, item.awm, item.tek, item.nakit, item.kod||''
    ]);
  });
  // İndirim satırı
  if(discountAmount > 0) {
    const getD = v => discountType==='TRY' ? discountAmount : v*discountAmount/100;
    rows.push(['İNDİRİM ('+disc+')', '', '',
      -getD(t.dk).toFixed(2), -getD(t.awm).toFixed(2),
      -getD(t.tek).toFixed(2), -getD(t.nakit).toFixed(2), '']);
  }
  // Toplam satırı
  rows.push(['NET TOPLAM', '', '',
    (t.dk-( discountType==='TRY'?discountAmount:t.dk*discountAmount/100 )).toFixed(2),
    (t.awm-(discountType==='TRY'?discountAmount:t.awm*discountAmount/100)).toFixed(2),
    (t.tek-(discountType==='TRY'?discountAmount:t.tek*discountAmount/100)).toFixed(2),
    (t.nakit-(discountType==='TRY'?discountAmount:t.nakit*discountAmount/100)).toFixed(2),
    '']);

  // BOM + CSV oluştur (Excel Türkçe karakter uyumlu)
  const BOM = '﻿';
  const csv = BOM + rows.map(r =>
    r.map(v => {
      const s = String(v ?? '').replace(/"/g, '""');
      return /[,;"\n]/.test(s) ? `"${s}"` : s;
    }).join(';')   // Türkiye Excel ayarı: noktalı virgül
  ).join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'aygun-teklif-' + new Date().toLocaleDateString('tr-TR').replace(/\./g,'-') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── TEKLİF DÜZENLEME MODAL (Admin) ──────────────────────────
function openEditProp(id) {
  if(!isAdmin()) return;
  haptic(16);
  const p = proposals.find(pr=>pr.id===id);
  if(!p) return;

  // Mevcut düzenleme modalı varsa kaldır
  const existing = document.getElementById('edit-prop-modal');
  if(existing) existing.remove();

  const urunRows = (p.urunler||[]).map((u,i) =>
    `<div class="edit-urun-row" data-idx="${i}">
      <input class="edit-urun-name" value="${u.urun||''}" placeholder="Ürün adı">
      <input class="edit-urun-nakit" type="number" value="${u.nakit||0}" placeholder="Nakit ₺" style="width:100px">
      <button class="btn-del-urun haptic-btn" onclick="this.closest('.edit-urun-row').remove()">🗑</button>
    </div>`
  ).join('');

  const sureVal = p.sureBitis ? p.sureBitis.split('T')[0] : '';

  const modal = document.createElement('div');
  modal.id = 'edit-prop-modal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'display:flex;z-index:9999';
  modal.innerHTML = `
    <div class="wa-modal-content" style="max-width:560px;max-height:90vh;overflow-y:auto">
      <div class="modal-header">
        <h3>✏️ Teklif Düzenle</h3>
        <button class="close-modal-btn haptic-btn" onclick="document.getElementById('edit-prop-modal').remove()">✕</button>
      </div>
      <div class="wa-modal-body">
        <div class="wa-grid">
          <div class="footer-field">
            <label>Müşteri Adı</label>
            <input type="text" id="ep-name" value="${p.custName||''}">
          </div>
          <div class="footer-field">
            <label>Telefon</label>
            <input type="tel" id="ep-phone" value="${p.phone||''}">
          </div>
          <div class="footer-field">
            <label>Ödeme Şekli</label>
            <input type="text" id="ep-odeme" value="${p.odeme||''}">
          </div>
          <div class="footer-field">
            <label>İndirim (₺)</label>
            <input type="number" id="ep-indirim" value="${p.indirim||0}">
          </div>
          <div class="footer-field">
            <label>Teklif Geçerlilik Tarihi</label>
            <input type="date" id="ep-sure" value="${sureVal}">
          </div>
          <div class="footer-field">
            <label>Durum</label>
            <select id="ep-durum">
              <option value="bekliyor"    ${p.durum==='bekliyor'?'selected':''}>⏳ Bekliyor</option>
              <option value="satisDondu"  ${p.durum==='satisDondu'?'selected':''}>✅ Satışa Döndü</option>
              <option value="iptal"       ${p.durum==='iptal'?'selected':''}>✕ İptal</option>
              <option value="sureDoldu"   ${p.durum==='sureDoldu'?'selected':''}>⌛ Süresi Doldu</option>
            </select>
          </div>
          <div class="footer-field full">
            <label>Not</label>
            <textarea id="ep-not" rows="2">${p.not||''}</textarea>
          </div>
        </div>
        <div class="wa-section-divider">Ürünler</div>
        <div id="ep-urun-list">${urunRows}</div>
        <button class="btn-add-urun haptic-btn" onclick="addEditUrunRow()" style="margin-top:8px;width:100%">+ Ürün Ekle</button>
        <button class="wa-send-btn haptic-btn" onclick="saveEditProp('${p.id}')" style="margin-top:16px">💾 Kaydet</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(()=>modal.classList.add('open'));
}

function addEditUrunRow() {
  const list = document.getElementById('ep-urun-list');
  if(!list) return;
  const div = document.createElement('div');
  div.className = 'edit-urun-row';
  div.innerHTML = `<input class="edit-urun-name" placeholder="Ürün adı" value="">
    <input class="edit-urun-nakit" type="number" placeholder="Nakit ₺" value="0" style="width:100px">
    <button class="btn-del-urun haptic-btn" onclick="this.closest('.edit-urun-row').remove()">🗑</button>`;
  list.appendChild(div);
}

async function saveEditProp(id) {
  haptic(22);
  const idx = proposals.findIndex(p=>p.id===id);
  if(idx===-1) return;

  const urunRows = document.querySelectorAll('#ep-urun-list .edit-urun-row');
  const yeniUrunler = [];
  urunRows.forEach(row => {
    const name  = row.querySelector('.edit-urun-name')?.value?.trim() || '';
    const nakit = parseFloat(row.querySelector('.edit-urun-nakit')?.value) || 0;
    if(name) yeniUrunler.push({ urun:name, nakit, dk:nakit, awm:nakit, tek:nakit, stok:0, aciklama:'-', kod:'' });
  });

  const sureVal = document.getElementById('ep-sure')?.value;
  proposals[idx] = {
    ...proposals[idx],
    custName: document.getElementById('ep-name')?.value?.trim() || proposals[idx].custName,
    phone:    document.getElementById('ep-phone')?.value?.trim() || proposals[idx].phone,
    odeme:    document.getElementById('ep-odeme')?.value?.trim() || proposals[idx].odeme,
    indirim:  parseFloat(document.getElementById('ep-indirim')?.value) || 0,
    durum:    document.getElementById('ep-durum')?.value || proposals[idx].durum,
    not:      document.getElementById('ep-not')?.value?.trim() || '',
    urunler:  yeniUrunler.length ? yeniUrunler : proposals[idx].urunler,
    sureBitis: sureVal ? new Date(sureVal).toISOString() : proposals[idx].sureBitis,
    editedAt: new Date().toISOString(),
    editedBy: currentUser?.Email||'admin'
  };

  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  await fbSaveProp(proposals[idx]);
  document.getElementById('edit-prop-modal')?.remove();
  renderProposals();
  const adminList = document.getElementById('admin-proposals-list');
  if(adminList) renderProposals(adminList, true);
  const ct = document.getElementById('change-toast');
  if(ct){ ct.textContent='✓ Teklif güncellendi'; ct.classList.add('show'); setTimeout(()=>ct.classList.remove('show'),2000); }
}


// ─── SİPARİŞ NOTU (Firebase) ─────────────────────────────────
function getSiparisNotlari() {
  return window._siparisData || [];
}

async function openSiparisNot(urunAdi, urunIdx) {
  haptic(16);
  const not = prompt(urunAdi + ' icin siparis notu:\n(Adet, muadil veya aciklama girebilirsiniz)', '');
  if(not === null || not.trim() === '') return;
  const yeni = {
    id: uid(),
    ts: new Date().toISOString(),
    urun: urunAdi,
    not: not.trim(),
    user: currentUser?.Email||'-',
    durum: 'bekliyor'
  };
  try {
    await setDoc(doc(_db, 'siparis', yeni.id), yeni);
  } catch(e) {
    // Firebase başarısızsa localStorage'a yaz
    const ls = JSON.parse(localStorage.getItem('aygun_siparis')||'[]');
    ls.unshift(yeni);
    localStorage.setItem('aygun_siparis', JSON.stringify(ls));
    if(!window._siparisData) window._siparisData = [];
    window._siparisData.unshift(yeni);
  }
  renderSiparisPanel();
  updateSiparisBadge();
  const ct = document.getElementById('change-toast');
  if(ct) {
    const el = document.createElement('div'); el.className='toast-item';
    el.innerHTML='<span>📦</span><span style="flex:1">Siparis notu eklendi: '+urunAdi+'</span><button class="toast-close" onclick="this.parentElement.remove()">x</button>';
    ct.appendChild(el); setTimeout(()=>el.remove(), 3500);
  }
}

function renderSiparisPanel() {
  const el = document.getElementById('admin-siparis-list');
  if(!el) return;
  const list = getSiparisNotlari();
  if(!list.length) { el.innerHTML='<div class="admin-empty">Siparis notu yok</div>'; return; }
  el.innerHTML = list.map(s => `
    <div class="siparis-row ${s.durum==='tamamlandi'?'siparis-done':''}">
      <div style="flex:1">
        <div class="siparis-urun">${s.urun}</div>
        <div class="siparis-meta">${(s.user||'').split('@')[0]} · ${fmtDate(s.ts)}</div>
        <div class="siparis-not">${s.not}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
        ${s.durum==='bekliyor'
          ? `<button class="pact-btn pact-green haptic-btn" style="font-size:.65rem;padding:4px 8px" onclick="siparisToggle('${s.id}')">&#10003; Tamamlandi</button>`
          : '<span style="font-size:.65rem;color:#10b981;font-weight:700">&#10003; Tamamlandi</span>'}
        <button class="pact-btn pact-del haptic-btn" style="font-size:.65rem;padding:4px 8px;margin-left:0" onclick="siparisDelete('${s.id}')">&#128465;</button>
      </div>
    </div>`).join('');
}

async function siparisToggle(id) {
  const item = (window._siparisData||[]).find(s=>s.id===id);
  if(!item) return;
  const yeniDurum = item.durum==='tamamlandi'?'bekliyor':'tamamlandi';
  try { await updateDoc(doc(_db,'siparis',id), {durum: yeniDurum}); } catch(e) {
    item.durum = yeniDurum; renderSiparisPanel();
  }
}

async function siparisDelete(id) {
  try { await deleteDoc(doc(_db,'siparis',id)); } catch(e) {
    if(window._siparisData) window._siparisData=window._siparisData.filter(s=>s.id!==id);
    renderSiparisPanel(); updateSiparisBadge();
  }
}

async function clearSiparisNotlari() {
  if(!confirm('Tum siparis notlari silinsin mi?')) return;
  const list = getSiparisNotlari();
  for(const s of list) {
    try { await deleteDoc(doc(_db,'siparis',s.id)); } catch(e){}
  }
  haptic(30);
}

function updateSiparisBadge() {
  const bekleyen = getSiparisNotlari().filter(s=>s.durum==='bekliyor').length;
  const badge = document.getElementById('siparis-badge');
  if(badge) { badge.style.display=bekleyen>0?'flex':'none'; badge.textContent=bekleyen; }
  const statEl = document.getElementById('stat-siparis');
  if(statEl) statEl.innerHTML=bekleyen>0
    ? bekleyen+'<span class="stat-today">'+bekleyen+' bekliyor</span>'
    : '0<span class="stat-today">Temiz</span>';
}


// ─── ÇIKIŞ ────────────────────────────────────────────────────
function logoutUser() {
  haptic(22);
  if(!confirm('Çıkış yapmak istediğinize emin misiniz?')) return;
  currentUser = null;
  localStorage.removeItem('aygun_user');
  // Firebase listener'ları durdur
  if(window._propUnsub)      { window._propUnsub(); window._propUnsub=null; }
  if(window._saleUnsub)      { window._saleUnsub(); window._saleUnsub=null; }
  if(window._siparisUnsub)   { window._siparisUnsub(); window._siparisUnsub=null; }
  if(window._analyticsUnsub) { window._analyticsUnsub(); window._analyticsUnsub=null; }
  window._siparisData = [];
  window._fbAnalytics = {};
  proposals = []; sales = [];
  // Admin paneli kapat
  const adminModal = document.getElementById('admin-modal');
  if(adminModal) { adminModal.style.display='none'; adminModal.classList.remove('open'); }
  // Giriş ekranına dön
  document.getElementById('app-content').style.display='none';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('user-input').value='';
  document.getElementById('pass-input').value='';
  document.getElementById('login-err').style.display='none';
}

// ─── ES MODULE → WINDOW BAĞLANTISI ──────────────────────────────
// type="module" script'lerde fonksiyonlar global değildir.
// HTML onclick="..." için window'a açıkça atanmalıdır.
Object.assign(window, {
  checkAuth, toggleCart, toggleZeroStock, filterData,
  openAbakus, closeAbakus, calcAbakus, selectAbakusRow,
  openAbakusAction, openWaFromAbakus,
  closeWaModal, finalizeAksiyon, finalizeProposal,
  openProposals, closeProposals, filterProposals, clearPropSearch,
  openAdmin, closeAdmin, switchAdminTab,
  openSaleDoc, closeSaleDoc, generateSalePDF,
  openWelcomeInfo, closeWelcomeInfo,
  closeChangePopup,
  addToBasket, removeFromBasket, clearBasket, applyDiscount,
  updatePropStatus, resendProposalWa, openPropNote,
  resetProductStats, exportBasketToExcel, renderUyuyanStok, deleteProp, renderSepetDetay,
  openEditProp, addEditUrunRow, saveEditProp,
  openSiparisNot, siparisToggle, siparisDelete, clearSiparisNotlari,
  clearAllPendingProps, logoutUser,
  openMessages: ()=>{},   // kaldırıldı ama eski referanslar için
});
