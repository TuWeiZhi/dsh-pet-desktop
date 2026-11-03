# NOTICE —— 来源、许可与本仓库的改动范围

## 1. 这个仓库是什么

本仓库（`TuWeiZhi/dsh-pet-desktop`）是**桌面宠物 dsh-pet 的 Windows 独立版**：
把插件版的内核（`lib/` `runtime/` `assets/`）原样搬过来，外面套一层 Electron 外壳，
打包成 NSIS 安装程序 —— **不需要安装 DSH，也不需要本机有 Node.js**。

血缘关系：

```
PC2005-cloud/dsh-pet  v0.3.8       上游，MIT
        │  增强 fork（插件形态）
        ▼
TuWeiZhi/dsh-pet      0.4.0–0.4.4  插件版，可装进 DSH 的 profile
        │  独立桌面分支（本仓库）
        ▼
TuWeiZhi/dsh-pet-desktop  0.4.4    Windows 独立安装包
```

许可：

- 上游：MIT，`Copyright (c) 2025 PC2005-cloud`（及 README 中列出的贡献者）
- 插件版 fork 追加的改动：`Copyright (c) 2026 TuWeiZhi`
- 本仓库追加的改动：`Copyright (c) 2026 TuWeiZhi`
- 完整许可全文见 [`LICENSE`](LICENSE)（与上游一致，未改一字）
- 内置桌宠动画等素材继承自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，
  其中睡觉的三段动画取自上游提交 [`31aa345`](https://github.com/PC2005-cloud/dsh-pet/commit/31aa345b11a18fc16d5fd35c42b8b9441071170e)。
  桌面便签姿势 `assets/pic/note-holding*.png` 和用户提供的 `assets/webm/便签-*.webm` 动画为本桌面版新增素材。上游许可见 [`LICENSE`](LICENSE)。

插件形态的详细说明（npm 包名、`cordis.patch.yml` 挂载行、entry id 的取舍、
如何与上游同步）保留在 [`README-PLUGIN.md`](README-PLUGIN.md) 与
[`NOTICE` 的插件版](https://github.com/TuWeiZhi/dsh-pet/blob/main/NOTICE.md) 里。

## 2. 发布的是"构建产物快照"，不是上游构建链

改动落在**打包后的运行时代码**里，而不是上游的 TypeScript 源码：

```
electron/main.js                  ← 本仓库新增：Electron 主进程，角色分发（host / helper）
lib/package.json                  ← 本仓库新增：声明 lib/ 内是 ESM
lib/index.js                      宿主半侧（Cordis 插件；独立版不直接用它）
lib/client.js                     浏览器半侧（overlay 宠物 UI + 设置页；独立版不用）
lib/standalone.js                 独立模式宿主（把宿主半边跑在伪 ctx 上）← 本仓库大量增补
runtime/electron-helper/*.js      桌面模式（透明置顶窗）的 Electron 辅助进程 ← 本仓库有改动
assets/config.jsonc               出厂默认配置
build/icon.ico                    ← 本仓库新增：由 assets/logo.png 生成
```

`src/` 里躺的是**上游 v0.3.8 的 TypeScript 原文**，随仓库发布只为对照与将来移植之用；
**改 `src/` 不会自动生效**，也不会重新构建 `lib/`（本仓库不携带上游的构建链与素材生成链）。
`src/FORK-NOTE.md` 说明这一点，权威改动清单是 [`patches/`](patches/) 与 [`CHANGELOG.md`](CHANGELOG.md)。

## 3. 相对插件版 0.4.4 改动到的文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `electron/main.js` | 新增 | 主进程入口；`DSH_PET_ROLE=helper` 时 `require` 桌宠窗口，否则起宿主子进程 |
| `lib/package.json` | 新增 | `{"type":"module"}`，让打包后的 Node 按 ESM 解析 `standalone.js` |
| `build/icon.ico` | 新增 | 7 个尺寸（16–256），由 `assets/logo.png` 生成 |
| `package.json` | 重写 | 插件清单 → Electron 应用清单；加 electron-builder 的 `build` 段 |
| `lib/standalone.js` | 大量增补 | 碎碎念本地化、`whisperLines`/`whisperBubbleSec`/`whisperTextScale`、`backupUserConfig`、设置页重写、独立版环境变量 |
| `runtime/electron-helper/main.js` | 改动 | `loadFile` 改绝对路径、`userData` 可覆盖、托盘加「AI 设置」「退出桌宠」、query 注入 `settingsMenu` |
| `runtime/electron-helper/sprite.js` | 改动 | 动作间隔（`eventsRefreshSec.action`）、隐藏余额与显示位置菜单项 |
| `runtime/electron-helper/renderer.js` | 改动 | 把 `eventsRefreshSec.action` 换算成毫秒传给 sprite |
| `runtime/electron-helper/constants.js` | 改动 | 从 URL query 读 `settingsMenu`（渲染端拿不到 `process.env`） |

此表记录相对插件版 0.4.4 的主要桌面改动；后续变化及新增的上游睡觉素材见仓库历史。

## 4. 桌面版为什么要有两个进程

宿主半边是纯 Node（HTTP 服务 + 插件逻辑），桌宠窗口是 Chromium。
放进同一个进程会让 Chromium 的消息循环拖慢宿主；更要紧的是
`runtime/electron-helper/host-liveness.js` 靠**管道断开**判断宿主已死 ——
同进程里这个信号不存在，宿主崩了宠物会变成僵尸窗口。

所以：`dsh-pet.exe`（Electron）→ 子进程 `dsh-pet.exe`（`ELECTRON_RUN_AS_NODE=1` 跑
`lib/standalone.js`）→ 子进程 `dsh-pet.exe`（`DSH_PET_ROLE=helper`，桌宠窗口）。
同一个 exe 用环境变量扮演三个角色，安装包里只有一份二进制。

## 5. 反馈

- 桌面版（安装包、设置页、托盘、退出）的问题：提到
  [`TuWeiZhi/dsh-pet-desktop` issues](https://github.com/TuWeiZhi/dsh-pet-desktop/issues)
- 插件版的问题：提到 [`TuWeiZhi/dsh-pet` issues](https://github.com/TuWeiZhi/dsh-pet/issues)
- 宠物/动画/上游功能本身的问题：请到上游
  [`PC2005-cloud/dsh-pet`](https://github.com/PC2005-cloud/dsh-pet) 反馈
