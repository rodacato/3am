// Shared helpers for the Step 0 boards. Everything is drawn from numbers and a seed,
// so the same board always renders the same scene (a preview of the engine's rule).
(function () {
  const C = {
    night: '#151A22',
    amber: '#F2A541',
    paper: '#E8E2D6',
    red: '#E0533D',
    fog: '#6B7480',
    ink: '#2B2823',
    shade: '#0B0E13',
  };

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Smooth 1D value noise; enough organic wobble for a mockup without simplex.
  function noise1(seed) {
    const r = rng(seed);
    const pts = Array.from({ length: 256 }, () => r() * 2 - 1);
    return (x) => {
      const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f);
      const a = pts[i & 255], b = pts[(i + 1) & 255];
      return a + (b - a) * t;
    };
  }

  const f = (n) => Math.round(n * 10) / 10;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // p99 latency in ms, one point per minute: a calm night, then the config push lands.
  function latency({ seed = 3, n = 90, onset = 62, base = 380, peak = 4300, ramp = 5 } = {}) {
    const nz = noise1(seed), r = rng(seed + 1), out = [];
    for (let i = 0; i < n; i++) {
      let v = base * (1 + 0.07 * Math.sin(i / 13)) + nz(i / 4) * 38 + (r() - 0.5) * 26;
      if (i >= onset) {
        const k = Math.min(1, (i - onset) / ramp);
        v += (peak - base) * k * (1 + 0.07 * nz(i / 2 + 50));
      }
      out.push(Math.max(40, v));
    }
    return out;
  }

  // A flat, boring signal: the alibi.
  function flat({ seed = 8, n = 90, base = 31, wobble = 3 } = {}) {
    const nz = noise1(seed), out = [];
    for (let i = 0; i < n; i++) out.push(base + nz(i / 5) * wobble);
    return out;
  }

  function scaleY(vals, y, h, min, max) {
    return (v) => y + h - ((v - min) / (max - min)) * h;
  }

  function linePath(vals, x, y, w, h, { min = 0, max } = {}) {
    max = max ?? Math.max(...vals) * 1.08;
    const sy = scaleY(vals, y, h, min, max);
    return vals.map((v, i) => `${i ? 'L' : 'M'}${f(x + (i / (vals.length - 1)) * w)},${f(sy(v))}`).join(' ');
  }

  function areaPath(vals, x, y, w, h, opts = {}) {
    return `${linePath(vals, x, y, w, h, opts)} L${f(x + w)},${f(y + h)} L${f(x)},${f(y + h)} Z`;
  }

  // Verlet rope between two pins, run to rest. slack > 1 sags; gravity can point anywhere
  // (down on a wall, sideways when the string lies flat on a desk).
  function rope(x1, y1, x2, y2, { slack = 1.04, n = 20, gx = 0, gy = 0.4, iter = 500 } = {}) {
    const pts = [], prev = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
      prev.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    }
    const seg = (Math.hypot(x2 - x1, y2 - y1) * slack) / (n - 1);
    for (let k = 0; k < iter; k++) {
      for (let i = 1; i < n - 1; i++) {
        const vx = (pts[i][0] - prev[i][0]) * 0.96, vy = (pts[i][1] - prev[i][1]) * 0.96;
        prev[i] = [pts[i][0], pts[i][1]];
        pts[i][0] += vx + gx;
        pts[i][1] += vy + gy;
      }
      for (let c = 0; c < 24; c++) {
        for (let i = 0; i < n - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const d = Math.hypot(dx, dy) || 1e-6;
          const diff = (d - seg) / d;
          const aw = i === 0 ? 0 : 0.5, bw = i + 1 === n - 1 ? 0 : 0.5;
          a[0] += dx * diff * aw; a[1] += dy * diff * aw;
          b[0] -= dx * diff * bw; b[1] -= dy * diff * bw;
        }
      }
    }
    return smooth(pts);
  }

  function smooth(pts) {
    let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q${f(pts[i][0])},${f(pts[i][1])} ${f(mx)},${f(my)}`;
    }
    const last = pts[pts.length - 1];
    return d + ` L${f(last[0])},${f(last[1])}`;
  }

  // Red string: a dark core plus a thin highlight so it reads as twisted thread.
  function string(d, { opacity = 1, width = 1.8 } = {}) {
    return `<g fill="none" stroke-linecap="round" opacity="${opacity}">
      <path d="${d}" stroke="#000" stroke-opacity=".35" stroke-width="${width + 1.4}" transform="translate(1.5,3)"/>
      <path d="${d}" stroke="${C.red}" stroke-width="${width}"/>
      <path d="${d}" stroke="#F4A08F" stroke-opacity=".45" stroke-width=".6" stroke-dasharray="2 3"/>
    </g>`;
  }

  // Push pin seen from the front: head, a hard highlight, a short cast shadow.
  function pin(x, y, { color = C.red, r = 5.5 } = {}) {
    return `<g>
      <ellipse cx="${x + 3}" cy="${y + 5}" rx="${r}" ry="${r * 0.6}" fill="#000" fill-opacity=".45"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>
      <circle cx="${x - r * 0.3}" cy="${y - r * 0.35}" r="${r * 0.32}" fill="#fff" fill-opacity=".55"/>
    </g>`;
  }

  // Paper card with square corners, grain and a contact shadow that is
  // heavier at the bottom edge (paper curls away from the board, not a floating card).
  function card(x, y, w, h, inner, { rot = 0, fill = C.paper, lift = 1, id = '' } = {}) {
    const cx = x + w / 2, cy = y + h / 2;
    return `<g ${id ? `id="${id}"` : ''} transform="rotate(${rot} ${cx} ${cy})">
      <path d="M${x + 2},${y + 4} L${x + w + 2 * lift},${y + 5} L${x + w + 3 * lift},${y + h + 5 * lift} L${x + 3},${y + h + 3 * lift} Z" fill="#000" fill-opacity=".42"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" filter="url(#grain)"/>
      <g transform="translate(${x},${y})">${inner}</g>
    </g>`;
  }

  // Strip of translucent tape.
  function tape(x, y, w, rot = 0) {
    return `<rect x="${x - w / 2}" y="${y - 8}" width="${w}" height="16" fill="#E8E2D6" fill-opacity=".38" stroke="#fff" stroke-opacity=".12" transform="rotate(${rot} ${x} ${y})"/>`;
  }

  function defs() {
    return `<defs>
      <filter id="grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" seed="4" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 .25  0 0 0 0 .2  0 0 0 0 .15  0 0 0 .14 0"/>
      </filter>
      <filter id="grain-dark" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".6" numOctaves="2" seed="11" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .045 0"/>
      </filter>
      <filter id="woodgrain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency=".004 .09" numOctaves="2" seed="21" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 .9  0 0 0 0 .75  0 0 0 0 .55  0 0 0 .07 0"/>
      </filter>
    </defs>`;
  }

  // Fit a fixed-size stage into the viewport.
  function fit(selector, W, H) {
    const run = () => document.querySelectorAll(selector).forEach((el) => {
      const s = Math.min(window.innerWidth / W, window.innerHeight / H);
      el.style.transform = `scale(${s})`;
    });
    window.addEventListener('resize', run);
    run();
  }

  window.AM = { C, rng, noise1, f, esc, latency, flat, linePath, areaPath, rope, smooth, string, pin, card, tape, defs, fit };
})();
