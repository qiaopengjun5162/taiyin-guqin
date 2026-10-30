# 减字谱识别准确率评估 Harness

这是 `taiyin-guqin` 项目里**缺失的那道质量闸门**（见根目录 `VERIFICATION.md` 第 3 节）。
有了它，AI 减字图片识别就能进入「跑 eval → 过了就推」的节奏，
而不再靠人工手测几张图做定性判断。

## 它衡量什么

把一批**带标注的减字谱图片**喂给后端识别端点，跑端到端识别，计算：

| 指标 | 含义 | 越低/越高越好 |
|---|---|---|
| `exact_match` | 单元格「规范减字文本完全相等」的命中率 | 越高越好 |
| `detection_rate` | 模型给出非空 glyph（非 null）的比例，刻画「看不清就放弃」倾向 | 越高越好 |
| `mean_cer` | 基于编辑距离的字符错误率（OCR 标准指标） | 越低越好 |
| `component P/R/F1` | 把减字拆成字符多重集后算 token 级 P/R/F1，刻画「少写/多写/写错某个部件」 | F1 越高越好 |
| `confidence 分桶准确率` | 当响应带 `confidence` 时，按置信度区间报准确率（可选） | 用于决定是否用阈值过滤 |

## 两种运行模式

- **单字** `mode: "single"`：每个样本一张图，调 `POST /api/v1/jianzi/recognize`。
- **整页** `mode: "sheet"`：每个样本一张整页图，调 `POST /api/v1/jianzi/recognize-sheet`，
  按 `(row, col)` 网格坐标与标注匹配；坐标约定与后端一致（row 从上到下、col 从左到右）。

## 标注格式

### 单字 `annotations/sample_single.json`

```json
{
  "mode": "single",
  "items": [
    {
      "id": "s1",
      "image": "images/大九勾四.png",
      "media_type": "image/png",
      "ground_truth_glyph": "大九勾四",
      "predicted": "大九勾四",
      "note": "完全正确"
    }
  ]
}
```

- `image`：图片路径，或内联 `image_base64`。相对路径按以下顺序解析，取第一个存在的：
  1. 标注文件所在目录（`annotations/xxx.json` 里写 `images/a.png`）
  2. harness 根目录（`annotations/` 与 `images/` 同级，**最常见**）
  3. 当前工作目录
  三处都没有时，报错会列出所有尝试过的绝对路径。
- `ground_truth_glyph`：人工标注的规范减字文本（真值）。
- `predicted` / `predicted_cells`：**仅离线模式需要**，用于不调后端时直接计分。

### 整页 `annotations/sample_sheet.json`

```json
{
  "mode": "sheet",
  "items": [
    {
      "id": "p1",
      "image": "images/page1.png",
      "media_type": "image/png",
      "grid": [
        {"row": 0, "col": 0, "ground_truth_glyph": "散挑一"},
        {"row": 0, "col": 1, "ground_truth_glyph": "大九勾四"}
      ],
      "predicted_cells": [
        {"row": 0, "col": 0, "glyph": "散挑一", "confidence": 0.91}
      ]
    }
  ]
}
```

## 怎么跑

```bash
cd tools/eval-jianzi

# 1) 单测指标数学（无需 key / 后端）
./run.sh --self-check

# 2) 离线校验评分逻辑（用标注里的 predicted 字段，不发起网络请求）
./run.sh --offline --annotations annotations/sample_single.json --report /tmp/eval_single.html
./run.sh --offline --annotations annotations/sample_sheet.json  --report /tmp/eval_sheet.html

# 3) 在线跑真实识别（需后端已配置 ANTHROPIC_API_KEY）
#    后端默认 http://127.0.0.1:3001，可用 EVAL_BACKEND 覆盖
EVAL_BACKEND=http://127.0.0.1:3001 ./run.sh --annotations annotations/your_set.json --report out.html
```

> ⚠️ **在线识别需要「能看图的模型」**，两种接法：
> - **Anthropic 官方**：`ANTHROPIC_API_KEY`（`ANTHROPIC_BASE_URL` 可改走兼容网关）。
> - **OpenAI 兼容网关**：`LLM_API_STYLE=openai` + `OPENAI_API_KEY` + `OPENAI_BASE_URL`
>   + `OPENAI_MODEL`（如 DeepSeek）；见 `gen_font_cases.py` 下方两个必踩的坑。
>
> 都没配置时端点返回 **HTTP 503** `{"error":"LLM 未配置…"}`，脚本会干净地报错退出
> （提示需配 key 或加 `--offline`），不会假装通过。

