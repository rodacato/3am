// Direction C scene: the window, the skyline as service map, notes on the glass.
// opts.proto leaves out the pieces the prototype animates itself (new card, loose strings, phone, shade).
(function () {
const { C, rng, f, latency, flat, linePath, rope, string, pin, card, tape, defs } = AM;
AM.windowScene = function (opts = {}) {
  const W = 1440, H = 900, GROUND = 690;
  let s = defs();
  const P = !!opts.proto;

  s += `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E131A"/><stop offset=".7" stop-color="#18202B"/><stop offset="1" stop-color="#28313C"/></linearGradient>
    <radialGradient id="dark" cx="640" cy="330" r="900" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#06080B" stop-opacity="0"/><stop offset=".4" stop-color="#06080B" stop-opacity=".12"/><stop offset="1" stop-color="#06080B" stop-opacity=".78"/></radialGradient>
    <radialGradient id="reflect" cx="250" cy="560" r="170" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#F2A541" stop-opacity=".16"/><stop offset="1" stop-color="#F2A541" stop-opacity="0"/></radialGradient>
    <clipPath id="glass"><rect x="40" y="30" width="1360" height="${GROUND - 30}"/></clipPath>
    <clipPath id="lap"><rect x="74" y="736" width="352" height="200"/></clipPath>
  </defs>`;

  s += `<rect width="${W}" height="${H}" fill="#0C0F14"/>`;
  s += `<g clip-path="url(#glass)"><rect x="40" y="30" width="1360" height="${GROUND}" fill="url(#sky)"/>`;

  // Distant haze line of the far city
  {
    const r = rng(31);
    let x = 40;
    while (x < 1400) { const w = 14 + r() * 30, h = 30 + r() * 70; s += `<rect x="${f(x)}" y="${f(GROUND - 120 - h)}" width="${f(w)}" height="${f(h + 120)}" fill="#1A222C"/>`; x += w; }
  }

  // Services as buildings. Lit windows are healthy requests; red ones are errors; dark ones are users waiting.
  function building(x, w, h, { label, sub = '', seed = 1, err = 0, dark = 0, tone = '#0F141A', far = false }) {
    const r = rng(seed), top = GROUND - h;
    let g = `<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${tone}"/>`;
    for (let wy = top + 14; wy < GROUND - 10; wy += 12) for (let wx = x + 8; wx < x + w - 8; wx += 10) {
      const k = r(), upper = (wy - top) / h < 0.55;
      if (upper && k < err) g += `<rect class="err" x="${wx}" y="${wy}" width="5" height="6" fill="${C.red}" fill-opacity="${f(.55 + r() * .4)}"/>`;
      else if (upper && k < err + dark) continue;
      else if (k < 0.42) g += `<rect x="${wx}" y="${wy}" width="5" height="6" fill="${C.amber}" fill-opacity="${f((far ? .18 : .3) + r() * .35)}"/>`;
    }
    g += `<text x="${x + w / 2}" y="${top - 10}" text-anchor="middle" class="mono" font-size="${far ? 9 : 10}" fill="${C.paper}" fill-opacity="${far ? .45 : .75}" letter-spacing=".04em">${label}</text>`;
    if (sub) g += `<text x="${x + w / 2}" y="${top - 24}" text-anchor="middle" class="mono" font-size="8" fill="${C.fog}">${sub}</text>`;
    return g;
  }

  const B = {
    storefront: [90, 160, 170], cart: [300, 110, 140], search: [430, 70, 250],
    checkout: [540, 136, 330], db: [730, 230, 118], cache: [1000, 104, 180], gw: [1236, 116, 214],
  };
  // River: payment-gw is someone else's building across the water
  s += `<rect x="1130" y="${GROUND - 26}" width="270" height="26" fill="#0A0E13"/>`;
  for (let i = 0; i < 14; i++) s += `<line x1="${1140 + i * 18}" y1="${GROUND - 14 + (i % 3) * 5}" x2="${1150 + i * 18}" y2="${GROUND - 14 + (i % 3) * 5}" stroke="${C.amber}" stroke-opacity=".18"/>`;

  // Dependencies are cables strung between rooftops, sagging under their own weight
  const roof = (k, dx = 0.5) => [B[k][0] + B[k][1] * dx, GROUND - B[k][2]];
  const cables = [
    ['storefront', 'checkout', .9, .2, 0], ['cart', 'checkout', .9, .1, 0], ['checkout', 'db', .8, .3, 0],
    ['checkout', 'cache', .9, .4, 0], ['checkout', 'gw', .95, .5, 1],
  ];
  cables.forEach(([a, b, da, db, hot]) => {
    const [x1, y1] = roof(a, da), [x2, y2] = roof(b, db);
    const d = rope(x1, y1, x2, y2, { slack: 1.03, gy: .4 });
    s += `<path d="${d}" fill="none" stroke="${hot ? C.red : '#55606D'}" stroke-opacity="${hot ? .8 : .7}" stroke-width="${hot ? 1.6 : 1.1}"/>`;
    if (hot) s += `<path d="${d}" fill="none" stroke="${C.red}" stroke-width="3.2" stroke-dasharray="2 9" stroke-linecap="round"/>`;
    else s += `<path d="${d}" fill="none" stroke="${C.amber}" stroke-opacity=".7" stroke-width="2.2" stroke-dasharray="1.5 22" stroke-linecap="round"/>`;
  });
  s += building(...B.storefront, { label: 'storefront', seed: 2 });
  s += building(...B.cart, { label: 'cart', seed: 3 });
  s += building(...B.search, { label: 'search-api', seed: 4 });
  s += building(...B.checkout, { label: 'checkout-api', sub: 'p99 4.3s', seed: 5, err: .26, dark: .3, tone: '#12171E' });
  s += building(...B.db, { label: 'payments-db', seed: 6 });
  s += building(...B.cache, { label: 'cache', seed: 7 });
  // water tower on the cache roof
  s += `<g fill="#0F141A"><rect x="1030" y="${GROUND - 180 - 44}" width="44" height="30"/><path d="M1026,${GROUND - 224} L1052,${GROUND - 244} L1078,${GROUND - 224} Z"/>
    <rect x="1034" y="${GROUND - 194}" width="3" height="14"/><rect x="1067" y="${GROUND - 194}" width="3" height="14"/></g>`;
  s += building(...B.gw, { label: 'payment-gw', sub: 'external', seed: 8, tone: '#141A22', far: true });
  s += `</g>`;

  // Window frame: sash, mullions, transom
  s += `<g fill="#090B0F"><rect x="28" y="20" width="1384" height="12"/><rect x="28" y="20" width="14" height="${GROUND - 10}"/><rect x="1398" y="20" width="14" height="${GROUND - 10}"/>
    <rect x="496" y="20" width="10" height="${GROUND}"/><rect x="948" y="20" width="10" height="${GROUND}"/><rect x="28" y="356" width="1384" height="9"/></g>`;
  s += `<rect x="40" y="30" width="1360" height="${GROUND - 30}" fill="url(#reflect)"/>`;

  // Notes taped to the glass
  const p99 = latency({ seed: 3, n: 90 });
  const cpu = flat({ seed: 8, n: 90 });
  s += card(84, 70, 214, 92, `
    <text x="12" y="18" class="mono" font-size="9" font-weight="600" fill="${C.red}" letter-spacing=".08em">CHANGE · 02:57:41</text>
    <text x="12" y="38" class="mono" font-size="10" fill="${C.ink}">config checkout-api v413</text>
    <text x="12" y="58" class="mono" font-size="10" fill="${C.ink}">retry.max_attempts</text>
    <text x="12" y="78" class="mono" font-size="15" font-weight="600" fill="${C.ink}">1 → 5</text>`, { rot: -2 });
  s += tape(190, 70, 54, -4);
  s += card(250, 196, 214, 112, `
    <text x="10" y="16" class="mono" font-size="9" fill="${C.ink}" fill-opacity=".7">checkout-api p99 · 02:00–03:29</text>
    <rect x="${f(10 + (62 / 89) * 194)}" y="24" width="${f((27 / 89) * 194)}" height="62" fill="${C.amber}" fill-opacity=".3"/>
    <path d="${linePath(p99, 10, 24, 194, 62, { max: 4800 })}" fill="none" stroke="${C.ink}" stroke-width="1.4"/>
    <text x="200" y="102" text-anchor="end" class="mono" font-size="8.5" fill="${C.ink}" fill-opacity=".6">03:02 ↑ 4.3s</text>`, { rot: 2 });
  s += tape(357, 196, 50, 3);
  if (!P) {
  s += card(980, 64, 262, 70, `
    <text x="12" y="18" class="mono" font-size="9" fill="${C.ink}" fill-opacity=".6">03:09:52.118  WARN  checkout-api</text>
    <text x="12" y="38" class="mono" font-size="10.5" fill="${C.ink}">payment.authorize retry attempt=4/5</text>
    <text x="12" y="56" class="mono" font-size="9.5" fill="${C.ink}" fill-opacity=".75">upstream=payment-gw elapsed_ms=811</text>`, { rot: 1.5 });
  s += tape(1111, 64, 52, -2);
  }
  s += card(984, 236, 164, 66, `
    <text x="10" y="16" class="mono" font-size="9" fill="${C.ink}" fill-opacity=".7">payments-db · cpu %</text>
    <path d="${linePath(cpu, 10, 22, 144, 26, { min: 0, max: 100 })}" fill="none" stroke="${C.ink}" stroke-width="1.2"/>
    <text x="154" y="60" text-anchor="end" class="mono" font-size="8.5" fill="${C.ink}" fill-opacity=".6">31% · flat</text>`, { rot: -2.5 });
  s += tape(1066, 236, 46, 4);

  // Hypotheses on the glass, each strung to the building it accuses
  s += card(560, 64, 236, 132, `
    <rect x="0" y="0" width="236" height="4" fill="${C.red}"/>
    <text x="14" y="24" class="mono" font-size="9" font-weight="600" fill="${C.red}" letter-spacing=".1em">H1 · ACCUSES checkout-api</text>
    <text x="14" y="54" class="serif" font-size="20" font-weight="420" fill="${C.ink}">Retries piled up after</text>
    <text x="14" y="78" class="serif" font-size="20" font-weight="420" fill="${C.ink}">the 02:57 config push.</text>
    <text x="14" y="112" class="mono" font-size="8.5" fill="${C.ink}" fill-opacity=".55">3 pieces · 0 against</text>`, { rot: -1 });
  s += tape(678, 64, 60, 2);
  s += card(1190, 176, 196, 124, `
    <text x="14" y="22" class="mono" font-size="9" font-weight="600" fill="${C.ink}" fill-opacity=".5" letter-spacing=".1em">H2 · ACCUSES payments-db</text>
    <text x="14" y="50" class="serif" font-size="18" fill="${C.ink}" fill-opacity=".8">The database is</text>
    <text x="14" y="72" class="serif" font-size="18" fill="${C.ink}" fill-opacity=".8">overloaded.</text>
    <text x="14" y="104" class="serif" font-style="italic" font-size="13" fill="${C.ink}" fill-opacity=".6">It was home all night.</text>`, { rot: 2.5, id: 'h2' });
  s += tape(1288, 176, 50, -3);

  const ck = roof('checkout', .5), dbr = roof('db', .5);
  const H1 = [678, 196], H2 = [1240, 298];
  s += string(rope(298, 116, 562, 120, { slack: 1.003 }));
  s += string(rope(464, 250, 566, 170, { slack: 1.003 }));
  if (!P) s += string(rope(980, 100, 794, 110, { slack: 1.003 }));
  s += string(rope(...H1, ck[0], ck[1] - 34, { slack: 1.002 }));
  if (!P) {
    s += string(rope(1148, 270, 1194, 250, { slack: 1.12 }), { opacity: .85 });
    s += string(rope(...H2, dbr[0] + 40, dbr[1] - 6, { slack: 1.16 }), { opacity: .8 });
  }
  (P ? [[298, 116], [562, 120], [464, 250], [566, 170], H1, [ck[0], ck[1] - 34]] : [[298, 116], [562, 120], [464, 250], [566, 170], [980, 100], [794, 110], H1, [ck[0], ck[1] - 34], [1148, 270], [1194, 250], H2, [dbr[0] + 40, dbr[1] - 6]])
    .forEach(([x, y]) => s += pin(x, y, { r: 4.5 }));

  // Sill and desk
  s += `<rect x="0" y="${GROUND}" width="${W}" height="26" fill="#1B2028"/><rect x="0" y="${GROUND + 26}" width="${W}" height="${H - GROUND - 26}" fill="#1A1714"/>
    <rect x="0" y="${GROUND + 26}" width="${W}" height="${H - GROUND - 26}" filter="url(#woodgrain)"/>`;

  // Laptop at the lower left: the log search
  s += `<rect x="62" y="724" width="376" height="200" rx="8" fill="#08090C"/><g clip-path="url(#lap)"><rect x="74" y="736" width="352" height="200" fill="#10151C"/>
    <text x="88" y="756" class="mono" font-size="9" fill="${C.fog}" letter-spacing=".06em">LOGS</text>
    <rect x="88" y="764" width="324" height="22" fill="#0B0F14" stroke="#262D37"/>
    <text x="96" y="779" class="mono" font-size="9" fill="${C.paper}"><tspan fill="${C.amber}">service:</tspan>checkout-api <tspan fill="${C.amber}">level:</tspan>warn+ "retry"</text>`;
  [['03:28:41', 'WARN', 'retry attempt=3/5'], ['03:28:42', 'WARN', 'retry attempt=4/5'], ['03:28:44', 'ERROR', 'timeout after 4012ms'], ['03:28:47', 'WARN', 'retry attempt=2/5'], ['03:28:49', 'WARN', 'retry attempt=5/5']]
    .forEach(([t, lv, m], i) => {
      const y = 806 + i * 15;
      s += `<text x="88" y="${y}" class="mono" font-size="9" fill="${C.fog}">${t}</text><text x="146" y="${y}" class="mono" font-size="9" fill="${lv === 'ERROR' ? C.red : C.paper}" fill-opacity="${lv === 'ERROR' ? 1 : .6}">${lv}</text><text x="190" y="${y}" class="mono" font-size="9" fill="${C.paper}" fill-opacity=".75">${m}</text>`;
    });
  s += `<text x="88" y="890" class="mono" font-size="8.5" fill="${C.fog}">1,912 lines · this search cost 4 min</text></g>`;

  // Mug and phone on the desk
  s += `<g><path d="M560,770 L564,834 Q600,846 636,834 L640,770 Z" fill="#262B33"/><ellipse cx="600" cy="770" rx="40" ry="10" fill="#1C2026"/><ellipse cx="600" cy="771" rx="34" ry="7.5" fill="#2E1E14"/>
    <path d="M640,782 q22,4 18,22 q-4,12 -20,10" fill="none" stroke="#262B33" stroke-width="7"/></g>`;
  if (!P) s += `<g transform="rotate(-6 1180 810)"><rect x="1050" y="740" width="260" height="130" rx="18" fill="#08090C"/><rect x="1060" y="750" width="240" height="110" rx="12" fill="#151B24"/>
    <text x="1076" y="800" class="mono" font-size="36" font-weight="500" fill="${C.paper}">03:29</text>
    <text x="1078" y="822" class="mono" font-size="8.5" fill="${C.fog}">+15 MIN SINCE THE PAGE</text>
    <rect x="1206" y="764" width="3" height="80" fill="${C.red}"/>
    <text x="1216" y="778" class="mono" font-size="8" font-weight="600" fill="${C.red}">PAGE 03:14</text>
    <text x="1216" y="796" class="mono" font-size="8.5" fill="${C.paper}">checkout p99</text>
    <text x="1216" y="810" class="mono" font-size="8.5" fill="${C.paper}">&gt; 4s for 5m</text>
    <text x="1216" y="834" class="mono" font-size="8" fill="${C.red}">1,240 users ↑</text></g>`;

  // Case title written on the sill in grease pencil
  if (!P) s += `<text x="700" y="${GROUND + 18}" class="serif" font-style="italic" font-size="15" fill="${C.paper}" fill-opacity=".55" text-anchor="middle">Case 01 · The Quiet Push — Mercadito, 03:29, the city asleep but one tower.</text>`;

  if (!P) s += `<rect width="${W}" height="${H}" fill="url(#dark)"/>`;
  return s;
};
})();
