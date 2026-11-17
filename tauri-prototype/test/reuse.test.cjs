const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const web = path.resolve(__dirname, '../web');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
test('all renderer and shipped asset bytes match Electron', () => {
  const manifest = JSON.parse(readFileSync(path.join(web, 'reuse-manifest.json')));
  assert.equal(manifest.filter(file => file.path.startsWith('assets/')).length, 163);
  for (const file of manifest) {
    assert.equal(hash(path.join(root, file.path)), file.sha256, file.path + ' source changed');
    assert.equal(hash(path.join(web, file.path)), file.sha256, file.path + ' copied incorrectly');
  }
});
test('original page references resolve in the prototype', () => {
  const page = readFileSync(path.join(web, 'runtime/electron-helper/index.html'), 'utf8');
  const scripts = [...page.matchAll(/<script src="\.\/([^"]+)"/g)].map(match => match[1]);
  const files = readdirSync(path.join(web, 'runtime/electron-helper'));
  assert.ok(scripts.length >= 10);
  for (const script of scripts) assert.ok(files.includes(script), script);
});
