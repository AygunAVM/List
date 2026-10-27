// Aygün AVM — kullanıcı hesapları (Firebase Auth) eşitleme
// V11.33 SONRASI TEK DOĞRU KAYNAK: Firestore kullanicilar/{eposta} (admin panel → Personel → Kullanıcı Yönetimi).
//   node kullanici-esitle.js --anahtar C:\gizli\servis.json --profilden
//     → panelde eklenen ama Auth hesabı olmayan kişilere hesap + geçici şifre açar (sifreler-gizli.csv),
//       "Hesabı kapat" işaretlilerin Auth hesabını devre dışı bırakır, kapalıyken açılanları yeniden etkinleştirir.
//       Profil alanlarına DOKUNMAZ.
// ESKİ --liste kipi (Excel/json) artık KULLANMAYIN: panelde yapılan düzenlemelerin üzerine yazar.
// Eski bilgi: kullanicilar.json → Firebase Auth + Firestore (kullanicilar/{eposta}) eşitleme
// Kullanım (KENDİ bilgisayarında, servis hesabı anahtarı bu klasörde DURMAMALI, güvenli yerde dursun):
//   npm i firebase-admin
//   node kullanici-esitle.js --anahtar C:\gizli\servis.json --liste kullanicilar.json            (yeni kullanıcıları ekler, mevcutları günceller)
//   node kullanici-esitle.js --anahtar ... --liste ... --kapat                                    (listede olmayan Auth kullanıcılarını devre dışı bırakır)
//   node kullanici-esitle.js --anahtar ... --liste ... --mevcut-sifre                            (henüz yeni şifre belirlememiş kullanıcıların Auth şifresini listedeki ESKİ şifreyle eşitler; ilk girişte yeni şifre zorunlu olur)
//   node kullanici-esitle.js --anahtar ... --sifirla ad@firma.com                                 (tek kullanıcıya yeni geçici şifre)
//   node kullanici-esitle.js --anahtar ... --tumunu-sifirla                                       (Auth'taki TÜM aktif kullanıcılara yeni geçici şifre; geçiş günü)
// Çıktı: sifreler-gizli.csv (e-posta;geçici şifre). Dağıttıktan sonra SİL.
const fs = require('fs'), crypto = require('crypto');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i < 0 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const anahtar = arg('anahtar');
if (!anahtar) { console.error('--anahtar <servis hesabı json> gerekli'); process.exit(1); }
initializeApp({ credential: cert(require(require('path').resolve(anahtar))) });
const auth = getAuth(), db = getFirestore();
const HASSAS = ['Sifre', 'SifreHash', 'Hash', 'sifre', 'password'];
const gecici = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(crypto.randomBytes(10), b => a[b % a.length]).join(''); };
const temiz = (u) => { const o = {}; for (const k of Object.keys(u)) if (!HASSAS.includes(k)) o[k] = u[k]; return o; };
(async () => {
  const cikti = [];
  const tek = arg('sifirla');
  if (arg('tumunu-sifirla')) {
    let tok; do {
      const r = await auth.listUsers(1000, tok); tok = r.pageToken;
      for (const ur of r.users) if (ur.email && !ur.disabled) {
        const p = gecici();
        await auth.updateUser(ur.uid, { password: p });
        await db.doc('kullanicilar/' + ur.email.toLowerCase()).set({ sifreDegistir: true }, { merge: true });
        cikti.push(ur.email.toLowerCase() + ';' + p); console.log('YENİLENDİ ' + ur.email);
      }
    } while (tok);
  } else if (arg('profilden')) {
    const snap = await db.collection('kullanicilar').get();
    for (const d of snap.docs) {
      const u = d.data(), e = d.id.toLowerCase();
      let ur = null;
      try { ur = await auth.getUserByEmail(e); } catch (er) { if (er.code !== 'auth/user-not-found') throw er; }
      if (u.Kilitli === true) {
        if (ur && !ur.disabled) { await auth.updateUser(ur.uid, { disabled: true }); console.log('KAPATILDI ' + e); }
        continue;
      }
      if (!ur) {
        const p = gecici();
        await auth.createUser({ email: e, password: p, displayName: u.Ad || undefined });
        await db.doc('kullanicilar/' + e).set({ sifreDegistir: true }, { merge: true });
        cikti.push(e + ';' + p); console.log('EKLENDİ  ' + e + '  (' + (u.Rol || '-') + ')');
      } else if (ur.disabled) { await auth.updateUser(ur.uid, { disabled: false }); console.log('AÇILDI   ' + e); }
    }
    console.log('Bitti: ' + snap.size + ' profil kontrol edildi.');
  } else if (tek && tek !== true) {
    const e = tek.toLowerCase(), p = gecici();
    const ur = await auth.getUserByEmail(e);
    await auth.updateUser(ur.uid, { password: p, disabled: false });
    await db.doc('kullanicilar/' + e).set({ sifreDegistir: true }, { merge: true });
    cikti.push(e + ';' + p);
  } else {
    let liste = JSON.parse(fs.readFileSync(arg('liste'), 'utf8').replace(/^\uFEFF/, ''));
    if (!Array.isArray(liste)) liste = liste.data || [];
    const epostalar = new Set();
    for (const u of liste) {
      if (!u.Email) continue;
      const e = String(u.Email).toLowerCase().trim(); epostalar.add(e);
      const profil = temiz(u); profil.Email = e;
      let yeni = false, ur;
      try { ur = await auth.getUserByEmail(e); }
      catch (er) { if (er.code !== 'auth/user-not-found') throw er; yeni = true; }
      if (yeni) {
        const p = gecici();
        await auth.createUser({ email: e, password: p, displayName: u.Ad || undefined });
        profil.sifreDegistir = true;            // yalnızca yeni kullanıcıda
        cikti.push(e + ';' + p);
      } else {
        if (ur.disabled) await auth.updateUser(ur.uid, { disabled: false });
        // --mevcut-sifre: yalnız YENİ ŞİFRE BELİRLEMEMİŞ (sifreDegistir=true) kişilerde, listedeki eski şifreyi Auth şifresi yap
        if (arg('mevcut-sifre') && u.Sifre && String(u.Sifre).trim().length >= 6) {
          const m = await db.doc('kullanicilar/' + e).get();
          if (m.exists && m.data().sifreDegistir === true) {
            await auth.updateUser(ur.uid, { password: String(u.Sifre).trim() });
            console.log('ESKİ ŞİFRE EŞİTLENDİ ' + e);
          }
        }
      }
      await db.doc('kullanicilar/' + e).set(profil, { merge: true });
      console.log((yeni ? 'EKLENDİ  ' : 'GÜNCEL   ') + e + '  (' + (u.Rol || '-') + ')');
    }
    if (arg('kapat')) {
      let tok; do {
        const r = await auth.listUsers(1000, tok); tok = r.pageToken;
        for (const ur of r.users) if (ur.email && !epostalar.has(ur.email.toLowerCase()) && !ur.disabled) {
          await auth.updateUser(ur.uid, { disabled: true }); console.log('KAPATILDI ' + ur.email);
        }
      } while (tok);
    }
  }
  if (cikti.length) { fs.writeFileSync('sifreler-gizli.csv', '\uFEFFeposta;gecici_sifre\n' + cikti.join('\n') + '\n'); console.log('→ sifreler-gizli.csv yazıldı (' + cikti.length + ' kişi). Dağıttıktan sonra silin.'); }
  process.exit(0);
})().catch(e => { console.error('HATA:', e.message); process.exit(1); });
