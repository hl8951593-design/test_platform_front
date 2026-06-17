# Scenario Data-Driven Request Override Contract

Status: target contract aligned with the current frontend data model
Last verified: 2026-06-15

## Goal

Data-driven execution changes concrete request fields for each scenario run. A dataset may override request paths, headers, query parameters, and arbitrarily nested request body fields without modifying the saved step template.

## Dataset Shape

```json
{
  "id": "DATA-1",
  "name": "VIP customer",
  "enabled": true,
  "variables": {
    "tenant_id": 1001
  },
  "records": [
    {
      "id": "RECORD-1",
      "name": "VIP customer",
      "enabled": true,
      "request_overrides": [
        {
          "step_id": "STEP-CREATE-ORDER",
          "target": "body",
          "path": "order.customer.profile.level",
          "value": "VIP"
        },
        {
          "step_id": "STEP-CREATE-ORDER",
          "target": "query_params",
          "path": "dry_run",
          "value": false
        }
      ]
    },
    {
      "id": "RECORD-2",
      "name": "Blocked customer",
      "enabled": true,
      "request_overrides": [
        {
          "step_id": "STEP-CREATE-ORDER",
          "target": "body",
          "path": "order.customer.profile.level",
          "value": "BLOCKED"
        },
        {
          "step_id": "STEP-CREATE-ORDER",
          "target": "query_params",
          "path": "dry_run",
          "value": true
        }
      ]
    }
  ]
}
```

`target` supports:

- `path`: replace the full request path; `path` must be empty.
- `headers`: override the header named by `path`.
- `query_params`: override the query parameter named by `path`.
- `body`: override a nested JSON field. Dot segments and array indexes are supported, for example `orders[0].items[2].sku`.

Each record is a complete test input and produces one independent scenario
run when both the dataset and record are enabled. `value` is JSON typed and
must retain strings, numbers, booleans, nulls, objects, and arrays.

The run launch item and persisted run detail should include `record_id` and
`record_name`. This is required to distinguish multiple runs produced by the
same dataset. The frontend maps these fields from launch responses, realtime
events, run lists, and run details. The canvas run switcher and run history use
the identity as `dataset_name · record_name`, with `record_id` as the stable
fallback when a display name is unavailable.

## Execution Order

For every test record in every enabled dataset:

1. Load the immutable scenario version and step request snapshots.
2. Copy each step request before mutation.
3. Apply the current record's `request_overrides` belonging to the current step.
4. Resolve dataset `variables`, environment variables, and upstream step bindings.
5. Validate the resulting request against the protocol-specific request schema.
6. Execute the request and store the resolved request snapshot in the run detail.

Request overrides take precedence over the saved request snapshot. Template and upstream variable resolution runs after overrides so an override value may itself contain a template expression.

An actual array request value is stored directly in `value`, for example
`"value": [1, 2]`.

## Validation

The backend should reject the scenario save or execution with HTTP `400` when:

- `step_id` does not exist in the selected scenario version.
- `target` is not supported by the step kind.
- A body path traverses a scalar value.
- An array index is invalid.
- A non-empty field path is provided for `target=path`.
- A record does not have an `id` or name.
- Two overrides in one record address the same `step_id + target + path`.

Error responses should include `dataset_id`, `step_id`, `target`, and `path` so the frontend can focus the exact field.

## Compatibility

Datasets without records remain valid and may be normalized to one empty
record. Existing `variables` continue to support environment-style and custom
template variables. During migration, the backend may accept dataset-level
`request_overrides`: each index in legacy `values` becomes one record, while a
legacy single `value` becomes one record. New responses and writes should use
`records`.

## Frontend Editing Semantics

- The field picker is derived from saved step request configuration.
- Nested body fields are presented as structured paths; users do not maintain
  path strings manually.
- Selecting a request field adds it to every record in every dataset with the
  original request value as the initial value.
- Removing a driven field removes the matching
  `step_id + target + path` override from every record.
- Adding a record copies the previous record's field structure and values so
  the user can change only the relevant cases.
- The legacy free-form dataset maintenance entry is not displayed as the
  primary editor.
