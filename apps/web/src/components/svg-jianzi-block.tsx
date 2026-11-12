"use client";

import type { JianziState } from "@/lib/types";
import { SVG_PATHS } from "@/lib/svg-paths";
import { fenToGlyph, isInlineMark } from "@/lib/jianzi";

// ── mapped into svg path keys ──────────────────

const HUI_MAP: Record<string, string> = {
  "一": "hui_1", "二": "hui_2", "三": "hui_3", "四": "hui_4", "五": "hui_5",
  "六": "hui_6", "七": "hui_7", "八": "hui_8", "九": "hui_9", "十": "hui_10",
  "十一": "hui_11", "十二": "hui_12", "十三": "hui_13",
};

const FEN_MAP: Record<string, string> = {
  "半": "fen_ban",
  "三分": "fen_3",
  "六分": "fen_6",
  "八分": "fen_8",
};

const LEFT_FINGER_MAP: Record<string, string | null> = {
  "大": "lh_da", "夕": "lh_ming", "名": "lh_ming",
  "中": "lh_zhong", "亻": null, "跪": "lh_gui",
};

/**
 * 右手指法 → SVG 字形键。
 *
 * 导出供契约测试使用：键盘新增指法时若忘记在此登记，
 * 字体 GSUB 分支仍能渲染，但 SVG 降级分支（泛音等）会静默渲染空白。
 */
export const RIGHT_ACTION_MAP: Record<string, string | null> = {
  "勾": "rh_gou", "勹": "rh_gou",
  "挑": "rh_tiao", "乚": "rh_tiao",
  "抹": "rh_mo", "木": "rh_mo",
  "托": "rh_tuo", "乇": "rh_tuo",
  "打": "rh_da", "丁": "rh_da",
  "擘": "rh_pi", "劈": "rh_pi", "尸": "rh_pi",
  "摘": "rh_zhai", "倽": "rh_zhai",
  "剔": "rh_ti",
  // 复合指法（双指法连字）——字体 GSUB 原生支持，SVG 降级时同样可渲染
  "抹挑": "rh_motiao",
  "勾剔": "rh_gouti",
  "抹勾": "rh_mogou",
  "打摘": "rh_dazhai",
  // 成块单指法（字体内折成块，GSUB 单字替换已核验真身）：
  // 轮/锁/涓/历/拂 有对应 lgw_*/lg_* 部件；蠲/剌 字体 cmap→placeholder 且无 GSUB 规则，不接入（rh_juan 复用涓字形）。
  "轮": "rh_lun",
  "锁": "rh_suo",
  "涓": "rh_juan",
  "历": "rh_li",
  "拂": "rh_fu",
  // 成块复合指法（GSUB 连字 lgw_* 已核验真身、有轮廓）：
  // 单字 拨/跪/撮/大撮/反撮 经渲染闸门实测按音块宽 1.533~2.0em（超 1em 方块），故不接；
  // 半蠲/反蠲/连蠲 因 蠲 是 placeholder 连锁缺口，不接入。
  "半扶": "rh_banfu",
  "长锁": "rh_changsuo",
  "短锁": "rh_duansuo",
  "背锁": "rh_beisuo",
  "圆锁": "rh_yuansuo",
  "半涓": "rh_banjuan",
  "反涓": "rh_fanjuan",
  "叠涓": "rh_diejuan",
  "连涓": "rh_lianjuan",
};

const STRING_MAP: Record<string, string> = {
  "一": "str_1", "二": "str_2", "三": "str_3", "四": "str_4",
  "五": "str_5", "六": "str_6", "七": "str_7",
};

/**
 * 装饰记号 → SVG 字形键，21 个必须全覆盖。
 *
 * 导出供契约测试使用：漏登记一个，字体 GSUB 分支仍能渲染，
 * 但 SVG 降级分支（泛音 / 打摘 / 两字徽位+分 / 抹+记号）会**静默空白**。
 *
 * 内折 3 个（绰/注/急）压在分数后、右手法前；吟猱族 18 个挂字尾右下，
 * 两类共用不上同一个槽位——`isInlineMark` 决定落哪一处。
 */
export const SLIDE_MAP: Record<string, string> = {
  "绰": "mod_chuo", "注": "mod_zhu", "急": "mod_ji",
  "吟": "mod_yin", "猱": "mod_nao",
  "绰吟": "mod_chuoyin", "绰猱": "mod_chuonao",
  "注吟": "mod_zhuyin", "注猱": "mod_zhunao",
  "细吟": "mod_xiyin", "细猱": "mod_xinao",
  "游吟": "mod_youyin", "游猱": "mod_younao",
  "荡吟": "mod_dangyin", "荡猱": "mod_dangnao",
  "飞吟": "mod_feiyin", "飞猱": "mod_feinao",
  "圆吟": "mod_yuanyin", "圆猱": "mod_yuanniao",
  "定吟": "mod_dingyin", "定猱": "mod_dingnao",
};

// ── glyph rendering helper ────────────────────

interface BBox {
  xMin: number; yMin: number; xMax: number; yMax: number;
}

