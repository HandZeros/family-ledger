#!/usr/bin/env node
/**
 * 把 Web 端（app/static）打包进 Android 壳的 www 目录。
 *
 * 目的：让 App 直接在自家 WebView 里跑账本界面，而不是跳到系统浏览器。
 * 产物：
 *   mobile/www/static/          ← app/static 的完整副本（路径仍保持 /static/xxx，
 *                                  因为 Capacitor 把 www 作为本地站点根目录）
 *   mobile/www/ledger/index.html ← 账本入口页副本
 *
 * www/index.html（连接页）是手写文件，不会被覆盖。
 * 这两个目录属于生成物，已加入 .gitignore；CI 每次构建前都会重新生成。
 *
 * 用法：node tools/build-mobile.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'static');
const WWW = path.join(ROOT, 'mobile', 'www');

const OUT_STATIC = path.join(WWW, 'static');
const OUT_LEDGER = path.join(WWW, 'ledger');

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, entry.name);
    if (entry.isDirectory()) rmrf(full);
    else fs.unlinkSync(full);
  }
  fs.rmdirSync(p);
}

// 逐文件复制（不用 fs.cpSync：个别环境会对整目录复制做拦截）
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.writeFileSync(d, fs.readFileSync(s));
  }
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function main() {
  if (!fs.existsSync(path.join(SRC, 'index.html'))) {
    console.error(`找不到 Web 端源码：${SRC}`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(WWW, 'index.html'))) {
    console.error(`找不到 App 连接页：${path.join(WWW, 'index.html')}`);
    process.exit(1);
  }

  rmrf(OUT_STATIC);
  rmrf(OUT_LEDGER);
  fs.mkdirSync(OUT_LEDGER, { recursive: true });

  copyDir(SRC, OUT_STATIC);
  fs.copyFileSync(path.join(SRC, 'index.html'), path.join(OUT_LEDGER, 'index.html'));

  const files = walk(OUT_STATIC);
  const bytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
  const kb = (bytes / 1024).toFixed(0);

  console.log(`已生成 mobile/www/static：${files.length} 个文件，${kb} KB`);
  console.log('已生成 mobile/www/ledger/index.html');
  console.log('接着执行：cd mobile && npx cap sync android');
}

main();
