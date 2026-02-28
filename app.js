let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0;
let discountType = 'TRY';
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;

// OTURUM SÜRESİ KONTROLÜ (30 DK)
window.onload = function() {
    const lastLogin = localStorage.getItem('aygun_last_login');
    const now = new Date().getTime();

    if (currentUser && lastLogin && (now - lastLogin < 30 * 60 * 1000)) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-content').style.display = 'block';
        loadData();
    }
};

async function checkAuth() {
    const u = document.getElementById('user-input').value.trim().toLowerCase();
    const p = document.getElementById('pass-input').value.trim();
    try {
        const res = await fetch('data/kullanicilar.json?t=' + Date.now());
        const users = await res.json();
        const user = users.find(x => x.Email.toLowerCase() === u && x.Sifre === p);
        if (user) {
            currentUser = user;
            localStorage.setItem('aygun_user', JSON.stringify(user));
            localStorage.setItem('aygun_last_login', new Date().getTime());
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-content').style.display = 'block';
            loadData();
        } else {
            document.getElementById('login-err').style.display = 'block';
        }
    } catch (e) {
        alert("Hata: Kullanıcı verisi yüklenemedi!");
    }
}

async function loadData() {
    try {
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        allProducts = json.data || [];
        renderTable(allProducts);
        updateUI();
    } catch (e) {
        alert("Ürün listesi yüklenemedi!");
    }
}

function cleanPrice(v) {
    if (!v) return 0;
    let c = String(v).replace(/\s/g, '').replace(/[.₺]/g, '').replace(',', '.');
    return isNaN(parseFloat(c)) ? 0 : parseFloat(c);
}

function filterData() {
    const val = document.getElementById('search').value.toLowerCase().trim();
    const keywords = val.split(" ").filter(k => k.length > 0);
    const filtered = allProducts.filter(u => {
        const rowText = Object.values(u).join(" ").toLowerCase();
        return keywords.every(kw => rowText.includes(kw));
    });
    renderTable(filtered);
}

function renderTable(data) {
    const list = document.getElementById('product-list');
    list.innerHTML = data.map(u => `
        <tr>
            <td><button class="add-btn" onclick="addToBasket(${allProducts.indexOf(u)})">+</button></td>
            <td><b>${u.Ürün || u.Model}</b></td>
            <td>${u['Ürün Gamı'] || '-'}</td>
            <td>${u.Marka || '-'}</td>
            <td>${u.Stok || 0}</td>
            <td>${cleanPrice(u['Diğer Kartlar']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u['4T AWM']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u['Tek Çekim']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u.Nakit).toLocaleString('tr-TR')}</td>
            <td><small>${u.Açıklama || '-'}</small></td>
            <td><small>${u.Kod || ''}</small></td>
        </tr>
    `).join('');
}

function addToBasket(idx) {
    const p = allProducts[idx];
    basket.push({
        urun: p.Ürün || p.Model,
        dk: cleanPrice(p['Diğer Kartlar']),
        awm: cleanPrice(p['4T AWM']),
        tek: cleanPrice(p['Tek Çekim']),
        nakit: cleanPrice(p.Nakit),
        aciklama: p.Açıklama || '-'
    });
    save();
}

function save() {
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    updateUI();
}

function removeFromBasket(index) {
    basket.splice(index, 1);
    save();
}

function applyDiscount() {
    discountAmount = parseFloat(document.getElementById('discount-input').value) || 0;
    discountType = document.getElementById('discount-type').value;
    updateUI();
}

