import { useCallback, useState } from "react";
import { toPng, toSvg } from "html-to-image";
import { buildSubsetFontEmbedCss } from "./export-font-embed";

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
        // 显示预埋的页脚容器（export-footer 默认 hidden），让它入画。
        // `flex` 必须显式补上：组件里只有 `print:flex`，屏幕上摘掉 `hidden`
        // 会退回 `block`，`items-center` 随之失效、页脚文字左对齐贴边。
        footer?.classList.remove("hidden");
        footer?.classList.add("flex");

        // 等一帧再截：`hidden` 去掉后容器高度要下一次布局才更新，而 html-to-image
        // 读的是当前布局尺寸。2026-11-26 实测不等这一帧，导出的 PNG 会把页脚
        // **只截到上半截**——曲名与定弦正好被切掉，图上只剩半行字。
        await new Promise<void>((resolve) => {
          const raf = typeof requestAnimationFrame === "function"
            ? requestAnimationFrame
            : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0);
          raf(() => raf(() => resolve()));
        });

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

        // 尺寸自己给，不靠库内部去读：`hidden` 移除后它拿到的 clientHeight
        // 可能仍是去掉页脚前那一刻的旧值（2026-11-26 实测导出图把页脚切掉半行，
        // 曲名与定弦正好丢失）。这里读的是**页脚已经参与布局之后**的真实尺寸。
        //
        // 再留 32px 余量：html-to-image 在克隆里重建样式，字体回退会让页脚行高
        // 比页面上明显变大（实测三行里最后一版仍会吃掉最后一行）。多出来的部分
        // 是背景色，视觉上看不出来；宁可下面多一条留白，也别把定弦切掉。
        const top = node.getBoundingClientRect().top;
        const footerBottom = footer ? footer.getBoundingClientRect().bottom - top : 0;
        const width = Math.ceil(node.scrollWidth);
        const height = Math.ceil(Math.max(node.scrollHeight, footerBottom)) + 32;

        // ⚠️ 字体分片只内联「这张图用得到的」。
        // html-to-image 默认会把文档里 613 个 `@font-face` 全拉一遍再 base64 塞进
        // SVG：本机只是慢，GitHub Pages 上每个分片要十几秒、导出 60 秒都出不来
        // （2026-11-26 线上实测挂起 507 个请求）。这里先按 unicode-range 过滤再内联。
        // 取不到规则时返回 null，退回库默认行为——宁可慢，不能导不出。
        let fontEmbedCSS: string | undefined;
        try {
          const embed = await buildSubsetFontEmbedCss(node);
          fontEmbedCSS = embed.css ?? undefined;
        } catch (err) {
          console.warn("subset font embed failed, fallback to default:", err);
        }

        const dataUrl = await render(node, {
          backgroundColor: "#f8f3eb",
          pixelRatio: 2,
          cacheBust: true,
          width,
          height,
          ...(fontEmbedCSS ? { fontEmbedCSS } : {}),
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
        footer?.classList.remove("flex");
        setIsExporting(false);
      }
    },
    [containerRef, title, timeout],
  );

  const exportPng = useCallback(() => exportImage("png"), [exportImage]);
  const exportSvg = useCallback(() => exportImage("svg"), [exportImage]);

  return { exportPng, exportSvg, isExporting };
}
