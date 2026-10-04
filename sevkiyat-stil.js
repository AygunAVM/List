// ═══════════════════════════════════════════════════════════════
//  AYGÜN AVM — sevkiyat-stil.js  (Rev 11.1 — tasarım sistemi + ikonlar)
// ═══════════════════════════════════════════════════════════════
//  Renk kuralı: KIRMIZI yalnızca GECİKME, hata ve birincil eylem içindir.
//  Durum renkleri (slate / amber / yeşil / mavi) kırmızı kullanmaz; böylece
//  geciken bir sevkiyat listede bir bakışta ayırt edilir.

const YOL = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/>',
  printer: '<path d="M6 9V3h12v6"/><rect x="6" y="14" width="12" height="7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>',
  tools: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.6-.6-2.6z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  truck: '<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  alert: '<path d="m10.3 3.9-8.2 14a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3l-8.2-14a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4M12 16h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'
};
export const ic = (ad, boyut) => '<svg class="svk-ic" width="' + (boyut || 16) + '" height="' + (boyut || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (YOL[ad] || '') + '</svg>';

const CSS = `
.svk-overlay,.svk-mdl,.svk-toast,.svk-pill,.svk-cam{
  --k-ink:#16171B;--k-ink2:#4B5563;--k-mut:#7B8394;--k-line:#E4E7ED;--k-bg:#F2F3F6;--k-card:#fff;
  --k-red:#C8102E;--k-red-d:#A50D26;--k-red-bg:#FDECEF;--k-red-line:#F4B6C0;
  --k-amb:#B45309;--k-amb-bg:#FFF4DB;--k-grn:#15803D;--k-grn-bg:#E6F6EC;--k-grn-line:#B9E2C8;--k-blu:#1D4ED8;--k-blu-bg:#E7EFFE;--k-gry:#6B7280;--k-gry-bg:#EEF0F4;
  font-family:'DM Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--k-ink);
}
.svk-ic{flex:none;vertical-align:-3px}
.svk-overlay{display:none;position:fixed;inset:0;z-index:9000;background:rgba(14,15,19,.58);backdrop-filter:blur(3px);align-items:stretch;justify-content:center}
.svk-panel{background:var(--k-bg);width:100%;max-width:900px;display:flex;flex-direction:column;overflow:hidden}
@media(min-width:920px){.svk-panel{margin:14px 0;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.4)}}
.svk-head{background:#17181C;color:#fff;padding:max(14px,env(safe-area-inset-top)) 16px 13px;display:flex;align-items:center;gap:12px;border-bottom:3px solid var(--k-red)}
.svk-ht{flex:1;min-width:0}.svk-ht h1{font-size:1.06rem;margin:0;font-weight:800;letter-spacing:.2px;display:flex;align-items:center;gap:8px}
.svk-ht p{margin:3px 0 0;font-size:.72rem;color:#B9BECB}.svk-ht p b{color:#fff}.svk-ht p .kz{color:#FF8A9B;font-weight:800}
.svk-hbtns{display:flex;gap:8px}
.svk-ib{width:38px;height:38px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font:inherit}
.svk-ib:hover{background:rgba(255,255,255,.18)}.svk-ib:disabled{opacity:.5}
.svk-scroll{flex:1;overflow-y:auto;overscroll-behavior:contain;padding-bottom:max(22px,env(safe-area-inset-bottom))}

/* KPI şeridi */
.svk-kpis{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(108px,1fr);gap:10px;padding:14px 14px 6px;overflow-x:auto;scrollbar-width:none}
.svk-kpi{background:var(--k-card);border:1px solid var(--k-line);border-radius:14px;padding:12px 13px;text-align:left;cursor:pointer;font:inherit;color:inherit;transition:transform .12s,box-shadow .12s}
.svk-kpi:hover{box-shadow:0 6px 18px rgba(20,22,30,.08);transform:translateY(-1px)}
.svk-kpi b{display:block;font-size:1.65rem;line-height:1;font-weight:800;letter-spacing:-.8px}
.svk-kpi span{display:block;margin-top:6px;font-size:.66rem;color:var(--k-mut);font-weight:700;text-transform:uppercase;letter-spacing:.5px}
.svk-kpi.kirmizi{background:var(--k-red-bg);border-color:var(--k-red-line)}.svk-kpi.kirmizi b{color:var(--k-red)}.svk-kpi.kirmizi span{color:#B0384B}
.svk-kpi.on{box-shadow:0 0 0 2px var(--k-ink)}

/* Filtre çubuğu */
.svk-filt{position:sticky;top:0;z-index:5;background:var(--k-bg);padding:8px 14px 6px;border-bottom:1px solid var(--k-line)}
.svk-seg{display:grid;grid-template-columns:repeat(3,1fr);background:#E3E6EC;border-radius:12px;padding:3px;gap:3px;margin-bottom:9px}
.svk-seg button{border:0;background:transparent;border-radius:9px;padding:9px 6px;font:inherit;font-size:.78rem;font-weight:700;color:var(--k-ink2);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.svk-seg button.on{background:#fff;color:var(--k-ink);box-shadow:0 1px 4px rgba(0,0,0,.14)}
.svk-seg button i{font-style:normal;font-size:.68rem;background:rgba(0,0,0,.08);border-radius:99px;padding:1px 7px;font-weight:800}
.svk-seg button.on i{background:var(--k-ink);color:#fff}
.svk-ara{display:flex;gap:8px;margin-bottom:8px}
.svk-arakutu{flex:1;display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #D5D9E2;border-radius:11px;padding:0 11px;color:var(--k-mut)}
.svk-arakutu input{flex:1;border:0;outline:0;background:transparent;font:inherit;font-size:.86rem;padding:10px 0;color:var(--k-ink);min-width:0}
.svk-ara select,.svk-in{padding:10px 11px;border:1px solid #D5D9E2;border-radius:11px;font:inherit;font-size:.85rem;background:#fff;color:var(--k-ink)}
.svk-chips{display:flex;gap:6px;overflow-x:auto;padding:2px 0 4px;scrollbar-width:none;align-items:center}
.svk-chip{white-space:nowrap;padding:6px 12px;border-radius:99px;border:1px solid #D5D9E2;background:#fff;font:inherit;font-size:.74rem;font-weight:600;color:var(--k-ink2);cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.svk-chip.on{background:var(--k-ink);color:#fff;border-color:var(--k-ink)}
.svk-chip.kz{color:var(--k-red);border-color:var(--k-red-line);background:var(--k-red-bg)}.svk-chip.kz.on{background:var(--k-red);color:#fff;border-color:var(--k-red)}
.svk-chip i{font-style:normal;opacity:.75;font-weight:800}
.svk-etiket{font-size:.62rem;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:var(--k-mut);margin:2px 0 3px;display:flex;align-items:center;gap:6px}
.svk-aralik{display:flex;gap:8px;align-items:center;margin:4px 0 2px;font-size:.78rem;color:var(--k-ink2)}.svk-aralik .svk-in{flex:1;min-width:0;padding:8px 10px}

/* Liste */
.svk-liste{padding:6px 0 10px}
.svk-gbas{display:flex;align-items:center;gap:8px;font-weight:800;font-size:.8rem;margin:16px 14px 8px;color:var(--k-ink)}
.svk-gbas small{font-weight:600;color:var(--k-mut)}.svk-gbas .say{margin-left:auto;font-size:.68rem;font-weight:800;background:#E3E6EC;border-radius:99px;padding:2px 9px;color:var(--k-ink2)}
.svk-gbas.kz{color:var(--k-red)}.svk-gbas.kz small{color:#C5566A}.svk-gbas.kz .say{background:var(--k-red);color:#fff}
.svk-gbas.bg{color:var(--k-ink)}.svk-gbas.bg::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--k-grn)}
.svk-kart{background:var(--k-card);border:1px solid var(--k-line);border-left:4px solid #C9CED9;border-radius:13px;padding:12px 14px;margin:0 14px 9px;cursor:pointer;transition:box-shadow .12s,transform .12s}
.svk-kart:hover{box-shadow:0 8px 22px rgba(20,22,30,.09);transform:translateY(-1px)}
.svk-kart.t-servis{border-left-color:#3B6FE0}.svk-kart.t-musteri{border-left-color:#16A34A}
.svk-kart.gec{border-color:var(--k-red-line);border-left-color:var(--k-red);background:#FFF7F8}
.svk-kart.iptal{opacity:.7}.svk-kart.iptal .svk-r1 b{text-decoration:line-through}
.svk-r1{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.svk-r1 b{font-size:.95rem;font-weight:800;line-height:1.25}
.svk-r2{font-size:.74rem;color:var(--k-mut);margin:3px 0 9px;font-weight:500}
.svk-r3{display:flex;flex-wrap:wrap;gap:6px}
.svk-cp{display:inline-flex;align-items:center;gap:5px;font-size:.72rem;font-weight:600;color:var(--k-ink2);background:var(--k-gry-bg);border-radius:8px;padding:4px 8px}
.svk-cp.kz{background:var(--k-red);color:#fff;font-weight:800}.svk-cp.kzh{background:var(--k-red-bg);color:var(--k-red);font-weight:800}
.svk-cp.mv{background:var(--k-blu-bg);color:var(--k-blu)}.svk-cp.yr{background:var(--k-grn-bg);color:var(--k-grn)}.svk-cp.am{background:var(--k-amb-bg);color:var(--k-amb)}
.svk-bar{height:5px;background:#E6E9EF;border-radius:99px;margin-top:10px;overflow:hidden}.svk-bar i{display:block;height:100%;background:var(--k-grn);border-radius:99px}
.svk-bar.kz i{background:var(--k-red)}
.svk-pill2{display:inline-flex;align-items:center;gap:6px;font-size:.68rem;font-weight:800;padding:4px 10px;border-radius:99px;white-space:nowrap}
.svk-pill2::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.svk-bos{padding:44px 20px;text-align:center;color:var(--k-mut);font-size:.88rem}.svk-bos svg{display:block;margin:0 auto 10px;opacity:.5}

/* Düğmeler */
.svk-btn{padding:9px 14px;border:1px solid #D0D4DD;background:#fff;border-radius:10px;font:inherit;font-size:.8rem;font-weight:700;cursor:pointer;color:var(--k-ink);display:inline-flex;align-items:center;justify-content:center;gap:7px}
.svk-btn:hover{background:#F7F8FA}.svk-btn:disabled,.svk-btn.pasif{opacity:.45;cursor:not-allowed}
.svk-btn.ana{background:var(--k-red);border-color:var(--k-red);color:#fff}.svk-btn.ana:hover{background:var(--k-red-d)}
.svk-btn.koyu{background:var(--k-ink);border-color:var(--k-ink);color:#fff}.svk-btn.koyu:hover{background:#2A2C33}
.svk-btn.yesil{background:var(--k-grn);border-color:var(--k-grn);color:#fff}
.svk-btn.tehlike{color:var(--k-red);border-color:var(--k-red-line);background:#fff}.svk-btn.tehlike:hover{background:var(--k-red-bg)}
.svk-btn.tam{width:100%}.svk-btn.kucuk{padding:6px 10px;font-size:.74rem}
.svk-eylem{display:flex;flex-wrap:wrap;gap:8px;align-items:center}

/* Detay */
.svk-banner{display:flex;gap:11px;align-items:flex-start;margin:12px 14px 0;padding:12px 14px;border-radius:13px;font-size:.8rem;line-height:1.4}
.svk-banner b{display:block;font-size:.86rem;margin-bottom:1px}
.svk-banner.kz{background:var(--k-red-bg);border:1px solid var(--k-red-line);color:#8A1226}.svk-banner.kz svg{color:var(--k-red)}
.svk-banner.gr{background:#E9ECF1;border:1px solid #D2D7E0;color:#3B4252}
.svk-steps{display:flex;padding:16px 8px 12px;background:#fff;border:1px solid var(--k-line);border-radius:14px;margin:12px 14px 0}
.svk-st{flex:1;text-align:center;position:relative;font-size:.66rem;color:var(--k-mut);font-weight:700;line-height:1.2;padding:0 2px}
.svk-st i{display:flex;width:30px;height:30px;margin:0 auto 7px;border-radius:50%;background:var(--k-gry-bg);color:var(--k-mut);align-items:center;justify-content:center;font-style:normal;font-weight:800;font-size:.78rem;position:relative;z-index:1;box-shadow:0 0 0 1px var(--k-line)}
.svk-st:not(:last-child)::after{content:"";position:absolute;top:14px;left:calc(50% + 17px);width:calc(100% - 34px);height:2px;background:var(--k-line)}
.svk-st.ok{color:var(--k-grn)}.svk-st.ok i{background:var(--k-grn);color:#fff;box-shadow:none}.svk-st.ok::after{background:var(--k-grn)}
.svk-st.cur{color:var(--k-ink)}.svk-st.cur i{background:var(--k-ink);color:#fff;box-shadow:0 0 0 4px #D9DCE4}
.svk-steps.iptal .svk-st i{opacity:.5}
.svk-card{background:var(--k-card);border:1px solid var(--k-line);border-radius:14px;margin:12px 14px 0;overflow:hidden}
.svk-ch{display:flex;align-items:center;gap:9px;padding:12px 14px;border-bottom:1px solid var(--k-line);font-weight:800;font-size:.8rem;letter-spacing:.3px;text-transform:uppercase;color:var(--k-ink2)}
.svk-ch .sg{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:700;font-size:.74rem;color:var(--k-mut)}
.svk-cb{padding:13px 14px}
.svk-satir{display:flex;gap:10px;align-items:flex-start;padding:5px 0;font-size:.84rem}.svk-satir svg{color:var(--k-mut);margin-top:2px}
.svk-satir a{color:var(--k-blu);text-decoration:none;font-weight:700}
.svk-ad{font-size:1.05rem;font-weight:800;margin-bottom:6px}
.svk-alan{display:grid;grid-template-columns:1fr 1fr;gap:10px}.svk-alan .tam{grid-column:1/-1}
.svk-lbl{display:block;font-size:.66rem;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--k-mut);margin-bottom:4px}
.svk-in.tam{width:100%;box-sizing:border-box}
.svk-turseg{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.svk-turseg button{border:1.5px solid #D5D9E2;background:#fff;border-radius:11px;padding:10px 8px;font:inherit;font-size:.78rem;font-weight:700;color:var(--k-ink2);cursor:pointer;display:flex;gap:7px;align-items:center;justify-content:center}
.svk-turseg button.on.servis{border-color:#3B6FE0;background:var(--k-blu-bg);color:var(--k-blu)}.svk-turseg button.on.musteri{border-color:#16A34A;background:var(--k-grn-bg);color:var(--k-grn)}
.svk-turseg button:disabled{cursor:not-allowed;opacity:.6}

.svk-bhead{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.svk-bhead .svk-bar{flex:1;margin:0}.svk-bhead span{font-size:.76rem;font-weight:800;white-space:nowrap}
.svk-kalem{padding:11px 0;border-top:1px solid var(--k-line)}.svk-kalem:first-of-type{border-top:0}
.svk-kad{font-size:.86rem;font-weight:700;display:flex;gap:8px;align-items:baseline}.svk-kad small{color:var(--k-mut);font-weight:500;font-size:.72rem}
.svk-kad .no{background:var(--k-gry-bg);border-radius:6px;padding:1px 7px;font-size:.7rem;color:var(--k-ink2);font-weight:800}
.svk-kin{display:flex;gap:8px;align-items:center;margin-top:7px}
.svk-kin .svk-seri{flex:1;font-family:'DM Mono',ui-monospace,Menlo,monospace;letter-spacing:.3px;min-width:0}
.svk-kin .svk-seri:disabled{background:#F5F6F8}
.svk-kin .dur{width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--k-gry-bg);color:var(--k-mut);flex:none}
.svk-kin .dur.ok{background:var(--k-grn);color:#fff}
.svk-serisiz{font-size:.72rem;white-space:nowrap;display:flex;align-items:center;gap:5px;color:var(--k-ink2);font-weight:600}
.svk-ipucu{font-size:.7rem;color:var(--k-amb);margin-top:6px;background:var(--k-amb-bg);border-radius:8px;padding:6px 9px;display:flex;gap:6px;align-items:flex-start}
.svk-ipucu.nt{color:var(--k-ink2);background:var(--k-gry-bg)}

.svk-pnl{border:1px solid var(--k-line);border-radius:13px;margin-bottom:10px;background:#fff;overflow:hidden}
.svk-pnl:last-child{margin-bottom:0}
.svk-pnl-h{display:flex;align-items:center;gap:10px;padding:11px 13px}
.svk-pnl-no{width:26px;height:26px;border-radius:50%;background:var(--k-ink);color:#fff;font-size:.74rem;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex:none}
.svk-pnl-t{font-weight:800;font-size:.86rem}.svk-pnl-s{margin-left:auto;font-size:.7rem;font-weight:800;border-radius:99px;padding:3px 10px;background:var(--k-gry-bg);color:var(--k-ink2);white-space:nowrap}
.svk-pnl-b{padding:0 13px 13px;font-size:.8rem;color:var(--k-ink2);line-height:1.45}
.svk-pnl.pasif{background:#FAFAFB}.svk-pnl.pasif .svk-pnl-no{background:#C3C8D3}.svk-pnl.pasif .svk-pnl-t{color:var(--k-mut)}
.svk-pnl.tamam{border-color:var(--k-grn-line);background:#F8FCF9}.svk-pnl.tamam .svk-pnl-no{background:var(--k-grn)}.svk-pnl.tamam .svk-pnl-s{background:var(--k-grn-bg);color:var(--k-grn)}
.svk-pnl.sirada{border-color:#BFC5D2;box-shadow:0 0 0 3px #E9ECF2}.svk-pnl.sirada .svk-pnl-s{background:var(--k-ink);color:#fff}
.svk-imzaEt{font-size:.66rem;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--k-mut);margin:10px 0 4px}
.svk-imza{width:100%;max-width:360px;height:120px;border:1.5px dashed #C3C8D3;border-radius:10px;background:#fff;touch-action:none;display:block}
.svk-imzaresim{max-height:54px;display:block;margin-top:6px;border:1px solid var(--k-line);border-radius:6px;background:#fff}
.svk-log{list-style:none;margin:0;padding:0;max-height:230px;overflow-y:auto;font-size:.76rem}
.svk-log li{display:flex;gap:10px;padding:7px 0;border-top:1px solid var(--k-line);color:var(--k-ink2)}.svk-log li:first-child{border-top:0}
.svk-log time{color:var(--k-mut);min-width:78px;font-variant-numeric:tabular-nums}.svk-log b{color:var(--k-ink)}
.svk-risk{border-color:var(--k-red-line)}.svk-risk .svk-ch{color:var(--k-red);background:#FFF7F8;border-color:var(--k-red-line)}
.svk-not{font-size:.76rem;color:var(--k-ink2);margin:2px 0 10px;line-height:1.45}
.svk-yetim{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--k-line);font-size:.78rem}

/* Modal: uyarı kartı + onay diyaloğu */
.svk-mdl{position:fixed;inset:0;z-index:9800;background:rgba(14,15,19,.62);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:18px;animation:svkf .14s ease-out}
@keyframes svkf{from{opacity:0}to{opacity:1}}@keyframes svkp{from{transform:translateY(10px) scale(.98);opacity:0}to{transform:none;opacity:1}}
.svk-dlg{background:#fff;border-radius:18px;width:100%;max-width:430px;max-height:92vh;overflow-y:auto;box-shadow:0 30px 70px rgba(0,0,0,.45);animation:svkp .18s ease-out}
.svk-dlg-ust{display:flex;gap:13px;align-items:flex-start;padding:20px 20px 6px}
.svk-dlg-ik{width:44px;height:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--k-red-bg);color:var(--k-red)}
.svk-dlg-ik.gri{background:var(--k-gry-bg);color:var(--k-ink2)}.svk-dlg-ik.amb{background:var(--k-amb-bg);color:var(--k-amb)}
.svk-dlg-kat{font-size:.62rem;font-weight:800;letter-spacing:.9px;color:var(--k-red);text-transform:uppercase}.svk-dlg-kat.gri{color:var(--k-mut)}
.svk-dlg-bas{font-size:1.04rem;font-weight:800;line-height:1.25;margin-top:2px}
.svk-dlg-ozet{padding:4px 20px 0;font-size:.84rem;color:var(--k-ink2);line-height:1.5;margin:0}
.svk-dl{margin:14px 20px 0;border:1px solid var(--k-line);border-radius:12px;overflow:hidden}
.svk-dl div{display:flex;justify-content:space-between;gap:14px;padding:9px 12px;font-size:.78rem;border-top:1px solid var(--k-line);align-items:baseline}.svk-dl div:first-child{border-top:0}
.svk-dl dt{color:var(--k-mut);font-weight:600;flex:none}.svk-dl dd{margin:0;font-weight:700;text-align:right;word-break:break-word}.svk-dl dd.mono{font-family:'DM Mono',ui-monospace,Menlo,monospace;color:var(--k-red)}
.svk-oneri{margin:14px 20px 0;background:var(--k-gry-bg);border-radius:12px;padding:11px 13px;font-size:.78rem;color:var(--k-ink2);line-height:1.5}.svk-oneri b{color:var(--k-ink)}
.svk-dlg-alt{padding:18px 20px 20px;display:flex;gap:9px}.svk-dlg-alt .svk-btn{flex:1;padding:12px}
.svk-dlg-gov{padding:10px 20px 0}.svk-dlg-gov .svk-in{width:100%;box-sizing:border-box;margin-top:4px}
.svk-dlg-gov label.svk-lbl{margin-top:10px}.svk-dlg-gov textarea{min-height:72px;resize:vertical}
.svk-dlg-gov .onay{display:flex;gap:9px;align-items:flex-start;font-size:.78rem;margin-top:12px;color:var(--k-ink2);line-height:1.4}
.svk-dlg-hata{color:var(--k-red);font-size:.76rem;font-weight:700;margin:10px 20px 0}

.svk-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(74px + env(safe-area-inset-bottom));z-index:9500;background:#17181C;color:#fff;padding:11px 14px;border-radius:13px;display:flex;gap:10px;align-items:center;font-size:.8rem;max-width:92vw;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.svk-toast button{background:#fff;color:#17181C;border:0;border-radius:8px;padding:6px 11px;font-weight:800;cursor:pointer;font:inherit;font-size:.76rem}.svk-toast .svk-x{background:transparent;color:#fff}
.svk-pill{position:fixed;left:10px;bottom:calc(78px + env(safe-area-inset-bottom));z-index:9400;background:var(--k-amb);color:#fff;font-size:.72rem;font-weight:800;padding:7px 12px;border-radius:99px;box-shadow:0 4px 14px rgba(0,0,0,.25)}
#tab-btn-sevkiyat{position:relative}.svk-tabrozet{position:absolute;top:2px;right:10px;min-width:15px;height:15px;padding:0 3px;border-radius:99px;background:var(--red,#D01F2E);color:#fff;font-size:.55rem;font-weight:900;align-items:center;justify-content:center;display:none}

/* Satış formu: teslim şekli */
.svk-formseg{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.svk-formseg label{display:block;cursor:pointer;margin:0}.svk-formseg input{position:absolute;opacity:0;pointer-events:none}
.svk-formseg span{display:flex;align-items:center;justify-content:center;gap:6px;border:1.5px solid #D5D9E2;border-radius:10px;padding:10px 6px;font-size:.78rem;font-weight:700;color:#4B5563;background:#fff}
.svk-formseg input:checked+span{border-color:#16171B;background:#16171B;color:#fff}

/* Kamera */
.svk-cam{position:fixed;inset:0;z-index:9600;background:#000;display:flex;flex-direction:column;align-items:center}.svk-cam video{flex:1;width:100%;object-fit:cover}
.svk-cam-frame{position:absolute;left:10%;top:38%;width:80%;height:24%;z-index:1;pointer-events:none}
.svk-cam-frame i{position:absolute;width:26px;height:26px;border:3px solid #fff;border-radius:3px}
.svk-cam-frame i.tl{top:0;left:0;border-right:0;border-bottom:0}.svk-cam-frame i.tr{top:0;right:0;border-left:0;border-bottom:0}
.svk-cam-frame i.bl{bottom:0;left:0;border-right:0;border-top:0}.svk-cam-frame i.br{bottom:0;right:0;border-left:0;border-top:0}
.svk-cam-top{position:absolute;top:max(10px,env(safe-area-inset-top));left:10px;right:10px;display:flex;justify-content:space-between;align-items:center;gap:8px;z-index:2}
.svk-cam-sira{color:#fff;font-size:.8rem;font-weight:700;background:rgba(0,0,0,.55);padding:6px 11px;border-radius:9px;max-width:58%}.svk-cam-sira:empty{display:none}
.svk-cam-araclar{display:flex;gap:6px;margin-left:auto}
.svk-cam-araclar button{padding:8px 13px;border:0;border-radius:9px;font-weight:700;background:rgba(255,255,255,.93);font:inherit;font-size:.78rem;font-weight:700}.svk-cam-araclar .on{background:#FDE047}
.svk-cam-durum{position:absolute;left:12px;right:12px;bottom:max(112px,calc(env(safe-area-inset-bottom) + 100px));z-index:2;color:#fff;font-size:.86rem;font-weight:700;text-align:center;padding:10px 12px;border-radius:12px;background:rgba(0,0,0,.55)}
.svk-cam-durum:empty{display:none}.svk-cam-durum.ok{background:rgba(21,128,61,.95)}.svk-cam-durum.hata{background:rgba(200,16,46,.95)}.svk-cam-durum.bekle{background:rgba(29,78,216,.92)}
.svk-cam-shot{position:absolute;bottom:max(64px,calc(env(safe-area-inset-bottom) + 52px));left:50%;transform:translateX(-50%);padding:10px 20px;border:0;border-radius:99px;font-weight:700;background:rgba(255,255,255,.18);color:#fff;z-index:2;font:inherit;font-size:.78rem;border:1px solid rgba(255,255,255,.4);backdrop-filter:blur(6px)}
.svk-cam-hint{position:absolute;bottom:max(24px,env(safe-area-inset-bottom));left:0;right:0;text-align:center;color:#fff;font-size:.78rem;opacity:.85;text-shadow:0 1px 3px rgba(0,0,0,.6);z-index:1}
`;
export function stilEkle() {
  if (document.getElementById('svk-style')) return;
  const st = document.createElement('style'); st.id = 'svk-style'; st.textContent = CSS;
  document.head.appendChild(st);
}
