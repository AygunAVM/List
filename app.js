// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — app.js  (Rev 4.0 — Firebase Firestore)
//  Teklifler ve Satışlar artık Firebase'de — cihazlar arası senkron
// ═══════════════════════════════════════════════════════════════

// ─── FİREBASE BAŞLATMA ──────────────────────────────────────────
import { initializeApp }                           from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
import { getFirestore, collection, doc, deleteDoc,
         addDoc, setDoc, updateDoc, onSnapshot,
         query, orderBy, serverTimestamp, where, // <-- 'where' burada olmalı
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
  // Proposals
  if(window._propUnsub) window._propUnsub();
  window._propUnsub = onSnapshot(
    query(_colProp(), orderBy('ts', 'desc')),
    snap => {
      proposals = snap.docs.map(d => d.data());
      // localStorage'ı da güncelle (offline fallback)
      localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
      // Reaktif UI güncellemesi
      EventBus.emit(EV.PROPOSAL_CHANGED);
      // NOT: EV.CART_UPDATED burada emit edilmez — proposals değişince sepet analizi güncellenmez
      // Açık modalları yenile
      if(document.getElementById('proposals-modal')?.classList.contains('open')) renderProposals();
      // Admin paneli açıksa overview DIŞI sekmeleri güncelle
      // (overview için EventBus.on(PROPOSAL_CHANGED) handler'ı zaten tetikler — çift render önlenir)
      const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
      if (adminOpen) {
        const activeTab = document.querySelector('.admin-tab.active')?.dataset?.tab;
        if (activeTab === 'sepetler') renderSepetDetay();
        if (activeTab === 'personel') renderAdminUsers();
        if (activeTab === 'analiz')   loadFunnelAnaliz(90, false);
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
  // Sipariş notları listener — tüm kullanıcılar okuyabilir
  if(window._siparisUnsub) window._siparisUnsub();
  window._siparisUnsub = onSnapshot(
    query(_colSiparis(), orderBy('ts', 'desc')),
    snap => {
      window._siparisData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      updateSiparisBadge();
      const adminOpen = document.getElementById('admin-modal')?.classList.contains('open');
      if (adminOpen) {
        const activeTab = document.querySelector('.admin-tab.active')?.dataset?.tab;
        if (activeTab === 'siparis') renderSiparisPanel();
      }
      // Ana ekran sipariş bildirim barı güncelle (tüm kullanıcılar)
      try { renderSiparisBildirimBar(); } catch(e) {}
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

  // ── Motd (Kayan Yazı) Listener ──────────────────────────────
  onSnapshot(
    query(_colMotd(), orderBy('ts', 'desc')),
    snap => {
      _motdMessages = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(m => m.aktif !== false);
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
let _motdTicker   = null; // Placeholder ticker interval

// Admin Fiyat Override Haritası — sayfa yüklenince localStorage'dan restore et
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
  _shiftCampaignState(removedIdx) {
    // Silinen idx'den sonrakilerin state'ini bir öne kaydır
    const newBasket = [...basket];
    newBasket.forEach((item, i) => {
      if (i >= removedIdx) {
        const prev = basket[i + 1];
        if (prev) {
          item._campaigns    = prev._campaigns    || null;
          item._selectedCamps = prev._selectedCamps || {};
        }
      }
    });
  },

  // Sepeti temizle (bypass = log yazmadan)
  clear(bypass = false) {
    if (bypass) { _doClearBasket(); return; }
    // Akış clearBasket() fonksiyonuna devredilir
    window.clearBasket();
  },

  // Ürün toplamları
  totals() {
    return basket.reduce((t, i) => {
      t.dk    += i.dk    || 0;
      t.awm   += i.awm   || 0;
      t.tek   += i.tek   || 0;
      // ❖ Proje fiyatı varsa ham nakit yerine onu kullan
      t.nakit += (i._projeNakit !== undefined ? i._projeNakit : (i.nakit || 0));
      return t;
    }, { dk:0, awm:0, tek:0, nakit:0 });
  },

  // Satır indirimi toplamı
  totalItemDisc() {
    return basket.reduce((s, i) => s + (i.itemDisc || 0), 0);
  },

  // İndirim sonrası nakit
  nakitNet() {
    const t = this.totals();
    const itemDisc = this.totalItemDisc();
    const base = t.nakit - itemDisc;
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
  const passInput = document.getElementById('pass-input');
  if (passInput) passInput.addEventListener('keydown', e => {
    if (e.key==='Enter') checkAuth();
  });
  if (currentUser) {
    showApp();
    loadData();
  }
  
  // ✅ YENİ: Mobil uyanış kontrolü (visibilitychange) - Throttle ile
  // Her görünür olma durumunda 30 saniyede bir sepet güncelle
  document.addEventListener('visibilitychange', async () => {
    try {
      if (document.visibilityState === 'visible' && currentUser && _db) {
        const simdi = Date.now();
        // Son kontrolün üzerinden 30 saniye (30000ms) geçmediyse işlemi iptal et
        if (simdi - _sonGorunurlukKontrol < 30000) {
          console.log('⏸️ Visibility throttle: 30 saniye geçmedi, atlanıyor.');
          return;
        }
        
        _sonGorunurlukKontrol = simdi;
        console.log('🔄 Sayfa görünür oldu, sepet kontrol ediliyor...');
        
        // Hata durumunda uygulamanın çökmesini engelle
        await fetchLiveBasket();
        if (basket.length) updateCartUI();
      }
    } catch (err) {
      console.warn('Visibility kontrolü hatası:', err);
      // Hata durumunda kullanıcıyı uyarma - sessizce geç
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
  
  const exp = new Date();
  exp.setDate(exp.getDate() + 3);
  const expDay = String(exp.getDate()).padStart(2, '0');
  const expMonth = String(exp.getMonth() + 1).padStart(2, '0');
  const expYear = String(exp.getFullYear()).slice(-2);
  const expDate = expDay + '.' + expMonth + '.' + expYear;

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


// ─── Süresi Dolmuş + 1 Ay Geçmiş Teklifleri Temizle ────────────
async function _temizleEskiTeklifler() {
  if (!currentUser || !_db) return;
  const birAyOnce = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const silinecekler = proposals.filter(p => {
    if (!p.archivedAt) return false;
    return p.archivedAt < birAyOnce;
  });
  if (!silinecekler.length) return;
  await Promise.all(silinecekler.map(p => fbDeleteProp(p.id).catch(() => {})));
  proposals = proposals.filter(p => !silinecekler.find(s => s.id === p.id));
  localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
  console.log(`🧹 ${silinecekler.length} eski teklif temizlendi.`);
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

  // Çıkış: sadece admin DEĞİL kullanıcılar
  const lb = document.getElementById('logout-btn');
  if (lb) lb.style.display = isAdmin() ? 'none' : 'flex';
  updateProposalBadge();
  startFirebaseListeners();
  startDataPolling();
  _initStockFilterBtn();

  // Placeholder + kayan yazı — motd listener yüklendikten sonra _startMotdTicker çağrılır
  // Başlangıçta statik placeholder'ı hemen set et (listener yavaş gelebilir)
  const searchEl = document.getElementById('search');
  if (searchEl) {
    const ad = currentUser?.Ad || currentUser?.Email?.split('@')[0] || '';
    searchEl.placeholder = ad ? 'En iyisiniz, ' + ad + ' — Ürün arama' : 'Ürün arama';
  }
  // Motd ticker'ı başlat (mesaj yoksa statik kalır)
  _startMotdTicker();

  await fixMissingArchivedAt();
  setTimeout(_temizleEskiTeklifler, 3000); // 1 ay+ arşivler silinir
  setTimeout(checkExpiredProposals, 5000);
  if (window._expiredTimer) clearInterval(window._expiredTimer);
  window._expiredTimer = setInterval(checkExpiredProposals, 10 * 60 * 1000);
  await fetchLiveBasket(); // Buluttan sepet yükle (cihazlar arası + hayalet sepet kontrolü)
  
  // ✅ visibilitychange kodu ARTIK BURADA YOK (DOMContentLoaded içine taşındı)
}

// ─── KAYAN YAZI (MOTD) TICKER ───────────────────────────────────
// Admin panelinden girilen mesajlar search placeholder'ında kayan yazı olarak gösterilir.
// Mesaj yoksa veya kullanıcı arama kutusuna odaklanmışsa statik placeholder gösterilir.

function _startMotdTicker() {
  const searchEl = document.getElementById('search');
  if (!searchEl) return;

  const ad = currentUser?.Ad || currentUser?.Email?.split('@')[0] || '';
  const staticPlaceholder = ad ? 'En İyisiniz, ' + ad + ' — Ürün arama' : 'Ürün arama';

  // Önce statik placeholder'ı set et
  searchEl.placeholder = staticPlaceholder;

  // Eski ticker'ı temizle
  if (_motdTicker) { clearInterval(_motdTicker); _motdTicker = null; }

  // Eski focus/blur listener'ları temizle (yığılmayı önle)
  if (searchEl._motdFocus) searchEl.removeEventListener('focus', searchEl._motdFocus);
  if (searchEl._motdBlur)  searchEl.removeEventListener('blur',  searchEl._motdBlur);

  // Mesaj yoksa sadece statik placeholder
  if (!_motdMessages.length) return;

  // Kayan yazı listesi: önce statik, sonra mesajlar
  const items = [staticPlaceholder, ..._motdMessages.map(m => '📢 ' + m.metin)];
  let idx = 0;

  // Kullanıcı yazmaya başlayınca ticker durur, bırakınca devam eder
  let _tickerPaused = false;
  searchEl._motdFocus = () => { _tickerPaused = true; };
  searchEl._motdBlur  = () => {
    _tickerPaused = false;
    if (!searchEl.value) searchEl.placeholder = items[idx];
  };
  searchEl.addEventListener('focus', searchEl._motdFocus, { passive: true });
  searchEl.addEventListener('blur',  searchEl._motdBlur,  { passive: true });

  _motdTicker = setInterval(() => {
    if (_tickerPaused || searchEl.value) return; // kullanıcı yazıyorsa geçme
    idx = (idx + 1) % items.length;
    // Animasyon: placeholder kayarak değişir (CSS transition ile)
    searchEl.style.transition = 'opacity .3s';
    searchEl.style.opacity = '0.3';
    setTimeout(() => {
      searchEl.placeholder = items[idx];
      searchEl.style.opacity = '1';
    }, 300);
  }, 4000); // Her 4 saniyede bir değiş
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
  await showApp();   // showApp içinde loadData zaten DOMContentLoaded'dan çağrılır
  logAnalytics('login');
  // loadData() çift çağrısı kaldırıldı — DOMContentLoaded → showApp → loadData yeterli
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
  // Admin kendi panelini açarken live basket temizleme akışı çalışmasın
  if (isAdmin()) return;
  try {
    const snap = await getDoc(doc(_db, 'live_baskets', currentUser.Email));
    if (!snap.exists()) return;
    const data = snap.data();
    const remote = data.basket || data.items || [];

    // ── "Zaman Yolculuğu" kontrolü: 30 dk geçmiş mi? ──────────
    if (data.lastActive) {
      const lastActiveMillis = data.lastActive.toMillis ? data.lastActive.toMillis() : new Date(data.lastActive).getTime();
      const gecenDk = (Date.now() - lastActiveMillis) / 60000;
      if (gecenDk > 30 && remote.length > 0) {
        console.log(`⏰ Hayalet sepet tespit edildi (${gecenDk.toFixed(0)} dakika), temizleniyor...`);
        basket = remote;
        if (data.sessionData) {
          _sessionData = { 
            ...data.sessionData, 
            blurUrunler: data.sessionData.blurUrunler || {}
          };
        }
        updateCartUI();
        await logSessionResult('kacti', 'Hareketsizlik (Arka Plan)');
        
        // ✅ DÜZELTİLMİŞ: _doClearBasket yerine window.clearBasket çağrısı
        if (typeof window.clearBasket === 'function') {
          window.clearBasket();
        } else if (typeof _doClearBasket === 'function') {
          _doClearBasket();
        }
        return;
      }
    }

    // 30 dk geçmemişse sepeti geri yükle
    if (remote.length > 0 && basket.length === 0) {
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
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'hidden' && basket.length > 0) {
    // En güncel session datasını localStorage'a yaz
    localStorage.setItem('_sd', JSON.stringify({
      searches:       _sessionData.searches       || [],
      revealedPrices: _sessionData.revealedPrices || [],
      startTime:      _sessionData.startTime
    }));
    saveBasket(); // live_baskets'i de güncelle
  }
});

// Debounce timer — sadece bir kez tanımlanır
let _searchDebounce;

function filterData() {
  // Arama kaydı (session takibi için) — debounce öncesi hemen yap
  const val = document.getElementById('search').value.trim();
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

function renderTable(searchVal) {
  const kws = norm(searchVal||'').split(' ').filter(k=>k.length>0);

  // Tüm ürünleri filtrele
  let data = allProducts.filter(u => {
    if (!showZeroStock && (Number(u.Stok)||0)===0) return false;
    if (!kws.length) return true;
    return kws.every(kw => norm(Object.values(u).join(' ')).includes(kw));
  });

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
      (isSahaPersonel() || isDestek()
        ? ('<td class="td-price price-blur" data-urun="' + (u[urunKey]||'').replace(/"/g,'&quot;') + '" data-fiyat="' + (u[kartKey]||0) + '" onclick="_fyGos(this)">Göster</td>' +
           '<td class="td-price price-blur" data-urun="' + (u[urunKey]||'').replace(/"/g,'&quot;') + '" data-fiyat="' + (u['4T AWM']||0) + '" onclick="_fyGos(this)">Göster</td>' +
           '<td class="td-price price-blur" data-urun="' + (u[urunKey]||'').replace(/"/g,'&quot;') + '" data-fiyat="' + (u[cekKey]||0) + '" onclick="_fyGos(this)">Göster</td>' +
           '<td class="td-price price-blur" data-urun="' + (u[urunKey]||'').replace(/"/g,'&quot;') + '" data-fiyat="' + (u.Nakit||0) + '" onclick="_fyGos(this)">Göster</td>')
        : ('<td class="td-price">' + fmt(u[kartKey]) + '</td>' +
           '<td class="td-price">' + fmt(u['4T AWM']) + '</td>' +
           '<td class="td-price">' + fmt(u[cekKey]) + '</td>' +
           '<td class="td-price">' + fmt(u.Nakit) + '</td>')) +
      '<td style="font-size:.67rem;color:var(--text-3)">' + (u.Kod||'') + '</td>' +
      '<td class="td-gam">' + (u[gamKey]||'-') + '</td>' +
      '<td class="td-marka">' + (u.Marka||'-') + '</td>' +
      '<td class="td-etiket">' + (u['Etiket Fiyatı']?fmt(u['Etiket Fiyatı']):'-') + '</td>' +
      '<td><button class="siparis-btn haptic-btn" onclick="openSiparisNotSafe(' + oi + ')" title="Siparis Notu Ekle">📦</button></td>';
    frag.appendChild(tr);
  });
  list.appendChild(frag);

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
    if (rows[targetIdx]) rows[targetIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
  // Güvenli yol: manuel binlik ayırıcı + sabit ₺ sembolü
  const abs = Math.abs(Math.round(n));
  const str = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + str + '\u00a0₺';
}
function yuvarlaCeyrek(n) { return Math.ceil(n / 250) * 250; }

function yuvarlaKademe(brut, nTaksit) {
  let adim;
  if (brut < 1000) adim = 25;
  else if (brut < 2500) adim = 50;
  else if (brut < 5000) adim = 100;
  else if (brut < 15000) adim = 250;
  else adim = 500;
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
  // Hiyerarşi guard: fiyatı gösterilmeden eklenen ürünü blur'lanmış say
  {
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
  
  const newItem = {
    urun: p[urunKey] || '',
    stok: Number(p.Stok) || 0,
    dk: parseFloat(p[kartKey]) || 0,
    awm: parseFloat(p['4T AWM']) || 0,
    tek: parseFloat(p[cekKey]) || 0,
    nakit: parseFloat(p.Nakit) || 0,
    aciklama: p[descKey] || '-',
    kod: p.Kod || ''
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

  // Admin için neden sorulmaz, direkt sil
  if (isAdmin()) {
    Basket.removeAt(i); // ✅ Basket Manager
    return;
  }

  // Normal kullanıcı: neden sorma panelini aç
  _pendingDeleteIndex = i;
  _pendingDeleteIndices = [];   // temizlik

  // Neden sorma panelini aç
  showReasonModal('kacti', 'Ürün sepetten çıkarılacak, lütfen neden belirtin:');
}

window.deleteSelectedItems = function() {
  const checkboxes = document.querySelectorAll('.cart-item-checkbox:checked');
  if (checkboxes.length === 0) {
    ayAlert("Lütfen silmek için en az bir ürün seçin.");
    return;
  }

  const indices = Array.from(checkboxes).map(cb => parseInt(cb.value)).sort((a, b) => b - a);

  // Admin: neden sormadan direkt sil
  if (isAdmin && isAdmin()) {
    Basket.removeMany(indices);
    _pendingDeleteIndex   = null;
    _pendingDeleteIndices = [];
    return;
  }

  // Satış kullanıcısı: neden sor
  _pendingDeleteIndices = indices;
  _pendingDeleteIndex = null;
  showReasonModal('kacti', 'Seçilen ürünler silinecek, lütfen neden belirtin:');
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
    () => handleSonuc('satis', ''), { once: true });
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
    sonTarih = new Date(yil, ay, gun, 23, 59, 59);
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
    return { metin, tutar, tip: 'proje', grup: 'PROJE', esik: 1, rol: 'ANY', sonTarih };
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
  const yeniFormat = metin.match(/^([A-ZÇŞĞÜÖİa-zçşğüöı0-9_]+)\s+[-–]?\s*[\d.,]+[kK]?\s*\((\d+)\/([A-Z])\)/i);
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
    // Aynı üründe aynı GRUPTAN ikinci 🔒 seçilemez (farklı grup seçilebilir)
    if (camp.tip === 'kilitli' && itemHasKilitli) {
      const ayniGrupKilitliVar = Object.entries(item._selectedCamps).some(([ci, sel]) => {
        if (!sel) return false;
        const c = item._campaigns[parseInt(ci)];
        return c && c.tip === 'kilitli' && c.grup === camp.grup;
      });
      if (ayniGrupKilitliVar) return; // sessizce engelle
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
      // Anında uygula
      secimler.forEach(s => {
        if (s.camp.tutar > 0) {
          s.item._projeNakit = s.camp.tutar;
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
      if (esikSaglandi && s.camp.tutar > 0) {
        s.item._projeNakit = s.camp.tutar;
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
      // aynı üründe aynı gruptan 2. 🔒 engelle (farklı grup olabilir)
      (camp.tip === 'kilitli' && Object.entries(item._selectedCamps).some(([ci2,s2]) => s2 && item._campaigns[parseInt(ci2)]?.tip === 'kilitli' && item._campaigns[parseInt(ci2)]?.grup === camp.grup)) ||
      (itemHasProje    && camp.tip !== 'proje')    ||   // proje seçiliyken diğerleri devre dışı
      (!itemHasProje   && camp.tip === 'proje' && (itemHasKilitli || itemHasBirlesen)) ||
      (itemHasBagimsiz && camp.tip === 'bagimsiz') ||   // aynı üründe 2. ⌗ engelle
      ayniProjeGrupVar                                   // aynı proje grubundan 2. seçim engelle
      // NOT: ⌗ 🔒 ve ⎇ ile birlikte seçilebilir — onları disable etmez
    );

    // Tutar formatı
    const tutarVal = camp.tutar || 0;
    const tutarStr = tutarVal > 0 && !isBilgi
      ? (tutarVal >= 1000 ? (tutarVal/1000).toFixed(tutarVal%1000===0?0:1)+'k' : tutarVal) + '₺'
      : '';

    // Harf rozeti
    const harfStr = (camp.rol && camp.rol !== 'ANY' && !sel)
      ? ' · ' + camp.rol : '';

    // Label: her tip için camp.metin'den oluştur (tarih ve eşik parantezi temizlenmiş)
    const metinTemiz = camp.metin
      .replace(/\s*\[\d{2}\.\d{2}\.\d{2,4}\]\s*/g, '') // tarih parantezi
      .replace(/\s*\(\d+\/[A-Z]\)\s*/g, '')               // eşik/rol parantezi
      .trim();
    const label = metinTemiz.length > 26 ? metinTemiz.slice(0,24) + '…' : metinTemiz;

    // --- Premium stil ---
    let style;
    if (isBilgi) {
      style = `background:${pal.bg};color:${pal.unsel};border-bottom:1.5px solid ${pal.line};opacity:.75;cursor:default;`;
    } else if (disabled) {
      // Koyulaştırılmış / tıklanamaz
      style = `background:#1e293b;color:#94a3b8;border-bottom:1.5px solid #334155;opacity:.28;cursor:not-allowed;`;
    } else if (sel && pending) {
      // Seçili ama eşik bekliyor — turuncu, üstü çizili değil
      style = `background:#fef3c7;color:#92400e;border-bottom:2px solid #f59e0b;font-weight:700;cursor:pointer;`;
    } else if (sel) {
      // Seçili + aktif — yeşil, üstü çizili
      style = `background:#dcfce7;color:${pal.sel};border-bottom:2px solid #4ade80;font-weight:800;text-decoration:line-through;text-decoration-color:#4ade80;cursor:pointer;`;
    } else {
      // Normal seçilebilir — ama tarihi dolmuşsa soluk ve iptal çizgili
      const tarihDolmus = camp.sonTarih && new Date() > camp.sonTarih;
      style = tarihDolmus
        ? `background:#f1f5f9;color:#94a3b8;border-bottom:1.5px solid #e2e8f0;font-weight:600;cursor:not-allowed;text-decoration:line-through;opacity:.55;`
        : `background:${pal.bg};color:${pal.unsel};border-bottom:1.5px solid ${pal.line};font-weight:600;cursor:pointer;`;
    }

    const baseStyle = `display:inline-flex;align-items:center;gap:3px;padding:3px 9px 4px;`
      + `border-radius:4px 4px 0 0;font-size:.60rem;white-space:nowrap;`
      + `margin:0 3px 0 0;transition:opacity .15s,background .15s;border:none;font-family:inherit;`;

    // Ikon
    const isProje    = camp.tip === 'proje';
    const isBagimsiz = camp.tip === 'bagimsiz';
    const icon = isBilgi     ? '✦'
      : isProje               ? '❖'
      : isBagimsiz            ? '⌗'
      : sel && !pending       ? '✓'
      : sel && pending        ? '⏳'
      : locked                ? '🔒'
      : '⎇';

    const tarihDolmus2 = camp.sonTarih && new Date() > camp.sonTarih;
    const clickAttr = (!disabled && !isBilgi && !tarihDolmus2)
      ? ` onclick="toggleCampaign(${idx},${ci})"` : '';

    return `<button type="button"${clickAttr} title="${camp.metin.replace(/"/g,'&quot;')}" `
      + `style="${baseStyle}${style}">`
      + `<span style="font-size:.68rem;line-height:1">${icon}</span>`
      + `<span style="margin-left:1px">${label}</span>`
      + `</button>`;
  }).join('');

  // Özet satırı (seçim varsa)
  const campDisc = item._campDisc || 0;
  const projeAktifPill = item._projeNakit !== undefined;
  const secilenSayi = Object.values(item._selectedCamps).filter(Boolean).length;
  const summaryRow = secilenSayi > 0
    ? `<div style="display:flex;align-items:center;gap:5px;margin-top:3px">`
      + (projeAktifPill
        ? `<span style="font-size:.57rem;background:#f3e8ff;color:#7c3aed;border-radius:3px;padding:1px 7px;font-weight:700">❖ ${fmt(item._projeNakit)}₺</span>`
        : campDisc > 0
          ? `<span style="font-size:.57rem;background:#dcfce7;color:#15803d;border-radius:3px;padding:1px 7px;font-weight:700">✓ -${campDisc>=1000?(campDisc/1000).toFixed(campDisc%1000===0?0:1)+'k':campDisc}₺</span>`
          : `<span style="font-size:.57rem;background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 7px;font-weight:600">⏳ eşik bekleniyor</span>`)
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

  const bulkDeleteBtn = `
    <div style="display:flex; justify-content:flex-end; margin-bottom:10px;">
      <button onclick="deleteSelectedItems()" class="btn-delete-selected"
        style="background:#dc2626; color:white; border:none; border-radius:8px;
        padding:6px 12px; font-size:.7rem; cursor:pointer; display:flex; align-items:center; gap:6px;">
        🗑️ Seçili Olanları Sil
      </button>
    </div>
  `;

  // SepetTipi: "NakitFiyat" → satır indirimi + nakit toplam (admin stili)
  //            "CokluFiyat" → 4 fiyat tipi, satır indirimi yok
  area.innerHTML = bulkDeleteBtn + (isNakitSepet() ? _buildAdminCartHTML() : _buildUserCartHTML());
  try { if (typeof checkUpsellOpportunities === 'function') checkUpsellOpportunities(); } catch(e) {}
}

// ── Admin sepet HTML ─────────────────────────────────────────
function _buildAdminCartHTML() {
  const t = Basket.totals();
  const totalItemDisc = Basket.totalItemDisc();
  let rows = '';

  basket.forEach((item, idx) => {
    const itemDisc  = item.itemDisc || 0;
    const projeAktif = item._projeNakit !== undefined;
    const efektifNakit = projeAktif ? item._projeNakit : item.nakit;
    const nakitNet  = projeAktif ? item._projeNakit : Math.max(0, item.nakit - itemDisc);
    const hasDisc   = !projeAktif && itemDisc > 0;

    rows += `<tr class="${hasDisc ? 'row-has-disc' : ''}${projeAktif ? ' row-proje-aktif' : ''}">
      <td style="width:30px; text-align:center;">
        <input type="checkbox" class="cart-item-checkbox" value="${idx}" style="width:18px; height:18px; cursor:pointer;">
      <\/td>
      <td><span class="product-name" style="font-size:.74rem">${item.urun}</span><\/td>
      <td class="${item.stok === 0 ? 'cart-stok-0' : ''}" style="font-size:.71rem">${item.stok}<\/td>
      <td style="max-width:150px;vertical-align:middle">
        ${renderCampaignPills(item, idx)}
      <\/td>
      <td class="cart-price${hasDisc ? ' cart-price-old' : ''}" style="${projeAktif ? 'color:#7c3aed;font-weight:800' : ''}">${fmt(projeAktif ? item._projeNakit : item.nakit)}<\/td>
      <td style="padding:4px 6px">
        ${projeAktif
          ? '<span style="font-size:.60rem;color:#94a3b8;font-style:italic">❖ proje</span>'
          : `<div style="display:flex;align-items:center;gap:3px">
          <input type="number" class="item-disc-input" data-idx="${idx}" min="0" value="${Math.max(0,(itemDisc||0)-(item._campDisc||0)) || ''}" placeholder="ind."
            onblur="setItemDisc(${idx}, this.value)"
            onkeydown="if(event.key==='Enter'){setItemDisc(${idx}, this.value); this.blur()}"
            style="width:52px;padding:3px 4px;border:1px solid ${hasDisc ? '#93c5fd' : 'var(--border)'};border-radius:5px;font-size:.67rem;text-align:right;background:${hasDisc ? '#eff6ff' : 'var(--surface)'};">
          ${hasDisc ? '<button onclick="setItemDisc(' + idx + ', 0); clearAllCampaigns(' + idx + ');" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:1px;font-size:.75rem;line-height:1" title="İndirimi sıfırla">✕</button>' : ''}
        </div>`}
      <\/td>
      <td class="cart-price${hasDisc ? ' cart-price-net' : ''}">${(hasDisc || projeAktif) ? fmt(nakitNet) : ''}<\/td>
      <td><button class="remove-btn haptic-btn" onclick="removeFromBasket(${idx})">×</button><\/td>
    <\/tr>`;
  });

  const baseAfterItemDisc = t.nakit - totalItemDisc;
  const discVal = getDisc(baseAfterItemDisc);
  const nakitFinal = Math.max(0, baseAfterItemDisc - discVal);

  let dr_item = totalItemDisc > 0 ? `<tr class="discount-row" style="background:#f0fdf4">
    <td colspan="4" style="text-align:right;font-size:.68rem;color:#15803d">Satır İndirimleri Toplamı<\/td>
    <td class="cart-price" style="text-decoration:none;color:#6b7280;font-size:.75rem">${fmt(t.nakit)}<\/td>
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

  const tot = `<tr class="total-row">
    <td colspan="4" style="text-align:right;font-weight:800;font-size:.78rem">NET TOPLAM<\/td>
    <td class="cart-price" style="text-decoration:${(discountAmount > 0 || totalItemDisc > 0) ? 'line-through' : 'none'};opacity:${(discountAmount > 0 || totalItemDisc > 0) ? '.45' : '1'};font-size:.72rem">${fmt(t.nakit)}<\/td>
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
  // Pazarlık indirimini sıfırla (sepet gir/çık)
  const _ekReset = document.getElementById('ab-ek-indirim');
  if (_ekReset) _ekReset.value = '';
  const _notReset = document.getElementById('ab-pazarlik-notu');
  if (_notReset) _notReset.value = '';
  const m = document.getElementById('abakus-modal');
  m.style.display = 'flex';
  m.classList.add('open');
  buildAbakusKartlar();
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

function buildAbakusKartlar() {
  if (!allRates.length) return;
  const kartlar = [];
  allRates.forEach(r => {
    if (r.Kart && !kartlar.includes(r.Kart)) kartlar.push(r.Kart);
  });
  // Ek pazarlık indirimi — yuvarlama sonrası uygulanacak
  const ekIndirimEl = document.getElementById('ab-ek-indirim');
  const ekIndirim = ekIndirimEl ? (parseFloat(ekIndirimEl.value) || 0) : 0;
  // %7 güvenlik sınırı kontrolü
  const uyariEl = document.getElementById('ab-ek-indirim-uyari');
  if (uyariEl) uyariEl.style.display = (ekIndirim > 0 && ekIndirim > nakit * 0.07) ? 'inline' : 'none';

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

  // Pazarlık değerlerini innerHTML yazmadan ÖNCE kaydet
  const _ekInpEl  = document.getElementById('ab-ek-indirim');
  const _pazNotEl = document.getElementById('ab-pazarlik-notu');
  const _savedIndirim = _ekInpEl  ? (_ekInpEl.value  || '') : '';
  const _savedNot     = _pazNotEl ? (_pazNotEl.value || '') : '';
  const ekIndirim     = parseFloat(_savedIndirim) || 0;

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
      const tahsilatBrut = yuvarlaKademe(nakit / (1 - oran / 100), td.n);
      // Ek pazarlık indirimi EN SON uygulanır — yuvarlama döngüsünü tetiklemez
      const tahsilat = Math.max(0, tahsilatBrut - ekIndirim);
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
    + '<label style="font-size:.68rem;color:#92400e;font-weight:700;white-space:nowrap">İndirim Tutarı (₺)</label>'
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
  html += `<tr class="ab-row-nakit ab-row-sel" id="ab-row-nakit-tr" onclick="selectAbakusRow(this)">
      <td><strong>💵 Nakit</strong></td>
      <td class="ab-zincir-cell">—</td>
      <td class="ab-mono">${ekIndirim > 0 ? '<span style="font-size:.62em;color:#dc2626;text-decoration:line-through">' + fmt(nakit) + '</span>' : '—'}</td>
      <td class="ab-mono ab-tahsilat-cell">${fmt(nakitFinal)}${ekIndirim > 0 ? '<span style="font-size:.60em;color:#16a34a;display:block">-' + fmt(ekIndirim) + ' pazarlık</span>' : ''}</td>
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
      const tahsilatZBrut = yuvarlaKademe(nakit / (1 - oran / 100), td.n);
      const tahsilatZ = Math.max(0, tahsilatZBrut - ekIndirim);
      const aylik = td.n === 1 ? tahsilatZ : Math.ceil(tahsilatZ / td.n);
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
    // Nakit ekIndirim'i global'de sakla — DOM input kapatılsa bile korunur
    if (parsed.type === 'nakit') {
      window._nakitEkIndirim = parsed.ekIndirim || 0;
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
      if (infoDiv) {
        if (abakusSelection === null) {
          // Nakit seçildi
          const _nakitVal = parsed.nakit || 0;
          const _ekStr = parsed.ekIndirim > 0
            ? ' <span style="color:#16a34a;font-size:.8em">(-' + fmt(parsed.ekIndirim) + ')</span>'
            : '';
          infoDiv.innerHTML = '<span class="ab-sel-chip ab-sel-nakit">💵 Nakit — ' + fmt(_nakitVal) + _ekStr + '</span>';
        } else {
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
  } catch (e) {
    console.error('selectAbakusRow:', e);
  }
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

  const totalItemDisc = basket.reduce((s, i) => s + (i.itemDisc || 0), 0);
  const nakitFiyat    = t.nakit;                                                          // ham liste toplamı
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

  if (abakusSelection) {
    // ✅ DOĞRU: Kart farkı indirim SONRASI nakit üzerinden hesaplanır
    // abakusSelection.tahsilat zaten calcAbakus tarafından doğru hesaplandı
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

    const sureBitisInputWa = document.getElementById('teklif-sure-bitis');
    let expDateObj = sureBitisInputWa?.value
      ? new Date(sureBitisInputWa.value)
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
      toplamOdeme: odemeTipi === 'nakit' ? tahsilat : toplamKartOdeme,
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
    await logSessionResult('satis');
    logAnalytics('sale', custName);
    // Sözleşme → ilgili bekleyen teklifi otomatik "Satışa Döndü" yap
    _syncSatisTeklif(custName, phone);
    await clearBasket(true, 'satis', 'Satış Belgesi');
    closeWaModal();
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
  // archivedAt set edilmiş teklifler ANINDA arşive geçer — listede görünmez
  const isArchived = p => !!p.archivedAt;

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
          // Seçili kampanya isimlerini derle
          const camps = u._campaigns || [];
          const selCamps = u._selectedCamps || {};
          const campLabels = Object.entries(selCamps)
            .filter(([ci,sel]) => sel && camps[parseInt(ci)])
            .map(([ci]) => {
              const c = camps[parseInt(ci)];
              const icon = c.tip === 'kilitli' ? '\uD83D\uDD12' : '\u29B6';
              const tutar = c.tutar >= 1000 ? (c.tutar/1000).toFixed(c.tutar%1000===0?0:1)+'k' : c.tutar;
              return `<span style="font-size:.65rem;background:${c.tip==='kilitli'?'#f3e8ff':'#eff6ff'};color:${c.tip==='kilitli'?'#7c3aed':'#1d4ed8'};padding:1px 5px;border-radius:4px;margin-left:4px">${icon} ${c.grup} -${tutar}</span>`;
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

async function checkExpiredProposals() {
  if (!currentUser || !_db) return;
  const now = new Date();
  const expired = proposals.filter(p => p.durum === 'bekliyor' && p.sureBitis && new Date(p.sureBitis) < now);
  if (!expired.length) return;
  for (const p of expired) { await updatePropStatus(p.id, 'sureDoldu'); }
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

// ─── TOPLU İŞLEM YARDIMCILARI ───────────────────────────────────
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
  ids.forEach(id => updatePropStatus(id, newStatus));
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
    let toplamOdeme = toplamNakit - toplamIndirim - ekIndirim;
    if (ab) {
      toplamOdeme  = Number(ab.tahsilat) || toplamOdeme;
      kartAdi      = ab.kart || ab.label || '';
      taksitSayisi = ab.taksit || 1;
      aylikTaksit  = ab.aylik || (taksitSayisi > 1 ? Math.floor(toplamOdeme/taksitSayisi) : toplamOdeme);
      odemeTipi    = taksitSayisi <= 1 ? 'tek_cekim' : 'taksit';
    }
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

      // 3. Ödeme yöntemi eşleşmesi — kart adı VE taksit sayısı aynı olmalı
      const pAb     = p.abakus;
      const pKart   = pAb ? (pAb.kart||pAb.label||'').toLowerCase() : 'nakit';
      const pTaksit = pAb ? (pAb.taksit||1) : 0;
      const odemeEslesti = pKart === _abKart && pTaksit === _abTaksit;

      return odemeEslesti;
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
  const _pdfEkInd         = Number(data.ekIndirim || 0);
  const _pdfToplamIndirim = Number(data.toplamIndirim || 0);  // satır+alt (pazarlık hariç)
  let gosterilecekToplam  = Number(data.toplamOdeme || 0);
  let gosterilecekIndirim = isNakit ? _pdfToplamIndirim : 0;

  // Nakit ham tutar = net + indirimler + pazarlık
  const targetBrutTotal = isNakit
    ? (gosterilecekToplam + _pdfEkInd + gosterilecekIndirim)
    : gosterilecekToplam;
  
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
  
  // 4. ÖDEME TABLOSU — Tüm ödeme seçeneklerinde birleşik indirim
  // Toplam indirim = satır + alt + pazarlık (tek satır, birleşik)
  const _toplamTumIndirim = _pdfToplamIndirim + _pdfEkInd;
  const _hamListeFiyati   = targetBrutTotal;
  let odemeRows = '';

  // Ortak indirim satırı (her ödeme tipinde aynı)
  const _indirimSatiri = _toplamTumIndirim > 0
    ? '<tr><td class=\"ol\" style=\"color:#16a34a;\">Toplam İndirim<\/td><td class=\"or\" style=\"color:#16a34a;font-weight:700;\">-' + fmt(_toplamTumIndirim) + '<\/td><\/tr>'
    : '';
  const _pazarlikNotSatiri = data.pazarlikNotu && _pdfEkInd > 0
    ? '<tr><td class=\"ol\" style=\"color:#92400e;font-size:.85em;\">Pazarlık Notu<\/td><td class=\"or\" style=\"color:#92400e;font-size:.85em;\">' + data.pazarlikNotu + '<\/td><\/tr>'
    : '';

  if (isNakit) {
    odemeRows = '<tr><td class=\"ol\">Liste Fiyatı<\/td><td class=\"or\">' + fmt(_hamListeFiyati) + '<\/td><\/tr>'
      + _indirimSatiri + _pazarlikNotSatiri
      + '<tr><td class=\"ol\">Ödeme Şekli<\/td><td class=\"or\">Nakit<\/td><\/tr>'
      + '<tr class=\"grand-tr\"><td class=\"ol\">Toplam Ödenecek<\/td><td class=\"or total-cell\">' + fmt(gosterilecekToplam) + '<\/td><\/tr>';

  } else if (data.odemeTipi === 'tek_cekim') {
    odemeRows = '<tr><td class=\"ol\">Ödeme Şekli<\/td><td class=\"or\">' + (data.kartAdi || 'Kart') + ' — Tek Çekim<\/td><\/tr>'
      + _indirimSatiri + _pazarlikNotSatiri
      + '<tr class=\"grand-tr\"><td class=\"ol\">Toplam Ödenecek<\/td><td class=\"or total-cell\">' + fmt(gosterilecekToplam) + '<\/td><\/tr>';

  } else {
    const aylikTutar = data.aylikTaksit || Math.floor(gosterilecekToplam / (data.taksitSayisi || 1));
    odemeRows = '<tr><td class=\"ol\">Ödeme Şekli<\/td><td class=\"or\">' + (data.kartAdi || 'Kart') + '<\/td><\/tr>'
      + '<tr><td class=\"ol\">Taksit Sayısı<\/td><td class=\"or\">' + data.taksitSayisi + ' Taksit<\/td><\/tr>'
      + _indirimSatiri + _pazarlikNotSatiri
      + '<tr><td class=\"ol\">Aylık Taksit<\/td><td class=\"or\">' + fmt(aylikTutar) + '<\/td><\/tr>'
      + '<tr class=\"grand-tr\"><td class=\"ol\">Toplam Ödenecek<\/td><td class=\"or total-cell\">' + fmt(gosterilecekToplam) + '<\/td><\/tr>';
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
  if(ab) {
    toplamOdeme  = Number(ab.tahsilat) || nakitNet;   // abaküs tahsilatı tek kaynak
    kartAdi      = ab.kart || ab.label || '';
    taksitSayisi = ab.taksit || 1;
    const _taksTaban = taksitSayisi <= 1 ? toplamOdeme : Math.floor(toplamOdeme / taksitSayisi);
    const _taksKalan = taksitSayisi <= 1 ? 0 : (toplamOdeme - _taksTaban * taksitSayisi);
    aylikTaksit  = ab.aylik || (_taksTaban + _taksKalan);
    odemeTipi    = taksitSayisi <= 1 ? 'tek_cekim' : 'taksit';
  }

  const data = {
    belgeNo:          (p.id||'').slice(-8).toUpperCase(),
    tarih:            today,
    gecerlilikTarihi: sureTarih,
    musteriIsim:      p.custName || '—',
    telefon:          p.phone || '—',
    satici:           (p.user||'').split('@')[0],
    not:              p.not || '',
    odemeTipi,
    kartAdi,
    taksitSayisi,
    aylikTaksit,
    toplamOdeme,                                   // nakit: nakitNet, kart: ab.tahsilat
    toplamIndirim,                                 // satır + alt indirim (pazarlık ayrı)
    ekIndirim:    ekIndirimPdf,
    pazarlikNotu: p.pazarlikNotu || '',
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
    const snap  = await getDocs(query(collection(_db,'funnel_logs'), where('ts','>=',sinir), orderBy('ts','desc')));
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
        <div style="font-size:.56rem;color:var(--text-3);margin-bottom:5px">Mağazadaki hareketlilik — fiyat sorgulama ve sepet aktivitesi</div>
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
  if (typeof loadFunnelAnaliz === 'function') loadFunnelAnaliz(90, true);
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
  if (typeof loadFunnelAnaliz === 'function') loadFunnelAnaliz(90, true);
};

// ─── SATIŞ HUNİSİ ANALİZ ──────────────────────────────────────
async function loadFunnelAnaliz(gunAralik = 90, force = false) {
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
  console.log(`📊 Funnel analiz: Son ${gunAralik} günlük veri çekiliyor (${new Date().toISOString()})`);

  try {
    // ✅ GÜVENLİ TARİH FİLTRESİ: 'ts' (serverTimestamp) alanını kullan
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - gunAralik);
    
    const q = query(
      collection(_db, 'funnel_logs'),
      where('ts', '>=', limitDate),
      orderBy('ts', 'desc')
    );
    
    const snap = await getDocs(q);
    const allLogs = [];
    snap.forEach(d => allLogs.push(d.data()));

    if (!allLogs.length) {
      cont.innerHTML = `<div class="admin-empty">📭 Son ${gunAralik} günde veri yok.<br><span style="font-size:.72rem;color:var(--text-3)">Sepet kapatılınca burada görünecek.</span></div>`;
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

        return `<div style="background:var(--surface);border:1.5px solid var(--border);border-radius:16px;padding:14px;position:relative">
          <!-- Rozet — tooltip ile -->
          <div title="${rozetTooltip}"
            style="position:absolute;top:10px;right:10px;background:${r.c}18;border:1px solid ${r.c}44;border-radius:20px;padding:2px 9px;font-size:.62rem;font-weight:700;color:${r.c};cursor:help">${r.e} ${r.l}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-right:72px">
            <div class="user-avatar" style="width:34px;height:34px;font-size:.68rem">${s.ad.slice(0,2).toUpperCase()}</div>
            <div><b style="font-size:.88rem">${s.ad}</b>
              <div style="font-size:.62rem;color:var(--text-3)">${s.toplam} müşteri · ${rolEtiketi}</div>
            </div>
          </div>
          <!-- Satış/Bekleyen/Kaçan bar -->
          <div style="display:flex;height:16px;border-radius:6px;overflow:hidden;margin-bottom:10px;gap:1px">
            <div style="flex:${s.satis||0};background:#16a34a;display:flex;align-items:center;justify-content:center;font-size:.55rem;color:#fff;font-weight:800;min-width:0">${s.satis>0?sO+'%':''}</div>
            <div style="flex:${satis_kalan>0?satis_kalan:0};background:#f59e0b;min-width:0"></div>
            <div style="flex:${s.kacti||0};background:#dc2626;display:flex;align-items:center;justify-content:center;font-size:.55rem;color:#fff;font-weight:800;min-width:0">${s.kacti>0?kO+'%':''}</div>
          </div>
          <!-- 2 Ana Metrik -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:.62rem">
            <div style="background:#f0fdf4;border-radius:8px;padding:7px;text-align:center;border:1px solid #bbf7d0">
              <b style="font-size:.92rem;color:${satisCol}">${satisOranPct}%</b>
              <div style="color:#15803d;font-size:.58rem;margin-top:2px;font-weight:700">Satış Oranı</div>
              <div style="color:#94a3b8;font-size:.54rem">${s.satis} satış / ${s.toplam} müşteri</div>
            </div>
            <div style="background:${s.l3Giris===0?'#f8fafc':l3KapCol==='#16a34a'?'#f0fdf4':l3KapCol==='#f59e0b'?'#fffbeb':'#fef2f2'};border-radius:8px;padding:7px;text-align:center;border:1.5px solid ${l3KapCol}55">
              <b style="font-size:.92rem;color:${l3KapCol}">${l3KapanisOran}</b>
              <div style="color:${l3KapCol};font-size:.58rem;margin-top:2px;font-weight:700">${s.l3Giris===0 ? 'Abaküs Yok' : 'Kapanış Oranı'}</div>
              <div style="color:#94a3b8;font-size:.54rem">${s.l3Giris===0 ? 'Abaküs açılmadı' : s.l3Giris+' abaküs · '+s.l3Satis+' satış'}</div>
            </div>
          </div>
          <!-- Detay satırı — D/Ç + Kaçan vurgusu -->
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center">
            <!-- Altın/Gümüş + D/Ç tooltip -->
            <span title="Derinlik: müşteri başına ortalama ürün sayısı | Çeşitlilik: farklı ürün sayısı ortalaması"
              style="font-size:.58rem;color:var(--text-3);cursor:help">
              🥇${s.altin} 🥈${s.gumus}
              <span style="color:#94a3b8;margin-left:3px">D:${aD} Ç:${aC}</span>
            </span>
            <!-- Kaçan — vurgulu -->
            <span style="margin-left:auto;font-size:.60rem;font-weight:800;color:${kactiVurgu};background:${kactiVurgu}12;border:1px solid ${kactiVurgu}30;border-radius:8px;padding:2px 7px">
              ❌ ${s.kacti} kaçan (${kO}%)
            </span>
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
      gunAralik, totN, totS, totK, totHareketsiz, donusumGercek,
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
      _tavsiyeListesi: _tavsiyeListesiFinal, _tavsiyeKurallari
    };
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
  // s = _funnelStats objesi
  const { gunAralik, totN, totS, totK, totHareketsiz, donusumGercek,
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
<!-- Filtre -->
<div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap">
  ${['saha','destek','admin','hepsi'].map(f=>`
    <button class="funnel-filter-btn" data-filter="${f}"
      onclick="setFunnelFilter('${f}')"
      style="padding:5px 12px;border-radius:20px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:inherit;border:1.5px solid ${aktifFiltre===f?'var(--red)':'var(--border)'};background:${aktifFiltre===f?'var(--red)':'var(--surface)'};color:${aktifFiltre===f?'#fff':'var(--text-2)'}">
      ${f==='saha'?'👷 Saha':f==='destek'?'🖥 Destek':f==='admin'?'👑 Admin':'🌐 Tümü'}
    </button>`).join('')}
</div>
<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
  <span style="font-size:.65rem;color:var(--text-3);font-weight:600">🏬</span>
  ${[{k:'hepsi',l:'Tümü'},{k:'AVM',l:'🏬 AVM'},{k:'CARSI',l:'🏪 Çarşı'}].map(m=>`
    <button class="magaza-filter-btn" data-magaza="${m.k}"
      onclick="setMagazaFiltre('${m.k}')"
      style="padding:4px 11px;border-radius:20px;font-size:.68rem;font-weight:700;cursor:pointer;font-family:inherit;border:1.5px solid ${aktifMagaza===m.k?'#2563eb':'var(--border)'};background:${aktifMagaza===m.k?'#2563eb':'var(--surface)'};color:${aktifMagaza===m.k?'#fff':'var(--text-2)'}">
      ${m.l}
    </button>`).join('')}
</div>

      <!-- Bilgi: Hangi tarih aralığı gösteriliyor -->
      <div style="font-size:.6rem;color:var(--text-3);text-align:center;margin-bottom:10px">
        📅 Son ${gunAralik} gün · Toplam ${totN} oturum
      </div>

      <!-- Genel Özet -->
      <div style="background:linear-gradient(135deg,#1e293b,#0f172a);border-radius:16px;padding:14px;margin-bottom:12px;color:#fff">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center;margin-bottom:10px">
          <div><div style="font-size:1.4rem;font-weight:800">${totN}</div><div style="font-size:.62rem;opacity:.6">Müşteri</div></div>
          <div><div style="font-size:1.4rem;font-weight:800;color:#22c55e">${totS}</div><div style="font-size:.62rem;opacity:.6">Satış</div></div>
          <div>
            <div style="font-size:1.4rem;font-weight:800;color:#ef4444">${totK}</div>
            <div style="font-size:.62rem;opacity:.6">Gerçek Kaçan</div>
            ${totHareketsiz > 0 ? `<div style="font-size:.56rem;opacity:.4;margin-top:1px">+${totHareketsiz} hareketsizlik</div>` : ''}
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
      <div style="font-size:.68rem;font-weight:700;color:var(--text-3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">👤 Personel Analizi</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px;margin-bottom:14px">
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
  const archived = proposals
    .filter(p => !!p.archivedAt)
    .sort((a,b)=>new Date(b.archivedAt)-new Date(a.archivedAt));

  if(!archived.length) {
    el.innerHTML = '<div class="admin-empty">📦 Arşiv boş<br><span style="font-size:.72rem;color:var(--text-3)">İptal, satışa dönen ve süresi dolan teklifler burada listelenir</span></div>';
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
    const d = p.ts ? p.ts.split('T')[0] : '';
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
    `"${urunAdi}" için yeni nakit fiyat ve not girin:\nMevcut Nakit: ${eskiFiyat} ₺\n\nFormat: YENİFİYAT | NOT (örn: 12500 | Kampanya indirimi)`,
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
  const manuelNot = `⚠️ MANUEL MÜDAHALE: ${urunAdi} | ${eskiFiyat} ₺ → ${Number(yeniFiyat.replace(/\D/g,'')).toLocaleString('tr-TR')} ₺ (Not: ${not})`;
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

  (p.urunler || []).forEach(tu => {
    // allProducts'tan güncel kaydı bul
    const guncel = allProducts.find(ap => {
      const keys = Object.keys(ap);
      const urunKey = keys.find(k => k.toLowerCase().includes('urun')) || '';
      return ap[urunKey] === tu.urun;
    });

    let nakit = tu.nakit || 0;
    let dk    = tu.dk    || nakit;
    let awm   = tu.awm   || nakit;
    let tek   = tu.tek   || nakit;
    let aciklama = tu.aciklama || '-';
    let stok  = tu.stok  || 0;
    let kod   = tu.kod   || '';
    let degisti = false;

    if (guncel) {
      const keys   = Object.keys(guncel);
      const kartKey = keys.find(k => k.includes('Kart')) || '';
      const cekKey  = keys.find(k => k.includes('ekim')) || '';
      const descKey = keys.find(k => k.toLowerCase() === 'aciklama') || '';

      const yNakit = parseFloat(guncel.Nakit)         || nakit;
      const yDk    = parseFloat(guncel[kartKey])       || dk;
      const yAwm   = parseFloat(guncel['4T AWM'])      || awm;
      const yTek   = parseFloat(guncel[cekKey])        || tek;
      const yAc    = guncel[descKey]                   || aciklama;
      const yStok  = Number(guncel.Stok)               || stok;
      const yKod   = guncel.Kod                        || kod;

      // Fiyat değişikliği var mı? (%1 tolerans — yuvarlama farkları için)
      if (Math.abs(yNakit - nakit) / Math.max(nakit, 1) > 0.01) {
        degisimler.push({
          urun: tu.urun,
          eskiFiyat: nakit,
          yeniFiyat: yNakit,
          fark: yNakit - nakit
        });
        degisti = true;
      }

      nakit    = yNakit;
      dk       = yDk;
      awm      = yAwm;
      tek      = yTek;
      aciklama = yAc;
      stok     = yStok;
      kod      = yKod;
    }

    yeniUrunler.push({ urun: tu.urun, nakit, dk, awm, tek, aciklama, stok, kod,
      _teklifFiyati: tu.nakit,   // teklifin orijinal fiyatı (referans için)
      _fiyatDegisti: degisti,
      // Kampanya ve indirim state'leri sıfırla — sepette taze fiyatla revize edilecek
      itemDisc: 0, _campDisc: 0, _selectedCamps: {}, _campaigns: null, _pendingGroups: {}
    });
  });

  // Fiyat değişimi uyarısı
  if (degisimler.length > 0) {
    const satirlar = degisimler.map(d => {
      const sign = d.fark > 0 ? '+' : '';
      return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #fef3c7;font-size:.8rem">
        <span>📦 ${d.urun}</span>
        <span>${fmt(d.eskiFiyat)} → <b style="color:${d.fark>0?'#dc2626':'#16a34a'}">${fmt(d.yeniFiyat)}</b>
        <span style="color:${d.fark>0?'#dc2626':'#16a34a'}">(${sign}${fmt(d.fark)})</span></span>
      </div>`;
    }).join('');
    await ayAlert(
      `<div style="margin-bottom:8px;font-weight:700">⚠️ Fiyat Değişikliği Tespit Edildi</div>
       <div style="font-size:.76rem;color:var(--text-3);margin-bottom:10px">Aşağıdaki ürünlerin güncel fiyatları tekliften farklı. Sepete güncel fiyatla eklenecek.</div>
       ${satirlar}`,
      'Güncellendi'
    );
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

  (p.urunler || []).forEach(tu => {
    const guncel = allProducts.find(ap => {
      const keys = Object.keys(ap);
      const urunKey = keys.find(k => k.toLowerCase().includes('urun')) || '';
      return ap[urunKey] === tu.urun;
    });

    let nakit = tu.nakit || 0;
    let dk    = tu.dk    || nakit;
    let awm   = tu.awm   || nakit;
    let tek   = tu.tek   || nakit;
    let aciklama = tu.aciklama || '-';
    let stok  = tu.stok  || 0;
    let kod   = tu.kod   || '';
    let degisti = false;

    if (guncel) {
      const keys    = Object.keys(guncel);
      const kartKey = keys.find(k => k.includes('Kart')) || '';
      const cekKey  = keys.find(k => k.includes('ekim')) || '';
      const descKey = keys.find(k => k.toLowerCase() === 'aciklama') || '';

      const yNakit = parseFloat(guncel.Nakit)         || nakit;
      const yDk    = parseFloat(guncel[kartKey])       || dk;
      const yAwm   = parseFloat(guncel['4T AWM'])      || awm;
      const yTek   = parseFloat(guncel[cekKey])        || tek;
      const yAc    = guncel[descKey]                   || aciklama;
      const yStok  = Number(guncel.Stok)               || stok;
      const yKod   = guncel.Kod                        || kod;

      if (Math.abs(yNakit - nakit) / Math.max(nakit, 1) > 0.01) {
        degisimler.push({ urun: tu.urun, eskiFiyat: nakit, yeniFiyat: yNakit, fark: yNakit - nakit });
        degisti = true;
      }

      nakit    = yNakit;
      dk       = yDk;
      awm      = yAwm;
      tek      = yTek;
      aciklama = yAc;
      stok     = yStok;
      kod      = yKod;
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
    const satirlar = degisimler.map(d => {
      const sign = d.fark > 0 ? '+' : '';
      return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #fef3c7;font-size:.8rem">
        <span>📦 ${d.urun}</span>
        <span>${fmt(d.eskiFiyat)} → <b style="color:${d.fark>0?'#dc2626':'#16a34a'}">${fmt(d.yeniFiyat)}</b>
        <span style="color:${d.fark>0?'#dc2626':'#16a34a'}">(${sign}${fmt(d.fark)})</span></span>
      </div>`;
    }).join('');
    await ayAlert(
      `<div style="margin-bottom:8px;font-weight:700">⚠️ Fiyat Değişikliği Tespit Edildi</div>
       <div style="font-size:.76rem;color:var(--text-3);margin-bottom:10px">Güncel fiyatlar tekliften farklı. Sepete güncel fiyatla, teklifteki manuel indirimlerle eklenecek.</div>
       ${satirlar}`,
      'Güncellendi'
    );
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
Object.assign(window, {
  // Temel fonksiyonlar
  checkAuth, toggleCart, toggleZeroStock, filterData, iosLoadMore,
  openAbakus, closeAbakus, calcAbakus, selectAbakusRow,
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
  updatePropStatus, resendProposalWa, openPropNote, deleteProp,
  openEditProp, addEditUrunRow, saveEditProp, printTeklif, teklifSepeteEkle, teklifRevizeSepet,
  
  // Admin işlemleri
  resetProductStats, exportBasketToExcel, renderUyuyanStok,
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
  togglePropGroup, setItemDisc, toggleCartDiscPanel,
  
  // Toplu teklif işlemleri
  bulkUpdateStatus, bulkPrintProposals, mergeProposals, clearBulkSelection,
  adminForceLogout,

  // Çıkış
  logoutUser,

  // Kayan yazı (Motd)
  saveMotdMessage, deleteMotdMessage, toggleMotdMessage, renderMotdPanel,
  
  // Premium modal yardımcı
  closeReasonPanel,

  // Floating feedback bar
  _feedbackSelect, _feedbackDismiss, _nedenSec, _showNedenPanel,
  showReasonModal,      // Her silme işleminde açılan modal
  showEmptyCartModal,   // Sepet boşaldığında açılan modal
  
  // Mesajlaşma (aktif değilse boş fonksiyon)
  openMessages: () => {
    console.log('Mesajlaşma paneli henüz aktif değil');
    if (typeof ayAlert === 'function') ayAlert('Mesajlaşma özelliği yakında eklenecek.');
  }
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
  _campToast('✨ En iyi kombinasyon seçildi — '+fmtD+'₺ kampanya indirimi', 'ok');
  haptic(30);
}

// ═══════════════════════════════════════════════════════════════
// 💡 AKILLI ÇAPRAZ SATIŞ (UPSELL) MOTORU
// ═══════════════════════════════════════════════════════════════

function checkUpsellOpportunities() {
  const CONTAINER_ID = 'upsell-bar-container';
  let container = document.getElementById(CONTAINER_ID);
  if (!container) {
    const footer = document.querySelector('#cart-modal .cart-footer');
    if (!footer) return;
    container = document.createElement('div');
    container.id = CONTAINER_ID;
    footer.parentNode.insertBefore(container, footer);
  }
  if (!basket.length || !isNakitSepet()) { container.innerHTML=''; return; }

  const grupBilgi={};
  basket.forEach((item,bi)=>{
    (item._campaigns||[]).forEach(camp=>{
      if(camp.tip!=='birlesen'&&camp.tip!=='kilitli') return;
      if(camp.tutar<=0||camp.esik<2) return;
      if(camp.sonTarih&&new Date()>camp.sonTarih) return;
      const g=camp.grup;
      if(!grupBilgi[g]) grupBilgi[g]={esik:camp.esik,tutar:camp.tutar,sahip:new Set()};
      grupBilgi[g].sahip.add(bi);
      if(camp.tutar>grupBilgi[g].tutar) grupBilgi[g].tutar=camp.tutar;
    });
  });

  const grupSecili={};
  basket.forEach((item,bi)=>{
    Object.entries(item._selectedCamps||{}).forEach(([ci,sel])=>{
      if(!sel) return;
      const c=(item._campaigns||[])[parseInt(ci)];
      if(!c||(c.tip!=='birlesen'&&c.tip!=='kilitli')) return;
      if(!grupSecili[c.grup]) grupSecili[c.grup]=new Set();
      grupSecili[c.grup].add(bi);
    });
  });

  const firsatlar=[];
  Object.entries(grupBilgi).forEach(([grup,info])=>{
    const seciliSayi=(grupSecili[grup]||new Set()).size;
    const sahipSayi=info.sahip.size;
    const acikPos=seciliSayi%info.esik;
    const eksik=acikPos===0?info.esik:(info.esik-acikPos);
    if(eksik===1&&seciliSayi>0) firsatlar.push({grup,kazanc:info.tutar,eksik:1,tip:'eksik1'});
    else if(seciliSayi===0&&sahipSayi>=info.esik) firsatlar.push({grup,kazanc:info.tutar,eksik:0,tip:'hazir'});
    else if(sahipSayi>0&&sahipSayi<info.esik&&(info.esik-sahipSayi)<=2) firsatlar.push({grup,kazanc:info.tutar,eksik:info.esik-sahipSayi,tip:'ekle'});
  });

  if(!firsatlar.length){container.innerHTML='';return;}
  firsatlar.sort((a,b)=>b.kazanc-a.kazanc);
  const f=firsatlar[0];
  const kFmt=f.kazanc>=1000?(f.kazanc/1000).toFixed(f.kazanc%1000===0?0:1)+'k₺':f.kazanc+'₺';

  let mesaj,buton='';
  if(f.tip==='hazir'){
    mesaj=`<b>${f.grup}</b> kampanyası uygulanabilir`;
    buton=`<button onclick="optimizeCampaigns()" style="background:#f59e0b;color:#0f172a;border:none;border-radius:6px;padding:4px 10px;font-weight:800;font-size:.64rem;cursor:pointer;white-space:nowrap;font-family:inherit;flex-shrink:0">✨ +${kFmt}</button>`;
  } else if(f.tip==='eksik1') mesaj=`<b>${f.grup}</b> kampanyasına <b>1 ürün</b> ekle → <b>+${kFmt}</b>`;
  else mesaj=`<b>${f.grup}</b> için <b>${f.eksik} ürün</b> daha → <b>+${kFmt}</b>`;

  container.innerHTML=`<div style="display:flex;align-items:center;gap:8px;background:#0f172a;color:#f8fafc;padding:7px 12px;font-size:.67rem;border-top:2px solid #f59e0b;flex-wrap:wrap;">
    <span style="flex-shrink:0">💡</span><span style="flex:1;min-width:0;line-height:1.4">${mesaj}</span>
    ${buton}
    <button onclick="document.getElementById('${CONTAINER_ID}').innerHTML=''" style="background:none;border:none;color:#64748b;font-size:.85rem;cursor:pointer;padding:0 2px;flex-shrink:0">✕</button>
  </div>`;
}

window.optimizeCampaigns       = optimizeCampaigns;
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

  // Vitrin Şampiyonları kartları — isim + fiyat + prim
  const vitrinHtml = vitrinAktif.map(v => {
    const oi    = _vitrinOi(v);
    const prim  = oi >= 0 ? _primDeger(allProducts[oi]) : 0;
    const primT = _primStr(prim);
    // fmt() ₺ ekliyor — extra ₺ EKLEME
    return `<div class="trend-card vitrin-card"
      onclick="switchMainTab('urunler');setTimeout(()=>{const s=document.getElementById('search');if(s){s.value=${JSON.stringify(v.urunAdi.split(' ').slice(0,3).join(' '))};filterData();}},100)">
      <div class="trend-rank" style="color:#e11d48;font-size:.58rem;font-weight:900">🛍️</div>
      <div class="trend-card-name">${v.urunAdi}</div>
      <div class="trend-card-meta">
        <span class="trend-card-price">${fmt(v.fiyat)}</span>
        ${v.kampanya ? `<span class="trend-card-score" style="background:#fef3c7;color:#92400e">${v.kampanya}</span>` : ''}
      </div>
      ${primT ? `<div style="font-size:.58rem;color:#b45309;font-weight:700;margin:1px 0 2px">${primT}</div>` : ''}
      ${v.aciklama ? `<div style="font-size:.60rem;color:var(--text-3);line-height:1.3;margin:1px 0 2px">${v.aciklama}</div>` : ''}
      <button class="trend-card-add haptic-btn"
        onclick="event.stopPropagation();${oi >= 0 ? 'vitrinSepeteEkle(' + oi + ')' : ''}"
        title="Sepete ekle — sepet açılır">+ Sepete</button>
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
      ${primT ? `<div style="font-size:.58rem;color:#b45309;font-weight:700;margin:1px 0 2px">${primT}</div>` : ''}
      <button class="trend-card-add haptic-btn"
        onclick="event.stopPropagation();${oi >= 0 ? 'vitrinSepeteEkle(' + oi + ')' : ''}"
        title="Sepete ekle">+ Sepete</button>
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
      const prim  = oi >= 0 ? _primDeger(allProducts[oi]) : 0;
      const primT = _primStr(prim);
      return `<div class="trend-full-card" style="border-left:3px solid #e11d48">
        <div class="trend-full-rank" style="color:#e11d48">🛍️</div>
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
          ${fmt(v.fiyat)}₺${v.kampanya ? ' · ' + v.kampanya : ''}
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
    const bugunTeklif = benimler.filter(p => (p.ts || '').slice(0, 10) === bugun).length;
    const bugunSatis  = benimler.filter(p => p.durum === 'satisDondu' && (p.ts || '').slice(0, 10) === bugun).length;
    const haftaTeklif = benimler.filter(p => (p.ts || '').slice(0, 10) >= haftaOnce).length;
    const haftaSatis  = benimler.filter(p => p.durum === 'satisDondu' && (p.ts || '').slice(0, 10) >= haftaOnce).length;
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

// window exports
window.saveVitrinUrun        = saveVitrinUrun;
window.deleteVitrinUrun      = deleteVitrinUrun;
window.toggleVitrinUrun      = toggleVitrinUrun;
window.renderAdminVitrinList = renderAdminVitrinList;
window.renderSiparisBildirimBar = renderSiparisBildirimBar;
