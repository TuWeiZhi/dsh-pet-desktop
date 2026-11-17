import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { adaptHost, adaptUpdates } from './host/adapt.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const web = join(here, 'web');
mkdirSync(web, { recursive: true });
const manifest = [];
function copyDirectory(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const item of readdirSync(source, { withFileTypes: true })) {
    if (item.name === 'note-layers') continue; // Same exclusion as the Electron installer.
    const from = join(source, item.name), to = join(destination, item.name);
    if (item.isDirectory()) copyDirectory(from, to);
    else {
      cpSync(from, to);
      manifest.push({ path: relative(root, from).replaceAll('\\', '/'), bytes: readFileSync(from).length,
        sha256: createHash('sha256').update(readFileSync(from)).digest('hex') });
    }
  }
}
copyDirectory(join(root, 'runtime/electron-helper'), join(web, 'runtime/electron-helper'));
copyDirectory(join(root, 'assets'), join(web, 'assets'));
for (const name of ['LICENSE', 'NOTICE.md', 'CC-BY-NC-SA-4.0.txt']) cpSync(join(root, name), join(web, name));
// The repository's smoke harness uses this same parser for the trusted shipped JSONC.
const config = runInNewContext('(' + readFileSync(join(root, 'assets/config.jsonc'), 'utf8') + ')');
writeFileSync(join(web, 'config.json'), JSON.stringify({ main: config }));
writeFileSync(join(web, 'reuse-manifest.json'), JSON.stringify(manifest, null, 2));
mkdirSync(join(web, 'lib'), { recursive: true });
mkdirSync(join(web, 'host'), { recursive: true });
writeFileSync(join(web, 'lib/standalone.js'), adaptHost(readFileSync(join(root, 'lib/standalone.js'), 'utf8')));
cpSync(join(root, 'lib/package.json'), join(web, 'lib/package.json'));
for (const name of ['helper-adapter.mjs', 'native-services.cjs']) cpSync(join(here, 'host', name), join(web, 'host', name));
writeFileSync(join(web, 'host/desktop-updates.cjs'), adaptUpdates(readFileSync(join(root, 'runtime/electron-helper/desktop-updates.js'), 'utf8')));
const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
const version=JSON.parse(readFileSync(join(here,'package.json'))).version;
if(pkg.version!==version||JSON.parse(readFileSync(join(here,'src-tauri/tauri.conf.json'))).version!==version)throw new Error('Electron, Tauri package and Tauri config versions must match');
pkg.version = version;
delete pkg.build; delete pkg.devDependencies; delete pkg.scripts;
writeFileSync(join(web, 'package.json'), JSON.stringify(pkg, null, 2));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
const modules = resolve(web, 'node_modules');
if (!modules.startsWith(resolve(web) + '\\')) throw new Error('Invalid generated dependency directory');
rmSync(modules, { recursive: true, force: true });
for (const [name, metadata] of Object.entries(lock.packages)) {
  if (!name.startsWith('node_modules/') || metadata.dev) continue;
  cpSync(join(root, name), join(web, name), { recursive: true,
    filter: file => !/\.(?:ts|mts|cts|map)$/.test(file) && !/(?:^|[\\/])(?:test|tests|__tests__)(?:[\\/]|$)/.test(file) });
}
if (process.platform !== 'win32' || process.arch !== 'x64' || process.version !== 'v24.22.1') throw new Error('Build with Windows x64 Node.js v24.22.1');
const expected = readFileSync(join(here,'host/NODE-SHASUMS256.txt'),'utf8').split(/\r?\n/).find(line=>line.endsWith('  win-x64/node.exe'))?.split(' ')[0];
if (createHash('sha256').update(readFileSync(process.execPath)).digest('hex') !== expected) throw new Error('Node runtime does not match the official v24.22.1 checksum');
cpSync(process.execPath, join(web, 'host/node.exe'));
cpSync(join(here,'host/NODE-LICENSE'),join(web,'host/NODE-LICENSE'));
console.log(`Prepared ${manifest.length} original files without modifying their bytes.`);
