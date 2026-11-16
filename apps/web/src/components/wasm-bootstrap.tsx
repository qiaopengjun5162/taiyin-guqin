"use client";

import { useEffect } from "react";
import { initWasmSync } from "@/lib/taiyin-wasm";

/**
 * S2 启动预加载：客户端挂载后一次性初始化 WASM，之后 9 个同步 getter 可用。
 *
 * 不渲染任何内容，和 `PwaRegister` 一样只挂副作用。
 * 初始化失败静默：`initWasmSync` 内部已回退到 idle，原 async 路径仍可接手，
 * 不该因为预加载失败把页面卡住或显示错误。
 *
 * 与页面里的 `useWasmInit()` 幂等共存：两条路径共用同一个 instance 与
 * loadPromise，谁先成功谁占用，不会重复初始化 glue。
 */
export function WasmBootstrap() {
  useEffect(() => {
    void initWasmSync();
  }, []);
  return null;
}
