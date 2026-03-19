// ═══════════════════════════════════════════════════════════════
//  PİYASA FİYAT ENTEGRASYONU
//  Bu kodu app.js'e ekleyin veya ayrı <script> olarak yükleyin
//  (loadData() çağrısından önce gelmelidir)
// ═══════════════════════════════════════════════════════════════

// Piyasa fiyat cache'i — kod → {vatan, mediamarkt}
window._marketPrices = {};
window._marketPricesMeta = null;

/**
 * market-prices.json'ı yükle ve cache'e al
 * loadData() ile paralel çalışır — hata olursa sessizce geçer
 */
async function loadMarketPrices() {
  try {
    const url = dataUrl('market-prices.json') + '?v=' + Date.now();
    const resp = await fetch(url);
    if (!resp.ok) return;
    const json = await resp.json();
    if (!json.prices) return;

    window._marketPricesMeta = json.meta;
    json.prices.forEach(p => {
      window._marketPrices[String(p.kod).trim()] = {
        vatan: p.vatan,        // null veya sayı
        mediamarkt: p.mediamarkt,
      };
    });

    // Güncelleme tarihini göster (isteğe bağlı)
    const meta = json.meta;
    if (meta?.guncelleme) {
      const tarih = new Date(meta.guncelleme).toLocaleDateString('tr-TR', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
      const el = document.getElementById('market-price-date');
      if (el) el.textContent = 'Piyasa: ' + tarih;
    }
    console.log('[market-prices] Yüklendi —', Object.keys(window._marketPrices).length, 'ürün');
  } catch (e) {
    console.warn('[market-prices] Yüklenemedi:', e.message);
    // Hata durumunda sistem çalışmaya devam eder
  }
}

/**
 * Bir ürün koduna ait piyasa fiyatlarını döner
 * @param {string|number} kod
 * @returns {{vatan: number|null, mediamarkt: number|null}}
 */
function getMarketPrice(kod) {
  return window._marketPrices[String(kod).trim()] || { vatan: null, mediamarkt: null };
}

/**
 * Piyasa fiyat hücresini formatlar
 * @param {number|null} fiyat
 * @param {number|null} bizimFiyat  — kendi Nakit fiyatımız (karşılaştırma için)
 * @returns {string} HTML
 */
function fmtMarket(fiyat, bizimFiyat) {
  if (!fiyat) return '<span style="color:var(--text-3);font-size:.75rem">—</span>';
  const f = Number(fiyat).toLocaleString('tr-TR') + '\u00a0₺';
  // Eğer piyasa bizden pahalıysa yeşil (avantajlı), ucuzsa turuncu (not)
  if (bizimFiyat && fiyat > 0 && bizimFiyat > 0) {
    const fark = fiyat - bizimFiyat;
    if (fark >= 0) {
      // Piyasa ≥ biz → yeşil (biz daha ucuz veya eşit)
      return `<span style="color:#2d9a52;font-weight:500">${f}</span>`;
    } else {
      // Piyasa < biz → turuncu (dikkat)
      return `<span style="color:#c46a00">${f}</span>`;
    }
  }
  return f;
}

// ═══════════════════════════════════════════════════════════════
//  MEVCUT renderTable() REPLACEMENTI
//  Aşağıdaki fonksiyon, app.js'teki renderTable'ı override eder.
//  İki yeni sütun ekler: Vatan ve MediaMarkt fiyatları.
//
//  KURULUM:
//   Bu bloğu app.js'teki renderTable tanımından SONRA yapıştırın.
//   (Ya da ayrı script dosyası olarak index.html'in en sonunda yükleyin)
// ═══════════════════════════════════════════════════════════════

(function patchRenderTable() {
  // Orijinal renderTable'a referans
  const _origRenderTable = window.renderTable;

  window.renderTable = function renderTableWithMarket(searchVal) {
    const kws = norm(searchVal || '').split(' ').filter(k => k.length > 0);
    const data = allProducts.filter(u => {
      if (!showZeroStock && (Number(u.Stok) || 0) === 0) return false;
      if (!kws.length) return true;
      return kws.every(kw => norm(Object.values(u).join(' ')).includes(kw));
    });
    const list = document.getElementById('product-list');
    list.innerHTML = '';
    const frag = document.createDocumentFragment();

    data.forEach(u => {
      const oi      = allProducts.indexOf(u);
      const stok    = Number(u.Stok) || 0;
      const sc      = stok === 0 ? 'stok-kritik' : stok > 10 ? 'stok-bol' : 'stok-orta';
      const keys    = Object.keys(u);
      const urunKey = keys.find(k => norm(k) === 'urun') || '';
      const descKey = keys.find(k => norm(k) === 'aciklama') || '';
      const kartKey = keys.find(k => k.includes('Kart')) || '';
      const cekKey  = keys.find(k => k.includes('ekim')) || '';
      const gamKey  = keys.find(k => norm(k).includes('gam')) || '';

      // Piyasa fiyatları
      const mp       = getMarketPrice(u.Kod);
      const nakit    = parseFloat(u.Nakit) || 0;
      const vatanHtml = fmtMarket(mp.vatan, nakit);
      const mmHtml    = fmtMarket(mp.mediamarkt, nakit);

      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td><button class="add-btn haptic-btn" onclick="addToBasket(${oi})">+</button></td>` +
        `<td><span class="product-name">${u[urunKey] || ''}</span>${u[descKey] ? `<span class="product-desc">${u[descKey]}</span>` : ''}</td>` +
        `<td class="${sc}">${stok}</td>` +
        `<td class="td-price">${fmt(u[kartKey])}</td>` +
        `<td class="td-price">${fmt(u['4T AWM'])}</td>` +
        `<td class="td-price">${fmt(u[cekKey])}</td>` +
        `<td class="td-price">${fmt(u.Nakit)}</td>` +
        `<td class="td-price td-market">${vatanHtml}</td>` +     // ← YENİ
        `<td class="td-price td-market">${mmHtml}</td>` +         // ← YENİ
        `<td style="font-size:.67rem;color:var(--text-3)">${u.Kod || ''}</td>` +
        `<td class="td-gam">${u[gamKey] || '-'}</td>` +
        `<td class="td-marka">${u.Marka || '-'}</td>` +
        `<td class="td-etiket">${u['Etiket Fiyatı'] ? fmt(u['Etiket Fiyatı']) : '-'}</td>` +
        `<td><button class="siparis-btn haptic-btn" onclick="openSiparisNot('${(u[urunKey] || '').replace(/'/g, "&#39;")}',${oi})" title="Sipariş Notu Ekle">📦</button></td>`;
      frag.appendChild(tr);
    });
    list.appendChild(frag);
  };
})();
