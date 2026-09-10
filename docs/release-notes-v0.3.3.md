# v0.3.3 操作可靠性

日期：2026-09-10

## 已实现

- 单项编辑、单项删除、批量编辑/删除、快速导入、JSON/Netscape 数据包和 Saved States 应用统一通过后台操作引擎写入。操作固定 tab、origin、Cookie store、浏览模式和每项操作前后状态。
- 后台先持久化完整任务，再回复接收确认；每项写入前记录意图，写入后保存结果。Popup 关闭不会丢失已经确认接收的任务。Service Worker 重启时对照现值、操作前值和预期结果恢复，未执行项目继续处理，无法确认的项目保留为冲突。
- 最近修改记录覆盖删除和所有导入入口；值快照来自统一 journal，本地只持久化不含值的摘要。历史中的 Operations 展示完整任务、逐项状态、失败原因、重试、撤销和移除记录。
- 重试仅处理失败/冲突项，继续使用原始操作前状态；成功项不重放。撤销可按单项或整批执行，倒序处理，操作后又发生变化的条目拒绝覆盖。
- Web Storage 在实际文档内同步比较旧值并写入/删除，区分空字符串与不存在。Cookie 读写核对 store、partition、domain、path、name 及可写属性，删除前还核对 Chrome 实际选择的同名候选。
- Chrome 自动缩短 Cookie 到期时间且 API 返回值与回读一致时，记录实际结果用于撤销，并保留原请求用于请求 ID 幂等检查。
- Popup/Side Panel 的站点写入通过同一个后台队列串行处理；收藏和 Saved States 使用 Web Locks 与增量更新，最后浏览的各数据视图选择合并保存，避免过期数组覆盖其他界面的更新。
- journal 最多保留 100 个批次，按预估 checkpoint 大小检查 session quota；容量不足在写入前拒绝，不自动淘汰旧任务。用户可移除已完成记录释放空间。Recent changes 的 Clear 只清除该类型的最近摘要，完整任务通过 Operations 单独移除。
- 后台进度刷新保留当前反馈和草稿；收藏写入期间显示忙碌状态，防止重复提交。
- 手动刷新取消已经排队的 Cookie 监听刷新，避免大量 Cookie 变化后重复刷新重建刚选中的行。

## 验证

| 检查 | 结果 |
|---|---|
| `npm run lint` | 通过 |
| `npm test` | 178 项通过 |
| `npm run verify:m4` | 通过 |
| `npm run test:acceptance` | 完整工作流通过，包含大量 Cookie 下的局部选择检查 |
| `npm run test:acceptance:v032` | 通过，目标隔离、草稿、Reset、历史撤销和 Saved States 容量回归 |
| `npm run test:acceptance:v033` | 通过，7 个浏览器场景 |

v0.3.3 专项验证包含真实 action Popup 发起、关闭及重开后恢复任务，部分失败重试，后续修改导致撤销冲突，两个扩展界面并发写入冲突，Worker 在写入前/后被 CDP 强制停止后的恢复，以及结果界面的重试、撤销、移除记录与 760px/420px 布局。真实 Popup 通过 `chrome.action.openPopup` 打开，用 `chrome.extension.getViews({type: "popup"})` 确认身份后经 CDP 操作，没有用扩展页面回退代替该项通过。

Worker 在等待 Chrome 写入回调时仍可读取已保存进度；恢复场景确认后续项目继续执行。两种布局的截图已检查，无页面或任务列表横向溢出，冲突原因可见。单测另覆盖 quota 预检、持久化失败、旧快照、精确 Cookie 身份、到期时间规范化和多界面本地更新。

完整回归中的收藏持久化断言改为等待实际存储确认，同批次历史按项目顺序稳定倒序排列；近期摘要和完整任务共享同一份操作记录。完整工作流脚本使用扩展页面回退模式，真实 Popup 生命周期由 v0.3.3 专项独立验证。

专项脚本：`npm run test:acceptance:v033`。报告与截图位于 `.tmp/v033-acceptance/`，仅使用合成测试数据。

## 使用边界

- 任务和完整值快照保存在 `chrome.storage.session`，可跨 Popup/Side Panel 关闭及 Service Worker 重启恢复；浏览器会话结束或扩展重载后不保留恢复能力。普通本地历史摘要仍可查看。
- 升级前的历史快照没有完整操作后状态，保留查看能力，停止提供旧记录撤销；旧导入批次不会被自动重放。
- Cookie API 没有原子 compare-and-set。扩展界面之间已串行；网站/网络响应仍可能在读取与写入之间修改 Cookie，前后核验不能提供数据库事务级隔离。删除的同名候选不确定时直接拒绝。
- Worker 恰在 Chrome 调整 Cookie 到期时间、但实际结果尚未 checkpoint 的窗口停止时，恢复会保守报告冲突。不会猜测并覆盖当前数据。
- Session Storage 撤销要求原 tab，允许同 tab 刷新；Local Storage/Cookie 撤销可使用相同 origin、store、浏览模式的其他 tab。批次失败项重试仍指向发起时的原 tab，标签页关闭时会明确失败。
- 编辑草稿仍仅保留在当前打开的界面内。收藏、布局和最后选择是异步偏好保存，不提供站点操作 journal 的接收确认协议。
- CHIPS、真实无痕窗口、HTTPS、权限撤销与跨域同名 Cookie 的完整兼容矩阵继续在发布工程阶段扩展。

重新加载当前目录的扩展可使用 Manifest 版本 `0.3.3`。本轮不包含上传商店或发布 zip。
