# Changelog

本仓库是 [`TuWeiZhi/dsh-pet`](https://github.com/TuWeiZhi/dsh-pet) 插件版的**独立桌面分支**：
同一份 `assets/` `lib/` `runtime/` 内核，外面套一层 Electron 外壳，做成 Windows 独立安装包，不再需要 DSH。

插件版自身的历史（0.4.0 – 0.4.4）见插件仓库的 CHANGELOG；本文件只记桌面分支。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

---

## [0.6.2] —— 便签悬停防误触（2026-11-04）

- 便签拿出动画的悬停触发延迟由 0.32 秒调整为 1 秒，减少鼠标划过宠物时的误触发。
- 鼠标在触发前移开会取消计时，再次进入后重新等待完整 1 秒。

## [0.6.1] —— 翻页体验与等概率动作（2026-11-04）

- 修复固定便签面板遮挡翻页动画；翻页期间保留按钮，动画结束后恢复正文。
- 连续点击按目标页逐页播放，修复动画次数与跳转页数不匹配；关闭便签会取消待播放的翻页请求。
- 前后翻页使用 4 倍速，约 1 秒一页；拿出和收起使用 2 倍速，待机保持原速。
- 桌面自动播放与点击共用常规动作池，每个可用动作等概率抽取，继续遵守固定位置和朝向限制。
- 修复抛掷期间抽中移动动作后动画链可能停住的问题，补充翻页与随机动作回归测试。

## [0.6.0] —— 分页便签与手动睡觉（2026-11-04）

- 桌面便签使用拿出、待机、翻页和收起动画，便签位于人物下方；每页显示五行，支持翻页并显示页码，继续保存原有便签文本。
- 内置宠物可通过右键菜单手动睡觉；点击宠物或选择「起来」唤醒，睡眠期间不展示日常动作和碎碎念。
- README 开头注明桌宠动画等素材继承自 PC2005-cloud/dsh-pet，许可与素材来源见 NOTICE。

## [0.5.0] —— 桌面便签、开机自启与应用内更新（2026-11-03）

### 新增

- 悬停宠物显示可编辑便签：浅蓝玻璃面板约 10 行，长内容滚动，无人为字符上限；移出后自动收起。
- 双手托举、眼睛向上看的专用姿势；便签覆盖在头发前方，不显示标题、关闭按钮、字符数或保存成功提示。
- 连续输入合并后异步保存，支持旧便签自动迁移、写入失败重试、重载与正常退出前保存全部宠物草稿。
- 托盘「开机自启」开关，支持 Windows 登录启动；卸载清理本应用启动项，升级保留设置。
- 托盘「检查更新」：应用内下载 GitHub Releases 安装包、显示进度、支持取消，SHA-256 校验通过并由用户确认后启动安装。

### 验证与升级

- 新增便签、异步存储、自启与更新回归测试；57 项定向测试及 Electron 交互验证通过。
- 约 12 万字符、30 次连续输入合并为 1 次写入；覆盖多窗口重载、退出恢复及校验失败阻止安装。
- `0.4.4` 安装版需手动下载本版安装包升级；`0.5.0` 起可在托盘检查后续更新。
- 安装包未签名，沿用现有发布配置；用户配置和便签默认保留。

## [0.4.4] —— 首个可安装的 Windows 独立版

一句话：**双击安装包就能在桌面上养宠物，不需要装 DSH、不需要本机有 Node.js。**

### 新增 · 独立 exe 外壳

- `electron/main.js`：唯一 Electron 主进程入口，按 `DSH_PET_ROLE` 分发两个角色 ——
  `host`（默认，起 `lib/standalone.js` 宿主半边）与 `helper`（`require` 桌宠窗口）。
  打包后 Electron 不认 argv 里的 app 路径，只能靠环境变量区分。
- `lib/package.json`（`{"type":"module"}`）：`lib/` 内是 ESM，打包后 Node 需要就近的 type 声明。
- `build/icon.ico`：由 `assets/logo.png` 生成，含 16/24/32/48/64/128/256 七个尺寸。
- NSIS 安装程序：可选安装目录、桌面快捷方式、开始菜单项「dsh-pet 桌面宠物」、控制面板卸载项。

### 改动 · 让内核适配独立形态

- `package.json`：插件清单 → Electron 应用清单，加 `build`（electron-builder NSIS 配置），
  删掉 `peerDependencies` / `dsh` 字段 / `bin` / `exports`。
- `lib/standalone.js`：`DSH_PET_OPEN_TARGET` 在独立版固定为 `site`（独立版没有 `dsh://` 协议、
  没有 DSH 主窗口，唤起「打开软件」必然失败）；追加 `DSH_PET_ROLE` / `DSH_PET_SETTINGS_MENU` /
  `DSH_PET_HELPER_USER_DATA` 三个环境变量。
- `runtime/electron-helper/main.js`：① `loadFile` 改绝对路径（打包后 `app.getAppPath()` 是
  `resources/app`，相对路径会 404）；② 支持 `DSH_PET_HELPER_USER_DATA` 覆盖 `userData`
  （否则与 DSH 插件版抢同一份 Chromium cache，日志刷 `Unable to move the cache`）；
  ③ 托盘加「AI 设置」「退出桌宠」；④ query 里注入 `settingsMenu`。
- `runtime/electron-helper/sprite.js`：右键菜单首项文案改由 `constants.js` 从 query 读
  （渲染端拿不到 `process.env`）。

### 新增 · 设置页重写（取代原来的「只有 AI 10 项」）

- 四个区块：**桌宠外观**（名字 / 大小 120–1600 px / 固定在当前位置）、
  **碎碎念与动作**（开关 / 间隔 ≥60s / 动作间隔 0–600s / 气泡停留 0–600s / 文字倍率 0.8–3）、
  **碎碎念语句池**（一行一条 + 共 N 条 + 随机试一条 + 让宠物说这句）、**模型连接（可选）**。
- 去掉「要设置的桌宠」下拉（独立版只跑一只宠物）、「余额功能」、「显示位置（仅浏览器/仅桌面/…）」、
  「水平/垂直偏移」—— 独立版恒显示在桌面，余额功能在独立模式下不可用。
- 访问凭据 `#token=` 改为「hash 优先 + `sessionStorage` 兜底」：原来脚本第一件事就把 hash
  抹掉，用户刷新一次就永久丢失令牌，于是保存按钮永远点不动。

### 修复 · 内核侧，桌面端此前缺失的能力

- **碎碎念本地化**：独立版 `lib/standalone.js` 停留在上游 0.3.8 时代，fork 的本地语句池补丁
  没同步进去 —— 碎碎念仍在调模型、且 `whisperLines` / `whisperBubbleSec` / `whisperTextScale`
  三个字段在它那里**零命中**。现补齐 `WHISPER_LINES_BUILTIN`（40 条保底）、`pickWhisperLine`
  （避开紧邻重复）、`whisperMeme`，`publishWhisper(petId, forcedText)` 不再调模型；
  `automaticWhisperSchedule` 改回 2 参，周期只读 `eventsRefreshSec.whisper`。
- **动作间隔**（`eventsRefreshSec.action`）桌面端此前**没有任何消费者**。现按浏览器端
  `pickNext` 的 `gapMs` 同一落点实现：随机动作播完记账 `actionRestUntil`，
  `playIdle()` 在休息期内**只播待机**、到点再掷骰 —— 宠物不会僵在动作最后一帧。
- `saveUserConfig` 补 `whisperLines` / `whisperBubbleSec` / `whisperTextScale` 的校验与落盘，
  `eventsRefreshSecValid` 允许 `action = 0`（0 = 不歇，此前会被一律拒掉）。
- `PUT /config` 落盘前 `backupUserConfig()`，生成 `main-config.jsonc.bak-<时间戳>`。
- `readJsonc` 换成多编码版（UTF-16LE/BE + BOM），读不出来时给一条 `warnOnce` 而不是静默回退。

### 工具

- `tools/settings-page/`：设置页三段原文（`page.html.txt` / `style.css.txt` / `script.js.txt`）
  + `apply.mjs`（拼回 `lib/standalone.js`，自动双写反斜杠）+ `extract.mjs`（抽出来 `node --check`）。
- `tools/sample-frames.ps1`：按 pid 枚举宠物窗口逐帧比对像素差，用来判断「画面是不是冻住了」。
