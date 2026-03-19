/**
 * Piyasa Fiyat Takip Scripti v6 - Cimri API
 * Cimri'nin arama API'si JSON döndürüyor, bot koruması zayıf
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
const DELAY_MS   = 800;

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

async function safeFetch(url, headers = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        ...headers,
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? await res.json() : await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Cimri arama API - JSON döndürür, mağaza fiyatları içerir
 */
async function cimnriFiyatlar(urunAdi, kod) {
  const sonuc = { vatan: null, mediamarkt: null };

  const sorgular = [String(kod).trim(), temizle(urunAdi)].filter(s => s.length > 2);

  for (const sorgu of sorgular) {
    // Cimri API endpoint
    const url = `https://www.cimri.com/api/search?q=${encodeURIComponent(sorgu)}&limit=5`;
    const data = await safeFetch(url, { 'Referer': 'https://www.cimri.com/' });

    if (data && typeof data === 'object') {
      // JSON API yanıtı
      const urunler = data.products || data.items || data.data || data.results || [];
      if (Array.isArray(urunler) && urunler.length > 0) {
        const ilk = urunler[0];
        // Mağaza fiyatlarını tara
        const magaza = ilk.merchants || ilk.offers || ilk.prices || [];
        for (const m of magaza) {
          const isim = String(m.merchantName || m.name || m.merchant || '').toLowerCase();
          const fiyat = parsePrice(m.price || m.salePrice || m.amount);
          if (fiyat) {
            if (isim.includes('vatan') && !sonuc.vatan)           sonuc.vatan      = fiyat;
            if (isim.includes('mediamarkt') && !sonuc.mediamarkt) sonuc.mediamarkt = fiyat;
          }
        }
        if (sonuc.vatan || sonuc.mediamarkt) break;
      }
    }

    if (typeof data === 'string' && data.length > 200) {
      // HTML yanıtı — regex ile çek
      const vatan = magazaFiyatBulHTML(data, ['vatan', 'vatanbilgisayar']);
      const mm    = magazaFiyatBulHTML(data, ['mediamarkt']);
      if (vatan) sonuc.vatan = vatan;
      if (mm)    sonuc.mediamarkt = mm;
      if (sonuc.vatan || sonuc.mediamarkt) break;
    }

    await sleep(300);
  }

  // Cimri bulamazsa Akakçe'yi dene
  if (!sonuc.vatan && !sonuc.mediamarkt) {
    const akSonuc = await akakceFiyatlar(urunAdi, kod);
    if (akSonuc.vatan)      sonuc.vatan      = akSonuc.vatan;
    if (akSonuc.mediamarkt) sonuc.mediamarkt = akSonuc.mediamarkt;
  }

  return sonuc;
}

async function akakceFiyatlar(urunAdi, kod) {
  const sonuc = { vatan: null, mediamarkt: null };
  const sorgular = [String(kod).trim(), temizle(urunAdi)].filter(s => s.length > 2);
  for (const sorgu of sorgular) {
    const html = await safeFetch(`https://www.akakce.com/arama/?q=${encodeURIComponent(sorgu)}`);
    if (!html || typeof html !== 'string') continue;
    const v  = magazaFiyatBulHTML(html, ['vatan', 'vatanbilgisayar']);
    const mm = magazaFiyatBulHTML(html, ['mediamarkt']);
    if (v)  sonuc.vatan      = v;
    if (mm) sonuc.mediamarkt = mm;
    if (v || mm) break;
    await sleep(300);
  }
  return sonuc;
}

function magazaFiyatBulHTML(html, anahtarlar) {
  const lower = html.toLowerCase();
  for (const anahtar of anahtarlar) {
    let pos = lower.indexOf(anahtar);
    while (pos !== -1) {
      const pencere = html.substring(Math.max(0, pos - 50), pos + 300);
      const patterns = [
        /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{0,2})?)\s*(?:TL|₺)/i,
        /"price"\s*:\s*"?([\d.,]+)"?/,
        /data-price="([\d.,]+)"/,
        />(\d{1,3}(?:[.,]\d{3})+)</,
      ];
      for (const pat of patterns) {
        const m = pencere.match(pat);
        if (m) {
          const f = parsePrice(m[1] || m[0]);
          if (f && f > 100) return f;
        }
      }
      pos = lower.indexOf(anahtar, pos + anahtar.length);
    }
  }
  return null;
}

