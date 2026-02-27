let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0; 
let discountType = 'TRY'; // 'TRY' veya 'PERCENT'

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
        } else { errText.style.display = 'block'; }
    } catch (e) { alert("Bağlantı hatası!"); }
}

// 2. VERİ YÜKLEME
async function loadData() {
    try {
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        allProducts = json.data || [];
        document.getElementById('v-tag').innerText = json.metadata?.v || "V5";
        renderBrands(allProducts);
        renderTable(allProducts);
        updateUI();
    } catch (err) { console.error(err); }
}

// 3. TABLO RENDER
function renderTable(data) {
    const list = document.getElementById('product-list');
    list.innerHTML = data.map(u => `
        <tr>
            <td><button class="add-btn" onclick="addToBasket('${u.Kod || ''}', '${u.Ürün || u.Model}', '${u.Stok || 0}', ${u['Diğer Kartlar'] || 0}, ${u['4T AWM'] || 0}, ${u['Tek Çekim'] || 0}, ${u.Nakit || 0}, '${u.Açıklama || '-'}')">+</button></td>
            <td><small>${u.Kod || '-'}</small></td>
            <td>${u.Ürün || u.Model || '-'}</td>
            <td>${u['Ürün Gamı'] || '-'}</td>
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

// 4. SEPET VE İNDİRİM MANTIĞI
function addToBasket(kod, urun, stok, dk, awm, tek, nakit, aciklama) {
    basket.push({ kod, urun, stok, dk, awm, tek, nakit, aciklama });
    saveAndRefresh();
}

function applyDiscount() {
    discountAmount = Number(document.getElementById('discount-input').value) || 0;
    discountType = document.getElementById('discount-type').value;
    updateUI();
}

function clearBasket() {
    if(confirm("Sepeti temizle?")) {
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
    if (basket.length === 0) { itemsDiv.innerHTML = "<p>Sepet boş.</p>"; return; }

    let subDK = 0, subAWM = 0, subTek = 0, subNakit = 0;
    let html = `<table class="cart-table"><thead><tr><th>Kod</th><th>Ürün</th><th>Stok</th><th>D.Kart</th><th>4T AWM</th><th>Tek Çekim</th><th>Nakit</th><th>Açıklama</th></tr></thead><tbody>`;

    basket.forEach(i => {
        subDK += Number(i.dk); subAWM += Number(i.awm); subTek += Number(i.tek); subNakit += Number(i.nakit);
        html += `<tr><td><small>${i.kod}</small></td><td>${i.urun}</td><td>${i.stok}</td><td>${Number(i.dk).toLocaleString('tr-TR')}</td><td>${Number(i.awm).toLocaleString('tr-TR')}</td><td>${Number(i.tek).toLocaleString('tr-TR')}</td><td>${Number(i.nakit).toLocaleString('tr-TR')}</td><td><small>${i.aciklama}</small></td></tr>`;
    });

    // İndirim Hesaplama
    let discDK = discountType === 'TRY' ? discountAmount : (subDK * discountAmount / 100);
    let discAWM = discountType === 'TRY' ? discountAmount : (subAWM * discountAmount / 100);
    let discTek = discountType === 'TRY' ? discountAmount : (subTek * discountAmount / 100);
    let discNakit = discountType === 'TRY' ? discountAmount : (subNakit * discountAmount / 100);

    // Ara Toplam
    html += `<tr class="subtotal-row"><td colspan="3" align="right">Ara Toplam:</td><td>${subDK.toLocaleString('tr-TR')}</td><td>${subAWM.toLocaleString('tr-TR')}</td><td>${subTek.toLocaleString('tr-TR')}</td><td>${subNakit.toLocaleString('tr-TR')}</td><td></td></tr>`;

    // İndirim Satırı (Kırmızı)
    if (discountAmount > 0) {
        html += `<tr class="discount-row" style="color:red; font-style:italic;"><td colspan="3" align="right">İndirim (-):</td><td>-${discDK.toLocaleString('tr-TR')}</td><td>-${discAWM.toLocaleString('tr-TR')}</td><td>-${discTek.toLocaleString('tr-TR')}</td><td>-${discNakit.toLocaleString('tr-TR')}</td><td></td></tr>`;
    }

    // Genel Toplam
    html += `<tr class="total-row" style="background:#eee; font-weight:bold;"><td colspan="3" align="right">GENEL TOPLAM:</td><td>${(subDK - discDK).toLocaleString('tr-TR')}</td><td>${(subAWM - discAWM).toLocaleString('tr-TR')}</td><td>${(subTek - discTek).toLocaleString('tr-TR')}</td><td>${(subNakit - discNakit).toLocaleString('tr-TR')}</td><td></td></tr></tbody></table>`;

    itemsDiv.innerHTML = html;
}

function finalizeProposal() {
    const n = document.getElementById('cust-name').value;
    const p = document.getElementById('cust-phone').value;
    if (!n || !p || basket.length === 0) { alert("Bilgileri girin!"); return; }

    let msg = `*AYGÜN AVM TEKLİF*\n*Müşteri:* ${n}\n\n`;
    let subDK = 0, subAWM = 0, subTek = 0, subNakit = 0;
    
    basket.forEach((i, idx) => {
        msg += `*${idx+1}. ${i.urun}* (${i.kod})\n`;
        subDK += Number(i.dk); subAWM += Number(i.awm); subTek += Number(i.tek); subNakit += Number(i.nakit);
    });

    let discDK = discountType === 'TRY' ? discountAmount : (subDK * discountAmount / 100);
    let discAWM = discountType === 'TRY' ? discountAmount : (subAWM * discountAmount / 100);
    let discTek = discountType === 'TRY' ? discountAmount : (subTek * discountAmount / 100);
    let discNakit = discountType === 'TRY' ? discountAmount : (subNakit * discountAmount / 100);

    msg += `\n*TOPLAM TEKLİF:*`;
    msg += `\n- D.Kart: ${(subDK - discDK).toLocaleString('tr-TR')} ₺`;
    msg += `\n- 4T AWM: ${(subAWM - discAWM).toLocaleString('tr-TR')} ₺`;
    msg += `\n- Tek Çekim: ${(subTek - discTek).toLocaleString('tr-TR')} ₺`;
    msg += `\n- Nakit: ${(subNakit - discNakit).toLocaleString('tr-TR')} ₺`;
    if(discountAmount > 0) msg += `\n\n_(İndirim uygulanmıştır)_`;

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
        const brandMatch = !brand || u.Marka === brand;
        return matchText && brandMatch;
    });
    renderTable(filtered);
}
