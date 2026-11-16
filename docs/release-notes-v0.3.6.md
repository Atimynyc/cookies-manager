# v0.3.6 发布

发布版本从 `0.3.5` 升级为 `0.3.6`，用于本次 Chrome Web Store 上传。

- 新增罗马尼亚语（Română），包含 562 条界面文案和 `store-assets/store-listing-ro.txt` 商店说明；扩展共支持九种语言。
- 首次安装可自动匹配 `ro`、`ro-RO`、`ro-MD`，也可在设置中手动切换；保留用户已保存的语言选择。
- 发布包：`release/cookie-controller-0.3.6.zip`，311,926 bytes，68 个文件。
- SHA-256：`50B25574097BCE8E5F063D2AE69A39535AB81DAF559B8D3C416B4378B0CD440A`；校验文件：`release/cookie-controller-0.3.6.zip.sha256`。
- ZIP 根目录包含 `manifest.json`，包内仅包含 `manifest.json`、`assets/`、`src/` 和完整的 `_locales/`，已逐文件校验与当前源码一致。
- 本次升级版本号后，九种语言的键、占位符和商店文案长度检查通过，并重新核对 Manifest 版本、运行资源和可选站点权限。

上一轮已通过 192 项单元测试、JavaScript lint、九种语言和英语回退的浏览器验收，以及完整扩展验收；本次只升级版本号并重新打包。功能与既有验证边界见 [v0.3.5 发布记录](release-notes-v0.3.5.md)。