// ─── ANA AKIŞ ────────────────────────────────────────────────────
async function main() {
  console.log(`[${new Date().toISOString()}] Başlatılıyor... (Cimri + Akakçe)`);

  if (!existsSync(URUNLER_JSON)) {
    console.error('HATA: urunler.json bulunamadı:', URUNLER_JSON);
    process.exit(1);
  }

  const raw     = JSON.parse(readFileSync(URUNLER_JSON, 'utf8'));
  const urunler = raw.data || (Array.isArray(raw) ? raw : []);
  console.log(`${urunler.length} ürün işlenecek.`);

  // İlk 10 ürünle test et, çalışıyorsa devam et
  const TEST_MODU = process.env.TEST_MODU === '1';
  const islenecek = TEST_MODU ? urunler.slice(0, 10) : urunler;
  if (TEST_MODU) console.log('*** TEST MODU: Sadece ilk 10 ürün ***');

  let onceki = {};
  if (existsSync(OUTPUT_JSON)) {
    try {
      const prev = JSON.parse(readFileSync(OUTPUT_JSON, 'utf8'));
      (prev.prices || []).forEach(p => { onceki[String(p.kod).trim()] = p; });
      console.log(`Önceki: ${Object.keys(onceki).length} kayıt`);
    } catch {}
  }

  const sonuclar = [];
  let bulunan = 0, bos = 0;

  for (let i = 0; i < islenecek.length; i++) {
    const u       = islenecek[i];
    const urunAdi = String(u['Ürün'] || u['urun'] || '').trim();
    const kod     = String(u['Kod']  || u['kod']  || '').trim();
    if (!urunAdi && !kod) continue;

    process.stdout.write(`[${i+1}/${islenecek.length}] ${urunAdi.substring(0, 35).padEnd(35)} `);

    let fiyatlar = { vatan: null, mediamarkt: null };
    try {
      fiyatlar = await cimnriFiyatlar(urunAdi, kod);
      await sleep(DELAY_MS);
    } catch (e) {
      process.stdout.write(`ERR `);
    }

    const prev = onceki[kod];
    if (!fiyatlar.vatan      && prev?.vatan)      fiyatlar.vatan      = prev.vatan;
    if (!fiyatlar.mediamarkt && prev?.mediamarkt) fiyatlar.mediamarkt = prev.mediamarkt;

    sonuclar.push({ kod, urun: urunAdi, vatan: fiyatlar.vatan, mediamarkt: fiyatlar.mediamarkt, ts: new Date().toISOString() });

    if (fiyatlar.vatan || fiyatlar.mediamarkt) {
      bulunan++;
      console.log(`✓ V:${String(fiyatlar.vatan ?? '—').padStart(7)} MM:${String(fiyatlar.mediamarkt ?? '—').padStart(7)}`);
    } else {
      bos++;
      console.log('—');
    }

    if ((i + 1) % 50 === 0) {
      writeFileSync(OUTPUT_JSON, JSON.stringify({
        meta: { guncelleme: new Date().toISOString(), toplamUrun: urunler.length, fiyatBulunan: bulunan, bulunamayan: bos },
        prices: sonuclar,
      }, null, 2), 'utf8');
      console.log(`--- Ara kayıt [${i+1}] Bulunan: ${bulunan} ---`);
    }
  }

  writeFileSync(OUTPUT_JSON, JSON.stringify({
    meta: { guncelleme: new Date().toISOString(), toplamUrun: urunler.length, fiyatBulunan: bulunan, bulunamayan: bos },
    prices: sonuclar,
  }, null, 2), 'utf8');

  console.log(`\n✓ Tamamlandı. Bulunan: ${bulunan} | Boş: ${bos}`);
}

main().catch(e => { console.error('KRİTİK HATA:', e); process.exit(1); });
