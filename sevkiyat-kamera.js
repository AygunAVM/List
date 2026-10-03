// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — sevkiyat-kamera.js  (Rev 11.0 — sürekli barkod/seri tarama)
// ═══════════════════════════════════════════════════════════════
//  · SÜREKLİ TARAMA: kamera ilk okumada kapanmaz. Her okumada `onKod(kod)`
//    çağrılır; sonuç ekranda gösterilir (bip + titreşim), `bitti:true`
//    dönünce kamera kendiliğinden kapanır.
//  · TEKRAR KORUMASI: aynı kod kısa sürede art arda okunursa yok sayılır
//    (başarıda 2.5 sn, hatada 4 sn) — aynı seri iki kez işlenmez, hata
//    mesajı da spam yapmaz.
//  · HIZ: Chrome/Android'de yerel BarcodeDetector (tam kare, donanım destekli)
//    birincil; yoksa (Safari/iOS) ZXing, hedef kareden kırpılmış canvas'ı
//    DOĞRUDAN çözer (JPEG/base64 gidiş-dönüşü yok). Yerel okuyucu varken
//    her 4. turda ZXing de denenir (yedek).
//  · KAMERA: sürekli otofokus, el feneri ve 2x yakınlaştırma (cihaz destekliyorsa).
//  · "📸" düğmesi son çare: ImageCapture ile gerçek yüksek çözünürlüklü kare.
//
//  onKod(kod) → Promise<{ ok:boolean, mesaj?:string, bitti?:boolean, siradaki?:string }>
// ═══════════════════════════════════════════════════════════════
const _CROP = { x: 0.10, y: 0.38, w: 0.80, h: 0.24 }; // hedef kare (video native yüzdesi) — CSS .svk-cam-frame ile aynı
const _ISTENEN = ['code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'qr_code', 'data_matrix'];

let _ses = null;
function bip(ok) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    _ses = _ses || new AC();
    if (_ses.state === 'suspended') _ses.resume().catch(() => {});
    const calis = (f, t0, sure) => {
      const o = _ses.createOscillator(), g = _ses.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, _ses.currentTime + t0);
      g.gain.exponentialRampToValueAtTime(0.25, _ses.currentTime + t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, _ses.currentTime + t0 + sure);
      o.connect(g); g.connect(_ses.destination);
      o.start(_ses.currentTime + t0); o.stop(_ses.currentTime + t0 + sure + 0.02);
    };
    if (ok) calis(1100, 0, 0.12); else { calis(300, 0, 0.18); calis(220, 0.22, 0.25); }
  } catch (e) { /* ses opsiyonel */ }
  try { if (navigator.vibrate) navigator.vibrate(ok ? 60 : [120, 60, 120]); } catch (e) {}
}

