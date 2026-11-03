// 桌面版发布前自检：确认「能构建、能装、能跑」依赖的东西都还在。
//
// 这个仓库是插件版 dsh-pet 的独立桌面分支，插件侧的发布门禁（npm 包结构 / cordis 挂载 /
// DSH 模块注册 id）在这里不适用，那套检查留在插件仓库。这里只查桌面版自己的东西。
//
// 用法：node tools/verify-desktop.mjs

import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let failed = 0;
const ok = (msg) => console.log('  ✓ ' + msg);
const bad = (msg) => { failed += 1; console.log('  ✗ ' + msg); };
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));

function readJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

function size(rel) {
  return existsSync(join(root, rel)) ? statSync(join(root, rel)).size : -1;
}

console.log('dsh-pet 桌面版自检');
console.log('根目录 ' + root);

// ---------- 1. 清单 ----------
console.log('\n[1] package.json');
const pkg = readJson('package.json');
check(pkg.name === 'dsh-pet-desktop', 'name = dsh-pet-desktop（实际 ' + pkg.name + '）');
check(/^\d+\.\d+\.\d+/.test(pkg.version || ''), 'version 合法（' + pkg.version + '）');
check(pkg.productName === 'dsh-pet', 'productName = dsh-pet');
check(pkg.main === 'electron/main.js', 'main 指向 electron/main.js');
check(!pkg.peerDependencies, '没有遗留插件版 peerDependencies');
check(!pkg.dsh, '没有遗留插件版 dsh 字段');
check(!pkg.exports, '没有遗留插件版 exports');

// ---------- 2. electron-builder 配置 ----------
console.log('\n[2] electron-builder 配置');
const build = pkg.build || {};
check(build.appId === 'com.tuweizhi.dshpet', 'appId = com.tuweizhi.dshpet');
check(build.asar === false, 'asar = false（standalone.js 靠 import.meta.url 推 packageRoot）');
check(build.win && build.win.icon === 'build/icon.ico', 'win.icon 指向 build/icon.ico');
check(
  build.win && Array.isArray(build.win.target) && build.win.target.some((t) => t.target === 'nsis'),
  'win.target 含 nsis'
);
check(build.nsis && build.nsis.oneClick === false, 'nsis.oneClick = false（可选安装目录）');
const files = build.files || [];
for (const need of ['electron/**/*', 'lib/**/*', 'runtime/**/*', 'assets/**/*', 'package.json']) {
  check(files.includes(need), 'files 白名单含 ' + need);
}

// ---------- 3. 入口与运行时文件 ----------
console.log('\n[3] 入口与运行时');
const mustExist = [
  'electron/main.js',
  'lib/package.json',
  'lib/standalone.js',
  'runtime/electron-helper/main.js',
  'runtime/electron-helper/sprite.js',
  'runtime/electron-helper/renderer.js',
  'runtime/electron-helper/constants.js',
  'runtime/electron-helper/preload.js',
  'runtime/electron-helper/index.html',
  'runtime/electron-helper/note.js',
  'runtime/electron-helper/note-pages.js',
  'runtime/electron-helper/note.css',
  'runtime/electron-helper/note-saving.js',
  'runtime/electron-helper/note-storage.js',
  'runtime/electron-helper/desktop-controls.js',
  'runtime/electron-helper/desktop-updates.js',
  'assets/pic/note-holding-look-up.png',
  ...['拿出', '待机', '上一页', '下一页', '收起'].map(name => `assets/webm/便签-${name}.webm`),
  'build/installer.nsh',
  'assets/config.jsonc',
  'assets/logo.png',
  'build/icon.ico',
  'LICENSE',
];
for (const rel of mustExist) check(existsSync(join(root, rel)), rel);

check(readJson('lib/package.json').type === 'module', 'lib/package.json 声明 type: module');
check(size('build/icon.ico') > 20000, 'build/icon.ico 有内容（' + size('build/icon.ico') + ' B）');

// ---------- 4. 语法 ----------
console.log('\n[4] 语法（node --check）');
const syntaxTargets = [
  'electron/main.js',
  'lib/standalone.js',
  'runtime/electron-helper/main.js',
  'runtime/electron-helper/sprite.js',
  'runtime/electron-helper/renderer.js',
  'runtime/electron-helper/constants.js',
  'runtime/electron-helper/preload.js',
];
syntaxTargets.push('runtime/electron-helper/note.js', 'runtime/electron-helper/note-pages.js', 'runtime/electron-helper/note-saving.js',
  'runtime/electron-helper/note-storage.js', 'runtime/electron-helper/desktop-controls.js',
  'runtime/electron-helper/desktop-updates.js');
for (const rel of syntaxTargets) {
  const r = spawnSync(process.execPath, ['--check', join(root, rel)], { encoding: 'utf8' });
  check(r.status === 0, rel + (r.status === 0 ? '' : '\n' + (r.stderr || '').trim()));
}

// ---------- 5. 设置页片段可重放 ----------
console.log('\n[5] 设置页片段与 lib/standalone.js 是否同步');
const spDir = join(root, 'tools', 'settings-page');
const standalone = readFileSync(join(root, 'lib', 'standalone.js'), 'utf8');
const esc = (text) => text.replace(/\\/g, '\\\\');
const frags = [
  ['settingsPage', 'page.html.txt'],
  ['settingsStyle', 'style.css.txt'],
  ['settingsScript', 'script.js.txt'],
];
let cursor = 0;
for (const [name, file] of frags) {
  const open = 'const ' + name + ' = `';
  const a = standalone.indexOf(open, cursor);
  if (a < 0) { bad(name + ' 在 lib/standalone.js 里找不到'); continue; }
  const bodyStart = a + open.length;
  const b = standalone.indexOf('`;', bodyStart);
  const inFile = standalone.slice(bodyStart + 1, b); // 跳过拼进去时补的那个换行
  const expected = esc(readFileSync(join(spDir, file), 'utf8'));
  check(inFile === expected, name + ' 与 ' + file + ' 一致（改完记得跑 apply.mjs）');
  cursor = b;
}

// ---------- 6. 不该带进仓库的东西 ----------
console.log('\n[6] 泄漏检查');
const suspicious = [
  [/C:\\Users\\91649/g, '本机绝对路径 C:\\Users\\91649'],
  [/gho_[A-Za-z0-9]{20,}/g, 'GitHub token'],
  [/sk-[A-Za-z0-9]{20,}/g, 'API key'],
];
const scanList = [
  'README.md',
  'NOTICE.md',
  'CHANGELOG.md',
  'package.json',
  'electron/main.js',
  'lib/standalone.js',
];
for (const rel of scanList) {
  if (!existsSync(join(root, rel))) continue;
  const text = readFileSync(join(root, rel), 'utf8');
  for (const [re, label] of suspicious) {
    check(!re.test(text), rel + ' 不含 ' + label);
  }
}

// ---------- 汇总 ----------
console.log('');
if (failed === 0) {
  console.log('全部通过：可以发布。');
} else {
  console.log(failed + ' 项未通过，已中止发布。');
  process.exitCode = 1;
}
