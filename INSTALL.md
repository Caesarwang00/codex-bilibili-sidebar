# 用自己的 Codex 安装

## 复制给 Codex

在自己的 **Windows Codex 桌面版本地聊天**中发送：

> 请帮我安装 https://github.com/Caesarwang00/codex-bilibili-sidebar 。先阅读仓库根目录的 INSTALL.md，把项目下载到本机独立目录，使用可用的 Node.js 20+（优先已有或 Codex 内置运行环境）运行根目录的 setup.mjs，安装依赖并启动服务。验证本机服务正常后，在 Codex 右侧内置浏览器打开 http://127.0.0.1:17329/ 。保留原有界面和功能，让我用自己的 B 站 App 扫码登录。

这会安装与仓库版本相同的界面和功能。推荐来自安装者自己的账号；作者的登录、便笺、播放记录和亮度偏好不随代码分发。

## 安装流程

1. **本地运行。** 请使用与 Codex 浏览器在同一台电脑上的本地工作目录。云端任务、SSH 主机或容器的 `127.0.0.1` 不等于本机侧栏地址。
2. **下载代码。** 在合适的独立目录执行：

   ```sh
   git clone https://github.com/Caesarwang00/codex-bilibili-sidebar.git
   cd codex-bilibili-sidebar
   ```

   也可以从 GitHub 选择 Code → Download ZIP 后解压。若同名目录已存在，先确认是本项目并检查本地修改，再复用或另选目录，不覆盖已有文件。
3. **找到 Node.js 20+。** 先检查 `node --version`。若系统未配置 Node，可使用 Codex 提供的工作区依赖工具查找内置 Node，并用返回的完整路径运行。Windows 常见内置路径为 `%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`，应先确认该文件存在。
4. **安装并启动。** 在仓库根目录运行：

   ```sh
   node setup.mjs
   ```

   或双击根目录的 `start.cmd`。脚本自动安装锁定版本的依赖，检查后启动只监听本机的服务。优先使用随 Node 提供的 pnpm；只有 npm 时会通过 npm 调用固定版本的 pnpm。不需要管理员权限、全局安装扩展、复制 Cookie 或修改 Codex 配置。
5. **检查服务。** `http://127.0.0.1:17329/api/health` 应返回 `{"app":"sidebar-notes-local-v1"}`。如果端口被其他程序占用，先确认占用者，不能擅自结束未知程序。
6. **打开侧栏。** 用 Codex 的浏览器打开 `http://127.0.0.1:17329/`。如果当前 Codex 不提供内置浏览器，也可先用普通浏览器验证；侧栏体验需要桌面版提供该功能。
7. **登录自己的账号。** 点「账号 → 扫码登录」，由使用者在手机 B 站 App 中扫码确认。登录成功后显示「已记住登录」。点「开始浏览」观看个人推荐，视频下方可调画质、亮度和进入专注模式。

## 下次打开、停止和更新

- 下次使用：运行根目录 `start.cmd`，或再次运行 `node setup.mjs`，然后打开同一个本地地址。已在运行时不会重复启动。
- 停止服务：根目录 `stop.cmd`，或 `node sidebar-notes/launch.mjs stop`。Windows 加密登录记录会保留。
- 更新：先检查本地修改，再 `git pull --ff-only`，停止旧服务并运行 `node setup.mjs`。锁文件变化时会重新同步依赖。
- 只安装依赖、不启动：`node setup.mjs --install-only`。
- 手动安装备用路径：在 `sidebar-notes` 中执行 `pnpm install --frozen-lockfile`，然后返回根目录运行 `node setup.mjs`。

## 支持范围与常见问题

- **Windows** 是完整验证的平台，包含 Windows DPAPI 加密记住登录。其他系统目前不支持该持久化机制，账号可在本次服务内存中使用，但不能承诺同样的免扫码体验。
- 第一次安装需要访问 npm 注册表和 GitHub。失败后可再次运行 `setup.mjs`，不要删除锁文件或换用不明依赖来源。
- 本地服务提示启动失败时查看 `sidebar-notes/.runtime/server.log`。它只记录运行信息，不含账号 Cookie。
- B 站接口可能限流、变更或要求官网验证；不保证所有视频和地区均可用。
- 页面上的「专注」只隐藏视频区域，不主动暂停。F8 / Esc 需要页面获得焦点。
- 本项目是可放入 Codex 浏览器的本地网页工具，不是 Codex 插件市场中的扩展。

详细功能见 [项目说明](sidebar-notes/README.md)。
