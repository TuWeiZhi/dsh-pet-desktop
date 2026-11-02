# patches/ —— 本 fork 相对上游 dsh-pet 0.3.8 的逐条差异

这里放的是**构建产物级的 patch**（`lib/`、`runtime/`、`assets/config.jsonc`），不是上游 TypeScript 源码的 patch：本 fork 不发构建链，改动就是在打包结果上做的（原因见 [`../NOTICE.md`](../NOTICE.md) §2）。

每个 patch 只对应上游 tarball 里的**同一个文件**，路径按包根目录（`-p1` 可直用）。

> `01`–`06` 的基准是**上游 0.3.8**；`07`–`10` 是 **0.4.2 增量**，基准是本仓库 **0.4.1**（即要先应用 `01`–`06`，再用 `07`–`10`）；
> `11`–`12` 是 **0.4.3 增量**，基准是本仓库 **0.4.2**；
> `13` 是 **0.4.4 增量**，基准是本仓库 **0.4.3**。

## 清单

| patch | 目标文件 | 行数 | 改了什么 |
|---|---|---|---|
| `01-assets-config-jsonc.patch` | `assets/config.jsonc` | +31 / −11 | 出厂默认配置：新增 `whisperLines` / `whisperBubbleSec` / `whisperTextScale`，`eventsRefreshSec` 增 `action`，`whisperModel` 标停用、`whisperPrompt` 注释改为"仅对话用" |
| `02-lib-index-js.patch` | `lib/index.js` | +215 / −39 | 宿主半侧：碎碎念改全本地语句池（`WHISPER_LINES_BUILTIN` / `pickWhisperLine` / `publishWhisper`）、按概率出图（`WHISPER_IMAGE_CHANCE`）、`POST /whisper?text=`、新校验器与 `GLOBAL_DEFAULT_KEYS`、调度去掉 `ctx.standaloneAi` 依赖 |
| `03-lib-client-js.patch` | `lib/client.js` | +437 / −40 | 浏览器半侧：可点击收起的气泡、停留时长/文字倍率、动作间隔（`eventsRefreshSec.action`）、`clampPetBox` 全面夹框、`sideAllow` 边距扣减、设置页两张新卡片与全部中英文案；0.4.1 起模块注册 id 改为 `@tuweizhi/dsh-pet` |
| `04-runtime-shared-core-js.patch` | `runtime/electron-helper/shared-core.js` | +6 / −2 | 桌面模式：`anchorPixel` 按 `sideAllow` 扣掉画布左右透明留白，边距只算角色本体 |
| `05-runtime-sprite-js.patch` | `runtime/electron-helper/sprite.js` | +3 / −0 | 桌面模式：把 `sideAllow` 一路传给 `anchorPixel` |
| `06-src-client-index-ts.patch` | `src/client/index.ts` | +3 / −1 | 源码侧同步 0.4.1 的注册 id 修正（`id` 必须等于包名），保持 `src/` 与产物一致 |
| `07-lib-index-js-robustness.patch` | `lib/index.js` | +79 / −12 | 0.4.2 宿主半侧健壮性：配置读取容忍 UTF-16 且解析失败**必须告警**（不再静默回退默认值）、落盘前自动备份（`PUT /config` 与「恢复默认」）、Electron 下载改**多镜像重试**（单次 180s 超时、`DSH_PET_ELECTRON_MIRRORS` 可配） |
| `08-src-host-config-ts.patch` | `src/host/config.ts` | +95 / −11 | 同上第 1、2 项在 TypeScript 源码侧的等价实现（`readJsonc` 多编码解码 + `backupUserConfig`） |
| `09-src-host-helper-process-ts.patch` | `src/host/helper-process.ts` | +40 / −15 | 同上第 3 项（`EnsureElectronOptions.attemptTimeoutMs` / `mirrors`、多镜像 for 循环） |
| `10-src-host-index-ts.patch` | `src/host/index.ts` | +2 / −0 | 同上第 2 项：`PUT /config` 落盘前调用 `backupUserConfig`
| `11-lib-client-js-whisper-surface.patch` | `lib/client.js` | +30 / −12 | 0.4.3 浏览器半侧：设置页「让宠物说这句」与菜单碎碎念的 `surface=web` 改成 `surface=any`（`display=desktop` 时原来被宿主判 `pet-not-displayed`，点了没反应），并把试播结果就近渲染在语句池卡片里（`sayMsg`），不再写到页面顶部的 `msg` |
| `12-runtime-sprite-js-bubble-dismiss.patch` | `runtime/electron-helper/sprite.js` | +88 / −21 | 0.4.3 桌面模式：碎碎念/工作气泡支持**点一下收起**（`bubbleSlot` / `bubbleDismissible` / `dismissBubble`，气泡挂 `is-clickable` 并参与 `syncInputRegions`、`inputBusy`）；隐藏时只摘 `is-on` / `is-clickable`，尺寸类留到下次渲染，避免淡出 0.25s 里字号跳回大号（「收起瞬间气泡短暂变大」） |
| `13-runtime-whisper-prefs.patch` | `runtime/electron-helper/{shared-core,renderer,sprite,events}.js` + `index.html` | +55 / −8 | 0.4.4 桌面模式：设置页「碎碎念停留秒数」与「文字倍率」**在桌面端生效**（此前桌面端完全不读这两个字段，停留永远写死 10s、文字永远 1×）。`whisperDwellMsOf` / `whisperTextScaleOf`、`loadConfig` 带出两字段、`showWhisper` 用 `duration ?? this.whisperDwellMs` 且 0 = 不自动消失、`.pet-bubble.is-whisper` 把 `--f` 乘 `--dsh-pet-whisper-scale`（配图不跟着放大）、窗口上边距按放大后的字号预留（`bubbleMaxHeightOfPx` / `bubbleTopMarginOfPx`） |

