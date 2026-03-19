/**
 * FINAL v11 - Stabil Multi Source + Smart Filter + Cache + Auto Path
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/* ---------------- DATA PATH AUTO ---------------- */

function findDataDir() {
  const dirs = readdirSync(ROOT);

  for (const d of dirs) {
    if (d.toLowerCase() === 'data') {
      return join(ROOT, d);
    }

    if (d.toLowerCase() === 'weblist') {
      const inner = readdirSync(join(ROOT, d));
      const data = inner.find(x => x.toLowerCase() === 'data');
      if (data) return join(ROOT, d, data);
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

/* ---------------- HELPERS ---------------- */

function parsePrice(v) {
  if (!v) return null;

  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;

  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');

  const n = parseFloat(s);
  return (!isNaN(n) && n > 100) ? Math.round(n) : null;
}

/* ---------------- AKILLI FİLTRE ---------------- */

function isValidPrice(fiyat, eski) {
  if (!fiyat) return false;

  // Çok düşük saçma fiyat
  if (fiyat < 200) return false;

  // Eskiye göre aşırı sapma (%70 aşağı / %200 yukarı)
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

async function akakce(q) {
  const out = { vatan: null, mediamarkt: null };

  try {
    const html = await safeFetch(`https://www.akakce.com/arama/?q=${encodeURIComponent(q)}`);
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

async function cimri(q) {
  const out = { vatan: null, mediamarkt: null };

  try {
    const html = await safeFetch(`https://www.cimri.com/arama?q=${encodeURIComponent(q)}`);
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

async function getPrice(q) {

  let r = await akakce(q);
  if (r.vatan || r.mediamarkt) return r;

  await sleep(300);

  return await cimri(q);
}

/* ---------------- MAIN ---------------- */

async function main() {

  console.log("START");

  if (!existsSync(URUNLER)) {
    console.error("urunler.json bulunamadı!");
    process.exit(1);
  }

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

    let yeni = await getPrice(ad + " " + kod);
    const eski = cache[kod] || {};

    // SMART FILTER
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
