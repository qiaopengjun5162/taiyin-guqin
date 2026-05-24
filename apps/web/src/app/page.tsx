import { JianzipuKeyboard } from "@/components/jianzipu-keyboard";

export default function Home() {
  return (
    <main className="flex flex-col items-center min-h-dvh py-10 px-4">
      {/* ── 品牌：印章 + 标题 ── */}
      <div className="flex flex-col items-center gap-3">
        {/* 印章 */}
        <div className="flex items-center justify-center w-14 h-14 rounded-full border-2 border-amber-700/60 bg-amber-950/30">
          <span
            className="text-2xl font-bold text-amber-600/90 select-none"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            太音
          </span>
        </div>
        <div className="text-center">
          <h1
            className="text-2xl font-bold tracking-[0.15em] text-amber-100/90"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            太音
          </h1>
          <p className="mt-1 text-xs tracking-[0.3em] text-amber-600/60 uppercase">
            古琴减字谱 · 拼装键盘
          </p>
        </div>
      </div>

      {/* ── 主卡片 —— 宣纸质感 ── */}
      <div className="mt-8 w-full max-w-md rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        {/* 卡片顶部装饰线（朱砂色） */}
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />

        <div className="p-5">
          <JianzipuKeyboard />
        </div>
      </div>

      {/* ── 页脚 ── */}
      <p className="mt-auto pt-10 text-[11px] tracking-[0.15em] text-amber-700/30">
        先选音色，再依次拼出完整减字
      </p>
    </main>
  );
}
