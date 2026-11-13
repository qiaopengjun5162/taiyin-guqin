import { describe, it, expect } from "vitest";
import {
  parseRapidInput,
  normalizeRapidInput,
  RAPID_SLOTS_BY_TONE,
} from "../jianzi-rapid";
import { jianziToText } from "../jianzi";

describe("normalizeRapidInput", () => {
  it("去掉空白与标点、转小写", () => {
    expect(normalizeRapidInput(" D J, G 4 ")).toBe("djg4");
  });

  it("全角字母与数字转半角", () => {
    expect(normalizeRapidInput("ｄｊｇ４")).toBe("djg4");
  });
});

describe("parseRapidInput · 散音", () => {
  it("g4 → 勾四弦", () => {
    const r = parseRapidInput("g4", "散");
    expect(r.complete).toBe(true);
    expect(r.state.rightAction).toBe("勹");
    expect(r.state.stringNumber).toBe("四");
    expect(r.state.leftFinger).toBeNull();
    expect(r.state.hui).toBeNull();
  });

  it("散音槽位为右手→弦序→结构记号（结构记号是末尾可选槽）", () => {
    expect(RAPID_SLOTS_BY_TONE["散"]).toEqual(["rightAction", "stringNumber", "structureMark"]);
  });

  it("散音槽位里没有走手音——空弦滑不动", () => {
    expect(RAPID_SLOTS_BY_TONE["散"]).not.toContain("slide");
  });

  it("s 在三弦位 → 三，ss → 四", () => {
    expect(parseRapidInput("gs", "散").state.stringNumber).toBe("三");
    expect(parseRapidInput("gss", "散").state.stringNumber).toBe("四");
  });
});

describe("parseRapidInput · 按音", () => {
  it("djg4 → 大九勾四（完整）", () => {
    const r = parseRapidInput("djg4", "按");
    expect(r.complete).toBe(true);
    expect(r.consumed).toBe(4);
    expect(r.state.leftFinger).toBe("大");
    expect(r.state.hui).toBe("九");
    expect(r.state.rightAction).toBe("勹");
    expect(r.state.stringNumber).toBe("四");
  });

  it("火蜘蛛消歧：ss=四、sss=十", () => {
    expect(parseRapidInput("dssg4", "按").state.hui).toBe("四");
    expect(parseRapidInput("dsssg4", "按").state.hui).toBe("十");
    expect(parseRapidInput("dsg4", "按").state.hui).toBe("三");
  });

  it("「分」可省略也可插入：djg4 与 djf6g4", () => {
    expect(parseRapidInput("djg4", "按").state.fen).toBeNull();
    const withFen = parseRapidInput("djf6g4", "按");
    expect(withFen.complete).toBe(true);
    expect(withFen.state.fen).toBe("六分");
    expect(withFen.state.hui).toBe("九");
  });

  it("t=挑、tu=托、ti=剔", () => {
    expect(parseRapidInput("djt4", "按").state.rightAction).toBe("乚");
    expect(parseRapidInput("djtu4", "按").state.rightAction).toBe("乇");
    expect(parseRapidInput("djti4", "按").state.rightAction).toBe("剔");
  });

  it("复合指法 mt=抹挑", () => {
    const r = parseRapidInput("djmt4", "按");
    expect(r.complete).toBe(true);
    expect(r.state.rightAction).toBe("抹挑");
  });

  it("同一个字母按位置区分：d 在首位是大，在右手位是打", () => {
    expect(parseRapidInput("d", "按").state.leftFinger).toBe("大");
    const r = parseRapidInput("djd4", "按");
    expect(r.state.leftFinger).toBe("大");
    expect(r.state.rightAction).toBe("丁");
  });
});

