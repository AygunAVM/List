/**
 * FINAL v10 - Stabil Multi Source (Akakce + Cimri + Cache)
 */
console.log("DATA PATH:", DATA);
console.log("URUNLER:", URUNLER);

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

import { readdirSync } from 'fs';

function findDataDir() {
  const dirs = readdirSync(ROOT);
  const dataDir = dirs.find(d => d.toLowerCase() === 'data' || d.toLowerCase() === 'weblist');
  
  if (!dataDir) return null;

  // Weblist varsa onun içindeki Data'yı ara
  if (dataDir.toLowerCase() === 'weblist') {
    const inner = readdirSync(join(ROOT, dataDir));
    const d = inner.find(x => x.toLowerCase() === 'data');
    if (d) return join(ROOT, dataDir, d);
  }

  return join(ROOT, dataDir);
}

const DATA = findDataDir();

if (!DATA) {
  console.error("DATA klasörü bulunamadı!");
  process.exit(1);
}

const URUNLER = join(DATA, 'urunler.json');
const OUTPUT  = join(DATA, 'market-prices.json');
const PROGRESS = join(DATA, 'market-prices-progress.json');
const OUTPUT = join(DATA, 'market-prices.json');
const PROGRESS = join(DATA, 'market-prices-progress.json');

const BATCH_SIZE = 50;
const DELAY = 1200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- HELPERS ---------------- */

function parsePrice(v) {
  if (!v) return null;
  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return (!isNaN(n) && n > 100) ? Math.round(n) : null;
}

async function safeFetch(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10)',
        'Accept-Language': 'tr-TR'
      }
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/* ---------------- AKAKCE ---------------- */

async function akakce(urun) {
  const out = { vatan: null, mediamarkt: null };

  try {
    const url = `https://www.akakce.com/arama/?q=${encodeURIComponent(urun)}`;
    const html = await safeFetch(url);
    if (!html) return out;

    const lower = html.toLowerCase();

    if (lower.includes("vatan")) {
      const m = html.match(/vatan[\s\S]{0,200}?(\d{2,3}(?:\.\d{3})+)/i);
      if (m) out.vatan = parsePrice(m[1]);
    }

    if (lower.includes("mediamarkt")) {
      const m = html.match(/mediamarkt[\s\S]{0,200}?(\d{2,3}(?:\.\d{3})+)/i);
      if (m) out.mediamarkt = parsePrice(m[1]);
    }

  } catch {}

  return out;
}

/* ---------------- CIMRI ---------------- */

async function cimri(urun) {
  const out = { vatan: null, mediamarkt: null };

  try {
    const url = `https://www.cimri.com/arama?q=${encodeURIComponent(urun)}`;
    const html = await safeFetch(url);
    if (!html) return out;

    const parts = html.split("merchantName");

    for (const p of parts) {
      const low = p.toLowerCase();
      const m = p.match(/(\d{2,3}(?:[.,]\d{3})+)/);

      if (!m) continue;
      const fiyat = parsePrice(m[1]);
      if (!fiyat) continue;

      if (low.includes("vatan") && !out.vatan) out.vatan = fiyat;
      if (low.includes("mediamarkt") && !out.mediamarkt) out.mediamarkt = fiyat;
    }

  } catch {}

  return out;
}

/* ---------------- MULTI SOURCE ---------------- */

async function getPrice(urun) {

  let r = await akakce(urun);
  if (r.vatan || r.mediamarkt) return r;

  await sleep(300);

  r = await cimri(urun);
  return r;
}

/* ---------------- MAIN ---------------- */

async function main() {

  console.log("START");

  const list = JSON.parse(readFileSync(URUNLER, 'utf8'));
  const urunler = Array.isArray(list) ? list : list.data || [];

  let cache = {};
  if (existsSync(OUTPUT)) {
    const prev = JSON.parse(readFileSync(OUTPUT, 'utf8'));
    (prev.prices || []).forEach(p => cache[p.kod] = p);
  }

  let start = 0;
  if (existsSync(PROGRESS)) {
    const prog = JSON.parse(readFileSync(PROGRESS, 'utf8'));
    start = prog.next || 0;
  }

  const end = Math.min(start + BATCH_SIZE, urunler.length);
  console.log(`BATCH ${start}-${end}`);

  for (let i = start; i < end; i++) {

    const u = urunler[i];
    const ad = (u.Urun || u['Ürün'] || '').trim();
    const kod = (u.Kod || '').trim();

    if (!ad && !kod) continue;

    process.stdout.write(`${i+1}. ${ad.substring(0,30)} → `);

    let fiyat = await getPrice(ad + " " + kod);

    const eski = cache[kod] || {};

    // CACHE KORUMA
    if (!fiyat.vatan && eski.vatan) fiyat.vatan = eski.vatan;
    if (!fiyat.mediamarkt && eski.mediamarkt) fiyat.mediamarkt = eski.mediamarkt;

    cache[kod] = {
      kod,
      urun: ad,
      vatan: fiyat.vatan,
      mediamarkt: fiyat.mediamarkt,
      ts: new Date().toISOString()
    };

    console.log(`V:${fiyat.vatan || '-'} MM:${fiyat.mediamarkt || '-'}`);

    await sleep(DELAY);
  }

  const all = urunler.map(u => {
    const k = (u.Kod || '').trim();
    return cache[k] || { kod: k, urun: u.Urun, vatan: null, mediamarkt: null };
  });

  writeFileSync(OUTPUT, JSON.stringify({
    meta: {
      guncelleme: new Date().toISOString(),
      toplam: urunler.length
    },
    prices: all
  }, null, 2));

  const next = end >= urunler.length ? 0 : end;

  writeFileSync(PROGRESS, JSON.stringify({
    next,
    ts: new Date().toISOString()
  }));

  console.log("DONE");
}

main();
