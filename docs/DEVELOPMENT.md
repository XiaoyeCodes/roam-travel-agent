# 开发、验证与部署

[← 返回 README](../README.md)

## 验证

```powershell
npm run check
npm test
npm run build
npm run test:revisions
npm run test:production
# 另一个终端保持 npm run dev 运行
npm run test:ui
```

单元/集成测试使用隔离的本地模型服务和本地 MCP 服务，不消耗真实模型额度。覆盖跨月日期、未知预算、工具权限、真实 MCP HTTP 协商、函数调用、7 位专家、交叉审阅、坐标防伪、缺失天气、402 错误和任务取消。UI 检查涵盖桌面/390px 手机界面、示例流程、路线切换、预算、配置、历史恢复、HTML 手册下载和无横向溢出。

行程修改测试额外覆盖锁定约束、预览隔离、版本冲突、应用与撤销、费用差额、未知信息、时间/营业规则和路线失败。`test:revisions` 自动启动独立 API 与浏览器，检查草稿重启恢复、真实 HTML 下载及手机编辑布局；详情见[行程修改与信息核验](ITINERARY-QUALITY.md)。

候选方案与最终行程使用 `structured-output.ts` 处理模型格式差异：先规范字符串数组、空字段和枚举，再进行最多两次带具体字段反馈的修复；输出截断会提高长度额度并要求压缩描述。连续不可用时，初次提案提供明确标注的基础方向，调整提案保留上一版和反馈，最终汇总则保存待完善草案及专家资料。模型服务不可用、全部专家失败、地图或图片补充失败均不阻断整单输出；失败原因和未知项保留为结果提示，未知价格仍为 `null`，不会冒充查询成功。单次执行超过八分钟会先保存现有草案，避免无限等待。相关回归用例位于 `workflow.test.ts`。

失败或取消的记录可通过 `POST /api/trips/:id/retry` 恢复原需求与确认意见（JSON 请求体 `{}`）；运行中、等待确认或已完成的记录不能重复启动。前端“重新规划”使用此接口，继续保存到原记录，不另建重复旅程。

生成任务使用持久化检查点保存原始工具结果、每位专家的初次分析和交叉审阅结果，以及已汇总的行程。正常重启与进程崩溃后自动排队续跑，完成阶段不重复调用模型；超出三个并行任务的请求自动排队。用户主动取消会先落盘，重启不会恢复已取消任务。旧版未保存检查点的历史失败任务可通过重新规划迁移，已有专家报告可以复用，缺失的原始工具数据不会伪造。运行 `npm run test:recovery` 可在隔离目录验证实际 API 进程关闭、强制退出、启动恢复、排队和取消，不调用真实外部服务。

`planning.test.ts` 覆盖费用范围、人数与房晚、重复费用关联、旧账本迁移、未知余额、班次引用来源、到达/返程衔接、跨日校验、修复反馈与全程设置撤销。`test:revisions` 还会操作费用和班次表单，验证真实 HTML 包含相同公式、区间与缓冲；截图输出到忽略提交的 `output/qa`。

已验证本地演示、模型与 MCP 模拟服务、生产构建和 HTML 导出。免费铁路/机票查询的实网验证使用 `npm run test:tickets:live`，会自动创建隔离环境、安装 Python 依赖、查未来第 7 天上海到南京高铁及上海到北京机票，并检查重启、缓存和桌面/手机界面；结果写入 `output/qa/tickets-live.json`，不消耗模型额度、不下单。该命令会访问真实网站，不属于默认离线测试。

默认 `npm test` 包含票务日期、机场映射、上游错误、未知票价、去返程证据与子进程取消/超时测试。Python 解析测试为 `.data/travel-venv/Scripts/python.exe server/python/test_flights.py`（Linux 使用 `.data/travel-venv/bin/python`）。生产与方案确认的隔离测试设置 `ROAM_TICKETS_DISABLED=1`，避免意外联网查票。真实模型及高德、Tavily、Unsplash 查询仍使用相应有效凭据。

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
