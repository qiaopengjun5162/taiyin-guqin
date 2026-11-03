"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import * as api from "@/lib/api";
import {
  clearStoredSession,
  displayNameOf,
  getServerSessionSnapshot,
  getSessionSnapshot,
  subscribeSession,
  type Session,
} from "@/lib/auth";

/** 口令最短长度，必须与后端 `MIN_PASSWORD_LENGTH` 一致。 */
const MIN_PASSWORD_LENGTH = 8;

/** 登录态（水合阶段为 null，挂载后由 localStorage 接管）。 */
function useSession(): Session | null {
  return useSyncExternalStore(subscribeSession, getSessionSnapshot, getServerSessionSnapshot);
}

type Mode = "login" | "register";

/**
 * 社区账号：登录 / 注册 / 登出。
 *
 * ## 为什么要有它
 *
 * 光靠本机凭证时，清缓存 / 换设备就永久失去旧谱的改删权——谱还在、还能看，
 * 但改不了、删不掉。登录后服务端认账号，换设备照样认得出「这是我的谱」。
 *
 * ## 如实写清的边界
 *
 * 不做邮箱验证（没有邮件通道），也不提供找回口令。这两件事写在界面上，
 * 而不是等用户丢了口令才发现——把「注册过」当成「安全托管」是最容易吃亏的误会。
 */
export function AccountPanel() {
  const session = useSession();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 挂载时校验会话是否还有效。
   *
   * 会话在服务端存库、30 天过期，也可能被别处登出吊销。不校验的话界面一直显示
   * 「已登录」，用户一点保存却收到 403，完全不知道发生了什么。
   * 会话失效由 `fetchCurrentUser` 内部清掉本地登录态（它会触发订阅更新），
   * 所以这里不需要 setState——也就不必为 effect 里的 setState 加豁免注释。
   */
  useEffect(() => {
    if (!session) return;
    void api.fetchCurrentUser().catch(() => {
      // 后端不可达 / 未配置：保留本地登录态，下次打开再校验。
      // 不该因为一次网络抖动就把用户的登录状态抹掉。
    });
  }, [session]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`口令至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") {
        await api.registerAccount(email, password, displayName);
      } else {
        await api.loginAccount(email, password);
      }
      setPassword("");
    } catch (err) {
      // 后端对「邮箱不存在」和「口令不对」给的是同一句话（防账号枚举），
      // 原样展示即可，别自作聪明改成更「友好」的措辞。
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await api.logoutAccount();
    } finally {
      clearStoredSession();
      setBusy(false);
    }
  }

  const inputClass =
    "w-full px-2 py-1.5 min-h-[36px] text-[11px] tracking-wider rounded border border-amber-700/20 bg-transparent text-stone-800 placeholder-stone-400 outline-none focus:border-amber-600/50 transition-colors";

  return (
    <div className="mt-3 pt-3 border-t border-amber-700/15">
      <p className="text-[11px] tracking-wider text-stone-700 mb-1">社区账号（可选）</p>

      {session ? (
        <div className="space-y-1">
          <p className="text-[10px] tracking-wider text-emerald-700/80">
            已登录：{displayNameOf(session.user)}
          </p>
          <p className="text-[10px] leading-relaxed text-stone-500">
            登录后发布的谱归属你的账号，换设备、清缓存都不会失去改删权。
          </p>
          <button
            type="button"
            onClick={logout}
            disabled={busy}
            className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-600 hover:text-stone-900 hover:border-amber-700/50 disabled:opacity-40 transition-all"
          >
            {busy ? "登出中…" : "登出"}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <p className="text-[10px] leading-relaxed text-stone-500">
            登录后可跨设备管理自己发布的谱。不登录也能发布——只是那首谱只认这台设备。
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder="邮箱"
            aria-label="邮箱"
            className={inputClass}
          />
          {mode === "register" && (
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={40}
              placeholder="昵称（可选，留空则用邮箱显示）"
              aria-label="昵称"
              className={inputClass}
            />
          )}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            placeholder={`口令（至少 ${MIN_PASSWORD_LENGTH} 位）`}
            aria-label="口令"
            className={inputClass}
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-600 hover:text-stone-900 hover:border-amber-700/50 disabled:opacity-40 transition-all"
            >
              {busy ? "处理中…" : mode === "register" ? "注册" : "登录"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
              }}
              className="px-2 py-1 text-[10px] tracking-wider text-stone-500 hover:text-stone-800 transition-all"
            >
              {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
            </button>
          </div>
          <p className="text-[9px] leading-relaxed text-stone-400">
            不做邮箱验证，也暂不支持找回口令——口令请自己记牢。
          </p>
          {error && (
            <p className="text-[10px] tracking-wider text-red-500/90" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
