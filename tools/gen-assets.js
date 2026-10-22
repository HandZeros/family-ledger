/**
 * 生成品牌资源：PWA 图标、Android 图标、启动图。
 *
 * 用法：
 *   node tools/gen-assets.js
 * 依赖 Playwright（仅开发时使用）：
 *   npm i -D playwright
 * 默认调用系统 Chrome，可通过环境变量指定：
 *   CHROME_PATH="/path/to/chrome" node tools/gen-assets.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const RES = path.join(ROOT, 'mobile/android/app/src/main/res');

// 账本图形（512x512 坐标系）
const GLYPH = `
  <g fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">
    <rect x="132" y="112" width="248" height="288" rx="40" stroke-width="26" opacity="0.96"/>
    <path d="M196 112v-8c0-13 11-24 24-24h72c13 0 24 11 24 24v8" stroke-width="22" opacity="0.75"/>
    <path d="M196 224h120" stroke-width="22"/>
    <path d="M196 292h76" stroke-width="22" opacity="0.7"/>
  </g>
  <circle cx="316" cy="312" r="54" fill="#F3D19A"/>
  <path d="M296 312h40M316 292v40" stroke="#1F4C3E" stroke-width="17" stroke-linecap="round"/>`;

const DEFS = `<defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#3A7F68"/><stop offset="1" stop-color="#1F4C3E"/>
  </linearGradient>
  <clipPath id="circle"><circle cx="256" cy="256" r="256"/></clipPath>
</defs>`;

const fullIcon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  ${DEFS}<rect width="512" height="512" rx="112" fill="url(#g)"/>${GLYPH}</svg>`;

const roundIcon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  ${DEFS}<rect width="512" height="512" fill="url(#g)" clip-path="url(#circle)"/>${GLYPH}</svg>`;

const maskable = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  ${DEFS}<rect width="512" height="512" fill="#1F4C3E"/>
  <g transform="translate(256,256) scale(0.64) translate(-256,-256)">
    <rect width="512" height="512" rx="118" fill="url(#g)"/>${GLYPH}
  </g></svg>`;

const foreground = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <g transform="translate(256,256) scale(0.62) translate(-256,-256)">${GLYPH}</g></svg>`;

const splash = (w, h) => {
  const m = Math.min(w, h);
  const icon = m * 0.3;
  const cx = w / 2;
  const cy = h / 2 - m * 0.03;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#1F4C3E"/>
    <g transform="translate(${cx - icon / 2},${cy - icon / 2}) scale(${icon / 512})">${GLYPH}</g>
    <text x="${cx}" y="${cy + icon * 0.78}" fill="#FFFFFF" opacity="0.7"
      font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="${m * 0.055}"
      letter-spacing="${m * 0.012}" text-anchor="middle">家庭账本</text>
  </svg>`;
};

const TASKS = [];

// 1. PWA / 站点图标
TASKS.push(['app/static/icons/icon-192.png', 192, 192, () => fullIcon(192)]);
TASKS.push(['app/static/icons/icon-512.png', 512, 512, () => fullIcon(512)]);
TASKS.push(['app/static/icons/icon-1024.png', 1024, 1024, () => fullIcon(1024)]);
TASKS.push(['app/static/icons/apple-touch-icon.png', 180, 180, () => fullIcon(180)]);
TASKS.push(['app/static/icons/icon-maskable-512.png', 512, 512, () => maskable(512)]);
TASKS.push(['mobile/www/icon.png', 1024, 1024, () => fullIcon(1024)]);

// 2. Android mipmap（自适应图标：背景色见 values/ic_launcher_background.xml）
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENS)) {
  const dir = `mobile/android/app/src/main/res/mipmap-${d}`;
  const lg = Math.round(48 * k);
  const fg = Math.round(108 * k);
  TASKS.push([`${dir}/ic_launcher.png`, lg, lg, () => fullIcon(lg)]);
  TASKS.push([`${dir}/ic_launcher_round.png`, lg, lg, () => roundIcon(lg)]);
  TASKS.push([`${dir}/ic_launcher_foreground.png`, fg, fg, () => foreground(fg)]);
}

// 3. Android 启动图（尺寸沿用 Capacitor 模板）
const SPLASH = {
  'drawable': [480, 320],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
};
for (const [sub, [w, h]] of Object.entries(SPLASH)) {
  TASKS.push([`mobile/android/app/src/main/res/${sub}/splash.png`, w, h, () => splash(w, h)]);
}

// 4. 飞牛 FPK 图标（要求不透明，用全幅背景版本）
TASKS.push(['fnos/family-ledger/ICON.PNG', 64, 64, () => maskable(64)]);
TASKS.push(['fnos/family-ledger/ICON_256.PNG', 256, 256, () => maskable(256)]);
TASKS.push(['fnos/family-ledger/app/ui/images/icon_64.png', 64, 64, () => maskable(64)]);
TASKS.push(['fnos/family-ledger/app/ui/images/icon_256.png', 256, 256, () => maskable(256)]);

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-proxy-server', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  let n = 0;
  for (const [rel, w, h, gen] of TASKS) {
    const out = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(
      `<html><body style="margin:0;overflow:hidden;background:transparent">${gen()}</body></html>`
    );
    await page.waitForTimeout(60);
    const transparent = !rel.includes('splash');
    await page.screenshot({ path: out, omitBackground: transparent, type: 'png' });
    n++;
  }
  await browser.close();
  console.log(`已生成 ${n} 个资源文件`);
})().catch((e) => {
  console.error('生成失败：', e.message);
  process.exit(1);
});
