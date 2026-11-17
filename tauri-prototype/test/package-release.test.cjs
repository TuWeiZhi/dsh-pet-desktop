const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

test('release packaging works without a locally staged target/release/web directory', () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'dsh-pet-package-test-'));
  const here = path.join(root, 'tauri-prototype');
  const version = '0.7.8';
  const hash = data => createHash('sha256').update(data).digest('hex');
  function write(file, data) {
    const target = path.join(here, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  try {
    write('package-release.mjs', fs.readFileSync(path.join(__dirname, '../package-release.mjs')));
    write('package.json', JSON.stringify({ version }));
    write(`src-tauri/target/release/bundle/nsis/dsh-pet-tauri_${version}_x64-setup.exe`, 'installer fixture');
    write('src-tauri/target/release/dsh-pet-tauri.exe', 'native fixture');
    write('web/host/node.exe', 'node fixture');
    write('web/assets/pet.webp', 'asset fixture');
    write('web/reuse-manifest.json', JSON.stringify([{ path: 'assets/pet.webp', sha256: hash('asset fixture') }]));
    const result = spawnSync(process.execPath, [path.join(here, 'package-release.mjs')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const output = path.join(root, 'dist/tauri-full');
    assert.equal(fs.readFileSync(path.join(output, 'portable/web/host/node.exe'), 'utf8'), 'node fixture');
    assert.equal(fs.readFileSync(path.join(output, 'portable/web/assets/pet.webp'), 'utf8'), 'asset fixture');
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'tauri-update-manifest.json')));
    assert.deepEqual(manifest, { version, size: Buffer.byteLength('installer fixture'), sha256: hash('installer fixture') });
    const report = JSON.parse(fs.readFileSync(path.join(output, 'build-report.json')));
    assert.equal(report.reusedAssets, 1);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
