// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — sevkiyat-belge.js  (Rev 11.0 — yazdırılabilir belgeler + WhatsApp)
// ═══════════════════════════════════════════════════════════════
import { B, esc, tarihTR, kalemListe, tl, teslimTuru, kalemSerisiz, saatSira, kalemTur, gruplar, grupTeslim, grupPartileri, servisAdlari, TUR_KISA } from './sevkiyat-veri.js?v=V11.31-20261026-2101';

const IMZA_OK = u => typeof u === 'string' && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(u) && u.length < 60000;

const CSS =
  'body{font-family:Arial,Helvetica,sans-serif;color:#1c1c1e;margin:24px;font-size:13px}' +
  'h1{font-size:18px;margin:0 0 2px}h2{font-size:14px;margin:18px 0 6px;padding:4px 8px;background:#f4f4f5;border-left:4px solid #D01F2E}' +
  '.sub{color:#71717a;font-size:11px;margin-bottom:14px}' +
  '.bilgi{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin-bottom:14px}' +
  '.bilgi div{border-bottom:1px solid #e4e4e7;padding:3px 0}.bilgi b{display:inline-block;min-width:86px;color:#52525b}' +
  'table{width:100%;border-collapse:collapse;margin-bottom:18px}th,td{border:1px solid #d4d4d8;padding:7px 8px;text-align:left;vertical-align:top}' +
  'th{background:#f4f4f5;font-size:11px}td.seri{font-family:monospace;min-width:150px}td.chk{width:34px;text-align:center;font-size:16px}' +
  '.imza{display:flex;gap:40px;margin-top:34px}.imza div{flex:1;font-size:11px;color:#52525b}.imza span{display:block;border-bottom:1px solid #1c1c1e;height:34px}' +
  '.imza span img{height:34px;display:block}' +
  '.kabul{font-size:11px;color:#52525b}.tahsil{margin:10px 0;padding:8px 10px;border:2px solid #D01F2E;font-weight:700}' +
  '.pbtn{position:fixed;top:10px;right:10px;padding:8px 16px;border:0;border-radius:6px;background:#D01F2E;color:#fff;font-weight:700;cursor:pointer}' +
  '@media print{.pbtn{display:none}body{margin:10mm}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}';

function sayfa(baslik, govde) {
  return '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>' + esc(baslik) + '</title><style>' + CSS + '</style></head><body>' +
    '<button class="pbtn" onclick="window.print()">Yazdır</button>' + govde + '</body></html>';
}