describe("parseRapidInput · 未完成与容错", () => {
  it("半截输入不判完成，并提示下一个槽位", () => {
    const r = parseRapidInput("dj", "按");
    expect(r.complete).toBe(false);
    expect(r.consumed).toBe(2);
    expect(r.nextSlot).toBe("rightAction");
  });

  it("尾部有无法解析的字符时不算完整", () => {
    const r = parseRapidInput("djg4x", "按");
    expect(r.complete).toBe(false);
  });

  it("空串不判完成", () => {
    expect(parseRapidInput("", "按").complete).toBe(false);
  });

  it("识别结果带上音色，节奏位留空", () => {
    const r = parseRapidInput("mqt3", "泛");
    expect(r.complete).toBe(true);
    expect(r.state.toneType).toBe("泛");
    expect(r.state.rhythmMode).toBeNull();
  });

  it("泛音需要完整四槽（含左手与徽位）", () => {
    expect(parseRapidInput("mqt3", "泛").complete).toBe(true);
    // 「dg4」少了徽位。不能用「gt3」做反例了：散音兜底会把它接成「散勾剔三」，
    // 那是一条合法的散音谱字，判完成反而是对的。
    expect(parseRapidInput("dg4", "泛").complete).toBe(false);
  });
});

describe("parseRapidInput · 十三徽与全部分位", () => {
  it("十一 sssy / 十二 ssse / 十三 ssss", () => {
    expect(parseRapidInput("dsssyg4", "按").state.hui).toBe("十一");
    expect(parseRapidInput("dssseg4", "按").state.hui).toBe("十二");
    expect(parseRapidInput("dssssg4", "按").state.hui).toBe("十三");
  });

  it("十三徽整字可成字", () => {
    const r = parseRapidInput("dssssg4", "按");
    expect(r.complete).toBe(true);
    expect(r.state.hui).toBe("十三");
    expect(r.state.rightAction).toBe("勹");
    expect(r.state.stringNumber).toBe("四");
  });

  it("十徽仍走 sss，不被 ssss 抢走", () => {
    const r = parseRapidInput("dsssg4", "按");
    expect(r.state.hui).toBe("十");
    expect(r.complete).toBe(true);
  });

  it("分位 f1–f9 与 fb", () => {
    const cases = [
      ["f1", "一分"], ["f2", "二分"], ["f3", "三分"], ["f4", "四分"], ["f5", "五分"],
      ["f6", "六分"], ["f7", "七分"], ["f8", "八分"], ["f9", "九分"], ["fb", "半"],
    ] as const;
    for (const [key, fen] of cases) {
      const r = parseRapidInput(`dq${key}g4`, "按");
      expect(r.state.hui, key).toBe("七");
      expect(r.state.fen, key).toBe(fen);
      expect(r.complete, key).toBe(true);
    }
  });
});

describe("parseRapidInput · 音色写进串（对齐文源输入法 SG3）", () => {
  it("sg3 → 散勾三；按音模式下也能直接打散音", () => {
    const r = parseRapidInput("sg3", "按");
    expect(r.complete).toBe(true);
    expect(r.state.toneType).toBe("散");
    expect(r.state.rightAction).toBe("勹");
    expect(r.state.stringNumber).toBe("三");
  });

  it("fd9g4 → 泛音大九勾四", () => {
    const r = parseRapidInput("fd9g4", "按");
    expect(r.complete).toBe(true);
    expect(r.state.toneType).toBe("泛");
    expect(r.state.leftFinger).toBe("大");
    expect(r.state.hui).toBe("九");
  });

  it("a 前缀显式声明按音", () => {
    const r = parseRapidInput("ad9g4", "散");
    expect(r.complete).toBe(true);
    expect(r.state.toneType).toBe("按");
  });

  it("无音色前缀时不抢当前音色：完整的泛音照旧是泛音", () => {
    expect(parseRapidInput("mqt3", "泛").state.toneType).toBe("泛");
  });

  it("散音兜底：g4 在按音模式下不抢跑，回车才按散勾四入谱", () => {
    // 「g4」在按音语法里是「跪 + 四徽」，是个还没打完的前半截；
    // 自动逻辑不敢替你拍板，否则打「d1」时会提前成「散打一」把后面的字全吞掉。
    expect(parseRapidInput("g4", "按").complete).toBe(false);
    const forced = parseRapidInput("g4", "按", { force: true });
    expect(forced.complete).toBe(true);
    expect(forced.state.toneType).toBe("散");
    expect(forced.state.stringNumber).toBe("四");
  });

  it("显式前缀不受影响：sg4 在按音模式下直接成字", () => {
    const r = parseRapidInput("sg4", "按");
    expect(r.complete).toBe(true);
    expect(r.state.toneType).toBe("散");
  });

  it("兜底不抢按音的首槽：d 仍是「大」而不是「打」", () => {
    expect(parseRapidInput("d", "按").state.leftFinger).toBe("大");
  });
});

