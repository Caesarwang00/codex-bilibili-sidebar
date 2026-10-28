# Codex Bilibili Sidebar

在 Codex 右侧浏览器中使用的本地 B 站播放器与便笺工具。

- 扫码登录，读取账号的个性化首页推荐；支持上一条、下一条和手动粘贴视频链接。
- 登录后优先播放可用的 1080P，支持画质切换和亮度调节。
- Windows 下加密记住登录，重启服务后自动恢复，凭据失效时重新扫码。
- 「专注」按钮和 F8 / Esc 隐藏视频区域，保留播放状态。
- 便笺、待办和草稿在浏览器本地保存。

## 让自己的 Codex 安装

把下面这段话复制给 **Windows Codex 桌面版的本地聊天**：

> 请帮我安装 https://github.com/Caesarwang00/codex-bilibili-sidebar 。阅读根目录 INSTALL.md，使用本机或 Codex 内置 Node.js 20+ 运行 setup.mjs，安装依赖并启动服务，然后在 Codex 右侧浏览器打开 http://127.0.0.1:17329/ ，让我用自己的 B 站账号扫码登录。保留仓库中的界面和全部功能。

无需手动修改 Codex 配置。安装者使用自己的 B 站账号，获得相同界面和功能、属于自己的个性化推荐。[详细安装说明](INSTALL.md)

## 手动运行

需要 Node.js 20 或更新版本。安装脚本可使用 Codex 内置 Node 和包管理器；Windows 登录持久化使用 DPAPI。

```sh
git clone https://github.com/Caesarwang00/codex-bilibili-sidebar.git
cd codex-bilibili-sidebar
node setup.mjs
```

在 Codex 内置浏览器打开 <http://127.0.0.1:17329/>，首次使用点「账号 → 扫码登录」。Windows 也可以下载 ZIP、解压后双击根目录的 `start.cmd`，首次会自动安装依赖。

停止服务：

```sh
node sidebar-notes/launch.mjs stop
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
