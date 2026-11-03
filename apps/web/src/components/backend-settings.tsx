"use client";

import { useState, useSyncExternalStore } from "react";
import { AccountPanel } from "./account-panel";
import {
  subscribeApiBase,
  subscribeSettings,
  getApiBaseSnapshot,
  getServerApiBaseSnapshot,
  setStoredApiBase,
  clearStoredApiBase,
  getAuthorSnapshot,
  getServerAuthorSnapshot,
  setStoredAuthor,
  MAX_AUTHOR_LENGTH,
} from "@/lib/settings";

/** 读运行时后端地址（服务端 / 水合阶段返回 ""，挂载后由 localStorage 接管）。 */
function useApiBaseUrl(): { url: string; set: (u: string) => void; clear: () => void } {
  const url = useSyncExternalStore(
    subscribeApiBase,
    getApiBaseSnapshot,
    getServerApiBaseSnapshot,
  );
  return {
    url: url ?? "",
    set: setStoredApiBase,
    clear: clearStoredApiBase,
  };
}

/** 读本机记住的打谱人署名（水合阶段为空串 = 匿名）。 */
function useAuthor(): string {
  return useSyncExternalStore(
    subscribeSettings,
    getAuthorSnapshot,
    getServerAuthorSnapshot,
  );
}

/**
 * 社区后端设置：用户填入与好友共享的曲谱后端地址后，保存 / 加载即走服务器
 * （浏览 + 发布社区曲谱）；留空则曲谱仅存本浏览器。不填不破坏任何现有行为。
 */
export function BackendSettings() {
  const { url, set, clear } = useApiBaseUrl();
  const author = useAuthor();
  const [draft, setDraft] = useState(url);
  const [authorDraft, setAuthorDraft] = useState(author);
  const connected = url.length > 0;

  /** 保存：一次提交后端地址与署名，避免两个按钮让人以为是两件事。 */
  function save() {
    set(draft);
    setStoredAuthor(authorDraft);
  }

  return (
    <div className="no-print mt-2 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-sm">
      <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
      <div className="p-4">
        <p className="text-[11px] tracking-wider text-stone-700 mb-1">社区后端（可选）</p>
        <p className="text-[10px] tracking-wider text-stone-500 mb-2 leading-relaxed">
          填入与好友共享的曲谱后端地址，即可浏览 / 发布社区曲谱。留空则曲谱仅存本浏览器。
        </p>
        <input
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="https://your-guqin-server.example.com"
          aria-label="社区后端地址"
          className="w-full px-2 py-1.5 min-h-[36px] text-[11px] tracking-wider rounded border border-amber-700/20 bg-transparent text-stone-800 placeholder-stone-400 outline-none focus:border-amber-600/50 transition-colors"
        />
        <p className="mt-3 text-[11px] tracking-wider text-stone-700 mb-1">我的署名（可选）</p>
        <p className="text-[10px] tracking-wider text-stone-500 mb-2 leading-relaxed">
          发布到社区时显示为打谱人；留空则匿名。本机存的是私有草稿，不带署名。
        </p>
        <input
          type="text"
          value={authorDraft}
          onChange={(e) => setAuthorDraft(e.target.value)}
          maxLength={MAX_AUTHOR_LENGTH}
          placeholder="如：张百忍 / 某某琴社"
          aria-label="我的署名"
          className="w-full px-2 py-1.5 min-h-[36px] text-[11px] tracking-wider rounded border border-amber-700/20 bg-transparent text-stone-800 placeholder-stone-400 outline-none focus:border-amber-600/50 transition-colors"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/30 text-stone-600 hover:text-stone-900 hover:border-amber-700/50 transition-all"
          >
            保存
          </button>
          {connected && (
            <button
              type="button"
              onClick={() => {
                clear();
                setDraft("");
              }}
              className="px-3 py-1 text-[10px] tracking-wider rounded border border-amber-700/20 text-stone-400 hover:text-red-600 transition-all"
            >
              清除（改用本地）
            </button>
          )}
        </div>
        <p
          className={`mt-2 text-[10px] tracking-wider ${
            connected ? "text-emerald-700/80" : "text-stone-500"
          }`}
        >
          {connected ? `已连接社区后端：${url}` : "未连接：曲谱仅存本浏览器"}
        </p>
        <p className="mt-1 text-[10px] tracking-wider text-stone-500">
          {author ? `发布署名：${author}` : "发布署名：匿名"}
        </p>
        <AccountPanel />
      </div>
    </div>
  );
}
