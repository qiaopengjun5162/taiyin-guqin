import type { JianziState, Duration, PitchSlide, SlideMark, NoteType } from "./types";

/**
 * 21 个装饰记号，**按长度降序**（两字复合在前、单字在后），供最长匹配。
 *
 * 顺序即正确性：「绰吟」若排在「绰」后面，`matchSlideMark("绰吟…")` 会先吃掉「绰」，
 * 剩下「吟…」既不是分数也不是指法，整条解析就废了。
 * 与 Rust `jianzi_code::SLIDE_TOKENS`、`jianzi-rapid.ts` 的 `TOKENS.slide` 同源，
 * 三处增删必须一起改（有契约测试守着）。
 */
export const SLIDE_MARKS: readonly SlideMark[] = [
  "绰吟", "绰猱", "注吟", "注猱", "细吟", "细猱", "游吟", "游猱",
  "荡吟", "荡猱", "飞吟", "飞猱", "圆吟", "圆猱", "定吟", "定猱",
  "绰", "注", "急", "吟", "猱",
];

/** 字体压在「分数后、右手法前」槽里的三个内折记号；其余 18 个挂字尾。 */
const INLINE_MARKS: ReadonlySet<SlideMark> = new Set<SlideMark>(["绰", "注", "急"]);

/** 记号走内折槽（true）还是挂字尾（false）。渲染与释义都按这个分。 */
export function isInlineMark(mark: SlideMark): boolean {
  return INLINE_MARKS.has(mark);
}

/** 在 s 开头最长匹配一个装饰记号；认不出返回 null。 */
function matchSlideMark(s: string): SlideMark | null {
  for (const mark of SLIDE_MARKS) {
    if (s.startsWith(mark)) return mark;
  }
  return null;
}

/** 判断减字是否已完成（各音色类型所需字段不同）。 */
export function isComplete(state: JianziState): boolean {
  // 散音：只需要右手指法和弦序
  if (state.toneType === "散") {
    return state.rightAction !== null && state.stringNumber !== null;
  }
  // 泛音、按音：需要左手指法 + 徽位 + 右手指法 + 弦序
  return (
    state.toneType !== null &&
    state.leftFinger !== null &&
    state.hui !== null &&
    state.rightAction !== null &&
    state.stringNumber !== null
  );
}

/** 创建空状态。 */
export function createEmptyState(): JianziState {
  return {
    toneType: null,
    rhythmMode: null,
    leftFinger: null,
    hui: null,
    fen: null,
    slide: null,
    rightAction: null,
    stringNumber: null,
  };
}

/**
 * 分位 → 字体拼装用的字形字符。
 *
 * 这是减字谱字体的一条硬规则：徽位后面的分数在**减字里只写数字**，
 * 不写「分」字——「七徽六分」的减字是「七」下压一个「六」。
 * 若把「六分」整串塞进去，字体找不到对应部件，整块会被撑开散架
 * （线上实测：选「六分」后「勹」被挤到格子外）。
 */
const FEN_GLYPH: Record<string, string> = {
  "一分": "一", "二分": "二", "三分": "三", "四分": "四", "五分": "五",
  "六分": "六", "七分": "七", "八分": "八", "九分": "九", "半": "半",
};

/** 分位取值 → 减字字形（找不到映射时退回去掉「分」字）。 */
export function fenToGlyph(fen: string): string {
  return FEN_GLYPH[fen] ?? fen.replace(/分$/, "");
}

/**
 * 左手指法 → 字体真正认得的字形字符。
 *
 * 传统减字里食指写「亻」（取"食"左半）、名指写「夕」（取"名"左半），
 * 键盘也是照这个给的按钮。但字体里**只有全字「食」「名」的连字**，
 * 偏旁字根本没有成字连字——实测「夕九勾四」散成 3em、「亻九勾四」3em，
 * 而「名九勾四」「食九勾四」都是整字 1em。
 * 所以序列化时统一换成全字；解析仍两种都收，老谱子照样能读回来。
 */
const LEFT_FINGER_GLYPH: Record<string, string> = {
  夕: "名",
  亻: "食",
};