/*
 * 将字体坐标系中的 glyph path（y 轴向上）映射到 SVG 坐标系（y 轴向下）。
 * 字体提取的 SVG path 使用 font coordinate space（原点在左下），
 * 而 SVG viewBox 的原点在左上，因此需要 y 翻转 + 平移。
 */
function GlyphSVG({ d, bbox }: { d: string; bbox: BBox }) {
  const w = bbox.xMax - bbox.xMin;
  const h = bbox.yMax - bbox.yMin;
  if (w <= 0 || h <= 0) return null;
  return (
    <svg
      viewBox={`${bbox.xMin} 0 ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full"
    >
      <g transform={`scale(1, -1) translate(0, ${-bbox.yMax})`}>
        <path d={d} fill="#1c1b1a" />
      </g>
    </svg>
  );
}

// ── main component ─────────────────────────────

/**
 * SVG 四象限减字块（CSS 绝对定位版）。
 *
 * 完全绕过字体 GSUB，用积木式 SVG path 手动装配减字布局。
 *
 * 降级条件（由 JianziBlock 父组件判定）：
 *   toneType === "泛" || ["打", "摘"].includes(rightAction)
 */
export function SvgJianziBlock({
  state,
  fontSize = "36px",
  compact,
}: {
  state: JianziState;
  fontSize?: string;
  compact?: boolean;
}) {
  const toneType = compact ? null : state.toneType;
  const leftFinger = toneType !== "散" ? state.leftFinger : null;
  const hui = toneType !== "散" ? state.hui : null;
  const fen = toneType !== "散" ? state.fen : null;

  const topKey = toneType === "泛" ? "top_fan" : toneType === "散" ? "top_san" : null;
  const lhKey = leftFinger ? LEFT_FINGER_MAP[leftFinger] ?? null : null;
  const huiKey = hui ? HUI_MAP[hui] : null;
  const fenKey = fen ? FEN_MAP[fen] : null;
  // 装饰记号：泛音滑不动（一滑就脱离徽位节点），只给按音画；
  // 绰/注/急 三个字形共用字体里的同一个槽位，SVG 用同一处槽位落下
  const slideKey =
    toneType !== "泛" && state.slide
      ? SLIDE_MAP[state.slide] ?? null
      : null;
  /** 吟猱族在字体里挂字尾（右下小字），SVG 也照此摆，不能塞进内折槽。 */
  const isTailSlide = Boolean(state.slide && !isInlineMark(state.slide));
  const actionKey = state.rightAction ? RIGHT_ACTION_MAP[state.rightAction] ?? null : null;
  /** 抹（木）不是半包围外壳：字体把弦序排在木的下方，不在木的肚子里。 */
  const isFlatAction = actionKey === "rh_mo";
  const strKey = state.stringNumber ? STRING_MAP[state.stringNumber] : null;

  const topEntry = topKey ? SVG_PATHS[topKey] : null;
  const lhEntry = lhKey ? SVG_PATHS[lhKey] : null;
  const huiEntry = huiKey ? SVG_PATHS[huiKey] : null;
  const fenEntry = fenKey ? SVG_PATHS[fenKey] : null;
  const slideEntry = slideKey ? SVG_PATHS[slideKey] : null;
  const actionEntry = actionKey ? SVG_PATHS[actionKey] : null;
  const strEntry = strKey ? SVG_PATHS[strKey] : null;

  // 左手指法 亻 无 svg path -> 用系统楷体回退
  const textFinger: string | null =
    leftFinger && !lhEntry ? (leftFinger === "亻" ? "食" : leftFinger) : null;

  const hasAnything =
    topEntry || lhEntry || huiEntry || fenEntry || slideEntry || actionEntry || strEntry || textFinger;
  if (!hasAnything) return null;

  // fontSize may contain "px" like "36px" or "24px"
  const numPx = parseFloat(fontSize);

  return (
    <div
      className="relative inline-flex items-center justify-center select-none"
      style={{ width: numPx, height: numPx * 1.4 }}
    >
      {/* ── 顶帽（音色标记） ──
          原 44%×16% 是 1.96 的扁槽：「散」字形 1.95 撑满(99%)、「泛」1.02 只填 52%，
          两者视觉大小差一倍。收窄加高到 1.43 后散/泛填充率约 73%/71%，大小趋一致。 */}
      {topEntry?.bbox && (
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{ top: "2%", width: "38%", height: "19%" }}
        >
          <GlyphSVG d={topEntry.d} bbox={topEntry.bbox} />
        </div>
      )}

      {/* ── 左手指法（左上象限） ──
          「注」是三点水，字体把它排在谱字左沿、把「大」整体右移让位。
          SVG 里靠这里让槽：有注时左手指法缩一点、往右挪，给三点水腾出左沿。 */}
      {lhEntry?.bbox && (
        <div
          className="absolute"
          style={
            state.slide === "注" && toneType !== "泛"
              ? { top: "17%", left: "15%", width: "30%", height: "24%" }
              : { top: "17%", left: "3%", width: "34%", height: "24%" }
          }
        >
          <GlyphSVG d={lhEntry.d} bbox={lhEntry.bbox} />
        </div>
      )}
      {textFinger && (
        <span
          className="absolute"
          style={{
            top: "28%",
            left: "18%",
            transform: "translate(-50%, -50%)",
            fontSize: numPx * 0.28,
            fontFamily: "'KaiTi', 'STKaiti', 'Noto Serif SC', serif",
            color: "#1c1b1a",
            lineHeight: 1,
          }}
        >
          {textFinger}
        </span>
      )}

      {/* ── 徽位（右上象限） ── */}
      {huiEntry?.bbox && (
        <div
          className="absolute"
          style={{ top: "17%", right: "3%", width: "34%", height: "22%" }}
        >
          <GlyphSVG d={huiEntry.d} bbox={huiEntry.bbox} />
        </div>
      )}

      {/* ── 分位（徽位下方） ──
          槽位宽高比需贴近字形本身（约 0.74 竖长）：原 26%×9% 是 2.06 的扁槽，
          preserveAspectRatio=meet 等比缩放后填充率仅 38%，分位被压得极小。 */}
      {fenEntry?.bbox && (
        <div
          className="absolute"
          style={{ top: "38%", right: "3%", width: "11%", height: "12%" }}
        >
          <GlyphSVG d={fenEntry.d} bbox={fenEntry.bbox} />
        </div>
      )}
      {/* 有分位但没抽到对应字形（一分/二分/四分/五分/七分/九分）时用文字兜底，
          否则这些微分在泛音/打摘分支会静默丢掉分数，谱面记错音位。 */}
      {fen && !fenEntry && (
        <span
          className="absolute"
          style={{
            top: "44%",
            right: "3%",
            fontSize: numPx * 0.2,
            fontFamily: "'KaiTi', 'STKaiti', 'Noto Serif SC', serif",
            color: "#1c1b1a",
            lineHeight: 1,
          }}
        >
          {fenToGlyph(fen)}
        </span>
      )}

      {/* ── 内折装饰记号（绰/注/急） ──
          字体把这些笔画用 GPOS 压在谱字块里：绰是夹在「大」和徽位之间的一个短竖，
          注是沿左沿排开的三点水，急是同一位置的横折（与绰同槽）。
          SVG 没有 GPOS，位置靠这里的槽位给。
          槽宽高比贴着字形本身（绰 226×213≈1.06、急 274×218≈1.26、注 223×670≈0.33），
          扁槽会让 preserveAspectRatio=meet 把字形缩得很小。 */}
      {slideEntry?.bbox && !isTailSlide && (
        <div
          className="absolute"
          style={
            state.slide === "注"
              ? { top: "14%", left: "0%", width: "21%", height: "48%" }
              : { top: "28%", left: "30%", width: "22%", height: "16%" }
          }
        >
          <GlyphSVG d={slideEntry.d} bbox={slideEntry.bbox} />
        </div>
      )}

      {/* ── 挂尾装饰记号（吟猱族 18 个） ──
          字体把它们排成谱字右下的一枚小字（实测约 0.33em 见方，
          「大九六勾四细吟」是 1em 方块 + 右侧小字；塞进内折槽会散成 1.5em）。
          字形本身接近方形（约 320×350），槽也按近方形给，别用扁槽压小。 */}
      {slideEntry?.bbox && isTailSlide && (
        <div
          className="absolute"
          style={{ bottom: "4%", right: "0%", width: "24%", height: "20%" }}
        >
          <GlyphSVG d={slideEntry.d} bbox={slideEntry.bbox} />
        </div>
      )}

      {/* ── 右手（下半部） ──
          勾/挑/劈/打/摘 是半包围外壳，弦序嵌在壳里；
          「抹」（木）不是包围结构——字体把木排在中间、弦序排在它**下面**，
          所以抹要收窄让出底部，否则「四」会被木的撇捺压掉。 */}
      {actionEntry?.bbox && (
        <div
          className="absolute"
          style={
            isFlatAction
              ? { bottom: "19%", left: 0, width: "100%", height: "42%" }
              : { bottom: "1%", left: 0, width: "100%", height: "56%" }
          }
        >
          <GlyphSVG d={actionEntry.d} bbox={actionEntry.bbox} />
        </div>
      )}

      {/* ── 弦序（嵌入右手壳内；抹时排在木下方） ── */}
      {strEntry?.bbox && actionEntry && (
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={
            isFlatAction
              ? { bottom: "0%", width: "32%", height: "17%" }
              : { bottom: "19%", width: "28%", height: "20%" }
          }
        >
          <GlyphSVG d={strEntry.d} bbox={strEntry.bbox} />
        </div>
      )}
      {strEntry?.bbox && !actionEntry && (
        <div
          className="absolute left-1/2 -translate-x-1/2"
          style={{ bottom: "22%", width: "38%", height: "28%" }}
        >
          <GlyphSVG d={strEntry.d} bbox={strEntry.bbox} />
        </div>
      )}
    </div>
  );
}
