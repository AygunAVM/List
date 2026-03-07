/**
 * app.js
 * Tam işlevsel Express sunucusu (detaylı, uzun sürüm)
 * - Teklif/satış CRUD (dosya tabanlı basit DB)
 * - Taksit hesaplama sunucu tarafı (detaylı formüller ve döküm)
 * - WhatsApp metin oluşturma endpoint'i
 * - Admin endpoint'leri (listeleme, görünürlük, satışa çevirme)
 *
 * Kurulum:
 *   npm init -y
 *   npm i express uuid helmet morgan cors
 * Çalıştır:
 *   node app.js
 *
 * NOT: Üretimde veritabanı, kimlik doğrulama ve input sanitizasyonu ekleyin.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const OFFERS_FILE = path.join(DATA_DIR, 'offers.json');
const PORT = process.env.PORT || 3000;

const app = express();

// Güvenlik ve logging
app.use(helmet());
app.use(morgan('combined'));
app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Veri klasörü ve dosya oluşturma
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(OFFERS_FILE)) fs.writeFileSync(OFFERS_FILE, JSON.stringify([], null, 2), 'utf8');

// -----------------------------
// Yardımcı fonksiyonlar
// -----------------------------
function readOffers() {
  try {
    const raw = fs.readFileSync(OFFERS_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('Offers read error:', err);
    return [];
  }
}

function writeOffers(arr) {
  try {
    fs.writeFileSync(OFFERS_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch (err) {
    console.error('Offers write error:', err);
  }
}

/**
 * Finansal formüller ve taksit hesaplama
 *
 * Varsayımlar ve açıklama:
 * - monthlyRate: aylık faiz oranı (ör. 0.046 = %4.6)
 * - chainPosFee: zincir pos ücreti (aylık değilse toplam üzerinden yüzdelik olarak verilebilir)
 * - Kullanılan yöntem: eşit taksit (annuity) yerine basit örnek ve ayrıntılı aylık breakdown.
 *
 * Annuity (eşit taksit) formülü (opsiyonel olarak kullanılabilir):
 *   monthly = P * r / (1 - (1 + r)^-n)
 *   burada P = ana para, r = aylık faiz, n = taksit sayısı
 *
 * Bu uygulamada hem basit hem annuity seçenekleri desteklenir.
 */
function calculateInstallmentsDetailed(total, months = 4, monthlyRate = 0.046, chainPosFee = 0, useAnnuity = false) {
  total = Number(total) || 0;
  months = Math.max(1, parseInt(months, 10) || 1);
  monthlyRate = Number(monthlyRate) || 0;
  chainPosFee = Number(chainPosFee) || 0;

  // Eğer nakit (months === 1) ise taksit yok
  if (months === 1 || monthlyRate === 0 && chainPosFee === 0) {
    return {
      months: 1,
      monthlyRate,
      chainPosFee,
      monthlyPayment: Number(total.toFixed(2)),
      totalCollected: Number(total.toFixed(2)),
      breakdown: [{ month: 1, payment: Number(total.toFixed(2)), principal: Number(total.toFixed(2)), fee: 0 }]
    };
  }

  let monthlyPayment;
  const breakdown = [];

  if (useAnnuity && monthlyRate > 0) {
    // Annuity formülü
    const r = monthlyRate;
    const n = months;
    const P = total;
    const annuityMonthly = (P * r) / (1 - Math.pow(1 + r, -n));
    monthlyPayment = annuityMonthly * (1 + chainPosFee);
    // Breakdown: faiz ve anapara ayrımı (yaklaşık)
    let remaining = P;
    for (let m = 1; m <= n; m++) {
      const interest = remaining * r;
      const principal = annuityMonthly - interest;
      remaining -= principal;
      const fee = (principal + interest) * chainPosFee;
      const payment = principal + interest + fee;
      breakdown.push({
        month: m,
        payment: Number(payment.toFixed(2)),
        principal: Number(principal.toFixed(2)),
        interest: Number(interest.toFixed(2)),
        fee: Number(fee.toFixed(2)),
        remaining: Number(Math.max(0, remaining).toFixed(2))
      });
    }
  } else {
    // Basit eşit bölünmüş anapara + faiz örneği
    const principalPerMonth = total / months;
    for (let m = 1; m <= months; m++) {
      const interest = principalPerMonth * monthlyRate;
      const fee = (principalPerMonth + interest) * chainPosFee;
      const payment = principalPerMonth + interest + fee;
      breakdown.push({
        month: m,
        payment: Number(payment.toFixed(2)),
        principal: Number(principalPerMonth.toFixed(2)),
        interest: Number(interest.toFixed(2)),
        fee: Number(fee.toFixed(2))
      });
    }
    const baseMonthly = (total * (1 + monthlyRate)) / months;
    monthlyPayment = baseMonthly * (1 + chainPosFee);
  }

  const totalCollected = breakdown.reduce((s, b) => s + b.payment, 0);

  return {
    months,
    monthlyRate,
    chainPosFee,
    monthlyPayment: Number(monthlyPayment.toFixed(2)),
    totalCollected: Number(totalCollected.toFixed(2)),
    breakdown
  };
}

// -----------------------------
// API Endpoints
// -----------------------------

