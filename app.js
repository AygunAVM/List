// GLOBAL DURUM
let allProducts = [], allRates = [], basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;
let currentCategory = 'all';

// DOM HAZIR
document.addEventListener('DOMContentLoaded', () => {
    if (currentUser) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-content').style.display = 'block';
        loadData();
        loadRates();
    }
});

// VERİ YÜKLEME
function loadData() {
    fetch('data/urunler.json?t=' + Date.now())
        .then(r => r.json())
        .then(data => {
            // Sadece adı olan geçerli ürünleri filtrele
            allProducts = data.filter(p => p && (p.UrunAd || p.Urun_Ad)); 
            renderProducts();
            renderChips();
        })
        .catch(err => console.error("Ürün yükleme hatası:", err));
}

function loadRates() {
    fetch('data/rates.json?t=' + Date.now())
        .then(r => r.json())
        .then(data => {
            allRates = data || [];
            populateCardSelect();
        })
        .catch(err => console.log("Oranlar dosyası henüz hazır değil."));
}

// ÜRÜN LİSTELEME (HATA KORUMALI)
function renderProducts() {
    const grid = document.getElementById('product-grid');
    const search = (document.getElementById('search-input').value || "").toLowerCase();
    
    const filtered = allProducts.filter(p => {
        // Veri boşsa hata vermemesi için || "" kullanıyoruz
        const name = (p.UrunAd || p.Urun_Ad || "").toLowerCase();
        const brand = (p.Marka || "").toLowerCase();
        const cat = p.Kategori || "";

        const matchSearch = name.includes(search) || brand.includes(search);
        const matchCat = currentCategory === 'all' || cat === currentCategory;
        return matchSearch && matchCat;
    });

    if (filtered.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px; color:#94a3b8;">Ürün bulunamadı.</div>';
        return;
    }

    grid.innerHTML = filtered.map(p => `
        <div class="product-card">
            <div class="product-info">
                <h4>${p.UrunAd || p.Urun_Ad}</h4>
                <p>${p.Marka || '-'}</p>
                <div class="price">${formatPrice(p.Fiyat || 0)}</div>
            </div>
            <button class="add-btn haptic-btn" onclick="addToBasket('${p.UrunAd || p.Urun_Ad}', ${p.Fiyat || 0})">+</button>
        </div>
    `).join('');
}

function renderChips() {
    const container = document.getElementById('filter-chips');
    const categories = ['all', ...new Set(allProducts.map(p => p.Kategori).filter(Boolean))];
    container.innerHTML = categories.map(c => `
        <div class="chip ${currentCategory === c ? 'active' : ''}" onclick="setCategory('${c}', this)">
            ${c === 'all' ? 'Hepsi' : c}
        </div>
    `).join('');
}

function setCategory(cat, el) {
    currentCategory = cat;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    renderProducts();
}

function filterProducts() { renderProducts(); }

// SEPET VE DİĞER FONKSİYONLAR
function addToBasket(name, price) {
    const item = basket.find(i => i.name === name);
    if (item) item.count++; else basket.push({name, price, count: 1});
    updateBasketUI();
}

function updateBasketUI() {
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    const count = basket.reduce((a, b) => a + b.count, 0);
    document.getElementById('cart-count').innerText = count;
}

function formatPrice(p) { 
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(p); 
}

function toggleCart() {
    const modal = document.getElementById('cart-modal');
    const isVisible = modal.style.display === 'flex';
    modal.style.display = isVisible ? 'none' : 'flex';
    if (!isVisible) renderBasket();
}

function renderBasket() {
    const list = document.getElementById('cart-items');
    const total = basket.reduce((s, i) => s + (i.price * i.count), 0);
    list.innerHTML = basket.map(i => `
        <div class="cart-item" style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #eee;">
            <span>${i.name} (x${i.count})</span>
            <span>${formatPrice(i.price * i.count)}</span>
        </div>
    `).join('');
    document.getElementById('cart-total').innerText = formatPrice(total);
}

function clearBasket() {
    basket = [];
    updateBasketUI();
    toggleCart();
}

// POS HESAPLAMA
function populateCardSelect() {
    const select = document.getElementById('pos-card-select');
    if(!select) return;
    const cards = [...new Set(allRates.map(r => r.Kart).filter(Boolean))];
    select.innerHTML = '<option value="">Kart Seçin...</option>' + 
        cards.map(c => `<option value="${c}">${c}</option>`).join('');
}

function openPosCalc() {
    document.getElementById('pos-modal').style.display = 'flex';
    renderPosResults();
}

function closePosCalc() {
    document.getElementById('pos-modal').style.display = 'none';
}

function renderPosResults() {
    const card = document.getElementById('pos-card-select').value;
    const container = document.getElementById('pos-results');
    const net = basket.reduce((s, i) => s + (i.price * i.count), 0);
    if (!card || net === 0) {
        container.innerHTML = '<p style="text-align:center; padding:20px;">Lütfen kart seçin.</p>';
        return;
    }

    const filtered = allRates.filter(r => r.Kart === card);
    container.innerHTML = filtered.map(r => `
        <div class="pos-zincir-box">
            <div class="pos-zincir-title" style="font-weight:bold; color:#3b82f6; border-bottom:1px solid #eee; margin-bottom:10px;">${r.Zincir}</div>
            <div class="pos-grid-layout" style="display:grid; grid-template-columns:1fr 1fr; gap:5px;">
                ${getPosLine("Tek", r.Tek, net)}
                ${getPosLine("3 Taksit", r["3Taksit"], net)}
                ${getPosLine("6 Taksit", r["6Taksit"], net)}
                ${getPosLine("9 Taksit", r["9Taksit"], net)}
            </div>
        </div>
    `).join('');
}

function getPosLine(lbl, rateStr, net) {
    if (!rateStr || rateStr === "Yok") return "";
    const rate = parseFloat(rateStr.toString().replace(',', '.'));
    const total = net / (1 - (rate / 100));
    return `<div class="pos-item-card" style="background:#f8fafc; padding:8px; border-radius:4px;">
                <small style="display:block; font-size:10px; color:#64748b;">${lbl} (%${rate})</small>
                <b style="font-size:13px;">${formatPrice(total)}</b>
            </div>`;
}

function checkAuth() {
    const email = document.getElementById('user-input').value;
    const pass = document.getElementById('pass-input').value;
    if(email && pass) {
        currentUser = { email };
        localStorage.setItem('aygun_user', JSON.stringify(currentUser));
        location.reload();
    }
}
