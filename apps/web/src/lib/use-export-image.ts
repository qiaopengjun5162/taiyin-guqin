import { useCallback, useState } from "react";
import { toPng, toSvg } from "html-to-image";

interface UseExportImageOptions {
  /** 截图目标容器 ref（应包裹乐谱 + 页脚） */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 曲谱名称，用于文件名 */
  title?: string;
  /** 导出超时（毫秒） */
  timeout?: number;
}

export type ExportFormat = "png" | "svg";

/** 乐谱截图导出 hook —— 同时支持 PNG（位图）与 SVG（矢量，无损缩放） */
export function useExportImage({ containerRef, title, timeout = 15_000 }: UseExportImageOptions) {
  const [isExporting, setIsExporting] = useState(false);

  const exportImage = useCallback(
    async (format: ExportFormat) => {
      const node = containerRef.current;
      if (!node) return;

      setIsExporting(true);
      const footer = document.getElementById("export-footer");
      try {
        // 显示预埋的页脚容器（export-footer 默认 hidden），让它入画
        footer?.classList.remove("hidden");

        const timer = setTimeout(() => {
          setIsExporting(false);
        }, timeout);

        // ⚠️ 必须先等字体：减字靠项目自带的 @font-face 显示，字体没加载完时
        // html-to-image 会把「大九勾四」画成四个普通汉字，**不报任何错**，
        // 导出的 PNG/SVG 拿去贴课件或发文章就是错的。与单字导出同一道保护。
        // jsdom / 老浏览器没有 fonts API，可选链兜住，不能因此让导出整体失败。
        if (document.fonts?.ready) await document.fonts.ready;

        // html-to-image 的 toPng/toSvg 入参一致，仅返回格式不同
        const render = format === "svg" ? toSvg : toPng;
        const extension = format === "svg" ? "svg" : "png";
        const dataUrl = await render(node, {
          backgroundColor: "#f8f3eb",
          pixelRatio: 2,
          cacheBust: true,
        });

        clearTimeout(timer);

        // 触发下载
        const link = document.createElement("a");
        const filename = title
          ? `太音减字谱_${title}_${Date.now()}.${extension}`
          : `太音减字谱_${Date.now()}.${extension}`;
        link.download = filename;
        link.href = dataUrl;
        link.click();
      } catch (err) {
        console.error(`export ${format} failed:`, err);
      } finally {
        footer?.classList.add("hidden");
        setIsExporting(false);
      }
    },
    [containerRef, title, timeout],
  );

  const exportPng = useCallback(() => exportImage("png"), [exportImage]);
  const exportSvg = useCallback(() => exportImage("svg"), [exportImage]);

  return { exportPng, exportSvg, isExporting };
}
