/**
 * Piyasa Fiyat Takip Scripti
 * Vatan Bilgisayar ve MediaMarkt'tan fiyat çeker
 * Hatalarda boş bırakır, sistemi durdurmaz
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Ayarlar ---
const URUNLER_JSON = join(__dirname, '..', 'Data', 'urunler.json');
const OUTPUT_JSON  = join(__dirname, '..', 'Data', 'market-prices.json');
const DELAY_MS     = 1800;   // İstekler arası bekleme (ms) - anti-ban
const TIMEOUT_MS   = 12000;  // İstek zaman aşımı

// Browser User-Agent - bot tespitini azaltır
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// --- Yardımcı fonksiyonlar ---

/** ms bekle */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Sayfa HTML'ini fetch et */
async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'tr-TR,tr;q=0.9',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/** "1.299,00 TL" → 1299  |  "1299.00" → 1299  |  bulunamazsa null */
function parsePrice(raw) {
  if (!raw) return null;
  // Türkçe format: nokta binlik ayraç, virgül ondalık
  let s = raw.replace(/[^\d.,]/g, '');           // Sadece rakam, nokta, virgül
  if (!s) return null;
  // "1.299,00" → "1299.00"
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) || n <= 0 ? null : Math.round(n);
}

// ===================================================
// VATAN BİLGİSAYAR
// ===================================================

/**
 * Vatan'da ürün arar ve fiyat döner.
 * Önce ürün kodu ile dener, bulamazsa isimle arar.
 */
async function vatanFiyat(urunAdi, kod) {
  // 1. Kodu dene (daha kesin sonuç)
  const sorgu = encodeURIComponent(String(kod).trim());
  let fiyat = await vatanAra(sorgu, String(kod));

  // 2. Bulamazsa ürün adını dene
  if (fiyat === null) {
    const sorguAd = encodeURIComponent(urunAdi.trim().replace(/[➥♻✈☛]/g, '').trim());
    fiyat = await vatanAra(sorguAd, urunAdi);
  }
  return fiyat;
}

async function vatanAra(sorgu, etiket) {
  const url = `https://www.vatanbilgisayar.com/arama/?q=${sorgu}`;
  const html = await fetchPage(url);
  if (!html) return null;

  const $ = cheerio.load(html);
  // Vatan ürün listesi fiyat seçicileri (birkaç fallback)
  const selectors = [
    '.product-list__price span',
    '.product-list-item__price-new',
    '[class*="product-price"]',
    '[data-price]',
    '.price-area .price',
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length) {
      const raw = el.attr('data-price') || el.text();
      const p = parsePrice(raw);
      if (p) return p;
    }
  }
  return null;
}

// ===================================================
// MEDIAmarkt
// ===================================================

async function mediamarktFiyat(urunAdi, kod) {
  const sorgu = encodeURIComponent(String(kod).trim());
  let fiyat = await mediamarktAra(sorgu);

  if (fiyat === null) {
    const sorguAd = encodeURIComponent(urunAdi.trim().replace(/[➥♻✈☛]/g, '').trim());
    fiyat = await mediamarktAra(sorguAd);
  }
  return fiyat;
}

async function mediamarktAra(sorgu) {
  const url = `https://www.mediamarkt.com.tr/tr/search.html?query=${sorgu}`;
  const html = await fetchPage(url);
  if (!html) return null;

  const $ = cheerio.load(html);
  const selectors = [
    '[data-test="branded-price-whole-value"]',
    '.price-wrapper span',
    '[class*="product-price"]',
    '[class*="priceTag"]',
    '.flix-price',
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length) {
      const raw = el.attr('data-price') || el.text();
      const p = parsePrice(raw);
      if (p) return p;
    }
  }
  return null;
}

// ===================================================
// ANA AKIŞ
// ===================================================

async function main() {
  console.log(`[${new Date().toISOString()}] Fiyat takibi başlatılıyor...`);

  // Ürün listesini yükle
  if (!existsSync(URUNLER_JSON)) {
    console.error('HATA: urunler.json bulunamadı:', URUNLER_JSON);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(URUNLER_JSON, 'utf8'));
  const urunler = raw.data || raw; // metadata/data yapısını destekle

  console.log(`Toplam ${urunler.length} ürün işlenecek.`);

  // Önceki sonuçları yükle (mevcut varsa)
  let mevcutSonuclar = {};
  if (existsSync(OUTPUT_JSON)) {
    try {
      const prev = JSON.parse(readFileSync(OUTPUT_JSON, 'utf8'));
      if (prev.prices) {
        prev.prices.forEach(p => { mevcutSonuclar[p.kod] = p; });
      }
    } catch { /* ilk çalışma */ }
  }

  const sonuclar = [];
  let basarili = 0, bos = 0, hata = 0;

  for (let i = 0; i < urunler.length; i++) {
    const u = urunler[i];
    const urunAdi = (u['Ürün'] || '').toString().trim();
    const kod     = (u['Kod']  || '').toString().trim();

    if (!urunAdi && !kod) continue;

    process.stdout.write(`[${i+1}/${urunler.length}] ${urunAdi.substring(0,40)}... `);

    let vatanFiyati    = null;
    let mediaFiyati    = null;

    try {
      vatanFiyati = await vatanFiyat(urunAdi, kod);
      await sleep(DELAY_MS);
      mediaFiyati = await mediamarktFiyat(urunAdi, kod);
      await sleep(DELAY_MS);
    } catch (e) {
      hata++;
      console.log('HATA:', e.message);
    }

    const satirSonuc = {
      kod,
      urun: urunAdi,
      vatan: vatanFiyati,
      mediamarkt: mediaFiyati,
      ts: new Date().toISOString(),
    };

    sonuclar.push(satirSonuc);

    if (vatanFiyati || mediaFiyati) {
      basarili++;
      console.log(`✓ Vatan:${vatanFiyati ?? '-'} MM:${mediaFiyati ?? '-'}`);
    } else {
      bos++;
      console.log('— bulunamadı');
    }
  }

  // Sonuçları yaz
  const cikti = {
    meta: {
      guncelleme: new Date().toISOString(),
      toplamUrun: urunler.length,
      fiyatBulunan: basarili,
      bulunamayan: bos,
      hata,
    },
    prices: sonuclar,
  };

  writeFileSync(OUTPUT_JSON, JSON.stringify(cikti, null, 2), 'utf8');
  console.log(`\nTamamlandı. Bulunan: ${basarili} | Boş: ${bos} | Hata: ${hata}`);
  console.log(`Çıktı: ${OUTPUT_JSON}`);
}

main().catch(e => {
  console.error('KRİTİK HATA:', e);
  process.exit(1);
});
