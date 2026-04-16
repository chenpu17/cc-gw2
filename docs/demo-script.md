# Demo Script

这份脚本用于录制官网、README、发版说明或社区分享视频。目标不是展示所有功能，而是在 `3-5` 分钟内让个人开发者和小团队理解：为什么需要 `cc-gw`，以及接入后多了什么。

## 场景设定

- 团队规模：个人开发者到 `1-100` 人软件研发团队
- 当前问题：多个 provider、多个 SDK、多个 base URL、日志分散、路由和 key 散落在业务代码里
- 演示目标：把一次模型调用收口到 `cc-gw`，然后在控制台看到路由、日志和运行态

## 录屏流程

1. 打开 README 首屏，停留在一句话定位和安装命令。
2. 执行安装和启动命令：

```bash
npm install -g @chenpu17/cc-gw
cc-gw start --foreground --port 4100
```

3. 打开产品官网：

```text
http://127.0.0.1:4100/
```

4. 停留在架构图，讲清楚链路：

```text
Clients -> cc-gw -> Providers -> Console & observability
```

5. 打开控制台：

```text
http://127.0.0.1:4100/ui
```

6. 展示 Dashboard、Models & Routing、Logs、API Keys 和 Profiler。
7. 用一条请求说明接入方式：

```bash
curl http://127.0.0.1:4100/openai/v1/chat/completions \
  -H 'authorization: Bearer sk-ccgw-your-key' \
  -H 'content-type: application/json' \
  -d '{"model":"gpt-4.1-mini","messages":[{"role":"user","content":"ping"}]}'
```

8. 回到 Logs 或 Dashboard，说明请求已经进入统一观测入口。

## 旁白提纲

- `cc-gw` 不是企业 AI 平台，它更适合开发者和小团队先解决入口混乱
- 业务代码只需要面对一个 base URL
- provider 切换、模型路由、fallback、API Key 和日志排查都回到网关
- 你可以先本地跑，再迁到团队共享实例

## 结尾 CTA

```bash
npm install -g @chenpu17/cc-gw
cc-gw start --foreground --port 4100
```

然后访问：

```text
http://127.0.0.1:4100/
```
