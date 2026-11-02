// client 半侧 bundle 外壳：由 tsdown 构建为 lib/client.js。
// 必须是一个「普通副作用脚本」——加载时调用 window.__ModuleLoader__.load，
// 不能包含顶层 ESM export / import（react 由 factory 的 require 取得）。
import { makeFactory } from './app';

declare const window: {
  __ModuleLoader__: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH 全局注入的模块系统契约（f(require) => module）
    load(info: { id: string; factory: (require: (m: string) => any) => any }): void;
  };
};

window.__ModuleLoader__.load({
  // 必须与 package.json 的 name 逐字一致：DSH client-modules 用包名作为模块 id 查 factory，
  // 不是包名就会报 “loaded without registering ... via __ModuleLoader__.load”。
  id: '@tuweizhi/dsh-pet',
  factory: makeFactory(),
});
