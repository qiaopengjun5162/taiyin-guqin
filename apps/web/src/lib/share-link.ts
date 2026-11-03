/**
 * 曲谱分享链接：让社区里的一首谱能被「链接直达」。
 *
 * 本项目是静态导出（GitHub Pages），没有服务端路由可做 `/s/<id>`，
 * 于是分享靠 URL query：`https://<host>/taiyin-guqin/?score=<id>`。
 * 页面挂载时读 query、自动拉取该谱并载入编辑器。
 *
 * 两个函数刻意做成纯逻辑（search / href 从参数注入），
 * 不直接读 window，便于单测覆盖 basePath、异常输入等边界。
 */

/** 从 query string 里取分享的曲谱 id；缺省或空串返回 null。 */
export function readSharedScoreId(search: string): string | null {
  try {
    const id = new URLSearchParams(search).get("score")?.trim();
    return id ? id : null;
  } catch {
    // 极老的宿主或畸形输入：当作没有分享参数，退回正常空页
    return null;
  }
}

/**
 * 构造某首谱的分享链接。
 *
 * 保留当前 origin 与 pathname（含 `/taiyin-guqin` 这类 basePath），
 * 清掉已有 query / hash，只留 `?score=<id>`——避免把 `#` 锚点或调试参数带进分享。
 *
 * @param id 曲谱 id（社区服务器 id）
 * @param href 当前页面完整地址；省略时取 `window.location.href`（便于测试注入）
 */
export function buildScoreShareUrl(id: string, href?: string): string {
  const base = href ?? (typeof window !== "undefined" ? window.location.href : "");
  if (!base) {
    // 无 window（极端情况）时退化成相对链接，仍可被浏览器解析
    return `?score=${encodeURIComponent(id)}`;
  }
  try {
    const url = new URL(base);
    url.search = "";
    url.hash = "";
    url.searchParams.set("score", id);
    return url.toString();
  } catch {
    return `?score=${encodeURIComponent(id)}`;
  }
}
