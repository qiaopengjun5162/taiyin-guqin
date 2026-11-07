"use client";

import { useEffect } from "react";

/**
 * 注册 Service Worker（见 public/sw.js）。
 *
 * 三个必须守住的点：
 *
 * 1. **只在生产注册**。dev 下 Next 的 HMR 资源和 SW 缓存会互相污染，
 *    症状是「改了代码但页面不变」，清理缓存也未必救得回来——本地调试会非常痛苦。
 * 2. **路径必须带 basePath**。GitHub Pages 上脚本在 `/taiyin-guqin/sw.js`，
 *    写死 `/sw.js` 会 404（然后被 SPA rewrites 兜成 200 的 HTML，
 *    `register()` 拿到一段 HTML 后抛「MIME type 不对」，静默失败）。
 * 3. **注册失败不能影响页面**。Safari 无痕模式、旧内核、被策略禁用都会抛异常，
 *    这是纯增强功能，失败就安静地当没有。
 *
 * 参数全部显式传入（而不是在函数体里读 `process.env`）：`NODE_ENV` 在打包时
 * 会被静态替换成字面量，基于环境变量的测试会「看起来跑了其实没测到」。
 */

/** SW 脚本地址（随部署根变化） */
export function serviceWorkerUrl(basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ""): string {
  return `${basePath}/sw.js`;
}

/** 作用域同样要带 basePath；超出脚本所在目录的 scope 会被浏览器拒绝 */
export function serviceWorkerScope(basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ""): string {
  return `${basePath}/`;
}

export interface RegisterOptions {
  /** 显式覆盖「是否生产环境」，方便测试；不传则读 NODE_ENV */
  enabled?: boolean;
  basePath?: string;
}

export async function registerServiceWorker(
  options: RegisterOptions = {},
): Promise<ServiceWorkerRegistration | null> {
  const enabled = options.enabled ?? process.env.NODE_ENV === "production";
  if (!enabled) return null;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;

  const basePath = options.basePath ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  try {
    return await navigator.serviceWorker.register(serviceWorkerUrl(basePath), {
      scope: serviceWorkerScope(basePath),
    });
  } catch {
    return null;
  }
}

/**
 * 空组件：只负责在挂载后触发一次注册。
 * `enabled` 只给测试用（生产不传，走 NODE_ENV 判断）。
 */
export function PwaRegister({ enabled }: { enabled?: boolean } = {}) {
  useEffect(() => {
    void registerServiceWorker({ enabled });
  }, [enabled]);
  return null;
}
