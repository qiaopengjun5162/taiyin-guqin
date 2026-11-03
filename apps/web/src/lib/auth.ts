/**
 * 社区账号的**登录态**（会话 token + 当前用户）。
 *
 * ## 它与「所有权凭证」的分工
 *
 * `owner-token.ts` 那把钥匙只存在这台设备上，清缓存 / 换电脑就丢，
 * 丢了就再也改不动自己以前发的谱。账号是第二把钥匙：存在服务器上的会话，
 * 换设备只要登录就认得出「这是我的谱」。
 *
 * 两把钥匙并存，不是替换——没注册的人照旧能用凭证发布、改删。
 *
 * ## 为什么是「会话 token」而不是把账号密码存浏览器
 *
 * 口令永不下发、也不存本地。登录换回一个随机 token（服务端存库，30 天过期），
 * 登出即删行。泄露时登出立刻止损，而不必改口令。
 *
 * 本文件刻意不引入 react，供 `api.ts` 在 node 测试环境安全 import。
 */

const STORAGE_KEY = "taiyin.session";

export interface SessionUser {
  id: string;
  email: string;
  /** 昵称；空串表示没填（后端允许，界面按邮箱兜底显示）。 */
  display_name: string;
}

export interface Session {
  token: string;
  user: SessionUser;
}

/** 存储不可用时的进程内兜底，保证一次会话内登录态稳定。 */
let memorySession: Session | null = null;

function read(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { token, user } = parsed as Partial<Session>;
    // 形状校验：手改 localStorage / 旧版本残留都可能给出残缺对象，
    // 与其让后面每个调用点各自判空，不如在这里一次性挡掉。
    if (typeof token !== "string" || !token) return null;
    if (typeof user !== "object" || user === null) return null;
    if (typeof user.id !== "string" || !user.id) return null;
    return {
      token,
      user: {
        id: user.id,
        email: typeof user.email === "string" ? user.email : "",
        display_name: typeof user.display_name === "string" ? user.display_name : "",
      },
    };
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 读取当前登录态；未登录返回 null。 */
export function getStoredSession(): Session | null {
  const stored = read();
  if (stored) {
    memorySession = stored;
    return stored;
  }
  // 存储被禁（隐私模式）时退回进程内：这次会话内仍认得出自己的谱
  return memorySession;
}

/** 登录后记住会话；`null` 表示登出。 */
export function setStoredSession(session: Session | null): void {
  memorySession = session;
  if (typeof window !== "undefined") {
    try {
      if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 隐私模式：只是刷新页面后要重新登录，不影响本次使用
    }
  }
  emit();
}

/** 登出（清本地会话；服务端的会话行由 api.logoutAccount 负责删）。 */
export function clearStoredSession(): void {
  setStoredSession(null);
}

/** 会话 token，供请求头使用；未登录返回空串。 */
export function getSessionToken(): string {
  return getStoredSession()?.token ?? "";
}

/** 当前登录用户 id；未登录返回 null（列表里比对「这是我的谱」用）。 */
export function getCurrentUserId(): string | null {
  return getStoredSession()?.user.id ?? null;
}

/** useSyncExternalStore 订阅：登录 / 登出后组件自动重渲染。 */
export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 客户端快照。**必须缓存**：直接返回 read() 会每次新建对象，
 *  useSyncExternalStore 判定「变了」从而无限重渲染。 */
let snapshot: Session | null = null;
export function getSessionSnapshot(): Session | null {
  const next = getStoredSession();
  const same =
    (next === null && snapshot === null) ||
    (next !== null && snapshot !== null && next.token === snapshot.token && next.user.id === snapshot.user.id);
  if (!same) snapshot = next;
  return snapshot;
}

/** 服务端 / 水合快照：永远 null，避免 hydration 不一致。 */
export function getServerSessionSnapshot(): Session | null {
  return null;
}

/** 显示名：没填昵称就退回邮箱，避免列表里出现空白的「我的谱」。 */
export function displayNameOf(user: SessionUser): string {
  return user.display_name.trim() || user.email;
}
