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
const _colMotd      = () => collection(_db, 'motd'); // Kayan yazı mesajları

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
  if (activeTab === 'analiz')    { loadFunnelAnaliz(90, false); }  // ✅ 5-sekme
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

  // ── Motd (Kayan Yazı) Listener ──────────────────────────────
  onSnapshot(
    query(_colMotd(), orderBy('ts', 'desc')),
    snap => {
      _motdMessages = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(m => m.aktif !== false); // aktif:false olanları gösterme
      _startMotdTicker();
    },
    err => console.warn('motd listener:', err)
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
let _motdMessages = []; // Admin tarafından girilen kayan yazılar
let _motdTicker   = null; // Placeholder ticker interval

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
  add(item, productIdx) {
    basket.push(item);
    if (basket.length === 1) {
      logSepet('session_basla', 0, null);
      resetSessionTimer();
    }
    logSepet('ekle', item.nakit || 0, item.urun || '');
    if (_intentLevel >= 1 && _intentLevel < 2) _intentLevel = 2;
    this._sync();
  },

  // Tek ürün çıkar (index)
  removeAt(idx) {
    const removed = basket[idx];
    if (!removed) return null;
    logSepet('cikar', removed.nakit || 0, removed.urun || null);
    basket.splice(idx, 1);
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

  // Satır indirimi güncelle
  setItemDisc(idx, val) {
    if (!basket[idx]) return;
    basket[idx].itemDisc = Math.max(0, parseFloat(val) || 0);
    this._sync();
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
      t.nakit += i.nakit || 0;
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
    searchEl.placeholder = ad ? 'Şampiyonsun, ' + ad + ' — Ürün arama' : 'Ürün arama';
  }
  // Motd ticker'ı başlat (mesaj yoksa statik kalır)
  _startMotdTicker();

  await fixMissingArchivedAt();
  setTimeout(_temizleEskiTeklifler, 3000); // 1 ay+ arşivler silinir
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
  const staticPlaceholder = ad ? 'Şampiyonsun, ' + ad + ' — Ürün arama' : 'Ürün arama';

  // Önce statik placeholder'ı set et
  searchEl.placeholder = staticPlaceholder;

  // Eski ticker'ı temizle
  if (_motdTicker) { clearInterval(_motdTicker); _motdTicker = null; }

  // Mesaj yoksa sadece statik placeholder
  if (!_motdMessages.length) return;

  // Kayan yazı listesi: önce statik, sonra mesajlar
  const items = [staticPlaceholder, ..._motdMessages.map(m => '📢 ' + m.metin)];
  let idx = 0;

  // Kullanıcı yazmaya başlayınca ticker durur, bırakınca devam eder
  let _tickerPaused = false;
  searchEl.addEventListener('focus', () => { _tickerPaused = true; }, { passive: true });
  searchEl.addEventListener('blur',  () => {
    _tickerPaused = false;
    if (!searchEl.value) searchEl.placeholder = items[idx];
  }, { passive: true });

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
  el.textContent = fiyat ? Number(fiyat).toLocaleString('tr-TR') + ' ₺' : '—';
  el.classList.remove('price-blur');
  el.style.cursor = 'default';
  el.removeAttribute('onclick');

  // Tekil sayım — aynı ürünün 4 fiyatından biri açıldıysa yeterli
  const urunKey = urunAdi || '_';
  if (_sessionData.blurUrunler && !_sessionData.blurUrunler[urunKey]) {
    _sessionData.blurUrunler[urunKey] = true;
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
  return isNaN(n) ? (val || '-') : n.toLocaleString('tr-TR') + '\u00a0₺';
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
    // Eğer blur oturumu açıksa kapat (artık gerçek oturum başladı)
    _blurSessionActive = false;
    _blurSessionUrunler = {};
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

  // Seçili indexleri geçici listeye al (büyükten küçüğe sırala)
  _pendingDeleteIndices = Array.from(checkboxes).map(cb => parseInt(cb.value)).sort((a, b) => b - a);
  _pendingDeleteIndex = null;   // tekli silme değil
  
  // Neden sorma panelini aç
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

function setItemDisc(idx, val) {
  Basket.setItemDisc(idx, val); // ✅ Basket Manager
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
    basket.forEach(i => { i.itemDisc = 0; });
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

  area.innerHTML = bulkDeleteBtn + (isAdmin() ? _buildAdminCartHTML() : _buildUserCartHTML());
}

// ── Admin sepet HTML ─────────────────────────────────────────
function _buildAdminCartHTML() {
  const t = Basket.totals();
  const totalItemDisc = Basket.totalItemDisc();
  let rows = '';

  basket.forEach((item, idx) => {
    const itemDisc  = item.itemDisc || 0;
    const nakitNet  = Math.max(0, item.nakit - itemDisc);
    const hasDisc   = itemDisc > 0;

    rows += `<tr class="${hasDisc ? 'row-has-disc' : ''}">
      <td style="width:30px; text-align:center;">
        <input type="checkbox" class="cart-item-checkbox" value="${idx}" style="width:18px; height:18px; cursor:pointer;">
      <\/td>
      <td><span class="product-name" style="font-size:.74rem">${item.urun}</span><\/td>
      <td class="${item.stok === 0 ? 'cart-stok-0' : ''}" style="font-size:.71rem">${item.stok}<\/td>
      <td style="font-size:.63rem;color:var(--text-3);max-width:80px;word-break:break-word">${item.aciklama || '—'}<\/td>
      <td class="cart-price${hasDisc ? ' cart-price-old' : ''}">${fmt(item.nakit)}<\/td>
      <td style="padding:4px 6px">
        <div style="display:flex;align-items:center;gap:3px">
          <input type="number" class="item-disc-input" min="0" value="${itemDisc || ''}" placeholder="ind."
            onblur="setItemDisc(${idx}, this.value)"
            onkeydown="if(event.key==='Enter'){setItemDisc(${idx}, this.value); this.blur()}"
            style="width:52px;padding:3px 4px;border:1px solid ${hasDisc ? '#93c5fd' : 'var(--border)'};border-radius:5px;font-size:.67rem;text-align:right;background:${hasDisc ? '#eff6ff' : 'var(--surface)'};">
          ${hasDisc ? `<button onclick="setItemDisc(${idx}, 0); this.closest('tr').querySelector('.item-disc-input').value=''" style="background:none;border:none;color:#94a3b8;cursor:pointer;padding:1px;font-size:.75rem;line-height:1" title="İndirimi sıfırla">✕</button>` : ''}
        </div>
      <\/td>
      <td class="cart-price${hasDisc ? ' cart-price-net' : ''}">${hasDisc ? fmt(nakitNet) : ''}<\/td>
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
      <th style="width:30px"></th><th>Ürün</th><th>Stok</th><th>Açıklama</th><th>Liste</th><th style="min-width:70px">Satır İnd.</th><th>Net</th><th></th>
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

  const totalItemDisc = basket.reduce((s, i) => s + (i.itemDisc || 0), 0);
  const nakitFiyat = t.nakit;
  const altIndirim = discountType === 'TRY' ? discountAmount : (nakitFiyat - totalItemDisc) * discountAmount / 100;
  const toplamIndirim = totalItemDisc + altIndirim;
  const indirimliNakit = nakitFiyat - toplamIndirim;

  let od = '', odText = '', tahsilat = indirimliNakit;

  if (abakusSelection) {
    const kartNakit = nakitFiyat;
    const abOran = abakusSelection.oran / 100;
    const brut = kartNakit / (1 - abOran);
    const yuvarlanmis = yuvarlaKademe(brut, abakusSelection.taksit);
    tahsilat = yuvarlanmis;
    const taksitSayisi = abakusSelection.taksit;
    const aylikTutar = taksitSayisi === 1 ? tahsilat : Math.ceil(tahsilat / taksitSayisi);
    od = abakusSelection.label + ' (' + abakusSelection.zincir + ' POS): ' + fmt(tahsilat) + '\nAylık taksit: ' + fmt(aylikTutar);
    odText = abakusSelection.label + ' / ' + abakusSelection.zincir + ' POS — ' + fmt(tahsilat);
  } else {
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

    let waMsg = `Aygün AVM Teklif\n\n`;
    waMsg += `*Sn* ${custName}\n`;
    waMsg += `*Telefon* ${phone}\n\n`;
    waMsg += `\`Ürünler\`\n`;
    basket.forEach(i => { waMsg += `  - ${i.urun}\n`; });

    let indirimMetni = '';
    if (toplamIndirim > 0) {
      indirimMetni = `\n_İndirimler -${fmt(toplamIndirim)}_\n\n`;
    } else {
      indirimMetni = `\n\n`;
    }
    waMsg += indirimMetni;

    if (abakusSelection === null) {
      waMsg += `* Nakit\n`;
      waMsg += `*Toplam* ${fmt(indirimliNakit)}\n\n`;
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
    _kaydetTeklif(custName, phone, odText, tahsilat, extraNote, sureBitisWa, gizlilikElWa?.value || 'acik');
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

    _kaydetTeklif(custName, phone, odText, tahsilat, extraNote, sureBitis, gizlilik);
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
    await logSessionResult('satis');   // ✅ DOĞRU YER
    logAnalytics('sale', custName);
    await clearBasket(true, 'satis', 'Satış Belgesi');
    closeWaModal();
    _clearAksiyonForm();
    return;
  }
}

function _kaydetTeklif(custName, phone, odText, tahsilat, extraNote, sureBitis, gizlilik) {
  if (_intentLevel < 4) _intentLevel = 4; // Intent L4: Teklif oluşturuldu
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
      // Sepete Ekle — herkes yapabilir (teklif sahibi veya admin)
      if(isAdmin() || p.user === (currentUser?.Email||'')) btns.push(`<button class="pact-btn haptic-btn" onclick="teklifSepeteEkle('${p.id}')" title="Sepete Ekle" style="color:#16a34a;border-color:#bbf7d0;background:#f0fdf4">🛒</button>`);
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


// ─── SEPET LOGLAMA (Firebase sepet_loglari) ─────────────────────
// Firebase ücretsiz plan uyumlu: günde ~500 yazma, koleksiyon hafif tutulur
async function logSepet(islem, tutar, urunAdi) {
  if (!currentUser || !_db) return;
  try {
    await addDoc(collection(_db, 'sepet_loglari'), {
      personelId:  currentUser.Email,
      personelAd:  currentUser.Ad || currentUser.Email.split('@')[0],
      ts:          serverTimestamp(),
      islem,        // 'ekle' | 'cikar' | 'terk' | 'session_basla'
      tutar:        tutar || 0,
      urun:         urunAdi || null,
      sepetAdet:    basket.length,
      tarih:        new Date().toISOString().split('T')[0]
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
  if (basket.length === 0) return;

  // localStorage'dan güncel session datasını al (kaçış korumasında yazdık)
  try { const sd = JSON.parse(localStorage.getItem('_sd')||'{}');
    if (sd.searches)       _sessionData.searches       = sd.searches;
    if (sd.revealedPrices) _sessionData.revealedPrices = sd.revealedPrices;
  } catch(e) {}

  const toplamTutar = basket.reduce((s,i)=>s+(i.nakit-(i.itemDisc||0)),0);
  const sure        = _sessionData.startTime ? Math.round((Date.now()-_sessionData.startTime)/1000) : 0;

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
    await addDoc(collection(_db, 'funnel_logs'), {
      personelId:      currentUser.Email,
      personelAd:      currentUser.Ad || currentUser.Email.split('@')[0],
      funnelRol:       funnelRol,   // ✅ DÜZELTİLMİŞ: 'saha' | 'destek' | 'admin'
      ts:              serverTimestamp(),
      tarih:           new Date().toISOString().split('T')[0],
      gun:             new Date().getDay(),
      saat:            new Date().getHours(),
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
        <div style="font-size:.62rem;font-weight:700;color:var(--text-3);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">⏰ Saatlik Yoğunluk</div>
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
  console.log("🎯 Filtre değiştirildi:", filter);
  
  const cont = document.getElementById('funnel-analiz-konteynir');
  if (cont) {
    cont.dataset.funnelFiltre = filter;
  }
  
  // Buton stillerini güncelle (hemen görünür olsun)
  document.querySelectorAll('.funnel-filter-btn').forEach(btn => {
    const isActive = btn.dataset.filter === filter;
    btn.style.borderColor = isActive ? 'var(--red)' : 'var(--border)';
    btn.style.background = isActive ? 'var(--red)' : 'var(--surface)';
    btn.style.color = isActive ? '#fff' : 'var(--text-2)';
  });
  
  // Veriyi yeniden yükle (force=true ile cooldown'u aş)
  if (typeof loadFunnelAnaliz === 'function') {
    loadFunnelAnaliz(90, true);
  }
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
    const logs = aktifFiltre === 'hepsi'
      ? allLogs
      : allLogs.filter(l => {
          const rol = l.funnelRol || 'saha';
          if (aktifFiltre === 'saha')   return rol === 'saha';
          if (aktifFiltre === 'destek') return rol === 'destek';
          if (aktifFiltre === 'admin')  return rol === 'admin';
          return false;
        });
    
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
    const totK = logs.filter(l=>l.sonuc==='kacti').length;

    // Gerçek dönüşüm oranı
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
    const top3Pahali = Object.entries(fiyatiPahali)
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
    const urunIsiMap = {}; // { urunAdi: { blur:n, satis:n, l3:n, l3Kacti:n } }

    logs.forEach(log => {
      // Blur kaynağı: blurUrunListesi (yeni) veya bakilanFiyatlar (eski)
      const blurListesi = log.blurUrunListesi || log.bakilanFiyatlar || [];
      blurListesi.forEach(u => {
        if (!u) return;
        if (!urunIsiMap[u]) urunIsiMap[u] = { blur:0, satis:0, l3:0, l3Kacti:0 };
        urunIsiMap[u].blur++;
        if ((log.intentLevel || 0) >= 3) {
          urunIsiMap[u].l3++;
          if (log.sonuc === 'kacti') urunIsiMap[u].l3Kacti++;
        }
      });
      // Satış kaynağı: sepete eklenen + sonuç satis
      if (log.sonuc === 'satis' || log.sonuc === 'teklif') {
        (log.urunler || []).forEach(u => {
          const ad = u.urun || u;
          if (!ad) return;
          if (!urunIsiMap[ad]) urunIsiMap[ad] = { blur:0, satis:0, l3:0, l3Kacti:0 };
          if (log.sonuc === 'satis') urunIsiMap[ad].satis++;
        });
      }
    });

    // proposals + sales'tan da satış ekle (daha geniş veri)
    proposals.forEach(p => (p.urunler||[]).forEach(u => {
      if (!u.urun) return;
      if (!urunIsiMap[u.urun]) urunIsiMap[u.urun] = { blur:0, satis:0, l3:0, l3Kacti:0 };
      if (p.durum === 'satisDondu') urunIsiMap[u.urun].satis++;
    }));
    sales.forEach(s => (s.urunler||[]).forEach(u => {
      if (!u.urun) return;
      if (!urunIsiMap[u.urun]) urunIsiMap[u.urun] = { blur:0, satis:0, l3:0, l3Kacti:0 };
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
      const obj = { ad, ...v, ...bilgi,
        donusum: v.blur === 0 ? 0 : Math.round((v.satis / v.blur) * 100),
        l3DonuPct: v.l3 === 0 ? null : Math.round(((v.l3-v.l3Kacti)/v.l3)*100)
      };
      if (blurCok  &&  satisCok)  vitrinsampiyonlari.push(obj);
      else if (blurCok && !satisCok) direktenDonenler.push(obj);
      else if (!blurCok && satisCok) sessizDegerler.push(obj);
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
  if (h>=0) { 
    if(l.sonuc==='satis') saatSatis[h]++; 
    if(l.sonuc==='kacti') saatKacti[h]++; 
    saatBlur[h] += (l.bakilanFiyatlar || []).length;
  }
});

    // ── L3 GLOBAL İSTATİSTİKLER ───────────────────────────────
    const l3Toplam    = logs.filter(l => (l.intentLevel||0) >= 3).length;
    const l3Satis     = logs.filter(l => (l.intentLevel||0) >= 3 && l.sonuc === 'satis').length;
    const l3Kacti     = logs.filter(l => (l.intentLevel||0) >= 3 && l.sonuc === 'kacti').length;
    const l3KayipCiro = logs
      .filter(l => (l.intentLevel||0) >= 3 && l.sonuc === 'kacti')
      .reduce((s, l) => s + (l.toplamTutar||0), 0);
    const l3Donusum   = l3Toplam === 0 ? 0 : ((l3Satis / l3Toplam) * 100).toFixed(1);

    // L3'te kaçanların neden dağılımı
    const l3NedenMap = {};
    logs.filter(l => (l.intentLevel||0) >= 3 && l.sonuc === 'kacti').forEach(l => {
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
        const bB   = s.bundleFirsat===0?'—':((s.bundleYapilan/s.bundleFirsat)*100).toFixed(0)+'%';
        const aD   = s.toplam===0?0:(s.derinlikToplam/s.toplam).toFixed(1);
        const bU   = s.toplam===0?0:(s.benzersizToplam/s.toplam).toFixed(1);
        const bL   = s.toplam===0?0:(s.blurToplam/s.toplam).toFixed(1);
        const kC   = parseFloat(kO)>50?'#dc2626':parseFloat(kO)>30?'#f59e0b':'#16a34a';
        const satis_kalan = s.toplam - s.satis - s.kacti;
        // L3 kapanış oranı (abaküse girip satışa dönen)
        const l3KapanisOran = s.l3Giris===0 ? '—' : ((s.l3Satis/s.l3Giris)*100).toFixed(0)+'%';
        const l3KapCol = s.l3Giris===0 ? '#94a3b8'
          : (s.l3Satis/s.l3Giris)>=0.6 ? '#16a34a'
          : (s.l3Satis/s.l3Giris)>=0.3 ? '#f59e0b' : '#dc2626';
        
        // Rol etiketi (saha/destek/admin ayrımı)
        let rolEtiketi = '';
        if (s.rol === 'saha') rolEtiketi = '👷 Saha';
        else if (s.rol === 'destek') rolEtiketi = '🖥 Destek';
        else if (s.rol === 'admin') rolEtiketi = '👑 Admin';
        else rolEtiketi = '👤 Personel';
        
        return `<div style="background:var(--surface);border:1.5px solid var(--border);border-radius:16px;padding:14px;position:relative">
          <div style="position:absolute;top:10px;right:10px;background:${r.c}18;border:1px solid ${r.c}44;border-radius:20px;padding:2px 9px;font-size:.62rem;font-weight:700;color:${r.c}">${r.e} ${r.l}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-right:72px">
            <div class="user-avatar" style="width:34px;height:34px;font-size:.68rem">${s.ad.slice(0,2).toUpperCase()}</div>
            <div><b style="font-size:.88rem">${s.ad}</b>
              <div style="font-size:.62rem;color:var(--text-3)">${s.toplam} müşteri · ${rolEtiketi}</div>
            </div>
          </div>
          <div style="display:flex;height:20px;border-radius:8px;overflow:hidden;margin-bottom:8px;gap:1px">
            <div style="flex:${s.satis};background:#16a34a;display:flex;align-items:center;justify-content:center;font-size:.58rem;color:#fff;font-weight:800">${s.satis>0?sO+'%':''}</div>
            <div style="flex:${satis_kalan>0?satis_kalan:0};background:#f59e0b;min-width:0"></div>
            <div style="flex:${s.kacti};background:#dc2626;display:flex;align-items:center;justify-content:center;font-size:.58rem;color:#fff;font-weight:800">${s.kacti>0?kO+'%':''}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;font-size:.62rem">
            <div style="background:#f8fafc;border-radius:7px;padding:5px 2px;text-align:center"><b>${aD}</b><div style="color:var(--text-3)">Derin.</div></div>
            <div style="background:#f8fafc;border-radius:7px;padding:5px 2px;text-align:center"><b>${bU}</b><div style="color:var(--text-3)">Çeşit</div></div>
            <div style="background:#f8fafc;border-radius:7px;padding:5px 2px;text-align:center"><b>${bL}</b><div style="color:var(--text-3)">Blur</div></div>
            <div style="background:#f8fafc;border-radius:7px;padding:5px 2px;text-align:center"><b style="color:${kC}">${kO}%</b><div style="color:var(--text-3)">Kaçan</div></div>
            <div style="background:#f8fafc;border-radius:7px;padding:5px 2px;text-align:center;border:1px solid ${l3KapCol}33">
              <b style="color:${l3KapCol}">${l3KapanisOran}</b>
              <div style="color:var(--text-3)">Kapanış</div>
            </div>
            <div style="background:#f8fafc;border-radius:7px;padding:5px 2px;text-align:center">
              <b title="Altın(3+çeşit)">🥇${s.altin}</b><b title="Gümüş(2çeşit)" style="margin:0 2px">🥈${s.gumus}</b>
              <div style="color:var(--text-3)">Sepet</div>
            </div>
          </div>
        </div>`;
      }).join('');

    // ── SAATLİK YOĞUNLUK BARI (Satış/Kaçan) ─────────────────────────
    const saatMax = Math.max(...saatSatis.map((v,i)=>v+saatKacti[i]), 1);
    const saatBar = [...Array(24).keys()].map(h => {
      const top = saatSatis[h]+saatKacti[h];
      const sW  = top===0?0:Math.round(saatSatis[h]/saatMax*80);
      const kW  = top===0?0:Math.round(saatKacti[h]/saatMax*80);
      return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px;font-size:.58rem">
        <span style="min-width:26px;color:var(--text-3);text-align:right">${h<10?'0'+h:h}:00</span>
        <div style="flex:1;height:10px;border-radius:4px;background:#f1f5f9;display:flex;overflow:hidden">
          <div style="width:${sW}%;background:#16a34a"></div>
          <div style="width:${kW}%;background:#dc2626"></div>
        </div>
        <span style="min-width:16px;color:var(--text-2)">${top||''}</span>
      </div>`;
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

    // ── RENDER ────────────────────────────────────────────────
    // ── Hesaplama sonuçlarını stats objesine topla ──────────────
    const _funnelStats = {
      gunAralik, totN, totS, totK, donusumGercek,
      momOturum, momSatis, momIcon, momCol,
      son7Logs, onc7Logs, bugunLogs,
      katMap,
      top3Pahali,
      // Ürün Isı Haritası
      vitrinsampiyonlari, direktenDonenler, sessizDegerler, olduStok,
      // L3 Pazarlık
      l3Toplam, l3Satis, l3Kacti, l3KayipCiro, l3Donusum,
      l3NedenSirali, l3UrunSirali, saatL3Kacti, l3SaatMax,
      // Personel
      personelHTML,
      // Saatlik barlar
      saatBar, blurBar, saatBlur
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
  // s = _funnelStats objesi
  const { gunAralik, totN, totS, totK, donusumGercek,
    momOturum, momSatis, momIcon, momCol,
    son7Logs, onc7Logs, bugunLogs,
    katMap, top3Pahali,
    vitrinsampiyonlari, direktenDonenler, sessizDegerler, olduStok,
    l3Toplam, l3Satis, l3Kacti, l3KayipCiro, l3Donusum,
    l3NedenSirali, l3UrunSirali, saatL3Kacti, l3SaatMax,
    personelHTML, saatBar, blurBar, saatBlur } = s;

  cont.innerHTML = `
<!-- Filtre -->
<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
  ${['saha','destek','admin','hepsi'].map(f=>`
    <button class="funnel-filter-btn" data-filter="${f}"
      onclick="setFunnelFilter('${f}')"
      style="padding:6px 14px;border-radius:20px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:inherit;border:1.5px solid ${aktifFiltre===f?'var(--red)':'var(--border)'};background:${aktifFiltre===f?'var(--red)':'var(--surface)'};color:${aktifFiltre===f?'#fff':'var(--text-2)'}">
      ${f==='saha'?'👷 Saha':f==='destek'?'🖥 Destek':f==='admin'?'👑 Admin':'🌐 Tümü'}
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
          <div><div style="font-size:1.4rem;font-weight:800;color:#ef4444">${totK}</div><div style="font-size:.62rem;opacity:.6">Kaçan</div></div>
          <div><div style="font-size:1.4rem;font-weight:800;color:#22c55e">${donusumGercek}%</div><div style="font-size:.62rem;opacity:.6">Dönüşüm</div></div>
        </div>
        <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:1px solid rgba(255,255,255,.1);font-size:.72rem">
          <span>${momIcon} Son 7 gün vs önceki 7 gün: <b style="color:${momCol}">${Math.abs(momOturum)}% ${parseFloat(momOturum)>0?'↑ artış':'↓ azalış'}</b></span>
          <span>🏆 Satış: ${momSatis>0?'+':''}${momSatis}%</span>
        </div>
        <div style="font-size:.62rem;opacity:.4;text-align:center;margin-top:5px">Son 7 gün: ${son7Logs.length} · Önceki 7 gün: ${onc7Logs.length} · Bugün: ${bugunLogs.length}</div>
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

      <!-- Fiyat İtirazı Top 3 -->
      ${top3Pahali.length ? `
      <div style="background:#fff5f5;border:1.5px solid #fecaca;border-radius:14px;padding:12px;margin-bottom:12px">
        <div style="font-size:.7rem;font-weight:800;color:#dc2626;margin-bottom:8px">💸 Fiyat İtirazı Alan Top 3 Ürün</div>
        ${top3Pahali.map(([u,n],i)=>`
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #fee2e2;font-size:.75rem">
            <span>${['🥇','🥈','🥉'][i]} ${u}</span>
            <span style="font-weight:700;color:#dc2626">${n} itiraz</span>
          </div>`).join('')}
      </div>` : ''}

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

        <!-- Direkten Dönenler tablosu -->
        <div id="_isi-dd" style="display:block;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;overflow:hidden;margin-bottom:8px">
          <div style="padding:8px 10px;background:#fef3c7;font-size:.64rem;font-weight:800;color:#92400e;display:flex;justify-content:space-between">
            <span>🔥 Direkten Dönenler — Acil Fiyat/Taksit Revizyonu</span>
            <span style="opacity:.6">${direktenDonenler.length} ürün</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 44px 44px 44px 56px;gap:0;padding:4px 8px;background:#fef9c3;font-size:.58rem;font-weight:800;color:#78350f;border-bottom:1px solid #fde68a">
            <span>Ürün</span><span style="text-align:center">Blur</span><span style="text-align:center">Satış</span><span style="text-align:center">L3</span><span style="text-align:center">Dönüşüm</span>
          </div>
          ${direktenDonenler.slice(0,8).map(u => {
            const don = u.blur===0?0:Math.round(u.satis/u.blur*100);
            const donCol = don>=30?'#16a34a':don>=10?'#f59e0b':'#dc2626';
            const l3txt = u.l3 > 0 ? (u.l3Kacti+'/'+u.l3) : '—';
            return '<div style="display:grid;grid-template-columns:1fr 44px 44px 44px 56px;padding:5px 8px;border-bottom:1px solid #fef3c7;align-items:center">' +
              '<span style="font-size:.68rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#1e293b">' + u.ad + '</span>' +
              '<span style="text-align:center;font-size:.68rem;font-weight:700;color:#f59e0b">' + u.blur + '</span>' +
              '<span style="text-align:center;font-size:.68rem;font-weight:700;color:#16a34a">' + u.satis + '</span>' +
              '<span style="text-align:center;font-size:.65rem;color:#dc2626">' + l3txt + '</span>' +
              '<span style="text-align:center;font-size:.68rem;font-weight:800;color:'+donCol+'">' + don + '%</span>' +
            '</div>';
          }).join('')}
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
            <div style="font-size:1.3rem;font-weight:800;color:#ef4444">${fmt(l3KayipCiro)}</div>
            <div style="font-size:.58rem;opacity:.5">kaçırılan potansiyel</div>
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
          '<div style="font-size:.62rem;font-weight:700;opacity:.5;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Kaçış Nedenleri</div>' +
          l3NedenSirali.map(([n,c]) => {
            const pct = l3Kacti===0?0:Math.round(c/l3Kacti*100);
            return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">' +
              '<div style="flex:1;font-size:.68rem;color:rgba(255,255,255,.75)">' + n + '</div>' +
              '<div style="width:90px;height:5px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden">' +
                '<div style="width:' + pct + '%;height:100%;background:#ef4444;border-radius:3px"></div>' +
              '</div>' +
              '<div style="font-size:.65rem;font-weight:700;color:#ef4444;min-width:26px;text-align:right">' + c + '</div>' +
            '</div>';
          }).join('') + '</div>' : ''}

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
          <div style="display:flex;align-items:flex-end;gap:2px;height:32px">
            ${[...Array(24).keys()].map(h => {
              const v = saatL3Kacti[h];
              const hPct = v === 0 ? 0 : Math.round(v/l3SaatMax*100);
              return '<div title="' + (h<10?'0'+h:h) + ':00 — ' + v + ' kaçan" style="flex:1;background:' +
                (hPct>0?'rgba(239,68,68,'+Math.max(0.15,hPct/100)+')':'rgba(255,255,255,.05)') +
                ';border-radius:2px 2px 0 0;height:' + Math.max(2,hPct) + '%;min-height:2px"></div>';
            }).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;font-size:.52rem;opacity:.3;margin-top:2px">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
          </div>
        </div>
      </div>

      <!-- Saatlik Blur Yoğunluğu -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:12px">
        <div style="font-size:.68rem;font-weight:700;color:var(--text-3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">🔍 Saatlik Blur Yoğunluğu</div>
        <div style="display:flex;gap:10px;font-size:.6rem;margin-bottom:6px">
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#f59e0b;margin-right:3px"></span>Fiyat Bakılan Ürün</span>
          <span style="color:var(--text-3)">(Toplam ${saatBlur.reduce((a,b)=>a+b,0)} blur)</span>
        </div>
        ${blurBar}
      </div>
    `;


}

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
  // Motd listesi — admin görüntüleyebilsin
  renderMotdPanel();
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
      _fiyatDegisti: degisti
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
  
  // Sepet işlemleri
  addToBasket, removeFromBasket, fiyatGoster, _fyGos, applyDiscount,
  addToBasketPrim, openSiparisNotSafe, _initStockFilterBtn,
  deleteSelectedItems,   // Toplu silme fonksiyonu
  
  // Teklif işlemleri
  updatePropStatus, resendProposalWa, openPropNote, deleteProp,
  openEditProp, addEditUrunRow, saveEditProp, printTeklif, teklifSepeteEkle,
  
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
  togglePropGroup, setItemDisc, toggleCartDiscPanel,
  
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
