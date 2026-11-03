/**
 * 后端地址的运行时配置（「社区后端」设置面板用）。
 *
 * 背景：GitHub Pages 这类静态托管没有后端，构建时若不注入
 * `NEXT_PUBLIC_API_URL`，线上站点永远走本地存储（`isBrowserOnlyMode` 恒真），
 * 「社区 / 分享」始终接不通。这里把后端地址做成「用户可在设置里填」的运行时值，
 * 存 localStorage，优先级高于构建期环境变量；不填则维持原有本地行为。
 *
 * 这样自托管用户、以及尚未部署后端的人都能用，且沙箱里可直接测
 * （mock fetch + 设 / 清 localStorage，无需真实联网）。
 *
 * 本文件刻意不引入 react，供 `api.ts` 在 node 测试环境安全 import。
 * 用到 `useSyncExternalStore` 的 hook 放在组件侧（`backend-settings.tsx`）。
 */

const STORAGE_KEY = "taiyin.apiBaseUrl";

/** 去掉首尾空白与结尾斜杠，避免 `http://x/` 与 `http://x` 被当成两个地址。 */
function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? normalize(v) : null;
  } catch {
    // 隐私模式 / 禁用存储：视为未配置
    return null;
  }
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 读取当前运行时后端地址（未配置返回 null）。 */
export function getStoredApiBase(): string | null {
  return readRaw();
}

/** 写入 / 更新后端地址；传入空白等价于清除。 */
export function setStoredApiBase(url: string): void {
  const value = normalize(url);
  if (typeof window !== "undefined") {
    try {
      if (value) window.localStorage.setItem(STORAGE_KEY, value);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 存储不可用时静默忽略，连接开关只是不生效
    }
  }
  emit();
}

/** 清除运行时后端地址，回到「仅本地存储」模式。 */
export function clearStoredApiBase(): void {
  setStoredApiBase("");
}

/** useSyncExternalStore 订阅：设置变更后组件自动重渲染。 */
export function subscribeApiBase(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 客户端快照（引用随 localStorage 变化）。 */
export function getApiBaseSnapshot(): string | null {
  return readRaw();
}

/** 服务端 / 水合快照：永远 null，避免 hydration 不一致。 */
export function getServerApiBaseSnapshot(): string | null {
  return null;
}
