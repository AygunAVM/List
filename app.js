let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];

// 1. Şifre Kontrolü (Hatalı giriş riskini engeller)
async function checkAuth() {
    const input = document.getElementById('pass-input').value;
    try {
        const res = await fetch('data/kullanicilar.json');
        const users = await res.json();
        // kullanicilar.json içinde "Sifre" sütunu olduğunu varsayıyoruz
        const isValid = users.some(u => String(u.Sifre) === input);
        
        if (isValid) {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-content').style.display = 'block';
            loadData();
        } else {
            document.getElementById('login-err').style.display = 'block';
        }
    } catch (e) { alert("Güvenlik dosyası yüklenemedi!"); }
}

async function loadData() {
    const res = await fetch('data/urunler.json?v=' + Date.now());
    const json = await res.json();
    allProducts = json.data || [];
    document.getElementById('v-tag').innerText = json.metadata?.v || "V2.1";
    renderBrands(allProducts);
    renderTable(allProducts);
}

function renderTable(data) {
    const list = document.getElementById('product-list');
    list.innerHTML = data.map(u => `
        <tr>
            <td><button class="add-btn" onclick="addToBasket('${u.Kod}', '${u.Ürün}', ${u['Diğer Kartlar']}, ${u['4T AWM']}, ${u['Tek Çekim']}, ${u.Nakit})">+</button></td>
            <td><small>${u.Kod || ''}</small></td>
            <td><strong>${u.Ürün}</strong></td>
            <td>${u['Ürün Gamı'] || ''}</td>
            <td>${u.Marka}</td>
            <td>${u.Stok || '0'}</td>
            <td>${Number(u['Diğer Kartlar']).toLocaleString('tr-TR')}</td>
            <td>${Number(u['4T AWM']).toLocaleString('tr-TR')}</td>
            <td>${Number(u['Tek Çekim']).toLocaleString('tr-TR')}</td>
            <td>${Number(u.Nakit).toLocaleString('tr-TR')}</td>
            <td><small>${u.Açıklama || ''}</small></td>
        </tr>
    `).join('');
}

function addToBasket(kod, urun, dk, awm, tek, nakit) {
    if (basket.length === 0) localStorage.setItem('basket_timestamp', Date.now());
    basket.push({ kod, urun, dk, awm, tek, nakit });
    saveAndRefresh();
}

function updateUI() {
    document.getElementById('cart-count').innerText = basket.length;
    const cartItems = document.getElementById('cart-items');
    
    if (basket.length === 0) {
        cartItems.innerHTML = "<p>Sepet boş.</p>";
    } else {
        cartItems.innerHTML = basket.map(i => `
            <div class="cart-item-row">
                <strong>${i.urun}</strong><br>
                <small>D.Kart: ${i.dk} | 4T: ${i.awm} | Tek: ${i.tek} | Nakit: ${i.nakit}</small>
            </div>
        `).join('');
    }
}

// finalizeProposal fonksiyonunda tüm fiyatları WhatsApp mesajına ekle
function finalizeProposal() {
    const name = document.getElementById('cust-name').value;
    const phone = document.getElementById('cust-phone').value;
    if (!name || !phone) { alert("Bilgileri girin!"); return; }

    let msg = `*AYGÜN AVM TEKLİF*\n*Müşteri:* ${name}\n\n`;
    basket.forEach((i, idx) => {
        msg += `*${idx+1}. ${i.urun}*\n`;
        msg += `- D.Kart: ${i.dk} ₺\n- 4T AWM: ${i.awm} ₺\n- Tek Çekim: ${i.tek} ₺\n- Nakit: ${i.nakit} ₺\n\n`;
    });

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
    clearBasket();
    toggleCart();
}
// ... (diğer yardımcı fonksiyonlar: checkBasketExpiry, filterData, saveAndRefresh vb. önceki kodla aynı kalacak)
