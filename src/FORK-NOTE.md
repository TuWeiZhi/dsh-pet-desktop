# src/ 说明：这里是**上游的 TypeScript 原文**，不是本 fork 的构建源

## 一句话

`src/` 原样保留上游 [`PC2005-cloud/dsh-pet`](https://github.com/PC2005-cloud/dsh-pet) v0.3.8 的 TypeScript 源码，**仅供对照与将来移植**。
实际发布、也实际被 DSH 加载的是**打包产物**：

```
lib/index.js         ← 宿主半侧（Cordis 插件）
lib/client.js        ← 浏览器半侧（overlay 宠物 UI + 设置页）
lib/standalone.js    ← 独立模式 CLI
runtime/electron-helper/*.js  ← 桌面模式辅助进程
assets/config.jsonc  ← 出厂默认配置
```

**改 `src/` 不会生效**：本 fork 没有携带上游的构建链（打包 + 素材生成 + 97 个透明动画的转码流水线一律没有），也没有把 `src/` 重新编译进 `lib/`。想核对该改哪几个产物文件，看 [`../patches/`](../patches/) 与 [`../CHANGELOG.md`](../CHANGELOG.md)。

## 那为什么还留着 src/？

1. **可读性**：`lib/*.js` 是打包后的产物（几万行、变量被重命名），要理解某个行为"本来是怎么设计的"，读 `src/` 快得多。
2. **移植路线图**：如果将来要回到"改 TypeScript → 重新构建"的正路，需要把本 fork 的改动按文件对应回 `src/`：
   - `src/host/**` ↔ `lib/index.js`
   - `src/client/**` ↔ `lib/client.js`
   - `src/standalone/**` ↔ `lib/standalone.js`
   - 桌面模式的 Electron 辅助进程源码不在本包内（上游用独立构建），只有产物 `runtime/electron-helper/`
3. **许可与出处**：源码随包发布也是上游 MIT 许可下的正常分发形态，出处声明见 [`../NOTICE.md`](../NOTICE.md)。

## 对照本 fork 的改动时看哪里

| 想找的改动 | 产物位置 | 上游源码里大致对应 |
|---|---|---|
| 碎碎念本地语句池、`POST /whisper?text=` | `lib/index.js` | `src/host/` 里的 whisper 调度与路由 |
| 可点击收起的气泡、停留/倍率、动作间隔、夹框 | `lib/client.js` | `src/client/` 里的 overlay 与设置页 |
| 贴角只算角色本体（桌面模式） | `runtime/electron-helper/shared-core.js`、`sprite.js` | 上游桌面辅助进程（源码不在本包） |

> 提醒：`lib/` 里的注释是**中文**、写的是"为什么这么改"；`src/` 是上游原文，没有本 fork 的注释。两者对不上是正常的，产物才是唯一事实。
