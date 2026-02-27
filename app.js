let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0; 
let discountType = 'TRY'; 

// 1. GİRİŞ KONTROLÜ
async function checkAuth() {
    const userInp = document.getElementById('user-input').value.trim().toLowerCase();
    const passInp = document.getElementById('pass-input').value.trim();
    const errText = document.getElementById('login-err');

    try {
        const res = await fetch('data/kullanicilar.json?t=' + Date.now());
        const users = await res.json();
        const user = users.find(u => String(u.Email).toLowerCase() === userInp && String(u.Sifre) === passInp);

        if (user) {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-content').style.display = 'block';
            loadData();
        } else {
            errText.style.display = 'block';
        }
    } catch (e) {
        alert("Bağlantı hatası: Kullanıcı listesi alınamadı.");
    }
}

// 2. VERİ YÜKLEME
async function loadData() {
    try {
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        allProducts = json.data || [];
        document.getElementById('v-tag').innerText = json.metadata?.v || "V5.1";
        renderBrands(allProducts);
        renderTable(allProducts);
        updateUI();
    } catch (err) {
        console.error("Yükleme hatası:", err);
    }
}

// 3. TABLO RENDER (Özel karakter hatası giderildi)
function renderTable(data) {
    const list = document.getElementById('product-list');
    list.innerHTML = data.map((u, index) => {
        // Özel karakterleri (tırnak vb.) temizliyoruz veya JSON string olarak güvenli hale getiriyoruz
        const safeUrun = (u.Ürün || u.Model || '').replace(/'/g, "\\'");
        const safeAciklama = (u.Açıklama || '-').replace(/'/g, "\\'");
        
        return `
        <tr>
            <td>
                <button class="add-btn" onclick="addToBasketByIndex(${index})">+</button>
            </td>
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
    `}).join('');
}

// 4. GÜVENLİ SEPETE EKLEME (Index tabanlı)
function addToBasketByIndex(index) {
    const u = allProducts[index];
    if(!u) return;

    basket.push({
        kod: u.Kod || '',
        urun: u.Ürün || u.Model || 'Adsız Ürün',
        stok: u.Stok || 0,
        dk: u['Diğer Kartlar'] || 0,
        awm: u['4T AWM'] || 0,
        tek: u['Tek Çekim'] || 0,
        nakit: u.Nakit || 0,
        aciklama: u.Açıklama || '-'
    });
    
    saveAndRefresh();
    // Küçük bir görsel bildirim
    const btn = event.target;
    const originalText = btn.innerText;
    btn.innerText = "✅";
    setTimeout(() => btn.innerText = originalText, 800);
}

// 5. İNDİRİM VE UI GÜNCELLEME
function applyDiscount() {
    discountAmount = Number(document.getElementById('discount-input').value) || 0;
    discountType = document.getElementById('discount-type').value;
    updateUI();
}

function clearBasket() {
    if(confirm("Sepeti temizlemek istiyor musunuz?")) {
        basket = [];
        discountAmount = 0;
        localStorage.removeItem('aygun_basket');
        saveAndRefresh();
    }
}

function saveAndRefresh() {
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    updateUI();
}

function updateUI() {
    document.getElementById('cart-count').innerText = basket.length;
    const itemsDiv = document.getElementById('cart-items');
    
    if (basket.length === 0) {
        itemsDiv.innerHTML = "<p style='padding:20px; text-align:center;'>Sepetiniz şu an boş.</p>";
        return;
    }

    let subDK = 0, subAWM = 0, subTek = 0, subNakit = 0;
    let html = `<table class="cart-table">
        <thead>
            <tr>
                <th>Ürün</th>
                <th>D.Kart</th>
                <th>4T AWM</th>
                <th>Tek Çekim</th>
                <th>Nakit</th>
                <th>İşlem</th>
            </tr>
        </thead>
        <tbody>`;

    basket.forEach((i
