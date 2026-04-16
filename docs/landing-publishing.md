# Landing Publishing

## 入口约定

- `GET /`：产品官网
- `GET /ui/`：Web 管理控制台
- `/cc-gw-social-card.png`：社交分享图发布文件
- `/cc-gw-social-card.svg`：社交分享图源文件
- `/site.webmanifest`：PWA / 应用元数据入口
- `/robots.txt`：爬虫入口规则
- `/sitemap.xml`：按请求 host 动态生成的站点地图

## 发版前应核对

- 官网文案是否仍与 [`product-positioning.md`](./product-positioning.md) 一致
- `README.md` 顶部定位、架构图和官网叙事是否同步
- landing 页面里的架构图、演示区和 CTA 是否仍符合当前产品能力
- 社交分享图与导出的 PNG 是否仍代表当前产品定位
- `site.webmanifest` 里的名称、描述和主题色是否仍与官网一致
- 录屏流程是否仍与 [`demo-script.md`](./demo-script.md) 一致
- 对外发布文案是否优先复用 [`launch-copy.md`](./launch-copy.md)

## 建议验证

```bash
pnpm --filter @cc-gw/web build
npx playwright test tests/playwright/landing.spec.ts --reporter=line
pnpm test:e2e:web:visual
```

如果本轮修改影响 landing 的视觉结构，再额外执行：

```bash
pnpm exec playwright test tests/playwright/visual.spec.ts --update-snapshots --grep "landing"
```

## 发布说明里建议强调

- `cc-gw` 适合个人开发者和 `1-100` 人软件研发团队
- 主卖点是统一入口、少改业务代码、日志排查和轻量本地协作
- 不是面向超大组织治理的企业 AI 平台
