/**
 * Piyasa Fiyat Takip v7
 * - Sadece stoklu ürünler
 * - Her çalışmada 60 ürün işler (kalan bir sonrakine)
 * - Tüm liste bitince sıfırdan başlar
 * - Önceki bulunan fiyatları korur
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

const BATCH_SIZE = 60;   // Her çalışmada işlenecek ürün sayısı
const DELAY_MS   = 900;
const TIMEOUT_MS = 6000;

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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,*/*',
        'Accept-Language': 'tr-TR,tr;q=0.9',
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

function fiyatBul(html, anahtarlar) {
  if (!html) return null;
  const lower = html.toLowerCase();
  for (const anahtar of anahtarlar) {
    let pos = lower.indexOf(anahtar);
    while (pos !== -1) {
      const pencere = html.substring(Math.max(0, pos - 50), pos + 400);
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

async function vatanFiyat(urunAdi, kod) {
  for (const sorgu of [String(kod).trim(), temizle(urunAdi)].filter(s => s.length > 2)) {
    const html = await safeFetch(`https://www.vatanbilgisayar.com/arama/?q=${encodeURIComponent(sorgu)}`);
    if (!html) continue;
    // JSON-LD
    const m = html.match(/"price"\s*:\s*"?([\d.,]+)"?/);
    if (m) { const f = parsePrice(m[1]); if (f > 100) return f; }
    const f = fiyatBul(html, ['vatanbilgisayar', 'vatan-fiyat', 'product-price']);
    if (f) return f;
  }
  return null;
}

async function mediamarktFiyat(urunAdi, kod) {
  for (const sorgu of [String(kod).trim(), temizle(urunAdi)].filter(s => s.length > 2)) {
    const html = await safeFetch(`https://www.mediamarkt.com.tr/tr/search.html?query=${encodeURIComponent(sorgu)}`);
    if (!html) continue;
    const m = html.match(/"price"\s*:\s*"?([\d.,]+)"?/);
    if (m) { const f = parsePrice(m[1]); if (f > 100) return f; }
    const f = fiyatBul(html, ['mediamarkt', 'product-price', 'price-tag']);
    if (f) return f;
  }
  return null;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Başlatılıyor...`);

  if (!existsSync(URUNLER_JSON)) {
    console.error('HATA: urunler.json bulunamadı'); process.exit(1);
  }

  const raw     = JSON.parse(readFileSync(URUNLER_JSON, 'utf8'));
  const tumUrunler = raw.data || (Array.isArray(raw) ? raw : []);

  // Sadece stoklu ürünler
  const urunler = tumUrunler.filter(u => Number(u.Stok || u.stok || 0) > 0);
  console.log(`Stoklu ürün: ${urunler.length} / ${tumUrunler.length}`);

  // Önceki sonuçları yükle
  let mevcutFiyatlar = {};
  if (existsSync(OUTPUT_JSON)) {
    try {
      const prev = JSON.parse(readFileSync(OUTPUT_JSON, 'utf8'));
      (prev.prices || []).forEach(p => { mevcutFiyatlar[String(p.kod).trim()] = p; });
    } catch {}
  }

  // Progress — kaçıncı üründen devam edilecek
  let startIndex = 0;
  if (existsSync(PROGRESS_JSON)) {
    try {
      const prog = JSON.parse(readFileSync(PROGRESS_JSON, 'utf8'));
      // Aynı ürün listesi için devam et
      if (prog.toplamUrun === urunler.length) {
        startIndex = prog.sonrakiIndex || 0;
        console.log(`Devam ediliyor: ${startIndex}. üründen (${urunler.length - startIndex} kaldı)`);
      }
    } catch {}
  }

  // Tüm liste bittiyse sıfırla
  if (startIndex >= urunler.length) {
    console.log('Tüm liste işlendi, sıfırdan başlanıyor.');
    startIndex = 0;
  }

  const endIndex = Math.min(startIndex + BATCH_SIZE, urunler.length);
  const batch    = urunler.slice(startIndex, endIndex);
  console.log(`Bu çalışma: ${startIndex + 1} - ${endIndex} arası (${batch.length} ürün)\n`);

  let bulunan = 0, bos = 0;

  for (let i = 0; i < batch.length; i++) {
    const u       = batch[i];
    const urunAdi = String(u['Ürün'] || u['urun'] || '').trim();
    const kod     = String(u['Kod']  || u['kod']  || '').trim();
    if (!urunAdi && !kod) continue;

    process.stdout.write(`[${startIndex + i + 1}/${urunler.length}] ${urunAdi.substring(0, 33).padEnd(33)} `);

    let vatanF = null, mmF = null;
    try {
      vatanF = await vatanFiyat(urunAdi, kod);
      await sleep(DELAY_MS);
      mmF    = await mediamarktFiyat(urunAdi, kod);
      await sleep(DELAY_MS);
    } catch {}

    // Bulunamazsa önceki değeri koru
    const prev = mevcutFiyatlar[kod];
    if (!vatanF && prev?.vatan)      vatanF = prev.vatan;
    if (!mmF    && prev?.mediamarkt) mmF    = prev.mediamarkt;

    mevcutFiyatlar[kod] = { kod, urun: urunAdi, vatan: vatanF, mediamarkt: mmF, ts: new Date().toISOString() };

    if (vatanF || mmF) { bulunan++; console.log(`✓ V:${String(vatanF??'—').padStart(7)} MM:${String(mmF??'—').padStart(7)}`); }
    else               { bos++;     console.log('—'); }
  }

  // Tüm stoklu ürünleri birleştir (stoksuzlar için önceki fiyat korunur)
  const tumFiyatlar = tumUrunler.map(u => {
    const kod = String(u['Kod'] || u['kod'] || '').trim();
    return mevcutFiyatlar[kod] || { kod, urun: String(u['Ürün']||'').trim(), vatan: null, mediamarkt: null, ts: null };
  });

  // Sonraki index
  const sonrakiIndex = endIndex >= urunler.length ? 0 : endIndex;
  const tumBitti     = endIndex >= urunler.length;

  // Çıktıyı yaz
  const cikti = {
    meta: {
      guncelleme:   new Date().toISOString(),
      toplamUrun:   tumUrunler.length,
      stokluUrun:   urunler.length,
      fiyatBulunan: Object.values(mevcutFiyatlar).filter(p => p.vatan || p.mediamarkt).length,
      sonBatch:     `${startIndex + 1}-${endIndex}`,
      tamamlandi:   tumBitti,
    },
    prices: tumFiyatlar,
  };
  writeFileSync(OUTPUT_JSON, JSON.stringify(cikti, null, 2), 'utf8');

  // Progress kaydet
  writeFileSync(PROGRESS_JSON, JSON.stringify({
    toplamUrun:   urunler.length,
    sonrakiIndex: sonrakiIndex,
    sonGuncelleme: new Date().toISOString(),
  }), 'utf8');

  console.log(`\n✓ Bu batch tamamlandı. Bulunan: ${bulunan} | Boş: ${bos}`);
  console.log(tumBitti
    ? '🎉 Tüm liste işlendi! Sıradaki çalışmada baştan başlanacak.'
    : `⏭  Devam: ${sonrakiIndex + 1}. üründen itibaren (${urunler.length - sonrakiIndex} kaldı)`);
}

main().catch(e => { console.error('KRİTİK HATA:', e); process.exit(1); });