### 无 key 也能验证管线：确定性 mock + 端到端冒烟

真实识别质量取决于 Claude，而那需要 key。但「eval 流水线本身对不对」
（图片→HTTP→后端解析→打分→HTML 报告，字段是否对齐）**不该**被「有没有 key」
卡住。为此提供了 `mock_backend.py`：接口契约与真实后端完全一致，但识别结果由
图片字节**确定性派生**（sha256 → 固定词表），不调任何模型。

对应 VERIFICATION.md 的研究三分法（eval / env / model）：mock 下能跑通，
说明问题只在「模型」侧；跑不通，说明是「管线/环境」侧——先把管线修对，再谈模型。

```bash
# 一条命令：起 mock → 生成真值标注 → 在线跑 eval → 出报告 → 关 mock
./smoke.sh

# 等价分步：
python3 mock_backend.py --port 3099 &          # 起 mock 后端
python3 gen_smoke.py                           # 生成 images/ + annotations/smoke_*.json
EVAL_BACKEND=http://127.0.0.1:3099 \
  ./run.sh --annotations annotations/smoke_single.json --report /tmp/eval_smoke_single.html
EVAL_BACKEND=http://127.0.0.1:3099 \
  ./run.sh --annotations annotations/smoke_sheet.json  --report /tmp/eval_smoke_sheet.html
```

`gen_smoke.py` 复用 mock 的派生函数计算真值，因此在线 exact_match≈100%；
并故意把个别样本真值改错，制造「红行」与 <100% 汇总，以验证打分/着色逻辑。
生成的 `images/` 与 `annotations/smoke_*.json` 均为可再生产物（已在 .gitignore 忽略）。

## 真减字数据集：从字体渲染，零人工标注

`gen_font_cases.py` 直接读项目自带字体 `TaiYinJianZiPuKaiTi.ttf`，按**字形名**取轮廓
渲染成 PNG，真值由 **GSUB 连字表反查**自动得出（连字把构件字符合成一个字形，反读这张表
就是真值文本）。好处是：真值来自字体本身（不靠人眼看图写、不会写错），样本可无限扩、
完全可复现。一个字形有多个等价写法时（如「半涓/半蠲」）会写进 `ground_truth_alts`，
计分时任一命中都算对。

```bash
# 依赖 fontTools + ImageMagick（macOS: brew install imagemagick）
python3 gen_font_cases.py               # 渲染全部 42 个复合字形（lg/lgw/xl/md 前缀）
python3 gen_font_cases.py --limit 3     # 快速冒烟
python3 gen_font_cases.py --prefix md   # 只渲弦序类
# 产出 images/<glyph>.png + annotations/font_cases.json（不含 predicted = 在线跑）
```

42 条覆盖：右手指法连字 `lg_*`（打摘/勾剔/抹勾/…/掐撮N声）、复合指法 `lgw_*`
（半扶/长锁/圆搂/…）、弦序与手指 `md_*`（一弦…七弦/食指）、组合指法 `xl_*`（拨剌/大撮/三弹）。
`sm_*`（171 个部件如「十一徽一分」）暂不进主数据集——识别提示词面向完整谱字。

> 教训：真值手工写会错。早期手工标注把 `xl_santan` 写成「散弹」，GSUB 反查证明是**「三弹」**。

## 基线结果

### 第一版（2026-10-29，10 条手工真值）

后端 `LLM_API_STYLE=openai` + DeepSeek `deepseek-flash`（视觉）：

| 指标 | 数值 |
|---|---|
| `detection_rate` | 100%（10/10 都给出了非空结果） |
| `exact_match` | **0%**（0/10） |
| `mean_cer` | 1.050 |
| `component F1` | 23.8%（P 22.7% / R 25.0%） |
| 置信度 0.8–1.0 桶 | 5 条，exact 仍为 **0%** |

### 扩样版（2026-10-30，42 条 GSUB 自动真值，统计意义基线）

同一后端同一模型，数据集换成 GSUB 反查的全部 42 个复合字形：

