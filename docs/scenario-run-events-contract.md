# Scenario Run Realtime Events Contract

Status: target backend contract with implemented frontend reconnection and recovery
Last verified: 2026-06-15

This contract makes the scenario canvas reflect real backend execution progress.
The existing run detail API remains the authoritative snapshot.

## 1. Start Execution

`POST /api/v1/scenarios/{scenario_id}/execute?project_id={project_id}`

Request:

```json
{
  "environment_id": 1,
  "dataset_ids": ["DATA-1"],
  "idempotency_key": "scenario-run-550e8400"
}
```

Return `202 Accepted` immediately after run records and event streams are
created. Do not wait for scenario execution to finish.

```json
{
  "execution_id": "SCENARIO-EXEC-1",
  "scenario_id": "SCENARIO-1",
  "scenario_version": 9,
  "status": "queued",
  "created_at": "2026-06-12T08:00:00.000Z",
  "runs": [
    {
      "run_id": "RUN-1",
      "dataset_id": "DATA-1",
      "dataset_name": "Default",
      "record_id": "RECORD-1",
      "record_name": "Valid customer",
      "status": "queued",
      "events_url": "/api/v1/scenario-runs/RUN-1/events?project_id=7",
      "detail_url": "/api/v1/scenario-runs/RUN-1?project_id=7"
    }
  ]
}
```

The same `idempotency_key` must return the same execution and run IDs without
starting duplicate work.

## 2. Subscribe to One Run

`GET /api/v1/scenario-runs/{run_id}/events?project_id={project_id}`

Headers:

```http
Accept: text/event-stream
Authorization: Bearer <token>
Last-Event-ID: 12
```

Response headers:

