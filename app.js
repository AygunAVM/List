// --- VERSİYONLAMA SİSTEMİ ---
const VERSION = "V5";
const LAST_UPDATE = "2026-03-01 00:05"; // Tarihi buraya elle girebilir veya Build zamanı otomatikleşebilir.
document.getElementById('v-tag').innerText = `${VERSION} ${LAST_UPDATE}`;

let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0;
let discountType = 'TRY';
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;

window.onload = function() {
    if (currentUser) {
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
    renderTable(allProducts);
    updateUI();
}

function renderTable(data) {
    const list = document.getElementById('product-list');
    list.innerHTML = data.map(u => {
        const stok = parseInt(u.Stok) || 0;
        const stokClass = stok === 0 ? 'stok-kritik' : (stok > 10 ? 'stok-bol' : '');
        
        return `<tr>
            <td><button class="add-btn action-btn" onclick="addToBasket(${allProducts.indexOf(u)})">+</button></td>
            <td><b>${u.Ürün || u.Model}</b></td>
            <td class="${stokClass}">${stok}</td>
            <td>${cleanPrice(u['Diğer Kartlar']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u['4T AWM']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u['Tek Çekim']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u.Nakit).toLocaleString('tr-TR')}</td>
            <td><small>${u.Açıklama || '-'}</small></td>
            <td><small>${u.Kod || ''}</small></td>
        </tr>`;
    }).join('');
}

function addToBasket(idx) {
    const p = allProducts[idx];
    basket.push({
        urun: p.Ürün || p.Model,
        dk: cleanPrice(p['Diğer Kartlar']), awm: cleanPrice(p['4T AWM']),
        tek: cleanPrice(p['Tek Çekim']), nakit: cleanPrice(p.Nakit),
        stok: p.Stok || 0, aciklama: p.Açıklama || '-'
    });
    save();
}

function cleanPrice(v) {
    if (!v) return 0;
    let c = String(v).replace(/\s/g, '').replace(/[.₺]/g, '').replace(',', '.');
    return isNaN(parseFloat(c)) ? 0 : parseFloat(c);
}

function updateUI() {
    document.getElementById('cart-count').innerText = basket.length;
    const cont = document.getElementById('cart-items');
    if (basket.length === 0) { cont.innerHTML = "<p style='text-align:center;'>Sepet boş.</p>"; return; }

    let html = `<table style="width:100%; border-collapse:collapse; font-size:12px;"><thead><tr style="background:#f1f1f1;">
        <th>Ürün</th><th>Stok</th><th>Nakit</th><th>Açıklama</th><th>✕</th></tr></thead><tbody>`;

    basket.forEach((i, idx) => {
        html += `<tr>
            <td style="text-align:left; padding:8px;"><b>${i.urun}</b></td>
            <td style="color:${i.stok == 0 ? 'red' : 'inherit'}">${i.stok}</td>
            <td>${i.nakit.toLocaleString('tr-TR')}</td>
            <td><small>${i.aciklama}</small></td>
            <td><button class="action-btn" onclick="removeFromBasket(${idx})" style="color:red; background:none;">✕</button></td>
        </tr>`;
    });
    html += `</tbody></table>`;
    cont.innerHTML = html;
}

function save() { localStorage.setItem('aygun_basket', JSON.stringify(basket)); updateUI(); }
function removeFromBasket(index) { basket.splice(index, 1); save(); }
function toggleCart() { const m = document.getElementById('cart-modal'); m.style.display = (m.style.display === 'flex') ? 'none' : 'flex'; }
function applyDiscount() { discountAmount = parseFloat(document.getElementById('discount-input').value) || 0; discountType = document.getElementById('discount-type').value; updateUI(); }

// --- ÖZEL ONAY PENCERESİ MANTIĞI ---
function showConfirm() { document.getElementById('confirm-modal').style.display = 'flex'; }
function closeConfirm() { document.getElementById('confirm-modal').style.display = 'none'; }
function clearBasket() { basket=[]; discountAmount=0; save(); closeConfirm(); }

function finalizeProposal() {
    const name = document.getElementById('cust-name').value;
    const phone = document.getElementById('cust-phone').value;
    if(!name || !phone) { alert("Müşteri bilgileri eksik!"); return; }
    
    let msg = `*AYGÜN AVM TEKLİF*\n*Müşteri:* ${name}\n\n`;
    basket.forEach(i => { msg += `• ${i.urun}\n`; });
    
    const selectedPrices = Array.from(document.querySelectorAll('.price-toggle:checked')).map(cb => cb.value);
    const getD = (total) => discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);

    selectedPrices.forEach(type => {
        let total = basket.reduce((a,b) => a + b[type], 0);
        msg += `\n${type.toUpperCase()}: ${(total - getD(total)).toLocaleString('tr-TR')} ₺`;
    });

    if (discountAmount > 0) {
        let text = discountType === 'TRY' ? `${discountAmount} ₺` : `%${discountAmount}`;
        msg += `\n\n*(${text} İndirim uygulanmıştır)*`;
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
}

function filterData() {
    const val = document.getElementById('search').value.toLowerCase();
    const filtered = allProducts.filter(u => Object.values(u).join(" ").toLowerCase().includes(val));
    renderTable(filtered);
}
