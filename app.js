// --- AKILLI İÇERİK KONTROLLÜ VERSİYONLAMA ---
function checkDataVersion(jsonData) {
    const simdi = new Date();
    // İstanbul Saati Ayarı
    const bugunStr = simdi.toLocaleDateString('tr-TR', { day: '2d-digit', month: '2d-digit', year: '2d-digit' });
    const suanSaat = simdi.toLocaleTimeString('tr-TR', { hour: '2d-digit', minute: '2d-digit' });

    // Mevcut verinin "Parmak İzi"ni oluştur (Dosya içeriğinin karakter uzunluğu)
    const currentFingerprint = JSON.stringify(jsonData).length;

    // Yerel hafızadaki durumu al
    let vData = JSON.parse(localStorage.getItem('aygun_v_final')) || { 
        date: bugunStr, 
        count: 0, 
        fingerprint: 0,
        displayTime: suanSaat
    };

    // 1. GÜN DEĞİŞTİ Mİ? (Ertesi gün v1'den başla)
    if (vData.date !== bugunStr) {
        vData = { 
            date: bugunStr, 
            count: 1, 
            fingerprint: currentFingerprint,
            displayTime: suanSaat
        };
    } 
    // 2. VERİ DEĞİŞTİ Mİ? (Makro yeni veri push etmişse fingerprint tutmaz)
    else if (vData.fingerprint !== currentFingerprint) {
        vData.count += 1;
        vData.fingerprint = currentFingerprint;
        vData.displayTime = suanSaat;
    }
    // 3. AYNI VERİ (Sayfa yenilense de count ve saat sabit kalır)

    localStorage.setItem('aygun_v_final', JSON.stringify(vData));
    
    const vTag = document.getElementById('v-tag');
    if (vTag) {
        vTag.innerText = `v${vData.count}/${vData.date}-${vData.displayTime}`;
    }
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
    } catch (e) { alert("Giriş verisi alınamadı!"); }
}

// VERİ YÜKLEME
async function loadData() {
    try {
        // Cache (önbellek) sorununu önlemek için zaman damgası ekliyoruz
        const res = await fetch('data/urunler.json?nocache=' + Date.now());
        if (!res.ok) throw new Error("Dosya okunamadı");
        const json = await res.json();
        
        allProducts = Array.isArray(json) ? json : (json.data || []);
        
        // Versiyonu burada kontrol ediyoruz
        checkDataVersion(json);
        
        renderTable(allProducts);
        updateUI();
    } catch (e) {
        console.error("Yükleme hatası:", e);
        document.getElementById('v-tag').innerText = "Veri Hatası!";
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
    if(!list) return;
    list.innerHTML = data.map(u => {
        const stok = parseInt(u.Stok) || 0;
        const stokClass = stok === 0 ? 'stok-kritik' : (stok > 10 ? 'stok-bol' : '');
        return `<tr>
            <td><button class="add-btn haptic-btn" onclick="addToBasket(${allProducts.indexOf(u)})">+</button></td>
            <td><b>${u.Ürün || u.Model || '-'}</b></td>
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
    if(confirm("Tüm sepet temizlensin mi?")) {
        basket = [];
        discountAmount = 0;
        const dInput = document.getElementById('discount-input');
        if(dInput) dInput.value = "";
        save();
    }
}

function applyDiscount() {
    discountAmount = parseFloat(document.getElementById('discount-input').value) || 0;
    discountType = document.getElementById('discount-type').value;
    updateUI();
}

function updateUI() {
    const cCount = document.getElementById('cart-count');
    if(cCount) cCount.innerText = basket.length;
    
    const cont = document.getElementById('cart-items');
    if (!cont) return;

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

    const calcD = (total) => discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);

    html += `<tr style="background:var(--primary); color:white; font-weight:bold;">
        <td colspan="2" align="right" style="padding:12px;">NET TOPLAM:</td>
        <td>${(tDK - calcD(tDK)).toLocaleString('tr-TR')}</td><td>${(tAWM - calcD(tAWM)).toLocaleString('tr-TR')}</td>
        <td>${(tTek - calcD(tTek)).toLocaleString('tr-TR')}</td><td>${(tNak - calcD(tNak)).toLocaleString('tr-TR')}</td>
        <td colspan="2"></td></tr></tbody></table>`;
    
    cont.innerHTML = html;
}

function toggleCart() {
    const m = document.getElementById('cart-modal');
    if(m) m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
}

function finalizeProposal() {
    const name = document.getElementById('cust-name').value.trim();
    const phone = document.getElementById('cust-phone').value.trim();
    const validity = document.getElementById('validity-date').value;
    const extra = document.getElementById('extra-info').value.trim();
    
    if (!name || !phone) { alert("Müşteri bilgileri eksik!"); return; }

    let msg = `*aygün® TEKLİF*\n*Müşteri:* ${name}\n*Telefon:* ${phone}\n`;
    if(validity) msg += `*Geçerlilik:* ${validity}\n`;
    msg += `\n*Ürünler:*\n`;
    basket.forEach(i => { msg += `• ${i.urun}\n`; });

    const selectedPrices = Array.from(document.querySelectorAll('.price-toggle:checked')).map(cb => cb.value);
    const calcD = (total) => discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);

    msg += `\n*Ödeme Seçenekleri:*\n`;
    const tDK = basket.reduce((a,b)=>a+b.dk,0);
    const tAWM = basket.reduce((a,b)=>a+b.awm,0);
    const tTek = basket.reduce((a,b)=>a+b.tek,0);
    const tNak = basket.reduce((a,b)=>a+b.nakit,0);

    if(selectedPrices.includes('nakit')) msg += `Nakit: ${(tNak - calcD(tNak)).toLocaleString('tr-TR')} ₺\n`;
    if(selectedPrices.includes('tek')) msg += `Tek Çekim: ${(tTek - calcD(tTek)).toLocaleString('tr-TR')} ₺\n`;
    if(selectedPrices.includes('awm')) msg += `4T AWM: ${(tAWM - calcD(tAWM)).toLocaleString('tr-TR')} ₺\n`;
    if(selectedPrices.includes('dk')) msg += `D. Kart: ${(tDK - calcD(tDK)).toLocaleString('tr-TR')} ₺\n`;

    if (discountAmount > 0) msg += `\n_(İndirim uygulanmıştır)_`;
    if(extra) msg += `\n\n*Not:* ${extra}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
}

window.onload = () => {
    if (currentUser) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-content').style.display = 'block';
        loadData();
    }
};
