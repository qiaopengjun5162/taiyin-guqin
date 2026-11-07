/**
 * 生成 PWA 图标（192 / 512 / maskable 512 / apple-touch 180）。
 *
 * 为什么用 Playwright 而不是画图库：仓库里没有 sharp / PIL / fontTools，
 * 但我们**已经有真的减字谱字体**（public/fonts/WangJiJianZiPuKaiTi.ttf）。
 * 用这个字体把「散勾三」这个真减字渲染成图标，比拿一个手绘几何图形凑数更贴题，
 * 也不会引入新的构建期依赖（Playwright 只在本地跑一次，产物是已提交的 PNG）。
 *
 * 用法：
 *   NODE_PATH=<repo>/node_modules node apps/web/scripts/generate-icons.mjs
 *
 * 注意：这是**一次性/低频**脚本，不挂进 build，避免 CI 依赖浏览器。
 */
import { chromium } from "playwright";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "..");
const FONT_PATH = join(WEB_ROOT, "public/fonts/WangJiJianZiPuKaiTi.ttf");
const OUT_DIR = join(WEB_ROOT, "public/icons");

/** 主题色，与 src/app/globals.css 的 :root 保持一致 */
const INK = "#1c1b1a";
const GOLD = "#d8bd86";
const GOLD_RING = "rgba(201,169,110,0.34)";

/**
 * glyphScale = 减字占画布的线性比例。
 * - `any`（普通图标）：OS 会自己加圆角/遮罩，字可以占大一点；
 * - `maskable`：Android 会把图标裁进圆形安全区（直径约 80%），
 *   字必须缩到 ~0.5 才不会被切掉笔画；
 * - apple-touch：iOS 自动加圆角，尺寸由系统定，字略小于 any。
 */
const TARGETS = [
  // 192 是很多启动器实际取用的尺寸，字要占得比 512 更满才不至于"缩在中间一小团"
  { name: "icon-192.png", size: 192, glyphScale: 0.70, ring: false },
  { name: "icon-512.png", size: 512, glyphScale: 0.60, ring: true },
  { name: "icon-maskable-512.png", size: 512, glyphScale: 0.46, ring: false },
  { name: "apple-touch-icon.png", size: 180, glyphScale: 0.64, ring: false },
];

/**
 * 字体必须以 base64 内嵌进 CSS。
 *
 * 踩过的坑：最初写 `src:url("file:///.../xxx.ttf")`，页面是 `page.setContent()`
 * 造出来的 about:blank 上下文，**无权读 file://**，字体静默不加载 →
 * 回退系统字体，渲染出「散勾三」三个普通汉字。不报错，看起来还挺像样，
 * 但根本不是减字。所以在 main() 里额外断言 document.fonts.check()。
 */
const FONT_DATA_URI = `data:font/ttf;base64,${readFileSync(FONT_PATH).toString("base64")}`;

/** 减字「散勾三」：散音前缀 + 勾三合体，是字体里确定能成字的组合 */
const GLYPH = "散勾三";

function buildHtml({ size, glyphScale, ring }) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @font-face {
    font-family: "JZ";
    src: url("${FONT_DATA_URI}") format("truetype");
    font-weight: normal;
    font-style: normal;
  }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${size}px; height: ${size}px;
    background: ${INK};
    display: flex; align-items: center; justify-content: center;
    position: relative; overflow: hidden;
  }
  /* 极淡的径向提亮，避免纯平底色在深色桌面上"糊"成一块 */
  body::after {
    content: ""; position: absolute; inset: 0;
    background: radial-gradient(circle at 50% 42%, rgba(201,169,110,0.10), transparent 68%);
  }
  ${
    ring
      ? `.ring { position: absolute; inset: ${Math.round(size * 0.06)}px;
            border: ${Math.max(1, Math.round(size * 0.005))}px solid ${GOLD_RING};
            border-radius: ${Math.round(size * 0.16)}px; }`
      : ""
  }
  .glyph {
    position: relative; z-index: 1;
    font-family: "JZ"; color: ${GOLD};
    line-height: 1; white-space: nowrap;
    /* 减字笔画细，加一点墨晕让它在小尺寸下不糊 */
    text-shadow: 0 0 ${Math.round(size * 0.012)}px rgba(216,189,134,0.45);
  }
</style></head>
<body>
  ${ring ? '<div class="ring"></div>' : ""}
  <div class="glyph" id="g">${GLYPH}</div>
</body></html>`;
}

async function main() {
  if (!existsSync(FONT_PATH)) {
    throw new Error(`找不到减字字体：${FONT_PATH}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  try {
    for (const target of TARGETS) {
      const page = await browser.newPage({
        viewport: { width: target.size, height: target.size },
        deviceScaleFactor: 1,
      });
      await page.setContent(buildHtml(target), { waitUntil: "load" });
      // 必须先触发一次 load 再等 ready，否则字体可能还没进 pending 集合
      await page.evaluate(async () => {
        await document.fonts.load('64px "JZ"');
        await document.fonts.ready;
      });
      const fontOk = await page.evaluate(() => document.fonts.check('64px "JZ"'));
      if (!fontOk) {
        throw new Error(
          "减字字体没加载成功（会静默回退系统字体，图标变成普通汉字）——检查 base64 内嵌是否被截断",
        );
      }

      // 自动缩放：减字是「部件并置」拼出来的，宽度不是 1em，
      // 靠固定 font-size 猜会一半出框一半留白，所以按实测尺寸反推。
      await page.evaluate(({ glyphScale }) => {
        const el = document.getElementById("g");
        const size = el.parentElement.getBoundingClientRect().width;
        const targetPx = size * glyphScale;
        let fs = size;
        for (let i = 0; i < 3; i++) {
          el.style.fontSize = `${fs}px`;
          const r = el.getBoundingClientRect();
          const ratio = Math.min(targetPx / r.width, targetPx / r.height);
          if (Math.abs(ratio - 1) < 0.005) break;
          fs *= ratio;
        }
      }, target);

      const out = join(OUT_DIR, target.name);
      // viewport 已经就是目标尺寸，直接截全页即可（不要传 clip，免得尺寸漂）
      await page.screenshot({ path: out });
      await page.close();
      console.log(`✓ ${target.name}  ${target.size}×${target.size}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`\n输出目录：${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
