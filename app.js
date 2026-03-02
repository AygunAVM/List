let allProducts = [];
let cart = [];
let lastData = JSON.parse(localStorage.getItem('last_urunler')) || null;

// GİRİŞ KONTROLÜ
function handleLogin() {
    const email = document.getElementById('email').value;
    const remember = document.getElementById('remember').checked;
    if(email) {
        if(remember) localStorage.setItem('user_logged_in', 'true');
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('main-screen').classList.remove('hidden');
        loadData();
    }
}

// VERİ YÜKLEME VE VERSİYON KONTROLÜ
async function loadData() {
    try {
        const response = await fetch('urunler.json?v=' + Date.now());
        const json = await response.json();
        allProducts = json.data;
        document.getElementById('version-text').innerText = json.metadata.v;

        // Değişim Günlüğü Kontrolü
        if (lastData && lastData.metadata.v !== json.metadata.v) {
            compareData(lastData.data, json.data);
        }
        localStorage.setItem('last_urunler', JSON.stringify(json));
        renderTable(allProducts);
    } catch (e) { console.error("Veri yüklenemedi", e); }
}

// GELİŞMİŞ ARAMA (Sams Buzd mantığı)
function handleSearch() {
    const query = document.getElementById('search').value.toLocaleLowerCase('tr-TR').split(' ');
    const filtered = allProducts.filter(p => {
        const text = `${p.Ürün} ${p.Açıklama} ${p.Kod} ${p.Marka}`.toLocaleLowerCase('tr-TR');
        return query.every(word => text.includes(word));
    });
    renderTable(filtered);
}

// TABLO RENDER
function renderTable(data) {
    const body = document.getElementById('product-body');
    body.innerHTML = data.map(p => `
        <tr>
            <td>**${p.Ürün}**</td>
            <td>${p.Stok}</td>
            <td>${p['Diğer Kartlar']}</td>
            <td>${p['4T AWM']}</td>
            <td>${p['Tek Çekim']}</td>
            <td>${p.Nakit}</td>
            <td>${p.Açıklama}</td>
            <td>${p.Kod}</td>
            <td class="small-text">${p['Ürün Gamı']}</td>
            <td class="small-text">${p.Marka}</td>
            <td><button onclick="addToCart(${p.Kod})" class="btn-primary">+</button></td>
        </tr>
    `).join('');
}

// SEPET İŞLEMLERİ
function addToCart(kod) {
    const product = allProducts.find(p => p.Kod === kod);
    cart.push({...product});
    updateCartUI();
}

function updateCartUI() {
    document.getElementById('cart-count').innerText = cart.length;
    const discount = parseFloat(document.getElementById('global-discount').value) || 0;
    const body = document.getElementById('cart-body');
    
    body.innerHTML = cart.map((p, idx) => `
        <tr>
            <td>${p.Ürün}</td>
            <td>${p.Stok}</td>
            <td class="price-row">${p['Diğer Kartlar']} <span class="discount-badge">${discount > 0 ? '-'+discount : ''}</span></td>
            <td>${p['4T AWM']}</td>
            <td>${p['Tek Çekim']}</td>
            <td>${p.Nakit}</td>
            <td>${p.Açıklama}</td>
            <td><button onclick="removeFromCart(${idx})">❌</button></td>
        </tr>
    `).join('');
}

function applyDiscount() { updateCartUI(); }
function toggleCart() { document.getElementById('cart-screen').classList.toggle('hidden'); }
function removeFromCart(idx) { cart.splice(idx, 1); updateCartUI(); }

// WHATSAPP - ÜLKE KODU DÜZELTMESİ
function sendWhatsApp() {
    let phone = document.getElementById('cust-phone').value.replace(/\D/g, '');
    if (phone.startsWith('0')) phone = '90' + phone.substring(1);
    if (phone.length === 10) phone = '90' + phone;

    let message = `*Aygün AVM Sipariş Listesi*\nMüşteri: ${document.getElementById('cust-name').value}\n\n`;
    cart.forEach(p => {
        message += `• ${p.Ürün} - ${p.Nakit} TL\n`;
    });
    
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
}

// DEĞİŞİM KARŞILAŞTIRMA (Max 2 Kayıt)
function compareData(oldData, newData) {
    const changes = [];
    newData.forEach(newItem => {
        const oldItem = oldData.find(o => o.Kod === newItem.Kod);
        if(oldItem) {
            if(oldItem.Stok !== newItem.Stok) changes.push(`${newItem.Ürün} Stok: ${oldItem.Stok} ➔ ${newItem.Stok}`);
            if(oldItem.Nakit !== newItem.Nakit) changes.push(`${newItem.Ürün} Fiyat: ${oldItem.Nakit} ➔ ${newItem.Nakit}`);
        }
    });

    if(changes.length > 0) {
        const changeList = document.getElementById('change-list');
        changeList.innerHTML = changes.slice(0, 20).map(c => `<li>${c}</li>`).join('');
        document.getElementById('change-modal').classList.remove('hidden');
    }
}

function closeChangeModal() { document.getElementById('change-modal').classList.add('hidden'); }

// Sayfa açılışında login kontrolü
if(localStorage.getItem('user_logged_in') === 'true') {
    handleLogin();
}
