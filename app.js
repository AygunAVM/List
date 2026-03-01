let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0;
let discountType = 'TRY';
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;

// --- GÜNCELLEME ANALİZİ (ZEKA) ---
async function analyzeChanges(newData) {
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

                if (oldItem.Açıklama !== newItem.Açıklama) diffs.push(`Açıklama güncellendi`);

                if (diffs.length > 0) {
                    currentChanges.push(`<b>${newItem.Ürün || newItem.Model}</b>: ${diffs.join(' | ')}`);
                }
            }
        });
    }

    if (currentChanges.length > 0) {
        const time = new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
        const log = { time, list: currentChanges };
        
        let allLogs = JSON.parse(localStorage.getItem('aygun_change_logs')) || [];
        allLogs.unshift(log);
        localStorage.setItem('aygun_change_logs', JSON.stringify(allLogs.slice(0, 3)));
        
        // Veri değiştiyse: Kullanıcıyı login'e at ve uyarıyı kur
        localStorage.setItem('aygun_needs_alert', 'true');
        localStorage.removeItem('aygun_user'); 
        location.reload(); 
    }
    
    localStorage.setItem('aygun_last_raw_data', JSON.stringify(newData));
}

// --- BİLDİRİM PANELİ ---
function showNotification() {
    const needsAlert = localStorage.getItem('aygun_needs_alert');
    const logs = JSON.parse(localStorage.getItem('aygun_change_logs')) || [];
    
    if (needsAlert === 'true' && logs.length > 0) {
        const lastLog = logs[0];
        let popup = document.createElement('div');
        popup.id = 'change-popup';
        popup.style = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: white; padding: 2rem; border-radius: 1.5rem; z-index: 10001;
            width: 90%; max-width: 500px; box-shadow: 0 0 0 1000px rgba(0,0,0,0.7), 0 25px 50px rgba(0,0,0,0.5);
            font-family: 'Inter', sans-serif; border-top: 8px solid #2563eb;
        `;
        popup.innerHTML = `
            <h2 style="margin-bottom:15px; color:#1e293b; font-size:1.4rem;">🔔 Güncelleme Tespit Edildi!</h2>
            <p style="font-size:0.8rem; color:#64748b; margin-bottom:15px;">Son güncelleme saati: ${lastLog.time}</p>
            <div style="font-size:0.9rem; color:#334155; max-height:300px; overflow-y:auto; margin-bottom:20px; background:#f8fafc; padding:15px; border-radius:10px; border:1px solid #e2e8f0;">
                ${lastLog.list.map(item => `<div style="margin-bottom:10px; padding-bottom:5px; border-bottom:1px solid #cbd5e1;">${item}</div>`).join('')}
            </div>
            <button onclick="closeAlert()" style="width:100%; background:#2563eb; color:white; padding:15px; border:none; border-radius:12px; font-weight:700; cursor:pointer; font-size:1rem;">TAMAM, DEĞİŞİKLİKLERİ GÖRDÜM</button>
        `;
        document.body.appendChild(popup);
    }
}

function closeAlert() {
    localStorage.removeItem('aygun_needs_alert');
    const p = document.getElementById('change-popup');
    if(p) p.remove();
}

// --- AUTH ---
async function checkAuth() {
    const u = document.getElementById('user-input').value.trim().toLowerCase();
    const p = document.getElementById('pass-input').value.trim();
    const remember = document.getElementById('remember-check').checked;

    if(!u || !p) return;
    
    try {
        const res = await fetch('data/kullanicilar.json?t=' + Date.now());
        const users = await res.json();
        const user = users.find(x => x.Email.toLowerCase() === u && x.Sifre === p);
        
        if (user) {
            localStorage.setItem('aygun_user', JSON.stringify(user));
            if (remember) localStorage.setItem('aygun_remembered', JSON.stringify({ u, p }));
            else localStorage.removeItem('aygun_remembered');
            location.reload(); // Sayfayı yenileyerek temiz yükleme yap
        } else {
            document.getElementById('login-err').style.display = 'block';
        }
    } catch (e) { alert("Sistem hatası!"); }
}

// --- VERİ YÜKLEME ---
async function loadData() {
    try {
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        allProducts = Array.isArray(json) ? json : (json.data || []);
        
        // Önce değişim var mı bak
        const currentDataSize = JSON.stringify(json).length;
        let vData = JSON.parse(localStorage.getItem('aygun_v_state')) || { lastSize: 0 };

        if (vData.lastSize !== 0 && vData.lastSize !== currentDataSize) {
            await analyzeChanges(json);
        }

        // Versiyon bilgisini güncelle
        const now = new Date();
        vData.lastSize = currentDataSize;
        vData.lastUpdate = `${now.toLocaleDateString('tr-TR')} - ${now.toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'})}`;
        localStorage.setItem('aygun_v_state', JSON.stringify(vData));
        document.getElementById('v-tag').innerText = vData.lastUpdate;

        renderTable(allProducts);
        updateUI();
        showNotification(); // Varsa uyarıyı göster
    } catch (e) { console.error("Veri hatası."); }
}

// --- STANDART FONKSİYONLAR ---
function cleanPrice(v) {
    if (!v) return 0;
    let c = String(v).replace(/\s/g, '').replace(/[.₺]/g, '').replace(',', '.');
    return isNaN(parseFloat(c)) ? 0 : parseFloat(c);
}

function filterData() {
    const val = document.getElementById('search').value.toLowerCase().trim();
    const filtered = allProducts.filter(u => Object.values(u).join(" ").toLowerCase().includes(val));
    renderTable(filtered);
}

function renderTable(data) {
    const list = document.getElementById('product-list');
    if(!list) return;
    list.innerHTML = data.map(u => `
        <tr>
            <td><button class="add-btn" onclick="addToBasket(${allProducts.indexOf(u)})">+</button></td>
            <td><b>${u.Ürün || u.Model || '-'}</b></td>
            <td class="${parseInt(u.Stok) <= 0 ? 'stok-kritik' : 'stok-bol'}">${u.Stok || 0}</td>
            <td>${cleanPrice(u['Diğer Kartlar']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u['4T AWM']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u['Tek Çekim']).toLocaleString('tr-TR')}</td>
            <td>${cleanPrice(u.Nakit).toLocaleString('tr-TR')}</td>
            <td><small>${u.Açıklama || '-'}</small></td>
            <td><small>${u.Kod || ''}</small></td>
            <td>${u['Ürün Gamı'] || '-'}</td>
            <td>${u.Marka || '-'}</td>
        </tr>`).join('');
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

function save() {
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    updateUI();
}

function removeFromBasket(index) {
    basket.splice(index, 1);
    save();
}

function clearBasket() {
    if(confirm("Sepet temizlensin mi?")) { basket = []; save(); }
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
    if (!cont || basket.length === 0) { 
        if(cont) cont.innerHTML = "<p style='text-align:center; padding:20px;'>Sepetiniz boş.</p>"; 
        return; 
    }

    let tDK=0, tAWM=0, tTek=0, tNak=0;
    let html = `<table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead style="position:sticky; top:0; background:#f8fafc; z-index:10;">
            <tr><th>Ürün</th><th>Stok</th><th>D.Kart</th><th>4T AWM</th><th>TekÇekim</th><th>Nakit</th><th>Açıklama</th><th>✕</th></tr>
        </thead><tbody>`;

    basket.forEach((i, idx) => {
        tDK+=i.dk; tAWM+=i.awm; tTek+=i.tek; tNak+=i.nakit;
        html += `<tr style="border-bottom:1px solid #f1f5f9;">
            <td>${i.urun}</td><td>${i.stok}</td>
            <td>${i.dk.toLocaleString('tr-TR')}</td><td>${i.awm.toLocaleString('tr-TR')}</td>
            <td>${i.tek.toLocaleString('tr-TR')}</td><td>${i.nakit.toLocaleString('tr-TR')}</td>
            <td><small>${i.aciklama}</small></td>
            <td><button onclick="removeFromBasket(${idx})" style="color:red; background:none; border:none; cursor:pointer;">✕</button></td>
        </tr>`;
    });

    const calcD = (t) => discountType === 'TRY' ? discountAmount : (t * discountAmount / 100);
    
    if (discountAmount > 0) {
        html += `<tr style="color:red; font-style:italic;">
            <td colspan="2" align="right">İndirim:</td>
            <td>-${calcD(tDK).toLocaleString('tr-TR')}</td><td>-${calcD(tAWM).toLocaleString('tr-TR')}</td>
            <td>-${calcD(tTek).toLocaleString('tr-TR')}</td><td>-${calcD(tNak).toLocaleString('tr-TR')}</td><td colspan="2"></td></tr>`;
    }

    html += `<tr style="background:#2563eb; color:white; font-weight:bold;">
        <td colspan="2" align="right">TOPLAM:</td>
        <td>${(tDK - calcD(tDK)).toLocaleString('tr-TR')}</td><td>${(tAWM - calcD(tAWM)).toLocaleString('tr-TR')}</td>
        <td>${(tTek - calcD(tTek)).toLocaleString('tr-TR')}</td><td>${(tNak - calcD(tNak)).toLocaleString('tr-TR')}</td><td colspan="2"></td></tr></tbody></table>`;
    cont.innerHTML = html;
}

function toggleCart() {
    const m = document.getElementById('cart-modal');
    if(m) m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
}

function finalizeProposal() {
    const name = document.getElementById('cust-name').value.trim();
    const phone = document.getElementById('cust-phone').value.trim();
    if (!name || !phone) { alert("Bilgileri girin!"); return; }
    let msg = `*aygün® TEKLİF*\n*Müşteri:* ${name}\n\n*Ürünler:*\n`;
    basket.forEach(i => { msg += `• ${i.urun}\n`; });
    const tNak = basket.reduce((a,b)=>a+b.nakit,0);
    const d = discountType === 'TRY' ? discountAmount : (tNak * discountAmount / 100);
    msg += `\n*Nakit Toplam:* ${(tNak - d).toLocaleString('tr-TR')} ₺`;
    window.open(`https://wa.me/${phone.replace(/\s/g, '')}?text=${encodeURIComponent(msg)}`);
}

window.onload = () => {
    const remembered = JSON.parse(localStorage.getItem('aygun_remembered'));
    if (remembered) {
        document.getElementById('user-input').value = remembered.u;
        document.getElementById('pass-input').value = remembered.p;
        document.getElementById('remember-check').checked = true;
    }
    const user = JSON.parse(localStorage.getItem('aygun_user'));
    if (user) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-content').style.display = 'block';
        loadData();
    }
};
