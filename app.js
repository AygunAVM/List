// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — Full Integrated app.js (v1.0.2)
// ═══════════════════════════════════════════════════════════════

// ─── 1. AYARLAR & GLOBAL STATE ────────────────────────────────
const GITHUB_TOKEN   = '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'; // Private Repoda Güvenlidir
const GITHUB_REPO    = 'AygunAVM/List';
const KOMISYON_ESIGI = 13.0; // %13 altı "Karlı/Uygun" kabul edilir

let allProducts     = [];
let allRates        = [];
let basket          = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let discountAmount  = 0, discountType = 'TRY';
let currentUser     = JSON.parse(localStorage.getItem('aygun_user')) || null;
let currentVersion  = '1.0.2';
let abakusSelection = null;
let showZeroStock   = false;

// Veritabanı (Local + Sync)
let proposals = JSON.parse(localStorage.getItem('aygun_proposals')) || [];
let sales     = JSON.parse(localStorage.getItem('aygun_sales'))     || [];
let messages  = JSON.parse(localStorage.getItem('aygun_messages'))  || [];

const KART_MAX_TAKSIT = {
 'Axess':9,'Bonus':9,'Maximum':9,'World':9,'Vakifbank':9,'Vakıfbank':9,
 'BanKKart':9,'Bankkart':9,'Paraf':9,'QNB':9,'Finans':9,
 'Sirket Kartlari':9,'Şirket Kartları':9,'Aidatsiz Kartlar':9,'Aidatsız Kartlar':9
};

// ─── 2. YARDIMCI FONKSİYONLAR ─────────────────────────────────
const haptic = (ms) => { if (navigator.vibrate) navigator.vibrate(ms || 18); };
const fmt = (val) => { 
    const n = parseFloat(val); 
    return isNaN(n) ? (val || '-') : n.toLocaleString('tr-TR') + ' ₺'; 
};
const norm = (s) => (s||'').toLowerCase().replace(/[ğĞ]/g,'g').replace(/[üÜ]/g,'u').replace(/[şŞ]/g,'s').replace(/[ıİ]/g,'i').replace(/[öÖ]/g,'o').replace(/[çÇ]/g,'c');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const yuvarlaCeyrek = (n) => Math.ceil(n / 250) * 250;

// ─── 3. BULUT SENKRONİZASYONU ────────────────────────────────
async function syncWithCloud(path, data, commitMsg) {
    if (!GITHUB_TOKEN || GITHUB_TOKEN.includes('Token')) return;
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
    try {
        const res = await fetch(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
        const file = await res.json();
        const sha = file.sha;

        await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: commitMsg,
                content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
                sha: sha
            })
        });
    } catch (e) { console.error("Sync Hatası:", e); }
}

// ─── 4. VERİ YÜKLEME & TABLO ──────────────────────────────────
async function loadData() {
    try {
        const pRes = await fetch(`data/urunler.json?v=${Date.now()}`);
        const pJson = await pRes.json();
        allProducts = pJson.data || pJson;
        
        const rRes = await fetch(`data/oranlar.json?v=${Date.now()}`);
        allRates = await rRes.json();
        
        renderTable();
        updateCartUI();
    } catch(e) { console.error("Yükleme Hatası:", e); }
}

