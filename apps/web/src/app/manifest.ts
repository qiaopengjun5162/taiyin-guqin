import type { MetadataRoute } from "next";

/**
 * PWA 清单。Next 会在构建期把它渲染成静态的 `manifest.webmanifest`。
 *
 * ⚠️ 这里的路径全部手拼 basePath，**不能写 "/icons/..."**。
 * 本站两处部署：GitHub Pages 在 `/taiyin-guqin/` 子路径，Vercel 在根路径。
 * start_url / scope / icons 写死根路径时，GitHub Pages 上「添加到主屏」会装出一个
 * 指向 404 的图标——点开白屏，而且用户不会知道是路径错了。
 *
 * 之所以拆成 `buildManifest(basePath)` + 默认导出两层：
 * 一是路径逻辑可以脱离 `process.env` 被测（构建期 `NEXT_PUBLIC_*` 有被静态替换的可能，
 * 那样基于环境变量的断言就会假通过）；二是以后多环境部署时能直接复用。
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * `output: "export"` 下必须显式声明为静态路由，否则构建直接报
 * 「export const dynamic = "force-static"... not configured on route /manifest.webmanifest」。
 * 这个清单本来就没有任何请求态依赖，静态化是它唯一合理的形态。
 */
export const dynamic = "force-static";

export function buildManifest(basePath: string): MetadataRoute.Manifest {
  return {
    name: "太音 · 古琴AI传习平台",
    short_name: "太音",
    description:
      "减字谱输入、简谱转减字、整页识别、指法编排与出声——打开就用，不用装任何软件。",
    lang: "zh-CN",
    dir: "ltr",
    start_url: `${basePath}/`,
    scope: `${basePath}/`,
    // standalone：从主屏打开时不显示浏览器地址栏，像一个 App。
    // 刻意不用 fullscreen——练琴时要能随时切出去看消息。
    display: "standalone",
    orientation: "portrait-primary",
    // 宣纸底色，与 --paper 一致：冷启动那一瞬间不闪白
    background_color: "#f5efe6",
    // 墨色状态栏，与图标底色一致
    theme_color: "#1c1b1a",
    categories: ["music", "education"],
    icons: [
      {
        src: `${basePath}/icons/icon-192.png`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${basePath}/icons/icon-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Android 会把图标裁进圆形安全区，必须单独给一张字更小的
        src: `${basePath}/icons/icon-maskable-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

export default function manifest(): MetadataRoute.Manifest {
  return buildManifest(BASE_PATH);
}