## 怎么用

```sh
# 以上游 0.3.8 的 tarball 为基准，在包根目录重放全部改动
npm pack dsh-pet@0.3.8 --pack-destination /tmp
mkdir -p /tmp/up && tar -xzf /tmp/dsh-pet-0.3.8.tgz -C /tmp/up
cd /tmp/up/package
git init -q . && git add -A && git commit -qm base

for p in /path/to/dsh-pet/patches/*.patch; do git apply -p1 "$p" || echo "冲突：$p"; done
```

只重放某一个文件也可以：`git apply -p1 patches/03-lib-client-js.patch`。

## 与上游同步时的锚点

上游若在这些函数里也做了改动，patch 会冲突，按下面的锚点手工合并（都是本 fork 动过的位置）：

- `lib/index.js`
  - `automaticWhisperSchedule(petEnabled, configuredPeriodSec)` —— 旧签名是 `(policy, petEnabled, configuredPeriodSec)`
  - `publishWhisper(petId, forcedText)` —— 旧的 `whisperTick` 里 `await generateWhisper(...)` 那一段被替换
  - `GLOBAL_DEFAULT_KEYS`、`topFieldValid`、`eventsRefreshSecValid`、`saveUserConfig`
  - 路由处理里的 `POST /whisper`（新增 `?text=` 分支）与 `schedule` 构造处
  - 常量 `WHISPER_IMAGE_CHANCE`、`whisperMeme()`、`WHISPER_LINES_BUILTIN`、`pickWhisperLine()`
- `lib/client.js`
  - **末段 `window.__ModuleLoader__.load({ id })`** —— 0.4.1 起 id 必须是包名 `@tuweizhi/dsh-pet`（上游是 `dsh-pet`），改包名时这一行必须跟着改，否则界面侧加载失败
  - `flattenConfigPets`（多带 `whisperBubbleSec` / `whisperTextScale`）
  - `whisperBubbleView` / `bubbleCss` / `makeWhisperBubble`（`onDismiss`、`is-clickable`、`--dsh-pet-whisper-scale`）
  - `throwBounds` / `clampPetBox` / `startThrow` / 拖拽 pointermove & pointerup / `customPos` 渲染
  - `PetCard` 的 `triggerWhisper`（停留 0 的处理）与 `pickNext`（动作间隔）、`PetMulti` 的 `dismissTip` 透传
  - `makePetConfigSection` 的两张新卡片（「自动行为间隔」「碎碎念：语句池与气泡」）与 `zh` / `en` 文案表
