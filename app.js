// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — app.js  (Rev 3.0 — Firebase Firestore)
//  Teklifler ve Satışlar artık Firebase'de — cihazlar arası senkron
// ═══════════════════════════════════════════════════════════════

// ─── FİREBASE BAŞLATMA ──────────────────────────────────────────
import { initializeApp }                           from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
import { getFirestore, collection, doc, deleteDoc,
         addDoc, setDoc, updateDoc, onSnapshot,
         query, orderBy, serverTimestamp,
         getDoc, getDocs }                         from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const _FB_CFG = {
  apiKey:            "AIzaSyB6ng3XtLONcTlmBXW83gBVQTJGGt9xFII",
  authDomain:        "aygun-teklif.firebaseapp.com",
  projectId:         "aygun-teklif",
  storageBucket:     "aygun-teklif.firebasestorage.app",
  messagingSenderId: "765946162646",
  appId:             "1:765946162646:web:f173e0694a26d36cd10877"
};
const _fbApp = initializeApp(_FB_CFG);
const _db    = getFirestore(_fbApp);
const _colProp      = () => collection(_db, 'proposals');
const _colSales     = () => collection(_db, 'sales');
const _colSiparis   = () => collection(_db, 'siparis');
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
window._liveBasketsUnsub = null;  // YENİ
window._liveBaskets = {};         // YENİ
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
        if(activeTab === 'overview') { renderAdminPanel(); }
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

  // --- YENİ: Live Baskets Listener ---
  if(window._liveBasketsUnsub) window._liveBasketsUnsub();
  window._liveBasketsUnsub = onSnapshot(
    collection(_db, 'live_baskets'),
    snap => {
      window._liveBaskets = {};
      snap.docs.forEach(doc => {
        window._liveBaskets[doc.id] = doc.data();
      });
      const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
      if(adminOpen) {
        const activeTab = document.querySelector('.admin-tab.active')?.dataset?.tab;
        if(activeTab === 'sepetler') renderSepetDetay();
        // renderSepetDurum() çağrısı KALDIRILDI
      }
    },
    err => console.warn('live_baskets listener:', err)
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
let allProducts     = [];
let allRates        = [];
let basket          = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount  = 0, discountType = 'TRY';
let currentUser     = JSON.parse(localStorage.getItem('aygun_user')) || null;
let currentVersion  = '...';
let showZeroStock   = false;
let abakusSelection = null;   // null → Nakit, obje → Taksit bilgisi

// Yerel depolar — Firebase listener gelene kadar localStorage'dan yükle
let proposals = JSON.parse(localStorage.getItem('aygun_proposals')) || [];
let sales     = JSON.parse(localStorage.getItem('aygun_sales'))     || [];
let messages  = [];

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
  document.getElementById('app-content').style.display  = 'block';
  const ab = document.getElementById('admin-btn');
  if(ab) ab.style.display = isAdmin() ? 'flex' : 'none';
  const lb = document.getElementById('logout-btn');
  if(lb) lb.style.display = isAdmin() ? 'none' : 'flex';
  updateProposalBadge();
  startFirebaseListeners();
  startDataPolling();
  // Arama kutusuna kullanıcı adını yaz
  const searchEl = document.getElementById('search');
  if(searchEl) {
    const ad = currentUser?.Ad || currentUser?.Email?.split('@')[0] || '';
    searchEl.placeholder = ad ? 'En iyisiyim ' + ad + ' — Ürün arama' : 'Ürün arama';
  }
}

