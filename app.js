// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — app.js  (Rev 3.0 — Firebase Firestore)
//  Teklifler ve Satışlar artık Firebase'de — cihazlar arası senkron
// ═══════════════════════════════════════════════════════════════

// ─── FİREBASE BAŞLATMA ──────────────────────────────────────────
import { initializeApp }                           from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
import { getFirestore, collection, doc, deleteDoc,
         addDoc, setDoc, updateDoc, onSnapshot,
         query, orderBy, serverTimestamp,
         getDoc, getDocs }                         from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

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
window._liveBasketsUnsub = null;  // YENİ
window._liveBaskets = {};         // YENİ
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
if (adminOpen) {
  const activeTab = document.querySelector('.admin-tab.active')?.dataset?.tab;
  if (activeTab === 'overview')  renderAdminPanel();
  if (activeTab === 'sepetler')  renderSepetDetay();
  if (activeTab === 'personel')  renderAdminUsers();
}
updateProposalBadge(); // Admin paneli kapalı olsa bile badge güncel kalsın
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
updateSiparisBadge(); // Badge panelin açık olup olmadığından bağımsız güncel kalmalı
const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
if (adminOpen) {
  const activeTab = document.querySelector('.admin-tab.active')?.dataset?.tab;
  if (activeTab === 'siparis') renderSiparisPanel();
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

  // Sessions listener (admin eş zamanlı oturum izleme)
  _startSessionListener();

    // Sessions listener (admin eş zamanlı oturum izleme)
  _startSessionListener();

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

// ═══════════════════════════════════════════════════════════════
// ÖZEL DİYALOG SİSTEMİ — alert / confirm / prompt yerine
// Tarayıcının domain adını gösteren kaba diyaloglar kapatıldı.
// ayAlert(msg)          → Promise<void>
// ayConfirm(msg)        → Promise<boolean>
// ayPrompt(msg, defVal, existingNotes) → Promise<string|null>
// ═══════════════════════════════════════════════════════════════
(function() {
  // Animasyon CSS'i (bir kez eklenir)
  if(!document.getElementById('_ay-dlg-css')) {
    const st = document.createElement('style');
    st.id = '_ay-dlg-css';
    st.textContent = `
      @keyframes _ayFadeIn  { from{opacity:0}          to{opacity:1} }
      @keyframes _aySlideUp { from{transform:translateY(16px);opacity:0} to{transform:translateY(0);opacity:1} }
      #_ay-dlg-ov {
        position:fixed;inset:0;z-index:999999;
        background:rgba(28,28,30,.60);
        display:flex;align-items:center;justify-content:center;
        padding:16px;
        backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
        animation:_ayFadeIn .14s ease;
      }
      #_ay-dlg-box {
        background:#fff;border-radius:18px;
        padding:28px 24px 20px;max-width:360px;width:100%;
        box-shadow:0 24px 64px rgba(0,0,0,.22),0 0 0 1px rgba(0,0,0,.05);
        font-family:'DM Sans',system-ui,sans-serif;
        animation:_aySlideUp .18s cubic-bezier(.22,1,.36,1);
      }
      ._ay-icon { font-size:2rem;text-align:center;margin-bottom:10px; }
      ._ay-msg  { font-size:.90rem;color:#1C1C1E;line-height:1.55;text-align:center;font-weight:500;margin-bottom:18px;white-space:pre-wrap; }
      ._ay-notes {
        background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;
        padding:10px 12px;font-size:.75rem;color:#4c1d95;
        line-height:1.5;margin-bottom:14px;white-space:pre-wrap;max-height:120px;overflow-y:auto;
      }
      ._ay-input {
        width:100%;padding:11px 13px;border:1.5px solid #DDE1EA;
        border-radius:10px;font-family:inherit;font-size:.88rem;
        color:#1C1C1E;outline:none;resize:vertical;min-height:72px;
        box-sizing:border-box;margin-bottom:14px;transition:border-color .12s;
      }
      ._ay-input:focus { border-color:#D01F2E; }
      ._ay-btns { display:flex;gap:8px; }
      ._ay-btn  {
        flex:1;padding:12px;border:none;border-radius:11px;
        font-family:inherit;font-weight:700;font-size:.86rem;cursor:pointer;
        transition:filter .10s,transform .08s;
      }
      ._ay-btn:active { transform:scale(.95); }
      ._ay-btn-ok     { background:#1C1C1E;color:#fff; }
      ._ay-btn-ok:hover { filter:brightness(1.15); }
      ._ay-btn-danger { background:#D01F2E;color:#fff; }
      ._ay-btn-danger:hover { filter:brightness(1.12); }
      ._ay-btn-cancel { background:#F0F1F4;color:#52525B; }
      ._ay-btn-cancel:hover { filter:brightness(.95); }
    `;
    document.head.appendChild(st);
  }

  function _build(type, msg, defVal, existingNotes) {
    return new Promise(resolve => {
      // Önceki varsa kaldır
      document.getElementById('_ay-dlg-ov')?.remove();

      const ov = document.createElement('div');
      ov.id = '_ay-dlg-ov';

      const box = document.createElement('div');
      box.id = '_ay-dlg-box';

      // İkon
      const iconMap = { alert:'ℹ️', confirm:'⚠️', danger:'🗑️', prompt:'✏️' };
      const emo = document.createElement('div');
      emo.className = '_ay-icon';
      emo.textContent = iconMap[type] || 'ℹ️';
      box.appendChild(emo);

      // Mesaj
      const msgEl = document.createElement('div');
      msgEl.className = '_ay-msg';
      msgEl.textContent = msg;
      box.appendChild(msgEl);

      // Mevcut notlar (sadece prompt'ta)
      if(type === 'prompt' && existingNotes) {
        const notesEl = document.createElement('div');
        notesEl.className = '_ay-notes';
        notesEl.textContent = existingNotes;
        box.appendChild(notesEl);
      }

      // Input (sadece prompt)
      let input = null;
      if(type === 'prompt') {
        input = document.createElement('textarea');
        input.className = '_ay-input';
        input.value = defVal || '';
        input.placeholder = 'Buraya yazın…';
        box.appendChild(input);
      }

      // Butonlar
      const btns = document.createElement('div');
      btns.className = '_ay-btns';

      const close = val => { ov.remove(); resolve(val); };

      if(type === 'alert') {
        const ok = document.createElement('button');
        ok.className = '_ay-btn _ay-btn-ok';
        ok.textContent = 'Tamam';
        ok.onclick = () => close(true);
        btns.appendChild(ok);
      } else if(type === 'confirm' || type === 'danger') {
        const cancel = document.createElement('button');
        cancel.className = '_ay-btn _ay-btn-cancel';
        cancel.textContent = 'Vazgeç';
        cancel.onclick = () => close(false);
        const ok = document.createElement('button');
        ok.className = type === 'danger' ? '_ay-btn _ay-btn-danger' : '_ay-btn _ay-btn-ok';
        ok.textContent = type === 'danger' ? 'Sil' : 'Onayla';
        ok.onclick = () => close(true);
        btns.appendChild(cancel);
        btns.appendChild(ok);
      } else if(type === 'prompt') {
        const cancel = document.createElement('button');
        cancel.className = '_ay-btn _ay-btn-cancel';
        cancel.textContent = 'İptal';
        cancel.onclick = () => close(null);
        const ok = document.createElement('button');
        ok.className = '_ay-btn _ay-btn-ok';
        ok.textContent = 'Kaydet';
        ok.onclick = () => {
          const v = input.value.trim();
          close(v || null);
        };
        // Enter ile kaydet (Shift+Enter yeni satır)
        input.addEventListener('keydown', e => {
          if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ok.click(); }
        });
        btns.appendChild(cancel);
        btns.appendChild(ok);
      }

      box.appendChild(btns);
      ov.appendChild(box);
      document.body.appendChild(ov);

      // ESC ile kapat
      const esc = e => {
        if(e.key === 'Escape') {
          ov.remove();
          resolve(type === 'prompt' ? null : false);
          document.removeEventListener('keydown', esc);
        }
      };
      document.addEventListener('keydown', esc);

      // Overlay dışına tıklayınca kapat (sadece alert)
      if(type === 'alert') {
        ov.addEventListener('click', e => { if(e.target === ov) close(true); });
      }

      // Odaklan
      if(input) setTimeout(() => input.focus(), 60);
      else setTimeout(() => box.querySelector('._ay-btn-ok,._ay-btn-danger')?.focus(), 60);
    });
  }

  window.ayAlert   = msg              => _build('alert',   msg, '', '');
  window.ayConfirm = msg              => _build('confirm', msg, '', '');
  window.ayDanger  = msg              => _build('danger',  msg, '', '');
  window.ayPrompt  = (msg, def, notes)=> _build('prompt',  msg, def, notes||'');
})();


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

function updateProposalBadge() {
  const myProps = isAdmin() ? proposals : proposals.filter(p => p.user === (currentUser?.Email || ''));
  const waiting = myProps.filter(p => p.durum === 'bekliyor').length;
  const badge = document.getElementById('prop-badge');
  if (badge) {
    badge.style.display = waiting > 0 ? 'flex' : 'none';
    badge.textContent = waiting;
  }
}
// ─── TEKLİFİ WHATSAPP İLE YENİDEN GÖNDER ─────────────────────────
function resendProposalWa(id) {
  haptic(18);
  const p = proposals.find(pr => pr.id === id);
  if (!p) return;
  
  const exp = new Date();
  exp.setDate(exp.getDate() + 3);
  const expDay = String(exp.getDate()).padStart(2, '0');
  const expMonth = String(exp.getMonth() + 1).padStart(2, '0');
  const expYear = String(exp.getFullYear()).slice(-2);
  const expDate = expDay + '.' + expMonth + '.' + expYear;

  const urunList = (p.urunler || []).map(i => '  - ' + i.urun).join('\n');

  const pTotalItemDisc = (p.urunler || []).reduce((s, u) => s + (u.itemDisc || 0), 0);
  const pAltIndirim = p.indirim || 0;
  const pToplamIndirim = pTotalItemDisc + pAltIndirim;

  let indirimMetni = '';
  if (pToplamIndirim > 0) {
    indirimMetni = '\n_İndirimler -' + fmt(pToplamIndirim) + '_';
  }

  const ab = p.abakus;
  let odemeBlok;
  if (ab && ab.taksit > 1) {
    const aylik = ab.aylik ? ab.aylik : Math.ceil((ab.tahsilat || p.nakit || 0) / ab.taksit);
    odemeBlok = '* `' + ab.kart + '`\n*' + fmt(aylik) + '* x ' + ab.taksit + ' Taksit\n*Toplam* ' + fmt(ab.tahsilat || p.nakit || 0);
  } else if (ab && ab.taksit === 1) {
    odemeBlok = '* `' + (ab.kart || p.odeme || 'Tek Çekim') + '`\n*' + fmt(ab.tahsilat || p.nakit || 0) + '* Tek Çekim';
  } else {
    odemeBlok = '* `Nakit`\n*Toplam* ' + fmt(p.nakit || 0);
  }

  const kapanisStr = '> Teklifimize konu ürünlerin fiyatlarını değerlendirmelerinize sunar, ihtiyaç duyacağınız her konuda memnuniyetle destek vermeye hazır olduğumuzu belirtir; çalışmalarınızda kolaylıklar dileriz. Teklif geçerlilik *' + expDate + '* tarihidir.';
  const msg = 'Aygün AVM Teklif'
    + '\n*Sn* ' + p.custName
    + '\n*Telefon* ' + p.phone
    + '\n\n`Ürünler`\n' + urunList
    + indirimMetni
    + '\n\n' + odemeBlok
    + (p.not ? '\n\n*Not* ' + p.not : '')
    + '\n\n' + kapanisStr
    + '\n*Saygılarımızla,* ' + (currentUser?.Ad || currentUser?.Email?.split('@')[0] || '');

  window.open('https://wa.me/9' + p.phone + '?text=' + encodeURIComponent(msg), '_blank');
}

async function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-content').style.display = 'block';
  const ab = document.getElementById('admin-btn');
  if (ab) ab.style.display = isAdmin() ? 'flex' : 'none';
  const lb = document.getElementById('logout-btn');
  if (lb) lb.style.display = isAdmin() ? 'none' : 'flex';
  updateProposalBadge();
  startFirebaseListeners();
  startDataPolling();
  _initStockFilterBtn();

  const searchEl = document.getElementById('search');
  if (searchEl) {
    const ad = currentUser?.Ad || currentUser?.Email?.split('@')[0] || '';
    searchEl.placeholder = ad ? 'Mart Yıldızı, ' + ad + ' — Ürün arama' : 'Ürün arama';
  }

  await fixMissingArchivedAt();
}

