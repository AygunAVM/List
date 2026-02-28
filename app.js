let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0;
let discountType = 'TRY';
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;

// SAYFA YÜKLENDİĞİNDE OTURUM KONTROLÜ (30 DK KRİTERİ)
window.onload = function() {
    const lastLogin = localStorage.getItem('aygun_last_login');
    const now = new Date().getTime();

    if (currentUser && lastLogin && (now - lastLogin < 30 * 60 * 1000)) {
        // 30 dakikadan az olmuşsa oturumu devam ettir
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-content').style.display = 'block';
        loadData();
        localStorage.setItem('aygun_last_login', now); // Süreyi yenile
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
        } else { document.getElementById('login-err').style.display = 'block'; }
    } catch (e) { alert("Veri hatası!"); }
}

async function loadData() {
    const res = await fetch('data/urunler.json?v=' + Date.now());
    const json = await res.json();
    allProducts = json.data || [];
    // Sadece v5 ve tarih/saat kısmını göster
    document.getElementById('v-tag').innerText = json.metadata?.v || "V5 2026.02.27 15:37";
    renderTable(allProducts);
    updateUI();
}

function cleanPrice(v) {
    if (!v) return 0;
    let c = String(v).replace(/\s/g, '').replace(/[.₺]/g, '').replace(',', '.');
    return isNaN(parseFloat(c)) ? 0 : parseFloat(c);
}

// AKILLI FİLTRELEME (Multi-keyword search)
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
            <td><small>${u.Kod || ''}</small></td>
            <td><b>${u.Ürün || u.Model}</b></td>
            <td>${u['Ürün Gamı'] || '-'}</td>
            <td>${u.Marka || '-'}</td>
            <td>${u.Stok || 0}</td>
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
    if (basket.length === 0) { cont.innerHTML = "<p style='text-align:center;'>Sepet boş.</p>"; return; }

    let tDK=0, tAWM=0, tTek=0, tNak=0;
    let html = `<table class="cart-table"><thead><tr><th>Ürün (Açıklama)</th><th>D.Kart</th><th>4T AWM</th><th>TekÇekim</th><th>Nakit</th><th></th></tr></thead><tbody>`;

    basket.forEach((i, idx) => {
        tDK+=i.dk; tAWM+=i.awm; tTek+=i.tek; tNak+=i.nakit;
        html += `<tr>
            <td style="text-align:left; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                <b>${i.urun}</b><br><small style="color:#666">${i.aciklama}</small>
            </td>
            <td>${i.dk.toLocaleString('tr-TR')}</td>
            <td>${i.awm.toLocaleString('tr-TR')}</td>
            <td>${i.tek.toLocaleString('tr-TR')}</td>
            <td>${i.nakit.toLocaleString('tr-TR')}</td>
            <td><button onclick="removeFromBasket(${idx})" style="border:none; background:none; color:red; font-size:18px;">✕</button></td>
        </tr>`;
    });

    const getD = (total) => discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);
    
    if (discountAmount > 0) {
        html += `<tr style="color:red; font-weight:bold;"><td align="right">İndirim:</td>
        <td>-${getD(tDK).toLocaleString('tr-TR')}</td><td>-${getD(tAWM).toLocaleString('tr-TR')}</td>
        <td>-${getD(tTek).toLocaleString('tr-TR')}</td><td>-${getD(tNak).toLocaleString('tr-TR')}</td><td></td></tr>`;
    }

    html += `<tr class="genel-toplam"><td align="right">NET TOPLAM:</td>
        <td>${(tDK - getD(tDK)).toLocaleString('tr-TR')}</td><td>${(tAWM - getD(tAWM)).toLocaleString('tr-TR')}</td>
        <td>${(tTek - getD(tTek)).toLocaleString('tr-TR')}</td><td>${(tNak - getD(tNak)).toLocaleString('tr-TR')}</td><td></td></tr></tbody></table>`;
    
    cont.innerHTML = html;
}

function toggleCart() {
    const m = document.getElementById('cart-modal');
    m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
}

function clearBasket() {
    if(confirm("Sepeti temizle?")) { basket=[]; discountAmount=0; document.getElementById('discount-input').value=""; save(); }
}

// WHATSAPP MESAJI (Yeni Format)
function finalizeProposal() {
    const n = document.getElementById('cust-name').value;
    const p = document.getElementById('cust-phone').value;
    const extra = document.getElementById('extra-info').value;
    const pType = document.getElementById('price-type-select').value;
    
    if(!n || basket.length === 0) { alert("Müşteri adı ve ürün seçimi zorunludur!"); return; }

    let msg = `*AYGÜN AVM TEKLİF*\n`;
    msg += `*Müşteri:* ${n}\n`;
    msg += `*Telefon:* ${p || '-'}\n`;
    msg += `*Teklif Veren:* ${currentUser?.Email || 'bilgi@aygunavm.com'}\n\n`;

    let tDK=0, tAWM=0, tTek=0, tNak=0;
    basket.forEach(i => {
        msg += `• ${i.urun}\n`;
        tDK+=i.dk; tAWM+=i.awm; tTek+=i.tek; tNak+=i.nakit;
    });

    const getD = (total) => discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);
    
    msg += `\n`;
    if(pType === 'nakit') msg += `💰 *Nakit: ${(tNak - getD(tNak)).toLocaleString('tr-TR')} ₺*`;
    if(pType === 'tek')   msg += `💳 *Tek Çekim: ${(tTek - getD(tTek)).toLocaleString('tr-TR')} ₺*`;
    if(pType === 'awm')   msg += `🗓️ *4T AWM: ${(tAWM - getD(tAWM)).toLocaleString('tr-TR')} ₺*`;
    if(pType === 'dk')    msg += `🃏 *D. Kart: ${(tDK - getD(tDK)).toLocaleString('tr-TR')} ₺*`;

    if(extra) msg += `\n\n> ${extra}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
}
