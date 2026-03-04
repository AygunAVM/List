// GLOBAL DURUM
let allProducts = [], allRates = [], basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;

// BAŞLANGIÇ
document.addEventListener('DOMContentLoaded', () => {
  if (currentUser) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-content').style.display = 'block';
    loadData();
    loadRates();
  }
});

// VERİ YÜKLEME
function loadData() {
  fetch('data/urunler.json?t=' + Date.now()).then(r => r.json()).then(data => {
    allProducts = data; renderProducts(); renderChips();
  });
}

function loadRates() {
  fetch('data/rates.json?t=' + Date.now()).then(r => r.json()).then(data => {
    allRates = data;
    const select = document.getElementById('pos-card-select');
    const cards = [...new Set(allRates.map(r => r.Kart))];
    select.innerHTML = '<option value="">Lütfen Kart Seçin...</option>' + 
      cards.map(c => `<option value="${c}">${c}</option>`).join('');
  });
}

// POS HESAPLAMA MODAL FONKSİYONLARI
function openPosCalc() {
  document.getElementById('pos-modal').style.display = 'flex';
  renderPosResults();
}

function closePosCalc() {
  document.getElementById('pos-modal').style.display = 'none';
}

function renderPosResults() {
  const card = document.getElementById('pos-card-select').value;
  const container = document.getElementById('pos-results');
  const netTotal = basket.reduce((s, i) => s + (i.price * i.count), 0);

  if (!card || netTotal === 0) {
    container.innerHTML = '<p style="text-align:center;padding:40px;color:#94a3b8;">Lütfen kart seçin ve sepete ürün ekleyin.</p>';
    return;
  }

  const rows = allRates.filter(r => r.Kart === card);
  let html = `<div class="pos-net-badge">Nakit Karşılığı: ${formatPrice(netTotal)}</div>`;

  rows.forEach(r => {
    html += `<div class="pos-zincir-box">
      <div class="pos-zincir-title">${r.Zincir}</div>
      <div class="pos-grid-layout">
        ${getPosRow("Tek", r.Tek, netTotal)}
        ${getPosRow("2 Taksit", r["2Taksit"], netTotal)}
        ${getPosRow("3 Taksit", r["3Taksit"], netTotal)}
        ${getPosRow("6 Taksit", r["6Taksit"], netTotal)}
        ${getPosRow("9 Taksit", r["9Taksit"], netTotal)}
      </div>
    </div>`;
  });
  container.innerHTML = html;
}

function getPosRow(lbl, rateStr, net) {
  if (!rateStr || rateStr === "Yok") return "";
  const rate = parseFloat(rateStr.toString().replace(',', '.'));
  const total = net / (1 - (rate / 100));
  return `<div class="pos-item-card">
    <span class="pos-item-lbl">${lbl} (%${rate})</span>
    <span class="pos-item-val">${formatPrice(total)}</span>
  </div>`;
}

function formatPrice(n) { return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n); }

// MEVCUT ÜRÜN VE SEPET FONKSİYONLARI BURADA DEVAM EDER...