function startDataPolling() {
  // Mevcut interval varsa temizle
  if(window._dataPollingTimer) clearInterval(window._dataPollingTimer);
  // Her 10 dakikada bir urunler.json'ı kontrol et
  // Versiyon değiştiyse checkChanges otomatik log'a ekler ve popup gösterir
  window._dataPollingTimer = setInterval(async () => {
    if(!currentUser) return; // Çıkış yapıldıysa dur
    try {
      const url = dataUrl('urunler.json') + '?poll=' + Date.now();
      const resp = await fetch(url, { cache: 'no-store' });
      if(!resp.ok) return;
      const json = await resp.json();
      const newV = json.metadata?.v;
      const email = currentUser?.Email||'guest';
      const seen = JSON.parse(localStorage.getItem(CHANGE_SEEN_KEY + email)||'[]');
      // Sadece yeni bir versiyon varsa işle (gereksiz diff hesabını önle)
      if(newV && !seen.includes(newV)) {
        allProducts = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : allProducts);
        window._cachedUrunler = allProducts;
        // Firebase analytics yüklendiyse önce seen recovery yap
        await new Promise(r => setTimeout(r, 500)); // analytics listener için bekle
        checkChanges(json);
        filterData();
      }
    } catch(e) { /* polling hatası sessizce geç */ }
  }, 10 * 60 * 1000); // 10 dakika
}

function safeJSON(text) {
  // BOM temizle, Python boolean/None değerlerini JSON uyumlu yap
  const cleaned = text
    .replace(/^﻿/, '')
    .trim()
    .replace(/:\s*True/g, ': true')
    .replace(/:\s*False/g, ': false')
    .replace(/:\s*None/g, ': null');
  return JSON.parse(cleaned);
}

