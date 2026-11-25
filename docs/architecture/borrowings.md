# 架构借鉴：外部优秀项目给太音的启示

> 目的：不闭门造车。把古琴数字化领域与通用音乐排版领域里**已跑通的做法**读一遍，
> 明确哪些该拿、哪些不该拿、拿了之后具体改什么。
>
> 整理时间：2026-11-17。所有结论都附出处；标「待验证」的是尚未在本地实测的说法。

---

## 一、结论先行：四个真正值得拿的东西

| # | 借鉴点 | 出处 | 我们现在的状态 | 优先级 |
|---|---|---|---|---|
| 1 | 减字谱是**上下文无关文法**，不是扁平字段 | alephpi/jianzipu | 只有 `GuqinNote{左手/徽位/右手/弦}`，表达不了撮式、旁注、联袂 | **高** |
| 2 | 谱字 = **布局(layout) + 字形(glyph)** 分层合成 | JianZiPu Font / alephpi | GSUB 连字 + SVG 四象限降级，471 字形封顶 | **高** |
| 3 | 域核心 / 绑定层 / 应用层**三层分离**，UI 不直连生成代码 | Rust shared-core 实践 | 页面与组件直接 import `taiyin-wasm` / `api` | **中高** |
| 4 | 正写(ortho) / 简写(abbr) 双输入模式 | alephpi/jianzipu | 只有一套连打文法，十/十一/十二/十三 有歧义 | 中 |

---

## 二、逐项展开

### 1. 减字谱是文法，不是字段（最重要）

`alephpi/jianzipu` 的开发指南把减字谱读法定义成**上下文无关语言**，归纳为四类语法形式：

1. **简单形式**：`[徽位指法短语 [指法 大指][数字 七徽 六分]][修饰 注][弦位指法短语 [指法 勾][数字 三弦]]`
2. **复杂形式 / 撮式**：`撮` + 两个子式（左手按一弦、右手弹另一弦），如「撮大七七三散四」
3. **旁注形式**：竖排夹注，如「上七徽九分」「二上七六」
4. **独体形式**：记号与联袂指法，可单独成谱字

并且给出语法分析树的完整结构。它还把读法分为**正写**与**简写**两种：

> 「大十二勾四」可以理解为「大指十徽二分勾四弦」或「大指十二徽勾四弦」。
> 鉴于十徽一分、二分、三分并不常用，我们**总是**把十一、十二、十三理解为十一徽、十二徽、十三徽。

**我们缺什么**：当前 `GuqinNote` 是扁平的六字段：

```rust
GuqinNote { note_type, left_finger, hui, right_action, string_number, compound, ornaments, duration }
```

这能表达「单音」，但表达不了：

- **撮式**：同一拍弹两根弦（两个 `(指法, 弦序)` 并列）→ 现在只能拆成两个音，节奏语义丢失；
- **旁注**：`上七徽九分` 这种两步走手位置移动 → 现在只能塞进 `ornaments`，是字形不是结构；
- **联袂四式**（分开/同声/应合/放合）→ 现在靠前端 `lianmei.ts` 在音符数组上**事后成组**，
  没进核心库，所以小程序/App 拿不到这份语义；
- **撮式与联袂的区别** → 前者是同时发声，后者是有先后或同时的复合，二者共用一套「成组」概念，
  但现在只有联袂有实现。

**怎么拿**：

- 在 `taiyin-core` 里把 `GuqinNote` 升级为**谱字节点树**：`Puzi` 枚举四类形式，叶子是现有的 `GuqinNote`。
- 把 `lianmei.ts`（259 行，纯逻辑，零浏览器 API）迁进核心——它与撮式共享「成组」模型。
- 保留 `GuqinNote` 作为**单音叶子**，旧数据仍可反序列化（`serde(default)` + 新 `Puzi::Simple(GuqinNote)` 包装），
  不破坏已存曲谱。
- 这是**数据结构变更**，必须继 `ts-rs` 生成类型一起改，并跑 `just check-types-fresh`。

> 注意：alephpi 的解析器是 Python、字体走 Figma→fonttools 管线，代码不好直接搬。
> **值得拿的是文法定义与术语表**（jianzi/puzi/reading/modifier/marker/layout/glyph），
> 不是它的实现。

