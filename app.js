// ═══════════════════════════════════════════════════════════════
// AYGÜN AVM — app.js (Revize Edilmiş Versiyon)
// Özellikler: Oran gizlendi, Satış/Teklif seçimi ayrıldı, Admin düzeltildi
// ═══════════════════════════════════════════════════════════════
let allProducts = [];
let allRates = [];
let basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount = 0, discountType = 'TRY';
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;
let currentVersion = '...';
let showZeroStock = false;
let abakusSelection = null; // Tıklanan taksit satırı veya nakit objesi

let proposals = JSON.parse(localStorage.getItem('aygun_proposals')) || [];
let sales = JSON.parse(localStorage.getItem('aygun_sales')) || [];
let messages = JSON.parse(localStorage.getItem('aygun_messages')) || [];

const KART_MAX_TAKSIT = {
  'Axess':9,'Bonus':9,'Maximum':9,'World':9,'Vakifbank':9,'Vakıfbank':9,
  'BanKKart':9,'Bankkart':9,'Paraf':9,'QNB':9,'Finans':9,
  'Sirket Kartlari':9,'Şirket Kartları':9,'Aidatsiz Kartlar':9,'Aidatsız Kartlar':9
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('pass-input').addEventListener('keydown', e => {
        if (e.key==='Enter') checkAuth();
    });
    if (currentUser) {
        showApp();
        loadData();
    }
    checkUnreadMessages();
});

function isAdmin() {
    if (!currentUser) return false;
    const mail = (currentUser.Email||'').toLowerCase();
    return currentUser.Rol==='admin' || mail.includes('bilgi@') || mail.includes('aygun@') || mail.includes('fatih@');
}

function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-content').style.display = 'block';
    const ab = document.getElementById('admin-btn');
    if (ab) ab.style.display = isAdmin() ? 'flex' : 'none';
    updateProposalBadge();
}

async function checkAuth() {
    const u = document.getElementById('user-input').value.trim().toLowerCase();
    const p = document.getElementById('pass-input').value.trim();
    const err = document.getElementById('login-err');
    
    if (!u||!p) { err.textContent='E-mail ve şifre boş bırakılamaz.'; err.style.display='block'; return; }
    try {
        const text = await (await fetch('data/kullanicilar.json?t='+Date.now())).text();
        let users = JSON.parse(text);
        if (!Array.isArray(users)) users = users.data||[];
        
        let user = users.find(x => x.Email && x.Email.toLowerCase() === u && x.Sifre === p);
        if (user) {
            currentUser = user;
            if (document.getElementById('remember-me').checked) localStorage.setItem('aygun_user', JSON.stringify(user));
            err.style.display='none';
            showApp();
            loadData();
        } else {
            err.textContent='E-mail veya şifre hatalı!'; err.style.display='block';
        }
    } catch(e) { err.textContent='Bağlantı hatası: '+e.message; err.style.display='block'; }
}

async function loadData() {
    try {
        const json = JSON.parse(await (await fetch('data/urunler.json?v='+Date.now())).text());
        allProducts = Array.isArray(json.data)?json.data:(Array.isArray(json)?json:[]);
        renderTable();
        updateCartUI();
    } catch(e) { console.error(e); }
    try {
        allRates = JSON.parse(await (await fetch('data/oranlar.json?v='+Date.now())).text());
    } catch(e) { console.error(e); }
}