function startDataPolling() {
  if (window._dataPollingTimer) clearInterval(window._dataPollingTimer);
  window._dataPollingTimer = setInterval(async () => {
    if (!currentUser) return;
    try {
      const url = dataUrl('urunler.json') + '?poll=' + Date.now();
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) return;
      const json = await resp.json();
      const newV = json.metadata?.v;
      const email = currentUser?.Email || 'guest';
      const seen = JSON.parse(localStorage.getItem(CHANGE_SEEN_KEY + email) || '[]');
      if (newV && !seen.includes(newV)) {
        allProducts = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : allProducts);
        window._cachedUrunler = allProducts;
        await new Promise(r => setTimeout(r, 500));
        checkChanges(json);
        filterData();
      }
    } catch (e) { /* polling hatası sessizce geç */ }
  }, 10 * 60 * 1000);
}

function safeJSON(text) {
  const cleaned = text
    .replace(/^﻿/, '')
    .trim()
    .replace(/:\s*True/g, ': true')
    .replace(/:\s*False/g, ': false')
    .replace(/:\s*None/g, ': null');
  return JSON.parse(cleaned);
}

// Eksik archivedAt alanı olan eski teklifleri düzelt (localStorage + Firebase)
async function fixMissingArchivedAt() {
  let changed = false;
  const updates = [];

  proposals.forEach(p => {
    if ((p.durum === 'iptal' || p.durum === 'satisDondu' || p.durum === 'sureDoldu') && !p.archivedAt) {
      p.archivedAt = p.ts || new Date().toISOString();
      changed = true;
      updates.push(fbUpdateProp(p.id, { archivedAt: p.archivedAt }));
    }
  });

  if (changed) {
    localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
    await Promise.all(updates);
    console.log('Eski tekliflere archivedAt eklendi ve Firebase senkronize edildi.');
  }
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
  err.style.display = 'none';
  await _checkAndRegisterSession(user.Email, user.Rol);
  await showApp();   // ⬅️ await eklendi
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
    // Tablo başlığındaki "+" yerine "Ekle" yaz
    const thPlus = document.querySelector('#product-table thead th:first-child');
    if(thPlus && thPlus.textContent.trim()=='+') {
      thPlus.textContent = 'Ekle';
      thPlus.style.cssText = 'font-size:.62rem;letter-spacing:.04em;font-weight:800;text-transform:uppercase;';
    }
  } catch(e) { console.error('urunler:',e); ayAlert('Ürün listesi yüklenemedi.\nURL: '+urunUrl+'\nHata: '+e.message); }

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

  // Tüm ürünleri filtrele
  let data = allProducts.filter(u => {
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

    // Prim sütunu
    const primKey = keys.find(k=>norm(k)==='prim')||'';
    const primVal = primKey ? parseFloat(u[primKey]) : NaN;
    const hasPrim = !isNaN(primVal) && primVal > 0;

    // ── Stok sınıfı ─────────────────────────────────────────────
    let stokCls = '';
    if (stok === 0) stokCls = 'stok-0';
    else if (stok <= 3) stokCls = 'stok-az';
    else if (stok <= 10) stokCls = 'stok-orta';
    else stokCls = 'stok-bol';

    // ── Prim seviyesi sınıfı ───────────────────────────────────
    let primCls = '';
    let primLabel = '';
    if (hasPrim) {
      // Prim rakamını formatla (K birimi)
      if (primVal >= 1000) {
        primLabel = (primVal / 1000).toFixed(primVal % 1000 === 0 ? 0 : 1) + 'K';
      } else {
        primLabel = Math.round(primVal).toString();
      }
      
      // Prim seviyesine göre sınıf (veri dağılımına göre)
      if (primVal >= 1000) primCls = 'prim-high';      // Süper prim (5 ürün)
      else if (primVal >= 250) primCls = 'prim-mid';   // Orta prim (~50 ürün)
      else primCls = 'prim-low';                       // Düşük prim (~300 ürün)
    }

    // Buton tıklama fonksiyonu
    const btnClick = hasPrim
      ? 'addToBasketPrim(' + oi + ')'
      : 'addToBasket(' + oi + ')';

    const btnTitle = hasPrim
      ? primLabel + ' Puan kazan!'
      : 'Sepete ekle';

    // ── BUTON HTML (sadece prim rakamı) ────────────────────────
    let btnHtml = '';
    if (hasPrim) {
      btnHtml = '<button class="add-btn-modern haptic-btn ' + stokCls + ' ' + primCls + '" onclick="' + btnClick + '" title="' + btnTitle + '">' +
          '<span class="prim-hint">' + primLabel + '</span>' +
        '</button>';
    } else {
      // Prim olmayan ürünlerde küçük sepete ekle butonu
      btnHtml = '<button class="add-btn-modern haptic-btn ' + stokCls + '" onclick="' + btnClick + '" title="Sepete ekle" style="background:linear-gradient(145deg, #475569, #334155);">' +
          '<span class="prim-hint" style="font-size:.68rem;">🛒</span>' +
        '</button>';
    }

    // Tablo satırını oluştur (| ayraçları kaldırıldı)
    const tr = document.createElement('tr');
    tr.innerHTML = 
      '<td class="td-add-cell">' + btnHtml + '</td>' +
      '<td><span class="product-name">' + (u[urunKey]||'') + '</span>' + (u[descKey]?'<span class="product-desc">'+u[descKey]+'</span>':'') + '</td>' +
      '<td class="' + sc + '">' + stok + '</td>' +
      '<td class="td-price">' + fmt(u[kartKey]) + '</td>' +
      '<td class="td-price">' + fmt(u['4T AWM']) + '</td>' +
      '<td class="td-price">' + fmt(u[cekKey]) + '</td>' +
      '<td class="td-price">' + fmt(u.Nakit) + '</td>' +
      '<td style="font-size:.67rem;color:var(--text-3)">' + (u.Kod||'') + '</td>' +
      '<td class="td-gam">' + (u[gamKey]||'-') + '</td>' +
      '<td class="td-marka">' + (u.Marka||'-') + '</td>' +
      '<td class="td-etiket">' + (u['Etiket Fiyatı']?fmt(u['Etiket Fiyatı']):'-') + '</td>' +
      '<td><button class="siparis-btn haptic-btn" onclick="openSiparisNotSafe(' + oi + ')" title="Siparis Notu Ekle">📦</button></td>';
    frag.appendChild(tr);
  });
  list.appendChild(frag);
}

function toggleZeroStock() {
  showZeroStock=!showZeroStock;
  const btn=document.getElementById('stock-filter-btn');
  if(btn) {
    btn.classList.toggle('active', showZeroStock);
    btn.title = showZeroStock ? 'Stok sıfır gösteriliyor (tıkla: gizle)' : 'Stok sıfır gizli (tıkla: göster)';
    btn.innerHTML = showZeroStock
      ? '<span style="position:relative">📦<span style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;background:#22c55e;border-radius:50%;border:2px solid #fff"></span></span>'
      : '<span style="position:relative">📦<span style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;background:#ef4444;border-radius:50%;border:2px solid #fff"></span></span>';
  }
  filterData();
}

