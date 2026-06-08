# TestAuto Dev Test Platform

TestAuto 是一个面向自动化测试设计、执行、诊断和报告分析的前端项目。当前项目使用 React、TypeScript 和 Vite 构建。

## 常用命令

```bash
npm install
npm run dev
npm test
npm run build
```

## 环境配置

认证接口默认请求：

```text
http://127.0.0.1:8000/api/v1
```

如需切换测试或线上环境，在 `.env` 中配置：

```text
VITE_API_BASE_URL=http://example.com/api/v1
```

## 技术文档

开发过程中需要持续维护技术文档，记录功能模块、业务逻辑、接口契约、数据权限和用户权限关系：

[docs/technical-architecture.md](docs/technical-architecture.md)
