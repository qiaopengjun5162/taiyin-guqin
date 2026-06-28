# 撤销 / 重做 + 编辑器快捷键设计文档

- **日期**: 2026-06-28
- **范围**: `apps/web` 前端
- **目标**: 为乐谱编辑器提供撤销 / 重做能力，并通过键盘快捷键提升编辑效率

## 背景

当前 `page.tsx` 使用独立的 `useState` 管理 `score` 和 `scoreTitle`。添加、编辑、删除音符或修改标题后，用户无法回退操作，误操作成本较高。

## 目标

- 支持撤销 / 重做以下操作：
  - 添加音符
  - 编辑音符
  - 删除音符
  - 修改曲谱标题
- 提供全局键盘快捷键：
  - `Ctrl/Cmd + Z`：撤销
  - `Ctrl/Cmd + Shift + Z` 或 `Ctrl/Cmd + Y`：重做
- 在工具栏增加撤销 / 重做按钮，与快捷键状态同步

## 非目标

- 不改动后端 API 或数据库结构
- 不改动渲染组件 `JianziBlock` / `SvgJianziBlock`
- 不改键盘内部状态管理逻辑

## 架构

### 新增 Hook：`useScoreHistory`

位置：`apps/web/src/lib/use-score-history.ts`

维护三态历史栈：

```ts
type Snapshot = {
  score: NoteColumn[];
  title: string;
};

type HistoryState = {
  past: Snapshot[];
  present: Snapshot;
  future: Snapshot[];
};
```

对外暴露：

```ts
function useScoreHistory(initialScore?: NoteColumn[], initialTitle?: string): {
  score: NoteColumn[];
  title: string;
  canUndo: boolean;
  canRedo: boolean;
  setScore: (updater: SetStateAction<NoteColumn[]>) => void;
  setTitle: (title: string) => void;
  commitScore: (updater: SetStateAction<NoteColumn[]>) => void;
  commitTitle: (title: string) => void;
  undo: () => void;
  redo: () => void;
};
```

- `setScore` / `setTitle`：只更新 `present`，不入栈（用于编辑过程中临时状态，如标题输入）
- `commitScore` / `commitTitle`：先应用更新，再将旧 `present` 推入 `past`，清空 `future`

### 标题变更策略

标题输入框每 keystroke 都入栈会产生过多历史节点。采用 `onBlur` 入栈策略：

- 输入过程中只调用 `setTitle(value)` 更新 `present.title`
- 失去焦点时调用 `commitTitle(value)` 将旧标题入栈

### 快捷键监听

在 `page.tsx` 中添加全局 `keydown` 监听：

```ts
useEffect(() => {
  function handleKeyDown(e: KeyboardEvent) {
    const isUndo = (e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey;
    const isRedo = (e.ctrlKey || e.metaKey) && ((e.key === "z" && e.shiftKey) || e.key === "y");
    if (isUndo) { e.preventDefault(); undo(); }
    if (isRedo) { e.preventDefault(); redo(); }
  }
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [undo, redo]);
```

### 编辑中撤销的边界处理

如果当前 `editingIndex !== null`，执行 `undo` / `redo` 后：

- 若 `editingIndex` 指向的索引在新 `score` 中仍然有效，保留编辑状态
- 若索引越界或对应 `id` 已不存在，将 `editingIndex` 重置为 `null`

### 历史上限

最多保留 50 个 `past` 快照。超过时从栈底移除最旧记录。

### 空操作过滤

`commit` 前对比新状态与 `present`，若 `score` 和 `title` 均无变化，则不 push 新快照。

## 数据流变化

修改前：

```
page.tsx
  ├─ useState(score)
  ├─ useState(scoreTitle)
  └─ handler functions
```

修改后：

```
page.tsx
  └─ useScoreHistory()
       ├─ score / setScore
       ├─ title / setTitle
       ├─ undo / redo
       └─ canUndo / canRedo
```

`handleAppend`、`handleRemove`、`handleLoadScore` 等会真正改变乐谱或标题状态的操作，在更新后调用 `commitScore()` / `commitTitle()`。`handleSave` 只负责持久化，不入栈。

## UI 变更

在 `SaveLoadToolbar` 左侧增加撤销 / 重做按钮：

- 撤销：`←` 图标或文字「撤销」
- 重做：`→` 图标或文字「重做」
- 不可用时降低透明度并禁用点击

## 测试策略

- `apps/web/src/lib/__tests__/use-score-history.test.ts`
  - 初始化状态
  - 连续 commit 后 undo / redo
  - commit 后清空 future
  - 历史上限截断
  - 空操作不记录
  - 标题 commit 与撤销
- `apps/web/src/components/__tests__/score-view.test.tsx` 补充：
  - 工具栏按钮禁用状态
- 可选：在 `page.tsx` 的集成测试中验证快捷键

## 验收标准

- [ ] 添加、编辑、删除音符后可撤销
- [ ] 撤销后可重做
- [ ] 修改标题并失焦后可撤销
- [ ] `Ctrl/Cmd+Z` 触发撤销
- [ ] `Ctrl/Cmd+Shift+Z` 和 `Ctrl/Cmd+Y` 触发重做
- [ ] 工具栏按钮状态与 `canUndo` / `canRedo` 同步
- [ ] 历史栈不超过 50 步
- [ ] 测试覆盖率不下降

## 风险与回退

- 风险：Hook API 设计不佳导致后续功能扩展困难
  - 缓解：保持接口最小化，只暴露当前需要的字段
- 风险：快捷键与浏览器默认行为冲突
  - 缓解：`preventDefault()` 仅在触发撤销 / 重做时调用
- 回退：删除 `useScoreHistory` 文件并恢复原来的 `useState` 即可