describe("parseRapidInput · 徽位改用数字", () => {
  it("d9g4 / d13g4 / d10g4", () => {
    expect(parseRapidInput("d9g4", "按").state.hui).toBe("九");
    expect(parseRapidInput("d13g4", "按").state.hui).toBe("十三");
    expect(parseRapidInput("d10g4", "按").state.hui).toBe("十");
    expect(parseRapidInput("d1g4", "按").state.hui).toBe("一");
    expect(parseRapidInput("d11g4", "按").state.hui).toBe("十一");
  });

  it("「十三」不会被读成「一徽三分」", () => {
    const r = parseRapidInput("d13g4", "按");
    expect(r.state.hui).toBe("十三");
    expect(r.state.fen).toBeNull();
  });

  it("分位仍要 f 前缀，避免和徽位数字撞车", () => {
    const r = parseRapidInput("d13f6g4", "按");
    expect(r.state.hui).toBe("十三");
    expect(r.state.fen).toBe("六分");
    expect(r.complete).toBe(true);
  });
});

describe("parseRapidInput · 走手音（绰/注/急）", () => {
  it("c=绰、z=注、j=急", () => {
    expect(parseRapidInput("d9cg4", "按").state.slide).toBe("绰");
    expect(parseRapidInput("d9zg4", "按").state.slide).toBe("注");
    expect(parseRapidInput("d9jg4", "按").state.slide).toBe("急");
    for (const s of ["d9cg4", "d9zg4", "d9jg4"]) {
      expect(parseRapidInput(s, "按").complete, s).toBe(true);
    }
  });

  it("z 在右手位是「摘」，不是注", () => {
    const r = parseRapidInput("d9z4", "按");
    expect(r.state.slide).toBeNull();
    expect(r.state.rightAction).toBe("倽");
    expect(r.complete).toBe(true);
  });

  it("分数 + 走手音一起打，序列化顺序仍是字体要的「分数在前」", () => {
    const r = parseRapidInput("d9f6cg4", "按");
    expect(r.complete).toBe(true);
    expect(r.state.fen).toBe("六分");
    expect(r.state.slide).toBe("绰");
    expect(jianziToText(r.state)).toBe("大九六绰勾四");
  });
});

describe("parseRapidInput · 音色双向兜底", () => {
  it("界面停在散音时，完整的按音串照样出按音", () => {
    const r = parseRapidInput("d9g4", "散");
    expect(r.complete).toBe(true);
    expect(r.state.toneType).toBe("按");
    expect(r.state.hui).toBe("九");
  });

  it("界面停在按音时，纯右手串出散音", () => {
    // t 不是左手指法，按音语法读不下去 → 兜底成立
    const r = parseRapidInput("t7", "按");
    expect(r.state.toneType).toBe("散");
    expect(r.state.rightAction).toBe("乚");
  });

  it("回归：d1 在按音模式下不许提前成「散打一」", () => {
    // 这正是把「d13g4」打成「3g4」卡在框里的元凶
    expect(parseRapidInput("d1", "按").complete).toBe(false);
    expect(parseRapidInput("d13g4", "按").complete).toBe(true);
  });

  it("泛音不被兜底抢走：界面选了泛音就打泛音", () => {
    const r = parseRapidInput("mqt3", "泛");
    expect(r.state.toneType).toBe("泛");
  });

  it("泛音也不会被误猜成按音：不写 f 就按界面音色走", () => {
    // 同样的串在散音界面下兜底成按音（名七挑三），这是按音，不是泛音
    expect(parseRapidInput("mqt3", "散").state.toneType).toBe("按");
  });
});

