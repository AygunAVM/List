// GLOBAL STATE
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
    fetch('data/urunler.json?t=' + Date.now()).then(r => r.json()).then(data => {
        allProducts = data;
        renderProducts();
        renderChips();
    }).catch(err => console.error("Ürün yükleme hatası:", err));
}

function loadRates() {
    fetch('data/rates.json?t=' + Date.now()).then(r => r.json()).then(data => {
        allRates = data;
        populateCardSelect();
    }).catch(err => console.log("Oranlar bulunamadı."));
}

// ÜRÜN LİSTELEME (Eksik olan fonksiyon)
function renderProducts() {
    const grid = document.getElementById('product-grid');
    const search = document.getElementById('search-input').value.toLowerCase();
    
    const filtered = allProducts.filter(p => {
        const matchSearch = p.UrunAd.toLowerCase().includes(search) || p.Marka.toLowerCase().includes(search);
        const matchCat = currentCategory === 'all' || p.Kategori === currentCategory;
        return matchSearch && matchCat;
    });

    grid.innerHTML = filtered.map(p => `
        <div class="product-card">
            <div class="product-info">
                <h4>${p.UrunAd}</h4>
                <p>${p.Marka}</p>
                <div class="price">${formatPrice(p.Fiyat)}</div>
            </div>
            <button class="add-btn haptic-btn" onclick="addToBasket('${p.UrunAd}', ${p.Fiyat})">+</button>
        </div>
    `).join('');
}

function renderChips() {
    const container = document.getElementById('filter-chips');
    const cats = ['all', ...new Set(allProducts.map(p => p.Kategori))];
    container.innerHTML = cats.map(c => `
        <div class="chip ${currentCategory === c ? 'active' : ''}" onclick="setCategory('${c}', this)">${c === 'all' ? 'Hepsi' : c}</div>
    `).join('');
}

function setCategory(cat, el) {
    currentCategory = cat;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    renderProducts();
}

function filterProducts() { renderProducts(); }

// SEPET İŞLEMLERİ
function addToBasket(name, price) {
    const item = basket.find(i => i.name === name);
    if (item) item.count++; else basket.push({name, price, count: 1});
    updateBasketUI();
}

function updateBasketUI() {
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    document.getElementById('cart-count').innerText = basket.reduce((a, b) => a + b.count, 0);
}

function toggleCart() {
    const modal = document.getElementById('cart-modal');
    modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    renderBasket();
}

function renderBasket() {
    const list = document.getElementById('cart-items');
    const total = basket.reduce((s, i) => s + (i.price * i.count), 0);
    list.innerHTML = basket.map(i => `
        <div class="cart-item">
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

// POS HESAPLAMA (Abaküs Fonksiyonları)
function populateCardSelect() {
    const select = document.getElementById('pos-card-select');
    const cards = [...new Set(allRates.map(r => r.Kart))];
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
    if (!card || net === 0) return;

    const filtered = allRates.filter(r => r.Kart === card);
    container.innerHTML = filtered.map(r => `
        <div class="pos-zincir-box">
            <div class="pos-zincir-title">${r.Zincir}</div>
            <div class="pos-grid-layout">
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
    return `<div class="pos-item-card"><small>${lbl}</small><b>${formatPrice(total)}</b></div>`;
}

function formatPrice(p) { return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(p); }

function checkAuth() {
    const email = document.getElementById('user-input').value;
    const pass = document.getElementById('pass-input').value;
    // Basit giriş mantığı (kullanicilar.json'dan çekilebilir)
    if(email && pass) {
        currentUser = {email};
        localStorage.setItem('aygun_user', JSON.stringify(currentUser));
        location.reload();
    }
}
