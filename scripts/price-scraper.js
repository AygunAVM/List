/**
 * Piyasa Fiyat Takip Scripti v5
 * Akakçe üzerinden Vatan + MediaMarkt fiyatlarını çeker
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

console.log('[init] Data dir:', DATA_DIR);

const TIMEOUT_MS = 8000;
const DELAY_MS   = 1200;

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

async function safeFetch(url) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'Cache-Control': 'no-cache',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res.ok ? await res.text() : null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Akakçe'den hem Vatan hem MM fiyatlarını tek sorguda çek
 * Akakçe sonuç sayfasında mağaza adları ile fiyatlar birlikte geliyor
 */
async function akakceFiyatlar(urunAdi, kod) {
  const sonuc = { vatan: null, mediamarkt: null };

  const sorgular = [
    String(kod).trim(),
    temizle(urunAdi),
  ].filter(s => s.length > 2);

  for (const sorgu of sorgular) {
    const url  = `https://www.akakce.com/arama/?q=${encodeURIComponent(sorgu)}`;
    const html = await safeFetch(url);
    if (!html || html.length < 500) continue;

    // Akakçe HTML'de mağaza+fiyat çiftlerini bul
    // Format: data-merchant="Vatan Bilgisayar" ... fiyat
    const vatanFiyat    = magazaFiyatBul(html, ['vatan', 'vatanbilgisayar']);
    const mmFiyat       = magazaFiyatBul(html, ['mediamarkt', 'media markt']);

    if (vatanFiyat)    sonuc.vatan      = vatanFiyat;
    if (mmFiyat)       sonuc.mediamarkt = mmFiyat;

    // Her ikisi de bulunduysa dur
    if (sonuc.vatan && sonuc.mediamarkt) break;

    // Sadece biri bulunduysa ikinci sorguyu dene
    if (sonuc.vatan || sonuc.mediamarkt) break;
  }

  return sonuc;
}

/**
 * HTML içinde belirli mağazanın fiyatını bul
 */
function magazaFiyatBul(html, magazaAnahtarlar) {
  const htmlLower = html.toLowerCase();

  for (const anahtar of magazaAnahtarlar) {
    let pos = 0;
    while (true) {
      pos = htmlLower.indexOf(anahtar, pos);
      if (pos === -1) break;

      // Bu noktadan ±500 karakter içinde fiyat ara
      const pencere = html.substring(Math.max(0, pos - 100), pos + 500);

      // Fiyat pattern'leri
      const patterns = [
        /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(?:TL|₺)/i,
        /"price"\s*:\s*"?([\d.,]+)"?/,
        /data-price="([\d.,]+)"/,
        /class="[^"]*price[^"]*"[^>]*>([\d.,\s]+)/i,
        />\s*(\d{1,3}(?:[.,]\d{3})+)\s*</,
      ];

      for (const pat of patterns) {
        const m = pencere.match(pat);
        if (m) {
          const fiyat = parsePrice(m[1] || m[0]);
          if (fiyat && fiyat > 100) return fiyat;
        }
      }

      pos += anahtar.length;
    }
  }
  return null;
}

// ─── ANA AKIŞ ────────────────────────────────────────────────────
async function main() {
  console.log(`[${new Date().toISOString()}] Başlatılıyor... (Akakçe modu)`);

  if (!existsSync(URUNLER_JSON)) {
    console.error('HATA: urunler.json bulunamadı:', URUNLER_JSON);
    process.exit(1);
  }

  const raw     = JSON.parse(readFileSync(URUNLER_JSON, 'utf8'));
  const urunler = raw.data || (Array.isArray(raw) ? raw : []);
  console.log(`${urunler.length} ürün işlenecek.`);

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

  for (let i = 0; i < urunler.length; i++) {
    const u       = urunler[i];
    const urunAdi = String(u['Ürün'] || u['urun'] || '').trim();
    const kod     = String(u['Kod']  || u['kod']  || '').trim();
    if (!urunAdi && !kod) continue;

    process.stdout.write(`[${i+1}/${urunler.length}] ${urunAdi.substring(0, 35).padEnd(35)} `);

    let fiyatlar = { vatan: null, mediamarkt: null };
    try {
      fiyatlar = await akakceFiyatlar(urunAdi, kod);
      await sleep(DELAY_MS);
    } catch (e) {
      process.stdout.write(`ERR:${e.message.substring(0,30)} `);
    }

    // Bulunamazsa önceki değeri koru
    const prev = onceki[kod];
    if (!fiyatlar.vatan      && prev?.vatan)      fiyatlar.vatan      = prev.vatan;
    if (!fiyatlar.mediamarkt && prev?.mediamarkt) fiyatlar.mediamarkt = prev.mediamarkt;

    sonuclar.push({
      kod, urun: urunAdi,
      vatan:      fiyatlar.vatan,
      mediamarkt: fiyatlar.mediamarkt,
      ts: new Date().toISOString(),
    });

    if (fiyatlar.vatan || fiyatlar.mediamarkt) {
      bulunan++;
      console.log(`✓ V:${String(fiyatlar.vatan ?? '—').padStart(7)} MM:${String(fiyatlar.mediamarkt ?? '—').padStart(7)}`);
    } else {
      bos++;
      console.log('—');
    }

    // Her 50 üründe ara kayıt
    if ((i + 1) % 50 === 0) {
      writeFileSync(OUTPUT_JSON, JSON.stringify({
        meta: { guncelleme: new Date().toISOString(), toplamUrun: urunler.length, fiyatBulunan: bulunan, bulunamayan: bos, devamEdiyor: true },
        prices: sonuclar,
      }, null, 2), 'utf8');
      console.log(`\n--- Ara kayıt [${i+1}/${urunler.length}] Bulunan: ${bulunan} ---\n`);
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
