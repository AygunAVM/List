let allProducts = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;

// --- GİRİŞ VE HATIRLAMA ---
async function checkAuth() {
    const u = document.getElementById('user-input').value.trim().toLowerCase();
    const p = document.getElementById('pass-input').value.trim();
    const rem = document.getElementById('remember-check').checked;

    try {
        const res = await fetch('data/kullanicilar.json?t=' + Date.now());
        const users = await res.json();
        const user = users.find(x => x.Email.toLowerCase() === u && x.Sifre === p);

        if (user) {
            localStorage.setItem('aygun_user', JSON.stringify(user));
            if (rem) localStorage.setItem('aygun_rem', JSON.stringify({u, p}));
            else localStorage.removeItem('aygun_rem');
            location.reload();
        } else {
            document.getElementById('login-err').style.display = 'block';
        }
    } catch (e) { alert("Bağlantı Hatası!"); }
}

function logout() {
    localStorage.removeItem('aygun_user');
    location.reload();
}

// --- AKILLI ARAMA (BÜYÜK/KÜÇÜK HARF DUYARSIZ) ---
function filterData() {
    const searchVal = document.getElementById('search').value.toLocaleLowerCase('tr-TR').trim();
    const keywords = searchVal.split(" ").filter(k => k.length > 0);
    
    const filtered = allProducts.filter(item => {
        const itemText = Object.values(item).join(" ").toLocaleLowerCase('tr-TR');
        return keywords.every(kw => itemText.includes(kw));
    });
    renderTable(filtered);
}

// --- VERİ ANALİZİ (MAKRO DEĞİŞİMİNİ YAKALAMA) ---
function analyzeChanges(newData, macroTimestamp) {
    const oldData = JSON.parse(localStorage.getItem('aygun_last_raw')) || [];
    let logs = [];

    if (oldData.length > 0) {
        newData.forEach(newItem => {
            const oldItem = oldData.find(o => o.Kod === newItem.Kod || o.Ürün === newItem.Ürün);
            if (oldItem) {
                let changes = [];
                if (parseInt(oldItem.Stok) !== parseInt(newItem.Stok)) 
                    changes.push(`Stok ${newItem.Stok > oldItem.Stok ? 'arttı' : 'azaldı'} (${oldItem.Stok} -> ${newItem.Stok})`);
                
                const pOld = parseFloat(String(oldItem.Nakit).replace(/[^\d.-]/g, '')) || 0;
                const pNew = parseFloat(String(newItem.Nakit).replace(/[^\d.-]/g, '')) || 0;
                if (pOld !== pNew)
                    changes.push(`Nakit fiyat ${pNew > pOld ? 'arttı' : 'azaldı'} (${pNew.toLocaleString('tr-TR')} ₺)`);

                if (changes.length > 0) logs.push(`• <b>${newItem.Ürün}:</b> ${changes.join(', ')}`);
            }
        });
    }

    if (logs.length > 0) {
        let history = JSON.parse(localStorage.getItem('aygun_change_history')) || [];
        history.unshift({ date: macroTimestamp, list: logs.slice(0, 15) });
        localStorage.setItem('aygun_change_history', JSON.stringify(history.slice(0, 2))); // En fazla 2 kayıt
        localStorage.setItem('aygun_show_alert', 'true');
    }
    localStorage.setItem('aygun_last_raw', JSON.stringify(newData));
}

function showChangeAlert() {
    const shouldShow = localStorage.getItem('aygun_show_alert');
    const history = JSON.parse(localStorage.getItem('aygun_change_history')) || [];
    if (shouldShow === 'true' && history.length > 0) {
        const content = document.getElementById('change-content');
        content.innerHTML = history.map(h => `<div style="margin-bottom:10px;"><small>${h.date}</small><br>${h.list.join('<br>')}</div>`).join('<hr style="margin:10px 0; opacity:0.2;">');
        document.getElementById('change-alert').style.display = 'block';
    }
}

function closeChangeAlert() {
    localStorage.removeItem('aygun_show_alert');
    document.getElementById('change-alert').style.display = 'none';
}

// --- VERİ YÜKLEME ---
async function loadData() {
    try {
        const res = await fetch('data/urunler.json?v=' + Date.now());
        const data = await res.json();
        allProducts = data.urunler || [];
        
        // Versiyon Bilgisi (Makrodan Gelen)
        const macroTime = data.guncelleme_tarihi || "Belirtilmedi";
        document.getElementById('v-tag').innerText = "Versiyon: " + macroTime;

        // Değişim kontrolü (Sadece versiyon metni farklıysa çalışır)
        const lastV = localStorage.getItem('aygun_last_v');
        if (lastV && lastV !== macroTime) {
            analyzeChanges(allProducts, macroTime);
        }
        localStorage.setItem('aygun_last_v', macroTime);

        renderTable(allProducts);
        updateUI();
        showChangeAlert();
    } catch (e) { console.error("Veri hatası:", e); }
}

