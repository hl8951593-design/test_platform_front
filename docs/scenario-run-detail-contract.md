# Scenario Run Detail Contract

Status: target contract
Last verified: 2026-06-15

The frontend uses a two-level API so run history stays fast while complete
request and response snapshots remain available on demand.

## 1. Run List

`GET /api/v1/scenario-runs?project_id={project_id}&scenario_id={scenario_id}`

This endpoint should return summaries only:

```json
{
  "items": [
    {
      "id": "RUN-1",
      "scenario_id": "SCENARIO-1",
      "environment_id": 1,
      "environment_name": "UAT",
      "dataset_name": "Default",
      "record_id": "RECORD-1",
      "record_name": "Valid customer",
      "status": "passed",
      "started_at": "2026-06-11T06:56:31Z",
      "finished_at": "2026-06-11T06:56:35Z",
      "duration_ms": 4100,
      "step_results": [
        {
          "step_id": "STEP-1",
          "name": "List companies",
          "kind": "api_case",
          "status": "passed",
          "duration_ms": 1178,
          "message": "Execution passed"
        }
      ]
    }
  ]
}
```

Do not include large request or response bodies in the list endpoint.

`dataset_id`, `dataset_name`, `record_id`, and `record_name` are run identity
fields, not optional presentation metadata. The frontend uses them to
distinguish multiple records from the same dataset in the canvas switcher and
run history.

## 2. Run Detail

`GET /api/v1/scenario-runs/{run_id}?project_id={project_id}`

No new endpoint is required. This existing endpoint must return complete step
details:

```json
{
  "id": "RUN-1",
  "scenario_id": "SCENARIO-1",
  "environment_id": 1,
  "environment_name": "UAT",
  "dataset_name": "Default",
  "record_id": "RECORD-1",
  "record_name": "Valid customer",
  "status": "passed",
  "started_at": "2026-06-11T06:56:31Z",
  "finished_at": "2026-06-11T06:56:35Z",
  "duration_ms": 4100,
  "step_results": [
    {
      "step_id": "STEP-1",
      "name": "List companies",
      "kind": "api_case",
      "execution_id": "EXEC-101",
      "status": "passed",
      "duration_ms": 1178,
      "message": "Execution passed",
      "error_message": "",
      "started_at": "2026-06-11T06:56:31.100Z",
      "finished_at": "2026-06-11T06:56:32.278Z",
      "request_snapshot": {
        "method": "POST",
        "url": "https://uat.example.com/api/companies",
        "path": "/api/companies",
        "headers": {
          "Authorization": "***"
        },
        "query_params": {
          "page": 1
        },
        "body": {
          "keyword": "OpenAI"
        }
      },
      "response_snapshot": {
        "status_code": 200,
        "headers": {
          "content-type": "application/json"
        },
        "json": {
          "code": 0,
          "data": []
        },
        "received_messages": []
      },
      "assertion_results": [
        {
          "name": "HTTP status",
          "status": "passed",
          "message": "",
          "expected": 200,
          "actual": 200
        }
      ],
      "extracted_variables": [],
      "resolved_bindings": []
    }
  ]
}
```

## Requirements

- Return the final resolved request after environment and upstream-variable
  substitution.
- Preserve JSON types in request bodies, response bodies, assertion values,
  extracted variables, and resolved bindings.
- Mask Authorization, Cookie, tokens, passwords, secrets, and API keys before
  returning snapshots.
- For WebSocket steps, return connection request data and
  `response_snapshot.received_messages`.
- For failed and timed-out steps, still return any request snapshot, partial
  response, timing data, and `error_message` that exist.
- `execution_id` should reference the underlying HTTP or WebSocket execution
  record for audit and future deep links.
- If bodies are size-limited, return explicit `body_truncated` and
  `original_body_size` fields rather than silently cutting content.
