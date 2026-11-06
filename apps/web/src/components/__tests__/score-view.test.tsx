/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ScoreView } from "../score-view";
import { createEmptyState } from "@/lib/jianzi";
import type { NoteColumn, JianziState } from "@/lib/types";

function makeNote(overrides: Partial<NoteColumn> = {}): NoteColumn {
  const jianzi: JianziState = {
    ...createEmptyState(),
    toneType: "散",
    rightAction: "勹",
    stringNumber: "五",
  };
  return {
    id: overrides.id ?? crypto.randomUUID(),
    jianpuNumber: null,
    jianpuOctave: "",
    jianpuDot: false,
    duration: "四分",
    jianzi,
    ...overrides,
  };
}

describe("ScoreView", () => {
  describe("onEdit", () => {
    it("fires onEdit with correct index when clicking a note column", () => {
      const onEdit = vi.fn();
      const notes = [makeNote({ id: "a" }), makeNote({ id: "b" })];
      const { container } = render(
        <ScoreView notes={notes} onEdit={onEdit} />,
      );
      const columns = container.firstElementChild!.children;
      fireEvent.click(columns[1]);
      expect(onEdit).toHaveBeenCalledWith(1);
    });

    it("does not fire onEdit when clicking delete button", () => {
      const onEdit = vi.fn();
      const onRemove = vi.fn();
      const notes = [makeNote({ id: "a" })];
      const { container } = render(
        <ScoreView notes={notes} onEdit={onEdit} onRemove={onRemove} />,
      );
      const column = container.firstElementChild!.children[0];
      const deleteBtn = column.querySelector("button");
      expect(deleteBtn).not.toBeNull();
      fireEvent.click(deleteBtn!);
      expect(onRemove).toHaveBeenCalledWith("a");
      expect(onEdit).not.toHaveBeenCalled();
    });
  });

  describe("onRemove", () => {
    it("fires onRemove with note id", () => {
      const onRemove = vi.fn();
      const notes = [makeNote({ id: "test-id" })];
      const { container } = render(
        <ScoreView notes={notes} onRemove={onRemove} />,
      );
      const column = container.firstElementChild!.children[0];
      const deleteBtn = column.querySelector("button");
      fireEvent.click(deleteBtn!);
      expect(onRemove).toHaveBeenCalledWith("test-id");
    });
  });

  describe("editingIndex highlight", () => {
    it("adds highlight class to the editing column", () => {
      const notes = [makeNote({ id: "a" }), makeNote({ id: "b" })];
      const { container } = render(
        <ScoreView notes={notes} editingIndex={1} />,
      );
      const columns = container.firstElementChild!.children;
      expect(columns[0].className).not.toContain("ring-amber");
      expect(columns[1].className).toContain("ring-amber");
    });
  });

  describe("playingIndex highlight", () => {
    it("adds playing class to the playing column", () => {
      const notes = [makeNote({ id: "a" }), makeNote({ id: "b" })];
      const { container } = render(
        <ScoreView notes={notes} playingIndex={0} />,
      );
      const columns = container.firstElementChild!.children;
      expect(columns[0].className).toContain("bg-emerald-50");
      expect(columns[1].className).not.toContain("bg-emerald-50");
    });

    it("playing highlight takes precedence over editing", () => {
      const notes = [makeNote({ id: "a" })];
      const { container } = render(
        <ScoreView notes={notes} editingIndex={0} playingIndex={0} />,
      );
      const column = container.firstElementChild!.children[0];
      expect(column.className).toContain("bg-emerald-50");
      expect(column.className).not.toContain("ring-amber");
    });

    it("scrolls the playing column into view", () => {
      const scrollMock = vi.fn();
      (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
        scrollMock;
      const notes = [makeNote({ id: "a" }), makeNote({ id: "b" })];
      render(<ScoreView notes={notes} playingIndex={1} />);
      expect(scrollMock).toHaveBeenCalledTimes(1);
      (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView =
        undefined;
    });
  });

  describe("empty state", () => {
    it("shows placeholder when notes is empty", () => {
      const { container } = render(<ScoreView notes={[]} />);
      expect(container.textContent).toContain("在下方拼装减字");
    });
  });

  describe("bar lines", () => {
    it("renders a bar line after every beatsPerBar beats", () => {
      const notes = [
        makeNote({ id: "a" }),
        makeNote({ id: "b" }),
        makeNote({ id: "c" }),
        makeNote({ id: "d" }),
        makeNote({ id: "e" }),
      ];
      const { container } = render(
        <ScoreView notes={notes} beatsPerBar={4} />,
      );
      const barLines = container.querySelectorAll("[data-testid='bar-line']");
      expect(barLines).toHaveLength(1);
    });

    it("renders bar lines for mixed durations", () => {
      const notes = [
        makeNote({ id: "a", duration: "四分" }),
        makeNote({ id: "b", duration: "八分" }),
        makeNote({ id: "c", duration: "八分" }),
        makeNote({ id: "d", duration: "四分" }),
        makeNote({ id: "e", duration: "四分" }),
      ];
      const { container } = render(
        <ScoreView notes={notes} beatsPerBar={3} />,
      );
      const barLines = container.querySelectorAll("[data-testid='bar-line']");
      expect(barLines).toHaveLength(1);
    });
  });

  describe("lyric", () => {
    it("renders lyric text under a note", () => {
      const notes = [makeNote({ id: "a", lyric: "花" })];
      const { container } = render(<ScoreView notes={notes} />);
      expect(container.textContent).toContain("花");
    });

    it("does not render lyric for a note without one", () => {
      const notes = [makeNote({ id: "a", lyric: "花" }), makeNote({ id: "b" })];
      const { container } = render(<ScoreView notes={notes} />);
      const columns = container.firstElementChild!.children;
      expect(columns[1].textContent).not.toContain("花");
    });

    it("fires onSeekLyric with the note index when its lyric is clicked, not onEdit", () => {
      const onSeekLyric = vi.fn();
      const onEdit = vi.fn();
      const notes = [
        makeNote({ id: "a", lyric: "花" }),
        makeNote({ id: "b", lyric: "非" }),
      ];
      const { container } = render(
        <ScoreView notes={notes} onSeekLyric={onSeekLyric} onEdit={onEdit} />,
      );
      const lyricSpans = Array.from(container.querySelectorAll("span"));
      const target = lyricSpans.find((s) => s.textContent === "非")!;
      expect(target).toBeTruthy();
      fireEvent.click(target);
      expect(onSeekLyric).toHaveBeenCalledWith(1);
      expect(onEdit).not.toHaveBeenCalled();
    });
  });

  /**
   * 三种排版共用同一份小节切分，差别只在"怎么把小节组装成行"。
   * 这里钉的是组装方式本身——小节数错、或小节没成组（会被劈到两行），
   * 界面不会报错，只会看起来"小节线飘了"。
   */
  describe("排版布局", () => {
    // 4/4 下 10 个四分音符 = 3 节（4 + 4 + 2）
    const tenNotes = Array.from({ length: 10 }, (_, i) =>
      makeNote({ id: `n${i}` }),
    );

    it("默认是自然流式：内容拍平，不产生小节分组", () => {
      const { container } = render(<ScoreView notes={tenNotes} />);
      expect(
        container.querySelector("[data-score-layout='flow']"),
      ).toBeTruthy();
      expect(container.querySelectorAll("[data-bar-group]")).toHaveLength(0);
      expect(container.querySelectorAll("[data-note-column]")).toHaveLength(10);
      // 3 节 → 2 根分隔线（最后一节后面不画）
      expect(
        container.querySelectorAll("[data-testid='bar-line']"),
      ).toHaveLength(2);
    });

    it("小节换行：每节一个分组，组内音符不跨组", () => {
      const { container } = render(
        <ScoreView notes={tenNotes} layout="barline" />,
      );
      const groups = container.querySelectorAll("[data-bar-group]");
      expect(groups).toHaveLength(3);
      expect(
        Array.from(groups).map(
          (g) => g.querySelectorAll("[data-note-column]").length,
        ),
      ).toEqual([4, 4, 2]);
      // 分组起点是全谱下标：0 / 4 / 8
      expect(
        Array.from(groups).map((g) => g.getAttribute("data-bar-start")),
      ).toEqual(["0", "4", "8"]);
    });

    it("小节换行：整节不可拆（break-inside 由分组承载）", () => {
      const { container } = render(
        <ScoreView notes={tenNotes} layout="barline" />,
      );
      const group = container.querySelector<HTMLElement>("[data-bar-group]")!;
      expect(group.style.breakInside).toBe("avoid");
      // 成组靠 flex 容器把音符与小节线绑成一个不可拆的项
      expect(group.className).toContain("flex");
      expect(group.className).toContain("items-stretch");
    });

    it("等宽小节：列宽按最长的一节算，且小节自己撑满整列", () => {
      const { container } = render(
        <ScoreView notes={tenNotes} layout="equal" />,
      );
      const groups = Array.from(
        container.querySelectorAll<HTMLElement>("[data-bar-group]"),
      );
      expect(groups).toHaveLength(3);
      // 每节都撑满 grid 列，宽度由列决定 → 各节等宽、右边缘齐
      expect(groups.every((g) => g.style.width === "100%")).toBe(true);

      // 最长节 4 音：4*72 + 3*12 gap + 16 小节线 = 340px 作为列宽下限
      const shell = container.querySelector<HTMLElement>("[data-score-layout]")!;
      expect(shell.style.gridTemplateColumns).toBe(
        "repeat(auto-fill, minmax(340px, 1fr))",
      );
    });

    it("等宽小节的音符在节内均匀铺开", () => {
      const { container } = render(
        <ScoreView notes={tenNotes} layout="equal" />,
      );
      const group = container.querySelector<HTMLElement>("[data-bar-group]")!;
      expect(group.style.justifyContent).toBe("space-around");
    });

    it("等宽小节用 grid 让每行撑到页边，流式用 flex 顺排", () => {
      const { container: equal } = render(
        <ScoreView notes={tenNotes} layout="equal" />,
      );
      const equalShell =
        equal.querySelector<HTMLElement>("[data-score-layout]")!;
      expect(equalShell.style.display).toBe("grid");
      // 不用 space-between：一行两节时会把剩余空间全塞进中间那个间隙
      expect(equalShell.style.justifyContent).toBe("");

      for (const layout of ["flow", "barline"] as const) {
        const { container } = render(
          <ScoreView notes={tenNotes} layout={layout} />,
        );
        const shell = container.querySelector<HTMLElement>("[data-score-layout]")!;
        expect(shell.style.display).toBe("flex");
        expect(shell.style.flexWrap).toBe("wrap");
      }
    });

    it("小节成组后比容器还宽时自己滚，不把整页撑破", () => {
      // 成组的大节无法像单个音符那样折行；不兜住就会出现整页横向滚动条
      const { container: barline } = render(
        <ScoreView notes={tenNotes} layout="barline" />,
      );
      expect(
        barline.querySelector<HTMLElement>("[data-score-layout]")!.style
          .overflowX,
      ).toBe("auto");

      const { container: equal } = render(
        <ScoreView notes={tenNotes} layout="equal" />,
      );
      expect(
        equal.querySelector<HTMLElement>("[data-score-layout]")!.style.overflowX,
      ).toBe("auto");

      // 流式本来就是逐个音符折行，不需要滚动容器
      const { container: flow } = render(
        <ScoreView notes={tenNotes} layout="flow" />,
      );
      expect(
        flow.querySelector<HTMLElement>("[data-score-layout]")!.style.overflowX,
      ).toBe("");
    });

    it("疏密档位改变列间距与内边距，不改音符宽度", () => {
      const { container: compact } = render(
        <ScoreView notes={tenNotes} density="compact" />,
      );
      const { container: loose } = render(
        <ScoreView notes={tenNotes} density="loose" />,
      );
      const a = compact.querySelector<HTMLElement>("[data-score-layout]")!;
      const b = loose.querySelector<HTMLElement>("[data-score-layout]")!;
      expect(parseInt(a.style.gap, 10)).toBeLessThan(parseInt(b.style.gap, 10));
      expect(parseInt(a.style.padding, 10)).toBeLessThan(
        parseInt(b.style.padding, 10),
      );
      const noteA = compact.querySelector<HTMLElement>("[data-note-column]")!;
      const noteB = loose.querySelector<HTMLElement>("[data-note-column]")!;
      expect(noteA.style.width).toBe(noteB.style.width);
    });
  });
});
