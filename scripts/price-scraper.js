/**
 * Piyasa Fiyat Takip Scripti
 * Vatan Bilgisayar ve MediaMarkt'tan fiyat çeker
 * Hatalarda boş bırakır, sistemi durdurmaz
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// Data klasörünü büyük/küçük harf farkı olmadan bul
function findDataDir() {
  try {
    const entries = readdirSync(REPO_ROOT);
    const found = entries.find(e => e.toLowerCase() === 'data');
    if (found) return join(REPO_ROOT, found);
  } catch {}
  return join(REPO_ROOT, 'Data'); // fallback
}

const DATA_DIR    = findDataDir();
const URUNLER_JSON = join(DATA_DIR, 'urunler.json');
const OUTPUT_JSON  = join(DATA_DIR, 'market-prices.json');

console.log('[init] Repo root:', REPO_ROOT);
console.log('[init] Data dir:', DATA_DIR);
console.log('[init] urunler.json:', URUNLER_JSON);

const DELAY_MS   = 2000;
const TIMEOUT_MS = 15000;

const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
];
const randUA = () => UA_LIST[Math.floor(Math.random() * UA_LIST.length)];
const sleep  = ms => new Promise(r => setTimeout(r, ms));

function parsePrice(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) || n <= 0 ? null : Math.round(n);
}

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

function temizle(s) {
  return String(s || '')
    .replace(/[➥♻✈☛⇒→▸✦★]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 80);
}

// ─── VATAN ───────────────────────────────────────────────────────
async function vatanFiyat(urunAdi, kod) {
  let fiyat = await vatanAra(String(kod).trim());
  if (fiyat) return fiyat;
  fiyat = await vatanAra(temizle(urunAdi));
  return fiyat;
}

async function vatanAra(sorgu) {
  try {
    const url = `https://www.vatanbilgisayar.com/arama/?q=${encodeURIComponent(sorgu)}`;
    const res  = await safeFetch(url);
    if (!res) return null;
    const html = await res.text();
    const patterns = [
      /"price"\s*:\s*"?([\d.,]+)"?/,
      /data-price="([\d.,]+)"/,
      /"lowPrice"\s*:\s*"?([\d.,]+)"?/,
      /"offers"[^}]+"price"\s*:\s*"?([\d.]+)"?/,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) { const p = parsePrice(m[1]); if (p && p > 100) return p; }
    }
    return null;
  } catch { return null; }
}

// ─── MEDIAmarkt ──────────────────────────────────────────────────
async function mediamarktFiyat(urunAdi, kod) {
  let fiyat = await mediamarktAra(String(kod).trim());
  if (fiyat) return fiyat;
  fiyat = await mediamarktAra(temizle(urunAdi));
  return fiyat;
}

async function mediamarktAra(sorgu) {
  try {
    const url = `https://www.mediamarkt.com.tr/tr/search.html?query=${encodeURIComponent(sorgu)}`;
    const res  = await safeFetch(url);
    if (!res) return null;
    const html = await res.text();
    const patterns = [
      /"price"\s*:\s*"?([\d.,]+)"?/,
      /data-price="([\d.,]+)"/,
      /"lowPrice"\s*:\s*"?([\d.,]+)"?/,
      /"offers"[^}]+"price"\s*:\s*"?([\d.]+)"?/,
      /priceValue['":\s]+([\d.,]+)/,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) { const p = parsePrice(m[1]); if (p && p > 100) return p; }
    }
    return null;
  } catch { return null; }
}

// ─── ANA AKIŞ ────────────────────────────────────────────────────
async function main() {
  console.log(`[${new Date().toISOString()}] Fiyat takibi başlatılıyor...`);

  if (!existsSync(URUNLER_JSON)) {
    // Klasör içeriğini göster — debug için
    console.error('HATA: urunler.json bulunamadı:', URUNLER_JSON);
    try {
      console.error('Repo root içeriği:', readdirSync(REPO_ROOT).join(', '));
      console.error('Data dir içeriği:', readdirSync(DATA_DIR).join(', '));
    } catch (e) { console.error('Klasör okunamadı:', e.message); }
    process.exit(1);
  }

  const raw     = JSON.parse(readFileSync(URUNLER_JSON, 'utf8'));
  const urunler = raw.data || (Array.isArray(raw) ? raw : []);
  console.log(`Toplam ${urunler.length} ürün işlenecek.`);

  // Önceki sonuçları yükle
  let onceki = {};
  if (existsSync(OUTPUT_JSON)) {
    try {
      const prev = JSON.parse(readFileSync(OUTPUT_JSON, 'utf8'));
      (prev.prices || []).forEach(p => { onceki[String(p.kod).trim()] = p; });
    } catch {}
  }

  const sonuclar = [];
  let bulunan = 0, bos = 0;

  for (let i = 0; i < urunler.length; i++) {
    const u       = urunler[i];
    const urunAdi = String(u['Ürün'] || u['urun'] || '').trim();
    const kod     = String(u['Kod']  || u['kod']  || '').trim();
    if (!urunAdi && !kod) continue;

    process.stdout.write(`[${i+1}/${urunler.length}] ${urunAdi.substring(0, 40).padEnd(40)} `);

    let vatanF = null, mmF = null;
    try {
      vatanF = await vatanFiyat(urunAdi, kod);
      await sleep(DELAY_MS);
      mmF    = await mediamarktFiyat(urunAdi, kod);
      await sleep(DELAY_MS);
    } catch (e) { console.log('HATA:', e.message); }

    // Bulunamadıysa önceki değeri koru
    const prev = onceki[kod];
    if (!vatanF && prev?.vatan)      vatanF = prev.vatan;
    if (!mmF    && prev?.mediamarkt) mmF    = prev.mediamarkt;

    sonuclar.push({ kod, urun: urunAdi, vatan: vatanF, mediamarkt: mmF, ts: new Date().toISOString() });

    if (vatanF || mmF) { bulunan++; console.log(`✓ V:${vatanF ?? '—'} MM:${mmF ?? '—'}`); }
    else               { bos++;     console.log('—'); }
  }

  const cikti = {
    meta: { guncelleme: new Date().toISOString(), toplamUrun: urunler.length, fiyatBulunan: bulunan, bulunamayan: bos },
    prices: sonuclar,
  };

  writeFileSync(OUTPUT_JSON, JSON.stringify(cikti, null, 2), 'utf8');
  console.log(`\nTamamlandı. Bulunan: ${bulunan} | Boş: ${bos}`);
}

main().catch(e => {
  console.error('KRİTİK HATA:', e);
  process.exit(1);
});
