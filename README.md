# 应用工坊

中文应用生成工作台的独立演示。首页、发现、项目列表、模板库、设置和项目编辑器共享同一工作区。首次访问时项目列表为空。

## 本地运行

需要 Python 3.8 或以上。在本目录运行以下命令，然后打开 http://localhost:8000/zh/dashboard/ 。

```sh
python3 server.py
```

默认生成流程使用服务端 AI。启动时通过环境变量提供 LLM_BASE_URL、LLM_MODEL 和 LLM_API_KEY。接入 DeepSeek 官方端点时，默认使用 deepseek-flash，可通过 LLM_MODEL 指定其他可用模型。可使用 STUDIO_BIND=127.0.0.1 限制为本机访问。可选的 STUDIO_LOCAL_AGENT=1 模式使用已登录的 Codex CLI 独立生成 HTML，使用 Codex 账户额度，仅监听回环地址。

端口从 PORT 环境变量读取，默认 8000。服务端以浏览器会话标识分配工作区，在 `STUDIO_DATA_DIR/workspaces/<浏览器标识>/projects/<项目 ID>/` 下保存草稿和已保存版本的源文件。默认数据目录为项目根目录下的 data，位于静态发布目录之外。通过 HTTPS 部署时可设置 STUDIO_SECURE_COOKIE=1。当前工作区跟随浏览器会话，项目列表与对话仍保存在浏览器。静态文件位于 dist，可直接部署到支持 HTTPS 的静态托管平台。服务器只对外提供 dist 内的文件。

## Railway 部署

从本目录运行 `railway up`，使用项目中的 Dockerfile。为服务挂载 `/data` 卷，并将健康检查设为 `/healthz`。应用会自动使用 Railway 提供的卷挂载路径。服务监听平台提供的 PORT。

使用 `STUDIO_BASE_PATH=/atoms` 将页面、资源和 API 统一挂载到 `/atoms/`，并设置 `STUDIO_SECURE_COOKIE=1`。如果通过同一域名下的路径代理访问，将 `STUDIO_PUBLIC_ORIGIN` 设置为面向浏览器的 HTTPS 来源。代理需保留路径、查询参数、响应 Cookie 和生成流。模型配置通过 Railway 的服务变量提供。

`deploy/cloudflare/` 提供仅转发 `/atoms` 的 Worker。为现有域名启用 Cloudflare 代理后，可通过 Wrangler 部署该 Worker。现有 DNS 源地址可继续服务该域名的其他路径。

## 登录

邮箱登录使用 Resend 发送六位一次性验证码。验证码 10 分钟内有效，首次验证邮箱自动创建账号，已有邮箱账号保留原账号 ID。登录会话和验证码校验数据储存在持久化目录的 SQLite 中。新建项目、克隆项目、克隆模板和编辑模板需要登录。登录后会回到对应的草稿或克隆确认。访客可以浏览和预览发现与模板。已登录账号使用独立的服务端源码目录。同一浏览器按访客和账号分别保存项目列表与对话。

在 Railway 的 `atoms-web` 服务设置 `RESEND_API_KEY` 和 `STUDIO_EMAIL_FROM`。发件地址需要属于已在 Resend 验证的域名，例如 `login@send.jokeyking.com`。先确认邮件能送达，再把生产登录切换到验证码。

在 Railway 为任一第三方登录设置两个服务变量即可显示入口。Google 使用 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`，GitHub 使用 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET`。分别注册以下 HTTPS 回调。站点使用 `STUDIO_PUBLIC_ORIGIN=https://jokeyking.com` 与 `STUDIO_BASE_PATH=/atoms`。

- Google 回调 `https://jokeyking.com/atoms/api/auth/google/callback`
- GitHub 回调 `https://jokeyking.com/atoms/api/auth/github/callback`

邮箱、Google 和 GitHub 账号按各自的登录身份区分。

## 体验路径

1. 在首页输入“创建一个名为「设计冲刺」的绿色任务看板”，点击生成。
2. 在预览区添加任务、设置优先级和日期，拖动卡片或点击按钮更改状态。
3. 在编辑器左侧输入“把主色调改成蓝色”，在版本面板查看或恢复上一版。
4. 刷新验证项目和任务；导出 HTML 后双击即可独立使用。导出内容为应用源码，独立文件使用自己的数据存储。

