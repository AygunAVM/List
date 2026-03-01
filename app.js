let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0;
let discountType = 'TRY';
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;

// --- DEĞİŞİM ANALİZ MOTORU ---
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
                    currentChanges.push(`<strong>${newItem.Ürün || newItem.Model}</strong>: ${diffs.join(' | ')}`);
                }
            }
        });
    }

    if (currentChanges.length > 0) {
        const time = new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
        const log = { time, list: currentChanges };
        
        // Değişimi kaydet ve sistemden çıkış yap (yeniden girişte uyaracak)
        localStorage.setItem('aygun_change_logs', JSON.stringify([log]));
        localStorage.setItem('aygun_needs_alert', 'true');
        localStorage.removeItem('aygun_user'); 
        location.reload(); 
    }
    
    // Mevcut veriyi bir sonraki kıyas için sakla
    localStorage.setItem('aygun_last_raw_data', JSON.stringify(newData));
}

// --- BİLDİRİM PANELİ ---
function showNotification() {
    const needsAlert = localStorage.getItem('aygun_needs_alert');
    const logs = JSON.parse(localStorage.getItem('aygun_change_logs')) || [];
    
    if (needsAlert === 'true' && logs.length > 0) {
        const lastLog = logs[0];
        const overlay = document.createElement('div');
        overlay.id = 'change-overlay';
        overlay.style = "position:fixed; inset:0; background:rgba(15,23,42,0.8); z-index:10000; display:flex; align-items:center; justify-content:center; padding:20px;";
        
        const modal = document.createElement('div');
        modal.style = "background:white; width:100%; max-width:500px; border-radius:1.5rem; padding:2rem; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); border-top: 10px solid #2563eb; animation: slideUp 0.4s ease-out;";
        
        modal.innerHTML = `
            <div style="text-align:center; margin-bottom:20px;">
                <span style="font-size:3rem;">🔔</span>
                <h2 style="color:#1e293b; margin-top:10px;">Sistem Güncellendi</h2>
                <p style="color:#64748b; font-size:0.9rem;">${lastLog.time} itibarıyla yapılan değişiklikler:</p>
            </div>
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:15px; max-height:250px; overflow-y:auto; font-size:0.85rem; color:#334155;">
                ${lastLog.list.map(item => `<div style="padding:8px 0; border-bottom:1px solid #edf2f7;">${item}</div>`).join('')}
            </div>
            <button onclick="closeAlert()" style="width:100%; background:#2563eb; color:white; padding:15px; border:none; border-radius:12px; font-weight:700; margin-top:20px; cursor:pointer; font-size:1rem; transition: background 0.2s;">DEĞİŞİKLİKLERİ GÖRDÜM</button>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }
}

function closeAlert() {
    localStorage.removeItem('aygun_needs_alert');
    const el = document.getElementById('change-overlay');
    if(el) el.remove();
}

// --- VERİ YÜKLEME ---
async function loadData() {
    try {
        // Cache engellemek için ?v=timestamp ekliyoruz
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const json = await res.json();
        allProducts = Array.isArray(json) ? json : (json.data || []);
        
        const currentDataSize = JSON.stringify(json).length;
        let vData = JSON.parse(localStorage.getItem('aygun_v_state')) || { lastSize: 0 };

        // Eğer boyut değişmişse analizi başlat
        if (vData.lastSize !== 0 && vData.lastSize !== currentDataSize) {
            await analyzeChanges(json);
        }

        const now = new Date();
        vData.lastSize = currentDataSize;
        vData.lastUpdate = `${now.toLocaleDateString('tr-TR')} - ${now.toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'})}`;
        localStorage.setItem('aygun_v_state', JSON.stringify(vData));
        
        document.getElementById('v-tag').innerText = vData.lastUpdate;
        renderTable(allProducts);
        updateUI();
        showNotification(); // Eğer login sonrası uyarı bayrağı varsa göster
    } catch (e) { 
        console.error("Veri yüklenemedi:", e); 
    }
}

// --- GİRİŞ KONTROLÜ ---
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
            location.reload(); 
        } else {
            document.getElementById('login-err').style.display = 'block';
        }
    } catch (e) { alert("Bağlantı hatası!"); }
}

// --- YARDIMCI FONKSİYONLAR ---
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

function updateUI() {
    const cartCount = document.getElementById('cart-count');
    if(cartCount) cartCount.innerText = basket.length;
    // (Diğer Sepet Tablo kodlarını bozmamak için burayı sade bıraktım, eski updateUI aynen kalabilir)
}

function toggleCart() {
    const m = document.getElementById('cart-modal');
    if(m) m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
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
