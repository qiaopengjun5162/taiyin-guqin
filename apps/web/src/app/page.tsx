import { JianzipuKeyboard } from "@/components/jianzipu-keyboard";

export default function Home() {
  return (
    <main className="flex flex-col items-center min-h-dvh py-8 px-4">
      {/* 品牌 */}
      <h1 className="text-3xl font-bold tracking-tight">太音</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        古琴减字谱 · 拼装键盘
      </p>

      {/* 键盘组件 */}
      <div className="mt-8 w-full max-w-md">
        <JianzipuKeyboard />
      </div>

      {/* 页脚提示 */}
      <p className="mt-auto pt-8 text-xs text-muted-foreground">
        依次点击 左手 → 徽位 → 右手 → 弦序，拼出完整减字
      </p>
    </main>
  );
}
