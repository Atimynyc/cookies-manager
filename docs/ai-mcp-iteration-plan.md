# Cookie Controller 本地 AI / MCP 迭代计划

更新日期：2026-09-23

## 1. 目标

让 Claude Code、Codex、Kiro、Cursor、Claw Code 等支持 MCP 的本地 AI 工具，可以在用户授权后直接操作当前 Chrome 标签页的 Cookie、Local Storage 和 Session Storage。

产品目标不是让每个客户端分别集成 Chrome，而是提供一套统一的本地连接能力：

```text
AI 客户端 -> 标准 MCP Server -> Chrome Native Messaging -> Cookie Controller 扩展
```

用户只需安装一次 Companion/连接器；MCP Server 由 AI 客户端按需通过 stdio 自动启动，不要求用户手动运行后台服务。

## 2. 非目标与边界

- 不把 MCP Server 运行在 Chrome 扩展内部。扩展 Service Worker 负责浏览器 API 和操作执行，MCP Server 是独立本地进程。
- 不引入云端代理、账号系统、遥测或远程 Cookie 存储。
- 第一版不支持远程机器控制本地浏览器。
- 不默认开放所有站点的批量导出、删除或敏感值读取。
- 不通过 Playwright 点击 Popup 作为正式协议。

## 3. 总体架构

### 3.1 组件

1. **Chrome Extension**：复用现有 `operation-engine`、操作日志、撤销和目标校验能力，新增 Native Messaging 入口。
2. **MCP Server**：独立 Node.js/TypeScript 项目，提供 MCP 工具、参数校验、权限策略和错误转换。
3. **Native Host**：Windows/macOS 平台桥接程序，负责 Chrome Native Messaging 的 stdin/stdout 协议。可以与 MCP Server 合并为一个可执行文件，但职责边界要保持清晰。
4. **Installer/Companion**：安装扩展配套文件、注册 Native Messaging Host、配置客户端启动命令和卸载流程。

### 3.2 生命周期

```text
AI 客户端启动或首次调用工具
  -> 自动启动 cookie-controller-mcp
  -> MCP Server 连接 Native Host
  -> Chrome 唤醒扩展 Service Worker
  -> 执行操作并返回结构化结果
  -> AI 客户端退出时结束 MCP 进程
```

不做常驻系统服务作为第一版依赖。Chrome 未运行时返回可操作提示，而不是静默失败。

## 4. 版本路线图

| 版本 | 主题 | 核心交付 | 预计工作量 |
|---|---|---|---|
| AI-0.1 | 协议与内部命令层 | 统一命令模型、权限边界、扩展端 Native Messaging 骨架 | 3-5 人日 |
| AI-0.2 | MCP MVP | stdio MCP Server、只读工具、结构化错误和客户端手工配置文档 | 4-6 人日 |
| AI-0.3 | 安全写操作 | 预览/确认、域名白名单、删除/覆盖/导出保护、撤销联动 | 5-8 人日 |
| AI-0.4 | 跨平台连接器 | Windows/macOS Native Host、签名/权限检查、连接诊断 | 5-8 人日 |
| AI-0.5 | 安装与无感启动 | Companion 安装器、自动注册 Host、客户端配置向导和升级/卸载 | 6-10 人日 |
| AI-0.6 | 多客户端发布 | Claude Code、Codex、Cursor、Kiro、Claw Code 验证矩阵与文档 | 3-5 人日 |
| AI-1.0 | 稳定发布 | 安全审计、完整验收、隐私说明、故障恢复和版本兼容策略 | 5-8 人日 |

工作量为单人开发、测试和文档的粗略估算，不包含商店审核、代码签名和 notarization 等外部等待时间。

## 5. AI-0.1：协议与扩展命令层

### 目标

把现有扩展内部消息整理成稳定、可版本化、可审计的本地控制协议。

### 任务

- 将 `submit/list/get/retry/undo/forget` 抽取为统一的 `handleExternalCommand()`。
- 增加协议版本、request id、client name、capabilities 和 timeout 字段。
- Native Messaging 消息只允许 JSON 对象，拒绝未知命令和超大 payload。
- 校验请求目标：当前 tab、origin、Cookie store、Session Storage tab 语义必须明确。
- 统一错误码：`INVALID_REQUEST`、`PERMISSION_DENIED`、`TARGET_UNAVAILABLE`、`OPERATION_FAILED`、`CONFIRMATION_REQUIRED`。
- 保持现有操作日志、重试、冲突校验和撤销机制，不为 AI 另建一套写入引擎。

### 验收

- 扩展内部 Popup 调用与外部命令共享同一业务处理函数。
- 未授权来源、未知命令、无效目标和过大请求不会触发写入。
- 所有请求和结果都带 request id，日志不包含 Cookie value、token 或密码。

## 6. AI-0.2：MCP MVP

### 首批工具

- `get_current_tab`
- `list_current_site_cookies`
- `get_cookie_metadata`
- `list_local_storage`
- `list_session_storage`
- `get_operation`
- `list_operations`

第一版优先只读，降低权限和误操作风险。工具返回结构化数据，并在描述中明确当前 tab、origin 和敏感数据边界。

### 任务

- 使用标准 stdio MCP，不依赖 HTTP 端口。
- MCP 参数使用 JSON Schema，禁止任意命令执行。
- Native Messaging 断开、Chrome 未启动、特殊 URL 和权限不足均转换为可理解错误。
- 提供各客户端的最小配置示例，但不把客户端差异写入核心业务代码。

### 验收

