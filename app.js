let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0;
let discountType = 'TRY';

// GİRİŞ KONTROLÜ
async function checkAuth() {
    const u = document.getElementById('user-input').value.trim().toLowerCase();
    const p = document.getElementById('pass-input').value.trim();
    try {
        const res = await fetch('data/kullanicilar.json?t=' + Date.now());
        const users = await res.json();
        const user = users.find(x => x.Email.toLowerCase() === u && x.Sifre === p);
        if (user) {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-content').style.display = 'block';
            loadData();
        } else { document.getElementById('login-err').style.display = 'block'; }
    } catch (e) { alert("Veri hatası!"); }
}

async function loadData() {
    const res = await fetch('data/urunler.json?v=' + Date.now());
    const json = await res.json();
    allProducts = json.data || [];
    renderBrands(allProducts);
    renderTable(allProducts);
    updateUI();
}

function cleanPrice(v) {
    if (!v) return 0;
    let c = String(v).replace(/\s/g, '').replace(',', '.');
    return isNaN(parseFloat(c)) ? 0 : parseFloat(c);
}

// ANA TABLO RENDER
function renderTable(data) {
    const list = document.getElementById('product-list');
    list.innerHTML = data.map((u, idx) => `
        <tr>
            <td><button class="add-btn" onclick="addToBasket(${allProducts.indexOf(u)})">+</button></td>
            <td><small>${u.Kod || ''}</small></td>
            <td><b>${u.Ürün || u.Model}</b></td>
            <td>${u.Stok || 0}</td>
            <td>${cleanPrice(u['Diğer Kartlar']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u['4T AWM']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u.Nakit).toLocaleString('tr-TR')}</td>
        </tr>
    `).join('');
}

function addToBasket(index) {
    const p = allProducts[index];
    basket.push({
        kod: p.Kod,
        urun: p.Ürün || p.Model,
        stok: p.Stok,
        dk: cleanPrice(p['Diğer Kartlar']),
        awm: cleanPrice(p['4T AWM']),
        tek: cleanPrice(p['Tek Çekim']),
        nakit: cleanPrice(p.Nakit),
        aciklama: p.Açıklama || '-'
    });
    save();
}

// SEPETTEN ÜRÜN SİLME
function removeFromBasket(index) {
    basket.splice(index, 1);
    save();
}

function save() {
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    updateUI();
}

function applyDiscount() {
    discountAmount = parseFloat(document.getElementById('discount-input').value) || 0;
    discountType = document.getElementById('discount-type').value;
    updateUI();
}

// SEPET GÖRÜNÜMÜ (Açıklama Geri Geldi + Silme Butonu Eklendi)
function updateUI() {
    document.getElementById('cart-count').innerText = basket.length;
    const cont = document.getElementById('cart-items');
    if (basket.length === 0) { cont.innerHTML = "Sepet boş."; return; }

    let sDK=0, sAWM=0, sNak=0;
    let html = `<table class="cart-table"><thead><tr><th>Ürün</th><th>Açıklama</th><th>Nakit</th><th>Sil</th></tr></thead><tbody>`;

    basket.forEach((i, idx) => {
        sDK+=i.dk; sAWM+=i.awm; sNak+=i.nakit;
        html += `
            <tr>
                <td><b>${i.urun}</b></td>
                <td><small>${i.aciklama}</small></td>
                <td>${i.nakit.toLocaleString('tr-TR')}</td>
                <td><button class="remove-item" onclick="removeFromBasket(${idx})">🗑️</button></td>
            </tr>`;
    });

    let dNak = discountType === 'TRY' ? discountAmount : (sNak * discountAmount / 100);
    
    html += `
        <tr style="color:red; font-weight:bold;">
            <td colspan="2" align="right">Toplam (İndirimli):</td>
            <td>${(sNak - dNak).toLocaleString('tr-TR')} ₺</td>
            <td></td>
        </tr></tbody></table>`;
    
    cont.innerHTML = html;
}

function toggleCart() {
    const m = document.getElementById('cart-modal');
    m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
}

function clearBasket() {
    if(confirm("Sepeti temizle?")) { basket=[]; discountAmount=0; save(); }
}

function renderBrands(data) {
    const sel = document.getElementById('brand-filter');
    const b = [...new Set(data.map(x => x.Marka))].filter(x => x).sort();
    sel.innerHTML = '<option value="">Markalar</option>' + b.map(x => `<option value="${x}">${x}</option>`).join('');
}

function filterData() {
    const term = document.getElementById('search').value.toLowerCase();
    const br = document.getElementById('brand-filter').value;
    const f = allProducts.filter(u => {
        const m1 = Object.values(u).join(" ").toLowerCase().includes(term);
        const m2 = !br || u.Marka === br;
        return m1 && m2;
    });
    renderTable(f);
}

function finalizeProposal() {
    const n = document.getElementById('cust-name').value;
    if(!n || basket.length === 0) { alert("Bilgileri doldurun!"); return; }
    let msg = `*AYGÜN AVM TEKLİF*\n*Müşteri:* ${n}\n\n`;
    let sNak=0;
    basket.forEach(i => {
        msg += `• ${i.urun}\n  _Nakit: ${i.nakit.toLocaleString('tr-TR')} ₺_\n`;
        sNak += i.nakit;
    });
    let d = discountType === 'TRY' ? discountAmount : (sNak * discountAmount / 100);
    msg += `\n*GENEL TOPLAM: ${(sNak - d).toLocaleString('tr-TR')} ₺*`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
}