- `runtime/electron-helper/shared-core.js`：`anchorPixel` 里 `const left = a.x + o.marginX` 那几行
- `runtime/electron-helper/sprite.js`：调用 `anchorPixel` 时补 `sideAllow`
- `lib/index.js` / `src/host/*.ts`（0.4.2 新增锚点）：
  - `stripJsonc` / `readJsonc`（多编码解码，失败要 `warnOnce`，不能静默返回 undefined）
  - `backupUserConfig`（本 fork 新增函数）与 `syncUserConfigFromDefault`、`PUT /config` 的写盘点
  - `ensureElectronDownload` 整个函数体（多镜像 for 循环、`attemptTimeoutMs`、`DSH_PET_ELECTRON_MIRRORS`）
- `lib/client.js`（0.4.3 新增锚点）：`makePetConfigSection` 里「让宠物说这句」按钮的 whisper URL（`&surface=any&text=`）与 `sayMsg` 就地反馈；菜单碎碎念的 `postAction("/dsh-pet-7340/whisper?…&surface=any")`
- `runtime/electron-helper/sprite.js`（0.4.3 新增锚点）：
  - 新增方法 `bubbleSlot()` / `bubbleDismissible()` / `dismissBubble()`（在 `balanceClickable()` 之后）
  - 气泡 click 监听里的两段分派（余额展开 → 否则收起）
  - `inputBusy()` 追加 `|| this.bubbleDismissible()`
  - `renderBubble()` 开头：`slot === 'none'` 分支必须**先**处理且只摘 `is-on` / `is-clickable`（尺寸类 `is-whisper` / 配图类 / `is-expanded` 留到下次渲染，否则淡出时会「短暂变大」）
- `runtime/electron-helper/*`（0.4.4 新增锚点，共 5 个文件）：
  - `shared-core.js`：新增 `whisperDwellMsOf()` / `whisperTextScaleOf()`（紧跟 `whisperBubbleView` 之后）；`bubbleMaxHeightPx` / `bubbleTopMarginPx` 拆出 `bubbleMaxHeightOfPx(f)` / `bubbleTopMarginOfPx(f, size)` 两个按字号 px 收的变体（原函数改成一行转调，行为不变）
  - `renderer.js`：`loadConfig()` 的返回对象里补 `whisperBubbleSec` / `whisperTextScale`（紧跟 `font` 那一行）
  - `sprite.js`：顶部常量 `WHISPER_FONT_RATIO = 0.7473`（与 `index.html` 的 `.is-whisper` 同值）；构造函数里 `this.whisperScale` / `this.whisperDwellMs` 与 `this.margin.t`（按 `max(正文, 放大后碎碎念)` 字号算）；注入 `--dsh-pet-whisper-scale`
  - `events.js`：`showWhisper` 末尾的定时器段落（`dwellMs = duration ?? this.whisperDwellMs`，`dwellMs > 0` 才挂）
  - `index.html`：`.pet-bubble.is-whisper` 里的 `--f: calc(var(--f0) * var(--dsh-pet-whisper-scale, 1))` 与紧随其后的 `.pet-bubble.is-whisper .pet-bub-img { --m: var(--f0); }`（配图不跟着放大）

改完跑 `npm run verify` —— 它会检查 fork 改动标记（`WHISPER_LINES_BUILTIN`、`dsh-pet-whisper-scale`、`sideAllow` 等）是否还在，防止上游同名文件被整份覆盖回去而不自知。

## 重新生成 patch

```sh
# a/ = 上游解包目录，b/ = 本仓库；逐个文件对比
git -c core.autocrlf=false diff --no-index --no-prefix --output=patches/02-lib-index-js.patch -- a/lib/index.js b/lib/index.js
```

`--no-prefix` 让 patch 头保持 `--- a/lib/index.js` / `+++ b/lib/index.js`，正好是 `-p1` 的形态。

> ⚠️ 用 `--output=` 直接写文件，**不要**用 PowerShell 的 `>` / `Out-File` 重定向：Windows PowerShell 的 `>` 默认写成 **UTF-16LE + CRLF**，`git apply` 会直接报 `error: No valid patches in input (allow with "--allow-empty")`（本仓库 0.4.2–0.4.4 的 `07`–`12` 就踩过这个坑，已改回 UTF-8 无 BOM + LF）。
> 校验一行即可：`file patches/*.patch`（或 `head -c2 patches/*.patch | xxd`）不该看到 `ff fe`，`grep -c $'\r' patches/*.patch` 应为 0。
