let allProducts = [];
let cart = [];

// GİRİŞ FONKSİYONU
function handleLogin() {
    const user = document.getElementById('username').value;
    if(user.length > 2) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('main-screen').classList.remove('hidden');
        loadData();
    } else {
        alert("Lütfen geçerli bir kullanıcı adı girin.");
    }
}

// VERİ YÜKLEME (Hata Kontrollü)
async function loadData() {
    try {
        // 'urunler.json' dosyasının index.html ile AYNI klasörde olduğunu varsayıyoruz
        const response = await fetch('urunler.json?v=' + Date.now());
        
        if (!response.ok) {
            throw new Error(`Dosya bulunamadı! Durum: ${response.status}`);
        }

        const json = await response.json();
        allProducts = json.data;
        document.getElementById('version-text').innerText = json.metadata.v;
        renderTable(allProducts);
    } catch (error) {
        console.error("Veri yükleme hatası:", error);
        alert("HATA: urunler.json dosyası yüklenemedi. Lütfen dosya adını ve yerini kontrol edin.");
    }
}

// GELİŞMİŞ ARAMA (Sams Buzd)
function handleSearch() {
    const query = document.getElementById('search').value.toLocaleLowerCase('tr-TR').trim().split(' ');
    const filtered = allProducts.filter(p => {
        const productData = `${p.Ürün} ${p.Marka} ${p.Kod} ${p.Açıklama}`.toLocaleLowerCase('tr-TR');
        return query.every(word => productData.includes(word));
    });
    renderTable(filtered);
}

// TABLOYU OLUŞTURMA
function renderTable(data) {
    const body = document.getElementById('product-body');
    body.innerHTML = data.map(p => `
        <tr>
            <td><strong>${p.Ürün}</strong></td>
            <td>${p.Stok}</td>
            <td>${p['Diğer Kartlar']}</td>
            <td>${p['4T AWM']}</td>
            <td>${p['Tek Çekim']}</td>
            <td>${p.Nakit}</td>
            <td style="font-size: 0.75rem; color: #666;">${p.Açıklama}</td>
            <td>${p.Kod}</td>
            <td>${p.Marka}</td>
            <td><button onclick="addToCart('${p.Kod}')" style="background:var(--success); color:white; border-radius:5px; padding:5px 10px;">+</button></td>
        </tr>
    `).join('');
}

// SEPET İŞLEMLERİ
function addToCart(kod) {
    const item = allProducts.find(p => p.Kod == kod);
    if(item) {
        cart.push({...item});
        updateCartUI();
    }
}

function updateCartUI() {
    const count = document.getElementById('cart-count');
    const itemsDiv = document.getElementById('cart-items');
    const discount = parseFloat(document.getElementById('global-discount').value) || 0;

    count.innerText = cart.length;
    
    itemsDiv.innerHTML = cart.map((p, index) => `
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid #eee; padding:10px 0;">
            <div>
                <strong>${p.Ürün}</strong><br>
                <small>${p.Nakit} TL ${discount > 0 ? '- '+discount : ''}</small>
            </div>
            <button onclick="removeFromCart(${index})" style="color:red; background:none;">❌</button>
        </div>
    `).join('');
}

function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartUI();
}

function toggleCart() {
    document.getElementById('cart-overlay').classList.toggle('hidden');
}

// WHATSAPP GÖNDERİMİ (Telefon Düzeltmeli)
function sendWhatsApp() {
    let phone = document.getElementById('cust-phone').value.replace(/\D/g, '');
    if(!phone) return alert("Lütfen telefon girin!");
    
    // Telefonu 905xx formatına çevir
    if(phone.startsWith('0')) phone = '9' + phone;
    if(phone.length === 10) phone = '90' + phone;

    let message = `*Aygün AVM Sipariş Formu*\n`;
    message += `*Müşteri:* ${document.getElementById('cust-name').value}\n`;
    message += `--------------------------\n`;
    
    const discount = parseFloat(document.getElementById('global-discount').value) || 0;
    
    cart.forEach(p => {
        const finalPrice = parseFloat(p.Nakit) - discount;
        message += `• ${p.Ürün} (${p.Kod}) - *${finalPrice} TL*\n`;
    });

    if(document.getElementById('cust-note').value) {
        message += `\n*Not:* ${document.getElementById('cust-note').value}`;
    }

    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
}
