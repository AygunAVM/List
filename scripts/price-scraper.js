/**
 * FINAL v12 - FULL STABLE SYSTEM
 * Multi Source + Smart Filter + Product Match + Cache + Auto Path
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/* ---------------- PATH ---------------- */

function findDataDir() {
  const dirs = readdirSync(ROOT);

  for (const d of dirs) {
    if (d.toLowerCase() === 'data') return join(ROOT, d);

    if (d.toLowerCase() === 'weblist') {
      const inner = readdirSync(join(ROOT, d));
      const found = inner.find(x => x.toLowerCase() === 'data');
      if (found) return join(ROOT, d, found);
    }
  }
  return null;
}

const DATA = findDataDir();
if (!DATA) {
  console.error("DATA klasörü bulunamadı!");
  process.exit(1);
}

const URUNLER = join(DATA, 'urunler.json');
const OUTPUT = join(DATA, 'market-prices.json');
const PROGRESS = join(DATA, 'market-prices-progress.json');

console.log("DATA:", DATA);

/* ---------------- CONFIG ---------------- */

const BATCH_SIZE = 50;
const DELAY = 1200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- SAFE STRING ---------------- */

function toStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/* ---------------- PRICE PARSE ---------------- */

function parsePrice(v) {
  if (!v) return null;

  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;

  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');

  const n = parseFloat(s);
  return (!isNaN(n) && n > 100) ? Math.round(n) : null;
}

/* ---------------- PRODUCT MATCH ---------------- */

function normalize(text) {
  return toStr(text)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isMatch(search, found) {
  const s = normalize(search);
  const f = normalize(found);

  if (!s || !f) return false;

  // En az %60 benzerlik (basit contains)
  return f.includes(s.substring(0, Math.min(10, s.length)));
}

/* ---------------- SMART FILTER ---------------- */

function isValidPrice(fiyat, eski) {
  if (!fiyat) return false;

  if (fiyat < 200) return false;

  if (eski) {
    if (fiyat < eski * 0.3) return false;
    if (fiyat > eski * 3) return false;
  }

  return true;
}

/* ---------------- FETCH ---------------- */

async function safeFetch(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Android)',
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

async function akakce(query) {
  const out = { vatan: null, mediamarkt: null };

  try {
    const html = await safeFetch(`https://www.akakce.com/arama/?q=${encodeURIComponent(query)}`);
    if (!html) return out;

    const blocks = html.split("prdName");

    for (const b of blocks.slice(0, 5)) {

      if (!isMatch(query, b)) continue;

      const priceMatch = b.match(/(\d{2,3}(?:\.\d{3})+)/);
      const price = parsePrice(priceMatch?.[1]);

      if (!price) continue;

      const low = b.toLowerCase();

      if (low.includes("vatan") && !out.vatan) out.vatan = price;
      if (low.includes("mediamarkt") && !out.mediamarkt) out.mediamarkt = price;
    }

  } catch {}

  return out;
}

/* ---------------- CIMRI ---------------- */

async function cimri(query) {
  const out = { vatan: null, mediamarkt: null };

  try {
    const html = await safeFetch(`https://www.cimri.com/arama?q=${encodeURIComponent(query)}`);
    if (!html) return out;

    const parts = html.split("merchantName");

    for (const p of parts.slice(0, 10)) {

      if (!isMatch(query, p)) continue;

      const m = p.match(/(\d{2,3}(?:[.,]\d{3})+)/);
      const fiyat = parsePrice(m?.[1]);

      if (!fiyat) continue;

      const low = p.toLowerCase();

      if (low.includes("vatan") && !out.vatan) out.vatan = fiyat;
      if (low.includes("mediamarkt") && !out.mediamarkt) out.mediamarkt = fiyat;
    }

  } catch {}

  return out;
}

/* ---------------- MULTI SOURCE ---------------- */

async function getPrice(query) {

  let r = await akakce(query);
  if (r.vatan || r.mediamarkt) return r;

  await sleep(300);

  return await cimri(query);
}

/* ---------------- MAIN ---------------- */

async function main() {

  console.log("START");

  if (!existsSync(URUNLER)) {
    console.error("urunler.json bulunamadı!");
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(URUNLER, 'utf8'));
  const urunler = Array.isArray(raw) ? raw : raw.data || [];

  let cache = {};
  if (existsSync(OUTPUT)) {
    const prev = JSON.parse(readFileSync(OUTPUT, 'utf8'));
    (prev.prices || []).forEach(p => cache[toStr(p.kod)] = p);
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

    const ad = toStr(u.Urun || u['Ürün']);
    const kod = toStr(u.Kod || u['kod']);

    if (!ad && !kod) continue;

    process.stdout.write(`${i+1}. ${ad.substring(0,30)} → `);

    let yeni = await getPrice(ad + " " + kod);
    const eski = cache[kod] || {};

    // FILTER
    if (!isValidPrice(yeni.vatan, eski.vatan)) yeni.vatan = eski.vatan || null;
    if (!isValidPrice(yeni.mediamarkt, eski.mediamarkt)) yeni.mediamarkt = eski.mediamarkt || null;

    cache[kod] = {
      kod,
      urun: ad,
      vatan: yeni.vatan,
      mediamarkt: yeni.mediamarkt,
      ts: new Date().toISOString()
    };

    console.log(`V:${yeni.vatan || '-'} MM:${yeni.mediamarkt || '-'}`);

    await sleep(DELAY);
  }

  const all = urunler.map(u => {
    const k = toStr(u.Kod || u['kod']);
    return cache[k] || { kod: k, urun: toStr(u.Urun), vatan: null, mediamarkt: null };
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