describe("parseRapidInput · 吟猱族 18 个记号", () => {
  const MARKS: [string, string][] = [
    ["y", "吟"], ["n", "猱"],
    ["cy", "绰吟"], ["cn", "绰猱"], ["zy", "注吟"], ["zn", "注猱"],
    ["xy", "细吟"], ["xn", "细猱"], ["uy", "游吟"], ["un", "游猱"],
    ["hy", "荡吟"], ["hn", "荡猱"], ["vy", "飞吟"], ["vn", "飞猱"],
    ["oy", "圆吟"], ["on", "圆猱"], ["ky", "定吟"], ["kn", "定猱"],
  ];

  it("18 个记号逐个连打，整字成字", () => {
    for (const [letter, mark] of MARKS) {
      const r = parseRapidInput(`d9${letter}g4`, "按");
      expect(r.complete, `${letter} → ${mark}`).toBe(true);
      expect(r.state.slide, letter).toBe(mark);
      expect(r.state.rightAction, letter).toBe("勹");
    }
  });

  it("双字母优先：xy 不会被拆成 x + y", () => {
    const r = parseRapidInput("d9xyg4", "按");
    expect(r.complete).toBe(true);
    expect(r.state.slide).toBe("细吟");
  });

  it("旧 3 个单字母仍照常", () => {
    expect(parseRapidInput("d9cg4", "按").state.slide).toBe("绰");
    expect(parseRapidInput("d9zg4", "按").state.slide).toBe("注");
    expect(parseRapidInput("d9jg4", "按").state.slide).toBe("急");
  });

  it("y 在徽位槽仍是「一」，不因吟占用 y 而变", () => {
    const r = parseRapidInput("dyg4", "按");
    expect(r.state.hui).toBe("一");
    expect(r.state.slide).toBeNull();
  });

  it("连打出的挂尾记号，序列化挂在字尾", () => {
    const r = parseRapidInput("d9f6xyg4", "按");
    expect(r.complete).toBe(true);
    expect(r.state.slide).toBe("细吟");
    expect(jianziToText(r.state)).toBe("大九六勾四细吟");
  });
});

describe("parseRapidInput · 谱面结构记号", () => {
  it("5 个记号接在弦序之后，连打整字成字", () => {
    const cases: [string, string][] = [
      ["xx", "少息"],
      ["dx", "大息"],
      ["zz", "再作"],
      ["cz", "从头再作"],
      ["rp", "入拍"],
    ];
    for (const [letter, mark] of cases) {
      const r = parseRapidInput(`d9g4${letter}`, "按");
      expect(r.complete, `${letter} → ${mark}`).toBe(true);
      expect(r.state.structureMark, letter).toBe(mark);
      expect(r.state.rightAction, letter).toBe("勹");
      expect(r.state.hui, letter).toBe("九");
    }
  });

  it("结构记号独立于减字：带少息的勾四仍是完整减字", () => {
    const r = parseRapidInput("d9g4xx", "按");
    expect(r.complete).toBe(true);
    expect(r.state.structureMark).toBe("少息");
    // 减字本身不含记号（jianziToText 只拼四宫格）
    expect(jianziToText(r.state)).toBe("大九勾四");
  });

  it("散音串也能挂结构记号", () => {
    const r = parseRapidInput("g4zz", "散");
    expect(r.complete).toBe(true);
    expect(r.state.toneType).toBe("散");
    expect(r.state.structureMark).toBe("再作");
  });

  it("记号首字母互不相同，不会被误拆：cz 是「从头再作」而非 注+某", () => {
    const r = parseRapidInput("d9g4cz", "按");
    expect(r.complete).toBe(true);
    expect(r.state.structureMark).toBe("从头再作");
    // 确认没有把 c 当走手音、z 当摘
    expect(r.state.slide).toBeNull();
    expect(r.state.rightAction).toBe("勹");
  });

  it("末尾无法解析的记号字符不算完整（保持旧容错）", () => {
    const r = parseRapidInput("d9g4xy", "按");
    expect(r.complete).toBe(false);
    // structureMark 是可选字段：createEmptyState() 不预置该键，没解析出记号时就是 undefined。
    // 断言「缺省即无」，别把它写死成 null——那样会把可选字段重新钉成必填。
    expect(r.state.structureMark ?? null).toBeNull();
  });
});
