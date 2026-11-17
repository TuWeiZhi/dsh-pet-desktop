export function adaptHost(source) {
  function replaceOnce(from, to) {
    if (source.split(from).length !== 2) throw new Error('Host integration point changed: ' + from);
    source = source.replace(from, to);
  }
  replaceOnce('#!/usr/bin/env node', '#!/usr/bin/env node\nimport { withTauriHelper, withRestartBarrier } from "../host/helper-adapter.mjs";');
  replaceOnce('new HelperProcess({', 'new (withTauriHelper(HelperProcess))({');
  replaceOnce('let desktopModeEverActive = false;', 'let desktopModeEverActive = true;');
  replaceOnce('const handlePetRoute = async (rawUrl, method, body, signal) => {',
    'const handlePetRoute = (...args) => withRestartBarrier(args, () => handlePetRouteRaw(...args), () => helper, () => desktopSyncQueue);\n\tconst handlePetRouteRaw = async (rawUrl, method, body, signal) => {');
  return source;
}

export function adaptUpdates(source) {
  if (source.split('`dsh-pet-${version}-setup.exe`').length !== 3 || !source.includes('/update-manifest.json')) {
    throw new Error('Update integration points changed');
  }
  return source.replaceAll('`dsh-pet-${version}-setup.exe`', '`dsh-pet-tauri-${version}-setup.exe`')
    .replaceAll('/update-manifest.json', '/tauri-update-manifest.json');
}
