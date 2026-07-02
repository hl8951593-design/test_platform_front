import { requestWithAuth } from "./client";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 0, message: "ok", data }),
  } as Response;
}

describe("api client request coalescing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("reuses an identical in-flight authenticated GET request", async () => {
    localStorage.setItem("access_token", "token");
    let resolveFirst!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce(jsonResponse({ fresh: true }));

    const first = requestWithAuth<{ value: number }>("/agents/dashboard?project_id=1");
    const second = requestWithAuth<{ value: number }>("/agents/dashboard?project_id=1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFirst(jsonResponse({ value: 1 }));
    await expect(Promise.all([first, second])).resolves.toEqual([{ value: 1 }, { value: 1 }]);

    await expect(requestWithAuth("/agents/dashboard?project_id=1")).resolves.toEqual({ fresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not coalesce mutating authenticated requests", async () => {
    localStorage.setItem("access_token", "token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({ ok: true }));

    await Promise.all([
      requestWithAuth("/agents/runs", { method: "POST", body: JSON.stringify({ intent: "first" }) }),
      requestWithAuth("/agents/runs", { method: "POST", body: JSON.stringify({ intent: "second" }) }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not coalesce non-shell authenticated GET requests", async () => {
    localStorage.setItem("access_token", "token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse([]));

    await Promise.all([
      requestWithAuth("/test-cases?project_id=1"),
      requestWithAuth("/test-cases?project_id=1"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
