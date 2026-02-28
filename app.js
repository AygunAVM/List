let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0;
let discountType = 'TRY';
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;

async function loadData() {
    const res = await fetch('data/urunler.json?v=' + Date.now());
    const json = await res.json();
    allProducts = json.data || [];
    renderTable(allProducts);
    updateUI();
}

// AKILLI ARAMA: sam buzd yazınca ikisini de arar
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
    list.innerHTML = data.map(u => {
        const stok = parseInt(u.Stok) || 0;
        const stokClass = stok === 0 ? 'stok-kritik' : (stok > 10 ? 'stok-bol' : '');
        return `<tr>
            <td><button class="add-btn haptic-btn" onclick="addToBasket(${allProducts.indexOf(u)})">+</button></td>
            <td><b>${u.Ürün || u.Model}</b></td>
            <td>${u['Ürün Gamı'] || '-'}</td>
            <td>${u.Marka || '-'}</td>
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

// SEPET HESAPLAMA: Her fiyattan indirim düşer
function updateUI() {
    document.getElementById('cart-count').innerText = basket.length;
    const cont = document.getElementById('cart-items');
    if (basket.length === 0) { cont.innerHTML = "<p style='text-align:center; padding:30px; color:#64748b;'>Sepetiniz boş.</p>"; return; }

    let tDK=0, tAWM=0, tTek=0, tNak=0;
    let html = `<table style="width:100%; border-collapse:collapse; font-size:12px; min-width:850px;">
        <thead><tr style="background:#f8fafc; color:#64748b;">
            <th style="padding:10px;">Ürün</th><th>Stok</th><th>D.Kart</th><th>4T AWM</th><th>TekÇekim</th><th>Nakit</th><th>Açıklama</th><th>✕</th>
        </tr></thead><tbody>`;

    basket.forEach((i, idx) => {
        tDK+=i.dk; tAWM+=i.awm; tTek+=i.tek; tNak+=i.nakit;
        html += `<tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:10px;"><b>${i.urun}</b></td>
            <td style="color:${i.stok == 0 ? 'red' : 'inherit'}">${i.stok}</td>
            <td>${i.dk.toLocaleString('tr-TR')}</td><td>${i.awm.toLocaleString('tr-TR')}</td>
            <td>${i.tek.toLocaleString('tr-TR')}</td><td>${i.nakit.toLocaleString('tr-TR')}</td>
            <td><small>${i.aciklama}</small></td>
            <td><button class="haptic-btn" onclick="removeFromBasket(${idx})" style="color:red; background:none; font-size:16px;">✕</button></td>
        </tr>`;
    });

    const getD = (total) => discountType === 'TRY' ? (discountAmount / (basket.length || 1)) : (total * discountAmount / 100);
    const totalD = (total) => discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);

    if (discountAmount > 0) {
        html += `<tr style="color:red; font-weight:bold; background:#fff5f5;">
            <td colspan="2" align="right">İndirim:</td>
            <td>-${totalD(tDK).toLocaleString('tr-TR')}</td><td>-${totalD(tAWM).toLocaleString('tr-TR')}</td>
            <td>-${totalD(tTek).toLocaleString('tr-TR')}</td><td>-${totalD(tNak).toLocaleString('tr-TR')}</td>
            <td colspan="2"></td></tr>`;
    }

    html += `<tr style="background:var(--primary); color:white; font-weight:bold;">
        <td colspan="2" align="right" style="padding:12px;">NET TOPLAM:</td>
        <td>${(tDK - totalD(tDK)).toLocaleString('tr-TR')}</td><td>${(tAWM - totalD(tAWM)).toLocaleString('tr-TR')}</td>
        <td>${(tTek - totalD(tTek)).toLocaleString('tr-TR')}</td><td>${(tNak - totalD(tNak)).toLocaleString('tr-TR')}</td>
        <td colspan="2"></td></tr></tbody></table>`;
    
    cont.innerHTML = html;
}

// Diğer fonksiyonlar (save, addToBasket, toggleCart vb.) aynı kalacak.
