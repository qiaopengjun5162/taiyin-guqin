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

- `image`：相对标注文件的图片路径，或内联 `image_base64`。
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

> ⚠️ **硬约束**：在线识别需要后端 `ANTHROPIC_API_KEY`（且 `LlmConfig` 的
> `ANTHROPIC_URL` 默认指向官方域名，可用 `ANTHROPIC_BASE_URL` 改走兼容代理）。
> 未配置时端点返回 **HTTP 503** `{"error":"LLM 未配置…"}`，脚本会干净地报错退出
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

## 报告

`--report out.html` 会生成一份 HTML 报告（汇总 + 逐样本明细 + 置信度分桶），
模板在 `report_template.html`，可自由改样式。

## 现在能做什么 / 还差什么

- ✅ 计分逻辑、报告、离线自测**现已完整可用**（见上面的 `--offline` / `--self-check`）。
- ✅ **桩管线验证可用**：`mock_backend.py` + `smoke.sh` 在「无 key」前提下端到端验证
  在线管线（HTTP→解析→打分→报告），把「管线/环境」与「模型」解耦（研究三分法）。
- ⏳ **放量前的真标注集**：需要一批真实减字谱图片 + 人工标注的 `ground_truth_glyph`。
  拿到后删掉样本里的 `predicted` 字段、填上真实 `image` 路径，即可在线跑。
- 🔧 **可选扩展**：把「由减字反推简谱音高」接进评分，增加「音高匹配率」指标。
  ⚠️ 注意：`taiyin_core` **暂无** jianzi→jianpu 转换逻辑，前端 `jianzi-pitch.ts` 是唯一实现。
  若给后端加 `/api/v1/jianzi/to-jianpu` 端点，需**先把转换逻辑抽到共享层**（如 `taiyin_core`），
  否则会出现第二份物理模型实现，踩中「改一处漏一处」的同步坑（见仓库 MEMORY.md）。
- 🔧 **可选 CI 化**：`smoke.sh` 已能在 CI 里跑（无需 key / 无需编译 Rust 后端），可加一个
  GitHub Actions job 持续守护 eval harness 不被回归破坏。
