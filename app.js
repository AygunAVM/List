// Global Değişkenler
let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];

// 1. Başlatıcı: Sayfa yüklendiğinde çalışır
window.onload = () => {
    checkBasketExpiry(); // Önce süreyi kontrol et
    loadData();          // Verileri çek
    updateUI();          // Arayüzü güncelle
};

// 2. Veri Yükleme: GitHub'daki JSON dosyasını okur
async function loadData() {
    try {
        // Cache (önbellek) sorununu önlemek için zaman damgası ekliyoruz
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        
        allProducts = json.data || [];
        
        // Versiyon bilgisini sol üst köşeye yazdırır
        document.getElementById('v-tag').innerText = json.metadata?.v || "V2.0";

        renderBrands(allProducts);
        renderTable(allProducts);
    } catch (err) {
        console.error("Veri yükleme hatası:", err);
        document.getElementById('product-list').innerHTML = "<tr><td colspan='4'>Veri yüklenemedi!</td></tr>";
    }
}

// 3. Tabloyu Oluşturma
function renderTable(data) {
    const list = document.getElementById('product-list');
    if (data.length === 0) {
        list.innerHTML = "<tr><td colspan='4' style='text-align:center'>Ürün bulunamadı.</td></tr>";
        return;
    }

    list.innerHTML = data.map(u => `
        <tr>
            <td>
                <strong>${u.Model || u.Ürün}</strong><br>
                <small style="color:#666">${u.Kategori || ''}</small>
            </td>
            <td>${u.Marka || '-'}</td>
            <td><strong>${Number(u.Nakit).toLocaleString('tr-TR')} ₺</strong></td>
            <td>
                <button class="add-btn" onclick="addToBasket('${u.Model || u.Ürün}', ${u.Nakit})">
                    Ekle
                </button>
            </td>
        </tr>
    `).join('');
}

// 4. Marka Filtresini Doldurma
function renderBrands(data) {
    const select = document.getElementById('brand-filter');
    const brands = [...new Set(data.map(u => u.Marka))].filter(x => x).sort();
    
    brands.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b;
        opt.textContent = b;
        select.appendChild(opt);
    });
}

// 5. Arama ve Filtreleme
function filterData() {
    const searchTerm = document.getElementById('search').value.toLowerCase();
    const selectedBrand = document.getElementById('brand-filter').value;

    const filtered = allProducts.filter(u => {
        const textMatch = Object.values(u).join(" ").toLowerCase().includes(searchTerm);
        const brandMatch = !selectedBrand || u.Marka === selectedBrand;
        return textMatch && brandMatch;
    });

    renderTable(filtered);
}

// 6. Sepet Mantığı
function addToBasket(name, price) {
    // Eğer sepet boşsa, silinme süresini (30 dk) şimdi başlat
    if (basket.length === 0) {
        localStorage.setItem('basket_timestamp', Date.now());
    }
    
    // Ürünü ekle (Hata payını azaltmak için fiyatı o anki haliyle dondurur)
    basket.push({ 
        name, 
        price, 
        id: Date.now() 
    });
    
    saveAndRefresh();
}

// 7. 30 Dakika Kontrolü (Hata Riskini Engelleme)
function checkBasketExpiry() {
    const startTime = localStorage.getItem('basket_timestamp');
    if (startTime) {
        const now = Date.now();
        const diffInMinutes = (now - startTime) / (1000 * 60);

        if (diffInMinutes > 30) {
            clearBasket();
            alert("GÜVENLİK UYARISI: Sepet 30 dakikadır işlem görmediği için hatalı fiyat riskine karşı temizlendi.");
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

// 8. Arayüz Güncelleme
function updateUI() {
    // Sepet ikonundaki sayıyı güncelle
    document.getElementById('cart-count').innerText = basket.length;
    
    // Modal içindeki ürün listesini güncelle
    const cartItems = document.getElementById('cart-items');
    if (basket.length === 0) {
        cartItems.innerHTML = "<p style='color:#999'>Sepetiniz şu an boş.</p>";
    } else {
        let total = 0;
        let html = basket.map((item, index) => {
            total += item.price;
            return `
                <div style="display:flex; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:5px;">
                    <span>${item.name}</span>
                    <span><strong>${item.price.toLocaleString('tr-TR')} ₺</strong></span>
                </div>
            `;
        }).join('');
        
        html += `<div style="text-align:right; margin-top:10px; font-weight:bold; font-size:18px;">
                    Toplam: ${total.toLocaleString('tr-TR')} ₺
                 </div>`;
        cartItems.innerHTML = html;
    }
}

// 9. Modalı Aç/Kapat
function toggleCart() {
    const modal = document.getElementById('cart-modal');
    const isOpening = (modal.style.display !== 'flex');
    
    modal.style.display = isOpening ? 'flex' : 'none';
    
    if (isOpening) checkBasketExpiry();
}

// 10. Teklifi Finalize Etme (WhatsApp Entegrasyonu)
function finalizeProposal() {
    const name = document.getElementById('cust-name').value.trim();
    const phone = document.getElementById('cust-phone').value.trim();

    if (basket.length === 0) {
        alert("Hata: Sepetiniz boş!");
        return;
    }

    if (!name || !phone) {
        alert("Hata: Müşteri Adı ve Telefonu girilmeden teklif oluşturulamaz!");
        return;
    }

    // Metin Oluşturma
    let message = `*AYGÜN AVM TEKLİF FORMU*\n`;
    message += `----------------------------\n`;
    message += `*Müşteri:* ${name}\n`;
    message += `*Telefon:* ${phone}\n`;
    message += `*Tarih:* ${new Date().toLocaleString('tr-TR')}\n\n`;
    message += `*Ürünler:*\n`;

    let total = 0;
    basket.forEach((item, i) => {
        message += `${i+1}. ${item.name} - ${item.price.toLocaleString('tr-TR')} ₺\n`;
        total += item.price;
    });

    message += `\n*GENEL TOPLAM: ${total.toLocaleString('tr-TR')} ₺*\n`;
    message += `----------------------------\n`;
    message += `_Bu teklif 24 saat geçerlidir._`;

    // WhatsApp'a Gönder
    const encodedMsg = encodeURIComponent(message);
    window.open(`https://wa.me/?text=${encodedMsg}`);
    
    // İşlem başarılı, sepeti temizle
    clearBasket();
    toggleCart();
    
    // Formu sıfırla
    document.getElementById('cust-name').value = "";
    document.getElementById('cust-phone').value = "";
}
