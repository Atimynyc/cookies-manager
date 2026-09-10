# v0.3.2 稳定性修复

日期：2026-09-10

## 已实现

- 单项编辑、删除、快速导入和数据包操作固定发起时的 tab、origin、Cookie store 和浏览模式；执行时复核目标，避免切换或导航后误写。
- Storage 在注入函数内部验证实际 origin，并回读确认写入和删除结果；自动刷新前再次校验目标，已导航的页面不会被误刷新。
- 历史快照记录目标信息。Cookie 撤销保持原 store、domain、path 和 partition；Local Storage 要求相同 origin/浏览模式；Session Storage 还要求原 tab，同 tab 刷新可继续撤销。
- 旧快照缺少目标信息时禁用撤销并显示原因；读取或写入期间禁用冲突操作，防止重复 Undo。
- 修复 Reset 的未定义函数调用，完整更新值、过期时间、编辑器高度、保存状态和工具结果。
- 草稿按目标、数据类型和项目保留；重复点选、刷新和切换后可恢复。保存前重读页面数据，外部变化需要确认覆盖，取消确认会保留草稿。
- Saved States 创建/复制超过 50 项时拒绝保存并保留全部原数据；已有超限集合仍可完整读取、重命名和删除。Chrome quota 预检及实际写入错误均有可见反馈。
- 错误提示保持到用户关闭或新状态替换；静态检查加入 `no-undef`；浏览器验收捕获未处理页面异常并使用独立临时截图目录。

## 验证

| 检查 | 结果 |
|---|---|
| `npm run lint` | 通过 |
| `npm test` | 86/86 通过 |
| `npm run verify:m4` | 通过 |
| `npm run test:acceptance` | 通过 |
| `npm run test:acceptance:v032` | 通过 |

完整验收覆盖 Popup/Side Panel 的常用编辑、批量操作、JSON/Netscape 导入导出、Saved States、Storage、历史和撤销。截图默认位于 `.tmp/acceptance-artifacts/`。

专项浏览器验收覆盖跨站草稿保留、外部更新确认/取消、Reset、Storage 实际文档 origin 拒绝、Local Storage 跨站撤销限制、Session Storage 跨 tab 撤销限制及回原 tab 恢复、Saved States 上限和已有数据完整保留。760px 主界面、420px 侧边栏截图已检查，容量错误文本可见且无横向溢出；专项截图位于 `.tmp/v032-acceptance/`。

## 使用边界

- 草稿仅保存在当前打开的扩展界面内，关闭该 Popup 或 Side Panel 后不持久保留。
- 本轮浏览器验收使用扩展页面模式；完整脚本尝试真实 action Popup 后回退，不代表真实 Popup 关闭时的任务恢复已经通过验证。
- 长批次关闭后的恢复、统一操作日志、预览与写入之间的数据冲突检查及并发界面协调继续按 v0.3.3 安排。
- 无痕/store 隔离及 CHIPS 身份保留有控制器测试，完整真实浏览器兼容矩阵按后续发布计划补齐。

重新加载当前目录的扩展可使用 Manifest 版本 `0.3.2`。
