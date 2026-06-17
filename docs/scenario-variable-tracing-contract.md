# Scenario Variable Tracing Contract

Status: target contract implemented by the current frontend mapper
Last verified: 2026-06-15

The scenario run detail endpoint must return the values that were actually
produced and consumed by the execution engine. The frontend must not infer
runtime values from request templates or response snapshots.

## Endpoint

`GET /api/v1/scenario-runs/{run_id}?project_id={project_id}`

## Step Result Fields

Each item in `step_results` should include:

```json
{
  "step_id": "STEP-2",
  "name": "Get company detail",
  "status": "passed",
  "duration_ms": 120,
  "message": "Execution passed",
  "extracted_variables": [
    {
      "extraction_id": "VAR-2",
      "name": "companyName",
      "path": "data.name",
      "value": "OpenAI",
      "masked": false
    }
  ],
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

## Scenario Configuration

The frontend persists explicit extraction and binding IDs in each step config:

```json
{
  "_scenario_context": {
    "extractions": [
      {
        "id": "VAR-1",
        "name": "companyId",
        "path": "data.id",
        "masked": false
      }
    ],
    "bindings": [
      {
        "id": "BIND-1",
        "name": "companyId",
        "source_step_id": "STEP-1",
        "source_extraction_id": "VAR-1",
        "target": "query_params",
        "target_path": "companyId"
      }
    ]
  },
  "query_params": {
    "companyId": "{{companyId}}"
  }
}
```

## Semantics

- `extracted_variables.value` is the value after JSON path extraction and any
  execution-engine conversion.
- `resolved_bindings.value` is the final value written to the target request
  field.
- Values preserve their JSON type: string, number, boolean, null, array, or
  object.
- `masked=true` means the API must not return the secret value. It may return a
  fixed placeholder or `null`; the frontend renders a fixed masked marker.
- Failed extraction is still represented with `value: null` and an `error`
  field rather than being silently omitted.
- IDs must match the scenario version snapshot used by the run.
- Runtime values are rendered only from `extracted_variables` and
  `resolved_bindings`. The frontend never infers them from templates,
  response output, or the source extraction of a binding.
- Historical runs created before tracing support show no runtime value.
- The frontend reads legacy camelCase config metadata, but always writes the
  snake_case backend contract.
