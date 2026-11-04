'use strict';
const updates = require('./desktop-updates.js');

function loginOptions({ isPackaged, execPath, appRoot }) {
  return { name: 'dsh-pet-desktop', path: execPath, args: isPackaged ? [] : ['"' + appRoot + '"'] };
}

function createDesktopControls({ app, dialog, shell, version, appRoot, directory, beforeInstall, quit, resume,
  onChange = () => {}, platform = process.platform, execPath = process.execPath, service = updates,
  setInterval: schedule = setInterval }) {
  const login = loginOptions({ isPackaged: app.isPackaged, execPath, appRoot });
  let phase = 'idle', percent = 0, release = null, installer = null, controller = null, checkFailed = false, updateFailed = false;
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

  async function install() {
    phase = 'installing'; notify();
    let launched = false;
    try {
      // 点击安装时再次校验，未经校验的文件不会启动。
      await service.verifyInstaller(installer, release);
      await beforeInstall();
      const error = await shell.openPath(installer);
      if (error) throw new Error(error);
      launched = true;
      await quit();
    } catch (error) {
      await resume();
      installer = null; phase = launched ? 'launched' : 'idle'; updateFailed = !launched; notify();
      console.error(launched ? '[dsh-pet] 安装程序已启动，请手动退出桌宠后继续安装' : '[dsh-pet] 未能启动更新安装', error);
    }
  }

  async function check() {
    if (!supported || phase !== 'idle') return;
    phase = 'checking'; notify();
    try {
      release = await service.checkRelease(version);
      checkFailed = false; updateFailed = false;
    } catch (error) {
      checkFailed = true;
      console.error('[dsh-pet] 检查更新失败', error);
    } finally {
      phase = 'idle'; notify();
    }
  }

  async function update() {
    if (!supported) return;
    if (phase === 'ready') return install();
    if (phase !== 'idle') return;
    if (!release) return checkFailed ? check() : undefined;
    try {
      updateFailed = false;
      controller = new AbortController();
      phase = 'downloading'; percent = 0; notify();
      installer = await service.downloadRelease(release, directory, {
        signal: controller.signal, onProgress: value => { percent = value; notify(); },
      });
      if (controller.signal.aborted) return;
      phase = 'ready'; notify();
    } catch (error) {
      installer = null;
      if (!controller?.signal.aborted) {
        updateFailed = true;
        console.error('[dsh-pet] 下载更新失败', error);
      }
    } finally {
      controller = null;
      if (phase !== 'ready') phase = 'idle';
      notify();
    }
  }

  function start() {
    if (!supported) return;
    void check();
    schedule(() => void check(), 24 * 60 * 60 * 1000);
  }

  function refresh(menu) {
    const startup = menu.getMenuItemById('launch-at-login');
    if (startup) startup.checked = loginEnabled();
    const update = menu.getMenuItemById('check-updates');
    if (update) {
      update.enabled = supported && (phase === 'ready' || (phase === 'idle' && (Boolean(release) || checkFailed)));
      switch (phase) {
        case 'checking': update.label = '正在检查更新…'; break;
        case 'downloading': update.label = `正在下载更新：${percent}%`; break;
        case 'ready': update.label = `点击安装 v${release.version}…`; break;
        case 'installing': update.label = '正在启动安装…'; break;
        case 'launched': update.label = '安装程序已启动，请手动退出桌宠'; break;
        default:
          if (updateFailed) update.label = '更新失败，点击重试';
          else if (release) update.label = `点击更新（v${release.version}）`;
          else if (checkFailed) update.label = '检查更新失败，点击重试';
          else update.label = `当前版本：v${version}`;
      }
    }
    const cancel = menu.getMenuItemById('cancel-update');
    if (cancel) cancel.visible = phase === 'downloading';
  }

  return {
    items: () => [
      { id: 'launch-at-login', label: '开机自启', type: 'checkbox', enabled: supported, checked: loginEnabled(), click: item => void setStartup(item) },
      { id: 'check-updates', label: `当前版本：v${version}`, enabled: false, click: () => void update() },
      { id: 'cancel-update', label: '取消下载更新', visible: false, click: () => controller?.abort() },
    ],
    refresh, check, update, start, setStartup,
  };
}

module.exports = { loginOptions, createDesktopControls };
