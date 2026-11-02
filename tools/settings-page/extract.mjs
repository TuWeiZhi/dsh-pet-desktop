// 从 lib/standalone.js 里把 settingsPage / settingsStyle / settingsScript 三个模板字面量抽出来，
// 落到 out/ 下，方便直接用 node --check 验语法、或用浏览器打开看渲染效果。
//
// 这一步是「设置页静默失效」最快的诊断手段：服务端真正发出去的 JS 到底长什么样，
// 只有抽出来才看得见（页面本身不报错，字段全停在默认值）。
//
// 用法：node tools/settings-page/extract.mjs

import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const outDir = join(here, 'out');

const t = fs.readFileSync(join(root, 'lib', 'standalone.js'), 'utf8');

function grab(name) {
  const open = 'const ' + name + ' = `';
  const a = t.indexOf(open);
  if (a < 0) throw new Error('not found: ' + name);
  const b = t.indexOf('`;', a + open.length);
  return t.slice(a + open.length, b);
}

const page = grab('settingsPage');
const script = grab('settingsScript');
const style = grab('settingsStyle');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(join(outDir, 'page.html'), page, 'utf8');
fs.writeFileSync(join(outDir, 'script.js'), script, 'utf8');
fs.writeFileSync(join(outDir, 'style.css'), style, 'utf8');

console.log('page', page.length, 'script', script.length, 'style', style.length);
console.log('no raw CR in script:', !script.includes('\r'));
console.log('wrote', outDir);
