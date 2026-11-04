# NOTICE —— 来源、许可与本仓库的改动范围

## 1. 这个仓库是什么

本仓库是基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的 Windows 独立桌面版，使用其代码和桌宠素材，并将运行时改造为 Electron 安装程序。原项目地址：<https://github.com/PC2005-cloud/dsh-pet>。

### 代码许可

- 上游代码：MIT，`Copyright (c) 2026 PC2005-cloud`；完整版权与许可声明见 [`LICENSE`](LICENSE)。
- 本项目及其沿用的改动：`Copyright (c) 2026 TuWeiZhi`。代码的 MIT 许可不改变以下素材及角色形象的许可条件。

### 动画等素材

- 上游作者 PC2005-cloud 在 [v0.3.8 许可说明](https://github.com/PC2005-cloud/dsh-pet/blob/v0.3.8/README.md#许可)中声明：动画、提示词和源视频允许开源使用，**禁止商用**。本项目沿用的上游素材应遵循该说明，不能仅依据代码的 MIT 许可使用。
- 本项目沿用上游桌宠动画等素材；睡觉的三段动画取自上游提交 [`31aa345`](https://github.com/PC2005-cloud/dsh-pet/commit/31aa345b11a18fc16d5fd35c42b8b9441071170e)。本项目新增了便签姿势 `assets/pic/note-holding*.png` 和用户提供的 `assets/webm/便签-*.webm` 动画；这些素材使用了相同的角色形象，仍须遵循下述形象许可。
- 上游要求二次创作的介绍、展示和分发处附上原项目地址：<https://github.com/PC2005-cloud/dsh-pet>。

### 角色形象署名与许可

- 角色为社区二创的 DeepSeek「大肥鱼」（鲸鱼娘），非 DeepSeek 官方形象。原型「溟月」出自 B 站 [@上善无形](https://space.bilibili.com/4456176)；DeepSeek 版女仆鲸鱼娘设计出自 B 站 [@ZipZipPipe](https://space.bilibili.com/4168597)。来源见[上游形象说明](https://github.com/PC2005-cloud/dsh-pet/blob/31aa345b11a18fc16d5fd35c42b8b9441071170e/README.md#许可)。
- 根据上游说明和 [@ZipZipPipe 的声明](https://www.bilibili.com/opus/1247156596114456581)，大肥鱼形象采用 **CC BY-NC-SA 4.0（署名、非商业性使用、相同方式共享）**，不得商用。许可全文见随包附带的 [`CC-BY-NC-SA-4.0.txt`](CC-BY-NC-SA-4.0.txt)，也可查看[许可正文](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.en)和[中文摘要](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans)。
- 分享形象时须保留适当署名及许可链接、标明修改；分享基于该形象的演绎素材时须按相同或兼容许可共享。本项目对上述新增素材中由本项目享有权利的形象演绎贡献按 CC BY-NC-SA 4.0 发布；其他素材权利不因此获得额外授权。该要求针对相关形象及其演绎素材，不能把整套上游动画素材的全部权利简单归为 CC 许可。许可按现状提供，无担保；具体条款以许可正文为准。

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

## 3. 主要桌面版改动

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

此表概述桌面版的主要改动；后续变化及新增的上游睡觉素材见仓库历史。

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
- 宠物/动画/上游功能本身的问题：请到上游
  [`PC2005-cloud/dsh-pet`](https://github.com/PC2005-cloud/dsh-pet) 反馈
