# 标准表格真实浏览器回归

在仓库根目录安装 workspace 依赖后，先启动测试页面：

```sh
pnpm --filter @ses/client dev --host 127.0.0.1 --port 5175 --strictPort
```

另开终端运行 `pnpm --filter @ses/client test:table-layout`。需要本机可运行项目服务端依赖的 Playwright Chromium。可用 `SES_TEST_URL` 指向其他 Vite 地址下的 `/browser-tests/`，用 `SES_SCREENSHOT` 指定截图路径。

测试使用脱敏且仅保留布局相关字段的 15 列合并表结构，不连接或改写业务文档；检查不同正文宽度、跨列结构、名义列宽、鼠标拖拽以及超宽像素列的保留行为。超宽显式列宽仍可能超出正文，属于既有拖拽语义。
