let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];

// Uygulama açıldığında çalışacaklar
window.onload = () => {
    checkBasketExpiry();
    loadData();
    updateUI();
};

async function loadData() {
    try {
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        allProducts = json.data;
        document.getElementById('v-tag').innerText = json.metadata.v;
        renderBrands(allProducts);
        renderTable(allProducts);
    } catch (err) { console.error("Veri hatası:", err); }
}

function renderTable(data) {
    const list = document.getElementById('product-list');
    list.innerHTML = data.map(u => `
        <tr>
            <td>${u.Model || u.Ürün}</td>
            <td>${u.Marka}</td>
            <td>${Number(u.Nakit).toLocaleString('tr-TR')} ₺</td>
            <td><button class="add-btn" onclick="addToBasket('${u.Model || u.Ürün}', ${u.Nakit})">Ekle</button></td>
        </tr>
    `).join('');
}

function addToBasket(name, price) {
    // Sepet boşsa zamanı başlat
    if (basket.length === 0) {
        localStorage.setItem('basket_timestamp', Date.now());
    }
    
    basket.push({ name, price, id: Date.now() });
    saveAndRefresh();
}

function checkBasketExpiry() {
    const startTime = localStorage.getItem('basket_timestamp');
    if (startTime) {
        const diff = (Date.now() - startTime) / 1000 / 60; // Dakika
        if (diff > 30) {
            clearBasket();
            alert("Hata Riskini Önleme: 30 dakikadır bekleyen sepet temizlendi.");
        }
    }
}

function clearBasket() {
    basket = [];
    localStorage.removeItem('aygun_basket');
    localStorage.removeItem('basket_timestamp');
    saveAndRefresh();
}

function saveAndRefresh() {
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    updateUI();
}

function updateUI() {
    document.getElementById('cart-count').innerText = basket.length;
    // Modal içindeki listeyi de güncelle
    const cartItems = document.getElementById('cart-items');
    cartItems.innerHTML = basket.map(i => `<p>• ${i.name} - ${i.price.toLocaleString('tr-TR')} ₺</p>`).join('');
}

function toggleCart() {
    const modal = document.getElementById('cart-modal');
    modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    checkBasketExpiry();
}

// Filtreleme fonksiyonları buraya gelecek...
