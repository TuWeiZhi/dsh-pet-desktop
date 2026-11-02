'use strict';

/**
 * dsh-pet 桌面版 —— Electron 入口（进程角色分发）
 *
 * 本文件是整个 exe 的**唯一** Electron 主进程入口，按 DSH_PET_ROLE 分成两个角色：
 *
 *   1. host（默认）：启动器。不开任何窗口，只做四件事：
 *        · 单实例锁（第二次双击不再起一套宠物）
 *        · 把「宿主半边」lib/standalone.js 作为**纯 Node 子进程**拉起
 *          （同一个 exe + ELECTRON_RUN_AS_NODE=1，不需要另装 Node）
 *        · 把子进程 stdout/stderr 落到 %APPDATA%\dsh-pet\logs\host.log
 *        · 子进程退出 → 自己退出（用户关掉桌宠时不留后台孤儿）
 *
 *   2. helper（DSH_PET_ROLE=helper）：桌宠进程。宿主 lib/standalone.js 里
 *      HelperProcess 用 `spawn(process.execPath, [runtime/electron-helper/main.js])`
 *      拉起它；打包后 Electron 不认 argv 里的 app 路径，所以靠这个环境变量
 *      直接把本进程交给 runtime/electron-helper/main.js 接管（透明置顶窗口 + 托盘）。
 *
 * 为什么宿主不直接跑在本进程里：宿主那半边是纯 Node（http 服务 + 文件 + 子进程），
 * 放在 Electron 主进程里会和 Chromium 的消息循环互相拖累；更重要的是 helper 的
 * 「宿主存活探测」（runtime/electron-helper/host-liveness.js）依赖**管道断开**判定
 * 宿主已死 —— 分开两个进程，这条判定才成立。
 */

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const HELPER_MAIN = path.join(APP_ROOT, 'runtime', 'electron-helper', 'main.js');
const HOST_ENTRY = path.join(APP_ROOT, 'lib', 'standalone.js');

// ─────────────────────────────────────────────────────────────
// 角色 2：桌宠 helper —— 立刻把控制权交给上游 runtime，本文件不再做任何事
// ─────────────────────────────────────────────────────────────
if (process.env.DSH_PET_ROLE === 'helper') {
  require(HELPER_MAIN);
  // CJS 模块顶层 return：module wrapper 内合法，等价于"到此为止"
  return;
}

// ─────────────────────────────────────────────────────────────
// 角色 1：启动器
// ─────────────────────────────────────────────────────────────
const { app, shell, dialog } = require('electron');

app.setName('dsh-pet');

/** %APPDATA% —— 桌面版的数据根（宿主侧 DSH_HOME 指向它，于是配置落在 %APPDATA%\dsh-pet\） */
const DATA_HOME = app.getPath('appData');
/** %APPDATA%\dsh-pet —— 用户配置 / 宠物资源 / 日志 */
const DATA_DIR = path.join(DATA_HOME, 'dsh-pet');
/** Electron 自己的 Cache/GPUCache/Local Storage 单独一层，别和宠物配置混在一起 */
const ELECTRON_RUNTIME_DIR = path.join(DATA_DIR, 'runtime');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'host.log');
const RUNTIME_FILE = path.join(DATA_DIR, 'standalone-runtime.json');
const LOG_MAX_BYTES = 2 * 1024 * 1024;

for (const dir of [DATA_DIR, ELECTRON_RUNTIME_DIR, LOG_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* 权限异常留给后面 spawn 失败时统一报错 */
  }
}
app.setPath('userData', ELECTRON_RUNTIME_DIR);
app.setPath('sessionData', ELECTRON_RUNTIME_DIR);

/** 只保留最近一份日志：超过上限就滚动一次，避免长期挂机把磁盘写满 */
function rollLog() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > LOG_MAX_BYTES) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    /* 文件不存在 = 第一次写 */
  }
}

function logLine(stream, chunk) {
  const text = String(chunk);
  if (!text) return;
  process.stdout.write(text);
  try {
    fs.appendFileSync(LOG_FILE, text);
  } catch {
    /* 日志写不进去不能影响桌宠本体 */
  }
  void stream;
}

/** 双击第二次：把 AI 设置页翻出来（宿主把带令牌的地址写在 standalone-runtime.json 里） */
function openSettingsPage() {
  try {
    const info = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
    if (typeof info.settingsUrl === 'string' && info.settingsUrl) {
      void shell.openExternal(info.settingsUrl);
      return true;
    }
  } catch {
    /* 宿主还没起来 / 文件已被清理 */
  }
  return false;
}

// 单实例：桌宠只能是"一套"。第二个实例把启动权交回去，顺手打开设置页。
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

app.on('second-instance', () => {
  openSettingsPage();
});

// 这个进程没有窗口，不能让 Electron 因为"窗口全关"就退；退出只由宿主子进程决定。
app.on('window-all-closed', () => {});

rollLog();

let child = null;
let quitting = false;

function killChild() {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill();
  } catch {
    /* 已经没了 */
  }
}

function startHost() {
  const env = {
    ...process.env,
    // 同一个 exe 以「纯 Node」身份跑宿主脚本：不需要用户机器上装 Node
    ELECTRON_RUN_AS_NODE: '1',
    // 宿主侧 dshHomeDir() 读它 → 配置/宠物/日志全部落在 %APPDATA%\dsh-pet\
    DSH_HOME: DATA_HOME,
    // 宿主拉起 helper 时用这个可执行文件（打包后就是本 exe）
    DSH_PET_ELECTRON_PATH: process.execPath,
    // 本进程是宿主，不是 helper
    DSH_PET_ROLE: 'host',
    // 别把 ELECTRON_RUN_AS_NODE 漏给 helper：helperSpawnEnv 也会删，这里双保险
    DSH_PET_DESKTOP_APP: '1',
  };
  delete env.NODE_OPTIONS;

  child = spawn(process.execPath, [HOST_ENTRY], {
    cwd: DATA_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => logLine('out', chunk));
  child.stderr?.on('data', (chunk) => logLine('err', chunk));

  child.on('error', (error) => {
    logLine('err', `[dsh-pet] 宿主进程启动失败：${error && error.message ? error.message : error}\n`);
    if (!quitting) {
      dialog.showErrorBox(
        'dsh-pet 启动失败',
        `无法启动桌宠服务：\n${error && error.message ? error.message : error}\n\n日志：${LOG_FILE}`,
      );
      app.quit();
    }
  });

  child.on('exit', (code, signal) => {
    logLine('out', `[dsh-pet] 宿主已退出（code=${code} signal=${signal}）\n`);
    child = null;
    if (!quitting) app.quit();
  });
}

app.on('before-quit', () => {
  quitting = true;
  killChild();
});

// 用户注销 / 关机时也要把子进程带走
process.on('exit', killChild);
process.on('SIGINT', () => {
  killChild();
  app.exit(0);
});
process.on('SIGTERM', () => {
  killChild();
  app.exit(0);
});

app.whenReady().then(() => {
  startHost();
}).catch((error) => {
  dialog.showErrorBox('dsh-pet 启动失败', String((error && error.message) || error));
  app.quit();
});
