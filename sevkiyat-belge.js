// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — sevkiyat-belge.js  (Rev 11.0 — yazdırılabilir belgeler + WhatsApp)
// ═══════════════════════════════════════════════════════════════
import { B, esc, tarihTR, kalemListe, tl, teslimTuru, seriGerekir } from './sevkiyat-veri.js?v=V11.3-20261006-0805';

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
    ((!k.seriNo && !seriGerekir(k.kod)) ? '<i>Serisiz ürün</i>' : esc(k.seriNo || '')) + '</td>' +
    (depo ? '<td class="chk">☐</td>' : '') + '</tr>').join('');
  const tahsil = Number(s.tahsilatTutari) > 0 && !s.tahsilatAlindi
    ? [['Teslimde Tahsilat', tl(s.tahsilatTutari)]] : [];
  const bilgi = (depo
    ? [['Satış No', s.saleNo], ['Müşteri', s.musteri], ['Telefon', s.telefon], ['Teslimat', tarihTR(s.teslimTarihi) + ' ' + (s.teslimSaati || '')],
       ['Teslim Şekli', teslimTuru(s) === 'musteri' ? 'Müşteriye doğrudan teslim' : 'Servis: ' + (s.atananServis || 'Belirlenmedi')],
       ['Satış Noktası', s.satisNoktasi || '—'], ['Not', s.not || '—']]
    : [['Satış No', s.saleNo], ['Müşteri', s.musteri], ['Telefon', s.telefon + (s.telefon2 ? ' / ' + s.telefon2 : '')], ['Adres', s.adres || '—'],
       ['Teslimat', tarihTR(s.teslimTarihi) + ' ' + (s.teslimSaati || '')], ['Teslim Şekli', teslimTuru(s) === 'musteri' ? 'Müşteriye doğrudan teslim' : 'Servis: ' + (s.atananServis || '—')]]).concat(tahsil);
  // V11.2: teslim alan / imza artık 'servisTeslim' kaydında (servis yetkilisine teslim); eski kayıtlarda teslimEdildi
  const te = (s.servisTeslim && (s.servisTeslim.alan || s.servisTeslim.imza)) ? s.servisTeslim : (s.teslimEdildi || {});
  const imza = IMZA_OK(te.imza) ? '<img alt="imza" src="' + te.imza + '">' : '';
  const alt = depo
    ? '<div class="imza"><div>Hazırlayan (Depo)<span></span></div><div>Teslim Alan (Servis)<span></span></div></div>'
    : '<p class="kabul">Yukarıda cinsi, seri numarası belirtilen ürünleri eksiksiz ve çalışır durumda teslim aldım.</p>' +
      '<div class="imza"><div>Teslim Alan ' + (teslimTuru(s) === 'musteri' ? 'Ad Soyad' : 'Servis Yetkilisi') + (te.alan ? ': <b>' + esc(te.alan) + '</b>' : '') +
      '<span></span></div><div>Tarih / İmza<span>' + imza + '</span></div></div>';
  const govde =
    '<h1>AYGÜN AVM — ' + baslik + '</h1><div class="sub">Düzenlenme: ' + esc(new Date().toLocaleString('tr-TR')) + '</div>' +
    '<div class="bilgi">' + bilgi.map(([a, b]) => '<div><b>' + esc(a) + '</b>' + esc(b) + '</div>').join('') + '</div>' +
    '<table><thead><tr><th>#</th><th>Ürün</th><th>Kod</th><th>Seri / Barkod</th>' + (depo ? '<th>✓</th>' : '') + '</tr></thead><tbody>' +
    satirlar + '</tbody></table>' + alt;
  return sayfa(baslik + ' ' + s.saleNo, govde);
}
export const belgeAc = (tip, s) => B().openPdf(belgeHtml(tip, s));

// Günlük yükleme / dağıtım listesi: servise göre gruplu, saate göre sıralı
export function yuklemeListesiHtml(liste, etiket) {
  const gruplar = new Map();
  liste.forEach(s => {
    const g = teslimTuru(s) === 'musteri' ? 'Müşteriye Teslim' : (s.atananServis || 'Servis atanmadı');
    if (!gruplar.has(g)) gruplar.set(g, []);
    gruplar.get(g).push(s);
  });
  const govde = ['<h1>AYGÜN AVM — YÜKLEME / DAĞITIM LİSTESİ</h1><div class="sub">Teslimat: ' + esc(etiket) +
    ' · Toplam ' + liste.length + ' sevkiyat · Düzenlenme: ' + esc(new Date().toLocaleString('tr-TR')) + '</div>'];
  [...gruplar.keys()].sort((a, b) => a.localeCompare(b, 'tr')).forEach(g => {
    const grup = gruplar.get(g).sort((a, b) => (a.teslimSaati || '99:99').localeCompare(b.teslimSaati || '99:99'));
    govde.push('<h2>🚚 ' + esc(g) + ' (' + grup.length + ')</h2><table><thead><tr><th>Saat</th><th>Müşteri / Tel</th><th>Adres</th><th>Ürünler (seri)</th><th>Not / Tahsilat</th><th>✓</th></tr></thead><tbody>');
    grup.forEach(s => {
      const urun = kalemListe(s).map(k => esc(k.urun) + ' <small>' + ((!k.seriNo && !seriGerekir(k.kod)) ? 'serisiz' : esc(k.seriNo || '— seri yok —')) + '</small>').join('<br>');
      const tah = Number(s.tahsilatTutari) > 0 && !s.tahsilatAlindi ? '<b>Tahsilat: ' + esc(tl(s.tahsilatTutari)) + '</b><br>' : '';
      govde.push('<tr><td>' + esc(s.teslimSaati || '—') + '</td><td><b>' + esc(s.musteri) + '</b><br>' + esc(s.telefon) +
        '</td><td>' + esc(s.adres || '—') + '</td><td>' + urun + '</td><td>' + tah + esc(s.not || '') + '</td><td class="chk">☐</td></tr>');
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
