# WebSocket 测试用例接口

WebSocket 测试用例与 HTTP 测试用例完全独立，仅复用项目环境、环境变量和项目权限。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/websocket-test-cases?project_id={project_id}` | 查询用例 |
| POST | `/websocket-test-cases?project_id={project_id}` | 新增用例 |
| PUT | `/websocket-test-cases/{id}?project_id={project_id}` | 更新用例 |
| POST | `/websocket-test-cases/{id}/execute?project_id={project_id}` | 执行已保存用例 |
| POST | `/websocket-test-cases/execute-unsaved?project_id={project_id}` | 执行未保存用例 |
| POST | `/websocket-test-cases/batch-execute?project_id={project_id}` | 批量执行 |

## 核心配置

```json
{
  "name": "连接并校验欢迎消息",
  "environment_id": 1,
  "path": "/ws/chat/{{room_id}}",
  "headers": {"Authorization": "Bearer {{token}}"},
  "subprotocols": ["json"],
  "messages": [{"type": "json", "data": {"action": "join"}}],
  "receive_count": 1,
  "connect_timeout_ms": 10000,
  "receive_timeout_ms": 10000,
  "assertions": [{"type": "message_count", "expected": 1}],
  "extractors": [{"name": "connection_id", "message_index": 0, "path": "connection_id"}]
}
```

完整 `ws://` 或 `wss://` 地址可以不绑定环境；相对路径必须绑定环境。`path`、headers、subprotocols
和发送消息支持环境变量替换。

断言支持 `message_count`、`message_contains`、`message_json_equals`。执行结果包含 `session_snapshot`、
`response_snapshot`、`assertion_results`、`error_message` 和 `duration_ms`。
