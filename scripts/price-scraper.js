/**
 * Piyasa Fiyat Takip v8 - Akakce Mobil API
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

const DATA_DIR      = findDataDir();
const URUNLER_JSON  = join(DATA_DIR, 'urunler.json');
const OUTPUT_JSON   = join(DATA_DIR, 'market-prices.json');
const PROGRESS_JSON = join(DATA_DIR, 'market-prices-progress.json');

const BATCH_SIZE = 60;
const DELAY_MS   = 1000;
const TIMEOUT_MS = 8000;

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
        'User-Agent': 'Akakce/7.0 (Android; Mobile)',
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'tr-TR',
        ...headers,
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) return await res.json();
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function parsePriceFromObj(obj) {
  if (!obj) return null;
  const keys = ['price', 'salePrice', 'currentPrice', 'minPrice', 'lowestPrice', 'amount'];
  for (const k of keys) {
    if (obj[k]) { const f = parsePrice(obj[k]); if (f > 100) return f; }
  }
  return null;
}

async function akakceFiyatlar(urunAdi, kod) {
  const sonuc = { vatan: null, mediamarkt: null };
  const sorgular = [String(kod).trim(), temizle(urunAdi)].filter(s => s.length > 2);

  for (const sorgu of sorgular) {
    // Akakçe mobil API endpoint'leri
    const urls = [
      `https://api.akakce.com/v3/search?q=${encodeURIComponent(sorgu)}&limit=10`,
      `https://m.akakce.com/api/search?keyword=${encodeURIComponent(sorgu)}`,
      `https://www.akakce.com/api/search?q=${encodeURIComponent(sorgu)}`,
    ];

    for (const url of urls) {
      const data = await safeFetch(url);
      if (!data) continue;

      if (typeof data === 'object') {
        // JSON yanıtı — ürün listesi içinde mağaza fiyatlarını ara
        const items = data.products || data.items || data.results || data.data || [];
        const arr   = Array.isArray(items) ? items : Array.isArray(data) ? data : [];

        for (const item of arr.slice(0, 3)) {
          // Mağaza listesi
          const offers = item.merchants || item.offers || item.prices || item.shops || [];
          for (const offer of (Array.isArray(offers) ? offers : [])) {
            const isim = String(offer.name || offer.merchantName || offer.merchant || '').toLowerCase();
            const fiyat = parsePriceFromObj(offer) || parsePrice(offer.price || offer.amount);
            if (fiyat) {
              if (isim.includes('vatan') && !sonuc.vatan)           sonuc.vatan      = fiyat;
              if (isim.includes('mediamarkt') && !sonuc.mediamarkt) sonuc.mediamarkt = fiyat;
            }
          }
          // Direkt min fiyat
          if (!sonuc.vatan && !sonuc.mediamarkt) {
            const f = parsePriceFromObj(item);
            // Mağaza ayırt edemiyorsak en azından bir fiyat var
          }
        }
        if (sonuc.vatan || sonuc.mediamarkt) return sonuc;
      }

      if (typeof data === 'string' && data.length > 200) {
        // HTML — regex ile çek
        const lower = data.toLowerCase();
        for (const [anahtar, alan] of [['vatan', 'vatan'], ['mediamarkt', 'mediamarkt']]) {
          let pos = lower.indexOf(anahtar);
          while (pos !== -1) {
            const pencere = data.substring(Math.max(0, pos - 30), pos + 300);
            const patterns = [
              /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{0,2})?)\s*(?:TL|₺)/i,
              /"price"\s*:\s*"?([\d.,]+)"?/,
              />(\d{1,3}(?:[.,]\d{3})+)</,
            ];
            for (const pat of patterns) {
              const m = pencere.match(pat);
              if (m) {
                const f = parsePrice(m[1] || m[0]);
                if (f && f > 100) {
                  if (alan === 'vatan' && !sonuc.vatan)           sonuc.vatan      = f;
                  if (alan === 'mediamarkt' && !sonuc.mediamarkt) sonuc.mediamarkt = f;
                }
              }
            }
            pos = lower.indexOf(anahtar, pos + anahtar.length);
          }
        }
        if (sonuc.vatan || sonuc.mediamarkt) return sonuc;
      }
    }
    if (sonuc.vatan || sonuc.mediamarkt) break;
    await sleep(300);
  }
  return sonuc;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Başlatılıyor... (Akakçe Mobil API)`);

  if (!existsSync(URUNLER_JSON)) {
    console.error('HATA: urunler.json bulunamadı'); process.exit(1);
  }

  const raw        = JSON.parse(readFileSync(URUNLER_JSON, 'utf8'));
  const tumUrunler = raw.data || (Array.isArray(raw) ? raw : []);
  const urunler    = tumUrunler.filter(u => Number(u.Stok || u.stok || 0) > 0);
  console.log(`Stoklu: ${urunler.length} / ${tumUrunler.length}`);

  let mevcutFiyatlar = {};
  if (existsSync(OUTPUT_JSON)) {
    try {
      const prev = JSON.parse(readFileSync(OUTPUT_JSON, 'utf8'));
      (prev.prices || []).forEach(p => { mevcutFiyatlar[String(p.kod).trim()] = p; });
    } catch {}
  }

  let startIndex = 0;
  if (existsSync(PROGRESS_JSON)) {
    try {
      const prog = JSON.parse(readFileSync(PROGRESS_JSON, 'utf8'));
      if (prog.toplamUrun === urunler.length) startIndex = prog.sonrakiIndex || 0;
    } catch {}
  }
  if (startIndex >= urunler.length) startIndex = 0;

  const endIndex = Math.min(startIndex + BATCH_SIZE, urunler.length);
  const batch    = urunler.slice(startIndex, endIndex);
  console.log(`Batch: ${startIndex + 1}-${endIndex} (${batch.length} ürün)\n`);

  let bulunan = 0, bos = 0;

  for (let i = 0; i < batch.length; i++) {
    const u       = batch[i];
    const urunAdi = String(u['Ürün'] || u['urun'] || '').trim();
    const kod     = String(u['Kod']  || u['kod']  || '').trim();
    if (!urunAdi && !kod) continue;

    process.stdout.write(`[${startIndex+i+1}/${urunler.length}] ${urunAdi.substring(0,33).padEnd(33)} `);

    let fiyatlar = { vatan: null, mediamarkt: null };
    try {
      fiyatlar = await akakceFiyatlar(urunAdi, kod);
      await sleep(DELAY_MS);
    } catch {}

    const prev = mevcutFiyatlar[kod];
    if (!fiyatlar.vatan      && prev?.vatan)      fiyatlar.vatan      = prev.vatan;
    if (!fiyatlar.mediamarkt && prev?.mediamarkt) fiyatlar.mediamarkt = prev.mediamarkt;

    mevcutFiyatlar[kod] = { kod, urun: urunAdi, vatan: fiyatlar.vatan, mediamarkt: fiyatlar.mediamarkt, ts: new Date().toISOString() };

    if (fiyatlar.vatan || fiyatlar.mediamarkt) {
      bulunan++;
      console.log(`✓ V:${String(fiyatlar.vatan??'—').padStart(7)} MM:${String(fiyatlar.mediamarkt??'—').padStart(7)}`);
    } else {
      bos++; console.log('—');
    }
  }

  const tumFiyatlar = tumUrunler.map(u => {
    const kod = String(u['Kod'] || u['kod'] || '').trim();
    return mevcutFiyatlar[kod] || { kod, urun: String(u['Ürün']||'').trim(), vatan: null, mediamarkt: null, ts: null };
  });

  const sonrakiIndex = endIndex >= urunler.length ? 0 : endIndex;

  writeFileSync(OUTPUT_JSON, JSON.stringify({
    meta: { guncelleme: new Date().toISOString(), toplamUrun: tumUrunler.length, stokluUrun: urunler.length, fiyatBulunan: Object.values(mevcutFiyatlar).filter(p=>p.vatan||p.mediamarkt).length, sonBatch: `${startIndex+1}-${endIndex}` },
    prices: tumFiyatlar,
  }, null, 2), 'utf8');

  writeFileSync(PROGRESS_JSON, JSON.stringify({ toplamUrun: urunler.length, sonrakiIndex, sonGuncelleme: new Date().toISOString() }), 'utf8');

  console.log(`\n✓ Batch bitti. Bulunan: ${bulunan} | Boş: ${bos}`);
  console.log(sonrakiIndex === 0 ? '🎉 Tüm liste tamamlandı.' : `⏭ Devam: ${sonrakiIndex+1}. üründen (${urunler.length-sonrakiIndex} kaldı)`);
}

main().catch(e => { console.error('KRİTİK HATA:', e); process.exit(1); });
