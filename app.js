let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0;
let discountType = 'TRY';
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;

// --- GÜNCELLEME ANALİZİ ---
function analyzeChanges(newData) {
    const oldData = JSON.parse(localStorage.getItem('aygun_last_raw_data')) || [];
    let currentChanges = [];

    if (oldData.length > 0) {
        newData.forEach(newItem => {
            const oldItem = oldData.find(o => (o.Ürün || o.Model) === (newItem.Ürün || newItem.Model));
            if (oldItem) {
                let diffs = [];
                const sOld = parseInt(oldItem.Stok) || 0;
                const sNew = parseInt(newItem.Stok) || 0;
                if (sOld !== sNew) diffs.push(`Stok: ${sOld} → ${sNew}`);

                const pOld = cleanPrice(oldItem.Nakit);
                const pNew = cleanPrice(newItem.Nakit);
                if (pOld !== pNew && pOld > 0) diffs.push(`Nakit: ${pOld.toLocaleString('tr-TR')} → ${pNew.toLocaleString('tr-TR')} ₺`);

                if (oldItem.Açıklama !== newItem.Açıklama) diffs.push(`Açıklama değişti`);

                if (diffs.length > 0) {
                    currentChanges.push(`<b>${newItem.Ürün || newItem.Model}</b><br>${diffs.join(' | ')}`);
                }
            }
        });
    }

    if (currentChanges.length > 0) {
        // Yeni bir değişim var! Günlüğü kaydet ve sistemi giriş ekranına zorla
        const time = new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
        const log = { time, list: currentChanges.slice(0, 10) }; // Son 10 değişimi al
        
        let allLogs = JSON.parse(localStorage.getItem('aygun_change_logs')) || [];
        allLogs.unshift(log);
        localStorage.setItem('aygun_change_logs', JSON.stringify(allLogs.slice(0, 3)));
        
        // KRİTİK: Veri değiştiği için kullanıcıyı logout yapıyoruz
        localStorage.removeItem('aygun_user'); 
        localStorage.setItem('aygun_needs_alert', 'true'); // Tekrar girdiğinde uyarı çıkması için işaretle
        location.reload(); 
    }
    
    localStorage.setItem('aygun_last_raw_data', JSON.stringify(newData));
}

// --- BİLDİRİM POPUP ---
function showNotification() {
    const needsAlert = localStorage.getItem('aygun_needs_alert');
    const logs = JSON.parse(localStorage.getItem('aygun_change_logs')) || [];
    
    if (needsAlert === 'true' && logs.length > 0) {
        const lastLog = logs[0];
        let popup = document.createElement('div');
        popup.id = 'change-popup';
        popup.style = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: white; padding: 2rem; border-radius: 1.5rem; z-index: 10000;
            width: 90%; max-width: 450px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
            font-family: 'Inter', sans-serif; border-top: 6px solid #2563eb;
            animation: slideIn 0.4s ease-out;
        `;
        popup.innerHTML = `
            <h3 style="margin-bottom:15px; color:#1e293b; display:flex; align-items:center; gap:10px;">
                🔔 Veri Güncellendi (${lastLog.time})
            </h3>
            <div style="font-size:0.85rem; color:#475569; max-height:300px; overflow-y:auto; margin-bottom:20px; border:1px solid #f1f5f9; padding:10px; border-radius:8px; background:#f8fafc;">
                ${lastLog.list.map(item => `<div style="margin-bottom:10px; padding-bottom:5px; border-bottom:1px solid #e2e8f0;">${item}</div>`).join('')}
            </div>
            <button onclick="closeAlert()" style="width:100%; background:#1e293b; color:white; padding:12px; border:none; border-radius:10px; font-weight:700; cursor:pointer;">DEĞİŞİKLİKLERİ ANLADIM</button>
        `;
        document.body.appendChild(popup);
        
        // Karartma perdesi
        let overlay = document.createElement('div');
        overlay.id = 'alert-overlay';
        overlay.style = "position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:9999;";
        document.body.appendChild(overlay);
    }
}

function closeAlert() {
    localStorage.removeItem('aygun_needs_alert');
    document.getElementById('change-popup').remove();
    document.getElementById('alert-overlay').remove();
}

// --- AUTH SİSTEMİ ---
async function checkAuth() {
    const u = document.getElementById('user-input').value.trim().toLowerCase();
    const p = document.getElementById('pass-input').value.trim();
    const remember = document.getElementById('remember-check').checked;

    if(!u || !p) { alert("Lütfen bilgileri doldurun."); return; }
    
    try {
        const res = await fetch('data/kullanicilar.json?t=' + Date.now());
        const users = await res.json();
        const user = users.find(x => x.Email.toLowerCase() === u && x.Sifre === p);
        
        if (user) {
            currentUser = user;
            localStorage.setItem('aygun_user', JSON.stringify(user));
            
            if (remember) {
                localStorage.setItem('aygun_remembered', JSON.stringify({ u, p }));
            } else {
                localStorage.removeItem('aygun_remembered');
            }

            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('app-content').style.display = 'block';
            loadData();
        } else {
            document.getElementById('login-err').style.display = 'block';
        }
    } catch (e) { alert("Bağlantı hatası!"); }
}

function logout() {
    localStorage.removeItem('aygun_user');
    location.reload();
}

// --- VERİ YÜKLEME ---
async function loadData() {
    try {
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        const currentDataSize = JSON.stringify(json).length;
        
        allProducts = Array.isArray(json) ? json : (json.data || []);
        
        // Versiyon ve Değişim Kontrolü
        let vData = JSON.parse(localStorage.getItem('aygun_v_state')) || { lastSize: 0, lastUpdate: "..." };
        if (vData.lastSize !== currentDataSize) {
            analyzeChanges(json);
            const now = new Date();
            vData.lastSize = currentDataSize;
            vData.lastUpdate = `${now.toLocaleDateString('tr-TR', {day:'2-digit', month:'2-digit', year:'2-digit'})} - ${now.toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'})}`;
            localStorage.setItem('aygun_v_state', JSON.stringify(vData));
        }

        document.getElementById('v-tag').innerText = vData.lastUpdate;
        renderTable(allProducts);
        updateUI();
        showNotification(); // Varsa değişimi göster
    } catch (e) { console.error("Yükleme hatası."); }
}

