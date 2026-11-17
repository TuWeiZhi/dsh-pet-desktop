const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join, win32 } = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { runInNewContext } = require('node:vm');

// Exercise the source and both shipped bundles: this fork does not rebuild lib/.
for (const file of ['src/host/helper-process.ts', 'lib/standalone.js', 'lib/index.js']) {
  function loadRuntime(env, existingFiles) {
    let source = readFileSync(join(__dirname, '../..', file), 'utf8');
    if (file.endsWith('.ts')) source = stripTypeScriptTypes(source);
    const start = source.indexOf('function resolveElectronPath(');
    const end = source.indexOf('function defaultLaunch(', start);
    assert.ok(start >= 0 && end > start);
    const downloadCalls = [];
    const runtime = runInNewContext(source.slice(start, end).replace(/^export /gm, '') +
      '\n({ resolveElectronPath, ensureElectronDownload })', {
      process: { env, platform: 'win32', arch: 'x64' },
      join: win32.join,
      existsSync: (path) => existingFiles.includes(path),
      require() { throw new Error('No development dependencies in the installer'); },
      mkdirSync() { downloadCalls.push('mkdir'); throw new Error('Downloads disabled in this test'); },
      console: { log() {}, warn() {} },
      AbortController,
      setTimeout() { downloadCalls.push('timer'); return { unref() {} }; },
      clearTimeout() {},
    });
    return { ...runtime, downloadCalls };
  }

  test(file + ': desktop uses its bundled executable without download dependencies', async () => {
    const executable = 'C:\\pet\\dsh-pet.exe';
    const runtime = loadRuntime({ DSH_PET_DESKTOP_APP: '1', DSH_PET_ELECTRON_PATH: executable }, [executable]);
    assert.equal(await runtime.ensureElectronDownload(), executable);
    assert.deepEqual(runtime.downloadCalls, []);
  });

  test(file + ': missing desktop runtime does not trigger a download', async () => {
    const runtime = loadRuntime({ DSH_PET_DESKTOP_APP: '1' }, []);
    assert.equal(await runtime.ensureElectronDownload(), undefined);
    assert.deepEqual(runtime.downloadCalls, []);
  });
}
