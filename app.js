let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];

// 1. GİRİŞ KONTROLÜ (Email ve Sifre sütunlarına göre)
async function checkAuth() {
    const userInp = document.getElementById('user-input').value.trim().toLowerCase();
    const passInp = document.getElementById('pass-input').value.trim();
    const errText = document.getElementById('login-err');

    try {
        const res = await fetch('data/kullanicilar.json?t=' + Date.now());
        if (!res.ok) throw new Error("Kullanıcı dosyası bulunamadı");
        const users = await res.json();
        
        // JSON yapındaki "Email" ve "Sifre" alanlarını kontrol ediyoruz
        const user = users.find(u => 
            String(u.Email).toLowerCase() === userInp && 
            String(u.Sifre) === passInp
        );

        if (user) {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-content').style.display = 'block';
            loadData();
        } else {
            errText.style.display = 'block';
            errText.innerText = "Hatalı Email veya Şifre!";
        }
    } catch (e) {
        console.error("Giriş hatası:", e);
        alert("Bağlantı hatası: data/kullanicilar.json dosyasına erişilemiyor.");
    }
}

// 2. ÜRÜN VERİLERİNİ YÜKLEME
async function loadData() {
    try {
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        
        allProducts = json.data || [];
        document.getElementById('v-tag').innerText = json.metadata?.v || "V2.3";

        renderBrands(allProducts);
        renderTable(allProducts);
        updateUI();
    } catch (err) {
        console.error("Veri yükleme hatası:", err);
        document.getElementById('product-list').innerHTML = "<tr><td colspan='11'>Veriler yüklenemedi.</td></tr>";
    }
}

// 3. TABLO OLUŞTURMA (Sütunlar: Kod, Ürün, Ürün Gamı, Marka, Stok, Diğer Kartlar, 4T AWM, Tek Çekim, Nakit, Açıklama)
function renderTable(data) {
    const list = document.getElementById('product-list');
    list.innerHTML = data.map(u => `
        <tr>
            <td><button class="add-btn" onclick="addToBasket('${u.Kod || ''}', '${u.Ürün || u.Model || 'Adsız'}', ${u['Diğer Kartlar'] || 0}, ${u['4T AWM'] || 0}, ${u['Tek Çekim'] || 0}, ${u.Nakit || 0})">+</button></td>
            <td><small>${u.Kod || '-'}</small></td>
            <td><strong>${u.Ürün || u.Model || '-'}</strong></td>
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

// 4. SEPET SİSTEMİ
function addToBasket(kod, urun, dk, awm, tek, nakit) {
    if (basket.length === 0) localStorage.setItem('basket_timestamp', Date.now());
    basket.push({ kod, urun, dk, awm, tek, nakit });
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
        itemsDiv.innerHTML = "<p style='color:#999'>Sepetiniz boş.</p>";
    } else {
        itemsDiv.innerHTML = basket.map((i, idx) => `
            <div style="border-bottom:1px solid #eee; padding:8px 0;">
                <strong>${i.urun}</strong> 
                <button onclick="removeFromBasket(${idx})" style="color:red; float:right; border:none; background:none; cursor:pointer;">✕</button><br>
                <small>Nakit: ${Number(i.nakit).toLocaleString('tr-TR')} ₺ | 4T: ${Number(i.awm).toLocaleString('tr-TR')} ₺</small>
            </div>
        `).join('');
    }
}

function removeFromBasket(index) {
    basket.splice(index, 1);
    saveAndRefresh();
}

function toggleCart() {
    const m = document.getElementById('cart-modal');
    m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
}

function finalizeProposal() {
    const n = document.getElementById('cust-name').value.trim();
    const p = document.getElementById('cust-phone').value.trim();
    if (!n || !p || basket.length === 0) { alert("Müşteri bilgilerini girin!"); return; }

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