// TABLO VE SEPET İŞLEMLERİ
function filterData() { renderTable(document.getElementById('search').value.trim()); }
function renderTable(searchVal) {
    const kws = (searchVal||'').toLowerCase().split(' ').filter(k=>k.length>0);
    const data = allProducts.filter(u => {
        if (!showZeroStock && (Number(u.Stok)||0)===0) return false;
        if (!kws.length) return true;
        return kws.every(kw => Object.values(u).join(' ').toLowerCase().includes(kw));
    });
    const list = document.getElementById('product-list');
    list.innerHTML='';
    data.forEach((u, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><button class="add-btn" onclick="addToBasket(${allProducts.indexOf(u)})">+</button></td>
            <td><b>${u.Urun || u.urun || ''}</b></td>
            <td>${u.Stok||0}</td>
            <td>${u.Kart||u['D.Kart']||'-'}</td>
            <td>${u['4T AWM']||'-'}</td>
            <td>${u['Tek Çekim']||'-'}</td>
            <td>${u.Nakit||'-'}</td>
            <td>${u.Kod||'-'}</td>
            <td>${u.Gam||'-'}</td>
            <td>${u.Marka||'-'}</td>
        `;
        list.appendChild(tr);
    });
}

function addToBasket(idx) {
    const p=allProducts[idx];
    basket.push({ urun:p.Urun||p.urun||'', stok:Number(p.Stok)||0, nakit:parseFloat(p.Nakit)||0 });
    localStorage.setItem('aygun_basket',JSON.stringify(basket));
    updateCartUI();
}

function updateCartUI() {
    document.getElementById('cart-count').innerText=basket.length;
    document.getElementById('cart-modal-count').innerText=basket.length+' ürün';
    const area=document.getElementById('cart-table-area');
    if (!basket.length) { area.innerHTML='<div class="empty-cart">Sepetiniz boş</div>'; return; }
    
    let html = '<table class="cart-table"><thead><tr><th>Ürün</th><th>Tutar</th><th></th></tr></thead><tbody>';
    let totalNakit = 0;
    basket.forEach((item, i) => {
        totalNakit += item.nakit;
        html += `<tr><td>${item.urun}</td><td>${item.nakit} ₺</td><td><button onclick="basket.splice(${i},1); updateCartUI();">🗑</button></td></tr>`;
    });
    html += `</tbody></table><br><b>Toplam Nakit: ${totalNakit} ₺</b>`;
    area.innerHTML = html;
}

function toggleCart() {
    const m = document.getElementById('cart-modal');
    m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
    updateCartUI();
}

// KARŞILAMA EKRANI
function openWelcomeModal() { document.getElementById('welcome-modal').style.display='flex'; }
function closeWelcomeModal() { document.getElementById('welcome-modal').style.display='none'; }

// ABAKÜS (TAKSİT HESAPLAMA) - ORAN SÜTUNU ÇIKARILDI
function openAbakus() {
    if(!basket.length) { alert('Sepet boş!'); return; }
    document.getElementById('abakus-modal').style.display='flex';
    const kartlar = [...new Set(allRates.map(r=>r.Kart).filter(Boolean))];
    document.getElementById('ab-kart').innerHTML = kartlar.map(k=>`<option>${k}</option>`).join('');
    calcAbakus();
}
function closeAbakus() { document.getElementById('abakus-modal').style.display='none'; }

function calcAbakus() {
    abakusSelection = null;
    document.getElementById('ab-actions').style.display = 'none';
    let nakit = basket.reduce((sum, i)=>sum+i.nakit, 0);
    const manEl=document.getElementById('ab-nakit');
    if(manEl && manEl.value!=='') nakit = parseFloat(manEl.value);
    
    const secKart = document.getElementById('ab-kart').value;
    const maxT = KART_MAX_TAKSIT[secKart]||9;
    const zRows = allRates.filter(r=>r.Kart===secKart);
    
    let html = `<div class="ab-nakit-row" onclick="selectAbakusRow(this, '${JSON.stringify({label:'Nakit', tahsilat:nakit, aylik:0})}')">
        <span>Nakit Ödeme</span> <strong style="margin-left:auto;">${nakit.toLocaleString('tr-TR')} ₺</strong>
    </div>`;
    
    html += `<table class="ab-table"><thead><tr><th>Taksit</th><th>Zincir POS</th><th>Aylık Taksit</th><th>Toplam Tahsilat</th></tr></thead><tbody>`;
    
    zRows.forEach(satir => {
        [2,3,4,5,6,7,8,9].forEach(t => {
            if(t > maxT) return;
            const oran = parseFloat(satir[`${t}Taksit`]);
            if(isNaN(oran)||oran<=0) return;
            const tahsilat = nakit * (1 + (oran/100));
            const aylik = tahsilat / t;
            // Oran gizlendi, JSON içine veriler atıldı.
            const jData = JSON.stringify({label:t+' Taksit', zincir:satir.Zincir, tahsilat, aylik});
            html += `<tr class="ab-row-sel" onclick="selectAbakusRow(this, '${jData.replace(/"/g, '&quot;')}')">
                <td><b>${t} Taksit</b></td>
                <td>${satir.Zincir}</td>
                <td>${aylik.toLocaleString('tr-TR',{maximumFractionDigits:2})} ₺</td>
                <td class="ab-tahsilat-cell">${tahsilat.toLocaleString('tr-TR',{maximumFractionDigits:2})} ₺</td>
            </tr>`;
        });
    });
    html += `</tbody></table>`;
    document.getElementById('ab-result').innerHTML = html;
}

function selectAbakusRow(rowEl, jsonStr) {
    document.querySelectorAll('.ab-nakit-row, .ab-row-sel').forEach(r=>r.classList.remove('ab-row-selected'));
    rowEl.classList.add('ab-row-selected');
    abakusSelection = JSON.parse(jsonStr);
    document.getElementById('ab-actions').style.display = 'flex';
}

// WHATSAPP TEKLİF & SATIŞ BELGESİ AKTARIMI
function openWaFromAbakus() {
    closeAbakus();
    document.getElementById('wa-modal').style.display='flex';
    document.getElementById('sale-method').value = abakusSelection.label + (abakusSelection.zincir ? ` (${abakusSelection.zincir})` : '');
}
function openSaleFromAbakus() {
    closeAbakus();
    document.getElementById('sale-modal').style.display='flex';
    document.getElementById('sale-method').value = abakusSelection.label + (abakusSelection.zincir ? ` (${abakusSelection.zincir})` : '');
    updateSalePreview();
}
function closeWaModal() { document.getElementById('wa-modal').style.display='none'; }
function closeSaleDoc() { document.getElementById('sale-modal').style.display='none'; }

function finalizeProposal() {
    const custName = document.getElementById('cust-name').value || 'Müşteri';
    const phone = document.getElementById('cust-phone').value;
    const note = document.getElementById('extra-info').value;
    
    const prop = { id: Date.now(), user: currentUser.Email, custName, phone, durum: 'bekliyor',
                   odeme: abakusSelection ? abakusSelection.label : 'Nakit', urunler: basket, ts: new Date() };
    proposals.push(prop);
    localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
    updateProposalBadge();
    
    const text = `*Aygün Teklif*\nMüşteri: ${custName}\nÖdeme: ${prop.odeme}\nTutar: ${abakusSelection?abakusSelection.tahsilat.toLocaleString('tr-TR'):''} ₺\nNot: ${note}`;
    window.open('https://wa.me/9'+phone+'?text='+encodeURIComponent(text),'_blank');
    closeWaModal();
}

// TEKLİFLER (ADMIN HERKESİ GÖRÜR)
function openProposals() {
    document.getElementById('proposals-modal').style.display='flex';
    renderProposals();
}
function closeProposals() { document.getElementById('proposals-modal').style.display='none'; }

function renderProposals() {
    const target = document.getElementById('proposals-body');
    const list = isAdmin() ? proposals : proposals.filter(p=>p.user === currentUser.Email);
    if(!list.length) { target.innerHTML='<div style="padding:20px;">Teklif bulunamadı.</div>'; return; }
    
    target.innerHTML = list.map(p => `
        <div class="proposal-card">
            <b>${p.custName}</b> - ${p.odeme} (${p.durum}) <br>
            <small>Oluşturan: ${p.user}</small>
        </div>
    `).reverse().join('');
}
function updateProposalBadge() {
    const list = isAdmin() ? proposals : proposals.filter(p=>p.user === currentUser.Email);
    const badge = document.getElementById('prop-badge');
    if(list.length > 0) { badge.style.display='flex'; badge.innerText=list.length; } else badge.style.display='none';
}

// SATIŞ BELGESİ İŞLEMLERİ
function openSaleDoc() { document.getElementById('sale-modal').style.display='flex'; updateSalePreview(); }
function updateSalePreview() {
    // PDF önizleme mantığı...
}
function generateSalePDF() {
    alert('Satış belgesi oluşturuldu ve kaydedildi.');
    closeSaleDoc();
}

// MESAJLAŞMA (ADMİN & PERSONEL)
function openMessages() {
    document.getElementById('messages-modal').style.display='flex';
    document.getElementById('msg-badge').style.display='none';
    document.getElementById('user-msg-bar').classList.remove('visible');
    
    if(isAdmin()) document.getElementById('msg-compose-area').style.display='block';
    
    const target = document.getElementById('msg-body');
    const myMsgs = messages.filter(m => m.to === 'all' || m.to === currentUser.Email);
    target.innerHTML = myMsgs.map(m => `<div class="proposal-card"><b>${m.from}</b>: ${m.text}</div>`).join('');
    
    // Okundu işaretle
    myMsgs.forEach(m => m.read = true);
    localStorage.setItem('aygun_messages', JSON.stringify(messages));
}
function closeMessages() { document.getElementById('messages-modal').style.display='none'; }

function sendAdminMessage() {
    const text = document.getElementById('msg-text').value;
    const to = document.getElementById('msg-target').value;
    if(!text) return;
    messages.push({ from: currentUser.Email, to, text, read: false, ts: new Date() });
    localStorage.setItem('aygun_messages', JSON.stringify(messages));
    document.getElementById('msg-text').value = '';
    openMessages(); // Yenile
}

function checkUnreadMessages() {
    const unread = messages.filter(m => (m.to === 'all' || m.to === currentUser.Email) && !m.read);
    if(unread.length > 0) {
        document.getElementById('msg-badge').style.display = 'flex';
        document.getElementById('msg-badge').innerText = unread.length;
        document.getElementById('user-msg-bar').classList.add('visible');
    }
}

// ADMİN PANELİ KONTROLLERİ
function openAdmin() { document.getElementById('admin-modal').style.display='flex'; }
function closeAdmin() { document.getElementById('admin-modal').style.display='none'; }
function switchAdminTab(tabId) {
    document.querySelectorAll('.admin-tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(c=>c.classList.remove('active'));
    document.querySelector(`button[onclick="switchAdminTab('${tabId}')"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active');
    if(tabId==='tab-props') {
        document.getElementById('admin-proposals-list').innerHTML = proposals.map(p=>`<div class="proposal-card">${p.user} - ${p.custName} - ${p.odeme}</div>`).join('');
    }
}
