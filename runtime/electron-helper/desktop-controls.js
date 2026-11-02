'use strict';
const updates = require('./desktop-updates.js');

function loginOptions({ isPackaged, execPath, appRoot }) {
  return { name: 'dsh-pet-desktop', path: execPath, args: isPackaged ? [] : ['"' + appRoot + '"'] };
}

function createDesktopControls({ app, dialog, shell, version, appRoot, directory, beforeInstall, quit, resume,
  onChange = () => {}, platform = process.platform, execPath = process.execPath, service = updates }) {
  const login = loginOptions({ isPackaged: app.isPackaged, execPath, appRoot });
  let phase = 'idle', percent = 0, release = null, installer = null, controller = null;
  const supported = platform === 'win32';
  const notify = () => onChange();
  const errorDialog = (message, error) => dialog.showMessageBox({ type: 'error', title: 'dsh-pet', message, detail: error.message || String(error), buttons: ['知道了'] });

  function loginEnabled() {
    if (!supported) return false;
    const state = app.getLoginItemSettings({ path: login.path, args: login.args });
    // openAtLogin 只检查默认 AppUserModelID；自定义 Run 项从用户级 launchItems 读取。
    const entry = state.launchItems?.find(item => item.name === login.name && item.scope === 'user');
    return entry?.enabled === true;
  }

  async function setStartup(item) {
    const wanted = item.checked;
    try {
      app.setLoginItemSettings({ ...login, openAtLogin: wanted, enabled: wanted });
      item.checked = loginEnabled();
      if (item.checked !== wanted) throw new Error('系统未应用此设置，请在 Windows 启动应用设置中检查。');
    } catch (error) {
      item.checked = !wanted;
      await errorDialog('开机自启设置失败', error);
    }
  }

  async function installPrompt() {
    phase = 'confirming'; notify();
    const answer = await dialog.showMessageBox({
      type: 'question', title: '安装更新', message: `v${release.version} 已下载完成`,
      detail: '确认后将保存便签、退出桌宠，并启动安装程序。',
      buttons: ['立即安装', '稍后'], defaultId: 1, cancelId: 1,
    });
    if (answer.response !== 0) { phase = 'ready'; notify(); return; }
    phase = 'installing'; notify();
    let launched = false;
    try {
      // “稍后”返回后仍会再次校验，未经校验的文件不会启动。
      await service.verifyInstaller(installer, release);
      await beforeInstall();
      const error = await shell.openPath(installer);
      if (error) throw new Error(error);
      launched = true;
      await quit();
    } catch (error) {
      await resume();
      installer = null; release = null; phase = 'idle'; notify();
      await errorDialog(launched ? '安装程序已启动，请手动退出桌宠后继续安装' : '未能启动更新安装', error);
    }
  }

  async function check() {
    if (!supported || (phase !== 'idle' && phase !== 'ready')) return;
    if (phase === 'ready') return installPrompt();
    phase = 'checking'; notify();
    try {
      release = await service.checkRelease(version);
      if (!release) {
        await dialog.showMessageBox({ type: 'info', title: '检查更新', message: '当前已是最新版本', detail: `当前版本：v${version}`, buttons: ['知道了'] });
        return;
      }
      const answer = await dialog.showMessageBox({
        type: 'question', title: '发现新版本', message: `发现 v${release.version}`,
        detail: `当前版本：v${version}\n安装包约 ${(release.size / 1024 / 1024).toFixed(1)} MB。下载完成后再确认安装。`,
        buttons: ['下载更新', '取消'], defaultId: 0, cancelId: 1,
      });
      if (answer.response !== 0) return;
      controller = new AbortController();
      phase = 'downloading'; percent = 0; notify();
      installer = await service.downloadRelease(release, directory, {
        signal: controller.signal, onProgress: value => { percent = value; notify(); },
      });
      if (controller.signal.aborted) return;
      phase = 'ready'; notify();
      await installPrompt();
    } catch (error) {
      installer = null; release = null; phase = 'idle';
      if (!controller?.signal.aborted) await errorDialog('检查或下载更新失败', error);
    } finally {
      controller = null;
      if (phase !== 'ready' && phase !== 'installing') phase = 'idle';
      notify();
    }
  }

  function refresh(menu) {
    const startup = menu.getMenuItemById('launch-at-login');
    if (startup) startup.checked = loginEnabled();
    const update = menu.getMenuItemById('check-updates');
    if (update) {
      update.enabled = supported && (phase === 'idle' || phase === 'ready');
      switch (phase) {
        case 'checking': update.label = '正在检查更新…'; break;
        case 'downloading': update.label = `正在下载更新：${percent}%`; break;
        case 'ready': update.label = `安装新版本 v${release.version}…`; break;
        case 'confirming': update.label = '等待确认安装…'; break;
        case 'installing': update.label = '正在启动安装…'; break;
        default: update.label = '检查更新…';
      }
    }
    const cancel = menu.getMenuItemById('cancel-update');
    if (cancel) cancel.visible = phase === 'downloading';
  }

  return {
    items: () => [
      { id: 'launch-at-login', label: '开机自启', type: 'checkbox', enabled: supported, checked: loginEnabled(), click: item => void setStartup(item) },
      { id: 'check-updates', label: '检查更新…', enabled: supported, click: () => void check() },
      { id: 'cancel-update', label: '取消下载更新', visible: false, click: () => controller?.abort() },
    ],
    refresh, check, setStartup,
  };
}

module.exports = { loginOptions, createDesktopControls };