export function belgeHtml(tip, s) {
  const depo = tip === 'depo';
  const baslik = depo ? 'DEPO SEVKİYAT FİŞİ' : 'TESLİMAT BELGESİ';
  const satirlar = kalemListe(s).map((k, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + esc(k.urun) + '</td><td>' + esc(k.kod) + '</td><td class="seri">' +
    ((!k.seriNo && kalemSerisiz(k)) ? '<i>Serisiz ürün</i>' : esc(k.seriNo || '')) + '</td>' +
    '<td>' + esc(TUR_KISA[kalemTur(s, k)]) + (kalemTur(s, k) === 'servis' && k.servis ? '<br><small>' + esc(k.servis) + '</small>' : '') + '</td>' +
    (depo ? '<td><b>' + esc(k.depo || '—') + '</b></td><td class="chk">☐</td>' : '') + '</tr>').join('');
  const G = gruplar(s), karma = G.length > 1;
  const sekilMetin = karma ? 'Karma: ürün bazlı (aşağıdaki “Teslim” sütunu)'
    : (G[0] === 'musteri' ? 'Müşteriye doğrudan teslim' : 'Servise teslim' + (servisAdlari(s).length ? ' (' + servisAdlari(s).join(', ') + ')' : ''));
  const tahsil = Number(s.tahsilatTutari) > 0 && !s.tahsilatAlindi
    ? [['Teslimde Tahsilat', tl(s.tahsilatTutari)]] : [];
  const bilgi = (depo
    ? [['Satış No', s.saleNo], ['Müşteri', s.musteri], ['Telefon', s.telefon], ['Teslimat', tarihTR(s.teslimTarihi) + ' ' + (s.teslimSaati || '')],
       ['Teslim Şekli', sekilMetin],
       ['Satış Noktası', s.satisNoktasi || '—'], ['Not', s.not || '—']]
    : [['Satış No', s.saleNo], ['Müşteri', s.musteri], ['Telefon', s.telefon + (s.telefon2 ? ' / ' + s.telefon2 : '')], ['Adres', s.adres || '—'],
       ['Teslimat', tarihTR(s.teslimTarihi) + ' ' + (s.teslimSaati || '')], ['Teslim Şekli', sekilMetin]]).concat(tahsil);
  // V11.11: her teslim grubunun (servis / müşteri) kendi teslim alan + imza bloğu vardır; eski kayıtlarda tek kayıt (servisTeslim / teslimEdildi)
  const grupBlok = tur => {
    const partiler = grupPartileri(s, tur);   // V11.21: kısmi tesliminde her parti kendi imzasıyla
    const liste = partiler.length ? partiler : [{ te: (G.length === 1 ? (s.teslimEdildi || {}) : {}), kalemler: [] }];
    return liste.map(pt => {
      const te = pt.te || {}, imza = IMZA_OK(te.imza) ? '<img alt="imza" src="' + te.imza + '">' : '';
      const urunler = liste.length > 1 && pt.kalemler.length ? '<br><small>' + pt.kalemler.map(x => esc(x.urun)).join(', ') + '</small>' : '';
      return '<div class="imza"><div>' + (karma ? (tur === 'musteri' ? 'Müşteri alır — ' : 'Servis götürür — ') : '') + 'Teslim Alan ' + (tur === 'musteri' ? 'Ad Soyad' : 'Servis Yetkilisi') + (te.alan ? ': <b>' + esc(te.alan) + '</b>' : '') + urunler +
        '<span></span></div><div>Tarih / İmza' + (te.t ? ': ' + esc(new Date(te.t).toLocaleString('tr-TR')) : '') + '<span>' + imza + '</span></div></div>';
    }).join('');
  };
  const alt = depo
    ? '<div class="imza"><div>Hazırlayan (Depo)<span></span></div><div>Teslim Alan (' + (G.length === 1 && G[0] === 'musteri' ? 'Müşteri' : 'Servis') + ')<span></span></div></div>'
    : '<p class="kabul">Yukarıda cinsi, seri numarası belirtilen ürünleri eksiksiz ve çalışır durumda teslim aldım.</p>' + G.map(grupBlok).join('');
  const govde =
    '<h1>AYGÜN AVM — ' + baslik + '</h1><div class="sub">Düzenlenme: ' + esc(new Date().toLocaleString('tr-TR')) + '</div>' +
    '<div class="bilgi">' + bilgi.map(([a, b]) => '<div><b>' + esc(a) + '</b>' + esc(b) + '</div>').join('') + '</div>' +
    '<table><thead><tr><th>#</th><th>Ürün</th><th>Kod</th><th>Seri / Barkod</th><th>Teslim</th>' + (depo ? '<th>Depo</th><th>✓</th>' : '') + '</tr></thead><tbody>' +
    satirlar + '</tbody></table>' + alt;
  return sayfa(baslik + ' ' + s.saleNo, govde);
}
export const belgeAc = (tip, s) => B().openPdf(belgeHtml(tip, s));

// Günlük yükleme / dağıtım listesi: servise göre gruplu, saate göre sıralı
export function yuklemeListesiHtml(liste, etiket) {
  // V11.11: karma kayıt iki yerde görünür — servis götürülecek ürünler servisin altında, müşterinin alacakları “Müşteriye Teslim” altında
  const gruplarM = new Map();
  liste.forEach(s => {
    gruplar(s).forEach(tur => {
      const g = tur === 'musteri' ? 'Müşteriye Teslim' : (servisAdlari(s).join(' · ') || 'Servise Teslim');
      if (!gruplarM.has(g)) gruplarM.set(g, []);
      gruplarM.get(g).push({ s, tur });
    });
  });
  const govde = ['<h1>AYGÜN AVM — YÜKLEME / DAĞITIM LİSTESİ</h1><div class="sub">Teslimat: ' + esc(etiket) +
    ' · Toplam ' + liste.length + ' sevkiyat · Düzenlenme: ' + esc(new Date().toLocaleString('tr-TR')) + '</div>'];
  [...gruplarM.keys()].sort((a, b) => a.localeCompare(b, 'tr')).forEach(g => {
    const grup = gruplarM.get(g).sort((a, b) => saatSira(a.s.teslimSaati).localeCompare(saatSira(b.s.teslimSaati)));
    govde.push('<h2>🚚 ' + esc(g) + ' (' + grup.length + ')</h2><table><thead><tr><th>Saat</th><th>Müşteri / Tel</th><th>Adres</th><th>Ürünler (seri)</th><th>Not / Tahsilat</th><th>✓</th></tr></thead><tbody>');
    grup.forEach(({ s, tur }) => {
      const urun = kalemListe(s).filter(k => kalemTur(s, k) === tur).map(k => esc(k.urun) + (k.depo ? ' <small>[' + esc(k.depo) + ']</small>' : '') + ' <small>' + ((!k.seriNo && kalemSerisiz(k)) ? 'serisiz' : esc(k.seriNo || '— seri yok —')) + '</small>').join('<br>');
      const diger = gruplar(s).length > 1 ? '<br><small>(Aynı müşterinin ' + (tur === 'musteri' ? 'servisle giden' : 'kendisi alacağı') + ' ürünleri ayrı listede)</small>' : '';
      const tah = Number(s.tahsilatTutari) > 0 && !s.tahsilatAlindi ? '<b>Tahsilat: ' + esc(tl(s.tahsilatTutari)) + '</b><br>' : '';
      govde.push('<tr><td>' + esc(s.teslimSaati || '—') + '</td><td><b>' + esc(s.musteri) + '</b><br>' + esc(s.telefon) +
        '</td><td>' + esc(s.adres || '—') + '</td><td>' + urun + diger + '</td><td>' + tah + esc(s.not || '') + '</td><td class="chk">☐</td></tr>');
    });
    govde.push('</tbody></table>');
  });
  if (!liste.length) govde.push('<p>Bu gün için sevkiyat yok.</p>');
  return sayfa('Yükleme Listesi ' + etiket, govde.join(''));
}
export const listeAc = (liste, etiket) => B().openPdf(yuklemeListesiHtml(liste, etiket));

export function waAc(s) {
  const msg = 'Sn ' + s.musteri + ',\nAygün AVM siparişiniz (' + s.saleNo + ') ' + tarihTR(s.teslimTarihi) +
    (s.teslimSaati ? ' ' + s.teslimSaati : '') + ' tarihinde teslim edilecektir.' +
    (Number(s.tahsilatTutari) > 0 && !s.tahsilatAlindi ? '\nTeslimatta tahsil edilecek tutar: ' + tl(s.tahsilatTutari) + '.' : '') +
    '\nBilgilerinize sunar, iyi günler dileriz.';
  window.open('https://wa.me/9' + s.telefon + '?text=' + encodeURIComponent(msg), '_blank');
}
export function waTeslimAc(s) {
  const msg = 'Sn ' + s.musteri + ',\nAygün AVM siparişiniz (' + s.saleNo + ') teslim edilmiştir. Bizi tercih ettiğiniz için teşekkür ederiz, keyifle kullanmanızı dileriz.';
  window.open('https://wa.me/9' + s.telefon + '?text=' + encodeURIComponent(msg), '_blank');
}

// Servise WhatsApp'tan gönderilecek bilgi mesajı (kopyala-yapıştır)
const telBicim = t => { const d = String(t || '').replace(/\D/g, '').replace(/^90/, '').replace(/^0?/, '0'); return d.length === 11 ? d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7, 9) + ' ' + d.slice(9) : String(t || '').trim(); };
export function servisMesaji(s) {
  // V11.14: marka bazlı bloklar — `VESTEL` / `SAMSUNG` …; yalnızca servisin götüreceği/alacağı ürünler (müşterinin aldıkları yazılmaz).
  // Seri numarası gerekmez: servis gün öncesinden çağrılabilsin diye kod + depo yeterlidir.
  const tel = [s.telefon, s.telefon2].filter(x => String(x || '').replace(/\D/g, '').length >= 10).map(telBicim).join(' ⎇ ');
  const tarih = String(s.teslimTarihi || '').split('-').reverse().join('/');
  const servisKalem = kalemListe(s).filter(k => kalemTur(s, k) === 'servis');
  const markaOf = k => {
    let m = String(k.marka || '').trim();
    if (!m) { const p = (B() && B().urunBul && B().urunBul(k.kod)) || null; m = p ? String(p['Marka'] || p.marka || '').trim() : ''; }
    return m ? m.toLocaleUpperCase('tr-TR') : 'DİĞER';
  };
  const gamOf = k => {
    let g = String(k.gam || '').trim();
    if (!g) { const p = (B() && B().urunBul && B().urunBul(k.kod)) || null; g = p ? String(p['Ürün Gamı'] || p.gam || '').trim() : ''; }
    return g || k.urun || k.kod || '';
  };
  const markalar = new Map();
  servisKalem.forEach(k => { const m = markaOf(k); if (!markalar.has(m)) markalar.set(m, []); markalar.get(m).push(k); });
  if (!markalar.size) return 'Bu kayıtta servise gidecek ürün yok (tüm ürünleri müşteri alıyor).';
  const blok = (m, kalemler) => {
    const sat = ['`' + m + '`'];
    sat.push(String(s.musteri || '').toLocaleUpperCase('tr-TR'));
    if (tel) sat.push('* ' + tel);
    if (s.adres) sat.push('📍 ' + String(s.adres).replace(/\s+/g, ' ').toLocaleUpperCase('tr-TR'));
    sat.push('> ' + tarih + ', ' + (s.teslimSaati || 'Gün içinde') + (s.satisNoktasi ? ' - ' + s.satisNoktasi + ' Satışıdır' : ''));
    if (Number(s.tahsilatTutari) > 0 && !s.tahsilatAlindi) sat.push('💰 Tahsilat: ' + tl(s.tahsilatTutari));
    if (s.not) sat.push('_' + s.not + '_');
    sat.push('', '📦');
    const gamlar = new Map();
    kalemler.forEach(k => { const g = gamOf(k); if (!gamlar.has(g)) gamlar.set(g, []); gamlar.get(g).push(k); });
    gamlar.forEach((ks, g) => { sat.push('*' + g + '*'); ks.forEach(k => sat.push('• ' + (k.kod || k.urun) + (k.depo ? ' - ' + k.depo : ''))); });
    return sat.join('\n');
  };
  return [...markalar].map(([m, ks]) => blok(m, ks)).join('\n\n');
}
