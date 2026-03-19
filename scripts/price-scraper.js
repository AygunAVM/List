/**
 * Piyasa Fiyat Takip Scripti
 * Vatan Bilgisayar ve MediaMarkt'tan fiyat çeker
 * Hatalarda boş bırakır, sistemi durdurmaz
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const URUNLER_JSON = join(__dirname, '..', 'Data', 'urunler.json');
const OUTPUT_JSON  = join(__dirname, '..', 'Data', 'market-prices.json');
const DELAY_MS     = 2000;
const TIMEOUT_MS   = 15000;

const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
];
const randUA = () => UA_LIST[Math.floor(Math.random() * UA_LIST.length)];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** "1.299,00 TL" → 1299  |  null eğer parse edilemezse */
function parsePrice(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) || n <= 0 ? null : Math.round(n);
}

/** Güvenli fetch — timeout + hata yönetimi */
async function safeFetch(url, extraHeaders = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': randUA(),
        'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.9',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        ...extraHeaders,
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return res;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ─── VATAN BİLGİSAYAR ───────────────────────────────────────────
async function vatanFiyat(urunAdi, kod) {
  // 1. Arama API'si (JSON — daha güvenilir)
  const sorgu = encodeURIComponent(String(kod).trim());
  let fiyat = await vatanApiAra(sorgu);
  if (fiyat) return fiyat;

  // 2. Ürün adıyla dene
  const sorguAd = encodeURIComponent(temizle(urunAdi));
  fiyat = await vatanApiAra(sorguAd);
  return fiyat;
}

async function vatanApiAra(sorgu) {
  try {
    // Vatan arama sayfası — meta/JSON veri
    const url = `https://www.vatanbilgisayar.com/arama/?q=${sorgu}`;
    const res  = await safeFetch(url);
    if (!res) return null;
    const html = await res.text();

    // JSON-LD veya data-price attribute'larından fiyat çek
    const patterns = [
      /"price"\s*:\s*"?([\d.,]+)"?/,
      /data-price="([\d.,]+)"/,
      /"lowPrice"\s*:\s*"?([\d.,]+)"?/,
      /class="product-list__price[^"]*"[^>]*>\s*<[^>]+>\s*([\d.,]+\s*TL)/i,
      /"offers"[^}]+"price"\s*:\s*"?([\d.]+)"?/,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) {
        const p = parsePrice(m[1]);
        if (p && p > 100) return p; // 100 TL altı muhtemelen yanlış
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── MEDIAmarkt ─────────────────────────────────────────────────
async function mediamarktFiyat(urunAdi, kod) {
  // 1. Kod ile dene
  const sorgu = encodeURIComponent(String(kod).trim());
  let fiyat = await mediamarktApiAra(sorgu);
  if (fiyat) return fiyat;

  // 2. Ürün adıyla dene
  const sorguAd = encodeURIComponent(temizle(urunAdi));
  fiyat = await mediamarktApiAra(sorguAd);
  return fiyat;
}

async function mediamarktApiAra(sorgu) {
  try {
    // MediaMarkt arama
    const url = `https://www.mediamarkt.com.tr/tr/search.html?query=${sorgu}`;
    const res  = await safeFetch(url, { 'Accept': 'text/html,*/*' });
    if (!res) return null;
    const html = await res.text();

    const patterns = [
      /"price"\s*:\s*"?([\d.,]+)"?/,
      /data-price="([\d.,]+)"/,
      /"lowPrice"\s*:\s*"?([\d.,]+)"?/,
      /"offers"[^}]+"price"\s*:\s*"?([\d.]+)"?/,
      /priceValue['":\s]+([\d.,]+)/,
      /<span[^>]+class="[^"]*price[^"]*"[^>]*>([\d.,\s]+(?:TL|₺))/i,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) {
        const p = parsePrice(m[1]);
        if (p && p > 100) return p;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── YARDIMCI ────────────────────────────────────────────────────
/** Ürün adından özel karakterleri temizle */
function temizle(s) {
  return String(s || '')
    .replace(/[➥♻✈☛⇒→▸]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 80); // çok uzun sorgu gönderme
}

// ─── ANA AKIŞ ────────────────────────────────────────────────────
async function main() {
  console.log(`[${new Date().toISOString()}] Fiyat takibi başlatılıyor...`);

  if (!existsSync(URUNLER_JSON)) {
    console.error('HATA: urunler.json bulunamadı:', URUNLER_JSON);
    process.exit(1);
  }

  const raw      = JSON.parse(readFileSync(URUNLER_JSON, 'utf8'));
  const urunler  = raw.data || (Array.isArray(raw) ? raw : []);
  console.log(`Toplam ${urunler.length} ürün işlenecek.`);

  // Önceki sonuçları yükle — bulunamayan ürünleri önceki değerle tut
  let onceki = {};
  if (existsSync(OUTPUT_JSON)) {
    try {
      const prev = JSON.parse(readFileSync(OUTPUT_JSON, 'utf8'));
      (prev.prices || []).forEach(p => { onceki[String(p.kod).trim()] = p; });
    } catch { /* ilk çalışma */ }
  }

  const sonuclar = [];
  let bulunan = 0, bos = 0;

  for (let i = 0; i < urunler.length; i++) {
    const u       = urunler[i];
    const urunAdi = String(u['Ürün'] || u['urun'] || '').trim();
    const kod     = String(u['Kod']  || u['kod']  || '').trim();

    if (!urunAdi && !kod) continue;

    process.stdout.write(`[${i+1}/${urunler.length}] ${urunAdi.substring(0, 45).padEnd(45)} `);

    let vatanFiyati = null, mediaFiyati = null;
    try {
      vatanFiyati = await vatanFiyat(urunAdi, kod);
      await sleep(DELAY_MS);
      mediaFiyati = await mediamarktFiyat(urunAdi, kod);
      await sleep(DELAY_MS);
    } catch (e) {
      console.log('HATA:', e.message);
    }

    // Bulunamadıysa önceki değeri koru
    const prev = onceki[kod];
    if (!vatanFiyati && prev?.vatan)        vatanFiyati = prev.vatan;
    if (!mediaFiyati && prev?.mediamarkt)   mediaFiyati = prev.mediamarkt;

    sonuclar.push({ kod, urun: urunAdi, vatan: vatanFiyati, mediamarkt: mediaFiyati, ts: new Date().toISOString() });

    if (vatanFiyati || mediaFiyati) {
      bulunan++;
      console.log(`✓ V:${vatanFiyati ?? '—'} MM:${mediaFiyati ?? '—'}`);
    } else {
      bos++;
      console.log('—');
    }
  }

  const cikti = {
    meta: {
      guncelleme: new Date().toISOString(),
      toplamUrun: urunler.length,
      fiyatBulunan: bulunan,
      bulunamayan: bos,
    },
    prices: sonuclar,
  };

  writeFileSync(OUTPUT_JSON, JSON.stringify(cikti, null, 2), 'utf8');
  console.log(`\nTamamlandı. Bulunan: ${bulunan} | Boş: ${bos}`);
}

main().catch(e => {
  console.error('KRİTİK HATA:', e);
  process.exit(1);
});