/** 键盘显示字符 → 字体 GSUB 引擎期望的触发字符 */
const RIGHT_ACTION_GLYPH: Record<string, string> = {
  勹: "勾",
  木: "抹",
  乚: "挑",
  乇: "托",
  丁: "打",
  // 「擘」在字体里没有整字连字（实测「大九六擘四」散成 3em 的长串），
  // 「劈」有。两者在减字谱里是同一个指法的两种写法，统一交给「劈」渲染。
  尸: "劈",
  倽: "摘",
  剔: "剔",
  // 旧数据/粘贴文本里可能直接是「擘」
  擘: "劈",
};

/** 将减字状态序列化为忘机减字谱字体可渲染的文本 */
export function jianziToText(jianzi: JianziState): string {
  // 散音："散"作为左侧前缀，不参与主体连字组
  if (jianzi.toneType === "散") {
    let s = "散";
    if (jianzi.rightAction)
      s += RIGHT_ACTION_GLYPH[jianzi.rightAction] ?? jianzi.rightAction;
    if (jianzi.stringNumber) s += jianzi.stringNumber;
    return s;
  }

  let text = "";

  // 泛音：加空格阻断字体 GSUB 上下文劫持，使"泛"和后续指法独立渲染
  if (jianzi.toneType === "泛") {
    text += "泛 ";
  }

  if (jianzi.leftFinger)
    text += LEFT_FINGER_GLYPH[jianzi.leftFinger] ?? jianzi.leftFinger;
  if (jianzi.hui) text += jianzi.hui;
  if (jianzi.fen) text += fenToGlyph(jianzi.fen);
  // ⚠ 顺序是字体连字规则，不是排版偏好：
  //   「大九六绰勾四」拼成整字，写成「大九绰六勾四」就散成两串（实测 1em vs 2em）。
  //   所以分数必须在前，内折记号在后。
  const slide = jianzi.slide && jianzi.toneType !== "泛" ? jianzi.slide : null;
  if (slide && isInlineMark(slide)) text += slide;
  if (jianzi.rightAction)
    text += RIGHT_ACTION_GLYPH[jianzi.rightAction] ?? jianzi.rightAction;
  if (jianzi.stringNumber) text += jianzi.stringNumber;
  // 吟猱族必须挂在字尾：放进上面的内折槽会把整字劈成两坨
  // （实测「大九六吟勾四」1.5em），挂在弦序后是 1em 方块 + 右侧小字，才是传统写法。
  if (slide && !isInlineMark(slide)) text += slide;
  return text;
}

/** 已知的徽数字集：一～九 为单位数，十/十一/十二/十三 另判 */
const HUI_CHARS = new Set([
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
]);
/** 徽位后可能紧跟的分位数字（一分～九分 在减字里只写数字） */
const FEN_DIGITS = new Set(["一", "二", "三", "四", "五", "六", "七", "八", "九"]);
/** 弦序字符集 */
const STRING_CHARS = new Set(["一", "二", "三", "四", "五", "六", "七"]);
// 装饰记号的匹配统一走 matchSlideMark（21 个，两字复合优先）。
// 不再维护单字 Set：复合「细吟」按单字丢会残留「细」，把后面的弦序判死。

/**
 * 右手指法名，**按最长优先排列**，散音与按/泛音共用一份。
 *
 * 顺序即正确性：`勾剔` 必须排在 `勾` 前面，否则「散勾剔二」只吃掉一个「勾」，
 * 剩下的「剔二」既不是弦序也不是指法，整条就废了。
 * 曾经散音分支自己维护一份只有单指法的表，于是 `散勾剔二` 这类谱本常见写法
 * 解析出一个**缺弦序的半残状态**——识别面板按「非 null 即成功」统计，把它算成解析成功，
 * 到了播放时才因为没有弦序而静默不出声。合并成一份表就是为了不再出现第二份。
 *
 * 全字（勾）与偏旁（勹）并存的原因：键盘存偏旁，粘贴传统谱本存全字。
 */
