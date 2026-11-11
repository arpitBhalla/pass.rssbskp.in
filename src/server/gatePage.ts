import 'server-only';

/*
 * The gate page (/v#<code>): what a phone opens when it scans a pass's QR code. Plain HTML and JS, no
 * framework, so it loads fast on a phone.
 *
 * 1. Reads the code from the link (after #, so it never reaches server logs) and shows the pass it names.
 * 2. Asks the server (gate.check): the code's secret tag, the register, the scan log. Needs a login,
 *    which the phone keeps.
 */

const STYLE = String.raw`
*{box-sizing:border-box;margin:0}
html{-webkit-text-size-adjust:100%}
body{font:18px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#231f20;background:#f6f7f8;min-height:100vh}
header{background:hsl(6 99% 27%);color:#fff;padding:12px 16px;font-weight:700;font-size:17px;letter-spacing:.01em}
main{max-width:34rem;margin:0 auto;padding:0 0 32px}
.verdict{padding:22px 16px 20px;color:#fff;background:#6d6e71}
.verdict.valid{background:#007236}
.verdict.check{background:#f2b705;color:#231f20}
.verdict.invalid{background:#9e0b0f}
.word{font-size:clamp(44px,15vw,84px);font-weight:800;line-height:1;letter-spacing:.01em}
.which{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:22px;font-weight:700}
.which b{font-variant-numeric:tabular-nums;font-size:26px}
.chip{width:14px;height:20px;border-radius:2px;border:2px solid #fff;flex:none}
.advice{margin-top:6px;font-size:19px}
.box{background:#fff;border-bottom:1px solid #dcdfe3;padding:14px 16px}
.reasons{background:#fff8e1;border-bottom:1px solid #e9d9a6;padding:12px 16px 12px 36px}
.reasons li+li{margin-top:6px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px}
dt{color:#6d6e71}
dd{font-weight:700;overflow-wrap:anywhere}
h2{font-size:15px;color:#6d6e71;font-weight:600;margin-bottom:6px}
table{width:100%;border-collapse:collapse;font-size:16px}
td{padding:5px 0;border-top:1px solid #eceef0;vertical-align:top}
td+td{padding-left:12px}
.r-valid{color:#007236;font-weight:700}.r-check{color:#8a6100;font-weight:700}.r-invalid{color:#9e0b0f;font-weight:700}
.note{padding:12px 16px;color:#6d6e71;font-size:15px}
.btn{display:block;margin:16px;padding:14px;text-align:center;border-radius:4px;background:hsl(6 99% 27%);color:#fff;font-weight:700;text-decoration:none}
.intro{padding:24px 16px}
.intro p+p{margin-top:12px;color:#6d6e71;font-size:16px}
`;

