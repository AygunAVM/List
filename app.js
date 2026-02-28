// --- DİNAMİK VERSİYONLAMA SİSTEMİ (İstanbul Saati Bazlı) ---
function getIstanbulVersion() {
    const simdi = new Date();
    // İstanbul saat dilimine göre tarih ve saat alıyoruz
    const options = { timeZone: 'Europe/Istanbul', year: '2d-digit', month: '2d-digit', day: '2d-digit', hour: '2d-digit', minute: '2d-digit', hour12: false };
    const formatter = new Intl.DateTimeFormat('tr-TR', options);
    const parts = formatter.formatToParts(simdi);
    
    const gun = parts.find(p => p.type === 'day').value;
    const ay = parts.find(p => p.type === 'month').value;
    const yil = parts.find(p => p.type === 'year').value;
    const saat = parts.find(p => p.type === 'hour').value;
    const dak = parts.find(p => p.type === 'minute').value;

    const bugunStr = `${gun}.${ay}.${yil}`;
    const tamZaman = `${bugunStr}-${saat}:${dak}`;

    // Yerel depolamadan (localStorage) kontrol yapıyoruz
    let vData = JSON.parse(localStorage.getItem('aygun_v_counter')) || { date: bugunStr, count: 0 };

    if (vData.date !== bugunStr) {
        // Gün değişmişse v1'den başla
        vData = { date: bugunStr, count: 1 };
    } else {
        // Aynı gün içindeyse bir artır
        vData.count += 1;
    }

    localStorage.setItem('aygun_v_counter', JSON.stringify(vData));
    return `v${vData.count}/${tamZaman}`;
}

let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0;
let discountType = 'TRY';
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;

// GİRİŞ KONTROLÜ
async function checkAuth() {
    const u = document.getElementById('user-input').value.trim().toLowerCase();
    const p = document.getElementById('pass-input').value.trim();
    if(!u || !p) { alert("Lütfen bilgileri girin."); return; }
    
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
        } else {
            document.getElementById('login-err').style.display = 'block';
        }
    } catch (e) { alert("Bağlantı hatası!"); }
}

// VERİ YÜKLEME VE VERSİYON GÜNCELLEME
async function loadData() {
    try {
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        allProducts = json.data || [];
        
        // Veri her yüklendiğinde (Makro sonrası refresh gibi) versiyonu güncelle
        document.getElementById('v-tag').innerText = getIstanbulVersion();
        
        renderTable(allProducts);
        updateUI();
    } catch (e) { console.error("Ürünler yüklenemedi."); }
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
    list.innerHTML = data.map(u => {
        const stok = parseInt(u.Stok) || 0;
        const stokClass = stok === 0 ? 'stok-kritik' : (stok > 10 ? 'stok-bol' : '');
        return `<tr>
            <td><button class="add-btn haptic-btn" onclick="addToBasket(${allProducts.indexOf(u)})">+</button></td>
            <td><b>${u.Ürün || u.Model}</b></td>
            <td class="${stokClass}">${stok}</td>
            <td>${cleanPrice(u['Diğer Kartlar']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u['4T AWM']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u['Tek Çekim']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u.Nakit).toLocaleString('tr-TR')}</td>
            <td><small>${u.Açıklama || '-'}</small></td>
            <td><small>${u.Kod || ''}</small></td>
            <td>${u['Ürün Gamı'] || '-'}</td>
            <td>${u.Marka || '-'}</td>
        </tr>`;
    }).join('');
}

