# 界面与商店本地化

扩展包含 `en`、`zh_CN`、`zh_TW`、`es`、`pt_BR`、`de`、`fr`、`ja`、`ro` 九份本地词库。首次安装时读取 `chrome.i18n.getUILanguage()`，将支持的地区变体匹配到对应词库，未匹配时选择英语，并保存为具体语言。中文按简繁体脚本或地区匹配（台湾、香港、澳门使用繁体）；葡萄牙语使用现有的巴西葡萄牙语词库；罗马尼亚语的 `ro`、`ro-RO`、`ro-MD` 均匹配 `ro`。右上角设置显示九种具体语言，罗马尼亚语名称为 Română，可随时手动更改。界面通过扩展本地 URL 加载对应词库，由同一个 `t` 接口解析原生占位符，运行时无需访问翻译服务。Manifest 的商店名称/描述仍由 Chrome 处理。

语言保存在 `chrome.storage.local` 的 `uiLanguage` 中。`initializeI18n()` 在界面初始化和后台请求执行前恢复语言；首次选择及旧版本 `auto` 语言偏好的迁移通过同一个存储锁执行，保存后不再跟随 Chrome 语言变化，也不会覆盖已保存的手动选择。设置变更通过 `storage.onChanged` 同步到其他扩展界面。更换语言只重绘界面，不重载扩展或目标网页，保留编辑草稿和用户数据。

皮肤采用太阳/月亮按钮，参考 [DaisyUI Swap](https://daisyui.com/components/swap/) 的双图标切换交互，使用项目现有的原生按钮与 SVG 实现。太阳对应浅色，月亮对应深色；普通模式未设置时默认浅色，隐私模式未设置时默认深色。两种模式分别保存到 `uiThemeRegular` 和 `uiThemeIncognito`（`light` / `dark`），旧版全局 `uiTheme` 不参与选择，也不再跟随系统外观。保存时捕获当前模式，异步完成期间即使切换窗口，也只更新该模式的偏好。主题控制器会通知设置按钮同步图标和无障碍开关状态，存储失败时恢复之前的皮肤。

## 新增或修改文案

JavaScript 使用 `src/shared/i18n.js` 的 `t`，英文原文同时作为可读回退文本。动态数据必须作为替换参数传入：

```js
import { t } from "../shared/i18n.js";
button.textContent = t("Save changes");
message.textContent = t`Delete ${item.name}?`;
```

`messageKey(source)` 生成稳定的 Chrome 消息键。标记模板的动态位置在原文中表示为 `$1`、`$2` 等；词库中写为 `$slot_1$`、`$slot_2$`，并声明 `placeholders.slot_1.content: "$1"`。保留占位符数量，允许译文调整顺序。修改原文后需要更新所有语言的对应键。

静态 HTML 使用 `data-i18n="English source"` 和 `data-i18n-attrs="title aria-label"`。元素中的直接子元素以 `$1` 等槽位保留，可保留按钮图标、输入框、强调文本和代码示例。`localizeDocument()` 保留原文和子元素引用，首次加载和语言切换时处理这些标记；已被业务逻辑改写文本或追加子控件的元素由对应视图重绘，保留列宽调整等控件。模块级文案使用 getter 在访问时翻译，避免切换后仍保留首次加载的语言。

使用 `node scripts/i18n-source.mjs` 提取当前 JavaScript 和 HTML 中的原文、键及来源文件。`npm run test:locales` 会检查这些文案是否存在于英文词库，同时检查各语言键集合、占位符和商店长度限制。

## 翻译流程

本轮静态文案通过已授权的 DeepL MCP 翻译，并对技术歧义补充英文上下文后重新翻译。当前账号无法使用文档上传翻译，因此按提取的界面词条分批翻译。后续使用相同流程时：

1. 只提交扩展静态文案，并保留关联界面上下文。
2. 用固定标记保护参数、技术术语、URL 和代码示例。不要把 `$1` 直接提交为普通文本，以免被误认为金额。
3. 还原标记后，核对各参数的数量，复核 “key”、网站来源、会话和 Cookie 存储等术语。
4. 更新 `_locales/{locale}/messages.json`，保留英文 `description` 方便校对；运行词库和浏览器检查。

Cookie 名称、值、域名、路径、Storage 键值、用户保存的状态及导入内容均属于用户数据，不进入翻译流程。JSON 字段、内部枚举、数据类型、错误码、SameSite 属性值和 Netscape 文件头保持原样。页面内注入的函数不能引用扩展模块，应在返回扩展上下文后翻译固定错误。

## 验证与打包

```text
npm run lint
npm test
npm run test:locales
npm run test:locales:browser
npm run test:theme:browser
npm run test:acceptance
```

多语言浏览器检查覆盖九种支持语言、意大利语回退、独立语言与皮肤切换、设置持久化、跨界面同步、未保存草稿、键盘操作、原始数据保留、Cookie 编辑/快速导入、JSON/Netscape 导出、Storage 视图及 380px 侧边栏。语言列表和词库校验均使用 `UI_LANGUAGES`，新增语言会自动纳入手动切换和词库一致性检查；浏览器启动语言用例仍需单独添加。结果与截图位于 `output/playwright/locales/`。

主题专项浏览器检查在临时 Chrome 配置中启用隐私访问，验证真实隐私窗口中的原生 action 弹窗：默认黑色、改成白色后关闭并重开仍为白色、普通窗口的选择不受影响。同时覆盖普通模式默认白色、忽略系统深浅色、同模式同步、重载持久化、键盘操作及保存失败后的恢复。结果与截图位于 `output/playwright/themes/`。

发布包必须包含 `manifest.json`、`assets/`、`src/` 和完整 `_locales/`。`store-assets/store-listing-*.txt` 是各语言的商店文案草稿，短描述不超过 80 个字符；Manifest 描述不超过 132 个字符。商店文案与既有英文宣传图需在 Chrome Web Store 开发者后台分别配置。
