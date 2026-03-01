let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0;
let discountType = 'TRY';
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;

// --- GİRİŞ EKRANI TASARIM İYİLEŞTİRMESİ (Dinamik Stil Enjeksiyonu) ---
const loginStyles = `
#login-screen {
    background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
    display: flex; align-items: center; justify-content: center; height: 100vh; font-family: 'Inter', sans-serif;
}
.login-card {
    background: white; padding: 2.5rem; border-radius: 1.5rem; 
    box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
    width: 100%; max-width: 400px; text-align: center;
}
.login-card img { width: 120px; margin-bottom: 1.5rem; }
.login-card h2 { color: #1e293b; margin-bottom: 1.5rem; font-size: 1.5rem; font-weight: 700; }
.input-group { margin-bottom: 1.25rem; text-align: left; }
.input-group label { display: block; font-size: 0.875rem; color: #64748b; margin-bottom: 0.5rem; }
.input-group input { 
    width: 100%; padding: 0.75rem; border: 1px solid #cbd5e1; border-radius: 0.75rem;
    outline: none; transition: all 0.2s; font-size: 1rem;
}
.input-group input:focus { border-color: #2563eb; ring: 2px solid #bfdbfe; }
.login-btn { 
    width: 100%; background: #2563eb; color: white; padding: 0.75rem; border: none;
    border-radius: 0.75rem; font-weight: 600; cursor: pointer; transition: background 0.2s;
}
.login-btn:hover { background: #1d4ed8; }
`;
const styleSheet = document.createElement("style");
styleSheet.innerText = loginStyles;
document.head.appendChild(styleSheet);

// --- DEĞİŞİM ANALİZİ VE BİLDİRİM SİSTEMİ ---
function analyzeChanges(newData) {
    const oldData = JSON.parse(localStorage.getItem('aygun_last_raw_data')) || [];
    let changeLogs = JSON.parse(localStorage.getItem('aygun_change_logs')) || [];
    let currentChanges = [];

    if (oldData.length > 0) {
        newData.forEach(newItem => {
            const oldItem = oldData.find(o => (o.Ürün || o.Model) === (newItem.Ürün || newItem.Model));
            if (oldItem) {
                let diffs = [];
                // Stok Değişimi
                const sOld = parseInt(oldItem.Stok) || 0;
                const sNew = parseInt(newItem.Stok) || 0;
                if (sOld !== sNew) diffs.push(`Stok ${sNew > sOld ? 'arttı' : 'azaldı'} (${sOld} -> ${sNew})`);

                // Nakit Fiyat Değişimi
                const pOld = cleanPrice(oldItem.Nakit);
                const pNew = cleanPrice(newItem.Nakit);
                if (pOld !== pNew) diffs.push(`Nakit fiyat ${pNew > pOld ? 'arttı' : 'azaldı'} (${pNew.toLocaleString('tr-TR')} ₺)`);

                // Açıklama Değişimi
                if (oldItem.Açıklama !== newItem.Açıklama) diffs.push(`Açıklama revize edildi`);

                if (diffs.length > 0) {
                    currentChanges.push(`<b>${newItem.Ürün || newItem.Model}:</b> ${diffs.join(', ')}`);
                }
            }
        });
    }

    if (currentChanges.length > 0) {
        const time = new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
        changeLogs.unshift({ time, list: currentChanges.slice(0, 5) }); // Son 5 ürünü al
        changeLogs = changeLogs.slice(0, 3); // Max 3 büyük güncellemeyi sakla
        localStorage.setItem('aygun_change_logs', JSON.stringify(changeLogs));
        showNotificationPopup(changeLogs[0]);
    }
    localStorage.setItem('aygun_last_raw_data', JSON.stringify(newData));
}

