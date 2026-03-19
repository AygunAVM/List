/**
 * FINAL v13 - REAL PRODUCTION
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/* PATH */
function findDataDir() {
  const dirs = readdirSync(ROOT);
  for (const d of dirs) {
    if (d.toLowerCase() === 'data') return join(ROOT, d);
    if (d.toLowerCase() === 'weblist') {
      const inner = readdirSync(join(ROOT, d));
      const f = inner.find(x => x.toLowerCase() === 'data');
      if (f) return join(ROOT, d, f);
    }
  }
  return null;
}

const DATA = findDataDir();
const URUNLER = join(DATA, 'urunler.json');
const OUTPUT = join(DATA, 'market-prices.json');
const PROGRESS = join(DATA, 'market-prices-progress.json');

const BATCH = 50;
const DELAY = 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* TEMİZLEME */
function cleanText(s) {
  return String(s || '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toStr(v) {
  return String(v ?? '').trim();
}

/* FİYAT */
function parsePrice(v) {
  if (!v) return null;
  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return (!isNaN(n) && n > 100) ? Math.round(n) : null;
}

/* SMART FILTER */
function valid(f, old) {
  if (!f) return false;
  if (f < 200) return false;
  if (old) {
    if (f < old * 0.4) return false;
    if (f > old * 2.5) return false;
  }
  return true;
}

/* FETCH */
async function fetchHtml(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    return r.ok ? await r.text() : null;
  } catch { return null; }
}

/* SCRAPER */
async function scrape(query) {
  const out = { vatan: null, mediamarkt: null };

  // Akakçe
  let html = await fetchHtml(`https://www.akakce.com/arama/?q=${encodeURIComponent(query)}`);
  if (html) {
    const m1 = html.match(/vatan[\s\S]{0,200}?(\d{2,3}(?:\.\d{3})+)/i);
    const m2 = html.match(/mediamarkt[\s\S]{0,200}?(\d{2,3}(?:\.\d{3})+)/i);
    if (m1) out.vatan = parsePrice(m1[1]);
    if (m2) out.mediamarkt = parsePrice(m2[1]);
  }

  await sleep(300);

  // Cimri fallback
  html = await fetchHtml(`https://www.cimri.com/arama?q=${encodeURIComponent(query)}`);
  if (html) {
    const parts = html.split("merchantName");
    for (const p of parts) {
      const price = parsePrice(p.match(/(\d{2,3}(?:[.,]\d{3})+)/)?.[1]);
      if (!price) continue;
      const l = p.toLowerCase();
      if (l.includes("vatan") && !out.vatan) out.vatan = price;
      if (l.includes("mediamarkt") && !out.mediamarkt) out.mediamarkt = price;
    }
  }

  return out;
}

/* MAIN */
async function main() {

  const raw = JSON.parse(readFileSync(URUNLER, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.data || [];

  let cache = {};
  if (existsSync(OUTPUT)) {
    const prev = JSON.parse(readFileSync(OUTPUT, 'utf8'));
    (prev.prices || []).forEach(p => cache[p.kod] = p);
  }

  let start = 0;
  if (existsSync(PROGRESS)) {
    start = JSON.parse(readFileSync(PROGRESS)).next || 0;
  }

  const end = Math.min(start + BATCH, list.length);

  for (let i = start; i < end; i++) {

    const u = list[i];

    const kod = cleanText(toStr(u.Kod));
    const ad = cleanText(toStr(u.Urun));

    if (!kod && !ad) continue;

    // 🔥 EN KRİTİK: model ağırlıklı arama
    const query = kod.length > 3 ? kod : ad;

    process.stdout.write(`${i+1}. ${query} → `);

    let r = await scrape(query);
    const old = cache[kod] || {};

    if (!valid(r.vatan, old.vatan)) r.vatan = old.vatan || null;
    if (!valid(r.mediamarkt, old.mediamarkt)) r.mediamarkt = old.mediamarkt || null;

    cache[kod] = {
      kod,
      urun: ad,
      vatan: r.vatan,
      mediamarkt: r.mediamarkt,
      ts: new Date().toISOString()
    };

    console.log(`V:${r.vatan||'-'} MM:${r.mediamarkt||'-'}`);

    await sleep(DELAY);
  }

  writeFileSync(OUTPUT, JSON.stringify({
    meta: { guncelleme: new Date().toISOString() },
    prices: Object.values(cache)
  }, null, 2));

  writeFileSync(PROGRESS, JSON.stringify({
    next: end >= list.length ? 0 : end
  }));

}

main();