// --- DİĞER FONKSİYONLAR (Dokunulmadı) ---
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
            <td><button class="add-btn" onclick="addToBasket(${allProducts.indexOf(u)})">+</button></td>
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
    if(confirm("Sepeti temizlemek istediğinize emin misiniz?")) {
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
    const cartCount = document.getElementById('cart-count');
    if(cartCount) cartCount.innerText = basket.length;
    
    const cont = document.getElementById('cart-items');
    if (!cont) return;

    if (basket.length === 0) {
        cont.innerHTML = "<p style='text-align:center; padding:40px; color:#94a3b8;'>Sepetiniz şu an boş.</p>";
        return;
    }

    let tDK=0, tAWM=0, tTek=0, tNak=0;
    let html = `
    <div style="overflow-x:auto;">
    <table style="width:100%; border-collapse:collapse; font-size:12px; min-width:850px;">
        <thead>
            <tr style="color:#64748b;">
                <th style="padding:12px 10px; text-align:left;">Ürün Tanımı</th>
                <th>Stok</th><th>D.Kart</th><th>4T AWM</th><th>TekÇekim</th><th>Nakit</th>
                <th>Açıklama</th><th style="width:40px">✕</th>
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
            <td><button onclick="removeFromBasket(${idx})" style="color:#e11d48; background:none; border:none; cursor:pointer; font-size:18px;">✕</button></td>
        </tr>`;
    });

    const calcD = (total) => discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);

    if (discountAmount > 0) {
        html += `<tr style="color:#e11d48; font-style:italic; background:#fff1f2;">
            <td colspan="2" align="right" style="padding:8px;">UYGULANAN İNDİRİM:</td>
            <td>-${calcD(tDK).toLocaleString('tr-TR')}</td><td>-${calcD(tAWM).toLocaleString('tr-TR')}</td>
            <td>-${calcD(tTek).toLocaleString('tr-TR')}</td><td>-${calcD(tNak).toLocaleString('tr-TR')}</td>
            <td colspan="2"></td></tr>`;
    }

    html += `<tr style="background:#2563eb; color:white; font-weight:bold;">
        <td colspan="2" align="right" style="padding:12px;">NET ÖDENECEK:</td>
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
    const extra = document.getElementById('extra-info').value.trim();
    
    if (!name || !phone) { alert("Lütfen müşteri adı ve telefonunu giriniz."); return; }

    let msg = `*aygün® MÜŞTERİ TEKLİFİ*\n*Müşteri:* ${name}\n*Tel:* ${phone}\n\n*Ürün Detayları:*\n`;
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
    if(selectedPrices.includes('dk')) msg += `Diğer Kart: ${(tDK - calcD(tDK)).toLocaleString('tr-TR')} ₺\n`;

    if (discountAmount > 0) msg += `\n_(İndirim uygulanmıştır)_`;
    if(extra) msg += `\n\n*Not:* ${extra}`;

    window.open(`https://wa.me/${phone.replace(/\s/g, '')}?text=${encodeURIComponent(msg)}`);
}

// SAYFA AÇILIŞINDA ÇALIŞACAK
window.onload = () => {
    // Beni Hatırla Kontrolü
    const remembered = JSON.parse(localStorage.getItem('aygun_remembered'));
    if (remembered) {
        document.getElementById('user-input').value = remembered.u;
        document.getElementById('pass-input').value = remembered.p;
        document.getElementById('remember-check').checked = true;
    }

    if (currentUser) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-content').style.display = 'block';
        loadData();
    }
};
