# Tauri 完整桌面版

本目录沿用原型目录名。应用采用 **Tauri 启动器 → 随包 Node 宿主 → Tauri 桌宠窗口**，与原版启动器/宿主/helper 分层对应。系统 WebView2 负责绘制，用户无需安装 Node。

现有桌宠页面、JS、CSS、字体和 163 个发布素材按字节复用。设置页面、OpenAI/Anthropic SDK、模型发现、对话记忆、碎碎念和配置合并由原 `lib/standalone.js` 执行。睡觉/唤醒、便签动画和拖拽物理逻辑不改。Tauri 适配窗口、穿透、多宠物广播、显示器几何、托盘、自启和更新安装。

## 数据与兼容

继续使用原型的内部应用标识 `com.tuweizhi.dshpet.tauri-prototype`，保留原型便签。应用数据目录下：`notes/` 保存便签，`dsh-pet/` 保存配置、AI 设置和记忆，`webview/` 保存 WebView2 缓存。它与 Electron 的 `%APPDATA%/dsh-pet` 独立，不自动读取或覆盖 Electron 密钥和配置。

设置仍在系统浏览器打开原设置页，沿用运行令牌及鉴权。余额和 DSH 会话工作状态仍保持原独立版的不可用语义。

`host/adapt.mjs` 在构建时产生窗口生命周期适配副本，不修改原宿主文件：配置/显示/重载前保存全部便签，失败取消操作；异步响应绑定发起请求的 helper，丢弃旧进程迟到消息；全部宠物隐藏后保留托盘入口。

更新复用原网络与摘要校验代码，选择 `dsh-pet-tauri-<版本>-setup.exe` 和 `tauri-update-manifest.json`，不接受 Electron 包。下载可取消，安装前重新校验并保存便签。正常卸载清理本应用自启项，升级保留自启和数据。真实线上升级需要对应版本已发布，本地构建不会自动发布。

## 构建

需要 Windows x64、Node.js **24.22.1**、Rust MSVC 和 Visual Studio C++ 构建工具。随包 Node 会核对官方校验和并附许可证。

```powershell
# 仓库根目录
npm ci
cd tauri-prototype
npm ci
npm run build
npm run package:release
```

交付文件在 `../dist/tauri-full/`：安装程序、独立更新清单、体积/哈希报告和 `portable/` 免安装目录。免安装运行必须保留 exe 旁完整的 `web/`。系统 WebView2 不计入安装包体积，缺少时安装器联网补装。

不要编辑生成的 `web/`。`prepare.mjs` 复制原文件、裁剪依赖的开发文件，并记录 `reuse-manifest.json`。构建检查应用和 Tauri 配置版本一致。

## 验证

```powershell
npm run prepare:frontend
npm test
cargo test --manifest-path src-tauri/Cargo.toml --offline
```

测试包括文件哈希、便签保存屏障、迟到响应、更新渠道/摘要/取消，以及隔离注册表下的自启状态。`test/full-smoke.mjs` 对隔离运行版本执行设置、AI、便签、多窗口端到端检查，只调用本地模拟 AI 服务。

调试时用 `DSH_PET_TAURI_DATA_DIR` 指定隔离目录，`DSH_PET_TAURI_DEBUG_PORT` 开启本机 WebView2 测试端口；正常启动不需要。自动化测试不使用真实 API 密钥或实际自启项。

原生按下/移动/松手、穿透和便签交互用 Windows Computer Use 观察。其拖动指令是瞬时位移；持续拖动手感、不同 DPI 的屏幕切换及真实发布后的升级仍需实机验收。证据在忽略入库的 `evidence/`，不随安装包发布。

### 0.7.7 本地验收（2026-11-17）

- Windows x64 NSIS 安装包：**97,824,138 字节（97.82 MB / 93.29 MiB）**；对比最初 Electron 的 191,676,440 字节减少 **48.96%**。完整便携目录为 184,880,389 字节，含 Node；系统 WebView2 另计。
- 安装包 SHA-256：`bf4907b7691657f7b4d9bc1d3d1dd41a779739fce36804f865fea9f4a2e84d38`。交付便携程序与实际测试的 release 程序 SHA-256 相同：`7b9ed551d3583f930f20d4865f4f73a65eed230c3d87d43dd4c1af6958ccf095`。
- 11 项 JavaScript、8 项 Rust 测试通过；原项目回归 273 项通过、1 项平台跳过，桌面自检通过。原前端及发布文件 187 个（含 163 个素材）哈希一致。
- 最终便携版本通过鉴权、配置保存/重载、写盘失败保留草稿、模拟 OpenAI/Anthropic 模型发现/连接/对话/记忆/取消、多窗口便签保存检查。不使用真实 AI 密钥。
- 原生 Alt+F4 验证窗口数量 `2 → 1 → 0`，关闭单窗不退出宿主；关闭最后一个窗口保留托盘服务，保存配置后能恢复。全部隐藏后冷启动保留托盘，显示路由能恢复宠物及便签。显式退出结束宿主及启动器。
- 独立代码复审通过。安装、自动更新链路已验证构建产物、渠道选择、校验/取消及安装命令；尚未执行真实线上升级，不能据此声称线上升级已验收。

本次收尾结论保存在本节及对应测试中，临时工作游标已移除；无新增 lesson。