| 指标 | 数值 |
|---|---|
| `n` | **42** |
| `detection_rate` | 97.6%（41/42；仅 `圆锁` 返回 null） |
| `exact_match` | **0.0%**（0/42） |
| `mean_cer` | 1.193 |
| `component P/R/F1` | 13.8% / 13.7% / **13.7%** |
| 置信度各桶（0–1 全部） | n=42，exact 全是 **0%** |

**失败模式（比单个数字更有信息量）**：

1. **模板坍缩**：42 条里 30+ 条的预测是 `散挑一` / `散挑三` / `散勾四` 这类
   「散+指法+数字」模板——正好是识别提示词里给的格式示例（`llm.rs` 的
   `散挑一 / 大九勾四`）。模型没在读字形，在**背提示词里的例子**。
2. **只读出数字**：弦序类 `md_3→三`、`md_5→五`、`md_6→六`——看得见数字，
   丢掉「弦」部件；`md_shi→挑一` 则完全猜错。
3. **复合指法全灭**：掐撮/掐拂滚/长锁/圆搂这类多部件连字没有一条沾边，
   F1 从 10 条版的 23.8% 掉到 13.7%，说明小样本时的 F1 偏高是运气。

结论与归因（按 eval / env / model 三分法）：

- **管线/环境侧：已通过。** 42/42 有响应、JSON 可解析、报告可复现，失败不在管线。
- **模型侧：不是「精度差一点」，是根本没在识别。** exact 0/42 + 模板坍缩 +
  高置信度全错（0.8–1.0 桶 17 条 exact 0%）三点合起来可以定论：
  通用视觉模型未针对减字谱训练，**不能作为准确率来源**，也不能用 confidence 过滤。
- 要提升只有两条路：① 用减字数据微调/训练专用识别模型（数据集就是现成的
  42+171 个自动真值字形）；② 电子谱面场景绕开视觉，走「字体 GSUB 反查」非视觉路径
  ——本项目渲染层本来就用字体连字，反查天然 100% 准。

> 复现：`python3 gen_font_cases.py && ./run.sh --annotations annotations/font_cases.json --backend http://127.0.0.1:3001`

### 模板匹配：电子谱面 100% 的第二条路（2026-10-30，`template_match.py`）

上面的结论②已落地：对**电子谱面**（本项目字体渲染的干净减字图）不再问视觉模型，
改为「字体全字形模板 + 归一化最近邻」——268 个字形（213 个复合减字 + 55 个部件）
覆盖字体里全部可读字形，识别退化为闭集最近邻：确定性、毫秒级、零成本。
其中 11 处**同形异名**（见下「整页识别」）合并为等价写法后，索引 **257 条**。

```bash
python3 template_match.py build     # 渲染 268 字形建模板索引（缓存 .cache/）
python3 template_match.py predict \
  --annotations annotations/font_cases.json --out annotations/font_cases_tpl.json
python3 score.py --offline --annotations annotations/font_cases_tpl.json
python3 template_match.py robust    # 扰动鲁棒性实验（量化适用边界）
python3 template_match.py export-rust  # 导出后端内嵌索引 crates/taiyin-server/data/
```

同一批 42 条字体真字，两条路的对比：

| 指标 | 视觉大模型（deepseek-flash） | 模板匹配 |
|---|---|---|
| exact_match | **0.0%**（0/42） | **100.0%**（42/42） |
| mean_cer | 1.193 | **0.000** |
| component F1 | 13.7% | **100.0%** |
| 耗时/成本 | 1.4–1.6s/张，计费 | <1ms/张，零成本 |
| 输出确定性 | 非确定（同图两跑不同错答） | 确定 |

扰动鲁棒性（`robust` 子命令，42 条各加扰动后重匹配；含 3x3 中值去斑预处理）：

| 条件 | 命中率 | 说明 |
|---|---|---|
| 无扰动 / 平移 | 100% | 归一化裁外接框，平移天然不敏感 |
| 缩放 0.7x / 1.4x | 100% | 同上 |
| 高斯模糊 r=1 / r=2 | 100% | 笔画拓扑未变 |
| 椒盐噪声 0.5% | 100% | 中值去斑兜住 |
| 椒盐噪声 1% / 2% | 97.6% / 92.9% | 边界在这里开始 |
| （无中值去斑时）椒盐噪声任意 | 78.6% | 噪点撑大外接框 → 去斑是必需预处理 |

