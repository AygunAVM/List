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
        alert("Bağlantı hatası: Kullanıcı listesi okunamadı.");
    }
}

// 2. VERİ YÜKLEME VE TEMİZLEME
async function loadData() {
    try {
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        allProducts = json.data || [];
        document.getElementById('v-tag').innerText = json.metadata?.v || "V6.0";
        renderBrands(allProducts);
        renderTable(allProducts);
        updateUI();
    } catch (err) {
        console.error("Veri yükleme hatası:", err);
    }
}

// Sayı temizleme yardımcısı (Fiyatlardaki nokta, virgül ve boşlukları yönetir)
function cleanPrice(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    // Sayı olmayan her şeyi temizle (virgülü noktaya çevir)
    let cleaned = String(val).replace(/\s/g, '').replace(',', '.');
    let num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

// 3. TABLO RENDER
function renderTable(data) {
    const list = document.getElementById('product-list');
    list.innerHTML = data.map(u => {
        // Fiyatları güvenli hale getir
        const dk = cleanPrice(u['Diğer Kartlar']);
        const awm = cleanPrice(u['4T AWM']);
        const tek = cleanPrice(u['Tek Çekim']);
        const nakit = cleanPrice(u.Nakit);
        const urunAdi = (u.Ürün || u.Model || 'Adsız Ürün').replace(/'/g, "\\'"); // Tırnak işareti hatasını önle

        return `
        <tr>
            <td><button class="add-btn" onclick="addToBasket('${u.Kod || ''}', '${urunAdi}', '${u.Stok || 0}', ${dk}, ${awm}, ${tek}, ${nakit}, '${(u.Açıklama || '').replace(/'/g, "\\'")}')">+</button></td>
            <td><small>${u.Kod || '-'}</small></td>
            <td><strong>${u.Ürün || u.Model || '-'}</strong></td>
            <td>${u['Ürün Gamı'] || '-'}</td>
            <td>${u.Marka || '-'}</td>
            <td>${u.Stok || '0'}</td>
            <td>${dk.toLocaleString('tr-TR')}</td>
            <td>${awm.toLocaleString('tr-TR')}</td>
            <td>${tek.toLocaleString('tr-TR')}</td>
            <td>${nakit.toLocaleString('tr-TR')}</td>
            <td><small>${u.Açıklama || '-'}</small></td>
        </tr>`;
    }).join('');
}

// 4. SEPET İŞLEMLERİ
function addToBasket(kod, urun, stok, dk, awm, tek, nakit, aciklama) {
    basket.push({ kod, urun, stok, dk, awm, tek, nakit, aciklama });
    saveAndRefresh();
}

function applyDiscount() {
    discountAmount = cleanPrice(document.getElementById('discount-input').value);
    discountType = document.getElementById('discount-type').value;
    updateUI();
}

function clearBasket() {
    if (confirm("Sepeti temizlemek istiyor musunuz?")) {
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
        itemsDiv.innerHTML = "<p style='padding:20px; color:#666;'>Sepetiniz şu an boş.</p>";
        return;
    }

    let subDK = 0, subAWM = 0, subTek = 0, subNakit = 0;
    let html = `<table class="cart-table"><thead><tr><th>Ürün</th><th>Stok</th><th>D.Kart</th><th>4T AWM</th><th>Tek Çekim</th><th>Nakit</th></tr></thead><tbody>`;

    basket.forEach(i => {
        subDK += i.dk; subAWM += i.awm; subTek += i.tek; subNakit += i.nakit;
        html += `<tr><td>${i.urun}</td><td>${i.stok}</td><td>${i.dk.toLocaleString('tr-TR')}</td><td>${i.awm.toLocaleString('tr-TR')}</td><td>${i.tek.toLocaleString('tr-TR')}</td><td>${i.nakit.toLocaleString('tr-TR')}</td></tr>`;
    });

    // İndirim Hesaplama
    let dDK = discountType === 'TRY' ? discountAmount : (subDK * discountAmount / 100);
    let dAWM = discountType === 'TRY' ? discountAmount : (subAWM * discountAmount / 100);
    let dTek = discountType === 'TRY' ? discountAmount : (subTek * discountAmount / 100);
    let dNakit = discountType === 'TRY' ? discountAmount : (subNakit * discountAmount / 100);

    html += `<tr class="subtotal-row"><td colspan="2" align="right">Ara Toplam:</td><td>${subDK.toLocaleString('tr-TR')}</td><td>${subAWM.toLocaleString('tr-TR')}</td><td>${subTek.toLocaleString('tr-TR')}</td><td>${subNakit.toLocaleString('tr-TR')}</td></tr>`;
    
    if (discountAmount > 0) {
        html += `<tr class="discount-row"><td colspan="2" align="right">İndirim (-):</td><td>-${dDK.toLocaleString('tr-TR')}</td><td>-${dAWM.toLocaleString('tr-TR')}</td><td>-${dTek.toLocaleString('tr-TR')}</td><td>-${dNakit.toLocaleString('tr-TR')}</td></tr>`;
    }

    html += `<tr class="total-row"><td colspan="2" align="right">GENEL TOPLAM:</td><td>${(subDK - dDK).toLocaleString('tr-TR')}</td><td>${(subAWM - dAWM).toLocaleString('tr-TR')}</td><td>${(subTek - dTek).toLocaleString('tr-TR')}</td><td>${(subNakit - dNakit).toLocaleString('tr-TR')}</td></tr></tbody></table>`;

    itemsDiv.innerHTML = html;
}

function finalizeProposal() {
    const n = document.getElementById('cust-name').value.trim();
    const p = document.getElementById('cust-phone').value.trim();
    if (!n || !p || basket.length === 0) { alert("Lütfen müşteri adı ve telefonunu girin!"); return; }

    let msg = `*AYGÜN AVM TEKLİF FORMU*\n*Müşteri:* ${n}\n*Tarih:* ${new Date().toLocaleDateString('tr-TR')}\n\n`;
    let sDK=0, sAWM=0, sTek=0, sNak=0;

    basket.forEach((i, idx) => {
        msg += `*${idx+1}. ${i.urun}* (${i.kod})\n`;
        sDK+=i.dk; sAWM+=i.awm; sTek+=i.tek; sNak+=i.nakit;
    });

    let dDK = discountType === 'TRY' ? discountAmount : (sDK * discountAmount / 100);
    let dAWM = discountType === 'TRY' ? discountAmount : (sAWM * discountAmount / 100);
    let dTek = discountType === 'TRY' ? discountAmount : (sTek * discountAmount / 100);
    let dNak = discountType === 'TRY' ? discountAmount : (sNak * discountAmount / 100);

    msg += `\n*TOPLAM TEKLİFİMİZ:*`;
    msg += `\n💰 Nakit: ${(sNak - dNak).toLocaleString('tr-TR')} TL`;
    msg += `\n💳 Tek Çekim: ${(sTek - dTek).toLocaleString('tr-TR')} TL`;
    msg += `\n🗓️ 4T AWM: ${(sAWM - dAWM).toLocaleString('tr-TR')} TL`;
    msg += `\n🃏 Diğer Kartlar: ${(sDK - dDK).toLocaleString('tr-TR')} TL`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
}

function toggleCart() {
    const m = document.getElementById('cart-modal');
    m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
}

function renderBrands(data) {
    const select = document.getElementById('brand-filter');
    const brands = [...new Set(data.map(u => u.Marka))].filter(x => x).sort();
    select.innerHTML = '<option value="">Tüm Markalar</option>' + brands.map(b => `<option value="${b}">${b}</option>`).join('');
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
