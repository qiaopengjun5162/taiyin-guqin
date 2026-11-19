import type { Metadata } from "next";
import Link from "next/link";
import { RAPID_CHEATSHEET } from "@/lib/client";
import { BackToTop } from "@/components/page-chrome";

export const metadata: Metadata = {
  title: "减字谱 · 太音科普 | 古琴（七弦琴）减字谱",
  description:
    "古琴又称七弦琴、琴，是我国最早的弹拨乐器。减字谱由唐末曹柔创立，从文字谱演化而来，只记演奏法与音高、不记节奏；这里讲一个减字如何拆读，以及太音如何把它数字化。",
};

const INTRO: string[] = [
  "减字谱，又称古琴指法谱，是以记写指位与左右手演奏技法为特征的记谱法。",
  "它将古琴文字谱中的指法、术语，截取其较具特点的部分组合而成，故名「减字谱」。",
  "减字谱由唐末琴家曹柔创立，由文字谱演化而来；只记录演奏法与音高，不记录音名、节奏，特点是「字简而义尽，文约而音赅」。",
  "它是对文字谱记谱法的一次重大改革，沿用千年而未被取代。",
];

const GLYPHS: { label: string; pos: string; meaning: string }[] = [
  { label: "夕", pos: "左上角", meaning: "左手无名指" },
  { label: "大", pos: "左上角", meaning: "左手大指" },
  { label: "中", pos: "左上角", meaning: "左手中指" },
  { label: "亻", pos: "左上角", meaning: "左手食指" },
  { label: "足", pos: "左上角", meaning: "跪指（无名指卷曲）" },
  { label: "徽位", pos: "右上角", meaning: "十三徽及徽分（标明按弦位置）" },
  { label: "乚", pos: "旁部", meaning: "右手指法：食指「挑」" },
  { label: "勹", pos: "旁部", meaning: "右手指法：中指「勾」" },
  { label: "绰", pos: "旁部", meaning: "走手音：按音从本位下方滑上来（只用于按音）" },
  { label: "注", pos: "旁部", meaning: "走手音：按音从本位上方向下滑下来（只用于按音）" },
  { label: "大写数字", pos: "下半部", meaning: "弦数（七弦，写几即第几弦）" },
];

/**
 * 十三徽：从岳山起算、占全弦长的分数。
 *
 * 这些比例决定按音的音高（把弦按在实际位置，有效弦长缩短，频率随之升高），
 * 也是「同一徽位」在七根弦上音程相同的根本原因。
 *
 * 数值与 `src/lib/jianzi-pitch.ts` 的 `HUI_FRACTION` 一一对应；
 * 那一份是功能实现（算频率用），这里是给人看的分数写法。
 * 两侧由 `scripts/verify-domain-contracts.mjs` 的徽位契约守着不许漂。
 *
 * 一徽在岳山附近、十三徽近龙龈；七徽正好是中点，所以是 1/2——
 * 这也是七徽按音比空弦高整整八度的原因。
 */
const HUI_TABLE: { hui: string; ratio: string }[] = [
  { hui: "一徽", ratio: "1/8" },
  { hui: "二徽", ratio: "1/6" },
  { hui: "三徽", ratio: "1/5" },
  { hui: "四徽", ratio: "1/4" },
  { hui: "五徽", ratio: "1/3" },
  { hui: "六徽", ratio: "2/5" },
  { hui: "七徽", ratio: "1/2" },
  { hui: "八徽", ratio: "3/5" },
  { hui: "九徽", ratio: "2/3" },
  { hui: "十徽", ratio: "3/4" },
  { hui: "十一徽", ratio: "4/5" },
  { hui: "十二徽", ratio: "5/6" },
  { hui: "十三徽", ratio: "7/8" },
];