function updateUI() {
    document.getElementById('cart-count').innerText = basket.length;
    const cont = document.getElementById('cart-items');
    if (basket.length === 0) { cont.innerHTML = "<p style='padding:40px; text-align:center; color:#999;'>Sepetiniz boş.</p>"; return; }

    let tDK=0, tAWM=0, tTek=0, tNak=0;
    let html = `<table style="width:100%; border-collapse:collapse; font-size:12px;"><thead><tr style="background:#f1f1f1;">
        <th style="padding:10px; text-align:left;">Ürün</th><th>D.Kart</th><th>4T AWM</th><th>TekÇekim</th><th>Nakit</th><th>✕</th></tr></thead><tbody>`;

    basket.forEach((i, idx) => {
        tDK+=i.dk; tAWM+=i.awm; tTek+=i.tek; tNak+=i.nakit;
        html += `<tr>
            <td style="padding:10px; border-bottom:1px solid #eee;"><b>${i.urun}</b><br><small style="color:#888">${i.aciklama}</small></td>
            <td style="text-align:center;">${i.dk.toLocaleString('tr-TR')}</td>
            <td style="text-align:center;">${i.awm.toLocaleString('tr-TR')}</td>
            <td style="text-align:center;">${i.tek.toLocaleString('tr-TR')}</td>
            <td style="text-align:center;">${i.nakit.toLocaleString('tr-TR')}</td>
            <td style="text-align:center;"><button onclick="removeFromBasket(${idx})" style="color:red; border:none; background:none; cursor:pointer; font-weight:bold;">✕</button></td>
        </tr>`;
    });

    const getD = (total) => discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);
    
    if (discountAmount > 0) {
        html += `<tr style="color:red; font-weight:bold; background:#fff5f5;"><td align="right" style="padding:10px;">İndirim:</td>
        <td align="center">-${getD(tDK).toLocaleString('tr-TR')}</td><td align="center">-${getD(tAWM).toLocaleString('tr-TR')}</td>
        <td align="center">-${getD(tTek).toLocaleString('tr-TR')}</td><td align="center">-${getD(tNak).toLocaleString('tr-TR')}</td><td></td></tr>`;
    }

    html += `<tr style="background:var(--primary); color:white; font-weight:bold;"><td align="right" style="padding:12px;">TOPLAM:</td>
        <td align="center">${(tDK - getD(tDK)).toLocaleString('tr-TR')}</td><td align="center">${(tAWM - getD(tAWM)).toLocaleString('tr-TR')}</td>
        <td align="center">${(tTek - getD(tTek)).toLocaleString('tr-TR')}</td><td align="center">${(tNak - getD(tNak)).toLocaleString('tr-TR')}</td><td></td></tr></tbody></table>`;
    
    cont.innerHTML = html;
}

function toggleCart() {
    const m = document.getElementById('cart-modal');
    m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
}

function clearBasket() {
    if(confirm("Tüm sepeti temizlemek istediğinize emin misiniz?")) {
        basket = [];
        discountAmount = 0;
        document.getElementById('discount-input').value = "";
        save();
    }
}

function finalizeProposal() {
    const name = document.getElementById('cust-name').value.trim();
    const phone = document.getElementById('cust-phone').value.trim();
    const validity = document.getElementById('validity-date').value.trim();
    const extra = document.getElementById('extra-info').value.trim();
    
    if (!/^0\d{10}$/.test(phone)) { alert("Lütfen 0 ile başlayan 11 haneli telefon numarası girin."); return; }
    if (!name || basket.length === 0) { alert("Müşteri adı ve en az bir ürün gereklidir!"); return; }

    let msg = `*AYGÜN AVM TEKLİF*\n`;
    msg += `*Müşteri:* ${name}\n`;
    msg += `*Telefon:* ${phone}\n`;
    msg += `*Teklif Veren:* ${currentUser?.Email || 'Aygün AVM Satış'}\n`;
    if(validity) msg += `*Teklif Geçerlilik:* ${validity}\n`;
    msg += `\n*Ürünler:*\n`;

    basket.forEach(i => { msg += `• ${i.urun}\n`; });
    msg += `\n*Fiyatlandırma:*\n`;

    const getD = (total) => discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);
    const selectedPrices = Array.from(document.querySelectorAll('.price-toggle:checked')).map(cb => cb.value);
    
    const totalNakit = basket.reduce((a,b)=>a+b.nakit,0);
    const totalTek = basket.reduce((a,b)=>a+b.tek,0);
    const totalAWM = basket.reduce((a,b)=>a+b.awm,0);
    const totalDK = basket.reduce((a,b)=>a+b.dk,0);

    selectedPrices.forEach(type => {
        if(type === 'nakit') msg += `Nakit: ${(totalNakit - getD(totalNakit)).toLocaleString('tr-TR')} ₺\n`;
        if(type === 'tek')   msg += `Tek Çekim: ${(totalTek - getD(totalTek)).toLocaleString('tr-TR')} ₺\n`;
        if(type === 'awm')   msg += `4T AWM: ${(totalAWM - getD(totalAWM)).toLocaleString('tr-TR')} ₺\n`;
        if(type === 'dk')    msg += `D. Kart: ${(totalDK - getD(totalDK)).toLocaleString('tr-TR')} ₺\n`;
    });

    if (discountAmount > 0) {
        let det = discountType === 'TRY' ? `${discountAmount} ₺` : `%${discountAmount}`;
        msg += `\n_(Bu teklife ${det} indirim uygulanmıştır.)_`;
    }

    if(extra) msg += `\n\n> ${extra}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
}
