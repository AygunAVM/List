/**
 * app.js
 * Tam işlevsel Express sunucusu (detaylı, uzun sürüm)
 * - Teklif/satış CRUD (dosya tabanlı basit DB)
 * - Taksit hesaplama sunucu tarafı (doğrulayıcı, farklı senaryolar)
 * - WhatsApp metin oluşturma endpoint'i
 * - Admin endpoint'leri (listeleme, görünürlük, satışa çevirme)
 *
 * Kurulum:
 *   npm init -y
 *   npm i express uuid helmet morgan cors
 * Çalıştır:
 *   node app.js
 *
 * NOT: Gerçek projede bu dosya yerine veritabanı (Mongo/Postgres) ve kimlik doğrulama kullanılmalıdır.
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Veri klasörü ve dosya oluşturma
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(OFFERS_FILE)) fs.writeFileSync(OFFERS_FILE, JSON.stringify([], null, 2), 'utf8');

// Yardımcı fonksiyonlar (uzun, açıklamalı)
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
 * Taksit hesaplama mantığı (detaylı)
 * - total: toplam tutar (Number)
 * - months: taksit sayısı (Integer)
 * - monthlyRate: aylık faiz oranı (decimal, örn 0.046 = %4.6)
 * - chainPosFee: zincir pos ücreti (opsiyonel, yüzde olarak decimal)
 *
 * Dönen nesne:
 * {
 *   months: Number,
 *   monthlyRate: Number,
 *   chainPosFee: Number,
 *   monthlyPayment: Number,
 *   totalCollected: Number,
 *   breakdown: [{month:1, payment:..., principal:..., fee:...}, ...]
 * }
 */
function calculateInstallments(total, months = 4, monthlyRate = 0.046, chainPosFee = 0) {
  total = Number(total) || 0;
  months = Math.max(1, parseInt(months, 10) || 1);
  monthlyRate = Number(monthlyRate) || 0;
  chainPosFee = Number(chainPosFee) || 0;

  // Basit faizli eşit taksit hesaplama (annuity formülü yerine basit örnek)
  // monthlyPayment = (total * (1 + monthlyRate)) / months
  // chainPosFee eklenirse her aya eklenir: monthlyPayment * (1 + chainPosFee)
  const baseMonthly = (total * (1 + monthlyRate)) / months;
  const monthlyPayment = baseMonthly * (1 + chainPosFee);
  const totalCollected = monthlyPayment * months;

  // Ayrıntılı döküm (her ay için)
  const breakdown = [];
  for (let m = 1; m <= months; m++) {
    const principal = total / months;
    const fee = (principal * monthlyRate) + (principal * chainPosFee);
    const payment = principal + fee;
    breakdown.push({
      month: m,
      payment: Number(payment.toFixed(2)),
      principal: Number(principal.toFixed(2)),
      fee: Number(fee.toFixed(2))
    });
  }

  return {
    months,
    monthlyRate,
    chainPosFee,
    monthlyPayment: Number(monthlyPayment.toFixed(2)),
    totalCollected: Number(totalCollected.toFixed(2)),
    breakdown
  };
}

/**
 * Teklif oluşturma endpoint'i
 * - Validasyon: items array, her item {id,name,price,qty}
 * - type: 'offer' veya 'sale'
 * - cash: boolean
 * - months: integer
 * - chainPosFee: decimal (opsiyonel)
 */
app.post('/api/offers', (req, res) => {
  try {
    const payload = req.body || {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) return res.status(400).json({ error: 'Sepet boş olamaz.' });

    // Temel doğrulamalar
    const normalizedItems = items.map(it => {
      return {
        id: String(it.id || uuidv4()),
        name: String(it.name || 'Ürün'),
        price: Number(it.price || 0),
        qty: Math.max(1, parseInt(it.qty || 1, 10))
      };
    });

    const totals = normalizedItems.reduce((s, it) => s + it.price * it.qty, 0);
    const months = payload.cash ? 1 : Math.max(1, parseInt(payload.months || 4, 10));
    const monthlyRate = payload.monthlyRate !== undefined ? Number(payload.monthlyRate) : 0.046;
    const chainPosFee = payload.chainPosFee !== undefined ? Number(payload.chainPosFee) : 0;

    const installments = payload.cash ? null : calculateInstallments(totals, months, monthlyRate, chainPosFee);

    const offer = {
      id: uuidv4(),
      userId: payload.userId || 'anonymous',
      items: normalizedItems,
      totals: Number(totals.toFixed(2)),
      installments,
      type: payload.type === 'sale' ? 'sale' : 'offer',
      cash: !!payload.cash,
      chainPosFee: Number(chainPosFee),
      visibleToAdmin: true,
      createdAt: new Date().toISOString()
    };

    const arr = readOffers();
    arr.push(offer);
    writeOffers(arr);

    // Güvenlik: sunucu tarafı hesaplamayı döndür
    res.status(201).json(offer);
  } catch (err) {
    console.error('Create offer error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

/**
 * Teklif için WhatsApp metni döndüren endpoint
 * - ID ile teklif bulunur, metin oluşturulur ve hem düz hem encode edilmiş döner
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
 * Admin: tüm teklifleri listele
 * - Gerçek uygulamada kimlik doğrulama zorunlu olmalı
 */
app.get('/api/admin/offers', (req, res) => {
  try {
    const arr = readOffers();
    // Admin için sıralama: yeni önce
    arr.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(arr);
  } catch (err) {
    console.error('Admin list error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

/**
 * Admin: teklifi satışa çevir
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
 * Admin: görünürlük toggle
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

/**
 * Sağlık kontrolü
 */
app.get('/api/ping', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/**
 * Hata yakalama (basit)
 */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Beklenmeyen sunucu hatası' });
});

/**
 * Sunucuyu başlat
 */
app.listen(PORT, () => {
  console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});
