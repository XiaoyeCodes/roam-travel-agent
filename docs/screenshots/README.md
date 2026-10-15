# 项目真实截图

[← 返回项目 README](../../README.md)

截图日期为 2026-10-15，来自本机运行的山行 Roam 与实际下载的 HTML 旅行手册。全部通过浏览器截屏获得，没有替换页面内容、伪造接口返回或使用 AI 生成的产品界面。

## 当前截图条件

- 行程来自「体验南京示例」：上海出发，2 人，南京 3 天，总预算 ¥3,500，示例参考费用 ¥3,060。
- 行程、天气状态、预算与协作消息均为演示内容，截图保留相应提示。
- 未配置高德与 Unsplash Key。地图为游览顺序示意图；地点图片使用内置且注明来源的 Unsplash 精选图库。
- 大模型配置状态显示「已配置」，本次演示未调用大模型。
- 桌面截图宽度为 1440 px，设置截图截取真实弹窗，手机截图宽度为 390 px。
- 截图中照片的摄影师和原图来源见应用内署名及 [photo-catalog.ts](../../server/src/photo-catalog.ts)。

## 文件索引

| 文件                                         | 画面                                 |
| -------------------------------------------- | ------------------------------------ |
| [01-planner.png](01-planner.png)             | 首页、出行表单、南京示例与专家团队   |
| [02-itinerary.png](02-itinerary.png)         | 每日时间轴、景点照片、地图与预算侧栏 |
| [03-route-map.png](03-route-map.png)         | 按日期区分的演示游览顺序             |
| [04-budget.png](04-budget.png)               | 全程预算汇总与分类明细               |
| [05-collaboration.png](05-collaboration.png) | 专家状态、演示交流记录与专家结论     |
| [06-html-guide.png](06-html-guide.png)       | 实际导出的 HTML 手册封面与行程章节   |
| [07-settings.png](07-settings.png)           | API Key 申请入口与官方指南           |
| [08-mobile.png](08-mobile.png)               | 390 px 手机端图文行程                |

## 重新截取

在项目根目录启动 `npm run dev`，另开终端执行：

```bash
node --import tsx scripts/capture-readme.mjs
```

脚本会覆盖本目录同名 PNG，并新增一条本地示例记录。需要本机浏览器及网络图片访问；可以通过 `BROWSER_EXECUTABLE_PATH` 指定浏览器。截图使用当时真实的应用设置，外部服务已配置时可能产生对应查询。更新图片后，请同步检查项目 README 中的截图说明。
