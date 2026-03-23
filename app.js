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
function yuvarlaCeyrek(n) { return Math.ceil(n/250)*250; } // eski — artık kullanılmıyor

// Kademeli yuvarlama: brüt tutara göre toplam tahsilatı yuvarlar
// Küçük tutarlarda hassas (25-50 TL adım), büyük tutarlarda kaba (250-500 TL adım)
function yuvarlaKademe(brut, nTaksit) {
  // Tek çekim / toplam için adım
  let adim;
  if      (brut <  1000) adim =  25;
  else if (brut <  2500) adim =  50;
  else if (brut <  5000) adim = 100;
  else if (brut < 15000) adim = 250;
  else                   adim = 500;
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
}
function saveBasket() {
  localStorage.setItem('aygun_basket', JSON.stringify(basket));
  updateCartUI();
  // Firebase'e basket snapshot yaz (admin paneli sepetler için)
  if(currentUser && _db && basket.length >= 0) {
    const email = currentUser.Email;
    const today = new Date().toISOString().split('T')[0];
    const snap  = basket.map(i => ({urun:i.urun, nakit:i.nakit, stok:i.stok}));
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
      const tahsilat=yuvarlaKademe(nakit/(1-oran/100), td.n);
      const aylik = td.n === 1 ? tahsilat : Math.ceil(tahsilat / td.n);
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
  const totalItemDisc = basket.reduce((s,i)=>s+(i.itemDisc||0),0);
  let nakit = t.nakit - totalItemDisc - getDisc(t.nakit - totalItemDisc);
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
    const sureBitisInputWa = document.getElementById('teklif-sure-bitis');
    let expDateObj;
    if(sureBitisInputWa?.value) {
      expDateObj = new Date(sureBitisInputWa.value);
    } else {
      expDateObj = new Date(); expDateObj.setDate(expDateObj.getDate()+3);
    }
    const expDay=String(expDateObj.getDate()).padStart(2,'0');
    const expMonth=String(expDateObj.getMonth()+1).padStart(2,'0');
    const expYear=String(expDateObj.getFullYear()).slice(-2);
    const expDate=expDay+'.'+expMonth+'.'+expYear;
    const urunList=basket.map(i=>'  - '+i.urun).join('\n');
    const dn=discountAmount>0?'\n_İndirim: '+(discountType==='PERCENT'?'%'+discountAmount:fmt(discountAmount))+'_':'';
    // Ödeme satırları
    let odemeBlok='';
    if(abakusSelection) {
      const kartTipi    = abakusSelection.kart || abakusSelection.label || '';
      const aylikTutar  = fmt(abakusSelection.aylik||0);
      const taksitSayisi= abakusSelection.taksit || Math.round((abakusSelection.tahsilat||tahsilat)/(abakusSelection.aylik||1));
      const toplam      = fmt(abakusSelection.tahsilat||tahsilat);
      odemeBlok = '* `'+kartTipi+'`\n*'+aylikTutar+'* x '+taksitSayisi+' Taksit\n*Toplam* '+toplam;
    } else {
      odemeBlok = '* `Nakit`\n*Toplam* '+fmt(nakit);
    }
    const kapanisStr = '> Teklifimize konu ürünlerin fiyatlarını değerlendirmelerinize sunar, ihtiyaç duyacağınız her konuda memnuniyetle destek vermeye hazır olduğumuzu belirtir; çalışmalarınızda kolaylıklar dileriz. Teklif geçerlilik *'+expDate+'* tarihidir.';
    const msg='Aygün AVM Teklif'
      +'\n*Sn* '+custName
      +'\n*Telefon* '+phone
      +'\n\n`Ürünler`\n'+urunList
      +dn
      +'\n\n'+odemeBlok
      +(extraNote?'\n\n*Not* '+extraNote:'')
      +'\n\n'+kapanisStr+'\n*Saygılarımızla,* '+( currentUser?.Ad || currentUser?.Email?.split('@')[0] || '' );
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
  haptic(16);
  const m=document.getElementById('proposals-modal'); if(!m) return;
  m.style.display='flex'; m.classList.add('open');
  currentPropFilter = 'all';
  document.querySelectorAll('.pseg-btn').forEach(b=>b.classList.toggle('active', b.dataset.filter==='all'));
  try { renderProposals(); }
  catch(e) {
    const body = document.getElementById('proposals-body');
    if(body) body.innerHTML = '<div class="admin-empty" style="color:#dc2626">⚠️ Hata: ' + e.message + '</div>';
    console.error('renderProposals error:', e);
  }
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
  // Yeniden eskiye sırala
  myProps.sort((a,b) => (b.ts||'').localeCompare(a.ts||''));


  // Gruplandırma: sadece TELEFON numarasına göre
  // (isim yazım farklılıklarından etkilenmez)
  const phoneMap = new Map();
  myProps.forEach(p => {
    const key = (p.phone||'').replace(/\D/g,''); // sadece rakamlar
    if(!key || key.length < 7) { // telefonsuz teklifler gruplanmaz
      // direkt render edilecek
      return;
    }
    if(!phoneMap.has(key)) phoneMap.set(key, []);
    phoneMap.get(key).push(p);
  });

  let renderHtml = '';
  const renderedIds = new Set();

  phoneMap.forEach((group, phone) => {
    if(group.length > 1) {
      const rep = group[0];
      const bekCnt = group.filter(p => p.durum==='bekliyor'||p.durum==='sureDoldu').length;
      // Güvenli ID: sadece rakam
      const grpId = 'grp' + phone.slice(-8);
      renderedIds.add('__grp_' + grpId); // placeholder
      group.forEach(p => renderedIds.add(p.id));

      renderHtml += '<div class="prop-group">'
        + '<div class="prop-group-header" onclick="togglePropGroup(\'' + grpId + '\')">' 
        + '<span class="prop-group-avatar">' + (rep.custName||'?').slice(0,2).toUpperCase() + '</span>'
        + '<div class="prop-group-info">'
        + '<span class="prop-group-name">' + (rep.custName||'—') + '</span>'
        + '<span class="prop-group-sub">' + (rep.phone||'—') + ' &nbsp;·&nbsp; ' + group.length + ' teklif' + (bekCnt>0?' &nbsp;·&nbsp; '+bekCnt+' bekliyor':'') + '</span>'
        + '</div>'
        + '<span class="prop-group-chevron" id="' + grpId + '_chv">▼</span>'
        + '</div>'
        + '<div class="prop-group-items" id="' + grpId + '">';

      group.forEach(p => { renderHtml += _renderSingleProp(p); });
      renderHtml += '</div></div>';
    }
  });

  // Gruplanmamış teklifler
  myProps.forEach(p => {
    if(!renderedIds.has(p.id)) renderHtml += _renderSingleProp(p);
  });

  target.innerHTML = renderHtml || '<div class="admin-empty">Teklif bulunamadı</div>';
}

function togglePropGroup(grpId) {
  const el = document.getElementById(grpId);
  const chv = document.getElementById(grpId+'_chv');
  if(!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if(chv) chv.textContent = open ? '▶' : '▼';
  haptic(8);
}

function _renderSingleProp(p) {
  try {
  const statusMap = {bekliyor:'⏳ Bekliyor', satisDondu:'✅ Satışa Döndü', iptal:'✕ İptal', sureDoldu:'⌛ Süresi Doldu'};
  const statusCls = {bekliyor:'status-bekliyor', satisDondu:'status-satis-dondu', iptal:'status-iptal', sureDoldu:'status-sure-doldu'};
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
      btns.push(`<button class="pact-btn pact-pdf haptic-btn" onclick="printTeklif('${p.id}')" title="PDF Teklif"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="9" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5 5h5M5 8h5M5 11h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M9 1v3.5H12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg><span class="pact-label"> PDF</span></button>`);
      btns.push(`<button class="pact-btn pact-wa haptic-btn" onclick="resendProposalWa('${p.id}')" title="WhatsApp"><svg width="13" height="13" viewBox="0 0 32 32" fill="currentColor"><path d="M16 2C8.27 2 2 8.27 2 16c0 2.44.65 4.72 1.78 6.7L2 30l7.53-1.74A13.94 13.94 0 0016 30c7.73 0 14-6.27 14-14S23.73 2 16 2zm0 25.5a11.44 11.44 0 01-5.86-1.6l-.42-.25-4.47 1.03 1.06-4.34-.27-.44A11.5 11.5 0 1116 27.5zm6.3-8.6c-.34-.17-2.02-.99-2.33-1.1-.31-.12-.54-.17-.76.17-.23.34-.88 1.1-1.08 1.33-.2.23-.4.25-.74.08-.34-.17-1.43-.52-2.73-1.66-1.01-.9-1.69-2-1.89-2.34-.2-.34-.02-.52.15-.69.15-.15.34-.4.51-.6.17-.2.23-.34.34-.57.12-.23.06-.43-.03-.6-.08-.17-.76-1.83-1.04-2.5-.27-.65-.55-.56-.76-.57h-.65c-.22 0-.57.08-.87.4s-1.14 1.11-1.14 2.7 1.17 3.13 1.33 3.35c.17.22 2.3 3.5 5.57 4.77.78.34 1.39.54 1.86.69.78.25 1.49.21 2.05.13.63-.09 1.93-.79 2.2-1.55.28-.76.28-1.41.2-1.55-.09-.13-.32-.2-.65-.36z"/></svg></button>`);
    }
    // Not: kendi teklifi VEYA admin not ekleyebilir; herkese açık tekliflerde de satış kullanıcısı not ekleyebilir
    const canNote = isAdmin() || p.user===me || p.gizlilik==='acik' || !p.gizlilik;
    if(canNote) btns.push(`<button class="pact-btn pact-note haptic-btn" onclick="openPropNote('${p.id}')" title="Not Ekle"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 12V14h2l7.5-7.5-2-2L2 12zm12.7-7.3a1 1 0 000-1.4l-1-1a1 1 0 00-1.4 0L11 3.6l2.4 2.4 1.3-1.3z" fill="currentColor"/></svg>${noteDot}</button>`);
    if(canEdit) {
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
          <span class="proposal-tag"><a href="tel:${p.phone}" style="color:inherit;text-decoration:none">📞 ${p.phone}</a></span>
          <span class="proposal-tag">💳 ${p.odeme||'—'}</span>
          ${userTag}${gizliTag}${sureTag}
          ${p.not?`<span class="proposal-tag prop-note-inline">💬 ${p.not}</span>`:''}
        </div>
        <div class="proposal-products">${(p.urunler||[]).map(u=>`• ${u.urun}`).join('<br>')}</div>
        ${adminNotes}
      </div>
      ${btns.length ? `<div class="proposal-action-bar">${btns.join('')}</div>` : ''}
    </div>`;
  } catch(e) {
    console.error('_renderSingleProp error:', e, p);
    return `<div class="proposal-card" style="padding:10px;color:#dc2626">⚠️ ${p.custName||'?'} — render hatası: ${e.message}</div>`;
  }
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
    `• ${fmtDate(n.ts)} [${n.who.split('@')[0]}]: ${n.text}`
  ).join('\n');
  const hint = existingNotes ? 'Mevcut notlar:\n'+existingNotes+'\n\nYeni not ekle:' : 'Not girin:';
  const text = prompt(hint, '');
  if(text === null || text.trim() === '') return;
  const idx = proposals.findIndex(pr=>pr.id===id);
  if(idx===-1) return;
  if(!proposals[idx].adminNot) proposals[idx].adminNot = [];
  const newNote = {
    ts: new Date().toISOString(),
    who: currentUser?.Email||'?',
    text: text.trim()
  };
  proposals[idx].adminNot.unshift(newNote);
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  renderProposals();
  const adminList=document.getElementById('admin-proposals-list');
  if(adminList) renderProposals(adminList, true);
  // Firebase güncelle
  fbUpdateProp(proposals[idx].id, { adminNot: proposals[idx].adminNot });
  // Bildirim — teklifler modalı açıksa nota scroll et, değilse toast göster
  _showNoteToast(p.custName, text.trim());
}

function _showNoteToast(custName, noteText) {
  // Mevcut not toast'ı varsa kaldır
  let toast = document.getElementById('note-toast');
  if(!toast) {
    toast = document.createElement('div');
    toast.id = 'note-toast';
    toast.style.cssText = [
      'position:fixed','top:70px','left:50%','transform:translateX(-50%) translateY(-20px)',
      'background:#1e293b','color:#fff','padding:10px 16px','border-radius:10px',
      'font-size:.76rem','font-weight:600','z-index:9999','box-shadow:0 4px 20px rgba(0,0,0,.25)',
      'opacity:0','transition:all .25s','max-width:300px','text-align:center',
      'border-left:3px solid #22c55e','pointer-events:none'
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.innerHTML = '💬 <strong>' + custName + '</strong><br><span style="opacity:.8;font-size:.70rem">' + noteText.slice(0,60) + (noteText.length>60?'…':'') + '</span>';
  // Göster
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  // 3 saniye sonra kaldır
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-20px)';
  }, 3500);
}


// ─── PDF TEKLİF ─────────────────────────────────────────────────
function printTeklif(id) {
  const p = proposals.find(pr => pr.id === id);
  if(!p) { alert('Teklif bulunamadı'); return; }
  haptic(16);
  try { _doPrintTeklif(p); } catch(e) {
    console.error('printTeklif hata:', e);
    alert('PDF oluşturulurken hata: ' + e.message);
  }
}
function _doPrintTeklif(p) {

  const ab     = p.abakus;
  const today  = new Date().toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'});
  const sureTarih = p.sureBitis
    ? new Date(p.sureBitis).toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'})
    : '—';

  // Ödeme bloğu
  let odemeRows = '';
  if(ab) {
    const kartAdi   = ab.kart || ab.label || '—';
    const taksitSay = ab.taksit || 1;
    const aylikTut  = fmt(ab.aylik || 0);
    const toplamTut = fmt(ab.tahsilat || p.nakit || 0);
    if(taksitSay <= 1) {
      odemeRows = `
        <tr><td class="ol">Ödeme Şekli</td><td class="or">${kartAdi} — Tek Çekim</td></tr>
        <tr><td class="ol">Ödenecek Tutar</td><td class="or total-cell">${toplamTut}</td></tr>`;
    } else {
      odemeRows = `
        <tr><td class="ol">Kart</td><td class="or">${kartAdi}</td></tr>
        <tr><td class="ol">Taksit Sayısı</td><td class="or">${taksitSay} Taksit</td></tr>
        <tr><td class="ol">Aylık Taksit</td><td class="or">${aylikTut}</td></tr>
        <tr><td class="ol">Toplam Ödenecek</td><td class="or total-cell">${toplamTut}</td></tr>`;
    }
  } else {
    odemeRows = `
      <tr><td class="ol">Ödeme Şekli</td><td class="or">Nakit</td></tr>
      <tr><td class="ol">Toplam Tutar</td><td class="or total-cell">${fmt(p.nakit||0)}</td></tr>`;
  }

  // İndirim satırları
  const pTotalItemDisc = (p.urunler||[]).reduce((s,u)=>s+(u.itemDisc||0),0);
  const pBaseAfterItem = (p.urunler||[]).reduce((s,u)=>s+Math.max(0,(u.nakit||u.fiyat||0)-(u.itemDisc||0)),0);

  const pItemDiscRow = pTotalItemDisc > 0
    ? `<tr><td class="ol">Satır İndirimler</td><td class="or" style="color:#16a34a">-${fmt(pTotalItemDisc)}</td></tr>`
    : '';
  const indRow = (p.indirim && p.indirim > 0)
    ? `<tr><td class="ol">Alt İndirim</td><td class="or" style="color:#f97316">-${p.indirimTip==='PERCENT'?'%'+p.indirim:fmt(p.indirim)}</td></tr>`
    : '';

  // Ürün satırları — satır indirimi varsa göster
  const hasItemDiscs = (p.urunler||[]).some(u => (u.itemDisc||0) > 0);
  const urunRows = (p.urunler||[]).map((u,i) => {
    const disc = u.itemDisc || 0;
    const net  = Math.max(0, (u.nakit||u.fiyat||0) - disc);
    return `<tr class="${i%2===0?'row-even':'row-odd'}">
      <td class="u-no">${i+1}</td>
      <td class="u-ad">${u.urun||'—'}</td>
      <td class="u-fiyat">${disc>0?`<span style="text-decoration:line-through;opacity:.45;font-size:.85em;margin-right:5px">${fmt(u.nakit||u.fiyat||0)}</span>`:''}<span style="${disc>0?'color:#16a34a;font-weight:800':''}">${disc>0?fmt(net):fmt(u.nakit||u.fiyat||0)}</span>${disc>0?`<span style="display:block;font-size:.75em;color:#16a34a">-${fmt(disc)} indirim</span>`:''}</td>
    </tr>`;
  }).join('');
  // Toplam indirim özeti
  const salesPerson = (p.user||'').split('@')[0];

  const LOGO_B64 = 'data:image/png;base64,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';
  const html = `<!DOCTYPE html>
<html lang="tr"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aygün AVM — Teklif ${(p.id||'').slice(-6).toUpperCase()}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Inter',sans-serif;background:#fff;color:#1e293b;font-size:13px;}
  .page{max-width:740px;margin:0 auto;background:#fff;min-height:100vh;}

  /* Header */
  .hdr{background:#fff;padding:24px 36px 0;display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #e11d48;}
  .hdr-logo img{height:52px;width:auto;display:block;}
  .hdr-right{text-align:right;padding-bottom:16px;}
  .hdr-right .doc-type{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#e11d48;}
  .hdr-right .doc-no{font-size:20px;font-weight:800;color:#0f172a;margin-top:2px;letter-spacing:-.5px;}
  .hdr-right .doc-date{font-size:11px;color:#94a3b8;margin-top:3px;}

  /* Accent bar */
  .accent{height:2px;background:linear-gradient(90deg,#e11d48,#f97316,#eab308);}

  /* Body */
  .body{padding:24px 36px;}

  /* Müşteri + Teklif bilgileri */
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:22px;}
  .info-card{border-radius:8px;padding:14px 16px;border:1px solid #e2e8f0;}
  .info-card.cust{border-left:3px solid #e11d48;}
  .info-card.teklif{border-left:3px solid #64748b;}
  .info-card h4{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:10px;}
  .info-row{display:flex;gap:8px;margin-bottom:5px;font-size:11.5px;align-items:baseline;}
  .info-lbl{color:#94a3b8;min-width:70px;flex-shrink:0;font-size:11px;}
  .info-val{color:#1e293b;font-weight:600;}

  /* Ürünler tablosu */
  .section-title{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px;display:flex;align-items:center;gap:6px;}
  .section-title::after{content:'';flex:1;height:1px;background:#e2e8f0;}
  .urun-table{width:100%;border-collapse:collapse;margin-bottom:20px;}
  .urun-table thead tr{background:#0f172a;}
  .urun-table thead th{color:#94a3b8;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;padding:8px 12px;text-align:left;}
  .urun-table thead th:last-child{text-align:right;}
  .u-no{width:32px;color:#64748b!important;font-size:10.5px;font-weight:400!important;}
  .u-ad{font-weight:500;color:#1e293b;font-size:12px;}
  .u-fiyat{text-align:right;font-weight:700;color:#0f172a;white-space:nowrap;font-size:12px;}
  .row-even td{background:#fff;}
  .row-odd td{background:#f8fafc;}
  .urun-table tbody td{padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;}

  /* Ödeme kartı */
  .odeme-wrap{margin-bottom:22px;display:grid;grid-template-columns:1fr 1fr;gap:14px;}
  .odeme-card{border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;}
  .odeme-card h4{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;padding:10px 14px 8px;background:#f8fafc;border-bottom:1px solid #f1f5f9;}
  .odeme-table{width:100%;border-collapse:collapse;}
  .odeme-table tr:not(:last-child) td{border-bottom:1px solid #f1f5f9;}
  .odeme-table tr:last-child{background:#0f172a;}
  .odeme-table tr:last-child .ol,.odeme-table tr:last-child .or{background:transparent;}
  .odeme-table tr:last-child .ol{color:#94a3b8!important;}
  .odeme-table tr:last-child .or{color:#fff!important;}
  .ol{padding:8px 14px;font-size:11px;color:#64748b;background:#f8fafc;width:48%;}
  .or{padding:8px 14px;font-size:12px;font-weight:600;color:#1e293b;background:#fff;}
  .total-cell{font-size:16px!important;font-weight:800!important;}

  /* Not */
  .not-box{background:#fff7ed;border-left:3px solid #f97316;border-radius:0 6px 6px 0;padding:10px 14px;margin-bottom:18px;font-size:11.5px;color:#9a3412;border:1px solid #fed7aa;border-left:3px solid #f97316;}
  .not-lbl{font-weight:800;margin-right:5px;}

  /* Footer */
  .footer{padding:16px 36px 24px;border-top:2px solid #f1f5f9;margin-top:4px;}
  .footer-text{font-size:10.5px;color:#94a3b8;line-height:1.7;text-align:center;font-style:italic;}
  .footer-bottom{display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px;gap:24px;}
  .sig-box{flex:1;border-top:1.5px solid #e2e8f0;padding-top:8px;text-align:center;}
  .sig-lbl{font-size:9.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.8px;}
  .footer-brand{font-size:9px;color:#cbd5e1;text-align:center;margin-top:12px;}

  @media print{
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    body{background:#fff;}
    .page{box-shadow:none;}
  }
  @media(max-width:600px){
    .info-grid,.odeme-wrap{grid-template-columns:1fr;}
    .body,.hdr,.footer{padding-left:16px;padding-right:16px;}
  }
</style>
</head>
<body>
<div class="page">
  <div class="hdr">
    <div class="hdr-logo"><img src="${LOGO_B64}" alt="Aygün AVM"></div>
    <div class="hdr-right">
      <div class="doc-type">Fiyat Teklifi</div>
      <div class="doc-no">#${(p.id||'').slice(-6).toUpperCase()}</div>
      <div class="doc-date">${today}</div>
    </div>
  </div>
  <div class="accent"></div>

  <div class="body">
    <!-- Müşteri & Teklif Bilgileri -->
    <div class="info-grid">
      <div class="info-card cust">
        <h4>Müşteri Bilgileri</h4>
        <div class="info-row"><span class="info-lbl">Ad Soyad</span><span class="info-val">${p.custName||'—'}</span></div>
        <div class="info-row"><span class="info-lbl">Telefon</span><span class="info-val">${p.phone||'—'}</span></div>
        ${p.custEmail?`<div class="info-row"><span class="info-lbl">E-posta</span><span class="info-val">${p.custEmail}</span></div>`:''}
        ${p.address?`<div class="info-row"><span class="info-lbl">Adres</span><span class="info-val">${p.address}</span></div>`:''}
      </div>
      <div class="info-card teklif">
        <h4>Teklif Detayları</h4>
        <div class="info-row"><span class="info-lbl">Teklif No</span><span class="info-val">#${(p.id||'').slice(-6).toUpperCase()}</span></div>
        <div class="info-row"><span class="info-lbl">Tarih</span><span class="info-val">${today}</span></div>
        <div class="info-row"><span class="info-lbl">Geçerlilik</span><span class="info-val">${sureTarih}</span></div>
        <div class="info-row"><span class="info-lbl">Hazırlayan</span><span class="info-val">${salesPerson}</span></div>
      </div>
    </div>

    <!-- Ürünler -->
    <div class="section-title">Ürünler</div>
    <table class="urun-table">
      <thead><tr><th class="u-no">#</th><th>Ürün Adı</th><th style="text-align:right">Fiyat</th></tr></thead>
      <tbody>${urunRows}</tbody>
    </table>

    <!-- Ödeme -->
    <div class="odeme-wrap">
      <div class="odeme-card">
        <h4>Ödeme Bilgileri</h4>
        <table class="odeme-table">
          ${pItemDiscRow}
          ${indRow}
          ${odemeRows}
        </table>
      </div>
      <div></div>
    </div>

    ${p.not?`<div class="not-box"><span>Not:</span>${p.not}</div>`:''}
  </div>

  <div class="footer">
    <p class="footer-text">Teklifimize konu ürünlerin fiyatlarını değerlendirmelerinize sunar, ihtiyaç duyacağınız her konuda memnuniyetle destek vermeye hazır olduğumuzu belirtir; çalışmalarınızda kolaylıklar dileriz.</p>
    <div class="footer-bottom">
      <div class="sig-box"><div class="sig-lbl">Firma İmzası</div></div>
      <div class="sig-box"><div class="sig-lbl">Müşteri İmzası</div></div>
    </div>
    <p class="footer-brand">Aygün AVM · 0530 3115041</p>
  </div>
</div>
<script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),400);});<\/script>
</body></html>`;

  const win = window.open('', '_blank', 'width=820,height=960,scrollbars=yes');
  if(!win) {
    _showPdfInline(html);
    return;
  }
  win.document.write(html);
  win.document.close();
}

function _showPdfInline(html) {
  // Popup bloklandığında sayfanın üzerinde overlay içinde göster
  let overlay = document.getElementById('pdf-overlay');
  if(!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'pdf-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:12px;overflow:auto';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = '';
  // Üst bar
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:10px;margin-bottom:10px;width:100%;max-width:780px;justify-content:flex-end';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Kapat';
  closeBtn.style.cssText = 'background:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer';
  closeBtn.onclick = () => overlay.remove();
  const printBtn = document.createElement('button');
  printBtn.textContent = '🖨 Yazdır / PDF';
  printBtn.style.cssText = 'background:#e11d48;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer';
  printBtn.onclick = () => iframe.contentWindow.print();
  bar.appendChild(closeBtn);
  bar.appendChild(printBtn);
  overlay.appendChild(bar);
  // iframe
  const iframe = document.createElement('iframe');
  iframe.id = 'pdf-iframe';
  iframe.style.cssText = 'width:100%;max-width:780px;height:85vh;border:none;border-radius:8px;background:#fff';
  overlay.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
}

// ─── WA'DAN PDF ──────────────────────────────────────────────────
// PDF yerine şık HTML teklif linkini base64 olarak encode edip
// "Teklif için: [link]" şeklinde yönlendirme yapıyoruz
// Mobil'de direkt print API'ye erişim kısıtlı olduğundan
// WA butonuna tıklayınca hem teklif mesajı hem PDF butonu çıksın

function resendProposalWa(id) {
  haptic(18);
  const p=proposals.find(pr=>pr.id===id); if(!p) return;
  const exp=new Date(); exp.setDate(exp.getDate()+3);
  const expDay=String(exp.getDate()).padStart(2,'0');
  const expMonth=String(exp.getMonth()+1).padStart(2,'0');
  const expYear=String(exp.getFullYear()).slice(-2);
  const expDate=expDay+'.'+expMonth+'.'+expYear;
  const urunList=(p.urunler||[]).map(i=>{
    const disc = i.itemDisc||0;
    const net  = Math.max(0,(i.nakit||i.fiyat||0)-disc);
    return '  - '+i.urun+(disc>0?' ('+fmt(net)+' — '+fmt(disc)+' ind.)':'');
  }).join('\n');
  // İndirim bloğu — satır ind + alt ind
  const pTotalItemDiscWa = (p.urunler||[]).reduce((s,u)=>s+(u.itemDisc||0),0);
  let dnLines = '';
  if(pTotalItemDiscWa > 0) dnLines += '\n_Satır İndirim: -'+fmt(pTotalItemDiscWa)+'_';
  if(p.indirim > 0) dnLines += '\n_Alt İndirim: '+(p.indirimTip==='PERCENT'?'%'+p.indirim:fmt(p.indirim))+'_';
  const dn = dnLines;

  // Ödeme bloğu — taksit varsa detaylı format
  const ab = p.abakus;
  let odemeBlok;
  if(ab && ab.taksit > 1) {
    odemeBlok = '* `'+ab.kart+'`\n*'+fmt(ab.aylik||0)+'* x '+ab.taksit+' Taksit\n*Toplam* '+fmt(ab.tahsilat||p.nakit||0);
  } else if(ab && ab.taksit === 1) {
    odemeBlok = '* `'+(ab.kart||p.odeme||'Tek Çekim')+'`\n*Toplam* '+fmt(ab.tahsilat||p.nakit||0);
  } else {
    odemeBlok = '* `'+(p.odeme||'Nakit')+'`\n*Toplam* '+fmt(p.tahsilat||p.nakit||0);
  }
  const kapanisStr2 = '> Teklifimize konu ürünlerin fiyatlarını değerlendirmelerinize sunar, ihtiyaç duyacağınız her konuda memnuniyetle destek vermeye hazır olduğumuzu belirtir; çalışmalarınızda kolaylıklar dileriz. Teklif geçerlilik *'+expDate+'* tarihidir.';
  const msg='Aygün AVM Teklif'
    +'\n*Sn* '+p.custName
    +'\n*Telefon* '+p.phone
    +'\n\n`Ürünler`\n'+urunList
    +dn
    +'\n\n'+odemeBlok
    +(p.not?'\n\n*Not* '+p.not:'')
    +'\n\n'+kapanisStr2+'\n*Saygılarımızla,* '+( currentUser?.Ad || currentUser?.Email?.split('@')[0] || '' );
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
// Strateji: Her versiyon geçişi ayrı bir "log kaydı" olarak biriktirilir.
// Kullanıcı uygulamayı açtığında tüm görülmemiş kayıtlar birleşik gösterilir.
// Bu sayede v1→v2→v3→v4 geçişlerinin hiçbiri kaçırılmaz.

const CHANGE_LOG_KEY = 'aygun_change_log_';    // + email
const CHANGE_SEEN_KEY = 'aygun_change_seen_';  // + email
const LAST_JSON_KEY  = 'last_json_';           // + email

function _diffJson(oldJson, newJson) {
  // İki JSON snapshot arasındaki farkları döndür
  const changes = [];
  if(!oldJson?.data || !Array.isArray(newJson?.data)) return changes;
  newJson.data.forEach(p => {
    const old = (oldJson.data||[]).find(ld => ld.Kod === p.Kod);
    if(!old) return; // yeni ürün — şimdilik atla
    const keys    = Object.keys(p);
    const urunKey = keys.find(k=>norm(k)==='urun')||'Kod';
    const descKey = keys.find(k=>norm(k)==='aciklama')||'';
    const urunAdi = p[urunKey]||p.Kod||'?';
    // Nakit fiyat
    const nv=parseFloat(p['Nakit']), ov=parseFloat(old['Nakit']);
    if(!isNaN(nv)&&!isNaN(ov)&&nv!==ov) {
      const diff=nv-ov, pct=((diff/ov)*100).toFixed(1);
      changes.push({ type:'price', urun:urunAdi, field:'Nakit', old:ov, new:nv, diff, pct });
    }
    // Stok
    const ns=Number(p.Stok), os=Number(old.Stok);
    if(!isNaN(ns)&&!isNaN(os)&&ns!==os)
      changes.push({ type:'stok', urun:urunAdi, old:os, new:ns, diff:ns-os });
    // Açıklama
    if(descKey && p[descKey]!==old[descKey])
      changes.push({ type:'aciklama', urun:urunAdi, old:old[descKey]||'', new:p[descKey]||'' });
    // Ürün adı
    if(old[urunKey]&&p[urunKey]&&old[urunKey]!==p[urunKey])
      changes.push({ type:'urunadi', urun:p[urunKey], old:old[urunKey], new:p[urunKey] });
  });
  return changes;
}

function checkChanges(json) {
  const email   = currentUser?.Email||'guest';
  const logKey  = CHANGE_LOG_KEY  + email;
  const seenKey = CHANGE_SEEN_KEY + email;
  const lastKey = LAST_JSON_KEY   + email;
  const vKey    = json.metadata?.v || 'v?';

  // Çerez silinmişse Firebase'deki popupSeen versiyonlarını seen[]'e aktar
  let seen = JSON.parse(localStorage.getItem(seenKey)||'[]');
  if(seen.length === 0 && window._fbAnalytics) {
    const userDocs = Object.values(window._fbAnalytics)
      .filter(d => d.email === email && (d.currentAppVer || d.popupSeen))
      .sort((a,b) => (b.date||'').localeCompare(a.date||''));
    if(userDocs.length) {
      const fbVer = userDocs[0].currentAppVer || userDocs[0].popupSeen;
      if(fbVer && !seen.includes(fbVer)) {
        seen.push(fbVer);
        localStorage.setItem(seenKey, JSON.stringify(seen));
      }
    }
  }

  if(!seen.includes(vKey)) {
    // Makro changelog'u var mı? (en güvenilir kaynak)
    const serverChangelog = Array.isArray(json.metadata?.changelog) ? json.metadata.changelog : null;
    const lastJson = JSON.parse(localStorage.getItem(lastKey)||'null');

    if(serverChangelog && serverChangelog.length > 0) {
      // Sunucu changelog'undan görülmemiş versiyonları bul
      const localLog = JSON.parse(localStorage.getItem(logKey)||'[]');
      const loggedVersions = new Set(localLog.map(e => e.toV));

      // Changelog en yeniden eskiye sıralı geliyor
      // Atlanmış versiyonları tespit et: seen'de olmayan + logda olmayan
      const missed = serverChangelog.filter(entry =>
        !seen.includes(entry.v) && !loggedVersions.has(entry.v) && entry.v !== vKey
      );

      if(missed.length > 0 && lastJson) {
        // Atlanmış her versiyon için sahte bir log girişi oluştur
        // (diff yapamayız ama versiyonun var olduğunu gösterebiliriz)
        missed.reverse().forEach(entry => {
          localLog.push({
            fromV: '?',
            toV:   entry.v,
            ts:    entry.ts || new Date().toISOString(),
            changes: [{ type: 'info', msg: entry.v + ' versiyonunda değişimler yapıldı (detay mevcut değil)' }],
            shown: false
          });
        });
      }

      // Mevcut versiyon için gerçek diff
      if(lastJson) {
        const changes = _diffJson(lastJson, json);
        if(changes.length > 0) {
          const prevV = lastJson.metadata?.v || serverChangelog[1]?.v || '?';
          localLog.push({
            fromV: prevV,
            toV:   vKey,
            ts:    new Date().toISOString(),
            changes,
            shown: false
          });
        }
      }

      if(localLog.length > 20) localLog.splice(0, localLog.length - 20);
      localStorage.setItem(logKey, JSON.stringify(localLog));

    } else if(lastJson) {
      // Changelog yok — eski yöntem: direkt diff
      const changes = _diffJson(lastJson, json);
      if(changes.length > 0) {
        const localLog = JSON.parse(localStorage.getItem(logKey)||'[]');
        localLog.push({
          fromV: lastJson.metadata?.v || '?',
          toV:   vKey,
          ts:    new Date().toISOString(),
          changes,
          shown: false
        });
        if(localLog.length > 20) localLog.splice(0, localLog.length - 20);
        localStorage.setItem(logKey, JSON.stringify(localLog));
      }
    }

    // Snapshot güncelle, versiyon işlendi işaretle
    localStorage.setItem(lastKey, JSON.stringify(json));
    seen.push(vKey);
    if(seen.length > 30) seen.splice(0, seen.length - 30);
    localStorage.setItem(seenKey, JSON.stringify(seen));
  }

  // Görülmemiş log girişleri varsa popup aç
  showPendingChanges(logKey);
}

// Değişim öncelik sırası: 1=yüksek(zorunlu işaretle), 2=düşük(opsiyonel)
function _changePriority(type) {
  if(type==='price')    return 1; // 🔴
  if(type==='aciklama') return 2; // 🟠
  if(type==='stok')     return 3; // 🟡
  return 4;                        // ⚪ versiyon/info
}
function _changeEmoji(type) {
  if(type==='price')    return '🔴';
  if(type==='aciklama') return '🟠';
  if(type==='stok')     return '🟡';
  return '⚪';
}
function _isMandatory(type) {
  return type==='price' || type==='aciklama';
}

function showPendingChanges(logKey) {
  const log = JSON.parse(localStorage.getItem(logKey)||'[]');
  if(!log.length) return;

  const newEntries = log.filter(e => !e.shown);
  if(!newEntries.length) return;

  // Max 3 yeni versiyon göster — fazlası varsa en yeniler önce
  // Önce tüm yenileri shown=true yap, sadece son 3'ü popup'ta göster
  if(newEntries.length > 3) {
    // En eski olanları sessizce shown=true yap
    const toSkip = newEntries.slice(0, newEntries.length - 3);
    toSkip.forEach(e => { e.shown = true; });
    localStorage.setItem(logKey, JSON.stringify(log));
  }

  const p = document.getElementById('change-popup');
  if(p && p.style.display === 'flex') return;

  // Tüm değişimleri düzleştir
  const allChanges = [];
  log.forEach(entry => {
    // Versiyon başlığı
    allChanges.push({
      type: 'versiyon', from: entry.fromV, to: entry.toV,
      ts: entry.ts, isOld: !!entry.shown
    });
    entry.changes.forEach(c => allChanges.push({ ...c, isOld: !!entry.shown }));
  });

  const newOptional  = allChanges.filter(c => !c.isOld && c.type !== 'versiyon' && !_isMandatory(c.type));
  const newMandatory = allChanges.filter(c => !c.isOld && c.type !== 'versiyon' &&  _isMandatory(c.type));
  const oldItems     = allChanges.filter(c =>  c.isOld && c.type !== 'versiyon');
  const newVerItems  = allChanges.filter(c => !c.isOld && c.type === 'versiyon');
  const oldVerItems  = allChanges.filter(c =>  c.isOld && c.type === 'versiyon');

  const sortByGamMarka = (a,b) => {
    const ga=a.gam||'',gb=b.gam||'';
    if(ga!==gb) return ga.localeCompare(gb,'tr');
    const ma=a.marka||'',mb=b.marka||'';
    if(ma!==mb) return ma.localeCompare(mb,'tr');
    return (a.urun||'').localeCompare(b.urun||'','tr');
  };
  newOptional.sort(sortByGamMarka);
  newMandatory.sort(sortByGamMarka);

  // ÜSTE: bilgi amaçlı (versiyon başlığı + opsiyoneller) → ALTTA: zorunlular
  const sorted = [...newVerItems, ...newOptional, ...newMandatory, ...oldVerItems, ...oldItems];

  showChangePopup(sorted, logKey);
}

function _renderMergedItem(m, idx, isRequired=true) {
  const hasPrice    = !!m.price;
  const hasAciklama = !!m.aciklama;
  const hasStok     = !!m.stok;

  // Başlık ikonu
  let emoji = hasPrice ? (m.price.diff > 0 ? '📈' : '📉') : (hasAciklama ? '📝' : '📦');

  // Badge'lar
  let badges = '';
  if(hasPrice) {
    const up   = m.price.diff > 0, sign = up ? '+' : '';
    badges += `<span class="change-badge ${up?'badge-price-up':'badge-price-down'}">${sign}${m.price.pct}%</span>`;
  }
  if(hasAciklama) badges += `<span class="change-badge badge-desc">Açıklama</span>`;
  if(hasStok) {
    const up = m.stok.diff > 0;
    badges += `<span class="change-badge ${up?'badge-stok-up':'badge-stok-down'}">Stok ${up?'+':''}${m.stok.diff}</span>`;
  }

  // Detay satırları
  let details = '';
  if(hasPrice) {
    details += `<span class="ci-row">Nakit: ${fmt(m.price.old)} → <strong>${fmt(m.price.new)}</strong></span>`;
  }
  if(hasStok) {
    const up = m.stok.diff > 0;
    details += `<span class="ci-row" style="color:${up?'#16a34a':'#dc2626'}">Stok: ${m.stok.old} → <strong>${m.stok.new}</strong></span>`;
  }
  if(hasAciklama) {
    details += `<span class="ci-row ci-aciklama-block">📝 ${m.aciklama.new||'(boş)'}</span>`;
  }

  const mandCls  = isRequired ? 'change-item-mandatory' : 'change-item-readonly';
  const clickEvt = isRequired ? 'onclick="toggleChangeItemRow(this)"' : '';
  const readTag  = isRequired ? '' : '<span class="ci-read-tag" title="Okumak yeterli">📖</span>';

  return `<div class="change-item ${mandCls}" data-idx="${idx}" ${clickEvt}>
    <span class="ci-emoji">${emoji}</span>
    <div class="ci-body">
      <span class="ci-urun">${m.urun}</span>
      <span class="ci-detail">${details}</span>
    </div>
    <div class="ci-badges">${badges}${readTag}</div>
  </div>`;
}

function _renderChangeItem(c, idx, infoMode=false) {
  const isOld    = !!c.isOld;
  const mandatory = !isOld && !infoMode && _isMandatory(c.type);
  const optional  = infoMode || (!isOld && !_isMandatory(c.type));
  // infoMode=true → başta normal görünüm (change-item-info), buton sonrası soluklaşır
  const doneCls   = isOld ? 'change-item-done' : '';
  const mandCls   = mandatory  ? 'change-item-mandatory' : '';
  const optCls    = infoMode   ? 'change-item-info'
                  : optional   ? 'change-item-optional' : '';
  const oldCls    = isOld      ? 'change-item-old'       : '';

  // Zorunlularda: kutucuk yok, satırın tamamı tıklanınca fosforlu çizgi efekti
  // Opsiyonellerde: kutucuk yok, baştan çizili (okundu)
  // Eskilerde: kutucuk çizili

  let inner = '';
  if(c.type === 'price') {
    const up=c.diff>0, sign=up?'+':'';
    inner = `<span class="ci-emoji">${up?'📈':'📉'}</span>
      <div class="ci-body">
        <span class="ci-urun">${c.urun}</span>
        <span class="ci-detail">Nakit: ${fmt(c.old)} → <strong>${fmt(c.new)}</strong></span>
      </div>
      <span class="change-badge ${up?'badge-price-up':'badge-price-down'}">${sign}${c.pct}%</span>`;
  } else if(c.type === 'stok') {
    const up=c.diff>0, sign=up?'+':'';
    inner = `<span class="ci-emoji">${up?'📦':'⚠️'}</span>
      <div class="ci-body">
        <span class="ci-urun">${c.urun}</span>
        <span class="ci-detail">Stok: ${c.old} → <strong>${c.new}</strong></span>
      </div>
      <span class="change-badge ${up?'badge-stok-up':'badge-stok-down'}">Stok ${sign}${c.diff}</span>`;
  } else if(c.type === 'aciklama') {
    inner = `<span class="ci-emoji">📝</span>
      <div class="ci-body">
        <span class="ci-urun">${c.urun}</span>
        <span class="ci-detail">Açıklama → <em>${c.new||'(boş)'}</em></span>
      </div>
      <span class="change-badge badge-desc">Açıklama</span>`;
  } else if(c.type === 'urunadi') {
    inner = `<span class="ci-emoji">🏷️</span>
      <div class="ci-body">
        <span class="ci-urun">${c.new}</span>
        <span class="ci-detail">Ürün adı güncellendi</span>
      </div>`;
  } else if(c.type === 'info') {
    inner = `<span class="ci-emoji">ℹ️</span>
      <div class="ci-body">
        <span class="ci-urun">Versiyon güncellendi</span>
        <span class="ci-detail">${c.msg||''}</span>
      </div>`;
  } else return '';

  const clickAttr = mandatory ? 'onclick="toggleChangeItemRow(this)"' : '';
  return `<div class="change-item ${doneCls} ${mandCls} ${optCls} ${oldCls}" data-idx="${idx}" ${clickAttr}>${inner}</div>`;
}

function showChangePopup(changes, logKey) {
  const list = document.getElementById('change-list');
  if(!list) return;

  const isSatisUser = !isAdmin();

  // Değişimleri grupla
  const verItems  = changes.filter(c => c.type === 'versiyon' && !c.isOld);
  const optItems  = changes.filter(c => c.type !== 'versiyon' && !c.isOld && !_isMandatory(c.type));
  const mandItems = changes.filter(c => c.type !== 'versiyon' && !c.isOld &&  _isMandatory(c.type));

  let html = '';

  // ── BÖLÜM 1: Bilgi Amaçlı ─────────────────────────────────
  const stokItems = optItems.filter(c => c.type === 'stok');
  const lowItems  = [...verItems, ...stokItems];

  if(lowItems.length) {
    const firstVer = verItems.length ? verItems[0] : null;
    const lastVer  = verItems.length ? verItems[verItems.length-1] : null;
    let verRangeStr = '';
    if(firstVer && lastVer && firstVer !== lastVer) verRangeStr = firstVer.from + ' → ' + lastVer.to;
    else if(firstVer) verRangeStr = firstVer.from + ' → ' + firstVer.to;

    // Stokları düz metin listesi olarak göster
    let stokListHtml = '';
    stokItems.forEach(c => {
      const up   = c.diff > 0;
      const sign = up ? '+' : '';
      const icon = up ? '▲' : '▼';
      const color= up ? '#16a34a' : '#dc2626';
      stokListHtml += `<div class="info-stok-row">
        <span class="info-stok-urun">${c.urun}</span>
        <span class="info-stok-val" style="color:${color}">${icon} ${sign}${c.diff} (${c.old}→<strong>${c.new}</strong>)</span>
      </div>`;
    });

    html += `<div class="section-block section-low">
      <div class="section-header section-header-low">
        <span class="sh-icon">📋</span>
        <div>
          <div class="sh-title">Bilgi Amaçlı Değişimler</div>
          <div class="sh-sub">${verRangeStr ? verRangeStr + ' · ' : ''}${stokItems.length} stok güncellendi</div>
        </div>
      </div>
      <div class="info-stok-list">${stokListHtml || '<div class="info-stok-row" style="color:#94a3b8">Stok değişimi yok</div>'}</div>
      <button class="section-confirm-btn section-confirm-low" onclick="confirmSection('low',this)">
        <span class="scb-icon">☐</span> Okudum, devam ediyorum
      </button>
    </div>`;
  }

  // ── BÖLÜM 2: Önemli Değişimler ────────────────────────────
  if(mandItems.length) {
    // Tüm mandatory değişimleri ürün bazında birleştir (price + aciklama + stok)
    const mergedMap = new Map();
    mandItems.forEach(c => {
      const key = c.urun || c.new || '?';
      if(!mergedMap.has(key)) mergedMap.set(key, { urun:key, price:null, aciklama:null, stok:null });
      if(c.type === 'price')    mergedMap.get(key).price    = c;
      if(c.type === 'aciklama') mergedMap.get(key).aciklama = c;
      if(c.type === 'stok')     mergedMap.get(key).stok     = c;
    });
    const mergedItems = Array.from(mergedMap.values());

    // %10 seçim (satış kullanıcısı)
    let randomSelected = null;
    let requiredCount  = mergedItems.length;
    if(isSatisUser && mergedItems.length > 1) {
      requiredCount = Math.max(1, Math.ceil(mergedItems.length * 0.10));
      // Her zaman EN SON ürünü zorunlu yap (en alta inememe durumu için)
      const shuffled = [...Array(mergedItems.length - 1).keys()].sort(() => Math.random() - 0.5);
      const selected = new Set(shuffled.slice(0, requiredCount - 1));
      selected.add(mergedItems.length - 1); // son eleman her zaman zorunlu
      randomSelected = selected;
    }

    const subLabel = isSatisUser
      ? `${requiredCount} tanesini onaylayın`
      : 'Her satıra tıklayarak onaylayın';

    html += `<div class="section-block section-high">
      <div class="section-header section-header-high">
        <span class="sh-icon">⚠️</span>
        <div>
          <div class="sh-title">Önemli Değişimler</div>
          <div class="sh-sub">${subLabel}</div>
        </div>
      </div>
      <div class="section-items">`;

    mergedItems.forEach((m, mIdx) => {
      const isRequired = !randomSelected || randomSelected.has(mIdx);
      html += _renderMergedItem(m, mIdx, isRequired);
    });

    html += `</div></div>`;
  }

  list.innerHTML = html;

  // Header bandını güncelle (satış kullanıcısı için)
  _updateChangeBanner(mandItems.length, mergedMap_count(mandItems));

  _updateChangeBtn();

  const p = document.getElementById('change-popup');
  p.dataset.logKey = logKey || '';
  p.style.display = 'flex';
  p.classList.add('open');
}

function mergedMap_count(mandItems) {
  const s = new Set();
  mandItems.forEach(c => s.add(c.urun || c.new || '?'));
  return s.size;
}

function _updateChangeBanner(totalMand, uniqueUrun) {
  // Siyah başlık bandındaki bilgilendirme
  const sub = document.getElementById('change-header-sub');
  if(!sub) return;
  if(!isAdmin() && uniqueUrun > 0) {
    const req = Math.max(1, Math.ceil(uniqueUrun * 0.10));
    sub.textContent = uniqueUrun + ' önemli değişim — ' + req + ' tanesini onaylayın';
  } else if(isAdmin() && uniqueUrun > 0) {
    sub.textContent = uniqueUrun + ' önemli değişim · Tümünü işaretle ile geç';
  } else {
    sub.textContent = 'Değişimleri okuyun';
  }
}

function confirmSection(type, btn) {
  // "Okudum" butonuna basılınca bölümü kapat, butonu işaretle
  const block = btn.closest('.section-block');
  if(!block) return;
  btn.classList.add('scb-confirmed');
  btn.innerHTML = '<span class="scb-icon">✓</span> Okundu';
  btn.disabled = true;
  block.classList.add('section-confirmed');
  _doUpdateChangeBtn();
  haptic(12);
}

function toggleChangeItem(el) {
  const item = el.closest('.change-item');
  if(!item) return;
  const done = item.classList.toggle('change-item-done');
  el.textContent = done ? '✓' : '';
  el.classList.toggle('chk-done', done);
  _updateChangeBtn();
  haptic(8);
}

function toggleChangeItemRow(item) {
  // Zorunlu satıra herhangi bir yerden tıklayınca toggle
  if(!item.classList.contains('change-item-mandatory')) return;
  const chk = item.querySelector('.chk-box');
  if(chk) { toggleChangeItem(chk); return; }
  // chk yoksa direkt item toggle
  item.classList.toggle('change-item-done');
  _updateChangeBtn();
  haptic(8);
}

function _updateChangeBtn() {
  // DOM'un kesin hazır olması için hem sync hem async çalıştır
  _doUpdateChangeBtn();
  setTimeout(_doUpdateChangeBtn, 50);
}
function _doUpdateChangeBtn() {
  const btn = document.getElementById('change-close-btn');
  if(!btn) return;
  const lowSection    = document.querySelector('#change-list .section-low');
  const lowConfirmed  = !lowSection || lowSection.classList.contains('section-confirmed');
  const mandatoryLeft = document.querySelectorAll('#change-list .change-item-mandatory:not(.change-item-done)').length;
  const canClose      = lowConfirmed && mandatoryLeft === 0;

  // Admin: "Tümünü Onayla" siyah bantta — kapatma butonu gizli
  const markAllBtn = document.getElementById('change-mark-all-btn');
  if(markAllBtn) markAllBtn.style.display = (isAdmin() && (mandatoryLeft > 0 || !lowConfirmed)) ? 'inline-flex' : 'none';

  // Kapatma butonu her iki kullanıcıda da GİZLİ — otomatik kapanır
  btn.style.display = 'none';

  // Durum bilgisi siyah banta yaz
  const sub = document.getElementById('change-header-sub');
  if(sub) {
    if(canClose) {
      sub.textContent = '';
      // Otomatik kapat (kısa gecikmeyle kullanıcı son öğeyi görsün)
      setTimeout(() => closeChangePopup(), 350);
    } else if(!lowConfirmed && mandatoryLeft > 0) {
      sub.innerHTML = '<span class="chg-sub-info">⬆ Önce bilgi bölümünü onaylayın</span>';
    } else if(!lowConfirmed) {
      sub.innerHTML = '<span class="chg-sub-info">⬆ Bilgi bölümünü onaylayın</span>';
    } else {
      sub.innerHTML = '<span class="chg-sub-info">' + mandatoryLeft + ' onay kaldı</span>';
    }
  }
}

function markAllChanges() {
  // Tüm zorunlu + readonly satırları işaretle
  document.querySelectorAll('#change-list .change-item-mandatory:not(.change-item-done), #change-list .change-item-readonly').forEach(item => {
    item.classList.add('change-item-done');
  });
  // Bilgi bölümü "Okudum" butonunu onayla
  document.querySelectorAll('.section-confirm-btn:not(.scb-confirmed)').forEach(btn => {
    confirmSection('low', btn);
  });
  haptic(18);
  // Otomatik kapat — _doUpdateChangeBtn zaten tetikler
  _updateChangeBtn();
}

function closeChangePopup() {
  const p = document.getElementById('change-popup');
  const logKey = p.dataset.logKey;
  if(logKey) {
    const log = JSON.parse(localStorage.getItem(logKey)||'[]');
    let changed = false;
    log.forEach(e => { if(!e.shown) { e.shown = true; changed = true; } });
    if(changed) localStorage.setItem(logKey, JSON.stringify(log));
  }
  // Mevcut versiyonu seen'e ekle (henüz yoksa)
  const email = currentUser?.Email||'guest';
  const seenKey = CHANGE_SEEN_KEY + email;
  const seen = JSON.parse(localStorage.getItem(seenKey)||'[]');
  const curVer = window._currentVersion || '';
  if(curVer && !seen.includes(curVer)) {
    seen.push(curVer);
    if(seen.length > 30) seen.splice(0, seen.length - 30);
    localStorage.setItem(seenKey, JSON.stringify(seen));
  }
  // seen güncellendikten SONRA Firebase'e yaz
  _fbSavePopupSeen();
  p.style.display = 'none';
  p.classList.remove('open');
  if(allProducts && allProducts.length) filterData();
}

function _fbSavePopupSeen() {
  if(!currentUser || !_db) return;
  const email = currentUser.Email;
  const today = new Date().toISOString().split('T')[0];
  const seenArr = JSON.parse(localStorage.getItem('aygun_change_seen_'+email)||'[]');
  const lastSeen = seenArr.length ? seenArr[seenArr.length-1] : null;
  const now = new Date().toISOString();
  const local = JSON.parse(localStorage.getItem('analytics_local')||'{}');
  if(!local[today]) local[today]={};
  if(!local[today][email]) local[today][email]={logins:0,proposals:0,basketAdds:0,sales:0,products:{}};
  local[today][email].popupSeen = lastSeen;
  local[today][email].popupSeenTs = now;
  localStorage.setItem('analytics_local', JSON.stringify(local));
  // Firebase'e yaz — versiyonu da ekle
  if(_db) {
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js').then(({setDoc,doc})=>{
      const docId = email.replace(/[^a-zA-Z0-9]/g,'_')+'_'+today;
      setDoc(doc(_db,'analytics',docId), {
        email, date:today,
        popupSeen: lastSeen,
        popupSeenTs: now,
        currentAppVer: window._currentVersion || ''
      }, {merge:true});
    }).catch(()=>{});
  }
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
  // Firebase'e async yaz (popup durumu dahil)
  _fbWriteAnalytics(email, today, rec);
}

async function _fbWriteAnalytics(email, today, rec) {
  if(!_db) return;
  try {
    const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const docId = email.replace(/[^a-zA-Z0-9]/g,'_') + '_' + today;
    await setDoc(doc(_db, 'analytics', docId), { email, date: today, ...rec }, { merge: true });
  } catch(e) { /* sessiz */ }
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

  // Kritik Stok — her açılışta tazele
  const _stokEl = document.getElementById('admin-stok-uyari');
  if(_stokEl) { renderStokUyari(); }
  // Kullanıcı sepet durumu
  renderSepetDurum();
  // Personel bugün
  renderPersonelBugun(data, today);
}

function toggleStokPanel() {
  const panel = document.getElementById('admin-stok-uyari');
  const arrow = document.getElementById('stok-panel-arrow');
  if(!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if(arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
  if(!isOpen) renderStokUyari(); // İlk açılışta yükle
}
function renderStokUyari() {
  const el = document.getElementById('admin-stok-uyari');
  if(!el) return;
  el.innerHTML = '<div class="admin-empty" style="color:#64748b">⏳ Stok kontrol ediliyor...</div>';
  const rows = (allProducts && allProducts.length) ? allProducts
             : (window._cachedUrunler && window._cachedUrunler.length) ? window._cachedUrunler
             : null;
  if(rows && rows.length) { window._cachedUrunler = rows; _doStokUyari(el, rows); return; }
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
    // Versiyon bilgisi: Firebase analytics önce, localStorage fallback
    let bestDoc = null;
    if(window._fbAnalytics) {
      const uDocs = Object.values(window._fbAnalytics)
        .filter(d => d.email === email && (d.currentAppVer || d.popupSeen))
        .sort((a,b) => (b.date||'').localeCompare(a.date||''));
      if(uDocs.length) bestDoc = uDocs[0];
    }
    if(!bestDoc) {
      const localAnal = JSON.parse(localStorage.getItem('analytics_local')||'{}');
      const sortedDates = Object.keys(localAnal).sort().reverse();
      for(const d of sortedDates) {
        const rec = localAnal[d] && localAnal[d][email];
        if(rec && (rec.currentAppVer || rec.popupSeen)) {
          bestDoc = { ...rec, date: d, email };
          break;
        }
      }
    }
    const userAppVer  = (bestDoc && (bestDoc.currentAppVer || bestDoc.popupSeen)) || null;
    const popupSeenTs = (bestDoc && bestDoc.popupSeenTs) || null;
    const appVer      = window._currentVersion || '';
    // Sadece versiyon numarasını karşılaştır (V10 vs V10)
    const uVerNum     = userAppVer ? userAppVer.split(' ')[0] : null;
    const cVerNum     = appVer     ? appVer.split(' ')[0]     : null;
    const isUpToDate  = uVerNum && cVerNum && uVerNum === cVerNum;
    const verLabel    = uVerNum || null;
    const verColor    = !verLabel ? 'badge-ver-unknown'
                      : isUpToDate ? 'badge-ver-ok' : 'badge-ver-warn';
    const verIcon     = !verLabel ? '?' : isUpToDate ? '✓' : '⚠️';
    const seenTs      = popupSeenTs
      ? new Date(popupSeenTs).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
      : null;
    const verTitle    = seenTs ? ('Son popup: '+seenTs) : (verLabel ? 'Versiyon: '+verLabel : 'Popup henüz kapatılmamış');
    const verBadge    = '<span class="badge ' + verColor + ' ver-badge-admin" title="' + verTitle + '">' + (verLabel||'?') + ' ' + verIcon + '</span>';
    const verStatusLine = (!isUpToDate && verLabel && cVerNum)
      ? '<div class="user-ver-warn">📋 ' + verLabel + ' → güncel: ' + cVerNum + '</div>'
      : (!verLabel ? '<div class="user-ver-warn" style="color:#94a3b8">📋 Versiyon bilgisi yok</div>' : '');

    return `<div class="user-row">
      <div class="user-avatar">${ini}</div>
      <div class="user-info">
        <div class="user-email">${email.split('@')[0]}</div>
        <div class="user-meta">Son aktivite: ${s.lastSeen||'-'}</div>
        ${verStatusLine}
      </div>
      <div class="user-badges">
        ${verBadge}
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

async function clearUserBasket(email) {
  if(!isAdmin()) return;
  if(!confirm(email.split('@')[0] + ' kullanıcısının sepeti boşaltılsın mı?')) return;
  haptic(20);
  try {
    const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const today = new Date().toISOString().split('T')[0];
    const docId = email.replace(/[^a-zA-Z0-9]/g,'_') + '_' + today;
    await setDoc(doc(_db,'analytics',docId), {email, date:today, basketSnapshot:[], basketTs:new Date().toISOString()}, {merge:true});
    // Local cache'i de güncelle
    if(window._fbAnalytics) {
      Object.keys(window._fbAnalytics).forEach(k => {
        if(window._fbAnalytics[k].email === email) window._fbAnalytics[k].basketSnapshot = [];
      });
    }
    renderSepetDetay();
  } catch(e) { alert('Hata: ' + e.message); }
}
function clearUserProps(userEmail) {
  if(!isAdmin()) return;
  const userPending = proposals.filter(p=>p.user===userEmail&&(p.durum==='bekliyor'||p.durum==='sureDoldu'));
  if(!userPending.length) { alert('Bu kullanıcının bekleyen teklifi yok'); return; }
  if(!confirm(userEmail.split('@')[0]+' kullanıcısının '+userPending.length+' teklifi silinsin mi?')) return;
  haptic(30);
  userPending.forEach(async p => {
    const idx = proposals.findIndex(pr=>pr.id===p.id);
    if(idx>-1) proposals.splice(idx,1);
    try { await deleteDoc(doc(_db,'proposals',p.id)); } catch(e){}
  });
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  renderSepetDetay(); renderSepetDurum(); updateProposalBadge();
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

  // 2. Firestore proposals'dan bekleyen teklif sepetleri (diğer cihazlar)
  //    Admin'in kendi sepeti zaten yukarıda (myBasket) gösterildi
  const myEmail = currentUser?.Email || '';
  const propUsers = [...new Set(
    proposals.filter(p => p.durum === 'bekliyor' || p.durum === 'taslak')
             .map(p => p.user)
             .filter(u => u && u !== myEmail)
  )];

  propUsers.forEach(user => {
    const userProps = proposals.filter(p =>
      p.user === user && (p.durum === 'bekliyor' || p.durum === 'taslak')
    );
    if(!userProps.length) return;
    const ini = user.split('@')[0].slice(0,2).toUpperCase();

    // Her teklifte ürünler — tek liste olarak göster
    const urunMap = new Map(); // urun -> { qty, nakit }
    userProps.forEach(p => {
      (p.urunler||[]).forEach(u => {
        if(!u.urun) return;
        const cur = urunMap.get(u.urun) || { qty: 0, nakit: u.nakit||0 };
        cur.qty++;
        urunMap.set(u.urun, cur);
      });
    });

    const itemRows = Array.from(urunMap.entries()).map(([urun, v]) =>
      '<div class="sepet-item-row">' +
      '<span class="sepet-item-urun">' + urun + '</span>' +
      (v.qty > 1 ? '<span class="sepet-item-qty">x' + v.qty + '</span>' : '') +
      '<span class="sepet-item-price">' + fmt(v.nakit) + '</span>' +
      '</div>'
    ).join('');

    html_parts.push(
      '<div class="sepet-user-block">' +
      '<div class="sepet-user-header">' +
      '<div class="user-avatar" style="width:32px;height:32px;font-size:.75rem">' + ini + '</div>' +
      '<span style="font-weight:700">' + user.split('@')[0] + '</span>' +
      '<span class="stok-badge sk" style="background:#fef3c7;color:#92400e">' + userProps.length + ' teklif / ' + urunMap.size + ' ürün</span>' +
      '<button onclick="clearUserProps(\'' + user + '\')" style="margin-left:auto;background:#fee2e2;border:none;border-radius:6px;padding:4px 12px;font-size:.68rem;cursor:pointer;color:#dc2626;font-weight:600">🗑 Boşalt</button>' +
      '</div>' +
      itemRows +
      '</div>'
    );
  });

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
  const totalItemDiscCSV = basket.reduce((s,i)=>s+(i.itemDisc||0),0);
  if(isAdmin()) {
    // Admin CSV: Liste Fiyatı + Satır İnd. + Net Fiyat
    const rows = [
      ['Ürün', 'Stok', 'Açıklama', 'Liste (₺)', 'Satır İnd. (₺)', 'Net (₺)', 'Kod']
    ];
    basket.forEach(item => {
      const itemDisc = item.itemDisc || 0;
      rows.push([
        item.urun, item.stok, item.aciklama||'-',
        item.nakit, itemDisc||0,
        Math.max(0, item.nakit - itemDisc), item.kod||''
      ]);
    });
    if(totalItemDiscCSV > 0) {
      rows.push(['Satır İnd. Toplamı', '', '', t.nakit, -totalItemDiscCSV, (t.nakit-totalItemDiscCSV).toFixed(2), '']);
    }
    const baseAfterItem = t.nakit - totalItemDiscCSV;
    if(discountAmount > 0) {
      const getD = v => discountType==='TRY' ? discountAmount : v*discountAmount/100;
      rows.push(['Alt İndirim ('+disc+')', '', '', baseAfterItem, -getD(baseAfterItem).toFixed(2), (baseAfterItem-getD(baseAfterItem)).toFixed(2), '']);
    }
    const nakitFinalCSV = baseAfterItem - (discountType==='TRY'?discountAmount:baseAfterItem*discountAmount/100);
    rows.push(['NET TOPLAM', '', '', t.nakit, -(t.nakit-Math.max(0,nakitFinalCSV)).toFixed(2), Math.max(0,nakitFinalCSV).toFixed(2), '']);
    const BOM2 = '\uFEFF';
    const csv2 = BOM2 + rows.map(r =>
      r.map(v => {
        const s = String(v ?? '').replace(/"/g, '""');
        return /[,;"\n]/.test(s) ? `"${s}"` : s;
      }).join(';')
    ).join('\r\n');
    const blob2 = new Blob([csv2], { type: 'text/csv;charset=utf-8;' });
    const url2  = URL.createObjectURL(blob2);
    const a2    = document.createElement('a');
    a2.href     = url2;
    a2.download = 'aygun-admin-teklif-' + new Date().toLocaleDateString('tr-TR').replace(/\./g,'-') + '.csv';
    document.body.appendChild(a2); a2.click(); document.body.removeChild(a2); URL.revokeObjectURL(url2);
    return;
  }

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
  // Toast bildirimi
  const ct = document.getElementById('change-toast');
  if(ct) {
    const el = document.createElement('div'); el.className='toast-item';
    el.innerHTML='<span>📦</span><span style="flex:1">Sipariş notu eklendi: '+urunAdi+'</span><button class="toast-close" onclick="this.parentElement.remove()">×</button>';
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
  // Admin butonunda da badge göster
  const adminBtn = document.getElementById('btn-admin');
  if(adminBtn) {
    let dot = adminBtn.querySelector('.admin-btn-dot');
    if(bekleyen > 0) {
      if(!dot) {
        dot = document.createElement('span');
        dot.className = 'admin-btn-dot';
        dot.style.cssText = 'position:absolute;top:-3px;right:-3px;width:10px;height:10px;background:#e11d48;border-radius:50%;border:2px solid #fff';
        adminBtn.style.position = 'relative';
        adminBtn.appendChild(dot);
      }
      dot.style.display = 'block';
    } else if(dot) {
      dot.style.display = 'none';
    }
  }
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
  if(window._dataPollingTimer) { clearInterval(window._dataPollingTimer); window._dataPollingTimer=null; }
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
  resetProductStats, exportBasketToExcel, renderUyuyanStok, deleteProp, renderSepetDetay, clearUserProps, clearUserBasket, toggleStokPanel,
  openEditProp, addEditUrunRow, saveEditProp,
  openSiparisNot, siparisToggle, siparisDelete, clearSiparisNotlari,
  clearAllPendingProps, logoutUser, toggleChangeItem, toggleChangeItemRow, markAllChanges, confirmSection, printTeklif, togglePropGroup, setItemDisc, toggleCartDiscPanel,
  openMessages: ()=>{},   // kaldırıldı ama eski referanslar için
});