```http
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

If bearer authentication is required, the frontend will consume SSE through
`fetch()` streaming so it can send the Authorization and Last-Event-ID headers.

Each SSE message has a numeric ID, an event name, and one JSON object:

```text
id: 13
event: step_started
data: {"schema_version":1,"sequence":13,"event":"step_started",...}
```

## 3. Common Event Envelope

Every event data object contains:

```json
{
  "schema_version": 1,
  "sequence": 13,
  "event": "step_started",
  "run_id": "RUN-1",
  "scenario_id": "SCENARIO-1",
  "scenario_version": 9,
  "project_id": 7,
  "dataset_id": "DATA-1",
  "record_id": "RECORD-1",
  "record_name": "Valid customer",
  "occurred_at": "2026-06-12T08:00:01.120Z"
}
```

`sequence` is strictly increasing within one run. Events must be persisted
before publication. Delivery may be at least once; clients deduplicate using
`run_id + sequence`.

The frontend keeps independent progress, status, and recovery notices for each
`run_id`. When one execution creates multiple dataset-record runs, the user can
switch the canvas between them without mixing their step events.

## 4. Required Events

### run_queued

```json
{
  "event": "run_queued",
  "status": "queued",
  "total_steps": 4
}
```

### run_started

```json
{
  "event": "run_started",
  "status": "running",
  "total_steps": 4,
  "started_at": "2026-06-12T08:00:01.000Z"
}
```

### step_started

Sent immediately before executing the step:

```json
{
  "event": "step_started",
  "step_id": "STEP-2",
  "step_index": 1,
  "name": "Get company detail",
  "kind": "api_case",
  "status": "running",
  "started_at": "2026-06-12T08:00:02.000Z",
  "resolved_bindings": [
    {
      "binding_id": "BIND-1",
      "source_step_id": "STEP-1",
      "source_extraction_id": "VAR-1",
      "target": "query_params",
      "target_path": "companyId",
      "value": 9527,
      "masked": false
    }
  ]
}
```

### step_completed

Sent after request execution, extraction, and assertions are complete:

```json
{
  "event": "step_completed",
  "step_id": "STEP-2",
  "step_index": 1,
  "name": "Get company detail",
  "kind": "api_case",
  "execution_id": "EXEC-102",
  "status": "passed",
  "started_at": "2026-06-12T08:00:02.000Z",
  "finished_at": "2026-06-12T08:00:02.883Z",
  "duration_ms": 883,
  "message": "Execution passed",
  "error_message": "",
  "status_code": 200,
  "assertion_summary": {
    "total": 2,
    "passed": 2,
    "failed": 0
  },
  "extracted_variables": [
    {
      "extraction_id": "VAR-2",
      "name": "companyName",
      "path": "data.name",
      "value": "OpenAI",
      "masked": false
    }
  ],
  "resolved_bindings": []
}
```

### step_failed

`status` is `failed` or `timeout`. Return all available partial information:

```json
{
  "event": "step_failed",
  "step_id": "STEP-2",
  "step_index": 1,
  "status": "failed",
  "started_at": "2026-06-12T08:00:02.000Z",
  "finished_at": "2026-06-12T08:00:02.883Z",
  "duration_ms": 883,
  "message": "Assertion failed",
  "error_code": "ASSERTION_FAILED",
  "error_message": "Expected HTTP 200, received 500",
  "continue_on_failure": false,
  "extracted_variables": [],
  "resolved_bindings": []
}
```

### step_skipped

```json
{
  "event": "step_skipped",
  "step_id": "STEP-3",
  "step_index": 2,
  "status": "skipped",
  "reason": "previous_step_failed"
}
```

### transition_started

This event drives the connector animation between two real nodes:

```json
{
  "event": "transition_started",
  "source_step_id": "STEP-1",
  "source_step_index": 0,
  "target_step_id": "STEP-2",
  "target_step_index": 1,
  "reason": "previous_step_completed"
}
```

For a condition step, `reason` may be `condition_true` or `condition_false`.
Emit this only for the edge that the executor actually chooses.

### run_completed

```json
{
  "event": "run_completed",
  "status": "passed",
  "started_at": "2026-06-12T08:00:01.000Z",
  "finished_at": "2026-06-12T08:00:05.100Z",
  "duration_ms": 4100,
  "summary": {
    "total": 4,
    "passed": 4,
    "failed": 0,
    "timeout": 0,
    "skipped": 0
  }
}
```

### run_failed

```json
{
  "event": "run_failed",
  "status": "failed",
  "error_code": "STEP_FAILED",
  "error_message": "Scenario stopped at STEP-2",
  "failed_step_id": "STEP-2",
  "finished_at": "2026-06-12T08:00:02.883Z",
  "duration_ms": 1883,
  "summary": {
    "total": 4,
    "passed": 1,
    "failed": 1,
    "timeout": 0,
    "skipped": 2
  }
}
```

### heartbeat

Send every 15 seconds while the connection is open:

```json
{
  "event": "heartbeat",
  "status": "running"
}
```

## 5. State Machines

Run:

`queued -> running -> passed | failed | timeout | cancelled`

Step:

`pending -> running -> passed | failed | timeout | skipped | cancelled`

Execution order for two successful steps:

1. `run_queued`
2. `run_started`
3. `step_started(STEP-1)`
4. `step_completed(STEP-1)`
5. `transition_started(STEP-1 -> STEP-2)`
6. `step_started(STEP-2)`
7. `step_completed(STEP-2)`
8. `run_completed`

When a step fails:

- Emit `step_failed`.
- If `continue_on_failure=false`, emit `step_skipped` for every remaining
  pending step, then `run_failed`.
- If `continue_on_failure=true`, emit `transition_started` and continue.
  The final run status remains `failed` when any step failed.

## 6. Recovery Snapshot

`GET /api/v1/scenario-runs/{run_id}?project_id={project_id}`

This endpoint must work while the run is still executing and include:

```json
{
  "id": "RUN-1",
  "status": "running",
  "current_step_id": "STEP-2",
  "current_step_index": 1,
  "last_event_sequence": 13,
  "started_at": "2026-06-12T08:00:01.000Z",
  "finished_at": null,
  "duration_ms": 1883,
  "step_results": [
    {
      "step_id": "STEP-1",
      "step_index": 0,
      "status": "passed",
      "duration_ms": 1178,
      "extracted_variables": [],
      "resolved_bindings": []
    },
    {
      "step_id": "STEP-2",
      "step_index": 1,
      "status": "running",
      "started_at": "2026-06-12T08:00:02.000Z",
      "extracted_variables": [],
      "resolved_bindings": []
    },
    {
      "step_id": "STEP-3",
      "step_index": 2,
      "status": "pending",
      "extracted_variables": [],
      "resolved_bindings": []
    }
  ]
}
```

The final detail response continues to use the complete request, response,
assertion, extraction, and binding structures defined in
`scenario-run-detail-contract.md` and
`scenario-variable-tracing-contract.md`.

## 7. Reconnection and Retention

- Accept `Last-Event-ID`; replay all persisted events with a larger sequence.
- Keep run events available for at least 24 hours, preferably as long as the
  run detail record exists.
- Close the stream after a terminal run event has been sent.
- If replay is no longer available, return `409` with
  `{"code":"EVENT_HISTORY_EXPIRED","detail_url":"..."}`.
- The frontend reconnects a closed or failed stream at most three times using
  increasing delays and sends the last accepted sequence as `Last-Event-ID`.
- Replayed events are deduplicated by `run_id + sequence`; events whose
  sequence is not larger than the accepted sequence are ignored.
- A sequence gap immediately triggers a run-detail request so the canvas can
  be calibrated against the authoritative snapshot before live consumption
  continues.
- A `409 EVENT_HISTORY_EXPIRED` response stops replay attempts and restores
  the canvas from run detail. The response may be raw or wrapped in the
  platform response envelope under `data`.
- Connection interruption, recovery, sequence calibration, and expired
  history are shown as dismissible status notices.

## 8. Security and Payload Rules

- Preserve original JSON types; never stringify all values.
- When `masked=true`, never send the original secret value.
- Mask authorization, cookies, tokens, passwords, secrets, and API keys.
- Do not send large request or response bodies through SSE. Full snapshots
  belong in the run detail endpoint.
- Persist an immutable scenario version snapshot so step IDs and binding IDs
  remain stable throughout the run.
- Use UTC ISO-8601 timestamps with millisecond precision.

## 9. Optional Cancellation

`POST /api/v1/scenario-runs/{run_id}/cancel?project_id={project_id}`

Return `202`, stop at the next safe cancellation point, emit `step_skipped` or
`step_cancelled` as appropriate, then emit `run_cancelled`.
