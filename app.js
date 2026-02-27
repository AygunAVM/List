let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];

// 1. Şifre ve Kullanıcı Kontrolü
async function checkAuth() {
    const userInp = document.getElementById('user-input').value.trim();
    const passInp = document.getElementById('pass-input').value.trim();
    const errText = document.getElementById('login-err');

    try {
        const res = await fetch('data/kullanicilar.json?t=' + Date.now());
        const users = await res.json();
        
        // Excel'den gelen sütun isimleri: "Kullanıcı Adı" ve "Sifre" varsayılmıştır
        const user = users.find(u => 
            String(u["Kullanıcı Adı"]).toLowerCase() === userInp.toLowerCase() && 
            String(u.Sifre) === passInp
        );

        if (user) {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-content').style.display = 'block';
            loadData();
        } else {
            errText.style.display = 'block';
        }
    } catch (e) {
        console.error("Giriş hatası:", e);
        alert("Kullanıcı listesi yüklenemedi. Lütfen internetinizi ve data/kullanicilar.json dosyasını kontrol edin.");
    }
}

// 2. Ürün Verilerini Yükleme
async function loadData() {
    try {
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        
        allProducts = json.data || [];
        document.getElementById('v-tag').innerText = json.metadata?.v || "V2.2";

        renderBrands(allProducts);
        renderTable(allProducts);
        checkBasketExpiry();
        updateUI();
    } catch (err) {
        console.error("Veri yükleme hatası:", err);
        alert("Ürün listesi yüklenemedi!");
    }
}

// 3. Tabloyu Ekrana Basma
function renderTable(data) {
    const list = document.getElementById('product-list');
    list.innerHTML = data.map(u => `
        <tr>
            <td><button class="add-btn" onclick="addToBasket('${u.Kod || ''}', '${u.Ürün || u.Model}', '${u['Diğer Kartlar'] || 0}', '${u['4T AWM'] || 0}', '${u['Tek Çekim'] || 0}', '${u.Nakit || 0}')">+</button></td>
            <td><small>${u.Kod || '-'}</small></td>
            <td>${u.Ürün || u.Model || '-'}</td>
            <td><small>${u['Ürün Gamı'] || '-'}</small></td>
            <td>${u.Marka || '-'}</td>
            <td>${u.Stok || '0'}</td>
            <td>${Number(u['Diğer Kartlar'] || 0).toLocaleString('tr-TR')}</td>
            <td>${Number(u['4T AWM'] || 0).toLocaleString('tr-TR')}</td>
            <td>${Number(u['Tek Çekim'] || 0).toLocaleString('tr-TR')}</td>
            <td>${Number(u.Nakit || 0).toLocaleString('tr-TR')}</td>
            <td><small>${u.Açıklama || '-'}</small></td>
        </tr>
    `).join('');
}

function renderBrands(data) {
    const select = document.getElementById('brand-filter');
    const brands = [...new Set(data.map(u => u.Marka))].filter(x => x).sort();
    select.innerHTML = '<option value="">Tüm Markalar</option>' + 
        brands.map(b => `<option value="${b}">${b}</option>`).join('');
}

function filterData() {
    const term = document.getElementById('search').value.toLowerCase();
    const brand = document.getElementById('brand-filter').value;
    const filtered = allProducts.filter(u => {
        const matchText = Object.values(u).join(" ").toLowerCase().includes(term);
        const matchBrand = !brand || u.Marka === brand;
        return matchText && matchBrand;
    });
    renderTable(filtered);
}

// 4. Sepet İşlemleri
function addToBasket(kod, urun, dk, awm, tek, nakit) {
    if (basket.length === 0) localStorage.setItem('basket_timestamp', Date.now());
    basket.push({ kod, urun, dk, awm, tek, nakit, time: new Date().toLocaleTimeString() });
    saveAndRefresh();
}

function saveAndRefresh() {
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    updateUI();
}

function updateUI() {
    document.getElementById('cart-count').innerText = basket.length;
    const itemsDiv = document.getElementById('cart-items');
    if (basket.length === 0) {
        itemsDiv.innerHTML = "<p>Sepetiniz boş.</p>";
    } else {
        itemsDiv.innerHTML = basket.map((i, idx) => `
            <div style="border-bottom:1px solid #ddd; padding:10px 0;">
                <strong>${i.urun}</strong> <button onclick="removeFromBasket(${idx})" style="color:red; float:right; border:none; background:none;">Sil</button><br>
                <small>Nakit: ${Number(i.nakit).toLocaleString('tr-TR')} ₺ | 4T: ${Number(i.awm).toLocaleString('tr-TR')} ₺</small>
            </div>
        `).join('');
    }
}

function removeFromBasket(index) {
    basket.splice(index, 1);
    if (basket.length === 0) localStorage.removeItem('basket_timestamp');
    saveAndRefresh();
}

function checkBasketExpiry() {
    const start = localStorage.getItem('basket_timestamp');
    if (start) {
        const diff = (Date.now() - start) / 1000 / 60;
        if (diff > 30) {
            basket = [];
            localStorage.removeItem('aygun_basket');
            localStorage.removeItem('basket_timestamp');
            updateUI();
            alert("Sepet süresi (30 dk) dolduğu için güvenlik gereği temizlendi.");
        }
    }
}

function toggleCart() {
    const m = document.getElementById('cart-modal');
    m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
}

function finalizeProposal() {
    const n = document.getElementById('cust-name').value;
    const p = document.getElementById('cust-phone').value;
    if (!n || !p || basket.length === 0) { alert("Lütfen müşteri bilgilerini doldurun ve sepete ürün ekleyin."); return; }

    let msg = `*AYGÜN AVM TEKLİF FORMU*\n*Müşteri:* ${n}\n*Tel:* ${p}\n\n`;
    basket.forEach((i, index) => {
        msg += `*${index+1}. ${i.urun}*\n`;
        msg += `- Nakit: ${Number(i.nakit).toLocaleString('tr-TR')} ₺\n`;
        msg += `- Tek Çekim: ${Number(i.tek).toLocaleString('tr-TR')} ₺\n`;
        msg += `- 4T AWM: ${Number(i.awm).toLocaleString('tr-TR')} ₺\n`;
        msg += `- Diğer Kart: ${Number(i.dk).toLocaleString('tr-TR')} ₺\n\n`;
    });
    
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
    basket = [];
    localStorage.removeItem('aygun_basket');
    localStorage.removeItem('basket_timestamp');
    updateUI();
    toggleCart();
}
