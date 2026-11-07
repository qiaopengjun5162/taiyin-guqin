/**
 * 生成对外介绍用的竖版说明图（docs/assets/pitch-card.png）。
 *
 * 为什么单独做一张图：`docs/pitch.md` 是给「说」用的，但真正发出去时
 * 对方需要一张能在微信里一眼看懂的东西。文字话术 + 一张图才成套。
 *
 * 内容只讲一件事：**一个减字 = 四个动作**，所以写谱难；我们把这条链接上。
 * 所有表述都对着已上线功能，口径红线见 docs/pitch.md 第七节。
 *
 * 用法（在仓库根目录）：
 *   node apps/web/scripts/generate-pitch-card.mjs
 *
 * 和 generate-icons.mjs 一样，是**低频**脚本，不挂进 build（CI 不装浏览器）。
 */
import { chromium } from "playwright";
import { mkdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(WEB_ROOT, "../..");
const FONT_PATH = join(WEB_ROOT, "public/fonts/WangJiJianZiPuKaiTi.ttf");
const OUT_DIR = join(REPO_ROOT, "docs/assets");
const OUT_FILE = join(OUT_DIR, "pitch-card.png");

/** 与 src/app/globals.css 的 :root 保持一致 */
const PAPER = "#f5efe6";
const INK = "#1c1b1a";
const ZHU = "#c23b22";
const MUTED = "#6b6560";
const FAINT = "#a89e90";

/**
 * 减字「大九勾四」= 左手大指 + 九徽 + 右手勾 + 第四弦。
 * 选它而不是别的：四个部件互不重复、读法能一句话讲清，最适合当教学示例。
 * 布局规律：上半左手（指法 + 徽位），下半右手（指法 + 弦次）。
 */
const GLYPH = "大九勾四";

/**
 * 字体必须 base64 内嵌。踩过的坑：`page.setContent()` 是 about:blank 上下文，
 * 无权读 file://，字体静默不加载 → 回退系统字体，渲染出四个普通汉字，
 * 不报错还挺像样。所以下面额外断言 document.fonts.check()。
 */
const FONT_DATA_URI = `data:font/ttf;base64,${readFileSync(FONT_PATH).toString("base64")}`;

const W = 1080;
const H = 1440;

const HTML = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @font-face {
    font-family: "JZ";
    src: url("${FONT_DATA_URI}") format("truetype");
    font-weight: normal; font-style: normal;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${W}px; height: ${H}px; }
  body {
    background: ${PAPER};
    font-family: "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif;
    color: ${INK};
    position: relative; overflow: hidden;
    padding: 62px 84px;
    display: flex; flex-direction: column;
  }
  /* 宣纸肌理：极淡的径向渐变 + 细噪点，避免大面积纯色显得"是 PPT" */
  body::before {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background:
      radial-gradient(circle at 22% 8%, rgba(201,169,110,0.13), transparent 46%),
      radial-gradient(circle at 88% 96%, rgba(194,59,34,0.07), transparent 42%);
  }
  .layer { position: relative; z-index: 1; }

  /* ── 眉标 ── */
  .eyebrow {
    display: flex; align-items: center; gap: 16px;
    font-size: 25px; letter-spacing: 0.34em; color: ${MUTED};
  }
  .eyebrow .seal {
    width: 40px; height: 40px; background: ${ZHU}; color: ${PAPER};
    display: flex; align-items: center; justify-content: center;
    font-size: 23px; letter-spacing: 0; border-radius: 5px;
  }
  .rule { height: 1px; background: linear-gradient(90deg, rgba(28,27,26,0.28), transparent); margin: 26px 0 44px; }

  /* ── 标题 ── */
  h1 { font-size: 67px; line-height: 1.24; font-weight: 600; letter-spacing: 0.01em; }
  h1 em { font-style: normal; color: ${ZHU}; }
  .sub { margin-top: 20px; font-size: 30px; line-height: 1.62; color: ${MUTED}; letter-spacing: 0.01em; }

  /* ── 减字卡 ── */
  .card {
    margin-top: 34px; padding: 36px 44px 34px;
    background: rgba(255,253,248,0.9);
    border: 1px solid rgba(201,169,110,0.42);
    border-radius: 20px;
    display: flex; align-items: center; gap: 44px;
  }
  .glyph-box {
    flex: 0 0 auto; position: relative; padding: 12px 16px; margin-right: 16px;
    display: flex; align-items: center; justify-content: center;
  }
  .glyph-box::after {
    content: ""; position: absolute; inset: -16px -20px;
    border: 1.5px dashed rgba(201,169,110,0.85); border-radius: 14px;
  }
  .glyph-box .one {
    position: absolute; top: -30px; left: 4px; z-index: 2;
    padding: 0 10px; background: rgba(255,253,248,0.98);
    font-size: 20px; letter-spacing: 0.14em; color: #8a8078;
  }
  .glyph {
    font-family: "JZ"; color: ${INK}; line-height: 1; white-space: nowrap;
  }
  .readout { flex: 1 1 auto; }
  .readout .big {
    display: flex; flex-wrap: wrap; align-items: baseline;
    gap: 0 12px; font-size: 33px; line-height: 1.42; letter-spacing: 0.02em;
  }
  .readout .big b { color: ${ZHU}; font-weight: 600; font-style: normal; }
  .readout .big .dot { color: ${FAINT}; }
  .parts { margin-top: 22px; display: grid; grid-template-columns: 1fr 1fr; gap: 13px 20px; }
  .part { display: flex; align-items: baseline; gap: 11px; font-size: 25px; color: ${MUTED}; }
  .part i {
    font-style: normal; font-size: 25px; font-weight: 600; color: ${ZHU};
    min-width: 34px; height: 34px; line-height: 34px; text-align: center;
    background: rgba(194,59,34,0.08); border-radius: 7px;
  }
  .part s { text-decoration: none; color: ${FAINT}; font-size: 23px; }

  /* ── 过去 / 现在 ── */
  .split { margin-top: 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 26px; }
  .pane { padding: 28px 30px 30px; border-radius: 16px; }
  .pane.old { background: rgba(28,27,26,0.045); border: 1px solid rgba(28,27,26,0.09); }
  .pane.now { background: rgba(194,59,34,0.06); border: 1px solid rgba(194,59,34,0.24); }
  .pane .tag { font-size: 22px; letter-spacing: 0.22em; margin-bottom: 16px; }
  .pane.old .tag { color: ${FAINT}; }
  .pane.now .tag { color: ${ZHU}; }
  .pane li { list-style: none; font-size: 24px; line-height: 1.86; color: ${MUTED}; letter-spacing: -0.005em; }
  .pane.now li { color: ${INK}; }
  .pane li::before { content: "·"; margin-right: 10px; color: ${FAINT}; }
  .pane.now li::before { color: ${ZHU}; }

  /* ── 四个出口 ── */
  .outs { margin-top: 30px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .out { text-align: center; padding: 22px 8px 20px; border-top: 2px solid rgba(201,169,110,0.55); }
  .out .k { font-size: 30px; font-weight: 600; }
  .out .v { margin-top: 9px; font-size: 21px; color: ${MUTED}; line-height: 1.5; }

  /* ── 收尾 ── */
  .foot { margin-top: auto; padding-top: 26px; }
  .foot .line { font-size: 31px; line-height: 1.62; font-weight: 500; }
  .foot .line b { color: ${ZHU}; font-weight: 600; }
  .foot .meta {
    margin-top: 20px; padding-top: 20px;
    border-top: 1px solid rgba(28,27,26,0.2);
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 23px; color: ${FAINT}; letter-spacing: 0.04em;
  }
</style></head>
<body>
  <div class="layer eyebrow">
    <span class="seal">音</span><span>太音 · 古琴谱工具</span>
  </div>
  <div class="rule layer"></div>

  <h1 class="layer">古琴谱不是音符，<br>是<em>动作指令</em>。</h1>
  <div class="sub layer">所以写谱一直是苦活——一个方块里，要同时说清四件事。</div>

  <div class="card layer">
    <div class="glyph-box"><span class="one">一个字</span><div class="glyph" id="g">${GLYPH}</div></div>
    <div class="readout">
      <div class="big"><b>大指按九徽</b><span class="dot">·</span><b>食指勾第四弦</b></div>
      <div class="parts">
        <div class="part"><i>大</i><span>左手 · 大指</span></div>
        <div class="part"><i>九</i><span>按在九徽</span></div>
        <div class="part"><i>勾</i><span>右手 · 食指勾</span></div>
        <div class="part"><i>四</i><span>第四弦</span></div>
      </div>
    </div>
  </div>

  <div class="split layer">
    <div class="pane old">
      <div class="tag">过去</div>
      <ul>
        <li>装 Windows 软件 + 专用字体</li>
        <li>Word 里换字体就乱码</li>
        <li>只负责「写」，不出声、不排版</li>
      </ul>
    </div>
    <div class="pane now">
      <div class="tag">现在</div>
      <ul>
        <li>打开网页就能用，手机也行</li>
        <li>输简谱，自动翻成带指法的谱</li>
        <li>整首能播，能慢练，能导出</li>
      </ul>
    </div>
  </div>

  <div class="outs layer">
    <div class="out"><div class="k">能弹</div><div class="v">自动排指法<br>按手怎么挪省力</div></div>
    <div class="out"><div class="k">能听</div><div class="v">整首出声<br>不用上琴</div></div>
    <div class="out"><div class="k">能打印</div><div class="v">存图 / PDF<br>进课件教材</div></div>
    <div class="out"><div class="k">能带走</div><div class="v">PNG · SVG<br>WAV · MIDI</div></div>
  </div>

  <div class="foot layer">
    <div class="line">输入法只管「打字」。我们管<b>从一张谱，到能弹、能听、能发</b>。</div>
    <div class="meta">
      <span>零安装 · 可添加到主屏 · 断网也能开</span>
      <span>qiaopengjun5162.github.io/taiyin-guqin</span>
    </div>
  </div>
</body></html>`;

async function main() {
  if (!existsSync(FONT_PATH)) throw new Error(`找不到减字字体：${FONT_PATH}`);
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ args: ["--no-proxy-server"] });
  try {
    const page = await browser.newPage({
      viewport: { width: W, height: H },
      deviceScaleFactor: 2,
    });
    await page.setContent(HTML, { waitUntil: "load" });

    await page.evaluate(async () => {
      await document.fonts.load('64px "JZ"');
      await document.fonts.ready;
    });
    const fontOk = await page.evaluate(() => document.fonts.check('64px "JZ"'));
    if (!fontOk) {
      throw new Error(
        "减字字体没加载成功——会静默回退系统字体，图上的减字变成四个普通汉字。检查 base64 内嵌。",
      );
    }

    /**
     * 减字是「部件并置」拼出来的，宽度不是 1em：固定 font-size 会一半出框一半留白。
     * 这里按实测外框反推字号，目标高度占卡片高的约 78%。
     */
    await page.evaluate(() => {
      const el = document.getElementById("g");
      const target = 168; // px，视觉调试值
      let fs = 260;
      for (let i = 0; i < 5; i++) {
        el.style.fontSize = `${fs}px`;
        const r = el.getBoundingClientRect();
        const ratio = Math.min(target / r.width, target / r.height);
        if (Math.abs(ratio - 1) < 0.004) break;
        fs *= ratio;
      }
    });

    // 溢出检查：任何一块内容跑到画布外，说明文案太长，必须改而不是硬截
    const overflow = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll(".layer, .layer *")) {
        const r = el.getBoundingClientRect();
        if (r.bottom > window.innerHeight + 1 || r.right > window.innerWidth + 1) {
          out.push(`${el.className || el.tagName} bottom=${Math.round(r.bottom)}`);
        }
      }
      return out.slice(0, 5);
    });
    if (overflow.length) throw new Error(`内容溢出画布：\n${overflow.join("\n")}`);

    await page.screenshot({ path: OUT_FILE });
    await page.close();

    const kb = Math.round(statSync(OUT_FILE).size / 1024);
    console.log(`✓ ${OUT_FILE}  ${W}×${H}@2x  ${kb}KB`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
