// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — app.js  (Rev 4.0 — Firebase Firestore)
//  Teklifler ve Satışlar artık Firebase'de — cihazlar arası senkron
// ═══════════════════════════════════════════════════════════════

// ─── FİREBASE BAŞLATMA ──────────────────────────────────────────
import { initializeApp }                           from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
import { getFirestore, collection, collectionGroup, doc, deleteDoc,
         addDoc, setDoc, updateDoc, onSnapshot,
         query, orderBy, serverTimestamp, where, limit,
         getDoc, getDocs, increment,
         enableNetwork, disableNetwork }         from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

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

// ── Firebase WebChannel konsol gürültüsünü filtrele ───────────────
// "WebChannelConnection RPC 'Listen' stream transport errored" mesajları
// Firebase'in kendi reconnect mekanizmasının normal bir parçasıdır.
// Uygulama davranışını etkilemez; sadece konsolu temiz tutar.
(function _suppressFirebaseNoise() {
  const _origError = console.error.bind(console);
  const _origWarn  = console.warn.bind(console);
  const _NOISE = ['WebChannelConnection', 'WebChannel', 'transport errored', 'Listen stream'];
  const _isNoise = (...args) => args.some(a => _NOISE.some(n => String(a).includes(n)));
  console.error = (...args) => { if (!_isNoise(...args)) _origError(...args); };
  console.warn  = (...args) => { if (!_isNoise(...args)) _origWarn(...args);  };
})();

// ── Firebase Bağlantı İzleyici ────────────────────────────────────
// WebChannel 404 hatası Spark planında periyodik yaşanır.
// online/offline olaylarını dinleyerek Firestore'u yeniden bağlıyoruz.
(function _initFirebaseWatchdog() {
  let _isOnline = navigator.onLine;
  let _reconnectTimer = null;

  async function _reconnectFirestore() {
    try {
      await disableNetwork(_db);
      await enableNetwork(_db);
    } catch(e) { /* sessiz */ }
  }

  window.addEventListener('online', async () => {
    if (!_isOnline) {
      _isOnline = true;
      clearTimeout(_reconnectTimer);
      _reconnectTimer = setTimeout(_reconnectFirestore, 1500);
    }
  });

  window.addEventListener('offline', () => { _isOnline = false; });

  // Sayfa görünür olduğunda (tab'a geri dönünce) da yeniden bağlan
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _isOnline) {
      clearTimeout(_reconnectTimer);
      _reconnectTimer = setTimeout(_reconnectFirestore, 2000);
    }
  });
})();
const _colProp      = () => collection(_db, 'proposals');
const _colSales     = () => collection(_db, 'sales');
const _colSiparis   = () => collection(_db, 'siparis');
const _colAnalytics = () => collection(_db, 'analytics');
const _colMotd      = () => collection(_db, 'motd');   // Kayan yazı mesajları
const _colVitrin    = () => collection(_db, 'vitrin'); // Kampanya vitrin ürünleri

// ════════════════════════════════════════════════════════════════
// EVENTBUS — Hafif Observable (cart:updated, proposal:changed, auth:stateChanged)
// ════════════════════════════════════════════════════════════════
const EventBus = (() => {
  const _listeners = {};
  return {
    on(event, fn)  {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
    },
    off(event, fn) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(f => f !== fn);
    },
    emit(event, data) {
      (_listeners[event] || []).forEach(fn => { try { fn(data); } catch(e) { console.warn('EventBus error:', event, e); } });
    }
  };
})();

// ─── Namespace sabitleri (typo önleme) ──────────────────────────
const EV = Object.freeze({
  CART_UPDATED:      'cart:updated',
  CART_CLEARED:      'cart:cleared',
  PROPOSAL_CHANGED:  'proposal:statusChanged',
  PROPOSAL_SEPETE:   'proposal:addedToCart',
  AUTH_STATE:        'auth:stateChanged',
  FUNNEL_RECALC:     'funnel:recalculate',
  UI_REFRESH:        'ui:refresh',
});



// ─── FİRESTORE YARDIMCI FONKSİYONLAR ───────────────────────────
// Firestore'a teklif kaydet
async function fbSaveProp(prop) {
  try {
    const ref = doc(_db, 'proposals', prop.id);
    const prevSnap = await getDoc(ref).catch(() => null);
    const isNew = !prevSnap || !prevSnap.exists();
    await setDoc(ref, _fbSerialize(prop));
    // Teklif sayacını sadece GERÇEKten yeni kayıtta artır
    if (isNew && prop.durum === 'bekliyor') {
      incrementDailyStat('teklif_sayisi').catch(()=>{});
    }
  } catch(e) { console.error('fbSaveProp:', e); }
}
// Firestore'a satış kaydet
async function fbSaveSale(sale) {
  try {
    const ref = doc(_db, 'sales', sale.id);
    await setDoc(ref, _fbSerialize(sale));
    // NOT: satis_sayisi artırımı finalizeAksiyon içinde yapılır — çift sayımı önler
  } catch(e) { console.error('fbSaveSale:', e); }
}
// Firestore'dan teklif kalıcı sil
async function fbDeleteProp(id) {
  try {
    await deleteDoc(doc(_db, 'proposals', id));
  } catch(e) { console.error('fbDeleteProp:', e); }
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
  // ── Yeniden bağlanma yardımcısı ──────────────────────────────
  // Firebase WebChannel 404/network hataları geçicidir — belirli süre sonra yeniden dene
  function _safeListener(label, queryFn, onNext, onErr, retryMs = 8000) {
    let unsub = null;
    let retryTimer = null;
    let retryCount = 0;
    const MAX_RETRY = 8;

    function start() {
      try {
        if (unsub) { try { unsub(); } catch(e) {} }
        unsub = onSnapshot(queryFn(), onNext, err => {
          console.warn(`[${label}] listener hatası:`, err?.code || err?.message || err);
          if (onErr) onErr(err);
          // Geçici hata (network, unavailable) → yeniden bağlan
          const errCode = err?.code || '';
          const errStr  = String(err?.message || err || '');
          const isRetryable = !errCode
            || ['unavailable','resource-exhausted','internal','deadline-exceeded','cancelled'].includes(errCode)
            || errStr.includes('404') || errStr.includes('WebChannel') || errStr.includes('transport');
          if (isRetryable && retryCount < MAX_RETRY) {
            retryCount++;
            const delay = Math.min(retryMs * retryCount, 60000);
            console.log(`[${label}] ${delay/1000}s sonra yeniden bağlanılıyor... (${retryCount}/${MAX_RETRY})`);
            clearTimeout(retryTimer);
            retryTimer = setTimeout(async () => {
              // Firestore'u önce disable sonra enable ederek stream'i sıfırla
              try { await disableNetwork(_db); await enableNetwork(_db); } catch(e) {}
              start();
            }, delay);
          }
        });
        retryCount = 0; // Başarılı bağlantıda sıfırla
      } catch(e) {
        console.error(`[${label}] listener başlatma hatası:`, e);
      }
    }

    start();
    return () => {
      clearTimeout(retryTimer);
      if (unsub) { try { unsub(); } catch(e) {} }
    };
  }

  // ── Proposals ────────────────────────────────────────────────
  if(window._propUnsub) window._propUnsub();
  window._propUnsub = _safeListener(
    'proposals',
    () => query(_colProp(), orderBy('ts', 'desc')),
    snap => {
      proposals = snap.docs.map(d => d.data());
      localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
      updateProposalBadge();
      EventBus.emit(EV.PROPOSAL_CHANGED);
      EventBus.emit(EV.CART_UPDATED, { source: 'firestore:proposals' });
      if(document.getElementById('proposals-modal')?.classList.contains('open')) renderProposals();
      const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
      if (adminOpen) {
        const activeTab = document.querySelector('.admin-tab.active')?.dataset?.tab;
        if (activeTab === 'overview')  renderAdminPanel();
        if (activeTab === 'sepetler')  renderSepetDetay();
        if (activeTab === 'personel')  renderAdminUsers();
        if (activeTab === 'analiz')    loadFunnelAnaliz(90, false);
      }
      updateProposalBadge();
    },
    // Hata olursa localStorage'dan yükle (offline fallback)
    () => {
      try {
        const cached = localStorage.getItem('aygun_proposals');
        if (cached && !proposals.length) {
          proposals = JSON.parse(cached);
          updateProposalBadge();
          if(document.getElementById('proposals-modal')?.classList.contains('open')) renderProposals();
          console.info('[proposals] Offline cache\'den yüklendi');
        }
      } catch(e) {}
    }
  );
  // ── Sales ─────────────────────────────────────────────────────
  if(window._saleUnsub) window._saleUnsub();
  window._saleUnsub = _safeListener(
    'sales',
    () => query(_colSales(), orderBy('ts', 'desc')),
    snap => {
      sales = snap.docs.map(d => d.data());
      localStorage.setItem('aygun_sales', JSON.stringify(sales));
    },
    () => {
      try { const c = localStorage.getItem('aygun_sales'); if(c && !sales.length) sales = JSON.parse(c); } catch(e) {}
    }
  );
  // ── Sipariş notları ────────────────────────────────────────────
  if(window._siparisUnsub) window._siparisUnsub();
  window._siparisUnsub = _safeListener(
    'siparis',
    () => query(_colSiparis(), orderBy('ts', 'desc')),
    snap => {
      window._siparisData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateSiparisBadge();
      const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
      if (adminOpen) {
        const activeTab = document.querySelector('.admin-tab.active')?.dataset?.tab;
        if (activeTab === 'siparis') renderSiparisPanel();
      }
      try { renderSiparisBildirimBar(); } catch(e) {}
    }
  );
  // ── Analytics ─────────────────────────────────────────────────
  if(window._analyticsUnsub) window._analyticsUnsub();
  window._analyticsUnsub = _safeListener(
    'analytics',
    () => collection(_db, 'analytics'),
    snap => {
      window._fbAnalytics = {};
      snap.docs.forEach(d => { window._fbAnalytics[d.id] = d.data(); });
    }
  );

  // Sessions listener (admin eş zamanlı oturum izleme)
  _startSessionListener();

  // --- YENİ: Live Baskets Listener ---
  // Admin: tüm sepetleri dinle | Personel: sadece kendi sepetini dinle (güvenlik + performans)
  if(window._liveBasketsUnsub) window._liveBasketsUnsub();
  if (isAdmin()) {
    window._liveBasketsUnsub = onSnapshot(
      collection(_db, 'live_baskets'),
      snap => {
        window._liveBaskets = {};
        snap.docs.forEach(d => { window._liveBaskets[d.id] = d.data(); });
        const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
        if (adminOpen) {
          const activeTab = document.querySelector('.admin-tab.active')?.dataset?.tab;
          if (activeTab === 'sepetler') renderSepetDetay();
        }
      },
      err => console.warn('live_baskets listener:', err)
    );
  } else {
    // Personel: sadece kendi dokümanını dinle
    const _myEmail = currentUser?.Email;
    if (_myEmail) {
      window._liveBasketsUnsub = onSnapshot(
        doc(_db, 'live_baskets', _myEmail),
        snap => {
          if (!window._liveBaskets) window._liveBaskets = {};
          if (snap.exists()) window._liveBaskets[_myEmail] = snap.data();
          else delete window._liveBaskets[_myEmail];
        },
        err => console.warn('live_baskets listener (personel):', err)
      );
    }
  }

  // ── Motd (Kayan Yazı) + Karşılama Metni Listener ─────────────
  onSnapshot(
    query(_colMotd(), orderBy('ts', 'desc')),
    snap => {
      _motdMessages = snap.docs
        .filter(d => d.id !== '_greeting')          // greeting ayrı belge
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(m => m.aktif !== false);

      // Karşılama metnini güncelle
      const greetingDoc = snap.docs.find(d => d.id === '_greeting');
      if (greetingDoc) {
        const g = greetingDoc.data().metin || '';
        localStorage.setItem(_GREETING_KEY, g);     // lokal cache
      }

      _startMotdTicker();
    },
    err => console.warn('motd listener:', err)
  );

  // ── Vitrin (Kampanya Ürünleri) Listener ──────────────────
  onSnapshot(
    query(_colVitrin(), orderBy('ts', 'desc')),
    snap => {
      _vitrinUrunler = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(v => v.aktif !== false);
      // Canlı güncelle
      if (typeof renderTrendFullList === 'function') renderTrendFullList();
      if (typeof renderTrendCards === 'function') renderTrendCards();
      if (typeof renderAdminVitrinList === 'function') renderAdminVitrinList();
    },
    err => console.warn('vitrin listener:', err)
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
let _campAraFilter  = null; // { grup, esik, excludeRol } — camp-ara-btn filtresi
let discountAmount  = 0, discountType = 'TRY';
let currentUser     = JSON.parse(localStorage.getItem('aygun_user')) || null;
let currentVersion  = '...';
let showZeroStock   = false;
let abakusSelection = null;

// ── iOS Performans ──────────────────────────────────────────────
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
if (isIOS) document.body.classList.add('ios-performance');

// iOS pagination state
const IOS_PAGE_SIZE = 50;
let _iosCurrentPage  = 1;   // her arama sıfırlanır
let _iosFilteredData = [];   // son filtrelenmiş veri (Daha Fazla için)

// ✅ YENİ: Funnel analiz cooldown
let _lastFunnelLoadTime = 0;
let _isFunnelLoading = false;

// ✅ YENİ: Visibility throttle için global değişken
let _sonGorunurlukKontrol = 0;
let _visibilityHandlerAttached = false;

// Yerel depolar — Firebase listener gelene kadar localStorage'dan yükle
let proposals = JSON.parse(localStorage.getItem('aygun_proposals')) || [];
let sales     = JSON.parse(localStorage.getItem('aygun_sales'))     || [];
let messages  = [];
let _motdMessages  = []; // Admin tarafından girilen kayan yazılar
let _vitrinUrunler = []; // Admin tarafından eklenen vitrin/kampanya ürünleri
// ─── Arama kutusu karşılama metni ────────────────────────────────────────────
// Admin panelinden (Kayan Yazı sekmesi) yönetilir — localStorage'da saklanır.
// Admin bir değer girmezse sadece "Ürün arama" gösterilir.
const _GREETING_KEY = 'aygun_greeting';
function _getGreeting() {
  return localStorage.getItem(_GREETING_KEY) || '';
}
// ─────────────────────────────────────────────────────────────────────────────

// Admin Fiyat Override Haritası — sayfa yüklenince localStorage'dan restore et
// _adminOverrides: fiyat override mekanizması devre dışı — kullanılmıyor (v-next için)
window._adminOverrides = (() => {
  try { return JSON.parse(localStorage.getItem('aygun_admin_overrides') || '{}'); }
  catch(e) { return {}; }
})();

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
// BASKET STATE MANAGER
// Tüm sepet değişikliği bu fonksiyonlardan geçer.
// Doğrudan basket.push / basket.splice YAPMA.
// Yan etkiler (save, UI, log, timer) burada yönetilir.
// ═══════════════════════════════════════════════════════════════
const Basket = {

  // Ürün ekle
  async add(item, productIdx) {
    basket.push(item);
    if (basket.length === 1) {
      logSepet('session_basla', 0, null).catch(e=>console.warn('logSepet:',e));
      resetSessionTimer();
    }
    logSepet('ekle', item.nakit || 0, item.urun || '').catch(e=>console.warn('logSepet:',e));
    if (_intentLevel >= 1 && _intentLevel < 2) _intentLevel = 2;
    this._sync();
  },

  // Tek ürün çıkar (index)
  removeAt(idx) {
    const removed = basket[idx];
    if (!removed) return null;
    logSepet('cikar', removed.nakit || 0, removed.urun || null).catch(()=>{});
    basket.splice(idx, 1);
    // Kampanya seçimlerini sonraki item'lardan temizle (index kaydı)
    basket.forEach(item => { item._campaigns = null; item._selectedCamps = {}; });
    this._sync();
    return removed;
  },

  // Çoklu çıkar (index listesi — büyükten küçüğe sıralı olmalı)
  removeMany(indices) {
    indices.forEach(idx => {
      const removed = basket[idx];
      if (removed) logSepet('cikar', removed.nakit || 0, removed.urun || null);
      basket.splice(idx, 1);
    });
    this._sync();
  },

  // Satır indirimi güncelle — kampanya indirimi (_campDisc) korunur
  setItemDisc(idx, val) {
    if (!basket[idx]) return;
    const campDisc  = basket[idx]._campDisc || 0;
    const manuelVal = Math.max(0, parseFloat(val) || 0);
    basket[idx].itemDisc = campDisc + manuelVal;
    this._sync();
  },

  // Sepet index kaydığında (silme işlemi) kampanya state'ini güncelle
  // _shiftCampaignState: kaldırıldı (kullanılmıyordu)

  // Sepeti temizle (bypass = log yazmadan)
  clear(bypass = false) {
    if (bypass) { _doClearBasket(); return; }
    // Akış clearBasket() fonksiyonuna devredilir
    window.clearBasket();
  },

  // Ürün toplamları — ALT TOPLAM METODU
  // Liste bazı (override veya nakit) + ❖ proje farkı
  totals() {
    return basket.reduce((t, i) => {
      t.dk    += i.dk    || 0;
      t.awm   += i.awm   || 0;
      t.tek   += i.tek   || 0;

      // Liste bazı: override varsa override, yoksa ham nakit
      const listeBase = i._nakitOverride !== undefined ? i._nakitOverride : (i.nakit || 0);
      t.nakit    += listeBase;
      t.nakitNet += listeBase;

      // ❖ proje farkı (+ veya -) yalnızca NET'e eklenir
      if (i._projeNakit !== undefined) {
        t.nakitNet += (i._projeNakit - listeBase);
      }

      return t;
    }, { dk:0, awm:0, tek:0, nakit:0, nakitNet:0 });
  },

  // Satır indirimi toplamı
  totalItemDisc() {
    return basket.reduce((s, i) => s + (i.itemDisc || 0), 0);
  },

  // İndirim sonrası nakit (NET)
  nakitNet() {
    const t = this.totals();
    const itemDisc = this.totalItemDisc();
    const base = t.nakitNet - itemDisc;   // NET = proje/override/nakit karışımı - satır ind.
    return Math.max(0, base - getDisc(base));
  },

  // Sync: kaydet + UI güncelle
  _sync() {
    saveBasket();
    updateCartUI();
  }
};

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

// ─── EventBus Dinleyicileri ──────────────────────────────────────
EventBus.on(EV.CART_UPDATED, ({ basket }) => {
  // Sepet değişince: Özet sekmesi açıksa sepet analizini güncelle
  const adminOpen   = document.getElementById('admin-modal')?.classList.contains('open');
  const activeTab   = document.querySelector('.admin-tab.active')?.dataset?.tab;
  if (adminOpen && activeTab === 'overview') {
    const konteyner = document.getElementById('analiz-konteynir');
    if (konteyner) _renderSepetAnalizHeatmap();
  }
});

EventBus.on(EV.CART_CLEARED, () => {
  const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
  const activeTab  = document.querySelector('.admin-tab.active')?.dataset?.tab;
  if (adminOpen && activeTab === 'sepetler') renderSepetDetay();
});

EventBus.on(EV.PROPOSAL_CHANGED, () => {
  updateProposalBadge();
  const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
  const activeTab  = document.querySelector('.admin-tab.active')?.dataset?.tab;
  if (adminOpen && activeTab === 'overview') renderAdminPanel();
});

document.addEventListener('DOMContentLoaded', () => {
  // ── Camp ara butonları — event delegation ──────────────────
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('.camp-ara-btn');
    if (!btn) return;
    e.stopPropagation();
    const grup       = btn.dataset.grup      || '';
    const esik       = parseInt(btn.dataset.esik || '2');
    const excludeRol = btn.dataset.excludeRol || '';
    if (!grup) return;
    _campAraFilter = { grup, esik, excludeRol };
    // Haptic + sepeti kapat
    if (typeof haptic === 'function') haptic(30);
    const cm = document.getElementById('cart-modal');
    if (cm) { cm.classList.remove('open'); cm.style.display='none'; }
    if (typeof switchMainTab==='function') {
      // Arama kutusunu TEMİZLE — grup kodu yazmak text-search'ü de tetikler
      // ve kampanya grup adı ürün modeliyle eşleşmeyince liste boşalır.
      const s = document.getElementById('search');
      if (s) s.value = '';
      switchMainTab('urunler');
      setTimeout(function(){ if(typeof filterData==='function') filterData(); }, 60);
    } else {
      if (typeof _aktifMainTab!=='undefined') _aktifMainTab='urunler';
      const tu=document.getElementById('tab-urunler'), tt=document.getElementById('tab-trend');
      if(tu) tu.style.display='block'; if(tt) tt.style.display='none';
      setTimeout(function(){
        const s=document.getElementById('search'); if(s) s.value='';
        if(typeof filterData==='function') filterData();
      }, 60);
    }
  });


  const passInput = document.getElementById('pass-input');
  if (passInput) passInput.addEventListener('keydown', e => {
    if (e.key==='Enter') checkAuth();
  });
  if (currentUser) {
    showApp();
    loadData();
  }
  
  // [DÜZELTME-3] Tek birleşik visibilitychange handler — çakışma önlendi.
  // hidden  → session datasını localStorage'a yaz + buluta kaydet (sepet doluysa)
  // visible → throttle (30 sn) ile fetchLiveBasket (guard: sadece sepet boşsa yükler)
  document.addEventListener('visibilitychange', async () => {
    try {
      if (document.visibilityState === 'hidden') {
        // Kaçış koruma yazımı
        if (basket.length > 0) {
          localStorage.setItem('_sd', JSON.stringify({
            searches:       _sessionData.searches       || [],
            revealedPrices: _sessionData.revealedPrices || [],
            startTime:      _sessionData.startTime
          }));
          saveBasket();
        }

      } else if (document.visibilityState === 'visible' && currentUser && _db) {
        const simdi = Date.now();
        if (simdi - _sonGorunurlukKontrol < 15000) {
          console.log('⏸️ Visibility throttle: 15 saniye geçmedi, atlanıyor.');
          return;
        }
        _sonGorunurlukKontrol = simdi;
        console.log('🔄 Sayfa görünür oldu, sepet kontrol ediliyor...');
        await fetchLiveBasket();
      }
    } catch (err) {
      console.warn('Visibility kontrolü hatası:', err);
    }
  });
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

  // Geçerlilik tarihi: teklifteki sureBitis varsa onu kullan, yoksa +3 gün
  const expDateObj = p.sureBitis
    ? new Date(p.sureBitis)
    : (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d; })();
  const expDate = String(expDateObj.getDate()).padStart(2, '0') + '.' +
                  String(expDateObj.getMonth() + 1).padStart(2, '0') + '.' +
                  String(expDateObj.getFullYear()).slice(-2);

  const urunList = (p.urunler || []).map(i => '  - ' + i.urun).join('\n');

  const pTotalItemDisc = (p.urunler || []).reduce((s, u) => s + (u.itemDisc || 0), 0);
  const pAltIndirim    = p.indirim || 0;
  const pEkIndirim     = Number(p.ekIndirim || 0);  // pazarlık indirimi
  const pToplamIndirim = pTotalItemDisc + pAltIndirim;

  let indirimMetni = '';
  if (pToplamIndirim > 0 || pEkIndirim > 0) {
    indirimMetni = '\n_İndirimler -' + fmt(pToplamIndirim)
      + (pEkIndirim > 0 ? ' + Pazarlık -' + fmt(pEkIndirim) : '') + '_';
  }

  // WA'da görünen fiyat = p.nakit (kaydedilen tahsilat — zaten ekIndirim düşülmüş)
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


// ═══════════════════════════════════════════════════════════════════════════
// 🏛️  TEKLİF DURUM MAKİNESİ  (State Machine)
// ═══════════════════════════════════════════════════════════════════════════
// Geçerli geçişler — hatalı geçişler sessizce engellenir
const PROP_TRANSITIONS = {
  bekliyor:   ['satisDondu', 'iptal', 'sureDoldu'],
  sureDoldu:  ['iptal'],           // süresi dolmuş teklif sadece iptal edilebilir
  satisDondu: [],                  // terminal — değiştirilemez
  iptal:      [],                  // terminal — değiştirilemez
};

function _propTransitionAllowed(current, next) {
  return (PROP_TRANSITIONS[current] || []).includes(next);
}

// ── İstemci tarafında süre kontrolü (Firebase yazma harcamaz) ──────────────
// Periyodik checkExpiredProposals() setInterval çağrısının yerini alır.
// Render sırasında çağrılır; yalnızca kullanıcı o teklife ilk kez
// dokunduğunda (veya render'da) Firebase'e durumu yazar.
function isExpired(p) {
  return p.durum === 'bekliyor' && !!p.sureBitis && new Date(p.sureBitis) < new Date();
}

// Süresi dolmuş tek teklifi Firebase'e (lazy) işaretle
async function _lazyMarkExpired(id) {
  const idx = proposals.findIndex(p => p.id === id);
  if (idx === -1) return;
  const p = proposals[idx];
  if (!isExpired(p)) return;
  if (!_propTransitionAllowed(p.durum, 'sureDoldu')) return;
  proposals[idx].durum      = 'sureDoldu';
  proposals[idx].archivedAt = new Date().toISOString();
  proposals[idx].iptalNedeni = 'Sadece Bilgi Aldı'; // Süresi dolan → bilgi amaçlıydı
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  await fbUpdateProp(id, {
    durum: 'sureDoldu',
    archivedAt: proposals[idx].archivedAt,
    iptalNedeni: 'Sadece Bilgi Aldı',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 🧹  JANITOR  — Toplu Temizlik (YALNIZCA Admin, haftada bir)
// ═══════════════════════════════════════════════════════════════════════════
// Her kullanıcı girişinde tetiklemek yerine Admin panelindeki butona ve
// "bu cihazda son 7 gün içinde yapılmadı" koşuluna bağladık.
// Böylece Firestore silme kotası korunur.
const _JANITOR_KEY = 'aygun_janitor_last';
const _JANITOR_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün

async function runJanitor({ force = false } = {}) {
  if (!currentUser || !_db) return { deleted: 0, skipped: true };
  if (!isAdmin()) return { deleted: 0, skipped: true };

  const lastRun = parseInt(localStorage.getItem(_JANITOR_KEY) || '0', 10);
  const now     = Date.now();
  if (!force && now - lastRun < _JANITOR_INTERVAL_MS) {
    const days = Math.round((now - lastRun) / 86400000);
    return { deleted: 0, skipped: true, msg: `Son temizlik ${days} gün önce yapıldı.` };
  }

  const birAyOnce   = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const birHaftaOnce = new Date(now -  7 * 24 * 60 * 60 * 1000).toISOString();
  const silinecekler = proposals.filter(p => {
    if (!p.archivedAt) return false;
    // Satış/İptal → 1 hafta sonra sil; Süre Doldu → 1 ay sonra sil
    if (p.durum === 'satisDondu' || p.durum === 'iptal') return p.archivedAt < birHaftaOnce;
    return p.archivedAt < birAyOnce;
  });

  if (!silinecekler.length) {
    localStorage.setItem(_JANITOR_KEY, String(now));
    return { deleted: 0, skipped: false };
  }

  await Promise.all(silinecekler.map(p => fbDeleteProp(p.id).catch(() => {})));
  proposals = proposals.filter(p => !silinecekler.find(s => s.id === p.id));
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  localStorage.setItem(_JANITOR_KEY, String(now));
  console.log(`🧹 Janitor: ${silinecekler.length} eski teklif silindi.`);
  return { deleted: silinecekler.length, skipped: false };
}

// Admin UI — Janitor butonunu tetikle
async function adminRunJanitor() {
  const res = await runJanitor({ force: true });
  if (res.skipped && res.msg) { await ayAlert(`ℹ️ ${res.msg}`); return; }
  await ayAlert(res.deleted > 0
    ? `🧹 ${res.deleted} eski teklif kalıcı olarak silindi.`
    : '✅ Silinecek eski teklif yok (30 gün sınırı).');
  renderArchivedProposals();
}

async function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-content').style.display = 'block';
  const ab = document.getElementById('admin-btn');
  if (ab) ab.style.display = isAdmin() ? 'flex' : 'none';

  // ── Tab bar butonları ──
  // Admin butonu: sadece admin
  const tabAdminBtn = document.getElementById('tab-btn-admin');
  if (tabAdminBtn) tabAdminBtn.style.display = isAdmin() ? 'flex' : 'none';

  // Sepet: HERKESe görünür
  const tabSepetBtn = document.getElementById('tab-btn-sepet');
  if (tabSepetBtn) tabSepetBtn.style.display = 'flex';

  // Teklifler: HERKESe görünür
  const tabTeklifBtn = document.getElementById('tab-btn-teklifler');
  if (tabTeklifBtn) tabTeklifBtn.style.display = 'flex';

  // Stok filtresi: HERKESe görünür
  const tabStokBtn = document.getElementById('tab-btn-stok');
  if (tabStokBtn) { tabStokBtn.style.display = 'flex'; tabStokBtn.id = 'stock-filter-btn'; }

  // Performansım: sadece satis ve destek rollerine görünür
  const tabMyStatsBtn = document.getElementById('tab-btn-mystats');
  if (tabMyStatsBtn) tabMyStatsBtn.style.display = (isSahaPersonel() || isDestek()) ? 'flex' : 'none';

  // Çıkış: sadece admin DEĞİL kullanıcılar
  const lb = document.getElementById('logout-btn');
  if (lb) lb.style.display = isAdmin() ? 'none' : 'flex';
  updateProposalBadge();
  startFirebaseListeners();
  startDataPolling();
  _initStockFilterBtn();

  // ── Admin temizleme realtime listener ───────────────────────────
  // Admin panelinden sepet temizlendiğinde kullanıcı ekranı açık olsa bile
  // anında yakalanır — fetchLiveBasket'e gerek kalmaz.
  if (!isAdmin() && currentUser?.Email) {
    if (window._adminClearUnsub) window._adminClearUnsub(); // önceki listener'ı kapat
    window._adminClearUnsub = onSnapshot(
      doc(_db, 'live_baskets', currentUser.Email),
      async (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (data.cleared !== true) return;
        console.log('🗑️ [Realtime] Admin sepeti temizledi.');
        basket = [];
        _sessionData = { searches:[], revealedPrices:[], blurUrunler:{}, startTime: Date.now() };
        localStorage.removeItem('aygun_basket');
        updateCartUI();
        // Bayrağı sıfırla
        await setDoc(doc(_db, 'live_baskets', currentUser.Email), {
          items: [], cleared: false, ts: new Date()
        }).catch(() => {});
        showToast('Sepetiniz yönetici tarafından temizlendi', 'info');
      },
      (err) => console.warn('Admin clear listener hatası:', err)
    );
  }

  // Placeholder + kayan yazı — motd listener yüklendikten sonra _startMotdTicker çağrılır
  // Başlangıçta statik placeholder'ı hemen set et (listener yavaş gelebilir)
  const searchEl = document.getElementById('search');
  if (searchEl) {
    const ad = currentUser?.Ad || currentUser?.Email?.split('@')[0] || '';
    const gr = _getGreeting();
    searchEl.placeholder = (gr && ad) ? gr + ', ' + ad + ' — Ürün arama' : 'Ürün arama';
  }
  // Motd ticker'ı başlat (mesaj yoksa statik kalır)
  _startMotdTicker();

  // showApp içindeki async işlemleri ayrı try/catch ile sar —
  // herhangi biri hata fırlatırsa checkAuth'daki catch login ekranına döndürmesin.
  try { await fixMissingArchivedAt(); } catch(e) { console.warn('fixMissingArchivedAt:', e.message); }
  try { await fetchLiveBasket(); }     catch(e) { console.warn('fetchLiveBasket:', e.message); }

  // ✅ visibilitychange kodu ARTIK BURADA YOK (DOMContentLoaded içine taşındı)
}

// ─── KAYAN YAZI (MOTD) TICKER ───────────────────────────────────
// Admin panelinden girilen mesajlar search placeholder'ında kayan yazı olarak gösterilir.
// Mesaj yoksa veya kullanıcı arama kutusuna odaklanmışsa statik placeholder gösterilir.

// ─── Modül düzeyinde tek bayrak — closure birikimi önlenir ───────
let _motdTicker   = null; // Placeholder ticker interval
let _tickerPaused    = false;
let _tickerListeners = false; // event listener'lar yalnızca bir kez eklenir

function _startMotdTicker() {
  const searchEl = document.getElementById('search');
  if (!searchEl) return;

  const ad = currentUser?.Ad || currentUser?.Email?.split('@')[0] || '';
  const gr = _getGreeting();
  const staticPlaceholder = (gr && ad) ? gr + ', ' + ad + ' — Ürün arama' : 'Ürün arama';

  searchEl.placeholder = staticPlaceholder;

  // Eski ticker'ı temizle
  if (_motdTicker) { clearInterval(_motdTicker); _motdTicker = null; }

  // Event listener'ları yalnızca bir kez ekle (birikim önlenir)
  if (!_tickerListeners) {
    _tickerListeners = true;
    searchEl.addEventListener('focus', () => { _tickerPaused = true; },  { passive: true });
    searchEl.addEventListener('blur',  () => { _tickerPaused = false; }, { passive: true });
  }

  // Mesaj yoksa sadece statik placeholder
  if (!_motdMessages.length) return;

  const items = [staticPlaceholder, ..._motdMessages.map(m => '📢 ' + m.metin)];
  let idx = 0;

  _motdTicker = setInterval(() => {
    // Kullanıcı yazıyorsa, odaklanmışsa veya değer varsa geç
    if (_tickerPaused || searchEl.value || document.activeElement === searchEl) return;
    idx = (idx + 1) % items.length;
    // Opacity animasyonu KALDIRILDI — iOS Safari'de odak kaybına neden oluyordu
    searchEl.placeholder = items[idx];
  }, 4000);
}

// Admin Motd Kaydet
async function saveMotdMessage(metin, hedef) {
  if (!metin || !metin.trim()) return;
  try {
    await setDoc(doc(_db, 'motd', 'msg_' + Date.now()), {
      metin: metin.trim(),
      hedef: hedef || 'hepsi', // 'hepsi' | email
      aktif: true,
      ts: serverTimestamp(),
      yazan: currentUser?.Email || 'admin'
    });
    showToast('✅ Kayan yazı eklendi', 'success');
  } catch(e) { console.error('saveMotd:', e); ayAlert('Kaydetme hatası: ' + e.message); }
}

async function deleteMotdMessage(id) {
  try {
    await deleteDoc(doc(_db, 'motd', id));
    showToast('🗑 Kayan yazı silindi', 'info');
  } catch(e) { console.error('deleteMotd:', e); }
}

async function toggleMotdMessage(id, aktif) {
  try {
    await updateDoc(doc(_db, 'motd', id), { aktif: !aktif });
  } catch(e) { console.error('toggleMotd:', e); }
}

// Admin paneli motd yönetim render
function renderMotdPanel() {
  const el = document.getElementById('admin-motd-list');
  if (!el) return;

  // Karşılama input'unu mevcut değerle doldur
  const grInput = document.getElementById('greeting-input');
  if (grInput) {
    grInput.value = localStorage.getItem(_GREETING_KEY) || '';
    grInput.placeholder = 'En iyisiniz';
    adminGreetingPreview();
  }

  const allMotd = _motdMessages.concat(
    // aktif=false olanları da göster (sadece admin için)
  );

  // Tüm motd'leri doğrudan snapshot'tan al
  const container = el;
  if (!_motdMessages.length) {
    container.innerHTML = '<div class="admin-empty" style="padding:12px">Henüz kayan yazı yok</div>';
    return;
  }
  container.innerHTML = _motdMessages.map(m => `
    <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;font-size:.76rem;color:var(--text-1)">${m.metin}</div>
      <span style="font-size:.62rem;color:var(--text-3)">${m.hedef === 'hepsi' ? '🌍' : '👤 ' + m.hedef.split('@')[0]}</span>
      <button onclick="deleteMotdMessage('${m.id}')"
        style="background:#fee2e2;border:none;border-radius:6px;padding:3px 8px;font-size:.65rem;color:#dc2626;cursor:pointer">🗑</button>
    </div>`).join('');
}

// ── Admin: Karşılama metni kaydet / önizle ───────────────────────────────────
function adminGreetingPreview() {
  const inp = document.getElementById('greeting-input');
  const prev = document.getElementById('greeting-preview');
  if (!inp || !prev) return;
  const val = inp.value.trim() || 'En iyisiniz';
  const ad  = currentUser?.Ad || currentUser?.Email?.split('@')[0] || 'kullanıcıadı';
  prev.textContent = '👁 Önizleme: "' + val + ', ' + ad + ' — Ürün arama"';
}

async function adminGreetingSave() {
  const inp = document.getElementById('greeting-input');
  if (!inp) return;
  const val = inp.value.trim();

  try {
    // Firestore'a yaz — tüm cihazlar motd listener üzerinden alır
    await setDoc(doc(_db, 'motd', '_greeting'), {
      metin: val,
      ts: new Date(),
      updatedBy: currentUser?.Email || 'admin',
    });
    // Lokal cache de güncelle
    if (val) localStorage.setItem(_GREETING_KEY, val);
    else localStorage.removeItem(_GREETING_KEY);
    // Arama kutusunu hemen güncelle
    _startMotdTicker();
    ayAlert('✅ Karşılama metni tüm cihazlara yayıldı: "' + (val || '(kaldırıldı)') + '"');
  } catch(e) {
    ayAlert('Kaydetme hatası: ' + e.message);
    console.error('adminGreetingSave:', e);
  }
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
  try { await _checkAndRegisterSession(user.Email, user.Rol); } catch(e) { console.warn('session:', e.message); }
  try {
    await showApp();
  } catch(e) {
    console.error('showApp hatası:', e);
    // showApp hata verse bile kullanıcı içeride — login'e geri dönme
  }
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


// ─── CANLI SEPET YÜKLE + HAYALET SEPET KONTROLÜ ─────────────────
async function fetchLiveBasket() {
  if (!currentUser || !_db) return;
  if (isAdmin()) return;

  try {
    const snap = await getDoc(doc(_db, 'live_baskets', currentUser.Email));
    if (!snap.exists()) return;
    const data = snap.data();

    // ── Admin temizleme bayrağı — guard'ın ÜSTÜNDE, her zaman kontrol edilir ──
    // Sepet dolu olsa bile admin temizleyebilmeli. Guard sadece normal restore için.
    if (data.cleared === true) {
      console.log('🗑️ Admin sepeti temizledi — localStorage ve bellek temizleniyor.');
      basket = [];
      _sessionData = { searches:[], revealedPrices:[], blurUrunler:{}, startTime: Date.now() };
      localStorage.removeItem('aygun_basket');
      updateCartUI();
      await setDoc(doc(_db, 'live_baskets', currentUser.Email), {
        items: [], cleared: false, ts: new Date()
      }).catch(() => {});
      showToast('Sepetiniz yönetici tarafından temizlendi', 'info');
      return;
    }

    // [DÜZELTME-1] Aktif oturum varsa (sepet doluysa) normal restore yapma.
    if (basket.length > 0) return;

    const remote = data.basket || data.items || [];

    // ── "Zaman Yolculuğu" kontrolü: 30 dk geçmiş mi? ──────────
    if (data.lastActive) {
      const lastActiveMillis = data.lastActive.toMillis ? data.lastActive.toMillis() : new Date(data.lastActive).getTime();
      const gecenDk = (Date.now() - lastActiveMillis) / 60000;
      if (gecenDk > 30 && remote.length > 0) {
        console.log(`⏰ Hayalet sepet tespit edildi (${gecenDk.toFixed(0)} dakika), temizleniyor...`);
        // [DÜZELTME-2] basket'i belleğe yükle ama UI'ya YANSITMA —
        // önce log at, sonra temizle; kullanıcı hiç bakmadığı ürünleri görmez.
        basket = remote;
        if (data.sessionData) {
          _sessionData = { 
            ...data.sessionData, 
            blurUrunler: data.sessionData.blurUrunler || {}
          };
        }
        // updateCartUI() KALDIRILDI — sepet UI'ya yansıtılmadan temizlenir
        await logSessionResult('kacti', 'Hareketsizlik (Arka Plan)');
        if (typeof window.clearBasket === 'function') {
          window.clearBasket();
        } else if (typeof _doClearBasket === 'function') {
          _doClearBasket();
        }
        return;
      }
    }

    // 30 dk geçmemişse sepeti geri yükle (sepet zaten boştu — guard yukarıda)
    if (remote.length > 0) {
      // [DÜZELTME-4] Restore sırasında hiyerarşi guard'ı kapat
      _restoringFromCloud = true;
      basket = remote;
      if (data.sessionData) {
        _sessionData = {
          searches:       data.sessionData.searches       || [],
          revealedPrices: data.sessionData.revealedPrices || [],
          blurUrunler:    data.sessionData.blurUrunler    || {},
          startTime:      data.sessionData.startTime      || Date.now()
        };
      }
      updateCartUI();
      _restoringFromCloud = false;
      console.log('📦 Sepet buluttan geri yüklendi.');
    }
  } catch(e) { 
    console.warn('fetchLiveBasket hatası (ağ sorunu olabilir):', e.message);
  }
}

function isAdmin() {
  if (!currentUser) return false;
  // Rolü küçük harfe çevirerek karşılaştır
  const role = (currentUser.Rol || '').toLowerCase();
  return role === 'admin';
}

// ─── SEPET TİPİ YARDIMCISı ──────────────────────────────────────
// kullanicilar.json'daki "SepetTipi": "CokluFiyat" | "NakitFiyat"
// Tanımsızsa admin → NakitFiyat, diğerleri → CokluFiyat (geriye dönük uyum)
function getSepetTipi() {
  if (!currentUser) return 'CokluFiyat';
  if (currentUser.SepetTipi) return currentUser.SepetTipi;
  // Geriye dönük uyumluluk: admin varsayılan NakitFiyat, diğerleri CokluFiyat
  return isAdmin() ? 'NakitFiyat' : 'CokluFiyat';
}
function isNakitSepet() { return getSepetTipi() === 'NakitFiyat'; }

// ─── MAĞAZA TİPİ YARDIMCISı ─────────────────────────────────────
function getMagazaTipi() {
  if (!currentUser) return 'BELIRSIZ';
  return (currentUser.magazaTipi || currentUser.MagazaTipi || 'BELIRSIZ').toUpperCase();
}
function getMagazaTipiLabel() {
  const t = getMagazaTipi();
  if (t === 'AVM')   return '🏬 AVM';
  if (t === 'CARSI') return '🏪 Çarşı';
  return '❓ Belirsiz';
}
// 'destek' rolü: satis kullanıcısıyla aynı yetkiler + admin paneli görmez funnel'de ayrı sayılır
function isDestek() {
  if (!currentUser) return false;
  return currentUser.Rol === 'destek';
}
// Saha personeli: sadece 'satis' rolü — funnel analizinde asıl ölçülen grup
function isSahaPersonel() {
  if (!currentUser) return false;
  return currentUser.Rol === 'satis';
}
// Funnel analizinde rol belirleme
function getFunnelRol() {
  if (!currentUser) return 'saha';
  if (currentUser.Rol === 'satis') return 'saha';
  if (currentUser.Rol === 'destek') return 'destek';
  if (currentUser.Rol === 'admin') return 'admin';
  return 'saha';
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
    // Trend ve kategori panellerini hazırla
    setTimeout(() => {
      try { renderTrendCards(); } catch(e) {}
      try { renderKategoriGrid(); } catch(e) {}
    }, 800); // analytics verisinin gelmesi için küçük gecikme
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

  // ── Kullanıcı verilerini tazele (Istisna vb. admin değişikliklerini yansıt) ──
  // Oturum açıkken kullanicilar.json güncellenmiş olabilir (yeni alan eklenmesi,
  // Istisna, MagazaTipi vb.). localStorage'daki eski currentUser'ı taze veriyle eş tut.
  if (currentUser?.Email) {
    try {
      const kResp = await fetch(dataUrl('kullanicilar.json')+'?v='+Date.now());
      if (kResp.ok) {
        let kullanicilar = safeJSON(await kResp.text());
        if (!Array.isArray(kullanicilar)) kullanicilar = kullanicilar.data || [];
        const freshUser = kullanicilar.find(u =>
          u.Email && u.Email.toLowerCase().trim() === currentUser.Email.toLowerCase().trim()
        );
        if (freshUser) {
          // Hassas alanları güncelle ama oturumu koru
          currentUser = { ...currentUser, ...freshUser };
          // Beni Hatırla seçiliyse localStorage'ı da güncelle
          if (localStorage.getItem('aygun_user')) {
            localStorage.setItem('aygun_user', JSON.stringify(currentUser));
          }
        }
      }
    } catch(e) { console.warn('kullanicilar.json yenilemesi:', e.message); }
  }
}

// ─── TABLO ──────────────────────────────────────────────────────

// ─── FİYAT GÖSTER — Blur Açma + Oturum Takibi ──────────────────
// Her ürün için 4 blur var (dk/awm/tek/nakit) — ürün başına 1 sayılır
function _fyGos(el) {
  if (!el) return;
  fiyatGoster(el, el.dataset.urun || '', parseFloat(el.dataset.fiyat) || 0);
}

function fiyatGoster(el, urunAdi, fiyat) {
  if (!el) return;
  el.textContent = fiyat ? fmt(fiyat) : '—'; // fmt() iOS-safe
  el.classList.remove('price-blur');
  el.style.cursor = 'default';
  el.removeAttribute('onclick');

  // Tekil sayım — aynı ürünün 4 fiyatından biri açıldıysa yeterli
  // blurUrunler bir obje (Set gibi) — aynı ürün tekrar sayılmaz
  const urunKey = urunAdi || '_';
  if (_sessionData.blurUrunler && !_sessionData.blurUrunler[urunKey]) {
    _sessionData.blurUrunler[urunKey] = true;
    // benzersizBlurSayisi: Object.keys(_sessionData.blurUrunler).length ile türetilir — funnel_logs'a bu yazılır
    if (!_sessionData.revealedPrices.includes(urunAdi))
      _sessionData.revealedPrices.push(urunAdi);
    localStorage.setItem('_sd', JSON.stringify({
      searches:       _sessionData.searches       || [],
      revealedPrices: _sessionData.revealedPrices || [],
      startTime:      _sessionData.startTime
    }));
    // Firebase'e anlık "bakılan fiyat" logu — sepet boş olsa bile kayıt
    if (currentUser && _db) {
      setDoc(doc(_db, 'fiyat_bakislari', currentUser.Email), {
        personelId:   currentUser.Email,
        personelAd:   currentUser.Ad || currentUser.Email.split('@')[0],
        lastSeen:     serverTimestamp(),
        revealedPrices: _sessionData.revealedPrices
      }, {merge: true}).catch(() => {});
      // Günlük blur sayacı
      incrementDailyStat('blur_sayisi', 1).catch(() => {});
    }
  }

  // Son blur'lanan ürünü kaydet (Abaküs eşleme için)
  // el.dataset.idx renderTable'da yok; allProducts üzerinden eşle
  const _blurIdx = allProducts.findIndex(p => {
    const k = Object.keys(p).find(kk => norm(kk) === 'urun');
    return k && p[k] === urunAdi;
  });
  if (_blurIdx >= 0) {
    _lastBlurredIndex = _blurIdx;
    _lastBlurredName  = urunAdi;
  }
  // Bu oturumda blur açılan tüm ürünler (Abaküs çoklu seçim için)
  if (urunAdi && _blurIdx >= 0) _blurredThisSession[urunAdi] = _blurIdx;

  // Intent Level 1: İlk blur
  if (_intentLevel < 1) _intentLevel = 1;

  // Sepet boşken blur açıldı → gizli oturum başlat
  if (basket.length === 0) {
    if (!_blurSessionActive) {
      _blurSessionActive = true;
      _blurSessionUrunler = {};
    }
    _blurSessionUrunler[urunKey] = true;
  }

  // Aktivite → timer sıfırla
  if (basket.length > 0 && typeof resetSessionTimer === 'function') resetSessionTimer();
}

// ─── 1 SAATLİK İNAKTİVİTE ZAMANLAYICISI ────────────────────────
// Sepet doluyken 1 saat boyunca hiçbir işlem yapılmazsa
// sepet otomatik boşaltılır ve "Sadece Bilgi Aldı" olarak loglanır.

let _idleTimer = null;
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 saat

function resetSessionTimer() {
  if (!basket.length) return; // Sepet boşsa timer çalışmasın
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(async () => {
    if (!basket.length) return; // Timer tetiklenirken sepet zaten boşalmış olabilir
    console.log('⏰ 1 saat hareketsizlik — sepet otomatik boşaltılıyor (Sadece Bilgi Aldı)');
    try {
      await logSessionResult('kacti', 'Sadece Bilgi Aldı');
    } catch(e) { console.warn('idle log hatası:', e); }
    _doClearBasket();
    // Kullanıcıya sessiz bildirim (toast)
    showToast('⏰ 1 saat hareketsizlik — sepet temizlendi', 'info');
  }, IDLE_TIMEOUT_MS);
}

function stopSessionTimer() {
  clearTimeout(_idleTimer);
  _idleTimer = null;
}

// ─── GLOBAL AKTİVİTE DİNLEYİCİSİ ───────────────────────────────
// Her tıklama = aktivite — hareketsizlik sayacını sıfırlar
document.addEventListener('click', function _activityListener(e) {
  if (basket.length > 0 && typeof resetSessionTimer === 'function') {
    resetSessionTimer();
  }
}, { passive: true, capture: false });

// ─── KAÇIŞ KORUMASI ─────────────────────────────────────────────
// [DÜZELTME-3] Bu handler DOMContentLoaded içindeki birleşik
// visibilitychange handler'a taşındı — çift kayıt / çakışma önlendi.

// Debounce timer — sadece bir kez tanımlanır
let _searchDebounce;

function filterData() {
  // Arama kaydı (session takibi için) — debounce öncesi hemen yap
  const val = document.getElementById('search').value.trim();

  // Clear butonu görünürlüğü
  const clrBtn = document.getElementById('search-clear-btn');
  if (clrBtn) clrBtn.style.display = val.length > 0 ? 'flex' : 'none';
  if (val.length > 2 && _sessionData && !_sessionData.searches.includes(val))
    _sessionData.searches.push(val);
  if (basket.length > 0 && typeof resetSessionTimer === 'function') resetSessionTimer();

  // Trend panel: arama başlayınca gizle, temizlenince göster
  const trendPanel = document.getElementById('trend-panel');
  if (trendPanel) {
    if (val.length > 0) trendPanel.classList.add('search-active');
    else trendPanel.classList.remove('search-active');
  }
  // Arama başlayınca tüm ürünler sekmesine geç
  if (val.length > 0 && _aktifMainTab !== 'urunler') switchMainTab('urunler');

  // iOS: sayfa sıfırla (yeni arama = baştan başla)
  if (isIOS) _iosCurrentPage = 1;

  // iOS: debounce ile gereksiz render'ı önle (300ms)
  // Android/Chrome: anlık render (0ms gecikme)
  const delay = isIOS ? 300 : 0;
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => renderTable(val), delay);
}

// ── Telefon numarası normalize ───────────────────────────────────────────────
// Yapıştırılan formatları otomatik 05XXXXXXXXX (11 hane) formatına çevirir:
//   +90 532 111 22 33  →  05321112233
//   0090 532 111 22 33 →  05321112233
//   0532 111 22 33     →  05321112233
//   532 111 22 33      →  05321112233  (başına 0 eklenir)
function normalizePhoneInput(el) {
  let raw = el.value;

  // Sadece rakam + + karakterleri bırak
  let digits = raw.replace(/[^\d+]/g, '');

  // +90 veya 0090 önekini kaldır
  if (digits.startsWith('+90')) {
    digits = '0' + digits.slice(3);
  } else if (digits.startsWith('0090')) {
    digits = '0' + digits.slice(4);
  } else if (digits.startsWith('90') && digits.length === 12) {
    // 905321112233 formatı
    digits = '0' + digits.slice(2);
  }

  // Sadece rakam bırak
  digits = digits.replace(/\D/g, '');

  // 10 haneli ise (5XX ile başlıyorsa) başına 0 ekle
  if (digits.length === 10 && digits[0] === '5') {
    digits = '0' + digits;
  }

  // Maksimum 11 hane
  digits = digits.slice(0, 11);

  // Input'a yaz (cursor pozisyonunu korumaya gerek yok — tel input)
  el.value = digits;
}

function clearMainSearch() {
  const el = document.getElementById('search');
  if (!el) return;
  el.value = '';
  el.focus();
  filterData();
}

function renderTable(searchVal) {
  const kws = norm(searchVal||'').split(' ').filter(k=>k.length>0);

  // Tüm ürünleri filtrele
  let data = allProducts.filter(u => {
    if (!showZeroStock && (Number(u.Stok)||0)===0) return false;
    if (!kws.length) return true;
    return kws.every(kw => norm(Object.values(u).join(' ')).includes(kw));
  });

  // ── Kampanya ara filtresi ─────────────────────────────────
  // Spread kopya YAPMA — allProducts.indexOf(u) bozulur → addToBasket(-1)
  let _campAraFiltered = false;
  if (_campAraFilter) {
    const { grup: cfGrup, esik: cfEsik, excludeRol } = _campAraFilter;
    // Yeni format regex: "ANK -7600(3/C)"
    const campReNew = /([A-ZÇŞĞÜÖİa-zçşğüöı0-9_+]+)\s+[-–]?\s*[\d.,]+[kK]?\s*\((\d+)\/([A-Z])\)/gi;
    data = data.filter(u => {
      const ac = u['Açıklama'] || '';
      if (!ac || ac === '-') return false;

      // ① Yeni format dene
      campReNew.lastIndex = 0;
      let m;
      while ((m = campReNew.exec(ac)) !== null) {
        if (m[1].toUpperCase() === cfGrup && parseInt(m[2]) === cfEsik) {
          const rol = m[3].toUpperCase();
          if (rol === excludeRol) return false;
          u._campAraRol = rol;
          return true;
        }
      }

      // ② Eski format dene — parseCampaigns ile (ANKSET, KEA-3k vb.)
      if (typeof parseCampaigns === 'function') {
        const camps = parseCampaigns(ac);
        for (const c of camps) {
          if ((c.grup||'').toUpperCase() === cfGrup &&
              (cfEsik <= 1 || c.esik === cfEsik)) {
            const rol = (c.rol || 'ANY').toUpperCase();
            if (rol !== 'ANY' && rol === excludeRol) return false;
            u._campAraRol = rol !== 'ANY' ? rol : '';
            return true;
          }
        }
      }

      return false;
    });
    _campAraFilter   = null;
    _campAraFiltered = true;
  }

  // ── iOS Pagination ──────────────────────────────────────────
  // Tam listeyi sakla (Daha Fazla Yükle butonu için)
  _iosFilteredData = data;
  if (isIOS && data.length > IOS_PAGE_SIZE) {
    data = data.slice(0, _iosCurrentPage * IOS_PAGE_SIZE);
  }
  // ───────────────────────────────────────────────────────────

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
      if      (primVal >= 400) primCls = 'prim-platin';
      else if (primVal >= 200) primCls = 'prim-altin';
      else if (primVal >= 100) primCls = 'prim-gumus';
      else if (primVal >= 31)  primCls = 'prim-bronz';
      else                     primCls = 'prim-low';
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
      '<td><span class="product-name">' + (u[urunKey]||'') + '</span>' + (u._campAraRol ? _rolRozetHTML(u._campAraRol) : '') + (u[descKey]?'<span class="product-desc">'+u[descKey]+'</span>':'') + '</td>' +
      '<td class="' + sc + '">' + stok + '</td>' +
      (isSahaPersonel() || isDestek()
        ? ('<td class="td-price price-blur td-nakit-wrap" data-urun="' + (u[urunKey]||'').replace(/"/g,'&quot;') + '" data-fiyat="' + (u.Nakit||0) + '" onclick="_fyGos(this)">Göster</td>' +
           '<td class="td-qf-cell"><button class="btn-qf haptic-btn" onclick="event.stopPropagation();openQuickFinance(' + oi + ',' + (u.Nakit||0) + ')" title="Taksit/Kredi Hesapla">💳</button></td>')
        : ('<td class="td-price">' + fmt(u.Nakit) + '</td>' +
           '<td class="td-qf-cell"><button class="btn-qf haptic-btn" onclick="event.stopPropagation();openQuickFinance(' + oi + ',' + (u.Nakit||0) + ')" title="Taksit/Kredi Hesapla">💳</button></td>')) +
      '<td style="font-size:.67rem;color:var(--text-3)">' + (u.Kod||'') + '</td>' +
      '<td class="td-gam">' + (u[gamKey]||'-') + '</td>' +
      '<td class="td-marka">' + (u.Marka||'-') + '</td>' +
      '<td class="td-etiket">' + (u['Etiket Fiyatı']?fmt(u['Etiket Fiyatı']):'-') + '</td>' +
      '<td><button class="siparis-btn haptic-btn" onclick="openSiparisNotSafe(' + oi + ')" title="Siparis Notu Ekle">📦</button></td>';
    frag.appendChild(tr);
  });
  list.appendChild(frag);

  if (_campAraFiltered) {
    data.forEach(u => { delete u._campAraRol; });
    _campAraFiltered = false;
  }

  // ── iOS: "Daha Fazla Yükle" butonu ──────────────────────────
  if (isIOS && _iosFilteredData.length > _iosCurrentPage * IOS_PAGE_SIZE) {
    const remaining = _iosFilteredData.length - _iosCurrentPage * IOS_PAGE_SIZE;
    const loadMoreRow = document.createElement('tr');
    loadMoreRow.innerHTML = `<td colspan="12" style="text-align:center;padding:14px 10px;">
      <button onclick="iosLoadMore()" style="
        background:#1C1C1E;color:#fff;border:none;border-radius:10px;
        padding:10px 24px;font-family:inherit;font-size:.78rem;font-weight:700;
        cursor:pointer;transition:all .12s;letter-spacing:.01em;">
        ⬇ Daha Fazla Yükle <span style="opacity:.6;font-weight:400">(${remaining} ürün daha)</span>
      </button>
    </td>`;
    list.appendChild(loadMoreRow);
  }
  // ─────────────────────────────────────────────────────────────
}

// iOS: sayfalama — mevcut sayfayı artır ve tabloyu yeniden çiz
function iosLoadMore() {
  _iosCurrentPage++;
  const val = document.getElementById('search')?.value?.trim() || '';
  renderTable(val);
  // Yeni eklenen satırlara scroll et
  requestAnimationFrame(() => {
    const rows = document.querySelectorAll('#product-list tr');
    const targetIdx = (_iosCurrentPage - 1) * IOS_PAGE_SIZE;
    if (targetIdx < rows.length && rows[targetIdx]) rows[targetIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
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
  const n = parseFloat(val);
  if (isNaN(n)) return (val || '-');
  // iOS Safari bazı sürümlerinde toLocaleString('tr-TR') yanlış sembol döndürür
  // Güvenli yol: manuel binlik ayırıcı + _tlSym() ile cross-browser TL sembolü
  const abs = Math.abs(Math.round(n));
  const str = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + str + '\u00a0' + _tlSym();
}
// ─── TL SEMBOLÜ — cross-browser ─────────────────────────────────
// '+_tlSym()+' (U+20BA) Samsung Internet dahil eski/nadir browserlarda görünmeyebilir.
// _tlSym() tarayıcı desteğini test ederek güvenli fallback döndürür.
const _tlSymCache = '₺'; // 2026: tüm cihazlar ₺ destekliyor
function _tlSym() { return _tlSymCache; }

// ── XSS Koruma: Kullanıcı/veri kaynaklı metinleri HTML'e güvenli yazmak için
function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


// Firestore Timestamp / ISO string / Date → 'YYYY-MM-DD' güvenli dönüşüm
function _tarih(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.slice(0, 10);
  if (val.toDate) return val.toDate().toISOString().slice(0, 10);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return '';
}

function yuvarlaCeyrek(n) { return Math.ceil(n / 250) * 250; }

function yuvarlaKademe(brut, nTaksit) {
  let adim;
  if (nTaksit === 1) {
    if      (brut <  1000)  adim = 25;
    else if (brut <  2500)  adim = 50;
    else if (brut <  5000)  adim = 100;
    else if (brut < 30000)  adim = 250;
    else if (brut < 75000)  adim = 500;
    else                    adim = 1000;
  } else {
    if      (brut <  1000)  adim = 25;
    else if (brut <  2500)  adim = 50;
    else if (brut <  5000)  adim = 100;
    else if (brut < 15000)  adim = 250;
    else                    adim = 500;
  }
  return Math.ceil(brut / adim) * adim;
}
function fmtDate(iso) { return new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Toast bildirim fonksiyonu
function showToast(message, type = 'info') {
  const ct = document.getElementById('change-toast');
  if (!ct) return;
  
  const colors = {
    info: { bg: '#e2e8f0', border: '#64748b', icon: 'ℹ️' },
    success: { bg: '#f0fdf4', border: '#16a34a', icon: '✅' },
    warning: { bg: '#fffbeb', border: '#f59e0b', icon: '⚠️' },
    danger: { bg: '#fef2f2', border: '#dc2626', icon: '❌' },
    revert: { bg: '#f0fdf4', border: '#16a34a', icon: '🔁' }
  };
  
  const style = colors[type] || colors.info;
  
  const el = document.createElement('div'); 
  el.className = 'toast-item';
  el.style.cssText = `background:${style.bg}; border-left:3px solid ${style.border}; margin-bottom:4px; border-radius:6px; padding:8px 12px; display:flex; align-items:center; gap:10px; font-size:.75rem;`;
  el.innerHTML = `<span style="font-size:1rem">${style.icon}</span><span style="flex:1">${message}</span>`;
  ct.appendChild(el); 
  setTimeout(() => el.remove(), 2500);
}

// Premium modal için neden panelini kapatma
function closeReasonPanel() {
  const panel = document.querySelector('.kacti-neden-panel');
  if (panel) {
    panel.style.display = 'none';
  }
  // ⚠️ DİKKAT: Burada clearBasket() veya _doClearBasket() ÇAĞIRMAYIN!
  // Sepet zaten boş olduğu için bu panel açıldı, tekrar temizlemek döngüye sokar
  console.log("🔘 Kaçış paneli kapatıldı, sepet dokunulmadı.");
}

// ─── OTURUM TAKİP (Funnel) ──────────────────────────────────────
let _sessionData = {
  searches:       [],
  revealedPrices: [],   // Blur açılan ürünler (tekil, ürün başına 1 sayılır)
  blurUrunler:    {},   // { urunAdi: true } — tekrar sayımı önler
  startTime:      null  // İlk ürün eklenince başlar
};
let _blurSessionActive  = false;
let _blurSessionUrunler = {};
let _restoringFromCloud = false; // [DÜZELTME-4] Bulut restore sırasında hiyerarşi guard'ı devre dışı bırakır

// ── Intent Scoring ──────────────────────────────────────────────
// Son blur'lanan ürünler (Abaküs eşleme + niyet skoru için)
let _lastBlurredIndex   = null;  // allProducts index'i
let _lastBlurredName    = '';    // ürün adı (confirm mesajı için)
let _blurredThisSession = {};    // { urunAdi: allProducts_index } — bu oturumda blur açılanlar
let _intentLevel        = 0;     // 0:yok 1:blur 2:blur+sepet 3:abakus 4:teklif/satis

function addToBasket(idx) {
  haptic(14);
  const p = allProducts[idx];
  
  // Yeni müşteri oturumu başlat (sepet boşken ilk ürün)
  if (basket.length === 0) {
    logAnalytics('basketSession');
    _sessionData = { searches: [], revealedPrices: [], blurUrunler: {}, startTime: Date.now() };
    localStorage.setItem('_sd', JSON.stringify(_sessionData));
    _blurSessionActive = false;
    _blurSessionUrunler = {};
  }
  // Hiyerarşi guard: fiyatı gösterilmeden eklenen ürünü blur'lanmış say.
  // [DÜZELTME-4] Buluttan restore sırasında (_restoringFromCloud=true) çalışmaz;
  // böylece temsilci bakmadığı ürünler analytics'te "baktı" görünmez.
  if (!_restoringFromCloud) {
    const _gk = Object.keys(p).find(k => (k||'').toLowerCase() === 'urun') || '';
    const _ga = p[_gk] || '';
    if (_ga && _sessionData && !_sessionData.blurUrunler[_ga]) {
      _sessionData.blurUrunler[_ga] = true;
      if (!_sessionData.revealedPrices.includes(_ga)) _sessionData.revealedPrices.push(_ga);
      if (!_blurredThisSession[_ga]) {
        const _gi = allProducts.findIndex(pr => {
          const _kk = Object.keys(pr).find(k2 => (k2||'').toLowerCase() === 'urun') || '';
          return pr[_kk] === _ga;
        });
        if (_gi >= 0) _blurredThisSession[_ga] = _gi;
      }
      localStorage.setItem('_sd', JSON.stringify(_sessionData));
    }
  }
  
  const keys = Object.keys(p);
  const urunKey = keys.find(k => norm(k) === 'urun') || '';
  const kartKey = keys.find(k => k.includes('Kart')) || '';
  const cekKey = keys.find(k => k.includes('ekim')) || '';
  const descKey = keys.find(k => norm(k) === 'aciklama') || '';
  const gamKey  = keys.find(k => norm(k).includes('gam')) || '';

  const newItem = {
    urun: p[urunKey] || '',
    stok: Number(p.Stok) || 0,
    dk: parseFloat(p[kartKey]) || 0,
    awm: parseFloat(p['4T AWM']) || 0,
    tek: parseFloat(p[cekKey]) || 0,
    nakit: parseFloat(p.Nakit) || 0,
    aciklama: p[descKey] || '-',
    kod: String(p.Kod ?? ''),
    gam: p[gamKey] || ''
  };

  logAnalytics('addToBasket', p[urunKey] || '');
  Basket.add(newItem, idx); // ✅ Basket Manager üzerinden

  // Sepeti live_baskets'e kaydet
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
  if (_sessionData.startTime) {
    localStorage.setItem('_sd', JSON.stringify({
      searches:       _sessionData.searches       || [],
      revealedPrices: _sessionData.revealedPrices || [],
      blurUrunler:    _sessionData.blurUrunler    || {},
      startTime:      _sessionData.startTime
    }));
  }
  updateCartUI();
  if (currentUser && _db) {
    const email = currentUser.Email;
    const today = new Date().toISOString().split('T')[0];
    const snap = basket.map(i => ({ urun: i.urun, nakit: i.nakit, stok: i.stok }));
    setDoc(doc(_db, 'basket_snapshots', email.replace(/[^a-zA-Z0-9]/g, '_') + '_' + today), {
      email, date: today, basketSnapshot: snap, basketTs: new Date().toISOString()
    }, { merge: true }).catch(() => {});
    
    const basketRef = doc(_db, 'live_baskets', email);
    if (basket.length === 0) {
      deleteDoc(basketRef).catch(e => console.warn('live_baskets silinemedi:', e));
    } else {
      setDoc(basketRef, {
        basket, lastActive: serverTimestamp(),
        personel: email, personelAd: currentUser.Ad || email.split('@')[0],
        funnelRol: getFunnelRol(),
        sessionData: {
          searches:       _sessionData.searches       || [],
          revealedPrices: _sessionData.revealedPrices || [],
          blurUrunler:    _sessionData.blurUrunler    || {},
          startTime:      _sessionData.startTime      || Date.now()
        }
      }, { merge: true }).catch(e => console.warn('live_baskets güncellenemedi:', e));
    }
  }
  EventBus.emit(EV.CART_UPDATED, { basket: [...basket] });
}

// =============================================================
// GEÇİCİ SİLME DEĞİŞKENLERİ (global)
// =============================================================
let _pendingDeleteIndex = null;      // Tekli silme için bekleyen index
let _pendingDeleteIndices = [];       // Toplu silme için bekleyen index listesi

// =============================================================
// SİLME FONKSİYONLARI (şimdi sadece modal açar, hemen silmez)
// =============================================================
function removeFromBasket(i) {
  haptic(12);

  // Admin: direkt sil
  if (isAdmin()) {
    Basket.removeAt(i);
    return;
  }

  // Sepette 2+ ürün varken → değişim/ekleme demek, soru sormadan sil
  if (basket.length > 1) {
    _showRemoveToast(i);
    return;
  }

  // Tek ürün: müşteri kaçmış olabilir → kaçış sebebi sor
  _pendingDeleteIndex = i;
  _pendingDeleteIndices = [];
  showReasonModal('kacti', 'Ürün sepetten çıkarılacak, lütfen neden belirtin:');
}

// Premium geri alma toast'lu silme (çok ürünlü durum)
function _showRemoveToast(idx) {
  const item = basket[idx];
  if (!item) return;

  // Önce sil
  Basket.removeAt(idx);

  // Mevcut toast varsa kapat
  const existing = document.getElementById('remove-undo-toast');
  if (existing) existing.remove();
  if (window._removeUndoTimer) clearTimeout(window._removeUndoTimer);

  // Premium toast
  const toast = document.createElement('div');
  toast.id = 'remove-undo-toast';
  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:.80rem;color:#f1f5f9;flex:1;line-height:1.3;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        🗑 <b>${_esc(item.urun)}</b> kaldırıldı
      </span>
      <button onclick="window._undoRemove()" style="
        padding:5px 13px;border-radius:10px;border:none;
        background:linear-gradient(135deg,#f59e0b,#d97706);
        color:#fff;font-size:.70rem;font-weight:800;
        cursor:pointer;font-family:inherit;flex-shrink:0;
        box-shadow:0 2px 6px rgba(245,158,11,.4)">
        ↩ Geri Al
      </button>
    </div>
    <div id="remove-undo-progress" style="
      height:3px;background:#f59e0b;border-radius:2px;
      margin-top:8px;transition:width 3s linear;width:100%">
    </div>`;
  toast.style.cssText = `
    position:fixed;bottom:calc(70px + env(safe-area-inset-bottom,0px));
    left:50%;transform:translateX(-50%);
    width:min(340px, calc(100vw - 24px));
    background:linear-gradient(135deg,#1e293b,#0f172a);
    border:1px solid #334155;
    border-radius:16px;padding:12px 14px;
    box-shadow:0 8px 32px rgba(0,0,0,.35),0 2px 8px rgba(0,0,0,.20);
    z-index:9999;
    animation:slideUpToast .22s cubic-bezier(.16,1,.3,1) both`;

  document.body.appendChild(toast);

  // Progress bar küçül
  requestAnimationFrame(() => {
    const bar = document.getElementById('remove-undo-progress');
    if (bar) { bar.style.width = '0%'; }
  });

  // Geri al fonksiyonu
  window._undoRemove = function() {
    clearTimeout(window._removeUndoTimer);
    toast.remove();
    // Orijinal pozisyona geri ekle
    basket.splice(idx, 0, item);
    updateCartUI();
    saveBasket();
    haptic(10);
  };

  // 3 saniye sonra kapat
  window._removeUndoTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
    toast.style.transition = 'opacity .25s, transform .25s';
    setTimeout(() => toast.remove(), 260);
    window._undoRemove = null;
  }, 3000);
}

window.deleteSelectedItems = function() {
  const checked  = document.querySelectorAll('.cart-item-checkbox:checked');
  const allBoxes = document.querySelectorAll('.cart-item-checkbox');
  const tumunuSil = checked.length === 0;
  const indices = Array.from(tumunuSil ? allBoxes : checked)
                    .map(cb => parseInt(cb.value)).sort((a,b) => b-a);
  if (!indices.length) return;
  if (isAdmin && isAdmin()) {
    Basket.removeMany(indices);
    _pendingDeleteIndex = null; _pendingDeleteIndices = [];
    return;
  }
  _pendingDeleteIndices = indices; _pendingDeleteIndex = null;
  showReasonModal('kacti', tumunuSil
    ? 'Tüm ürünler silinecek, lütfen neden belirtin:'
    : 'Seçilen ürünler silinecek, lütfen neden belirtin:');
};

// =============================================================
// NEDEN SORMA MODALI (silme işlemi burada gerçekleşir)
// =============================================================
async function showReasonModal(sonucTip = 'kacti', aciklama = '') {
  const existingModal = document.getElementById('session-result-modal');
  if (existingModal && existingModal.style.display === 'flex') return;
  
  const modal = document.getElementById('session-result-modal');
  if (!modal) return;
  
  const kpanel = modal.querySelector('.kacti-neden-panel');
  if (kpanel) kpanel.style.display = 'none';
  
  const satisBtn = document.getElementById('session-result-satis');
  if (satisBtn) {
    satisBtn.style.opacity = '1';
    satisBtn.style.pointerEvents = 'auto';
    satisBtn.title = '';
  }
  
  const kactiBtn = document.getElementById('session-result-kacti');
  if (kactiBtn) {
    kactiBtn.style.transform = '';
    kactiBtn.style.boxShadow = '';
  }
  
  modal.style.display = 'flex';
  
  // ✅ NEDEN SEÇİLDİĞİNDE YAPILACAKLAR (silme işlemi burada)
  const handleKacti = async (neden) => {
    modal.style.display = 'none';
    if (kpanel) kpanel.style.display = 'none';
    
    // Bekleyen silme işlemlerini gerçekleştir
    if (_pendingDeleteIndex !== null) {
      Basket.removeAt(_pendingDeleteIndex); // ✅ Basket Manager
    } else if (_pendingDeleteIndices.length > 0) {
      Basket.removeMany(_pendingDeleteIndices); // ✅ Basket Manager
    }
    
    // Log kaydı
    await logSessionResult(sonucTip, neden);
    
    // Geçici değişkenleri sıfırla
    _pendingDeleteIndex = null;
    _pendingDeleteIndices = [];
  };
  
  const handleSatis = async () => {
    modal.style.display = 'none';
    if (kpanel) kpanel.style.display = 'none';

    // ✅ DÜZELTME: Satış yapıldı seçilince de bekleyen silme işlemi gerçekleşir.
    // Tekli silme (removeFromBasket) veya toplu silme (deleteSelectedItems) fark etmez.
    if (_pendingDeleteIndex !== null) {
      Basket.removeAt(_pendingDeleteIndex); // ✅ Basket Manager
    } else if (_pendingDeleteIndices.length > 0) {
      Basket.removeMany(_pendingDeleteIndices); // ✅ Basket Manager
    }

    incrementDailyStat('satis_sayisi', 1).catch(() => {});
    await logSessionResult('satis', 'Satış yapıldı');

    // Geçici değişkenleri sıfırla
    _pendingDeleteIndex = null;
    _pendingDeleteIndices = [];
  };
  
  // Vazgeç butonu (X) – sadece modalı kapatır, silme yapmaz
  const vazgecBtn = document.getElementById('session-result-vazgec');
  if (vazgecBtn) {
    const newVazgec = vazgecBtn.cloneNode(true);
    vazgecBtn.parentNode.replaceChild(newVazgec, vazgecBtn);
    newVazgec.addEventListener('click', () => {
      modal.style.display = 'none';
      if (kpanel) kpanel.style.display = 'none';
      // Geçici değişkenleri sıfırla (silme iptal edildi)
      _pendingDeleteIndex = null;
      _pendingDeleteIndices = [];
    }, { once: true });
  }
  
  // Satış butonu
  const satisBtnClone = document.getElementById('session-result-satis');
  if (satisBtnClone) {
    const newSatis = satisBtnClone.cloneNode(true);
    satisBtnClone.parentNode.replaceChild(newSatis, satisBtnClone);
    newSatis.addEventListener('click', () => {
      handleSatis();
    }, { once: true });
  }
  
  // Kaçtı butonu (neden panelini açar)
  const kactiBtnClone = document.getElementById('session-result-kacti');
  if (kactiBtnClone) {
    const newKacti = kactiBtnClone.cloneNode(true);
    kactiBtnClone.parentNode.replaceChild(newKacti, kactiBtnClone);
    newKacti.addEventListener('click', () => {
      const kpanelLocal = modal.querySelector('.kacti-neden-panel');
      if (kpanelLocal) {
        kpanelLocal.style.display = 'flex';
      } else {
        handleKacti('');
      }
    }, { once: true });
  }
  
  // Neden butonları
  modal.querySelectorAll('.kacti-neden-btn').forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', () => {
      handleKacti(newBtn.dataset.neden || '');
    }, { once: true });
  });
}

// =============================================================
// SEPET BOŞALDIĞINDA AÇILACAK MODAL (SATIŞ BUTONU PASİF)
// =============================================================
async function showEmptyCartModal() {
  const existingModal = document.getElementById('session-result-modal');
  if (existingModal && existingModal.style.display === 'flex') return;
  
  const modal = document.getElementById('session-result-modal');
  if (!modal) return;
  
  const kpanel = modal.querySelector('.kacti-neden-panel');
  if (kpanel) kpanel.style.display = 'none';
  
  const satisBtn = document.getElementById('session-result-satis');
  if (satisBtn) {
    satisBtn.style.opacity = '0.5';
    satisBtn.style.pointerEvents = 'none';
    satisBtn.title = 'Sepet boşken satış yapılamaz';
  }
  
  const kactiBtn = document.getElementById('session-result-kacti');
  if (kactiBtn) {
    kactiBtn.style.transform = 'scale(1.02)';
    kactiBtn.style.boxShadow = '0 0 0 2px #dc2626';
  }
  
  modal.style.display = 'flex';
  
  const handleKacti = async (neden) => {
    modal.style.display = 'none';
    if (kpanel) kpanel.style.display = 'none';
    await logSessionResult('kacti', neden);
    _sessionData = { searches:[], revealedPrices:[], blurUrunler:{}, startTime: null };
    localStorage.removeItem('_sd');
    if (satisBtn) {
      satisBtn.style.opacity = '1';
      satisBtn.style.pointerEvents = 'auto';
    }
    if (kactiBtn) {
      kactiBtn.style.transform = '';
      kactiBtn.style.boxShadow = '';
    }
  };
  
  const vazgecBtn = document.getElementById('session-result-vazgec');
  if (vazgecBtn) {
    const newVazgec = vazgecBtn.cloneNode(true);
    vazgecBtn.parentNode.replaceChild(newVazgec, vazgecBtn);
    newVazgec.addEventListener('click', () => {
      modal.style.display = 'none';
      if (kpanel) kpanel.style.display = 'none';
      if (satisBtn) {
        satisBtn.style.opacity = '1';
        satisBtn.style.pointerEvents = 'auto';
      }
      if (kactiBtn) {
        kactiBtn.style.transform = '';
        kactiBtn.style.boxShadow = '';
      }
    }, { once: true });
  }
  
  const newKactiBtn = document.getElementById('session-result-kacti');
  if (newKactiBtn) {
    const clonedKacti = newKactiBtn.cloneNode(true);
    newKactiBtn.parentNode.replaceChild(clonedKacti, newKactiBtn);
    clonedKacti.addEventListener('click', () => {
      const kpanelLocal = modal.querySelector('.kacti-neden-panel');
      if (kpanelLocal) {
        kpanelLocal.style.display = 'flex';
      } else {
        handleKacti('');
      }
    }, { once: true });
  }
  
  modal.querySelectorAll('.kacti-neden-btn').forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', () => {
      handleKacti(newBtn.dataset.neden || '');
    }, { once: true });
  });
}
// =============================================================
// SEPET TEMİZLEME (GLOBAL)
// =============================================================
window.clearBasket = function(bypass = false, sonucOverride = null, nedenOverride = '') {
  console.log("🗑️ clearBasket çağrıldı, sepet durumu:", basket.length);
  if (basket.length === 0) {
    if (!bypass) ayAlert('Sepet zaten boş.');
    return;
  }
  if (bypass) {
    if (sonucOverride) {
      logSessionResult(sonucOverride, nedenOverride).catch(e => console.warn(e));
    }
    _doClearBasket();
    return;
  }
  if (isAdmin()) {
    ayDanger('Sepeti temizle?').then(cevap => {
      if (cevap) _doClearBasket();
    });
    return;
  }
  const modal = document.getElementById('session-result-modal');
  if (!modal) { 
    _doClearBasket(); 
    return; 
  }
  const kpanel = modal.querySelector('.kacti-neden-panel');
  if (kpanel) kpanel.style.display = 'none';
  ['session-result-satis','session-result-kacti','session-result-vazgec'].forEach(id => {
    const el = document.getElementById(id); 
    if (!el) return;
    const c = el.cloneNode(true); 
    el.parentNode.replaceChild(c, el);
  });
  modal.style.display = 'flex';
  const handleSonuc = async (sonuc, neden = '') => {
    modal.style.display = 'none';
    if (kpanel) kpanel.style.display = 'none';
    try {
      await logSessionResult(sonuc, neden);
    } catch(e) { console.warn(e); }
    _doClearBasket();
    _sessionData = { searches:[], revealedPrices:[], blurUrunler:{}, startTime: null };
    localStorage.removeItem('_sd');
  };
  document.getElementById('session-result-satis')?.addEventListener('click',
    () => {
      incrementDailyStat('satis_sayisi', 1).catch(() => {});
      handleSonuc('satis', '');
    }, { once: true });
  document.getElementById('session-result-kacti')?.addEventListener('click', () => {
    if (kpanel) { 
      kpanel.style.display = 'flex'; 
    } else { 
      handleSonuc('kacti',''); 
    }
  }, { once: true });
  document.getElementById('session-result-vazgec')?.addEventListener('click', () => {
    modal.style.display = 'none';
    if (typeof resetSessionTimer === 'function') {
      resetSessionTimer();
    }
    if (kpanel) kpanel.style.display = 'none';
  }, { once: true });
  modal.querySelectorAll('.kacti-neden-btn').forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', () => {
      handleSonuc('kacti', newBtn.dataset.neden || '');
    }, { once: true });
  });
};

function _doClearBasket() {
  console.log("📦 _doClearBasket çalıştı, sepet temizleniyor...");
  stopSessionTimer(); // ✅ Sepet temizlenince idle timer durdur
  basket = [];
  discountAmount = 0;
  abakusSelection = null;
  const di = document.getElementById('discount-input');
  if (di) di.value = '';
  saveBasket();
  if (currentUser && _db) {
    deleteDoc(doc(_db, 'live_baskets', currentUser.Email)).catch(() => {});
  }
  _sessionData = { searches:[], revealedPrices:[], blurUrunler:{}, startTime: null };
  localStorage.removeItem('_sd');
  _blurSessionActive   = false;
  _blurSessionUrunler  = {};
  // Intent ve blur session sıfırla
  _intentLevel         = 0;
  _lastBlurredIndex    = null;
  _lastBlurredName     = '';
  _blurredThisSession  = {};
  // Floating bar varsa kaldır
  _floatingBarActive   = false;
  document.getElementById('_float-feedback')?.remove();
  document.getElementById('_neden-panel')?.remove();
  updateCartUI();
}

// =============================================================
// İNDİRİM VE SEPET FONKSİYONLARI
// =============================================================
function applyDiscount() {
  const raw = (document.getElementById('discount-input').value || '').trim();
  if (raw && /^[\d\s\+\-\.]+$/.test(raw)) {
    try {
      const parts = raw.split('+').map(s => parseFloat(s.trim()) || 0);
      discountAmount = parts.reduce((a, b) => a + b, 0);
      if (raw.includes('+')) {
        document.getElementById('discount-input').value = discountAmount;
      }
    } catch(e) { 
      discountAmount = parseFloat(raw) || 0; 
    }
  } else {
    discountAmount = parseFloat(raw) || 0;
  }
  discountType = document.getElementById('discount-type').value || 'TRY';
  updateCartUI();
}

function getDisc(t) { 
  return discountType === 'TRY' ? discountAmount : t * discountAmount / 100; 
}

function basketTotals() {
  return Basket.totals(); // ✅ Basket Manager
}


// ═══════════════════════════════════════════════════════════════
// KAMPANYA YÖNETİM SİSTEMİ
// Açıklama metnini ⎇ (birleşebilir) ve 🔒︎ (kilitli) ayraçlarıyla parçalar,
// her parçadan tutar çıkarır ve sepet satırına tıklanabilir pill olarak ekler.
// ═══════════════════════════════════════════════════════════════

// basket[idx].selectedCampaigns = [ { metin, tutar, tip } ]
// tip: 'birlesen' | 'kilitli'

function parseCampaigns(aciklama) {
  if (!aciklama || aciklama === '-') return [];
  // ── ⤚ Bundle descriptor — kampanya pill olarak gösterilmez ──────
  // Format: ⤚KOŞUL|SİMGE
  //   ⤚*|⌗                   → herkese (global)
  //   ⤚Tv|✦                  → "Tv" gamı/kodu/adı varsa
  //   ⤚Tv+CepTelefonu|✦     → Tv VEYA Cep Telefonu varsa (OR, + ile)
  //   ⤚*~Adaptör~Epilasyon|⌗ → herkese ama bu gamlar sepette varsa gösterme (~ ile)
  //   ⤚Tv+Cep~Adaptör|✦     → (Tv OR Cep) AND NOT Adaptör
  // parseCampaigns sadece tip:'bundle' objesi döner, renderer atlar.
  if (aciklama.includes('⤚')) {
    const bundleRe = /⤚([^|\s][^|]*)\|?([^\s⤚]*)/g;
    const bundles = [];
    let bm;
    while ((bm = bundleRe.exec(aciklama)) !== null) {
      bundles.push({ tip: 'bundle', condition: bm[1].trim(), icon: bm[2].trim() || '⌗' });
    }
    if (bundles.length) return bundles;
  }
  const result = [];
  const str = aciklama;

  // 🔒 hem variation-selector'lı (FE0E) hem düz formu tanı
  const KILITLI_V  = '\uD83D\uDD12\uFE0E'; // 🔒︎
  const KILITLI_P  = '\uD83D\uDD12';         // 🔒  (düz)

  const has_birlesen  = str.includes('⎇');
  const has_kilitli   = str.includes(KILITLI_V) || str.includes(KILITLI_P);
  const has_tulha     = str.includes('✦');
  const has_proje     = str.includes('❖');
  const has_bagimsiz  = str.includes('⌗');

  if (has_birlesen || has_kilitli || has_proje || has_bagimsiz) {
    // ── Karma format: ⎇ 🔒 ❖ ⌗ ayraçları + ✦ araya bilgi olarak girer ──
    const ayraclar = [];
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '⎇') {
        ayraclar.push({ idx: i, len: 1, tip: 'birlesen' });
      } else if (str[i] === '❖') {
        ayraclar.push({ idx: i, len: 1, tip: 'proje' });
      } else if (str[i] === '⌗') {
        ayraclar.push({ idx: i, len: 1, tip: 'bagimsiz' });
      } else if (str[i] === '✦') {
        ayraclar.push({ idx: i, len: 1, tip: 'bilgi' });
      } else if (str.slice(i, i + KILITLI_V.length) === KILITLI_V) {
        ayraclar.push({ idx: i, len: KILITLI_V.length, tip: 'kilitli' });
      } else if (str.slice(i, i + KILITLI_P.length) === KILITLI_P) {
        // Düz 🔒 — sonrasında variation selector yoksa kilitli
        const afterChar = str.codePointAt(i + KILITLI_P.length);
        if (afterChar !== 0xFE0E) {
          ayraclar.push({ idx: i, len: KILITLI_P.length, tip: 'kilitli' });
        }
      }
    }
    let onceki = 0;
    ayraclar.forEach(a => {
      const metin = str.slice(onceki, a.idx).trim();
      if (metin) result.push(_buildCampObj(metin, a.tip));
      onceki = a.idx + a.len;
    });
    const kalan = str.slice(onceki).trim();
    if (kalan) result.push(_buildCampObj(kalan, 'birlesen'));
    return result;
  }

  if (has_tulha) {
    // ── Saf ✦ formatı: Bilgi pill ────────────────────────────────
    str.split('✦').forEach(seg => {
      const metin = seg.trim();
      if (metin) result.push(_buildCampObj(metin, 'bilgi'));
    });
    return result;
  }

  // Ayraç yok → tek bilgi segmenti
  const metin = str.trim();
  if (metin) result.push(_buildCampObj(metin, 'bilgi'));
  return result;
}

// Kampanya segmentini ayrıştır: eski format + yeni ID+ROL format
// Yeni format: "KEA -3000(2/A) ⎇"  →  id=KEA, tutar=3000, esik=2, rol=A, tip=birlesen
// Eski format: "KEA -3k İnd. KÜ ⎇" →  id=KEA, tutar=3000, esik=2, rol=ANY
function _buildCampObj(metin, tip) {
  // Tarih kontrolü: [GG.AA.YY] veya [GG.AA.YYYY] formatı
  const tarihMatch = metin.match(/\[(\d{2})\.(\d{2})\.(\d{2,4})\]/);
  let sonTarih = null;
  if (tarihMatch) {
    const gun = parseInt(tarihMatch[1]);
    const ay  = parseInt(tarihMatch[2]) - 1;
    const yil = tarihMatch[3].length === 2 ? 2000 + parseInt(tarihMatch[3]) : parseInt(tarihMatch[3]);
    sonTarih = new Date(Date.UTC(yil, ay, gun, 20, 59, 59)); // UTC+3 → 23:59:59 TR
  }

  // Proje tipi: fiyat = tutar (satır fiyatı override), iskonto/indirim devre dışı
  // Format: "EA+SFS 79.999(3/A)" → esik=3, rol=A (3 ürün eşleşmesi gerekir)
  // Format: "EA+SFS 79.999"      → esik=1, anında uygulanır
  if (tip === 'proje') {
    const tutar = _extractTutar(metin);
    // Parantez içinde esik/rol var mı? Örn: (3/A)
    const projeEsikM = metin.match(/\((\d+)\/([A-Z])\)/i);
    if (projeEsikM) {
      const pEsik = parseInt(projeEsikM[1]);
      const pRol  = projeEsikM[2].toUpperCase();
      // Grup adı: metnin ilk kelimesi (EA+SFS gibi)
      const pGrup = metin.split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9+]/g, '').slice(0, 16) || 'PROJE';
      return { metin, tutar, tip: 'proje', grup: pGrup, esik: pEsik, rol: pRol, sonTarih };
    }
    return { metin, tutar, tip: 'proje', grup: metin.split(' ')[0].replace(/[^A-Za-zÇçĞğİıÖöŞşÜü0-9+]/g,'').slice(0,16) || 'PROJE', esik: 1, rol: 'ANY', sonTarih };
  }

  // Bağımsız tip (⌗): 🔒 ve ⎇ kampanyalarla birlikte çalışabilir, kendi içinde tek seçim
  if (tip === 'bagimsiz') {
    const tutar = _extractTutar(metin);
    // Rol ve eşik yeni formattan çek (ör: "7T Mx Kr -8k (1/A)")
    const yeniF = metin.match(/^([A-ZÇŞĞÜÖİa-zçşğüöı0-9_+\s]+?)\s+[-–]?\s*[\d.,]+[kK]?\s*\((\d+)\/([A-Z])\)/i);
    if (yeniF) {
      return { metin, tutar, tip: 'bagimsiz', grup: 'BAGIMSIZ', esik: parseInt(yeniF[2]), rol: yeniF[3].toUpperCase(), sonTarih };
    }
    return { metin, tutar, tip: 'bagimsiz', grup: 'BAGIMSIZ', esik: 1, rol: 'ANY', sonTarih };
  }

  const tutar = _extractTutar(metin);
  let grup, esik, rol;

  // Yeni format: KIMLIK TUTAR(ESIK/ROL)
  // Örn: "KEA -3000(2/A)", "PAKET1 -15000(2/B)", "ANK -7600(3/C)"
  const yeniFormat = metin.match(/^([A-ZÇŞĞÜÖİa-zçşğüöı0-9_+]+)\s+[-–]?\s*[\d.,]+[kK]?\s*\((\d+)\/([A-Z])\)/i);
  if (yeniFormat && tip !== 'bilgi') {
    grup = yeniFormat[1].toUpperCase();
    esik = parseInt(yeniFormat[2]);
    rol  = yeniFormat[3].toUpperCase();
    // Tip override: kelime içinde 🔒 varsa kilitli (ayraç dışarıda ama metin de taşıyabilir)
    return { metin, tutar, tip, grup, esik, rol, sonTarih };
  }

  // Eski format: anahtar kelime tespiti
  rol = 'ANY';
  const esikMatch = metin.match(/\((\d+)\)/);
  const esikOverride = esikMatch ? parseInt(esikMatch[1]) : null;

  if (/PAP/i.test(metin)) {
    grup = 'PAP'; esik = esikOverride || 1; tip = 'birlesen';
  } else if (/KEA/i.test(metin) && tip !== 'bilgi') {
    grup = 'KEA'; esik = esikOverride || 2; tip = 'birlesen';
  } else if (/\bKM\b/i.test(metin) && tip !== 'bilgi') {
    grup = 'KM';  esik = esikOverride || 2; tip = 'kilitli';
  } else if (/\bİkili\b|\bIKILI\b/i.test(metin) && tip !== 'bilgi') {
    grup = 'IKILI'; esik = 2; tip = tip === 'kilitli' ? 'kilitli' : 'birlesen';
  } else if (/ANK|[Üü][çc]l[üu]\s+[Ss]et|Ankastre\s+[Ss]et/i.test(metin) && tip !== 'bilgi') {
    grup = 'ANK'; esik = esikOverride || 3; tip = 'birlesen';
  } else if (tutar === 0 || tip === 'bilgi') {
    grup = 'BILGI'; esik = 1; tip = 'bilgi';
  } else {
    grup = 'DIGER'; esik = esikOverride || 1;
  }
  return { metin, tutar, tip, grup, esik, rol, sonTarih };
}

function _extractTutar(metin) {
  // Parantez içindeki sayıları yoksay (eşik değerleri: "(Son 4 My)", "(2)", "(3)")
  // Köşeli parantez içindeki tarihleri ve normal parantez içini temizle
  const temiz = metin.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '');
  // k formatı: "3k", "14,5k", "-3k"
  // noktalı format: "3.000", "14.500"
  // düz tam sayı: "1247", "90000" (en az 3 hane)
  let max = 0;
  const regK = /(?:[-–]\s*)?(\d{1,3}(?:[,.]\d{1,3})?)\s*[kK]\b/g;
  const regN = /\b(\d{1,3}(?:\.\d{3})+)\b/g;
  const regI = /\b(\d{3,6})\b/g;
  let m;
  while ((m = regK.exec(temiz)) !== null) {
    const val = parseFloat(m[1].replace(',', '.')) * 1000;
    if (val > max) max = val;
  }
  while ((m = regN.exec(temiz)) !== null) {
    const val = parseFloat(m[1].replace(/\./g, ''));
    if (val > max) max = val;
  }
  // Düz tam sayıyı yalnızca k/noktalı format bulunamadıysa kullan
  if (max === 0) {
    while ((m = regI.exec(temiz)) !== null) {
      const val = parseInt(m[1]);
      if (val > max) max = val;
    }
  }
  return Math.round(max);
}
// ─── KAMPANYA UYARI TOAST ────────────────────────────────────────
function _campToast(msg, tip) {
  const renk = tip === 'warn' ? '#f97316' : tip === 'ok' ? '#16a34a' : '#3b82f6';
  const ikon = tip === 'warn' ? '⚠️' : tip === 'ok' ? '✅' : 'ℹ️';
  const ct = document.getElementById('change-toast');
  if (!ct) { console.warn('[kampanya]', msg); return; }
  const el = document.createElement('div');
  el.className = 'toast-item';
  el.style.cssText = 'background:#fff;border-left:4px solid ' + renk + ';border-radius:8px;'
    + 'padding:8px 14px;display:flex;align-items:center;gap:8px;font-size:.76rem;'
    + 'box-shadow:0 4px 12px rgba(0,0,0,.12);margin-bottom:4px;'
    + 'animation:slideInRight .22s ease';
  el.innerHTML = '<span style="font-size:1rem">' + ikon + '</span>'
    + '<span style="flex:1;color:#1e293b">' + msg + '</span>';
  ct.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3200);
}

// ─── KAMPANYA SEÇİM + GRUP MOTORU ──────────────────────────────
// Tıklama akışı:
//   1. Pill'e tıkla → kural kontrolleri → seçim state'ini güncelle
//   2. recalculateAllGroupCampaigns() → tüm sepeti tara, gruplara göre indirim hesapla
//   3. Her ürünün itemDisc'ini güncelle → updateCartUI
function toggleCampaign(idx, campIdx) {
  haptic(12);
  const item = basket[idx];
  if (!item) return;
  if (!item._campaigns)     item._campaigns    = parseCampaigns(item.aciklama);
  if (!item._selectedCamps) item._selectedCamps = {};

  const camp = item._campaigns[campIdx];
  if (!camp || camp.tip === 'bilgi') return;

  // Proje: tarih kontrolü toggle içinde de yapılıyor (bilgi değil ama özel)

  const isSelected = !!item._selectedCamps[campIdx];

  // ── Tarih kontrolü (seçmeden önce) ─────────────────────────
  if (!isSelected && camp.sonTarih && new Date() > camp.sonTarih) {
    const gun = String(camp.sonTarih.getDate()).padStart(2,'0');
    const ay  = String(camp.sonTarih.getMonth()+1).padStart(2,'0');
    const yil = String(camp.sonTarih.getFullYear()).slice(-2);
    _campToast('Bu kampanyanın geçerlilik tarihi ' + gun + '.' + ay + '.' + yil + ' tarihinde dolmuştur.', 'warn');
    return;
  }

  if (isSelected) {
    // Seçimi kaldır
    delete item._selectedCamps[campIdx];
    recalculateAllGroupCampaigns();
    updateCartUI();
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // KURAL 1: Aynı üründe ⎇ ve 🔒 birlikte olamaz
  // ═══════════════════════════════════════════════════════════
  const itemHasKilitli  = Object.entries(item._selectedCamps).some(
    ([ci, sel]) => sel && item._campaigns[parseInt(ci)]?.tip === 'kilitli'
  );
  const itemHasBirlesen = Object.entries(item._selectedCamps).some(
    ([ci, sel]) => sel && item._campaigns[parseInt(ci)]?.tip === 'birlesen'
  );

  // Proje tipi KURAL 1'den muaf — ayrı kontrol
  if (camp.tip !== 'proje') {
    if (camp.tip === 'kilitli' && itemHasBirlesen) {
      _campToast('Bu üründe ⎇ kampanya seçili — 🔒 ile birleşemez. Önce ⎇ seçimini kaldırın.', 'warn');
      return;
    }
    if (camp.tip === 'birlesen' && itemHasKilitli) {
      _campToast('Bu üründe 🔒 kampanya seçili — ⎇ ile birleşemez. Önce 🔒 seçimini kaldırın.', 'warn');
      return;
    }
    // Aynı GRUPTAN 🔒: radio-button — eskiyi sil, yenisini ekle
    // NOT: grup kısıtlaması yok — aynı üründe yalnızca TEK 🔒 seçilebilir
    if (camp.tip === 'kilitli' && itemHasKilitli) {
      Object.keys(item._selectedCamps).forEach(ci => {
        if (!item._selectedCamps[ci]) return;
        const c = item._campaigns[parseInt(ci)];
        if (c && c.tip === 'kilitli') delete item._selectedCamps[parseInt(ci)];
      });
    }

    // Aynı GRUPTAN ⎇ (birleşen): farklı eşikli aynı kampanya grubu radio-button gibi davranır
    // Örn: 4KEA -7k seçiliyken 3KEA -3,5k seçilince 4KEA bırakılmalı
    if (camp.tip === 'birlesen') {
      const eskiBirlesen = Object.entries(item._selectedCamps).find(([ci, s]) => {
        if (!s) return false;
        const c = item._campaigns[parseInt(ci)];
        return c && c.tip === 'birlesen' && c.grup === camp.grup && parseInt(ci) !== campIdx;
      });
      if (eskiBirlesen) delete item._selectedCamps[parseInt(eskiBirlesen[0])];
    }
  }

  // Proje seçilmek isteniyorken başka kampanya seçiliyse: sessiz engel (UI zaten disable)
  const itemHasAnyNonProje = Object.entries(item._selectedCamps).some(([ci, sel]) => {
    if (!sel) return false;
    const c = item._campaigns[parseInt(ci)];
    return c && c.tip !== 'proje' && c.tip !== 'bilgi';
  });
  const itemHasProjeSelected = Object.entries(item._selectedCamps).some(([ci, sel]) => {
    if (!sel) return false;
    return item._campaigns[parseInt(ci)]?.tip === 'proje';
  });
  if (camp.tip === 'proje' && itemHasAnyNonProje) return;
  if (camp.tip !== 'proje' && camp.tip !== 'bilgi' && camp.tip !== 'bagimsiz' && itemHasProjeSelected) return;

  // Bağımsız (⌗): aynı üründe 2. ⌗ engeli — sessiz
  const itemHasBagimsizSelected = Object.entries(item._selectedCamps).some(([ci, sel]) => {
    if (!sel) return false;
    return item._campaigns[parseInt(ci)]?.tip === 'bagimsiz';
  });
  if (camp.tip === 'bagimsiz' && itemHasBagimsizSelected) return;

  // ═══════════════════════════════════════════════════════════
  // KURAL 3: 🔒 kilitli kampanyalarda eşik aşılamaz.
  // ⎇ birleşen gruplar birden fazla tur oluşturabilir (sınır yok).
  // 🔒 kilitli gruplar: esik × tamamlananTurSayisi kadar ürün kullanılabilir,
  //   ama 🔒 tamamlandıktan sonra o ürünlerde başka kampanya yok.
  // ═══════════════════════════════════════════════════════════
  if (camp.esik > 1 && camp.tip === 'kilitli') {
    const grupAdi   = camp.grup;
    const esikDeger = camp.esik;

    // Bu grupta seçili farklı ürün sayısı
    const grupSeciliUrunler = new Set();
    basket.forEach((b, bi) => {
      if (!b._campaigns || !b._selectedCamps) return;
      Object.entries(b._selectedCamps).forEach(([ci, sel]) => {
        if (sel && b._campaigns[parseInt(ci)]?.grup === grupAdi) grupSeciliUrunler.add(bi);
      });
    });

    // Bu ürün zaten bu grupta seçim yapmış mı?
    const buUrunGrupta = Object.entries(item._selectedCamps).some(
      ([ci, sel]) => sel && item._campaigns[parseInt(ci)]?.grup === grupAdi
    );

    if (!buUrunGrupta) {
      // Açık turdaki ürün sayısı
      const acikTurUrunSayisi = grupSeciliUrunler.size % esikDeger;
      // Açık tur tam dolmuş mu ve yeni tur başlatılıyor? Bu serbest.
      // Açık turda yer var mı? Varsa eklenebilir.
      // 🔒 için: her tamamlanan tur bağımsız — yeni tur başlayabilir.
      // Engel: açık turda bu üründen eklenmesine rağmen eşik aşılacaksa (mantıken imkânsız)
      // → Hiçbir engel yok, 🔒 birden fazla tur oluşturabilir
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Seçimi kaydet ve hesapla
  // ═══════════════════════════════════════════════════════════
  item._selectedCamps[campIdx] = true;
  recalculateAllGroupCampaigns();
  updateCartUI();
}

// ─── GLOBAL GRUP HESAPLAMA MOTORU ──────────────────────────────
// Kurallar:
// PAP (esik=1, rol=ANY, ⎇): Her ürün kendi tutarını anında alır.
// KEA/IKILI/ANK (esik≥2, rol=A/B/C, ⎇ veya 🔒):
//   - esik kadar FARKLI ürün + FARKLI harfler → eşik sağlandı
//   - MAX tutar (tüm pill'ler aynı tutarı taşır) orantılı dağıtılır
// BILGI (✦): indirim yok
function recalculateAllGroupCampaigns() {
  // Kampanya kaynaklı indirim (_campDisc) sıfırla; manuel indirim korunur
  // Proje fiyatı (_projeNakit) da sıfırla
  basket.forEach(item => {
    if (item._projeNakit !== undefined) {
      delete item._projeNakit; // proje override'ı kaldır, ham nakit geri döner
      delete item._projeGrup;
    }
    if (item._campaigns && item._campaigns.length > 0) {
      const manuelDisc = (item.itemDisc || 0) - (item._campDisc || 0);
      item._campDisc = 0;
      item.itemDisc  = Math.max(0, manuelDisc);
    }
  });

  // Proje (❖) seçimlerini işle — esik=1 ise anında, esik>1 ise esik ürün gerekir
  // Önce tüm proje gruplarının eşiklerini kontrol et
  const projeGrupSecili = {}; // grup → [{bi, camp, ci}]
  basket.forEach((item, bi) => {
    if (!item._campaigns || !item._selectedCamps) return;
    Object.entries(item._selectedCamps).forEach(([ci, sel]) => {
      if (!sel) return;
      const camp = item._campaigns[parseInt(ci)];
      if (!camp || camp.tip !== 'proje') return;
      const g = camp.grup || 'PROJE';
      if (!projeGrupSecili[g]) projeGrupSecili[g] = [];
      projeGrupSecili[g].push({ bi, camp, ci: parseInt(ci), item });
    });
  });

  Object.entries(projeGrupSecili).forEach(([grup, secimler]) => {
    const esik = secimler[0].camp.esik || 1;

    if (esik === 1) {
      // Anında uygula (tutar=0 → hediye ürünü, yine de _projeNakit set edilir)
      secimler.forEach(s => {
        if (s.camp.tutar >= 0) {
          s.item._projeNakit = s.camp.tutar;
          s.item._projeGrup  = s.camp.grup || grup; // SATIR İND. etiketi için
          s.item._campDisc   = 0;
          s.item.itemDisc    = 0;
        }
        if (!s.item._pendingGroups) s.item._pendingGroups = {};
        s.item._pendingGroups[grup] = false;
      });
      return;
    }

    // Esikli: esik kadar farklı ürün + farklı rol gerekir
    const farkliRoller = new Set(secimler.map(s => s.camp.rol || 'ANY'));
    const farkliUrunler = new Set(secimler.map(s => s.bi));
    const esikSaglandi = farkliUrunler.size >= esik &&
      (secimler.every(s => !s.camp.rol || s.camp.rol === 'ANY') || farkliRoller.size >= esik);

    secimler.forEach(s => {
      if (!s.item._pendingGroups) s.item._pendingGroups = {};
      if (esikSaglandi && s.camp.tutar >= 0) {
        s.item._projeNakit = s.camp.tutar;
        s.item._projeGrup  = s.camp.grup || grup; // SATIR İND. etiketi için
        s.item._campDisc   = 0;
        s.item.itemDisc    = 0;
        s.item._pendingGroups[grup] = false;
      } else {
        // Eşik sağlanmadı → pending (sarı)
        s.item._pendingGroups[grup] = true;
      }
    });
  });

  // Bağımsız (⌗) seçimlerini işle: anında indirim (PAP gibi), diğer kampanyalardan bağımsız
  basket.forEach(item => {
    if (!item._campaigns || !item._selectedCamps) return;
    Object.entries(item._selectedCamps).forEach(([ci, sel]) => {
      if (!sel) return;
      const camp = item._campaigns[parseInt(ci)];
      if (!camp || camp.tip !== 'bagimsiz') return;
      const pay = camp.tutar || 0;
      if (pay > 0) {
        item.itemDisc  = (item.itemDisc  || 0) + pay;
        item._campDisc = (item._campDisc || 0) + pay;
      }
      if (!item._pendingGroups) item._pendingGroups = {};
      item._pendingGroups['BAGIMSIZ'] = false;
    });
  });

  // Tüm seçili pill'leri grup bazında topla
  // { 'PAP': [{basketIdx, campIdx, camp, item}], 'KEA': [...], ... }
  const grupSecimler = {};
  basket.forEach((item, bi) => {
    if (!item._campaigns || !item._selectedCamps) return;
    Object.entries(item._selectedCamps).forEach(([ci, sel]) => {
      if (!sel) return;
      const camp = item._campaigns[parseInt(ci)];
      if (!camp || camp.tip === 'bilgi' || camp.tip === 'proje' || camp.tip === 'bagimsiz') return;
      const g = camp.grup || 'DIGER';
      if (!grupSecimler[g]) grupSecimler[g] = [];
      grupSecimler[g].push({ basketIdx: bi, campIdx: parseInt(ci), camp, item });
    });
  });

  // Her grup için hesapla
  Object.entries(grupSecimler).forEach(([grup, secimler]) => {
    const esik = secimler[0]?.camp?.esik || 1;

    // ── PAP (esik=1, parantez yok) ──────────────────────────────
    // Her seçim bağımsız → o ürünün pill tutarını direkt uygula
    if (esik === 1) {
      secimler.forEach(s => {
        const pay = s.camp.tutar || 0;
        if (pay <= 0) return;
        s.item.itemDisc  = (s.item.itemDisc  || 0) + pay;
        s.item._campDisc = (s.item._campDisc || 0) + pay;
        if (!s.item._pendingGroups) s.item._pendingGroups = {};
        s.item._pendingGroups[grup] = false; // anında aktif
      });
      return;
    }

    // ── Gruplu kampanya (esik≥2) ─────────────────────────────────
    // Birden fazla tur oluşabilir:
    //   Tur-1: KEA(2/A) + KEA(2/B) → tamamlandı, 3k dağıtıldı
    //   Tur-2: KEA(2/A) + KEA(2/B) → tamamlandı, 3k dağıtıldı
    // Her tur bağımsız olarak kendi indirimini uygular.
    // Tur oluşturma: seçimler ürün bazında tekilleştirildikten sonra
    // sıralı olarak esik'lik gruplara bölünür; her gruba farklı harf kontrolü yapılır.
    const secimlerByUrun = new Map();
    secimler.forEach(s => {
      if (!secimlerByUrun.has(s.basketIdx)) secimlerByUrun.set(s.basketIdx, s);
    });
    const tekliSecimler = [...secimlerByUrun.values()];
    const tumRoller     = tekliSecimler.map(s => s.camp.rol || 'ANY');
    const hepsiANY      = tumRoller.every(r => r === 'ANY');

    // Tamamlanan turları greedy bul
    // Her turda: esik kadar seçim, hepsinin rolü farklı olmalı
    const tamamlananCiftler = [];
    if (hepsiANY) {
      // Rol yoksa sıralı böl
      for (let i = 0; i + esik <= tekliSecimler.length; i += esik) {
        tamamlananCiftler.push(tekliSecimler.slice(i, i + esik));
      }
    } else {
      // Rol var — greedy tur oluştur
      // Her turda kullanılan harfleri takip et, aynı harfi aynı turda kullanma
      let kalan = [...tekliSecimler];
      while (kalan.length >= esik) {
        const tur = [];
        const turHarfleri = new Set();
        const bekleyenler = [];
        for (const s of kalan) {
          const r = s.camp.rol || 'ANY';
          if (tur.length < esik && (r === 'ANY' || !turHarfleri.has(r))) {
            tur.push(s);
            if (r !== 'ANY') turHarfleri.add(r);
          } else {
            bekleyenler.push(s);
          }
        }
        if (tur.length === esik) {
          tamamlananCiftler.push(tur);
          kalan = bekleyenler;
        } else {
          break; // Tur tamamlanamadı
        }
      }
    }

    // Pending durumu güncelle
    tekliSecimler.forEach(s => {
      if (!s.item._pendingGroups) s.item._pendingGroups = {};
      const tamamlandi = tamamlananCiftler.some(c => c.some(cs => cs.basketIdx === s.basketIdx));
      s.item._pendingGroups[grup] = !tamamlandi;
    });

    const grupTutar = Math.max(...secimler.map(s => s.camp.tutar || 0));
    if (grupTutar <= 0) return;

    // Her tamamlanan çift için orantılı dağıtım yap
    tamamlananCiftler.forEach(cift => {
      const ciftUrunler = cift.map(s => s.basketIdx);
      const ciftNakit   = ciftUrunler.reduce((acc, bi) => acc + (basket[bi]?.nakit || 0), 0);
      if (ciftNakit <= 0) {
        const esitPay = Math.round(grupTutar / ciftUrunler.length);
        ciftUrunler.forEach(bi => {
          basket[bi].itemDisc  = (basket[bi].itemDisc  || 0) + esitPay;
          basket[bi]._campDisc = (basket[bi]._campDisc || 0) + esitPay;
        });
      } else {
        let dagitilan = 0;
        ciftUrunler.forEach((bi, i) => {
          const urun    = basket[bi];
          const agirlik = urun.nakit / ciftNakit;
          const pay     = i === ciftUrunler.length - 1
            ? grupTutar - dagitilan
            : Math.round(agirlik * grupTutar);
          urun.itemDisc  = (urun.itemDisc  || 0) + pay;
          urun._campDisc = (urun._campDisc || 0) + pay;
          dagitilan += pay;
        });
      }
    });
  });
  saveBasket();
}

function clearAllCampaigns(idx) {
  const item = basket[idx];
  if (!item) return;
  item._selectedCamps = {};
  item._pendingGroups = {};
  // kampanya indirimini sıfırla, manuel kalsın
  const manuelDisc = (item.itemDisc || 0) - (item._campDisc || 0);
  item._campDisc = 0;
  item.itemDisc  = Math.max(0, manuelDisc);
  recalculateAllGroupCampaigns();
  updateCartUI();
}

// Tüm sepet kampanyalarını sıfırla (sepet temizlenince)
function clearAllBasketCampaigns() {
  basket.forEach(item => {
    item._selectedCamps = {};
    item._pendingGroups = {};
    item.itemDisc = 0;
  });
}

// Kampanya pilllerini HTML olarak render et
// Durumlar: seçili(yeşil), pending(sarı), normal(grup renginde), devre dışı(soluk)
// ── Rol Rozet Renkleri ───────────────────────────────────────
const CAMP_ARA_ROL_RENK = {
  'A':{ bg:'#dbeafe', color:'#1e40af', border:'#93c5fd' },
  'B':{ bg:'#d1fae5', color:'#065f46', border:'#6ee7b7' },
  'C':{ bg:'#fce7f3', color:'#9d174d', border:'#f9a8d4' },
  'D':{ bg:'#fef3c7', color:'#92400e', border:'#fcd34d' },
  'E':{ bg:'#e0e7ff', color:'#3730a3', border:'#a5b4fc' },
  'F':{ bg:'#ffedd5', color:'#9a3412', border:'#fdba74' },
  'G':{ bg:'#f3e8ff', color:'#6b21a8', border:'#d8b4fe' },
  'H':{ bg:'#ecfdf5', color:'#065f46', border:'#34d399' },
};
function _rolRozetHTML(rol) {
  if (!rol) return '';
  const r = CAMP_ARA_ROL_RENK[rol] || { bg:'#f1f5f9', color:'#475569', border:'#cbd5e1' };
  return '<span style="display:inline-block;margin-left:4px;padding:1px 6px;border-radius:10px;'
    + 'font-size:.55rem;font-weight:800;letter-spacing:.04em;'
    + 'background:' + r.bg + ';color:' + r.color + ';border:1px solid ' + r.border + ';'
    + 'vertical-align:middle;white-space:nowrap">' + rol + '</span>';
}

// ── Kampanya Pill Eşik Arama Butonu ──────────────────────────
// ⎇ birlesen, 🔒 kilitli, ❖ proje — pending durumunda da görünür
function _campSearchBtn(item, camp, ci) {
  if (!['birlesen','kilitli','proje'].includes(camp.tip)) return '';
  if (!camp.tutar || camp.tutar <= 0 || !camp.esik || camp.esik < 2) return '';
  if (camp.sonTarih && new Date() > camp.sonTarih) return '';

  const sc     = item._selectedCamps || {};
  const pg     = item._pendingGroups || {};
  const secili = !!(sc[ci] || sc[String(ci)] || sc[Number(ci)]);
  const pending = secili && (pg[camp.grup] === true);
  if (secili && !pending) return ''; // tamamlanmış — gizle

  const grup      = (camp.grup || '').toUpperCase();
  const esik      = camp.esik;
  const mevcutRol = (camp.rol || 'ANY').toUpperCase();
  const iNakit    = parseFloat(String(item['Nakit'] || 0).replace(',','.')) || 0;
  const YON       = 3.5;
  const sepetKodlar = new Set((typeof basket!=='undefined'?basket:[]).map(b=>String(b['Kod']||'')));

  let bulunan = false;
  const campRe = /([A-ZÇŞĞÜÖİa-zçşğüöı0-9_+]+)\s+[-–]?\s*[\d.,]+[kK]?\s*\((\d+)\/([A-Z])\)/gi;
  for (const p of (typeof allProducts!=='undefined'?allProducts:[])) {
    if (sepetKodlar.has(String(p['Kod']||''))) continue;
    const pNakit = parseFloat(String(p['Nakit']||0).replace(',','.')) || 0;
    if (iNakit > 0 && pNakit > iNakit * YON) continue;
    if ((parseFloat(p['Stok']||0)||0) <= 0) continue;
    const ac = p['Açıklama'] || '';
    if (!ac || ac==='-') continue;
    campRe.lastIndex = 0;
    let m;
    while ((m = campRe.exec(ac)) !== null) {
      if (m[1].toUpperCase()===grup && parseInt(m[2])===esik && m[3].toUpperCase()!==mevcutRol) {
        bulunan = true; break;
      }
    }
    if (bulunan) break;
  }
  if (!bulunan) return '';

  const isProje = camp.tip === 'proje';
  const bg    = pending ? '#451a03' : isProje ? '#2e1065' : '#172554';
  const color = pending ? '#fcd34d' : isProje ? '#c4b5fd' : '#93c5fd';
  const bdr   = pending ? '#d97706' : isProje ? '#6d28d9' : '#1e40af';

  return `<button type='button' class='camp-ara-btn'
    data-grup='${grup}' data-esik='${esik}' data-exclude-rol='${mevcutRol}'
    title='${grup} eşik tamamlayıcı ürünleri ara'
    style='display:inline-flex;align-items:center;justify-content:center;
      width:15px;height:15px;border-radius:3px;
      background:${bg};color:${color};border:1px solid ${bdr};
      cursor:pointer;font-size:.55rem;flex-shrink:0;margin-left:2px;
      vertical-align:middle;font-family:inherit;padding:0;
      line-height:1;position:relative;top:-1px'>🔍</button>`;
}

function renderCampaignPills(item, idx) {
  if (!item.aciklama || item.aciklama === '-') return '';
  if (!item._campaigns)     item._campaigns    = parseCampaigns(item.aciklama);
  if (!item._campaigns.length) return '';
  if (!item._selectedCamps) item._selectedCamps = {};
  if (!item._pendingGroups) item._pendingGroups = {};

  // Seçim durumu tespiti
  const itemHasKilitli  = Object.entries(item._selectedCamps).some(
    ([ci, sel]) => sel && item._campaigns[parseInt(ci)]?.tip === 'kilitli'
  );
  const itemHasBirlesen = Object.entries(item._selectedCamps).some(
    ([ci, sel]) => sel && item._campaigns[parseInt(ci)]?.tip === 'birlesen'
  );

  // Renk paleti — her grup sabit renk
  const PAL = {
    PAP:   { sel:'#166534', unsel:'#15803d', line:'#bbf7d0', bg:'#f0fdf4' },
    KEA:   { sel:'#1e40af', unsel:'#1d4ed8', line:'#bfdbfe', bg:'#eff6ff' },
    KM:    { sel:'#9a3412', unsel:'#c2410c', line:'#fed7aa', bg:'#fff7ed' },
    IKILI: { sel:'#6b21a8', unsel:'#7e22ce', line:'#e9d5ff', bg:'#faf5ff' },
    ANK:   { sel:'#9f1239', unsel:'#be123c', line:'#fecdd3', bg:'#fff1f2' },
    BILGI: { sel:'#5b21b6', unsel:'#6d28d9', line:'#ddd6fe', bg:'#f5f3ff' },
    DIGER: { sel:'#1e293b', unsel:'#334155', line:'#e2e8f0', bg:'#f8fafc' },
    PROJE:    { sel:'#6b21a8', unsel:'#7e22ce', line:'#e9d5ff', bg:'#faf5ff' },
    BAGIMSIZ: { sel:'#0f766e', unsel:'#0d9488', line:'#99f6e4', bg:'#f0fdfa' },
  };

  const pills = item._campaigns.map((camp, ci) => {
    const sel     = !!item._selectedCamps[ci];
    const locked  = camp.tip === 'kilitli';
    const pending = sel && (item._pendingGroups[camp.grup] === true);
    const isBilgi = camp.tip === 'bilgi' || camp.grup === 'BILGI';
    const pal     = PAL[camp.grup] || PAL.DIGER;

    // Devre dışı: tür çakışması VEYA aynı üründe başka 🔒 zaten seçiliyse
    const itemHasProje    = Object.entries(item._selectedCamps).some(
      ([ci2, sel2]) => sel2 && item._campaigns[parseInt(ci2)]?.tip === 'proje'
    );
    const itemHasBagimsiz = Object.entries(item._selectedCamps).some(
      ([ci2, sel2]) => sel2 && item._campaigns[parseInt(ci2)]?.tip === 'bagimsiz'
    );
    // Aynı üründe aynı proje grubundan zaten seçili mi?
    const ayniProjeGrupVar = camp.tip === 'proje' && !sel && Object.entries(item._selectedCamps).some(([ci2,s2]) => {
      if (!s2) return false;
      const c2 = item._campaigns[parseInt(ci2)];
      return c2 && c2.tip === 'proje' && c2.grup === camp.grup;
    });
    const disabled = !sel && !isBilgi && (
      (itemHasKilitli  && camp.tip === 'birlesen') ||
      (itemHasBirlesen && camp.tip === 'kilitli') ||
      // aynı üründe başka 🔒 seçiliyse diğer 🔒'lar disable — radio-button davranışı
      // (grup fark etmez — bir üründe yalnızca tek 🔒 aktif olabilir)
      (camp.tip === 'kilitli' && itemHasKilitli) ||
      (itemHasProje    && camp.tip !== 'proje')    ||   // proje seçiliyken diğerleri devre dışı
      (!itemHasProje   && camp.tip === 'proje' && (itemHasKilitli || itemHasBirlesen)) ||
      (itemHasBagimsiz && camp.tip === 'bagimsiz') ||   // aynı üründe 2. ⌗ engelle
      ayniProjeGrupVar                                   // aynı proje grubundan 2. seçim engelle
      // NOT: ⌗ 🔒 ve ⎇ ile birlikte seçilebilir — onları disable etmez
    );

    // Tutar formatı
    const tutarVal = camp.tutar || 0;
    const tutarStr = tutarVal > 0 && !isBilgi
      ? (tutarVal >= 1000 ? (tutarVal/1000).toFixed(tutarVal%1000===0?0:1)+'k' : tutarVal) + _tlSym()
      : '';

    // Harf rozeti
    const harfStr = (camp.rol && camp.rol !== 'ANY' && !sel)
      ? ' · ' + camp.rol : '';

    // Label: tarih ve eşik/rol parantezi temizlenmiş
    const metinTemiz = camp.metin
      .replace(/\s*\[\d{2}\.\d{2}\.\d{2,4}\]\s*/g, '')
      .replace(/\s*\(\d+\/[A-Z]\)\s*/g, '')
      .trim();
    const label = _esc(metinTemiz.length > 26 ? metinTemiz.slice(0,24) + '…' : metinTemiz);

    // Kalan eşik hesabı
    const esikGerekli = camp.esik || 1;
    let esikSecilen = 0;
    if (esikGerekli >= 2) {
      const _b = (typeof basket !== 'undefined' ? basket : []);
      const sepBiSet = new Set();
      _b.forEach((bi2, biIdx) => {
        if (!bi2._selectedCamps || !bi2._campaigns) return;
        Object.entries(bi2._selectedCamps).forEach(([ci2, s2]) => {
          if (!s2) return;
          const c2 = bi2._campaigns[parseInt(ci2)];
          if (c2 && c2.grup === camp.grup) sepBiSet.add(biIdx);
        });
      });
      esikSecilen = sepBiSet.size;
    }
    const kalanEsik = Math.max(0, esikGerekli - esikSecilen);

    // Stil
    let style;
    if (isBilgi) {
      style = `background:${pal.bg};color:${pal.unsel};border-bottom:1.5px solid ${pal.line};opacity:.75;cursor:default;`;
    } else if (disabled) {
      style = `background:#1e293b;color:#94a3b8;border-bottom:1.5px solid #334155;opacity:.28;cursor:not-allowed;`;
    } else if (sel && pending) {
      style = `background:rgba(251,191,36,.18);color:#b45309;border-bottom:2px solid #f59e0b;font-weight:700;cursor:pointer;`;
    } else if (sel) {
      style = `background:#dcfce7;color:${pal.sel};border-bottom:2px solid #4ade80;font-weight:800;text-decoration:line-through;text-decoration-color:#4ade80;cursor:pointer;`;
    } else {
      const tarihDolmus = camp.sonTarih && new Date() > camp.sonTarih;
      style = tarihDolmus
        ? `background:#f1f5f9;color:#94a3b8;border-bottom:1.5px solid #e2e8f0;font-weight:600;cursor:not-allowed;text-decoration:line-through;opacity:.55;`
        : `background:${pal.bg};color:${pal.unsel};border-bottom:1.5px solid ${pal.line};font-weight:600;cursor:pointer;`;
    }

    const baseStyle = `display:inline-flex;align-items:center;gap:3px;padding:3px 9px 4px;`
      + `border-radius:4px 4px 0 0;font-size:.60rem;white-space:nowrap;`
      + `margin:0 3px 0 0;transition:opacity .15s,background .15s;border:none;font-family:inherit;`;

    const isProje    = camp.tip === 'proje';
    const isBagimsiz = camp.tip === 'bagimsiz';
    const icon = isBilgi              ? '✦'
      : isProje && sel && !pending    ? '✓'
      : isProje && sel && pending     ? '⏳'
      : isProje                       ? '❖'
      : isBagimsiz                    ? '⌗'
      : sel && !pending               ? '✓'
      : sel && pending                ? '⏳'
      : locked                        ? '🔒'
      : '⎇';

    // Eşik rozeti: seçilmemiş→xN, pending→+N
    let pillRozet = '';
    if (!isBilgi && esikGerekli >= 2) {
      if (sel && pending && kalanEsik > 0) {
        pillRozet = `<span style="font-size:.50rem;background:#d97706;color:#fff;padding:1px 4px;border-radius:3px;font-weight:800;margin-left:3px;flex-shrink:0">+${kalanEsik}</span>`;
      } else if (!sel) {
        pillRozet = `<span style="font-size:.48rem;background:rgba(0,0,0,.10);color:inherit;padding:1px 4px;border-radius:3px;font-weight:700;margin-left:2px;opacity:.75;flex-shrink:0">x${esikGerekli}</span>`;
      }
    }

    // Arama noktası — pill içi, camp-ara-btn class ile event delegation'a dahil
    const searchDot = (()=>{
      if (!['birlesen','kilitli','proje'].includes(camp.tip)) return '';
      if (!camp.tutar||camp.tutar<=0||!camp.esik||camp.esik<2) return '';
      if (camp.sonTarih && new Date()>camp.sonTarih) return '';
      const sc2=item._selectedCamps||{}, pg2=item._pendingGroups||{};
      const secili2=!!(sc2[ci]||sc2[String(ci)]||sc2[Number(ci)]);
      const pend2=secili2&&(pg2[camp.grup]===true);
      if (secili2&&!pend2) return '';
      const gr2=(camp.grup||'').toUpperCase(), es2=camp.esik;
      const mr2=(camp.rol||'ANY').toUpperCase();
      const dotBg=pend2?'rgba(217,119,6,.35)':isProje?'rgba(109,40,217,.3)':'rgba(30,64,175,.3)';
      const dotColor=pend2?'#fcd34d':isProje?'#c4b5fd':'#93c5fd';
      return `<span class="camp-ara-btn" data-grup="${gr2}" data-esik="${es2}" data-exclude-rol="${mr2}"
        title="${gr2} eşik tamamlayıcı ürünleri ara"
        style="display:inline-flex;align-items:center;justify-content:center;
          width:13px;height:13px;border-radius:50%;
          background:${dotBg};color:${dotColor};
          cursor:pointer;font-size:.45rem;flex-shrink:0;
          margin-left:4px;line-height:1;
          border:1px solid ${dotColor};opacity:.85">🔍</span>`;
    })();

    const tarihDolmus2 = camp.sonTarih && new Date() > camp.sonTarih;
    const clickAttr = (!disabled && !isBilgi && !tarihDolmus2)
      ? ` onclick="toggleCampaign(${idx},${ci})"` : '';

    // ── Bilgi (✦) — buton değil, zarif metin etiketi ─────────────────
    if (isBilgi) {
      return `<span title="${_esc(camp.metin)}" `
        + `style="display:inline-flex;align-items:center;gap:3px;`
        + `padding:2px 7px 3px;border-radius:4px;font-size:.60rem;white-space:nowrap;`
        + `margin:0 3px 0 0;font-family:inherit;font-weight:500;`
        + `background:transparent;color:${pal.unsel};opacity:.70;`
        + `border-bottom:1px dashed ${pal.line};letter-spacing:.01em;pointer-events:none;">`
        + `<span style="font-size:.58rem;opacity:.8">✦</span>`
        + `<span>${label}</span>`
        + `</span>`;
    }

    return `<button type="button"${clickAttr} title="${_esc(camp.metin)}" `
      + `style="${baseStyle}${style}">`
      + `<span style="font-size:.68rem;line-height:1">${icon}</span>`
      + `<span style="margin-left:1px">${label}</span>`
      + pillRozet
      + searchDot
      + `</button>`;
  }).join('');

  // Özet satırı — pending iken kaç eşik eksik dinamik hesapla
  const campDisc = item._campDisc || 0;
  const projeAktifPill = item._projeNakit !== undefined;
  const secilenSayi = Object.values(item._selectedCamps).filter(Boolean).length;
  let pendingSummaryText = '⏳ eşik bekleniyor';
  if (secilenSayi > 0 && campDisc === 0 && !projeAktifPill) {
    const pendingEntry = Object.entries(item._selectedCamps).find(([ci2, s2]) => {
      if (!s2) return false;
      const c2 = item._campaigns?.[parseInt(ci2)];
      return c2 && item._pendingGroups?.[c2.grup] === true;
    });
    if (pendingEntry) {
      const pc = item._campaigns?.[parseInt(pendingEntry[0])];
      if (pc) {
        const _b2 = (typeof basket !== 'undefined' ? basket : []);
        const pSet = new Set();
        _b2.forEach((bi3, biIdx3) => {
          if (!bi3._selectedCamps || !bi3._campaigns) return;
          Object.entries(bi3._selectedCamps).forEach(([ci3, s3]) => {
            if (!s3) return;
            const c3 = bi3._campaigns[parseInt(ci3)];
            if (c3 && c3.grup === pc.grup) pSet.add(biIdx3);
          });
        });
        const kalan3 = Math.max(0, (pc.esik || 2) - pSet.size);
        if (kalan3 > 0) pendingSummaryText = `⏳ ${kalan3} eşik eklenmelidir`;
      }
    }
  }
  const summaryRow = secilenSayi > 0
    ? `<div style="display:flex;align-items:center;gap:5px;margin-top:3px">`
      + (projeAktifPill
        ? (() => {
            // Satır özeti: "❖ EA+SFS · 159.999 TL" — kimlik + fiyat birlikte
            const grupEtiketi = (item._projeGrup || 'Proje').replace(/\s+[\d.,\[\]\s]+.*$/, '').trim() || 'Proje';
            const fiyatStr = item._projeNakit !== undefined ? fmt(item._projeNakit) : '';
            return `<span style="font-size:.57rem;background:#dcfce7;color:#15803d;border-radius:3px;padding:1px 7px;font-weight:700">✓ ${grupEtiketi} · ${fiyatStr}</span>`;
          })()
        : campDisc > 0
          ? `<span style="font-size:.57rem;background:#dcfce7;color:#15803d;border-radius:3px;padding:1px 7px;font-weight:700">✓ -${campDisc>=1000?(campDisc/1000).toFixed(campDisc%1000===0?0:1)+'k':campDisc}${_tlSym()}</span>`
          : `<span style="font-size:.57rem;background:rgba(251,191,36,.2);color:#b45309;border-radius:3px;padding:1px 7px;font-weight:600;border:1px solid rgba(245,158,11,.3)">${pendingSummaryText}</span>`)
      + `<button type="button" onclick="clearAllCampaigns(${idx})" `
        + `style="margin-left:auto;padding:1px 7px;border-radius:3px;font-size:.54rem;cursor:pointer;`
        + `background:#fee2e2;border:none;color:#dc2626;font-family:inherit;font-weight:700">✕</button>`
      + `</div>`
    : '';

  return `<div style="margin-top:4px;line-height:2">${pills}${summaryRow}</div>`;
}

function setItemDisc(idx, val) {
  // Manuel indirim girişi: kampanya indirimini (_campDisc) koru, üstüne ekle
  const item = basket[idx];
  if (!item) return;
  const campDisc = item._campDisc || 0;
  const manuelVal = Math.max(0, parseFloat(val) || 0);
  // Toplam itemDisc = manuel + kampanya
  item.itemDisc = campDisc + manuelVal;
  saveBasket();
  updateCartUI();
  // Panel güncelleme
  const totalItemDisc = Basket.totalItemDisc();
  const panel = document.getElementById('cart-disc-panel');
  if (panel) {
    const span = panel.querySelector('span');
    if (span && totalItemDisc > 0) span.textContent = 'Toplam satır ind: ' + fmt(totalItemDisc);
  }
}

function setNakitOverride(idx, val) {
  const item = basket[idx];
  if (!item) return;
  const parsed = parseFloat(val);
  if (!val || val === '' || isNaN(parsed)) {
    // Boş bırakılınca override kaldır
    delete item._nakitOverride;
  } else {
    item._nakitOverride = Math.max(0, parsed);
  }
  saveBasket();
  updateCartUI();
}

function toggleCartDiscPanel() {
  const panel = document.getElementById('cart-disc-panel');
  if (!panel) return;
  const isOpen = panel.dataset.open === '1';
  if (isOpen) {
    // Sadece manuel girişleri sıfırla — kampanya indirimlerini koru
    basket.forEach(i => {
      const campDisc = i._campDisc || 0;
      i.itemDisc = campDisc; // sadece kampanya kısmını bırak
    });
    saveBasket();
    window._cartDiscOpen = false;
  } else {
    window._cartDiscOpen = true;
  }
  updateCartUI();
}

// =============================================================
// SEPET ARAYÜZÜ (hatalı karakterler temizlenmiş)
// =============================================================
// ═══════════════════════════════════════════════════════════════
// SEPET UI — Katman Ayrımı
// updateCartUI() → render fonksiyonlarını çağırır
// _buildAdminCartHTML() — Admin görünümü
// _buildUserCartHTML()  — Satış kullanıcısı görünümü
// ═══════════════════════════════════════════════════════════════

function updateCartUI() {
  const ce = document.getElementById('cart-count');
  if (ce) ce.innerText = basket.length;
  // Alt bar sepet rozeti
  const tabBadge = document.getElementById('tab-cart-badge');
  if (tabBadge) {
    if (basket.length > 0) {
      tabBadge.textContent = basket.length;
      tabBadge.style.display = 'flex';
    } else {
      tabBadge.style.display = 'none';
    }
  }
  const badge = document.getElementById('cart-modal-count');
  if (badge) badge.textContent = basket.length + ' ürün';
  const area = document.getElementById('cart-table-area');
  if (!area) return;

  if (!basket.length) {
    area.innerHTML = '<div class="empty-cart"><span class="empty-cart-icon">🛒</span>Sepetiniz boş</div>';
    return;
  }

  area.innerHTML = isNakitSepet() ? _buildAdminCartHTML() : _buildUserCartHTML();
  try { if (typeof checkUpsellOpportunities === 'function') checkUpsellOpportunities(); } catch(e) {}
}

// ── Admin sepet HTML ─────────────────────────────────────────
function _buildAdminCartHTML() {
  const t = Basket.totals();
  const totalItemDisc = Basket.totalItemDisc();
  let rows = '';

  basket.forEach((item, idx) => {
    const itemDisc    = item.itemDisc || 0;
    const projeAktif  = item._projeNakit !== undefined;
    const hasOverride = item._nakitOverride !== undefined;
    // Alt toplam metodu: liste bazı + proje farkı
    const listeBase    = hasOverride ? item._nakitOverride : item.nakit;
    const efektifFiyat = projeAktif
                       ? listeBase + (item._projeNakit - listeBase)  // = item._projeNakit
                       : listeBase;
    const nakitNet    = Math.max(0, efektifFiyat - (projeAktif || hasOverride ? 0 : itemDisc));
    const hasDisc     = !projeAktif && !hasOverride && itemDisc > 0;

    rows += `<tr class="${hasDisc ? 'row-has-disc' : ''}${projeAktif ? ' row-proje-aktif' : ''}${hasOverride ? ' row-override-aktif' : ''}">
      <td style="width:30px; text-align:center;">
        <input type="checkbox" class="cart-item-checkbox" value="${idx}" style="width:18px; height:18px; cursor:pointer;">
      <\/td>
      <td><span class="product-name" style="font-size:.74rem">${item.urun}</span><\/td>
      <td class="${item.stok === 0 ? 'cart-stok-0' : ''}" style="font-size:.71rem">${item.stok}<\/td>
      <td style="max-width:150px;vertical-align:middle">
        ${renderCampaignPills(item, idx)}
      <\/td>
      <td style="padding:3px 5px;vertical-align:middle">
        <div style="display:flex;align-items:center;gap:2px">
          <input type="number" class="item-nakit-override" data-idx="${idx}"
            value="${hasOverride ? item._nakitOverride : ''}"
            placeholder="${item.nakit}"
            onblur="setNakitOverride(${idx},this.value)"
            onkeydown="if(event.key==='Enter'){setNakitOverride(${idx},this.value);this.blur()}"
            style="width:72px;padding:3px 5px;
              border:1.5px solid ${hasOverride ? '#f97316' : projeAktif ? '#c4b5fd' : 'var(--border)'};
              border-radius:5px;font-size:.68rem;text-align:right;font-family:inherit;
              background:${hasOverride ? '#fff7ed' : projeAktif ? '#f5f3ff' : 'var(--surface)'};
              color:${hasOverride ? '#c2410c' : projeAktif ? '#7c3aed' : 'var(--text-1)'};
              font-weight:${hasOverride || projeAktif ? '700' : '400'}">
          ${hasOverride ? `<button onclick="setNakitOverride(${idx},'')" style="background:none;border:none;color:#f97316;cursor:pointer;padding:1px;font-size:.75rem" title="Sıfırla">✕</button>` : ''}
        </div>
      <\/td>
      <td style="padding:4px 6px">
        ${projeAktif
          ? (() => {
              // SATIR İND. kısmına indirim tutarı değil kampanya kimliği (grup) gösterilir
              // Örn: EA+SFS 159.999 → "❖ EA+SFS"
              const grupEtiketi = (item._projeGrup || 'Proje').replace(/\s+[\d.,\[\]\s]+.*$/, '').trim() || 'Proje';
              return `<span style="
                display:inline-flex;align-items:center;gap:3px;
                font-size:.60rem;color:#7c3aed;font-weight:700;
                background:#f5f3ff;border:1px solid #c4b5fd;
                border-radius:5px;padding:2px 7px;white-space:nowrap;
                letter-spacing:.01em">❖ ${grupEtiketi}</span>`;
            })()
          : `<div style="display:flex;align-items:center;gap:3px">
          <input type="number" class="item-disc-input" data-idx="${idx}" min="0" value="${Math.max(0,(itemDisc||0)-(item._campDisc||0)) || ''}" placeholder="ind."
            onblur="setItemDisc(${idx}, this.value)"
            onkeydown="if(event.key==='Enter'){setItemDisc(${idx}, this.value); this.blur()}"
            style="width:52px;padding:3px 4px;border:1px solid ${hasDisc ? '#93c5fd' : 'var(--border)'};border-radius:5px;font-size:.67rem;text-align:right;background:${hasDisc ? '#eff6ff' : 'var(--surface)'};">
          ${hasDisc ? '<button onclick="setItemDisc(' + idx + ', 0); clearAllCampaigns(' + idx + ');" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:1px;font-size:.75rem;line-height:1" title="İndirimi sıfırla">✕</button>' : ''}
        </div>`}
      <\/td>
      <td class="cart-price${hasDisc ? ' cart-price-net' : ''}">${(hasDisc || projeAktif || hasOverride) ? fmt(nakitNet) : ''}<\/td>
      <td><button class="remove-btn haptic-btn" onclick="removeFromBasket(${idx})">×</button><\/td>
    <\/tr>`;
  });

  const baseAfterItemDisc = t.nakitNet - totalItemDisc;  // NET bazı: proje/override fiyatları
  const listeBase          = t.nakit;                     // Liste bazı: override/nakit (❖ yok)
  const discVal = getDisc(baseAfterItemDisc);
  const nakitFinal = Math.max(0, baseAfterItemDisc - discVal);

  let dr_item = totalItemDisc > 0 ? `<tr class="discount-row" style="background:#f0fdf4">
    <td colspan="4" style="text-align:right;font-size:.68rem;color:#15803d">Satır İndirimleri Toplamı<\/td>
    <td class="cart-price" style="text-decoration:none;color:#6b7280;font-size:.75rem">${fmt(listeBase)}<\/td>
    <td><\/td>
    <td class="cart-price" style="color:#16a34a;font-weight:700">-${fmt(totalItemDisc)}<\/td>
    <td><\/td>
  <\/tr>` : '';

  let dr = discountAmount > 0 ? `<tr class="discount-row" style="background:#fff7ed">
    <td colspan="4" style="text-align:right;font-size:.68rem;color:#c2410c">Alt İndirim ${discountType === 'PERCENT' ? '%' + discountAmount : fmt(discountAmount)}<\/td>
    <td class="cart-price" style="color:#6b7280;font-size:.75rem">${fmt(baseAfterItemDisc)}<\/td>
    <td><\/td>
    <td class="cart-price" style="color:#f97316;font-weight:700">-${fmt(discVal)}<\/td>
    <td><\/td>
  <\/tr>` : '';

  const hasAnyDisc = discountAmount > 0 || totalItemDisc > 0;
  const tot = `<tr class="total-row">
    <td colspan="4" style="text-align:right;font-weight:800;font-size:.78rem">NET TOPLAM<\/td>
    <td class="cart-price" style="text-decoration:${hasAnyDisc ? 'line-through' : 'none'};opacity:${hasAnyDisc ? '.45' : '1'};font-size:.72rem">${fmt(listeBase)}<\/td>
    <td><\/td>
    <td class="cart-price" style="font-weight:800;color:var(--text-1);font-size:.85rem">${fmt(nakitFinal)}<\/td>
    <td><\/td>
  <\/tr>`;

  return `<table class="cart-table">
    <thead>
      <th style="width:30px"></th><th>Ürün</th><th>Stok</th><th>Kampanya</th><th>Liste</th><th style="min-width:70px">Satır İnd.</th><th>Net</th><th></th>
    </thead>
    <tbody>${rows}${dr_item}${dr}${tot}</tbody>
  <\/table>`;
}

// ── Satış/Destek kullanıcısı sepet HTML ─────────────────────
function _buildUserCartHTML() {
  const t = Basket.totals();
  let rows = '';

  basket.forEach((item, idx) => {
    rows += `<tr>
      <td style="width:30px; text-align:center;">
        <input type="checkbox" class="cart-item-checkbox" value="${idx}" style="width:18px; height:18px; cursor:pointer;">
      <\/td>
      <td><span class="product-name" style="font-size:.75rem">${item.urun}</span><\/td>
      <td class="${item.stok === 0 ? 'cart-stok-0' : ''}">${item.stok}<\/td>
      <td style="font-size:.65rem;color:var(--text-3);max-width:90px;word-break:break-word">${item.aciklama}<\/td>
      <td class="cart-price">${fmt(item.dk)}<\/td>
      <td class="cart-price">${fmt(item.awm)}<\/td>
      <td class="cart-price">${fmt(item.tek)}<\/td>
      <td class="cart-price">${fmt(item.nakit)}<\/td>
      <td><button class="remove-btn haptic-btn" onclick="removeFromBasket(${idx})">×</button><\/td>
    <\/tr>`;
  });

  const discVal = getDisc(t.nakit);
  let dr = discountAmount > 0 ? `<tr class="discount-row">
    <td colspan="4" style="text-align:right;font-size:.69rem">İndirim ${discountType === 'PERCENT' ? '%' + discountAmount : fmt(discountAmount)}<\/td>
    <td class="cart-price">-${fmt(getDisc(t.dk))}<\/td>
    <td class="cart-price">-${fmt(getDisc(t.awm))}<\/td>
    <td class="cart-price">-${fmt(getDisc(t.tek))}<\/td>
    <td class="cart-price">-${fmt(discVal)}<\/td>
    <td><\/td>
  <\/tr>` : '';

  const tot = `<tr class="total-row">
    <td colspan="4" style="text-align:right;font-weight:700">NET TOPLAM<\/td>
    <td class="cart-price">${fmt(t.dk - getDisc(t.dk))}<\/td>
    <td class="cart-price">${fmt(t.awm - getDisc(t.awm))}<\/td>
    <td class="cart-price">${fmt(t.tek - getDisc(t.tek))}<\/td>
    <td class="cart-price">${fmt(t.nakit - discVal)}<\/td>
    <td><\/td>
  <\/tr>`;

  return `<table class="cart-table">
    <thead>
      <th style="width:30px"></th><th>Ürün</th><th>Stok</th><th>Açıklama</th><th>D.Kart</th><th>4T AWM</th><th>Tek Çekim</th><th>Nakit</th><th></th>
    </thead>
    <tbody>${rows}${dr}${tot}</tbody>
  <\/table>`;
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

  // Sepet boş ama bu oturumda blur açıldıysa → ürün seçtir, sepete ekle
  if (!basket.length) {
    const blurEntries = Object.entries(_blurredThisSession); // [[urunAdi, idx], ...]

    if (!blurEntries.length) {
      await ayAlert('Önce sepete ürün ekleyin!');
      return;
    }

    if (blurEntries.length === 1) {
      // Tek ürün: direkt sor
      const [ad, idx] = blurEntries[0];
      const onay = await ayConfirm(
        'Son fiyat bakılan ürün:\n"' + ad + '"\n\nSepete ekleyip hesaplayalım mı?'
      );
      if (!onay) return;
      addToBasket(idx);
    } else {
      // Birden fazla ürün: hangisini hesaplayacağını seç
      // ayPrompt ile ürün listesi göster
      const liste = blurEntries.map(([ad], i) => (i + 1) + '. ' + ad).join('\n');
      const secim = await ayPrompt(
        'Fiyatına bakılan urunler:\n' + liste +
        '\n\nHangi urunu hesaplayalim? (Numara yaz, orn: 1)',
        ''
      );
      if (!secim) return;
      const secilenIdx = parseInt(secim.trim()) - 1;
      if (isNaN(secilenIdx) || secilenIdx < 0 || secilenIdx >= blurEntries.length) {
        await ayAlert('Geçersiz seçim.');
        return;
      }
      const [, productIdx] = blurEntries[secilenIdx];
      addToBasket(productIdx);
    }
  }

  // Intent Level 3: Abaküs açıldı
  if (_intentLevel < 3) _intentLevel = 3;


  abakusSelection = null;

  // Pazarlık indirimini sıfırla
  const _ekReset = document.getElementById('ab-ek-indirim');
  if (_ekReset) _ekReset.value = '';
  const _notReset = document.getElementById('ab-pazarlik-notu');
  if (_notReset) _notReset.value = '';
  const m = document.getElementById('abakus-modal');
  m.style.display = 'flex';
  m.classList.add('open');

  // Tab durumunu sıfırla — her açılışta Kartlar sekmesinden başla
  window._abAktifTab = 'kart';
  ['kart','kredi'].forEach(t => {
    const btn = document.getElementById('ab-tab-' + t);
    if (btn) btn.classList.toggle('ab-type-active', t === 'kart');
  });
  const _kartRow  = document.getElementById('ab-kart-row');
  const _krediRow = document.getElementById('ab-kredi-row');
  if (_kartRow)  _kartRow.style.display  = 'flex';
  if (_krediRow) _krediRow.style.display = 'none';

  buildAbakusKartlar();

  // QF'ten gelen açılışta plan uygula — normal açılışlarda atla
  const _itemPlan = window._openAbakusFromQF && basket.length > 0 && basket[0]._qfKart ? basket[0] : null;
  window._openAbakusFromQF = false; // bir kerelik sıfırla
  if (_itemPlan) {
    const ks = document.getElementById('ab-kart');
    if (ks) {
      const opts = Array.from(ks.options).map(o => o.value);
      const kartMatch = opts.includes(_itemPlan._qfKart)
        ? _itemPlan._qfKart
        : opts.find(o => o.toLowerCase().includes(_itemPlan._qfKart.toLowerCase()));
      if (kartMatch) ks.value = kartMatch;
    }
    // _savedPlan mekanizması için geçici set — calcAbakus render sonrası seçer
    abakusSelection = {
      kart: _itemPlan._qfKart,
      taksit: _itemPlan._qfTaksit,
      zincir: _itemPlan._qfZincir || _itemPlan._qfKart,
      label: _itemPlan._qfPlanLabel || '',
      aylik: _itemPlan._qfAylik || 0,
      tahsilat: 0
    };
  }

  calcAbakus();
}

// Abaküs, ödeme aksiyonundan (WA/Teklif/Satış) kapatılıyorsa bar gösterme
let _abakusClosedByAction = false;

function closeAbakus() {
  const m = document.getElementById('abakus-modal');
  m.classList.remove('open');
  m.style.display = 'none';
  // Sadece X ile kapatılırsa (aksiyon seçilmeden) floating bar göster
  if (!_abakusClosedByAction) {
    _showFloatingFeedback();
  }
  _abakusClosedByAction = false; // sıfırla
}

// Abaküs aktif tab durumu: 'kart' | 'kredi'
window._abAktifTab = 'kart';
// Kredi için seçili kurum
window._abKrediKurum = '';

function switchAbakusTab(tab) {
  window._abAktifTab = tab;
  // Tab buton stilleri
  ['kart','kredi'].forEach(t => {
    const btn = document.getElementById('ab-tab-' + t);
    if (btn) btn.classList.toggle('ab-type-active', t === tab);
  });
  // Üst satır göster/gizle
  const kartRow  = document.getElementById('ab-kart-row');
  const krediRow = document.getElementById('ab-kredi-row');
  if (kartRow)  kartRow.style.display  = tab === 'kart'  ? 'flex' : 'none';
  if (krediRow) krediRow.style.display = tab === 'kredi' ? 'flex' : 'none';
  // Aksiyon panelini sıfırla
  abakusSelection = null;
  const actDiv = document.getElementById('ab-actions');
  if (actDiv) actDiv.style.display = 'none';
  calcAbakus();
}

function buildAbakusKartlar() {
  if (!allRates.length) return;

  // ── Kart select ──
  const kartlar = [];
  allRates.forEach(r => {
    if (r.Kart && !kartlar.includes(r.Kart) && (r.Tip||'').toLowerCase() !== 'kredi') kartlar.push(r.Kart);
  });
  const ks = document.getElementById('ab-kart');
  if (ks) ks.innerHTML = kartlar.map(k => `<option value="${k}">${k}</option>`).join('');

  // ── Kredi kurum chip'leri ──
  const krediKartlar = [];
  allRates.forEach(r => {
    if (r.Kart && !krediKartlar.includes(r.Kart) && (r.Tip||'').toLowerCase() === 'kredi') krediKartlar.push(r.Kart);
  });
  const chipsEl = document.getElementById('ab-kredi-kurumlar');
  if (chipsEl && krediKartlar.length) {
    if (!window._abKrediKurum || !krediKartlar.includes(window._abKrediKurum)) {
      window._abKrediKurum = krediKartlar[0];
    }
    const KURUM_ICON = { 'TOMBank': '🟠', 'Zip': '🟣' };
    chipsEl.innerHTML = krediKartlar.map(k => {
      const ico = KURUM_ICON[k] || '🏦';
      const isActive = k === window._abKrediKurum;
      return `<button class="ab-kredi-chip${isActive ? ' active' : ''}" onclick="selectKrediKurum('${k}')">` +
        `<span class="ab-kredi-chip-icon">${ico}</span>` +
        `<span class="ab-kredi-chip-name">${k}</span>` +
        `</button>`;
    }).join('');
  }
  // Kredi badge (kaç kurum var)
  const badgeEl = document.getElementById('ab-kredi-badge');
  if (badgeEl) {
    if (krediKartlar.length > 0) { badgeEl.textContent = krediKartlar.length; badgeEl.classList.add('visible'); }
    else badgeEl.classList.remove('visible');
  }
}

function selectKrediKurum(kurum) {
  window._abKrediKurum = kurum;
  // Chip aktif stilini güncelle
  document.querySelectorAll('.ab-kredi-chip').forEach(el => {
    el.classList.toggle('active', el.querySelector('.ab-kredi-chip-name')?.textContent === kurum);
  });
  // Aksiyon sıfırla
  abakusSelection = null;
  const actDiv = document.getElementById('ab-actions');
  if (actDiv) actDiv.style.display = 'none';
  calcAbakus();
}

window.switchAbakusTab  = switchAbakusTab;
window.selectKrediKurum = selectKrediKurum;

// ══════════════════════════════════════════════════════════════
// Hızlı Finans Modalı (Quick Finance) — Ana ekrandan taksit/kredi
// ══════════════════════════════════════════════════════════════
let _qfUrunIdx   = null;
let _qfNakit     = 0;
let _qfPlan      = null;
let _qfAktifTab  = 'tekcekim';
let _qfTaksitKart = '';
let _qfKrediKurum = '';

function openQuickFinance(urunIdx, nakitFiyat) {
  const urun    = allProducts[urunIdx] || {};
  const urunKey = Object.keys(urun).find(k => norm(k) === 'urun') || '';
  const descKey = Object.keys(urun).find(k => norm(k) === 'aciklama') || '';
  const urunAd  = urun[urunKey] || 'Ürün';
  const aciklama = urun[descKey] || urun.Aciklama || '';

  // Banner: proje fiyatı veya kampanya — artık sadece bilgi gösterir, Sepete Git footer'da
  let kampanyaBanner = '';
  if (aciklama.includes('\u2756')) {
    kampanyaBanner = '<div class="qf-camp-banner qf-camp-proje">' +
      '<span class="qf-camp-icon">\u2756</span>' +
      '<div><b>Proje Fiyatı Mevcut</b>' +
      '<div class="qf-camp-sub">Sepete eklendiğinde ödeme ekranından proje fiyatını seçebilirsiniz.</div></div>' +
      '</div>';
  } else if (typeof parseCampaigns === 'function' && aciklama) {
    const camps = parseCampaigns(aciklama);
    const kampanyalar = camps.filter(c => c.tip !== 'bilgi' && c.tip !== 'proje');
    if (kampanyalar.length > 0) {
      const campOzet = kampanyalar.map(c => {
        const s = c.tutar >= 1000 ? (c.tutar/1000).toFixed(c.tutar%1000===0?0:1)+'k' : String(c.tutar);
        return c.grup + ' -' + s;
      }).join(' \u00b7 ');
      kampanyaBanner = '<div class="qf-camp-banner">' +
        '<span class="qf-camp-icon">\uD83C\uDFF7\uFE0F</span>' +
        '<div><b>Sepette kampanya indirimi mevcut:</b> ' + campOzet +
        '<div class="qf-camp-sub">Sepete ekleyip ödeme ekranından devam ederseniz daha avantajlı fiyat oluşabilir.</div></div>' +
        '</div>';
    }
  }

  _qfUrunIdx  = urunIdx;
  _qfNakit    = nakitFiyat || 0;
  _qfPlan     = null;
  _qfAktifTab = 'tekcekim';

  incrementDailyStat('blur_sayisi', 1).catch(() => {});

  const modal = document.getElementById('qf-modal');
  if (!modal) return;

  const el = document.getElementById('qf-urun-ad');
  if (el) el.textContent = urunAd;
  const nakEl = document.getElementById('qf-nakit-fiyat');
  if (nakEl) nakEl.textContent = 'Nakit: ' + fmt(nakitFiyat);
  const bannerEl = document.getElementById('qf-camp-banner-slot');
  if (bannerEl) bannerEl.innerHTML = kampanyaBanner;

  _qfSwitchTab('tekcekim');

  // Footer sıfırla
  const _addBtn2 = document.getElementById('qf-add-btn');
  const _payBtn2 = document.getElementById('qf-pay-btn');
  const _planLbl = document.getElementById('qf-plan-label');
  if (_addBtn2) _addBtn2.disabled = false;   // Sepete Ekle her zaman aktif
  if (_payBtn2) _payBtn2.disabled = true;    // Ödeme Ekranı plan seçince aktifleşir
  if (_planLbl) { _planLbl.textContent = ''; _planLbl.classList.remove('has-plan'); }

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeQuickFinance() {
  const modal = document.getElementById('qf-modal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
  _qfPlan = null;
}

function _qfSwitchTab(tab) {
  _qfPlan = null; // Sekme değişince eski plan seçimi sıfırlanır (UX tutarlılığı)
  const payBtn = document.getElementById('qf-pay-btn');
  if (payBtn) payBtn.disabled = true;
  _qfAktifTab = tab;
  ['tekcekim','taksit','kredi'].forEach(t => {
    const btn = document.getElementById('qf-tab-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  const content = document.getElementById('qf-content');
  if (!content) return;
  if (tab === 'tekcekim') content.innerHTML = _qfRenderTekCekim();
  else if (tab === 'taksit') content.innerHTML = _qfRenderTaksit();
  else content.innerHTML = _qfRenderKredi();
}

function _qfRenderTekCekim() {
  if (!allRates.length) return '<div class="qf-empty">Oran verisi yüklenemedi.</div>';
  const nakit = _qfNakit;
  const kartlar = {};
  allRates.filter(r => !r.Tip || (r.Tip||'').toLowerCase() === 'kart').forEach(r => {
    if (!r.Kart) return;
    const oran = parseFloat(r.Tek);
    if (isNaN(oran) || oran <= 0) return;
    if (!kartlar[r.Kart] || oran < kartlar[r.Kart].oran) {
      kartlar[r.Kart] = { oran, tahsilat: yuvarlaKademe(nakit / (1 - oran/100), 1), zincir: r.Zincir };
    }
  });
  if (!Object.keys(kartlar).length) return '<div class="qf-empty">Tek çekim oranı bulunamadı.</div>';
  const EM = {Axess:'\uD83D\uDD35',Bonus:'\uD83D\uDFE1',Maximum:'\uD83D\uDD34',World:'\uD83D\uDFE2',QNB:'\uD83D\uDFE3',Paraf:'\uD83D\uDFE0',Bankkart:'\uD83D\uDD37',BanKKart:'\uD83D\uDD37',Vakifbank:'\uD83D\uDD36',Vakıfbank:'\uD83D\uDD36'};
  let html = '<div class="qf-kart-grid">';
  Object.entries(kartlar).sort((a,b)=>a[1].tahsilat-b[1].tahsilat).forEach(([kart,v]) => {
    const em = EM[kart] || '\uD83D\uDCB3';
    const sel = (_qfPlan?.kart===kart&&_qfPlan?.taksit===1)?' selected':'';
    html += '<div class="qf-kart-item'+sel+'" onclick="_qfSelectPlan(this,\''+kart+'\',1,'+v.tahsilat+',\''+( v.zincir||kart)+'\')">'+
      '<div class="qf-kart-em">'+em+'</div>'+
      '<div class="qf-kart-ad">'+kart+'</div>'+
      '<div class="qf-kart-fiyat">'+fmt(v.tahsilat)+'</div>'+
      '<div class="qf-kart-zincir">'+(v.zincir||'—')+'</div></div>';
  });
  return html + '</div>';
}

function _qfRenderTaksit() {
  if (!allRates.length) return '<div class="qf-empty">Oran verisi yüklenemedi.</div>';
  const nakit = _qfNakit;
  const TAK_LIST = [2,3,4,5,6,7,8,9];
  const kartSatirlari = allRates.filter(r => !r.Tip || (r.Tip||'').toLowerCase() === 'kart');
  const kartlar = [...new Set(kartSatirlari.map(r => r.Kart).filter(Boolean))];
  if (!_qfTaksitKart || !kartlar.includes(_qfTaksitKart)) _qfTaksitKart = kartlar[0] || '';
  const kartBtns = kartlar.map(k =>
    '<button class="qf-mini-tab'+(k===_qfTaksitKart?' active':'')+'" onclick="_qfTaksitKartSec(\''+k+'\');">'+k+'</button>'
  ).join('');
  const zRows = kartSatirlari.filter(r => r.Kart === _qfTaksitKart);
  const hesap = {};
  TAK_LIST.forEach(n => {
    zRows.forEach(r => {
      const oran = parseFloat(r[n+'Taksit']);
      if (isNaN(oran)||oran<=0) return;
      if (!hesap[n]||oran<hesap[n].oran) hesap[n]={oran,tahsilat:yuvarlaKademe(nakit/(1-oran/100),n),zincir:r.Zincir};
    });
  });
  const goster = {}; let oncekiAylik = null;
  TAK_LIST.forEach(n => {
    if (!hesap[n]) return;
    const nInt  = parseInt(n);
    const aylik = nInt === 1 ? hesap[n].tahsilat : yuvarlaKademe(hesap[n].tahsilat / nInt, 1);
    const tahsilatDuzeltilmis = nInt === 1 ? hesap[n].tahsilat : aylik * nInt; // ✅ aylık 25/50/100/250/500 katı
    if (oncekiAylik !== null && aylik >= oncekiAylik) return;
    goster[n] = {...hesap[n], tahsilat: tahsilatDuzeltilmis, aylik}; oncekiAylik = aylik;
  });
  let rows = '';
  Object.entries(goster).forEach(([n,v]) => {
    n = parseInt(n);
    const sel = _qfPlan?.kart===_qfTaksitKart&&_qfPlan?.taksit===n?' selected':'';
    const _zincir = v.zincir || _qfTaksitKart;
    rows += '<tr class="qf-taksit-row'+sel+'" onclick="_qfSelectPlan(this,\''+_qfTaksitKart+'\','+n+','+v.tahsilat+',\''+_zincir+'\')">' +
      '<td>'+n+' Taksit</td><td>'+fmt(v.aylik)+'/ay</td><td>'+fmt(v.tahsilat)+'</td>'+
      '<td style="font-size:.60rem;color:#94a3b8">'+(v.zincir||'—')+'</td></tr>';
  });
  return '<div class="qf-kart-scroll">'+kartBtns+'</div>'+
    '<table class="qf-taksit-table"><thead><tr><th>Taksit</th><th>Aylık</th><th>Toplam</th><th>POS</th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="4" class="qf-empty">Bu kart için taksit seçeneği yok.</td></tr>')+
    '</tbody></table>';
}

function _qfTaksitKartSec(kart) {
  _qfTaksitKart = kart;
  const c = document.getElementById('qf-content');
  if (c) c.innerHTML = _qfRenderTaksit();
}

function _qfKrediKurumSec(kurum) {
  _qfKrediKurum = kurum;
  const c = document.getElementById('qf-content');
  if (c) c.innerHTML = _qfRenderKredi();
}

function _qfRenderKredi() {
  const nakit = _qfNakit;
  const FALLBACK = [
    {ad:'TOMBank',vadeler:[{ay:3,faiz:2.49},{ay:6,faiz:2.89},{ay:9,faiz:3.19},{ay:12,faiz:3.49},{ay:18,faiz:3.89},{ay:24,faiz:4.29}]},
    {ad:'Zip',    vadeler:[{ay:3,faiz:2.69},{ay:6,faiz:2.99},{ay:12,faiz:3.59}]},
  ];
  const krediSatirlari = allRates.filter(r => (r.Tip||'').toLowerCase() === 'kredi');
  const useJSON = krediSatirlari.length > 0;
  const kurumlar = useJSON ? [...new Set(krediSatirlari.map(r=>r.Kart).filter(Boolean))] : FALLBACK.map(k=>k.ad);
  if (!_qfKrediKurum||!kurumlar.includes(_qfKrediKurum)) _qfKrediKurum = kurumlar[0]||'';
  const kurumBtns = kurumlar.map(k =>
    '<button class="qf-mini-tab'+(k===_qfKrediKurum?' active':'')+'" onclick="_qfKrediKurumSec(\''+k+'\');">'+k+'</button>'
  ).join('');
  const _ks = krediSatirlari.filter(r=>r.Kart===_qfKrediKurum);
  const VADE_LIST = [2,3,4,5,6,7,8,9,10,11,12,13,14,15,18,24,36,48].filter(ay =>
    useJSON ? _ks.some(r=>{const v=parseFloat(r[ay+'Taksit']);return !isNaN(v)&&v>0;})
    : (FALLBACK.find(k=>k.ad===_qfKrediKurum)||{vadeler:[]}).vadeler.some(v=>v.ay===ay)
  );
  let rows = '';
  if (useJSON) {
    VADE_LIST.forEach(ay => {
      _ks.forEach(r => {
        const vadeFarki = parseFloat(r[ay+'Taksit']); if(isNaN(vadeFarki)||vadeFarki<=0) return;
        const toplam = Math.round(nakit*(1+vadeFarki/100)/50)*50;
        const aylik = Math.ceil(toplam/ay);
        const sel = _qfPlan?.kart===_qfKrediKurum&&_qfPlan?.taksit===ay?' selected':'';
        rows += '<tr class="qf-taksit-row'+sel+'" onclick="_qfSelectPlan(this,\''+_qfKrediKurum+'\','+ay+','+toplam+',\''+_qfKrediKurum+'\'\,\'kredi\')">' +
          '<td>'+ay+' Ay</td><td>%'+vadeFarki+' vade farkı</td><td>'+fmt(aylik)+'/ay</td><td>'+fmt(toplam)+'</td></tr>';
      });
    });
  } else {
    const fb = FALLBACK.find(k=>k.ad===_qfKrediKurum);
    if (fb) fb.vadeler.forEach(v => {
      const toplam = Math.round(nakit*Math.pow(1+v.faiz/100,v.ay)/50)*50;
      const aylik = Math.ceil(toplam/v.ay);
      const sel = _qfPlan?.kart===_qfKrediKurum&&_qfPlan?.taksit===v.ay?' selected':'';
      rows += '<tr class="qf-taksit-row'+sel+'" onclick="_qfSelectPlan(this,\''+_qfKrediKurum+'\','+v.ay+','+toplam+',\''+_qfKrediKurum+'\'\,\'kredi\')">' +
        '<td>'+v.ay+' Ay</td><td>%'+v.faiz+'</td><td>'+fmt(aylik)+'/ay</td><td>'+fmt(toplam)+'</td></tr>';
    });
  }
  return '<div class="qf-kart-scroll">'+kurumBtns+'</div>'+
    '<table class="qf-taksit-table"><thead><tr><th>Vade</th><th>Oran</th><th>Aylık</th><th>Toplam</th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="4" class="qf-empty">Vade bulunamadı.</td></tr>')+
    '</tbody></table>';
}

function _qfSelectPlan(el, kart, taksit, tahsilat, zincir, tip) {
  taksit   = parseInt(taksit)   || taksit;
  tahsilat = parseFloat(tahsilat) || tahsilat;
  tip = tip || 'kart';
  _qfPlan = { kart, taksit, tahsilat, zincir, tip,
    label: taksit===1 ? (kart+' Tek Çekim') : (kart+' '+taksit+' Taksit'),
    aylik: taksit===1 ? tahsilat : yuvarlaKademe(tahsilat/taksit, 1),
    ekIndirim: 0, type: taksit===1 ? 'tekcekim' : 'taksit' };
  document.querySelectorAll('.qf-kart-item.selected,.qf-taksit-row.selected').forEach(e=>e.classList.remove('selected'));
  if (el) el.classList.add('selected');

  const addBtn = document.getElementById('qf-add-btn');
  if (addBtn) { addBtn.disabled = false; }  // zaten aktif, güvence için
  const payBtn = document.getElementById('qf-pay-btn');
  if (payBtn) { payBtn.disabled = false; }

  // Plan özet etiketi
  const planLabel = document.getElementById('qf-plan-label');
  if (planLabel) {
    planLabel.textContent = _qfPlan.label + '  —  ' + fmt(tahsilat) + ' ₺';
    planLabel.classList.add('has-plan');
  }
}

function qfAddToBasket() {
  if (_qfUrunIdx === null) return;

  const _planSnapshot = _qfPlan ? {..._qfPlan} : null;

  // 1. Sepete ekle
  addToBasket(_qfUrunIdx);

  // 2. Plan bilgisini DOĞRU item'a yaz (idx ile eşleştir — basket[0] hatası düzeltildi)
  if (_planSnapshot && basket.length > 0) {
    const urunAdKey = Object.keys(allProducts[_qfUrunIdx] || {}).find(k => (k||'').toLowerCase() === 'urun') || '';
    const urunAd    = (allProducts[_qfUrunIdx] || {})[urunAdKey] || '';
    // Sepette bu ürünü bul (son eklenen — aynı isimli varsa en sona eklendi)
    let targetItem = null;
    for (let i = basket.length - 1; i >= 0; i--) {
      if (basket[i].urun === urunAd || i === basket.length - 1) { targetItem = basket[i]; break; }
    }
    if (targetItem) {
      targetItem._qfPlanLabel = _planSnapshot.label;
      targetItem._qfAylik     = _planSnapshot.aylik;
      targetItem._qfTaksit    = parseInt(_planSnapshot.taksit) || _planSnapshot.taksit;
      targetItem._qfKart      = _planSnapshot.kart;
      targetItem._qfZincir    = _planSnapshot.zincir;
    }
  }

  // 3. QF modal kapat
  closeQuickFinance();

  // 4. Sadece sepete eklendi — sepeti aç, abaküse GITME
  setTimeout(() => toggleCart(), 80);
}

function qfGoToPayment() {
  if (_qfUrunIdx === null) return;

  const _planSnapshot = _qfPlan ? {..._qfPlan} : null;

  // 1. Sepete ekle
  addToBasket(_qfUrunIdx);

  // 2. Plan bilgisini doğru item'a yaz
  if (_planSnapshot && basket.length > 0) {
    const urunAdKey = Object.keys(allProducts[_qfUrunIdx] || {}).find(k => (k||'').toLowerCase() === 'urun') || '';
    const urunAd    = (allProducts[_qfUrunIdx] || {})[urunAdKey] || '';
    let targetItem  = null;
    for (let i = basket.length - 1; i >= 0; i--) {
      if (basket[i].urun === urunAd || i === basket.length - 1) { targetItem = basket[i]; break; }
    }
    if (targetItem) {
      targetItem._qfPlanLabel = _planSnapshot.label;
      targetItem._qfAylik     = _planSnapshot.aylik;
      targetItem._qfTaksit    = parseInt(_planSnapshot.taksit) || _planSnapshot.taksit;
      targetItem._qfKart      = _planSnapshot.kart;
      targetItem._qfZincir    = _planSnapshot.zincir;
    }
  }

  // 3. QF modal kapat
  closeQuickFinance();

  // 4. Abaküsü aç — _fromQF flag ile plan önceden seçili gelir
  window._openAbakusFromQF = true;
  setTimeout(() => openAbakus(), 120);
}


// ══════════════════════════════════════════════════════════════
// Tüketici Kredisi Abaküs Render — Premium
// ══════════════════════════════════════════════════════════════
function _calcAbakusKredi(resEl, zRows, nakit, kurum) {
  const fmtN = n => Number(n).toLocaleString('tr-TR');
  const VADE_LIST = [3, 6, 9, 12, 15, 18, 24, 36, 48];

  // Özet banner: min aylık taksit hesapla (tanıtım için)
  let minAylik = Infinity, minAylikVade = null;
  VADE_LIST.forEach(ay => {
    zRows.forEach(r => {
      const vf = parseFloat(r[ay + 'Taksit']);
      if (isNaN(vf) || vf <= 0) return;
      const _toplamHam = Math.round(nakit * (1 + vf / 100) / 50) * 50;
      const aylik  = yuvarlaKademe(_toplamHam / ay, 1);
      if (aylik < minAylik) { minAylik = aylik; minAylikVade = ay; }
    });
  });

  let html = '';

  // Özet bilgi şeridi
  if (minAylikVade) {
    html += `<div style="display:flex;align-items:center;gap:10px;background:linear-gradient(90deg,#eff6ff,#dbeafe);
      border:1px solid #bfdbfe;border-radius:var(--r-lg);padding:11px 14px;margin-bottom:12px;flex-wrap:wrap;">
      <span style="font-size:1.3rem">💡</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.72rem;color:#1e3a8a;font-weight:700">En Düşük Aylık Taksit</div>
        <div style="font-size:.62rem;color:#3b82f6;margin-top:1px">${minAylikVade} ay vade ile</div>
      </div>
      <div style="font-family:'DM Mono',monospace;font-size:1.05rem;font-weight:800;color:#1d4ed8">${fmtN(minAylik)} ₺/ay</div>
    </div>`;
  }

  html += '<div class="ab-kredi-table-wrap"><table class="ab-kredi-table">' +
    '<thead><tr>' +
    '<th>Vade</th>' +
    '<th>Aylık Taksit</th>' +
    '<th>Toplam Tutar</th>' +
    '</tr></thead><tbody>';

  let hasRow = false;
  let firstBest = true;
  VADE_LIST.forEach(ay => {
    zRows.forEach(r => {
      const vadeFarki = parseFloat(r[ay + 'Taksit']);
      if (isNaN(vadeFarki) || vadeFarki <= 0) return;
      const toplamHam = Math.round(nakit * (1 + vadeFarki / 100) / 50) * 50;
      const aylik  = yuvarlaKademe(toplamHam / ay, 1);
      const toplam = aylik * ay; // ✅ aylık 25/50/100/250/500 katı, toplam = aylık × ay
      hasRow = true;

      const isBest = (aylik === minAylik && ay === minAylikVade && firstBest);
      if (isBest) firstBest = false;

      const rowData = JSON.stringify({
        kart: kurum, taksit: ay, tahsilat: toplam, aylik,
        zincir: r.Zincir || kurum,
        label: kurum + ' ' + ay + ' Ay',
        oran: vadeFarki, ekIndirim: 0,
        tip: 'kredi'
      }).replace(/"/g, '&quot;');

      html += `<tr class="ab-kredi-row ab-row-sel" data-abrow="${rowData}" onclick="selectAbakusRow(this)">` +
        `<td><span class="ab-kredi-vade">${ay} Ay</span><span class="ab-kredi-oran">%${vadeFarki}</span></td>` +
        `<td><span class="ab-kredi-aylik">${fmtN(aylik)} ₺</span></td>` +
        `<td><span class="ab-kredi-toplam">${fmtN(toplam)} ₺</span>` +
        (isBest ? ' <span class="ab-kredi-badge-best">★ EN UYGUN</span>' : '') +
        `</td>` +
        `</tr>`;
    });
  });

  if (!hasRow) {
    html += `<tr><td colspan="3" class="ab-kredi-no-data">Vade bilgisi bulunamadı</td></tr>`;
  }

  html += '</tbody></table></div>';
  resEl.innerHTML = html;

  // Aksiyon panelini gizle — satır seçilince açılır
  const actDiv = document.getElementById('ab-actions');
  if (actDiv) actDiv.style.display = 'none';
}


function calcAbakus() {
  // QF planı varsa koru — render sonrası geri yüklenecek
  const _savedPlan = (abakusSelection && abakusSelection.kart) ? {...abakusSelection} : null;
  abakusSelection = null;
  // Aksiyon panelini gizle
  const actDiv = document.getElementById('ab-actions');
  if (actDiv) actDiv.style.display = 'none';
  const waBtn = document.getElementById('ab-wa-btn');
  if (waBtn) waBtn.style.display = 'none';

  // Pazarlık değerlerini innerHTML yazmadan ÖNCE kaydet
  const _ekInpEl  = document.getElementById('ab-ek-indirim');
  const _pazNotEl = document.getElementById('ab-pazarlik-notu');
  const _savedIndirim = _ekInpEl  ? (_ekInpEl.value  || '') : '';
  const _savedNot     = _pazNotEl ? (_pazNotEl.value || '') : '';
  const ekIndirim     = parseFloat(_savedIndirim) || 0;

  const t = basketTotals();
  const totalItemDisc = basket.reduce((s, i) => s + (i.itemDisc || 0), 0);
  // ❖ proje fiyatları nakitNet'e yansır — liste toplamı (t.nakit) değil, gerçek net baz alınır
  const bazNakit = t.nakitNet !== undefined ? t.nakitNet : t.nakit;
  let nakit = bazNakit - totalItemDisc - getDisc(bazNakit - totalItemDisc);
  // Nakit: kredi sekmesinde ab-nakit-kredi, kart sekmesinde ab-nakit kullan
  const aktifTab = window._abAktifTab || 'kart';
  const nakit2El = document.getElementById(aktifTab === 'kredi' ? 'ab-nakit-kredi' : 'ab-nakit');
  if (nakit2El && nakit2El.value !== '') {
    const mn2 = parseFloat(nakit2El.value.replace(',', '.'));
    if (!isNaN(mn2) && mn2 > 0) nakit = mn2;
  }

  const resEl = document.getElementById('ab-result');
  if (!resEl) return;

  // ── Tüketici Kredisi sekmesi ──────────────────────────────────
  if (aktifTab === 'kredi') {
    const kurum = window._abKrediKurum || '';
    const zRowsK = allRates.filter(r => r.Kart === kurum && (r.Tip||'').toLowerCase() === 'kredi');
    if (!zRowsK.length) {
      resEl.innerHTML = '<div class="ab-no-data">Kredi verisi bulunamadı.</div>';
      return;
    }
    _calcAbakusKredi(resEl, zRowsK, nakit, kurum);
    return;
  }

  // ── Kart sekmesi ──────────────────────────────────────────────
  const ks = document.getElementById('ab-kart');
  if (!ks) return;
  const secKart = ks.value;
  const maxT = KART_MAX_TAKSIT[secKart] || 9;
  const zRows = allRates.filter(r => r.Kart === secKart);

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
    { label: '6 Taksit',  n: 6,  key: '6Taksit',  oncelik: 3 },
    { label: '7 Taksit',  n: 7,  key: '7Taksit',  oncelik: 4 },
    { label: '8 Taksit',  n: 8,  key: '8Taksit',  oncelik: 5 },
    { label: '9 Taksit',  n: 9,  key: '9Taksit',  oncelik: 6 },
    { label: '12 Taksit', n: 12, key: '12Taksit', oncelik: 7 },
    { label: '15 Taksit', n: 15, key: '15Taksit', oncelik: 8 }
  ];

  const enKarliMap = {};
  zRows.forEach(satir => {
    TAK.forEach(td => {
      if (td.n > maxT) return;
      const oran = parseFloat(satir[td.key]);
      if (isNaN(oran) || oran <= 0) return;
      const tahsilatBrut = yuvarlaKademe(nakit / (1 - oran / 100), td.n);
      // Ek pazarlık indirimi EN SON uygulanır
      const tahsilatHam = Math.max(0, tahsilatBrut - ekIndirim);
      // ✅ Yuvarlama tutarlılığı: aylık önce yuvarla, toplam = aylık × taksit
      // Böylece "28.300 × 3 = 84.900" her zaman tutarlı gösterilir
      const aylik    = td.n === 1 ? tahsilatHam : yuvarlaKademe(tahsilatHam / td.n, 1);
      const tahsilat = td.n === 1 ? tahsilatHam : aylik * td.n; // ✅ aylık 25/50/100/250/500 katı
if (!enKarliMap[td.n] || oran < enKarliMap[td.n].oran) {
  enKarliMap[td.n] = {
    label: td.label,
    taksit: td.n,
    oncelik: td.oncelik,
    kart: satir.Kart,
    zincir: satir.Zincir,
    oran,
    tahsilat,
    tahsilatBrut, // yuvarlama öncesi — loglama için
    ekIndirim,    // pazarlık indirimi — teklif/PDF için
    aylik,
    karli: oran < KOMISYON_ESIGI,
    aciklama: satir.Aciklama ? String(satir.Aciklama) : ''
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
  // İndirim % hesapla (satır + alt indirim + pazarlık)
  const _brutTotal = t.nakit;
  const _altIndirimBant = discountType === 'TRY' ? discountAmount : ((_brutTotal - totalItemDisc) * discountAmount / 100);
  const _toplamIndBant = totalItemDisc + _altIndirimBant + ekIndirim;
  const _indPct = _brutTotal > 0 ? ((_toplamIndBant / _brutTotal) * 100).toFixed(1) : 0;
  const _indRozetHTML = _toplamIndBant > 0
    ? `<span style="font-size:.58rem;background:#dcfce7;color:#15803d;border-radius:5px;padding:1px 6px;font-weight:800;margin-left:4px">%${_indPct} İndirim</span>`
    : '';
  html += `<div class="ab-nakit-row"><span>Baz Nakit</span><strong>${fmt(nakit)}</strong>${_indRozetHTML}<span class="ab-kart-badge">${secKart} · max ${maxT}T</span></div>`;

  // ── Ek İndirim Alanı (Pazarlık) — opsiyonel, gizli panel ────────
  const _pzAcik = ekIndirim > 0;
  html += '<div style="margin:4px 0 6px">'
    + '<button id="ab-pazarlik-togbtn" onclick="(function(){'
    +   'var p=document.getElementById(\'ab-pazarlik-panel\');'
    +   'var open=p.style.display===\'block\';'
    +   'p.style.display=open?\'none\':\'block\';'
    +   'if(open){document.getElementById(\'ab-ek-indirim\').value=\'\';calcAbakus();}'
    + '})()"'
    + ' style="background:none;border:1px dashed ' + (_pzAcik ? '#f59e0b' : 'var(--border)') + ';'
    + 'border-radius:7px;padding:4px 10px;font-size:.68rem;font-weight:700;cursor:pointer;'
    + 'color:' + (_pzAcik ? '#b45309' : 'var(--text-2)') + ';font-family:inherit">'
    + '💬 Pazarlık İndirimi' + (_pzAcik ? ' · -' + fmt(ekIndirim) : '')
    + '</button></div>'
    + '<div id="ab-pazarlik-panel" style="display:' + (_pzAcik ? 'block' : 'none') + ';'
    + 'background:#fffbeb;border:1px solid #fde68a;border-radius:9px;padding:10px 12px;margin-bottom:8px">'
    + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">'
    + '<label style="font-size:.68rem;color:#92400e;font-weight:700;white-space:nowrap">İndirim Tutarı ('+_tlSym()+')</label>'
    + '<input id="ab-ek-indirim" type="number" min="0" placeholder="0"'
    + ' onchange="calcAbakus()" onblur="calcAbakus()"'
    + ' style="width:100px;padding:5px 8px;border:1.5px solid #fcd34d;border-radius:7px;'
    + 'font-size:.82rem;font-family:inherit;text-align:right;background:#fff;color:#78350f;font-weight:700">'
    + '<span id="ab-ek-indirim-uyari" style="font-size:.62rem;color:#dc2626;display:none;font-weight:700">⚠️ %7 sınırını aşıyor!</span>'
    + '</div>'
    + '<input id="ab-pazarlik-notu" type="text" placeholder="Pazarlık notu (opsiyonel)…"'
    + ' style="width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #fcd34d;'
    + 'border-radius:7px;font-size:.72rem;font-family:inherit;background:#fff;color:#78350f">'
    + '</div>';

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

  const nakitFinal = Math.max(0, nakit - ekIndirim);
  // ❖ Sepette proje fiyatı olan ürün varsa nakit label'ı gerekçesiyle değişir
  const _projeItems    = basket.filter(bi => bi._projeNakit !== undefined && bi._projeGrup);
  const _hasProje      = _projeItems.length > 0;
  const _projeGrupLbl  = _hasProje
    ? [...new Set(_projeItems.map(bi => (bi._projeGrup || 'Proje').replace(/\s+[\d.,[\]\s]+.*$/, '').trim()))].join(' · ')
    : '';
  const _nakitLabel    = _hasProje
    ? `<strong>❖ ${_projeGrupLbl}</strong>`
    : `<strong>💵 Nakit</strong>`;
  html += `<tr class="ab-row-nakit ab-row-sel" id="ab-row-nakit-tr" onclick="selectAbakusRow(this)">
      <td>${_nakitLabel}</td>
      <td class="ab-zincir-cell">—</td>
      <td class="ab-mono">${ekIndirim > 0 ? '<span style="font-size:.62em;color:#dc2626;text-decoration:line-through">' + fmt(nakit) + '</span>' : '—'}</td>
      <td class="ab-mono ab-tahsilat-cell">${fmt(nakitFinal)}${ekIndirim > 0 ? '<span style="font-size:.60em;color:#16a34a;display:block">-' + fmt(ekIndirim) + ' pazarlık</span>' : ''}</td>
      <td class="ab-badge-cell"><span class="ab-badge-nakit">${_hasProje ? '❖ FİYAT' : 'NAKİT'}</span></td>
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
      const tahsilatZBrut = yuvarlaKademe(nakit / (1 - oran / 100), td.n);
      const tahsilatZ = Math.max(0, tahsilatZBrut - ekIndirim);
      const aylik = td.n === 1 ? tahsilatZ : yuvarlaKademe(tahsilatZ / td.n, 1);
      const karli = oran < KOMISYON_ESIGI;
      html += `<tr class="${karli ? 'ab-row-good' : ''}"><td>${td.label}</td><td class="ab-mono">${fmt(aylik)}</td><td class="ab-mono">${fmt(tahsilatZ)}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  });
  html += `</div></details>`;
  resEl.innerHTML = html;

  // innerHTML sonrası pazarlık input değerlerini geri yükle
  const _newEk  = document.getElementById('ab-ek-indirim');
  const _newNot = document.getElementById('ab-pazarlik-notu');
  if (_newEk  && _savedIndirim) { _newEk.value  = _savedIndirim; }
  if (_newNot && _savedNot)     { _newNot.value = _savedNot; }
  const _uyariEl = document.getElementById('ab-ek-indirim-uyari');
  if (_uyariEl) _uyariEl.style.display = (ekIndirim > 0 && ekIndirim > nakit * 0.07) ? 'inline' : 'none';

  // data-abrow attribute'larını DOM'a yaz (innerHTML set edildikten sonra)
  const nakitRow = resEl.querySelector('#ab-row-nakit-tr');
  if (nakitRow) {
    nakitRow.dataset.abrow = JSON.stringify({ type: 'nakit', nakit: nakitFinal, nakitBrut: nakit, ekIndirim });
    // Global'e de yaz — selectAbakusRow'dan önce erişilirse kaybolmasın
    window._nakitEkIndirim = ekIndirim || 0;
  }
  const allRows = resEl.querySelectorAll('tr.ab-row-sel:not(#ab-row-nakit-tr)');
  let li = 0;
  allRows.forEach(tr => {
    if (li < liste.length) { tr.dataset.abrow = JSON.stringify(liste[li]); li++; }
  });
  // QF planı varsa: render sonrası eşleşen satırı bul ve seç
  if (_savedPlan && _savedPlan.kart) {
    abakusSelection = _savedPlan; // geri yükle
    const _planKart   = _savedPlan.kart;
    const _planTaksit = _savedPlan.taksit;
    setTimeout(() => {
      let matched = null;
      resEl.querySelectorAll('tr.ab-row-sel').forEach(tr => {
        try {
          const d = JSON.parse(tr.dataset.abrow || '{}');
          if (d.kart === _planKart && parseInt(d.taksit) === parseInt(_planTaksit)) matched = tr;
        } catch(e) {}
      });
      if (matched) {
        selectAbakusRow(matched);
        // Plan kullanıldı — item'dan temizle (bir kerelik)
        if (basket.length > 0 && basket[0]._qfKart) {
          delete basket[0]._qfKart;
          delete basket[0]._qfTaksit;
          delete basket[0]._qfZincir;
          delete basket[0]._qfPlanLabel;
          delete basket[0]._qfAylik;
        }
        // Scroll: abaküs modal container
        const abBody = document.querySelector('.abakus-body');
        if (abBody) {
          setTimeout(() => abBody.scrollTo({ top: abBody.scrollHeight, behavior: 'smooth' }), 80);
        }
      }
    }, 50);
  }
}

function selectAbakusRow(rowEl) {
  haptic(14);
  document.querySelectorAll('.ab-row-selected').forEach(r => r.classList.remove('ab-row-selected'));
  rowEl.classList.add('ab-row-selected');
  try {
    const raw = rowEl.dataset.abrow || '{}';
    const parsed = JSON.parse(raw);
    // ❖ Proje: nakit satırı seçilmiş ama sepette proje fiyatı var — null değil proje objesi yaz
    if (parsed.type === 'nakit') {
      window._nakitEkIndirim = parsed.ekIndirim || 0;
      const _projeItems = basket.filter(bi => bi._projeNakit !== undefined && bi._projeGrup);
      if (_projeItems.length > 0) {
        const _projeGrupLbl = [...new Set(_projeItems.map(bi =>
          (bi._projeGrup||'Proje').replace(/\s+[\d.,[\]\s]+.*$/, '').trim()
        ))].join(' · ');
        const _projeToplam = _projeItems.reduce((s,bi) => s + Math.max(0, Number(bi._projeNakit)), 0)
          + basket.filter(bi => bi._projeNakit === undefined).reduce((s,bi) =>
              s + Math.max(0, (bi.nakit||0) - (bi.itemDisc||0)), 0);
        abakusSelection = {
          type:       'proje',
          projeLabel: _projeGrupLbl,
          nakit:      _projeToplam,
          ekIndirim:  parsed.ekIndirim || 0
        };
      } else {
        abakusSelection = null;
      }
    } else {
      abakusSelection = parsed;
    }

    // Bilgi kutusu
    const bilgiKutusu = document.getElementById('kart-bilgi-kutusu');
    if (bilgiKutusu) {
      if (window._infoTimeout) clearTimeout(window._infoTimeout);
      bilgiKutusu.style.display = 'none';
      bilgiKutusu.innerHTML = '';
      if (parsed.aciklama && typeof parsed.aciklama === 'string' && parsed.aciklama.trim() !== '') {
        bilgiKutusu.innerHTML = '<span>💡</span> <span>' + parsed.aciklama + '</span>';
        bilgiKutusu.style.display = 'flex';
        window._infoTimeout = setTimeout(() => { bilgiKutusu.style.display = 'none'; }, 10000);
      }
    }

    // Aksiyon paneli — try içinde, parsed erişilebilir
    const actDiv = document.getElementById('ab-actions');
    const infoDiv = document.getElementById('ab-selection-info');
    if (actDiv) {
      actDiv.style.display = 'block';
      // .abakus-body scroll container'ını kullan
      setTimeout(() => {
        const abBody = document.querySelector('.abakus-body');
        if (abBody) {
          abBody.scrollTo({ top: abBody.scrollHeight, behavior: 'smooth' });
        } else {
          actDiv.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }, 80);
      if (infoDiv) {
        if (abakusSelection === null) {
          // Saf nakit seçildi (❖ yok)
          const _nakitVal = parsed.nakit || 0;
          const _ekStr = parsed.ekIndirim > 0
            ? ' <span style="color:#16a34a;font-size:.8em">(-' + fmt(parsed.ekIndirim) + ')</span>'
            : '';
          infoDiv.innerHTML = '<span class="ab-sel-chip ab-sel-nakit">💵 Nakit — ' + fmt(_nakitVal) + _ekStr + '</span>';
        } else if (abakusSelection.type === 'proje') {
          // ❖ Proje fiyatı seçildi
          const _ekStr = abakusSelection.ekIndirim > 0
            ? ' <span style="color:#16a34a;font-size:.8em">(-' + fmt(abakusSelection.ekIndirim) + ')</span>'
            : '';
          infoDiv.innerHTML = '<span class="ab-sel-chip ab-sel-nakit">❖ ' + abakusSelection.projeLabel + ' — ' + fmt(abakusSelection.nakit) + _ekStr + '</span>';
        } else {
          // Kartlı taksit / tek çekim
          const _ekChip = abakusSelection.ekIndirim > 0
            ? '<span class="ab-sel-chip" style="color:#16a34a">-' + fmt(abakusSelection.ekIndirim) + ' pazarlık</span>'
            : '';
          infoDiv.innerHTML = '<span class="ab-sel-chip">' + abakusSelection.label + '</span>'
            + '<span class="ab-sel-chip">' + abakusSelection.zincir + ' POS</span>'
            + '<span class="ab-sel-chip ab-sel-tahsilat">' + fmt(abakusSelection.tahsilat) + '</span>'
            + '<span class="ab-sel-chip ab-sel-aylik">Aylık ' + fmt(abakusSelection.aylik) + '</span>'
            + _ekChip;
        }
      }
    }
    const waBtn = document.getElementById('ab-wa-btn');
    if (waBtn) waBtn.style.display = 'none';

    // ── FATURA FİYATLARI TABLOSUNU GÜNCELLE ───────────────────
    // abakusSelection güncellendi — proje ise onun objesini geç, yoksa parsed'ı kullan
    _renderFaturaTablosu(abakusSelection !== null ? abakusSelection : parsed);

  } catch (e) {
    console.error('selectAbakusRow:', e);
  }
}

// ─── WA / TEKLİF / SATIŞ AKSİYON MODAL ─────────────────────────
let _aksiyonMode = 'wa'; // 'wa' | 'teklif' | 'satis'

// ── FATURA FİYATLARI TABLOSU ─────────────────────────────────────
function _renderFaturaTablosu(parsed) {
  const tablo   = document.getElementById('ab-fatura-tablo');
  const satirEl = document.getElementById('ab-fatura-satirlar');
  const topEl   = document.getElementById('ab-fatura-toplam');
  if (!tablo || !satirEl || !topEl || !basket.length) return;

  tablo.style.display = 'block';

  // type alanı yoksa taksit sayısından belirle
  const tahsilat  = Number(parsed.tahsilat)  || 0;
  const aylik     = Number(parsed.aylik)     || 0;
  const taksit    = Number(parsed.taksit)    || 0;
  const oran      = Number(parsed.oran)      || 0;
  const kartLabel = parsed.label || parsed.kart || '';
  const ekInd     = Number(parsed.ekIndirim) || 0;
  // tip: nakit=nakit, proje=❖ kampanya fiyatı, kartlı=taksit/tekcekim
  const tip = parsed.type === 'nakit'
    ? 'nakit'
    : parsed.type === 'proje'
      ? 'proje'
      : (tahsilat > 0 || taksit > 0 || oran > 0)
        ? (taksit > 1 ? 'taksit' : 'tekcekim')
        : 'nakit';

  // Sepet nakit toplamı (indirimliler dahil)
  const t = basketTotals();
  const totalItemDisc = basket.reduce((s,i) => s + (i.itemDisc||0), 0);
  const altIndirim = getDisc(t.nakit - totalItemDisc);
  const nakitFinal = Math.max(0, t.nakit - totalItemDisc - altIndirim - ekInd);

  // ❖ Proje fiyatları — her ürün kendi _projeNakit'ini kullanır
  const urunProjeFiyatlari = basket.map(item =>
    item._projeNakit !== undefined
      ? Math.max(0, Number(item._projeNakit))
      : Math.max(0, (item.nakit || 0) - (item.itemDisc || 0))
  );
  const projeToplam = urunProjeFiyatlari.reduce((s,v) => s+v, 0) || 1;

  // Hangi ödeme için toplam tahsilat?
  let toplamFatura;
  if (tip === 'nakit') {
    toplamFatura = nakitFinal;
  } else if (tip === 'proje') {
    // ❖ Proje: toplam = her ürünün proje fiyatı toplamı (komisyon/vade farkı yok)
    toplamFatura = projeToplam;
  } else {
    // Kartlı: tahsilat zaten komisyon dahil calcAbakus tarafından hesaplandı
    toplamFatura = tahsilat || nakitFinal;
  }

  // Her ürün için fatura bedeli
  // ❖ Proje: doğrudan _projeNakit (veya nakit-itemDisc), kartlı: oransal dağılım
  const urunNakitler = urunProjeFiyatlari; // proje fiyatlarını baz al (nakit için de aynı)
  const toplamNakit  = urunNakitler.reduce((s,v) => s+v, 0) || 1;

  let satirHTML = '';
  let dagitilanToplam = 0;

  basket.forEach((item, idx) => {
    const itemProje = urunProjeFiyatlari[idx]; // ❖ veya normal nakit
    const itemNakit = Math.max(0, (item.nakit||0) - (item.itemDisc||0)); // gösterim için ham nakit

    let faturaFiyat;
    if (tip === 'proje') {
      // ❖ Proje: her ürün kendi proje fiyatıyla gösterilir
      faturaFiyat = itemProje;
    } else {
      const paylasim = itemProje / toplamNakit;
      faturaFiyat = idx === basket.length - 1
        ? Math.max(0, toplamFatura - dagitilanToplam)
        : Math.round(toplamFatura * paylasim);
    }
    dagitilanToplam += faturaFiyat;

    const komisyon = faturaFiyat - itemProje;

    // Komisyon göstergesi (proje'de komisyon yok)
    let komisyonStr = '';
    if (tip !== 'nakit' && tip !== 'proje' && komisyon > 0) {
      komisyonStr = `<span style="font-size:.58rem;background:#fee2e2;color:#dc2626;border-radius:5px;padding:1px 6px;font-weight:700;white-space:nowrap">+${fmt(komisyon)} kom.</span>`;
    } else if (tip !== 'nakit' && tip !== 'proje' && komisyon < 0) {
      komisyonStr = `<span style="font-size:.58rem;background:#dcfce7;color:#15803d;border-radius:5px;padding:1px 6px;font-weight:700;white-space:nowrap">${fmt(komisyon)}</span>`;
    }

    // Alt etiket: proje'de "❖ Proje Fiyatı" yaz, normal nakit'te "Nakit: xxx" yaz
    const _itemProjeLabel = item._projeGrup
      ? (item._projeGrup.replace(/\s+[\d.,[\]\s]+.*$/, '').trim() || 'Proje Fiyatı')
      : 'Proje Fiyatı';
    const altEtiket = tip === 'proje' && item._projeNakit !== undefined
      ? `<span style="color:#15803d;font-weight:700">❖ ${_itemProjeLabel}</span>`
      : `<span>Nakit: <b style="color:#475569">${fmt(itemNakit)}</b></span>
         ${item.itemDisc > 0 ? `<span style="color:#16a34a">−${fmt(item.itemDisc)} ind.</span>` : ''}`;

    const renk = tip === 'nakit' ? '#0f172a' : tip === 'proje' ? '#15803d' : '#dc2626';
    const zemin = idx % 2 === 0 ? '#f8fafd' : '#ffffff';
    satirHTML += `
      <div style="display:flex;align-items:center;justify-content:space-between;
        background:${zemin};border-radius:8px;padding:8px 10px;gap:6px;border:1px solid #f1f5f9">
        <div style="flex:1;min-width:0">
          <div style="font-size:.74rem;font-weight:700;color:#1e293b;
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.urun}</div>
          <div style="font-size:.58rem;color:#94a3b8;margin-top:2px;display:flex;gap:6px;flex-wrap:wrap">
            ${altEtiket}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:3px">
          <b style="font-size:.90rem;font-weight:900;color:${renk}">${fmt(faturaFiyat)}</b>
          ${komisyonStr}
        </div>
      </div>`;
  });

  satirEl.innerHTML = satirHTML;

  // Alt özet
  const komisyonToplam = (tip === 'nakit' || tip === 'proje') ? 0 : Math.max(0, toplamFatura - nakitFinal);
  const projeLabel2 = parsed.projeLabel || (abakusSelection && abakusSelection.type === 'proje' ? abakusSelection.projeLabel : '') || '';
  let odemeBadge = '';
  if (tip === 'proje') {
    odemeBadge = `<span style="background:#dcfce7;color:#15803d;border-radius:6px;padding:3px 9px;font-size:.63rem;font-weight:700">❖ ${projeLabel2}</span>`;
  } else if (tip === 'nakit') {
    odemeBadge = `<span style="background:#dcfce7;color:#15803d;border-radius:6px;padding:3px 9px;font-size:.63rem;font-weight:700">💵 Nakit</span>`;
  } else if (tip === 'tekcekim') {
    odemeBadge = `<span style="background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:3px 9px;font-size:.63rem;font-weight:700">
      💳 ${kartLabel} · Tek Çekim${oran>0?' (%'+oran+')':''}
    </span>`;
  } else {
    odemeBadge = `<span style="background:#faf5ff;color:#7c3aed;border-radius:6px;padding:3px 9px;font-size:.63rem;font-weight:700">
      💳 ${kartLabel} · ${taksit} Taksit${oran>0?' (%'+oran+')':''}
    </span>`;
  }

  const toplamRenk = tip === 'nakit' || tip === 'proje' ? '#0f172a' : '#dc2626';
  topEl.innerHTML = `
    <div style="width:100%;display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
        ${odemeBadge}
        <span style="font-size:.96rem;font-weight:900;color:${toplamRenk}">${fmt(toplamFatura)}</span>
      </div>
      ${tip !== 'nakit' && tip !== 'proje' ? `
        <div style="display:flex;justify-content:space-between;align-items:center;
          background:#fef2f2;border-radius:8px;padding:5px 10px">
          <span style="font-size:.62rem;color:#64748b">Nakit: <b>${fmt(nakitFinal)}</b>
            ${aylik > 0 ? ` · Aylık: <b>${fmt(aylik)}</b>` : ''}
          </span>
          <span style="font-size:.62rem;color:#dc2626;font-weight:800">
            Komisyon: +${fmt(komisyonToplam)}
          </span>
        </div>` : ''}
    </div>`;
}

// ── EXCEL EXPORT — SEÇILI ÖDEMEYE GÖRE ───────────────────────────
window.exportAbakusExcel = function() {
  if (!basket.length) { ayAlert('Sepet boş!'); return; }
  haptic(18);

  const t = basketTotals();
  const totalItemDisc = basket.reduce((s,i) => s + (i.itemDisc||0), 0);
  const baseNakit = t.nakit - totalItemDisc - getDisc(t.nakit - totalItemDisc);
  const ekInd = abakusSelection?.ekIndirim || window._nakitEkIndirim || 0;
  const nakitFinal = Math.max(0, baseNakit - ekInd);

  let tip = 'nakit', toplamFatura = nakitFinal;
  let odemeBaslik = 'Nakit';

  if (abakusSelection) {
    tip = abakusSelection.taksit > 1 ? 'taksit' : 'tekcekim';
    toplamFatura = abakusSelection.tahsilat;
    odemeBaslik = (abakusSelection.label || abakusSelection.kart || '') + ' / ' + (abakusSelection.zincir || '')
      + (tip === 'taksit' ? ' / ' + abakusSelection.taksit + ' Taksit' : ' / Tek Çekim');
  }

  // ❖ Proje kampanyası varsa _projeNakit öncelikli
  const urunNakitler = basket.map(item =>
    item._projeNakit !== undefined
      ? Math.max(0, Number(item._projeNakit))
      : Math.max(0, (item.nakit||0) - (item.itemDisc||0))
  );
  const toplamNakit = urunNakitler.reduce((s,v) => s+v, 0) || 1;
  const tarih = new Date().toLocaleDateString('tr-TR');

  const rows = [
    ['Aygün AVM — Fatura Fiyatları'],
    ['Ödeme Yöntemi:', odemeBaslik],
    ['Tarih:', tarih],
    [],
    ['Ürün', 'Stok', 'Liste Fiyatı', 'Satır İnd.', 'Nakit Bedel', 'Fatura Bedeli', 'Komisyon', 'Kod']
  ];

  let dagitilanToplam = 0;
  basket.forEach((item, idx) => {
    const itemNakit   = urunNakitler[idx];
    const paylasim    = itemNakit / toplamNakit;
    const faturaFiyat = idx === basket.length - 1
      ? Math.max(0, toplamFatura - dagitilanToplam)
      : Math.round(toplamFatura * paylasim);
    dagitilanToplam  += faturaFiyat;
    const komisyon    = tip === 'nakit' ? 0 : faturaFiyat - itemNakit;
    rows.push([
      item.urun, item.stok||'', item.nakit||0,
      item.itemDisc||0, itemNakit,
      faturaFiyat, komisyon > 0 ? '+'+komisyon : komisyon, item.kod||''
    ]);
  });

  rows.push([]);
  rows.push(['TOPLAM', '', t.nakit, totalItemDisc, nakitFinal, toplamFatura,
    tip === 'nakit' ? 0 : Math.max(0, toplamFatura - nakitFinal), '']);

  const BOM = '\uFEFF';
  const csv = BOM + rows.map(r =>
    r.map(v => {
      const s = String(v ?? '').replace(/"/g, '""');
      return /[,;"'\n]/.test(s) ? `"${s}"` : s;
    }).join(';')
  ).join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'aygun-fatura-' + tarih.replace(/\./g,'-') + '.csv';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
};

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
  const bazNakit2 = t.nakitNet !== undefined ? t.nakitNet : t.nakit;
  let nakit = bazNakit2 - totalItemDisc - getDisc(bazNakit2 - totalItemDisc);
  const manEl=document.getElementById('ab-nakit');
  if(manEl && manEl.value!=='') { const mn=parseFloat(manEl.value.replace(',','.')); if(!isNaN(mn)&&mn>0) nakit=mn; }

  // Ödeme metni
  // Pazarlık notunu abaküs inputundan al
  const _pazarlikNotu = (document.getElementById('ab-pazarlik-notu')?.value || '').trim();
  const _ekIndirimAksiyon = abakusSelection?.ekIndirim || 0;

  let odemeMetni = '';
  if(abakusSelection===null) {
    // Nakit durumunda ek indirim nakitFinal'dan hesaplanmış olabilir
    const _abNakitEl = document.getElementById('ab-nakit');
    const _manNakit = _abNakitEl && _abNakitEl.value !== '' ? parseFloat(_abNakitEl.value.replace(',','.')) : 0;
    const _ekInd = parseFloat(document.getElementById('ab-ek-indirim')?.value || 0) || 0;
    odemeMetni = 'Nakit — '+fmt(nakit - _ekInd) + (_ekInd > 0 ? ' (Pazarlık: -'+fmt(_ekInd)+')' : '');
  } else if (abakusSelection.type === 'proje') {
    odemeMetni = '❖ ' + abakusSelection.projeLabel + ' — ' + fmt(abakusSelection.nakit)
      + (_ekIndirimAksiyon > 0 ? ' (Pazarlık: -'+fmt(_ekIndirimAksiyon)+')' : '');
  } else {
    odemeMetni = abakusSelection.label+' / '+abakusSelection.zincir+' POS — Toplam: '+fmt(abakusSelection.tahsilat)+' / Aylık: '+fmt(abakusSelection.aylik)
      + (_ekIndirimAksiyon > 0 ? ' (Pazarlık: -'+fmt(_ekIndirimAksiyon)+')' : '');
  }

  _abakusClosedByAction = true; // floating bar çıkmasın
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
        const _nakitGoster = Math.max(0, nakit - (parseFloat(document.getElementById('ab-ek-indirim')?.value || 0) || 0));
        info.innerHTML='<div class="wa-ab-info-box"><span class="wa-ab-chip wa-ab-nakit">💵 Nakit</span>'
          + (_nakitGoster < nakit ? '<span class="wa-ab-chip" style="color:#dc2626;text-decoration:line-through;opacity:.6">'+fmt(nakit)+'</span>' : '')
          + '<span class="wa-ab-chip wa-ab-tahsilat">'+fmt(_nakitGoster)+'</span>'
          + ((_nakitGoster < nakit) ? '<span class="wa-ab-chip" style="color:#16a34a">-'+fmt(nakit-_nakitGoster)+' pazarlık</span>' : '')
          + '</div>';
      } else if (abakusSelection.type === 'proje') {
        info.innerHTML='<div class="wa-ab-info-box"><span class="wa-ab-chip wa-ab-nakit">❖ '+abakusSelection.projeLabel+'</span><span class="wa-ab-chip wa-ab-tahsilat">'+fmt(abakusSelection.nakit)+'</span></div>';
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

  const custName = _esc((document.getElementById('cust-name')?.value || '').trim() || '-');
  const phone = (document.getElementById('cust-phone')?.value || '').trim();
  const extraNote = (document.getElementById('extra-info')?.value || '').trim();
  const t = basketTotals();

  const totalItemDisc = basket.reduce((s, i) => s + (i.itemDisc || 0), 0);
  const bazNakit3  = t.nakitNet !== undefined ? t.nakitNet : t.nakit;
  const nakitFiyat = bazNakit3;                                                           // ❖ dahil gerçek net baz
  const altIndirim    = discountType === 'TRY' ? discountAmount : (nakitFiyat - totalItemDisc) * discountAmount / 100;
  const toplamIndirim = totalItemDisc + altIndirim;                                       // satır + alt indirim
  const indirimliNakit = nakitFiyat - toplamIndirim;                                      // kart bazı = bu değer

  // Pazarlık indirimi — kart seçiliyse abakusSelection'dan
  // Nakit seçiliyse: önce global saklanan değer, yoksa input, yoksa 0
  const _ekIndirimF    = abakusSelection
    ? (abakusSelection.ekIndirim || 0)
    : (window._nakitEkIndirim ||
       parseFloat(document.getElementById('ab-ek-indirim')?.value || '0') || 0);
  const _pazarlikNotuF = (document.getElementById('ab-pazarlik-notu')?.value || '').trim();

  // Nakit tahsilat = indirimliNakit - pazarlık
  const nakitTahsilat = Math.max(0, indirimliNakit - _ekIndirimF);

  let od = '', odText = '';
  let tahsilat = nakitTahsilat; // default nakit

  if (abakusSelection && abakusSelection.type === 'proje') {
    // ❖ Proje fiyatı — komisyon/POS yok
    tahsilat = abakusSelection.nakit;
    od      = '❖ ' + abakusSelection.projeLabel + ': ' + fmt(tahsilat);
    odText  = '❖ ' + abakusSelection.projeLabel + ' — ' + fmt(tahsilat);
  } else if (abakusSelection) {
    // ✅ DOĞRU: Kart farkı indirim SONRASI nakit üzerinden hesaplanır
    tahsilat = abakusSelection.tahsilat;
    const taksitSayisi = abakusSelection.taksit;
    const aylikTutar   = taksitSayisi === 1 ? tahsilat : Math.floor(tahsilat / taksitSayisi) + (tahsilat % taksitSayisi > 0 ? 1 : 0);
    od      = abakusSelection.label + ' (' + abakusSelection.zincir + ' POS): ' + fmt(tahsilat) + '\nAylık taksit: ' + fmt(aylikTutar);
    odText  = abakusSelection.label + ' / ' + abakusSelection.zincir + ' POS — ' + fmt(tahsilat);
  } else {
    od     = 'Nakit — ' + fmt(nakitTahsilat);
    odText = 'Nakit — ' + fmt(nakitTahsilat);
    tahsilat = nakitTahsilat;
  }

  // ── WA MODU ──────────────────────────────────────────────────
  if (_aksiyonMode === 'wa') {
    if (!phone || phone.length !== 11 || phone[0] !== '0') {
      await ayAlert('WhatsApp için 0 ile başlayan 11 haneli telefon giriniz.');
      haptic(80);
      return;
    }

    // Geçerlilik tarihi öncelik sırası:
    // 1. Kaydedilmiş teklifteki sureBitis (propFromInput ile eşleşen teklif)
    // 2. Formdaki tarih inputu
    // 3. Varsayılan: +3 gün
    const sureBitisInputWa = document.getElementById('teklif-sure-bitis');
    const kaydedilenSure = (() => {
      // Mevcut düzenleme modunda olan teklifi bul
      const editId = document.getElementById('prop-edit-id')?.value;
      if (editId) {
        const mevcut = proposals.find(p => p.id === editId);
        if (mevcut?.sureBitis) return mevcut.sureBitis;
      }
      return null;
    })();
    const sureDegeri = sureBitisInputWa?.value   // form inputu dolu mu?
                    || kaydedilenSure            // kaydedilmiş teklif
                    || null;
    const expDateObj = sureDegeri
      ? new Date(sureDegeri)
      : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const expDate = String(expDateObj.getDate()).padStart(2, '0') + '.' +
      String(expDateObj.getMonth() + 1).padStart(2, '0') + '.' +
      String(expDateObj.getFullYear()).slice(-2);

    let waMsg = `Aygün AVM Teklif\n\n`;
    waMsg += `*Sn* ${custName}\n`;
    waMsg += `*Telefon* ${phone}\n\n`;
    waMsg += `\`Ürünler\`\n`;
    basket.forEach(i => { waMsg += `  - ${i.urun}\n`; });

    // WA indirim: tüm indirimler birleşik tek satır
    const _waToplamInd = toplamIndirim + _ekIndirimF;
    if (_waToplamInd > 0) {
      waMsg += `\n_Toplam İndirim: -${fmt(_waToplamInd)}_\n\n`;
    } else {
      waMsg += `\n\n`;
    }

    if (abakusSelection === null) {
      waMsg += `* Nakit\n`;
      waMsg += `*Toplam* ${fmt(nakitTahsilat)}\n\n`;
    } else if (Number(abakusSelection.taksit) === 1) {
      const kartAdi = abakusSelection.kart || abakusSelection.label || '';
      waMsg += `* ${kartAdi}\n`;
      waMsg += `*${fmt(tahsilat)}* Tek Çekim\n\n`;
    } else {
      const kartAdi = abakusSelection.kart || abakusSelection.label || '';
      const taksitSayisi = abakusSelection.taksit;
      const aylikTutar = Math.ceil(tahsilat / taksitSayisi);
      waMsg += `* ${kartAdi}\n`;
      waMsg += `*${fmt(aylikTutar)}* x ${taksitSayisi} Taksit\n`;
      waMsg += `*Toplam* ${fmt(tahsilat)}\n\n`;
    }

    waMsg += `> Teklifimize konu ürünlerin fiyatlarını değerlendirmelerinize sunar, ihtiyaç duyacağınız her konuda memnuniyetle destek vermeye hazır olduğumuzu belirtir; çalışmalarınızda kolaylıklar dileriz. Teklif geçerlilik *${expDate}* tarihidir.\n\n`;
    waMsg += `*Saygılarımızla,* ${currentUser?.Ad || currentUser?.Email?.split('@')[0] || 'fatih'}`;

    const wpLink = `https://wa.me/9${phone}?text=${encodeURIComponent(waMsg)}`;
    window.open(wpLink, '_blank');

    const sureBitisElWa = document.getElementById('teklif-sure-bitis');
    const sureBitisWa = sureBitisElWa?.value ? new Date(sureBitisElWa.value).toISOString() : null;
    const gizlilikElWa = document.querySelector('input[name="teklif-gizlilik"]:checked');
    _kaydetTeklif(custName, phone, odText, tahsilat, extraNote, sureBitisWa, gizlilikElWa?.value || 'acik', _ekIndirimF, _pazarlikNotuF);
    await clearBasket(true, 'teklif', 'WhatsApp');
    closeWaModal();
    closeAbakus();
    // Sepet + abakus modallarını kapat, ana ekrana dön
    const _cm1 = document.getElementById('cart-modal');
    if (_cm1) { _cm1.style.display='none'; _cm1.classList.remove('open'); }
    _clearAksiyonForm();
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

    _kaydetTeklif(custName, phone, odText, tahsilat, extraNote, sureBitis, gizlilik, _ekIndirimF, _pazarlikNotuF);
    await clearBasket(true, 'teklif', 'Form/PDF');
    closeWaModal();
    closeAbakus();
    const _cm2 = document.getElementById('cart-modal');
    if (_cm2) { _cm2.style.display='none'; _cm2.classList.remove('open'); }
    _clearAksiyonForm();
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
      toplamOdeme: odemeTipi === 'nakit' ? nakitTahsilat : toplamKartOdeme,
      toplamIndirim,
      ekIndirim:    _ekIndirimF || 0,
      pazarlikNotu: _pazarlikNotuF || '',
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
    fbSaveSale(saleRecord).catch(() => {});
    await logSessionResult('satis');
    logAnalytics('sale', custName);
    incrementDailyStat('teklif_sayisi', 1).catch(() => {});
    incrementDailyStat('satis_sayisi',  1).catch(() => {});
    _syncSatisTeklif(custName, phone);
    await clearBasket(true, 'satis', 'Satış Belgesi');
    closeWaModal();
    closeAbakus();
    const _cm3 = document.getElementById('cart-modal');
    if (_cm3) { _cm3.style.display='none'; _cm3.classList.remove('open'); }
    _clearAksiyonForm();
    return;
  }
}

function _kaydetTeklif(custName, phone, odText, tahsilat, extraNote, sureBitis, gizlilik, ekIndirim = 0, pazarlikNotu = '') {
  if (_intentLevel < 4) _intentLevel = 4; // Intent L4: Teklif oluşturuldu
  const prop = {
    id:uid(), ts:new Date().toISOString(),
    custName, phone, urunler:basket.map(i=>({...i})),
    odeme:odText, nakit:tahsilat, indirim:discountAmount, indirimTip:discountType,
    abakus: abakusSelection ? {...abakusSelection} : null,
    ekIndirim: ekIndirim || 0,         // Pazarlık indirimi (yuvarlama sonrası)
    pazarlikNotu: pazarlikNotu || '',   // Pazarlık notu
    user:currentUser?.Email||'-', durum:'bekliyor', not:extraNote, tip:'teklif',
    sureBitis: sureBitis || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // Varsayılan: 3 gün
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
  currentPropFilter = 'bekliyor';
  document.querySelectorAll('.pseg-btn').forEach(b=>b.classList.toggle('active', b.dataset.filter==='bekliyor'));
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

  // ── Render sırasında süresi dolan teklifleri lazy işaretle ──────────────
  // Firebase'e yazma: yalnızca kullanıcı o teklife "dokunduğunda" (_lazyMarkExpired)
  // Burada sadece local state güncellenir (kota koruması).
  proposals.forEach(p => {
    if (isExpired(p)) {
      p.durum = 'sureDoldu';
      if (!p.archivedAt)  p.archivedAt  = new Date().toISOString();
      if (!p.iptalNedeni) p.iptalNedeni = 'Sadece Bilgi Aldı';
    }
  });

  // Arşiv süreleri:
  // satisDondu / iptal → 1 hafta sonra listeden düşer
  // sureDoldu          → 1 ay sonra listeden düşer
  const now = Date.now();
  const _birHafta = 7  * 24 * 60 * 60 * 1000;
  const _birAy    = 30 * 24 * 60 * 60 * 1000;
  const isArchived = p => {
    if (!p.archivedAt) return false;
    const gecen = now - new Date(p.archivedAt).getTime();
    if (p.durum === 'satisDondu' || p.durum === 'iptal') return gecen > _birHafta;
    if (p.durum === 'sureDoldu')                          return gecen > _birAy;
    return false; // bekliyor arşivlenmez
  };

  let myProps = isAdmin()
    ? proposals.filter(p => !isArchived(p))
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

  // Toplu işlem çubuğu + checkbox'lar
  const _bulkBar = `
    <div id="prop-bulk-bar" style="display:none;position:sticky;bottom:0;background:var(--surface);
      border-top:1.5px solid var(--border);padding:10px 14px;display:none;
      align-items:center;gap:8px;flex-wrap:wrap;z-index:10;box-shadow:0 -4px 16px rgba(0,0,0,.08)">
      <span id="prop-bulk-count" style="font-size:.72rem;font-weight:700;color:var(--text-2);min-width:70px"></span>
      <button onclick="bulkUpdateStatus('satisDondu')"
        style="padding:6px 12px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-size:.70rem;font-weight:700;cursor:pointer;font-family:inherit">
        ✓ Satışa Döndü
      </button>
      <button onclick="bulkUpdateStatus('iptal')"
        style="padding:6px 12px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:.70rem;font-weight:700;cursor:pointer;font-family:inherit">
        ✕ İptal Et
      </button>
      <button onclick="bulkPrintProposals()"
        style="padding:6px 12px;background:#0f172a;color:#fff;border:none;border-radius:8px;font-size:.70rem;font-weight:700;cursor:pointer;font-family:inherit">
        🖨 Toplu PDF
      </button>
      <button onclick="mergeProposals()"
        style="padding:6px 12px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:.70rem;font-weight:700;cursor:pointer;font-family:inherit">
        🔗 Birleştir
      </button>
      <button onclick="clearBulkSelection()"
        style="padding:6px 10px;background:none;color:var(--text-3);border:1px solid var(--border);border-radius:8px;font-size:.70rem;cursor:pointer;font-family:inherit;margin-left:auto">
        ✕ İptal
      </button>
    </div>`;
  target.innerHTML = (renderHtml || '<div class="admin-empty">Teklif bulunamadı</div>') + _bulkBar;

  // Toplu seçim checkbox event'lerini bağla
  target.querySelectorAll('.prop-checkbox').forEach(cb => {
    cb.addEventListener('change', _updateBulkBar);
  });
  _updateBulkBar();
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
    const propDate = _tarih(p.ts);
    const todayStr = new Date().toISOString().split('T')[0];
    const salesCanEdit = propDate === todayStr;
    const canEdit = isAdmin() || (p.user===me && salesCanEdit);

    // Süre kontrolü — UI tarafında isExpired() ile, lazy Firebase yazma
    if (isExpired(p)) {
      p.durum = 'sureDoldu';
      if (!p.archivedAt) p.archivedAt = new Date().toISOString();
      // Lazy: Firebase'e yaz (süresi dolan teklife ilk kez dokunulunca)
      _lazyMarkExpired(p.id);
    }

    const isActive = p.durum==='bekliyor'||p.durum==='sureDoldu';

    // Not göstergesi
    const noteCount = (p.adminNot||[]).length;
    const noteDot = noteCount ? `<span class="note-dot">${noteCount}</span>` : '';

    // Buton grubu — ikon tabanlı pill tasarım
    const btns = [];
    if(canAct && isActive) {
      btns.push(`<button class="pact-btn pact-green haptic-btn" onclick="propSatisDon('${p.id}')" title="Satışa Döndü"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 8l4 4 8-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="pact-label"> Satışa Döndü</span></button>`);
      btns.push(`<button class="pact-btn pact-red haptic-btn" onclick="propIptalEt('${p.id}')" title="İptal Et"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><span class="pact-label"> İptal</span></button>`);
    }
    if(p.phone && p.phone!=='—') {
      btns.push(`<button class="pact-btn pact-pdf haptic-btn" onclick="printTeklif('${p.id}')" title="PDF Teklif"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="9" height="12" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5 5h5M5 8h5M5 11h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M9 1v3.5H12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg><span class="pact-label"> PDF</span></button>`);
      btns.push(`<button class="pact-btn pact-wa haptic-btn" onclick="resendProposalWa('${p.id}')" title="WhatsApp"><svg width="13" height="13" viewBox="0 0 32 32" fill="currentColor"><path d="M16 2C8.27 2 2 8.27 2 16c0 2.44.65 4.72 1.78 6.7L2 30l7.53-1.74A13.94 13.94 0 0016 30c7.73 0 14-6.27 14-14S23.73 2 16 2zm0 25.5a11.44 11.44 0 01-5.86-1.6l-.42-.25-4.47 1.03 1.06-4.34-.27-.44A11.5 11.5 0 1116 27.5zm6.3-8.6c-.34-.17-2.02-.99-2.33-1.1-.31-.12-.54-.17-.76.17-.23.34-.88 1.1-1.08 1.33-.2.23-.4.25-.74.08-.34-.17-1.43-.52-2.73-1.66-1.01-.9-1.69-2-1.89-2.34-.2-.34-.02-.52.15-.69.15-.15.34-.4.51-.6.17-.2.23-.34.34-.57.12-.23.06-.43-.03-.6-.08-.17-.76-1.83-1.04-2.5-.27-.65-.55-.56-.76-.57h-.65c-.22 0-.57.08-.87.4s-1.14 1.11-1.14 2.7 1.17 3.13 1.33 3.35c.17.22 2.3 3.5 5.57 4.77.78.34 1.39.54 1.86.69.78.25 1.49.21 2.05.13.63-.09 1.93-.79 2.2-1.55.28-.76.28-1.41.2-1.55-.09-.13-.32-.2-.65-.36z"/></svg></button>`);
    }
    // Not: kendi teklifi VEYA admin not ekleyebilir; herkese açık tekliflerde de satış kullanıcısı not ekleyebilir
    const canNote = isAdmin() || p.user===me || p.gizlilik==='acik' || !p.gizlilik;
    if(canNote) btns.push(`<button class="pact-btn pact-note haptic-btn" onclick="openPropNote('${p.id}')" title="Not Ekle"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 12V14h2l7.5-7.5-2-2L2 12zm12.7-7.3a1 1 0 000-1.4l-1-1a1 1 0 00-1.4 0L11 3.6l2.4 2.4 1.3-1.3z" fill="currentColor"/></svg>${noteDot}</button>`);
    // Sepete Ekle: tüm kullanıcılar her teklifi sepete alabilir — güncel fiyat + açıklamalar ile
    btns.push(`<button class="pact-btn haptic-btn" onclick="teklifSepeteEkle('${p.id}')" title="Güncel fiyat ve açıklamalarla sepete ekle" style="color:#16a34a;border-color:#bbf7d0;background:#f0fdf4;font-weight:700">🛒</button>`);
    if(canEdit) {
      if(isAdmin() || p.user === (currentUser?.Email||'')) btns.push(`<button class="pact-btn pact-edit haptic-btn" onclick="teklifRevizeSepet('${p.id}')" title="Revize Düzenle — güncel fiyat + teklif indirimleri" style="color:#7c3aed;border-color:#e9d5ff;background:#faf5ff">✏️</button>`);
      if(isAdmin()) btns.push(`<button class="pact-btn pact-edit haptic-btn" onclick="openEditProp('${p.id}')" title="Teklif Verilerini Düzenle"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1" y="11" width="14" height="1.5" rx=".75" fill="currentColor"/><path d="M10.5 2.5l2 2-7 7-2.5.5.5-2.5 7-7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></button>`);
      if(isAdmin()) btns.push(`<button class="pact-btn pact-del haptic-btn" onclick="deleteProp('${p.id}')" title="Sil"><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l.5 9h5L11 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`);
    }

    const userTag = `<span class="proposal-tag prop-user-tag" style="${p.user===me?'background:#dcfce7;color:#15803d':''}">👤 ${p.user.split('@')[0]}</span>`;
    const gizliTag = p.gizlilik==='kapali' ? `<span class="proposal-tag" style="background:#f3e8ff;color:#7c3aed">🔒</span>` : '';
    const sureTag = p.sureBitis ? `<span class="proposal-tag" style="background:#fff7ed;color:#c2410c">⏰ ${new Date(p.sureBitis).toLocaleDateString('tr-TR')}</span>` : '';
    const adminNotes = (p.adminNot||[]).length
      ? `<div class="prop-note-timeline">${(p.adminNot||[]).map(n=>`
          <div class="prop-tl-item">
            <div class="prop-tl-dot"></div>
            <div class="prop-tl-body">
              <span class="prop-tl-who">${n.who.split('@')[0]}</span>
              <span class="prop-tl-time">${fmtDate(n.ts)}</span>
              <div class="prop-tl-text">${n.text}</div>
            </div>
          </div>`).join('')}</div>`
      : '';

    return `<div class="proposal-card status-card-${p.durum||'bekliyor'}${p.durum==='satisDondu'?' prop-card-converted':''}" id="pcard-${p.id}">
      <div class="proposal-card-header">
        <label style="display:flex;align-items:center;gap:0;margin-right:4px;cursor:pointer" onclick="event.stopPropagation()">
          <input type="checkbox" class="prop-checkbox" data-id="${p.id}"
            style="width:15px;height:15px;accent-color:var(--red);cursor:pointer;border-radius:3px">
        </label>
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
        <div class="proposal-products">${(p.urunler||[]).map(u=>{
          const camps    = u._campaigns || [];
          const selCamps = u._selectedCamps || {};
          const campLabels = Object.entries(selCamps)
            .filter(([ci, sel]) => sel && camps[parseInt(ci)])
            .map(([ci]) => {
              const c = camps[parseInt(ci)];
              const iconMap = { birlesen:'⎇', kilitli:'🔒', proje:'❖', bagimsiz:'⌗', bilgi:'✦' };
              const icon = iconMap[c.tip] || '⌗';
              const tutar = c.tip === 'proje'
                ? (c.tutar >= 1000 ? (c.tutar/1000).toFixed(c.tutar%1000===0?0:1)+'k' : c.tutar)
                : '-' + (c.tutar >= 1000 ? (c.tutar/1000).toFixed(c.tutar%1000===0?0:1)+'k' : c.tutar);
              const bgMap = { birlesen:'#f0fdf4', kilitli:'#fef3c7', proje:'#f5f3ff', bagimsiz:'#eff6ff', bilgi:'#f8fafc' };
              const txMap = { birlesen:'#166534', kilitli:'#92400e', proje:'#7c3aed', bagimsiz:'#1d4ed8', bilgi:'#64748b' };
              const bg = bgMap[c.tip] || '#eff6ff';
              const tx = txMap[c.tip] || '#1d4ed8';
              return `<span style="font-size:.63rem;background:${bg};color:${tx};padding:1px 5px;border-radius:4px;margin-left:4px;white-space:nowrap">${icon} ${c.grup} ${tutar}</span>`;
            }).join('');
          return `• ${u.urun}${campLabels}`;
        }).join('<br>')}</div>
        ${adminNotes}
      </div>
      ${btns.length ? `<div class="proposal-action-bar">${btns.join('')}</div>` : ''}
    </div>`;
  } catch(e) {
    console.error('_renderSingleProp error:', e, p);
    return `<div class="proposal-card" style="padding:10px;color:#dc2626">⚠️ ${p.custName||'?'} — render hatası: ${e.message}</div>`;
  }
}

// checkExpiredProposals artık Firebase'e yazma yapmıyor —
// isExpired() UI render sırasında çağrılır, _lazyMarkExpired() ise
// kullanıcı o teklife dokunduğunda (durum değiştirme, görüntüleme) tetiklenir.
// Bu yaklaşım Firestore yazma kotasını korur.
function checkExpiredProposals() {
  // Geriye dönük uyumluluk — artık sadece local state günceller, FB yazmaz
  proposals.forEach(p => {
    if (isExpired(p)) {
      p.durum = 'sureDoldu';
      if (!p.archivedAt)  p.archivedAt  = new Date().toISOString();
      if (!p.iptalNedeni) p.iptalNedeni = 'Sadece Bilgi Aldı';
    }
  });
}

async function updatePropStatus(id, durum, extraFields = {}) {
  if (window._renderProposalsPaused) {
    // Toplu işlem sırasında render bastırılır — bulkUpdateStatus sonunda tek sefer render
    const idx2 = proposals.findIndex(p => p.id === id);
    if (idx2 === -1) return;
    // Sadece state güncelle, render çağırma
  }
  const idx = proposals.findIndex(p => p.id === id);
  if (idx === -1) return;

  const mevcut = proposals[idx].durum;

  // ── 1. Durum Makinesi: geçersiz geçişleri engelle ──────────────────────
  if (!_propTransitionAllowed(mevcut, durum)) {
    console.warn(`Geçersiz durum geçişi: ${mevcut} → ${durum} (teklif: ${id})`);
    return;
  }

  // ── 2. Satış anında finalSnapshot — fiyatları dondur ───────────────────
  // Arşivdeki teklif her zaman o günkü fiyatları yansıtır.
  if (durum === 'satisDondu' && !proposals[idx].finalSnapshot) {
    proposals[idx].finalSnapshot = {
      ts:       new Date().toISOString(),
      urunler:  (proposals[idx].urunler || []).map(u => ({ ...u })),
      nakit:    proposals[idx].nakit,
      indirim:  proposals[idx].indirim,
      ekIndirim:proposals[idx].ekIndirim || 0,
      abakus:   proposals[idx].abakus ? { ...proposals[idx].abakus } : null,
      odeme:    proposals[idx].odeme   || null,
    };
  }

  proposals[idx].durum = durum;

  // ── 3. Arşiv tarihi ─────────────────────────────────────────────────────
  if (durum === 'iptal' || durum === 'satisDondu' || durum === 'sureDoldu') {
    proposals[idx].archivedAt = new Date().toISOString();
  } else {
    delete proposals[idx].archivedAt;
  }

  // ── 4. Ekstra alanları uygula (iptalNedeni vb.) ─────────────────────────
  Object.assign(proposals[idx], extraFields);

  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  // Toplu işlem sırasında render bastırılır — bulkUpdateStatus sonunda tek sefer çağırır
  if (!window._renderProposalsPaused) {
    renderProposals();
    const adminList = document.getElementById('admin-proposals-list');
    if (adminList) renderProposals(adminList, true);
  }

  // Firebase'e yaz
  const fbFields = {
    durum,
    archivedAt: proposals[idx].archivedAt || null,
    ...extraFields,
  };
  if (proposals[idx].finalSnapshot) fbFields.finalSnapshot = proposals[idx].finalSnapshot;
  fbUpdateProp(proposals[idx].id, fbFields);
  if (durum === 'satisDondu') {
    incrementDailyStat('satis_sayisi', 1).catch(() => {});
  }
}

// ── Teklif: Satışa Döndü ─────────────────────────────────────────────────
async function propSatisDon(id) {
  haptic(20);
  const p = proposals.find(pr => pr.id === id);
  if (!p) return;
  if (!_propTransitionAllowed(p.durum, 'satisDondu')) {
    ayAlert('Bu teklif artık değiştirilemez.'); return;
  }
  if (!(await ayConfirm(`"${p.custName}" teklifini Satışa Döndü olarak işaretle?`))) return;
  await updatePropStatus(id, 'satisDondu');
}

// ── Teklif: İptal — zorunlu neden seçimi ────────────────────────────────
const _IPTAL_NEDENLER = [
  'Fiyat Pahalı',
  'Taksit Uygun Değil',
  'Sadece Bilgi Aldı',
  'Düşünmek İstiyor',
  'Teklif güncellendi',
];

async function propIptalEt(id) {
  haptic(16);
  const p = proposals.find(pr => pr.id === id);
  if (!p) return;
  if (!_propTransitionAllowed(p.durum, 'iptal')) {
    ayAlert('Bu teklif artık değiştirilemez.'); return;
  }

  // İptal nedeni seçim modalı
  const neden = await _iptalNedenSec(p.custName);
  if (!neden) return; // kullanıcı vazgeçti

  await updatePropStatus(id, 'iptal', { iptalNedeni: neden, iptalTs: new Date().toISOString() });
}

async function _iptalNedenSec(custName) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-end;justify-content:center';

    const secilenRef = { val: null };
    const btns = _IPTAL_NEDENLER.map((n, i) =>
      `<button data-idx="${i}" style="display:block;width:100%;text-align:left;padding:12px 16px;`
      + `background:none;border:none;border-bottom:1px solid var(--border);font-family:inherit;`
      + `font-size:.85rem;color:var(--text-1);cursor:pointer" class="_iptal-neden-btn">${n}</button>`
    ).join('');

    overlay.innerHTML = `
      <div style="background:var(--surface);border-radius:16px 16px 0 0;width:100%;max-width:540px;
        padding-bottom:env(safe-area-inset-bottom,0px);max-height:80vh;overflow-y:auto">
        <div style="padding:16px;border-bottom:1px solid var(--border)">
          <div style="font-weight:700;font-size:.92rem">İptal Nedeni</div>
          <div style="font-size:.74rem;color:var(--text-2);margin-top:3px">${custName} — lütfen bir neden seçin</div>
        </div>
        ${btns}
        <button id="_iptal-vazgec" style="display:block;width:100%;padding:14px;background:none;border:none;
          font-family:inherit;font-size:.82rem;color:var(--text-3);cursor:pointer">Vazgeç</button>
      </div>`;

    overlay.querySelectorAll('._iptal-neden-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        overlay.remove();
        resolve(_IPTAL_NEDENLER[idx]);
      });
    });
    overlay.querySelector('#_iptal-vazgec').addEventListener('click', () => {
      overlay.remove(); resolve(null);
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(null); } });
    document.body.appendChild(overlay);
  });
}
function _getSelectedPropIds() {
  return [...document.querySelectorAll('.prop-checkbox:checked')].map(cb => cb.dataset.id);
}

function _updateBulkBar() {
  const ids = _getSelectedPropIds();
  const bar  = document.getElementById('prop-bulk-bar');
  const cnt  = document.getElementById('prop-bulk-count');
  if (!bar) return;
  if (ids.length > 0) {
    bar.style.display = 'flex';
    if (cnt) cnt.textContent = ids.length + ' seçili';
  } else {
    bar.style.display = 'none';
  }
}

function clearBulkSelection() {
  document.querySelectorAll('.prop-checkbox').forEach(cb => cb.checked = false);
  _updateBulkBar();
}

// Modül 1: Toplu durum güncelleme
async function bulkUpdateStatus(newStatus) {
  const ids = _getSelectedPropIds();
  if (!ids.length) return;
  const label = newStatus === 'satisDondu' ? 'Satışa Döndü' : 'İptal';
  if (!(await ayConfirm(`${ids.length} teklif "${label}" olarak işaretlensin mi?`))) return;
  // renderProposals'ı batch sonrası tek seferlik çağır
  const _renderProposalsBak = window._renderProposalsPaused;
  window._renderProposalsPaused = true;
  ids.forEach(id => updatePropStatus(id, newStatus));
  window._renderProposalsPaused = false;
  renderProposals();
  clearBulkSelection();
  haptic(22);
}

// Modül 2: Toplu PDF — seçilen teklifleri tek pencerede aç
function bulkPrintProposals() {
  const ids = _getSelectedPropIds();
  if (!ids.length) { ayAlert('Önce teklif seçin.'); return; }
  const selected = ids.map(id => proposals.find(p => p.id === id)).filter(Boolean);
  if (!selected.length) return;
  haptic(16);

  // Her teklif için PDF HTML'i oluştur, tek pencerede birleştir
  let combinedHTML = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">
    <title>Toplu Teklif PDF</title>
    <style>
      body { font-family: -apple-system, sans-serif; padding: 20px; }
      .page-break { page-break-after: always; border-top: 2px dashed #e2e8f0; margin: 32px 0; padding-top: 16px; }
      @media print { .page-break { page-break-after: always; } }
    </style>
  </head><body>`;

  selected.forEach((p, i) => {
    const ab = p.abakus;
    const urunler = p.urunler || [];
    const toplamNakit = urunler.reduce((s,u) => s + Number(u.nakit||u.fiyat||0), 0);
    const toplamItemDisc = urunler.reduce((s,u) => s + Number(u.itemDisc||0), 0);
    const indirimTip = p.indirimTip || 'TRY';
    const indirimMiktar = Number(p.indirim || 0);
    const altIndirim = indirimTip === 'TRY' ? indirimMiktar : (toplamNakit - toplamItemDisc) * indirimMiktar / 100;
    const toplamIndirim = toplamItemDisc + altIndirim;
    const ekIndirim = Number(p.ekIndirim || 0);
    let odemeTipi = 'nakit', kartAdi = '', taksitSayisi = 0, aylikTaksit = 0;
    // ✅ nakitNet = ham fiyat - satır indirimleri - alt indirim - pazarlık
    const nakitNetHesap = toplamNakit - toplamItemDisc - altIndirim - ekIndirim;
    let toplamOdeme = nakitNetHesap;
    if (ab) {
      toplamOdeme  = Number(ab.tahsilat) || nakitNetHesap;
      kartAdi      = ab.kart || ab.label || '';
      taksitSayisi = ab.taksit || 1;
      // ✅ aylik = yuvarlaKademe ile tutarlı
      aylikTaksit  = ab.aylik || (taksitSayisi > 1 ? Math.ceil(toplamOdeme/taksitSayisi) : toplamOdeme);
      odemeTipi    = taksitSayisi <= 1 ? 'tek_cekim' : 'taksit';
    }
    const _topluProjeItems = (urunler||[]).filter(u => u._projeNakit !== undefined && u._projeGrup);
    const _topluProjeLabel = _topluProjeItems.length > 0
      ? [...new Set(_topluProjeItems.map(u => (u._projeGrup||'Proje').replace(/\s+[\d.,[\]\s]+.*$/, '').trim()))].join(' · ')
      : '';
    const pdfData = {
      belgeNo:      (p.id||'').slice(-8).toUpperCase(),
      tarih:        new Date(p.ts||Date.now()).toLocaleDateString('tr-TR'),
      musteriIsim:  p.custName || '—',
      telefon:      p.phone || '—',
      satici:       (p.user||'').split('@')[0],
      not:          p.not || '',
      odemeTipi, kartAdi, taksitSayisi, aylikTaksit,
      toplamOdeme, toplamIndirim, ekIndirim,
      pazarlikNotu: p.pazarlikNotu || '',
      projeLabel:   _topluProjeLabel,
      sureBitis:    p.sureBitis || '',
      urunler
    };
    combinedHTML += (i > 0 ? '<div class="page-break"></div>' : '');
    // buildPremiumPDF'in body kısmını al
    const fullHtml = buildPremiumPDF('TEKLİF FORMU', pdfData);
    // <body>...</body> arasını çıkar
    const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*)<\/body>/);
    combinedHTML += bodyMatch ? bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '') : `<p>${p.custName}</p>`;
  });

  combinedHTML += `<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));<\/script></body></html>`;
  const win = window.open('', '_blank', 'width=820,height=960,scrollbars=yes');
  if (!win) { ayAlert('Popup engellendi, tarayıcı izin verin.'); return; }
  win.document.write(combinedHTML);
  win.document.close();
}

// Modül 3: Teklif birleştirme — aynı müşterinin seçili tekliflerini tek sözleşmede topla
async function mergeProposals() {
  const ids = _getSelectedPropIds();
  if (ids.length < 2) { ayAlert('Birleştirmek için en az 2 teklif seçin.'); return; }
  const selected = ids.map(id => proposals.find(p => p.id === id)).filter(Boolean);

  // Müşteri tutarlılık kontrolü
  const names = [...new Set(selected.map(p => (p.custName||'').toLowerCase().trim()))];
  if (names.length > 1) {
    if (!(await ayConfirm(`Farklı müşterilere ait teklifler seçildi (${names.join(', ')}). Yine de birleştir?`))) return;
  }

  // Tüm ürünleri ve toplamları birleştir
  const allUrunler = selected.flatMap(p => p.urunler || []);
  const toplamNakit = allUrunler.reduce((s,u) => s + Number(u.nakit||u.fiyat||0), 0);
  const toplamItemDisc = allUrunler.reduce((s,u) => s + Number(u.itemDisc||0), 0);
  const toplamOdeme = toplamNakit - toplamItemDisc;
  const rep = selected[0];

  const pdfData = {
    belgeNo:      'BIRLESTIRME-' + Date.now().toString(36).toUpperCase().slice(-6),
    tarih:        new Date().toLocaleDateString('tr-TR'),
    musteriIsim:  rep.custName || '—',
    telefon:      rep.phone || '—',
    satici:       (rep.user||'').split('@')[0],
    not:          `Birleştirilen teklifler: ${selected.map(p=>'#'+(p.id||'').slice(-6)).join(', ')}`,
    odemeTipi:    'nakit',
    kartAdi: '', taksitSayisi: 0, aylikTaksit: 0,
    toplamOdeme,
    toplamIndirim: toplamItemDisc,
    ekIndirim: 0,
    pazarlikNotu: '',
    urunler: allUrunler
  };

  haptic(20);
  const html = buildPremiumPDF('BİRLEŞİK TEKLİF', pdfData);
  _openPdfWindow(html);
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

  // Timeline modal — mevcut notlar + yeni not girişi
  const _notes = (p.adminNot||[]);
  const _notesHTML = _notes.length
    ? _notes.map(n=>`<div style="display:flex;gap:8px;margin-bottom:10px">
        <div style="width:7px;height:7px;background:var(--red);border-radius:50%;margin-top:5px;flex-shrink:0"></div>
        <div style="flex:1">
          <div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap">
            <span style="font-size:.70rem;font-weight:700;color:var(--red)">${n.who.split('@')[0]}</span>
            <span style="font-size:.60rem;color:var(--text-3)">${fmtDate(n.ts)}</span>
          </div>
          <div style="font-size:.74rem;color:var(--text-1);margin-top:2px;line-height:1.45">${n.text}</div>
        </div>
      </div>`).join('')
    : '<div style="font-size:.72rem;color:var(--text-3);text-align:center;padding:12px 0">Henüz not yok</div>';

  const _gecmisMetni = _notes.length
    ? '─── Geçmiş ───\n' + _notes.map(n => n.who.split('@')[0] + ' (' + fmtDate(n.ts) + '): ' + n.text).join('\n') + '\n\n'
    : '';
  const text = await ayPrompt('📋 ' + p.custName + ' — Notlar\n\n' + _gecmisMetni + 'Yeni not:', '');
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
  fbUpdateProp(proposals[idx].id, { adminNot: proposals[idx].adminNot });
  _showNoteToast(p.custName, text.trim());
}
// Sözleşme kaydedilince aynı müşterinin bekleyen tekliflerini otomatik kapat
function _syncSatisTeklif(custName, phone) {
  try {
    const _name  = (custName||'').toLowerCase().trim();
    const _phone = (phone||'').replace(/\D/g,'');

    // Sepetteki ürün adları kümesi — eşleşme için
    const _sepetUrunler = new Set(basket.map(i => (i.urun||'').toLowerCase().trim()));

    // abakusSelection'daki ödeme yöntemi (kart adı + taksit)
    const _abKart    = abakusSelection ? (abakusSelection.kart||abakusSelection.label||'').toLowerCase() : 'nakit';
    const _abTaksit  = abakusSelection ? (abakusSelection.taksit||1) : 0;

    const matched = proposals.filter(p => {
      if (p.durum !== 'bekliyor') return false;

      // 1. Telefon veya isim eşleşmesi zorunlu
      const pPhone = (p.phone||'').replace(/\D/g,'');
      const pName  = (p.custName||'').toLowerCase().trim();
      const phoneMatch = _phone && _phone.length > 6 && pPhone === _phone;
      const nameMatch  = _name.length > 2 && pName === _name;
      if (!phoneMatch && !nameMatch) return false;

      // 2. Ürün örtüşmesi — teklifin ürünlerinden en az biri sepette olmalı
      const pUrunler = (p.urunler||[]).map(u => (u.urun||'').toLowerCase().trim());
      const urunEslesti = pUrunler.some(u => _sepetUrunler.has(u));
      if (!urunEslesti) return false;

      // 3. Ödeme eşleşmesi opsiyonel — kart+taksit aynıysa öncelikli, yoksa sadece isim/telefon+ürün yeterli
      const pAb     = p.abakus;
      const pKart   = pAb ? (pAb.kart||pAb.label||'').toLowerCase() : 'nakit';
      const pTaksit = pAb ? (pAb.taksit||1) : 0;
      const odemeEslesti = pKart === _abKart && pTaksit === _abTaksit;

      // Ödeme eşleşmesi varsa kesin eşleşme; yoksa isim/telefon+ürün yeterli
      return odemeEslesti || true; // gevşetildi: isim+ürün yeterli
    });

    matched.forEach(p => {
      updatePropStatus(p.id, 'satisDondu');
      console.log('🔗 Teklif kapatıldı (ürün+ödeme eşleşti):', p.id, p.custName, p.odeme);
    });

    if (matched.length > 0) {
      const _ct = document.getElementById('change-toast');
      if (_ct) {
        _ct.textContent = '✅ ' + matched.length + ' teklif "Satışa Döndü" olarak güncellendi';
        _ct.classList.add('show');
        setTimeout(() => _ct.classList.remove('show'), 2800);
      }
    }
  } catch(e) { console.warn('_syncSatisTeklif:', e); }
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
  const isTeklif  = docType === 'TEKLİF FORMU';
  const tarih     = data.tarih || new Date().toLocaleDateString('tr-TR');
  const isNakit   = data.odemeTipi === 'nakit';
  const isProje   = data.odemeTipi === 'proje';   // ❖ Proje fiyatı
  const isTaksit  = data.odemeTipi === 'taksit';
  // tek_cekim de "nakit gibi" gösterilir, komisyon satırı olmadan

  // ── LOGO ──────────────────────────────────────────────────────
  const originUrl = window.location.origin + window.location.pathname.replace(/[^\/]*$/, '');
  const logoUrl   = originUrl + 'logo.png';
  const logoHTML  = `<img src="${logoUrl}" alt="Aygün AVM"
    style="max-height:52px;width:auto;display:block;"
    onerror="this.outerHTML='<div style=\\'font-size:1.5rem;font-weight:900;color:#D01F2E;\\'>aygün<span style=\\'font-weight:400;color:#475569;\\'> AVM</span></div>'">`;

  // ── TEMEL HESAPLAR ─────────────────────────────────────────────
  const urunler      = data.urunler || [];
  const toplamOdeme  = Number(data.toplamOdeme  || 0);
  const aylikTaksit  = Number(data.aylikTaksit  || 0);
  const taksitSayisi = Number(data.taksitSayisi || 1);
  const kartAdi      = data.kartAdi || 'Kart';

  // Ürün bazlı efektif nakit (❖ proje varsa _projeNakit öncelikli)
  const urunNakitler = urunler.map(u =>
    u._projeNakit !== undefined
      ? Math.max(0, Number(u._projeNakit))
      : Math.max(0, Number(u.nakit || u.fiyat || 0) - Number(u.itemDisc || 0))
  );
  const nakitToplam = urunNakitler.reduce((s,v) => s+v, 0) || toplamOdeme || 1;

  // Her ürünün PDF fiyatı — nakit: kendi değeri, kartlı: oransal dağılım
  const urunFaturaFiyatlari = urunler.map((u, idx) => {
    // Nakit ve ❖ Proje: oransal dağılım yok, her ürünün kendi efektif fiyatı
    if (isNakit || isProje) return urunNakitler[idx];
    // Tek çekim ve taksit: toplamOdeme (komisyon dahil) oransal dağıtılır
    const pay = urunNakitler[idx] / nakitToplam;
    return idx === urunler.length - 1
      ? Math.max(0, toplamOdeme - urunler.slice(0,-1).reduce((s,_,j) => s + Math.round(toplamOdeme*(urunNakitler[j]/nakitToplam)), 0))
      : Math.round(toplamOdeme * pay);
  });

  // ── ÜRÜN SATIRLARI ─────────────────────────────────────────────
  let urunlerHTML = '';
  urunler.forEach((u, i) => {
    // Ürün adı ve marka
    let markaStr = '', urunAdi = u.urun || '—', kampanyaStr = '';
    if (window.allProducts?.length && u.kod) {
      const op = window.allProducts.find(p => p.Kod === u.kod);
      if (op) {
        if (op.Marka && op.Marka !== '-') markaStr = op.Marka + ' ';
        urunAdi = op.Urun || op.urun || u.urun;
      }
    }

    // Kampanya etiketi — seçili pill'lerin etiketi
    const campPills = u.campPills || u.kampanyalar || [];
    const secilenCamp = Array.isArray(campPills)
      ? campPills.filter(c => c.sel && !c.pending).map(c => c.label || c.etiket || c.ad).filter(Boolean)
      : [];
    if (u._projeNakit !== undefined) {
      const _pdfItemLabel = u._projeGrup
        ? (u._projeGrup.replace(/\s+[\d.,[\]\s]+.*$/, '').trim() || '')
        : '';
      secilenCamp.unshift('❖' + (_pdfItemLabel ? ' ' + _pdfItemLabel : ' Proje Fiyatı'));
    }
    if (secilenCamp.length) kampanyaStr = secilenCamp.join(' · ');
    else if (u.kampanya) kampanyaStr = u.kampanya;

    const itemDisc   = u._projeNakit !== undefined ? 0 : Number(u.itemDisc || 0);
    const faturaFiyat = urunFaturaFiyatlari[i];
    const listefiyat  = faturaFiyat + itemDisc;

    let fiyatHTML = '';
    if (itemDisc > 0) {
      fiyatHTML = `
        <div style="text-decoration:line-through;color:#94a3b8;font-size:.78em;line-height:1.2">${fmt(listefiyat)}</div>
        <div style="font-weight:800;color:#15803d;font-size:1em">${fmt(faturaFiyat)}</div>`;
    } else {
      fiyatHTML = `<div style="font-weight:800;color:#0f172a;font-size:1em">${fmt(faturaFiyat)}</div>`;
    }
    if (isTaksit && !isProje && taksitSayisi > 1) {
      // Birim taksit: aşağı yuvarla (Math.floor) — taksit×aylık ≤ birimFiyat garantisi
      // yuvarlaKademe yukarı yuvarlayıp taksit×aylık > fiyat gösterirse müşteri şaşırır
      const aylikHam = faturaFiyat / taksitSayisi;
      // Kademe: 50 altı → 1'e, 50-500 arası → 50'ye, 500+ → 100'e yuvarla (aşağı)
      let aylik;
      if (aylikHam < 50)        aylik = Math.floor(aylikHam);
      else if (aylikHam < 500)  aylik = Math.floor(aylikHam / 50) * 50;
      else                       aylik = Math.floor(aylikHam / 100) * 100;
      fiyatHTML += `<div style="font-size:.72em;color:#7c3aed;margin-top:2px">${taksitSayisi}×${fmt(aylik)}</div>`;
    }

    const zebra = i % 2 === 0 ? '#ffffff' : '#f8fafd';
    urunlerHTML += `
      <tr style="background:${zebra}">
        <td style="padding:12px 8px;text-align:center;color:#94a3b8;font-weight:700;font-size:.82em;width:32px;border-bottom:1px solid #f1f5f9">${i+1}</td>
        <td style="padding:12px 12px;border-bottom:1px solid #f1f5f9">
          <div style="font-weight:600;color:#0f172a;font-size:.92em;line-height:1.35">${markaStr}${urunAdi}</div>
          <div style="font-size:.70em;color:#94a3b8;margin-top:3px;font-family:'DM Mono',monospace">${u.kod||''}</div>
          ${kampanyaStr ? `<div style="font-size:.68em;color:#7c3aed;margin-top:3px;font-weight:600">🏷 ${kampanyaStr}</div>` : ''}
        </td>
        <td style="padding:12px 8px;text-align:center;color:#475569;font-size:.88em;width:36px;border-bottom:1px solid #f1f5f9">${u.adet||1}</td>
        <td style="padding:12px 14px;text-align:right;font-family:'DM Mono',monospace;white-space:nowrap;border-bottom:1px solid #f1f5f9">${fiyatHTML}</td>
      </tr>`;
  });

  // ── ÖDEME ÖZETİ (sadeleştirilmiş) ─────────────────────────────
  // Sadece: Liste Toplamı | Ödeme Şekli | (Taksit Sayısı) | Toplam Ödenecek
  // listeToplam = indirimsiz ham fiyat toplamı (üst satır için)
  const listeToplam = urunler.reduce((s,u) => s + Number(u.nakit||u.fiyat||0), 0);
  // indirimliToplam = urunNakitler toplamı (satır indirimleri düşülmüş)
  const indirimliToplam = urunNakitler.reduce((s,v) => s+v, 0);

  const projeLabel = data.projeLabel || (data.kartAdi && isProje ? data.kartAdi : '') || '';

  let odemeHTML = '';
  if (isProje) {
    // ❖ Proje: Liste Toplamı gösterilmez (nakit fiyatla uyuşmaz, müşteri yanıltılmasın)
    odemeHTML = `
      <tr><td class="rl">Ödeme Şekli</td><td class="rr"><span class="badge-nakit">❖ ${projeLabel}</span></td></tr>
      <tr class="grand-row"><td class="rl">Toplam Ödenecek</td><td class="rr total-amt">${fmt(toplamOdeme)}</td></tr>`;
  } else if (isNakit) {
    const _satirIndStr = (listeToplam - indirimliToplam) > 0
      ? `<tr style="color:#15803d"><td class="rl">Satır İndirimleri</td><td class="rr" style="font-weight:700;color:#15803d">-${fmt(listeToplam - indirimliToplam)}</td></tr>` : '';
    odemeHTML = `
      <tr><td class="rl">Liste Toplamı</td><td class="rr">${fmt(listeToplam)}</td></tr>
      ${_satirIndStr}
      <tr><td class="rl">Ödeme Şekli</td><td class="rr"><span class="badge-nakit">💵 Nakit</span></td></tr>
      <tr class="grand-row"><td class="rl">Toplam Ödenecek</td><td class="rr total-amt">${fmt(toplamOdeme)}</td></tr>`;
  } else if (data.odemeTipi === 'tek_cekim') {
    // Tek çekim: Liste Toplamı gösterilmez (vade farkı yok, müşteri yanıltılmasın)
    odemeHTML = `
      <tr><td class="rl">Ödeme Şekli</td><td class="rr"><span class="badge-kart">💳 ${kartAdi} — Tek Çekim</span></td></tr>
      <tr class="grand-row"><td class="rl">Toplam Ödenecek</td><td class="rr total-amt">${fmt(toplamOdeme)}</td></tr>`;
  } else {
    // Taksit: Liste Toplamı gösterilmez (müşteri "vade farkı var" diye çekinmesin)
    const aylik = aylikTaksit > 0 ? aylikTaksit : yuvarlaKademe(toplamOdeme / taksitSayisi, 1);
    const toplamKontrol = aylik * taksitSayisi;
    odemeHTML = `
      <tr><td class="rl">Ödeme Şekli</td><td class="rr"><span class="badge-taksit">💳 ${kartAdi}</span></td></tr>
      <tr><td class="rl">Taksit Sayısı</td><td class="rr"><strong>${taksitSayisi} Taksit</strong></td></tr>
      <tr style="background:#f5f3ff"><td class="rl" style="color:#7c3aed;font-weight:700">Aylık Taksit</td><td class="rr" style="color:#7c3aed;font-weight:900;font-size:1.1em">${fmt(aylik)}</td></tr>
      <tr class="grand-row"><td class="rl">Toplam Ödenecek</td><td class="rr total-amt">${fmt(toplamKontrol)}</td></tr>`;
  }

  // ── NOT & GEÇERLİLİK ──────────────────────────────────────────
  const sureBitis = data.sureBitis ? new Date(data.sureBitis).toLocaleDateString('tr-TR') : '';
  const notHtml   = data.not ? `
    <div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 10px 10px 0;padding:10px 14px;margin:0 40px 16px">
      <div style="font-size:.62em;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Not</div>
      <div style="font-size:.85em;color:#78350f">${_esc(data.not)}</div>
    </div>` : '';

  // ── FULL HTML ──────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<title>${docType} | Aygün AVM</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:#e8ecf3;color:#0f172a;padding:28px;font-size:14px;line-height:1.5}
  .page{max-width:820px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.13)}

  /* HEADER: üst koyu bant + altta logo beyaz alanı */
  .hdr-top{background:linear-gradient(135deg,#0f172a 0%,#1e293b 70%,#0f2744 100%);padding:22px 40px 18px;display:flex;align-items:center;justify-content:flex-end}
  .hdr-meta{text-align:right}
  .doc-tip{font-size:.58rem;font-weight:800;color:rgba(255,255,255,.4);letter-spacing:.14em;text-transform:uppercase;margin-bottom:4px}
  .doc-no{font-size:1.45rem;font-weight:900;color:#fff;letter-spacing:-.02em;line-height:1}
  .doc-tarih{font-size:.72rem;color:rgba(255,255,255,.5);margin-top:4px}

  /* LOGO BANDI — beyaz zemin */
  .logo-band{background:#fff;padding:16px 40px;border-bottom:1px solid #e8ecf5;display:flex;align-items:center;justify-content:space-between;gap:16px}
  .logo-band .tagline{font-size:.72rem;color:#94a3b8;font-weight:500}

  /* GEÇERLİLİK CHIP */
  .validity-chip{display:inline-flex;align-items:center;gap:6px;background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:8px;padding:5px 11px;font-size:.75rem;font-weight:700}

  /* BİLGİ BANTI */
  .info-band{background:#f8fafd;border-bottom:1px solid #e8ecf5;padding:16px 40px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
  .info-item label{font-size:.58rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;display:block;margin-bottom:2px}
  .info-item span{font-size:.85rem;font-weight:600;color:#1e293b}

  /* BÖLÜM BAŞLIĞI */
  .sec-title{padding:16px 40px 8px;font-size:.60rem;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.1em;display:flex;align-items:center;gap:6px}

  /* TABLO */
  table{width:100%;border-collapse:collapse}
  thead th{background:#0f172a;color:rgba(255,255,255,.45);font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:8px 12px;text-align:left}
  thead th:last-child{text-align:right;padding-right:14px}
  thead th:nth-child(3){text-align:center}
  tbody tr{transition:background .06s}

  /* ÖDEME */
  .odeme-wrap{padding:20px 40px 28px}
  .odeme-table{max-width:380px;margin-left:auto;border:1.5px solid #e2e8f0;border-radius:12px;overflow:hidden}
  .rl{padding:10px 14px;font-size:.83rem;color:#475569;border-bottom:1px solid #f1f5f9;white-space:nowrap}
  .rr{padding:10px 16px;font-size:.83rem;font-weight:600;color:#0f172a;text-align:right;border-bottom:1px solid #f1f5f9;font-family:'DM Mono',monospace;white-space:nowrap}
  .grand-row .rl,.grand-row .rr{border-bottom:none}
  .grand-row .rl{background:#0f172a;color:rgba(255,255,255,.65);font-weight:700;font-size:.88rem}
  .grand-row .rr{background:#0f172a}
  .total-amt{color:#D01F2E!important;font-size:1.15rem!important;font-weight:900!important}
  .badge-nakit{background:#dcfce7;color:#15803d;border-radius:6px;padding:2px 8px;font-size:.78em;font-weight:700}
  .badge-kart{background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:2px 8px;font-size:.78em;font-weight:700}
  .badge-taksit{background:#f5f3ff;color:#7c3aed;border-radius:6px;padding:2px 8px;font-size:.78em;font-weight:700}

  /* KOŞULLAR */
  .kosullar{padding:0 40px 20px}
  .kosul-box{background:#f8fafd;border:1px solid #e8ecf5;border-radius:10px;padding:13px 16px}
  .kosul-box h4{font-size:.62rem;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
  .kosul-box p{font-size:.74rem;color:#64748b;line-height:1.6}

  /* FOOTER */
  .footer{background:#f8fafd;border-top:1px solid #e8ecf5;padding:14px 40px;display:flex;align-items:center;justify-content:space-between;gap:12px}
  .footer-note{font-size:.68rem;color:#94a3b8;line-height:1.45}
  .footer-brand{font-size:.82rem;font-weight:900;color:#D01F2E;white-space:nowrap}

  /* YAZDIR */
  .print-btn{display:flex;justify-content:center;padding:16px 40px 22px}
  .print-btn button{padding:11px 30px;background:linear-gradient(135deg,#D01F2E,#b91c1c);color:#fff;border:none;border-radius:10px;font-size:.88rem;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 4px 14px rgba(208,31,46,.3)}

  @media print{
    body{padding:0;background:#fff}
    .page{box-shadow:none;border-radius:0}
    .print-btn{display:none}
    .hdr-top,.logo-band,.info-band,thead th,.grand-row .rl,.grand-row .rr{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
</style>
</head>
<body>
<div class="page">

  <!-- ÜST KOYU BANT: sadece belge no/tarih -->
  <div class="hdr-top">
    <div class="hdr-meta">
      <div class="doc-tip">${docType}</div>
      <div class="doc-no">#${data.belgeNo || '—'}</div>
      <div class="doc-tarih">📅 ${tarih}</div>
    </div>
  </div>

  <!-- LOGO BANDI: beyaz zemin, logo sol -->
  <div class="logo-band">
    <div>${logoHTML}</div>
    <div class="tagline">Aygün AVM Teknoloji Merkezi</div>
  </div>

  <!-- GEÇERLİLİK (teklif ise) -->
  ${isTeklif && sureBitis ? `<div style="padding:12px 40px 0"><div class="validity-chip">⏰ Teklif Geçerlilik: ${sureBitis} tarihine kadar</div></div>` : ''}

  <!-- BİLGİ BANTI -->
  <div class="info-band">
    <div class="info-item"><label>Müşteri</label><span>${_esc(data.musteriIsim || '—')}</span></div>
    ${data.telefon ? `<div class="info-item"><label>Telefon</label><span>📞 ${_esc(data.telefon)}</span></div>` : ''}
    ${data.musteriTc ? `<div class="info-item"><label>T.C. / Vergi No</label><span>${_esc(data.musteriTc)}</span></div>` : ''}
    ${data.musteriAdres ? `<div class="info-item"><label>Adres</label><span>${_esc(data.musteriAdres)}</span></div>` : ''}
    <div class="info-item"><label>Satış Danışmanı</label><span>👤 ${_esc(data.satici || '—')}</span></div>
  </div>

  <!-- ÜRÜN LİSTESİ -->
  <div class="sec-title">📦 Ürün Listesi</div>
  <table>
    <thead>
      <tr>
        <th style="width:32px;text-align:center">#</th>
        <th>Ürün / Hizmet Tanımı</th>
        <th style="width:36px;text-align:center">Adet</th>
        <th style="text-align:right;padding-right:14px">${isTaksit ? 'Birim Fiyat / Taksit' : 'Birim Fiyat'}</th>
      </tr>
    </thead>
    <tbody>${urunlerHTML}</tbody>
  </table>

  ${notHtml}

  <!-- ÖDEME ÖZETİ -->
  <div class="sec-title">💳 Ödeme Özeti</div>
  <div class="odeme-wrap">
    <table class="odeme-table">
      <tbody>${odemeHTML}</tbody>
    </table>
  </div>

  <!-- KOŞULLAR -->
  <div class="kosullar">
    <div class="kosul-box">
      <h4>Genel Koşullar</h4>
      <p>${isTeklif
        ? 'Bu teklif yukarıda belirtilen geçerlilik tarihine kadar geçerlidir. Stok ve fiyatlar değişkenlik gösterebilir.'
        : 'Ürünlerin teslim alınmasından sonra iade ve değişim koşulları için mağazamızı ziyaret ediniz.'
      } Kampanya ve indirimler birleştirilemez. Aygün AVM tüm hakları saklıdır.</p>
    </div>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-note">Bu belge elektronik olarak oluşturulmuştur. İmza gerektirmez.</div>
    <div class="footer-brand">aygün AVM</div>
  </div>

  <!-- YAZDIR -->
  <div class="print-btn">
    <button onclick="window.print()">🖨 Yazdır / PDF Kaydet</button>
  </div>

</div>
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

  // İndirim hesapları — indirimTip ile doğru alt indirim
  const toplamNakit    = (p.urunler||[]).reduce((s,u) => s + Number(u.nakit||u.fiyat||0), 0);
  const toplamItemDisc = (p.urunler||[]).reduce((s,u) => s + Number(u.itemDisc||0), 0);
  const _indirimTip    = p.indirimTip || 'TRY';
  const _indirimMiktar = Number(p.indirim || 0);
  const toplamAltIndirim = _indirimTip === 'TRY'
    ? _indirimMiktar
    : (toplamNakit - toplamItemDisc) * _indirimMiktar / 100;
  const toplamIndirim  = toplamItemDisc + toplamAltIndirim;           // satır + alt (pazarlık hariç)
  const ekIndirimPdf   = Number(p.ekIndirim || 0);                   // pazarlık
  const nakitNet       = toplamNakit - toplamIndirim - ekIndirimPdf; // tüm indirimler sonrası

  // Ödeme tipi belirle
  let odemeTipi = 'nakit', kartAdi = '', taksitSayisi = 0, aylikTaksit = 0;
  let toplamOdeme = nakitNet;
  if(ab && ab.type === 'proje') {
    // ❖ Proje: her ürünün proje fiyatı toplamını kullan, komisyon/vade farkı yok
    const _projeToplam = (p.urunler||[]).reduce((s,u) =>
      s + (u._projeNakit !== undefined
        ? Math.max(0, Number(u._projeNakit))
        : Math.max(0, Number(u.nakit||u.fiyat||0) - Number(u.itemDisc||0))), 0);
    toplamOdeme = _projeToplam;
    odemeTipi   = 'proje';
    kartAdi     = ab.projeLabel || '';
  } else if(ab) {
    toplamOdeme  = Number(ab.tahsilat) || nakitNet;   // abaküs tahsilatı tek kaynak
    kartAdi      = ab.kart || ab.label || '';
    taksitSayisi = ab.taksit || 1;
    const _taksTaban = taksitSayisi <= 1 ? toplamOdeme : Math.floor(toplamOdeme / taksitSayisi);
    const _taksKalan = taksitSayisi <= 1 ? 0 : (toplamOdeme - _taksTaban * taksitSayisi);
    aylikTaksit  = ab.aylik || (_taksTaban + _taksKalan);
    odemeTipi    = taksitSayisi <= 1 ? 'tek_cekim' : 'taksit';
  }

  // ❖ Proje gerekçesi — sepette proje fiyatlı ürün varsa PDF'e taşı
  const _pdfProjeItems = (p.urunler||[]).filter(u => u._projeNakit !== undefined && u._projeGrup);
  const _pdfProjeLabel = _pdfProjeItems.length > 0
    ? [...new Set(_pdfProjeItems.map(u => (u._projeGrup||'Proje').replace(/\s+[\d.,[\]\s]+.*$/, '').trim()))].join(' · ')
    : '';

  const data = {
    belgeNo:          (p.id||''  ).slice(-8).toUpperCase(),
    tarih:            today,
    gecerlilikTarihi: sureTarih,
    sureBitis:        p.sureBitis || '',   // geçerlilik tarihi raw ISO (PDF validity chip için)
    musteriIsim:      p.custName || '—',
    telefon:          p.phone || '—',
    satici:           (p.user||''  ).split('@')[0],
    not:              p.not || '',
    odemeTipi,
    kartAdi,
    taksitSayisi,
    aylikTaksit,
    toplamOdeme,                                   // nakit: nakitNet, kart: ab.tahsilat
    toplamIndirim,                                 // satır + alt indirim (pazarlık ayrı)
    ekIndirim:    ekIndirimPdf,
    pazarlikNotu: p.pazarlikNotu || '',
    projeLabel:   _pdfProjeLabel,                  // ❖ gerekçe etiketi (boş ise normal)
    urunler:      p.urunler || []
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

function _parseCampSegments(oldAc, newAc) {
  // parseCampaigns ile aynı ayraç mantığını kullan
  // Her segment için özgün metin → normalize edilmiş boşluk ile anahtar
  function toSegList(ac) {
    if (!ac || ac === '-') return [];
    const segs = parseCampaigns(ac);
    // Her segmentin ham metnini normalize et → key olarak kullan
    return segs.map(s => {
      const raw = (s.metin || s.text || '').trim().replace(/\s+/g, ' ');
      return { key: raw.toUpperCase(), raw };
    }).filter(s => s.raw);
  }
  const oldList = toSegList(oldAc);
  const newList = toSegList(newAc);
  const oldMap  = new Map(oldList.map(s => [s.key, s.raw]));
  const newMap  = new Map(newList.map(s => [s.key, s.raw]));
  const eklendi = [], kaldirildi = [], degisti = [];
  newMap.forEach((raw, key) => {
    if (!oldMap.has(key)) eklendi.push(raw);
    else if (oldMap.get(key) !== raw) degisti.push({ old: oldMap.get(key), new: raw });
  });
  oldMap.forEach((raw, key) => { if (!newMap.has(key)) kaldirildi.push(raw); });
  return { eklendi, kaldirildi, degisti };
}

function _diffJson(oldJson, newJson) {
  // İki JSON snapshot arasındaki farkları döndür
  const changes = [];
  if(!oldJson?.data || !Array.isArray(newJson?.data)) return changes;
  newJson.data.forEach(p => {
    const old = (oldJson.data||[]).find(ld => ld.Kod === p.Kod);
    if(!old) return; // yeni ürün — şimdilik atla
    const keys     = Object.keys(p);
    const urunKey  = keys.find(k=>norm(k)==='urun')||'Kod';
    const descKey  = keys.find(k=>norm(k)==='aciklama')||'';
    const bundleKey= keys.find(k=>norm(k)==='bundle')||'';  // Bundle sütunu varsa kamp diff'ten çıkar
    const urunAdi  = p[urunKey]||p.Kod||'?';
    // Nakit fiyat
    const marka=(p['Marka']||p['marka']||'').trim();
    const nv=parseFloat(p['Nakit']), ov=parseFloat(old['Nakit']);
    if(!isNaN(nv)&&!isNaN(ov)&&nv!==ov) {
      const diff=nv-ov, pct=((diff/ov)*100).toFixed(1);
      changes.push({type:'price',urun:urunAdi,field:'Nakit',old:ov,new:nv,diff,pct,marka});
    }
    const ns=Number(p.Stok), os=Number(old.Stok);
    if(!isNaN(ns)&&!isNaN(os)&&ns!==os)
      changes.push({type:'stok',urun:urunAdi,old:os,new:ns,diff:ns-os,marka});
    // Açıklama kampanya diff — Bundle sütunu ayrı yönetiliyorsa Açıklama'daki ⤚ satırlarını atla
    if(descKey && p[descKey]!==old[descKey]) {
      const oldAc = old[descKey]||'', newAc = p[descKey]||'';
      // Eğer her iki değer de yalnızca ⤚ bundle etiketi içeriyorsa → Bundle sütunu henüz yokken
      // Açıklama'ya yazılmış; bundle metaveri değişimi kampanya değişimi sayılmaz
      const isBundleOnly = s => !s || s.trim().startsWith('⤚');
      if(!(isBundleOnly(oldAc) && isBundleOnly(newAc))) {
        const segs=_parseCampSegments(oldAc, newAc);
        segs.kaldirildi.forEach(seg=>changes.push({type:'kamp_kaldirildi',urun:urunAdi,seg,marka}));
        segs.eklendi.forEach(seg=>changes.push({type:'kamp_eklendi',urun:urunAdi,seg,marka}));
        segs.degisti.forEach(d=>changes.push({type:'kamp_degisti',urun:urunAdi,segOld:d.old,seg:d.new,marka}));
      }
    }
    // Bundle sütunu değişimleri hiçbir zaman kampanya diff'i tetiklemez
    // (Bundle sütunu yönetim aracı — bilgi amaçlı değil, karşılama ekranı logic'i)
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
  return type==='price'||type==='kamp_eklendi'||type==='kamp_kaldirildi'||type==='kamp_degisti';
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

  const kampKal=m.kamp_kaldirildi||[], kampEk=m.kamp_eklendi||[], kampDeg=m.kamp_degisti||[];
  const hasKamp=!!(kampKal.length||kampEk.length||kampDeg.length);
  const _emoji = hasPrice?(m.price.diff>0?'📈':'📉'):hasKamp?'📋':'📦';
  let _badges='';
  if(hasPrice){const up=m.price.diff>0,sign=up?'+':'';_badges+=`<span class="change-badge ${up?'badge-price-up':'badge-price-down'}">${sign}${m.price.pct}%</span>`;}
  if(kampEk.length)  _badges+=`<span class="change-badge badge-kamp-eklendi">+${kampEk.length} Kampanya</span>`;
  if(kampKal.length) _badges+=`<span class="change-badge badge-kamp-kaldirildi">-${kampKal.length} Kampanya</span>`;
  if(kampDeg.length) _badges+=`<span class="change-badge badge-kamp-degisti">±${kampDeg.length} Kampanya</span>`;
  if(hasStok){const up=m.stok.diff>0;_badges+=`<span class="change-badge ${up?'badge-stok-up':'badge-stok-down'}">Stok ${up?'+':''}${m.stok.diff}</span>`;}
  let details = '';
  if(hasPrice) details+=`<span class="ci-row">Nakit: ${fmt(m.price.old)} → <strong>${fmt(m.price.new)}</strong></span>`;
  kampKal.forEach(c=>{details+=`<span class="ci-row ci-kamp-kaldirildi">➖ <s>${c.seg}</s></span>`;});
  kampEk.forEach(c=>{details+=`<span class="ci-row ci-kamp-eklendi">+ ${c.seg}</span>`;});
  kampDeg.forEach(c=>{details+=`<span class="ci-row ci-kamp-degisti">🔄 <s style="opacity:.5">${c.segOld}</s> → <strong>${c.seg}</strong></span>`;});
  const mandCls  = isRequired ? 'change-item-mandatory' : 'change-item-readonly';
  const clickEvt = isRequired ? 'onclick="toggleChangeItemRow(this)"' : '';
  const readTag  = isRequired ? '' : '<span class="ci-read-tag" title="Okumak yeterli">📖</span>';
  return `<div class="change-item ${mandCls}" data-idx="${idx}" ${clickEvt}>
    <span class="ci-emoji">${_emoji}</span>
    <div class="ci-body">
      <span class="ci-urun">${m.urun}</span>
      <span class="ci-detail">${details}</span>
    </div>
    <div class="ci-badges">${_badges}${readTag}</div>
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

  // ── Istisna (marka) filtresi ──────────────────────────────
  const istisnalar = (!isAdmin() ? (currentUser?.Istisna||'') : '')
    .split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  function _markaGizli(c) {
    if(!istisnalar.length) return false;
    const mk=(c.marka||'').trim().toLowerCase();
    if(!mk) return false;
    // Tam eşleşme VEYA marka adı istisna kelimesini içeriyor mu
    // (örn: ist="samsung", mk="samsung" → true)
    return istisnalar.some(ist => mk === ist || mk.includes(ist) || ist.includes(mk));
  }

  const verItems  = changes.filter(c=>c.type==='versiyon'&&!c.isOld);
  const stokTumu  = changes.filter(c=>c.type==='stok'&&!c.isOld);
  const optItems  = changes.filter(c=>c.type!=='versiyon'&&!c.isOld&&!_isMandatory(c.type)&&c.type!=='stok');
  const mandItems = changes.filter(c=>c.type!=='versiyon'&&!c.isOld&&_isMandatory(c.type)&&!_markaGizli(c));

  let html = '';

  // ── BÖLÜM 1: Bilgi Amaçlı ─────────────────────────────────
  const lowItems  = [...verItems, ...stokTumu];

  if(stokTumu.length || verItems.length) {
    const firstVer = verItems.length ? verItems[0] : null;
    const lastVer  = verItems.length ? verItems[verItems.length-1] : null;
    let verRangeStr = '';
    if(firstVer && lastVer && firstVer !== lastVer) verRangeStr = firstVer.from + ' → ' + lastVer.to;
    else if(firstVer) verRangeStr = firstVer.from + ' → ' + firstVer.to;

    // Stokları düz metin listesi olarak göster
    let stokListHtml = '';
    stokTumu.forEach(c => {
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
          <div class="sh-sub">${verRangeStr ? verRangeStr + ' · ' : ''}${stokTumu.length} stok güncellendi</div>
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
      const key=c.urun||c.new||'?';
      if(!mergedMap.has(key)) mergedMap.set(key,{urun:key,price:null,stok:null,kamp_eklendi:[],kamp_kaldirildi:[],kamp_degisti:[]});
      const m=mergedMap.get(key);
      if(c.type==='price')           m.price=c;
      if(c.type==='stok')            m.stok=c;
      if(c.type==='kamp_eklendi')    m.kamp_eklendi.push(c);
      if(c.type==='kamp_kaldirildi') m.kamp_kaldirildi.push(c);
      if(c.type==='kamp_degisti')    m.kamp_degisti.push(c);
    });
    const mergedItems = Array.from(mergedMap.values());

    // %5 seçim (satış kullanıcısı) — en az 1, her zaman EN SON eleman zorunlu
    let randomSelected = null;
    let requiredCount  = mergedItems.length;
    if(isSatisUser && mergedItems.length > 1) {
      requiredCount = Math.max(1, Math.ceil(mergedItems.length * 0.05));
      // En son ürünü her zaman zorunlu yap (en alta inmeden geçemesin)
      const idxs = [...Array(mergedItems.length - 1).keys()].sort(() => Math.random() - 0.5);
      const selected = new Set(idxs.slice(0, requiredCount - 1));
      selected.add(mergedItems.length - 1); // son eleman her zaman zorunlu
      randomSelected = selected;
    } else if(isAdmin()) {
      // Admin: hiçbir satır tek tek zorunlu değil — "Tümünü Onayla" yeterli
      randomSelected = new Set(); // boş set → hiç satır zorunlu değil
    }

    const subLabel = isAdmin()
      ? `${mergedItems.length} değişim — Tümünü Onayla ile geçin`
      : `${requiredCount} tanesini onaylayın (en az %5)`;

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


// ─── SEPET LOGLAMA (Firebase sepet_loglari) ─────────────────────
// Firebase ücretsiz plan uyumlu: günde ~500 yazma, koleksiyon hafif tutulur
async function logSepet(islem, tutar, urunAdi) {
  if (!currentUser || !_db) return;
  try {
    await addDoc(collection(_db, 'sepet_loglari'), {
      personelId:  currentUser.Email,
      personelAd:  currentUser.Ad || currentUser.Email.split('@')[0],
      ts:          serverTimestamp(),
      islem,
      tutar:        tutar || 0,
      urun:         urunAdi || null,
      sepetAdet:    basket.length,
      tarih:        new Date().toISOString().split('T')[0],
      magazaTipi:   getMagazaTipi(),
      sepetTipi:    getSepetTipi()
    });
  } catch(e) { console.warn('logSepet:', e); }
}
// ─── SATIŞ HUNİSİ (Sales Funnel) ───────────────────────────────
// Müşteri oturumu sonucunu Firebase'e kaydet
// ─── FLOATING FEEDBACK BAR ──────────────────────────────────────
// Abaküs kapatılınca veya teklif tamamlanınca ekranda kalıcı bar çıkar.
// Kullanıcı seçim yapmadan bar kaybolmaz (sadece ✕ ile kapatılır → belirsiz kalır).
// Admin'de gösterilmez.

let _floatingBarActive = false;

function _showFloatingFeedback() {
  // Admin için floating bar yok
  if (isAdmin()) return;
  // Sepet boşsa gösterme (zaten clearBasket akışı var)
  if (!basket.length) return;
  // Zaten aktifse tekrar oluşturma
  if (_floatingBarActive) return;
  _floatingBarActive = true;

  // Mevcut bar varsa kaldır
  document.getElementById('_float-feedback')?.remove();

  const bar = document.createElement('div');
  bar.id = '_float-feedback';
  bar.style.cssText = [
    'position:fixed', 'bottom:0', 'left:0', 'right:0',
    'z-index:9998',
    'background:#0f172a',
    'color:#fff',
    'padding:14px 16px calc(14px + env(safe-area-inset-bottom,0px))',
    'display:flex', 'align-items:center', 'gap:10px',
    'box-shadow:0 -4px 24px rgba(0,0,0,0.35)',
    'animation:slideUpFeed .3s cubic-bezier(.16,1,.3,1)',
    'font-family:inherit'
  ].join(';');

  bar.innerHTML = `
    <div style="flex:1;font-size:.76rem;font-weight:600;color:rgba(255,255,255,.75)">
      Bu müşteri nasıl sonuçlandı?
    </div>
    <button onclick="_feedbackSelect('satis')"
      style="padding:9px 16px;background:#16a34a;color:#fff;border:none;border-radius:10px;
        font-family:inherit;font-size:.76rem;font-weight:800;cursor:pointer;
        transition:filter .12s;flex-shrink:0">
      ✅ Satıldı
    </button>
    <button onclick="_feedbackSelect('kacti')"
      style="padding:9px 16px;background:#dc2626;color:#fff;border:none;border-radius:10px;
        font-family:inherit;font-size:.76rem;font-weight:800;cursor:pointer;
        transition:filter .12s;flex-shrink:0">
      ❌ Kaçtı
    </button>
    <button onclick="_feedbackDismiss()"
      style="padding:9px 14px;background:rgba(255,255,255,.10);color:rgba(255,255,255,.7);
        border:1px solid rgba(255,255,255,.18);border-radius:10px;font-size:.72rem;font-weight:600;
        cursor:pointer;flex-shrink:0;font-family:inherit;white-space:nowrap">
      ← Sepete Dön
    </button>
  `;

  // Animasyon CSS (bir kez eklenir)
  if (!document.getElementById('_feed-css')) {
    const st = document.createElement('style');
    st.id = '_feed-css';
    st.textContent = `
      @keyframes slideUpFeed {
        from { transform:translateY(100%); opacity:0; }
        to   { transform:translateY(0);    opacity:1; }
      }
    `;
    document.head.appendChild(st);
  }

  document.body.appendChild(bar);
}

async function _feedbackSelect(sonuc) {
  // Bar'ı kapat
  _floatingBarActive = false;
  document.getElementById('_float-feedback')?.remove();
  if (sonuc === 'satis') {
    if (_intentLevel < 4) _intentLevel = 4;
    incrementDailyStat('satis_sayisi', 1).catch(() => {});
    await logSessionResult('satis', 'Floating bar - Satis');
    _doClearBasket();
    return;
  }

  // 'kacti' → ayPrompt yerine 4 butonlu neden paneli göster
  _showNedenPanel();
}

// 4 butonlu neden paneli — floating bar'ın devamı
function _showNedenPanel() {
  document.getElementById('_neden-panel')?.remove();

  const nedenler = [
    { ikon: '💸', metin: 'Fiyat Pahalı' },
    { ikon: '💳', metin: 'Taksit Uygun Değil' },
    { ikon: 'ℹ️', metin: 'Sadece Bilgi Aldı' },
    { ikon: '🤔', metin: 'Düşünmek İstiyor' }
  ];

  const panel = document.createElement('div');
  panel.id = '_neden-panel';
  panel.style.cssText = [
    'position:fixed', 'bottom:0', 'left:0', 'right:0',
    'z-index:9999',
    'background:#0f172a',
    'padding:14px 16px calc(14px + env(safe-area-inset-bottom,0px))',
    'box-shadow:0 -4px 24px rgba(0,0,0,0.4)',
    'animation:slideUpFeed .25s cubic-bezier(.16,1,.3,1)',
    'font-family:inherit'
  ].join(';');

  const btnsHTML = nedenler.map(n =>
    '<button onclick="_nedenSec(&apos;' + n.metin + '&apos;)" style="' +
      'flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;' +
      'padding:10px 6px;background:rgba(255,255,255,.08);color:#fff;border:1.5px solid rgba(255,255,255,.15);' +
      'border-radius:12px;font-family:inherit;font-size:.66rem;font-weight:700;cursor:pointer;' +
      'transition:background .12s;min-width:0">' +
      '<span style="font-size:1.2rem">' + n.ikon + '</span>' +
      '<span style="text-align:center;line-height:1.2">' + n.metin + '</span>' +
    '</button>'
  ).join('');

  panel.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
      '<span style="font-size:.72rem;font-weight:700;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.06em">Neden kaçtı?</span>' +
      '<button onclick="_nedenSec(\'\')" style="background:rgba(255,255,255,.1);border:none;color:rgba(255,255,255,.5);' +
        'border-radius:50%;width:26px;height:26px;font-size:.72rem;cursor:pointer;font-family:inherit">✕</button>' +
    '</div>' +
    '<div style="display:flex;gap:8px">' + btnsHTML + '</div>';

  document.body.appendChild(panel);
}

async function _nedenSec(neden) {
  document.getElementById('_neden-panel')?.remove();
  await logSessionResult('kacti', neden);
  _doClearBasket();
}

function _feedbackDismiss() {
  _floatingBarActive = false;
  document.getElementById('_float-feedback')?.remove();
  // Seçim yapılmadı → sonuç 'belirsiz' olarak kalır, kaçtı SAYILMAZ
  // intentLevel ve diğer veriler funnel_logs'a gitmez
  console.log('📊 Floating bar kapatıldı — sonuç belirsiz kaldı');
}

async function logSessionResult(sonuc, neden) {
  if (!currentUser || !_db) return;
  // Sepet boşsa ama blur açıldıysa: 'kacti' loglanabilir
  // Sepet boşsa ve blur da yoksa: hiç loglama
  const _blurCount = Object.keys(_sessionData.blurUrunler||{}).length;

  if (basket.length === 0 && sonuc !== 'kacti') return;
  if (basket.length === 0 && sonuc === 'kacti' && _blurCount === 0) return; // blur yoksa anlamsız

  // localStorage'dan güncel session datasını al (kaçış korumasında yazdık)
  try { const sd = JSON.parse(localStorage.getItem('_sd')||'{}');
    if (sd.searches)       _sessionData.searches       = sd.searches;
    if (sd.revealedPrices) _sessionData.revealedPrices = sd.revealedPrices;
  } catch(e) {}

  // toplamTutar: sepetten hesapla; sepet boşsa blurUrunler üzerinden allProducts'tan tahmini değer topla
  let toplamTutar = basket.reduce((s,i)=>s+(i.nakit-(i.itemDisc||0)),0);
  if (toplamTutar === 0 && sonuc === 'kacti' && Object.keys(_sessionData.blurUrunler||{}).length > 0) {
    // Blur açılan ürünlerin nakit fiyatlarını topla (kayıp potansiyeli tahmini)
    Object.keys(_sessionData.blurUrunler).forEach(urunAdi => {
      const p = (window._cachedUrunler || allProducts).find(pr => {
        const k = Object.keys(pr).find(kk => (kk||'').toLowerCase() === 'urun');
        return k && pr[k] === urunAdi;
      });
      if (p) toplamTutar += parseFloat(p.Nakit || p.nakit || 0);
    });
  }
  const sure = _sessionData.startTime ? Math.round((Date.now()-_sessionData.startTime)/1000) : 0;

  // ✅ DÜZELTİLMİŞ KISIM: Sepet kategorisi (Bundle puanlama)
  // Artık ürün çeşitliliğine (benzersiz ürün sayısı) göre puanlama yapılıyor
  // Aynı üründen 3 tane eklemek "Altın" sayılmaz, farklı ürünler gerekir
  const benzersizUrunSayisi = new Set(basket.map(i => i.urun)).size;
  const sepetKategorisi = benzersizUrunSayisi >= 3 ? 'Altin' : 
                          benzersizUrunSayisi === 2 ? 'Gumus' : 'Standart';
  
  // Eski kod için referans: const sepetDerini = basket.length;
  // Not: "derinlik" alanına hala toplam ürün adedi yazılıyor (istatistik için)
  const sepetDerini = basket.length;

  // Bundle kontrolü — açıklamalı ürün var mı? (Bu kısım değişmedi)
  const bundleUrunler = basket.filter(i => {
    const urun = allProducts.find(p=>p.Kod===i.kod);
    const ac   = (urun?.Aciklama || i.aciklama || '').toLowerCase();
    return ac && ac !== '-' && ac !== 'nan' && ac.trim() !== '';
  });
  const bundleVarMi   = bundleUrunler.length > 0;
  const bundleYapildi = bundleVarMi && benzersizUrunSayisi > 1;  // ✅ bundle kontrolü de benzersiz sayıya göre

  // ✅ DÜZELTİLMİŞ: funnelRol - admin kendi kategorisinde
  let funnelRol = 'saha';
  if (currentUser.Rol === 'satis') funnelRol = 'saha';
  else if (currentUser.Rol === 'destek') funnelRol = 'destek';
  else if (currentUser.Rol === 'admin') funnelRol = 'admin';
  else funnelRol = 'saha';

  try {
    // UTC+3 (Europe/Istanbul) formatında tarih/saat hesapla
    // İstanbul saatini Intl.DateTimeFormat ile kesin hesapla
    // toLocaleString('en-US') bazı ortamlarda yanlış olabilir
    const _now = new Date();
    const _dtf = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short',
      hour12: false
    });
    const _parts = Object.fromEntries(
      _dtf.formatToParts(_now)
        .filter(p => p.type !== 'literal')
        .map(p => [p.type, p.value])
    );
    const _tarih = _parts.year + '-' + _parts.month + '-' + _parts.day;
    // weekday kısa Türkçe → sayıya çevir (Paz=0 Pzt=1 ... Cts=6)
    const _weekdayMap = {'Paz':0,'Pzt':1,'Sal':2,'Çar':3,'Per':4,'Cum':5,'Cmt':6};
    const _gun  = _weekdayMap[_parts.weekday] ?? _now.getDay();
    const _saat = parseInt(_parts.hour, 10); // 0-23 İstanbul saati

    await addDoc(collection(_db, 'funnel_logs'), {
      personelId:      currentUser.Email,
      personelAd:      currentUser.Ad || currentUser.Email.split('@')[0],
      funnelRol:       funnelRol,
      magazaTipi:      getMagazaTipi(),
      sepetTipi:       getSepetTipi(),
      ts:              serverTimestamp(),
      tarih:           _tarih,
      gun:             _gun,
      saat:            _saat,
      sonuc,
      neden:           neden || '',
      derinlik:        sepetDerini,           // Toplam ürün adedi (istatistik için)
      benzersizUrun:   benzersizUrunSayisi,   // ✅ YENİ: Benzersiz ürün sayısı
      sepetKategorisi,                         // 'Altin' | 'Gumus' | 'Standart' (artık çeşitliliğe göre)
      toplamTutar,
      sure,
      sepetAcikKaldi:  sure > 1800,
      bundleVarMi,
      bundleYapildi,
      // Intent Scoring
      intentLevel:        _intentLevel,   // 1:blur 2:blur+sepet 3:abakus 4:teklif
      benzersizBlurSayisi: Object.keys(_sessionData.blurUrunler || {}).length,

      bakilanFiyatlar: _sessionData.revealedPrices || [],
      aramalar:        _sessionData.searches       || [],
      zincir:          abakusSelection?.zincir || null,
      kart:            abakusSelection?.kart   || null,
      taksit:          abakusSelection?.taksit || null,
      indirimVarMi:    discountAmount > 0 || basket.some(i=>i.itemDisc>0),
      ekIndirim:       abakusSelection?.ekIndirim || 0,
      pazarlikNotu:    (document.getElementById('ab-pazarlik-notu')?.value || '').trim(),
      urunler:         basket.map(i=>({urun:i.urun,nakit:i.nakit,itemDisc:i.itemDisc||0})),

      // ── Gam Bazlı Analiz Alanları ─────────────────────────────
      // Sepete eklenen ürün adları
      sepeteEklenenUrunler: basket.map(i => i.urun),

      // Fiyatı sorulup sepete eklenmeyen ürünler
      // (blur açıldı ama sepette yok)
      alinmayanUrunler: (_sessionData.revealedPrices || []).filter(
        u => !basket.some(b => b.urun === u)
      ),

      // Gam bazlı özet { 'Klima': { sorulan:3, alinan:1 }, ... }
      // Ürün ısı haritası için blur verisi — ürün odağı
      // gamAnaliz kaldırıldı: ürün bazlı analiz daha doğru
      blurUrunListesi: Object.keys(_sessionData.blurUrunler || {})
    });
  } catch(e) { console.warn('logSessionResult:', e); }
}

function logAnalytics(action, detail) {
  if(!currentUser) return;
  const today = new Date().toISOString().split('T')[0];
  const email = currentUser.Email;
  const local = JSON.parse(localStorage.getItem('analytics_local')||'{}');
  if(!local[today]) local[today] = {};
  if(!local[today][email]) local[today][email] = {
    logins: 0, proposals: 0, basketAdds: 0, sales: 0, products: {},
    basketSessions: 0,
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
  if(action === 'basketSession') {
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
    await setDoc(doc(_db, 'analytics', docId), { email, date: today, magazaTipi: getMagazaTipi(), sepetTipi: getSepetTipi(), ...rec }, { merge: true });
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
        basketSessions: (fbRec.basketSessions || 0) + (existing.basketSessions || 0),
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


// ─── SEPET ANALİZ (Özet Panel İçin Kompakt Versiyon) ─────────────
let _ayHourlyChart = null, _ayDailyChart = null;

async function loadSepetAnaliz() {
  const cont = document.getElementById('analiz-konteynir');
  if (!cont) return;
  cont.innerHTML = '<div class="admin-empty" style="padding:12px">⏳ Analiz yükleniyor…</div>';

  try {
    // Son 30 günlük funnel_logs çek (blur + sepet + sonuç birleşik)
    const sinir = new Date(Date.now() - 30 * 86400000);
    const snap  = await getDocs(query(collection(_db,'funnel_logs'), where('ts','>=',sinir), orderBy('ts','desc'), limit(500)));
    const logs  = []; snap.forEach(d => logs.push(d.data()));

    // fiyat_bakislari — blur açılış saatleri
    const blurSnap = await getDocs(collection(_db,'fiyat_bakislari'));
    const blurKayitlar = []; blurSnap.forEach(d => blurKayitlar.push(d.data()));

    if (!logs.length && !blurKayitlar.length) {
      cont.innerHTML = '<div class="admin-empty" style="padding:16px">📭 Henüz veri yok.</div>';
      return;
    }

    // ── Saatlik yoğunluk: Sepet (satis+kacti) vs Blur (sadece fiyat)
    const saatSepet = Array(24).fill(0);
    const saatKacti = Array(24).fill(0);
    const saatSatis = Array(24).fill(0);
    logs.forEach(l => {
      const h = l.saat ?? (l.ts?.toDate ? l.ts.toDate().getHours() : -1);
      if (h < 0) return;
      saatSepet[h]++;
      if (l.sonuc === 'kacti' || l.sonuc === 'Kacti') saatKacti[h]++;
      if (l.sonuc === 'satis' || l.sonuc === 'Satis') saatSatis[h]++;
    });

    // Blur oturumları — anlık fiyat_bakislari koleksiyonundan
    // (Her personel için son güncelleme saatini al)
    const saatBlur = Array(24).fill(0);
    blurKayitlar.forEach(b => {
      if (b.lastSeen?.toDate) saatBlur[b.lastSeen.toDate().getHours()]++;
    });

    // ── KPI'lar
    const totN  = logs.length;
    const totS  = logs.filter(l => l.sonuc==='satis'||l.sonuc==='Satis').length;
    const totK  = logs.filter(l => l.sonuc==='kacti'||l.sonuc==='Kacti').length;
    const totB  = blurKayitlar.length;
    const donusum = totN === 0 ? 0 : ((totS/totN)*100).toFixed(1);
    const kactiOrani = totN === 0 ? 0 : ((totK/totN)*100).toFixed(1);

    // En yoğun saat (sepet)
    const enSaat = saatSepet.indexOf(Math.max(...saatSepet));
    const enBlurSaat = saatBlur.indexOf(Math.max(...saatBlur,0));

    // ── Saatlik harita — CSS bar (Chart.js gerektirmez, daha hafif)
    const saatMax = Math.max(...saatSepet.map((v,h) => v + saatBlur[h]), 1);
    const saatHtml = [...Array(24).keys()].map(h => {
      const topSepet = saatSepet[h];
      const topBlur  = saatBlur[h];
      const wS = Math.round(topSepet / saatMax * 100);
      const wB = Math.round(topBlur  / saatMax * 100);
      const wSatis = topSepet===0?0:Math.round(saatSatis[h]/topSepet*wS);
      const wKacti = Math.max(0, wS - wSatis);
      return `<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;font-size:.58rem">
        <span style="min-width:24px;color:var(--text-3);text-align:right">${h<10?'0'+h:h}</span>
        <div style="flex:1;height:11px;border-radius:5px;overflow:hidden;background:#f1f5f9;display:flex">
          <div style="width:${wSatis}%;background:#16a34a;height:100%"></div>
          <div style="width:${wKacti}%;background:#dc2626;height:100%"></div>
          <div style="width:${wB}%;background:#f59e0b55;height:100%"></div>
        </div>
        <span style="min-width:14px;color:var(--text-3);font-size:.54rem">${topSepet+topBlur||''}</span>
      </div>`;
    }).join('');

    // ── Blur → Sepet Dönüşüm (kaç blur açılıp sonra sepete eklendi?)
    let blurSepet = 0, blurKacti = 0;
    logs.forEach(l => {
      if ((l.bakilanFiyatlar||[]).length > 0) {
        if (l.sonuc==='satis'||l.sonuc==='Satis') blurSepet++;
        if (l.sonuc==='kacti'||l.sonuc==='Kacti') blurKacti++;
      }
    });

    cont.innerHTML = `
      <!-- KPI'lar -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:8px 10px 10px;border-bottom:1px solid var(--border)">
        <div style="text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#16a34a">${totS}</div>
          <div style="font-size:.58rem;color:var(--text-3)">Satış</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#dc2626">${totK}</div>
          <div style="font-size:.58rem;color:var(--text-3)">Kaçan</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#2563eb">${donusum}%</div>
          <div style="font-size:.58rem;color:var(--text-3)">Dönüşüm</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#f59e0b">${totB}</div>
          <div style="font-size:.58rem;color:var(--text-3)">Blur Otur.</div>
        </div>
      </div>

      <!-- Blur → Sepet dönüşüm özeti -->
      <div style="padding:6px 10px 8px;border-bottom:1px solid var(--border);font-size:.68rem;display:flex;gap:8px;flex-wrap:wrap">
        <span style="background:#f0fdf4;border-radius:6px;padding:3px 8px;color:#16a34a;font-weight:700">
          👁→🛒 ${blurSepet} satış (fiyat baktı, aldı)
        </span>
        <span style="background:#fef2f2;border-radius:6px;padding:3px 8px;color:#dc2626;font-weight:700">
          👁→❌ ${blurKacti} kaçan (fiyat baktı, gitti)
        </span>
        <span style="background:#fffbeb;border-radius:6px;padding:3px 8px;color:#92400e;font-weight:700">
          👁 ${totB} aktif blur oturumu
        </span>
      </div>

      <!-- Saatlik harita -->
      <div style="padding:8px 10px 4px">
        <div style="font-size:.62rem;font-weight:700;color:var(--text-3);margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em">📊 Operasyonel İş Yükü (Aktivite)</div>
        <div style="font-size:.56rem;color:var(--text-3);margin-bottom:5px">Mağazadaki aktivite — fiyat sorgulama ve sepet hareketleri</div>
        <div style="display:flex;gap:8px;font-size:.58rem;margin-bottom:5px">
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#16a34a;margin-right:2px"></span>Satış</span>
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#dc2626;margin-right:2px"></span>Kaçan</span>
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#f59e0b55;border:1px solid #f59e0b;margin-right:2px"></span>Blur</span>
        </div>
        ${saatHtml}
        <div style="font-size:.6rem;color:var(--text-3);margin-top:6px">
          En yoğun saat: <b>${enSaat}:00</b> · En çok blur: <b>${enBlurSaat}:00</b>
        </div>
      </div>
    `;

    // EventBus: analiz güncellendi
    EventBus.emit(EV.UI_REFRESH, { panel: 'sepetAnaliz' });

  } catch (e) {
    console.error('loadSepetAnaliz:', e);
    cont.innerHTML = `<div class="admin-empty" style="padding:12px;color:#dc2626">⚠️ Veri çekilemedi: ${e.message}</div>`;
  }
}

// EventBus tarafından tetiklenen hafif yenileme (Chart gerektirmez)
function _renderSepetAnalizHeatmap() {
  const cont = document.getElementById('analiz-konteynir');
  if (!cont) return;
  loadSepetAnaliz(); // debounce opsiyonel
}

function _analGetHourly(logs) {
  const h = Array(24).fill(0);
  logs.forEach(l => { if (l.ts && l.islem !== 'terk') { const hour = l.ts.toDate ? l.ts.toDate().getHours() : new Date(l.ts).getHours(); h[hour]++; } });
  return h;
}
function _analGetDaily(logs) {
  const days = Array(7).fill(0);
  const names = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  logs.forEach(l => { if (l.ts && l.islem !== 'terk') { const d = l.ts.toDate ? l.ts.toDate().getDay() : new Date(l.ts).getDay(); days[d]++; } });
  return { days, names };
}
function _analGetPersonel(logs) {
  const map = {};
  logs.forEach(l => {
    if (!l.personelId) return;
    if (!map[l.personelId]) map[l.personelId] = { ad: l.personelAd || l.personelId.split('@')[0], ekle: 0, cikar: 0, terk: 0 };
    if (l.islem === 'ekle') map[l.personelId].ekle++;
    if (l.islem === 'cikar') map[l.personelId].cikar++;
    if (l.islem === 'terk') map[l.personelId].terk++;
  });
  return map;
}
function _analGetAbandon(logs) {
  let ekle = 0, terk = 0;
  logs.forEach(l => { if (l.islem === 'ekle') ekle++; if (l.islem === 'terk') terk++; });
  return ekle === 0 ? '0.0' : ((terk / ekle) * 100).toFixed(1);
}
function _analRenderHourly(hours) {
  const ctx = document.getElementById('ayHourlyChart')?.getContext('2d');
  if (!ctx) return;
  if (_ayHourlyChart) { _ayHourlyChart.destroy(); _ayHourlyChart = null; }
  _ayHourlyChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: [...Array(24).keys()].map(h => (h < 10 ? '0' : '') + h + ':00'), datasets: [{ label: 'Sepet', data: hours, backgroundColor: 'rgba(208,31,46,.6)', borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 } } }, x: { ticks: { font: { size: 8 }, maxRotation: 45 } } } }
  });
}
function _analRenderDaily(daily) {
  const ctx = document.getElementById('ayDailyChart')?.getContext('2d');
  if (!ctx) return;
  if (_ayDailyChart) { _ayDailyChart.destroy(); _ayDailyChart = null; }
  _ayDailyChart = new Chart(ctx, {
    type: 'line',
    data: { labels: daily.names, datasets: [{ label: 'Haftalık', data: daily.days, borderColor: '#D01F2E', backgroundColor: 'rgba(208,31,46,.08)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#D01F2E' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 9 } } }, x: { ticks: { font: { size: 9 } } } } }
  });
}

// ✅ YENİ: Funnel filtreleme için yardımcı fonksiyon (global)
// ✅ YENİ: Funnel filtreleme için yardımcı fonksiyon (global)
window.setFunnelFilter = function(filter) {
  const cont = document.getElementById('funnel-analiz-konteynir');
  if (cont) cont.dataset.funnelFiltre = filter;
  document.querySelectorAll('.funnel-filter-btn').forEach(btn => {
    const isActive = btn.dataset.filter === filter;
    btn.style.borderColor = isActive ? 'var(--red)' : 'var(--border)';
    btn.style.background  = isActive ? 'var(--red)' : 'var(--surface)';
    btn.style.color       = isActive ? '#fff' : 'var(--text-2)';
  });
  if (typeof loadFunnelAnaliz === 'function') loadFunnelAnaliz(null, true);
};

window.setMagazaFiltre = function(filtre) {
  const cont = document.getElementById('funnel-analiz-konteynir');
  if (cont) cont.dataset.magazaFiltre = filtre;
  document.querySelectorAll('.magaza-filter-btn').forEach(btn => {
    const isActive = btn.dataset.magaza === filtre;
    btn.style.borderColor = isActive ? '#2563eb' : 'var(--border)';
    btn.style.background  = isActive ? '#2563eb' : 'var(--surface)';
    btn.style.color       = isActive ? '#fff' : 'var(--text-2)';
  });
  if (typeof loadFunnelAnaliz === 'function') loadFunnelAnaliz(null, true);
};

// Tarih aralığı hızlı seçim
window.setTarihAralik = function(tip) {
  const cont = document.getElementById('funnel-analiz-konteynir');
  if (!cont) return;
  const bugun = new Date();
  let bas, bit;
  if (tip === 'bugun') {
    bas = new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate());
    bit = new Date(bas); bit.setDate(bit.getDate() + 1);
  } else if (tip === 'hafta') {
    bas = new Date(bugun); bas.setDate(bugun.getDate() - 6);
    bas = new Date(bas.getFullYear(), bas.getMonth(), bas.getDate());
    bit = new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate() + 1);
  } else if (tip === '30') {
    bas = new Date(bugun); bas.setDate(bugun.getDate() - 29);
    bas = new Date(bas.getFullYear(), bas.getMonth(), bas.getDate());
    bit = new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate() + 1);
  } else if (tip === '90') {
    bas = new Date(bugun); bas.setDate(bugun.getDate() - 89);
    bas = new Date(bas.getFullYear(), bas.getMonth(), bas.getDate());
    bit = new Date(bugun.getFullYear(), bugun.getMonth(), bugun.getDate() + 1);
  }
  if (bas && bit) {
    const basStr = bas.toISOString().slice(0,10);
    // Firebase sorgusu için bit+1 kullanılır; görüntü ve input için bugün
    const bitGosterim = new Date(bit.getTime() - 86400000).toISOString().slice(0,10);
    cont.dataset.tarihBas = basStr;
    cont.dataset.tarihBit = bitGosterim; // ✅ görüntüde doğru tarih
    cont.dataset.tarihBitQuery = bit.toISOString().slice(0,10); // Firebase için +1 gün
    const inpBas = document.getElementById('funnel-tarih-bas');
    const inpBit = document.getElementById('funnel-tarih-bit');
    if (inpBas) inpBas.value = basStr;
    if (inpBit) inpBit.value = bitGosterim;
  }
  cont.dataset.tarihTip = tip;
  document.querySelectorAll('.tarih-hizli-btn').forEach(btn => {
    const isActive = btn.dataset.tip === tip;
    btn.style.background  = isActive ? '#0f172a' : 'var(--surface)';
    btn.style.color       = isActive ? '#fbbf24' : 'var(--text-2)';
    btn.style.borderColor = isActive ? '#0f172a' : 'var(--border)';
  });
  if (typeof loadFunnelAnaliz === 'function') loadFunnelAnaliz(null, true);
};

window.setTarihManuel = function() {
  const cont = document.getElementById('funnel-analiz-konteynir');
  if (!cont) return;
  const inpBas = document.getElementById('funnel-tarih-bas');
  const inpBit = document.getElementById('funnel-tarih-bit');
  if (!inpBas?.value || !inpBit?.value) return;
  cont.dataset.tarihBas = inpBas.value;
  cont.dataset.tarihBit = inpBit.value;
  cont.dataset.tarihBitQuery = ''; // manuel girişte sorguda aynı tarih kullanılır
  cont.dataset.tarihTip = 'ozel';
  document.querySelectorAll('.tarih-hizli-btn').forEach(btn => {
    btn.style.background  = 'var(--surface)';
    btn.style.color       = 'var(--text-2)';
    btn.style.borderColor = 'var(--border)';
  });
  // Uygula butonunu gizle
  const uygulaBtn = document.getElementById('funnel-uygula-btn');
  if (uygulaBtn) uygulaBtn.style.display = 'none';
  if (typeof loadFunnelAnaliz === 'function') loadFunnelAnaliz(null, true);
};

// Manuel tarih inputu değişince Uygula butonunu göster
window._onTarihInputChange = function() {
  const btn = document.getElementById('funnel-uygula-btn');
  if (btn) {
    btn.style.display = 'block';
    btn.style.animation = 'none';
    btn.offsetHeight; // reflow
    btn.style.animation = 'fadeIn .15s ease';
  }
};

// ── Haftalık Bilgi Paylaş ─────────────────────────────────────
window.paylasBilgi = function() {
  const cont = document.getElementById('funnel-analiz-konteynir');
  if (!cont) return;

  const s = window._funnelCache;
  if (!s) {
    navigator.clipboard.writeText('Veri henüz yüklenmedi — Personel Analizi sayfasını açın.').catch(() => {});
    return;
  }

  const tarihBas    = cont.dataset.tarihBas || '';
  const tarihBit    = cont.dataset.tarihBit || '';
  const aktifFiltre = s.aktifFiltre || cont.dataset.funnelFiltre || 'saha';
  const aktifMagaza = s.aktifMagaza || cont.dataset.magazaFiltre || 'hepsi';
  // gosterimLabel zaten _funnelCache'e kondu — doğrudan kullan
  const tarihStr = s.gosterimLabel || (tarihBas
    ? (tarihBit && tarihBit !== tarihBas ? `${tarihBas} – ${tarihBit}` : tarihBas)
    : 'Son 7 Gün');

  // ── Bugünün adı + haftanın gün numarası
  const haftaGunleri = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
  const bugunAdi = haftaGunleri[new Date().getDay()];

  // ── Personel sıralaması (satış oranına göre)
  const pMap = s.pMap || {};
  // aktifFiltre: 'saha' | 'destek' | 'admin' | 'hepsi'
  // pMap zaten filtrelenmiş logs'tan oluştu — rol filtresi tekrar uygulamaya gerek yok
  // sadece toplam > 0 olanları al (boş kayıtlar olmasın)
  const pSirali = Object.values(pMap)
    .filter(p => p.toplam > 0)
    .sort((a, b) => {
      const oA = a.toplam > 0 ? a.satis / a.toplam : 0;
      const oB = b.toplam > 0 ? b.satis / b.toplam : 0;
      return oB - oA;
    });

  // ── Genel mağaza metrikleri
  const totN  = s.totN  || 0;
  const totS  = s.totS  || 0;
  const totK  = s.totK  || 0;
  const donPct = totN > 0 ? ((totS / totN) * 100).toFixed(1) : '0.0';
  const mom   = parseFloat(s.momOturum || 0);
  const momStr = mom > 0 ? `📈 +${mom}% ↑` : mom < 0 ? `📉 ${mom}% ↓` : `➡️ değişim yok`;

  // ── En iyi / en zayıf personel
  const enIyi  = pSirali[0];
  const enZayif = pSirali[pSirali.length - 1];

  // ── L3 kapanış (abaküs) verisi
  const l3D   = s.l3Toplam  || 0;
  const l3S   = s.l3Satis   || 0;
  const l3Pct = l3D > 0 ? Math.round((l3S / l3D) * 100) : 0;
  const l3Kay = s.l3KayipCiro || 0;

  // ── Momentum karşılaştırma
  const s7S = s.s7S || (s.son7Logs || []).filter(l => l.sonuc === 'satis').length;
  const o7S = s.o7S || (s.onc7Logs || []).filter(l => l.sonuc === 'satis').length;
  const satMom = o7S > 0 ? ((s7S - o7S) / o7S * 100).toFixed(1) : null;
  const satMomStr = satMom !== null
    ? (parseFloat(satMom) > 0 ? `📈 +${satMom}% ↑` : `📉 ${satMom}% ↓`)
    : '—';

  // ── Fırsat kaybı uyarısı (L3 kaçan + yüksek kaçma oranı)
  const kacmaUyari = totN > 0 && (totK / totN) > 0.50
    ? `⚠️ Bu hafta müşterilerin %${((totK/totN)*100).toFixed(0)}'i kaçtı — fiyat itirazı odak noktası olmalı.`
    : null;

  // ── Personel satırları (max 8 kişi, özlü format)
  const rozEmo = oran => oran >= 70 ? '🥇' : oran >= 45 ? '🥈' : oran >= 25 ? '🥉' : '📌';
  const pSatirlari = pSirali.slice(0, 8).map((p, i) => {
    const oran = p.toplam > 0 ? Math.round((p.satis / p.toplam) * 100) : 0;
    const mag  = p.magazaTipi ? ` [${p.magazaTipi}]` : '';
    const l3   = p.l3Giris > 0 ? `, Abaküs %${Math.round(p.l3Satis/p.l3Giris*100)}` : '';
    const bun  = p.bundleFirsat > 0 ? `, Bundle %${Math.round(p.bundleYapilan/p.bundleFirsat*100)}` : '';
    const trend = i === 0 ? ' ⭐' : i === pSirali.length - 1 && pSirali.length > 1 ? ' 👀' : '';
    return `${i + 1}. ${rozEmo(oran)} *${p.ad}*${mag}: %${oran} (${p.satis}/${p.toplam})${l3}${bun}${trend}`;
  }).join('\n');

  // ── Stratejik tavsiye seçimi (en kritik 2 öneri)
  const tavsiyeler = [];
  if (l3D > 0 && l3Pct < 40) {
    tavsiyeler.push(`💡 Abaküs kapanışı zayıf (%${l3Pct}) — fiyat sunumunu güçlendirin.`);
  }
  if (enZayif && enZayif.toplam >= 5) {
    const zOran = Math.round(enZayif.satis / enZayif.toplam * 100);
    tavsiyeler.push(`💡 ${enZayif.ad} odak noktası — %${zOran} dönüşüm, birebir koçluk önerilir.`);
  }
  if (enIyi && enIyi.toplam >= 5) {
    const iOran = Math.round(enIyi.satis / enIyi.toplam * 100);
    tavsiyeler.push(`💡 ${enIyi.ad} bu hafta zirvede (%${iOran}) — tekniği ekiple paylaşılsın.`);
  }
  if (l3Kay > 50000) {
    tavsiyeler.push(`💡 Abaküs'te ${(l3Kay/1000).toFixed(0)}k₺ fırsat kaçtı — kapanış pratiği öncelik.`);
  }
  const tavsiyeSatiri = tavsiyeler.slice(0, 2).join('\n');

  // ── Metin oluştur
  // Filtre etiketleri
  const rolEtiket = { saha:'👷 Saha', destek:'🖥️ Destek', admin:'👑 Admin', hepsi:'🌐 Tümü' }[aktifFiltre] || aktifFiltre;
  const magEtiket = !aktifMagaza || aktifMagaza === 'hepsi' ? '🏬 Tüm Mağazalar'
    : aktifMagaza === 'AVM' ? '🏬 AVM' : aktifMagaza === 'CARSI' ? '🏪 Çarşı' : aktifMagaza;

  const metin = [
    `📊 *HAFTALIK PERSONEL ANALİZİ*`,
    `📅 ${tarihStr} | ${bugunAdi}`,
    `🔍 ${rolEtiket} · ${magEtiket}`,
    ``,
    `🏪 *GENEL TABLO*`,
    `• Toplam Müşteri: *${totN}* | Satış: *${totS}* | Kaçan: *${totK}*`,
    `• Dönüşüm Oranı: *%${donPct}*`,
    `• Oturum Trendi: ${momStr}`,
    `• Satış Trendi (7 gün): ${satMomStr} (${s7S} → ${o7S})`,
    ``,
    `👥 *PERSONEL SIRALAMASI*`,
    pSatirlari || '— Veri yok',
    ``,
    `🎯 *ABAKÜS KAPANIŞ*`,
    `• Kapanış Oranı: *%${l3Pct}* (${l3S}/${l3D} fırsat)`,
    l3Kay > 0 ? `• Kaçırılan Ciro: *${(l3Kay/1000).toFixed(0)}k ₺*` : null,
    ``,
    kacmaUyari || null,
    kacmaUyari ? `` : null,
    tavsiyeSatiri ? `📌 *STRATEJİK TAVSİYELER*` : null,
    tavsiyeSatiri || null,
    ``,
    `_Aygün AVM Teknoloji Merkezi · ${new Date().toLocaleDateString('tr-TR')}_`
  ].filter(s => s !== null).join('\n');

  // ── Gönder / Kopyala
  const btn = cont.querySelector('button[onclick="paylasBilgi()"]');
  const _resetBtn = () => { if (btn) { btn.textContent = '✅ Kopyalandı'; setTimeout(() => btn.innerHTML = '📤 Haftalık Bilgi', 2500); } };

  if (navigator.share) {
    navigator.share({ text: metin }).catch(() => {
      navigator.clipboard.writeText(metin).then(_resetBtn).catch(() => prompt('Kopyalayın:', metin));
    });
  } else {
    navigator.clipboard.writeText(metin).then(_resetBtn).catch(() => prompt('Kopyalayın:', metin));
  }
};

// ─── SATIŞ HUNİSİ ANALİZ ──────────────────────────────────────
async function loadFunnelAnaliz(gunAralik = null, force = false) {
  const cont = document.getElementById('funnel-analiz-konteynir');
  if (!cont) return;
  
  // ✅ COOLDOWN: 5 dakika (300000 ms) - force=true ise zorla yenile
  const simdi = Date.now();
  if (!force && (simdi - _lastFunnelLoadTime) < 300000) {
    const gecenSaniye = Math.round((simdi - _lastFunnelLoadTime) / 1000);
    const kalanSaniye = Math.round((300000 - (simdi - _lastFunnelLoadTime)) / 1000);
    console.log(`⏸️ Funnel analiz cooldown: ${gecenSaniye} saniye geçti. ${kalanSaniye} saniye bekleniyor.`);
    return;
  }
  
  // ✅ ZATEN ÇALIŞIYORSA BEKLE
  if (_isFunnelLoading) {
    console.log('⏸️ Funnel analiz zaten çalışıyor, atlanıyor.');
    return;
  }
  
  _isFunnelLoading = true;
  _lastFunnelLoadTime = simdi;
  
  cont.innerHTML = '<div class="admin-empty" style="padding:24px">⏳ Firebase\'den çekiliyor…</div>';

  // ── TARİH ARALIĞI BELİRLE ────────────────────────────────────
  let limitDate, limitDateEnd, gosterimLabel;
  const tarihBas = cont.dataset.tarihBas;
  const tarihBit = cont.dataset.tarihBit;
  
  if (tarihBas && tarihBit) {
    limitDate    = new Date(tarihBas + 'T00:00:00');
    // tarihBitQuery = hızlı seçimde gün+1 (gece 00:00); tarihBit ise görüntü tarihi
    const tarihBitQuery = cont.dataset.tarihBitQuery || tarihBit;
    limitDateEnd = new Date(tarihBitQuery + 'T23:59:59');
    // Gün farkını hesapla
    const diffMs  = limitDateEnd - limitDate;
    const diffGun = Math.round(diffMs / 86400000);
    gosterimLabel = diffGun <= 1
      ? tarihBas
      : `${tarihBas} → ${tarihBit}`;
    gunAralik = diffGun;
  } else {
    // Default: son 90 gün
    const g = gunAralik || 90;
    limitDate    = new Date();
    limitDate.setDate(limitDate.getDate() - g);
    limitDateEnd = null; // üst sınır yok
    gosterimLabel = `Son ${g} gün`;
    gunAralik = g;
    // Dataset'e yaz ki render tarafı bilsin
    const bugun = new Date();
    cont.dataset.tarihBas = new Date(bugun.getTime() - g*86400000).toISOString().slice(0,10);
    cont.dataset.tarihBit = bugun.toISOString().slice(0,10);
    cont.dataset.tarihTip = cont.dataset.tarihTip || '90';
  }

  console.log(`📊 Funnel analiz: ${gosterimLabel} (${new Date().toISOString()})`);

  try {
    // ✅ GÜVENLİ TARİH FİLTRESİ: 'ts' (serverTimestamp) alanını kullan
    let q;
    if (limitDateEnd) {
      q = query(
        collection(_db, 'funnel_logs'),
        where('ts', '>=', limitDate),
        where('ts', '<=', limitDateEnd),
        orderBy('ts', 'desc'),
        limit(500)
      );
    } else {
      q = query(
        collection(_db, 'funnel_logs'),
        where('ts', '>=', limitDate),
        orderBy('ts', 'desc'),
        limit(500)
      );
    }
    
    const snap = await getDocs(q);
    const allLogs = [];
    snap.forEach(d => allLogs.push(d.data()));

    if (!allLogs.length) {
      cont.innerHTML = `<div class="admin-empty">📭 ${gosterimLabel} için veri yok.<br><span style="font-size:.72rem;color:var(--text-3)">Sepet kapatılınca burada görünecek.</span></div>`;
      _isFunnelLoading = false;
      return;
    }

    // ── FİLTRE SEÇİMİ (Saha / Destek / Admin / Tümü) ─────────────────
    // Aktif filtreyi al
    let aktifFiltre = cont.dataset.funnelFiltre || 'saha';
    
    // ✅ Filtre butonlarının stillerini güncelle
    document.querySelectorAll('.funnel-filter-btn').forEach(btn => {
      const isActive = btn.dataset.filter === aktifFiltre;
      btn.style.borderColor = isActive ? 'var(--red)' : 'var(--border)';
      btn.style.background = isActive ? 'var(--red)' : 'var(--surface)';
      btn.style.color = isActive ? '#fff' : 'var(--text-2)';
    });
    
    // Logları filtrele
    // Funnel filtre eşleşmesi:
    //   Saha   → funnelRol === 'saha'   (Rol: 'satis')
    //   Destek → funnelRol === 'destek' (Rol: 'destek')
    //   Admin  → funnelRol === 'admin'  (Rol: 'admin')
    //   Tümü   → hepsi
    const rolFiltreli = aktifFiltre === 'hepsi'
      ? allLogs
      : allLogs.filter(l => {
          const rol = l.funnelRol || 'saha';
          if (aktifFiltre === 'saha')   return rol === 'saha';
          if (aktifFiltre === 'destek') return rol === 'destek';
          if (aktifFiltre === 'admin')  return rol === 'admin';
          return false;
        });
    const aktifMagaza = cont.dataset.magazaFiltre || 'hepsi';
    const logs = aktifMagaza === 'hepsi'
      ? rolFiltreli
      : rolFiltreli.filter(l => (l.magazaTipi||'BELIRSIZ').toUpperCase() === aktifMagaza.toUpperCase());
    
    // Log sayısı sıfırsa uyarı göster
    if (logs.length === 0) {
      cont.innerHTML = `<div class="admin-empty">📭 "${aktifFiltre === 'saha' ? '👷 Saha' : aktifFiltre === 'destek' ? '🖥 Destek' : aktifFiltre === 'admin' ? '👑 Admin' : '🌐 Tümü'}" filtresinde veri yok.<br><span style="font-size:.72rem;color:var(--text-3)">Farklı bir filtre deneyin.</span></div>`;
      _isFunnelLoading = false;
      return;
    }
    // ── TARİH DİLİMLERİ (Momentum) ────────────────────────────
    const bugun    = new Date().toISOString().split('T')[0];
    const son7Basi = new Date(Date.now() -  7*86400000).toISOString().split('T')[0];
    const onc7Basi = new Date(Date.now() - 14*86400000).toISOString().split('T')[0];

    const son7Logs  = logs.filter(l => (l.tarih||'') >= son7Basi);
    const onc7Logs  = logs.filter(l => (l.tarih||'') >= onc7Basi && (l.tarih||'') < son7Basi);
    const bugunLogs = logs.filter(l => (l.tarih||'').startsWith(bugun));

    // ── GENEL SAYILAR ──────────────────────────────────────────
    const totN = logs.length;
    const totS = logs.filter(l=>l.sonuc==='satis').length;
    // "Hareketsizlik (Arka Plan)" gerçek müşteri kaybı değil — ayrı say
    const HAREKETSIZLIK_NEDEN = 'Hareketsizlik (Arka Plan)';
    const totK        = logs.filter(l=>l.sonuc==='kacti' && l.neden !== HAREKETSIZLIK_NEDEN).length;
    const totHareketsiz = logs.filter(l=>l.sonuc==='kacti' && l.neden === HAREKETSIZLIK_NEDEN).length;

    // Gerçek dönüşüm oranı (hareketsizlik hariç)
    const donusumGercek = totN === 0 ? 0 : ((totS / totN) * 100).toFixed(1);

    // ── MOMENTUM ──────────────────────────────────────────────
    const s7S = son7Logs.filter(l=>l.sonuc==='satis').length;
    const o7S = onc7Logs.filter(l=>l.sonuc==='satis').length;
    const momOturum = onc7Logs.length === 0
      ? (son7Logs.length > 0 ? '+100' : '0')
      : ((son7Logs.length - onc7Logs.length) / onc7Logs.length * 100).toFixed(1);
    const momSatis = onc7Logs.length === 0 ? 0 : ((s7S - o7S) / Math.max(onc7Logs.length, 1) * 100).toFixed(1);
    const momIcon  = parseFloat(momOturum) > 0 ? '📈' : parseFloat(momOturum) < 0 ? '📉' : '➡️';
    const momCol   = parseFloat(momOturum) > 0 ? '#22c55e' : parseFloat(momOturum) < 0 ? '#ef4444' : '#94a3b8';

    // ── SEPETKATEGORİSİ DAĞILIMI ──────────────────────────────
    const katMap = { Altin:0, Gumus:0, Standart:0 };
    logs.forEach(l => { const k = l.sepetKategorisi||'Standart'; katMap[k] = (katMap[k]||0)+1; });

    // ── FİYAT İTİRAZI ALAN TOP 3 ÜRÜN ────────────────────────
    const fiyatiPahali = {};
    logs.forEach(l => {
      if (l.sonuc === 'kacti' && l.neden === 'Fiyat Pahalı') {
        (l.bakilanFiyatlar || []).forEach(u => {
          if (u) fiyatiPahali[u] = (fiyatiPahali[u] || 0) + 1;
        });
      }
    });
    // Minimum 3 itiraz eşiği: daha az itiraz istatistiksel anlamsız
    const MIN_ITIRAZ = 3;
    const top3Pahali = Object.entries(fiyatiPahali)
      .filter(([,n]) => n >= MIN_ITIRAZ)
      .sort((a,b) => b[1]-a[1]).slice(0,3);

    // ── ÜRÜN ISI HARİTASI ─────────────────────────────────────
    // Ürünler yüklü değilse önce yükle
    let _urunlerForMap = window._cachedUrunler || allProducts || [];
    if (!_urunlerForMap.length) {
      try {
        const _r = await fetch(dataUrl('urunler.json') + '?isı=' + Date.now());
        const _j = safeJSON(await _r.text());
        _urunlerForMap = Array.isArray(_j.data) ? _j.data : (Array.isArray(_j) ? _j : []);
        window._cachedUrunler = _urunlerForMap;
        if (!allProducts.length) allProducts = _urunlerForMap;
      } catch(e) { console.warn('Urun listesi yuklenemedi:', e); }
    }

    // Ürün adı → stok, nakit, kod haritası
    const _urunBilgi = {};
    _urunlerForMap.forEach(p => {
      const keys = Object.keys(p);
      const uKey = keys.find(k => norm(k) === 'urun');
      if (uKey && p[uKey]) {
        _urunBilgi[p[uKey]] = {
          stok:  Number(p.Stok || p.stok || 0),
          nakit: parseFloat(p.Nakit || p.nakit || 0),
          kod:   p.Kod || p.kod || ''
        };
      }
    });

    // Her ürün için blur (ilgi) ve satış sayısını hesapla
    const urunIsiMap = {}; // { urunAdi: { blur:n, satis:n, sepet:n, l3:n, l3Kacti:n, nedenMap:{} } }

    logs.forEach(log => {
      // Blur kaynağı: blurUrunListesi (yeni) veya bakilanFiyatlar (eski)
      const blurListesi = log.blurUrunListesi || log.bakilanFiyatlar || [];
      blurListesi.forEach(u => {
        if (!u) return;
        if (!urunIsiMap[u]) urunIsiMap[u] = { blur:0, satis:0, sepet:0, l3:0, l3Kacti:0, nedenMap:{} };
        urunIsiMap[u].blur++;
        // Kaçış nedeni ürün bazında topla
        if (log.sonuc === 'kacti' && log.neden) {
          const n = log.neden;
          // Hareketsizlik sistem temizliğidir, gerçek kaçış nedeni değildir —
          // nedenMap'e yazılmaz, ayrıca takip edilir.
          if (n !== 'Hareketsizlik (Arka Plan)') {
            urunIsiMap[u].nedenMap[n] = (urunIsiMap[u].nedenMap[n] || 0) + 1;
          }
        }
        if ((log.intentLevel || 0) >= 3) {
          urunIsiMap[u].l3++;
          if (log.sonuc === 'kacti') urunIsiMap[u].l3Kacti++;
        }
      });
      // Sepet sayısı
      (log.urunler || []).forEach(u => {
        const ad = u.urun || u;
        if (!ad) return;
        if (!urunIsiMap[ad]) urunIsiMap[ad] = { blur:0, satis:0, sepet:0, l3:0, l3Kacti:0, nedenMap:{} };
        urunIsiMap[ad].sepet++;
      });
      // Satış kaynağı: sepete eklenen + sonuç satis
      if (log.sonuc === 'satis' || log.sonuc === 'teklif') {
        (log.urunler || []).forEach(u => {
          const ad = u.urun || u;
          if (!ad) return;
          if (!urunIsiMap[ad]) urunIsiMap[ad] = { blur:0, satis:0, sepet:0, l3:0, l3Kacti:0, nedenMap:{} };
          if (log.sonuc === 'satis') urunIsiMap[ad].satis++;
        });
      }
    });

    // proposals + sales'tan da satış ekle (daha geniş veri)
    proposals.forEach(p => (p.urunler||[]).forEach(u => {
      if (!u.urun) return;
      if (!urunIsiMap[u.urun]) urunIsiMap[u.urun] = { blur:0, satis:0, sepet:0, l3:0, l3Kacti:0, nedenMap:{} };
      if (p.durum === 'satisDondu') urunIsiMap[u.urun].satis++;
    }));
    sales.forEach(s => (s.urunler||[]).forEach(u => {
      if (!u.urun) return;
      if (!urunIsiMap[u.urun]) urunIsiMap[u.urun] = { blur:0, satis:0, sepet:0, l3:0, l3Kacti:0, nedenMap:{} };
      urunIsiMap[u.urun].satis++;
    }));

    // Toplam blur ve stok bilgisi
    const toplamBlur = Object.values(urunIsiMap).reduce((s,v) => s + v.blur, 0);

    // 4 Davranış Grubu
    const vitrinsampiyonlari = []; // Çok blur + çok satış
    const direktenDonenler   = []; // Çok blur + az satış (L3'te kayıp var)
    const sessizDegerler     = []; // Az blur + çok satış
    const olduStok           = []; // Sıfır blur + stok > 0

    // Eşik: blur medyanının üstü = "çok", altı = "az"
    const blurDeger = Object.values(urunIsiMap).map(v => v.blur).filter(v => v > 0);
    const blurMedyan = blurDeger.length
      ? blurDeger.sort((a,b)=>a-b)[Math.floor(blurDeger.length/2)]
      : 1;
    const satisDeger = Object.values(urunIsiMap).map(v => v.satis).filter(v => v > 0);
    const satisMedyan = satisDeger.length
      ? satisDeger.sort((a,b)=>a-b)[Math.floor(satisDeger.length/2)]
      : 1;

    Object.entries(urunIsiMap).forEach(([ad, v]) => {
      const blurCok  = v.blur >= blurMedyan;
      const satisCok = v.satis >= Math.max(1, satisMedyan);
      const bilgi    = _urunBilgi[ad] || { stok:0, nakit:0 };

      // En sık kaçış nedeni "Hareketsizlik" mi? → gerçek kaçış verisi yok
      const topNeden = Object.entries(v.nedenMap || {}).sort((a,b) => b[1]-a[1])[0];
      const topNedenAdi = topNeden ? topNeden[0] : '';
      const sadceHareketsizlik =
        topNedenAdi === 'Hareketsizlik (Arka Plan)' &&
        Object.keys(v.nedenMap || {}).length === 1;

      const obj = { ad, ...v, ...bilgi,
        donusum: v.blur === 0 ? 0 : Math.round((v.satis / v.blur) * 100),
        l3DonuPct: v.l3 === 0 ? null : Math.round(((v.l3-v.l3Kacti)/v.l3)*100),
        sadceHareketsizlik  // DD tablosunda uyarı için
      };
      if (blurCok && satisCok) {
        vitrinsampiyonlari.push(obj);
      } else if (blurCok && !satisCok) {
        // Tüm kaçışları hareketsizlik olan ürünleri DD'ye ALMA
        // Sistem temizliği nedeniyle kaçmış — gerçek müşteri kararı değil
        if (!sadceHareketsizlik) direktenDonenler.push(obj);
      } else if (!blurCok && satisCok) {
        sessizDegerler.push(obj);
      }
      // olduStok: allProducts üzerinden — hiç blur almamış stoklu ürünler
    });

    // Ölü stok: stok > 0 ama hiç blur yok
    _urunlerForMap.forEach(p => {
      const keys = Object.keys(p);
      const uKey = keys.find(k => norm(k) === 'urun');
      if (!uKey || !p[uKey]) return;
      const ad = p[uKey];
      const stok = Number(p.Stok || 0);
      if (stok > 0 && (!urunIsiMap[ad] || urunIsiMap[ad].blur === 0)) {
        olduStok.push({ ad, stok, nakit: parseFloat(p.Nakit||0) });
      }
    });

    // Sırala
    direktenDonenler.sort((a,b) => b.blur - a.blur);
    vitrinsampiyonlari.sort((a,b) => b.satis - a.satis);
    sessizDegerler.sort((a,b) => b.satis - a.satis);
    olduStok.sort((a,b) => b.stok - a.stok);

    console.log('🌡 Urun Isi Haritasi:', Object.keys(urunIsiMap).length,
      'urun | VS:', vitrinsampiyonlari.length,
      'DD:', direktenDonenler.length,
      'SD:', sessizDegerler.length,
      'OS:', olduStok.length);

    // gamSirali/gamEnIyi/gamEnKotu artık kullanılmıyor — uyumluluk için boş
    const gamSirali = [], gamEnIyi = [], gamEnKotu = [];

// ── PERSONEL İSTATİSTİKLERİ ──────────────────────────────
const pMap = {};
const saatSatis = Array(24).fill(0), saatKacti = Array(24).fill(0);
const saatBlur = Array(24).fill(0);  // Saatlik blur sayacı

logs.forEach(l => {
  const eid = l.personelId || '?';
  if (!pMap[eid]) pMap[eid] = {
    ad:l.personelAd||eid.split('@')[0], rol:l.funnelRol||'saha',
    magazaTipi: l.magazaTipi || '',
    toplam:0, satis:0, kacti:0, derinlikToplam:0, tutarToplam:0,
    benzersizToplam:0,
    bundleFirsat:0, bundleYapilan:0,
    altin:0, gumus:0, standart:0,
    blurToplam:0,
    // L3 Pazarlık Analizi
    l3Giris:0,    // Abaküs açan = L3'e giren
    l3Satis:0,   // L3'ten satışa dönen
    l3Kacti:0,   // L3'ten kaçan
    l3Ciro:0     // L3'te kaçırılan potansiyel ciro
  };
  const p = pMap[eid];
  p.toplam++;
  if (l.sonuc==='satis') p.satis++;
  if (l.sonuc==='kacti') p.kacti++;
  p.derinlikToplam += l.derinlik||0;
  p.benzersizToplam += l.benzersizUrun || l.derinlik||0;
  p.tutarToplam    += l.toplamTutar||0;
  p.blurToplam     += (l.bakilanFiyatlar || []).length;
  if (l.bundleVarMi)  { p.bundleFirsat++; if(l.bundleYapildi) p.bundleYapilan++; }
  // L3 pazarlık analizi (intentLevel >= 3 → abaküs açıldı)
  if ((l.intentLevel || 0) >= 3) {
    p.l3Giris++;
    if (l.sonuc === 'satis') p.l3Satis++;
    if (l.sonuc === 'kacti') { p.l3Kacti++; p.l3Ciro += l.toplamTutar || 0; }
  }
  const k = l.sepetKategorisi||'Standart';
  if (k==='Altin') p.altin++; else if(k==='Gumus') p.gumus++; else p.standart++;
  const h = l.saat ?? -1;
  // serverTimestamp null gelince 00:00 yığılması önle
  if (h >= 0 && h <= 23) { 
    if(l.sonuc==='satis') saatSatis[h]++; 
    // Hareketsizlik saatlik "kaçan" grafiğini kirletmesin
    if(l.sonuc==='kacti' && l.neden !== HAREKETSIZLIK_NEDEN) saatKacti[h]++; 
    saatBlur[h] += (l.bakilanFiyatlar || []).length;
  }
});

    // ── L3 GLOBAL İSTATİSTİKLER ───────────────────────────────
    const l3Toplam    = logs.filter(l => (l.intentLevel||0) >= 3).length;
    const l3Satis     = logs.filter(l => (l.intentLevel||0) >= 3 && l.sonuc === 'satis').length;
    // Hareketsizlik kaçışını gerçek L3 kaçışından ayır
    const l3Kacti     = logs.filter(l => (l.intentLevel||0) >= 3 && l.sonuc === 'kacti' && l.neden !== HAREKETSIZLIK_NEDEN).length;
    const l3KactiHareketsiz = logs.filter(l => (l.intentLevel||0) >= 3 && l.sonuc === 'kacti' && l.neden === HAREKETSIZLIK_NEDEN).length;
    // Ciro kaybı: L3 (intentLevel>=3) gerçek kaçışlar.
    // toplamTutar 0 ise bakilanFiyatlar içindeki ürünlerin nakit fiyatından tahmin et
    const _urunNakitHarita = {};
    (window._cachedUrunler || allProducts || []).forEach(p => {
      const k = Object.keys(p).find(kk => (kk||'').toLowerCase() === 'urun');
      if (k && p[k]) _urunNakitHarita[p[k]] = parseFloat(p.Nakit || p.nakit || 0);
    });
    const _ciroSeen = new Set();
    const l3KayipCiro = logs
      .filter(l => (l.intentLevel||0) >= 3 && l.sonuc === 'kacti' && l.neden !== HAREKETSIZLIK_NEDEN)
      .reduce((s, l) => {
        const _ck = (l.personelId||'?') + '_' + (l.tarih||'') + '_' + (l.saat??'');
        if (_ciroSeen.has(_ck)) return s;
        _ciroSeen.add(_ck);
        const tutar = l.toplamTutar || 0;
        if (tutar > 0) return s + tutar;
        const tahmin = (l.bakilanFiyatlar || []).reduce((a, u) => a + (_urunNakitHarita[u] || 0), 0);
        return s + tahmin;
      }, 0);
    const l3Donusum   = l3Toplam === 0 ? 0 : ((l3Satis / l3Toplam) * 100).toFixed(1);

    // L3'te kaçanların neden dağılımı (hareketsizlik ayrı kategori)
    const l3NedenMap = {};
    logs.filter(l => (l.intentLevel||0) >= 3 && l.sonuc === 'kacti' && l.neden !== HAREKETSIZLIK_NEDEN).forEach(l => {
      const n = l.neden || 'Belirtilmedi';
      l3NedenMap[n] = (l3NedenMap[n] || 0) + 1;
    });
    const l3NedenSirali = Object.entries(l3NedenMap).sort((a,b) => b[1]-a[1]);

    // L3'te en çok kaçırılan ürünler (bakilanFiyatlar + intentLevel>=3 + kacti)
    const l3UrunMap = {};
    logs.filter(l => (l.intentLevel||0) >= 3 && l.sonuc === 'kacti').forEach(l => {
      (l.bakilanFiyatlar || []).forEach(u => {
        if (!u) return;
        if (!l3UrunMap[u]) l3UrunMap[u] = { kacti:0, ciro:0 };
        l3UrunMap[u].kacti++;
        l3UrunMap[u].ciro += l.toplamTutar || 0;
      });
    });
    const l3UrunSirali = Object.entries(l3UrunMap)
      .sort((a,b) => b[1].kacti - a[1].kacti).slice(0, 8);

    // Saatlik L3 kaçış dağılımı (hangi saatte abaküsten kaçılıyor)
    const saatL3Kacti = Array(24).fill(0);
    logs.filter(l => (l.intentLevel||0) >= 3 && l.sonuc === 'kacti').forEach(l => {
      const h = l.saat ?? -1;
      if (h >= 0) saatL3Kacti[h]++;
    });
    const l3SaatMax = Math.max(...saatL3Kacti, 1);

    // ── PERSONEL KARTLARI (Rozet Hesaplama) ───────────────────
    function rozet(p) {
      const oran = p.toplam===0 ? 0 : p.satis/p.toplam;
      if (oran >= 0.70) return { e:'🥇', l:'Altın',    c:'#f59e0b' };
      if (oran >= 0.45) return { e:'🥈', l:'Gümüş',   c:'#64748b' };
      if (oran >= 0.25) return { e:'🥉', l:'Bronz',    c:'#b45309' };
      return              { e:'🎯', l:'Gelişiyor', c:'#6366f1' };
    }

    const personelHTML = Object.entries(pMap)
      .sort((a,b) => b[1].satis/Math.max(b[1].toplam,1) - a[1].satis/Math.max(a[1].toplam,1))
      .map(([,s]) => {
        const r    = rozet(s);
        const sO   = s.toplam===0?0:((s.satis/s.toplam)*100).toFixed(0);
        const kO   = s.toplam===0?0:((s.kacti/s.toplam)*100).toFixed(0);
        const satis_kalan = s.toplam - s.satis - s.kacti;
        // Satış Oranı: Satış / Toplam Oturum
        const satisOranPct = s.toplam===0 ? 0 : ((s.satis/s.toplam)*100).toFixed(0);
        const satisCol = parseFloat(satisOranPct)>=50?'#16a34a':parseFloat(satisOranPct)>=25?'#f59e0b':'#dc2626';
        // Kapanış Oranı: L3 Satış / L3 Giriş (Abaküs'ten satışa dönüş)
        // l3Giris=0 → abaküs hiç açılmamış; "—" göster, renk gri
        // l3Giris>0 ama l3Satis=0 → abaküs açıldı ama hiç satış yok; kırmızı
        const _l3Oran = (s.l3Giris > 0 && s.l3Satis >= 0)
          ? s.l3Satis / s.l3Giris : null;
        const l3KapanisOran = s.l3Giris === 0
          ? '—'
          : (_l3Oran * 100).toFixed(0) + '%';
        const l3KapCol = s.l3Giris === 0 ? '#94a3b8'
          : _l3Oran >= 0.6 ? '#16a34a'
          : _l3Oran >= 0.3 ? '#f59e0b' : '#dc2626';
        // Rol etiketi
        let rolEtiketi = '';
        if (s.rol === 'saha') rolEtiketi = '👷 Saha';
        else if (s.rol === 'destek') rolEtiketi = '🖥 Destek';
        else if (s.rol === 'admin') rolEtiketi = '👑 Admin';
        else rolEtiketi = '👤 Personel';

        // Derinlik ve çeşitlilik ortalama
        const aD = s.toplam === 0 ? 0 : (s.derinlikToplam  / s.toplam).toFixed(1);
        const aC = s.toplam === 0 ? 0 : (s.benzersizToplam / s.toplam).toFixed(1);
        // Rozet tooltip kriteri
        const rozetTooltip = r.l === 'Altın'     ? 'Satış oranı ≥ %70'
                           : r.l === 'Gümüş'     ? 'Satış oranı %45–69'
                           : r.l === 'Bronz'      ? 'Satış oranı %25–44'
                           : 'Satış oranı < %25 — gelişme potansiyeli var';
        // Kaçan vurgu rengi
        const kactiVurgu = parseFloat(kO) >= 50 ? '#dc2626' : parseFloat(kO) >= 30 ? '#f59e0b' : '#64748b';

        // Mağaza badge
        const magazaBadge = s.magazaTipi
          ? (s.magazaTipi.toUpperCase() === 'AVM'
            ? `<span style="font-size:.56rem;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;padding:1px 6px;font-weight:700">🏬 AVM</span>`
            : `<span style="font-size:.56rem;background:#fdf4ff;color:#7e22ce;border:1px solid #e9d5ff;border-radius:6px;padding:1px 6px;font-weight:700">🏪 Çarşı</span>`)
          : '';

        // Kazanç özeti (tutar varsa)
        const ortTutar = s.satis > 0 ? Math.round(s.tutarToplam / s.satis) : 0;
        const tutarStr = ortTutar > 0
          ? `<span style="font-size:.56rem;color:#059669;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;padding:1px 6px;font-weight:700">⌀ ${(ortTutar/1000).toFixed(1)}k₺/satış</span>`
          : '';

        // Bundle oranı
        const bundleOran = s.bundleFirsat > 0 ? Math.round(s.bundleYapilan/s.bundleFirsat*100) : null;
        const bundleStr = bundleOran !== null
          ? `<div style="text-align:center;background:${bundleOran>=50?'#f0fdf4':'#fff7ed'};border-radius:8px;padding:6px 4px;border:1px solid ${bundleOran>=50?'#bbf7d0':'#fed7aa'}">
              <b style="font-size:.86rem;color:${bundleOran>=50?'#15803d':'#c2410c'}">${bundleOran}%</b>
              <div style="font-size:.56rem;color:${bundleOran>=50?'#15803d':'#c2410c'};margin-top:1px;font-weight:700">🎁 Bundle</div>
              <div style="font-size:.52rem;color:#94a3b8" title="Bundle dönüşümü: ${s.bundleYapilan} başarılı / ${s.bundleFirsat} fırsat">${s.bundleYapilan}/${s.bundleFirsat}</div>
            </div>`
          : `<div style="text-align:center;background:#f8fafc;border-radius:8px;padding:6px 4px;border:1px solid #e2e8f0">
              <b style="font-size:.86rem;color:#cbd5e1">—</b>
              <div style="font-size:.56rem;color:#94a3b8;margin-top:1px;font-weight:700">Bundle</div>
              <div style="font-size:.52rem;color:#cbd5e1">Fırsat yok</div>
            </div>`;

        return `
<div data-personel-id="1"
  data-personel-ad="${s.ad}"
  data-satis-oran="${satisOranPct}"
  data-satis-adet="${s.satis}"
  data-toplam-adet="${s.toplam}"
  data-magaza="${s.magazaTipi||''}"
  data-rozet="${r.e}"
  style="background:var(--surface);border:1.5px solid #e8ecf5;border-radius:20px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)">

  <!-- Kart Başlık Bandı -->
  <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:12px 14px;display:flex;align-items:center;justify-content:space-between">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,${r.c},${r.c}cc);display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:800;color:#fff;flex-shrink:0;box-shadow:0 2px 8px ${r.c}44">
        ${s.ad.slice(0,2).toUpperCase()}
      </div>
      <div>
        <div style="font-size:.88rem;font-weight:800;color:#f1f5f9;line-height:1.2">${s.ad}</div>
        <div style="display:flex;gap:4px;align-items:center;margin-top:3px;flex-wrap:wrap">
          <span style="font-size:.58rem;color:#64748b;font-weight:600">${rolEtiketi}</span>
          ${magazaBadge}
          ${tutarStr}
        </div>
      </div>
    </div>
    <!-- Rozet -->
    <div title="${rozetTooltip}" style="background:${r.c}20;border:1.5px solid ${r.c}55;border-radius:20px;padding:3px 10px;font-size:.63rem;font-weight:800;color:${r.c};cursor:help;white-space:nowrap;flex-shrink:0">
      ${r.e} ${r.l}
    </div>
  </div>

  <!-- Progress Bar: Satış / Bekleyen / Kaçan -->
  <div style="height:10px;display:flex;gap:1px;background:#f1f5f9">
    <div style="flex:${s.satis||0};background:#22c55e;min-width:0"></div>
    <div style="flex:${satis_kalan>0?satis_kalan:0};background:#f59e0b;min-width:0"></div>
    <div style="flex:${s.kacti||0};background:#ef4444;min-width:0"></div>
  </div>

  <!-- Metrik Grid -->
  <div style="padding:12px 14px">

    <!-- 3 Ana KPI -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px">
      <!-- Satış Oranı -->
      <div style="background:#f0fdf4;border-radius:12px;padding:8px 6px;text-align:center;border:1px solid #bbf7d0">
        <div style="font-size:1.25rem;font-weight:900;color:${satisCol};line-height:1">${satisOranPct}%</div>
        <div style="font-size:.58rem;color:#15803d;font-weight:700;margin-top:3px">Satış Oranı</div>
        <div style="font-size:.52rem;color:#86efac;margin-top:1px">${s.satis} / ${s.toplam}</div>
      </div>
      <!-- Kapanış Oranı -->
      <div style="background:${s.l3Giris===0?'#f8fafc':l3KapCol==='#16a34a'?'#f0fdf4':l3KapCol==='#f59e0b'?'#fffbeb':'#fef2f2'};border-radius:12px;padding:8px 6px;text-align:center;border:1.5px solid ${s.l3Giris===0?'#e2e8f0':l3KapCol}44">
        <div style="font-size:1.25rem;font-weight:900;color:${l3KapCol};line-height:1">${l3KapanisOran}</div>
        <div style="font-size:.58rem;color:${l3KapCol};font-weight:700;margin-top:3px">${s.l3Giris===0?'Abaküs Yok':'Kapanış'}</div>
        <div style="font-size:.52rem;color:#94a3b8;margin-top:1px">${s.l3Giris===0?'açılmadı':s.l3Giris+' abaküs'}</div>
      </div>
      <!-- Kaçan -->
      <div style="background:${parseFloat(kO)>=50?'#fef2f2':parseFloat(kO)>=30?'#fffbeb':'#f8fafc'};border-radius:12px;padding:8px 6px;text-align:center;border:1px solid ${kactiVurgu}30">
        <div style="font-size:1.25rem;font-weight:900;color:${kactiVurgu};line-height:1">${kO}%</div>
        <div style="font-size:.58rem;color:${kactiVurgu};font-weight:700;margin-top:3px">Kaçan</div>
        <div style="font-size:.52rem;color:#94a3b8;margin-top:1px">${s.kacti} müşteri</div>
      </div>
    </div>

    <!-- Alt Detay Satırı -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px">
      <!-- Bundle -->
      ${bundleStr}
      <!-- Sepet Kalitesi -->
      <div style="text-align:center;background:#fafbff;border-radius:8px;padding:6px 4px;border:1px solid #e0e7ff">
        <div style="font-size:.86rem;font-weight:800;color:#4338ca">🥇${s.altin} 🥈${s.gumus}</div>
        <div style="font-size:.56rem;color:#4338ca;margin-top:1px;font-weight:700">Sepet Kalitesi</div>
        <div style="font-size:.52rem;color:#94a3b8">${s.standart} standart</div>
      </div>
      <!-- Derinlik & Çeşitlilik -->
      <div title="Derinlik: ort. ürün sayısı | Çeşitlilik: ort. farklı ürün" style="text-align:center;background:#f8fafc;border-radius:8px;padding:6px 4px;border:1px solid #e2e8f0;cursor:help">
        <div style="font-size:.86rem;font-weight:800;color:#475569">D:${aD}</div>
        <div style="font-size:.56rem;color:#475569;margin-top:1px;font-weight:700">Ç:${aC}</div>
        <div style="font-size:.52rem;color:#94a3b8">Derinlik/Çeş.</div>
      </div>
    </div>

    <!-- Müşteri sayısı footer -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding-top:8px;border-top:1px solid #f1f5f9">
      <span style="font-size:.60rem;color:#94a3b8">${s.toplam} müşteri oturumu</span>
      <span style="font-size:.60rem;color:#94a3b8">${s.blurToplam} fiyat bakışı</span>
    </div>
  </div>
</div>`;
      }).join('');

    // ── SAATLİK YOĞUNLUK BARI — null/undefined korumalı ──────────
    const saatMax = Math.max(...saatSatis.map((v,i)=>(v||0)+(saatKacti[i]||0)), 1);
    const saatBar = [...Array(24).keys()].map(h => {
      const s = saatSatis[h] || 0;
      const k = saatKacti[h] || 0;
      const top = s + k;
      // sW + kW <= 100 garantisi
      const sW = top === 0 ? 0 : Math.min(100, Math.round(s / saatMax * 100));
      const kW = top === 0 ? 0 : Math.min(100 - sW, Math.round(k / saatMax * 100));
      const label = h < 10 ? '0' + h : String(h);
      return '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px">' +
        '<span style="width:20px;color:var(--text-3);text-align:right;font-size:.50rem;flex-shrink:0">' + label + '</span>' +
        '<div style="flex:1;height:8px;border-radius:2px;background:#f1f5f9;overflow:hidden;display:flex">' +
          '<div style="width:' + sW + '%;background:#16a34a;height:100%;flex-shrink:0"></div>' +
          '<div style="width:' + kW + '%;background:#dc2626;height:100%;flex-shrink:0"></div>' +
        '</div>' +
        '<span style="width:18px;color:var(--text-2);font-size:.50rem;flex-shrink:0;text-align:left">' + (top > 0 ? top : '') + '</span>' +
      '</div>';
    }).join('');

    // Saatlik Blur Yoğunluğu Grafiği
    const blurMax = Math.max(...saatBlur, 1);
    const blurBar = [...Array(24).keys()].map(h => {
      const blur = saatBlur[h];
      const width = blur===0?0:Math.round(blur/blurMax*80);
      return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px;font-size:.58rem">
        <span style="min-width:26px;color:var(--text-3);text-align:right">${h<10?'0'+h:h}:00</span>
        <div style="flex:1;height:10px;border-radius:4px;background:#f1f5f9;overflow:hidden">
          <div style="width:${width}%;height:100%;background:#f59e0b;border-radius:4px"></div>
        </div>
        <span style="min-width:16px;color:var(--text-2)">${blur||''}</span>
      </div>`;
    }).join('');

    // ── FUNNEL AŞAMA TOTALLERİ — Session-Based (tekil oturum sayımı) ──
    const _uniqueSessionKey = l => `${l.personelId||'?'}_${l.tarih||''}_${l.saat??''}`;
    const _seenSessions = new Set();
    const _uniqueLogs = logs.filter(l => {
      const key = _uniqueSessionKey(l);
      if (_seenSessions.has(key)) return false;
      _seenSessions.add(key);
      return true;
    });
    const funnelBlur = _uniqueLogs.filter(l =>
      (l.benzersizBlurSayisi || 0) > 0 ||
      (l.blurUrunListesi || l.bakilanFiyatlar || []).length > 0
    ).length;
    const _rawSepet   = _uniqueLogs.filter(l => (l.derinlik || 0) > 0 || (l.urunler||[]).length > 0).length;
    const _rawL3      = l3Toplam;
    const _rawTeklif  = proposals.filter(p => p.durum !== 'iptal').length;
    const _rawSatis   = totS;

    // Huni uyarısı kaldırıldı — eski kayıtlarda benzersizBlurSayisi eksik, UI Math.min ile kırpıyor

    // UI için kırpılmış değerler (görsel tutarlılık)
    const funnelSepet  = Math.min(funnelBlur, _rawSepet);
    const funnelL3     = Math.min(funnelSepet, _rawL3);
    const funnelTeklif = Math.min(funnelL3, _rawTeklif);
    const funnelSatis  = Math.min(funnelTeklif > 0 ? funnelTeklif : funnelL3, _rawSatis);

    // ── OTOMATİK TAVSİYE KURALLARI — if-else koşul mantığı ─────────
    let _tavsiyeKurallari;
    try {
      _tavsiyeKurallari = JSON.parse(localStorage.getItem('aygun_tavsiye_kurallari') || 'null');
    } catch(e) { _tavsiyeKurallari = null; }
    if (!_tavsiyeKurallari) {
      _tavsiyeKurallari = [
        { id:'r1', aktif:true, durum:'Blur > 10, Satış = 0, Abaküs açıldı', oneri:'Fiyat veya taksit seçeneklerini gözden geçirin.', icon:'💸',
          test: (u) => u.blur > 10 && u.satis === 0 && u.l3 > 0 },
        { id:'r2', aktif:true, durum:'Blur > 10, Sepet = 0', oneri:'Teşhir konumunu değiştirin, öne çıkarın.', icon:'📍',
          test: (u) => u.blur > 10 && u.sepet === 0 },
        { id:'r3', aktif:true, durum:'Blur < 3, Satış > 2', oneri:'Fiyat avantajlı — reklam yapın.', icon:'📢',
          test: (u) => u.blur < 3 && u.satis > 2 },
        { id:'r4', aktif:true, durum:'Blur = 0, Stok > 0', oneri:'Vitrinden kaldırın, yerine yeni ürün koyun.', icon:'🔄',
          test: (u) => u.blur === 0 && (u.stok || 0) > 0 },
      ];
    }

    // Dinamik öneri metni üret (3 ana koşul if-else zinciri)
    function _dinamikOneri(u) {
      const yuksekBlur = u.blur > 5;
      const dusukSepet = (u.sepet || 0) === 0 || (u.sepet || 0) < u.blur * 0.2;
      const yuksekSepet = (u.sepet || 0) > 2;
      const sifirSatis  = u.satis === 0;
      const yuksekSatis = u.satis > 2;
      const dusukBlur   = u.blur < 3;

      if (yuksekBlur && dusukSepet) {
        return { oneri: 'Fiyat/Teşhir Revizyonu — Çok bakılıyor ama sepete eklenmiyor.', icon: '💸', renk: '#fef2f2', kenar: '#fecaca', gerekce: 'Düşük Dönüşüm' };
      } else if (yuksekSepet && sifirSatis) {
        return { oneri: 'Taksit/Vade Farkı Kontrolü — Sepete alınıyor ama satışa dönmüyor.', icon: '📋', renk: '#fff7ed', kenar: '#fed7aa', gerekce: 'Yüksek Sepet / Sıfır Satış' };
      } else if (dusukBlur && yuksekSatis) {
        return { oneri: 'Fiyat Avantajlı — Az bakılan ama çok satan ürün. Öne çıkarın.', icon: '📢', renk: '#eff6ff', kenar: '#bfdbfe', gerekce: 'Keşfedilmemiş Değer' };
      }
      return null;
    }

    // Map<productId, öneri> — aynı ürün için duplicate oluşmaz
    const _tavsiyeMap = new Map();
    direktenDonenler.concat(sessizDegerler).concat(olduStok).forEach(u => {
      const entry = { urun: u.ad, blur: u.blur, satis: u.satis, sepet: u.sepet || 0, stok: u.stok || 0 };
      const dinamik = _dinamikOneri(u);
      if (dinamik) {
        if (!_tavsiyeMap.has(u.ad)) _tavsiyeMap.set(u.ad, { ...entry, kural: { ...dinamik, durum: dinamik.oneri }, _oncelik: 1 });
        return;
      }
      _tavsiyeKurallari.filter(k => k.aktif).forEach(kural => {
        try { if (kural.test(u) && !_tavsiyeMap.has(u.ad)) _tavsiyeMap.set(u.ad, { ...entry, kural: { ...kural, renk: '#f8fafc', kenar: '#e2e8f0' }, _oncelik: 2 }); } catch(e) {}
      });
    });
    const _tavsiyeListesiFinal = [..._tavsiyeMap.values()].sort((a,b) => b.blur - a.blur).slice(0,15);

    // ── HESAPLAMA SONUÇLARINI stats objesine topla ──────────────
    const _funnelStats = {
      gunAralik, gosterimLabel,
      tarihBas: cont.dataset.tarihBas, tarihBit: cont.dataset.tarihBit,
      totN, totS, totK, totHareketsiz, donusumGercek,
      momOturum, momSatis, momIcon, momCol,
      son7Logs, onc7Logs, bugunLogs,
      katMap,
      top3Pahali,
      // Ürün Isı Haritası
      vitrinsampiyonlari, direktenDonenler, sessizDegerler, olduStok,
      // L3 Pazarlık
      l3Toplam, l3Satis, l3Kacti, l3KactiHareketsiz, l3KayipCiro, l3Donusum,
      l3NedenSirali, l3UrunSirali, saatL3Kacti, l3SaatMax,
      // Personel
      personelHTML,
      // Saatlik barlar
      saatBar, blurBar, saatBlur, saatSatis, saatKacti,
      // YENİ: Funnel aşama totalleri
      funnelBlur, funnelSepet, funnelL3, funnelTeklif, funnelSatis,
      // YENİ: Otomatik tavsiyeler
      _tavsiyeListesi: _tavsiyeListesiFinal, _tavsiyeKurallari,
      // paylasBilgi için gereken ham veriler
      pMap,
      s7S, o7S,
      son7Logs, onc7Logs,
      // Aktif filtreler — paylasBilgi doğru okusun diye
      aktifFiltre,
      aktifMagaza,
      gosterimLabel
    };
    window._funnelCache = _funnelStats; // paylasBilgi doğrudan okur
    _renderFunnelHTML(cont, aktifFiltre, _funnelStats);

        console.log(`✅ Funnel analiz tamamlandı: ${logs.length} oturum işlendi.`);

  } catch(e) {
    console.error('loadFunnelAnaliz:', e);
    cont.innerHTML = `<div class="admin-empty" style="color:#dc2626">⚠️ Veri çekilemedi: ${e.message}</div>`;
  } finally {
    _isFunnelLoading = false;
  }
}


// ═══════════════════════════════════════════════════════════════
// FUNNEL RENDER FONKSİYONU — Katman Ayrımı
// Hesaplama (loadFunnelAnaliz) ile UI (render) birbirinden bağımsız
// ═══════════════════════════════════════════════════════════════
function _renderFunnelHTML(cont, aktifFiltre, s) {
  const aktifMagaza = cont.dataset.magazaFiltre || 'hepsi';
  const aktifTarihTip = cont.dataset.tarihTip || '90';
  const tarihBas = cont.dataset.tarihBas || '';
  const tarihBit = cont.dataset.tarihBit || '';
  // s = _funnelStats objesi
  const { gunAralik, gosterimLabel,
    totN, totS, totK, totHareketsiz, donusumGercek,
    momOturum, momSatis, momIcon, momCol,
    son7Logs, onc7Logs, bugunLogs,
    katMap, top3Pahali,
    vitrinsampiyonlari, direktenDonenler, sessizDegerler, olduStok,
    l3Toplam, l3Satis, l3Kacti, l3KactiHareketsiz, l3KayipCiro, l3Donusum,
    l3NedenSirali, l3UrunSirali, saatL3Kacti, l3SaatMax,
    personelHTML, saatBar, blurBar, saatBlur, saatSatis, saatKacti,
    funnelBlur, funnelSepet, funnelL3, funnelTeklif, funnelSatis,
    _tavsiyeListesi, _tavsiyeKurallari } = s;

  cont.innerHTML = `
<!-- ═══════════════════════════════════════════════════════
     PREMIUM FİLTRE PANELİ
     ═══════════════════════════════════════════════════════ -->
<div style="background:linear-gradient(160deg,#0f172a 0%,#1e293b 100%);border-radius:20px;padding:14px;margin-bottom:12px;box-shadow:0 4px 24px rgba(0,0,0,.18)">

  <!-- Başlık satırı -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
    <span style="font-size:.72rem;font-weight:800;color:#f1f5f9;letter-spacing:.04em">📊 ANALİZ FİLTRELERİ</span>
    <span style="font-size:.60rem;color:#64748b;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:2px 8px">
      ${totN} oturum · ${gosterimLabel}
    </span>
  </div>

  <!-- Hızlı Tarih Butonları -->
  <div style="display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap">
    ${[
      {tip:'bugun', l:'Bugün'},
      {tip:'hafta', l:'Son 7 Gün'},
      {tip:'30',    l:'Son 30 Gün'},
      {tip:'90',    l:'Son 90 Gün'}
    ].map(t=>`
      <button class="tarih-hizli-btn" data-tip="${t.tip}"
        onclick="setTarihAralik('${t.tip}')"
        style="padding:5px 12px;border-radius:20px;font-size:.68rem;font-weight:700;cursor:pointer;font-family:inherit;
          border:1.5px solid ${aktifTarihTip===t.tip?'#fbbf24':'#334155'};
          background:${aktifTarihTip===t.tip?'#0f172a':'rgba(255,255,255,.04)'};
          color:${aktifTarihTip===t.tip?'#fbbf24':'#94a3b8'};
          transition:all .12s">
        ${t.l}
      </button>`).join('')}
  </div>

  <!-- Manuel Tarih Aralığı -->
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap">
    <span style="font-size:.62rem;color:#64748b;font-weight:600;white-space:nowrap">📅 Özel:</span>
    <input id="funnel-tarih-bas" type="date" value="${tarihBas}"
      onchange="_onTarihInputChange()"
      style="padding:5px 9px;border-radius:10px;border:1.5px solid #334155;background:#1e293b;color:#f1f5f9;font-size:.68rem;font-family:inherit;outline:none;cursor:pointer">
    <span style="color:#475569;font-size:.75rem">→</span>
    <input id="funnel-tarih-bit" type="date" value="${tarihBit}"
      onchange="_onTarihInputChange()"
      style="padding:5px 9px;border-radius:10px;border:1.5px solid #334155;background:#1e293b;color:#f1f5f9;font-size:.68rem;font-family:inherit;outline:none;cursor:pointer">
    <button id="funnel-uygula-btn" onclick="setTarihManuel()"
      style="padding:5px 13px;border-radius:10px;border:none;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;font-size:.68rem;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 2px 8px rgba(37,99,235,.35);display:none">
      Uygula
    </button>
  </div>

  <!-- Ayraç -->
  <div style="height:1px;background:rgba(255,255,255,.06);margin-bottom:10px"></div>

  <!-- Rol + Mağaza Filtreleri -->
  <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">
    <span style="font-size:.60rem;color:#475569;font-weight:700;margin-right:2px">ROL</span>
    ${['saha','destek','admin','hepsi'].map(f=>`
      <button class="funnel-filter-btn" data-filter="${f}"
        onclick="setFunnelFilter('${f}')"
        style="padding:4px 11px;border-radius:20px;font-size:.66rem;font-weight:700;cursor:pointer;font-family:inherit;
          border:1.5px solid ${aktifFiltre===f?'var(--red)':'#334155'};
          background:${aktifFiltre===f?'var(--red)':'rgba(255,255,255,.04)'};
          color:${aktifFiltre===f?'#fff':'#94a3b8'}">
        ${f==='saha'?'👷 Saha':f==='destek'?'🖥 Destek':f==='admin'?'👑 Admin':'🌐 Tümü'}
      </button>`).join('')}
    <span style="font-size:.60rem;color:#475569;font-weight:700;margin-left:6px;margin-right:2px">MAĞAZA</span>
    ${[{k:'hepsi',l:'Tümü'},{k:'AVM',l:'🏬 AVM'},{k:'CARSI',l:'🏪 Çarşı'}].map(m=>`
      <button class="magaza-filter-btn" data-magaza="${m.k}"
        onclick="setMagazaFiltre('${m.k}')"
        style="padding:4px 11px;border-radius:20px;font-size:.66rem;font-weight:700;cursor:pointer;font-family:inherit;
          border:1.5px solid ${aktifMagaza===m.k?'#2563eb':'#334155'};
          background:${aktifMagaza===m.k?'#2563eb':'rgba(255,255,255,.04)'};
          color:${aktifMagaza===m.k?'#fff':'#94a3b8'}">
        ${m.l}
      </button>`).join('')}
  </div>

</div>

      <!-- Genel Özet -->
      <div style="background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:16px;padding:14px;margin-bottom:12px;color:#fff">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center;margin-bottom:10px">
          <div><div style="font-size:1.4rem;font-weight:800">${totN}</div><div style="font-size:.62rem;opacity:.6">Müşteri</div></div>
          <div><div style="font-size:1.4rem;font-weight:800;color:#22c55e">${totS}</div><div style="font-size:.62rem;opacity:.6">Satış</div></div>
          <div>
            <div style="font-size:1.4rem;font-weight:800;color:#ef4444">${totK}</div>
            <div style="font-size:.62rem;opacity:.6">Gerçek Kaçan</div>
            ${totHareketsiz > 0 ? `<div style="font-size:.56rem;opacity:.4;margin-top:1px">+${totHareketsiz} hareketsiz</div>` : ''}
          </div>
          <div><div style="font-size:1.4rem;font-weight:800;color:#22c55e">${donusumGercek}%</div><div style="font-size:.62rem;opacity:.6">Dönüşüm</div></div>
        </div>
        <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:1px solid rgba(255,255,255,.1);font-size:.72rem">
          <span>${momIcon} Son 7 gün vs önceki 7 gün: <b style="color:${momCol}">${Math.abs(momOturum)}% ${parseFloat(momOturum)>0?'↑ artış':'↓ azalış'}</b></span>
          <span>🎯 Dönüşüm Oranı: <b style="color:#22c55e">${donusumGercek}%</b></span>
        </div>
        <div style="font-size:.62rem;opacity:.4;text-align:center;margin-top:5px">Son 7 gün: ${son7Logs.length} · Önceki 7 gün: ${onc7Logs.length} · Bugün: ${bugunLogs.length}</div>
        ${totHareketsiz > 0 ? `<div style="margin-top:6px;padding:5px 8px;background:rgba(255,255,255,.06);border-radius:7px;font-size:.60rem;opacity:.65;text-align:center">
          🔕 Sistem Temizliği: ${totHareketsiz} hareketsizlik oturumu ciro kaybı hesabına dahil edilmedi
        </div>` : ''}
      </div>

      <!-- Sepet Kategorisi (Çeşitlilik Bazlı) -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">
        <div style="background:#fef3c7;border-radius:12px;padding:10px;text-align:center">
          <div style="font-size:1.3rem;font-weight:800;color:#92400e">🥇 ${katMap.Altin}</div>
          <div style="font-size:.62rem;color:#92400e;margin-top:2px">Altın (3+ çeşit)</div>
        </div>
        <div style="background:#f1f5f9;border-radius:12px;padding:10px;text-align:center">
          <div style="font-size:1.3rem;font-weight:800;color:#475569">🥈 ${katMap.Gumus}</div>
          <div style="font-size:.62rem;color:#475569;margin-top:2px">Gümüş (2 çeşit)</div>
        </div>
        <div style="background:#f8fafc;border-radius:12px;padding:10px;text-align:center">
          <div style="font-size:1.3rem;font-weight:800;color:#64748b">📦 ${katMap.Standart}</div>
          <div style="font-size:.62rem;color:#64748b;margin-top:2px">Standart (1 çeşit)</div>
        </div>
      </div>

      <!-- Fiyat İtirazı Top3 — min 3 itiraz eşiği. Eşik karşılanmazsa L3 kaçan ürünler gösterilir -->
      ${(() => {
        if (top3Pahali.length) {
          return `<div style="background:#fff5f5;border:1.5px solid #fecaca;border-radius:14px;padding:12px;margin-bottom:12px">
            <div style="font-size:.7rem;font-weight:800;color:#dc2626;margin-bottom:4px">💸 Fiyat İtirazı Alan Ürünler</div>
            <div style="font-size:.58rem;color:#dc2626;opacity:.6;margin-bottom:8px">En az 3 itiraz alan ürünler gösteriliyor</div>
            ${top3Pahali.map(([u,n],i)=>`
              <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #fee2e2;font-size:.75rem">
                <span>${['🥇','🥈','🥉'][i]} ${u}</span>
                <span style="font-weight:700;color:#dc2626">${n} itiraz</span>
              </div>`).join('')}
          </div>`;
        }
        if (l3UrunSirali && l3UrunSirali.length) {
          return `<div style="background:#fff5f5;border:1.5px solid #fecaca;border-radius:14px;padding:12px;margin-bottom:12px">
            <div style="font-size:.7rem;font-weight:800;color:#dc2626;margin-bottom:4px">🚪 L3'te En Çok Kaçan Ürünler</div>
            <div style="font-size:.58rem;color:#dc2626;opacity:.6;margin-bottom:8px">Fiyat itirazı eşiği karşılanmadı — abaküs pazarlığında kaçan ürünler</div>
            ${l3UrunSirali.slice(0,3).map(([u,v],i)=>`
              <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #fee2e2;font-size:.75rem">
                <span>${['🥇','🥈','🥉'][i]} ${u}</span>
                <span style="font-weight:700;color:#dc2626">${v.kacti} kaçış</span>
              </div>`).join('')}
          </div>`;
        }
        return '';
      })()}

      <!-- ÜRÜN ISI HARİTASI — 4 Davranış Grubu -->
      <div style="margin-bottom:14px">

        <!-- Grup başlık kutuları -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          <div style="background:linear-gradient(135deg,#fef3c7,#fffbeb);border:1.5px solid #fde68a;border-radius:12px;padding:10px;cursor:pointer" onclick="document.getElementById('_isi-dd').style.display=document.getElementById('_isi-dd').style.display==='none'?'block':'none'">
            <div style="font-size:.72rem;font-weight:800;color:#92400e">🔥 Direkten Dönenler</div>
            <div style="font-size:1.4rem;font-weight:900;color:#92400e">${direktenDonenler.length}</div>
            <div style="font-size:.60rem;color:#b45309">Çok ilgi, az satış — fiyat sorunu</div>
          </div>
          <div style="background:linear-gradient(135deg,#d1fae5,#f0fdf4);border:1.5px solid #6ee7b7;border-radius:12px;padding:10px;cursor:pointer" onclick="document.getElementById('_isi-vs').style.display=document.getElementById('_isi-vs').style.display==='none'?'block':'none'">
            <div style="font-size:.72rem;font-weight:800;color:#065f46">🏆 Vitrin Şampiyonları</div>
            <div style="font-size:1.4rem;font-weight:900;color:#065f46">${vitrinsampiyonlari.length}</div>
            <div style="font-size:.60rem;color:#15803d">Çok ilgi, çok satış — stok artır</div>
          </div>
          <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1.5px solid #93c5fd;border-radius:12px;padding:10px;cursor:pointer" onclick="document.getElementById('_isi-sd').style.display=document.getElementById('_isi-sd').style.display==='none'?'block':'none'">
            <div style="font-size:.72rem;font-weight:800;color:#1e40af">💎 Sessiz Değerler</div>
            <div style="font-size:1.4rem;font-weight:900;color:#1e40af">${sessizDegerler.length}</div>
            <div style="font-size:.60rem;color:#1d4ed8">Az ilgi, çok satış — öne çıkar</div>
          </div>
          <div style="background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:1.5px solid #cbd5e1;border-radius:12px;padding:10px;cursor:pointer" onclick="document.getElementById('_isi-os').style.display=document.getElementById('_isi-os').style.display==='none'?'block':'none'">
            <div style="font-size:.72rem;font-weight:800;color:#475569">❄️ Ölü Stok</div>
            <div style="font-size:1.4rem;font-weight:900;color:#475569">${olduStok.length}</div>
            <div style="font-size:.60rem;color:#64748b">Hiç ilgi yok — teşhir değiştir</div>
          </div>
        </div>

        <!-- Direkten Dönenler tablosu — Sayfalama + Kaçış Nedeni -->
        <div id="_isi-dd" style="display:block;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;overflow:hidden;margin-bottom:8px">
          <div style="padding:8px 10px;background:#fef3c7;font-size:.64rem;font-weight:800;color:#92400e;display:flex;justify-content:space-between">
            <span>🔥 Direkten Dönenler — Acil Fiyat/Taksit Revizyonu</span>
            <span style="opacity:.6">${direktenDonenler.length} ürün</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 38px 38px 38px 50px 1fr;gap:0;padding:4px 8px;background:#fef9c3;font-size:.56rem;font-weight:800;color:#78350f;border-bottom:1px solid #fde68a">
            <span>Ürün</span><span style="text-align:center">Blur</span><span style="text-align:center">Sepet</span><span style="text-align:center">Satış</span><span style="text-align:center">Dönüşüm</span><span style="text-align:center">En Sık Kaçış Nedeni</span>
          </div>
          <div id="_dd-rows"></div>
          <div id="_dd-pagination" style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#fef9c3;border-top:1px solid #fde68a;font-size:.60rem"></div>
        </div>

        <!-- Vitrin Şampiyonları -->
        <div id="_isi-vs" style="display:none;background:#f0fdf4;border:1px solid #86efac;border-radius:10px;overflow:hidden;margin-bottom:8px">
          <div style="padding:8px 10px;background:#d1fae5;font-size:.64rem;font-weight:800;color:#065f46;display:flex;justify-content:space-between">
            <span>🏆 Vitrin Şampiyonları — Stok Artır, Öne Çıkar</span>
            <span style="opacity:.6">${vitrinsampiyonlari.length} ürün</span>
          </div>
          ${vitrinsampiyonlari.slice(0,6).map(u =>
            '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #bbf7d0">' +
              '<span style="flex:1;font-size:.68rem;font-weight:600;color:#1e293b">' + u.ad + '</span>' +
              '<span style="font-size:.65rem;color:#f59e0b">👁 ' + u.blur + '</span>' +
              '<span style="font-size:.65rem;color:#16a34a;font-weight:700">✅ ' + u.satis + '</span>' +
            '</div>'
          ).join('')}
        </div>

        <!-- Sessiz Değerler -->
        <div id="_isi-sd" style="display:none;background:#eff6ff;border:1px solid #93c5fd;border-radius:10px;overflow:hidden;margin-bottom:8px">
          <div style="padding:8px 10px;background:#dbeafe;font-size:.64rem;font-weight:800;color:#1e40af;display:flex;justify-content:space-between">
            <span>💎 Sessiz Değerler — Görünürlüğü Artır veya Fiyatı Yükselt</span>
            <span style="opacity:.6">${sessizDegerler.length} ürün</span>
          </div>
          ${sessizDegerler.slice(0,6).map(u =>
            '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #bfdbfe">' +
              '<span style="flex:1;font-size:.68rem;font-weight:600;color:#1e293b">' + u.ad + '</span>' +
              '<span style="font-size:.65rem;color:#94a3b8">👁 ' + u.blur + '</span>' +
              '<span style="font-size:.65rem;color:#16a34a;font-weight:700">✅ ' + u.satis + '</span>' +
            '</div>'
          ).join('')}
        </div>

        <!-- Ölü Stok -->
        <div id="_isi-os" style="display:none;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:8px">
          <div style="padding:8px 10px;background:#f1f5f9;font-size:.64rem;font-weight:800;color:#475569;display:flex;justify-content:space-between">
            <span>❄️ Ölü Stok — Teşhir veya İndirim Gerekiyor</span>
            <span style="opacity:.6">${olduStok.length} ürün</span>
          </div>
          ${olduStok.slice(0,8).map(u =>
            '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #e2e8f0">' +
              '<span style="flex:1;font-size:.68rem;font-weight:600;color:#475569">' + u.ad + '</span>' +
              '<span style="font-size:.65rem;color:#94a3b8">Stok: ' + u.stok + '</span>' +
              '<span style="font-size:.65rem;color:#64748b">' + fmt(u.nakit) + '</span>' +
            '</div>'
          ).join('')}
        </div>

      </div>

            <!-- Personel Kartları -->
      <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:16px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:.72rem;font-weight:800;color:#f1f5f9;letter-spacing:.04em">👤 PERSONEL ANALİZİ</div>
          <div style="font-size:.60rem;color:#64748b;margin-top:2px">${gosterimLabel} · ${Object.keys(s.personelHTML ? {} : {}).length || ''} ${aktifFiltre==='saha'?'Saha':aktifFiltre==='destek'?'Destek':aktifFiltre==='admin'?'Admin':'Tüm'} personel</div>
        </div>
        <button onclick="paylasBilgi()"
          style="padding:6px 13px;border-radius:12px;border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;font-size:.66rem;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 2px 8px rgba(22,163,74,.35);white-space:nowrap">
          📤 Haftalık Bilgi
        </button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:14px">
        ${personelHTML}
      </div>

      <!-- Satış & Kaçan Yoğunluğu -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:12px">
        <div style="font-size:.68rem;font-weight:700;color:var(--text-3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">⏰ Satış & Kaçan Yoğunluğu</div>
        <div style="display:flex;gap:10px;font-size:.6rem;margin-bottom:6px">
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#16a34a;margin-right:3px"></span>Satış</span>
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#dc2626;margin-right:3px"></span>Kaçan</span>
        </div>
        ${saatBar}
      </div>

      <!-- L3 PAZARLİK ANALİZİ -->
      <div style="background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:14px;padding:14px;margin-bottom:12px;color:#fff">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div>
            <div style="font-size:.72rem;font-weight:800;letter-spacing:.04em">🎯 Pazarlık (L3) Analizi</div>
            <div style="font-size:.62rem;opacity:.5;margin-top:2px">Abaküse kadar gelen müşteriler</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:1.5rem;font-weight:900;color:#dc2626;letter-spacing:-.02em;line-height:1">${fmt(l3KayipCiro)}</div>
            <div style="font-size:.58rem;color:#dc2626;opacity:.7;font-weight:700;margin-top:2px">⚠️ kaçırılan ciro</div>
          </div>
        </div>

        <!-- L3 özet sayaçlar -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:12px">
          <div style="background:rgba(255,255,255,.07);border-radius:10px;padding:8px;text-align:center">
            <div style="font-size:1.1rem;font-weight:800">${l3Toplam}</div>
            <div style="font-size:.58rem;opacity:.5">Abaküs</div>
          </div>
          <div style="background:rgba(34,197,94,.15);border-radius:10px;padding:8px;text-align:center">
            <div style="font-size:1.1rem;font-weight:800;color:#22c55e">${l3Satis}</div>
            <div style="font-size:.58rem;opacity:.5">Satış</div>
          </div>
          <div style="background:rgba(239,68,68,.15);border-radius:10px;padding:8px;text-align:center">
            <div style="font-size:1.1rem;font-weight:800;color:#ef4444">${l3Kacti}</div>
            <div style="font-size:.58rem;opacity:.5">Kaçan</div>
          </div>
          <div style="background:rgba(255,255,255,.07);border-radius:10px;padding:8px;text-align:center">
            <div style="font-size:1.1rem;font-weight:800;color:${parseFloat(l3Donusum)>=50?'#22c55e':parseFloat(l3Donusum)>=30?'#f59e0b':'#ef4444'}">${l3Donusum}%</div>
            <div style="font-size:.58rem;opacity:.5">Kapanış</div>
          </div>
        </div>

        <!-- Neden dağılımı -->
        ${l3NedenSirali.length ? '<div style="margin-bottom:10px">' +
          '<div style="font-size:.62rem;font-weight:700;opacity:.5;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Kaçış Nedenleri (Gerçek Müşteri)</div>' +
          l3NedenSirali.map(([n,c]) => {
            const pct = l3Kacti===0?0:Math.round(c/l3Kacti*100);
            return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">' +
              '<div style="flex:1;font-size:.68rem;color:rgba(255,255,255,.75)">' + n + '</div>' +
              '<div style="width:90px;height:5px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden">' +
                '<div style="width:' + pct + '%;height:100%;background:#ef4444;border-radius:3px"></div>' +
              '</div>' +
              '<div style="font-size:.65rem;font-weight:700;color:#ef4444;min-width:26px;text-align:right">' + c + '</div>' +
            '</div>';
          }).join('') +
          (l3KactiHareketsiz > 0 ?
            '<div style="margin-top:8px;padding:6px 8px;background:rgba(255,255,255,.05);border-radius:6px;display:flex;align-items:center;justify-content:space-between">' +
              '<div style="font-size:.62rem;color:rgba(255,255,255,.4)">🔕 Sistem Temizliği (Hareketsizlik)</div>' +
              '<div style="font-size:.65rem;color:rgba(255,255,255,.3);font-weight:700">' + l3KactiHareketsiz + ' — ciro dahil değil</div>' +
            '</div>' : '') +
          '</div>' : ''}

        <!-- En çok kaçırılan ürünler -->
        ${l3UrunSirali.length ? '<div>' +
          '<div style="font-size:.62rem;font-weight:700;opacity:.5;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Direkten Dönen Ürünler</div>' +
          l3UrunSirali.map(([u, v], i) =>
            '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06)">' +
              '<span style="font-size:.60rem;font-weight:800;color:rgba(255,255,255,.3);min-width:14px">' + (i+1) + '</span>' +
              '<span style="flex:1;font-size:.68rem;color:rgba(255,255,255,.8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + u + '</span>' +
              '<span style="font-size:.65rem;font-weight:700;color:#ef4444">' + v.kacti + ' kacti</span>' +
            '</div>'
          ).join('') + '</div>' : ''}

        <!-- Saatlik L3 kaçış dağılımı -->
        <div style="margin-top:10px">
          <div style="font-size:.62rem;font-weight:700;opacity:.5;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Saatlik L3 Kayıp</div>
          <!-- Çubuk + sayı etiketi — sadece değer>0 olanlarda göster -->
          <div style="display:flex;align-items:flex-end;gap:2px;height:44px">
            ${[...Array(24).keys()].map(h => {
              const v = saatL3Kacti[h];
              const hPct = v === 0 ? 0 : Math.round(v/l3SaatMax*100);
              const barH = Math.max(2, hPct);
              const etiket = v > 0
                ? '<span style="position:absolute;bottom:100%;left:50%;transform:translateX(-50%);font-size:.44rem;font-weight:800;color:#ef4444;white-space:nowrap;margin-bottom:1px">' + v + '</span>'
                : '';
              return '<div title="' + (h<10?'0'+h:h) + ':00 — ' + v + ' kaçan" ' +
                'style="flex:1;position:relative;display:flex;align-items:flex-end;justify-content:center">' +
                etiket +
                '<div style="width:100%;background:' +
                (hPct>0?'rgba(239,68,68,'+Math.max(0.2,hPct/100)+')':'rgba(255,255,255,.05)') +
                ';border-radius:2px 2px 0 0;height:' + barH + '%;min-height:2px"></div>' +
                '</div>';
            }).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;font-size:.52rem;opacity:.3;margin-top:2px">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
          </div>
        </div>
      </div>

      <!-- Saatlik Blur Yoğunluğu — Isı Haritası -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:12px;margin-bottom:12px">
        <div style="font-size:.68rem;font-weight:700;color:var(--text-3);margin-bottom:3px;text-transform:uppercase;letter-spacing:.06em">🔥 Ticari Verimlilik (Satış vs Kaçan)</div>
        <div style="font-size:.58rem;color:var(--text-3);margin-bottom:8px">Hangi saatte para kazandık, hangi saatte müşteri kaçırdık?</div>
        ${(() => {
          // En yoğun 3 saati belirle
          const combined = [...Array(24).keys()].map(h => ({ h, tot: saatSatis[h]+saatKacti[h]+saatBlur[h] }));
          const top3 = [...combined].sort((a,b)=>b.tot-a.tot).slice(0,3);
          const top3html = top3.filter(x=>x.tot>0).map((x,i)=>`
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:.62rem;text-align:center">
              <div style="font-weight:800;font-size:.8rem;color:#1e293b">${x.h<10?'0'+x.h:x.h}:00</div>
              <div style="color:#64748b;margin-top:2px">${saatBlur[x.h]} blur · ${saatSatis[x.h]} satış · ${saatKacti[x.h]} kaçan</div>
              <div style="font-size:.56rem;color:#94a3b8">${['🥇 En yoğun','🥈 2. yoğun','🥉 3. yoğun'][i]}</div>
            </div>`).join('');
          const maxHeat = Math.max(...combined.map(x=>x.tot), 1);
          const heatColors = ['#dbeafe','#93c5fd','#3b82f6','#1d4ed8','#1e3a8a'];
          const heatGrid = `<div style="display:grid;grid-template-columns:repeat(24,1fr);gap:2px;margin:8px 0">
            ${combined.map(({h,tot}) => {
              const idx = tot===0?0:Math.min(4,Math.ceil(tot/maxHeat*5));
              const pct = tot===0?0:Math.round(tot/maxHeat*100);
              return `<div title="${h<10?'0'+h:h}:00 — ${saatBlur[h]} blur, ${saatSatis[h]} satış, ${saatKacti[h]} kaçan"
                style="height:28px;border-radius:3px;background:${heatColors[idx]};cursor:help;position:relative"></div>`;
            }).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;font-size:.52rem;color:var(--text-3)">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
          </div>
          <div style="display:flex;align-items:center;gap:4px;margin-top:6px;font-size:.58rem;color:var(--text-3)">
            <span>Düşük</span>
            ${heatColors.map(c=>`<div style="width:14px;height:8px;border-radius:2px;background:${c}"></div>`).join('')}
            <span>Yüksek</span>
          </div>`;
          return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin-bottom:8px">${top3html}</div>${heatGrid}`;
        })()}
      </div>

      <!-- SATIŞ HUNİSİ (Funnel) GRAFİĞİ -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:12px">
        <div style="font-size:.68rem;font-weight:700;color:var(--text-3);margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em">🔽 Satış Hunisi — Darboğaz Analizi</div>
        <div style="font-size:.58rem;color:var(--text-3);margin-bottom:12px">Her aşamadaki müşteri kaybı</div>
        ${(() => {
          const asamalar = [
            { ad:'👁 Fiyat Baktı (Blur)', sayi: funnelBlur,   renk:'#3b82f6' },
            { ad:'🛒 Sepete Ekledi',       sayi: funnelSepet,  renk:'#8b5cf6' },
            { ad:'🧮 Abaküs Açtı (L3)',    sayi: funnelL3,     renk:'#f59e0b' },
            { ad:'📋 Teklif Verdi',         sayi: funnelTeklif, renk:'#f97316' },
            { ad:'✅ Satış',               sayi: funnelSatis,  renk:'#16a34a' },
          ];
          const maxSayi = Math.max(asamalar[0].sayi, 1);
          return asamalar.map((a, i) => {
            // Çubuk genişliği: her zaman ilk adıma (Blur) göre - görsel proporsiyon için
            const barPct = Math.min(100, Math.round(a.sayi / maxSayi * 100));
            // Adım oranı: bir önceki adıma göre (kademeli dönüşüm)
            const oncekiSayi = i === 0 ? a.sayi : asamalar[i-1].sayi;
            const adimDonusumPct = oncekiSayi === 0 ? 0 : Math.min(100, Math.round(a.sayi / oncekiSayi * 100));
            const kayip = Math.max(0, oncekiSayi - a.sayi);
            const kayipPct = oncekiSayi === 0 ? 0 : Math.min(100, Math.round(kayip / oncekiSayi * 100));
            return `<div style="margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
                <span style="font-size:.68rem;font-weight:600;color:#1e293b">${a.ad}</span>
                <div style="display:flex;align-items:center;gap:8px">
                  ${i>0 && kayip>0 ? `<span style="font-size:.58rem;color:#dc2626;font-weight:700">▼ ${kayipPct}% (${kayip} kişi)</span>` : ''}
                  <span style="font-size:.72rem;font-weight:800;color:${a.renk}">${a.sayi}</span>
                </div>
              </div>
              <div style="height:20px;border-radius:6px;background:#f1f5f9;overflow:hidden">
                <div style="width:${barPct}%;height:100%;background:${a.renk};border-radius:6px;transition:width .3s;display:flex;align-items:center;padding-left:6px">
                  ${barPct>10 && i>0 ? `<span style="font-size:.56rem;color:#fff;font-weight:700">${adimDonusumPct}%</span>` : ''}
                </div>
              </div>
            </div>`;
          }).join('');
        })()}
        ${funnelBlur > 0 ? `
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <div style="flex:1;min-width:120px;background:#fef2f2;border-radius:8px;padding:8px;font-size:.64rem;color:#dc2626">
            ⚠️ Abaküs → Satış: <b>${l3Donusum}%</b> — ${parseFloat(l3Donusum)<20?'Acil müdahale!':parseFloat(l3Donusum)<40?'İyileştirme gerekli.':'İyi seviye.'}
          </div>
          ${l3KayipCiro > 0 ? `<div style="flex:1;min-width:120px;background:#fef2f2;border:1.5px solid #fecaca;border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:.58rem;color:#dc2626;font-weight:700;margin-bottom:2px">💸 Kaçırılan Potansiyel Ciro</div>
            <div style="font-size:1.1rem;font-weight:900;color:#dc2626;letter-spacing:-.01em">${fmt(l3KayipCiro)}</div>
          </div>` : ''}
        </div>` : ''}
      </div>

      <!-- OTOMATİK TAVSİYE MOTORU -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="font-size:.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em">🤖 Otomatik Tavsiye Motoru</div>
          <button onclick="document.getElementById('_tavsiye-kural-panel').style.display=document.getElementById('_tavsiye-kural-panel').style.display==='none'?'block':'none'"
            style="font-size:.60rem;padding:3px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-2);cursor:pointer;font-family:inherit">
            ⚙️ Kuralları Düzenle
          </button>
        </div>
        <div style="font-size:.58rem;color:var(--text-3);margin-bottom:10px">${_tavsiyeListesi.length} aksiyon önerisi üretildi</div>

        <!-- Tavsiye Listesi -->
        ${_tavsiyeListesi.length ? `
        <div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;padding-right:2px">
          ${_tavsiyeListesi.slice(0,15).map(t=>`
          <div style="display:flex;align-items:flex-start;gap:8px;background:${t.kural.renk||'#f8fafc'};border-radius:8px;padding:8px 10px;border:1px solid ${t.kural.kenar||'#e2e8f0'}">
            <span style="font-size:1rem;margin-top:1px">${t.kural.icon}</span>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px">
                <span style="font-size:.68rem;font-weight:700;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%">${t.urun}</span>
                <span style="font-size:.56rem;font-weight:700;padding:1px 6px;border-radius:10px;background:rgba(0,0,0,.07);color:#475569;white-space:nowrap">${t.kural.durum || t.kural.oneri.split('—')[0].trim()}</span>
              </div>
              <div style="font-size:.62rem;color:#475569;margin-bottom:3px">${t.kural.oneri}</div>
              <div style="display:flex;gap:8px;font-size:.56rem;color:#94a3b8">
                <span>Görüntüleme (Blur): <b style="color:#f59e0b">${t.blur}</b></span>
                <span>Sepet: <b>${t.sepet}</b></span>
                <span>Satış: <b style="color:#16a34a">${t.satis}</b></span>
                <span>Stok: <b>${t.stok}</b></span>
              </div>
            </div>
          </div>`).join('')}
        </div>` : `<div style="text-align:center;padding:16px;color:var(--text-3);font-size:.68rem">✅ Kritik aksiyon gerektiren ürün bulunamadı</div>`}

        <!-- Kural Düzenleme Paneli -->
        <div id="_tavsiye-kural-panel" style="display:none;margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
          <div style="font-size:.64rem;font-weight:700;color:var(--text-2);margin-bottom:8px">🛠 Tavsiye Kuralları — Aktif/Pasif yapabilirsiniz</div>
          <div id="_kural-listesi"></div>
          <button onclick="_saveTavsiyeKurallari()"
            style="margin-top:8px;width:100%;padding:8px;background:var(--black);color:#fff;border:none;border-radius:8px;font-size:.68rem;font-weight:700;cursor:pointer;font-family:inherit">
            💾 Kuralları Kaydet
          </button>
        </div>
      </div>

      <!-- Sistem Şeffaflığı Footer -->
      ${totHareketsiz > 0 ? `
      <div style="margin-top:8px;padding:8px 12px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;font-size:.60rem;color:#64748b;text-align:center">
        💡 Bilgi: <b>${totHareketsiz}</b> adet sistem temizliği (hareketsizlik) oturumu, ciro kaybı hesabından hariç tutulmuştur. Gerçek kaçış verisi kirletilmemektedir.
      </div>` : ''}
    `;  /* ── RENDER SONU ── */


  // ── POST-RENDER: Direkten Dönenler Pagination ──────────────────
  (function() {
    const PER_PAGE = 20;
    let _ddPage = 0;
    const ddData = direktenDonenler;

    function _renderDDPage(page) {
      const rows = document.getElementById('_dd-rows');
      const pag  = document.getElementById('_dd-pagination');
      if (!rows || !pag) return;
      const start = page * PER_PAGE;
      const slice = ddData.slice(start, start + PER_PAGE);
      rows.innerHTML = slice.map(u => {
        const don = u.blur===0?0:Math.round(u.satis/u.blur*100);
        const donCol = don>=30?'#16a34a':don>=10?'#f59e0b':'#dc2626';
        // Ürün bazında en sık kaçış nedeni
        const nedenEntries = Object.entries(u.nedenMap || {}).sort((a,b)=>b[1]-a[1]);
        const topNeden = nedenEntries.length ? nedenEntries[0] : null;
        const nedenHtml = topNeden
          ? `<span style="font-size:.58rem;color:#92400e;font-weight:700">${topNeden[0]} <span style="opacity:.6">(${topNeden[1]}x)</span></span>`
          : `<span style="font-size:.58rem;color:#94a3b8">—</span>`;
        return `<div style="display:grid;grid-template-columns:1fr 38px 38px 38px 50px 1fr;padding:5px 8px;border-bottom:1px solid #fef3c7;align-items:center">
          <span style="font-size:.66rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1e293b">${u.ad}</span>
          <span style="text-align:center;font-size:.68rem;font-weight:700;color:#f59e0b">${u.blur}</span>
          <span style="text-align:center;font-size:.68rem;font-weight:700;color:#8b5cf6">${u.sepet||0}</span>
          <span style="text-align:center;font-size:.68rem;font-weight:700;color:#16a34a">${u.satis}</span>
          <span style="text-align:center;font-size:.68rem;font-weight:800;color:${donCol}">${don}%</span>
          <span style="padding-left:4px">${nedenHtml}</span>
        </div>`;
      }).join('');

      const totalPages = Math.ceil(ddData.length / PER_PAGE);
      pag.innerHTML = totalPages <= 1 ? '' :
        `<span style="color:#92400e;font-weight:700">${start+1}–${Math.min(start+PER_PAGE,ddData.length)} / ${ddData.length}</span>
         <div style="display:flex;gap:4px">
           <button onclick="window._ddNav(-1)" style="padding:3px 8px;border-radius:5px;border:1px solid #fde68a;background:${page===0?'#fef3c7':'#92400e'};color:${page===0?'#b45309':'#fff'};font-size:.60rem;cursor:pointer;font-family:inherit" ${page===0?'disabled':''}>‹</button>
           <button onclick="window._ddNav(1)"  style="padding:3px 8px;border-radius:5px;border:1px solid #fde68a;background:${page>=totalPages-1?'#fef3c7':'#92400e'};color:${page>=totalPages-1?'#b45309':'#fff'};font-size:.60rem;cursor:pointer;font-family:inherit" ${page>=totalPages-1?'disabled':''}>›</button>
         </div>`;
    }

    window._ddNav = function(dir) {
      const totalPages = Math.ceil(ddData.length / PER_PAGE);
      _ddPage = Math.max(0, Math.min(totalPages-1, _ddPage + dir));
      _renderDDPage(_ddPage);
    };
    _renderDDPage(0);
  })();

  // ── POST-RENDER: Kural Paneli Yükle ─────────────────────────────
  (function() {
    const kListEl = document.getElementById('_kural-listesi');
    if (!kListEl) return;
    let _editKurallari = JSON.parse(JSON.stringify(_tavsiyeKurallari));
    kListEl.innerHTML = _editKurallari.map((k,i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <label style="position:relative;width:32px;height:18px;flex-shrink:0">
          <input type="checkbox" id="_kural_${i}" ${k.aktif?'checked':''} onchange="window._tavsiyeKurallariEdit[${i}].aktif=this.checked"
            style="opacity:0;width:0;height:0;position:absolute">
          <span style="position:absolute;inset:0;background:${k.aktif?'#16a34a':'#cbd5e1'};border-radius:9px;cursor:pointer;transition:background .2s"></span>
          <span style="position:absolute;top:2px;left:${k.aktif?'16':'2'}px;width:14px;height:14px;background:#fff;border-radius:50%;transition:left .2s"></span>
        </label>
        <div style="flex:1;min-width:0">
          <div style="font-size:.62rem;font-weight:700;color:#1e293b">${k.icon} ${k.durum}</div>
          <input type="text" value="${k.oneri}" onchange="window._tavsiyeKurallariEdit[${i}].oneri=this.value"
            style="width:100%;margin-top:2px;padding:4px 6px;font-size:.60rem;border:1px solid var(--border);border-radius:5px;font-family:inherit;color:var(--text-1);background:var(--surface)">
        </div>
      </div>`).join('');
    window._tavsiyeKurallariEdit = _editKurallari;
  })();

  window._saveTavsiyeKurallari = function() {
    try {
      // Toggle'ları da güncelle
      if (window._tavsiyeKurallariEdit) {
        window._tavsiyeKurallariEdit.forEach((k,i) => {
          const cb = document.getElementById('_kural_'+i);
          if (cb) k.aktif = cb.checked;
        });
        localStorage.setItem('aygun_tavsiye_kurallari', JSON.stringify(window._tavsiyeKurallariEdit));
        showToast('✅ Kurallar kaydedildi');
        document.getElementById('_tavsiye-kural-panel').style.display = 'none';
      }
    } catch(e) { showToast('❌ Kayıt hatası'); }
  };

} // _renderFunnelHTML sonu

// loadFunnelAnaliz üzerine filtre değişkeni ekle (butonlar için)
loadFunnelAnaliz.filtre = 'saha';

window.openAdmin = async function() {
  console.log("Admin Paneli Açılıyor, Kullanıcı:", currentUser);
  
  // Rol kontrolü (büyük/küçük harf duyarsız)
  const userRole = (currentUser?.Rol || "").toLowerCase();
  if (userRole !== 'admin') {
    console.warn("Yetkisiz erişim denemesi. Rol:", userRole);
    if (typeof ayAlert === 'function') {
      await ayAlert("Yetkisiz Erişim! Admin paneli için admin yetkisi gerekir.");
    } else {
      alert("Yetkisiz Erişim! Admin paneli için admin yetkisi gerekir.");
    }
    return;
  }

  const modal = document.getElementById('admin-modal');
  if (!modal) {
    console.error("HATA: 'admin-modal' ID'li element HTML içinde bulunamadı!");
    return;
  }

  // Modalı göster
  modal.style.zIndex = "9999";
  modal.style.display = 'flex';
  modal.classList.add('open');

  // ✅ DÜZELTME — 5 sekme mobil CSS enjeksiyonu (bir kez eklenir)
  if (!document.getElementById('_admin-5tab-css')) {
    const st = document.createElement('style');
    st.id = '_admin-5tab-css';
    st.textContent = `
      /* 5 sekme: scrollable tab bar, kompakt */
      .admin-tabs {
        display: flex;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        gap: 0;
        border-bottom: 2px solid var(--border);
        background: var(--surface);
      }
      .admin-tabs::-webkit-scrollbar { display: none; }
      .admin-tab {
        flex: 0 0 auto;
        padding: 10px 16px;
        font-size: .75rem;
        font-weight: 700;
        white-space: nowrap;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        color: var(--text-2);
        background: none;
        border-left: none;
        border-right: none;
        border-top: none;
        transition: color .15s, border-color .15s;
      }
      .admin-tab.active {
        color: var(--red);
        border-bottom-color: var(--red);
      }
      /* Analiz sekmesi içi: Funnel üstte, Ürün Pop. + Uyuyan alt panel */
      .analiz-sub-section {
        margin-top: 18px;
        border-top: 1.5px solid var(--border);
        padding-top: 14px;
      }
      .analiz-sub-title {
        font-size: .68rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .07em;
        color: var(--text-3);
        margin-bottom: 10px;
      }
      /* Proposals sekmesi içi: arşiv alt panel */
      .arsiv-sub-section {
        margin-top: 18px;
        border-top: 1.5px solid var(--border);
        padding-top: 14px;
      }
    `;
    document.head.appendChild(st);
  }

  // Admin header'ı güncelle
  const hdrUser = document.getElementById('admin-header-user');
  if (hdrUser) {
    hdrUser.textContent = currentUser?.Email?.split('@')[0] || '—';
  }

  // İçeriği try-catch ile yükle (hata olsa bile modal açık kalır)
  try {
    await renderAdminPanel();
    console.log("Admin paneli başarıyla yüklendi.");
  } catch (err) {
    console.error("Admin Paneli içeriği yüklenirken hata oluştu:", err);
    const body = document.querySelector('.admin-body');
    if (body) {
      body.innerHTML = '<div class="admin-empty" style="color:#dc2626; padding:20px;">⚠️ Admin paneli yüklenirken hata oluştu. Sayfayı yenileyip tekrar deneyin.</div>';
    }
  }

  // Otomatik yenileme timer (overview sekmesi için)
  if (window._adminRefreshTimer) clearInterval(window._adminRefreshTimer);
  window._adminRefreshTimer = setInterval(() => {
    const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
    if (!adminOpen) {
      clearInterval(window._adminRefreshTimer);
      return;
    }
    const activeTab = document.querySelector('.admin-tab.active')?.dataset?.tab;
    if (activeTab === 'overview' || !activeTab) {
      renderAdminPanel().catch(e => console.warn("Auto-refresh hatası:", e));
    }
  }, 60000);
};
function closeAdmin() {
  const m=document.getElementById('admin-modal');
  m.classList.remove('open'); m.style.display='none';
  if(window._adminRefreshTimer) { clearInterval(window._adminRefreshTimer); window._adminRefreshTimer=null; }
}
function switchAdminTab(tab) {
  // ✅ DÜZELTME — 5 sekme yapısı:
  // 'products' → 'analiz' sekmesinin içindeki alt bölüm olarak açılır
  // 'arsiv'    → 'proposals' (Teklif) sekmesinin içinde görünür
  // Eski sekme adı gelirse yönlendir
  if (tab === 'products') { tab = 'analiz'; }
  if (tab === 'arsiv')    { tab = 'proposals'; }

  document.querySelectorAll('.admin-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  document.querySelectorAll('.admin-tab-content').forEach(c=>c.classList.toggle('active',c.id==='tab-'+tab));
  if(tab==='proposals') {
    renderProposals(document.getElementById('admin-proposals-list'), true);
    // Arşiv alt panelini de güncelle
    renderArchivedProposals();
  }
  if(tab==='siparis')  { renderSiparisPanel(); updateSiparisBadge(); }
  if(tab==='sepetler') { renderSepetDetay(); }
  if(tab==='personel') { renderAdminUsers(); }
  if(tab==='analiz')   {
    // Analiz sekmesi: Funnel + Ürün Popülerliği + Uyuyan Stok
    loadFunnelAnaliz();
    renderAdminProducts();
    const urunList = (allProducts&&allProducts.length) ? allProducts
                   : (window._cachedUrunler&&window._cachedUrunler.length) ? window._cachedUrunler
                   : [];
    if(urunList.length) {
      renderUyuyanStok(urunList);
    } else {
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
  // İndirim raporu özeti — indirim kullanan personel
  _renderIndirimOzet();
  // Motd listesi — admin görüntüleyebilsin
  renderMotdPanel();
  // Vitrin ürünleri listesi
  renderAdminVitrinList();
}
// Özet panelinde analizi yükle (manuel buton ile yapılacak)
// loadSepetAnaliz();

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
      loginAt: new Date().toISOString(),
      forceLogout: false
    });
    // Heartbeat — her 60 sn'de güncelle
    if(window._sessionHeartbeat) clearInterval(window._sessionHeartbeat);
    window._sessionHeartbeat = setInterval(()=>{
      if(!currentUser||!_db) { clearInterval(window._sessionHeartbeat); return; }
      setDoc(doc(_db,'sessions',sessionId),{lastSeen:new Date().toISOString()},{merge:true}).catch(()=>{});
    },60000);
  } catch(e) { console.warn('Session check failed:', e); }
}

// Sessions listener — admin tüm oturumları, personel kendi oturumunu dinler
window._fbSessions = {};
function _startSessionListener() {
  if(!_db) return;

  // Personel: kendi session belgesini dinle — forceLogout kontrolü
  if(!isAdmin()) {
    const _myId = localStorage.getItem('_aygun_session_id');
    if(_myId) {
      if(window._mySessionUnsub) window._mySessionUnsub();
      window._mySessionUnsub = onSnapshot(
        doc(_db, 'sessions', _myId),
        (snap) => {
          if(!snap.exists()) {
            if(currentUser) ayAlert('⚠️ Oturumunuz sonlandırıldı. Lütfen tekrar giriş yapın.').then(() => logoutUser());
            return;
          }
          if(snap.data().forceLogout === true) {
            if(currentUser) ayAlert('⚠️ Yönetici tarafından oturumunuz kapatıldı. Lütfen tekrar giriş yapın.').then(() => logoutUser());
          }
        },
        (err) => console.warn('Session listener:', err)
      );
    }
    return;
  }

  // Admin: tüm oturumları izle
  onSnapshot(collection(_db,'sessions'), snap => {
    window._fbSessions    = {};
    window._activeSessions = {};
    snap.docs.forEach(d => {
      window._fbSessions[d.id]    = d.data();
      window._activeSessions[d.id] = d.data();
    });
    const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
    if(adminOpen && document.querySelector('.admin-tab.active')?.dataset?.tab === 'personel') {
      renderAdminUsers();
    }
  }, ()=>{});
}

// ─── ARŞİV PANEL ────────────────────────────────────────────────
function renderArchivedProposals() {
  const el = document.getElementById('admin-arsiv-list');
  if(!el) { return; }

  // Janitor butonu
  const lastRun = parseInt(localStorage.getItem(_JANITOR_KEY) || '0', 10);
  const daysSince = lastRun ? Math.round((Date.now()-lastRun)/86400000) : null;
  const janitorInfo = daysSince !== null
    ? `Son temizlik: ${daysSince} gün önce`
    : 'Henüz temizlik yapılmadı';
  const janitorBar = `<div style="display:flex;align-items:center;justify-content:space-between;`
    + `padding:10px 14px;background:var(--surface-2);border-bottom:1px solid var(--border);`
    + `font-size:.72rem;color:var(--text-2);">`
    + `<span>🧹 <strong>Arşiv Temizliği</strong> — ${janitorInfo} (30 gün+ silinir)</span>`
    + `<button onclick="adminRunJanitor()" style="background:#fee2e2;border:none;border-radius:6px;`
    + `padding:5px 12px;font-size:.70rem;color:#dc2626;cursor:pointer;font-family:inherit;font-weight:700;`
    + `transition:background .15s" onmouseover="this.style.background='#fecaca'" `
    + `onmouseout="this.style.background='#fee2e2'">Temizle</button></div>`;

  const archived = proposals
    .filter(p => !!p.archivedAt)
    .sort((a,b)=>new Date(b.archivedAt)-new Date(a.archivedAt));

  if(!archived.length) {
    el.innerHTML = janitorBar + '<div class="admin-empty">📦 Arşiv boş<br><span style="font-size:.72rem;color:var(--text-3)">İptal, satışa dönen ve süresi dolan teklifler burada listelenir</span></div>';
    return;
  }
  const statusLabel = {bekliyor:'⏳',satisDondu:'✅',iptal:'✕',sureDoldu:'⌛'};
  el.innerHTML = janitorBar + archived.map(p => {
    const iptalNeden = p.iptalNedeni ? `<div style="font-size:.62rem;color:#dc2626;margin-top:2px">↳ ${p.iptalNedeni}</div>` : '';
    const snapshotTag = p.finalSnapshot ? `<span style="font-size:.60rem;background:#dcfce7;color:#15803d;padding:1px 5px;border-radius:3px;font-weight:600">📸 Snapshot</span>` : '';
    return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 12px;border-bottom:1px solid var(--border);font-size:.76rem;">
      <span style="font-size:1rem;margin-top:1px">${statusLabel[p.durum]||'📄'}</span>
      <div style="flex:1">
        <div style="font-weight:700;display:flex;gap:6px;align-items:center">${p.custName||'—'} ${snapshotTag}</div>
        <div style="font-size:.65rem;color:var(--text-3)">${p.user?.split('@')[0]||'—'} · ${fmtDate(p.archivedAt)}</div>
        ${iptalNeden}
      </div>
      <div style="font-family:'DM Mono',monospace;font-size:.73rem;color:var(--text-2)">${p.urunler?.length||0} ürün</div>
      <button onclick="deleteProp('${p.id}')" style="background:#fee2e2;border:none;border-radius:6px;padding:4px 8px;font-size:.65rem;color:#dc2626;cursor:pointer;font-family:inherit;font-weight:700">Sil</button>
    </div>`;
  }).join('');
}

// İndirim Kullanım Raporu — admin özet panelinde
function _renderIndirimOzet() {
  const el = document.getElementById('admin-indirim-ozet');
  if (!el) return;

  // Sadece personelin ek pazarlık indirimi (ekIndirim) — kampanya/satır hariç
  const pazarlikliTeklifler = proposals.filter(p => Number(p.ekIndirim || 0) > 0);

  const perUser = {};
  pazarlikliTeklifler.forEach(p => {
    const u = p.user || '-';
    if (!perUser[u]) perUser[u] = { teklifSayisi: 0, toplamPazarlik: 0 };
    perUser[u].teklifSayisi++;
    perUser[u].toplamPazarlik += Number(p.ekIndirim || 0);
  });

  const toplam         = proposals.length;
  const pazarlikliSayi = pazarlikliTeklifler.length;
  const pazarlikOrani  = toplam > 0 ? ((pazarlikliSayi / toplam) * 100).toFixed(0) : 0;
  const sorted         = Object.entries(perUser).sort((a, b) => b[1].toplamPazarlik - a[1].toplamPazarlik);

  el.innerHTML = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">'
    + '<div style="flex:1;min-width:100px;background:#fef3c7;border-radius:8px;padding:8px 10px;text-align:center">'
    +   '<div style="font-size:1.2rem;font-weight:800;color:#92400e">' + pazarlikOrani + '%</div>'
    +   '<div style="font-size:.62rem;color:#92400e">teklifte pazarlık</div>'
    + '</div>'
    + '<div style="flex:1;min-width:100px;background:#fef2f2;border-radius:8px;padding:8px 10px;text-align:center">'
    +   '<div style="font-size:1.2rem;font-weight:800;color:#dc2626">' + pazarlikliSayi + '</div>'
    +   '<div style="font-size:.62rem;color:#dc2626">pazarlıklı teklif</div>'
    + '</div>'
    + '<div style="flex:1;min-width:100px;background:#f0fdf4;border-radius:8px;padding:8px 10px;text-align:center">'
    +   '<div style="font-size:1.2rem;font-weight:800;color:#16a34a">' + (toplam - pazarlikliSayi) + '</div>'
    +   '<div style="font-size:.62rem;color:#16a34a">pazarlıksız teklif</div>'
    + '</div>'
    + '</div>'
    + '<div style="font-size:.65rem;color:var(--text-3);margin-bottom:8px;text-align:center">💰 Sadece personelin ek pazarlık indirimi (kampanya/satır indirimleri hariç)</div>'
    + (sorted.length
        ? sorted.map(([email, s]) =>
            '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:.74rem">'
            + '<span style="font-weight:700;flex:1">' + email.split('@')[0] + '</span>'
            + '<span style="color:#92400e;font-size:.68rem">' + s.teklifSayisi + ' teklif · ' + fmt(s.toplamPazarlik) + ' pazarlık</span>'
            + '</div>'
          ).join('')
        : '<div style="font-size:.72rem;color:var(--text-3);text-align:center;padding:8px">Henüz pazarlık verisi yok</div>'
      );
}

function renderAdminUsers() {
  const us = {};

  // 1. Proposals ve sales'dan kullanıcı verisi
  proposals.forEach(p => {
    const u = p.user||'-'; if(!u||u==='-') return;
    if(!us[u]) us[u] = { proposals:0, sales:0, lastSeen:'', logins:0, magazaTipi:'?' };
    us[u].proposals++;
    const d = _tarih(p.ts);
    if(d > us[u].lastSeen) us[u].lastSeen = d;
  });
  sales.forEach(s => {
    const u = s.user||'-'; if(!u||u==='-') return;
    if(!us[u]) us[u] = { proposals:0, sales:0, lastSeen:'', logins:0, magazaTipi:'?' };
    us[u].sales++;
    const d = s.ts ? s.ts.split('T')[0] : '';
    if(d > us[u].lastSeen) us[u].lastSeen = d;
  });

  // 2. Firebase analytics — logins + magazaTipi
  if(window._fbAnalytics) {
    Object.values(window._fbAnalytics).forEach(rec => {
      const email = rec.email;
      if(!email) return;
      if(!us[email]) us[email] = { proposals:0, sales:0, lastSeen:'', logins:0, magazaTipi:'?' };
      us[email].logins += (rec.logins||0);
      if(rec.magazaTipi) us[email].magazaTipi = rec.magazaTipi;
      if(rec.date && rec.date > us[email].lastSeen) us[email].lastSeen = rec.date;
    });
  }

  // 3. localStorage analytics (bu cihaz fallback)
  const analData = JSON.parse(localStorage.getItem('analytics_local')||'{}');
  Object.entries(analData).forEach(([date,byUser]) => {
    Object.entries(byUser).forEach(([email,rec]) => {
      if(!us[email]) us[email] = { proposals:0, sales:0, lastSeen:'', logins:0, magazaTipi:'?' };
      us[email].logins += rec.logins||0;
      if(date > us[email].lastSeen) us[email].lastSeen = date;
    });
  });

  // 4. Aktif session'lardan online durumu
  const activeSessions = window._activeSessions || {};

  const su = Object.entries(us).sort((a,b) => (b[1].proposals+b[1].sales) - (a[1].proposals+a[1].sales));
  const el = document.getElementById('admin-user-list');
  if(!el) return;
  if(!su.length) {
    el.innerHTML = '<div class="admin-empty">Henüz kullanıcı verisi yok</div>';
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  el.innerHTML = su.map(([email, s]) => {
    const ini = email.split('@')[0].slice(0,2).toUpperCase();
    const name = email.split('@')[0];
    const pending = proposals.filter(p => p.user===email && p.durum==='bekliyor').length;
    const isOnline = Object.values(activeSessions).some(sess => sess.email === email);
    const isToday  = s.lastSeen === today;
    const mtBadge  = s.magazaTipi && s.magazaTipi !== '?'
      ? `<span style="font-size:.58rem;background:#eff6ff;color:#1d4ed8;border-radius:4px;padding:1px 5px;font-weight:700">${s.magazaTipi === 'AVM' ? '🏬 AVM' : '🏪 Çarşı'}</span>` : '';
    const onlineDot = isOnline
      ? '<span title="Şu an aktif" style="width:7px;height:7px;background:#16a34a;border-radius:50%;display:inline-block;margin-right:3px;vertical-align:middle"></span>'
      : '';

    return `<div class="user-row" style="border-left:3px solid ${isOnline?'#16a34a':isToday?'#f59e0b':'var(--border)'}">
      <div class="user-avatar" style="background:${isOnline?'#dcfce7;color:#15803d':isToday?'#fef3c7;color:#92400e':'var(--surface-2);color:var(--text-2)'}">${ini}</div>
      <div class="user-info" style="flex:1">
        <div class="user-email" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
          ${onlineDot}<strong>${name}</strong>${mtBadge}
        </div>
        <div class="user-meta">Son görülme: ${s.lastSeen||'—'}</div>
      </div>
      <div class="user-badges" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
        ${s.logins ? `<span class="badge badge-green" title="Toplam Giriş">${s.logins}G</span>` : ''}
        <span class="badge badge-blue"   title="Teklif">${s.proposals}T</span>
        <span class="badge badge-orange" title="Satış">${s.sales}S</span>
        ${pending ? `<span class="badge" style="background:#fef3c7;color:#92400e">${pending}⏳</span>` : ''}
        <button onclick="adminForceLogout('${email}')"
          style="padding:3px 8px;font-size:.60rem;font-weight:700;border:1px solid #fecaca;border-radius:5px;
                 background:#fff5f5;color:#dc2626;cursor:pointer;font-family:inherit;white-space:nowrap"
          title="Oturumu kapat">
          ⏏ Çıkar
        </button>
      </div>
    </div>`;
  }).join('');
}

// Admin'in başka kullanıcının oturumunu kapatması
async function adminForceLogout(targetEmail) {
  if(!isAdmin()) return;
  if(!(await ayConfirm(targetEmail.split('@')[0] + ' kullanıcısının oturumu kapatılsın mı?'))) return;
  try {
    const sesSnap = await getDocs(
      query(collection(_db, 'sessions'), where('email', '==', targetEmail))
    );
    if(sesSnap.empty) {
      const _ct = document.getElementById('change-toast');
      if(_ct) { _ct.textContent = targetEmail.split('@')[0] + ' aktif oturumu yok'; _ct.classList.add('show'); setTimeout(()=>_ct.classList.remove('show'),2500); }
      return;
    }
    // forceLogout flag'ini true yap — personelin cihazına anlık bildirim gider
    for(const d of sesSnap.docs) {
      await updateDoc(doc(_db,'sessions',d.id), { forceLogout: true, forceLogoutAt: serverTimestamp() });
      const _id = d.id;
      setTimeout(async () => { try { await deleteDoc(doc(_db,'sessions',_id)); } catch(e){} }, 5000);
    }
    haptic(22);
    const _ct = document.getElementById('change-toast');
    if(_ct) { _ct.textContent = '✅ ' + targetEmail.split('@')[0] + ' oturumu kapatılıyor…'; _ct.classList.add('show'); setTimeout(()=>_ct.classList.remove('show'),2800); }
    renderAdminUsers();
  } catch(e) { console.warn('adminForceLogout:', e); await ayAlert('Oturum kapatılamadı: ' + e.message); }
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
    `<div class="product-row" style="gap:6px">
      <span class="product-rank">${i+1}</span>
      <div class="product-bar-wrap">
        <div class="product-bar-name">${p}</div>
        <div class="product-bar-track"><div class="product-bar-fill" style="width:${Math.round(c/mx*100)}%"></div></div>
      </div>
      <span class="product-bar-count">${c}x</span>
      <button onclick="adminHizliDuzenle('${p.replace(/'/g,"\\'")}')"
        style="flex-shrink:0;padding:3px 7px;font-size:.58rem;font-weight:700;border:1px solid #cbd5e1;border-radius:5px;background:#f8fafc;color:#475569;cursor:pointer;font-family:inherit;white-space:nowrap">
        ✏️ Düzenle
      </button>
    </div>`
  ).join('')||'<div class="admin-empty">Veri yok</div>';
}

// ─── ADMIN HIZLI DÜZENLE — Fiyat Override + Sipariş Notu ──────────
window.adminHizliDuzenle = async function(urunAdi) {
  if(!isAdmin()) return;
  // Ürünü allProducts'tan bul
  const urun = (window._cachedUrunler || allProducts).find(p => {
    const k = Object.keys(p).find(kk => (kk||'').toLowerCase() === 'urun');
    return k && p[k] === urunAdi;
  });
  const eskiFiyat = urun ? (urun.Nakit || urun.nakit || '—') : '—';

  const sebepVeFiyat = await ayPrompt(
    `"${urunAdi}" için yeni nakit fiyat ve not girin:\nMevcut Nakit: ${eskiFiyat} '+_tlSym()+'\n\nFormat: YENİFİYAT | NOT (örn: 12500 | Kampanya indirimi)`,
    '',
    ''
  );
  if (!sebepVeFiyat || !sebepVeFiyat.trim()) return;

  const parcalar = sebepVeFiyat.split('|');
  const yeniFiyat = parcalar[0]?.trim();
  const not = parcalar[1]?.trim() || 'Manuel güncelleme';

  if (!yeniFiyat || isNaN(Number(yeniFiyat.replace(/\D/g,'')))) {
    await ayAlert('Geçersiz fiyat formatı. Örnek: 12500 | Kampanya indirimi');
    return;
  }

  // Sipariş notuna otomatik olarak yaz
  const manuelNot = `⚠️ MANUEL MÜDAHALE: ${urunAdi} | ${eskiFiyat} '+_tlSym()+' → ${Number(yeniFiyat.replace(/\D/g,'')).toLocaleString('tr-TR')} '+_tlSym()+' (Not: ${not})`;
  const yeniKayit = {
    id: uid(),
    ts: new Date().toISOString(),
    urun: urunAdi,
    not: manuelNot,
    user: currentUser?.Email || '-',
    durum: 'bekliyor'
  };
  try {
    await setDoc(doc(_db, 'siparis', yeniKayit.id), yeniKayit);
  } catch(e) {
    const ls = JSON.parse(localStorage.getItem('aygun_siparis')||'[]');
    ls.unshift(yeniKayit);
    localStorage.setItem('aygun_siparis', JSON.stringify(ls));
    if(!window._siparisData) window._siparisData = [];
    window._siparisData.unshift(yeniKayit);
  }

  renderSiparisPanel();
  updateSiparisBadge();

  // EventBus reaktif tetikleme + funnel yenile
  EventBus.emit(EV.FUNNEL_RECALC);
  EventBus.emit(EV.CART_UPDATED, { source: 'adminHizliDuzenle' });
  // Grafikleri otomatik yenile
  if (typeof loadFunnelAnaliz === 'function') {
    setTimeout(() => loadFunnelAnaliz(90, true), 300);
  }

  showToast(`✅ Manuel müdahale kaydedildi: ${urunAdi}`);
  haptic && haptic(20);
};
// ─── TÜM CANLI SEPETLERİ TEMİZLE (ADMİN) ────────────────────────
async function clearAllLiveBaskets() {
  if (!isAdmin()) return;
  
  // ayDanger veya confirm kontrolü
  const onay = typeof ayDanger === 'function' 
    ? await ayDanger('Tüm kullanıcıların canlı sepetleri silinsin mi?')
    : confirm('Tüm kullanıcıların canlı sepetleri silinsin mi?');
    
  if (!onay) return;
  
  if (typeof haptic === 'function') haptic(30);

  try {
    const querySnapshot = await getDocs(collection(_db, 'live_baskets'));
    const deletePromises = querySnapshot.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);
    
    // Yerel sepeti de sıfırla
    basket = []; 
    discountAmount = 0;
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    
    if (typeof updateCartUI === 'function') updateCartUI();
    if (typeof renderSepetDetay === 'function') renderSepetDetay();
    
    console.log("Tüm canlı sepetler başarıyla silindi.");
  } catch (e) { 
    console.error('Tüm canlı sepetler silinemedi:', e); 
    if (typeof ayAlert === 'function') ayAlert('Silme hatası!'); 
  }
}

// ─── KULLANICI TEKLİFLERİNİ TEMİZLE (ADMİN) ──────────────────────────
async function clearUserProps(userEmail) {
  // ✅ YETKİ KONTROLÜ: Sadece admin silebilir
  if (!isAdmin()) {
    console.warn('Yetkisiz erişim: clearUserProps sadece admin tarafından kullanılabilir.');
    if (typeof ayAlert === 'function') await ayAlert('Bu işlem için admin yetkisi gerekir.');
    return;
  }
  
  if (!userEmail) {
    console.warn('clearUserProps: userEmail parametresi gerekli');
    return;
  }
  
  try {
    const q = query(collection(_db, 'proposals'), where('user', '==', userEmail));
    const snap = await getDocs(q);
    
    if (snap.empty) {
      console.log(`${userEmail} için silinecek teklif bulunamadı.`);
      if (typeof ayAlert === 'function') await ayAlert(`${userEmail.split('@')[0]} kullanıcısının teklifi yok.`);
      return;
    }
    
    const sils = snap.docs.map(d => deleteDoc(d.ref));
    await Promise.all(sils);
    console.log(`${userEmail} için ${snap.size} teklif silindi.`);
    
    // Yerel proposals dizisini de güncelle
    const remainingProps = proposals.filter(p => p.user !== userEmail);
    proposals.length = 0;
    proposals.push(...remainingProps);
    localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
    
    if (typeof renderSepetDetay === 'function') renderSepetDetay();
    if (typeof updateProposalBadge === 'function') updateProposalBadge();
    
  } catch (e) { 
    console.error("Teklif silme hatası:", e); 
    if (typeof ayAlert === 'function') await ayAlert('Silme işlemi sırasında hata oluştu: ' + e.message);
  }
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
    // Silmek yerine boş sepet yaz + cleared bayrağı — kullanıcının cihazı bu bayrağı görünce localStorage'ı da temizler
    await setDoc(basketRef, {
      items: [],
      cleared: true,
      clearedAt: new Date().toISOString(),
      clearedBy: currentUser?.Email || 'admin',
      ts: new Date(),
    });
    renderSepetDetay();
    showToast('✅ ' + email.split('@')[0] + ' sepeti temizlendi', 'success');
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
      ['Ürün', 'Stok', 'Açıklama', 'Liste ('+_tlSym()+')', 'Satır İnd. ('+_tlSym()+')', 'Net ('+_tlSym()+')', 'Kod']
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
    ['Ürün', 'Stok', 'Açıklama', 'D.Kart ('+_tlSym()+')', '4T AWM ('+_tlSym()+')', 'Tek Çekim ('+_tlSym()+')', 'Nakit ('+_tlSym()+')', 'Kod']
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

// ─── TEKLİF → SEPETE EKLE (tüm kullanıcılar) ────────────────────
async function teklifSepeteEkle(propId) {
  const p = proposals.find(pr => pr.id === propId);
  if (!p) return;

  if (basket.length > 0) {
    const onay = await ayDanger('Mevcut sepet temizlenip teklifin ürünleri eklenecek. Devam edilsin mi?');
    if (!onay) return;
    _doClearBasket();
  }

  const degisimler = [];
  const yeniUrunler = [];

  // allProducts için anahtar çözümleyici (her seferinde yeniden hesaplama yerine bir kez)
  const _keys0  = allProducts.length ? Object.keys(allProducts[0]) : [];
  const _urunKey = _keys0.find(k => norm(k) === 'urun')    || '';
  const _kodKey  = _keys0.find(k => norm(k) === 'kod')     || 'Kod';
  const _kartKey = _keys0.find(k => k.includes('Kart'))    || '';
  const _cekKey  = _keys0.find(k => k.includes('ekim'))    || '';
  const _descKey = _keys0.find(k => norm(k) === 'aciklama')|| '';
  const _gamKey  = _keys0.find(k => norm(k).includes('gam')) || '';

  (p.urunler || []).forEach(tu => {
    // Önce Kod ile eşleştir (daha güvenilir), sonra ürün adıyla
    const guncel = allProducts.find(ap => {
      const apKod  = String(ap[_kodKey]  || '').trim().toLowerCase();
      const apUrun = String(ap[_urunKey] || '').trim().toLowerCase();
      const tuKod  = String(tu.kod       || '').trim().toLowerCase();
      const tuUrun = String(tu.urun      || '').trim().toLowerCase();
      return (tuKod && apKod === tuKod) || apUrun === tuUrun;
    });

    let nakit    = tu.nakit    || 0;
    let dk       = tu.dk       || nakit;
    let awm      = tu.awm      || nakit;
    let tek      = tu.tek      || nakit;
    let aciklama = tu.aciklama || '-';
    let stok     = tu.stok     || 0;
    let kod      = tu.kod      || '';
    let gam      = tu.gam      || '';
    let degisti  = false;

    if (guncel) {
      const yNakit = parseFloat(guncel.Nakit)          || nakit;
      const yDk    = parseFloat(guncel[_kartKey])       || dk;
      const yAwm   = parseFloat(guncel['4T AWM'])       || awm;
      const yTek   = parseFloat(guncel[_cekKey])        || tek;
      const yAc    = (guncel[_descKey] !== undefined && guncel[_descKey] !== null)
                     ? String(guncel[_descKey]) : aciklama;
      const yStok  = Number(guncel.Stok) || stok;
      const yKod   = guncel[_kodKey]     || kod;
      const yGam   = guncel[_gamKey]     || gam;

      if (Math.abs(yNakit - nakit) / Math.max(nakit, 1) > 0.01) {
        degisimler.push({ urun: tu.urun, eskiFiyat: nakit, yeniFiyat: yNakit, fark: yNakit - nakit });
        degisti = true;
      }

      nakit = yNakit; dk = yDk; awm = yAwm; tek = yTek;
      aciklama = yAc; stok = yStok; kod = yKod; gam = yGam;
    }

    yeniUrunler.push({
      urun: tu.urun, nakit, dk, awm, tek, aciklama, stok, kod, gam,
      _teklifFiyati: tu.nakit,
      _fiyatDegisti: degisti,
      // Kampanyalar güncel aciklama'dan yeniden parse edilecek — _campaigns: null ile tetiklenir
      itemDisc: 0, _campDisc: 0, _selectedCamps: {}, _campaigns: null, _pendingGroups: {},
    });
  });

  // Fiyat değişimi uyarısı — özel HTML modal (ayAlert textContent kullanır, HTML render etmez)
  if (degisimler.length > 0) {
    await new Promise(resolve => {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(28,28,30,.55);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)';
      const satirlar = degisimler.map(d => {
        const sign = d.fark > 0 ? '+' : '';
        const renk = d.fark > 0 ? '#dc2626' : '#16a34a';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #fef3c7;font-size:.80rem">
          <span>📦 ${d.urun}</span>
          <span style="text-align:right">${fmt(d.eskiFiyat)} → <b style="color:${renk}">${fmt(d.yeniFiyat)}</b>
            <span style="color:${renk};font-size:.72rem"> (${sign}${fmt(d.fark)})</span></span>
        </div>`;
      }).join('');
      ov.innerHTML = `<div style="background:#fff;border-radius:18px;padding:24px;max-width:400px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.22);font-family:'DM Sans',system-ui,sans-serif">
        <div style="font-size:1.4rem;text-align:center;margin-bottom:8px">💰</div>
        <div style="font-weight:700;font-size:.95rem;margin-bottom:6px;text-align:center">Fiyat Değişikliği Tespit Edildi</div>
        <div style="font-size:.75rem;color:#6b7280;margin-bottom:14px;text-align:center">Güncel fiyatlar tekliften farklı. Sepete güncel fiyatla eklenecek.</div>
        <div style="background:#fffbeb;border-radius:10px;padding:8px 12px;margin-bottom:16px">${satirlar}</div>
        <button style="width:100%;padding:11px;background:#1a1a1a;color:#fff;border:none;border-radius:10px;font-family:inherit;font-size:.88rem;font-weight:700;cursor:pointer" onclick="this.closest('div[style]').parentElement.remove();arguments[0].stopPropagation()">Anladım, Devam Et</button>
      </div>`;
      ov.addEventListener('click', e => { if(e.target===ov){ov.remove();resolve();} });
      ov.querySelector('button').addEventListener('click', () => { ov.remove(); resolve(); });
      document.body.appendChild(ov);
    });
  }

  // Sepete ekle
  basket = yeniUrunler;
  if (basket.length > 0) {
    _sessionData.startTime = _sessionData.startTime || Date.now();
    localStorage.setItem('_sd', JSON.stringify({
      searches: _sessionData.searches || [],
      revealedPrices: _sessionData.revealedPrices || [],
      blurUrunler: _sessionData.blurUrunler || {},
      startTime: _sessionData.startTime
    }));
  }
  saveBasket();
  EventBus.emit(EV.PROPOSAL_SEPETE, { propId, urunSayisi: basket.length, degisimler });

  // Teklif modalını kapat, sepeti aç
  const pm = document.getElementById('proposals-modal');
  if (pm) { pm.classList.remove('open'); pm.style.display = 'none'; }
  const cart = document.getElementById('cart-modal');
  if (cart) { cart.style.display = 'flex'; cart.classList.add('open'); }

  haptic(22);
  const ct = document.getElementById('change-toast');
  if (ct) {
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.innerHTML = `<span>🛒</span><span style="flex:1">${basket.length} ürün sepete eklendi${degisimler.length ? ' — <b>fiyatlar güncellendi</b>' : '.'}</span>`;
    ct.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
}

// ─── TEKLİF REVİZE SEPETE ───────────────────────────────────────
// Kalem butonu: Güncel fiyat+açıklama + teklif zamanındaki satır indirimleri
// Kampanyalar sıfırlanır ama manuel indirimler (itemDisc - campDisc) korunur
async function teklifRevizeSepet(propId) {
  const p = proposals.find(pr => pr.id === propId);
  if (!p) return;

  if (basket.length > 0) {
    const onay = await ayDanger('Mevcut sepet temizlenip teklifin ürünleri revize modda eklenecek. Devam edilsin mi?');
    if (!onay) return;
    _doClearBasket();
  }

  const degisimler = [];
  const yeniUrunler = [];

  const _keys0r  = allProducts.length ? Object.keys(allProducts[0]) : [];
  const _urunKeyR = _keys0r.find(k => norm(k) === 'urun')     || '';
  const _kodKeyR  = _keys0r.find(k => norm(k) === 'kod')      || 'Kod';
  const _kartKeyR = _keys0r.find(k => k.includes('Kart'))     || '';
  const _cekKeyR  = _keys0r.find(k => k.includes('ekim'))     || '';
  const _descKeyR = _keys0r.find(k => norm(k) === 'aciklama') || '';
  const _gamKeyR  = _keys0r.find(k => norm(k).includes('gam'))|| '';

  (p.urunler || []).forEach(tu => {
    const guncel = allProducts.find(ap => {
      const apKod  = String(ap[_kodKeyR]  || '').trim().toLowerCase();
      const apUrun = String(ap[_urunKeyR] || '').trim().toLowerCase();
      const tuKod  = String(tu.kod        || '').trim().toLowerCase();
      const tuUrun = String(tu.urun       || '').trim().toLowerCase();
      return (tuKod && apKod === tuKod) || apUrun === tuUrun;
    });

    let nakit    = tu.nakit    || 0;
    let dk       = tu.dk       || nakit;
    let awm      = tu.awm      || nakit;
    let tek      = tu.tek      || nakit;
    let aciklama = tu.aciklama || '-';
    let stok     = tu.stok     || 0;
    let kod      = tu.kod      || '';
    let gam      = tu.gam      || '';
    let degisti  = false;

    if (guncel) {
      const yNakit = parseFloat(guncel.Nakit)           || nakit;
      const yDk    = parseFloat(guncel[_kartKeyR])       || dk;
      const yAwm   = parseFloat(guncel['4T AWM'])        || awm;
      const yTek   = parseFloat(guncel[_cekKeyR])        || tek;
      const yAc    = (guncel[_descKeyR] !== undefined && guncel[_descKeyR] !== null)
                     ? String(guncel[_descKeyR]) : aciklama;
      const yStok  = Number(guncel.Stok)                 || stok;
      const yKod   = guncel[_kodKeyR]                    || kod;
      const yGam   = guncel[_gamKeyR]                    || gam;

      if (Math.abs(yNakit - nakit) / Math.max(nakit, 1) > 0.01) {
        degisimler.push({ urun: tu.urun, eskiFiyat: nakit, yeniFiyat: yNakit, fark: yNakit - nakit });
        degisti = true;
      }

      nakit = yNakit; dk = yDk; awm = yAwm; tek = yTek;
      aciklama = yAc; stok = yStok; kod = yKod; gam = yGam;
    }

    // Teklif zamanındaki manuel satır indirimi koru
    // (itemDisc - _campDisc) = manuel kısım; kampanya kısmı sıfırlanır
    const manuelItemDisc = Math.max(0, (tu.itemDisc || 0) - (tu._campDisc || 0));

    yeniUrunler.push({
      urun: tu.urun, nakit, dk, awm, tek, aciklama, stok, kod,
      itemDisc: manuelItemDisc,  // teklifteki manuel indirim korunur
      _campDisc: 0,              // kampanya indirimi sıfır
      _selectedCamps: {},        // kampanya seçimleri temizlendi
      _campaigns: null,          // yeniden parse edilecek
      _pendingGroups: {},
      _teklifFiyati: tu.nakit,
      _fiyatDegisti: degisti,
    });
  });

  if (degisimler.length > 0) {
    await new Promise(resolve => {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(28,28,30,.55);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)';
      const satirlar = degisimler.map(d => {
        const sign = d.fark > 0 ? '+' : '';
        const renk = d.fark > 0 ? '#dc2626' : '#16a34a';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #fef3c7;font-size:.80rem">
          <span>📦 ${d.urun}</span>
          <span style="text-align:right">${fmt(d.eskiFiyat)} → <b style="color:${renk}">${fmt(d.yeniFiyat)}</b>
            <span style="color:${renk};font-size:.72rem"> (${sign}${fmt(d.fark)})</span></span>
        </div>`;
      }).join('');
      ov.innerHTML = `<div style="background:#fff;border-radius:18px;padding:24px;max-width:400px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.22);font-family:'DM Sans',system-ui,sans-serif">
        <div style="font-size:1.4rem;text-align:center;margin-bottom:8px">💰</div>
        <div style="font-weight:700;font-size:.95rem;margin-bottom:6px;text-align:center">Fiyat Değişikliği Tespit Edildi</div>
        <div style="font-size:.75rem;color:#6b7280;margin-bottom:14px;text-align:center">Güncel fiyatlar tekliften farklı. Sepete güncel fiyatla, teklifteki manuel indirimlerle eklenecek.</div>
        <div style="background:#fffbeb;border-radius:10px;padding:8px 12px;margin-bottom:16px">${satirlar}</div>
        <button style="width:100%;padding:11px;background:#1a1a1a;color:#fff;border:none;border-radius:10px;font-family:inherit;font-size:.88rem;font-weight:700;cursor:pointer">Anladım, Devam Et</button>
      </div>`;
      ov.addEventListener('click', e => { if(e.target===ov){ov.remove();resolve();} });
      ov.querySelector('button').addEventListener('click', () => { ov.remove(); resolve(); });
      document.body.appendChild(ov);
    });
  }

  basket = yeniUrunler;
  if (basket.length > 0) {
    _sessionData.startTime = _sessionData.startTime || Date.now();
    localStorage.setItem('_sd', JSON.stringify({
      searches: _sessionData.searches || [],
      revealedPrices: _sessionData.revealedPrices || [],
      blurUrunler: _sessionData.blurUrunler || {},
      startTime: _sessionData.startTime
    }));
  }
  saveBasket();
  EventBus.emit(EV.PROPOSAL_SEPETE, { propId, urunSayisi: basket.length, degisimler });

  const pm = document.getElementById('proposals-modal');
  if (pm) { pm.classList.remove('open'); pm.style.display = 'none'; }
  const cart = document.getElementById('cart-modal');
  if (cart) { cart.style.display = 'flex'; cart.classList.add('open'); }

  haptic(22);
  const ct = document.getElementById('change-toast');
  if (ct) {
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.innerHTML = `<span>✏️</span><span style="flex:1">${basket.length} ürün revize modda sepete eklendi${degisimler.length ? ' — <b>fiyatlar güncellendi</b>' : '.'}</span>`;
    ct.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
}

function openEditProp(id) {
  // Admin düzenleyebilir; diğerleri de kendi tekliflerini sepete ekleyebilir
  haptic(16);
  const p = proposals.find(pr=>pr.id===id);
  if(!p) return;

  // Mevcut düzenleme modalı varsa kaldır
  const existing = document.getElementById('edit-prop-modal');
  if(existing) existing.remove();

  const urunRows = (p.urunler||[]).map((u,i) =>
    `<div class="edit-urun-row" data-idx="${i}">
      <input class="edit-urun-name" value="${u.urun||''}" placeholder="Ürün adı">
      <input class="edit-urun-nakit" type="number" value="${u.nakit||0}" placeholder="Nakit '+_tlSym()+'" style="width:100px">
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
            <label>İndirim ('+_tlSym()+')</label>
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
    <input class="edit-urun-nakit" type="number" placeholder="Nakit '+_tlSym()+'" value="0" style="width:100px">
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
        <div class="siparis-not">${_esc(s.not)}</div>
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
  
  // Nav bar admin badge — prop-badge ile aynı yapı, sayı gösterir
  const siparisNavBadge = document.getElementById('siparis-nav-badge');
  if(siparisNavBadge) {
    siparisNavBadge.style.display = bekleyen > 0 ? 'flex' : 'none';
    siparisNavBadge.textContent = bekleyen > 99 ? '99+' : bekleyen;
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
  if(window._propUnsub)        { window._propUnsub(); window._propUnsub=null; }
  if(window._saleUnsub)        { window._saleUnsub(); window._saleUnsub=null; }
  if(window._siparisUnsub)     { window._siparisUnsub(); window._siparisUnsub=null; }
  if(window._analyticsUnsub)   { window._analyticsUnsub(); window._analyticsUnsub=null; }
  if(window._adminClearUnsub)  { window._adminClearUnsub(); window._adminClearUnsub=null; }
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
Object.assign(window, {
  // Temel fonksiyonlar
  checkAuth, toggleCart, toggleZeroStock, filterData, clearMainSearch, normalizePhoneInput, iosLoadMore,
  openAbakus, closeAbakus, calcAbakus, selectAbakusRow,
  openQuickFinance, closeQuickFinance, qfAddToBasket, qfGoToPayment, _qfSwitchTab, _qfTaksitKartSec, _qfKrediKurumSec, _qfSelectPlan,
  openAbakusAction, openWaFromAbakus,
  closeWaModal, finalizeAksiyon, finalizeProposal,
  openProposals, closeProposals, filterProposals, clearPropSearch,
  openAdmin, closeAdmin, switchAdminTab,
  openSaleDoc, closeSaleDoc, generateSalePDF,
  openWelcomeInfo, closeWelcomeInfo,
  closeChangePopup,
  
  // Optimizasyon + Upsell
  optimizeCampaigns, checkUpsellOpportunities,

  // Sepet işlemleri
  addToBasket, removeFromBasket, fiyatGoster, _fyGos, applyDiscount,
  addToBasketPrim, openSiparisNotSafe, _initStockFilterBtn,
  deleteSelectedItems,   // Toplu silme fonksiyonu
  
  // Teklif işlemleri
  updatePropStatus, propSatisDon, propIptalEt, resendProposalWa, openPropNote, deleteProp,
  openEditProp, addEditUrunRow, saveEditProp, printTeklif, teklifSepeteEkle, teklifRevizeSepet,
  
  // Admin işlemleri
  resetProductStats, exportBasketToExcel, exportAbakusExcel, renderUyuyanStok,
  renderSepetDetay, clearUserProps, clearUserBasket, toggleStokPanel,
  clearAllPendingProps, clearAllLiveBaskets,
  renderArchivedProposals,
  
  // Sipariş notları
  openSiparisNot, siparisToggle, siparisDelete, clearSiparisNotlari,
  
  // Funnel analiz
  loadFunnelAnaliz, loadSepetAnaliz, setFunnelFilter,
  
  // Canlı sepet
  fetchLiveBasket,
  
  // Değişiklik yönetimi
  toggleChangeItem, toggleChangeItemRow, markAllChanges, confirmSection,
  toggleCampaign, clearAllCampaigns, recalculateAllGroupCampaigns,
  togglePropGroup, setItemDisc, setNakitOverride, toggleCartDiscPanel,
  
  // Toplu teklif işlemleri
  bulkUpdateStatus, bulkPrintProposals, mergeProposals, clearBulkSelection,
  adminForceLogout,

  // Çıkış
  logoutUser,

  // Kayan yazı (Motd) + Karşılama metni
  saveMotdMessage, deleteMotdMessage, toggleMotdMessage, renderMotdPanel,
  adminGreetingSave, adminGreetingPreview,
  
  // Premium modal yardımcı
  closeReasonPanel,

  // Floating feedback bar
  _feedbackSelect, _feedbackDismiss, _nedenSec, _showNedenPanel,
  showReasonModal,      // Her silme işleminde açılan modal
  showEmptyCartModal,   // Sepet boşaldığında açılan modal
  
  // openMessages: kaldırıldı (henüz aktif değil)
});

// ═══════════════════════════════════════════════════════════════
// ✨ EN İYİ FİYAT OPTİMİZASYON MOTORU  v8
//
// Dinamik Net Kazanç: Her çift onaylanırken, o ana kadar
// alınan kararları (atanmış ürünleri) baz alarak gerçek
// birlesen kayıbını hesaplar. Kaskad etkiler doğru görülür.
// ═══════════════════════════════════════════════════════════════

function optimizeCampaigns() {
  if (!basket.length) return;
  haptic(20);

  // 1. Sıfırla
  basket.forEach(item => {
    item._selectedCamps = {};
    item._pendingGroups = {};
    if (item._projeNakit !== undefined) delete item._projeNakit;
    const m = (item.itemDisc||0) - (item._campDisc||0);
    item._campDisc = 0; item.itemDisc = Math.max(0, m);
  });
  basket.forEach(item => {
    if (!item._campaigns) item._campaigns = parseCampaigns(item.aciklama||'');
  });

  // 2. Adayları topla
  const adaylar = [];
  basket.forEach((item, bi) => {
    (item._campaigns||[]).forEach((camp, ci) => {
      if (camp.tip !== 'birlesen' && camp.tip !== 'kilitli') return;
      if (camp.tutar <= 0) return;
      if (camp.sonTarih && new Date() > camp.sonTarih) return;
      adaylar.push({ bi, ci, camp });
    });
  });

  if (!adaylar.length) {
    _campToast('Optimize edilecek ⎇/🔒 kampanya bulunamadı.', 'info');
    return;
  }

  // 3. Birlesen potansiyeli — verilen ürün seti hariç
  function birlesenPot(haricSet) {
    const grpMap = {};
    adaylar.forEach(k => {
      if (k.camp.tip !== 'birlesen' || haricSet.has(k.bi)) return;
      const g = k.camp.grup;
      if (!grpMap[g]) grpMap[g] = [];
      grpMap[g].push(k);
    });
    let t = 0;
    Object.values(grpMap).forEach(list => {
      const esik = list[0].camp.esik||1;
      const tutar = Math.max(...list.map(k => k.camp.tutar));
      if (esik === 1) { t += list.reduce((s,k) => s+k.camp.tutar, 0); return; }
      let c = 0, kalan = [...list];
      while (kalan.length >= esik) {
        const H=new Set(), U=new Set(), cift=[], rest=[];
        for (const k of kalan) {
          const r = k.camp.rol||'ANY';
          if (!H.has(r) && !U.has(k.bi) && cift.length < esik) { cift.push(k); H.add(r); U.add(k.bi); }
          else rest.push(k);
        }
        if (cift.length === esik) { c++; kalan = rest; } else break;
      }
      t += c * tutar;
    });
    return t;
  }

  // 4. Tüm mümkün kilitli çiftleri bul
  const kilitliGruplar = {};
  adaylar.forEach(k => {
    if (k.camp.tip !== 'kilitli') return;
    const g = k.camp.grup;
    if (!kilitliGruplar[g]) kilitliGruplar[g] = [];
    kilitliGruplar[g].push(k);
  });

  function kilitliCiftler(list) {
    const esik = list[0].camp.esik||1;
    const ciftler = [];
    const hANY = list.every(k => !k.camp.rol || k.camp.rol === 'ANY');
    if (esik === 1) { list.forEach(k => ciftler.push([k])); return ciftler; }
    if (hANY) {
      for (let i = 0; i+esik <= list.length; i += esik) ciftler.push(list.slice(i, i+esik));
    } else {
      let kalan = [...list];
      while (kalan.length >= esik) {
        const H=new Set(), U=new Set(), cift=[], rest=[];
        for (const k of kalan) {
          const r = k.camp.rol||'ANY';
          if (!H.has(r) && !U.has(k.bi) && cift.length < esik) { cift.push(k); H.add(r); U.add(k.bi); }
          else rest.push(k);
        }
        if (cift.length === esik) { ciftler.push(cift); kalan = rest; } else break;
      }
    }
    return ciftler;
  }

  // 5. Greedy: Her adımda mevcut duruma göre en kârlı çifti seç
  const urunDurum = {}; // bi → { kilitliAtandi, birlesenGruplar }
  const sonSecimler = [];

  function atanabilir(k) {
    const d = urunDurum[k.bi]; if (!d) return true;
    if (k.camp.tip === 'kilitli') { if (d.ki || (d.bg && d.bg.size>0)) return false; }
    if (k.camp.tip === 'birlesen' && d.ki) return false;
    return true;
  }
  function ata(k) {
    if (!urunDurum[k.bi]) urunDurum[k.bi] = { ki: false, bg: new Set() };
    if (k.camp.tip === 'kilitli') urunDurum[k.bi].ki = true;
    if (k.camp.tip === 'birlesen') urunDurum[k.bi].bg.add(k.camp.grup);
    sonSecimler.push(k);
  }

  // Mevcut atanmış kilitli ürün seti
  function kilitliAtanmisBiSet() {
    return new Set(Object.entries(urunDurum).filter(([,d]) => d.ki).map(([bi]) => parseInt(bi)));
  }

  // Greedy döngüsü: her turda mevcut duruma göre en kârlı çifti bul ve uygula
  let devam = true;
  while (devam) {
    devam = false;
    let enIyi = null;

    // Mevcut kilitli atanmış ürünleri al
    const mevcutKilitli = kilitliAtanmisBiSet();

    Object.values(kilitliGruplar).forEach(list => {
      const atanabilirler = list.filter(k => atanabilir(k));
      if (!atanabilirler.length) return;
      const ciftler = kilitliCiftler(atanabilirler);
      const tutar = Math.max(...list.map(k => k.camp.tutar));

      ciftler.forEach(cift => {
        if (!cift.every(k => atanabilir(k))) return;
        const ciftBi = new Set(cift.map(k => k.bi));
        // Şu anki mevcut durumda birlesen potansiyeli
        const mevcutBP = birlesenPot(mevcutKilitli);
        // Bu çift eklenirse birlesen potansiyeli
        const yeniBP = birlesenPot(new Set([...mevcutKilitli, ...ciftBi]));
        const kayip = mevcutBP - yeniBP;
        const netKazanc = tutar - kayip;

        if (netKazanc > 0 && (!enIyi || netKazanc > enIyi.netKazanc)) {
          enIyi = { cift, netKazanc, tutar, kayip };
        }
      });
    });

    if (enIyi) {
      enIyi.cift.forEach(k => ata(k));
      devam = true; // bir sonraki turda tekrar dene
    }
  }

  // 6. Kalan ürünlere birlesen kampanyaları uygula
  const bGrpMap = {};
  adaylar.forEach(k => {
    if (k.camp.tip !== 'birlesen') return;
    const g = k.camp.grup;
    if (!bGrpMap[g]) bGrpMap[g] = [];
    bGrpMap[g].push(k);
  });

  function bPot(list) {
    const esik = list[0].camp.esik||1, tutar = Math.max(...list.map(k=>k.camp.tutar));
    if (esik === 1) return list.filter(k=>atanabilir(k)).reduce((s,k)=>s+k.camp.tutar, 0);
    return Math.floor(new Set(list.filter(k=>atanabilir(k)).map(k=>k.bi)).size/esik)*tutar;
  }

  Object.entries(bGrpMap).sort((a,b) => bPot(b[1])-bPot(a[1])).forEach(([,list]) => {
    const esik = list[0].camp.esik||1;
    const hANY = list.every(k => !k.camp.rol || k.camp.rol==='ANY');
    if (esik === 1) { list.forEach(k => { if (atanabilir(k)) ata(k); }); return; }
    function eI() {
      const u={};
      list.filter(k=>atanabilir(k)).forEach(k=>{const key=k.bi+'|'+k.camp.grup;if(!u[key]||k.camp.tutar>u[key].camp.tutar)u[key]=k;});
      return Object.values(u);
    }
    if (hANY) { const l=eI(); for(let i=0;i+esik<=l.length;i+=esik) l.slice(i,i+esik).forEach(k=>ata(k)); }
    else {
      let kalan=eI();
      while (kalan.length >= esik) {
        const H=new Set(), U=new Set(), cift=[], rest=[];
        for (const k of kalan) {
          const r=k.camp.rol||'ANY';
          if (!H.has(r)&&!U.has(k.bi)&&cift.length<esik) { cift.push(k); H.add(r); U.add(k.bi); }
          else rest.push(k);
        }
        if (cift.length===esik) { cift.forEach(k=>ata(k)); kalan=rest.filter(k=>atanabilir(k)); }
        else break;
      }
    }
  });

  // 7. Uygula
  if (!sonSecimler.length) {
    _campToast('Uygulanabilir kampanya kombinasyonu bulunamadı.', 'info');
    updateCartUI(); return;
  }
  sonSecimler.forEach(s => {
    if (!basket[s.bi]._selectedCamps) basket[s.bi]._selectedCamps = {};
    basket[s.bi]._selectedCamps[s.ci] = true;
  });
  recalculateAllGroupCampaigns();
  updateCartUI();

  const toplamDisc = basket.reduce((t,i) => t+(i._campDisc||0), 0);
  const fmtD = toplamDisc>=1000 ? (toplamDisc/1000).toFixed(toplamDisc%1000===0?0:1)+'k' : toplamDisc;
  _campToast('✨ En iyi kombinasyon seçildi — '+fmtD+''+_tlSym()+' kampanya indirimi', 'ok');
  haptic(30);
}

// ═══════════════════════════════════════════════════════════════
// 🎁 BUNDLE TAVSİYE MOTORU  (⤚ operatörü tabanlı)
// ═══════════════════════════════════════════════════════════════
// Aksesuar ürününün Açıklama sütununa yazılan ⤚ etiketiyle
// sepetteki ürünlerle eşleştirme yapar. JSON şişmez — yazım
// yalnızca aksesuar tarafında, ana ürünlere dokunulmaz.
//
// Format:  ⤚KOŞUL|SİMGE
//   ⤚*|⌗           → Sepette herhangi ürün varsa öner (global)
//   ⤚CEP|✦         → Sepette "Cep Telefonu" gamı varsa öner
//   ⤚SM-A175F|⌗    → Sepette tam Kod = SM-A175F olan ürün varsa öner
// ═══════════════════════════════════════════════════════════════

// ─── Bundle koşul eşleştirici ────────────────────────────────────────────────
// Desteklenen format:
//   *                        → sepette herhangi ürün varsa (global)
//   Tv                       → sepette "Tv" gamı / adı geçen ürün varsa
//   Tv+CepTelefonu           → "Tv" VEYA "Cep Telefonu" (OR, + ile)
//   S26&CepTelefonu          → "S26" VE "Cep Telefonu" aynı üründe (AND, & ile)
//   ^55&Tv                   → ürün adı/kodu 55 ile BAŞLIYOR VE gam Tv (boyut eşleşmesi)
//   *~Adaptör~Epilasyon      → herkese ama bu gamlar sepette varsa gösterme
//
// ^ (şapka) operatörü — BAŞLANGIÇ eşleşmesi:
//   Ürün adı veya kodun başında (ya da QE/UE/SM gibi 2-3 harf prefixten sonra) arar.
//   Örn: ^55 → 55UT9740 ✓, QE55S90 ✓, 43UV9750 ✗, 65UV9750 ✗
//   Bu sayede '43UV9750' içindeki '50' ve '75' yanlış eşleşmesi engellenir.
//
// Eşleşme kuralları:
//   Kod   → TAM eşleşme (===) veya ^ ile başlangıç
//   Gam   → kısmi (includes)
//   Ürün  → kısmi (includes) veya ^ ile başlangıç
// ─────────────────────────────────────────────────────────────────────────────
function _bundleMatches(condition, basket) {
  if (!condition || !basket.length) return false;

  const cond = condition.trim();
  const ns = s => (s || '').toLowerCase().replace(/\s+/g, '');

  // ── [N≥X] / [N≤X] / [N>X] / [N<X] Nakit fiyat filtresi ─────────────────
  // Syntax: ⤚*[N≥10000]|⌗  →  sepette nakiti ≥10000 olan ürün varsa eşleş
  // Koşul: includePart veya tam cond içinde [N op sayı] formatı
  const priceFilterRe = /\[N([><=≥≤]+)(\d+)\]/g;
  let condWithoutFilter = cond;
  let priceFilters = [];
  let pm;
  while ((pm = priceFilterRe.exec(cond)) !== null) {
    const op  = pm[1];
    const val = parseInt(pm[2], 10);
    priceFilters.push({ op, val });
    condWithoutFilter = condWithoutFilter.replace(pm[0], '');
  }
  if (priceFilters.length > 0) {
    // Sepette fiyat koşulunu sağlayan en az bir ürün olmalı
    const priceOk = basket.some(item => {
      const nakit = item.nakit || item._nakitOrijinal || 0;
      return priceFilters.every(({ op, val }) => {
        if (op === '>=' || op === '≥') return nakit >= val;
        if (op === '<=' || op === '≤') return nakit <= val;
        if (op === '>')               return nakit >  val;
        if (op === '<')               return nakit <  val;
        if (op === '==' || op === '=')return nakit == val;
        return false;
      });
    });
    if (!priceOk) return false;
    // Fiyat koşulu geçti — geri kalan koşulu kontrol et
    condWithoutFilter = condWithoutFilter.trim();
    if (!condWithoutFilter || condWithoutFilter === '*') return true;
    // Devam — fiyat filtresi kaldırılmış cond ile normal eşleşme yap
    return _bundleMatches(condWithoutFilter, basket);
  }

  // ── ^ Başlangıç eşleşmesi ────────────────────────────────────────────────
  function startsWith(term, item) {
    const t = ns(term);
    const u = ns(item.urun);
    const k = ns(item.kod ?? '');
    if (u.startsWith(t)) return true;
    if (k.startsWith(t)) return true;
    const afterPrefix = k.replace(/^[a-z]{2,3}/, '');
    if (afterPrefix.startsWith(t)) return true;
    return false;
  }

  // ── Standart eşleşme (kısmi — includes) ──────────────────────────────────
  function includes(term, item) {
    const t = ns(term);
    return String(item.kod ?? '').toLowerCase() === t ||
           ns(item.gam).includes(t)  ||
           ns(item.urun).includes(t);
  }

  function termHits(rawTerm, bskt) {
    const isStart = rawTerm.startsWith('^');
    const term    = isStart ? rawTerm.slice(1) : rawTerm;
    return bskt.some(item => isStart ? startsWith(term, item) : includes(term, item));
  }

  // ── Hariç tutma: '~' ayracından sonra ────────────────────────────────────
  const tildeIdx = cond.indexOf('~');
  const includePart = tildeIdx >= 0 ? cond.slice(0, tildeIdx) : cond;
  const excludePart = tildeIdx >= 0 ? cond.slice(tildeIdx + 1) : '';

  if (excludePart) {
    const excTerms = excludePart.split('~').map(s => s.trim()).filter(Boolean);
    if (excTerms.some(t => termHits(t, basket))) return false;
  }

  if (includePart === '*') return true;

  // ── AND: '&' ile ayrılmış ─────────────────────────────────────────────────
  if (includePart.includes('&')) {
    const andTerms = includePart.split('&').map(s => s.trim()).filter(Boolean);
    return basket.some(item =>
      andTerms.every(rawTerm => {
        const isStart = rawTerm.startsWith('^');
        const term    = isStart ? rawTerm.slice(1) : rawTerm;
        return isStart ? startsWith(term, item) : includes(term, item);
      })
    );
  }

  // ── OR: '+' ile ayrılmış ──────────────────────────────────────────────────
  return includePart.split('+').map(s => s.trim()).filter(Boolean)
    .some(t => termHits(t, basket));
}

function _getBundleSuggestions() {
  if (!basket.length || !allProducts?.length) return [];
  // Sepetteki kodları string olarak tut (JSON'dan integer gelebilir)
  const basketKodlar = new Set(basket.map(i => String(i.kod ?? '').toLowerCase()));
  const results = [];

  allProducts.forEach((p, idx) => {
    const keys      = Object.keys(p);
    const bundleKey = keys.find(k => norm(k) === 'bundle') || '';   // önce Bundle sütunu
    const descKey   = keys.find(k => norm(k) === 'aciklama') || ''; // yoksa Açıklama'ya bak
    const gamKey    = keys.find(k => norm(k).includes('gam')) || '';
    const urunKey   = keys.find(k => norm(k) === 'urun') || '';

    // Bundle sütunu varsa onu kullan (temiz), yoksa Açıklama'daki ⤚ etiketlerine bak
    const bundleRaw = bundleKey ? (p[bundleKey] || '') : (p[descKey] || '');
    if (!bundleRaw.includes('⤚')) return;

    const segs = parseCampaigns(bundleRaw);
    const bundleSegs = segs.filter(s => s.tip === 'bundle');
    if (!bundleSegs.length) return;
    // Integer Kod → String'e zorla (JSON'dan sayı olarak gelebilir)
    if (basketKodlar.has(String(p.Kod ?? '').toLowerCase())) return;

    // Birden fazla ⤚ koşulu varsa (örn: ⤚CEP|✦⤚A17|⌗), herhangi biri eşleşirse öner
    const matched = bundleSegs.find(bs => _bundleMatches(bs.condition, basket));
    if (!matched) return;

    results.push({
      _idx: idx, urun: p[urunKey] || '', kod: String(p.Kod ?? ''),
      gam: p[gamKey] || '', nakit: parseFloat(p.Nakit) || 0,
      condition: matched.condition, icon: matched.icon,
    });
  });

  // Öncelik: tam kod eşleşmesi > gam eşleşmesi > global (*)
  // Özelden genele sırala — spesifik öneri öne çıkar
  results.sort((a, b) => {
    const score = r => {
      if (r.condition === '*') return 0;                                          // global → en son
      const cLow = r.condition.toLowerCase();
      // Tam kod eşleşmesi → en yüksek puan
      if (basket.some(i => String(i.kod??'').toLowerCase() === cLow)) return 10;
      // ^ başlangıç eşleşmesi içeren AND koşulları (örn: ^55&Tv) → yüksek
      if (r.condition.includes('^') && r.condition.includes('&')) return 8;
      // ^ operatörü var (boyut/model) → yüksek
      if (r.condition.includes('^')) return 7;
      // AND koşulu → orta-yüksek
      if (r.condition.includes('&')) return 6;
      // + OR koşulu (birden fazla gam) → orta
      if (r.condition.includes('+')) return 4;
      // Tek gam/ürün adı eşleşmesi → düşük-orta
      return 3;
    };
    return score(b) - score(a);
  });
  return results.slice(0, 8);
}

function checkUpsellOpportunities() {
  const container = document.getElementById('upsell-bar-container');
  if (!container) return;
  const suggestions = _getBundleSuggestions();

  if (!suggestions.length) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  const iconColor = { '⌗':'#6366f1','✦':'#0ea5e9','🔒':'#f59e0b','❖':'#8b5cf6' };
  const cards = suggestions.map(s => `
    <div class="bundle-pill" onclick="addToBasket(${s._idx})" title="Sepete ekle: ${s.urun}">
      <span class="bundle-pill-icon" style="color:${iconColor[s.icon]||'#6366f1'}">${s.icon||'⌗'}</span>
      <div class="bundle-pill-body">
        <span class="bundle-pill-urun">${s.urun}</span>
        ${s.gam ? `<span class="bundle-pill-gam">${s.gam}</span>` : ''}
      </div>
      ${s.nakit > 0 ? `<span class="bundle-pill-price">${fmt(s.nakit)}</span>` : ''}
      <span class="bundle-pill-add">＋</span>
    </div>`).join('');

  container.innerHTML = `
    <div class="bundle-bar-header">
      <span>🎁</span>
      <span class="bundle-bar-title">Birlikte alınabilir</span>
    </div>
    <div class="bundle-pills-row">${cards}</div>`;
}

window.optimizeCampaigns        = optimizeCampaigns;
window.checkUpsellOpportunities = checkUpsellOpportunities;

// ═══════════════════════════════════════════════════════════════
// 🔥 TREND + SEKMELİ NAVİGASYON
// ═══════════════════════════════════════════════════════════════

let _aktifMainTab = 'urunler';

// switchMainTab — tek tanım (aşağıdaki window.switchMainTab override kaldırıldı)
window.renderKategoriGrid = typeof renderKategoriGrid !== 'undefined' ? renderKategoriGrid : function(){};

// ═══════════════════════════════════════════════════════════════
// 🔥 TREND / VİTRİN FONKSİYONLARI
// ═══════════════════════════════════════════════════════════════

// Son 14 günde en çok blur/detay açılan ürünler
function _trendSkoru() {
  const onceki14 = new Date(Date.now() - 14*24*60*60*1000).toISOString().split('T')[0];
  const skorlar = {};
  if (window._fbAnalytics) {
    Object.values(window._fbAnalytics).forEach(rec => {
      if (!rec.products || (rec.date && rec.date < onceki14)) return;
      Object.entries(rec.products).forEach(([urun, cnt]) => {
        skorlar[urun] = (skorlar[urun] || 0) + cnt;
      });
    });
  }
  try {
    const local = JSON.parse(localStorage.getItem('analytics_local') || '{}');
    Object.entries(local).forEach(([gun, gunRec]) => {
      if (gun < onceki14) return;
      Object.values(gunRec).forEach(userRec => {
        if (!userRec.products) return;
        Object.entries(userRec.products).forEach(([urun, cnt]) => {
          skorlar[urun] = (skorlar[urun] || 0) + cnt;
        });
      });
    });
  } catch(e) {}

  if (!allProducts.length) return [];

  const keys0 = Object.keys(allProducts[0]);
  const urunKey = keys0.find(k => k.toLowerCase().replace(/\s/g,'') === 'urun') ||
                  keys0.find(k => k.toLowerCase().includes('ürün') || k.toLowerCase().includes('urun')) ||
                  keys0[1] || '';

  const analitikSonuc = allProducts
    .map(u => ({ u, urunAdi: u[urunKey] || '', addCnt: skorlar[u[urunKey] || ''] || 0 }))
    .filter(x => x.addCnt > 0)
    .sort((a, b) => b.addCnt - a.addCnt);

  // Analytics verisi varsa döndür
  if (analitikSonuc.length >= 3) return analitikSonuc;

  // Fallback: prim değerine göre sırala (analytics henüz oluşmamışsa)
  const primKey = keys0.find(k => k.toLowerCase() === 'prim') || '';
  const stokKey = keys0.find(k => k.toLowerCase() === 'stok') || '';
  return allProducts
    .filter(u => {
      const stok = stokKey ? parseFloat(u[stokKey]) : 1;
      return isNaN(stok) || stok > 0; // stok > 0 olanlar
    })
    .map(u => ({
      u,
      urunAdi: u[urunKey] || '',
      addCnt: 0,
      _prim: primKey ? (parseFloat(u[primKey]) || 0) : 0
    }))
    .filter(x => x._prim > 0)
    .sort((a, b) => b._prim - a._prim)
    .slice(0, 20);
}

// Ürün nesnesinden nakit fiyatı al (sayı döner, fmt() KULLANMA)
function _nakitFiyat(u) {
  const keys = Object.keys(u);
  const k = keys.find(kk => kk.toLowerCase() === 'nakit') || '';
  return k ? (parseFloat(u[k]) || 0) : 0;
}

// Ürün nesnesinden prim al
function _primDeger(u) {
  const keys = Object.keys(u);
  const k = keys.find(kk => kk.toLowerCase() === 'prim') || '';
  return k ? (parseFloat(u[k]) || 0) : 0;
}

// Prim sayısını okunabilir metne çevir
function _primStr(prim) {
  if (!prim || prim <= 0) return '';
  if (prim >= 1000) return (prim/1000).toFixed(prim%1000===0?0:1) + 'K puan';
  return Math.round(prim) + ' puan';
}

// Ürün adından marka önekini çıkar (kartlarda marka tekrar yazmasın)
function _temizAd(item) {
  const keys = Object.keys(item.u);
  const mk = keys.find(k => k.toLowerCase() === 'marka') || '';
  const marka = mk ? (item.u[mk] || '').trim() : '';
  let ad = item.urunAdi || '';
  if (marka && ad.toLowerCase().startsWith(marka.toLowerCase()))
    ad = ad.slice(marka.length).trim();
  return ad || item.urunAdi;
}

function _urunIdx(u) { return allProducts.indexOf(u); }

// Vitrin ürününü allProducts'ta bul
function _vitrinOi(v) {
  if (typeof v.productIdx === 'number' && v.productIdx >= 0) return v.productIdx;
  const keys0 = allProducts.length ? Object.keys(allProducts[0]) : [];
  const uk = keys0.find(k => k.toLowerCase() === 'urun') || '';
  return allProducts.findIndex(u =>
    (u[uk] || '').toLowerCase() === (v.urunAdi || '').toLowerCase()
  );
}

// ── Vitrin arama (admin) ────────────────────────────────────
let _vitrinSeciliIdx = -1;

function vitrinUrunAra(query) {
  const dropdown = document.getElementById('vitrin-urun-dropdown');
  if (!dropdown) return;
  const q = (query || '').trim().toLowerCase();
  if (!q || q.length < 2) {
    dropdown.style.display = 'none';
    _vitrinSeciliIdx = -1;
    return;
  }

  // allProducts henüz dolmadıysa bekle
  if (!allProducts.length) {
    dropdown.innerHTML = '<div class="vitrin-dd-item"><span class="vitrin-dd-ad" style="color:var(--text-3)">Ürün listesi yükleniyor…</span></div>';
    dropdown.style.display = 'block';
    return;
  }

  const keys0 = Object.keys(allProducts[0]);
  // Ürün sütununu bul — büyük/küçük harf ve boşluk toleranslı
  const urunKey = keys0.find(k => k.toLowerCase().replace(/\s/g,'') === 'urun') ||
                  keys0.find(k => k.toLowerCase().includes('ürün') || k.toLowerCase().includes('urun')) ||
                  keys0.find(k => k.toLowerCase() === 'product') || keys0[1] || '';
  const nakitKey = keys0.find(k => k.toLowerCase().replace(/\s/g,'') === 'nakit') || '';
  const notKey   = keys0.find(k => ['not','sipariş notu','aciklama','açıklama','note'].includes(k.toLowerCase())) || '';

  const hits = allProducts
    .map((u, idx) => ({ u, idx }))
    .filter(({ u }) => (u[urunKey] || '').toLowerCase().includes(q))
    .slice(0, 15);

  if (!hits.length) {
    dropdown.innerHTML = '<div class="vitrin-dd-item"><span class="vitrin-dd-ad" style="color:var(--text-3)">Sonuç yok</span></div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.style.display = 'block';
  // Veriyi JS dizisinde sakla — inline JS/tırnak sorunları tamamen önlenir
  dropdown._vitrinHits = hits.map(({ u, idx }) => ({
    idx,
    ad:    u[urunKey] || '',
    nakit: nakitKey ? (parseFloat(u[nakitKey]) || 0) : 0,
    not:   notKey ? (u[notKey] || '') : '',
  }));
  dropdown.innerHTML = dropdown._vitrinHits.map((item, i) => `
    <div class="vitrin-dd-item" data-i="${i}">
      <span class="vitrin-dd-ad">${item.ad}</span>
      ${item.nakit > 0 ? `<span class="vitrin-dd-fiyat">${fmt(item.nakit)}</span>` : ''}
    </div>`).join('');
  // Event delegation — tek listener, hiç inline JS yok
  dropdown.onclick = function(e) {
    const row = e.target.closest('.vitrin-dd-item');
    if (!row) return;
    const i = parseInt(row.dataset.i);
    const hit = dropdown._vitrinHits[i];
    if (hit) vitrinUrunSec(hit.idx, hit.ad, hit.nakit, hit.not);
  };
}

function vitrinUrunSec(idx, urunAdi, nakit, not) {
  _vitrinSeciliIdx = typeof idx === 'number' ? idx : parseInt(idx) || -1;
  const g = id => document.getElementById(id);

  const inp = g('vitrin-urun-input');
  if (inp) {
    inp.value = urunAdi || '';
    inp.style.borderColor = '#16a34a';
    inp.style.background  = '#f0fdf4';
    setTimeout(() => { inp.style.borderColor = ''; inp.style.background = ''; }, 1500);
  }
  const fiyatInp = g('vitrin-fiyat-input');
  if (fiyatInp && nakit > 0) fiyatInp.value = nakit;

  const acInp = g('vitrin-aciklama-input');
  if (acInp) acInp.value = not || '';

  // Dropdown'ı kapat
  const dd = g('vitrin-urun-dropdown');
  if (dd) dd.style.display = 'none';

  // Toast
  if (typeof _campToast === 'function') {
    const ad = (urunAdi || '').slice(0, 28) + ((urunAdi||'').length > 28 ? '…' : '');
    _campToast('✓ ' + ad + ' seçildi', 'ok');
  }
}
window.vitrinUrunSec = vitrinUrunSec;

// ── Trend Kartlar — ana ekran yatay scroll ──────────────────
function renderTrendCards() {
  const container = document.getElementById('trend-cards');
  if (!container) return;

  const vitrinAktif = _vitrinUrunler.filter(v => v.aktif !== false);
  const trendLimit  = vitrinAktif.length > 0 ? 6 : 12;
  const trendData   = _trendSkoru().slice(0, trendLimit);

  if (!vitrinAktif.length && !trendData.length) {
    // Fallback: puan sıralamasıyla göster
    const keys0 = allProducts.length ? Object.keys(allProducts[0]) : [];
    const urunKey = keys0.find(k => k.toLowerCase().replace(/\s/g,'') === 'urun') ||
                    keys0.find(k => k.toLowerCase().includes('urun')) || keys0[1] || '';
    const primKey = keys0.find(k => k.toLowerCase() === 'prim') || '';
    const stokKey = keys0.find(k => k.toLowerCase() === 'stok') || '';
    const fallback = allProducts
      .filter(u => {
        const prim = primKey ? (parseFloat(u[primKey]) || 0) : 0;
        const stok = stokKey ? parseFloat(u[stokKey]) : 1;
        return prim > 0 && (isNaN(stok) || stok > 0);
      })
      .sort((a, b) => (parseFloat(b[primKey]||0)) - (parseFloat(a[primKey]||0)))
      .slice(0, 8);

    if (!fallback.length) {
      document.getElementById('trend-panel')?.classList.add('search-active');
      return;
    }
    const subEl = document.getElementById('trend-date-range');
    if (subEl) subEl.textContent = 'yüksek puan';

    container.innerHTML = fallback.map(u => {
      const oi    = allProducts.indexOf(u);
      const ad    = u[urunKey] || '';
      const nakit = _nakitFiyat(u);
      const prim  = _primDeger(u);
      const primT = _primStr(prim);
      return `<div class="trend-card"
        onclick="switchMainTab('urunler');setTimeout(()=>{const s=document.getElementById('search');if(s){s.value=${JSON.stringify(ad.split(' ').slice(0,3).join(' '))};filterData();}},100)">
        <div class="trend-rank" style="color:#b45309">★</div>
        <div class="trend-card-name">${ad}</div>
        <div class="trend-card-meta">
          ${nakit > 0 ? `<span class="trend-card-price">${fmt(nakit)}</span>` : ''}
        </div>
        ${primT ? `<div style="font-size:.58rem;color:#b45309;font-weight:700;margin:1px 0 2px">${primT}</div>` : ''}
        <button class="trend-card-add haptic-btn"
          onclick="event.stopPropagation();${oi >= 0 ? 'vitrinSepeteEkle(' + oi + ')' : ''}"
          title="Sepete ekle">+ Sepete</button>
      </div>`;
    }).join('');
    return;
  }
  const subEl = document.getElementById('trend-date-range');
  if (subEl) subEl.textContent = 'son 14 gün';

  // Vitrin Şampiyonları kartları — premium açık altın/amber tema
  const vitrinHtml = vitrinAktif.map(v => {
    const oi    = _vitrinOi(v);
    const prim  = oi >= 0 ? _primDeger(allProducts[oi]) : 0;
    const primT = _primStr(prim);
    return `<div class="trend-card vitrin-card"
      onclick="switchMainTab('urunler');setTimeout(()=>{const s=document.getElementById('search');if(s){s.value=${JSON.stringify(v.urunAdi.split(' ').slice(0,3).join(' '))};filterData();}},100)">
      <div class="trend-rank" style="font-size:.62rem;font-weight:900;color:#d97706">🛍️</div>
      <div class="trend-card-name">${v.urunAdi}</div>
      <div class="trend-card-meta">
        <span class="trend-card-price">${fmt(v.fiyat)}</span>
        ${primT ? `<span class="trend-card-score">${primT}</span>` : ''}
      </div>
      ${v.aciklama ? `<div style="font-size:.59rem;color:#78716c;line-height:1.3;margin:2px 0 4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical">${v.aciklama}</div>` : ''}
      <button class="trend-card-add haptic-btn"
        onclick="event.stopPropagation();${oi >= 0 ? 'vitrinSepeteEkle(' + oi + ')' : ''}"
        title="Sepete ekle">＋ Ekle</button>
    </div>`;
  }).join('');

  // Popüler ürün kartları — isim + fiyat + prim
  const trendHtml = trendData.map((item, i) => {
    const rank    = i + 1;
    const rankCls = rank <= 3 ? 'rank-' + rank : '';
    const oi      = _urunIdx(item.u);
    const gorAd   = _temizAd(item);
    const nakit   = _nakitFiyat(item.u);
    const prim    = _primDeger(item.u);
    const primT   = _primStr(prim);
    return `<div class="trend-card"
      onclick="switchMainTab('urunler');setTimeout(()=>{
        const s=document.getElementById('search');
        if(s){s.value=${JSON.stringify(item.urunAdi.split(' ').slice(0,3).join(' '))};filterData();}
      },100)">
      <div class="trend-rank ${rankCls}">#${rank}</div>
      <div class="trend-card-name">${gorAd}</div>
      <div class="trend-card-meta">
        ${nakit > 0 ? `<span class="trend-card-price">${fmt(nakit)}</span>` : ''}
        ${item.addCnt > 0 ? `<span class="trend-card-score">${item.addCnt}×</span>` : ''}
      </div>
      ${primT ? `<div style="font-size:.57rem;color:#b45309;font-weight:700;margin:1px 0 4px;background:#fffbeb;padding:1px 6px;border-radius:5px;display:inline-block">${primT}</div>` : ''}
      <button class="trend-card-add haptic-btn"
        onclick="event.stopPropagation();${oi >= 0 ? 'vitrinSepeteEkle(' + oi + ')' : ''}"
        title="Sepete ekle">＋ Ekle</button>
    </div>`;
  }).join('');

  container.innerHTML = vitrinHtml + trendHtml;
}

// ── Kampanya Sekmesi Tam Liste ───────────────────────────────
function renderTrendFullList() {
  const container = document.getElementById('trend-full-list');
  if (!container) return;

  const vitrinAktif = _vitrinUrunler.filter(v => v.aktif !== false);
  const trendData   = _trendSkoru().slice(0, 20);

  if (!vitrinAktif.length && !trendData.length) {
    // Prim'e göre fallback göster — her zaman bir şey çıksın
    const keys0 = allProducts.length ? Object.keys(allProducts[0]) : [];
    const urunKey = keys0.find(k => k.toLowerCase().replace(/\s/g,'') === 'urun') ||
                    keys0.find(k => k.toLowerCase().includes('urun')) || keys0[1] || '';
    const primKey = keys0.find(k => k.toLowerCase() === 'prim') || '';
    const stokKey = keys0.find(k => k.toLowerCase() === 'stok') || '';
    const fallback = allProducts
      .filter(u => {
        const stok = stokKey ? parseFloat(u[stokKey]) : 1;
        const prim = primKey ? (parseFloat(u[primKey]) || 0) : 0;
        return prim > 0 && (isNaN(stok) || stok > 0);
      })
      .sort((a, b) => (parseFloat(b[primKey]||0)) - (parseFloat(a[primKey]||0)))
      .slice(0, 12);

    if (!fallback.length) {
      container.innerHTML = `<div style="grid-column:1/-1;padding:32px 16px;text-align:center">
        <div style="font-size:2rem;margin-bottom:8px">🛍️</div>
        <div style="font-size:.78rem;color:var(--text-3);line-height:1.6">
          Admin panelinden vitrin ürünü ekleyin.
        </div>
      </div>`;
      return;
    }

    container.innerHTML =
      `<div style="grid-column:1/-1;display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:.72rem;font-weight:800;color:var(--text-1)">🏆 Yüksek Primli Ürünler</span>
        <span style="font-size:.60rem;color:var(--text-3)">puan sıralaması</span>
      </div>` +
      fallback.map(u => {
        const oi    = allProducts.indexOf(u);
        const ad    = u[urunKey] || '';
        const nakit = _nakitFiyat(u);
        const prim  = _primDeger(u);
        const primT = _primStr(prim);
        return `<div class="trend-full-card">
          <div class="trend-full-rank" style="color:#b45309">★</div>
          <div class="trend-full-name">${ad}</div>
          ${nakit > 0 ? `<div class="trend-full-price">${fmt(nakit)}</div>` : ''}
          ${primT ? `<div class="trend-full-meta" style="color:#b45309;font-weight:700">${primT}</div>` : ''}
          <button class="trend-full-add haptic-btn"
            onclick="${oi >= 0 ? 'vitrinSepeteEkle(' + oi + ')' : ''}">🛒 Sepete Ekle</button>
        </div>`;
      }).join('');
    return;
  }

  let html = '';

  // Vitrin Şampiyonları
  if (vitrinAktif.length) {
    html += `<div style="grid-column:1/-1;display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <span style="font-size:.72rem;font-weight:800;color:var(--text-1)">🛍️ Vitrin Şampiyonları</span>
      <span style="font-size:.60rem;color:var(--text-3)">admin seçimi</span>
    </div>`;
    html += vitrinAktif.map(v => {
      const oi    = _vitrinOi(v);
      const prod  = (oi >= 0 && oi < allProducts.length) ? allProducts[oi] : null;
      const prim  = prod ? _primDeger(prod) : 0;
      const primT = _primStr(prim);
      return `<div class="trend-full-card vitrin-full-card" style="border-left:3px solid #7c3aed">
        <div class="trend-full-rank" style="color:#7c3aed">🛍️</div>
        <div class="trend-full-name">${v.urunAdi}</div>
        <div class="trend-full-price">${fmt(v.fiyat)}</div>
        ${primT ? `<div class="trend-full-meta" style="color:#b45309;font-weight:700">${primT}</div>` : ''}
        ${v.kampanya ? `<div class="trend-full-meta" style="color:#92400e">${v.kampanya}</div>` : ''}
        ${v.aciklama ? `<div style="font-size:.66rem;color:var(--text-2);line-height:1.4;margin-top:2px">${v.aciklama}</div>` : ''}
        <button class="trend-full-add haptic-btn"
          onclick="${oi >= 0 ? 'vitrinSepeteEkle(' + oi + ')' : ''}">🛒 Sepete Ekle</button>
      </div>`;
    }).join('');
  }

  // Popüler Ürünler
  if (trendData.length) {
    html += `<div style="grid-column:1/-1;display:flex;align-items:center;gap:8px;
      margin-top:${vitrinAktif.length ? '12px' : '0'};margin-bottom:4px">
      <span style="font-size:.72rem;font-weight:800;color:var(--text-1)">🔥 Popüler Ürünler</span>
      <span style="font-size:.60rem;color:var(--text-3)">son 14 gün</span>
    </div>`;
    html += trendData.map((item, i) => {
      const rank    = i + 1;
      const rankCls = rank <= 3 ? 'rank-' + rank : '';
      const oi      = _urunIdx(item.u);
      const gorAd   = _temizAd(item);
      const nakit   = _nakitFiyat(item.u);
      const prim    = _primDeger(item.u);
      const primT   = _primStr(prim);
      return `<div class="trend-full-card">
        <div class="trend-full-rank ${rankCls}">#${rank}</div>
        <div class="trend-full-name">${gorAd}</div>
        ${nakit > 0 ? `<div class="trend-full-price">${fmt(nakit)}</div>` : ''}
        <div class="trend-full-meta">
          ${item.addCnt > 0 ? item.addCnt + '× görüntülendi' : ''}
          ${primT ? (item.addCnt > 0 ? ' · ' : '') + primT : ''}
        </div>
        <button class="trend-full-add haptic-btn"
          onclick="${oi >= 0 ? 'vitrinSepeteEkle(' + oi + ')' : ''}">🛒 Sepete Ekle</button>
      </div>`;
    }).join('');
  }

  container.innerHTML = html;
}

// ── window export ───────────────────────────────────────────

// ── Vitrin ürününü sepete ekle ve sepeti aç ─────────────────
// addToBasket + toggleCart açar, abaküse yönlendirmez (kullanıcı seçer)
function vitrinSepeteEkle(oi) {
  if (oi < 0 || oi >= allProducts.length) {
    _campToast('Ürün listede bulunamadı.', 'warn');
    return;
  }
  addToBasket(oi);
  // Sepet modalını aç
  setTimeout(() => {
    const cart = document.getElementById('cart-modal');
    if (cart && !cart.classList.contains('open')) {
      cart.style.display = 'flex';
      cart.classList.add('open');
      updateCartUI();
    }
  }, 120);
  haptic(22);
}
window.vitrinSepeteEkle = vitrinSepeteEkle;

window.renderTrendCards    = renderTrendCards;
window.renderTrendFullList = renderTrendFullList;
window.vitrinUrunAra       = vitrinUrunAra;
window.vitrinUrunSec       = vitrinUrunSec;

// ═══════════════════════════════════════════════════════════════
// 🛍️ VİTRİN (KAMPANYA ÜRÜNLERİ) YÖNETİMİ
// ═══════════════════════════════════════════════════════════════

async function saveVitrinUrun() {
  const urunAdi  = document.getElementById('vitrin-urun-input')?.value?.trim();
  const fiyat    = parseFloat(document.getElementById('vitrin-fiyat-input')?.value || '0');
  const kampanya = document.getElementById('vitrin-kampanya-input')?.value?.trim() || '';
  const aciklama = document.getElementById('vitrin-aciklama-input')?.value?.trim() || '';

  if (!urunAdi) { _campToast('Ürün adı girilmedi.', 'warn'); return; }
  if (!fiyat)   { _campToast('Fiyat girilmedi.', 'warn'); return; }

  // Dropdown'dan seçilmemişse isim ile eşleştir
  let productIdx = _vitrinSeciliIdx;
  if (productIdx < 0 && allProducts.length) {
    const keys0 = Object.keys(allProducts[0]);
    const urunKey = keys0.find(k => k.toLowerCase().replace(/\s/g,'') === 'urun') ||
                    keys0.find(k => k.toLowerCase().includes('urun')) || keys0[1] || '';
    productIdx = allProducts.findIndex(u =>
      (u[urunKey] || '').toLowerCase() === urunAdi.toLowerCase()
    );
  }

  try {
    await setDoc(doc(_db, 'vitrin', 'vitrin_' + Date.now()), {
      urunAdi, fiyat, kampanya, aciklama, productIdx,
      aktif: true,
      ts: serverTimestamp(),
      ekleyen: currentUser?.Email || '-'
    });
    ['vitrin-urun-input','vitrin-fiyat-input','vitrin-kampanya-input','vitrin-aciklama-input']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const dd = document.getElementById('vitrin-urun-dropdown');
    if (dd) dd.style.display = 'none';
    _vitrinSeciliIdx = -1;
    _campToast('Vitrine eklendi! 🛍️', 'ok');
  } catch(e) {
    _campToast('Kayıt hatası: ' + e.message, 'warn');
  }
}

async function deleteVitrinUrun(id) {
  try { await deleteDoc(doc(_db, 'vitrin', id)); }
  catch(e) { console.warn('vitrin sil:', e); }
}

async function toggleVitrinUrun(id, aktif) {
  try { await updateDoc(doc(_db, 'vitrin', id), { aktif: !aktif }); }
  catch(e) { console.warn('vitrin toggle:', e); }
}

function renderAdminVitrinList() {
  const el = document.getElementById('admin-vitrin-list');
  if (!el) return;
  if (!_vitrinUrunler.length) {
    el.innerHTML = '<div class="admin-empty">Henüz vitrin ürünü yok.</div>';
    return;
  }
  el.innerHTML = _vitrinUrunler.map(v => `
    <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
      <div style="flex:1;min-width:0">
        <div style="font-size:.76rem;font-weight:700;color:var(--text-1)">${v.urunAdi}</div>
        <div style="font-size:.65rem;color:var(--text-3)">
          ${fmt(v.fiyat)}'+_tlSym()+'${v.kampanya ? ' · ' + v.kampanya : ''}
        </div>
      </div>
      <button onclick="toggleVitrinUrun('${v.id}', ${v.aktif !== false})"
        style="font-size:.62rem;padding:3px 8px;border-radius:6px;border:1px solid var(--border);
          background:${v.aktif !== false ? '#dcfce7' : '#f1f5f9'};
          color:${v.aktif !== false ? '#15803d' : '#64748b'};cursor:pointer;font-family:inherit">
        ${v.aktif !== false ? '✓ Aktif' : '○ Pasif'}
      </button>
      <button onclick="deleteVitrinUrun('${v.id}')"
        style="font-size:.62rem;padding:3px 8px;border-radius:6px;border:1px solid #fca5a5;
          background:#fee2e2;color:#dc2626;cursor:pointer;font-family:inherit">🗑</button>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// 📦 SİPARİŞ BİLDİRİM BARI — Tüm kullanıcılara görünür
// ═══════════════════════════════════════════════════════════════

function renderSiparisBildirimBar() {
  const BAR_ID = 'siparis-bildirim-bar';
  let bar = document.getElementById(BAR_ID);

  if (!bar) {
    const searchEl = document.querySelector('.search-container');
    if (!searchEl) return;
    bar = document.createElement('div');
    bar.id = BAR_ID;
    searchEl.insertAdjacentElement('afterend', bar);
  }

  // Admin için gizle — admin paneli zaten yeterli
  if (isAdmin()) { bar.style.display = 'none'; return; }

  // Hafif hesaplama — sadece mevcut proposals array kullanılır, ağ isteği yok
  try {
    const me         = currentUser?.Email || '';
    const bugun      = new Date().toISOString().slice(0, 10);
    const haftaOnce  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const benimler   = (proposals || []).filter(p => p.user === me);
    const bugunTeklif = benimler.filter(p => _tarih(p.ts) === bugun).length;
    const bugunSatis  = benimler.filter(p => p.durum === 'satisDondu' && (_tarih(p.archivedAt) || _tarih(p.ts)) === bugun).length;
    const haftaTeklif = benimler.filter(p => _tarih(p.ts) >= haftaOnce && _tarih(p.ts) !== '').length;
    const haftaSatis  = benimler.filter(p => p.durum === 'satisDondu' && (_tarih(p.archivedAt) || _tarih(p.ts)) >= haftaOnce).length;
    const donusum     = haftaTeklif > 0 ? Math.round((haftaSatis / haftaTeklif) * 100) : 0;

    let emoji, mesaj, alt = '', renk;
    if      (bugunSatis >= 3) { emoji='🔥'; renk='#15803d'; mesaj=`Bugün ${bugunSatis} satış kapattın!`; alt='Harika performans!'; }
    else if (bugunSatis === 2) { emoji='💪'; renk='#1d4ed8'; mesaj=`Bugün ${bugunSatis} satış`; alt='Bir tane daha!'; }
    else if (bugunSatis === 1) { emoji='✅'; renk='#0369a1'; mesaj='Bugün 1 satış yaptın'; alt='İkinciye ulaş!'; }
    else if (bugunTeklif >= 2) { emoji='⚡'; renk='#b45309'; mesaj=`${bugunTeklif} aktif teklif`; alt='Birini satışa dönüştür!'; }
    else if (haftaSatis > 0)   { emoji='📈'; renk='#0369a1'; mesaj=`Bu hafta ${haftaSatis} satış · %${donusum} dönüşüm`; alt='Bugün yeni teklif oluştur!'; }
    else if (haftaTeklif > 0)  { emoji='🎯'; renk='#7c3aed'; mesaj=`${haftaTeklif} teklif takipte`; alt='Satışa dönüştürmek için ara!'; }
    else                       { emoji='🚀'; renk='#7c3aed'; mesaj='İlk teklifini oluştur!'; alt='Bugün bir müşteri kazan.'; }

    bar.style.display = 'block';
    bar.innerHTML = `<div style="display:flex;align-items:center;gap:10px;
      background:var(--surface-2);border-bottom:1px solid var(--border);
      padding:7px 13px;font-size:.66rem;line-height:1.4;">
      <span style="font-size:1.05rem;flex-shrink:0">${emoji}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;color:${renk}">${mesaj}</div>
        ${alt ? `<div style="color:var(--text-3);font-size:.60rem;margin-top:1px">${alt}</div>` : ''}
      </div>
      ${haftaTeklif > 0 ? `<span style="font-size:.58rem;color:var(--text-3);flex-shrink:0;text-align:right">${haftaTeklif} teklif<br>7 gün</span>` : ''}
    </div>`;
  } catch(e) { bar.style.display = 'none'; }
}

// ═══════════════════════════════════════════════════════════════
// 🔥 TREND VE VİTRİN RENDER — Yeniden yazım
// ═══════════════════════════════════════════════════════════════


// switchMainTab — tek ve kesin tanım
function switchMainTab(tab) {
  _aktifMainTab = tab;

  // Tüm sekme içeriklerini gizle/göster — display:none/block doğrudan
  ['urunler','trend'].forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (!el) return;
    el.style.cssText = el.style.cssText.replace(/display\s*:\s*[^;]+;?/gi, '');
    el.style.display = (t === tab) ? 'block' : 'none';
  });

  // Buton aktif sınıfı
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  // Trend sekmesi içeriğini doldur
  if (tab === 'trend') {
    // allProducts henüz dolmamışsa kısa bekleme
    if (!allProducts.length) {
      const container = document.getElementById('trend-full-list');
      if (container) container.innerHTML =
        '<div style="grid-column:1/-1;padding:32px;text-align:center;color:var(--text-3);font-size:.78rem">Ürün listesi yükleniyor…</div>';
      setTimeout(() => { if (_aktifMainTab === 'trend') renderTrendFullList(); }, 1500);
    } else {
      renderTrendFullList();
    }
  }

  // Arama kutusunu temizle
  if (tab !== 'urunler') {
    const s = document.getElementById('search');
    if (s && s.value) { s.value = ''; filterData(); }
  }

  // Ana ekran trend paneli gizle/göster
  const tp = document.getElementById('trend-panel');
  if (tp) tp.classList.toggle('search-active', tab !== 'urunler');

  haptic(8);
}
window.switchMainTab = switchMainTab;

// ═══════════════════════════════════════════════════════════════
// 📊 MY STATS — Personel Performans Dashboard (BTB / BTS / Gamification)
// ═══════════════════════════════════════════════════════════════

// ── Daily Stats: Atomic Increment ───────────────────────────────
// Her satış veya sepet oluşturmada `users/{email}/daily_stats` dokümanını günceller.
// Tüm logları okumak yerine tek doküman okuyarak performans gösterilebilir.
async function incrementDailyStat(field, value = 1) {
  if (!currentUser || !_db) return;
  const today = new Date().toISOString().split('T')[0];
  const ref = doc(_db, 'users', currentUser.Email, 'daily_stats', today);
  try {
    await setDoc(ref, {
      personelId:  currentUser.Email,
      personelAd:  currentUser.Ad || currentUser.Email.split('@')[0],
      tarih:       today,
      magazaTipi:  getMagazaTipi(),
      [field]:     increment(value),
      lastUpdate:  serverTimestamp()
    }, { merge: true });
  } catch (e) { console.warn('incrementDailyStat:', e); }
}
window.incrementDailyStat = incrementDailyStat;

// ── Haftanın Yıldızı + Tam Sıralama ──────────────────────────
async function fetchWeeklyStar() {
  if (!_db) return null;
  try {
    const haftaOnceTar = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dsSnap = await getDocs(query(collectionGroup(_db, 'daily_stats'), where('tarih', '>=', haftaOnceTar)));

    const counts = {};
    dsSnap.docs.forEach(d => {
      const pathParts = d.ref.path.split('/');
      const email = pathParts[1]; if (!email) return;
      const sd = d.data();
      if (!counts[email]) counts[email] = { satis:0, blur:0, teklif:0, magazaTipi: sd.magazaTipi||'' };
      counts[email].satis  += sd.satis_sayisi || 0;
      counts[email].blur   += sd.blur_count   || 0;
      counts[email].teklif += sd.teklif_count || 0;
      if (!counts[email].magazaTipi && sd.magazaTipi) counts[email].magazaTipi = sd.magazaTipi;
    });

    if (!Object.keys(counts).length) return null;

    const ranked = Object.entries(counts)
      .sort((a,b) => b[1].satis - a[1].satis)
      .map(([email, data], i) => ({
        email, count: data.satis, blur: data.blur,
        teklif: data.teklif, magazaTipi: data.magazaTipi, rank: i+1
      }));

    // Mağaza bazlı lig
    const magazaMap = {};
    ranked.forEach(r => {
      const m = (r.magazaTipi||'BELIRSIZ').toUpperCase();
      if (!magazaMap[m]) magazaMap[m] = { satis:0, kisi:0 };
      magazaMap[m].satis += r.count;
      magazaMap[m].kisi++;
    });
    const magazaLigi = Object.entries(magazaMap)
      .sort((a,b) => b[1].satis - a[1].satis)
      .map(([mag, data]) => ({ mag, ...data, ortSatis: data.kisi > 0 ? +(data.satis/data.kisi).toFixed(1) : 0 }));

    // Mikro rozetler
    const kapanisUstasi  = ranked.filter(r=>r.teklif>0).sort((a,b)=>(b.count/b.teklif)-(a.count/a.teklif))[0];
    const teklifCanavarı = [...ranked].sort((a,b)=>b.teklif-a.teklif)[0];
    const sepetSihirbazi = ranked.filter(r=>r.blur>0).sort((a,b)=>(b.teklif/b.blur)-(a.teklif/a.blur))[0];

    return {
      email: ranked[0]?.email, count: ranked[0]?.count,
      ranked, total: ranked.length,
      magazaLigi,
      rozetler: { kapanisUstasi, teklifCanavarı, sepetSihirbazi }
    };
  } catch(e) { console.warn('fetchWeeklyStar:', e); return null; }
}

// ── MyStats Modal Aç ──────────────────────────────────────────
async function openMyStats() {
  haptic(18);
  const modal = document.getElementById('mystats-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.classList.add('open');
  renderMyStats();
}
window.openMyStats = openMyStats;

function closeMyStats() {
  const modal = document.getElementById('mystats-modal');
  if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
}
window.closeMyStats = closeMyStats;

// ── Ana render fonksiyonu ─────────────────────────────────────
// ── Aktif dönem seçimi (segmented control state) ────────────
let _myStatsDone  = false;   // veri bir kez yüklenince true
let _myStatsCache = null;    // hesaplanan ham veriler
let _myStatsPeriod = 'hafta'; // 'bugun' | 'hafta' | 'ay'

async function renderMyStats() {
  const container = document.getElementById('mystats-body');
  if (!container) return;
  container.innerHTML = '<div class="mystats-loading">⏳ Yükleniyor…</div>';

  const me  = currentUser?.Email || '';
  const ad  = currentUser?.Ad || me.split('@')[0];
  const now = new Date();
  const bugun     = now.toISOString().slice(0, 10);
  const haftaOnce = new Date(now - 7  * 86400000).toISOString().slice(0, 10);
  const ayOnce    = new Date(now - 30 * 86400000).toISOString().slice(0, 10);

  const benimler = (proposals || []).filter(p => p.user === me);
  const blurData = await _getMyBlurStats(me);
  const dun = new Date(now - 86400000).toISOString().slice(0, 10);

  // daily_stats'tan doğrudan satis_sayisi oku (dün dahil)
  let dsStats = { bugun: 0, hafta: 0, ay: 0, dun: 0, dunTeklif: 0 };
  try {
    if (_db && me) {
      const dsSnap = await getDocs(query(
        collection(_db, 'users', me, 'daily_stats'), where('tarih', '>=', ayOnce)
      ));
      dsSnap.docs.forEach(d => {
        const sd = d.data(); const tarih = sd.tarih || d.id; const s = sd.satis_sayisi || 0;
        dsStats.ay += s;
        if (tarih >= haftaOnce) dsStats.hafta += s;
        if (tarih === bugun)    dsStats.bugun  += s;
        if (tarih === dun)    { dsStats.dun     = s; dsStats.dunTeklif = sd.teklif_sayisi || 0; }
      });
    }
  } catch(e) { console.warn('renderMyStats ds:', e); }

  const _calc = (tarihFiltre, satisTarih, blurN, dsS) => {
    const teklif = benimler.filter(p => _tarih(p.ts) >= tarihFiltre && _tarih(p.ts) !== '').length;
    const satis  = dsS;
    const ciro   = benimler.filter(p => p.durum==='satisDondu' && (_tarih(p.archivedAt) || _tarih(p.ts)) >= satisTarih)
                           .reduce((s,p) => s + (p.nakit||0), 0);
    const bts = teklif > 0 ? Math.min(100, (satis / teklif) * 100) : null;
    const btb = (blurN > 0 && teklif <= blurN) ? Math.round((teklif / blurN) * 100) : null;
    return { teklif, satis, ciro, blur: blurN, btb, bts };
  };

  const d = {
    bugun: (() => {
      const t = benimler.filter(p => _tarih(p.ts) === bugun).length;
      const s = dsStats.bugun;
      const c = benimler.filter(p => p.durum==='satisDondu' && (_tarih(p.archivedAt) || _tarih(p.ts)) === bugun)
                        .reduce((sum,p) => sum + (p.nakit||0), 0);
      const blurN = blurData.bugun || 0;
      const bts   = t > 0 ? Math.min(100, (s / t) * 100) : null;
      const btb   = (blurN > 0 && t <= blurN) ? Math.round((t / blurN) * 100) : null;
      return { teklif:t, satis:s, ciro:c, blur:blurN, btb, bts };
    })(),
    hafta: _calc(haftaOnce, haftaOnce, blurData.hafta || 0, dsStats.hafta),
    ay:    _calc(ayOnce,    ayOnce,    blurData.ay    || 0, dsStats.ay),
  };
  // Mağaza ortalaması: star objesinden haftalık hesaplanacak (fetchWeeklyStar sonrası)
  _myStatsCache = { d, me, ad, bugun, dun, dsStats };

  // Haftanın Yıldızı (async — UI'dan bağımsız)
  const star = await fetchWeeklyStar();
  const benimYildiz = star && star.email === me;
  _myStatsCache.star = star;
  _myStatsCache.benimYildiz = benimYildiz;

  _renderMyStatsUI();
}
window.renderMyStats = renderMyStats;

// ── Segmented Control: dönem değiştir ────────────────────────
function switchMyStatsPeriod(p) {
  _myStatsPeriod = p;
  // Butonları güncelle
  ['bugun','hafta','ay'].forEach(t => {
    const btn = document.getElementById('ms-seg-' + t);
    if (btn) btn.classList.toggle('ms-seg-active', t === p);
  });
  if (_myStatsCache) _renderMyStatsUI();
  haptic(8);
}
window.switchMyStatsPeriod = switchMyStatsPeriod;

// ── Saf UI render (veri değişmeden yeniden çizilebilir) ──────

function _renderMyStatsUI() {
  const container = document.getElementById('mystats-body');
  if (!container || !_myStatsCache) return;
  const { d, me, ad, bugun, dun, dsStats, star, benimYildiz } = _myStatsCache;
  const p  = _myStatsPeriod;
  const v  = d[p];
  const tlS = _tlSym();

  const BTS_HEDEF = 30;

  // ── Motivasyon ──────────────────────────────────────────────────
  const { emoji: motEmoji, mesaj: motMesaj, renk: motRenk } =
    _getMotivation(d.bugun.satis, d.bugun.teklif, d.hafta.satis, v.bts, d.bugun.blur);

  const periodLabel = { bugun:'Bugün', hafta:'Bu Hafta', ay:'Bu Ay' }[p];

  // ── Kapanış Oranı ───────────────────────────────────────────────
  const btsVal      = v.bts !== null ? v.bts : 0;
  const btsHedefPct = Math.min(100, (btsVal / BTS_HEDEF) * 100);
  const btsRenk     = btsVal >= BTS_HEDEF ? '#15803d' : btsVal >= 15 ? '#b45309' : '#dc2626';
  const btsHint     = v.bts === null
    ? '🚀 Henüz teklif yok — hemen bir teklif oluştur!'
    : btsVal >= BTS_HEDEF ? '✅ Hedefi aştın! Kapanış ustasısın.'
    : btsVal >= 15 ? `👍 İyi gidiyorsun — hedef %${BTS_HEDEF}`
    : `⚠️ Her 5 tekliften en az 1'i satışa dönüşmeli`;

  // ── Sepet Dönüşüm Oranı ─────────────────────────────────────────
  const btbRaw  = v.btb !== null ? Math.min(100, v.btb) : null;
  const btbVal  = btbRaw !== null ? btbRaw : 0;
  const btbWarn = btbRaw !== null && btbVal < 20;
  const btbAcil = btbRaw !== null && btbVal < 5 && (v.blur||0) > 10;
  const btbHint = btbRaw === null
    ? '🚀 Hemen bir ürün fiyatı sorgula, veriler burada görünsün!'
    : btbAcil       ? `🚨 Çok fazla fiyat sorgusu boşa gidiyor — acil müdahale et! (%${btbVal})`
    : btbVal < 20   ? `⚠️ Fiyat gören müşterilerin %${btbVal}'i teklife döndü — konuşmayı ilerlet`
    : btbVal < 50   ? `👍 ${btbVal}% — her 2 fiyat bakışından biri teklife dönüyor`
    : `🔥 ${btbVal}% — fiyat gören müşterilerin çoğu teklif alıyor`;

  // ── Lider & sıralama verileri ───────────────────────────────────
  const meRank = star?.ranked?.find(r => r.email === me);
  const lider  = star?.ranked?.[0];
  const ranked = star?.ranked || [];
  const topN   = ranked.slice(0, 3);
  const total  = star?.total || topN.length;

  // ── Dün vs Bugün delta ──────────────────────────────────────────
  const dunSatis  = dsStats?.dun || 0;
  const dunTeklif = dsStats?.dunTeklif || 0;
  const bugSatis  = d.bugun.satis;
  const bugTeklif = d.bugun.teklif;
  const deltaS    = bugSatis  - dunSatis;
  const deltaT    = bugTeklif - dunTeklif;
  const _delta = (val, label) => {
    if (val === 0) return `<span style="color:#64748b">= ${label}</span>`;
    const col = val > 0 ? '#15803d' : '#dc2626';
    const ico = val > 0 ? '▲' : '▼';
    return `<span style="color:${col}">${ico}${Math.abs(val)} ${label}</span>`;
  };

  // ── Mağaza ortalaması (haftalık star verisinden) ─────────────────
  const magazaLig  = star?.magazaLigi || [];
  const beniMag    = typeof getMagazaTipi === 'function' ? getMagazaTipi() : '';
  const magData    = magazaLig.find(m => m.mag === beniMag);
  const magOrt     = magData?.ortSatis || 0;
  const magLiderS  = lider?.count || 0;
  const meSatis    = meRank?.count || 0;

  // ── Rozet puanı / sonraki rozet ─────────────────────────────────
  const roz = star?.rozetler || {};
  let sonrakiRozetHtml = '';
  const hafSatis = d.hafta.satis;
  const hafTeklif = d.hafta.teklif;
  if (!roz.kapanisUstasi && hafTeklif > 0) {
    const hedefBTS = 40; // Kapanış Ustası için %40 BTS gerekli
    const meHafBTS = hafTeklif > 0 ? Math.round(hafSatis/hafTeklif*100) : 0;
    const eksik = Math.ceil((hedefBTS/100 * hafTeklif) - hafSatis);
    if (eksik > 0 && eksik <= 5) {
      sonrakiRozetHtml = `
        <div style="background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:12px;padding:10px 14px;margin-top:8px;border:1px solid #fbbf2433;display:flex;align-items:center;gap:10px">
          <span style="font-size:1.1rem">🎯</span>
          <div style="flex:1">
            <div style="font-size:.62rem;font-weight:800;color:#fbbf24">Kapanış Ustası rozetine ${eksik} satış kaldı!</div>
            <div style="font-size:.56rem;color:#64748b">Bu hafta BTS %${meHafBTS} → hedef %${hedefBTS}</div>
          </div>
          <div style="background:#fbbf2422;border-radius:8px;padding:4px 8px;font-size:.72rem;font-weight:900;color:#fbbf24">${eksik}</div>
        </div>`;
    }
  }

  // ── Liderden fark çubuğu (kıyaslama) ────────────────────────────
  const _karsilastirmaHtml = (() => {
    if (!star || ranked.length < 2) return '';
    const benimSatis = meSatis;
    const liderSatis = magLiderS || 1;
    const magOrtSat  = magOrt || 0;
    const benimPct   = Math.round((benimSatis  / liderSatis) * 100);
    const ortPct     = Math.round((magOrtSat   / liderSatis) * 100);
    const benimRenk  = meRank?.rank === 1 ? '#f59e0b' : benimSatis >= magOrtSat ? '#15803d' : '#3b82f6';
    const ortOnda    = magOrtSat > 0 && benimSatis < magOrtSat;

    return `
      <div style="background:#0f172a;border-radius:14px;padding:14px 16px;margin-top:10px;border:1px solid #1e293b">
        <div style="font-size:.58rem;font-weight:800;color:#64748b;letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px">📊 HAFTALIK KIYASLAMA</div>

        <!-- Kişi çubukları -->
        <div style="display:flex;flex-direction:column;gap:7px">

          <!-- Lider -->
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:52px;font-size:.58rem;color:#f59e0b;font-weight:700;text-align:right;flex-shrink:0">👑 Lider</div>
            <div style="flex:1;background:#1e293b;border-radius:4px;height:10px;overflow:hidden">
              <div style="height:100%;width:100%;background:linear-gradient(90deg,#f59e0b,#fbbf24);border-radius:4px"></div>
            </div>
            <div style="width:32px;font-size:.66rem;font-weight:900;color:#f59e0b;text-align:left">${liderSatis}</div>
          </div>

          <!-- Ben -->
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:52px;font-size:.58rem;color:${benimRenk};font-weight:700;text-align:right;flex-shrink:0">👤 Sen</div>
            <div style="flex:1;background:#1e293b;border-radius:4px;height:10px;overflow:hidden;position:relative">
              <div style="height:100%;width:${Math.min(100,benimPct)}%;background:${benimRenk};border-radius:4px;transition:width .5s ease"></div>
              ${magOrtSat > 0 ? `<div style="position:absolute;top:0;bottom:0;left:${Math.min(100,ortPct)}%;width:2px;background:#64748b;opacity:.7" title="Mağaza ort."></div>` : ''}
            </div>
            <div style="width:32px;font-size:.66rem;font-weight:900;color:${benimRenk};text-align:left">${benimSatis}</div>
          </div>

          <!-- Mağaza ort -->
          ${magOrtSat > 0 ? `
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:52px;font-size:.58rem;color:#64748b;font-weight:700;text-align:right;flex-shrink:0">⌀ Ort.</div>
            <div style="flex:1;background:#1e293b;border-radius:4px;height:10px;overflow:hidden">
              <div style="height:100%;width:${Math.min(100,ortPct)}%;background:#334155;border-radius:4px"></div>
            </div>
            <div style="width:32px;font-size:.66rem;font-weight:900;color:#64748b;text-align:left">${magOrtSat}</div>
          </div>` : ''}
        </div>

        <!-- Fark mesajı -->
        <div style="margin-top:10px;padding:8px 10px;border-radius:8px;background:#1e293b;font-size:.63rem;font-weight:700;color:#f1f5f9;line-height:1.5">
          ${meRank?.rank === 1
            ? `🏆 Lidersin! ${ranked[1] ? `${meSatis - ranked[1].count} satış önündesin — durma!` : 'Tebrikler!'}`
            : liderSatis > meSatis
              ? `Zirveye <span style="color:#fbbf24;font-size:.76rem;font-weight:900"> ${liderSatis - meSatis} satış</span> kaldı`
              : '🎯 Hedef yakın!'}
          ${magOrtSat > 0 && ortOnda
            ? `<span style="display:block;margin-top:3px;font-weight:600;color:#94a3b8">Mağaza ortalaması: ${magOrtSat} — <span style="color:#f87171">${magOrtSat - meSatis} satış geriden geliyorsun</span></span>`
            : magOrtSat > 0 && !ortOnda && meRank?.rank !== 1
              ? `<span style="display:block;margin-top:3px;font-weight:600;color:#86efac">Mağaza ortalamasının üzündesin ✓</span>`
              : ''}
        </div>
      </div>`;
  })();

  // ── Dün vs Bugün kartı ───────────────────────────────────────────
  const _dunBugunHtml = `
    <div style="background:#0f172a;border-radius:14px;padding:12px 16px;margin-top:10px;border:1px solid #1e293b">
      <div style="font-size:.58rem;font-weight:800;color:#64748b;letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px">📅 DÜN vs BUGÜN</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:#1e293b;border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:.55rem;color:#64748b;font-weight:600;text-transform:uppercase;margin-bottom:4px">Dün Satış</div>
          <div style="font-size:1.4rem;font-weight:900;color:#94a3b8">${dunSatis}</div>
          <div style="font-size:.54rem;color:#475569;margin-top:2px">${dunTeklif} teklif</div>
        </div>
        <div style="background:#1e293b;border-radius:10px;padding:10px;text-align:center;border:1px solid ${deltaS > 0 ? '#15803d44' : deltaS < 0 ? '#dc262644' : '#1e293b'}">
          <div style="font-size:.55rem;color:#64748b;font-weight:600;text-transform:uppercase;margin-bottom:4px">Bugün Satış</div>
          <div style="font-size:1.4rem;font-weight:900;color:${deltaS > 0 ? '#4ade80' : deltaS < 0 ? '#f87171' : '#f1f5f9'}">${bugSatis}</div>
          <div style="font-size:.58rem;margin-top:4px;font-weight:700">${_delta(deltaS,'')}</div>
        </div>
        <div style="background:#1e293b;border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:.55rem;color:#64748b;font-weight:600;text-transform:uppercase;margin-bottom:4px">Dün Teklif</div>
          <div style="font-size:1.4rem;font-weight:900;color:#94a3b8">${dunTeklif}</div>
        </div>
        <div style="background:#1e293b;border-radius:10px;padding:10px;text-align:center;border:1px solid ${deltaT > 0 ? '#3b82f644' : '#1e293b'}">
          <div style="font-size:.55rem;color:#64748b;font-weight:600;text-transform:uppercase;margin-bottom:4px">Bugün Teklif</div>
          <div style="font-size:1.4rem;font-weight:900;color:${deltaT > 0 ? '#60a5fa' : '#f1f5f9'}">${bugTeklif}</div>
          <div style="font-size:.58rem;margin-top:4px;font-weight:700">${_delta(deltaT,'')}</div>
        </div>
      </div>
    </div>`;

  // ── Podyum (lider/2./3.) ─────────────────────────────────────────
  const podyumHtml = (() => {
    if (!topN.length) return '';
    const [bir, iki, uc] = topN;
    const _kart = (r, boyut, madalya, renk, border) => {
      if (!r) return '<div></div>';
      const isMe = r.email === me;
      const ad2  = r.email.split('@')[0];
      const bts  = r.teklif > 0 ? Math.round(r.count/r.teklif*100) : null;
      const fark = meRank && !isMe ? r.count - meSatis : null;
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
        <div style="font-size:${boyut==='lg'?'1.8rem':'1.4rem'}">${madalya}</div>
        <div style="width:${boyut==='lg'?'62px':'50px'};height:${boyut==='lg'?'62px':'50px'};
          border-radius:50%;background:linear-gradient(135deg,${renk},${renk}bb);
          display:flex;align-items:center;justify-content:center;
          font-size:${boyut==='lg'?'1.1rem':'.9rem'};font-weight:900;color:#fff;
          border:3px solid ${border};
          box-shadow:0 4px 16px ${renk}44;
          ${isMe?'outline:3px solid #fbbf24;outline-offset:2px':''}">
          ${ad2.slice(0,2).toUpperCase()}
        </div>
        <div style="font-size:${boyut==='lg'?'.72rem':'.62rem'};font-weight:800;color:#f1f5f9;text-align:center;max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${ad2}${isMe?' 👈':''}
        </div>
        <div style="font-size:${boyut==='lg'?'.78rem':'.64rem'};font-weight:900;color:${renk}">${r.count} satış</div>
        ${fark !== null && fark > 0 ? `<div style="font-size:.52rem;color:#f87171;font-weight:700">+${fark} ileride</div>` : ''}
        ${bts!==null?`<div style="font-size:.56rem;color:#64748b">BTS %${bts}</div>`:''}
      </div>`;
    };
    return `<div style="
      background:linear-gradient(160deg,#0f172a 0%,#1e293b 80%,#0f2744 100%);
      border-radius:20px;padding:18px 10px 14px;margin-top:10px;
      border:1px solid #1e3a5f;
      box-shadow:0 8px 32px rgba(0,0,0,.25)">
      <div style="text-align:center;font-size:.60rem;font-weight:800;color:#64748b;letter-spacing:.1em;text-transform:uppercase;margin-bottom:14px">🏆 HAFTALIK PODYUM</div>
      <div style="display:flex;align-items:flex-end;justify-content:center;gap:8px">
        ${_kart(iki,'md','🥈','#64748b','#94a3b8')}
        ${_kart(bir,'lg','👑','#d97706','#fbbf24')}
        ${_kart(uc,'md','🥉','#92400e','#b45309')}
      </div>
    </div>`;
  })();

  // ── Benim sıram bandı ────────────────────────────────────────────
  const rankBand = meRank
    ? (() => {
        const medals = ['🥇','🥈','🥉'];
        const medal  = medals[meRank.rank - 1] || '#' + meRank.rank;
        const color  = meRank.rank === 1 ? '#b45309' : meRank.rank === 2 ? '#475569' : meRank.rank === 3 ? '#92400e' : 'var(--text-2)';
        const detay  = meRank.rank === 1
          ? '👑 Haftanın liderisin!'
          : lider
            ? `${meRank.rank}. sıradasın — ${lider.count - meRank.count} satış ile zirveye ulaş`
            : `${meRank.rank}. sıradasın`;
        return `<div class="ms-rank-band" style="border-left-color:${color}">
          <span class="ms-rank-pos" style="color:${color}">${medal}</span>
          <div class="ms-rank-info">
            <span class="ms-rank-label">${total} kişi arasında</span>
            <span class="ms-rank-detail">${detay}</span>
          </div>
          <div class="ms-rank-score">${meRank.count}<span>satış</span></div>
        </div>`;
      })()
    : `<div class="ms-rank-band ms-rank-zero">
        <span class="ms-rank-pos" style="color:var(--text-3)">—</span>
        <div class="ms-rank-info">
          <span class="ms-rank-label">${total} kişi arasında</span>
          <span class="ms-rank-detail">${lider ? `İlk satışını yap — lider ${lider.count} satışta!` : 'Bu hafta henüz satış yok — ilk satışını yap!'}</span>
        </div>
      </div>`;

  // ── Mikrorozetler ────────────────────────────────────────────────
  const rozetHtmlFull = (roz.kapanisUstasi || roz.teklifCanavarı || roz.sepetSihirbazi) ? `
    <div style="background:#0f172a;border-radius:16px;padding:12px 14px;margin-top:10px;border:1px solid #1e293b">
      <div style="font-size:.58rem;font-weight:800;color:#64748b;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">🏅 HAFTANIN ROZETLERİ</div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${roz.kapanisUstasi ? `
          <div style="display:flex;align-items:center;gap:8px;background:#1e293b;border-radius:10px;padding:7px 10px">
            <span style="font-size:1rem">🎯</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:.64rem;font-weight:800;color:#fbbf24">Kapanış Ustası</div>
              <div style="font-size:.58rem;color:#94a3b8">${roz.kapanisUstasi.email.split('@')[0]} · BTS %${roz.kapanisUstasi.teklif>0?Math.round(roz.kapanisUstasi.count/roz.kapanisUstasi.teklif*100):0}</div>
            </div>
            ${roz.kapanisUstasi.email===me?`<span style="font-size:.56rem;background:#fbbf2422;color:#fbbf24;border-radius:5px;padding:1px 6px;font-weight:700">SEN!</span>`:''}
          </div>` : ''}
        ${roz.teklifCanavarı ? `
          <div style="display:flex;align-items:center;gap:8px;background:#1e293b;border-radius:10px;padding:7px 10px">
            <span style="font-size:1rem">⚡</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:.64rem;font-weight:800;color:#a78bfa">Teklif Canavarı</div>
              <div style="font-size:.58rem;color:#94a3b8">${roz.teklifCanavarı.email.split('@')[0]} · ${roz.teklifCanavarı.teklif} teklif</div>
            </div>
            ${roz.teklifCanavarı.email===me?`<span style="font-size:.56rem;background:#a78bfa22;color:#a78bfa;border-radius:5px;padding:1px 6px;font-weight:700">SEN!</span>`:''}
          </div>` : ''}
        ${roz.sepetSihirbazi ? `
          <div style="display:flex;align-items:center;gap:8px;background:#1e293b;border-radius:10px;padding:7px 10px">
            <span style="font-size:1rem">🛒</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:.64rem;font-weight:800;color:#34d399">Sepet Sihirbazı</div>
              <div style="font-size:.58rem;color:#94a3b8">${roz.sepetSihirbazi.email.split('@')[0]} · ${roz.sepetSihirbazi.blur>0?Math.round(roz.sepetSihirbazi.teklif/roz.sepetSihirbazi.blur*100):0}% dönüşüm</div>
            </div>
            ${roz.sepetSihirbazi.email===me?`<span style="font-size:.56rem;background:#34d39922;color:#34d399;border-radius:5px;padding:1px 6px;font-weight:700">SEN!</span>`:''}
          </div>` : ''}
      </div>
    </div>` : '';

  // ── Mağaza Ligi ──────────────────────────────────────────────────
  const magazaLigiHtml = magazaLig.length > 1 ? `
    <div style="background:#0f172a;border-radius:16px;padding:12px 14px;margin-top:10px;border:1px solid #1e293b">
      <div style="font-size:.58rem;font-weight:800;color:#64748b;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">🏢 MAĞAZA LİGİ</div>
      ${magazaLig.map((m,i)=>{
        const medals = ['🥇','🥈','🥉'];
        const isMyMag = (beniMag === m.mag);
        const bar = Math.round((m.satis / (magazaLig[0]?.satis||1)) * 100);
        return `<div style="margin-bottom:6px;background:#1e293b;border-radius:10px;padding:8px 10px;${isMyMag?'border:1px solid #fbbf2444':''}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:.66rem;font-weight:800;color:#f1f5f9">${medals[i]||'·'} ${m.mag==='AVM'?'🏬 AVM':m.mag==='CARSI'?'🏪 Çarşı':m.mag} ${isMyMag?'<span style="font-size:.54rem;color:#fbbf24">(senin mağazan)</span>':''}</span>
            <span style="font-size:.70rem;font-weight:900;color:${i===0?'#fbbf24':'#94a3b8'}">${m.satis} satış</span>
          </div>
          <div style="background:#0f172a;border-radius:4px;height:5px;overflow:hidden">
            <div style="height:100%;width:${bar}%;background:${i===0?'linear-gradient(90deg,#f59e0b,#fbbf24)':'#334155'};border-radius:4px;transition:width .4s"></div>
          </div>
          <div style="font-size:.54rem;color:#475569;margin-top:3px">${m.kisi} personel · Ort. ${m.ortSatis} satış</div>
        </div>`;
      }).join('')}
    </div>` : '';

  // ── Tam sıralama (4. ve altı) ────────────────────────────────────
  const altListeHtml = (() => {
    const altlar = ranked.slice(3);
    if (!altlar.length) return '';
    return `<div style="margin-top:10px;background:#0f172a;border-radius:16px;overflow:hidden;border:1px solid #1e293b">
      <div style="padding:10px 14px 6px;font-size:.58rem;font-weight:800;color:#64748b;letter-spacing:.1em;text-transform:uppercase">TAM SIRALAMA</div>
      ${altlar.map(r => {
        const isMe = r.email === me;
        const bts = r.teklif > 0 ? Math.round(r.count/r.teklif*100) : null;
        const fark = liderSatis > r.count ? liderSatis - r.count : 0;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:1px solid #1e293b;${isMe?'background:#1e2a1a':''}">
          <span style="font-size:.60rem;color:#64748b;font-weight:700;width:18px;text-align:center">${r.rank}.</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:.68rem;font-weight:700;color:${isMe?'#fbbf24':'#f1f5f9'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${r.email.split('@')[0]}${isMe?' 👈':''}
            </div>
            <div style="font-size:.54rem;color:#475569">${bts!==null?`BTS %${bts} · `:''} ${r.teklif} teklif${fark>0?` · <span style="color:#f87171">zirveye ${fark}</span>`:''}</div>
          </div>
          <span style="font-size:.72rem;font-weight:800;color:${isMe?'#fbbf24':'#94a3b8'}">${r.count}</span>
        </div>`;
      }).join('')}
    </div>`;
  })();

  // ── Kapanış oranı hero hero kartındaki rozet mesajı ─────────────
  const rozetHtmlHero = meRank?.rank === 1
    ? `<div style="position:absolute;top:12px;right:12px;font-size:1.4rem" title="Haftanın lideri!">👑</div>`
    : meRank && lider
      ? `<div style="position:absolute;top:12px;right:12px;font-size:.62rem;color:#b45309;font-weight:700;text-align:right;line-height:1.3">
           ${lider.count - meRank.count} satış ile<br>zirveye ulaş!
         </div>`
      : lider
        ? `<div style="position:absolute;top:12px;right:12px;font-size:.62rem;color:#7c3aed;font-weight:700;text-align:right;line-height:1.3">
             ${lider.count} satış ile<br>lider ol!
           </div>`
        : '';

  // ── RENDER ───────────────────────────────────────────────────────
  container.innerHTML = `
    <!-- Profil -->
    <div class="ms-hero" style="position:relative">
      <div class="ms-hero-avatar">${ad.charAt(0).toUpperCase()}</div>
      <div class="ms-hero-info">
        <div class="ms-hero-name">${ad}</div>
        <div class="ms-hero-role">${_getRolLabel()}</div>
      </div>
      ${rozetHtmlHero}
    </div>

    <!-- Motivasyon -->
    <div class="ms-motivasyon" style="background:${motRenk}15;border-left:3px solid ${motRenk}">
      <span style="font-size:1.3rem">${motEmoji}</span>
      <span style="color:${motRenk};font-weight:700;font-size:.80rem">${motMesaj}</span>
    </div>

    <!-- Dün vs Bugün -->
    ${_dunBugunHtml}

    <!-- Haftalık kıyaslama çubuğu -->
    ${_karsilastirmaHtml}

    <!-- Sonraki rozet sayacı -->
    ${sonrakiRozetHtml}

    <!-- Hero Kart: Kapanış Oranı -->
    <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border-radius:14px;padding:16px 18px;margin-top:10px;position:relative;overflow:hidden">
      <div style="font-size:.60rem;font-weight:800;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Kapanış Oranı</div>
      <div style="font-size:.65rem;color:#64748b;margin-bottom:10px">Satış ÷ Teklif × 100</div>
      <div style="font-size:2.6rem;font-weight:900;color:${btsRenk};line-height:1;margin-bottom:12px">${v.bts !== null && v.teklif > 0 ? btsVal.toFixed(1) + '%' : v.teklif === 0 ? '—' : btsVal.toFixed(1) + '%'}</div>
      <div style="background:rgba(255,255,255,.10);border-radius:4px;height:7px;margin-bottom:6px;overflow:hidden">
        <div style="height:100%;width:${btsHedefPct}%;background:${btsRenk};border-radius:4px;transition:width .4s ease"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:.60rem;color:#94a3b8;margin-bottom:8px">
        <span style="color:${btsRenk};font-weight:700">${btsVal.toFixed(0)}%</span>
        <span>Hedef %${BTS_HEDEF}</span>
      </div>
      <div style="font-size:.72rem;color:${btsRenk};font-weight:600">${btsHint}</div>
    </div>

    <!-- Segmented Control -->
    <div class="ms-seg-control">
      <button class="ms-seg-btn ${p==='bugun'?'ms-seg-active':''}" onclick="switchMyStatsPeriod('bugun')">Bugün</button>
      <button class="ms-seg-btn ${p==='hafta' ?'ms-seg-active':''}" onclick="switchMyStatsPeriod('hafta')">Bu Hafta</button>
      <button class="ms-seg-btn ${p==='ay'    ?'ms-seg-active':''}" onclick="switchMyStatsPeriod('ay')">Bu Ay</button>
    </div>

    <!-- Dönem Özeti — 3 kart -->
    <div class="ms-stat-row">
      <div class="ms-stat-card">
        <div class="ms-stat-val">${v.teklif}</div>
        <div class="ms-stat-lbl">TEKLİF</div>
      </div>
      <div class="ms-stat-card ms-stat-green">
        <div class="ms-stat-val">${v.satis}</div>
        <div class="ms-stat-lbl">SATIŞ</div>
      </div>
      <div class="ms-stat-card ms-stat-blue">
        <div class="ms-stat-val">${v.ciro > 0 ? _fmtK(v.ciro) : '—'}</div>
        <div class="ms-stat-lbl">CİRO ${tlS}</div>
      </div>
    </div>

    <!-- Sepet Dönüşüm Oranı -->
    <div class="ms-metric-card ${btbAcil ? 'ms-metric-acil' : btbWarn ? 'ms-metric-warn' : 'ms-metric-ok'}" style="margin-top:10px">
      <div class="ms-metric-header">
        <span class="ms-metric-name">Sepet Dönüşüm Oranı</span>
        <span class="ms-metric-formula">Teklif ÷ Fiyat Sorgulama × 100</span>
        ${btbAcil ? `<span style="font-size:.58rem;background:#dc2626;color:#fff;border-radius:6px;padding:1px 7px;font-weight:800">🚨 ACİL</span>` : ''}
      </div>
      <div class="ms-metric-val" style="color:${btbAcil?'#dc2626':btbWarn?'#d97706':'inherit'}">${btbRaw !== null ? btbVal.toFixed(1) + '%' : '—'}</div>
      <div class="ms-metric-bar-bg">
        <div class="ms-metric-bar-fill ${btbAcil?'ms-bar-acil':btbWarn?'ms-bar-warn':''}" style="width:${Math.min(btbVal,100)}%"></div>
      </div>
      <div class="ms-metric-hint">${btbHint}</div>
      ${v.blur > 0
        ? `<div style="font-size:.60rem;color:var(--text-3);margin-top:5px">${periodLabel}: <strong>${v.blur}</strong> fiyat sorgusu · <strong>${v.teklif}</strong> teklif</div>`
        : `<div style="font-size:.60rem;color:var(--text-3);margin-top:5px">Bu dönemde fiyat sorgulaması kaydedilmedi</div>`}
      ${btbAcil ? `<div style="font-size:.62rem;background:#fee2e2;color:#dc2626;border-radius:8px;padding:6px 8px;margin-top:6px;font-weight:700">⚡ ${v.blur} fiyat sorgusu var — teklife dönüştürme fırsatın kaçıyor!</div>` : ''}
    </div>

    <!-- Sıralama bandı -->
    ${star ? rankBand : ''}

    <!-- Podyum -->
    ${star ? podyumHtml : ''}

    <!-- Rozetler -->
    ${star ? rozetHtmlFull : ''}

    <!-- Mağaza Ligi -->
    ${star ? magazaLigiHtml : ''}

    <!-- Tam sıralama -->
    ${star ? altListeHtml : ''}

    <div style="text-align:center;font-size:.58rem;color:var(--text-3);padding:16px 0 4px">
      daily_stats koleksiyonundan anlık hesaplanmaktadır
    </div>
  `;
}


// ── Blur istatistiklerini daily_stats'tan çek ──────────
async function _getMyBlurStats(email) {
  if (!_db || !email) return { bugun: 0, hafta: 0, ay: 0, toplam: 0 };
  try {
    const now    = new Date();
    const bugun  = now.toISOString().slice(0, 10);
    const haftaTs = new Date(now - 7  * 86400000);
    const ayTs    = new Date(now - 30 * 86400000);
    const haftaOnceTar = haftaTs.toISOString().slice(0, 10);
    const ayOnceTar    = ayTs.toISOString().slice(0, 10);

    const dailySnap = await getDocs(
      query(collection(_db, 'users', email, 'daily_stats'),
        where('tarih', '>=', ayOnceTar))
    );
    let b = 0, h = 0, a = 0;
    dailySnap.docs.forEach(d => {
      const sd = d.data(); const tarih = sd.tarih || d.id;
      const blurN = sd.blur_sayisi || 0; if (!blurN) return;
      a += blurN;
      if (tarih >= haftaOnceTar) h += blurN;
      if (tarih === bugun) b += blurN;
    });
    if (a === 0) {
      const sessSnap = await getDocs(query(collection(_db, 'sessions'),
        where('user', '==', email), where('zaman', '>=', ayTs)));
      sessSnap.docs.forEach(d => {
        const sd = d.data(); const blurN = (sd.bakilanFiyatlar || sd.revealedPrices || []).length;
        if (!blurN) return;
        let t; if (sd.zaman?.toDate) t = sd.zaman.toDate(); else if (typeof sd.zaman==='string') t=new Date(sd.zaman); else return;
        const tarih = t.toISOString().slice(0,10);
        a += blurN; if (t >= haftaTs) h += blurN; if (tarih === bugun) b += blurN;
      });
    }
    return { bugun: b, hafta: h, ay: a, toplam: a };
  } catch(e) { console.warn('_getMyBlurStats:', e); return { bugun:0, hafta:0, ay:0, toplam:0 }; }
}

// ── Rol etiketi ───────────────────────────────────────────────
function _getRolLabel() {
  if (!currentUser) return '';
  const r = (currentUser.Rol || '').toLowerCase();
  if (r === 'satis')  return '🏬 Satış Personeli · ' + getMagazaTipiLabel();
  if (r === 'destek') return '🎧 Destek Personeli';
  return '';
}

// ── Motivasyon mesajı hesapla ────────────────────────────────
function _getMotivation(bugSatis, bugTeklif, hftSatis, bts, bugBlur) {
  if (bugSatis >= 3)  return { emoji:'🔥', mesaj:'Bugün 3+ satış! Muhteşem!',                       renk:'#15803d' };
  if (bugSatis === 2) return { emoji:'💪', mesaj:'Bugün 2 satış — bir tane daha!',                  renk:'#1d4ed8' };
  if (bugSatis === 1) return { emoji:'✅', mesaj:'Bugün 1 satış yaptın. İyi gidiyorsun!',           renk:'#0369a1' };
  if (bugTeklif >= 2) return { emoji:'⚡', mesaj:`${bugTeklif} aktif teklifin var — birini kapat!`, renk:'#b45309' };
  if (bugBlur  >= 5)  return { emoji:'👁️', mesaj:`Bugün ${bugBlur} fiyat sorgulandı — teklif oluştur!`, renk:'#0891b2' };
  if (hftSatis > 0)   return { emoji:'📈', mesaj:`Bu hafta ${hftSatis} satış — devam et!`,          renk:'#0369a1' };
  if (bts !== null && bts < 10) return { emoji:'🎯', mesaj:'Teklifleri takip et, satışa çevir!',    renk:'#7c3aed' };
  return { emoji:'🚀', mesaj:'İlk fiyatı sorgula, teklif oluştur ve yarışa gir!',                  renk:'#7c3aed' };
}

// ── Ciro kısaltma (1.250.000 → 1,25M) ──────────────────────────────────
function _fmtK(v) {
  if (v >= 1_000_000) return (v/1_000_000).toFixed(2) + 'M';
  if (v >= 1_000)     return (v/1_000).toFixed(1) + 'K';
  return fmt(v);
}

// ── Mevcut satış/teklif hookları ile daily_stats entegrasyonu ──
// saveProposal ve satış tamamlama noktalarından otomatik çağrılır.
// Bu fonksiyonlar ilgili yerlere entegre edilecek:

// Sepete eklendiğinde (Basket.add) → blur_acilan zaten fiyat_bakislari'nda
// Teklif oluşturulduğunda → incrementDailyStat('teklif_sayisi')
// Satış tamamlandığında  → incrementDailyStat('satis_sayisi')

// window exports
window.saveVitrinUrun        = saveVitrinUrun;
window.deleteVitrinUrun      = deleteVitrinUrun;
window.toggleVitrinUrun      = toggleVitrinUrun;
window.renderAdminVitrinList = renderAdminVitrinList;
window.renderSiparisBildirimBar = renderSiparisBildirimBar;
