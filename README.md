# dsh-pet 桌面版（独立 exe，不依赖 DSH）

把 [@tuweizhi/dsh-pet](https://github.com/TuWeiZhi/dsh-pet) 插件改造成 **Windows 独立桌面应用**：
双击 exe 就能在桌面上养宠物，不需要安装 DSH，也不需要用户机器上有 Node.js。

<p align="center">
  <a href="https://github.com/TuWeiZhi/dsh-pet-desktop/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/TuWeiZhi/dsh-pet-desktop?label=%E4%B8%8B%E8%BD%BD&color=blue"></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20x64-0078D4">
  <img alt="electron" src="https://img.shields.io/badge/electron-43.3.0-47848F">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/TuWeiZhi/dsh-pet-desktop?color=orange"></a>
  <img alt="fork of" src="https://img.shields.io/badge/based%20on-dsh--pet%200.4.4-informational">
</p>

> **下载**：到 [Releases](https://github.com/TuWeiZhi/dsh-pet-desktop/releases/latest) 下载 `dsh-pet-0.5.0-setup.exe`，双击安装即可。
> 安装包自带 Electron 运行时，安装时无需额外下载运行环境；`%APPDATA%\dsh-pet` 存配置，卸载默认保留。

本仓库是插件版的**独立桌面分支**，与插件仓库 [TuWeiZhi/dsh-pet](https://github.com/TuWeiZhi/dsh-pet) 各自演进：
插件版的原始说明保留在 [README-PLUGIN.md](README-PLUGIN.md)，本文件只讲桌面版。

---

## 一、安装包在哪

从 [Releases](https://github.com/TuWeiZhi/dsh-pet-desktop/releases/latest) 下载：

```
dsh-pet-0.5.0-setup.exe           # Windows x64 安装程序
dsh-pet-0.5.0-setup.exe.blockmap  # 发布附带的增量信息；当前应用内更新下载完整安装包
```

自己构建的产物落在 `dist\`（该目录不入库）：

```
dist\dsh-pet-0.5.0-setup.exe
dist\win-unpacked\                # 免安装目录，调试用
```

安装包内自带 Electron 43.3.0 运行时，**不联网下载**。

### 用户侧行为

| 动作 | 结果 |
| --- | --- |
| 双击安装程序 | 可选安装目录；建桌面快捷方式 + 开始菜单项「dsh-pet 桌面宠物」；安装完自动启动 |
| 启动应用 | 桌面上出现宠物；托盘出现图标 |
| 双击第二次 | 不会起第二套，改为打开「桌宠设置」网页 |
| 托盘图标右键 | 宠物显示/隐藏开关、**AI 设置**、**开机自启**、**检查更新**、**退出桌宠** |
| 开机自启 | 勾选后在 Windows 登录时启动；默认不开启，可取消；卸载时清理本应用的启动项 |
| 检查更新 | 检查本仓库 GitHub Releases，应用内下载 Windows 安装包并校验 SHA-256；下载期间可取消，完成后确认安装或选择稍后；安装前保存便签并退出桌宠 |
| 宠物右键 → 首项 | **AI 设置**（独立版没有 `dsh://` 协议，所以不是"打开软件"） |
| 鼠标悬停宠物 | 约 0.3 秒后举起便签牌；浅蓝实色玻璃观感，遮住头发、露出向上看的眼睛；默认约 10 行，长内容滚动，无字符上限或字符数显示 |
| 便签编辑 | 编辑即时生效；停顿 400 毫秒后合并异步保存，持续输入时每 2 秒触发保存；收起、重载和正常退出前提交剩余草稿，不显示保存成功提示。鼠标离开宠物和便签区域约 0.45 秒后收起，中文组词期间等待选词结束；支持 `Esc` 收起和右键「便签」打开；没有标题栏和关闭按钮 |
| 宠物右键其他项 | 碎碎念、对话、回到初始位置、重放动画、更换形象、更多、重载配置（**没有「查看余额」「显示位置」**） |
| 退出桌宠 | 走 `POST /shutdown` 优雅收尾，不留后台进程 |
| 卸载 | 控制面板「dsh-pet 桌面宠物」；`%APPDATA%\dsh-pet` 默认保留 |

数据目录：`%APPDATA%\dsh-pet\`

```
dsh-pet\
  main-config.jsonc          # 宠物/动画配置（不存在则用包内默认）
  standalone-ai.json         # AI 设置（含 apiKey，仅存本机）
  standalone-runtime.json    # 运行时端口与令牌，退出时删除
  logs\host.log              # 宿主日志，超 2 MB 滚动为 host.log.1
  runtime\                   # 启动器进程的 Electron 数据
  helper-runtime\            # 桌宠 helper 进程的 Electron 数据（旧 Local Storage 便签保留作迁移备份）
    notes\                   # 每只宠物一份 UTF-8 文本便签，异步写入后替换旧文件
    updates\                 # 下载并校验后的更新安装包
```

### 设置页（`http://127.0.0.1:<端口>/standalone-ai/#token=...`）

从宠物右键或托盘「AI 设置」打开。四个区块：

| 区块 | 内容 |
| --- | --- |
| 桌宠外观 | **桌宠名字**（最多 64 字，显示在托盘菜单与气泡提示里）、**大小（宽度 px，120–1600）**、固定在当前位置 |
| 碎碎念与动作 | 开启自动碎碎念、**碎碎念间隔（秒，≥60）**、**动作间隔（秒，0 = 不歇）**、气泡停留（秒，0 = 不自动消失）、文字倍率（0.8–3） |
| 碎碎念语句池 | 一行一条的文本框 + 「共 N 条」+「随机试一条」+「让宠物说这句」；留空则用内置 40 条保底 |
| 模型连接（可选） | 协议 / Base URL / 模型 / 密钥 / 清除密钥 / 启用对话 / 测试连接；**只影响右键「对话」**，碎碎念不调模型、不产生费用 |

页面上**没有**「要设置的桌宠」（独立版只跑一只宠物，不提供多宠物下拉）、「余额功能」「显示位置（仅浏览器/仅桌面/两者都显示/都不显示）」「水平/垂直偏移」——独立版恒显示在桌面，余额功能在独立模式下不可用，保存时 `balanceEnabled` 一律写成 `false`、`display` 一律写成 `desktop`。

保存时会先 `PUT /dsh-pet-7340/config`（改宠物与节奏，落盘前自动备份为 `main-config.jsonc.bak-<时间戳>`），再 `POST /standalone-ai/settings`（改 AI），两段都成功才显示「已保存到本机」。

**访问凭据**：页面地址里的 `#token=...` 是本次运行的一次性令牌（每次启动应用都会重新生成）。脚本会把它顺手存进 `sessionStorage`，所以同一标签页刷新后仍能保存；但**关掉标签页或换浏览器打开就会丢**，此时页面顶部会显示「本次运行的访问凭据已失效……请从托盘图标右键或宠物右键菜单里的「AI 设置」重新打开本页」，保存按钮保持禁用。

---

## 二、和插件版的差别（全部改动清单）

下面记录桌面版入口与打包改动；桌面专属便签在 `runtime/electron-helper/note.js`、`note.css` 中实现，抬眼托举素材为 `assets/pic/note-holding-look-up.png`。默认采用降低透明度的 B 浅蓝玻璃样式，正文覆盖于角色头发前方；通过 `electron tools/note-smoke.cjs --variants` 可生成样式对比图。材质由渐变和描边实现，不会模糊桌面上的其它窗口。网页插件端不显示便签。便签按宠物实例独立保存，不发送给 AI；清除 `helper-runtime` 数据目录会同时清除便签。

### 新增

| 路径 | 作用 |
| --- | --- |
| `electron/main.js` | **唯一** Electron 主进程入口，按 `DSH_PET_ROLE` 分发两个角色（见下） |
| `lib/package.json` | `{"type":"module"}` —— `lib/` 内是 ESM，打包后 Node 需要就近的 type 声明 |
| `build/icon.ico` | 应用图标，由 `assets/logo.png` 生成，含 16/24/32/48/64/128/256 七个尺寸 |

### 改动

| 路径 | 改了什么 |
| --- | --- |
| `package.json` | 插件清单 → Electron 应用清单：`main` 指向 `electron/main.js`，加 `build`（electron-builder NSIS 配置），删掉 `peerDependencies` / `dsh` 字段 / `bin` / `exports` |
| `lib/standalone.js` | ① 新增 `isStandaloneDesktopApp()`；② `launchHelper` 里 `DSH_PET_OPEN_TARGET` 在独立版固定为 `site`（不再试图唤起 `dsh://open`）；③ 追加 `DSH_PET_ROLE` / `DSH_PET_SETTINGS_MENU` / `DSH_PET_HELPER_USER_DATA` 三个环境变量 |
| `runtime/electron-helper/main.js` | ① `loadFile` 改绝对路径（打包后 `app.getAppPath()` 是 `resources/app`，相对路径会 404）；② 支持 `DSH_PET_HELPER_USER_DATA` 覆盖 `userData`（否则与 DSH 插件版抢同一份 Chromium cache）；③ 托盘加「AI 设置」「退出桌宠」；④ query 里注入 `settingsMenu` |
| `runtime/electron-helper/sprite.js` | ① 右键菜单首项文案改由 `constants.js` 的 `SETTINGS_MENU`（从 query 读）决定，不再读 `process.env`（渲染端拿不到）；② `SETTINGS_MENU` 时不再显示「查看余额」和「显示位置」分支；③ 实现**动作间隔**（`eventsRefreshSec.action`）：`handleEnded()` 里给随机动作记账 `actionRestUntil`，`playIdle()` 在休息期内**只播待机**、到点再掷骰（与浏览器端 `pickNext` 的 `gapMs` 同一落点，宠物不会僵在动作最后一帧） |
| `runtime/electron-helper/constants.js` | 新增 `const SETTINGS_MENU = params.get('settingsMenu') === '1';` |
| `runtime/electron-helper/renderer.js` | `loadConfig()` 多返回一个 `actionGapMs`（由新增的 `actionGapOf(merged)` 从 `main.eventsRefreshSec.action` 换算成毫秒） |
| `lib/standalone.js`（设置页与宿主能力） | ① **碎碎念本地化**：新增 `WHISPER_LINES_BUILTIN`（40 条保底）+ `pickWhisperLine`（避开紧邻重复）+ `whisperMeme`，`publishWhisper(petId, forcedText)` 不再调模型；② `automaticWhisperSchedule` 改回 2 参，周期只读 `eventsRefreshSec.whisper`；③ `saveUserConfig` 补 `whisperLines` / `whisperBubbleSec` / `whisperTextScale` 校验与落盘，`eventsRefreshSecValid` 允许 `action = 0`；④ `PUT /config` 落盘前 `backupUserConfig()`；⑤ `readJsonc` 换成多编码版（UTF-16LE/BE + BOM）；⑥ 设置页三块（`settingsPage` / `settingsStyle` / `settingsScript`）整体重写：加「桌宠名字」输入框（取代多宠物下拉）、大小/固定、碎碎念与动作四格、语句池文本框 + 试播按钮，去掉余额与显示位置；令牌改为 `#token=` 优先 + `sessionStorage` 兜底，失效时在表单顶部给出可操作提示 |

### 关键设计

**为什么是两个进程？**

```
dsh-pet.exe（启动器，Electron 主进程）
   └─ dsh-pet.exe --（ELECTRON_RUN_AS_NODE=1）lib/standalone.js     ← 宿主：http 服务 + 配置 + 拉 helper
        └─ dsh-pet.exe（DSH_PET_ROLE=helper）runtime/electron-helper/main.js  ← 桌宠窗口 + 托盘
             └─ renderer（Chromium）
```

- 宿主那半边是**纯 Node**（http 服务、文件读写、子进程）。塞进 Electron 主进程会和 Chromium 消息循环互相拖累。
- 更硬的理由：helper 的「宿主存活探测」（`runtime/electron-helper/host-liveness.js`）靠**管道断开**判定宿主已死。两个进程这条判定才成立。

**为什么 `asar: false`？**

`lib/standalone.js` 用 `import.meta.url` 推导 `packageRoot`，再拼 `assets/`、`runtime/` 做 `fs` 读取。asar 里这些路径 `fs` 不可靠，所以刻意关掉 asar（构建时会警告，属预期）。

**为什么 helper 的 `userData` 要单独一层？**

helper 里 `app.setName('dsh-pet-electron-helper')`，默认 userData 就是 `%APPDATA%\dsh-pet-electron-helper` —— 与 DSH 插件版**同名**。两者同时运行时抢同一份 Chromium disk cache，日志会刷：

```
[ERROR:net\disk_cache\cache_util_win.cc:25] Unable to move the cache: 拒绝访问。 (0x5)
```

所以宿主给 helper 传 `DSH_PET_HELPER_USER_DATA=%APPDATA%\dsh-pet\helper-runtime`。

**为什么「退出」要让宿主去走 `/shutdown`？**

helper 直接 `app.exit(0)` 会被宿主按重试策略重启，"退出"变成"重启"。所以 `requestAppQuit()` 从 `standalone-runtime.json` 里的带令牌 URL 取出 token，POST `/shutdown`，让宿主优雅收尾。

---

## 三、自己构建

前置：Node.js ≥ 20、npm。

```powershell
# 依赖（国内建议挂镜像）
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm install

# 若 electron 的 postinstall 没跑（node_modules\electron\dist 不存在）
node node_modules\electron\install.js

# 开发态直接跑（注意：某些沙箱环境会自带 ELECTRON_RUN_AS_NODE=1，要先删掉）
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npx electron .

# 只打包目录（不生成安装包，调试用）
npm run pack

# 生成 NSIS 安装包
npm run dist
```

产物：`dist\win-unpacked\`（免安装目录）与 `dist\dsh-pet-0.5.0-setup.exe`。

### 静默安装（脚本/自动化用）

```powershell
Start-Process dist\dsh-pet-0.5.0-setup.exe -ArgumentList "/S","/D=C:\path\to\install" -Wait
```

### 自检

```powershell
# 1) 仓库自检：清单、electron-builder 配置、入口文件、语法、设置页片段同步、泄漏
node tools\verify-desktop.mjs

# 2) 以纯 Node 模式跑宿主侧自检，不弹窗
$env:ELECTRON_RUN_AS_NODE = "1"
$env:DSH_HOME = $env:APPDATA
$env:DSH_PET_DESKTOP_APP = "1"
.\node_modules\electron\dist\electron.exe lib\standalone.js --check
```

---

## 四、已验证 / 未验证

**已验证**（Windows 11 25H2，3440×1440，缩放 100%）

- [x] 未打包运行（`npx electron .`）：宠物显示、碎碎念气泡、右键菜单
- [x] NSIS 静默安装 → 启动：8 个进程（启动器/宿主/helper/renderer/GPU 等），`renderer count=1`，日志 0 条 error
- [x] 桌面小窗正常渲染（修复 `ERR_FILE_NOT_FOUND` 后）
- [x] `GET /health` → `{"name":"dsh-pet-standalone","port":3080,...}`
- [x] `GET /standalone-ai/` → 200（设置页 HTML）
- [x] `GET /standalone-ai/settings`（带令牌）→ 200，读写正常，`hasKey` 正确翻转
- [x] `GET /dsh-pet-7340/config` → 200
- [x] 右键菜单首项为「AI 设置」
- [x] 托盘菜单：宠物开关 + AI 设置 + 退出桌宠
- [x] 托盘「退出桌宠」→ 6 秒内进程数归 0，`standalone-runtime.json` 被删除，日志 `收尾（POST /shutdown）… / 已退出。`
- [x] 单实例锁（第二次启动打开设置页）
- [x] helper 数据目录隔离（`%APPDATA%\dsh-pet\helper-runtime`，不再有 disk cache 报错）
- [x] 设置页四个区块全部回填：`size=520 → 480`、`whisperSec=120`、`actionSec=30 → 10`、`bubbleSec=8`、`textScale=1.5`、语句池「共 3 条」、协议显示「OpenAI 兼容」
- [x] 设置页点「保存到本机」→ `main-config.jsonc` 落盘（UTF-8 无 BOM）且生成 `.bak-<时间戳>` 备份，页面提示「已保存到本机。」
- [x] 宠物大小即时生效：改 520→480 后宠物窗口 `1040×837 → 960×773`（= 宽度 × 2 DPR）
- [x] 桌宠名字回填与改名：`蓝毛小女仆 → 蓝毛小女仆2`，保存后 `pets[0].name` 落盘并同步到托盘菜单
- [x] 页面已无「要设置的桌宠」下拉框（HTML 里搜不到 `pet-select`）
- [x] 令牌容错：带 `#token=` 打开全部回填、保存可点；真实刷新后靠 `sessionStorage` 仍可保存；彻底无令牌时顶部显示失效提示且保存禁用
- [x] 语句池保存：加第 4 条后显示「共 4 条」，保存后配置文件 `whisperLines` 为 4 条
- [x] 「随机试一条」→ 提示「抽到：我在这儿哦。」；「让宠物说这句」→ 提示「已让「蓝毛小女仆2」说：…」且宠物气泡显示该句
- [x] 碎碎念本地化：`POST /dsh-pet-7340/whisper?pet=main&surface=any` 连打 4 次返回池内语句且不重复紧邻，**未调用模型**
- [x] 指定句子播报：`&text=这是试播` → `{"ok":true,"text":"这是试播"}`
- [x] 右键菜单已无「查看余额」「显示位置」（只剩 AI 设置 / 碎碎念 / 对话 / 回到初始位置 / 重放动画 / 更换形象 / 更多 / 重载配置）
- [x] **动作间隔生效且不僵死**：`eventsRefreshSec.action = 20` 时日志确认 `arm 20000ms after <动作名>` → 20 秒后 `rest over, roll` 重新掷骰；期间逐帧比对（500 ms × 70 帧）画面持续变化（差值恒 ~1300–2500），**没有停在最后一帧**；`action = 8` 时相邻动作间隔约 15 秒（8 秒歇息 + 动作本身时长）

**未验证**

- [ ] AI 对话 / 碎碎念实际调用（需要真实 API Key，只验证了设置页读写与 `hasKey`）
- [ ] 多显示器 / 高 DPI 下的定位（`dpi-linearization.js` 逻辑原样保留，未在新形态下实测）
- [ ] 代码签名（当前 `no code signing certificate configured`，首次运行 SmartScreen 会拦）
- [x] 托盘检查新版本、应用内下载、SHA-256 校验、确认后启动安装（手动触发，完整安装包更新）

---

## 五、已知限制

- **未签名**：没有代码签名证书，Windows SmartScreen 会提示"未知发布者"。
- **仅 x64**：`win.target.arch = ["x64"]`，未出 arm64 / ia32 包。
- **不联网下载 Electron**：安装包 173 MB 体积主要来自 Electron 运行时 + `assets/webm`（106 个动画，51.8 MB）。
- **AI 能力受限于独立模式**：上游 `standalone` 模式本身就不可用「余额 / 会话工作状态 / DSH 系统通知」，桌面版继承这一限制。
- **`src/` 未同步**：`src/` 是上游 TypeScript 原文，仅供对照（见 `src/FORK-NOTE.md`），改它不生效。本次改动全部落在构建产物与 `electron/`，`src/` 未回写。
- **设置页脚本不能写裸 `\r` `\n`**：`settingsScript` 是宿主里的模板字面量，片段必须把反斜杠写成两个（`\\r?\\n`），否则会被提前解转义、浏览器收到的正则坏掉、整段脚本静默不执行（页面所有字段停在默认值，且不会有任何报错）。三段原文在 `tools/settings-page/`，改完跑 `node tools/settings-page/apply.mjs` 拼回去（脚本已自动双写反斜杠），再用 `node tools/settings-page/extract.mjs` 抽出来 `node --check` 验证。

---

## 六、排障

### 渲染端日志

渲染进程（桌宠小窗）的 `console` 默认**不进**宿主日志（宿主只把 helper 的 stderr 转成日志行）。要排查动画/气泡/动作间隔问题时，给 helper 设环境变量后再启动：

```powershell
$env:DSH_PET_DEBUG_CONSOLE = "1"
```

此时 `runtime/electron-helper/main.js` 会把每个宠物窗口的 `console-message` 用 `console.error` 转发（走 stderr → 宿主日志），于是 `%APPDATA%\dsh-pet\logs\host.log` 里能看到 `[renderer:info] ...` 行。

### 观察宠物是否在动（不靠肉眼）

按 pid 枚举宠物窗口拿真实 rect，再定时截图逐帧比对像素差；差值恒为 0 说明画面冻住了：

```powershell
# 见 tools/sample-frames.ps1：EnumWindows + GetWindowThreadProcessId 过滤 pid
# → GetWindowRect → Graphics.CopyFromScreen → 每 4px 采一点比 ARGB
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\sample-frames.ps1 -Frames 70 -IntervalMs 500 -Label 'action=8'
```

### 常用检查

| 想看什么 | 怎么做 |
| --- | --- |
| 进程拓扑 | `Get-Process dsh-pet`（正常 8 个：启动器/宿主/helper/renderer/GPU/utility） |
| 宿主日志 | `%APPDATA%\dsh-pet\logs\host.log`，超 2 MB 滚动为 `host.log.1` |
| 运行时端口与令牌 | `%APPDATA%\dsh-pet\standalone-runtime.json` |
| 当前生效配置 | `GET http://127.0.0.1:<port>/dsh-pet-7340/config`，带 `x-dsh-pet-token` |
| 退出应用 | 托盘「退出桌宠」，或 `POST /shutdown` 带令牌 |
| 只杀桌面版进程 | `... | Where-Object { $_.CommandLine -match 'dsh-pet-installed|dsh-pet-desktop' }`（**别只 match `dsh-pet`**，会连 DSH 插件版 helper 一起杀掉） |
