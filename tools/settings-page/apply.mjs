// 把 page.html.txt / style.css.txt / script.js.txt 三段原文拼回 lib/standalone.js 的
// settingsPage / settingsStyle / settingsScript 三个模板字面量里。
//
// 为什么要这么绕：这三块是**宿主里的模板字面量**，浏览器实际拿到的是「模板求值后」的文本。
// 片段里任何 `\r` `\n` `\t` 都会在宿主求值时被解转义，于是浏览器收到的 JS 会坏掉
// （曾经踩过：`split(/\r?\n/)` 变成真换行 → `SyntaxError: Invalid regular expression`，
// 整段脚本静默不执行，页面所有字段停在 HTML 默认值，且控制台没有任何报错）。
// 所以下面必须把每个反斜杠写成两个（esc()），片段本身按「浏览器看到的原文」写即可。
//
// 用法：node tools/settings-page/apply.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const target = join(root, 'lib', 'standalone.js');

const src = readFileSync(target, 'utf8');
const page = readFileSync(join(here, 'page.html.txt'), 'utf8');
const style = readFileSync(join(here, 'style.css.txt'), 'utf8');
const script = readFileSync(join(here, 'script.js.txt'), 'utf8');

for (const [name, text] of [['page', page], ['style', style], ['script', script]]) {
  if (text.includes('`')) throw new Error(name + ' 含反引号，会破坏模板字面量');
  if (text.includes('${')) throw new Error(name + ' 含 ${，会破坏模板字面量');
}

// 片段是「浏览器实际拿到的原文」，要放进模板字面量，所以反斜杠必须双写。
const esc = (text) => text.replace(/\\/g, '\\\\');

const PAGE_OPEN = 'const settingsPage = `';
const STYLE_OPEN = 'const settingsStyle = `';
const SCRIPT_OPEN = 'const settingsScript = `';
const CLOSE = '`;';

function region(openText, from, label) {
  const open = src.indexOf(openText, from);
  if (open < 0) throw new Error(label + ' 开始标记没找到');
  const bodyStart = open + openText.length;
  const close = src.indexOf(CLOSE, bodyStart);
  if (close < 0) throw new Error(label + ' 结束标记没找到');
  return { open, bodyStart, close };
}

const pageR = region(PAGE_OPEN, 0, 'page');
const styleR = region(STYLE_OPEN, pageR.close, 'style');
const scriptR = region(SCRIPT_OPEN, styleR.close, 'script');

const out =
  src.slice(0, pageR.bodyStart) + '\n' + esc(page) +
  src.slice(pageR.close, styleR.bodyStart) + '\n' + esc(style) +
  src.slice(styleR.close, scriptR.bodyStart) + '\n' + esc(script) +
  src.slice(scriptR.close);

writeFileSync(target, out, 'utf8');
console.log('ok, bytes', Buffer.byteLength(out));