const RIGHT_ACTION_NAMES = [
  "勾剔",
  "抹挑",
  "打摘",
  "抹勾",
  "仰托",
  "勾",
  "挑",
  "抹",
  "劈",
  "托",
  "剔",
  "打",
  "摘",
  "乇",
  "尸",
  "木",
  "乚",
  "勹",
  "丁",
  "倽",
];

/**
 * 装饰记号只存在于按音：散音是空弦、泛音要虚按徽位，都滑不动 / 谈不上急弹。
 * （实测字体里「散急勾四」也连不成整字，散成 1.33em。）
 */
export function canHaveSlide(toneType: NoteType | null): boolean {
  return toneType === "按";
}

/**
 * 只挑出会滑动音高的记号（绰/注）。
 *
 * 「急」是弹法记号，音高不动——把它混进滑音分支会把急弹当成注音弹，
 * 音高先高后落，等于弹错。所以音频链路一律过这道筛子。
 *
 * 吟猱族（含绰吟/注猱这类复合）一律返回 null：它们的吟猱成分不动音高，
 * 复合里的绰/注成分**暂不合成滑音**——这是已知的听感边界，
 * 宁可弹成直音，也不在未验证的合成路径上猜一个起音偏移量。
 * 录入 / 渲染 / 存档 / 读回不受影响，只是这一声暂时没有滑音。
 */
export function pitchSlide(slide: SlideMark | null): PitchSlide | null {
  return slide === "绰" || slide === "注" ? slide : null;
}

