#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  AYGÜN AVM — Tek komutla sürüm yenileme
# ─────────────────────────────────────────────────────────────
#  Kullanım:
#    ./bump-version.sh          → minör sürümü otomatik +1 artırır,
#                                   zaman damgasını ŞİMDİKİ ana ayarlar
#    ./bump-version.sh 9.0      → major.minor'u ELLE 9.0 yapar,
#                                   zaman damgasını ŞİMDİKİ ana ayarlar
#
#  Ne yapar:
#    app.js, index.html, service-worker.js, version.json içindeki
#    sürüm etiketlerini TEK bir 'V{major}.{minor}-{tarih}-{saat}'
#    string'iyle senkron biçimde günceller. Elle 4 dosyada arama-
#    değiştirme yapmanıza gerek kalmaz.
#
#  Sonraki adım (script bunu OTOMATİK yapmaz):
#    Bu 4 dosyayı sunucuya/hosting'e yükleyin, sonra admin panelden
#    "⚠️ Eskileri Güncelle" butonuna basıp o an açık olan eski
#    cihazları anında güncel sürüme geçirin.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

APP_JS="app.js"
INDEX_HTML="index.html"
SW_JS="service-worker.js"
VERSION_JSON="version.json"

for f in "$APP_JS" "$INDEX_HTML" "$SW_JS" "$VERSION_JSON"; do
  if [ ! -f "$f" ]; then
    echo "❌ '$f' bulunamadı. Bu script'i proje klasöründe (4 dosyanın yanında) çalıştırın."
    exit 1
  fi
done

# Mevcut sürümü app.js'den oku: const APP_BUILD_VERSION = 'V8.8-...';
CURRENT=$(sed -n "s/.*APP_BUILD_VERSION = '\([^']*\)'.*/\1/p" "$APP_JS" | head -n1)

if [ -z "$CURRENT" ]; then
  echo "❌ app.js içinde APP_BUILD_VERSION bulunamadı — dosya bozulmuş olabilir."
  exit 1
fi

CUR_MAJMIN=$(echo "$CURRENT" | sed -n 's/^V\([0-9]*\.[0-9]*\).*/\1/p')
if [ -z "$CUR_MAJMIN" ]; then
  echo "❌ Mevcut sürüm ('$CURRENT') beklenen 'V{major}.{minor}-...' biçiminde değil."
  echo "   İlk seferlik: ./bump-version.sh <major.minor> ile (örn: ./bump-version.sh 8.8) elle başlatın."
  CUR_MAJOR=0; CUR_MINOR=0
else
  CUR_MAJOR=$(echo "$CUR_MAJMIN" | cut -d. -f1)
  CUR_MINOR=$(echo "$CUR_MAJMIN" | cut -d. -f2)
fi

if [ "${1:-}" != "" ]; then
  NEW_MAJMIN="$1"
else
  NEW_MAJMIN="${CUR_MAJOR}.$((CUR_MINOR + 1))"
fi

STAMP=$(date +"%Y%m%d-%H%M")
NEW_VERSION="V${NEW_MAJMIN}-${STAMP}"

if [ "$NEW_VERSION" = "$CURRENT" ]; then
  echo "⚠️  Yeni sürüm mevcut sürümle aynı çıktı ($NEW_VERSION) — bir dakika bekleyip tekrar deneyin."
  exit 1
fi

echo "Eski sürüm : $CURRENT"
echo "Yeni sürüm : $NEW_VERSION"
echo

# --- app.js ---------------------------------------------------
sed -i.bak "s/APP_BUILD_VERSION = '[^']*'/APP_BUILD_VERSION = '${NEW_VERSION}'/" "$APP_JS"

# --- index.html -------------------------------------------------
sed -i.bak "s/app\.js?v=[^\"']*/app.js?v=${NEW_VERSION}/" "$INDEX_HTML"

# --- service-worker.js ------------------------------------------
sed -i.bak "s/CACHE_VERSION = '[^']*'/CACHE_VERSION = '${NEW_VERSION}'/" "$SW_JS"

# --- version.json -------------------------------------------------
sed -i.bak "s/\"build\": *\"[^\"]*\"/\"build\": \"${NEW_VERSION}\"/" "$VERSION_JSON"

rm -f "$APP_JS.bak" "$INDEX_HTML.bak" "$SW_JS.bak" "$VERSION_JSON.bak"

echo "✅ Güncellendi: $APP_JS, $INDEX_HTML, $SW_JS, $VERSION_JSON"
echo
echo "Sıradaki adım:"
echo "  1) Bu 4 dosyayı sunucuya/hosting'e yükleyin."
echo "  2) Admin panel → Personel → '⚠️ Eskileri Güncelle' butonuna basın"
echo "     (o an açık eski cihazları anında yeni sürüme geçirir)."
