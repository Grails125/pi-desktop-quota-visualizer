# 订阅额度（Subscription Quotas）— OpenCode Go 改造版

PI-Desktop 工作面板插件：把订阅账号的剩余额度统一成「5 小时 / 每周 / 每月 / 余额」窗口，显示剩余百分比、重置倒计时与进度条（绿=剩余、灰=已用）。只显示本机已登录的账号。

本仓库是 [czp0312/pi-desktop-quota-visualizer](https://github.com/czp0312/pi-desktop-quota-visualizer) 的改造版（fork），在原版基础上新增 **OpenCode Go 登录与额度查询**。原始作者与 MIT 许可保留见 [LICENSE](LICENSE)。

## 相比原版的改动（v0.7.0）

- **输入框右侧额度圆环**：在上下文圆环左边，按当前选中模型的订阅自动切换；圆环取该订阅的第一档额度窗口（5 小时 / 周 / 月…），颜色按剩余量分级（绿/黄/红）。点击浮窗锚定在圆环上方，显示全部订阅的中文详情（与订阅额度面板一致）。仅需 `renderer.extension` + `models.list`，只读取额度摘要（账号名/窗口标签/剩余百分比/重置时间），不含令牌或邮箱，不发起网络请求。
- OpenCode Go 订阅额度查询：调用 `opencode.ai/zen/go/v1/usage`，按滚动 5 小时 / 每周 / 每月窗口显示剩余与重置倒计时。
- 自动发现 OpenCode CLI 登录（`~/.local/share/opencode/auth.json` 的 `opencode` API Key，含 `XDG_DATA_HOME` 与 Windows 回退路径）。
- 面板「管理账号」新增 **API Key 填写区**（OpenCode Go / OpenRouter）：密码框输入、保存 / 清除、配置状态提示；Key 写入插件设置 `credentials`，不回显、不写日志，保存后自动刷新额度。
- 无 Go 订阅（接口 404）时给出说明而非编造数字；凭据失效（401/403）提示重新登录。
- 新增 `opencode.ai` 域名白名单。OpenCode Go 为 API Key 订阅，不参与插件 OAuth 登录与排序推荐。

## 支持的服务商

| 服务商 | 凭据来源 |
| --- | --- |
| Anthropic (Claude Pro/Max) | 插件 OAuth / 手工令牌 / Claude Code CLI |
| OpenAI (ChatGPT Plus/Pro) | 插件 OAuth / 手工令牌 / Codex CLI |
| GitHub Copilot | 插件设备码 / 手工令牌 / 编辑器凭据 |
| OpenRouter | 面板 API Key / 手工令牌 |
| **OpenCode Go** | 面板 API Key / 手工令牌 / OpenCode CLI |
| Kimi / Meta / Radius / xAI | 自定义来源（`settings.sources`） |

## 安装

- 从本仓库 [Releases](../../releases) 下载 `io.github.czp0312.subscription-quota-0.7.0.piplug`，在 PI-Desktop 中安装；或
- 将本目录整体复制到 `~/.pi-desktop/plugins/installed/io.github.czp0312.subscription-quota`，然后在 设置 → 扩展 中关闭再开启该插件（或重启 PI-Desktop）以重载 `main.js`。

> 注意：`main.js` 只在插件加载时读入一次。仅重开面板不会生效，改动后需关闭再开启插件或重启宿主。

## 使用 OpenCode Go

1. 打开 订阅额度 → 管理账号。
2. 在「OpenCode Go · API Key 登录」粘贴 API Key（在 opencode.ai/console 的 账户 → 个人 API 密钥 创建），点「保存 Key」。
3. 面板自动刷新并显示滚动 5 小时 / 每周 / 每月额度。
4. 若本机已 `opencode auth login`，开启「自动发现 CLI / 编辑器账号」即可无需手填。

也可在 设置 → 扩展 → 订阅额度 的 `credentials` 中填 `{"opencode":"<API Key>"}`。

## 安全说明

- 不读取 PI-Desktop 宿主密钥库；插件 OAuth 令牌在本插件数据目录加密保存。
- 手工 API Key 仅保存到本插件设置，用于查询额度；不回显、不写日志、不回传面板。
- 联网受 `manifest.net.domains` 白名单约束；删除只清选中插件账号 / 手工 Key，不影响宿主 / CLI 登录。

## 开发 / 测试

```bash
npm test   # node --test tests/*.test.js（无需安装依赖，DOM 用内置 stub）
```

测试覆盖（5 个文件 / 120 项断言）：OpenCode 窗口解析与凭据发现、API Key 通道（保存/清除/校验/不回显）、面板 DOM 交互冒烟、renderer 圆环挂载/轮询/点击详情、额度摘要不泄露令牌。

## 许可

MIT（沿用上游）。见 [LICENSE](LICENSE)。