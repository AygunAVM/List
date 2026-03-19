/**
 * Piyasa Fiyat Takip Scripti v4
 * - Vatan + MediaMarkt JSON API endpoint'leri
 * - Kısa timeout: takılırsa hemen geç, sistemi durdurma
 * - Bulunamazsa önceki değeri koru
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '..');

function findDataDir() {
  try {
    const found = readdirSync(REPO_ROOT).find(e => e.toLowerCase() === 'data');
    if (found) return join(REPO_ROOT, found);
  } catch {}
  return join(REPO_ROOT, 'data');
}

const DATA_DIR     = findDataDir();
const URUNLER_JSON = join(DATA_DIR, 'urunler.json');
const OUTPUT_JSON  = join(DATA_DIR, 'market-prices.json');

console.log('[init] Data dir :', DATA_DIR);

// Çok kısa timeout — takılırsa hemen geç
const TIMEOUT_MS = 5000;
// Siteler arası bekleme
const DELAY_MS   = 800;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parsePrice(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) || n < 50 ? null : Math.round(n);
}

function temizle(s) {
  return String(s || '')
    .replace(/[➥♻✈☛⇒→▸✦★↪♲]/g, '')
    .replace(/\s+/g, ' ').trim().substring(0, 60);
}

/** Timeout'lu fetch — askıda kalırsa TIMEOUT_MS sonra null döner */
async function tfetch(url, opts = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...opts,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        ...(opts.headers || {}),
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res.ok ? res : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ─── VATAN — JSON Arama API ──────────────────────────────────────
async function vatanFiyat(urunAdi, kod) {
  // Vatan'ın arama API'si JSON döndürüyor
  const sorgular = [
    String(kod).trim(),
    temizle(urunAdi),
  ].filter(Boolean);

  for (const s of sorgular) {
    try {
      const url = `https://www.vatanbilgisayar.com/arama/?q=${encodeURIComponent(s)}&ajax=1`;
      const res = await tfetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res) continue;

      const ct   = res.headers.get('content-type') || '';
      const text = await res.text();

      // JSON ise parse et
      if (ct.includes('json')) {
        try {
          const json = JSON.parse(text);
          // products[0].price veya items[0].price
          const items = json.products || json.items || json.data || [];
          if (Array.isArray(items) && items.length) {
            const p = parsePrice(items[0].price || items[0].salePrice || items[0].currentPrice);
            if (p) return p;
          }
        } catch {}
      }

      // HTML ise regex ile çek
      const patterns = [
        /"price"\s*:\s*"?([\d.,]+)"?/,
        /data-price="([\d.,]+)"/,
        /"currentPrice"\s*:\s*([\d.,]+)/,
        /"salePrice"\s*:\s*([\d.,]+)/,
        /class="[^"]*price[^"]*"[^>]*>([\d.,\s]+)(?:TL|₺)/i,
      ];
      for (const pat of patterns) {
        const m = text.match(pat);
        if (m) { const p = parsePrice(m[1]); if (p && p > 50) return p; }
      }
    } catch { /* devam */ }
  }
  return null;
}

