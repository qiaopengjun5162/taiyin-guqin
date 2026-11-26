/**
 * 导出页脚——平时隐藏，截图/打印时自动出现。
 *
 * 双通道复用：
 *   - 截图：html-to-image 捕获 DOM 时自然入画
 *   - 打印：@media print 显示，位于乐谱区底部
 *
 * ⚠️ `flex-col` 写在基础类里，`flex` 由使用方在显示时补上（见 `use-export-image.ts`）。
 * 只写 `print:flex` 的话，屏幕上摘掉 `hidden` 后 display 退回 `block`——
 * `items-center` 失效、每行文字左对齐贴边，导出的 PNG 里页脚是歪的（2026-11-26 实测）。
 */
export function ExportFooter({ title, tuning }: { title: string; tuning?: string }) {
  return (
    <div
      id="export-footer"
      className="hidden flex-col items-center gap-1 pt-6 mt-6 border-t border-stone-300/30 w-full print:flex"
      style={{ fontFamily: "var(--font-serif), 'Noto Serif SC', serif" }}
    >
      <p className="text-[11px] tracking-[0.15em] text-stone-500">
        太音智能 · 减字谱排版
      </p>
      {title && (
        <p className="text-[10px] tracking-wider text-stone-600">
          《{title}》
        </p>
      )}
      {/* 定弦是谱子的一部分：打印出来给别人弹，没这一行就得靠猜 */}
      {tuning && (
        <p className="text-[10px] tracking-wider text-stone-500">定弦 {tuning}</p>
      )}
    </div>
  );
}
