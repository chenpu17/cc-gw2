# Launch Copy

## 中文短版

别再让 AI 配置散落在每个项目里。

`cc-gw` 帮你把 Claude Code、OpenAI SDK、Anthropic SDK 和内部工具统一到一个本地优先入口。Key、路由、日志、事件和排查回到控制台里，适合那些已经觉得“provider key 和 base URL 写进业务代码里越来越乱”，但又不想先搭一套企业 AI 平台的人和团队。

安装：

```bash
npm install -g @chenpu17/cc-gw
cc-gw start --foreground --port 4100
```

官网：`http://127.0.0.1:4100/`
控制台：`http://127.0.0.1:4100/ui`

## English Short Version

Stop letting AI configuration sprawl across every project.

`cc-gw` gives personal developers and small software teams one local-first entry for Claude Code, OpenAI SDK, Anthropic SDK, and internal tools. Keys, routing, logs, events, and debugging move back into one console instead of being repeated across app code.

Install:

```bash
npm install -g @chenpu17/cc-gw
cc-gw start --foreground --port 4100
```

Product site: `http://127.0.0.1:4100/`
Console: `http://127.0.0.1:4100/ui`

## GitHub Release Notes Template

```markdown
## cc-gw <version>

This release helps teams stop scattering AI configuration across every project.

Highlights:

- Unified product landing page at `/`
- Web console remains available at `/ui/`
- One entry for Claude Code, OpenAI SDK, Anthropic SDK, and internal tools
- Built-in logs, events, routing, profiler, and API key management
- Prebuilt native binaries via npm package installation

Install:

```bash
npm install -g @chenpu17/cc-gw
cc-gw start --foreground --port 4100
```
```

## 社区帖子模板

```text
我做了一个帮团队收口 AI 调用入口的小工具：`cc-gw`。

如果你也受不了把 AI key、base URL 和 provider 切换写在每个项目里，可能会对它有兴趣。

它把 Claude Code、OpenAI SDK、Anthropic SDK 和内部工具统一到一个本地优先入口，再用 Web 控制台管理模型路由、API Key、日志、事件和 Profiler。

它不是给超大组织的企业 AI 平台，更适合个人开发者和 1-100 人软件研发团队。

npm install -g @chenpu17/cc-gw
cc-gw start --foreground --port 4100

产品官网：/
控制台：/ui/
```