出处：[alephpi/jianzipu dev_guide.md](https://github.com/alephpi/jianzipu/blob/master/dev_guide.md)

---

### 2. 谱字 = 布局 + 字形，分层合成（解决识别失效的根因）

两个独立来源都指向同一个模型：

**JianZiPu Font**（Nancy Yi Liang，53★）：

> The JianZiPu font uses a **glyph layering system** where each musical notation character is built by
> combining multiple **component glyphs** that stack and position themselves relative to each other.
> So each character is made of a series of glyphs, similar to how an English word is made of a series of letters.

**alephpi/jianzipu**：`LayoutNode { name, tag, Area{x,y,width,height}, children }`，
布局按语义划分区域，每个区域填入读法成分对应的字形名；变体（如徽分位的小写数字 `yi1.sm`）
不占 Unicode，只在字体内部使用。

**这直接解释了我们 `docs` 里记录的识别结构性失效**：

> 现有 257 个模板**全是字体预烘焙的复合指法符号**，0 条标准完整减字（如「大九勾四」），
> 连编辑器自己产出的减字都认不出（内置曲 27 个真实减字 → 0/27）。

根因不是「模板不够多」，而是**模板的粒度错了**：我们烘焙的是「整个谱字」，
而正确粒度是「部件 + 布局规则」。部件只有几十个（左手指法 5 + 右手 8 + 徽位 13 + 弦 7 + 修饰 21 ≈ 54），
布局只有几类；`54 × 布局` 就覆盖了绝大多数真实谱字，且**能识别没见过的新组合**。

**怎么拿**：

- 字形资产从「整字模板」改为「**部件模板 + 布局区域**」。现有 `apps/web/src/lib/svg-paths.ts`
  （92 行）与 `svg-paths.qiji.ts`（41 行）已经是按部件存的，方向对了，缺的是**布局定位规则**。
- 识别流程改为：切格 → 每个区域**分别**匹配部件 → 按布局规则组装并校验合法性（见第 4 点）。
  这样「认不出」会退化成「某个区域存疑、可逐格校正」，而不是整字失败。
- 渲染同样受益：GSUB 连字只覆盖字体预置的组合，布局合成能渲染任意合法组合，
  SVG 降级从「四象限特例」变成「通用路径」。

出处：[neuralfirings/JianZiPu](https://github.com/neuralfirings/JianZiPu)、[alephpi/jianzipu dev_guide.md](https://github.com/alephpi/jianzipu/blob/master/dev_guide.md)

---

### 3. 三层分离，UI 不直连生成代码

这是通用 Rust 跨端实践，不是古琴特有。核心三条：

**① 分层**：`core`（纯域，只依赖 serde）/ `bindings`（WASM 与 FFI 两个绑定面）/ `app`（各端 UI）。

**② 明确「共享什么」的判据**，不是「代码长得像就共享」，而是：

> The criterion is not whether the code looks similar. **It is whether the result has to be the same.**

四条筛选条件：① 结果只由输入决定；② 不直接依赖时间/locale/存储/网络；③ 不知道 UI 框架或平台 SDK；
④ 能用 Rust 单独测试。

**③ UI 不直连生成代码**：

> If a ViewController, a ViewModel, a Composable, or a React component is tied directly to generated code,
> a change in a function name or a DTO affects the whole UI. So the app has a layer in between.

**我们现在的状态（实测）**：

| 指标 | 数值 |
|---|---|
| `app/page.tsx` 行数 | 2071 |
| 其中 React hook 调用 | 67 处 |
| `useState` 声明 | 23 个 |
| `handle*` 事件处理器 | 30 个 |
| 直接 import `@/lib/taiyin-wasm` 的组件/页面 | 7 个（不含测试） |
| 直接 import `@/lib/api` 的组件/页面 | 7 个（不含测试） |

按第 ③ 条，这正是它警告的状态：**UI 与绑定层耦合**。
而且按第 ④ 条，「时间/存储/网络」不该进核心——我们的 `page.tsx` 同时管着草稿、未保存指纹、
进度落盘、后端地址、收藏缓存，已经越过这条线。

**怎么拿**：

- 建 `src/lib/client/` 作为**唯一门面**（对应它的 `SudokuEngineClient`）：
  UI 只认这一个 surface，内部再分派到 WASM 或 HTTP；测试里可换 fake。
- `page.tsx` 按关注点拆：曲谱编辑 / 播放练习 / 社区与账号 / 导出。**先拆状态，后拆渲染**——
  它现在 23 个 `useState` 混在一起，任何一处改动都要读两千行。
- 已在做的事与此一致：连打文法迁进 `taiyin-core`（纯逻辑、可用 Rust 单测、结果只由输入决定），
  正是第 ④ 条的合格候选。下一步同标准可迁：`lianmei.ts`、`jianpu-parser.ts`、`score-bars.ts`、
  `practice-progress.ts` 的判定部分。

**不该拿的**：文章建议用 UniFFI 做移动绑定。我们当前没有原生 App 计划，
小程序走 WASM 已验证可行（`apps/miniprogram-wasm-probe`）。先不引入 UniFFI，避免为不存在的一端付维护成本。

出处：[Rust shared core, part 1](https://jaemyeong.com/en/blog/rust-shared-core-01-architecture-boundary/)

---

### 4. 正写 / 简写双模式

alephpi 的做法：`ortho`（正写，无歧义）与 `abbr`（简写，好打）两套解析，且**可互相转换**；

> 鉴于十徽一分、二分、三分这三个徽位并不常用，我们总是将十一、十二、十三理解为十一徽、十二徽、十三徽。

**我们的现状**：连打文法只有一套，且靠最长匹配消歧——
`("13","十三")` 排在 `("1","一")` 前面，`ssss`/`sss`/`ss`/`s` 四级。这能工作，但：

- 没有「展开成完整读法」的能力，所以界面无法向初学者解释「你打的是什么」；
- 没有无歧义模式，导入外部谱本遇到 `大十二勾四` 只能按默认假设走。

**怎么拿**：在核心库里给 `parse_rapid_input` 增加 `expand` 输出——把解析结果展开成正写读法
（「大指十二徽勾四弦」），供界面释义与导出使用。这与既有 `jianzi-explain.ts`（566 行，
描述「每个字怎么读」）目标一致，后者可以改为调用核心，消掉一份重复。

---

## 三、明确**不拿**的东西

| 候选 | 为什么不拿 |
|---|---|
| Rime 系统级输入法 | 网页做不到系统 IME；竞品「忘机」已把它做成免费公共品，这维不可竞争。方向应押识别（他们没有）与整段编排 |
| Unicode `IRGN2645` 正式编码 | 尚在提案、审核周期长；我们用私有区/自建码即可 |
| Figma → fonttools 字体管线 | 重，且依赖设计工具；我们已有 wasm-pack + GSUB 管线 |
| UniFFI 移动绑定 | 无原生 App 计划，小程序走 WASM 已验证 |
| Verovio 集成 | 它解决五线谱/MEI 排版，减字谱不在其覆盖范围；引入 C++ 依赖换来的是用不上的能力 |

---

## 四、落地顺序（按「结果必须一致」筛选）

0. **首屏按「一句话原则」重写**（2026-11-18）。
   > 用户原话：「**如果一个项目用一句话讲不清楚，那它就不是一个好项目。
   > 并且你要假设用户是一个毫无耐心的用户，他是一个小白，甚至是一个白痴。**」

   实测旧首屏：**407 个字、34 个文本块**，而真正的操作区（减字键盘）在 978px 处——
   一屏看不到。项目自己的 `docs/entry-point-strategy.md` 早就写了
   「不会用：首屏是『选音色→点指法→点弦徽』，对路人是重交互」，一直没动。

   改动（都用真浏览器量过）：
   | 改前 | 改后 |
   |---|---|
   | 「太音是什么」+ 三类入口铺满一屏 | 一句话 + 「先听一首 / 开始打谱」两个按钮 |
   | 三入口（不会弹 / 会弹 / 在学）列表 | 折进「第一次用？看这三行」 |
   | 「只想记一个字」与主路径并排 | 收成 `<details>`，默认收起 |
   | 空谱画 80px 虚线占位框 | 不画（打了第一个字谱面才出现） |
   | 提示「还缺：右手指法、弦序」 | 「还需要：点下面的「右手指法」、「弦序」」 |
   | 预览框复述缺什么（与底部重复） | 只显示「未完成」 |

   **首屏 407 → 297 字，键盘 978 → 612px（移动端 1088 → 420px）。**

   最后一条最关键：旧提示只说「缺什么字段」，而新手不知道「右手指法」
   对应下面那排写着「毛托 / 尸劈 / 木抹」的按钮——**术语和按钮文案对不上**。
   新提示把字段名映射到页面上真实存在的分区标题。

1. ~~**`lianmei.ts` → 核心库**~~ **已完成（2026-11-17）**：259 行纯逻辑迁入
   `crates/taiyin-core/src/lianmei.rs`，21 个 Rust 单测 + 21 个跑真实 WASM 的前端用例。
2. ~~**`src/lib/client/` 门面 + `page.tsx` 状态拆分**~~
   **门面已完成**；状态拆出 `usePhrasePractice` / `useScoreExport` / `useScoreDraft`。
3. ~~**`jianpu-parser.ts` → 核心库**~~ **已完成（2026-11-18）**：189 行 + 时值表迁入
   `crates/taiyin-core/src/jianpu_parse.rs`，15 个 Rust 单测。
   前端只剩映射（`ParsedJianpuItem` 形状保持不变，调用方一行没改）。
4. ~~**谱字节点树（`Puzi`）**~~ **核心数据模型已完成（2026-11-25）**：
   `crates/taiyin-core/src/puzi.rs` 定义四类形式，`GuqinScore.notes` 由
   `Vec<GuqinNote>` 升为 `Vec<Puzi>`，`#[serde(untagged)]` + `Simple` 打头保证旧谱逐字段不变；
   9 条 Rust 单测（含旧 score JSON 往返逐值相等）+ 三份新生成类型
   （`Puzi.ts` / `GuqinScore.ts` / `Tuning.ts`）。同日补了两个 WASM 导出（`puzi_to_note` / `score_puzi_summary`）+ 8 条真实产物黄金样例。
   **边界**：UI 尚未接线，
   撮式/旁注/独体目前能存、能数，但不能录也不能画；联袂刻意不进 `Puzi`（它已是音符间关系，
   `lianmei.rs` 有独立模型），避免两套成组模型打架。详见 `docs/rust-migration-phase0.md` 第 13 节。
5. **识别改为部件 + 布局**：依赖 4 的字形资产整理，最后做。

### 状态拆分剩余清单

| 目标 hook | 内容 | 风险 |
|---|---|---|
| `useScoreDocument` | `score`/`title`/`useScoreHistory`/`editingIndex`/`currentScoreId`/脏标记 | 高（核心，与几乎所有 UI 相连） |
| `useScoreTransport` | `bpm`/`beatsPerBar`/定弦/基准音/播放/节拍器 | 中（`tuning` 有 37 处引用，且是曲谱属性） |
| `useCommunity` | `loadTabs`/分页/收藏/账号/认领/举报/迁移 | **中高，暂缓** |

> **`useCommunity` 为什么暂缓**：实测它不是一个独立关注点，而是与加载对话框的 UI 状态
> 深度纠缠——tab 对象里内嵌回调（`onLoadMore`）、`loadTabsRef` 镜像防闭包过期、
> 排序/关键词/定弦筛选状态互相牵连。强行拆会引入比收益更大的参数传递复杂度。
> 这违反「不过度工程」：**先拆边界清晰的，纠缠的要么连着 UI 一起重构，要么留着**。

每步验收：`tsc --noEmit` + `eslint` + 全量测试；`page-interactions` / `page-wiring`
是回归网，**不得改断言来迁就实现**。

### 六、一次真实事故：SSR 与「测试全绿但构建红」

拆 `useScoreDraft` 时我为了「少传一个参数」，把「是不是分享直达」在**渲染期**算好传进去：

```tsx
useScoreDraft({ ..., skipRestorePrompt: readSharedScoreId(window.location.search) !== null })
```

`tsc` 通过、`eslint` 通过、1388 条单测全绿、clippy 干净——因为单测跑在 jsdom 里，
`window` 恒存在。但 `next build` 当场红：

```
Error occurred prerendering page "/"
ReferenceError: window is not defined
```

静态导出在 Node 里预渲染，渲染期碰 `window` 必炸。

**结论与防线**：

1. **`next build` 必须真的跑**，别拿「测试全绿」当发布依据。CI 本来就有这一步，
   但它只会给出 `ReferenceError` + 压缩后的行号，定位要时间。
2. 新增 `ssr-safety.test.ts` 静态守卫，专抓「hook 实参里读浏览器 API」这一形状
   （事故原形）。判据刻意只留这一条：我最初还想检查「函数体内 `const x = window.yyy`」，
   结果**误报 17 处**（都是事件处理器与工具函数，SSR 时不执行）。会误报的门禁会被绕过，
   所以宁可漏报——间接读取的缺口交给 `next build` 兜底。
3. 修法：把判断挪进 hook 的 `useEffect`，`window` 只在客户端侧的 effect 里碰。

> 这条经验比它修的那个 bug 更值钱：**验证手段必须覆盖部署形态**。
> jsdom 测不到 SSR，就像 mock 测不到真 WASM——两者都会「绿得很可疑」。

### 七、实拍验收：1390 条测试全绿，用户说「根本不能用」

用户原话：「前端不管是风格还是显示都很差，特别差……看着通过了很多测试，我不知道是怎么测的，
反正前端用户真正去用的时候，就感觉根本不能用。」

这句话是对的。当时状态：1390 条单测全绿、`tsc`/`eslint` 干净、`next build` 通过、clippy 零告警。
**但这些全部通过之后，页面仍然是坏的。** 用 Playwright 打开真实浏览器逐处看，找到 6 个真缺陷：

| # | 缺陷 | 为什么单测发现不了 |
|---|---|---|
| 1 | 侧栏「本页导航」半透明底 + sticky，滚动时把下方面板文字**叠压**住 | jsdom 没有层叠与真实布局 |
| 2 | 只点「四弦」一个部件，预览框画出**不存在的减字**「散四」 | 逻辑「有内容就画」，测试也这么断言 |
| 3 | 演奏控制台在 360px 窄栏强行两列，滑杆被**挤出面板边界** | jsdom 不做布局，`getBoundingClientRect` 恒为 0 |
| 4 | 全站正文压在 12px（**56% 的文本元素**都是这个字号） | 字号是视觉问题，测试不读样式 |
| 5 | 移动端首屏 664px 全是介绍文字，减字键盘在 **1088px** 处 | 不测真实视口 |
| 6 | 390px 视口里 **20 个可点元素高度 < 32px**，手指点不准 | jsdom 不模拟触控尺寸 |

**修法**（都经过重新截图验证）：
- 去掉 sticky；假字改为「还缺 X、Y」；控制台改用**容器查询**（视口宽度不代表面板宽度）；
- 字号分两档提到 13/14px（谱面区与字典网格按导出契约锁定）；
- 移动端用 `order-last` 把两块引导卡排到键盘之后（键盘 1088px → **500px**）；
- `@media (pointer: coarse)` 兜底 44×44 触控区（20 个超标 → 0）；
- 右手按钮加读音（「勹」→「勹/勾」），否则新人找不到「勾」；按钮 `aria-label` 带分区，
  因为「音色·散」与「节奏·散」同名不同义，脚本按名字点会点错。

**新增闸门** `scripts/smoke-browser.mjs`（`just smoke-browser`）：真 Chromium、真视口、真交互，
13 项断言覆盖上面每一条。这是唯一能挡住这类退化的层——jsdom 测不到像素。

> **方法论**：单测验证「逻辑对不对」，浏览器冒烟验证「东西能不能用」。
> 只做前者时，「测试全绿」和「产品可用」是两个互不蕴含的命题。
> 这次同时暴露了我的另一个问题：**我一直在数测试数量，却没打开过页面看**。
> 用户看到的才是产品。

> 顺序原则来自第 3 项引用文的建议：**先搬小、确定性的逻辑**，
> 「Moving every candidate at once makes the scope large.」

---

## 四之二、LoopForge（腾讯）：方法论可取，领域无关

2026-11-17 读过腾讯开源的 [LoopForge](https://github.com/Tencent/LoopForge)（AI 研发交付平台，
Go + Docker + agent CLI 编排，MIT）。**它与古琴记谱零领域重叠**，不能搬任何业务代码；
但它的核心方法论戳中了本项目的两处真实缺口，已当天下手修。

### 借鉴点 1：门禁必须「不通过就放不过去」（已修）

LoopForge 反复强调的一句话：

> 过去 Agent 写完代码全凭主观感觉声称「已改好」……现在每个 SOP 节点内置编译、单测、代码规范等
> **客观验证门禁——不通过绝不放行**。

对照本项目：我们其实早有一整套 `scripts/verify-*.mjs` 契约闸门，思路同源，
但**有一部分只挂在 `justfile` 里、CI 不跑**。实测发现：

| 闸门 | 修复前 | 修复后 |
|---|---|---|
| `verify-tuning` | CI 有 | 不变 |
| `verify-wasm` | CI 有 | 不变 |
| `verify-duration-code-contract` | **仅本地** | 已接入 `build.yml` |
| `verify-domain-contracts` | **仅本地** | 已接入 `build.yml` |

「本地可选执行的检查不是门禁」——它只在人记得跑的时候起作用。这两条都是
`--self-test` 自证（8 / 16 条变异）再跑真实比对，接进 CI 的成本只是两行。

### 借鉴点 2：产物漂移是「假绿」之源（已修）

LoopForge 的 RSI 复盘把「返工根因」量化出来（如「第 1 次返工两次、55 分」）。
本项目有一类同性质但更隐蔽的风险：

`apps/web/wasm/**` 是**提交进 git** 的产物（小程序探针与部分 CI 直接复用）。
于是存在这个窗口：

```
改 crates/taiyin-core/src/**  →  忘记 just build-wasm  →
前端「跑真实 WASM」的测试仍加载旧 .wasm → 全绿
```

这不是假设：2026-11-17 迁移连打解析器时就撞到过——Rust 逻辑已改，
产物没重建时测的是旧行为。CI 因为每次都重建所以不会绿得可疑，**本地会**。

修法：新增 `scripts/verify-wasm-fresh.mjs`，按**内容指纹**（不看 mtime，git clone 后 mtime 全变）
比对源码树与产物，清单落在 `crates/taiyin-core/wasm-manifest.json`；
`just build-wasm` 末尾自动 `--write` 更新清单，`just verify-contracts` 与 CI 都会校验。
已实测：改动源码后闸门报红，恢复后转绿。

### 明确不借鉴的

| 候选 | 为什么不 |
|---|---|
| SOP 编排引擎 / 多角色 agent 流水线 | 那是「用 AI 交付软件」的平台，本项目是「给琴人用的工具」。引入等于把构建系统换成另一个产品 |
| Docker 沙箱工作区 | 我们已有 `docker-compose.yml` + distroless 生产镜像，够用 |
| 需求 → 交付的全链路追踪 | 单人项目，GitHub Issues 足够；上平台是过度工程 |
| 工程级 RSI（自动改写流程） | 有真实价值但成本远高于收益；我们以 `docs/` + 契约闸门手工维护 |

> 一句话总结：**LoopForge 教的是「怎么让机器可靠地交付」，我们要拿的是它关于
> 「门禁要硬、产物要新」的两条纪律，不是它的平台。**

---

## 五、参考

- [alephpi/jianzipu · dev_guide.md](https://github.com/alephpi/jianzipu/blob/master/dev_guide.md) — 减字谱文法、术语表、布局/字形分层
- [alephpi/jianzipu · README](https://github.com/alephpi/jianzipu) — 解析 → 中间表示 → OpenType 的总体流程
- [neuralfirings/JianZiPu](https://github.com/neuralfirings/JianZiPu) — 字形分层合成（component glyph layering）
- [Rust shared core, part 1: what to share and where to draw the line](https://jaemyeong.com/en/blog/rust-shared-core-01-architecture-boundary/) — 三层分离与共享判据
- [Verovio](https://www.verovio.org/index.xhtml) — 通用记谱引擎（评估后不采用，见上）
- [Tencent/LoopForge](https://github.com/Tencent/LoopForge) — AI 研发交付平台；借其「硬门禁 + 产物新鲜」两条纪律
- [登上 GitHub Trending｜腾讯开源 LoopForge](https://mp.weixin.qq.com/s/-gagDmalGrKyTtA-1dc8BQ) — 五步工程演进原文
