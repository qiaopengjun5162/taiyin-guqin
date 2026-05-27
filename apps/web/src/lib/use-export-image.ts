import { useCallback, useState } from "react";
import { toPng } from "html-to-image";

interface UseExportImageOptions {
  /** 截图目标容器 ref（应包裹乐谱 + 页脚） */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 曲谱名称，用于文件名 */
  title?: string;
  /** 导出超时（毫秒） */
  timeout?: number;
}

/** 乐谱截图导出 hook */
export function useExportImage({ containerRef, title, timeout = 15_000 }: UseExportImageOptions) {
  const [isExporting, setIsExporting] = useState(false);

  const exportPng = useCallback(async () => {
    const node = containerRef.current;
    if (!node) return;

    setIsExporting(true);
    const footer = document.getElementById("export-footer");
    try {
      // 显示预埋的页脚容器（export-footer 默认 hidden）
      footer?.classList.remove("hidden");

      const timer = setTimeout(() => {
        setIsExporting(false);
      }, timeout);

      const dataUrl = await toPng(node, {
        backgroundColor: "#f8f3eb",
        pixelRatio: 2,
        cacheBust: true,
      });

      clearTimeout(timer);

      // 触发下载
      const link = document.createElement("a");
      const filename = title
        ? `太音减字谱_${title}_${Date.now()}.png`
        : `太音减字谱_${Date.now()}.png`;
      link.download = filename;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("export failed:", err);
    } finally {
      footer?.classList.add("hidden");
      setIsExporting(false);
    }
  }, [containerRef, title, timeout]);

  return { exportPng, isExporting };
}
