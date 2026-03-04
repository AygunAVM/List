let allProducts = [], allRates = [], basket = JSON.parse(localStorage.getItem('aygun_basket')) || [];
let currentUser = JSON.parse(localStorage.getItem('aygun_user')) || null;

document.addEventListener('DOMContentLoaded', () => {
  if (currentUser) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-content').style.display = 'block';
    loadData();
    loadRates();
  }
});

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
  }).catch(() => console.log("Oranlar henüz yüklenmedi."));
}

function openPosCalc() {
  document.getElementById('pos-modal').style.display = 'flex';
  renderPosResults();
}

function closePosCalc() {
  document.getElementById('pos-modal').style.display = 'none';
}

function renderPosResults() {
  const selectedCard = document.getElementById('pos-card-select').value;
  const container = document.getElementById('pos-results');
  const netTotal = basket.reduce((s, i) => s + (i.price * i.count), 0);

  if (!selectedCard || netTotal === 0) return;

  const filtered = allRates.filter(r => r.Kart === selectedCard);
  let html = `<div class="pos-net-badge">Hedef Net: ${formatPrice(netTotal)}</div>`;

  filtered.forEach(row => {
    html += `<div class="pos-zincir-item">
      <div class="pos-zincir-head">${row.Zincir}</div>
      <div class="pos-row-grid">
        ${calculateLine("Tek", row.Tek, netTotal)}
        ${calculateLine("2 Taksit", row.Tek, netTotal)}
        ${calculateLine("3 Taksit", row["3Taksit"], netTotal)}
        ${calculateLine("6 Taksit", row["6Taksit"], netTotal)}
        ${calculateLine("9 Taksit", row["9Taksit"], netTotal)}
      </div>
    </div>`;
  });
  container.innerHTML = html;
}

function calculateLine(label, rateStr, net) {
  if (!rateStr || rateStr === "Yok") return "";
  const rate = parseFloat(rateStr.toString().replace(',', '.'));
  const total = net / (1 - (rate / 100));
  return `<div class="pos-res-box">
    <span class="pos-res-lbl">${label} (%${rate})</span>
    <span class="pos-res-val">${formatPrice(total)}</span>
  </div>`;
}

function formatPrice(p) { return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(p); }

// Mevcut sepet ve ürün fonksiyonlarınız (renderProducts, addBasket vb.) buraya dahil edilmelidir.
