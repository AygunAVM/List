let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];

// 1. GİRİŞ KONTROLÜ
async function checkAuth() {
    const userInp = document.getElementById('user-input').value.trim().toLowerCase();
    const passInp = document.getElementById('pass-input').value.trim();
    const errText = document.getElementById('login-err');

    try {
        const res = await fetch('data/kullanicilar.json?t=' + Date.now());
        const users = await res.json();
        
        const user = users.find(u => 
            String(u.Email).toLowerCase() === userInp && 
            String(u.Sifre) === passInp
        );

        if (user) {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-content').style.display = 'block';
            loadData();
        } else {
            errText.style.display = 'block';
        }
    } catch (e) {
        alert("Bağlantı hatası: Kullanıcı listesi alınamadı.");
    }
}

// 2. VERİ YÜKLEME
async function loadData() {
    try {
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        allProducts = json.data || [];
        document.getElementById('v-tag').innerText = json.metadata?.v || "V4";
        renderBrands(allProducts);
        renderTable(allProducts);
        updateUI();
    } catch (err) {
        console.error("Yükleme hatası:", err);
    }
}

// 3. TABLO RENDER
function renderTable(data) {
    const list = document.getElementById('product-list');
    list.innerHTML = data.map(u => `
        <tr>
            <td><button class="add-btn" onclick="addToBasket('${u.Kod || ''}', '${u.Ürün || u.Model}', '${u.Stok || 0}', ${u['Diğer Kartlar'] || 0}, ${u['4T AWM'] || 0}, ${u['Tek Çekim'] || 0}, ${u.Nakit || 0}, '${u.Açıklama || '-'}')">+</button></td>
            <td><small>${u.Kod || '-'}</small></td>
            <td>${u.Ürün || u.Model || '-'}</td>
            <td><small>${u['Ürün Gamı'] || '-'}</small></td>
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

// 4. SEPET SİSTEMİ VE TOPLAMLAR
function addToBasket(kod, urun, stok, dk, awm, tek, nakit, aciklama) {
    basket.push({ kod, urun, stok, dk, awm, tek, nakit, aciklama });
    saveAndRefresh();
}

function clearBasket() {
    if(confirm("Sepeti tamamen temizlemek istiyor musunuz?")) {
        basket = [];
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
        itemsDiv.innerHTML = "<p>Sepetiniz boş.</p>";
        return;
    }

    let totalDK = 0, totalAWM = 0, totalTek = 0, totalNakit = 0;

    let html = `
        <table class="cart-table">
            <thead>
                <tr>
                    <th>Kod</th>
                    <th>Ürün</th>
                    <th>Stok</th>
                    <th>D.Kart</th>
                    <th>4T AWM</th>
                    <th>Tek Çekim</th>
                    <th>Nakit</th>
                    <th>Açıklama</th>
                </tr>
            </thead>
            <tbody>
    `;

    basket.forEach((i, idx) => {
        totalDK += Number(i.dk);
        totalAWM += Number(i.awm);
        totalTek += Number(i.tek);
        totalNakit += Number(i.nakit);

        html += `
            <tr>
                <td><small>${i.kod}</small></td>
                <td>${i.urun}</td>
                <td>${i.stok}</td>
                <td>${Number(i.dk).toLocaleString('tr-TR')}</td>
                <td>${Number(i.awm).toLocaleString('tr-TR')}</td>
                <td>${Number(i.tek).toLocaleString('tr-TR')}</td>
                <td>${Number(i.nakit).toLocaleString('tr-TR')}</td>
                <td><small>${i.aciklama}</small></td>
            </tr>
        `;
    });

    // Toplam Satırı (Görseldeki image_0accbc.png yapısı)
    html += `
            <tr class="total-row">
                <td colspan="3" style="text-align:right"><strong>TOPLAM:</strong></td>
                <td><strong>${totalDK.toLocaleString('tr-TR')}</strong></td>
                <td><strong>${totalAWM.toLocaleString('tr-TR')}</strong></td>
                <td><strong>${totalTek.toLocaleString('tr-TR')}</strong></td>
                <td><strong>${totalNakit.toLocaleString('tr-TR')}</strong></td>
                <td></td>
            </tr>
        </tbody>
    </table>
    `;

    itemsDiv.innerHTML = html;
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