function showNotificationPopup(log) {
    let popup = document.getElementById('change-popup');
    if(!popup) {
        popup = document.createElement('div');
        popup.id = 'change-popup';
        popup.style = `
            position: fixed; bottom: 20px; right: 20px; background: white; 
            border-left: 5px solid #2563eb; box-shadow: 0 10px 15px rgba(0,0,0,0.2);
            padding: 1.5rem; border-radius: 1rem; z-index: 9999; max-width: 350px;
            animation: slideIn 0.5s ease-out; font-family: 'Inter', sans-serif;
        `;
        document.body.appendChild(popup);
    }
    popup.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <strong style="color:#1e293b">🔔 Son Değişiklikler (${log.time})</strong>
            <button onclick="document.getElementById('change-popup').remove()" style="background:none; border:none; cursor:pointer; font-size:1.2rem;">✕</button>
        </div>
        <div style="font-size:0.85rem; color:#475569; max-height:200px; overflow-y:auto;">
            ${log.list.map(item => `<p style="margin-bottom:8px; border-bottom:1px solid #f1f5f9; padding-bottom:4px;">${item}</p>`).join('')}
        </div>
    `;
}

// --- GÜNCELLEME ZAMANI TAKİBİ ---
function handleTimestamp(jsonData) {
    const currentSize = JSON.stringify(jsonData).length;
    let vData = JSON.parse(localStorage.getItem('aygun_v_state')) || { lastSize: 0, lastUpdate: "" };

    if (vData.lastSize !== currentSize) {
        analyzeChanges(jsonData); // Veri değişmişse analizi başlat
        const simdi = new Date();
        const tarihStr = simdi.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit' });
        const saatStr = simdi.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        
        vData.lastSize = currentSize;
        vData.lastUpdate = `${tarihStr} - ${saatStr}`;
        localStorage.setItem('aygun_v_state', JSON.stringify(vData));
    }

    const vTag = document.getElementById('v-tag');
    if (vTag) vTag.innerText = vData.lastUpdate;
}

// GİRİŞ KONTROLÜ
async function checkAuth() {
    const u = document.getElementById('user-input').value.trim().toLowerCase();
    const p = document.getElementById('pass-input').value.trim();
    if(!u || !p) { alert("Bilgileri girin."); return; }
    
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

// VERİ YÜKLEME
async function loadData() {
    try {
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        allProducts = Array.isArray(json) ? json : (json.data || []);
        
        handleTimestamp(json);
        renderTable(allProducts);
        updateUI();
    } catch (e) {
        console.error("Veri yükleme hatası.");
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
    if(confirm("Sepeti temizle?")) {
        basket = [];
        discountAmount = 0;
        const discInput = document.getElementById('discount-input');
        if(discInput) discInput.value = "";
        save();
    }
}

function applyDiscount() {
    discountAmount = parseFloat(document.getElementById('discount-input').value) || 0;
    discountType = document.getElementById('discount-type').value;
    updateUI();
}

function updateUI() {
    const cartCount = document.getElementById('cart-count');
    if(cartCount) cartCount.innerText = basket.length;
    
    const cont = document.getElementById('cart-items');
    if (!cont) return;

    if (basket.length === 0) {
        cont.innerHTML = "<p style='text-align:center; padding:40px; color:#94a3b8;'>Sepetiniz boş.</p>";
        return;
    }

    let tDK=0, tAWM=0, tTek=0, tNak=0;
    
    let html = `
    <div style="overflow-x:auto; max-height:400px;">
    <table style="width:100%; border-collapse:collapse; font-size:12px; min-width:850px;">
        <thead style="position:sticky; top:0; background:#f8fafc; z-index:10; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
            <tr style="color:#64748b;">
                <th style="padding:12px 10px; text-align:left;">Ürün</th>
                <th>Stok</th><th>D.Kart</th><th>4T AWM</th><th>TekÇekim</th><th>Nakit</th>
                <th>Açıklama</th><th>✕</th>
            </tr>
        </thead>
        <tbody>`;

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

    if (discountAmount > 0) {
        html += `<tr style="color:#e11d48; font-style:italic; background:#fff1f2;">
            <td colspan="2" align="right" style="padding:8px;">İNDİRİM:</td>
            <td>-${calcD(tDK).toLocaleString('tr-TR')}</td><td>-${calcD(tAWM).toLocaleString('tr-TR')}</td>
            <td>-${calcD(tTek).toLocaleString('tr-TR')}</td><td>-${calcD(tNak).toLocaleString('tr-TR')}</td>
            <td colspan="2"></td></tr>`;
    }

    html += `<tr style="background:var(--primary); color:white; font-weight:bold;">
        <td colspan="2" align="right" style="padding:12px;">NET TOPLAM:</td>
        <td>${(tDK - calcD(tDK)).toLocaleString('tr-TR')}</td><td>${(tAWM - calcD(tAWM)).toLocaleString('tr-TR')}</td>
        <td>${(tTek - calcD(tTek)).toLocaleString('tr-TR')}</td><td>${(tNak - calcD(tNak)).toLocaleString('tr-TR')}</td>
        <td colspan="2"></td></tr></tbody></table></div>`;
    
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