// ─── MEDIAmarkt — JSON Arama API ────────────────────────────────
async function mediamarktFiyat(urunAdi, kod) {
  const sorgular = [
    String(kod).trim(),
    temizle(urunAdi),
  ].filter(Boolean);

  for (const s of sorgular) {
    try {
      // MediaMarkt GraphQL / arama endpoint
      const url = `https://www.mediamarkt.com.tr/tr/search.html?query=${encodeURIComponent(s)}`;
      const res = await tfetch(url);
      if (!res) continue;

      const text = await res.text();

      const patterns = [
        /"price"\s*:\s*"?([\d.,]+)"?/,
        /data-price="([\d.,]+)"/,
        /"currentPrice"\s*[":,\s]+([\d.,]+)/,
        /"finalPrice"\s*[":,\s]+([\d.,]+)/,
        /priceValue[^>]*>([\d.,]+)/,
        /"value"\s*:\s*([\d]+)\s*,\s*"currency"\s*:\s*"TRY"/,
      ];
      for (const pat of patterns) {
        const m = text.match(pat);
        if (m) { const p = parsePrice(m[1]); if (p && p > 50) return p; }
      }
    } catch { /* devam */ }
  }
  return null;
}

// ─── ANA AKIŞ ────────────────────────────────────────────────────
async function main() {
  console.log(`[${new Date().toISOString()}] Başlatılıyor...`);

  if (!existsSync(URUNLER_JSON)) {
    console.error('HATA: urunler.json bulunamadı:', URUNLER_JSON);
    process.exit(1);
  }

  const raw     = JSON.parse(readFileSync(URUNLER_JSON, 'utf8'));
  const urunler = raw.data || (Array.isArray(raw) ? raw : []);
  console.log(`${urunler.length} ürün işlenecek.`);

  // Önceki sonuçları yükle
  let onceki = {};
  if (existsSync(OUTPUT_JSON)) {
    try {
      const prev = JSON.parse(readFileSync(OUTPUT_JSON, 'utf8'));
      (prev.prices || []).forEach(p => { onceki[String(p.kod).trim()] = p; });
      console.log(`Önceki: ${Object.keys(onceki).length} kayıt yüklendi`);
    } catch {}
  }

  const sonuclar = [];
  let bulunan = 0, bos = 0;
  const baslangic = Date.now();

  for (let i = 0; i < urunler.length; i++) {
    const u       = urunler[i];
    const urunAdi = String(u['Ürün'] || u['urun'] || '').trim();
    const kod     = String(u['Kod']  || u['kod']  || '').trim();
    if (!urunAdi && !kod) continue;

    process.stdout.write(`[${i+1}/${urunler.length}] ${urunAdi.substring(0, 35).padEnd(35)} `);

    let vatanF = null, mmF = null;
    try {
      vatanF = await vatanFiyat(urunAdi, kod);
      await sleep(DELAY_MS);
      mmF    = await mediamarktFiyat(urunAdi, kod);
      await sleep(DELAY_MS);
    } catch (e) {
      process.stdout.write(`HATA:${e.message} `);
    }

    // Bulunamadıysa önceki değeri koru
    const prev = onceki[kod];
    if (!vatanF && prev?.vatan)      vatanF = prev.vatan;
    if (!mmF    && prev?.mediamarkt) mmF    = prev.mediamarkt;

    sonuclar.push({ kod, urun: urunAdi, vatan: vatanF, mediamarkt: mmF, ts: new Date().toISOString() });

    if (vatanF || mmF) {
      bulunan++;
      console.log(`✓ V:${vatanF ?? '—'} MM:${mmF ?? '—'}`);
    } else {
      bos++;
      console.log('—');
    }

    // Her 50 üründe ara kayıt — timeout olsa bile veri kaybolmasın
    if ((i + 1) % 50 === 0) {
      const gecen = Math.round((Date.now() - baslangic) / 1000);
      console.log(`\n--- Ara kayıt [${i+1}/${urunler.length}] | ${gecen}s | Bulunan: ${bulunan} ---\n`);
      const araKayit = {
        meta: { guncelleme: new Date().toISOString(), toplamUrun: urunler.length, fiyatBulunan: bulunan, bulunamayan: bos, tamamlanmadi: true },
        prices: sonuclar,
      };
      try { writeFileSync(OUTPUT_JSON, JSON.stringify(araKayit, null, 2), 'utf8'); } catch {}
    }
  }

  const cikti = {
    meta: { guncelleme: new Date().toISOString(), toplamUrun: urunler.length, fiyatBulunan: bulunan, bulunamayan: bos },
    prices: sonuclar,
  };
  writeFileSync(OUTPUT_JSON, JSON.stringify(cikti, null, 2), 'utf8');
  console.log(`\n✓ Tamamlandı. Bulunan: ${bulunan} | Boş: ${bos}`);
}

main().catch(e => {
  console.error('KRİTİK HATA:', e);
  process.exit(1);
});
