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
});