/** 将文本（如"大九勾四"）解析为减字状态 */
export function parseJianziText(text: string): JianziState | null {
  if (!text.trim()) return null;
  const result = createEmptyState();

  let remaining = text.trim();
  let idx = 0;

  // 1. 音色前缀
  if (remaining.startsWith("散")) {
    result.toneType = "散";
    idx = 1;
  } else if (remaining.startsWith("泛")) {
    result.toneType = "泛";
    idx = 1;
  } else {
    result.toneType = "按";
  }

  remaining = remaining.slice(idx).trim();

  // 散音：只需要右手指法 + 弦序
  if (result.toneType === "散") {
    /*
     * 散音不吃走手音/急弹（`canHaveSlide` 的判定），但粘贴来的谱本里常带一个「绰」。
     * 这里**丢掉记号继续解析**，不因为多一个记号整条失败：
     * 旧代码不丢也不解析，直接返回一个「没指法没弦」的空壳，比失败更糟。
     */
    // 反复最长匹配剥掉装饰记号：复合「细吟」是两字，按单字丢会残留「细」，
    // 把后面的弦序判死。散音吃不了记号，但粘贴来的谱本常带，丢了继续解析。
    let cleaned = "";
    while (remaining.length > 0) {
      const mark = matchSlideMark(remaining);
      if (mark) {
        remaining = remaining.slice(mark.length);
      } else {
        cleaned += remaining[0];
        remaining = remaining.slice(1);
      }
    }
    remaining = cleaned.trim();

    for (const name of RIGHT_ACTION_NAMES) {
      if (remaining.startsWith(name)) {
        result.rightAction = name;
        remaining = remaining.slice(name.length);
        break;
      }
    }
    // 剩下的就是弦序
    if (remaining && STRING_CHARS.has(remaining)) {
      result.stringNumber = remaining;
    }
    // 必须和按/泛音一样过 isComplete：上面那两条 if 都不成立时，
    // 返回的是一个「有指法没弦」的半残对象，调用方（识别面板）会当成解析成功。
    return isComplete(result) ? result : null;
  }

  // 2. 左手指法
  // 传统减字偏旁写法：亻 = 食指（取"食"左半）、夕 = 名指（取"名"左半）。
  // 与全字写法（食/名）一并支持，粘贴传统谱本时才不会解析失败。
  for (const name of ["大", "名", "夕", "中", "食", "亻", "跪"]) {
    if (remaining.startsWith(name)) {
      result.leftFinger = name;
      remaining = remaining.slice(name.length);
      break;
    }
  }

  // 3. 徽位数字
  //    十一/十二/十三 是两个字；其余是一位。不能贪心吃光连续数字，
  //    否则「大七六勾四」（七徽六分）会被读成徽位「七六」。
  let huiBuf = "";
  if (remaining.startsWith("十")) {
    const second = remaining[1];
    if (second === "一" || second === "二" || second === "三") {
      huiBuf = remaining.slice(0, 2);
      remaining = remaining.slice(2);
    } else {
      huiBuf = "十";
      remaining = remaining.slice(1);
    }
  } else if (remaining.length > 0 && HUI_CHARS.has(remaining[0])) {
    huiBuf = remaining[0];
    remaining = remaining.slice(1);
  }
  if (huiBuf) result.hui = huiBuf;

  // 4. 分
  //    减字里分数只写数字（七徽六分 → 「大七六勾四」），也兼容旧写法「六分」。
  //    两字徽位后可能带一个「徽」分隔字（见 jianziToText 的说明），先跳过。
  if (remaining.startsWith("徽")) remaining = remaining.slice(1);
  // 内折记号（绰/注/急）允许写在分数前或后：字体的连字规则只认「分数在前」，
  // 但人打字时按口语顺序（「大九绰六勾四」）来的更多，两处都接住，
  // 序列化时再统一排成字体要的顺序。吟猱族不写这里——它们挂字尾（第 6 步）。
  const inlineBefore = matchSlideMark(remaining);
  if (inlineBefore && isInlineMark(inlineBefore)) {
    result.slide = inlineBefore;
    remaining = remaining.slice(inlineBefore.length);
  }
  if (remaining.startsWith("半")) {
    result.fen = "半";
    remaining = remaining.slice(1);
  } else if (remaining.length > 0 && FEN_DIGITS.has(remaining[0])) {
    result.fen = `${remaining[0]}分`;
    remaining = remaining.slice(1);
    if (remaining.startsWith("分")) remaining = remaining.slice(1);
  }
  if (!result.slide) {
    const inlineAfter = matchSlideMark(remaining);
    if (inlineAfter && isInlineMark(inlineAfter)) {
      result.slide = inlineAfter;
      remaining = remaining.slice(inlineAfter.length);
    }
  }

  // 5. 右手指法
  for (const name of RIGHT_ACTION_NAMES) {
    if (remaining.startsWith(name)) {
      result.rightAction = name;
      remaining = remaining.slice(name.length);
      break;
    }
  }

  // 6. 弦序 + 挂字尾的吟猱族记号
  //    字体把吟猱族小字挂在弦序之后（「大九六勾四细吟」），内折记号走第 4 步的槽内。
  //    先把首字当弦序，剩下的尾缀必须**整段**是合法装饰记号：
  //    认不出、或槽里已经有记号了（一谱字只带一个），都判失败，别静默吞掉错字。
  let stringPart = remaining;
  let tailPart = "";
  if (remaining.length > 0 && STRING_CHARS.has(remaining[0])) {
    stringPart = remaining[0];
    tailPart = remaining.slice(1);
  }
  if (tailPart) {
    const tailMark = matchSlideMark(tailPart);
    if (!tailMark || tailMark.length !== tailPart.length || result.slide) return null;
    result.slide = tailMark;
  }
  if (stringPart && STRING_CHARS.has(stringPart)) {
    result.stringNumber = stringPart;
  }
  // 泛音是虚按徽位取泛音，滑不动也谈不上吟猱；写进来也不收，免得谱面和听感对不上
  if (result.toneType === "泛") result.slide = null;

  return isComplete(result) ? result : null;
}

/** 根据时值获取减时线数量 */
export function getRhythmLineCount(duration: Duration): number {
  switch (duration) {
    case "全":
    case "二分":
      return 0;
    case "四分":
      return 1;
    case "八分":
      return 2;
    case "十六分":
      return 3;
  }
}

/** 将时值转换为以四分音符为 1 拍的拍数；dotted 为附点（×1.5）。 */
export function durationToBeats(duration: Duration, dotted = false): number {
  let beats: number;
  switch (duration) {
    case "全":
      beats = 4;
      break;
    case "二分":
      beats = 2;
      break;
    case "四分":
      beats = 1;
      break;
    case "八分":
      beats = 0.5;
      break;
    case "十六分":
      beats = 0.25;
      break;
  }
  return dotted ? beats * 1.5 : beats;
}
