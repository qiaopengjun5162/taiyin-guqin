/**
 * 导出页脚——平时隐藏，截图/打印时自动出现。
 *
 * 双通道复用：
 *   - 截图：html-to-image 捕获 DOM 时自然入画
 *   - 打印：@media print 显示，位于乐谱区底部
 */
export function ExportFooter({ title }: { title: string }) {
  return (
    <div
      id="export-footer"
      className="hidden print:flex flex-col items-center gap-1 pt-6 mt-6 border-t border-stone-300/30 w-full"
      style={{ fontFamily: "var(--font-serif), 'Noto Serif SC', serif" }}
    >
      <p className="text-[11px] tracking-[0.15em] text-stone-400">
        太音智能 · 减字谱排版
      </p>
      {title && (
        <p className="text-[10px] tracking-wider text-stone-300">
          《{title}》
        </p>
      )}
    </div>
  );
}