// --- TABLO RENDER ---
function renderTable(data) {
    const body = document.getElementById('product-list');
    body.innerHTML = data.map(u => `
        <tr>
            <td><button class="add-btn" onclick="addToBasket('${u.Kod}')">+</button></td>
            <td><b>${u.Ürün}</b></td>
            <td class="${parseInt(u.Stok) <= 0 ? 'stok-kritik' : ''}">${u.Stok}</td>
            <td>${u['Diğer Kartlar']}</td>
            <td>${u['4T AWM']}</td>
            <td>${u['Tek Çekim']}</td>
            <td>${u.Nakit}</td>
            <td style="white-space:normal; min-width:200px;">${u.Açıklama}</td>
            <td>${u.Kod}</td>
            <td class="small-text">${u['Ürün Gamı']}</td>
            <td class="small-text">${u.Marka}</td>
        </tr>
    `).join('');
}

// --- SEPET İŞLEMLERİ ---
function addToBasket(kod) {
    const p = allProducts.find(x => x.Kod === kod);
    if(p) {
        basket.push({...p, id: Date.now()});
        save();
    }
}

function save() {
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    updateUI();
}

function clearBasket() { if(confirm("Sepet silinsin mi?")) { basket = []; save(); } }

function updateUI() {
    document.getElementById('cart-count').innerText = basket.length;
    const body = document.getElementById('cart-items');
    if(!body) return;

    let totalNak = 0;
    let html = basket.map((i, idx) => {
        const nakitVal = parseFloat(String(i.Nakit).replace(/[^\d.-]/g, '')) || 0;
        totalNak += nakitVal;
        return `<tr>
            <td>${i.Ürün}</td><td>${i.Stok}</td>
            <td>${i['Diğer Kartlar']}</td><td>${i['4T AWM']}</td>
            <td>${i['Tek Çekim']}</td><td>${i.Nakit}</td>
            <td><small>${i.Açıklama}</small></td>
            <td><button onclick="removeItem(${idx})" style="color:red; background:none; border:none; font-size:1.2rem;">✕</button></td>
        </tr>`;
    }).join('');

    // İndirim Hesaplama
    const dVal = parseFloat(document.getElementById('discount-val')?.value) || 0;
    const dType = document.getElementById('discount-type')?.value;
    const discountAmount = dType === 'PERCENT' ? (totalNak * dVal / 100) : dVal;

    if (discountAmount > 0) {
        html += `<tr class="discount-row">
            <td colspan="5" align="right">İNDİRİM:</td>
            <td>- ${discountAmount.toLocaleString('tr-TR')} ₺</td>
            <td colspan="2"></td>
        </tr>
        <tr style="background:var(--primary); color:white; font-weight:800;">
            <td colspan="5" align="right">NET TOPLAM:</td>
            <td>${(totalNak - discountAmount).toLocaleString('tr-TR')} ₺</td>
            <td colspan="2"></td>
        </tr>`;
    }
    body.innerHTML = html;
}

function removeItem(idx) { basket.splice(idx, 1); save(); }

function toggleCart() {
    const m = document.getElementById('cart-modal');
    m.style.display = (m.style.display === 'flex') ? 'none' : 'flex';
}

// --- WHATSAPP GÖNDERİMİ (ÜLKE KODU DÜZELTİLMİŞ) ---
function sendWhatsApp() {
    let phone = document.getElementById('cust-phone').value.replace(/\D/g, '');
    const name = document.getElementById('cust-name').value;
    const note = document.getElementById('extra-note').value;

    if(!phone || phone.length < 10) { alert("Geçerli bir numara girin!"); return; }
    
    // Ülke kodu ekleme (0 ile başlıyorsa temizle ve 90 ekle)
    if (phone.startsWith('0')) phone = "90" + phone.substring(1);
    else if (!phone.startsWith('90')) phone = "90" + phone;

    let msg = `*Aygün AVM Teklif Formu*\n*Müşteri:* ${name}\n\n*Ürünler:*\n`;
    basket.forEach(i => msg += `• ${i.Ürün} (${i.Nakit})\n`);
    if(note) msg += `\n*Not:* ${note}`;
    msg += `\n\n_Bu bir bilgilendirme teklifidir._`;

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`);
}

// --- BAŞLANGIÇ ---
window.onload = () => {
    const rem = JSON.parse(localStorage.getItem('aygun_rem'));
    if (rem) {
        document.getElementById('user-input').value = rem.u;
        document.getElementById('pass-input').value = rem.p;
        document.getElementById('remember-check').checked = true;
    }
    if (currentUser) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-content').style.display = 'block';
        loadData();
    }
};