export default function JianzipuPage() {
  return (
    <main className="flex flex-col items-center min-h-dvh py-10 px-4 xl:px-6 xl:mt-6">
      {/* ── 品牌：朱砂印章 ── */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex items-center justify-center w-20 h-20 rounded-full border-[3px] border-[var(--vermillion)]/50 shadow-xl shadow-[var(--vermillion)]/5">
          <span
            className="text-2xl font-black tracking-[0.1em] text-[var(--vermillion)]/85 select-none ink-bleed font-calligraphy"
          >
            减字谱
          </span>
        </div>
        <div className="text-center">
          <h1
            className="text-sm font-bold tracking-[0.4em] text-amber-100/80 leading-relaxed"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            古琴 · 指法谱 · 科普
          </h1>
          <p className="mt-1 text-[10px] tracking-[0.25em] text-amber-600/40">
            字简而义尽 · 文约而音赅
          </p>
        </div>
      </div>

      {/* 桌面按内容分两栏流；多栏会保持 DOM 顺序（先上后下、先左后右），手机仍单列 */}
      <div className="mt-4 w-full max-w-md xl:columns-2 xl:gap-6 xl:max-w-[1040px]">
      {/*
       * ── 名称：琴 → 七弦琴 → 古琴 ──
       *
       * 放在最前：读者带着「古琴是什么」进来，先解决名字才谈得上谱。
       *
       * 很多人搜索用的是「七弦琴」，而全站此前一次都没出现这个词——
       * 既漏掉一个真实的认知入口，也让这一段源流无人知晓：
       * 它本来就叫「琴」，是因为胡琴、钢琴、月琴都借了这个字，
       * 才需要加限定语把「琴」和「借用琴字的乐器」分开。
       */}
      <section className="mt-4 w-full max-w-md xl:max-w-none break-inside-avoid rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <h2 className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            名字：琴 · 七弦琴 · 古琴
          </h2>
          <div className="space-y-3 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            <p>
              它本来只叫「<b className="text-amber-900">琴</b>」——七弦琴是我国民族乐器中最早的弹拨乐器之一，
              古人说「琴」时，指的就是它这一件，不必再加别的字。
            </p>
            <p>
              后来别的乐器纷纷借用了这个字：胡琴、月琴、钢琴、小提琴、口琴……
              「琴」从专名变成了一个类别词。于是琴本身也就不得不加上相当的限定词，
              来与其他乐器有所分别。
            </p>
            <p>
              <b className="text-amber-900">因为它有七条弦，所以就叫「七弦琴」</b>；
              <b className="text-amber-900">又因为它有着很古老的历史，也被人叫做「古琴」</b>。
              两个名字，说的都是那件本来只叫「琴」的乐器。
            </p>
            <p className="text-amber-800/70">
              本站在说「古琴」时，指的就是这件七弦的琴。
            </p>
          </div>
        </div>
      </section>

      {/* ── 什么是减字谱 ── */}
      <section className="mt-4 w-full max-w-md xl:max-w-none break-inside-avoid rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <h2 className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            什么是减字谱
          </h2>
          <div className="space-y-3 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            {INTRO.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      {/*
       * ── 琴的构造 · 琴体与弦数 ──
       *
       * 放在「琴上有什么」之前：先立起一个事实——**七弦不是从来就有的**。
       * 很容易让人以为「古琴自古就是七弦十三徽」，但考古实物不是这样：
       * 曾侯乙墓出的是十弦琴、五弦琴，郭店出过七弦琴，形制到汉代才逐步定型。
       *
       * 说清这一点有两层意义：
       * 1. 读者不会再拿今天的形制去想象两千年前的琴；
       * 2. 也解释了本工具为什么以七弦为基准——那是**定型后**的标准，不是唯一存在过的形态。
       */}
      <section className="mt-4 w-full max-w-md xl:max-w-none break-inside-avoid rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <h2 className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            琴的构造 · 琴体与弦数
          </h2>
          <div className="space-y-3 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            <p>
              <b className="text-amber-900">琴体</b>
              ：一整块木头挖出音箱——面板弧、底板平，头宽尾窄。
              弦从<b>岳山</b>起、跨过琴面、系于<b>龙龈</b>与<b>雁足</b>，
              左手在琴面按弦，右手在岳山一侧拨弦。
            </p>
            <p>
              <b className="text-amber-900">早期琴的形式和琴弦的多少，是没有一定的。</b>
              我们今天熟悉的「七弦十三徽」，是长期演变后才定下来的样子，不是它的起点。
            </p>
            <ul className="ml-4 list-disc space-y-1 text-[11px] text-[var(--ink-light)]">
              <li>
                1978 年湖北随县<b>曾侯乙墓</b>（约公元前 433 年）出土<b>十弦琴</b>一件，通长仅 67 厘米，
                琴箱只占琴身一半、另一半是实木，且无徽位——与今天的琴差别很大。
                <b>同墓还出一件五弦琴</b>，可见当时弦数并未统一。
              </li>
              <li>
                湖北荆门<b>郭店</b>等地出过<b>七弦琴</b>。可见战国时弦数并存，七弦只是其中一种。
              </li>
              <li>
                <b>至迟在汉代末年，琴已逐步完备定型</b>，形制与今天留存下来的琴式基本一致——
                从那以后，「七弦十三徽」才成了稳定的样子。
              </li>
            </ul>
            <p className="text-amber-800/70">
              本站以七弦为标准，因为减字谱成熟于七弦定型之后——
              谱面上的「几弦」指的是那七根。
            </p>
            {/*
             * 这一段是「为什么古谱今天还能弹」的答案，也是本工具成立的前提。
             *
             * 形制定型（上一段）说的是外形；这里说的是更关键的一点：
             * **结构与发声原理没大变**。七根弦、十三徽、按弦取音、轻触取泛音——
             * 一千多年前写下的「大九勾四」，今天照着弹仍然是那个音。
             *
             * 如果这条不成立，把老谱数字化就没有意义了。
             */}
            <p>
              <b className="text-amber-900">
                今琴的结构和发音原则，与古代没有很大的区别
              </b>
              ——同样是七弦十三徽、同样靠按弦长短与轻触取音。
              正因如此，一张千年前写下的谱，今天照着弹仍然是那个音；
              把老谱数字化才有意义。
            </p>
          </div>
        </div>
      </section>

      {/*
       * ── 琴上有什么：七弦 · 十三徽 · 三种音色 ──
       *
       * 放在「一个减字怎么读」之前是刻意的：减字里写的是「九徽」「五弦」「泛音」，
       * 读者如果不知道九徽在琴面的哪个位置、不知道泛音和按音的区别，
       * 那张拆解表只是把一组看不懂的字换成了另一组。
       *
       * 这些是读减字的**前置知识**，不是补充阅读。
       */}
      <section className="mt-4 w-full max-w-md xl:max-w-none break-inside-avoid rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <h2 className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            琴上有什么 · 七弦 · 十三徽 · 三种音色
          </h2>
          <div className="space-y-3 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            <p>
              <b className="text-amber-900">七弦</b>
              ：一弦最粗、七弦最细，一弦音最低、七弦音最高。
              减字最下面那个数字就是弦数——「四」即第四弦。
            </p>
            {/* 十三徽用比例说明，因为「几徽」在减字里就是按弦位置 */}
            <div>
              <p className="mb-2">
                <b className="text-amber-900">十三徽</b>
                ：琴面外侧嵌着的十三个圆点，标出按弦取音的位置。它们不是等距的——
                是弦长的整数分之一，所以徽位直接决定音高：
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-3">
                {HUI_TABLE.map((h) => (
                  <div key={h.hui} className="flex gap-1.5">
                    <span className="shrink-0 w-8 text-amber-700/60">{h.hui}</span>
                    <span className="text-[var(--ink-light)]">{h.ratio}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-amber-800/60">
                记「第几徽」即可，中间不到一个徽的细分叫「分」——如「九徽六分」。
              </p>
            </div>
            <p>
              <b className="text-amber-900">三种音色</b>：右指拨弦出声，左指怎么配合决定音色——
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                <b className="text-amber-900">散音</b>：左指不按弦，直接拨空弦，声音最沉、余音最长。
              </li>
              <li>
                <b className="text-amber-900">按音</b>：左指把弦按实在琴面上再拨，音高由徽位决定，余音可作绰注吟猱。
              </li>
              <li>
                <b className="text-amber-900">泛音</b>：左指轻触徽位而不压实，得清亮如钟磬的高八度音。
              </li>
            </ul>
            <p className="text-amber-800/70">
              减字里这三个字写不写，会改变整字的读法——所以下一节拆解时会先看它。
            </p>
          </div>
        </div>
      </section>

      {/* ── 一个减字怎么读 ── */}
      <section className="mt-4 w-full max-w-md xl:max-w-none break-inside-avoid rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <h2 className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            一个减字怎么读
          </h2>
          <p className="mb-4 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            以谱字「名十勾五」为例：左手无名指按五弦十徽，同时右手中指勾五弦得音。一个减字，可拆为上、下两部分来读——
          </p>
          <div className="space-y-2">
            {GLYPHS.map((g, i) => (
              <div
                key={i}
                className="flex items-baseline gap-3 text-[12px] leading-[1.8] text-[var(--ink-light)]"
              >
                <span className="shrink-0 w-14 text-center text-[var(--vermillion)] font-bold font-calligraphy">
                  {g.label}
                </span>
                <span className="shrink-0 w-12 text-[10px] tracking-wider text-amber-700/60">
                  {g.pos}
                </span>
                <span className="flex-1">{g.meaning}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 键盘速录：打字即打谱 ── */}
      <section className="mt-4 w-full max-w-md xl:max-w-none break-inside-avoid rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <h2 className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            打字即打谱 · 键盘速录
          </h2>
          <p className="mb-3 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            按减字的书写顺序打「音色 + 左手 + 徽位数字 + 分数 + 走手音 + 右手 + 弦数」，
            打满自动成字，不必碰鼠标。例：大九勾四 →{" "}
            <code className="text-[var(--vermillion)]">d9g4</code>；散勾三 →{" "}
            <code className="text-[var(--vermillion)]">sg3</code>；大九六分绰勾四 →{" "}
            <code className="text-[var(--vermillion)]">ad9f6cg4</code>。
          </p>
          <div className="space-y-1.5">
            {RAPID_CHEATSHEET.map((row) => (
              <div
                key={row.title}
                className="flex items-baseline gap-3 text-[12px] leading-[1.8] text-[var(--ink-light)]"
              >
                <span className="shrink-0 w-14 text-center text-[var(--vermillion)] font-bold font-calligraphy">
                  {row.title}
                </span>
                <span className="flex-1 text-[11px]">{row.text}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            反过来也通：把码整段粘回编辑器「减字码入谱」，就能还原成可播放、可导出的曲谱。
            同一串码，既是给眼睛看的注释，也是一份能搬运的存档。粘回时记得带上音色前缀——
            同一个「大九勾四」，按音是{" "}
            <code className="text-[var(--vermillion)]">ad9g4</code>，泛音是{" "}
            <code className="text-[var(--vermillion)]">fd9g4</code>；少了开头那个字母，
            按音与泛音就分不开了。节奏也一起搬：码后加{" "}
            <code className="text-[var(--vermillion)]">:8</code> 是八分音符，附点再加{" "}
            <code className="text-[var(--vermillion)]">.</code>，
            <code className="text-[var(--vermillion)]">r:4</code> 是四分休止。
          </p>
        </div>
      </section>

      {/* ── 减字谱 × 太音 ── */}
      <section className="mt-4 w-full max-w-md xl:max-w-none break-inside-avoid rounded-lg border border-amber-700/20 bg-[var(--paper)] shadow-xl shadow-black/30">
        <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-amber-700/40 via-[var(--vermillion)] to-amber-700/40" />
        <div className="p-5">
          <h2 className="mb-3 text-[10px] tracking-[0.3em] text-amber-700/60">
            减字谱 × 太音
          </h2>
          <div className="space-y-3 text-[12px] leading-[1.9] text-[var(--ink-light)]">
            <p>
              减字谱把「怎么弹」凝成一个方块字，是古琴传承千年的「规范」——恰如《乐论》所言「先王立乐之术」。
            </p>
            <p>
              但一个减字由十几个部件拼成，手写、录入门槛都不低。太音做的，是把这套拆字逻辑反过来：你选音色（散 / 泛 / 按）、点指法、点弦徽，编辑器实时拼出规范减字，并播放对应声音。
            </p>
            <p>
              学谱、记谱、演奏三步合一，让「字简而义尽」的千年智慧，在浏览器里活起来。
            </p>
          </div>
        </div>
      </section>
      </div>

      {/* ── 页脚：返回编辑器 ── */}
      <div className="no-print mt-8 flex flex-col items-center gap-2">
        <Link
          href="/yuelun"
          className="text-[11px] tracking-[0.15em] text-amber-700/40 hover:text-amber-100/70 transition-colors underline underline-offset-2"
        >
          乐论 · 《荀子》读书
        </Link>
        <Link
          href="/"
          className="text-[11px] tracking-[0.15em] text-amber-700/40 hover:text-amber-100/70 transition-colors underline underline-offset-2"
        >
          ← 回到减字谱编辑器
        </Link>
        <Link
          href="/zidian"
          className="text-[11px] tracking-[0.15em] text-amber-700/40 hover:text-amber-100/70 transition-colors underline underline-offset-2"
        >
          减字字典 · 字全表
        </Link>
      </div>
      <BackToTop />
    </main>
  );
}
