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

type Mode = "login" | "register" | "forgot" | "reset";

/**
 * 社区账号：登录 / 注册 / 登出 / 找回口令。
 *
 * ## 为什么要有它
 *
 * 光靠本机凭证时，清缓存 / 换设备就永久失去旧谱的改删权——谱还在、还能看，
 * 但改不了、删不掉。登录后服务端认账号，换设备照样认得出「这是我的谱」。
 *
 * ## 如实写清的边界
 *
 * 不做邮箱验证（注册时不验，找回口令的链接只发到注册邮箱本身，
 * 等于事后证明「控制该邮箱」）。找回口令走邮件链接（30 分钟内有效、一次有效），
 * 真收不到信再找管理员重置。
 */
export function AccountPanel() {
  const session = useSession();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 提示（非错误）：如「重置链接已寄出」。 */
  const [info, setInfo] = useState<string | null>(null);
  /** 邮件链接带回来的一次性重置令牌（`?reset_token=`）。 */
  const [resetToken, setResetToken] = useState<string | null>(null);

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

  /**
   * 邮件里的重置链接带 `?reset_token=`，点开就直接进重置表单——
   * 让用户自己把令牌抄进表单是纯折磨。链接由后端生成（见 forgot-password），
   * 这里只负责读出来；读不到就照常显示登录。
   */
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("reset_token");
    if (token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载后读 URL 参数（预渲染时没有 window，只能在 effect 里读）
      setResetToken(token);
      setMode("reset");
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (mode === "forgot") {
      // 不校验「邮箱是否注册过」——后端都不说，界面更不能说（防枚举）
      setBusy(true);
      try {
        await api.requestPasswordReset(email);
        // 统一话术：注册过 / 没注册过都一样，用户也不该从提示里看出差别
        setInfo("如果这个邮箱注册过，重置链接已经寄出（30 分钟内有效）。没收到就检查一下邮箱写没写对。");
      } catch (err) {
        setError(err instanceof Error ? err.message : "发送失败");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === "reset") {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`口令至少 ${MIN_PASSWORD_LENGTH} 位`);
        return;
      }
      if (!resetToken) {
        setError("链接不对——请从邮件里的链接重新进入");
        return;
      }
      setBusy(true);
      try {
        await api.resetPasswordWithToken(resetToken, password);
        setPassword("");
        setResetToken(null);
        setMode("login");
        setInfo("口令已改，请用新口令登录。旧的登录状态都已退出。");
      } catch (err) {
        setError(err instanceof Error ? err.message : "重置失败");
      } finally {
        setBusy(false);
      }
      return;
    }
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
          {mode === "reset" ? (
            <>
              <p className="text-[10px] leading-relaxed text-stone-500">
                设一个新口令（至少 {MIN_PASSWORD_LENGTH} 位）。改完后旧的登录状态都会退出。
              </p>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                placeholder={`新口令（至少 ${MIN_PASSWORD_LENGTH} 位）`}
                aria-label="新口令"
                className={inputClass}
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-600 hover:text-stone-900 hover:border-amber-700/50 disabled:opacity-40 transition-all"
                >
                  {busy ? "处理中…" : "设为新口令"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                    setInfo(null);
                  }}
                  className="px-2 py-1 text-[10px] tracking-wider text-stone-500 hover:text-stone-800 transition-all"
                >
                  返回登录
                </button>
              </div>
            </>
          ) : mode === "forgot" ? (
            <>
              <p className="text-[10px] leading-relaxed text-stone-500">
                填注册时用的邮箱，寄一条重置链接过去（30 分钟内有效、只能用一次）。
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
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-600 hover:text-stone-900 hover:border-amber-700/50 disabled:opacity-40 transition-all"
                >
                  {busy ? "寄出中…" : "寄重置链接"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                    setInfo(null);
                  }}
                  className="px-2 py-1 text-[10px] tracking-wider text-stone-500 hover:text-stone-800 transition-all"
                >
                  返回登录
                </button>
              </div>
            </>
          ) : (
            <>
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
                    setInfo(null);
                  }}
                  className="px-2 py-1 text-[10px] tracking-wider text-stone-500 hover:text-stone-800 transition-all"
                >
                  {mode === "login" ? "没有账号？注册" : "已有账号？登录"}
                </button>
                {mode === "login" && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode("forgot");
                      setError(null);
                      setInfo(null);
                    }}
                    className="px-2 py-1 text-[10px] tracking-wider text-stone-500 hover:text-stone-800 transition-all"
                  >
                    忘了口令？
                  </button>
                )}
              </div>
              <p className="text-[9px] leading-relaxed text-stone-400">
                不做邮箱验证。口令忘了点「忘了口令？」自助找回；收不到信再找管理员重置。
              </p>
            </>
          )}
          {info && (
            <p className="text-[10px] tracking-wider text-emerald-700/80" role="status">
              {info}
            </p>
          )}
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
