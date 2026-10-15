# 开发、验证与部署

[← 返回 README](../README.md)

## 验证

```powershell
npm run check
npm test
npm run build
npm run test:production
# 另一个终端保持 npm run dev 运行
npm run test:ui
```

单元/集成测试使用隔离的本地模型服务和本地 MCP 服务，不消耗真实模型额度。覆盖跨月日期、未知预算、工具权限、真实 MCP HTTP 协商、函数调用、7 位专家、交叉审阅、坐标防伪、缺失天气、402 错误和任务取消。UI 检查涵盖桌面/390px 手机界面、示例流程、路线切换、预算、配置、历史恢复、HTML 手册下载和无横向溢出。

已验证本地演示、模型与 MCP 模拟服务、生产构建和 HTML 导出。真实模型规划及高德、铁路/机票、Tavily、Unsplash 查询仍需配置有效凭据并进行实网验证。

## 生产构建与部署

```powershell
npm run build
npm start
```

生产模式由后端提供 `client/dist` 静态资源，访问 <http://127.0.0.1:8787/>。前端仍是独立构建产物，可放到独立静态站点，通过 `VITE_API_BASE` 指定 API 地址；跨域时在后端设置 `ALLOWED_ORIGINS`。

HTML 导出无需 Chromium。UI 自动化测试及保留的旧 PDF 接口自动探测 Windows Edge/Chrome、macOS Chrome、Linux Chromium，找不到时设置 `BROWSER_EXECUTABLE_PATH`。界面字体优先本机字体，中文标题可加载 Google Fonts；网络不可用时自动回退。

提供 `Dockerfile` 与 `compose.yaml`，镜像包含 Chromium 和中文字体。部署前在 `.env` 设置强随机 `APP_ACCESS_TOKEN`，随后

```powershell
docker compose up --build -d
```

容器内监听 `0.0.0.0`，宿主机默认只映射到 `127.0.0.1:8787`。公网使用 HTTPS 反向代理，并将域名加入 `ALLOWED_ORIGINS`。首次进入页面需要访问口令。所有使用者共享同一个服务空间，该配置不是多人账户系统。

`.env`、`.data` 和模型 Key 均已排除 Git 与 Docker 构建上下文。不要把 `.env` 文件和 `.data` 目录放到静态文件服务中。

## 更新 README 截图

保持开发服务运行，在另一个终端执行：

```bash
node --import tsx scripts/capture-readme.mjs
```

脚本使用本机 Chromium / Chrome / Edge，直接操作真实界面，点击内置南京示例并下载实际 HTML 手册。生成 8 张 PNG 到 `docs/screenshots/`，原始导出文件保存在忽略提交的 `output/html/`。截图文件会覆盖同名旧图，示例会新增一条本地旅行记录。

这一步无需调用大模型，需联网加载 Unsplash 图片。若已配置外部服务，应用可能按当前设置查询图片或获取地图；截图说明应与实际配置保持一致。脚本不会填写或保存密钥。截图前确认使用示例数据，截图后检查画面、取景说明、来源署名与链接。详见[截图说明](screenshots/README.md)。