**诚实边界**：以上全部是「训练=测试」分布（同一字体渲染）。拍照/扫描件的光照、
笔画粘连、形变不在适用范围——那类输入走 `RECOGNIZE_MODE=auto` 自动落 LLM，
或未来用 42+171 条自动真值微调专用模型。

**已接入后端**（`crates/taiyin-server/src/template_match.rs`，索引内嵌编译期打进二进制）：
`/api/v1/jianzi/recognize` 默认 `RECOGNIZE_MODE=auto`——模板置信度（top-2 margin 比）
≥ 0.3 直接返回 `method: "template"`；不够才落 LLM；LLM 未配置时用模板兜底，不再直接 503。
端到端实测（HTTP 真链路重跑 42 条）：**exact 100%、置信度 [0.8,1.0) 桶 42/42**，与离线一致。
Rust 端归一化（中值去斑/外接框/半像素双线性）与 Python 逐行等价，有 10 条单测
（含「取索引任一模板自匹配必须回同名」的管线回环）守护。

### 整页识别：切分 + 逐格匹配（2026-10-30，`sheet_eval.py`）

单字打到 100% 后，整页此前只有 LLM 一条路（exact 0% 不可用）。整页走模板路径的
前提是**格子切分**。`sheet_eval.py` 用真字体渲染合成整页谱图（随机网格/字号/间隙），
量化切分与识别的边界；`sheet_segment.rs` 是逐行等价的 Rust 实现，已接入
`/api/v1/jianzi/recognize-sheet`（`method: "template"`，auto 策略同单字）。

```bash
python3 sheet_eval.py synth --pool 42 --sheets-per-gap 12   # 合成整页 + 真值
python3 sheet_eval.py eval --dump /tmp/sheet_failures.json  # 切分+匹配，按间隙报告
python3 sheet_eval.py curve --pool 42                       # 准确率-字号曲线（单字）
python3 sheet_eval.py http-check                            # 同批图打真实后端逐格比对
```

**切分算法**（Python `segment()` ≡ Rust `sheet_segment::segment`，逐行等价）：
3×3 中值去斑 → 阈值 128 取墨 → 行投影找行带 → 带内列投影找字格，
**间隙容忍**（白缝 <0.10×S 不切，S=页面墨迹尺度=最大带高∪最大带宽，half-up 取整）。
为什么必须容忍：复合减字内部有白色通道——213 真字实测列向 p99=2px、行向单字可到
0.36×字高（上下部件间横通道）。无脑「一列白就切」会把一个字劈成两三个框
（首轮 eval 逐格只有 56–92%，全是这个原因）。行投影横跨整行，需整行所有字的
通道对齐才误切，实测极少，故行/列都取 0.10×S。

实测结果（72 张合成整页，字格池=42 条同分布）：

| 间隙/字高 | 结构对 | 整页 exact | 逐格 exact |
|---|---|---|---|
| 0.0 / 0.05 | 0/12 | 0 | 粘连（切不开） |
| 0.1（临界） | 12/12 | 11/12 | 99.5% |
| 0.2 / 0.3 | 12/12 | 11/12 | 99.5% / 99.0% |
| **0.5（真 app 渲染比例）** | 12/12 | 10/12 | **99.0%** |

准确率-字号曲线（单字缩到不同字号后匹配，`curve` 子命令）：

| 字高 | 24px | 48px | **≥72px** |
|---|---|---|---|
| exact（42 池） | 59.5% | 97.6% | **100%** |
| exact（34 纯复合池） | 50.0% | 97.1% | **100%** |

24px 的大跌是信息丢失（密集复合字如掐拨剌二声的区分笔画低于阈值噪声地板），
不是算法 bug——**识别整页请用 ≥3×（72px+）导出/截图**。残余的 48px 错误
（拨剌→连涓）是唯一混淆对。

**字体固有歧义（已合并为等价写法）**：11 处同形异名任何算法都区分不开——
一徽一分≡十一徽、一徽二分≡十二徽、一徽三分≡十三徽（轮廓逐像素相同，距离 0.000），
以及 md_N（N弦）≡sm_N（N徽）7 对（均画成光板数字 N，轮廓数相同、无区分标记，
人眼也无法区分——靠组合字形的象限位置才分得出弦/徽）。`template_match.py build`
自动合并（`KNOWN_SAME_OUTLINE` + 像素全同），truths 取并集；命中任一写法计对。
首轮 eval「192px 还有 3 个错」就是这 3 对平局被算成了失败。

