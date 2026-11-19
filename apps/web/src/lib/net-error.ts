/**
 * 网络故障判定 —— 独立模块，不放在 `api.ts` 里。
 *
 * ## 为什么要单独一个文件（2026-11-18 踩坑记录）
 *
 * 这个函数本来是 `api.ts` 里的一个导出。UI（`page.tsx`）要用它来决定
 * 「后端连不上时降级存本机」。但组件测试用 `vi.mock("@/lib/api")` 替换了整个模块，
 * 替身里没有这个导出——于是：
 *
 * - 直接 import → 调用处 `undefined is not a function`；
 * - 从门面 `@/lib/client` re-export → 同样穿透到 mock，一样拿不到；
 * - 写 `api.isBackendUnreachable?.()` → Vitest 的 mock 是 Proxy，
 *   **可选链也会触发 getter 并抛错**。
 *
 * 结论：**纯函数判定不该和网络客户端绑在同一个模块里**。
 * 它是与 HTTP 实现无关的分类逻辑，放在这里既不依赖 mock，也能被单测直接覆盖。
 */

/**
 * 这个错误是不是「后端连不上」（而不是「后端回复了错误」，也不是代码 bug）。
 *
 * 判据必须够窄——判宽了会把真实缺陷当成网络问题吞掉。
 *
 * 1. **连不上**（ECONNREFUSED / DNS 失败）：浏览器统一抛
 *    `TypeError: Failed to fetch`（Firefox 是 `NetworkError`，Safari 是 `Load failed`）。
 *    消息文案随浏览器不同，所以按消息特征判，不能只看类型。
 * 2. **超时**（`AbortError`）：后端在但太慢，同样可以本地兜底。
 * 3. **其它 `TypeError`**（例如读 `undefined.id`）：那是代码 bug，必须原样抛出。
 *    2026-11-18 踩过：判据写成「`instanceof TypeError` 即断网」，
 *    结果测试替身返回 `undefined` 引发的 TypeError 被当成断网，真实缺陷被吞掉。
 */
export function isBackendUnreachable(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (!(err instanceof TypeError)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("load failed") ||
    msg.includes("network request failed")
  );
}