// No backticks or dollar-brace in here: it sits inside a template string.
const SCRIPT = String.raw`
(function () {
  var out = document.getElementById('out');
  var WORD = { valid: 'VALID', check: 'CHECK', invalid: 'NOT VALID', wait: 'Checking', unknown: 'NOT CHECKED' };
  var ADVICE = { valid: 'Let in.', check: 'Genuine pass, but the register disagrees. Look closer:', invalid: "Don't let in." };
  var LABELS = { name: 'Name', dept: 'Dept', area: 'Area', incharge: 'Incharge', vehicle: 'Vehicle', vehicle_no: 'Reg. No.' };

  function h(tag, attrs) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'class') e.className = attrs[k]; else if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]);
    }
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) kid.forEach(function (k) { add(e, k); });
    else e.append(kid instanceof Node ? kid : String(kid));
  }
  function serial(n) { return String(n).padStart(4, '0'); }
  function type(id) { return DATA.types.find(function (t) { return t.id === id; }) || { label: id, band: '#6d6e71' }; }

  /* The code is one decimal number of 19 bytes: format (2), key id, sheet, serial (3), name hash (3), tag (10). */
  function parse(code) {
    if (!/^[1-9][0-9]{0,59}$/.test(code)) return null;
    var hex = BigInt(code).toString(16);
    if (hex.length % 2) hex = '0' + hex;
    var b = new Uint8Array(hex.length / 2);
    for (var i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
    if (b.length !== 19 || b[0] !== 2 || b[2] >= DATA.types.length) return null;
    return { type: DATA.types[b[2]].id, serial: (b[3] << 16) | (b[4] << 8) | b[5] };
  }

  function when(iso) {
    var d = new Date(iso);
    var min = Math.round((Date.now() - d) / 60000);
    var clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago, ' + clock;
    var day = d.toDateString() === new Date().toDateString() ? 'today' : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    return day + ' ' + clock;
  }

  function show(r) {
    var t = r.claim && type(r.claim.type);
    var rows = [];
    if (r.pass) for (var k in LABELS) if (r.pass[k]) rows.push(h('dt', null, LABELS[k]), h('dd', null, r.pass[k].toUpperCase()));
    out.replaceChildren();
    add(out, [
      h('section', { class: 'verdict ' + r.verdict },
        h('div', { class: 'word' }, WORD[r.verdict]),
        t && h('div', { class: 'which' }, h('span', { class: 'chip', style: 'background:' + t.band }), t.label, h('b', null, serial(r.claim.serial))),
        ADVICE[r.verdict] && h('p', { class: 'advice' }, ADVICE[r.verdict])),
      r.reasons && r.reasons.length ? h('ul', { class: 'reasons' }, r.reasons.map(function (x) { return h('li', null, x); })) : null,
      rows.length ? h('div', { class: 'box' }, h('dl', null, rows)) : null,
      r.earlier && r.earlier.length ? h('div', { class: 'box' },
        h('h2', null, r.scans === 1 ? 'Scanned once before' : 'Scanned ' + r.scans + ' times before'),
        h('table', null, r.earlier.map(function (e) {
          return h('tr', null, h('td', null, when(e.at)), h('td', null, e.by), h('td', { class: 'r-' + e.result }, WORD[e.result] || e.result));
        }))) : null,
      r.note ? h('p', { class: 'note' }, r.note) : null,
      r.login ? h('a', { class: 'btn', href: '/login?next=' + encodeURIComponent('/v#' + r.code) }, 'Log in to check the register') : null,
    ]);
  }

  function intro() {
    out.replaceChildren(h('div', { class: 'intro' },
      h('p', null, 'Scan the QR code on a pass with this phone\'s camera and open the link.'),
      h('p', null, 'The pass is checked against the register, and each scan is recorded.')));
  }

  function run() {
    var code = decodeURIComponent(location.hash.slice(1)).trim();
    if (!code) return intro();
    var p = parse(code);
    if (!p) return show({ verdict: 'invalid', reasons: ['This QR code is not an RSSB SKP pass.'] });
    var claim = { type: p.type, serial: p.serial };
    show({ verdict: 'wait', claim: claim });

    fetch('/api/trpc/gate.check', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code }),
    }).then(function (res) {
      return res.json().then(function (j) {
        if (j.result) {
          var r = j.result.data;
          r.note = 'Checked against the register; this scan is recorded.';
          return show(r);
        }
        var why = j.error && j.error.data && j.error.data.code;
        if (why === 'UNAUTHORIZED') return show({ verdict: 'unknown', claim: claim, note: 'Log in once on this phone to check passes.', login: true, code: code });
        show({ verdict: 'unknown', claim: claim, note: (j.error && j.error.message) || 'The register could not check this pass.' });
      });
    }, function () {
      show({ verdict: 'unknown', claim: claim, note: 'No connection to the register. Join the gate Wi-Fi and scan again.' });
    });
  }

  window.addEventListener('hashchange', run);
  run();
})();
`;

/** The gate page, with the sheet names and colours. */
export function gatePage(data: unknown): string {
  // JSON inside <script>: escape "<" so no value can close the tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#890e01">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 32'%3E%3Crect x='1' y='1' width='22' height='30' rx='2' fill='white' stroke='%23891001' stroke-width='2'/%3E%3Crect x='1' y='1' width='22' height='9' fill='%23891001'/%3E%3Crect x='1' y='26' width='22' height='5' fill='%23891001'/%3E%3C/svg%3E">
<title>Pass check</title>
<style>${STYLE}</style>
</head>
<body>
<header>RSSB SKP Pass Check</header>
<main id="out"></main>
<script>var DATA = ${json};${SCRIPT}</script>
</body>
</html>`;
}
