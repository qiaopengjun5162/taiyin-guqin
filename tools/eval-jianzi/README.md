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
> 未配置时端点返回 `method:"unavailable"`，脚本会直接报错退出——这是有意为之，
> 不假装通过。

## 报告

`--report out.html` 会生成一份 HTML 报告（汇总 + 逐样本明细 + 置信度分桶），
模板在 `report_template.html`，可自由改样式。

## 现在能做什么 / 还差什么

- ✅ 计分逻辑、报告、离线自测**现已完整可用**（见上面的 `--offline` / `--self-check`）。
- ⏳ **放量前的真标注集**：需要一批真实减字谱图片 + 人工标注的 `ground_truth_glyph`。
  拿到后删掉样本里的 `predicted` 字段、填上真实 `image` 路径，即可在线跑。
- 🔧 **可选扩展**：把「由减字反推简谱音高」（`apps/web/src/lib/jianzi-pitch.ts` 的
  `jianziToJianpu`）也接进评分，增加「音高匹配率」指标。最干净的做法是给后端加一个
  `/api/v1/jianzi/to-jianpu` 端点，harness 调用它而非在前端/Python 里重实现物理模型。
