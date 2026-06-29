async page => {
  const json = (route, data) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, message: "ok", data }),
  });

  await page.route("**/api/v1/projects", route => json(route, [
    { id: 1, name: "1", description: "Demo project", owner_name: "admin" },
  ]));
  await page.route("**/api/v1/environment-configs**", route => json(route, [
    { id: 1, name: "test", base_url: "https://test.example", is_default: true },
  ]));
  await page.route("**/api/v1/agents/dashboard", route => json(route, {
    readiness: "pass",
    checks: [{ key: "event_store_ready", status: "pass", severity: "P2", message: "EventStore ready" }],
    alert_summary: {},
  }));
  await page.route("**/api/v1/agents/metrics", route => json(route, { tool_success_rate: 0.95 }));
  await page.route("**/api/v1/agents/alerts", route => json(route, { items: [] }));
  await page.route("**/api/v1/agents/release-gates/promotion", route => json(route, { gate_id: "promotion", status: "pass" }));
  await page.route("**/api/v1/agents/release-gates", route => json(route, { items: [] }));
  await page.route("**/api/v1/agents/runs/run-1/events", route => route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: "",
  }));
  await page.route("**/api/v1/agents/runs/run-1/runbook", route => json(route, {
    run_id: "run-1",
    diagnosis: "Run is healthy",
    safe_actions: [],
  }));
  await page.route("**/api/v1/agents/memory-usage-events**", route => json(route, { items: [] }));
  await page.route("**/api/v1/agents/runs/run-1", route => json(route, {
    run_id: "run-1",
    project_id: 1,
    conversation_id: "agent-conv-local-demo",
    intent: "生成登录链路测试计划",
    status: "running",
    current_iteration: 1,
    current_step_index: 1,
    max_iterations: 3,
    auto_complete: false,
    runtime_snapshot_id: "agent-snap-demo",
    last_event_sequence: 4,
    migration_block_count: 0,
    events: [
      { event_seq: 1, event_type: "run.started", payload_json: { run_id: "run-1", provider: "deepseek", event_seq: 1 } },
      { event_seq: 2, event_type: "assistant.delta", payload_json: { delta: "我会先检查登录接口契约，生成场景草稿，然后等待你审批保存。\n\n- **接口测试**：生成 HTTP/WebSocket 测试用例草稿\n- **场景编排**：自动绑定变量与断言" } },
      { event_seq: 3, event_type: "tool.completed", payload_json: { tool_call_id: "tool-1" } },
      { event_seq: 4, event_type: "assistant.delta", payload_json: { delta: "\n工具返回了 3 个候选步骤，下一步会补齐断言和变量绑定。" } },
    ],
    tool_calls: [{
      tool_call_id: "tool-1",
      tool_name: "scenario.compose",
      status: "succeeded",
      effect_submission_state: "effect_committed",
      input_json_redacted: { prompt: "***" },
      output_json_redacted: { steps: ["login", "query profile", "logout"] },
      required_permissions_json: ["scenario:create"],
      recent_reconcile_attempts: [],
    }],
    approvals: [],
    migration_blocks: [],
    context_builds: [],
    loop_observations: [],
  }));
  await page.route("**/api/v1/agents/runs", route => {
    if (route.request().method() === "POST") {
      return json(route, {
        run_id: "run-1",
        conversation_id: "agent-conv-local-demo",
        status: "queued",
        runtime_snapshot_id: "agent-snap-demo",
      });
    }
    return json(route, { items: [] });
  });

  await page.evaluate(() => {
    localStorage.setItem("access_token", "token");
    localStorage.setItem("auth_user", JSON.stringify({ id: 1, username: "admin", account: "admin" }));
    localStorage.setItem("active_project_id", "1");
    localStorage.setItem("active_environment_id", "1");
  });
  await page.goto("http://localhost:5174/agents");
  await page.getByLabel("Agent 目标描述").fill("生成登录链路测试计划");
  await page.locator(".agent-send-button").click();
  await page.waitForSelector(".agent-tool-transcript");
}
