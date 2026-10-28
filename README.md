# Codex Bilibili Sidebar

在 Codex 右侧浏览器中使用的本地 B 站播放器与便笺工具。

- 扫码登录，读取账号的个性化首页推荐；支持上一条、下一条和手动粘贴视频链接。
- 登录后优先播放可用的 1080P，支持画质切换和亮度调节。
- Windows 下加密记住登录，重启服务后自动恢复，凭据失效时重新扫码。
- 「专注」按钮和 F8 / Esc 隐藏视频区域，保留播放状态。
- 便笺、待办和草稿在浏览器本地保存。

## 本地运行

需要 Node.js 20 或更新版本，以及 pnpm。登录持久化使用 Windows DPAPI；其他平台不保存登录凭据。

```sh
cd sidebar-notes
pnpm install --frozen-lockfile
node launch.mjs
```

在 Codex 内置浏览器打开 <http://127.0.0.1:17329/>，首次使用点「账号 → 扫码登录」。Windows 安装依赖后也可以双击 `sidebar-notes/start.cmd` 启动。

停止服务：

```sh
node launch.mjs stop
```

运行检查（在 `sidebar-notes` 目录）：

```sh
node --test test/*.test.mjs
```

## 本地数据

服务仅监听 `127.0.0.1`。Windows 登录记录保存在当前用户的 `%LOCALAPPDATA%\SidebarNotes\bilibili-session.dpapi`，经 Windows 用户级加密，不在仓库中。

依赖目录、运行日志、本地截图、环境变量文件和凭据文件均不纳入版本管理。便笺、草稿、待办与亮度设置保存在使用该页面的浏览器中。

本项目为本地工具，未与 B 站或 OpenAI 建立官方关联。视频权限与接口可用性由 B 站控制。

详细操作、实现与限制见 [项目说明](sidebar-notes/README.md)。
