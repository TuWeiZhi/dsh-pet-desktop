'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const REPOSITORY = 'TuWeiZhi/dsh-pet-desktop';
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;

function versionParts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error('无法识别版本号');
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('无法识别版本号');
  return parts;
}

function newerVersion(latest, current) {
  const a = versionParts(latest), b = versionParts(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function selectRelease(release, current) {
  if (!release || release.draft || release.prerelease) return null;
  if (!newerVersion(release.tag_name, current)) return null;
  const version = versionParts(release.tag_name).join('.');
  const name = `dsh-pet-${version}-setup.exe`;
  const asset = release.assets?.find(item => item.name === name);
  if (!asset) throw new Error('该版本尚未提供 Windows 安装包');
  const expectedUrl = `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(release.tag_name)}/${name}`;
  if (asset.browser_download_url !== expectedUrl) throw new Error('更新安装包来源不匹配');
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || '');
  if (!digest || !Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error('更新安装包缺少有效校验信息');
  return { version, name, url: expectedUrl, size: asset.size, sha256: digest[1].toLowerCase() };
}

async function checkRelease(current, fetcher = globalThis.fetch) {
  const response = await fetcher(RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-pet/' + current },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) throw new Error('尚未找到已发布的版本');
  if (!response.ok) throw new Error('检查更新失败：HTTP ' + response.status);
  return selectRelease(await response.json(), current);
}

async function verifyInstaller(file, release) {
  const stat = await fs.stat(file);
  if (stat.size !== release.size) throw new Error('安装包校验失败：文件大小不符');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== release.sha256) throw new Error('安装包校验失败：SHA-256 不符');
}

async function downloadRelease(release, directory, { fetch: fetcher = globalThis.fetch, signal, onProgress = () => {} } = {}) {
  await fs.mkdir(directory, { recursive: true });
  const partial = path.join(directory, randomUUID() + '.part');
  const file = path.join(directory, release.name);
  try {
    signal?.throwIfAborted();
    const response = await fetcher(release.url, { signal });
    if (!response.ok || !response.body) throw new Error('下载安装包失败：HTTP ' + response.status);
    const final = new URL(response.url);
    if (final.protocol !== 'https:' || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(final.hostname)) {
      throw new Error('安装包下载重定向来源不可信');
    }
    let received = 0, lastPercent = -1;
    const progress = new Transform({ transform(chunk, encoding, done) {
      received += chunk.length;
      if (received > release.size) return done(new Error('安装包校验失败：下载大小超出发布信息'));
      const percent = Math.floor(received / release.size * 100);
      if (percent !== lastPercent) { lastPercent = percent; onProgress(percent); }
      done(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial, { flags: 'wx' }), { signal });
    await verifyInstaller(partial, release);
    signal?.throwIfAborted();
    await fs.rename(partial, file);
    return file;
  } catch (error) {
    await fs.rm(partial, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = { newerVersion, selectRelease, checkRelease, downloadRelease, verifyInstaller };