## 生成方式与工程取舍

新建和修改统一调用服务端生成接口，由部署者配置 LLM_API_KEY、模型和服务端点。迭代时模型读取当前源码。编辑器中的「构建过程」记录实际运行的步骤、耗时和产物。模板库可在模型服务暂时不可用时演示预览、交互和保存。

1. 模型根据需求生成任务书、功能清单和一条核心流程的验收计划。
2. 初始化工作区，或在迭代时读取当前版本的源文件。模型按允许的文件名返回写入内容。
3. 组装 HTML、CSS 和 JavaScript，在沙箱中检查桌面和手机渲染，并在桌面运行核心流程。任务书无法提供可执行的交互步骤时，仍检查渲染。
4. 验收遇到问题时，模型根据任务书、源码和浏览器证据判断原因。控件命名不同可重新定位，功能出错则修补源码。复验沿用原始操作和预期结果。通过后保存版本并打开预览。有可渲染的页面时，修复两轮后仍有检查未通过也会保存，并在预览中标明。生成期间先打开代码页，流式显示文件和源码片段。
5. 用户可在预览中操作页面，查看桌面与手机视图。文件树支持嵌套目录和文件搜索，可导出单个 HTML。

运行由页面协调。可以在构建期间手动停止。验收会比较操作前后的结果，识别数值变化和按钮状态变化。临时的生成服务和项目文件保存故障会自动重试。构建最终未完成时，工作台会标明阶段并保留需求和上一个有效版本。刷新或关闭页面会中断本次运行。再打开项目可从构建记录重新提交。

runtime.js 编排构建，model.js 调用模型，preview.js 管理沙箱预览和浏览器验收，generator.js 提供离线模板，app.js 管理路由、项目、运行记录和版本。项目及版本存于当前浏览器的 localStorage，清理站点数据将清空工作区。预览使用独立来源的沙箱 iframe。内置应用经 postMessage 交给工作台保存状态，父页检查消息来源。恢复版本切换界面与源码，同一项目同类型的业务数据在各版本间共享。

## 发现与模板

在项目编辑器选择「分享到发现」并确认后，当前网页和该版本的源码会公开给同一站点的所有访问者。打开「发现」会读取服务端列表，页面可见时每 15 秒刷新。对话和私有历史仍保存在各自的工作区。点击「克隆项目」后输入项目名称并选择工作区，确认后创建独立项目。发现数据随服务端数据目录持久化。

模板库预设了石砧金工、港湾来信、山脊慢行，每个模板都有可运行网页、风景照片和可编辑的 Prompt。「克隆模板」先选择目标工作区和项目名称，再保存副本。「编辑模板」返回首页主输入框，带入图片和 Prompt，提交后才创建项目。

- 石砧金工照片来自 Rob Farrow，CC BY-SA 2.0。[照片来源](https://commons.wikimedia.org/wiki/File:Arthur%27s_Seat_-_view_over_Salisbury_Crags_-_geograph.org.uk_-_3118840.jpg)
- 港湾来信照片来自 rboed，CC BY 2.0。[照片来源](https://commons.wikimedia.org/wiki/File:Portree_harbour,_Isle_of_Skye,_Scotland_-_53732030830.jpg)
- 山脊慢行照片来自 BobTanGo，CC BY 4.0。[照片来源](https://commons.wikimedia.org/wiki/File:The_Dolomites_from_Seceda.jpg)

## 当前范围与后续优先级

工作台支持克隆发现作品、从模板库克隆或继续编辑，以及通过参考文本发起构建。项目编辑器即时展示构建进度，支持桌面和手机预览、代码查看、版本恢复、重命名、复制和 HTML 导出。工作区限当前浏览器使用。后续优先验证真实模型生成与错误修复，再加入账户和跨设备同步。

工作流参考 Atoms 官方帮助中心，界面和视觉标识为本项目独立设计。

- https://help.atoms.dev/zh/articles/12129546-dashboard-overview
- https://help.atoms.dev/en/articles/12129544-create-an-account
- https://atoms.dev/
