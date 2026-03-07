let allProducts = [];
let allRates = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;
let abakusSelection = null;
let proposals = JSON.parse(localStorage.getItem('aygun_proposals')) || [];

document.addEventListener('DOMContentLoaded', () => {
    if (currentUser) { showApp(); loadData(); }
});

function isAdmin() {
    if (!currentUser) return false;
    const mail = currentUser.Email.toLowerCase();
    return currentUser.Rol === 'admin' || mail.includes('aygun') || mail.includes('fatih');
}

function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-content').style.display = 'block';
    if(isAdmin()) document.getElementById('admin-btn').style.display = 'inline-block';
}

async function loadData() {
    try {
        // "./" kullanımı GitHub Pages List klasörü için hayatidir
        const pRes = await fetch('./data/urunler.json?v=' + Date.now());
        const pData = await pRes.json();
        allProducts = Array.isArray(pData.data) ? pData.data : pData;

        const rRes = await fetch('./data/oranlar.json?v=' + Date.now());
        allRates = await rRes.json();

        renderTable();
        updateCartUI();
    } catch (e) {
        console.error("404 veya Veri Hatası:", e);
    }
}

async function checkAuth() {
    const u = document.getElementById('user-input').value.trim().toLowerCase();
    const p = document.getElementById('pass-input').value.trim();
    try {
        const res = await fetch('./data/kullanicilar.json');
        const users = await res.json();
        const user = users.find(x => x.Email.toLowerCase() === u && x.Sifre === p);
        if (user) {
            currentUser = user;
            localStorage.setItem('aygun_user', JSON.stringify(user));
            showApp(); loadData();
        } else { alert("Hatalı giriş!"); }
    } catch (e) { alert("Kullanıcı verisi yüklenemedi!"); }
}

function renderTable(filter = "") {
    const list = document.getElementById('product-list');
    list.innerHTML = "";
    const filtered = allProducts.filter(p => (p.Urun||"").toLowerCase().includes(filter.toLowerCase()));
    filtered.forEach((p, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><button onclick="addToBasket(${allProducts.indexOf(p)})">+</button></td>
            <td>${p.Urun}</td>
            <td>${p.Stok}</td>
            <td>${p.Nakit} ₺</td>
            <td>${p['4T AWM'] || '-'}</td>
        `;
        list.appendChild(tr);
    });
}

function addToBasket(idx) {
    basket.push({ urun: allProducts[idx].Urun, nakit: parseFloat(allProducts[idx].Nakit) });
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    updateCartUI();
}

function updateCartUI() {
    document.getElementById('cart-count').innerText = basket.length;
    const area = document.getElementById('cart-table-area');
    if(basket.length === 0) { area.innerHTML = "Sepet Boş"; return; }
    let total = basket.reduce((s, i) => s + i.nakit, 0);
    area.innerHTML = basket.map((item, i) => `<div>${item.urun} - ${item.nakit} ₺ <button onclick="removeFromBasket(${i})">x</button></div>`).join('') + `<b>Toplam: ${total} ₺</b>`;
}

function removeFromBasket(i) {
    basket.splice(i, 1);
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    updateCartUI();
}

function openAbakus() {
    if(basket.length === 0) return;
    document.getElementById('abakus-modal').style.display = 'flex';
    const kartlar = [...new Set(allRates.map(r => r.Kart))];
    document.getElementById('ab-kart').innerHTML = kartlar.map(k => `<option>${k}</option>`).join('');
    calcAbakus();
}

function calcAbakus() {
    const kart = document.getElementById('ab-kart').value;
    const toplamNakit = basket.reduce((s, i) => s + i.nakit, 0);
    const oranlar = allRates.filter(r => r.Kart === kart);
    let html = `<table class="ab-table"><tr><th>Taksit</th><th>Zincir</th><th>Aylık</th><th>Toplam</th></tr>`;
    
    oranlar.forEach(row => {
        [2,3,4,5,6,9].forEach(t => {
            const oran = parseFloat(row[t + 'Taksit']);
            if(!oran) return;
            const toplam = toplamNakit * (1 + (oran/100));
            const aylik = toplam / t;
            const data = JSON.stringify({t, z: row.Zincir, toplam, aylik});
            html += `<tr onclick='selectAbRow(this, ${data})'>
                <td>${t}</td><td>${row.Zincir}</td>
                <td>${aylik.toFixed(2)}</td><td>${toplam.toFixed(2)}</td>
            </tr>`;
        });
    });
    html += `</table>`;
    document.getElementById('ab-result').innerHTML = html;
}

function selectAbRow(el, data) {
    document.querySelectorAll('.ab-table tr').forEach(r => r.style.background = "none");
    el.style.background = "#ffebee";
    abakusSelection = data;
    document.getElementById('ab-actions').style.display = 'flex';
}

function openWaFromAbakus() {
    const msg = `Teklif: ${abakusSelection.t} Taksit (${abakusSelection.z}) - Toplam: ${abakusSelection.toplam.toFixed(2)} ₺`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
}

function closeAbakus() { document.getElementById('abakus-modal').style.display = 'none'; }
function toggleCart() { 
    const m = document.getElementById('cart-modal');
    m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
}
function clearBasket() { basket = []; localStorage.removeItem('aygun_basket'); updateCartUI(); }
function filterData() { renderTable(document.getElementById('search').value); }
