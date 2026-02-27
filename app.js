let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0;
let discountType = 'TRY';

function generateVersion(metaV) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('tr-TR').replace(/\./g, '/');
    const timeStr = now.getHours() + ":" + (now.getMinutes()<10?'0':'') + now.getMinutes();
    document.getElementById('v-tag').innerText = `${metaV || 'v1'} ${dateStr} ${timeStr}`;
}

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
    } catch (e) { alert("Bağlantı hatası!"); }
}

async function loadData() {
    const res = await fetch('data/urunler.json?v=' + Date.now());
    const json = await res.json();
    allProducts = json.data || [];
    generateVersion(json.metadata?.v);
    renderBrands(allProducts);
    renderTable(allProducts);
    updateUI();
}

function cleanPrice(v) {
    if (!v) return 0;
    let c = String(v).replace(/\s/g, '').replace(',', '.');
    return isNaN(parseFloat(c)) ? 0 : parseFloat(c);
}

// ANA EKRAN TABLOSU
function renderTable(data) {
    const list = document.getElementById('product-list');
    list.innerHTML = data.map(u => `
        <tr>
            <td><button class="add-btn" onclick="addToBasket(${allProducts.indexOf(u)})">+</button></td>
            <td><small>${u.Kod || ''}</small></td>
            <td><b>${u.Ürün || u.Model}</b></td>
            <td>${cleanPrice(u['Diğer Kartlar']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u['4T AWM']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u['Tek Çekim']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u.Nakit).toLocaleString('tr-TR')}</td>
            <td><small>${u.Açıklama || '-'}</small></td>
        </tr>
    `).join('');
}

function addToBasket(idx) {
    const p = allProducts[idx];
    basket.push({
        kod: p.Kod,
        urun: p.Ürün || p.Model,
        dk: cleanPrice(p['Diğer Kartlar']),
        awm: cleanPrice(p['4T AWM']),
        tek: cleanPrice(p['Tek Çekim']),
        nakit: cleanPrice(p.Nakit),
        aciklama: p.Açıklama || '-'
    });
    save();
}

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

// SEPET GÜNCELLEME (İndirim yoksa satırı gizler)
function updateUI() {
    document.getElementById('cart-count').innerText = basket.length;
    const cont = document.getElementById('cart-items');
    if (basket.length === 0) { cont.innerHTML = "<p style='text-align:center; padding:20px;'>Sepet boş.</p>"; return; }

    let tDK=0, tAWM=0, tTek=0, tNak=0;
    let html = `<table class="cart-table">
        <thead><tr><th>Ürün</th><th>D.Kart</th><th>4T AWM</th><th>TekÇekim</th><th>Nakit</th><th></th></tr></thead><tbody>`;

    basket.forEach((i, idx) => {
        tDK+=i.dk; tAWM+=i.awm; tTek+=i.tek; tNak+=i.nakit;
        html += `<tr>
            <td><small><b>${i.urun}</b><br>${i.aciklama}</small></td>
            <td>${i.dk.toLocaleString('tr-TR')}</td>
            <td>${i.awm.toLocaleString('tr-TR')}</td>
            <td>${i.tek.toLocaleString('tr-TR')}</td>
            <td>${i.nakit.toLocaleString('tr-TR')}</td>
            <td><button onclick="removeFromBasket(${idx})" style="border:none; background:none; color:red; font-size:16px;">✕</button></td>
        </tr>`;
    });

    const getD = (total) => discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);

    // Ara Toplam Satırı
    html += `<tr class="ara-toplam"><td align="right">Ara Toplam:</td>
        <td>${tDK.toLocaleString('tr-TR')}</td><td>${tAWM.toLocaleString('tr-TR')}</td>
        <td>${tTek.toLocaleString('tr-TR')}</td><td>${tNak.toLocaleString('tr-TR')}</td><td></td></tr>`;

    // İNDİRİM SATIRI (Sadece indirim varsa gösterilir)
    if (discountAmount > 0) {
        html += `<tr class="indirim-satiri"><td align="right">İndirim (-):</td>
            <td>-${getD(tDK).toLocaleString('tr-TR')}</td><td>-${getD(tAWM).toLocaleString('tr-TR')}</td>
            <td>-${getD(tTek).toLocaleString('tr-TR')}</td><td>-${getD(tNak).toLocaleString('tr-TR')}</td><td></td></tr>`;
    }

    // Genel Toplam Satırı
    html += `<tr class="genel-toplam"><td align="right">NET TOPLAM:</td>
        <td>${(tDK - getD(tDK)).toLocaleString('tr-TR')}</td><td>${(tAWM - getD(tAWM)).toLocaleString('tr-TR')}</td>
        <td>${(tTek - getD(tTek)).toLocaleString('tr-TR')}</td><td>${(tNak - getD(tNak)).toLocaleString('tr-TR')}</td><td></td></tr>`;
    
    html += `</tbody></table>`;
    cont.innerHTML = html;
}

function toggleCart() {
    const m = document.getElementById('cart-modal');
    m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
}

function clearBasket() {
    if(confirm("Sepeti boşalt?")) { basket=[]; discountAmount=0; document.getElementById('discount-input').value=""; save(); }
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

function renderBrands(data) {
    const sel = document.getElementById('brand-filter');
    const b = [...new Set(data.map(x => x.Marka))].filter(x => x).sort();
    sel.innerHTML = '<option value="">Markalar</option>' + b.map(x => `<option value="${x}">${x}</option>`).join('');
}

function finalizeProposal() {
    const n = document.getElementById('cust-name').value;
    if(!n || basket.length === 0) { alert("Bilgileri girin!"); return; }
    let msg = `*AYGÜN AVM TEKLİF*\n*Müşteri:* ${n}\n\n`;
    let tDK=0, tAWM=0, tTek=0, tNak=0;
    basket.forEach(i => { msg += `• ${i.urun}\n`; tDK+=i.dk; tAWM+=i.awm; tTek+=i.tek; tNak+=i.nakit; });
    const getD = (total) => discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);
    msg += `\n*NET TOPLAM TEKLİF*`;
    msg += `\n💰 Nakit: ${(tNak - getD(tNak)).toLocaleString('tr-TR')} ₺`;
    msg += `\n💳 Tek Çekim: ${(tTek - getD(tTek)).toLocaleString('tr-TR')} ₺`;
    msg += `\n🗓️ 4T AWM: ${(tAWM - getD(tAWM)).toLocaleString('tr-TR')} ₺`;
    msg += `\n🃏 D. Kart: ${(tDK - getD(tDK)).toLocaleString('tr-TR')} ₺`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
}