function addToBasket(idx) {
    const p = allProducts[idx];
    basket.push({
        urun: p.Ürün || p.Model,
        dk: cleanPrice(p['Diğer Kartlar']),
        awm: cleanPrice(p['4T AWM']),
        tek: cleanPrice(p['Tek Çekim']),
        nakit: cleanPrice(p.Nakit),
        stok: p.Stok || 0,
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

function clearBasket() {
    if(confirm("Tüm sepeti temizlemek istediğinize emin misiniz?")) {
        basket = [];
        discountAmount = 0;
        document.getElementById('discount-input').value = "";
        save();
    }
}

function applyDiscount() {
    discountAmount = parseFloat(document.getElementById('discount-input').value) || 0;
    discountType = document.getElementById('discount-type').value;
    updateUI();
}

function updateUI() {
    document.getElementById('cart-count').innerText = basket.length;
    const cont = document.getElementById('cart-items');
    if (basket.length === 0) {
        cont.innerHTML = "<p style='text-align:center; padding:40px; color:#94a3b8;'>Sepetiniz boş.</p>";
        return;
    }

    let tDK=0, tAWM=0, tTek=0, tNak=0;
    let html = `<table style="width:100%; border-collapse:collapse; font-size:12px; min-width:850px;">
        <thead><tr style="background:#f8fafc; color:#64748b;">
            <th style="padding:10px; text-align:left;">Ürün</th><th>Stok</th><th>D.Kart</th><th>4T AWM</th><th>TekÇekim</th><th>Nakit</th><th>Açıklama</th><th>✕</th>
        </tr></thead><tbody>`;

    basket.forEach((i, idx) => {
        tDK+=i.dk; tAWM+=i.awm; tTek+=i.tek; tNak+=i.nakit;
        html += `<tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:10px; text-align:left;"><b>${i.urun}</b></td>
            <td style="color:${i.stok == 0 ? 'red' : 'inherit'}">${i.stok}</td>
            <td>${i.dk.toLocaleString('tr-TR')}</td><td>${i.awm.toLocaleString('tr-TR')}</td>
            <td>${i.tek.toLocaleString('tr-TR')}</td><td>${i.nakit.toLocaleString('tr-TR')}</td>
            <td><small>${i.aciklama}</small></td>
            <td><button class="haptic-btn" onclick="removeFromBasket(${idx})" style="color:red; background:none; font-size:18px;">✕</button></td>
        </tr>`;
    });

    const totalD = (total) => discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);

    if (discountAmount > 0) {
        html += `<tr style="color:red; font-weight:bold; background:#fff5f5;">
            <td colspan="2" align="right" style="padding:10px;">İndirim:</td>
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

function toggleCart() {
    const m = document.getElementById('cart-modal');
    m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
}

function finalizeProposal() {
    const name = document.getElementById('cust-name').value.trim();
    const phone = document.getElementById('cust-phone').value.trim();
    const validity = document.getElementById('validity-date').value;
    const extra = document.getElementById('extra-info').value.trim();
    
    if (!name || !phone) { alert("Müşteri bilgileri eksik!"); return; }

    let msg = `*aygün® TEKLİF*\n*Müşteri:* ${name}\n*Telefon:* ${phone}\n`;
    if(validity) {
        const d = new Date(validity);
        msg += `*Geçerlilik:* ${d.toLocaleDateString('tr-TR')}\n`;
    }
    msg += `\n*Ürünler:*\n`;
    basket.forEach(i => { msg += `• ${i.urun}\n`; });

    const selectedPrices = Array.from(document.querySelectorAll('.price-toggle:checked')).map(cb => cb.value);
    const totalD = (total) => discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);

    msg += `\n*Ödeme Seçenekleri:*\n`;
    if(selectedPrices.includes('nakit')) msg += `Nakit: ${(basket.reduce((a,b)=>a+b.nakit,0) - totalD(basket.reduce((a,b)=>a+b.nakit,0))).toLocaleString('tr-TR')} ₺\n`;
    if(selectedPrices.includes('tek')) msg += `Tek Çekim: ${(basket.reduce((a,b)=>a+b.tek,0) - totalD(basket.reduce((a,b)=>a+b.tek,0))).toLocaleString('tr-TR')} ₺\n`;
    if(selectedPrices.includes('awm')) msg += `4T AWM: ${(basket.reduce((a,b)=>a+b.awm,0) - totalD(basket.reduce((a,b)=>a+b.awm,0))).toLocaleString('tr-TR')} ₺\n`;
    if(selectedPrices.includes('dk')) msg += `D. Kart: ${(basket.reduce((a,b)=>a+b.dk,0) - totalD(basket.reduce((a,b)=>a+b.dk,0))).toLocaleString('tr-TR')} ₺\n`;

    if (discountAmount > 0) msg += `\n_(İndirim uygulanmıştır)_`;
    if(extra) msg += `\n\n*Not:* ${extra}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
}

// OTURUMU KORU
if (currentUser) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-content').style.display = 'block';
    loadData();
}
