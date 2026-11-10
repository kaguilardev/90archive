// Renders packaging close-ups for each jersey into public/assets/packaging/<slug>-<shot>.jpg.
// Uses the jersey's own photos, so the mockups stay accurate when products change.
// Needs Google Chrome or Microsoft Edge installed. Run: node scripts/make-packaging-mockups.js [slug]
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const products = JSON.parse(readFileSync(join(root, 'data/products.json'), 'utf8'));
const only = process.argv[2];
const outDir = join(root, 'public/assets/packaging');
mkdirSync(outDir, { recursive: true });

const browsers = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);
const browser = browsers.find((b) => existsSync(b));
if (!browser) throw new Error('Chrome or Edge not found. Set CHROME_PATH.');

// Where the shirt sits in each hanger photo, so the box shows the shirt and not the wall.
const CROP = { x: 0.13, y: 0.225, w: 0.74 };
const CROPS = {};

const esc =(s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const asset = (p) => pathToFileURL(join(root, 'public', p)).href;
const pick = (p, word) => p.images.find((i) => i.includes(word)) ?? p.images[0];

function scene(p, index) {
  const no = String(index + 1).padStart(3, '0');
  const player = p.player ? `${p.player}${p.number ? ` · ${p.number}` : ''}` : '';
  const front = asset(pick(p, 'hanger'));
  const back = asset(pick(p, 'detail'));
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;1,6..96,400&family=Jost:wght@400;500&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1600px; height: 1200px; overflow: hidden; }
  body { position: relative; background: #d8c8ab; font-family: Jost, sans-serif; color: #2a2218; }
  .linen { position: absolute; inset: 0;
    background:
      radial-gradient(120% 90% at 30% 20%, rgba(255,248,232,.55), transparent 60%),
      radial-gradient(90% 80% at 90% 100%, rgba(90,70,40,.22), transparent 60%),
      repeating-linear-gradient(0deg, rgba(80,60,30,.035) 0 1px, transparent 1px 3px),
      repeating-linear-gradient(90deg, rgba(80,60,30,.03) 0 1px, transparent 1px 4px); }
  .grain { position: absolute; inset: 0; opacity: .35; mix-blend-mode: multiply; }
  .obj { position: absolute; }
  .paper { background: #e9dcc3;
    background-image: radial-gradient(140% 120% at 0 0, rgba(255,255,255,.45), transparent 55%), linear-gradient(160deg, rgba(0,0,0,0) 60%, rgba(70,50,20,.08));
    box-shadow: 0 1px 1px rgba(40,28,10,.18), 0 14px 28px -10px rgba(40,28,10,.45), 0 30px 60px -30px rgba(40,28,10,.35); }
  .serif { font-family: "Bodoni Moda", serif; }
  .caps { text-transform: uppercase; letter-spacing: .28em; font-size: 11px; font-weight: 500; }
  .rule { width: 26px; height: 1px; background: currentColor; opacity: .5; margin: 14px auto; }
  .center { text-align: center; }

  /* Mailer */
  .mailer { left: 58px; top: 96px; width: 400px; height: 560px; transform: rotate(-4deg);
    background: #ccb791; border-radius: 4px; padding-top: 170px; }
  .mailer::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 44px; border-radius: 4px 4px 0 0;
    background: linear-gradient(#f4f1ea, #dcd7cc); box-shadow: inset 0 -1px 0 rgba(0,0,0,.08); }
  .mailer .mark { font-size: 84px; line-height: 1; }
  .mailer .sub { margin-top: 10px; font-size: 10px; letter-spacing: .32em; }
  .mailer .line { font-size: 17px; line-height: 1.5; margin-top: 120px; }
  .mailer .url { margin-top: 26px; font-size: 10px; letter-spacing: .3em; }

  /* Box */
  .box { left: 480px; top: 70px; width: 640px; height: 820px; background: #b99d72; border-radius: 6px; padding: 22px;
    box-shadow: 0 2px 2px rgba(40,28,10,.25), 0 30px 60px -20px rgba(40,28,10,.6); }
  .box::before { content: ""; position: absolute; left: 0; right: 0; top: -54px; height: 70px; border-radius: 6px 6px 0 0;
    background: linear-gradient(#cdb48a, #b49870); transform: perspective(600px) rotateX(38deg); transform-origin: bottom; z-index: -1; }
  .well { position: relative; width: 100%; height: 100%; overflow: hidden; background: #e9dcc3;
    box-shadow: inset 0 0 0 1px rgba(60,40,15,.25), inset 0 14px 22px -8px rgba(40,25,5,.55), inset 0 -6px 14px -6px rgba(40,25,5,.35); }
  .shirt { position: absolute; height: auto; filter: saturate(.95) contrast(1.03); }
  .flap { position: absolute; top: -2%; width: 40%; height: 26%;
    background: linear-gradient(135deg, #efe3cb, #dcc9a6 70%); filter: drop-shadow(0 8px 10px rgba(40,25,5,.4)); }
  .side { position: absolute; top: 30%; bottom: 0; width: 7%; background: linear-gradient(90deg, #dcc9a6, #ebdfc6); box-shadow: 0 0 14px rgba(40,25,5,.35); }
  .side.l { left: 0; } .side.r { right: 0; background: linear-gradient(270deg, #dcc9a6, #ebdfc6); }
  .flap.l { left: -4%; clip-path: polygon(0 0, 100% 0, 0 100%); }
  .flap.r { right: -4%; clip-path: polygon(0 0, 100% 0, 100% 100%); background: linear-gradient(225deg, #efe3cb, #d8c4a0 70%); }
  .tissue { position: absolute; left: -4%; right: -4%; bottom: -2%; height: 41%;
    background:
      linear-gradient(178deg, rgba(255,255,255,.5), transparent 30%),
      repeating-linear-gradient(97deg, rgba(120,95,55,.07) 0 2px, transparent 2px 46px),
      linear-gradient(#e6d6b8, #dcc9a6);
    clip-path: polygon(0 12%, 18% 4%, 46% 9%, 70% 2%, 100% 8%, 100% 100%, 0 100%);
    box-shadow: 0 -10px 20px rgba(0,0,0,.2); }
  .tissue-shade { position: absolute; left: -4%; right: -4%; bottom: calc(41% - 26px); height: 40px;
    background: linear-gradient(transparent, rgba(40,25,5,.32)); filter: blur(6px); }
  .seal { left: 50%; bottom: 20%; width: 120px; height: 120px; margin-left: -60px; border-radius: 50%;
    background: #1b1814; color: #e8dcc6; display: grid; place-content: center; text-align: center;
    box-shadow: 0 2px 3px rgba(0,0,0,.35); }
  .seal .serif { font-size: 30px; line-height: 1; }
  .seal .caps { font-size: 7px; letter-spacing: .3em; margin-top: 6px; }

  /* Hang tag */
  .string { left: 0; top: 0; width: 1600px; height: 1200px; pointer-events: none; }
  .tag { left: 512px; top: 236px; width: 170px; height: 270px; transform: rotate(-9deg); background: #151310; color: #e7dcc7;
    border-radius: 3px; padding-top: 86px; box-shadow: 0 2px 3px rgba(0,0,0,.4), 0 18px 30px -12px rgba(0,0,0,.6); }
  .tag::before { content: ""; position: absolute; left: 50%; top: 18px; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%;
    background: #a98f68; box-shadow: inset 0 1px 2px rgba(0,0,0,.6); }
  .tag .serif { font-size: 40px; line-height: 1; }
  .tag .caps { font-size: 8px; letter-spacing: .4em; margin-top: 8px; }
  .tag .foot { position: absolute; left: 0; right: 0; bottom: 24px; font-size: 7px; letter-spacing: .3em; }

  /* Right column */
  .story { left: 1158px; top: 84px; width: 370px; height: 520px; transform: rotate(2deg); padding: 44px 40px; }
  .story .caps { font-size: 10px; }
  .story h2 { font-family: "Bodoni Moda", serif; font-weight: 400; font-size: 40px; line-height: 1.1; margin-top: 18px; }
  .story .who { margin-top: 10px; font-size: 13px; letter-spacing: .2em; text-transform: uppercase; }
  .story .head { font-family: "Bodoni Moda", serif; font-style: italic; font-size: 19px; line-height: 1.4; margin-top: 4px; color: #4b3f2d; }
  .story .moment { font-family: "Bodoni Moda", serif; font-size: 22px; line-height: 1.25; margin-top: 10px; }
  .story .when { font-size: 12px; line-height: 1.5; margin-top: 8px; color: #5b4f3c; }
  .story .mark { position: absolute; left: 0; right: 0; bottom: 34px; font-size: 22px; }
  .print { left: 1180px; top: 650px; width: 330px; height: 300px; transform: rotate(-3deg); background: #f3ede1; padding: 14px 14px 46px; }
  .print .ph { width: 100%; height: 100%; background: url("${back}") center 38% / cover; filter: sepia(.25) contrast(1.05); }
  .print .cap { position: absolute; left: 0; right: 0; bottom: 14px; font-size: 9px; letter-spacing: .3em; }

  /* Bottom row */
  .card { top: 930px; width: 190px; height: 250px; padding: 30px 18px; }
  .card .serif.big { font-size: 26px; line-height: 1.15; margin-top: 12px; }
  .card .small { font-size: 12px; line-height: 1.5; color: #4b3f2d; }
  .card .mark { position: absolute; left: 0; right: 0; bottom: 22px; font-size: 16px; }
  .c1 { left: 96px; transform: rotate(-2deg); }
  .c2 { left: 320px; transform: rotate(1.5deg); }
  .c3 { left: 548px; top: 924px; width: 210px; transform: rotate(-1deg); }
  .sticker { left: 800px; top: 968px; width: 130px; height: 130px; border-radius: 50%; background: #c9b38c;
    display: grid; place-content: center; text-align: center; }
  .sticker .serif { font-size: 32px; line-height: 1; }
  .sticker .caps { font-size: 6.5px; margin-top: 6px; }
  .light { position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(115deg, rgba(255,250,235,.18), transparent 45%, rgba(40,25,5,.12)); }
</style></head><body><div id="stage">
<div class="linen"></div>
<svg class="grain" width="1600" height="1200"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .35  0 0 0 0 .27  0 0 0 0 .15  0 0 0 .5 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>

<div class="obj mailer paper center" style="background-color:#cbb48c">
  <div class="serif mark">90:00</div>
  <div class="caps sub">Football, remembered.</div>
  <div class="rule"></div>
  <p class="serif line">We don’t sell jerseys.<br>We archive memories.</p>
  <p class="caps url">90-00.com</p>
</div>

<div class="obj box">
  <div class="well">
    <img class="shirt" src="${front}" alt="" onload="window.fit && fit(this)">
    <div class="flap l"></div><div class="flap r"></div><div class="side l"></div><div class="side r"></div>
    <div class="tissue-shade"></div>
    <div class="tissue"></div>
    <div class="obj seal"><div class="serif">90:00</div><div class="caps">Archive</div></div>
  </div>
</div>

<svg class="obj string" viewBox="0 0 1600 1200"><path d="M 593 258 C 620 330, 700 340, 742 290 S 770 200, 752 192" fill="none" stroke="#1a1714" stroke-width="2.4" stroke-linecap="round"/></svg>
<div class="obj tag center">
  <div class="serif">90:00</div>
  <div class="caps">Archive</div>
  <div class="rule" style="margin-top:16px"></div>
  <div class="caps foot">Football, remembered.</div>
</div>

<div class="obj story paper center">
  <p class="caps">Archive ${no}</p>
  <h2>${esc(p.team)}</h2>
  ${player ? `<p class="who">${esc(player)}</p>` : ''}
  <div class="rule"></div>
  <p class="caps" style="letter-spacing:.3em">${esc(p.history?.years ?? '')}</p>
  <div class="rule"></div>
  <p class="head">${esc(p.history?.headline?.en ?? '')}</p>
  ${p.history?.moment ? `<p class="caps" style="margin-top:34px;font-size:9px">The moment</p>
  <p class="moment">${esc(p.history.moment.title.en)}</p>
  <p class="when">${esc(p.history.moment.date.en)}</p>` : ''}
  <p class="serif mark">90:00</p>
</div>

<div class="obj print paper"><div class="ph"></div><p class="caps cap center">${esc(p.title)}</p></div>

<div class="obj card paper center c1">
  <p class="caps" style="font-size:9px">Football, remembered.</p>
  <div class="rule"></div>
  <p class="small">Every jersey tells a story.<br>Every detail matters.<br>Every moment, forever.</p>
  <p class="serif mark">90:00</p>
</div>
<div class="obj card paper center c2">
  <p class="caps" style="font-size:9px">Archive ${no}</p>
  <p class="serif big">${esc(p.team)}</p>
  <p class="small" style="margin-top:8px">${esc(p.history?.years ?? '')}</p>
  <p class="serif mark">90:00</p>
</div>
<div class="obj card paper center c3">
  <p class="caps" style="font-size:9px">Thank you</p>
  <div class="rule"></div>
  <p class="small">for being part<br>of the archive.</p>
  <p class="serif mark">90:00</p>
</div>
<div class="obj sticker paper"><div class="serif">90:00</div><div class="caps">Football, remembered.</div></div>
<div class="light"></div></div>
<script>
  // Crop the hanger photo to the shirt: x and y are where the crop starts and w its width, as parts of the photo.
  function fit(img) {
    const c = ${JSON.stringify({ ...CROP, ...CROPS[p.slug] })}, box = img.parentElement.clientWidth;
    const scale = box / (img.naturalWidth * c.w);
    img.style.width = img.naturalWidth * scale + 'px';
    img.style.left = -img.naturalWidth * c.x * scale + 'px';
    img.style.top = -img.naturalHeight * c.y * scale + 'px';
  }
  const shirt = document.querySelector('.shirt');
  if (shirt.complete) fit(shirt);
</script>
</body></html>`;
}

// Close-ups cut from the full scene (in its 1600×1200 coordinates), each saved as <slug>-<name>.jpg at 800×1000.
const SHOTS = {
  mailer: { x: 10, y: 40, w: 520, h: 650 },
  box: { x: 470, y: 28, w: 664, h: 830 },
  tag: { x: 452, y: 150, w: 368, h: 460 },
  card: { x: 1118, y: 48, w: 452, h: 565 },
};
const OUT = { w: 800, h: 1000 };

const work = join(tmpdir(), `90archive-mockups-${process.pid}`);
mkdirSync(work, { recursive: true });
try {
  products.forEach((p, i) => {
    if (only && p.slug !== only) return;
    if (!p.images?.length) return console.log(`skip ${p.slug}: no photos`);
    for (const [name, crop] of Object.entries(SHOTS)) {
      const html = join(work, `${p.slug}-${name}.html`);
      const shot = join(work, `${p.slug}-${name}.jpg`);
      const s = OUT.w / crop.w;
      const view = `<style>html, body { width: ${OUT.w}px; height: ${OUT.h}px; }
        #stage { position: absolute; left: 0; top: 0; width: 1600px; height: 1200px; transform-origin: 0 0;
          transform: scale(${s}) translate(${-crop.x}px, ${-crop.y}px); }</style>`;
      writeFileSync(html, scene(p, i).replace('</head>', `${view}</head>`));
      execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
        `--window-size=${OUT.w},${OUT.h}`, '--virtual-time-budget=8000', `--screenshot=${shot}`, pathToFileURL(html).href], { stdio: 'ignore' });
      writeFileSync(join(outDir, `${p.slug}-${name}.jpg`), readFileSync(shot));
    }
    console.log(`made ${p.slug}`);
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
