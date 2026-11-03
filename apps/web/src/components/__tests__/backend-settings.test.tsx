import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BackendSettings } from "@/components/backend-settings";

describe("BackendSettings 社区后端设置", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("未连接时提示仅存本地；填地址保存后切换到已连接状态并写入 localStorage", () => {
    render(<BackendSettings />);
    expect(screen.getByText("未连接：曲谱仅存本浏览器")).toBeInTheDocument();

    const input = screen.getByLabelText("社区后端地址") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://guqin.example.com/" } });
    fireEvent.click(screen.getByText("保存"));

    expect(
      screen.getByText("已连接社区后端：https://guqin.example.com"),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem("taiyin.apiBaseUrl")).toBe(
      "https://guqin.example.com",
    );
  });

  it("已连接时显示「清除」按钮；点击后回到本地模式并清掉 localStorage", () => {
    window.localStorage.setItem("taiyin.apiBaseUrl", "https://guqin.example.com");
    render(<BackendSettings />);
    expect(
      screen.getByText("已连接社区后端：https://guqin.example.com"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("清除（改用本地）"));
    expect(screen.getByText("未连接：曲谱仅存本浏览器")).toBeInTheDocument();
    expect(window.localStorage.getItem("taiyin.apiBaseUrl")).toBeNull();
  });

  it("署名与后端地址一次保存写入，并显示在状态行", () => {
    render(<BackendSettings />);
    expect(screen.getByText("发布署名：匿名")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("社区后端地址"), {
      target: { value: "https://guqin.example.com" },
    });
    fireEvent.change(screen.getByLabelText("我的署名"), {
      target: { value: " 张百忍 " },
    });
    fireEvent.click(screen.getByText("保存"));

    expect(window.localStorage.getItem("taiyin.author")).toBe("张百忍");
    expect(screen.getByText("发布署名：张百忍")).toBeInTheDocument();
  });

  it("「清除（改用本地）」只清后端地址，不误删署名", () => {
    window.localStorage.setItem("taiyin.apiBaseUrl", "https://guqin.example.com");
    window.localStorage.setItem("taiyin.author", "张百忍");
    render(<BackendSettings />);

    fireEvent.click(screen.getByText("清除（改用本地）"));

    expect(window.localStorage.getItem("taiyin.apiBaseUrl")).toBeNull();
    expect(window.localStorage.getItem("taiyin.author")).toBe("张百忍");
    expect(screen.getByText("发布署名：张百忍")).toBeInTheDocument();
  });
});