**双端一致性（纪律）**：`sheet_segment.rs` 改动必须跑 `http-check` ——
同一批 72 张整页打真实 HTTP，与 Python 预测逐格比对。本轮结果：
**72/72 页、851/851 格完全一致**；单字 42 条回归仍 100%。
注意 Python `round()` 是银行家舍入（8.5→8）而 Rust `as usize` 是 half-up（8.5→9），
阈值取整必须用 `int(x+0.5)`，否则两端会在临界间隙上分叉。

### 两个必踩的坑（换模型时对照检查）

1. **模型必须支持图片输入。** 查端点 `GET /v1/models` 的 `input_modalities`：
   DeepSeek 上 `deepseek-flash` 是 `["text","image"]` ✅，而 `deepseek-v4-pro` 是 `["text"]` ❌。
   选错不会报错，只会返回「看不到这张图片」的空识别——**静默失败**。
2. **推理型模型要把「思考」关掉。** 开着思考时 `max_tokens` 会全被 `reasoning_tokens` 吃掉，
   `content` 恒为空、`finish_reason=length`（实测 512 和 3000 token 都是空）。
   后端默认发 `thinking: {"type":"disabled"}`（`OPENAI_DISABLE_THINKING` 控制），
   且 `content` 为空时**直接报错**而不是静默返回 `glyph: null`。

## 报告

`--report out.html` 会生成一份 HTML 报告（汇总 + 逐样本明细 + 置信度分桶），
模板在 `report_template.html`，可自由改样式。

## 现在能做什么 / 还差什么

- ✅ 计分逻辑、报告、离线自测**现已完整可用**（见上面的 `--offline` / `--self-check`）。
- ✅ **桩管线验证可用**：`mock_backend.py` + `smoke.sh` 在「无 key」前提下端到端验证
  在线管线（HTTP→解析→打分→报告），把「管线/环境」与「模型」解耦（研究三分法）。
- ✅ **真数据集已可生成**：`gen_font_cases.py` 从字体渲染真减字图，真值 GSUB 反查
  （零人工标注、自动发现异体写法），并已跑出 42 条的统计意义基线（见上「基线结果」）。
- ✅ **样本量已到统计意义**：42 个复合字形全量（lg/lgw/xl/md），另有 171 个 `sm_*`
  部件字形可按 `--prefix sm` 扩充；结论（exact 0/42、模板坍缩、置信度全错）已足够定论。
- ✅ **电子谱面识别已可用（单字 + 整页，2026-10-30）**：`template_match.py` 模板匹配
  exact 100%（字高 ≥72px），`sheet_eval.py` 整页切分 + 逐格匹配（间隙 ≥0.2×字高切分
  全对、真 app 比例处逐格 99%，双端 851/851 格一致）；均已接入后端
  `/api/v1/jianzi/recognize` 与 `/api/v1/jianzi/recognize-sheet`（`RECOGNIZE_MODE=auto`
  模板优先、LLM 兜底），见上「模板匹配」「整页识别」两节。
- ⏳ **手写/扫描件真图**：字体渲染的图是「电子谱面」分布，真实拍照/手写会有噪声、
  笔画粘连、光照差异，需另收一批人工标注的真实图片来测泛化（模板匹配不适用，
  走 LLM 或未来的微调模型）。
- 🔧 **可选扩展**：把「由减字反推简谱音高」接进评分，增加「音高匹配率」指标。
  ⚠️ 注意：`taiyin_core` **暂无** jianzi→jianpu 转换逻辑，前端 `jianzi-pitch.ts` 是唯一实现。
  若给后端加 `/api/v1/jianzi/to-jianpu` 端点，需**先把转换逻辑抽到共享层**（如 `taiyin_core`），
  否则会出现第二份物理模型实现，踩中「改一处漏一处」的同步坑（见仓库 MEMORY.md）。
- 🔧 **可选 CI 化**：`smoke.sh` 已能在 CI 里跑（无需 key / 无需编译 Rust 后端），可加一个
  GitHub Actions job 持续守护 eval harness 不被回归破坏。
