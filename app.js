let allProducts = [];
let cart = [];
let lastSeenVersion = localStorage.getItem('last_version');

// 1. Veri Yükleme ve Versiyon Kontrolü
async function loadData() {
    try {
        const response = await fetch('urunler.json?v=' + Date.now()); // Cache engelleme
        if (!response.ok) throw new Error("Dosya bulunamadı!");
        const json = await response.json();
        
        allProducts = json.data;
        document.getElementById('version-text').innerText = json.metadata.v;

        // Versiyon Değişiklik Kontrolü
        if (lastSeenVersion && lastSeenVersion !== json.metadata.v) {
            compareVersions(json.metadata.v);
        }
        localStorage.setItem('last_version', json.metadata.v);
        
        renderProducts(allProducts);
    } catch (err) {
        console.error("Veri yükleme hatası:", err);
    }
}

// 2. Büyük/Küçük Harf Duyarsız Arama (sams buzd)
function filterData() {
    const val = document.getElementById('searchInput').value.toLocaleLowerCase('tr-TR');
    const terms = val.split(' ');

    const filtered = allProducts.filter(item => {
        const fullText = `${item.Ürün} ${item.Marka} ${item['Ürün Gamı']}`.toLocaleLowerCase('tr-TR');
        return terms.every(term => fullText.includes(term));
    });
    renderProducts(filtered);
}

// 3. WhatsApp Ülke Kodu Düzeltmesi
function sendToWhatsApp() {
    let phone = document.getElementById('custTel').value.replace(/\D/g, '');
    const name = document.getElementById('custName').value;
    const note = document.getElementById('orderNote').value;

    if (phone.startsWith('0')) phone = '90' + phone.substring(1);
    if (phone.length !== 12) { alert("Lütfen 11 haneli telefon numarasını giriniz!"); return; }

    let message = `*Aygün AVM Sipariş*\nAlıcı: ${name}\nNot: ${note}\n----------\n`;
    cart.forEach(item => {
        message += `• ${item.Ürün} - ${item.price} TL ${item.discount !== 0 ? '(İnd: ' + item.discount + ')' : ''}\n`;
    });

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
}

// 4. Sepet İşlemleri ve İndirim Gösterimi
function addToCart(index) {
    const prod = allProducts[index];
    cart.push({ ...prod, discount: 0, price: prod.Nakit });
    updateCartUI();
}

function updateCartUI() {
    const container = document.getElementById('cart-items');
    document.getElementById('cart-count').innerText = cart.length;
    container.innerHTML = '';

    cart.forEach((item, idx) => {
        container.innerHTML += `
            <div class="cart-item">
                <b>${item.Ürün}</b> - ${item.price} TL
                <input type="number" placeholder="İndirim/Fark" onchange="applyDiscount(${idx}, this.value)">
                <span class="discount-text">${item.discount !== 0 ? (item.discount > 0 ? '+'+item.discount : item.discount) : ''}</span>
                <button onclick="removeFromCart(${idx})">Sil</button>
            </div>
        `;
    });
}

function applyDiscount(idx, val) {
    cart[idx].discount = parseFloat(val) || 0;
    updateCartUI();
}

// 5. Giriş ve Beni Hatırla
function handleLogin() {
    const remember = document.getElementById('remember').checked;
    // Basit giriş kontrolü
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    if(remember) localStorage.setItem('isLoggedIn', 'true');
    loadData();
}

// Sayfa yüklendiğinde
window.onload = () => {
    if(localStorage.getItem('isLoggedIn') === 'true') {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        loadData();
    }
};

// Ürünleri Render Etme
function renderProducts(data) {
    const container = document.getElementById('product-list');
    container.innerHTML = data.map((item, index) => `
        <div class="product-row" onclick="addToCart(${index})">
            <div class="p-cell">${item.Ürün}</div>
            <div class="p-cell">${item.Stok}</div>
            <div class="p-cell">${item['Diğer Kartlar']}</div>
            <div class="p-cell">${item['4T AWM']}</div>
            <div class="p-cell">${item['Tek Çekim']}</div>
            <div class="p-cell">${item.Nakit}</div>
            <div class="p-cell col-desc">${item.Açıklama}</div>
            <div class="p-cell small-p">${item.Kod}</div>
            <div class="p-cell small-p">${item['Ürün Gamı']}</div>
            <div class="p-cell small-p">${item.Marka}</div>
        </div>
    `).join('');
}

function toggleCart() { document.getElementById('cart-panel').classList.toggle('active'); }
