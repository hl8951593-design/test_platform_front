import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EnvironmentConfigsPage } from "./EnvironmentConfigsPage";

describe("EnvironmentConfigsPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("displays environment variables and updates an edited variable immediately", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: [{ id: 1, name: "test", base_url: "https://api.test", is_default: true, variables: [] }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: {
            id: 1,
            name: "test",
            base_url: "https://api.test",
            is_default: true,
            variables: [
              { id: 9, name: "user_id", value: "1001", is_secret: false, updated_at: "2026-06-10T08:00:00" },
              { id: 10, name: "access_token", value: "secret-token", is_secret: true, updated_at: "2026-06-10T08:01:00" },
            ],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 0, message: "ok", data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          message: "ok",
          data: { id: 9, name: "user_id", value: "1002", is_secret: false, updated_at: "2026-06-10T08:02:00" },
        }),
      } as Response);

    render(<EnvironmentConfigsPage onAction={vi.fn()} projectId={1} />);

    expect(await screen.findByText("user_id")).toBeInTheDocument();
    expect(screen.getByText("1001")).toBeInTheDocument();
    expect(screen.getByText("••••••••••••")).toBeInTheDocument();
    expect(screen.getByText("敏感")).toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("编辑变量")[0]);
    expect(screen.getByDisplayValue("user_id")).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("请输入变量值"), { target: { value: "1002" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(screen.getByText("1002")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:8000/api/v1/environment-configs/1/variables?project_id=1",
      expect.objectContaining({
        body: JSON.stringify({ name: "user_id", value: "1002", is_secret: false }),
        method: "POST",
      }),
    );
  });
});