/**
 * POST /api/offers
 * Body:
 * {
 *   userId?: string,
 *   items: [{id,name,price,qty}],
 *   type?: 'offer'|'sale',
 *   cash?: boolean,
 *   months?: number,
 *   monthlyRate?: number,
 *   chainPosFee?: number,
 *   useAnnuity?: boolean
 * }
 *
 * Döner: oluşturulan teklif nesnesi (sunucu tarafı hesaplamalar dahil)
 */
app.post('/api/offers', (req, res) => {
  try {
    const payload = req.body || {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) return res.status(400).json({ error: 'Sepet boş olamaz.' });

    // Normalize ve doğrula
    const normalizedItems = items.map(it => {
      return {
        id: String(it.id || uuidv4()),
        name: String(it.name || 'Ürün'),
        price: Number(it.price || 0),
        qty: Math.max(1, parseInt(it.qty || 1, 10))
      };
    });

    const totals = normalizedItems.reduce((s, it) => s + it.price * it.qty, 0);
    const cash = !!payload.cash;
    const months = cash ? 1 : Math.max(1, parseInt(payload.months || 4, 10));
    const monthlyRate = payload.monthlyRate !== undefined ? Number(payload.monthlyRate) : 0.046;
    const chainPosFee = payload.chainPosFee !== undefined ? Number(payload.chainPosFee) : 0;
    const useAnnuity = !!payload.useAnnuity;

    const installments = cash ? null : calculateInstallmentsDetailed(totals, months, monthlyRate, chainPosFee, useAnnuity);

    const offer = {
      id: uuidv4(),
      userId: payload.userId || 'anonymous',
      items: normalizedItems,
      totals: Number(totals.toFixed(2)),
      installments,
      type: payload.type === 'sale' ? 'sale' : 'offer',
      cash,
      chainPosFee: Number(chainPosFee),
      visibleToAdmin: true,
      createdAt: new Date().toISOString()
    };

    const arr = readOffers();
    arr.push(offer);
    writeOffers(arr);

    res.status(201).json(offer);
  } catch (err) {
    console.error('Create offer error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

/**
 * GET /api/offers/:id/whatsapp
 * Teklif ID'sine göre WhatsApp metni üretir (düz ve encode edilmiş)
 */
app.get('/api/offers/:id/whatsapp', (req, res) => {
  try {
    const id = req.params.id;
    const arr = readOffers();
    const offer = arr.find(o => o.id === id);
    if (!offer) return res.status(404).json({ error: 'Teklif bulunamadı' });

    const lines = [];
    lines.push(`Teklif / Satış Bilgisi (${offer.type.toUpperCase()})`);
    lines.push(`Tarih: ${new Date(offer.createdAt).toLocaleString('tr-TR')}`);
    lines.push('-------------------------');
    offer.items.forEach(it => {
      lines.push(`${it.name} x${it.qty} - ${Number(it.price).toFixed(2)} ₺`);
    });
    lines.push('-------------------------');
    lines.push(`Toplam: ${offer.totals.toFixed(2)} ₺`);
    if (offer.cash) {
      lines.push('Ödeme: Nakit');
    } else if (offer.installments) {
      lines.push(`Taksit: ${offer.installments.months} ay`);
      lines.push(`Aylık taksit: ${offer.installments.monthlyPayment.toFixed(2)} ₺`);
      lines.push(`Toplam tahsilat: ${offer.installments.totalCollected.toFixed(2)} ₺`);
    }
    lines.push('');
    lines.push('Teklif numarası: ' + offer.id);
    const text = lines.join('\n');

    res.json({ text, encoded: encodeURIComponent(text) });
  } catch (err) {
    console.error('WhatsApp text error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

/**
 * GET /api/admin/offers
 * Admin için tüm teklifleri döner (sıralı)
 * Gerçek uygulamada kimlik doğrulama ekleyin.
 */
app.get('/api/admin/offers', (req, res) => {
  try {
    const arr = readOffers();
    arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(arr);
  } catch (err) {
    console.error('Admin list error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

/**
 * POST /api/admin/offers/:id/convert
 * Teklifi satışa çevirir
 */
app.post('/api/admin/offers/:id/convert', (req, res) => {
  try {
    const id = req.params.id;
    const arr = readOffers();
    const idx = arr.findIndex(o => o.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Teklif bulunamadı' });

    arr[idx].type = 'sale';
    arr[idx].convertedAt = new Date().toISOString();
    writeOffers(arr);
    res.json(arr[idx]);
  } catch (err) {
    console.error('Convert error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

/**
 * POST /api/admin/offers/:id/visibility
 * Teklif görünürlüğünü günceller
 * Body: { visible: boolean }
 */
app.post('/api/admin/offers/:id/visibility', (req, res) => {
  try {
    const id = req.params.id;
    const visible = req.body.visible === true;
    const arr = readOffers();
    const idx = arr.findIndex(o => o.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Teklif bulunamadı' });

    arr[idx].visibleToAdmin = visible;
    writeOffers(arr);
    res.json(arr[idx]);
  } catch (err) {
    console.error('Visibility error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Sağlık kontrolü
app.get('/api/ping', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Hata yakalama (basit)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Beklenmeyen sunucu hatası' });
});

// Sunucuyu başlat
app.listen(PORT, () => {
  console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});