- 一个 MCP Server 可被至少两个 MCP 客户端同时配置和独立启动。
- 不启动终端服务时，客户端仍能在首次调用时自动拉起 MCP Server。
- 扩展关闭 Popup 不影响正在进行的只读请求。

## 7. AI-0.3：安全写操作

### 工具与流程

写操作必须采用两阶段：

```text
preview_* -> 返回变更摘要和 operationId
confirm_operation -> 执行写入并返回结果
undo_operation -> 在目标仍匹配时撤销
```

增加：

- `preview_set_cookie`、`preview_delete_cookie`。
- `preview_set_storage`、`preview_delete_storage`。
- 当前站点默认范围，跨域必须显式指定。
- 域名白名单和敏感域名额外确认。
- `dryRun` 默认开启，批量删除/覆盖必须带 `confirm=true`。
- 返回 before/after 摘要、成功/失败/跳过数量和 operationId。

### 安全要求

- 不向 AI 工具默认返回全量敏感 Cookie value；提供按项读取和脱敏摘要。
- 不在 stdout、普通日志或错误堆栈中记录 Cookie value、token、手机号等敏感信息。
- 设置单次返回条数、payload 大小和批量写入数量上限。
- `HttpOnly`、认证、支付和企业域名支持额外确认策略。

## 8. AI-0.4：Windows/macOS 连接器

### Windows

- 注册 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.cookiecontroller.bridge`。
- Native Host 使用绝对路径，安装目录默认位于 `Program Files` 或用户应用目录。
- 处理 Defender/SmartScreen、卸载和多用户安装场景。

### macOS

- 写入 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.cookiecontroller.bridge.json`。
- 支持 Apple Silicon、Intel，正式版提供签名和 notarization。
- 检查可执行权限；协议调试日志写 stderr，不污染 stdout。

### 验收

- Chrome 重启、扩展 Service Worker 休眠/唤醒、Native Host 重连均可恢复。
- Chrome 未安装、扩展 ID 不匹配、Host 路径失效时有明确诊断。
- Windows 和 macOS 的只读、写入、撤销流程结果一致。

## 9. AI-0.5：安装与无感启动

### 安装器职责

- 安装 MCP/Native Host 可执行文件。
- 注册 Native Messaging Host。
- 检测 Chrome 扩展 ID 和版本。
- 为已安装的 Claude Code、Codex、Cursor、Kiro、Claw Code 写入或生成配置。
- 提供“测试连接”和“修复配置”入口。
- 支持升级保留白名单和本地设置，卸载时移除注册项与配置但不删除浏览器站点数据。

### 用户流程

1. 安装 Chrome 扩展。
2. 安装一次 Companion。
3. 安装器完成 Host 注册和客户端配置。
4. 重启一次已打开的 AI 客户端。
5. 后续由 MCP 客户端自动启动 Server，用户不手动运行脚本或后台服务。

## 10. AI-0.6：客户端兼容矩阵

每个客户端验证：配置格式、stdio 启动、工具发现、超时、错误展示、进程退出和升级后的配置保留。

| 客户端 | 目标 | 验收重点 |
|---|---|---|
| Claude Code | 支持命令行配置和项目/用户级配置 | 首次调用自动启动、重连、权限提示 |
| Codex | 支持 MCP 配置文件 | 工具发现、结构化结果和超时 |
| Cursor | 支持项目级 JSON 配置 | 多工作区配置和重启行为 |
| Kiro | 支持 MCP 配置 | 安装器写入与手工修复 |
| Claw Code | 支持标准 MCP 即可接入 | 配置路径和协议兼容性 |

不在核心代码中硬编码客户端版本；安装器通过适配器写配置，无法自动配置时生成可复制的诊断命令。

## 11. 测试与发布门槛

- 单元测试：协议校验、工具参数、错误映射、白名单、脱敏、确认状态机。
- 扩展测试：Native Messaging 消息路由、Worker 重启、目标隔离、操作撤销。
- 连接器测试：Windows/macOS Host stdin/stdout framing、断连重连、路径和权限。
- 端到端测试：至少覆盖 Cookie 读取、Cookie 删除预览/确认/撤销、Local Storage 修改和失败恢复。
- 安全测试：未授权 origin、伪造 request id、超大 payload、跨域目标、敏感值泄漏。
- 发布包不包含测试密钥、调试日志或完整 Cookie 样本。

发布前必须完成：隐私说明、权限说明、安装/卸载文档、故障排查页、Windows 签名、macOS 签名与 notarization。

## 12. 风险与决策点

- **Native Messaging 依赖安装器**：Chrome Web Store 不能自动安装本地程序，因此 Companion 是正式功能的一部分。
- **客户端配置差异**：优先支持标准 stdio MCP，客户端适配只放在安装器和文档层。
- **敏感数据风险**：默认只读、当前站点、脱敏和两阶段写入，逐步开放能力。
- **扩展 ID 变化**：生产扩展应固定发布 ID；开发版和商店版的 Host 配置分开。
- **Chrome 休眠模型**：所有请求必须可重连，不依赖 Service Worker 常驻内存。
- **浏览器权限变化**：继续复用现有权限模型，新增 AI 通道不扩大站点权限范围。

## 13. 首个可交付版本定义

AI-0.3 完成后即可作为内部预览版：用户安装扩展和 Companion，配置一个 MCP 客户端后，可以在当前站点完成 Cookie/Storage 的读取、预览修改、确认写入和撤销；所有数据留在本机，MCP Server 由客户端自动启动。

AI-1.0 才面向公开分发，要求 Windows/macOS 安装器、签名、客户端兼容矩阵、完整安全测试和清晰的隐私/权限说明全部完成。
