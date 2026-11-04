'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash } = require('node:crypto');

async function writeUpdateManifest(directory, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  const installer = path.join(directory, `dsh-pet-${version}-setup.exe`);
  const stat = await fs.stat(installer);
  if (!stat.isFile() || stat.size <= 0) throw new Error('Installer is empty or missing');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(installer)) hash.update(chunk);
  const manifest = { version, size: stat.size, sha256: hash.digest('hex') };
  await fs.writeFile(path.join(directory, 'update-manifest.json'), JSON.stringify(manifest) + '\n');
  return manifest;
}

if (require.main === module) {
  const version = require('../package.json').version;
  if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== `v${version}`) {
    throw new Error('Release tag does not match package version');
  }
  writeUpdateManifest(path.join(__dirname, '..', 'dist'), version).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { writeUpdateManifest };