export async function kameraTara(opt) {
  const ayAlert = window.ayAlert || (m => { alert(m); return Promise.resolve(); });
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    await ayAlert('Bu cihaz/tarayıcı kamera erişimini desteklemiyor. El terminali/klavye ile girin.'); return;
  }

  // Yerel okuyucu (varsa)
  let yerel = null;
  if ('BarcodeDetector' in window) {
    try {
      const destek = await window.BarcodeDetector.getSupportedFormats();
      const kullan = _ISTENEN.filter(f => destek.includes(f));
      if (kullan.length) yerel = new window.BarcodeDetector({ formats: kullan });
    } catch (e) { console.warn('BarcodeDetector:', e); }
  }
  // ZXing (yedek / Safari)
  const Z = window.ZXing;
  let zxing = null;
  if (Z && Z.MultiFormatReader) {
    const hints = new Map();
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
      Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.CODE_93, Z.BarcodeFormat.CODABAR,
      Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E,
      Z.BarcodeFormat.ITF, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX
    ]);
    zxing = new Z.MultiFormatReader();
    zxing.setHints(hints);
  }
  if (!yerel && !zxing) {
    await ayAlert('Barkod okuyucu yüklenemedi (bağlantı sorunu olabilir). El terminali/klavye ile girin.'); return;
  }

  const ov = document.createElement('div'); ov.className = 'svk-cam';
  ov.innerHTML =
    '<video playsinline muted></video>' +
    '<div class="svk-cam-frame"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>' +
    '<div class="svk-cam-top"><span class="svk-cam-sira"></span>' +
      '<span class="svk-cam-araclar"><button class="svk-cam-fener" style="display:none">🔦</button>' +
      '<button class="svk-cam-zoom" style="display:none">1x</button>' +
      '<button class="svk-cam-close">Bitti ✕</button></span></div>' +
    '<div class="svk-cam-durum"></div>' +
    '<button class="svk-cam-shot">📸 Yine okunmuyorsa buraya basın</button>' +
    '<div class="svk-cam-hint">Barkodu çerçeveye hizalayın — otomatik okunur</div>';
  document.body.appendChild(ov);
  const video = ov.querySelector('video');
  const durumEl = ov.querySelector('.svk-cam-durum');
  const siraEl = ov.querySelector('.svk-cam-sira');
  const sira = s => { if (siraEl) siraEl.textContent = s || ''; };
  sira(opt.siradaki ? opt.siradaki() : '');

  let kapandi = false, stream = null, zamanlayici = null, mesgul = false, tur = 0;
  let sonKod = '', engelBitis = 0;
  const kapat = () => {
    if (kapandi) return; kapandi = true;
    if (zamanlayici) clearTimeout(zamanlayici);
    if (stream) stream.getTracks().forEach(t => t.stop());
    ov.remove();
    if (opt.onKapat) { try { opt.onKapat(); } catch (e) {} }
  };
  ov.querySelector('.svk-cam-close').onclick = kapat;

  const kirp = document.createElement('canvas');
  const kirpCtx = kirp.getContext('2d', { willReadFrequently: true });

  function zxingCanvas(canvas) {
    try {
      const kaynak = new Z.HTMLCanvasElementLuminanceSource(canvas);
      return zxing.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(kaynak))).getText();
    } catch (e) {
      if (!(e instanceof Z.NotFoundException)) {
        // Checksum/Format hataları normal tarama gürültüsüdür; gerçek hataları yaz
        if (e && e.name && !/Checksum|Format|NotFound/.test(e.name)) console.warn('zxing:', e.name, e.message);
      }
      return null;
    }
  }
  function kirpilmisKare(kaynak, kw, kh) {
    const sx = kw * _CROP.x, sy = kh * _CROP.y, sw = kw * _CROP.w, sh = kh * _CROP.h;
    const olcek = sw < 900 ? 1.5 : 1;
    kirp.width = Math.round(sw * olcek); kirp.height = Math.round(sh * olcek);
    kirpCtx.drawImage(kaynak, sx, sy, sw, sh, 0, 0, kirp.width, kirp.height);
    return kirp;
  }

  async function bir(kaynak, kw, kh, zxingDene) {
    if (yerel) {
      try {
        const r = await yerel.detect(kaynak);
        if (r && r.length && r[0].rawValue) return r[0].rawValue;
      } catch (e) { /* kare hazır değil vb. */ }
    }
    if (zxing && (zxingDene || !yerel)) return zxingCanvas(kirpilmisKare(kaynak, kw, kh));
    return null;
  }

  async function isle(kod) {
    const simdi = Date.now();
    if (kod === sonKod && simdi < engelBitis) return;
    sonKod = kod; engelBitis = simdi + 2500;
    mesgul = true;
    durumEl.className = 'svk-cam-durum bekle'; durumEl.textContent = '⏳ ' + kod;
    let r;
    try { r = await opt.onKod(kod); } catch (e) { console.error('onKod:', e); r = { ok: false, mesaj: 'Hata: ' + (e.message || e) }; }
    r = r || { ok: false, mesaj: 'Beklenmeyen sonuç' };
    if (kapandi) return;
    engelBitis = Date.now() + (r.ok ? 2500 : 4000);
    durumEl.className = 'svk-cam-durum ' + (r.ok ? 'ok' : 'hata');
    durumEl.textContent = r.mesaj || (r.ok ? '✅ Kaydedildi' : '⛔ Reddedildi');
    bip(!!r.ok);
    sira(r.siradaki !== undefined ? r.siradaki : (opt.siradaki ? opt.siradaki() : ''));
    mesgul = false;
    if (r.bitti) setTimeout(kapat, 900);
  }

  async function dongu() {
    if (kapandi) return;
    if (!mesgul && video.videoWidth && video.readyState >= 2) {
      tur++;
      let kod = null;
      try { kod = await bir(video, video.videoWidth, video.videoHeight, !yerel || tur % 4 === 3); } catch (e) { console.warn('tarama:', e); }
      if (kod && !kapandi) await isle(String(kod).trim());
    }
    if (!kapandi) zamanlayici = setTimeout(dongu, yerel ? 100 : 150);
  }

  // Son çare: ImageCapture ile gerçek yüksek çözünürlüklü tam kare (kırpma yok)
  ov.querySelector('.svk-cam-shot').onclick = async () => {
    if (kapandi || mesgul) return;
    const track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
    let kod = null;
    if (track && window.ImageCapture) {
      try {
        const blob = await new window.ImageCapture(track).takePhoto();
        const bmp = await createImageBitmap(blob);
        if (yerel) { try { const r = await yerel.detect(bmp); if (r.length) kod = r[0].rawValue; } catch (e) {} }
        if (!kod && zxing) {
          const c = document.createElement('canvas');
          const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
          c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
          c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
          kod = zxingCanvas(c);
        }
      } catch (e) { console.warn('yüksek çözünürlük kare:', e && e.name, e && e.message); }
    }
    if (!kod) {
      try { kod = await bir(video, video.videoWidth, video.videoHeight, true); } catch (e) {}
    }
    if (kod) { sonKod = ''; await isle(String(kod).trim()); }
    else { durumEl.className = 'svk-cam-durum hata'; durumEl.textContent = '⛔ Barkod bu karede okunamadı — yaklaşıp odaklayın'; bip(false); }
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    // Cihaz destekliyorsa: sürekli otofokus, fener, yakınlaştırma
    const track = stream.getVideoTracks()[0];
    const caps = (track && track.getCapabilities) ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }
    if (caps.torch) {
      const fb = ov.querySelector('.svk-cam-fener'); fb.style.display = '';
      let acik = false;
      fb.onclick = () => { acik = !acik; track.applyConstraints({ advanced: [{ torch: acik }] }).catch(() => { acik = !acik; }); fb.classList.toggle('on', acik); };
    }
    if (caps.zoom && caps.zoom.max > 1) {
      const zb = ov.querySelector('.svk-cam-zoom'); zb.style.display = '';
      const hedef = Math.min(caps.zoom.max, 2);
      let iki = false;
      zb.onclick = () => { iki = !iki; track.applyConstraints({ advanced: [{ zoom: iki ? hedef : (caps.zoom.min || 1) }] }).catch(() => {}); zb.textContent = iki ? '2x' : '1x'; };
    }
    // iOS/Safari'de ses bağlamı kullanıcı etkileşiminden sonra açılır: ilk bip'i boş ısıt
    try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { _ses = _ses || new AC(); _ses.resume().catch(() => {}); } } catch (e) {}
    dongu();
  } catch (e) {
    kapat();
    await ayAlert('Kamera açılamadı: ' + (e.message || e) + '\nEl terminali/klavye ile girebilirsiniz.');
  }
}