// ─── HASH TABANLI GİRİŞ ─────────────────────────────────────────
async function sha256hex(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function checkAuth() {
  haptic(22);
  const u   = document.getElementById('user-input').value.trim().toLowerCase();
  const p   = document.getElementById('pass-input').value.trim();
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
      const hashMatch  = (u2.SifreHash && u2.SifreHash===pHash) ||
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
    if (json.metadata?.v) { currentVersion=json.metadata.v; window._currentVersion=json.metadata.v; }
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
    const oi      = allProducts.indexOf(u);
    const stok    = Number(u.Stok)||0;
    const sc      = stok===0?'stok-kritik':stok>10?'stok-bol':'stok-orta';
    const keys    = Object.keys(u);
    const urunKey = keys.find(k=>norm(k)==='urun')||'';
    const descKey = keys.find(k=>norm(k)==='aciklama')||'';
    const kartKey = keys.find(k=>k.includes('Kart'))||'';
    const cekKey  = keys.find(k=>k.includes('ekim'))||'';
    const gamKey  = keys.find(k=>norm(k).includes('gam'))||'';
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
function yuvarlaCeyrek(n) { return Math.ceil(n/250)*250; } // eski — artık kullanılmıyor

// Kademeli yuvarlama: brüt tutara göre toplam tahsilatı yuvarlar
// Küçük tutarlarda hassas (25-50 TL adım), büyük tutarlarda kaba (250-500 TL adım)
function yuvarlaKademe(brut, nTaksit) {
  // Tek çekim / toplam için adım
  let adim;
  if      (brut <  1000) adim =  25;
  else if (brut <  2500) adim =  50;
  else if (brut <  5000) adim = 100;
  else if (brut < 15000) adim = 250;
  else                   adim = 500;
  return Math.ceil(brut / adim) * adim;
}
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

  // --- YENİ: Sepeti live_baskets'e kaydet ---
  if (currentUser && _db) {
    const userEmail = currentUser.Email;
    const basketRef = doc(_db, 'live_baskets', userEmail);
    const total = basket.reduce((s, i) => s + (i.nakit - (i.itemDisc || 0)), 0);
    setDoc(basketRef, {
      userEmail: userEmail,
      userName: currentUser.Ad || userEmail.split('@')[0],
      items: basket.map(item => ({
        urun: item.urun,
        nakit: item.nakit,
        stok: item.stok,
        itemDisc: item.itemDisc || 0,
        aciklama: item.aciklama,
        kod: item.kod
      })),
      total: total,
      ts: serverTimestamp()
    }, { merge: true }).catch(e => console.warn('live_baskets güncellenemedi:', e));
  }
}  
function saveBasket() {
  localStorage.setItem('aygun_basket', JSON.stringify(basket));
  updateCartUI();
  // Firebase'e basket snapshot yaz (admin paneli sepetler için)
  if(currentUser && _db && basket.length >= 0) {
    const email = currentUser.Email;
    const today = new Date().toISOString().split('T')[0];
    const snap  = basket.map(i => ({urun:i.urun, nakit:i.nakit, stok:i.stok}));
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')
      .then(({setDoc, doc}) => {
        const docId = email.replace(/[^a-zA-Z0-9]/g,'_') + '_' + today;
        setDoc(doc(_db,'analytics',docId), {email, date:today, basketSnapshot:snap, basketTs:new Date().toISOString()}, {merge:true});
      }).catch(()=>{});
  }
}
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

function setItemDisc(idx, val) {
  if(!basket[idx]) return;
  const disc = parseFloat(val) || 0;
  basket[idx].itemDisc = disc >= 0 ? disc : 0;
  saveBasket();
  // Sadece toplam göstergesini güncelle, re-render yok (klavye kaybolmasın)
  const totalItemDisc = basket.reduce((s,i)=>s+(i.itemDisc||0),0);
  const panel = document.getElementById('cart-disc-panel');
  if(panel) {
    const span = panel.querySelector('span');
    if(span && totalItemDisc > 0) span.textContent = 'Toplam satır ind: ' + fmt(totalItemDisc);
  }
}

function toggleCartDiscPanel() {
  const panel = document.getElementById('cart-disc-panel');
  if(!panel) return;
  const isOpen = panel.dataset.open === '1';
  if(isOpen) {
    basket.forEach(i => { i.itemDisc = 0; });
    saveBasket();
    window._cartDiscOpen = false;
  } else {
    window._cartDiscOpen = true;
  }
  updateCartUI();
}

// ─── SEPET UI ───────────────────────────────────────────────────
function updateCartUI() {
  const ce=document.getElementById('cart-count'); if(ce) ce.innerText=basket.length;
  const badge=document.getElementById('cart-modal-count'); if(badge) badge.textContent=basket.length+' ürün';
  const area=document.getElementById('cart-table-area'); if(!area) return;
  if(!basket.length) { area.innerHTML='<div class="empty-cart"><span class="empty-cart-icon">🛒</span>Sepetiniz boş</div>'; return; }
  const t=basketTotals();
  let rows='';
  if(isAdmin()) {
    // ── Admin sepeti: Her ürünün satırında % veya ₺ indirim butonu ─
    const totalItemDisc2 = basket.reduce((s,i)=>s+(i.itemDisc||0),0);
    basket.forEach((item,idx) => {
      const itemDisc = item.itemDisc || 0;
      const nakitNet = Math.max(0, item.nakit - itemDisc);
      const hasDisc = itemDisc > 0;
      rows+=`<tr class="${hasDisc?'row-has-disc':''}">`+
        `<td><span class="product-name" style="font-size:.74rem">${item.urun}</span></td>`+
        `<td class="${item.stok===0?'cart-stok-0':''}" style="font-size:.71rem">${item.stok}</td>`+
        `<td style="font-size:.63rem;color:var(--text-3);max-width:80px;word-break:break-word">${item.aciklama||'—'}</td>`+
        `<td class="cart-price${hasDisc?' cart-price-old':''}">${fmt(item.nakit)}</td>`+
        `<td style="padding:4px 6px">`+
          `<div style="display:flex;align-items:center;gap:3px">`+
            `<input type="number" class="item-disc-input" min="0" value="${itemDisc||''}" placeholder="ind."`+
              ` onblur="setItemDisc(${idx},this.value)"`+
              ` onkeydown="if(event.key==='Enter'){setItemDisc(${idx},this.value);this.blur()}"`+
              ` style="width:52px;padding:3px 4px;border:1px solid ${hasDisc?'#93c5fd':'var(--border)'};border-radius:5px;font-size:.67rem;text-align:right;background:${hasDisc?'#eff6ff':'var(--surface)'};">`+
            `${hasDisc?`<button onclick="setItemDisc(${idx},0);this.closest('tr').querySelector('.item-disc-input').value=''" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:1px;font-size:.75rem;line-height:1" title="İndirimi sıfırla">✕</button>`:''}`+
          `</div>`+
        `</td>`+
        `<td class="cart-price${hasDisc?' cart-price-net':''}">${hasDisc?fmt(nakitNet):''}</td>`+
        `<td><button class="remove-btn haptic-btn" onclick="removeFromBasket(${idx})">×</button></td></tr>`;
    });
    // Satır indirim toplamı satırı
    let dr_item = '';
    if(totalItemDisc2 > 0) {
      dr_item = `<tr class="discount-row" style="background:#f0fdf4">` +
        `<td colspan="3" style="text-align:right;font-size:.68rem;color:#15803d">Satır İndirimleri Toplamı</td>` +
        `<td class="cart-price" style="text-decoration:none;color:#6b7280;font-size:.75rem">${fmt(t.nakit)}</td>` +
        `<td></td>` +
        `<td class="cart-price" style="color:#16a34a;font-weight:700">-${fmt(totalItemDisc2)}</td><td></td></tr>`;
    }
    // Alt genel indirim satırı
    const baseAfterItemDisc = t.nakit - totalItemDisc2;
    let dr='';
    if(discountAmount>0) {
      dr=`<tr class="discount-row" style="background:#fff7ed">` +
        `<td colspan="3" style="text-align:right;font-size:.68rem;color:#c2410c">Alt İndirim ${discountType==='PERCENT'?'%'+discountAmount:fmt(discountAmount)}</td>` +
        `<td class="cart-price" style="color:#6b7280;font-size:.75rem">${fmt(baseAfterItemDisc)}</td>` +
        `<td></td>` +
        `<td class="cart-price" style="color:#f97316;font-weight:700">-${fmt(getDisc(baseAfterItemDisc))}</td><td></td></tr>`;
    }
    const nakitFinal = baseAfterItemDisc - getDisc(baseAfterItemDisc);
    const tot=`<tr class="total-row"><td colspan="3" style="text-align:right;font-weight:800;font-size:.78rem">NET TOPLAM</td>`+
      `<td class="cart-price" style="text-decoration:${(discountAmount>0||totalItemDisc2>0)?'line-through':'none'};opacity:${(discountAmount>0||totalItemDisc2>0)?'.45':'1'};font-size:.72rem">${fmt(t.nakit)}</td>`+
      `<td></td>`+
      `<td class="cart-price" style="font-weight:800;color:var(--text-1);font-size:.85rem">${fmt(Math.max(0,nakitFinal))}</td><td></td></tr>`;
    area.innerHTML=`<table class="cart-table"><thead><tr>`+
      `<th>Ürün</th><th>Stok</th><th>Açıklama</th><th>Liste</th><th style="min-width:70px">Satır İnd.</th><th>Net</th><th></th>`+
      `</tr></thead><tbody>${rows}${dr_item}${dr}${tot}</tbody></table>`;
  } else {
    // ── Satış kullanıcısı sepeti: eski düzen (D.Kart/AWM/Tek) ─
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
  const totalItemDisc = basket.reduce((s,i)=>s+(i.itemDisc||0),0);
  let nakit = t.nakit - totalItemDisc - getDisc(t.nakit - totalItemDisc);
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
      // Toplam tahsilat: kademeli yuvarlama (küçük tutarlarda hassas)
      const tahsilat = yuvarlaKademe(nakit/(1-oran/100), td.n);
      // Aylık taksit = tavan(toplam / taksit sayısı)
      const aylik = td.n === 1 ? tahsilat : Math.ceil(tahsilat / td.n);
      if(!enKarliMap[td.n]||oran<enKarliMap[td.n].oran) {
        enKarliMap[td.n]={
          label:td.label, taksit:td.n, oncelik:td.oncelik,
          kart:satir.Kart, zincir:satir.Zincir, oran,
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
      
