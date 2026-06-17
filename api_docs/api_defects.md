# 缺陷跟踪接口

状态：目标契约
最后核验：2026-06-17

缺陷模块用于按项目记录 Bug，并维护从创建到关闭或重新激活的生命周期。基础路径为 `/api/v1`。成功响应统一为 `{code, message, data}`。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/defects?project_id={id}` | 查询或创建当前项目缺陷 |
| GET/PUT/DELETE | `/defects/{defect_id}?project_id={id}` | 查询、更新或删除缺陷 |
| PUT | `/defects/{defect_id}/status?project_id={id}` | 推进缺陷状态 |

建议权限点包括 `defect:view`、`defect:create`、`defect:update`、`defect:delete` 和 `defect:transition`。

## 状态枚举

| 值 | 展示文案 |
| --- | --- |
| `new` | 新创建 |
| `active` | 已激活 |
| `confirmed` | 已确认 |
| `fixed` | 已修复 |
| `verified` | 已验证 |
| `closed` | 已关闭 |
| `reopened` | 重新激活 |

后端应校验状态流转合法性，并在非法流转时返回 HTTP `409` 或 `422`。

## 查询参数

```http
GET /api/v1/defects?project_id=1&keyword=支付&status=confirmed&urgency=critical&page_size=200
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `project_id` | 是 | 当前项目 ID |
| `keyword` | 否 | 按标题、指派人、报告人或内容搜索 |
| `status` | 否 | 缺陷状态 |
| `urgency` | 否 | 紧急程度 |
| `page` / `page_size` | 否 | 分页参数 |

响应可为数组，也可为 `{items,total,page,page_size}` 分页结构。前端当前兼容 `items`、`records` 和 `data`。

## 创建和更新

```json
{
  "title": "支付成功后订单状态未同步",
  "assignee": "qa_owner",
  "bug_type": "functional",
  "urgency": "critical",
  "status": "new",
  "content_html": "<p>复现步骤...</p>"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | Bug 标题 |
| `assignee` | 否 | 指派人账号、姓名或用户 ID，具体类型由后端统一 |
| `bug_type` | 是 | `functional`、`ui`、`performance`、`security`、`compatibility`、`data`、`other` |
| `urgency` | 是 | `low`、`medium`、`high`、`critical` |
| `status` | 是 | 当前状态；创建时默认建议为 `new` |
| `content_html` | 是 | 富文本内容 HTML，可包含服务端允许的图片地址或安全的内联图片 |

后端应清洗富文本 HTML，禁止脚本、事件属性和不安全 URL。若使用独立文件存储，建议把粘贴图片转换为附件 URL 后返回标准 `content_html`。

## 状态流转

```http
PUT /api/v1/defects/18/status?project_id=1
```

```json
{
  "status": "fixed"
}
```

响应返回更新后的缺陷对象。若状态已被其他用户修改，建议返回 HTTP `409` 并附带当前状态，前端重新加载列表后再操作。

## 响应对象

```json
{
  "id": 18,
  "project_id": 1,
  "title": "支付成功后订单状态未同步",
  "assignee_name": "李雷",
  "bug_type": "functional",
  "urgency": "critical",
  "status": "confirmed",
  "content_html": "<p>复现步骤...</p>",
  "reporter_name": "韩梅梅",
  "created_at": "2026-06-17T08:00:00",
  "updated_at": "2026-06-17T09:00:00"
}
```