// Stok filtre butonu ilk yükleme görünümünü ayarla
function _initStockFilterBtn() {
  const btn = document.getElementById('stock-filter-btn');
  if(!btn) return;
  btn.title = 'Stok sıfır gizli (tıkla: göster)';
  btn.innerHTML = '<span style="position:relative">📦<span style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;background:#ef4444;border-radius:50%;border:2px solid #fff"></span></span>';
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

function yuvarlaKademe(brut, nTaksit) {
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
  const p = allProducts[idx];
  
  // YENİ: Sepet boşsa yeni bir "doldurma" oturumu başlat
  if (basket.length === 0) {
    logAnalytics('basketSession');
  }
  
  const keys = Object.keys(p);
  const urunKey = keys.find(k => norm(k) === 'urun') || '';
  const kartKey = keys.find(k => k.includes('Kart')) || '';
  const cekKey = keys.find(k => k.includes('ekim')) || '';
  const descKey = keys.find(k => norm(k) === 'aciklama') || '';
  
  basket.push({
    urun: p[urunKey] || '',
    stok: Number(p.Stok) || 0,
    dk: parseFloat(p[kartKey]) || 0,
    awm: parseFloat(p['4T AWM']) || 0,
    tek: parseFloat(p[cekKey]) || 0,
    nakit: parseFloat(p.Nakit) || 0,
    aciklama: p[descKey] || '-',
    kod: p.Kod || ''
  });
  
  logAnalytics('addToBasket', p[urunKey] || '');
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
// Prim butonundan sepete ekle — addToBasket ile aynı ama animasyonla
function addToBasketPrim(idx) {
  addToBasket(idx);
  // Prim kutucuğuna para efekti
  const p = allProducts[idx];
  const keys = Object.keys(p);
  const primKey = keys.find(k=>(k+'').toLowerCase()==='prim')||'';
  const primVal = primKey ? parseFloat(p[primKey]) : NaN;
  if(!isNaN(primVal) && primVal > 0) _showPrimAnimation(primVal);
}

// Para efekti animasyonu — premium tasarım
function _showPrimAnimation(primVal) {
  const el = document.createElement('div');
  el.className = 'prim-fly';
  const pLbl = primVal>=1000 ? (primVal/1000).toFixed(primVal%1000===0?0:1)+'K' : String(Math.round(primVal));
  el.innerHTML = '<span style="font-size:1.2rem;">✨</span> +' + pLbl + ' <span style="font-weight:600;">Puan</span> <span style="font-size:1.2rem;">🪙</span>';
  el.style.cssText = 'position:fixed;top:52%;left:50%;z-index:99999;pointer-events:none;' +
    'display:flex;align-items:center;gap:12px;' +
    'background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);' +
    'color:#fbbf24;font-weight:900;font-size:1.3rem;' +
    'padding:14px 28px;border-radius:40px;' +
    'border:1px solid rgba(251,191,36,.5);' +
    'box-shadow:0 8px 32px rgba(0,0,0,.4),0 0 0 1px rgba(255,215,0,.2) inset,0 0 24px rgba(251,191,36,.3);' +
    'letter-spacing:-.01em;' +
    'animation:primFlyUp 1s cubic-bezier(.22,1,.36,1) forwards;' +
    'backdrop-filter:blur(2px);';
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 1000);
}

// Siparis notu — index üzerinden çağır (tırnak sorunu olmaz)
async function openSiparisNotSafe(idx) {
  const p = allProducts[idx];
  if(!p) return;
  const keys = Object.keys(p);
  const urunKey = keys.find(k=>(k+'').toLowerCase().replace(/[^a-z]/g,'')==='urun')||'';
  openSiparisNot(p[urunKey]||p.Kod||'Ürün '+idx, idx);
}

function saveBasket() {
  localStorage.setItem('aygun_basket', JSON.stringify(basket));
  updateCartUI();
  // Firebase'e basket snapshot yaz — analytics koleksiyonunu kirletmemek için ayrı koleksiyon
  if(currentUser && _db) {
    const email = currentUser.Email;
    const today = new Date().toISOString().split('T')[0];
    const snap  = basket.map(i => ({urun: i.urun, nakit: i.nakit, stok: i.stok}));
    const docId = email.replace(/[^a-zA-Z0-9]/g, '_') + '_' + today;
    setDoc(doc(_db, 'basket_snapshots', docId), {
      email, date: today, basketSnapshot: snap, basketTs: new Date().toISOString()
    }, {merge: true}).catch(() => {});
  }
}
function removeFromBasket(i) { haptic(12); basket.splice(i,1); saveBasket(); }
async function clearBasket() {
  haptic(30); if(!(await ayDanger('Sepeti temizle?'))) return;
  basket=[]; discountAmount=0;
  const di=document.getElementById('discount-input'); if(di) di.value='';
  saveBasket();
  // live_baskets'ten de sil (admin sepetler panelinde görünmesin)
  if(currentUser && _db) {
    deleteDoc(doc(_db, 'live_baskets', currentUser.Email)).catch(()=>{});
  }
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
async function openAbakus() {
  haptic(18);
  if (!basket.length) {
    await ayAlert('Önce sepete ürün ekleyin!');
    return;
  }
  abakusSelection = null; // null = Nakit seçili
  const m = document.getElementById('abakus-modal');
  m.style.display = 'flex';
  m.classList.add('open');
  buildAbakusKartlar();
  calcAbakus();
}

function closeAbakus() {
  const m = document.getElementById('abakus-modal');
  m.classList.remove('open');
  m.style.display = 'none';
}

function buildAbakusKartlar() {
  if (!allRates.length) return;
  const kartlar = [];
  allRates.forEach(r => {
    if (r.Kart && !kartlar.includes(r.Kart)) kartlar.push(r.Kart);
  });
  const ks = document.getElementById('ab-kart');
  if (!ks) return;
  ks.innerHTML = kartlar.map(k => `<option value="${k}">${k}</option>`).join('');
}

function calcAbakus() {
  abakusSelection = null; // sıfırla
  // Aksiyon panelini gizle
  const actDiv = document.getElementById('ab-actions');
  if (actDiv) actDiv.style.display = 'none';
  const waBtn = document.getElementById('ab-wa-btn');
  if (waBtn) waBtn.style.display = 'none';

  const t = basketTotals();
  const totalItemDisc = basket.reduce((s, i) => s + (i.itemDisc || 0), 0);
  let nakit = t.nakit - totalItemDisc - getDisc(t.nakit - totalItemDisc);
  const manEl = document.getElementById('ab-nakit');
  if (manEl && manEl.value !== '') {
    const mn = parseFloat(manEl.value.replace(',', '.'));
    if (!isNaN(mn) && mn > 0) nakit = mn;
  }

  const ks = document.getElementById('ab-kart');
  if (!ks) return;
  const secKart = ks.value;
  const maxT = KART_MAX_TAKSIT[secKart] || 9;
  const zRows = allRates.filter(r => r.Kart === secKart);
  const resEl = document.getElementById('ab-result');
  if (!resEl) return;

  if (!zRows.length) {
    resEl.innerHTML = '<div class="ab-no-data">Bu kart için oran bulunamadı.</div>';
    return;
  }

  const TAK = [
    { label: 'Tek Çekim', n: 1, key: 'Tek', oncelik: 9 },
    { label: '2 Taksit', n: 2, key: '2Taksit', oncelik: 8 },
    { label: '3 Taksit', n: 3, key: '3Taksit', oncelik: 7 },
    { label: '4 Taksit', n: 4, key: '4Taksit', oncelik: 1 },
    { label: '5 Taksit', n: 5, key: '5Taksit', oncelik: 2 },
    { label: '6 Taksit', n: 6, key: '6Taksit', oncelik: 3 },
    { label: '7 Taksit', n: 7, key: '7Taksit', oncelik: 4 },
    { label: '8 Taksit', n: 8, key: '8Taksit', oncelik: 5 },
    { label: '9 Taksit', n: 9, key: '9Taksit', oncelik: 6 }
  ];

  const enKarliMap = {};
  zRows.forEach(satir => {
    TAK.forEach(td => {
      if (td.n > maxT) return;
      const oran = parseFloat(satir[td.key]);
      if (isNaN(oran) || oran <= 0) return;
      const tahsilat = yuvarlaKademe(nakit / (1 - oran / 100), td.n);
const aylik = td.n === 1 ? tahsilat : Math.ceil(tahsilat / td.n);
if (!enKarliMap[td.n] || oran < enKarliMap[td.n].oran) {
  enKarliMap[td.n] = {
    label: td.label,
    taksit: td.n,
    oncelik: td.oncelik,
    kart: satir.Kart,
    zincir: satir.Zincir,
    oran,
    tahsilat,
    aylik,
    karli: oran < KOMISYON_ESIGI,
    aciklama: satir.Aciklama ? String(satir.Aciklama) : ''   // ⬅️ YENİ (güvenli string)
  };
}
    });
  });

  const liste = Object.values(enKarliMap).sort((a, b) => a.oncelik - b.oncelik);
  if (!liste.length) {
    resEl.innerHTML = '<div class="ab-no-data">Hesaplanacak oran bulunamadı.</div>';
    return;
  }

  const mutlakEnKarli = liste.slice().sort((a, b) => a.oran - b.oran)[0];
  let html = '';
  html += `<div class="ab-nakit-row"><span>Baz Nakit</span><strong>${fmt(nakit)}</strong><span class="ab-kart-badge">${secKart} · max ${maxT}T</span></div>`;

  html += `<div class="ab-table-wrap">
    <table class="ab-table">
      <thead>
        <tr>
          <th>Taksit</th>
          <th>Zincir POS</th>
          <th>Aylık Taksit</th>
          <th>Toplam Tahsilat</th>
          <th></th>
        </tr>
      </thead>
      <tbody>`;

  html += `<tr class="ab-row-nakit ab-row-sel" id="ab-row-nakit-tr" onclick="selectAbakusRow(this)">
      <td><strong>💵 Nakit</strong></td>
      <td class="ab-zincir-cell">—</td>
      <td class="ab-mono">—</td>
      <td class="ab-mono ab-tahsilat-cell">${fmt(nakit)}</td>
      <td class="ab-badge-cell"><span class="ab-badge-nakit">NAKİT</span></td>
    </tr>`;

  liste.forEach(s => {
    const isEK = s === mutlakEnKarli;
    const rowCls = isEK ? 'ab-row-best ab-row-sel' : (s.karli ? 'ab-row-good ab-row-sel' : 'ab-row-sel');
    const vurgu = s.taksit >= 4 ? '<span class="ab-taksit-dot"></span>' : '';
    const badge = isEK ? '<span class="ab-badge-best">★ EN KARLI</span>' : (s.karli ? '<span class="ab-badge-good">✓ UYGUN</span>' : '');
    html += `<tr class="${rowCls}" onclick="selectAbakusRow(this)">
        <td><strong>${s.label}</strong>${vurgu}</td>
        <td class="ab-zincir-cell">${s.zincir}</td>
        <td class="ab-mono">${fmt(s.aylik)}</td>
        <td class="ab-mono ab-tahsilat-cell">${fmt(s.tahsilat)}</td>
        <td class="ab-badge-cell">${badge}</td>
      </tr>`;
  });

  html += `</tbody></table></div>`;

  // Zincir detayları
  html += `<details class="ab-all-zincir"><summary class="ab-all-zincir-summary">Tüm Zincir Detayları</summary><div class="ab-zincir-grid">`;
  zRows.forEach(satir => {
    html += `<div class="ab-zincir-card"><div class="ab-zincir-card-title">${satir.Zincir}</div><table class="ab-table ab-table-sm"><tbody>`;
    TAK.forEach(td => {
      if (td.n > maxT) return;
      const oran = parseFloat(satir[td.key]);
      if (isNaN(oran) || oran <= 0) return;
      const tahsilat = yuvarlaKademe(nakit / (1 - oran / 100), td.n);
      const aylik = td.n === 1 ? tahsilat : Math.ceil(tahsilat / td.n);
      const karli = oran < KOMISYON_ESIGI;
      html += `<tr class="${karli ? 'ab-row-good' : ''}"><td>${td.label}</td><td class="ab-mono">${fmt(aylik)}</td><td class="ab-mono">${fmt(tahsilat)}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  });
  html += `</div></details>`;
  resEl.innerHTML = html;

  // data-abrow attribute'larını DOM'a yaz (innerHTML set edildikten sonra)
  const nakitRow = resEl.querySelector('#ab-row-nakit-tr');
  if (nakitRow) nakitRow.dataset.abrow = JSON.stringify({ type: 'nakit', nakit });
  const allRows = resEl.querySelectorAll('tr.ab-row-sel:not(#ab-row-nakit-tr)');
  let li = 0;
  allRows.forEach(tr => {
    if (li < liste.length) {
      tr.dataset.abrow = JSON.stringify(liste[li]);
      li++;
    }
  });
}

function selectAbakusRow(rowEl) {
  haptic(14);
  document.querySelectorAll('.ab-row-selected').forEach(r => r.classList.remove('ab-row-selected'));
  rowEl.classList.add('ab-row-selected');
  try {
    const raw = rowEl.dataset.abrow || '{}';
    const parsed = JSON.parse(raw);
    abakusSelection = (parsed.type === 'nakit') ? null : parsed;

    // ─── Bilgi kutusu gösterimi ─────────────────────────────────
    const bilgiKutusu = document.getElementById('kart-bilgi-kutusu');
    if (bilgiKutusu) {
      if (window._infoTimeout) clearTimeout(window._infoTimeout);
      bilgiKutusu.style.display = 'none';
      bilgiKutusu.innerHTML = '';

      if (parsed.aciklama && typeof parsed.aciklama === 'string' && parsed.aciklama.trim() !== '') {
        bilgiKutusu.innerHTML = `<span>💡</span> <span>${parsed.aciklama}</span>`;
        bilgiKutusu.style.display = 'flex';
        window._infoTimeout = setTimeout(() => {
          bilgiKutusu.style.display = 'none';
        }, 10000);
      }
    }
    // ─── Bitiş ───────────────────────────────────────────────────
  } catch (e) {
    console.error('selectAbakusRow:', e);
    return;
  }

  // Aksiyon panelini göster
  const actDiv = document.getElementById('ab-actions');
  const infoDiv = document.getElementById('ab-selection-info');
  if (actDiv) {
    actDiv.style.display = 'block';
    if (infoDiv) {
      if (abakusSelection === null) {
        const t = basketTotals();
        let nakit = t.nakit - getDisc(t.nakit);
        const manEl = document.getElementById('ab-nakit');
        if (manEl && manEl.value !== '') {
          const mn = parseFloat(manEl.value.replace(',', '.'));
          if (!isNaN(mn) && mn > 0) nakit = mn;
        }
        infoDiv.innerHTML = `<span class="ab-sel-chip ab-sel-nakit">💵 Nakit — ${fmt(nakit)}</span>`;
      } else {
        infoDiv.innerHTML = `<span class="ab-sel-chip">${abakusSelection.label}</span><span class="ab-sel-chip">${abakusSelection.zincir} POS</span><span class="ab-sel-chip ab-sel-tahsilat">${fmt(abakusSelection.tahsilat)}</span><span class="ab-sel-chip ab-sel-aylik">Aylık ${fmt(abakusSelection.aylik)}</span>`;
      }
    }
  }
  // Eski wa-btn uyumluluğu
  const waBtn = document.getElementById('ab-wa-btn');
  if (waBtn) waBtn.style.display = 'none';
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

async function finalizeAksiyon() {
  haptic(22);
  if (!basket.length) {
    await ayAlert('Sepet boş!');
    return;
  }

  const custName = (document.getElementById('cust-name')?.value || '').trim() || '-';
  const phone = (document.getElementById('cust-phone')?.value || '').trim();
  const extraNote = (document.getElementById('extra-info')?.value || '').trim();
  const t = basketTotals();

  // Satır indirimleri toplamı (ürün bazlı indirimler)
  const totalItemDisc = basket.reduce((s, i) => s + (i.itemDisc || 0), 0);

  // Nakit fiyat (indirimsiz)
  const nakitFiyat = t.nakit;

  // Toplam indirim (satır indirimleri + alt indirim)
  const altIndirim = discountType === 'TRY' ? discountAmount : (nakitFiyat - totalItemDisc) * discountAmount / 100;
  const toplamIndirim = totalItemDisc + altIndirim;

  // İndirim uygulanmış nakit fiyat
  const indirimliNakit = nakitFiyat - toplamIndirim;

  // Ödeme metni ve tahsilat tutarı
  let od = '',
    odText = '',
    tahsilat = indirimliNakit;

  if (abakusSelection) {
    // Kartlı ödeme: NAKİT FİYAT (indirimsiz) üzerinden taksit hesaplanır
    const kartNakit = nakitFiyat; // indirimsiz nakit fiyat
    const abOran = abakusSelection.oran / 100;
    const brut = kartNakit / (1 - abOran);
    const yuvarlanmis = yuvarlaKademe(brut, abakusSelection.taksit);
    tahsilat = yuvarlanmis;

    const taksitSayisi = abakusSelection.taksit;
    const aylikTutar = taksitSayisi === 1 ? tahsilat : Math.ceil(tahsilat / taksitSayisi);

    od = abakusSelection.label + ' (' + abakusSelection.zincir + ' POS): ' + fmt(tahsilat) + '\nAylık taksit: ' + fmt(aylikTutar);
    odText = abakusSelection.label + ' / ' + abakusSelection.zincir + ' POS — ' + fmt(tahsilat);
  } else {
    // Nakit ödeme: indirimli fiyat
    od = 'Nakit: ' + fmt(indirimliNakit) + ' (İndirim: -' + fmt(toplamIndirim) + ')';
    odText = 'Nakit — ' + fmt(indirimliNakit);
  }

  // ── WA MODU ──────────────────────────────────────────────────
  if (_aksiyonMode === 'wa') {
    if (!phone || phone.length !== 11 || phone[0] !== '0') {
      await ayAlert('WhatsApp için 0 ile başlayan 11 haneli telefon giriniz.');
      haptic(80);
      return;
    }

    const sureBitisInputWa = document.getElementById('teklif-sure-bitis');
    let expDateObj = sureBitisInputWa?.value
      ? new Date(sureBitisInputWa.value)
      : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const expDate = String(expDateObj.getDate()).padStart(2, '0') + '.' +
      String(expDateObj.getMonth() + 1).padStart(2, '0') + '.' +
      String(expDateObj.getFullYear()).slice(-2);

    // WA Mesajı oluştur
    let waMsg = `Aygün AVM Teklif\n\n`;
    waMsg += `*Sn* ${custName}\n`;
    waMsg += `*Telefon* ${phone}\n\n`;
    waMsg += `Ürünler\n`;
    basket.forEach(i => { waMsg += `  - ${i.urun}\n`; });

    let indirimMetni = '';
    if (toplamIndirim > 0) {
      indirimMetni = `\n_İndirimler -${fmt(toplamIndirim)} ₺_\n\n`;
    } else {
      indirimMetni = `\n\n`;
    }
    waMsg += indirimMetni;

    // Ödeme tipine göre dinamik kısım
    if (abakusSelection === null) {
      waMsg += `* Nakit\n`;
      waMsg += `*Toplam* ${fmt(indirimliNakit)}\n\n`;
    } else if (abakusSelection.taksit === 1) {
      const kartAdi = abakusSelection.kart || abakusSelection.label || '';
      waMsg += `* ${kartAdi}\n`;
      wwaMsg += `*${fmt(tahsilat)}* Tek Çekim\n\n`;
    } else {
      const kartAdi = abakusSelection.kart || abakusSelection.label || '';
      const taksitSayisi = abakusSelection.taksit;
      const aylikTutar = Math.ceil(tahsilat / taksitSayisi);
      waMsg += `* ${kartAdi}\n`;
      waMsg += `*${fmt(aylikTutar)}* x ${taksitSayisi} Taksit\n`;
      waMsg += `*Toplam* ${fmt(tahsilat)}\n\n`;
    }

    // Kapanış
    waMsg += `> Teklifimize konu ürünlerin fiyatlarını değerlendirmelerinize sunar, ihtiyaç duyacağınız her konuda memnuniyetle destek vermeye hazır olduğumuzu belirtir; çalışmalarınızda kolaylıklar dileriz. Teklif geçerlilik *${expDate}* tarihidir.\n\n`;
    waMsg += `*Saygılarımızla,* ${currentUser?.Ad || currentUser?.Email?.split('@')[0] || 'fatih'}`;

    const wpLink = `https://wa.me/9${phone}?text=${encodeURIComponent(waMsg)}`;
    window.open(wpLink, '_blank');

    const sureBitisElWa = document.getElementById('teklif-sure-bitis');
    const sureBitisWa = sureBitisElWa?.value ? new Date(sureBitisElWa.value).toISOString() : null;
    const gizlilikElWa = document.querySelector('input[name="teklif-gizlilik"]:checked');
    _kaydetTeklif(custName, phone, odText, tahsilat, extraNote, sureBitisWa, gizlilikElWa?.value || 'acik');
    closeWaModal();
    _clearAksiyonForm();
    abakusSelection = null;
    return;
  }

  // ── TEKLİF MODU (SADECE KAYIT) ────────────────────────────────
  if (_aksiyonMode === 'teklif') {
    const sureBitisEl = document.getElementById('teklif-sure-bitis');
    let expDateObj = sureBitisEl?.value
      ? new Date(sureBitisEl.value)
      : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const sureBitis = expDateObj.toISOString();
    const gizlilikEl = document.querySelector('input[name="teklif-gizlilik"]:checked');
    const gizlilik = gizlilikEl?.value || 'acik';

    _kaydetTeklif(custName, phone, odText, tahsilat, extraNote, sureBitis, gizlilik);
    closeWaModal();
    _clearAksiyonForm();
    abakusSelection = null;
    return;
  }

  // ── SATIŞ BELGESİ MODU ──────────────────────────────────────
  if (_aksiyonMode === 'satis') {
    if (!custName || custName === '-') {
      await ayAlert('Müşteri adı zorunludur.');
      haptic(80);
      return;
    }
    if (!phone || phone.length !== 11 || phone[0] !== '0') {
      await ayAlert('Geçerli telefon giriniz.');
      haptic(80);
      return;
    }
    const tc = (document.getElementById('cust-tc')?.value || '').trim();
    const email = (document.getElementById('cust-email')?.value || '').trim();
    const address = (document.getElementById('cust-address')?.value || '').trim();
    const phone2 = (document.getElementById('cust-phone2')?.value || '').trim();

    const saleNo = 'SAT-' + uid().toUpperCase().slice(0, 8);

    let odemeTipi = 'nakit',
      kartAdi = '',
      taksitSayisi = 0,
      aylikTaksit = 0,
      toplamKartOdeme = tahsilat;
    if (abakusSelection) {
      kartAdi = abakusSelection.kart || abakusSelection.label || '';
      taksitSayisi = abakusSelection.taksit || 1;
      toplamKartOdeme = abakusSelection.tahsilat || tahsilat;
      aylikTaksit = abakusSelection.aylik || (taksitSayisi > 1 ? Math.ceil(toplamKartOdeme / taksitSayisi) : toplamKartOdeme);
      odemeTipi = taksitSayisi <= 1 ? 'tek_cekim' : 'taksit';
    }

    const pdfData = {
      belgeNo: saleNo,
      tarih: new Date().toLocaleDateString('tr-TR'),
      musteriIsim: custName,
      telefon: phone,
      musteriTc: tc,
      musteriAdres: address,
      satici: (currentUser?.Email || '').split('@')[0] || (currentUser?.Ad || ''),
      not: extraNote,
      odemeTipi,
      kartAdi,
      taksitSayisi,
      aylikTaksit,
      toplamOdeme: odemeTipi === 'nakit' ? tahsilat : toplamKartOdeme,
      toplamIndirim,
      urunler: basket.map(i => ({ ...i }))
    };

    const html = buildPremiumPDF('SATIŞ SÖZLEŞMESİ', pdfData);
    _openPdfWindow(html);

    const saleRecord = {
      id: saleNo,
      ts: new Date().toISOString(),
      custName,
      custTC: tc,
      custPhone: phone,
      custPhone2: phone2,
      custEmail: email,
      address,
      method: odText,
      urunler: basket.map(i => ({ ...i })),
      nakit: tahsilat,
      indirim: discountAmount,
      user: currentUser?.Email || '-',
      tip: 'satis'
    };
    sales.unshift(saleRecord);
    localStorage.setItem('aygun_sales', JSON.stringify(sales));
    logAnalytics('sale', custName);

    closeWaModal();
    _clearAksiyonForm();
    abakusSelection = null;
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
  // 7 günden eski kapatılmış teklifleri arşive taşı
  const archiveCutoff = new Date(); archiveCutoff.setDate(archiveCutoff.getDate()-7);
  const isArchived = p => p.archivedAt && new Date(p.archivedAt) < archiveCutoff;

  let myProps = isAdmin()
    ? proposals.filter(p => !isArchived(p))          // admin: arşiv hariç tümü
    : proposals.filter(p =>
        !isArchived(p) &&
        (p.user === (currentUser?.Email||'') ||
         p.gizlilik === 'acik' ||
         !p.gizlilik)
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
  // Kapatılan tekliflere arşiv tarihi ekle (7 gün sonra arşive kalkacak)
  if(durum==='iptal'||durum==='satisDondu'||durum==='sureDoldu') {
    proposals[idx].archivedAt = new Date().toISOString();
  } else {
    delete proposals[idx].archivedAt;
  }
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  renderProposals();
  const adminList=document.getElementById('admin-proposals-list');
  if(adminList) renderProposals(adminList, true);
  fbUpdateProp(proposals[idx].id, {
    durum,
    archivedAt: proposals[idx].archivedAt || null
  });
}

async function deleteProp(id) {
  if(!isAdmin()) return;
  if(!(await ayDanger('Bu teklif kalıcı olarak silinsin mi?'))) return;
  haptic(30);
  const idx = proposals.findIndex(p=>p.id===id);
  if(idx===-1) return;
  proposals.splice(idx, 1);
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  renderProposals();
  const adminList=document.getElementById('admin-proposals-list');
  if(adminList) renderProposals(adminList, true);
  // Firestore'dan kalıcı sil
  try {
    await deleteDoc(doc(_db, 'proposals', id));
  } catch(e) { console.warn('FB delete:', e); }
  updateProposalBadge();
}

// ─── TEKLİFE NOT EKLE (sadece admin) ────────────────────────────
async function openPropNote(id) {
  haptic(14);
  const p = proposals.find(pr=>pr.id===id); if(!p) return;
  const existingNotes = (p.adminNot||[]).map(n=>
    `• ${fmtDate(n.ts)} [${n.who.split('@')[0]}]: ${n.text}`
  ).join('\n');
  const text = await ayPrompt('Not ekle:', '', existingNotes || '');
  if(!text || !text.trim()) return;
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
  toast.innerHTML = '📌 <strong>Yeni not eklendi:</strong> <span style="opacity:.9">' + custName + '</span><br><span style="opacity:.7;font-size:.68rem">' + noteText.slice(0,60) + (noteText.length>60?'…':'') + '</span>';
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-20px)';
  }, 3500);
}
// ─── PDF TEKLİF ─────────────────────────────────────────────────
async function printTeklif(id) {
  const p = proposals.find(pr => pr.id === id);
  if (!p) {
    await ayAlert('Teklif bulunamadı');
    return;
  }
  haptic(16);
  try {
    _doPrintTeklif(p);
  } catch (e) {
    console.error('printTeklif hata:', e);
    await ayAlert('PDF oluşturulurken hata: ' + e.message);
  }
}
// ═══════════════════════════════════════════════════════════════
// PREMIUM PDF ŞABLON MOTORU — SIFIR BİLGİ PRENSİBİ
// Taksitli işlemlerde nakit fiyat asla gösterilmez.
// Fiyatlar vade farkı yedirilmiş şekilde otomatik dağıtılır.
// ═══════════════════════════════════════════════════════════════
function buildPremiumPDF(docType, data) {
  const isTeklif = docType === 'TEKLİF FORMU';
  const tarih = data.tarih || new Date().toLocaleDateString('tr-TR');
  const isNakit = data.odemeTipi === 'nakit';
  
  // 1. LOGO (mutlak yol + fallback)
  const originUrl = window.location.origin + window.location.pathname.replace(/[^\/]*$/, '');
  const logoUrl = originUrl + 'logo.png';
  const logoHTML = `<img src="${logoUrl}" alt="Aygün AVM" style="max-height:52px; width:auto;" onerror="this.outerHTML='<div style=\\'font-size:1.5rem;font-weight:800;color:#D01F2E;\\'>aygün®<span style=\\'font-weight:400;\\'> AVM</span></div>'">`;
  
  // 2. TEMEL HESAPLAR
  const urunler = data.urunler || [];
  const baseTotalNakit = urunler.reduce((s, u) => s + Number(u.nakit || u.fiyat || 0), 0);
  const toplamIndirim = Number(data.toplamIndirim || 0);
  
  // İşlem tipine göre gösterilecek toplam tutar ve indirim bilgisi
  let gosterilecekToplam = Number(data.toplamOdeme || 0);
  let gosterilecekIndirim = isNakit ? toplamIndirim : 0;
  
  // Taksitli işlemlerde BRUT TUTAR = Toplam Ödenecek (indirimler zaten yok)
  const targetBrutTotal = isNakit ? (gosterilecekToplam + gosterilecekIndirim) : gosterilecekToplam;
  
    // 3. ÜRÜN SATIRLARI — ORANSAL FİYAT DAĞILIMI (Vade farkı yedirilmiş)
  let urunlerHTML = '';
  urunler.forEach((u, i) => {
    const urunBase = Number(u.nakit || u.fiyat || 0);
    const weight = baseTotalNakit > 0 ? (urunBase / baseTotalNakit) : (1 / urunler.length);
    
    // Bu ürünün gösterilecek birim fiyatı (vade farkı yedirilmiş)
    let birimFiyat = targetBrutTotal * weight;
    const itemDisc = Number(u.itemDisc || 0);
    
    // YENİ: Marka + Ürün + Gam Birleştirme (açıklama alt satırda değil, yan yana)
    // Eğer allProducts'ta bu ürünün marka ve gam bilgisi varsa, onları kullan
    let marka = '';
    let gam = '';
    let urunAdi = u.urun || '—';
    
    if (allProducts && allProducts.length > 0 && u.kod) {
      const orijinalUrun = allProducts.find(p => p.Kod === u.kod);
      if (orijinalUrun) {
        marka = orijinalUrun.Marka || '';
        gam = orijinalUrun.Gam || orijinalUrun.gam || '';
        urunAdi = orijinalUrun.Urun || orijinalUrun.urun || u.urun;
      }
    }
    
    // Marka ve Gam formatı
    const markaStr = marka && marka !== '-' ? marka + ' ' : '';
    const gamStr = gam && gam !== '-' ? ' <span style="color:#64748b; font-size:0.85em;">(' + gam + ')</span>' : '';
    const tamUrunAdi = markaStr + urunAdi + gamStr;
    
    let fiyatHTML = '';
    
    if (isNakit && itemDisc > 0) {
      // Nakit + Satır İndirimi: üstü çizili liste fiyatı + net fiyat
      const netFiyat = Math.max(0, birimFiyat - itemDisc);
      fiyatHTML = `
        <span style="text-decoration:line-through;color:#94a3b8;font-size:0.85em;margin-right:8px;">${fmt(birimFiyat)}</span>
        <span style="color:#16a34a;font-weight:800;">${fmt(netFiyat)}</span>
        <span style="display:block;font-size:0.65em;color:#16a34a;margin-top:2px;">-${fmt(itemDisc)} satır indirimi</span>
      `;
    } else if (isNakit) {
      // Nakit + Satır İndirimi Yok
      fiyatHTML = `<span style="font-weight:700;color:#0f172a;">${fmt(birimFiyat)}</span>`;
    } else {
      // Kartlı işlemler (tek çekim veya taksit) — vade farkı yedirilmiş fiyat, indirim yok
      fiyatHTML = `<span style="font-weight:700;color:#0f172a;">${fmt(birimFiyat)}</span>`;
    }
    
    urunlerHTML += `
      <tr style="border-bottom:1px solid #f1f5f9;">
        <td style="padding:14px 12px; width:40px; text-align:center; color:#64748b; font-weight:500;">${i+1}<\/td>
        <td style="padding:14px 12px;">
          <div style="font-weight:600; color:#0f172a;">${tamUrunAdi}</div>
         <\/td>
        <td style="padding:14px 12px; width:60px; text-align:center; color:#475569;">1<\/td>
        <td style="padding:14px 12px; text-align:right; font-family:'DM Mono',monospace;">${fiyatHTML}<\/td>
       <\/tr>
    `;
  });
  
  // 4. ÖDEME TABLOSU — DİNAMİK VE TEMİZ
  let odemeRows = '';
  
  if (isNakit) {
    // NAKİT: Tutar + İndirim + Ödeme Şekli + Toplam
    const hamTutar = targetBrutTotal;
    odemeRows = `
      <tr><td class="ol">Tutar<\/td><td class="or">${fmt(hamTutar)}<\/td><\/tr>
    `;
    if (gosterilecekIndirim > 0) {
      odemeRows += `
        <tr><td class="ol">İndirimler<\/td><td class="or" style="color:#16a34a;font-weight:700;">-${fmt(gosterilecekIndirim)}<\/td><\/tr>
      `;
    }
    odemeRows += `
      <tr><td class="ol">Ödeme Şekli<\/td><td class="or">Nakit<\/td><\/tr>
      <tr class="grand-tr"><td class="ol">Toplam Ödenecek<\/td><td class="or total-cell">${fmt(gosterilecekToplam)}<\/td><\/tr>
    `;
    
  } else if (data.odemeTipi === 'tek_cekim') {
    // TEK ÇEKİM KART: Ödeme Şekli + Toplam (Taksit bilgisi yok)
    odemeRows = `
      <tr><td class="ol">Ödeme Şekli<\/td><td class="or">${data.kartAdi || 'Kart'} — Tek Çekim<\/td><\/tr>
      <tr class="grand-tr"><td class="ol">Toplam Ödenecek<\/td><td class="or total-cell">${fmt(gosterilecekToplam)}<\/td><\/tr>
    `;
    
  } else {
    // TAKSİTLİ KART: Ödeme Şekli + Taksit Sayısı + Aylık Taksit + Toplam
    const aylikTutar = data.aylikTaksit || Math.ceil(gosterilecekToplam / (data.taksitSayisi || 1));
    odemeRows = `
      <tr><td class="ol">Ödeme Şekli<\/td><td class="or">${data.kartAdi || 'Kart'}<\/td><\/tr>
      <tr><td class="ol">Taksit Sayısı<\/td><td class="or">${data.taksitSayisi} Taksit<\/td><\/tr>
      <tr><td class="ol">Aylık Taksit<\/td><td class="or">${fmt(aylikTutar)}<\/td><\/tr>
      <tr class="grand-tr"><td class="ol">Toplam Ödenecek<\/td><td class="or total-cell">${fmt(gosterilecekToplam)}<\/td><\/tr>
    `;
  }
  
  // 5. PREMIUM HTML — FERAH, KURUMSAL, SAP TARZI
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${docType} | Aygün AVM</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f1f5f9;
      color: #0f172a;
      padding: 32px;
      line-height: 1.5;
    }
    .page {
      max-width: 900px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 20px;
      box-shadow: 0 20px 40px -12px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    
    /* HEADER */
    .header {
      padding: 32px 40px 24px;
      background: linear-gradient(135deg, #ffffff 0%, #fef2f2 100%);
      border-bottom: 1px solid #f1f5f9;
    }
    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      flex-wrap: wrap;
      gap: 20px;
    }
    .logo-area { flex-shrink: 0; }
    .title-area { text-align: right; }
    .doc-badge {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #D01F2E;
      margin-bottom: 6px;
    }
    .doc-number {
      font-size: 26px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
      line-height: 1.2;
    }
    .doc-date {
      font-size: 12px;
      color: #64748b;
      margin-top: 6px;
    }
    .doc-expiry {
      font-size: 12px;
      color: #D01F2E;
      font-weight: 600;
      margin-top: 4px;
    }
    
    /* INFO CARDS */
    .info-section {
      padding: 28px 40px 20px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      background: #ffffff;
      border-bottom: 1px solid #f1f5f9;
    }
    .info-card {
      background: #f8fafc;
      border-radius: 16px;
      padding: 20px 24px;
    }
    .info-card.customer { border-left: 4px solid #D01F2E; }
    .info-card.document { border-left: 4px solid #64748b; }
    .info-card h4 {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #94a3b8;
      margin-bottom: 16px;
    }
    .info-row {
      display: flex;
      margin-bottom: 10px;
      font-size: 13px;
    }
    .info-label {
      width: 90px;
      flex-shrink: 0;
      color: #64748b;
      font-weight: 500;
    }
    .info-value {
      color: #0f172a;
      font-weight: 600;
    }
    
    /* PRODUCTS TABLE */
    .products-section {
      padding: 24px 40px 20px;
    }
    .section-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #94a3b8;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .section-title span {
      background: #f1f5f9;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 10px;
      color: #475569;
    }
    .section-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #e2e8f0;
    }
    .product-table {
      width: 100%;
      border-collapse: collapse;
    }
    .product-table th {
      text-align: left;
      padding: 12px 12px;
      background: #f8fafc;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #475569;
      border-bottom: 1px solid #e2e8f0;
    }
    .product-table th:last-child { text-align: right; }
    .product-table td {
      padding: 14px 12px;
      font-size: 13px;
      border-bottom: 1px solid #f1f5f9;
    }
    .product-table td:last-child { text-align: right; font-family: monospace; }
    .product-name {
      font-weight: 600;
      color: #0f172a;
    }
    .product-desc {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 2px;
    }
    
    /* PAYMENT CARD */
    .payment-section {
      padding: 0 40px 24px;
      display: flex;
      justify-content: flex-end;
    }
    .payment-card {
      width: 380px;
      background: #f8fafc;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }
    .payment-card h4 {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #94a3b8;
      padding: 14px 20px;
      background: #ffffff;
      border-bottom: 1px solid #e2e8f0;
      margin: 0;
    }
    .payment-table {
      width: 100%;
      border-collapse: collapse;
    }
    .payment-table td {
      padding: 12px 20px;
      font-size: 13px;
      border-bottom: 1px solid #f1f5f9;
    }
    .payment-table td:first-child {
      color: #64748b;
      font-weight: 500;
    }
    .payment-table td:last-child {
      text-align: right;
      font-weight: 600;
      font-family: monospace;
    }
    .payment-table .grand-total td {
      background: #0f172a;
      color: #ffffff;
      font-weight: 800;
      font-size: 15px;
      border-bottom: none;
    }
    .payment-table .grand-total td:last-child {
      font-size: 18px;
    }
    
    /* NOTE */
    .note-section {
      padding: 0 40px 20px;
    }
    .note-box {
      background: #fffbeb;
      border-left: 4px solid #f59e0b;
      padding: 14px 20px;
      border-radius: 8px;
      font-size: 12px;
      color: #92400e;
      margin-bottom: 32px;
    }
    
    /* SIGNATURES */
    .signatures {
      display: flex;
      justify-content: space-between;
      padding: 20px 40px 32px;
      gap: 40px;
    }
    .sig-item {
      flex: 1;
      text-align: center;
    }
    .sig-line {
      border-top: 2px solid #cbd5e1;
      margin-bottom: 10px;
      padding-top: 8px;
    }
    .sig-label {
      font-size: 10px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      font-weight: 600;
    }
    
    /* FOOTER */
    .footer {
      background: #f8fafc;
      padding: 20px 40px 24px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
    }
    .footer-text {
      font-size: 10px;
      color: #94a3b8;
      line-height: 1.6;
    }
    .footer-brand {
      font-size: 9px;
      color: #cbd5e1;
      margin-top: 8px;
      font-weight: 500;
      letter-spacing: 0.5px;
    }
    
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .page {
        box-shadow: none;
        border-radius: 0;
      }
      .header {
        background: white;
      }
      .payment-table .grand-total td {
        background: #0f172a !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
    @media (max-width: 640px) {
      body { padding: 16px; }
      .header { padding: 20px; }
      .info-section { grid-template-columns: 1fr; padding: 20px; }
      .products-section { padding: 20px; }
      .payment-section { padding: 0 20px 20px; }
      .payment-card { width: 100%; }
      .signatures { padding: 20px; flex-direction: column; gap: 24px; }
    }
  </style>
</head>
<body>
<div class="page">
  
  <!-- HEADER -->
  <div class="header">
    <div class="header-content">
      <div class="logo-area">${logoHTML}</div>
      <div class="title-area">
        <div class="doc-badge">${docType}</div>
        <div class="doc-number">#${(data.belgeNo||'').toUpperCase()}</div>
        <div class="doc-date">Tarih: ${tarih}</div>
        ${data.gecerlilikTarihi ? `<div class="doc-expiry">Geçerlilik: ${data.gecerlilikTarihi}</div>` : ''}
      </div>
    </div>
  </div>
  
  <!-- INFO CARDS -->
  <div class="info-section">
    <div class="info-card customer">
      <h4>MÜŞTERİ BİLGİLERİ</h4>
      <div class="info-row"><span class="info-label">Ad Soyad</span><span class="info-value">${data.musteriIsim||'—'}</span></div>
      <div class="info-row"><span class="info-label">Telefon</span><span class="info-value">${data.telefon||'—'}</span></div>
      ${data.musteriTc ? `<div class="info-row"><span class="info-label">TC / Pasaport</span><span class="info-value">${data.musteriTc}</span></div>` : ''}
      ${data.musteriAdres ? `<div class="info-row"><span class="info-label">Adres</span><span class="info-value">${data.musteriAdres}</span></div>` : ''}
    </div>
    <div class="info-card document">
      <h4>${isTeklif ? 'TEKLİF DETAYLARI' : 'BELGE DETAYLARI'}</h4>
      <div class="info-row"><span class="info-label">Belge No</span><span class="info-value">#${(data.belgeNo||'').toUpperCase()}</span></div>
      <div class="info-row"><span class="info-label">Tarih</span><span class="info-value">${tarih}</span></div>
      <div class="info-row"><span class="info-label">Hazırlayan</span><span class="info-value">${data.satici||'—'}</span></div>
      ${!isTeklif && data.odemeYontemi ? `<div class="info-row"><span class="info-label">Ödeme Tipi</span><span class="info-value">${data.odemeYontemi}</span></div>` : ''}
    </div>
  </div>
  
  <!-- PRODUCTS -->
  <div class="products-section">
    <div class="section-title">
      ÜRÜNLER & HİZMETLER
      <span>${urunler.length} kalem</span>
    </div>
    <table class="product-table">
      <thead>
        <tr>
          <th style="width: 40px;">#</th>
          <th>Ürün / Hizmet Tanımı</th>
          <th style="width: 60px; text-align:center;">Adet</th>
          <th style="text-align:right">Birim Fiyat</th>
        </tr>
      </thead>
      <tbody>
        ${urunlerHTML}
      </tbody>
    </table>
  </div>
  
  <!-- PAYMENT SUMMARY -->
  <div class="payment-section">
    <div class="payment-card">
      <h4>ÖZET & ÖDEME BİLGİLERİ</h4>
      <table class="payment-table">
        ${odemeRows}
      </table>
    </div>
  </div>
  
  <!-- NOTE -->
  ${data.not ? `
  <div class="note-section">
    <div class="note-box">
      <strong>Not:</strong> ${data.not}
    </div>
  </div>
  ` : ''}
  
  <!-- SIGNATURES -->
  <div class="signatures">
    <div class="sig-item">
      <div class="sig-line"></div>
      <div class="sig-label">SATIŞ TEMSİLCİSİ İMZASI</div>
    </div>
    <div class="sig-item">
      <div class="sig-line"></div>
      <div class="sig-label">MÜŞTERİ ONAY İMZASI</div>
    </div>
  </div>
  
  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-text">
      ${isTeklif 
        ? 'Bu belge bir fiyat teklifi olup, stok ve fiyatlar anlık olarak değişiklik gösterebilir. Bizi tercih ettiğiniz için teşekkür ederiz.'
        : 'Bu belge satış belgesi olarak düzenlenmiştir. Ürün ve hizmetleri tercih ettiğiniz için teşekkür ederiz.'
      }
    </div>
    <div class="footer-brand">Aygün AVM · Kurumsal Yönetim Sistemi</div>
  </div>
</div>
<script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),400);});<\/script>
</body>
</html>`;
}

// ── Yardımcı: PDF penceresini aç ─────────────────────────────────
function _openPdfWindow(html) {
  const win = window.open('', '_blank', 'width=820,height=960,scrollbars=yes');
  if(!win) { _showPdfInline(html); return; }
  win.document.write(html);
  win.document.close();
}

function _doPrintTeklif(p) {
  const ab = p.abakus;
  const today = new Date().toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'});
  const sureTarih = p.sureBitis
    ? new Date(p.sureBitis).toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'})
    : null;

  // İndirim hesapları
  const toplamNakit    = (p.urunler||[]).reduce((s,u)=>s+(u.nakit||u.fiyat||0), 0);
  const toplamItemDisc = (p.urunler||[]).reduce((s,u)=>s+(u.itemDisc||0), 0);
  const toplamAltIndirim = p.indirim || 0;
  const toplamIndirim    = toplamItemDisc + toplamAltIndirim;
  const nakitNet         = toplamNakit - toplamIndirim;

  // Ödeme tipi belirle
  let odemeTipi = 'nakit', kartAdi = '', taksitSayisi = 0, aylikTaksit = 0, toplamOdeme = nakitNet;
  if(ab) {
    toplamOdeme = ab.tahsilat || nakitNet;
    kartAdi     = ab.kart || ab.label || '';
    taksitSayisi = ab.taksit || 1;
    aylikTaksit  = ab.aylik || (taksitSayisi > 1 ? Math.ceil(toplamOdeme/taksitSayisi) : toplamOdeme);
    odemeTipi    = taksitSayisi <= 1 ? 'tek_cekim' : 'taksit';
  }

  const data = {
    belgeNo:         (p.id||'').slice(-8).toUpperCase(),
    tarih:           today,
    gecerlilikTarihi: sureTarih,
    musteriIsim:     p.custName || '—',
    telefon:         p.phone || '—',
    satici:          (p.user||'').split('@')[0],
    not:             p.not || '',
    odemeTipi,
    kartAdi,
    taksitSayisi,
    aylikTaksit,
    toplamOdeme,
    toplamIndirim,
    urunler:         p.urunler || []
  };

  const html = buildPremiumPDF('TEKLİF FORMU', data);
  _openPdfWindow(html);
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
  const lowSection = document.querySelector('#change-list .section-low');
  const lowConfirmed = !lowSection || lowSection.classList.contains('section-confirmed');
  const mandatoryLeft = document.querySelectorAll('#change-list .change-item-mandatory:not(.change-item-done)').length;
  const canClose = lowConfirmed && mandatoryLeft === 0;

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
  _updateChangeBtn();
}

function closeChangePopup() {
  const p = document.getElementById('change-popup');
  const logKey = p.dataset.logKey;
  if(logKey) {
    const log = JSON.parse(localStorage.getItem(logKey) || '[]');
    let changed = false;
    log.forEach(e => { if(!e.shown) { e.shown = true; changed = true; } });
    if(changed) localStorage.setItem(logKey, JSON.stringify(log));
  }
  // Mevcut versiyonu seen'e ekle (henüz yoksa)
  const email = currentUser?.Email || 'guest';
  const seenKey = CHANGE_SEEN_KEY + email;
  const seen = JSON.parse(localStorage.getItem(seenKey) || '[]');
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
  const seenArr = JSON.parse(localStorage.getItem('aygun_change_seen_' + email) || '[]');
  const lastSeen = seenArr.length ? seenArr[seenArr.length - 1] : null;
  const now = new Date().toISOString();
  const local = JSON.parse(localStorage.getItem('analytics_local') || '{}');
  if(!local[today]) local[today] = {};
  if(!local[today][email]) local[today][email] = { logins: 0, proposals: 0, basketAdds: 0, sales: 0, products: {} };
  local[today][email].popupSeen = lastSeen;
  local[today][email].popupSeenTs = now;
  localStorage.setItem('analytics_local', JSON.stringify(local));
  // Firebase'e yaz — versiyonu da ekle
  if(_db) {
    const docId = email.replace(/[^a-zA-Z0-9]/g, '_') + '_' + today;
    setDoc(doc(_db, 'analytics', docId), {
      email, date: today,
      popupSeen: lastSeen,
      popupSeenTs: now,
      currentAppVer: window._currentVersion || ''
    }, { merge: true }).catch(() => {});
  }
}

function showChangeToasts(changes) {
  const ct = document.getElementById('change-toast');
  if(!ct) return;
  changes.forEach((c, i) => {
    setTimeout(() => {
      let txt = '';
      if(c.type === 'price') txt = `${c.urun}: ${c.field} ${c.diff > 0 ? '+' : ''}${c.pct}%`;
      else if(c.type === 'stok') txt = `${c.urun}: Stok ${c.diff > 0 ? '+' : ''}${c.diff}`;
      else if(c.type === 'aciklama') txt = `${c.urun}: Açıklama değişti`;
      const el = document.createElement('div');
      el.className = 'toast-item';
      el.innerHTML = `<span>🔔</span><span style="flex:1">${txt}</span><button class="toast-close" onclick="this.parentElement.remove()">×</button>`;
      ct.appendChild(el);
      setTimeout(() => el.remove(), 6000);
    }, i * 700);
  });
}

function logAnalytics(action, detail) {
  if(!currentUser) return;
  const today = new Date().toISOString().split('T')[0];
  const email = currentUser.Email;
  const local = JSON.parse(localStorage.getItem('analytics_local')||'{}');
  if(!local[today]) local[today] = {};
  if(!local[today][email]) local[today][email] = {
    logins: 0, proposals: 0, basketAdds: 0, sales: 0, products: {},
    basketSessions: 0,    // ⬅️ YENİ
    loginTimes: [], basketTimes: []
  };
  const rec = local[today][email];
  if(action === 'login') {
    rec.logins++;
    if(!rec.loginTimes) rec.loginTimes = [];
    rec.loginTimes.push(new Date().getHours());
    if(rec.loginTimes.length > 20) rec.loginTimes = rec.loginTimes.slice(-20);
  }
  if(action === 'proposal') rec.proposals++;
  if(action === 'sale')     rec.sales++;
  if(action === 'basketSession') {   // ⬅️ YENİ
    rec.basketSessions = (rec.basketSessions || 0) + 1;
  }
  if(action === 'addToBasket') {
    rec.basketAdds++;
    if(!rec.basketTimes) rec.basketTimes = [];
    rec.basketTimes.push(new Date().getHours());
    if(rec.basketTimes.length > 100) rec.basketTimes = rec.basketTimes.slice(-100);
    if(detail) rec.products[detail] = (rec.products[detail]||0)+1;
  }
  localStorage.setItem('analytics_local', JSON.stringify(local));
  _fbWriteAnalytics(email, today, rec);
}

async function _fbWriteAnalytics(email, today, rec) {
  if(!_db) return;
  try {
    const docId = email.replace(/[^a-zA-Z0-9]/g,'_') + '_' + today;
    await setDoc(doc(_db, 'analytics', docId), { email, date: today, ...rec }, { merge: true });
  } catch(e) { /* sessiz */ }
}

async function loadAnalyticsData() {
  const local = JSON.parse(localStorage.getItem('analytics_local')||'{}');
  if(window._fbAnalytics && Object.keys(window._fbAnalytics).length > 0) {
    const merged = JSON.parse(JSON.stringify(local));
    Object.values(window._fbAnalytics).forEach(fbRec => {
      const date  = fbRec.date;
      const email = fbRec.email;
      if(!date || !email) return;
      const hasAnalytics = (fbRec.logins != null) || (fbRec.proposals != null) || (fbRec.sales != null);
      if(!hasAnalytics) return;

      if(!merged[date]) merged[date] = {};
      const existing = merged[date][email] || {};
      merged[date][email] = {
        logins:      (fbRec.logins      || 0) + (existing.logins      || 0),
        proposals:   (fbRec.proposals   || 0) + (existing.proposals   || 0),
        sales:       (fbRec.sales       || 0) + (existing.sales       || 0),
        basketAdds:  (fbRec.basketAdds || 0) + (existing.basketAdds || 0),
        basketSessions: (fbRec.basketSessions || 0) + (existing.basketSessions || 0), // ⬅️ YENİ
        basketTimes: [...(fbRec.basketTimes||[]), ...(existing.basketTimes||[])].slice(-200),
        products:    Object.assign({}, existing.products || {}, fbRec.products || {}),
        loginTimes:  fbRec.loginTimes || existing.loginTimes || [],
        popupSeen:   fbRec.popupSeen  || existing.popupSeen  || null,
        currentAppVer: fbRec.currentAppVer || existing.currentAppVer || '',
      };
    });
    return merged;
  }
  return local;
}

// ─── ADMİN ──────────────────────────────────────────────────────
async function openAdmin() {
  // Header'a kullanıcı adını yaz
  const hdrUser = document.getElementById('admin-header-user');
  if(hdrUser) hdrUser.textContent = currentUser?.Email?.split('@')[0] || '—';
  if(!isAdmin()) { await ayAlert('Yetkisiz erişim.'); return; }
  haptic(18);
  const m=document.getElementById('admin-modal');
  m.style.display='flex'; m.classList.add('open');
  renderAdminPanel();
  // Otomatik yenileme — overview sekmesi açıkken her 60 saniyede bir
  if(window._adminRefreshTimer) clearInterval(window._adminRefreshTimer);
  window._adminRefreshTimer = setInterval(() => {
    const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
    if(!adminOpen) { clearInterval(window._adminRefreshTimer); return; }
    const activeTab = document.querySelector('.admin-tab.active')?.dataset?.tab;
    if(activeTab === 'overview' || !activeTab) renderAdminPanel();
  }, 60000);
}
function closeAdmin() {
  const m=document.getElementById('admin-modal');
  m.classList.remove('open'); m.style.display='none';
  if(window._adminRefreshTimer) { clearInterval(window._adminRefreshTimer); window._adminRefreshTimer=null; }
}
function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  document.querySelectorAll('.admin-tab-content').forEach(c=>c.classList.toggle('active',c.id==='tab-'+tab));
  if(tab==='proposals') renderProposals(document.getElementById('admin-proposals-list'), true);
  if(tab==='siparis')   { renderSiparisPanel(); updateSiparisBadge(); }
  if(tab==='sepetler')  { renderSepetDetay(); }
  if(tab==='personel')  { renderAdminUsers(); }
  if(tab==='arsiv')     { renderArchivedProposals(); }
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
  // Firebase analytics henüz yüklenmediyse kısa süre bekle
  if(!window._fbAnalytics || Object.keys(window._fbAnalytics).length === 0) {
    const personelEl = document.getElementById('admin-personel-bugun');
    if(personelEl) personelEl.innerHTML = '<div class="admin-empty">⏳ Veriler yükleniyor...</div>';
    await new Promise(r => setTimeout(r, 1200));
  }
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

  // YENİ: Grafik istatistikleri
  const maxDaily = Math.max(...dc.map(d => d.c));
  const todayCount = dc.find(d => d.date === today)?.c || 0;
  let statsDiv = document.getElementById('chart-stats');
  if(!statsDiv) {
    statsDiv = document.createElement('div');
    statsDiv.id = 'chart-stats';
    statsDiv.style.cssText = 'display:flex; justify-content:space-between; margin-top:8px; font-size:.7rem; color:var(--text-3);';
    dcEl.parentNode.appendChild(statsDiv);
  }
  statsDiv.innerHTML = `<span>📊 En yüksek giriş: ${maxDaily}</span><span>📅 Bugün: ${todayCount}</span>`;
  // Kritik Stok — her açılışta tazele
  const _stokEl = document.getElementById('admin-stok-uyari');
  if(_stokEl) { renderStokUyari(); }
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
function renderSepetDetay() {
  const el = document.getElementById('admin-sepet-detay');
  if(!el) return;

  const html_parts = [];
  const myEmail = currentUser?.Email || '';

  // 1. Mevcut admin oturumunun sepeti
  const myBasket = JSON.parse(localStorage.getItem('aygun_basket')||'[]');
  if(myBasket.length > 0) {
    const myEmailLocal = currentUser?.Email||'Ben';
    const ini = myEmailLocal.split('@')[0].slice(0,2).toUpperCase();
    const rows = myBasket.map(item =>
      '<div class="sepet-item-row">' +
      '<span class="sepet-item-urun">' + (item.urun||item.ad||'?') + '</span>' +
      '<span class="sepet-item-price">' + fmt(item.nakit||item.fiyat||0) + '</span>' +
      (item.itemDisc ? `<span class="sepet-item-disc">-${fmt(item.itemDisc)}</span>` : '') +
      '</div>'
    ).join('');
    html_parts.push(
      '<div class="sepet-user-block">' +
      '<div class="sepet-user-header">' +
      '<div class="user-avatar" style="width:32px;height:32px;font-size:.75rem;background:var(--red)">' + ini + '</div>' +
      '<span style="font-weight:700">' + myEmailLocal.split('@')[0] + '</span>' +
      '<span class="stok-badge sk" style="background:#dcfce7;color:#166534">' + myBasket.length + ' ürün</span>' +
      '<button class="btn-reset haptic-btn" onclick="clearBasket()" style="margin-left:auto;font-size:.65rem;padding:3px 8px">Boşalt</button>' +
      '</div>' +
      rows +
      '</div>'
    );
  }

  // 2. Diğer kullanıcıların canlı sepetleri
  if(window._liveBaskets) {
    Object.entries(window._liveBaskets).forEach(([userEmail, basketData]) => {
      if(userEmail === myEmail) return;
      if(!basketData.items || basketData.items.length === 0) return;

      const ini = userEmail.split('@')[0].slice(0,2).toUpperCase();
      const userName = basketData.userName || userEmail.split('@')[0];
      const itemRows = basketData.items.map(item =>
        '<div class="sepet-item-row">' +
        '<span class="sepet-item-urun">' + (item.urun||'?') + '</span>' +
        '<span class="sepet-item-price">' + fmt(item.nakit||0) + '</span>' +
        (item.itemDisc ? `<span class="sepet-item-disc">-${fmt(item.itemDisc)}</span>` : '') +
        '</div>'
      ).join('');

      const lastUpdate = basketData.ts?.toDate ? new Date(basketData.ts.toDate()).toLocaleTimeString('tr-TR') : '-';

      html_parts.push(
        '<div class="sepet-user-block">' +
        '<div class="sepet-user-header">' +
        '<div class="user-avatar" style="width:32px;height:32px;font-size:.75rem">' + ini + '</div>' +
        '<span style="font-weight:700">' + userName + '</span>' +
        '<span class="stok-badge sk" style="background:#fef3c7;color:#92400e">' + basketData.items.length + ' ürün</span>' +
        `<span class="stok-badge sk" style="background:#e2e8f0;color:#1e293b">${lastUpdate}</span>` +
        `<button onclick="clearUserBasket('${userEmail}')" style="margin-left:auto;background:#fee2e2;border:none;border-radius:6px;padding:4px 12px;font-size:.68rem;cursor:pointer;color:#dc2626;font-weight:600">🗑 Boşalt</button>` +
        '</div>' +
        itemRows +
        '</div>'
      );
    });
  }

  if(!html_parts.length) {
    el.innerHTML = '<div class="admin-empty">Aktif sepet bulunamadı</div>';
    return;
  }
  
  const clearBtn = isAdmin()
    ? '<div style="display:flex;justify-content:flex-end;margin-bottom:10px">' +
      '<button class="btn-reset haptic-btn" onclick="clearAllLiveBaskets()" style="background:#fee2e2;color:#dc2626;border-color:#fca5a5">🗑 Tüm Canlı Sepetleri Sil</button>' +
      '</div>'
    : '';
  el.innerHTML = clearBtn + html_parts.join('');
}
function renderPersonelBugun(data, today) {
  const el = document.getElementById('admin-personel-bugun');
  if(!el) return;
  const todayData = data[today]||{};
  
  // Bugün veri yoksa son 7 günün verilerini göster
  if(Object.keys(todayData).length === 0) {
    const dates = Object.keys(data).sort().slice(-7);
    const aggregatedData = {};
    dates.forEach(date => {
      Object.entries(data[date] || {}).forEach(([email, rec]) => {
        if(!aggregatedData[email]) {
          aggregatedData[email] = {
            proposals: 0, sales: 0, logins: 0,
            basketSessions: 0,   // ⬅️ YENİ
            days: 0
          };
        }
        aggregatedData[email].proposals += rec.proposals || 0;
        aggregatedData[email].sales += rec.sales || 0;
        aggregatedData[email].logins += rec.logins || 0;
        aggregatedData[email].basketSessions += rec.basketSessions || 0; // ⬅️ YENİ
        aggregatedData[email].days++;
      });
    });
    
    const sortedUsers = Object.entries(aggregatedData)
      .map(([email, rec]) => {
        const proposals = rec.proposals;
        const sales = rec.sales;
        const logins = rec.logins;
        const basketSessions = rec.basketSessions;
        const conversionRate = proposals > 0 ? ((sales / proposals) * 100).toFixed(1) : 0;
        return { email, proposals, sales, logins, basketSessions, conversionRate };
      })
      .sort((a, b) => b.proposals - a.proposals);
    
    if(sortedUsers.length === 0) {
      el.innerHTML = '<div class="admin-empty">Henüz veri yok. Kullanıcılar giriş yaptıkça burada görünecektir.</div>';
      return;
    }
    
    const html = `
      <div class="admin-section-header" style="margin-bottom:12px">📈 Personel Performansı (Son 7 Gün)</div>
      <div style="overflow-x:auto">
        <table style="width:100%; border-collapse:collapse; font-size:.75rem">
          <thead>
            <tr style="background:var(--surface-2); border-bottom:2px solid var(--border)">
              <th style="padding:8px 6px; text-align:left">Personel</th>
              <th style="padding:8px 6px; text-align:center" title="Giriş/Çıkış sayısı">Giriş</th>
              <th style="padding:8px 6px; text-align:center" title="Sepet oturumu sayısı">🛒 İşlem</th>   <!-- ⬅️ Başlık değişti -->
              <th style="padding:8px 6px; text-align:center">Teklif</th>
              <th style="padding:8px 6px; text-align:center">Satış</th>
              <th style="padding:8px 6px; text-align:center" title="En çok hangi saat aralığında aktif">Aktif Saat</th>
              </tr>
          </thead>
          <tbody>
            ${sortedUsers.map(user => {
              const peakHour = _getPeakHour(user.loginTimes || []);
              const activityScore = (user.logins||0) + (user.basketSessions||0)*0.5 + (user.proposals||0)*2; // ⬅️ basketSessions kullanıldı
              const scoreColor = activityScore===0?'#94a3b8':activityScore<3?'#f59e0b':'#16a34a';
              return `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:8px 6px; font-weight:600">
                  ${user.email.split('@')[0]}
                  <span style="display:block;font-size:.58rem;color:${scoreColor};font-weight:700">
                    ${activityScore===0?'⚪ İnaktif':activityScore<3?'🟡 Düşük':'🟢 Aktif'}
                  </span>
                </td>
                <td style="padding:8px 6px; text-align:center">${user.logins||0}</td>
                <td style="padding:8px 6px; text-align:center; font-weight:700; color:var(--red)">${user.basketSessions||0}</td>   <!-- ⬅️ basketSessions -->
                <td style="padding:8px 6px; text-align:center">${user.proposals||0}</td>
                <td style="padding:8px 6px; text-align:center">${user.sales||0}</td>
                <td style="padding:8px 6px; text-align:center; font-size:.72rem; color:var(--text-3)">${peakHour}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="font-size:.68rem; color:var(--text-3); margin-top:8px; text-align:center">ℹ️ Bugün veri yok, son 7 gün gösteriliyor</div>
    `;
    el.innerHTML = html;
    return;
  }
  
  // Bugün veri varsa normal gösterim
  const sortedUsers = Object.entries(todayData)
    .map(([email, rec]) => {
      const proposals = rec.proposals || 0;
      const sales = rec.sales || 0;
      const logins = rec.logins || 0;
      const basketSessions = rec.basketSessions || 0;   // ⬅️ YENİ
      const conversionRate = proposals > 0 ? ((sales / proposals) * 100).toFixed(1) : 0;
      return { email, ...rec, proposals, sales, logins, basketSessions, conversionRate };
    })
    .sort((a, b) => b.proposals - a.proposals);

  const html = `
    <div class="admin-section-header" style="margin-bottom:12px">📈 Personel Performansı (Bugün)</div>
    <div style="overflow-x:auto">
      <table style="width:100%; border-collapse:collapse; font-size:.75rem">
        <thead>
          <tr style="background:var(--surface-2); border-bottom:2px solid var(--border)">
            <th style="padding:8px 6px; text-align:left">Personel</th>
            <th style="padding:8px 6px; text-align:center" title="Giriş/Çıkış">Giriş</th>
            <th style="padding:8px 6px; text-align:center" title="Sepet oturumu sayısı">🛒 İşlem</th>   <!-- ⬅️ Başlık değişti -->
            <th style="padding:8px 6px; text-align:center">Teklif</th>
            <th style="padding:8px 6px; text-align:center">Satış</th>
            <th style="padding:8px 6px; text-align:center">Aktif Saat</th>
          </tr>
        </thead>
        <tbody>
          ${sortedUsers.map(user => {
            const peakHour = _getPeakHour([...(user.loginTimes||[]), ...(user.basketTimes||[])]);
            const activityScore = (user.logins||0) + (user.basketSessions||0)*0.5 + (user.proposals||0)*2; // ⬅️ basketSessions kullanıldı
            const scoreColor = activityScore===0?'#94a3b8':activityScore<3?'#f59e0b':'#16a34a';
            return `
            <tr style="border-bottom:1px solid var(--border)">
              <td style="padding:8px 6px; font-weight:600">
                ${user.email.split('@')[0]}
                <span style="display:block;font-size:.58rem;color:${scoreColor};font-weight:700">
                  ${activityScore===0?'⚪ İnaktif':activityScore<3?'🟡 Düşük':'🟢 Aktif'}
                </span>
              </td>
              <td style="padding:8px 6px; text-align:center">${user.logins||0}</td>
              <td style="padding:8px 6px; text-align:center; font-weight:700; color:var(--red)">${user.basketSessions||0}</td>   <!-- ⬅️ basketSessions -->
              <td style="padding:8px 6px; text-align:center">${user.proposals||0}</td>
              <td style="padding:8px 6px; text-align:center">${user.sales||0}</td>
              <td style="padding:8px 6px; text-align:center; font-size:.72rem; color:var(--text-3)">${peakHour}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
  el.innerHTML = html;
}
// ─── YARDIMCI: Zirve saat hesapla ───────────────────────────────
function _getPeakHour(times) {
  if(!times || !times.length) return '—';
  const counts = {};
  times.forEach(h => { counts[h] = (counts[h]||0)+1; });
  const peak = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
  const h = parseInt(peak[0]);
  const hNext = (h + 1) % 24;   // bir sonraki saat
  const pad = n => (n < 10 ? '0' : '') + n;
  return `${pad(h)}:00 – ${pad(hNext)}:00`;
}

// ─── EŞ ZAMANLI OTURUM KONTROLÜ ────────────────────────────────
async function _checkAndRegisterSession(email, rol) {
  if(!_db || rol==='admin') return; // Admin kısıtlanmaz
  try {
    // Aktif oturumları kontrol et (son 2 dakika içinde heartbeat gönderenler)
    const sessionId = 'ses_' + email.replace(/[^a-zA-Z0-9]/g,'_') + '_' + Date.now();
    localStorage.setItem('_aygun_session_id', sessionId);
    const twoMinAgo = new Date(Date.now()-120000).toISOString();
    // Aynı email için aktif oturum var mı?
    const existing = Object.values(window._fbSessions||{})
      .filter(s => s.email===email && s.lastSeen > twoMinAgo && s.id !== sessionId);
    if(existing.length > 0) {
      const warn = await ayConfirm(
        '⚠️ Bu hesap başka bir cihazda zaten açık!\n' +
        'Cihaz: ' + (existing[0].device||'Bilinmiyor') + '\nDevam etmek istiyor musunuz?'
      );
      if(!warn) { currentUser=null; localStorage.removeItem('aygun_user'); return; }
    }
    // Oturumu kaydet
    await setDoc(doc(_db,'sessions',sessionId),{
      id: sessionId, email, rol,
      lastSeen: new Date().toISOString(),
      device: navigator.userAgent.split('(')[1]?.split(')')[0]?.split(';')[0]?.trim() || 'Web',
      loginAt: new Date().toISOString()
    });
    // Heartbeat — her 60 sn'de güncelle
    if(window._sessionHeartbeat) clearInterval(window._sessionHeartbeat);
    window._sessionHeartbeat = setInterval(()=>{
      if(!currentUser||!_db) { clearInterval(window._sessionHeartbeat); return; }
      setDoc(doc(_db,'sessions',sessionId),{lastSeen:new Date().toISOString()},{merge:true}).catch(()=>{});
    },60000);
  } catch(e) { console.warn('Session check failed:', e); }
}

// Sessions listener (admin için — eş zamanlı oturum izleme)
window._fbSessions = {};
function _startSessionListener() {
  if(!_db || !isAdmin()) return;
  onSnapshot(collection(_db,'sessions'), snap => {
    window._fbSessions = {};
    snap.docs.forEach(d => { window._fbSessions[d.id] = d.data(); });
  }, ()=>{});
}

// ─── ARŞİV PANEL ────────────────────────────────────────────────
function renderArchivedProposals() {
  const el = document.getElementById('admin-arsiv-list');
  if(!el) { return; }
  const archiveCutoff = new Date(); archiveCutoff.setDate(archiveCutoff.getDate()-7);
  const archived = proposals.filter(p =>
    p.archivedAt && new Date(p.archivedAt) < archiveCutoff
  ).sort((a,b)=>new Date(b.archivedAt)-new Date(a.archivedAt));

  if(!archived.length) {
    el.innerHTML = '<div class="admin-empty">📦 Arşiv boş<br><span style="font-size:.72rem;color:var(--text-3)">İptal, süresi dolan ve satışa dönen teklifler 7 gün sonra buraya taşınır</span></div>';
    return;
  }
  const statusLabel = {bekliyor:'⏳',satisDondu:'✅',iptal:'✕',sureDoldu:'⌛'};
  el.innerHTML = archived.map(p => `
    <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border);font-size:.76rem;">
      <span style="font-size:1rem">${statusLabel[p.durum]||'📄'}</span>
      <div style="flex:1">
        <div style="font-weight:700">${p.custName||'—'}</div>
        <div style="font-size:.65rem;color:var(--text-3)">${p.user?.split('@')[0]||'—'} · ${fmtDate(p.archivedAt)}</div>
      </div>
      <div style="font-family:'DM Mono',monospace;font-size:.73rem;color:var(--text-2)">${p.urunler?.length||0} ürün</div>
      <button onclick="deleteProp('${p.id}')" style="background:#fee2e2;border:none;border-radius:6px;padding:4px 8px;font-size:.65rem;color:#dc2626;cursor:pointer;font-family:inherit;font-weight:700">Sil</button>
    </div>
  `).join('');
}

function renderAdminUsers() {
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
    // Versiyon bilgisi TAMAMEN KALDIRILDI
    return `<div class="user-row">
      <div class="user-avatar">${ini}</div>
      <div class="user-info">
        <div class="user-email">${email.split('@')[0]}</div>
        <div class="user-meta">Son aktivite: ${s.lastSeen||'-'}</div>
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
async function clearAllLiveBaskets() {
  if(!isAdmin()) return;
  if(!(await ayDanger('Tüm kullanıcıların canlı sepetleri silinsin mi?'))) return;
  haptic(30);
  try {
    const querySnapshot = await getDocs(collection(_db, 'live_baskets'));
    const deletePromises = querySnapshot.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);
    // Kendi localStorage sepetini de temizle
    basket = []; discountAmount = 0;
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    updateCartUI();
    renderSepetDetay();
  } catch(e) { console.error('Tüm canlı sepetler silinemedi:', e); ayAlert('Silme hatası!'); }
}
async function clearUserProps(userEmail) {
  if(!isAdmin()) return;
  const userPending = proposals.filter(p=>p.user===userEmail&&(p.durum==='bekliyor'||p.durum==='sureDoldu'));
  if(!userPending.length) { await ayAlert('Bu kullanıcının bekleyen teklifi yok'); return; }
  if(!(await ayDanger(userEmail.split('@')[0]+' kullanıcısının '+userPending.length+' teklifi silinsin mi?'))) return;
  haptic(30);
  userPending.forEach(async p => {
    const idx = proposals.findIndex(pr=>pr.id===p.id);
    if(idx>-1) proposals.splice(idx,1);
    try { await deleteDoc(doc(_db,'proposals',p.id)); } catch(e){}
  });
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  renderSepetDetay(); updateProposalBadge();
}
async function clearAllPendingProps() {
  if(!isAdmin()) return;
  const pending = proposals.filter(p=>p.durum==='bekliyor'||p.durum==='sureDoldu');
  if(!pending.length) { await ayAlert('Bekleyen teklif yok'); return; }
  if(!(await ayDanger(pending.length+' bekleyen teklif silinsin mi?'))) return;
  haptic(30);
  pending.forEach(async p=>{
    const idx=proposals.findIndex(pr=>pr.id===p.id);
    if(idx>-1) proposals.splice(idx,1);
    try { await deleteDoc(doc(_db,'proposals',p.id)); } catch(e){}
  });
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  renderSepetDetay();
  updateProposalBadge();
}

async function clearUserBasket(email) {
  if(!isAdmin()) return;
  if(!(await ayDanger(email.split('@')[0] + ' kullanıcısının sepeti boşaltılsın mı?'))) return;
  haptic(20);
  try {
    const basketRef = doc(_db, 'live_baskets', email);
    await deleteDoc(basketRef);
    renderSepetDetay();
  } catch(e) { ayAlert('Hata: ' + e.message); console.error(e); }
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

async function resetProductStats() {
  if(!(await ayConfirm('Ürün popülerlik verileri sıfırlansın mı?'))) return;
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
  if(!basket.length) { ayAlert('Sepet boş!'); return; }
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

// ─── SATIŞ BELGESİ MODAL ─────────────────────────────────────────
async function openSaleDoc() {
  if (!basket.length) {
    await ayAlert('Sepet boş!');
    return;
  }
  haptic(16);
  const m = document.getElementById('sale-modal');
  if (!m) return;
  m.style.display = 'flex';
  m.classList.add('open');
  updateSalePreview();
}

function closeSaleDoc() {
  const m = document.getElementById('sale-modal');
  if (m) {
    m.classList.remove('open');
    m.style.display = 'none';
  }
}

function updateSalePreview() {
  const get = id => (document.getElementById(id) || {}).value || '';
  const t = basketTotals();
  const nakit = t.nakit - getDisc(t.nakit);
  const today = new Date().toLocaleDateString('tr-TR');
  const saleNo = 'SAT-' + Date.now().toString(36).toUpperCase();
  const logoEl = document.querySelector('.header-logo img');
  const logoSrc = logoEl ? logoEl.src : '';
  const preview = document.getElementById('sale-preview');
  if (!preview) return;
  
  preview.innerHTML = `
    <div class="sale-preview-logo">${logoSrc ? `<img src="${logoSrc}" alt="Aygün AVM" style="height:40px">` : '<div style="font-weight:900;font-size:1.2rem;color:var(--red)">aygün® AVM</div>'}</div>
    <div class="sale-preview-title">SATIŞ BELGESİ</div>
    <div class="sale-preview-sub">No: ${saleNo} · Tarih: ${today}</div>
    <div class="sale-preview-section">
      <div class="sale-preview-section-title">Müşteri Bilgileri</div>
      ${[['Ad Soyad', get('sale-name')], ['TC / Pasaport', get('sale-tc')], ['Adres', get('sale-address')], ['Telefon', get('sale-phone')], ['Tel 2', get('sale-phone2')], ['E-Mail', get('sale-email')]].filter(r => r[1]).map(r => `<div class="sale-preview-row"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}
    </div>
    <div class="sale-preview-section">
      <div class="sale-preview-section-title">Ürünler</div>
      ${basket.map(i => `<div class="sale-preview-row"><span>${i.urun}</span><span>${fmt(i.nakit)}</span></div>`).join('')}
      ${discountAmount > 0 ? `<div class="sale-preview-row"><span>İndirim</span><span style="color:var(--green)">-${fmt(getDisc(nakit))}</span></div>` : ''}
    </div>
    <div class="sale-total-row"><span>${get('sale-method') || 'Ödeme Yöntemi'}</span><span>${fmt(nakit)}</span></div>
  `;
  preview.dataset.saleNo = saleNo;
}

async function generateSalePDF() {
  haptic(22);
  const get = id => (document.getElementById(id) || {}).value || '';
  if (!get('sale-name')) {
    await ayAlert('Müşteri adı zorunludur.');
    return;
  }

  const t = basketTotals();
  const totalItemDisc = basket.reduce((s, i) => s + (i.itemDisc || 0), 0);
  const altIndirimTutar = getDisc(t.nakit - totalItemDisc);
  const toplamIndirim = totalItemDisc + altIndirimTutar;
  const toplamOdeme = t.nakit - toplamIndirim;

  const today = new Date().toLocaleDateString('tr-TR');
  const belgeNo = document.getElementById('sale-preview')?.dataset.saleNo || ('SAT-' + uid().toUpperCase());

  // Ödeme yöntemi parse et
  const methodStr = get('sale-method') || 'Nakit';
  let odemeTipi = 'nakit', kartAdi = '', taksitSayisi = 0, aylikTaksit = 0, toplamKartOdeme = toplamOdeme;
  
  if (abakusSelection) {
    kartAdi = abakusSelection.kart || abakusSelection.label || '';
    taksitSayisi = abakusSelection.taksit || 1;
    toplamKartOdeme = abakusSelection.tahsilat || toplamOdeme;
    aylikTaksit = abakusSelection.aylik || (taksitSayisi > 1 ? Math.ceil(toplamKartOdeme / taksitSayisi) : toplamKartOdeme);
    odemeTipi = taksitSayisi <= 1 ? 'tek_cekim' : 'taksit';
  } else if (methodStr.toLowerCase().includes('taksit')) {
    odemeTipi = 'taksit';
    kartAdi = methodStr.split('-')[0]?.trim() || methodStr;
  } else if (methodStr.toLowerCase().includes('tek') || methodStr.toLowerCase().includes('çekim')) {
    odemeTipi = 'tek_cekim';
    kartAdi = methodStr.split('-')[0]?.trim() || methodStr;
  }

  const data = {
    belgeNo,
    tarih: today,
    musteriIsim: get('sale-name'),
    telefon: get('sale-phone'),
    musteriTc: get('sale-tc'),
    musteriAdres: get('sale-address'),
    satici: (currentUser?.Email || '').split('@')[0] || (currentUser?.Ad || ''),
    odemeYontemi: methodStr,
    odemeTipi,
    kartAdi,
    taksitSayisi,
    aylikTaksit,
    toplamOdeme: odemeTipi === 'nakit' ? toplamOdeme : toplamKartOdeme,
    toplamIndirim,
    urunler: basket.map(i => ({ ...i }))
  };

  const html = buildPremiumPDF('SATIŞ SÖZLEŞMESİ', data);
  const win = window.open('', '_blank', 'width=820,height=960,scrollbars=yes');
  if (!win) {
    _showPdfInline(html);
  } else {
    win.document.write(html);
    win.document.close();
  }

  // Satışı kaydet
  const saleRecord = {
    id: belgeNo,
    ts: new Date().toISOString(),
    custName: data.musteriIsim,
    custTC: data.musteriTc,
    custPhone: data.telefon,
    custEmail: get('sale-email'),
    address: data.musteriAdres,
    method: methodStr,
    urunler: basket.map(i => ({ ...i })),
    nakit: data.toplamOdeme,
    indirim: totalItemDisc,
    user: currentUser?.Email || '-',
    tip: 'satis'
  };
  sales.unshift(saleRecord);
  localStorage.setItem('aygun_sales', JSON.stringify(sales));
  logAnalytics('sale', data.musteriIsim);
  closeSaleDoc();
}

// ─── SİPARİŞ NOTU (Firebase) ─────────────────────────────────
function getSiparisNotlari() {
  return window._siparisData || [];
}

async function openSiparisNot(urunAdi, urunIdx) {
  haptic(16);
  const not = await ayPrompt(urunAdi + ' için sipariş notu:', '', '');
  if(!not || !not.trim()) return;
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
  if(!(await ayDanger('Tüm sipariş notları silinsin mi?'))) return;
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
  
  // --- YENİ: Admin butonunda da badge göster ---
  const adminBtn = document.getElementById('admin-btn');
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
  
  // --- YENİ: Toast bildirimi (sadece yeni eklendiğinde) ---
  if(window._lastSiparisCount !== bekleyen && bekleyen > window._lastSiparisCount) {
    showSiparisToast(bekleyen);
  }
  window._lastSiparisCount = bekleyen;
}

// YENİ FONKSİYON: Sipariş bildirimi gösterme
function showSiparisToast(count) {
  let toast = document.getElementById('siparis-toast');
  if(!toast) {
    toast = document.createElement('div');
    toast.id = 'siparis-toast';
    toast.style.cssText = [
      'position:fixed','bottom:20px','right:20px','z-index:10000',
      'background:#1e293b','color:#fff','padding:12px 20px','border-radius:12px',
      'font-size:.85rem','font-weight:600','box-shadow:0 4px 20px rgba(0,0,0,.25)',
      'border-left:4px solid #e11d48','animation:slideInRight 0.3s ease',
      'display:flex','align-items:center','gap:10px','cursor:pointer'
    ].join(';');
    toast.onclick = () => {
      document.getElementById('admin-btn')?.click();
      setTimeout(() => switchAdminTab('siparis'), 300);
      toast.remove();
    };
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span>📦</span> <strong>${count}</strong> yeni sipariş notu var! <span style="font-size:.7rem">→</span>`;
  setTimeout(() => {
    if(toast) toast.style.opacity = '0';
    setTimeout(() => toast?.remove(), 500);
  }, 5000);
}


// ─── ÇIKIŞ ────────────────────────────────────────────────────
async function logoutUser() {
  haptic(22);
  if(!(await ayConfirm('Çıkış yapmak istediğinize emin misiniz?'))) return;
  // Oturumu Firestore'dan temizle
  if(_db && currentUser) {
    const sessionId = localStorage.getItem('_aygun_session_id');
    if(sessionId) deleteDoc(doc(_db, 'sessions', sessionId)).catch(()=>{});
  }
  currentUser = null;
  localStorage.removeItem('aygun_user');
  localStorage.removeItem('_aygun_session_id');
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
  clearAllLiveBaskets,
  openMessages: ()=>{},
  addToBasketPrim, openSiparisNotSafe, _initStockFilterBtn,
  renderArchivedProposals,
});