function renderTable(searchVal = '') {
    const kws = norm(searchVal).split(' ').filter(k => k.length > 0);
    const data = allProducts.filter(u => {
        if (!showZeroStock && (Number(u.Stok)||0) === 0) return false;
        if (!kws.length) return true;
        return kws.every(kw => norm(Object.values(u).join(' ')).includes(kw));
    });

    const list = document.getElementById('product-list');
    list.innerHTML = '';
    data.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><button class="add-btn haptic-btn" onclick="addToBasket(${allProducts.indexOf(u)})">+</button></td>
            <td><span class="product-name">${u.Urun || ''}</span><span class="product-desc">${u.Aciklama || ''}</span></td>
            <td class="${(u.Stok||0) < 5 ? 'stok-kritik' : 'stok-bol'}">${u.Stok || 0}</td>
            <td class="td-price">${fmt(u['Kart Fiyati'])}</td>
            <td class="td-price">${fmt(u.Nakit)}</td>
            <td class="td-marka">${u.Marka || '-'}</td>
        `;
        list.appendChild(tr);
    });
}

// ─── 5. SEPET MANTIĞI ─────────────────────────────────────────
function addToBasket(idx) {
    haptic(14);
    const p = allProducts[idx];
    basket.push({
        id: uid(), urun: p.Urun, nakit: parseFloat(p.Nakit) || 0,
        kart: parseFloat(p['Kart Fiyati']) || 0, stok: p.Stok, kod: p.Kod
    });
    saveBasket();
}

function saveBasket() {
    localStorage.setItem('aygun_basket', JSON.stringify(basket));
    updateCartUI();
}

function removeFromBasket(idx) {
    basket.splice(idx, 1);
    saveBasket();
}

function basketTotals() {
    const t = { nakit: 0, kart: 0 };
    basket.forEach(i => { t.nakit += i.nakit; t.kart += i.kart; });
    return t;
}

function getDisc(total) {
    return discountType === 'TRY' ? discountAmount : (total * discountAmount / 100);
}

function updateCartUI() {
    const area = document.getElementById('cart-table-area');
    const badge = document.getElementById('cart-count');
    if (badge) badge.innerText = basket.length;
    if (!area) return;

    if (!basket.length) { area.innerHTML = '<div class="empty-cart">Sepet Boş</div>'; return; }

    const t = basketTotals();
    const netNakit = t.nakit - getDisc(t.nakit);

    let rows = basket.map((item, idx) => `
        <tr>
            <td>${item.urun}</td>
            <td class="cart-price">${fmt(item.nakit)}</td>
            <td><button class="remove-btn" onclick="removeFromBasket(${idx})">×</button></td>
        </tr>
    `).join('');

    area.innerHTML = `
        <table class="cart-table">
            <thead><tr><th>Ürün</th><th>Fiyat</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot>
                <tr class="total-row"><td colspan="1">TOPLAM (NET)</td><td>${fmt(netNakit)}</td><td></td></tr>
            </tfoot>
        </table>
    `;
}

// ─── 6. ABAKÜS (KOMİSYON HESAPLAMA) ───────────────────────────
function calcAbakus() {
    const t = basketTotals();
    const nakit = t.nakit - getDisc(t.nakit);
    const secKart = document.getElementById('ab-kart').value;
    const maxT = KART_MAX_TAKSIT[secKart] || 9;
    const zRows = allRates.filter(r => r.Kart === secKart);
    const resEl = document.getElementById('ab-result');

    let enKarliMap = {};
    const TAK = [
        {label:'Tek Çekim', n:1, key:'Tek'}, {label:'2 Taksit', n:2, key:'2Taksit'},
        {label:'3 Taksit', n:3, key:'3Taksit'}, {label:'4 Taksit', n:4, key:'4Taksit'},
        {label:'6 Taksit', n:6, key:'6Taksit'}, {label:'9 Taksit', n:9, key:'9Taksit'}
    ];

    zRows.forEach(satir => {
        TAK.forEach(td => {
            if (td.n > maxT) return;
            const oran = parseFloat(satir[td.key]);
            if (!oran) return;
            if (!enKarliMap[td.n] || oran < enKarliMap[td.n].oran) {
                enKarliMap[td.n] = {
                    label: td.label, zincir: satir.Zincir, oran, 
                    tahsilat: yuvarlaCeyrek(nakit / (1 - oran / 100)),
                    aylik: yuvarlaCeyrek((nakit / (1 - oran / 100)) / td.n)
                };
            }
        });
    });

    let html = `<div class="ab-table-wrap"><table class="ab-table"><thead><tr><th>Taksit</th><th>Zincir</th><th>Oran</th><th>Toplam</th></tr></thead><tbody>`;
    Object.values(enKarliMap).forEach(s => {
        const safeJson = JSON.stringify(s).replace(/'/g, "\\'");
        html += `<tr onclick="selectAbakusRow(this, '${safeJson}')">
            <td>${s.label}</td><td>${s.zincir}</td>
            <td class="${s.oran < KOMISYON_ESIGI ? 'ab-oran-good' : 'ab-oran-high'}">%${s.oran}</td>
            <td>${fmt(s.tahsilat)}</td>
        </tr>`;
    });
    resEl.innerHTML = html + `</tbody></table></div>`;
}

function selectAbakusRow(rowEl, jsonStr) {
    haptic(14);
    document.querySelectorAll('.ab-row-selected').forEach(r => r.classList.remove('ab-row-selected'));
    rowEl.classList.add('ab-row-selected');
    abakusSelection = JSON.parse(jsonStr);

    const waBtn = document.getElementById('ab-wa-btn');
    if (waBtn) {
        waBtn.style.display = 'flex';
        waBtn.style.pointerEvents = 'auto';
        waBtn.onclick = openWaFromAbakus;
        waBtn.innerHTML = `<span>📲</span><span>${abakusSelection.label} Seçildi: </span><strong>${fmt(abakusSelection.tahsilat)}</strong>`;
    }
}

// ─── 7. WHATSAPP & TEKLİFLER ─────────────────────────────────
function openWaFromAbakus() {
    document.getElementById('abakus-modal').style.display = 'none';
    const m = document.getElementById('wa-modal');
    m.style.display = 'flex';
    document.getElementById('wa-abakus-info').innerHTML = `Ödeme: ${abakusSelection.label} - ${fmt(abakusSelection.tahsilat)}`;
}

async function finalizeProposal() {
    const phone = document.getElementById('cust-phone').value;
    const name = document.getElementById('cust-name').value;
    const t = basketTotals();
    const netNakit = t.nakit - getDisc(t.nakit);

    const newProp = {
        id: uid(), ts: new Date().toISOString(),
        custName: name, phone: phone,
        odeme: abakusSelection ? abakusSelection.label : 'Nakit',
        tutar: abakusSelection ? abakusSelection.tahsilat : netNakit,
        user: currentUser.Email, durum: 'bekliyor'
    };

    proposals.unshift(newProp);
    localStorage.setItem('aygun_proposals', JSON.stringify(proposals));
    await syncWithCloud('data/teklifler.json', proposals, 'Yeni Teklif Kaydı');
    
    const msg = `*Aygün AVM Teklif*\nSayın ${name},\nSeçtiğiniz ürünler için toplam ödeme tutarı: ${fmt(newProp.tutar)}'dir.`;
    window.open(`https://wa.me/9${phone}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ─── 8. GİRİŞ & INITIALIZE ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (currentUser) {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-content').style.display = 'block';
        loadData();
    }
});
