import { toPng, toSvg } from "html-to-image";

/**
 * 单个减字 → 图片。
 *
 * 整谱导出走 `useExportImage`（截整个乐谱流 + 页脚、文件名带曲名）。这里是另一件事：
 * 用户只想「记一句指法」「给课件配一张图」「写文章贴一个字」，要的是**一个字**，
 * 而且要能直接贴进笔记 / PPT / 公众号，不希望带页脚、也不希望带一整首谱。
 *
 * 截图目标必须是 React 真实渲染出来的那个节点：`JianziBlock` 有两条渲染路径
 * （字体 GSUB 连字 / SVG 四象限降级），自己拿文字造离屏 DOM 会把降级分支画成普通汉字。
 */

export type JianziImageFormat = "png" | "svg";

/** 宣纸底色，与整谱导出保持一致。 */
const BACKGROUND = "#f8f3eb";

/**
 * 下载文件名。label 是减字的可读名（如「大九勾四」），用户可自定义，
 * 可能带路径分隔符或换行——不清干净会让浏览器把文件名截断甚至写到别的目录。
 */
export function jianziImageFilename(label: string, format: JianziImageFormat): string {
  const safe =
    (label ?? "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .trim()
      .slice(0, 40) || "减字";
  return `太音_${safe}.${format}`;
}

/**
 * 把单个减字节点截成图片并触发下载。返回是否成功，让调用方能给明确反馈
 * （失败时不能静默——症状会是「点了没反应」）。
 *
 * ⚠️ 必须先等 `document.fonts.ready`：减字靠项目自带的 @font-face 字体显示，
 * 字体没加载完时 html-to-image 会把「大九勾四」渲染成四个普通汉字，
 * **不报任何错**，图拿去贴到课件里就是错的。
 * 整谱导出（`useExportImage`）已同步补上同一道等待，两条导出路径口径一致。
 */
export async function downloadJianziImage(
  node: HTMLElement | null,
  label: string,
  format: JianziImageFormat = "png",
): Promise<boolean> {
  if (!node) return false;

  try {
    // jsdom / 老浏览器没有 fonts API，可选链兜住，不能因此让导出整个失败。
    if (document.fonts?.ready) await document.fonts.ready;

    const render = format === "svg" ? toSvg : toPng;
    const dataUrl = await render(node, {
      backgroundColor: BACKGROUND,
      // 收藏栏里单字只有 28px，4 倍出来约 112px，贴 PPT / 笔记才不糊。
      pixelRatio: 4,
      cacheBust: true,
    });

    const link = document.createElement("a");
    link.download = jianziImageFilename(label, format);
    link.href = dataUrl;
    link.click();
    return true;
  } catch (err) {
    console.error("单字图片导出失败:", err);
    return false;
  }
}
