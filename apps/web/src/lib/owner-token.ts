/**
 * 社区曲谱的**所有权凭证**（不是账号，也不是身份认证）。
 *
 * ## 为什么需要
 *
 * `/api/v1/scores` 是无账号的共享池。原先任何人拿到曲谱 id 就能 PUT / DELETE，
 * 而分享链接里正好带着 id —— 等于「看见链接的人都能删你的谱」。
 *
 * ## 做法
 *
 * 首次发布时本机生成一个随机 token 一并提交，之后改 / 删都带同一个 token。
 * 服务端只比对 token，不认人。所以这个 token 要当密码对待：
 * 谁拿到它，谁就能改删这台设备发布的谱。
 *
 * ## 已知边界（如实说明，不假装是账号体系）
 *
 * - 换设备 / 清缓存 / 换浏览器 = 凭证丢失，之前发布的谱在本机视角变成「别人的谱」，
 *   仍然可以读、可以另存为新谱，但改不了、删不了（服务端会 403，这是预期行为）。
 * - 同一浏览器里所有使用者的谱共用一个 token，无法区分「这台电脑上的两个人」。
 * - 真要「跨设备登录 + 认领旧谱」，需要账号体系，不在此模块范围内。
 *
 * 本文件不引入 react，供 `api.ts` 在 node 测试环境安全 import。
 */

const TOKEN_KEY = "taiyin.ownerToken";
const MY_SCORES_KEY = "taiyin.myScoreIds";
/** 最多记多少条「我发布过的 id」：够用即可，避免 localStorage 无限增长。 */
const MAX_TRACKED_IDS = 500;

/** 存储不可用时的进程内兜底，保证一次会话内凭证稳定（否则每次调用都换 token）。 */
let memoryToken: string | null = null;

function randomToken(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // 极老环境兜底：强度不足，但不至于让功能整个不可用
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 取本机的发布者凭证；首次调用时生成并持久化。
 *
 * 服务端 / 构建期（无 window）返回空串——此时不会发请求，调它也没意义。
 */
export function getOwnerToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(TOKEN_KEY);
    if (existing && existing.trim()) {
      memoryToken = existing;
      return existing;
    }
    if (!memoryToken) memoryToken = randomToken();
    window.localStorage.setItem(TOKEN_KEY, memoryToken);
    return memoryToken;
  } catch {
    // 隐私模式 / 存储被禁：退化为进程内凭证（刷新页面后会换新，旧谱就改不动了）
    if (!memoryToken) memoryToken = randomToken();
    return memoryToken;
  }
}

function readIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MY_SCORES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MY_SCORES_KEY, JSON.stringify(ids.slice(-MAX_TRACKED_IDS)));
  } catch {
    // 存不下就只是记不住「这是我的谱」，不影响发布本身
  }
}

/**
 * 记下「这首谱是我在这台设备发布的」。
 *
 * 用途有两个：
 * 1. 加载自己的谱时保留 id，保存走更新而不是每次都新建副本；
 * 2. 加载别人的谱时不设 id，保存自动变成「另存为新谱」，避开服务端 403。
 *
 * 注意这只是本地记录，服务端仍以凭证为准——本地记录被伪造也改不了别人的谱。
 */
export function rememberMyScore(id: string): void {
  if (!id) return;
  const ids = readIds();
  if (ids.includes(id)) return;
  writeIds([...ids, id]);
}

/** 删除成功后移除本地记录，避免 id 越积越多。 */
export function forgetMyScore(id: string): void {
  if (!id) return;
  const ids = readIds();
  if (!ids.includes(id)) return;
  writeIds(ids.filter((x) => x !== id));
}

/** 这首谱是否由本机发布（据此决定「保存」走更新还是新建）。 */
export function isMyScore(id: string): boolean {
  if (!id) return false;
  return readIds().includes(id);
}

/** 仅供测试：清空进程内缓存的凭证。 */
export function resetOwnerTokenCache(): void {
  memoryToken = null;
}
