import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { storageKeys } from '@/services/storageKeys'

const resources = {
  zh: {
    translation: {
      app: {
        title: 'cc-gw 控制台',
        skipToContent: '跳转到主要内容',
        consoleSubtitle: '网关控制平面',
        environmentLabel: '运行状态',
        online: '服务在线'
      },
      nav: {
        dashboard: '仪表盘',
        logs: '请求日志',
        events: '事件',
        models: '模型供应商',
        routing: '路由管理',
        apiKeys: 'API 密钥',
        settings: '设置',
        help: '使用指南',
        about: '关于',
        profiler: '性能分析',
        group: {
          overview: '概览',
          admin: '管理'
        }
      },
      language: {
        zh: '简体中文',
        en: 'English'
      },
      common: {
        loading: '加载中...',
        loadingShort: '加载中...',
        noData: '暂无数据',
        languageSelector: '语言选择',
        yes: '是',
        edit: '编辑',
        delete: '删除',
        create: '创建',
        save: '保存',
        saving: '保存中...',
        cancel: '取消',
        actions: {
          loading: '处理中...',
          refresh: '刷新',
          refreshing: '刷新中...',
          manualRefresh: '手动刷新',
          reset: '重置',
          close: '关闭',
          openNavigation: '打开导航',
          closeNavigation: '关闭导航',
          save: '保存设置',
          saving: '保存中...',
          cancel: '取消',
          copy: '复制',
          testConnection: '测试连接',
          testingConnection: '测试中...',
          cleanup: '清理历史日志',
          cleaning: '清理中...',
          checkUpdates: '检查更新',
          logout: '退出登录'
        },
        theme: {
          label: '主题',
          light: '亮色',
          dark: '暗色',
          system: '跟随系统'
        },
        status: {
          success: '成功',
          pending: '进行中',
          error: '失败',
          enabled: '已启用',
          disabled: '已禁用'
        },
        notifications: {
          featureInProgress: '功能开发中，敬请期待。'
        },
        units: {
          request: '次',
          ms: 'ms',
          token: 'Tokens',
          msPerToken: 'ms/Token'
        },
        noMatches: '无匹配项',
        unknownError: '未知错误',
        filters: {
          activeCount: '{{count}} 个筛选条件',
          collapse: '收起筛选',
          expand: '展开筛选',
          allRequests: '全部请求'
        }
      },
      login: {
        title: '登录 cc-gw 控制台',
        description: '启用 Web UI 访问控制后，请输入账号与密码继续。',
        fields: {
          username: '用户名',
          usernamePlaceholder: '请输入用户名',
          password: '密码',
          passwordPlaceholder: '请输入密码'
        },
        actions: {
          submit: '登录'
        },
        validation: {
          required: '请填写用户名和密码',
          failed: '登录失败，请检查账号或密码后重试'
        },
        hint: '如果忘记密码，可在服务器上通过 CLI 或编辑配置重置 Web 登录设置。',
        status: '已登录：{{username}}'
      },
      dashboard: {
        description: '快速了解请求规模与实时运行状态。',
        labels: {
          providers: 'Provider 数量',
          activeClientAddresses: '活跃来源地址',
          activeClientSessions: '活跃会话',
          uniqueClientAddressesLastHour: '1小时活跃客户端 IP',
          uniqueClientSessionsLastHour: '1小时会话',
          todayRequests: '今日请求',
          activeRequests: '活跃转发连接',
          throughput: '实时吞吐',
          requestsPerMinute: 'RPM',
          outputTokensPerMinute: 'TPM',
          cpu: 'CPU 占用率',
          bandwidth: '网络带宽',
          networkIngress: '入口带宽',
          networkEgress: '出口带宽',
          database: '数据库',
          memory: '内存占用'
        },
        filters: {
          endpoint: '端点筛选',
          endpointAll: '全部端点',
          endpointAnthropic: 'anthropic',
          endpointOpenAI: 'openai'
        },
        status: {
          listeningLabel: '监听地址',
          listening: '监听：{{host}}:{{port}}',
          providers: 'Provider 数量：{{value}}',
          todayRequests: '今日请求：{{value}}',
          active: '活动请求：{{value}}',
          dbSize: '数据库：{{value}}',
          memory: '内存占用：{{value}}'
        },
        actions: {
          compact: '释放数据库空间',
          compacting: '整理中...'
        },
        toast: {
          overviewError: '统计数据获取失败',
          dailyError: '趋势数据获取失败',
          modelError: '模型统计获取失败',
          statusError: '状态信息获取失败',
          dbError: '数据库信息获取失败',
          recentError: '最近请求获取失败',
          compactSuccess: {
            title: '数据库整理完成',
            desc: '空闲页已整理，建议稍后刷新确认容量。'
          },
          compactError: {
            title: '数据库整理失败',
            desc: '错误信息：{{message}}'
          }
        },
        cards: {
          todayRequests: '今日请求数',
          todayInput: '今日输入 Tokens',
          todayCacheRead: '今日缓存读取',
          todayCacheCreation: '今日缓存写入',
          todayOutput: '今日输出 Tokens',
          todayCached: '今日缓存 Tokens',
          avgLatency: '平均响应耗时'
        },
        charts: {
          requestsTitle: '请求趋势',
          requestsDesc: '最近 14 天请求与 Token 走势',
          modelTitle: '模型调用分布',
          modelDesc: '近 7 天不同模型的调用次数与 Token 走势',
          barRequests: '请求数',
          lineInput: '输入 Tokens',
          lineOutput: '输出 Tokens',
          lineCached: '缓存 Tokens',
          lineCacheRead: '缓存读取',
          lineCacheCreation: '缓存写入',
          axisTokens: 'Tokens',
          ttftLabel: 'TTFT(ms)',
          tpotLabel: 'TPOT(ms/Token)',
          ttftTitle: 'TTFT 模型对比',
          ttftDesc: '比较不同模型的首 Token 耗时 (TTFT)',
          ttftEmpty: '暂无 TTFT 数据。',
          tpotTitle: 'TPOT 模型对比',
          tpotDesc: '比较不同模型的平均 Token 耗时 (TPOT)',
          tpotEmpty: '暂无 TPOT 数据。',
          ttftAxis: 'TTFT (ms)',
          tpotAxis: 'TPOT (ms/Token)',
          empty: '暂无数据'
        },
        insights: {
          totalRequests: '趋势期总请求',
          totalRequestsHint: '最近 14 天累计请求量',
          busiestDay: '最忙的一天',
          busiestDayHint: '{{value}} 次请求',
          topModel: '最高频模型',
          topModelHint: '{{value}} 次调用',
          fastestTtft: '最快 TTFT 模型'
        },
        recent: {
          title: '最新请求',
          subtitle: '仅展示最近 {{count}} 条记录',
          loading: '加载中...',
          empty: '暂无请求记录',
          routePlaceholder: '未指定',
          columns: {
            time: '时间',
            endpoint: '端点',
            provider: 'Provider',
            route: '路由',
            latency: '耗时(ms)',
            status: '状态'
          }
        },
        modelTable: {
          title: '模型性能摘要',
          description: '统计每个后端模型的请求数、平均耗时、TTFT 与 TPOT。',
          empty: '暂无模型统计数据。',
          columns: {
            model: 'Provider/模型',
            requests: '请求数',
            latency: '平均耗时',
            ttft: 'TTFT',
            tpot: 'TPOT'
          }
        }
      },
      logs: {
        title: '请求日志',
      description: '查看近期请求，支持筛选 Provider、模型、成功状态及时间范围。',
      filtersTitle: '筛选条件',
      filtersDescription: '组合多种条件精准定位请求记录。',
      summary: {
        total: '记录总数：{{value}}'
      },
      filters: {
        provider: 'Provider',
        providerAll: '全部 Provider',
        endpoint: '请求端点',
          endpointAll: '全部端点',
          endpointAnthropic: 'anthropic',
          endpointOpenAI: 'openai',
        apiKey: 'API Key',
        apiKeyHint: '可多选，不选择时将展示全部密钥。',
        modelId: '模型 ID',
        modelPlaceholder: '如 deepseek-chat',
        status: '状态',
          statusAll: '全部',
          statusSuccess: '成功',
          statusError: '失败',
          startDate: '起始日期',
          endDate: '结束日期',
          apiKeyAll: '全部密钥',
          apiKeySelected: '{{count}} 个已选'
        },
        actions: {
          columns: '列设置',
          visibleCount: '已显示 {{count}} 列',
          manualRefresh: '手动刷新',
          refreshing: '刷新中...',
          export: '导出 ZIP 日志',
          exporting: '导出中...',
          detail: '详情'
        },
        quickViews: {
          all: '全部流量',
          errors: '仅看失败',
          today: '今天',
          anthropic: 'Anthropic',
          openai: 'OpenAI'
        },
        table: {
          loading: '正在加载日志...',
          empty: '未找到符合条件的日志记录。',
          density: {
            comfortable: '标准',
            compact: '紧凑'
          },
          requestedModelFallback: '未指定',
          apiKeyUnknown: '未知密钥',
          columns: {
            time: '时间',
            endpoint: '端点',
            provider: 'Provider',
            requestedModel: '请求模型',
            routedModel: '路由模型',
            apiKey: 'API Key',
            inputTokens: '输入 Tokens',
            cacheReadTokens: '缓存读取',
            cacheCreationTokens: '缓存写入',
            outputTokens: '输出 Tokens',
            stream: 'Stream',
            latency: '耗时(ms)',
            ttft: 'TTFT(ms)',
            tpot: 'TPOT(ms/Token)',
            status: '状态',
            error: '错误信息',
            actions: '操作'
          },
          pagination: {
            perPage: '每页',
            unit: '条',
            previous: '上一页',
            next: '下一页',
            pageLabel: '第 {{page}} / {{total}} 页'
          }
        },
        empty: {
          title: '日志还没有开始积累',
          subtitle: '发起一条真实请求后，这里会开始显示路由结果、耗时和状态。',
          filteredTitle: '当前筛选条件下没有匹配记录',
          filteredSubtitle: '可以重置筛选条件，或放宽时间范围、端点和状态。',
          actions: {
            reset: '重置筛选',
            apiKeys: '去 API 密钥'
          }
        },
        endpointAnthropic: 'anthropic',
        endpointOpenAI: 'openai',
        toast: {
          listError: {
            title: '日志获取失败',
            desc: '错误信息：{{message}}'
          },
          providerError: {
            title: 'Provider 列表获取失败',
            desc: '错误信息：{{message}}'
          },
          exportSuccess: {
            title: '导出完成',
            desc: 'ZIP 压缩包已开始下载，包内包含 `logs.json`。'
          },
          exportError: {
            title: '导出失败',
            desc: '错误信息：{{message}}'
          }
        },
        stream: {
          streaming: '流式',
          single: '单次'
        },
        detail: {
          title: '日志详情',
          id: 'ID #{{id}}',
          infoSection: '基本信息',
          info: {
            time: '时间',
            sessionId: 'Session ID',
            endpoint: '端点',
            provider: 'Provider',
            requestedModel: '请求模型',
            noRequestedModel: '未指定',
            model: '路由模型',
            stream: 'Stream',
            latency: '耗时',
            status: '状态',
            inputTokens: '输入 Tokens',
            cacheReadTokens: '缓存读取',
            cacheCreationTokens: '缓存写入',
            outputTokens: '输出 Tokens',
            ttft: 'TTFT (首 Token 耗时)',
            tpot: 'TPOT (平均 ms/Token)',
            error: '错误信息'
          },
          summary: {
            route: '{{from}} → {{to}}',
            latency: '耗时：{{value}}',
            ttft: 'TTFT：{{value}}',
            tpot: 'TPOT：{{value}}',
            stream: 'Stream：{{value}}'
          },
          payload: {
            title: 'Payloads',
            helperWithUpstream: '客户端与上游链路内容已分开展示。',
            helperClientOnly: '当前请求未发生额外链路改写，仅展示客户端侧内容。',
            clientRequest: '客户端请求体',
            upstreamRequest: '上游请求体',
            upstreamResponse: '上游响应体',
            clientResponse: '客户端响应体',
            emptyRequest: '暂无请求内容',
            emptyResponse: '暂无响应内容'
          },
          apiKey: {
            title: '密钥信息',
            name: '密钥名称',
            identifier: '密钥 ID',
            masked: '掩码展示',
            maskedUnavailable: '暂无掩码信息',
            raw: '原始密钥',
            rawUnavailable: '未记录原始密钥',
            rawMasked: '原始密钥（已脱敏）',
            rawMaskedHint: '出于安全考虑，仅展示部分前后缀。如需完整值，请在上游服务中重新生成。',
            missing: '未记录',
            lastUsed: '最后使用'
          },
          copy: {
            requestSuccess: '请求体已复制到剪贴板。',
            responseSuccess: '响应体已复制到剪贴板。',
            keySuccess: 'API 密钥已复制到剪贴板。',
            empty: '{{label}}为空，无法复制。',
            failure: '复制失败',
            failureFallback: '无法复制内容，请稍后再试。'
          },
          loadError: '无法加载日志详情。'
        }
      },

      providers: {
        title: '模型提供商',
        description: '管理集成的模型服务，查看默认模型及支持能力。',
        emptyState: '暂无 Provider，请点击“新增提供商”以开始配置。',
        emptyFiltered: '当前筛选条件下没有匹配的 Provider。',
        count: '已配置：{{count}} 个 Provider',
        groupCount: '{{count}} 个提供商',
        filters: {
          searchPlaceholder: '按名称、ID 或 Base URL 搜索',
          typeAll: '全部类型'
        },
        status: {
          ready: '已就绪',
          needsDefault: '待设默认模型'
        },
        toast: {
          createSuccess: '已添加 Provider：{{name}}',
          updateSuccess: '已更新 Provider：{{name}}',
          testSuccess: 'Provider 连通性检查通过。',
          testSuccessDesc: '状态：{{status}} · 耗时：{{duration}}',
          testFailure: 'Provider 连通性检查失败：{{message}}',
          loadFailure: '获取配置失败：{{message}}',
          deleteSuccess: '已删除 Provider：{{name}}',
          deleteFailure: '删除 Provider 失败：{{message}}'
        },
        actions: {
          add: '新增提供商',
          refresh: '刷新',
          refreshing: '刷新中...',
          edit: '编辑',
          delete: '删除',
          test: '测试连接'
        },
        quickAddHuawei: {
          button: '一键添加华为云模型',
          title: '一键添加华为云模型',
          description: '输入 API Key 即可快速添加华为云 DeepSeek V3.1、KIMI-K2 与 Qwen3-235B-A22B 模型。',
          apiKeyLabel: 'API Key',
          apiKeyPlaceholder: '请输入华为云 API Key',
          note: '完成后可在提供商列表中查看并进一步调整配置。',
          submit: '添加',
          providerLabel: '华为云',
          validation: {
            apiKey: '请填写 API Key'
          },
          toast: {
            success: '已添加华为云模型',
            added: '已添加 {{name}}',
            failure: '添加失败，请稍后重试'
          }
        },
        testDialog: {
          title: '连接测试选项',
          subtitle: '针对 {{name}} 的测试请求',
          description: '部分 Claude 兼容服务需要额外 Header 才能通过诊断。请选择需要附加的 Header，不勾选则保持最简请求。',
          headerValue: 'Header 值：{{value}}',
          presetLabel: '模拟 Claude Code 请求（推荐）',
          presetDescription: '附加 Claude CLI 常用的 Header（anthropic-beta、x-app、user-agent 等）以提升兼容性。',
          presetPreviewSummary: '查看将附加的 Header 列表',
          preservedInfo: '以下 Header 将自动附加（来自当前配置）：',
          cancel: '取消',
          primary: '开始测试',
          options: {
            beta: {
              label: '`anthropic-beta` 头',
              description: '启用 Claude Code 的实验特性（如工具流式）；fox code_cc 等服务通常要求此头。'
            },
            browser: {
              label: '`anthropic-dangerous-direct-browser-access` 头',
              description: '标记请求来自受信客户端，Claude Code 默认会携带此头。'
            },
            xApp: {
              label: '`x-app` 头',
              description: '标识请求来源，Claude CLI 默认发送为 cli。'
            },
            userAgent: {
              label: '`user-agent` 头',
              description: '模拟 Claude CLI 的 User-Agent 值。'
            },
            accept: {
              label: '`accept` 头',
              description: '声明客户端接受 JSON 响应格式。'
            },
            acceptLanguage: {
              label: '`accept-language` 头',
              description: '兼容要求语言信息的服务。'
            },
            secFetchMode: {
              label: '`sec-fetch-mode` 头',
              description: '与浏览器/CLI 保持一致的访问信息。'
            },
            acceptEncoding: {
              label: '`accept-encoding` 头',
              description: '允许 gzip/deflate 压缩响应内容。'
            },
            stainlessHelper: {
              label: '`x-stainless-helper-method` 头',
              description: '表明请求使用 Claude CLI 的 stream helper。'
            },
            stainlessRetry: {
              label: '`x-stainless-retry-count` 头',
              description: 'Claude CLI 当前的重试计数。'
            },
            stainlessTimeout: {
              label: '`x-stainless-timeout` 头',
              description: 'Claude CLI 设定的超时时间（秒）。'
            },
            stainlessLang: {
              label: '`x-stainless-lang` 头',
              description: 'Claude CLI 所使用的语言标识。'
            },
            stainlessPackage: {
              label: '`x-stainless-package-version` 头',
              description: 'Claude CLI 的包版本号。'
            },
            stainlessOs: {
              label: '`x-stainless-os` 头',
              description: '调用方所在的操作系统。'
            },
            stainlessArch: {
              label: '`x-stainless-arch` 头',
              description: '调用方 CPU 架构信息。'
            },
            stainlessRuntime: {
              label: '`x-stainless-runtime` 头',
              description: '运行时环境标识，例如 node。'
            },
            stainlessRuntimeVersion: {
              label: '`x-stainless-runtime-version` 头',
              description: '运行时环境的版本号。'
            }
          }
        },
        card: {
          baseUrl: 'Base URL',
          defaultModelLabel: '默认模型',
          defaultModel: '默认模型：{{model}}',
          noDefault: '未设置默认模型',
          modelsTitle: '支持模型',
          noModels: '尚未配置模型。',
          authMode: '认证方式',
          providerDefault: 'Provider 默认',
          modelCount: '{{count}} 个模型',
          passthrough: '透传模式'
        },
        drawer: {
          createTitle: '新增 Provider',
          editTitle: '编辑 Provider',
          quickStart: '快速配置',
          description: '配置基础信息与模型列表。',
          formSummary: '当前草稿',
          modelsDescription: '维护支持的模型列表。',
          defaultHint: '当前默认模型：{{model}}',
          summary: {
            type: 'Provider 类型',
            auth: '认证方式',
            models: '模型数量',
            untitled: '未命名 Provider'
          },
          sections: {
            type: '1. 选择 Provider 类型',
            basic: '2. 填写基础信息',
            auth: '3. 设置认证',
            checklist: '提交前检查'
          },
          hints: {
            type: '先选择 Provider 模板，可自动填入推荐 Base URL。',
            basic: 'ID 用于路由映射；显示名称用于界面展示。',
            auth: '根据上游接口要求选择 Header 认证方式。',
            customProvider: '自定义兼容服务',
            checkUrl: '确认 Base URL 指向上游 API 根路径。',
            checkAuth: '确认密钥与认证 Header 类型匹配。',
            checkModels: '如需路由提示和默认模型，请补充模型列表。',
            advancedTitle: '高级模式说明',
            advancedBody: '开启后可单独维护显示名称与模型别名；如果只是快速接入，保留默认同步即可。'
          },
          fields: {
            id: 'Provider ID',
            idPlaceholder: '如 openai',
            label: '显示名称',
            labelPlaceholder: '如 官方主账号',
            baseUrl: 'Base URL',
            baseUrlPlaceholder: 'https://api.example.com/v1',
            type: 'Provider 类型',
            apiKey: 'API Key（可选）',
            apiKeyPlaceholder: '可留空以从环境变量读取',
            authMode: '认证方式',
            authModeHint: '选择 API 认证方式，填写对应的密钥值。',
            authModeApiKey: 'X-API-Key',
            authModeProviderDefault: 'Provider 默认',
            authModeAuthToken: 'Authorization: Bearer',
            authModeXAuthToken: 'X-Auth-Token',
            models: '模型配置',
            showAdvanced: '显示高级选项',
            hideAdvanced: '隐藏高级选项',
            addModel: '新增模型',
            modelId: '模型 ID',
            modelIdPlaceholder: '如 claude-sonnet-4-5-20250929',
            modelLabel: '显示名称（可选）',
            modelLabelPlaceholder: '如 GPT-4 旗舰',
            setDefault: '设为默认模型',
            removeModel: '删除模型'
          },
          errors: {
            idRequired: '请填写 Provider ID',
            idDuplicate: '该 Provider ID 已存在',
            baseUrlInvalid: 'Base URL 格式无效',
            modelsRequired: '请至少配置一个模型',
            modelInvalid: '模型 ID 不可为空或重复',
            defaultInvalid: '默认模型必须在模型列表中'
          },
          toast: {
            saveFailure: '保存失败：{{message}}'
          },
          noModelsTitle: '透传模式已启用',
          noModelsHint: '当前未配置模型列表。该 Provider 将以"透传"模式使用，可在模型路由中映射，或在请求中直接指定模型。',
          routeExample: '路由映射示例：'
        },
        confirm: {
          delete: '确认删除 Provider「{{name}}」？'
        }
      },

      modelManagement: {
        title: '模型与路由管理',
        description: '统一维护模型提供商配置、模型路由映射与自定义端点。',
        providersEyebrow: '供应池',
        header: {
          providersHelper: '先维护上游 Provider 供应池，再进入路由管理为内置端点和自定义端点配置映射规则。',
          routingHelper: '当前工作区正在编辑「{{name}}」的路由规则，保持单工作区上下文以减少切换混淆。'
        },
        guide: {
          title: '配置导览',
          subtitle: '将资源池与流量入口拆开维护，减少信息混排。',
          description: '先把上游 Provider 配完整，再去路由管理为 /anthropic、/openai 与自定义端点分配模型映射。',
          endpointBadge: '{{count}} 个路由工作区',
          providersDescription: '维护 Base URL、鉴权方式、默认模型与模型别名。这一层只定义上游资源。',
          providersMeta: '当前已配置 {{count}} 个 Provider',
          routingDescription: '分别管理内置端点与自定义端点的映射、模板和校验策略。这一层决定对外入口如何分流。',
          routingMeta: '{{count}} 个工作区，{{dirty}} 个未保存',
          current: '当前步骤',
          currentAction: '当前页',
          openAction: '打开'
        },
        overview: {
          synced: '工作区已同步',
          unsavedCount: '未保存 {{count}}',
          providersStat: 'Providers',
          providersStatHint: '已接入的上游供应池',
          routeWorkspacesStat: '路由工作区',
          routeWorkspacesStatHint: '内置端点 + 自定义端点',
          customEndpointsStat: '自定义端点',
          customEndpointsStatHint: '额外暴露的接入入口',
          activeWorkspace: '当前工作区',
          activeWorkspaceProvider: 'Provider 清单',
          activeWorkspaceRouting: '路由编辑区',
          providerAndSystem: '资源与内置路由',
          providerPoolTag: 'Provider 池',
          systemEndpointTag: '内置端点',
          customEndpoints: '自定义端点',
          customEndpointsHint: '自定义端点保留紧凑横向卡片，便于快速切换、编辑和删除。',
          headerWithCustom: '优先在此处切换和维护自定义端点，避免主工作区被多列布局挤压。',
          headerWithoutCustom: '先配置提供商与内置路由，需要时再补充自定义端点。',
          endpointPaths: '访问路径',
          protocols: '协议路径',
          endpointEnabled: '已启用',
          endpointDisabled: '已停用',
          endpointProtocols: '{{count}} 条协议路径',
          endpointNoProtocol: '尚未配置协议路径',
          endpointMorePaths: '另有 {{count}} 条路径',
          endpointManagedExternally: '该端点不可删除，仅可调整配置。',
          routesEditorHint: '源模型 -> 目标 provider:model',
          suggestionHint: '一键补充该端点常见的源模型写法，减少手工录入。',
          resourceCardTitle: 'Provider 供应池',
          resourceCardDescription: 'Provider 只表示上游模型资源与鉴权配置，不直接决定外部请求入口。',
          entryCardTitle: 'Endpoint 入口层',
          entryCardDescription: 'Anthropic、OpenAI 与自定义端点才是网关对外暴露的入口；路由与模板都按 endpoint 作用域管理。'
        },
        providersSemantics: {
          title: '先维护 Provider 资源池，再维护 Endpoint 路由',
          description: '这里配置的是上游供应商、认证方式和模型清单；真正对客户端暴露的仍是内置端点与自定义端点。'
        },
        tabs: {
          providers: '模型提供商',
          providersDesc: '配置上游模型提供商以及认证信息。',
          anthropic: 'Anthropic 路由',
          anthropicDesc: '管理 /anthropic 端点的模型映射和默认配置。',
          openai: 'OpenAI 路由',
          openaiDesc: '管理 /openai 端点的模型映射和默认配置。',
          customEndpoint: '自定义端点'
        },
        addEndpoint: '添加端点',
        createEndpoint: '创建端点',
        editEndpoint: '编辑端点',
        deleteEndpointConfirm: '确定要删除端点 "{{label}}" 吗？此操作无法撤销。',
        deleteEndpointSuccess: '端点删除成功',
        deleteEndpointError: '删除失败：{{error}}',
        createEndpointSuccess: '端点创建成功',
        createEndpointError: '创建失败：{{error}}',
        updateEndpointSuccess: '端点更新成功',
        updateEndpointError: '更新失败：{{error}}',
        endpointValidationError: '请填写所有必填字段',
        pathValidationError: '请填写所有路径信息',
        atLeastOnePath: '至少需要一个路径',
        endpointId: '端点 ID',
        endpointIdPlaceholder: '如 custom-api',
        endpointIdHint: 'ID 创建后不可修改，用于内部标识。',
        endpointLabel: '显示名称',
        endpointLabelPlaceholder: '如 我的自定义 API',
        endpointPath: '访问路径',
        endpointPaths: '访问路径',
        endpointPathPlaceholder: '如 /custom/api',
        endpointPathHint: '路径需以 / 开头，修改后立即生效。',
        endpointProtocol: '协议类型',
        endpointEnabled: '启用此端点',
        endpointRoutingHint: '创建后，您可以在此端点的路由配置 Tab 中设置模型路由规则。',
        addPath: '添加路径',
        removePath: '删除路径',
        protocolAnthropic: 'Anthropic 协议',
        protocolOpenAI: 'OpenAI',
        protocolOpenAIChat: 'OpenAI Chat',
        protocolOpenAIResponses: 'OpenAI Responses',
        protocolHint: {
          anthropic: 'Anthropic Messages API 协议（/v1/messages）',
          'openai-auto': 'OpenAI 协议（支持 Chat Completions 和 Responses API）。请确保路径以 /v1/chat/completions 或 /v1/responses 结尾。',
          'openai-chat': 'OpenAI Chat Completions API 协议（/v1/chat/completions）',
          'openai-responses': 'OpenAI Responses API 协议（/v1/responses）'
        },
        actions: {
          saveRoutes: '保存路由',
          unsaved: '有未保存修改',
          footerTitle: '路由操作',
          footerDirtyHint: '已修改当前路由规则，请在此处完成保存。',
          footerSavedHint: '当前路由已与服务器保持同步。'
        },
        routesEditorTitle: '路由规则',
        emptyRoutesHint: '点击下方按钮添加路由规则。',
        routing: {
          selectTarget: '请选择目标 Provider:模型'
        },
        claudeValidation: {
          title: 'Anthropic 请求校验',
          description: '在转发前校验 /anthropic 请求体。建议默认使用更宽松的 Anthropic strict；只有确认客户端完全遵循 Claude Code 约定时再使用 Claude Code 模式。',
          modeLabel: '校验模式',
          options: {
            off: {
              label: '关闭',
              description: '不做请求体结构校验。'
            },
            'anthropic-strict': {
              label: 'Anthropic strict',
              description: '校验基础 Anthropic Messages 结构，并拒绝未知 block type。'
            },
            'claude-code': {
              label: 'Claude Code',
              description: '在 Anthropic strict 基础上保留 Claude Code 专属校验。'
            }
          }
        },
        toast: {
          routesSaved: '模型路由已更新。',
          routesSaveFailure: '保存模型路由失败：{{message}}',
          presetSaved: '已保存模板 "{{name}}"。',
          presetSaveFailure: '保存模板失败：{{message}}',
          presetApplySuccess: '已应用模板 "{{name}}"。',
          presetApplyFailure: '应用模板失败：{{message}}',
          presetDeleteSuccess: '模板 "{{name}}" 已删除。',
          presetDeleteFailure: '删除模板失败：{{message}}',
          validationModeSaved: 'Anthropic 请求校验模式已更新为：{{mode}}。',
          validationModeFailure: '更新请求校验模式失败：{{message}}'
        },
        presets: {
          title: '路由模板',
          description: '保存当前 Anthropic 路由映射，便于在不同 Provider 方案之间快速切换。',
          namePlaceholder: '输入模板名称，例如 fox',
          save: '保存模板',
          saving: '保存中...',
          empty: '尚未保存任何模板。',
          apply: '应用',
          applying: '应用中...',
          delete: '删除',
          deleting: '删除中...',
          rulesCount: '{{count}} 条规则',
          noRules: '空模板',
          previewTooltip: '悬停查看路由规则',
          diffTitle: '应用模板确认',
          diffDescription: '以下路由将被替换为模板 "{{name}}" 的配置：',
          diffAdded: '新增',
          diffRemoved: '移除',
          diffChanged: '变更',
          diffConfirm: '确认应用',
          diffEmpty: '模板与当前配置相同，无需变更。'
        },
        validation: {
          presetName: '请输入模板名称。',
          presetDuplicate: '模板 {{name}} 已存在，请使用其他名称。'
        },
        confirm: {
          deletePreset: '确定要删除模板 "{{name}}" 吗？'
        }
      },
      routingManagement: {
        title: '路由管理',
        description: '按端点管理模型映射、模板与自定义入口，避免和 Provider 资源池混在一起。',
        eyebrow: '流量入口'
      },
      events: {
        title: '安全事件',
        description: '查看校验防护与系统检测记录，及时发现异常访问。',
        filters: {
          title: '筛选条件',
          allLevels: '全部严重级别',
          typePlaceholder: '按事件类型过滤（可留空）'
        },
        actions: {
          newest: '最新',
          older: '更早'
        },
        levels: {
          info: '提示',
          warn: '警告',
          error: '错误'
        },
        empty: {
          title: '暂无事件记录',
          subtitle: '当前没有异常或告警事件，这通常意味着系统运行平稳。',
          filteredTitle: '当前筛选条件下没有匹配事件',
          filteredSubtitle: '可以重置筛选条件，或去请求日志中查看更完整的调用链。',
          actions: {
            logs: '查看请求日志'
          }
        },
        details: '查看详情',
        defaultTitle: '未命名事件',
        defaultMessage: '未提供详细描述。',
        toast: {
          loadFailure: '加载事件失败：{{message}}'
        }
      },
      settings: {
        title: '设置',
        description: '调整网关端口、日志策略及其他运行参数。',
        toast: {
          loadFailure: '配置加载失败：{{message}}',
          saveSuccess: '系统配置已更新。',
          saveFailure: '保存失败：{{message}}',
          protocolRestartRequired: '配置已保存！请执行 cc-gw restart --daemon 重启服务使协议配置生效',
          copySuccess: '配置文件路径已复制到剪贴板。',
          copyFailure: '复制失败：{{message}}',
          cleanupSuccess: '已删除 {{count}} 条历史日志。',
          cleanupNone: '没有需要删除的日志。',
          cleanupFailure: '清理失败：{{message}}',
          clearAllSuccess: '日志已清空（请求 {{logs}} 条，统计 {{metrics}} 条）。',
          clearAllFailure: '清空失败：{{message}}',
          missingConfig: '未能加载配置，请刷新或稍后再试。',
          authLoadFailure: '安全配置加载失败：{{message}}'
        },
        sections: {
          basics: '基础配置',
          routing: '模型路由',
          configFile: '配置文件',
          cleanup: '日志清理',
          security: '访问安全',
          protocol: '协议配置',
          jump: '跳转到'
        },
        overview: {
          title: '当前运行概览',
          description: '先确认当前监听方式、访问保护和配置文件位置，再进入具体调优。',
          unsavedCount: '待保存 {{count}} 项',
          cards: {
            protocols: '协议入口',
            security: '控制台访问',
            configFile: '配置文件'
          },
          values: {
            authEnabled: '已启用登录保护',
            authDisabled: '未启用登录保护',
            httpOnly: '仅 HTTP',
            httpsOnly: '仅 HTTPS',
            httpAndHttps: 'HTTP + HTTPS'
          }
        },
        fields: {
          port: '监听端口',
          host: '监听地址（可选）',
          hostPlaceholder: '默认 127.0.0.1',
          retention: '日志保留天数',
          logExportTimeout: '日志导出超时 (秒)',
          logExportTimeoutHint: '默认 60 秒；导出量较大时可调高，范围 5-600 秒。',
          bodyLimit: '请求体大小上限 (MB)',
          bodyLimitHint: '默认 10 MB；如 Claude Code 的 /compact 遇到 413，可适当调大。',
          defaults: '默认模型配置',
          storeRequestPayloads: '保存请求内容',
          storeRequestPayloadsHint: '开启后会在日志数据库中保留客户端请求；如发生协议转换，也会额外保存发往上游的请求体。',
          storeResponsePayloads: '保存响应内容',
          storeResponsePayloadsHint: '开启后会保留客户端响应；如发生协议转换，也会保存上游原始响应。流式响应会整理为完整消息而不是 chunk 片段。',
          logLevel: '日志级别',
          logLevelOption: {
            fatal: '致命 (fatal)',
            error: '错误 (error)',
            warn: '警告 (warn)',
            info: '信息 (info)',
            debug: '调试 (debug)',
            trace: '跟踪 (trace)'
          },
          enableRoutingFallback: '启用模型回退策略',
          enableRoutingFallbackHint: '无匹配模型时自动落到首个可用模型。默认关闭，建议仅在明确需要时开启。'
        },
        auth: {
          description: '开启 Web UI 登录后，所有管理接口仅对已登录用户开放，模型代理端点仍保持兼容。',
          enable: '启用 Web UI 登录保护',
          enableHint: '推荐在多人共用或生产环境中开启，访问 /ui 与 /api/* 将需要先登录。',
          username: '登录用户名',
          usernamePlaceholder: '设置用于登录的用户名',
          password: '登录密码',
          passwordPlaceholder: '至少 6 位字符',
          confirmPassword: '确认密码',
          confirmPasswordPlaceholder: '再次输入登录密码',
          status: '当前状态',
          statusEnabled: '已启用登录保护',
          statusDisabled: '未启用登录保护',
          passwordHintRequired: '首次启用或修改用户名时必须设置新密码（不少于 6 位）。',
          passwordHintOptional: '如需更新密码可填写新值，留空则沿用旧密码。',
          actions: {
            save: '保存安全设置'
          },
          toast: {
            success: '安全设置已更新。',
            failure: '保存失败：{{message}}'
          },
          validation: {
            username: '请填写用户名',
            minLength: '密码至少需要 6 位字符',
            passwordRequired: '请设置登录密码',
            confirmMismatch: '两次输入的密码不一致'
          }
        },
        protocol: {
          description: '配置 HTTP 和 HTTPS 服务端口，默认同时启用两个协议',
          restartWarning: '⚠️ 修改协议配置后需要重启服务才能生效',
          restartHint: '保存配置后，请执行以下命令重启服务：',
          restartTip: '💡 提示：端口、协议启用状态、证书路径需要重启；Provider 和路由配置支持热加载无需重启',
          http: {
            enable: '启用 HTTP',
            hint: '标准 HTTP 协议，适用于本地开发和内网环境',
            port: 'HTTP 端口',
            host: 'HTTP 主机地址'
          },
          https: {
            enable: '启用 HTTPS',
            hint: 'HTTPS 加密协议',
            port: 'HTTPS 端口',
            host: 'HTTPS 主机地址',
            keyPath: '证书私钥路径',
            certPath: '证书文件路径',
            caPath: 'CA 证书路径 (可选)',
            warning: '⚠️ 关于 HTTPS 证书',
            invalidCert: '自签名证书无效：',
            invalidCertDetail: 'Claude Code 和大多数 AI 工具无法信任自签名证书，会导致连接失败。',
            recommended: '推荐方案：',
            recommendedDetail: '本地开发环境建议使用 HTTP 协议（127.0.0.1 本地访问非常安全）。',
            tip: '💡 如需 HTTPS，请使用受信任 CA（如 Let\'s Encrypt）签发的正式证书，或配置反向代理（如 Nginx/Caddy）处理 HTTPS。'
          }
        },
        validation: {
          port: '请输入 1-65535 之间的端口号',
          retention: '日志保留天数需为 1-365 之间的数字',
          logExportTimeout: '日志导出超时需在 5-600 秒之间',
          bodyLimit: '请求体大小需在 1-2048 MB 之间',
          protocolRequired: '至少需要启用 HTTP 或 HTTPS 协议',
          httpPort: 'HTTP 端口必须在 1-65535 之间',
          httpsPort: 'HTTPS 端口必须在 1-65535 之间',
          httpsCertificate: 'HTTPS 已启用但缺少证书路径，请手动配置受信任的证书',
          routePair: '请填写完整的来源模型与目标模型配置。',
          routeDuplicate: '模型 {{model}} 已存在映射，请勿重复配置。'
        },
        defaults: {
          completion: '对话：{{model}}',
          reasoning: '推理：{{model}}',
          background: '后台：{{model}}',
          none: '未设置默认模型'
        },
        routing: {
          title: '模型路由映射',
          description: '为 Claude Code 发起的模型请求指定实际 Provider 与模型 ID（如将 claude 系列映射至 Kimi）。如需禁用映射，可留空或移除。',
          titleByEndpoint: '{{endpoint}} 路由配置',
          descriptionByEndpoint: {
            anthropic: '当 Claude Code 通过 /anthropic 端点请求特定模型时，将根据此映射选择目标 Provider 与模型。',
            openai: '当 Codex 通过 /openai 端点请求特定模型时，将根据此映射选择目标 Provider 与模型。'
          },
          wildcardHint: '来源模型支持使用 * 通配符（如 claude-*），匹配度更高的规则优先；若目标写成 providerId:*，会将请求里的模型名原样转发给对应 Provider。',
          add: '新增映射',
          empty: '尚未配置映射，系统将使用默认模型策略。',
          source: '来源模型',
          target: '目标 Provider:模型',
          sourceLabel: '来源模型',
          sourcePlaceholder: '如 claude-sonnet-4-5-20250929',
          targetLabel: '目标 Provider:模型',
          targetPlaceholder: '如 kimi:kimi-k2-0905-preview',
          customTargetOption: '自定义目标…',
          providerPassthroughOption: '{{provider}} · 透传原始模型 (*)',
          remove: '移除',
          suggested: '常用 Anthropic 模型'
        },
        file: {
          description: '当前配置存储在本地文件，可通过编辑该文件进行离线修改。',
          unknown: '未知路径'
        },
        cleanup: {
          description: '立即清理早于当前保留天数的日志记录。',
          softLabel: '轻度操作',
          softTitle: '清理过期日志',
          softDescription: '仅删除超过保留天数的历史日志，适合日常维护。',
          confirmTitle: '清理历史日志',
          confirmDescription: '该操作会删除超过保留天数的历史日志，但不会影响当前较新的记录。',
          hardLabel: '高风险操作',
          hardTitle: '彻底清空日志',
          clearAllTitle: '彻底清空日志',
          clearAll: '彻底清空',
          clearingAll: '清空中...',
          confirmCleanup: '该操作会删除超过保留天数的历史日志，但不会影响当前较新的记录。',
          confirmClearAll: '此操作会删除全部请求日志和日统计数据，且无法恢复。',
          clearAllWarning: '该操作会删除所有日志记录及日统计数据，请谨慎操作。'
        }
      },
      help: {
        title: '使用指南',
        intro: '完整的 cc-gw 配置和使用指南，帮助您从零开始搭建 AI 模型网关。',
        note: '所有配置变更都会实时生效。建议通过 Web UI 进行配置管理，CLI 主要用于服务启动和重启。',
        helper: '推荐顺序：先启动服务，再配置 Provider，然后创建 API 密钥，最后接入 Claude Code 或 Codex。',
        meta: {
          breadcrumb: '网关 / 使用指南',
          guides: '{{count}} 个指南',
          faqCount: '{{count}} 个问题',
          recommendedFlow: '推荐流程',
          claudeWorkflow: 'IDE / 桌面工作流',
          codexWorkflow: '终端工作流'
        },
        clientConfig: {
          title: '客户端配置指南',
          subtitle: '选择您的客户端工具，按照步骤进行配置'
        },
        advancedGuide: {
          title: '高级使用指南',
          subtitle: '日常使用技巧与最佳实践'
        },
        sections: {
          configuration: {
            title: '🚀 基础配置流程',
            items: [
              '📦 **安装并启动服务**：运行 `npm install -g @chenpu17/cc-gw && cc-gw start --daemon --port 4100`，然后访问 http://127.0.0.1:4100/ui',
              '🔧 **配置模型提供商**：在"模型供应商"页面中添加至少一个 Provider，配置 Base URL、API Key 和默认模型',
              '🔑 **生成网关 API Key（可选）**：在"API 密钥"页面创建 API 密钥，为不同客户端创建独立密钥。默认情况下，所有请求都可以通过网关访问。'
            ]
          },
          claudeCodeConfig: {
            title: '⚡ Claude Code 配置',
            items: [
              '🎯 **配置环境变量**：\n```bash\nexport ANTHROPIC_BASE_URL=http://127.0.0.1:4100/anthropic\nexport ANTHROPIC_API_KEY=sk-ant-oat01-8HEmUDacamV1...\n```\n写入 ~/.bashrc 或 ~/.zshrc 后执行 `source ~/.bashrc` 或 `source ~/.zshrc` 让变量生效。',
              '🔧 **插件设置配置**：\n- 在 Claude Code 插件设置中选择"自定义 API"\n- 填入 Base URL：`http://127.0.0.1:4100/anthropic`\n- 填入 API Key：使用你的实际 API Key（如 `sk-ant-oat01-8HEmUDacamV1...`）',
              '✅ **快速验证**：\n```bash\nclaude "你好，请简短回应"\n```\n输出正常即代表配置成功，可在"请求日志"页看到对应记录。'
            ]
          },
          codexConfig: {
            title: '🛠️ Codex CLI 配置',
            items: [
              '📝 **编辑配置文件**：\n在 `~/.codex/config.toml` 进行配置：\n```toml\nmodel = "gpt-5-codex"\nmodel_provider = "cc_gw"\nmodel_reasoning_effort = "high"\ndisable_response_storage = true\n\n[model_providers.cc_gw]\nname = "cc_gw"\nbase_url = "http://127.0.0.1:4100/openai/v1"\nwire_api = "responses"\nenv_key = "cc_gw_key"\n```',
              '🔑 **设置环境变量**：\n```bash\nexport cc_gw_key=sk-ant.....\n```\n写入 ~/.bashrc 或 ~/.zshrc 后执行 `source` 让变量生效。',
              '✅ **验证配置**：\n```bash\ncodex status  # 检查连接状态\ncodex ask "你好，请介绍一下自己"  # 测试对话\ncodex chat  # 进入交互模式\n```\n输出正常即代表配置成功。'
            ]
          },
          usage: {
            title: '📊 日常使用指南',
            items: [
              '📈 **仪表盘监控**：实时查看请求量、Token 使用量、缓存命中率和响应时间（TTFT/TPOT）等关键指标',
              '📋 **日志分析**：使用"请求日志"页面筛选和分析请求记录；详情抽屉会按客户端/上游链路分开展示 payload 区块，便于定位协议改写问题',
              '🔄 **模型路由管理**：在"路由管理"页面中设置模型映射规则，实现不同模型的智能路由',
              '🎛️ **系统配置**：在"设置"页面中调整日志保留策略、数据存储设置和运行参数',
              '🔐 **安全配置**：启用 Web UI 登录保护，设置用户名密码，确保管理接口安全'
            ]
          },
          tips: {
            title: '💡 高级技巧与最佳实践',
            items: [
              '📦 **环境变量管理**：推荐使用 direnv 管理环境变量，创建 .envrc 文件自动加载配置',
              '🔌 **自定义接入点**：创建额外的 API 端点以支持不同的协议和独立路由配置。在"路由管理"页面可以创建和管理自定义接入点。\n\n**主要特性**：\n• 只需配置基础路径（如 `/my-endpoint`），系统会根据协议自动注册完整 API 路径\n• 支持 Anthropic 和 OpenAI 协议（Chat Completions / Responses API）\n• 每个端点可配置独立的模型路由规则\n• 一个端点可注册多个路径，支持多种协议\n\n**示例配置**：\n```json\n{\n  "id": "claude-api",\n  "label": "Claude 专用接入点",\n  "path": "/claude",\n  "protocol": "anthropic"\n}\n```\n配置后，客户端通过 `http://127.0.0.1:4100/claude/v1/messages` 访问（路径自动扩展）。',
              '🗃️ **数据备份**：定期备份 ~/.cc-gw/ 目录（包含配置、日志和数据库）',
              '🧹 **日志清理**：根据需要调整日志保留天数，或使用"日志清理"功能手动清理',
              '🔍 **问题排查**：开启"保存请求内容 / 保存响应内容"后，可在日志详情里复制客户端与上游 payload，用于调试兼容性问题',
              '⚡ **性能优化**：如无需排障，可关闭 payload 存储以减少磁盘占用与敏感数据落盘风险',
              '🎯 **模型切换**：使用路由模板功能，实现不同 Provider 方案的一键切换',
              '📊 **监控告警**：结合 Dashboard 数据设置自定义监控，及时发现异常'
            ]
          }
        },
        faq: {
          title: '❓ 常见问题解答',
          items: [
            {
              q: '如何解决 Claude Code 连接失败问题？',
              a: '1) 检查 cc-gw 服务状态：`cc-gw status`\n2) 验证环境变量：`echo $ANTHROPIC_BASE_URL`\n3) 确认 API Key 正确性\n4) 在"请求日志"中查看详细错误信息'
            },
            {
              q: '如何使用自定义接入点？',
              a: '在"路由管理"页面创建自定义接入点，配置基础路径（如 `/my-endpoint`）和协议类型。系统会自动根据协议注册完整的 API 路径。例如，配置 `/claude` + `anthropic` 协议后，客户端通过 `http://127.0.0.1:4100/claude/v1/messages` 访问。\n\n如果遇到 404 错误，检查：\n1) 端点是否已启用\n2) 客户端使用的是完整路径（包括协议子路径）\n3) 查看服务器日志确认路由是否注册成功'
            },
            {
              q: '为什么没有缓存命中数据？',
              a: '需要上游 Provider 返回 cached_tokens 或 input_tokens_details.cached_tokens 字段。确认 Provider 支持缓存功能并已正确配置。'
            },
            {
              q: '如何配置多个客户端使用不同模型？',
              a: '为每个客户端创建独立的 API Key，在"路由管理"页面中设置不同的路由规则，或使用不同的环境变量配置。也可以为不同客户端创建专用的自定义接入点。'
            },
            {
              q: 'Codex CLI 如何连接到 cc-gw？',
              a: '配置 ~/.codex/config.toml 文件，设置 model_provider 为 "cc_gw"，base_url 为 cc-gw 的 OpenAI 兼容端点，并设置相应的环境变量。'
            },
            {
              q: '如何备份和迁移配置？',
              a: '备份整个 ~/.cc-gw/ 目录，包含 config.json、数据库和日志文件。在新环境中恢复目录并重启服务即可。'
            },
            {
              q: 'Web UI 显示 404 错误怎么办？',
              a: '确认已执行 `pnpm --filter @cc-gw/web build`，或使用 npm 全局安装版本。检查服务启动日志中的静态资源路径。'
            }
          ]
        }
      },

      about: {
        title: '关于',
        description: '查看 cc-gw 的版本信息、构建元数据与运行状态。',
        app: {
          title: '应用信息',
          subtitle: '版本与构建元数据一目了然。',
          labels: {
            name: '名称',
            version: '版本',
            buildTime: '构建时间',
            runtime: '后端运行时',
            backendVersion: '后端版本'
          },
          hint: {
            buildTime: '构建时间以 UTC 表示，便于排查部署版本。'
          }
        },
        status: {
          title: '运行状态',
          subtitle: '来自当前网关实例的实时指标。',
          loading: '正在获取运行状态...',
          empty: '未能获取状态信息。',
          labels: {
            host: '监听地址',
            port: '监听端口',
            providers: '已配置 Provider',
            active: '活动请求',
            platform: '运行平台',
            pid: '进程 PID'
          },
          hint: {
            active: '活动请求数每分钟刷新一次，可快速判断当前负载。'
          }
        },
        support: {
          title: '使用提示',
          subtitle: '运行维护说明',
          description: '通过 Web UI 管理 Provider、模型路由与日志，高级配置可直接编辑 ~/.cc-gw/config.json。',
          tip: '高级配置建议结合 CLI 使用，可将 ~/.cc-gw/config.json 纳入版本管理或自动化脚本。',
          actions: {
            checkUpdates: '检查更新',
            checkingUpdates: '检查中...'
          }
        },
        update: {
          available: '发现新版本 v{{version}}',
          current: '当前已是最新版本 v{{version}}',
          channel: '更新通道：{{channel}}'
        },
        toast: {
          statusError: {
            title: '状态加载失败'
          },
          upToDate: {
            title: '当前已是最新版本 v{{version}}',
            description: 'npm registry 中没有发现更高版本。'
          },
          updateAvailable: {
            title: '发现新版本 v{{version}}',
            description: '可通过 npm install -g {{packageName}} 更新。'
          },
          updateError: {
            title: '检查更新失败'
          }
        }
      },
      apiKeys: {
        title: 'API 密钥管理',
        description: '创建和管理用于访问网关的 API 密钥',
        helper: '建议为不同客户端、环境或自动化任务使用独立密钥，便于回溯、限权和停用。',
        createNew: '创建新密钥',
        createAction: '创建',
        createDescription: '创建一个新的 API 密钥用于身份验证，可选填写密钥描述。',
        descriptionLabel: '密钥描述（可选）',
        keyDescriptionPlaceholder: '例如：仅供内部测试环境使用',
        keyNamePlaceholder: '输入密钥名称',
        keyCreated: 'API 密钥已创建',
        saveKeyWarning: '请妥善保管此密钥。您也可以随时通过密钥列表查看完整密钥。',
        wildcard: '通配符',
        wildcardHint: '启用该密钥后，任何自定义密钥与空密钥都可以通过认证；如需限制访问，可随时禁用该密钥。',
        status: {
          enabled: '已启用',
          disabled: '已禁用'
        },
        actions: {
          enable: '启用',
          disable: '禁用',
          delete: '删除',
          reveal: '显示完整密钥',
          hide: '隐藏密钥'
        },
        created: '创建时间',
        lastUsed: '最后使用',
        requestCount: '请求次数',
        totalTokens: '总令牌数',
        deleteDialogTitle: '删除 API 密钥',
        confirmDelete: '确定要删除此 API 密钥吗？此操作无法撤销。',
        errors: {
          nameRequired: '密钥名称不能为空'
        },
        analytics: {
          title: '密钥使用分析',
          description: '展示最近 {{days}} 天的密钥调用情况',
          range: {
            today: '今日',
            week: '近 7 天',
            month: '近 30 天'
          },
          cards: {
            total: '总密钥数',
            enabled: '启用密钥',
            active: '活跃密钥（{{days}} 天）'
          },
          charts: {
            requests: '按密钥的请求次数（Top 10）',
            tokens: '按密钥的 Token 消耗（Top 10）'
          },
          tokens: {
            input: '输入 Token',
            output: '输出 Token'
          },
          requestsSeries: '请求次数',
          empty: '所选时间范围内暂无统计数据。',
          emptyHint: '先创建并使用至少一个密钥，图表会在有真实流量后开始显示。',
          actions: {
            logs: '去请求日志'
          },
          unknownKey: '未知密钥'
        },
        quickStart: {
          title: '推荐使用方式',
          description: '先按客户端拆分密钥，再逐步收紧权限，可以显著降低排查成本。',
          create: {
            title: '按客户端分组',
            description: '例如为 Claude Code、Codex、CI 或测试环境分别创建独立密钥。'
          },
          restrict: {
            title: '按端点限制访问',
            description: '需要时只开放 Anthropic、OpenAI 或自定义接入点，避免误用。'
          },
          wildcard: {
            title: '谨慎使用通配密钥',
            description: '通配密钥适合临时兼容；生产环境更推荐关闭它并使用命名密钥。'
          }
        },
        list: {
          title: '密钥列表',
          emptyTitle: '先创建第一把 API 密钥',
          empty: '尚未创建 API 密钥，点击右上角按钮开始创建。',
          emptyFilteredTitle: '没有符合当前筛选条件的密钥',
          emptyFiltered: '当前筛选条件下没有匹配的 API 密钥。'
        },
        filters: {
          searchPlaceholder: '按名称、描述或端点搜索',
          all: '全部',
          enabled: '已启用',
          disabled: '已禁用'
        },
        summary: {
          totalCount: '密钥 {{count}}',
          wildcard: '通配符密钥：{{count}}',
          restricted: '受限密钥：{{count}}',
          unrestricted: '不限制端点：{{count}}'
        },
        views: {
          cards: '卡片视图',
          compact: '紧凑列表'
        },
        table: {
          name: '密钥',
          access: '访问范围',
          actions: '操作',
          accessWildcard: '通配访问',
          accessOpen: '不限制端点'
        },
        toast: {
          keyCreated: 'API 密钥创建成功',
          keyUpdated: 'API 密钥已更新',
          keyDeleted: 'API 密钥已删除',
          keyCopied: '密钥已复制到剪贴板',
          createFailure: '创建失败：{{message}}',
          updateFailure: '更新失败：{{message}}',
          deleteFailure: '删除失败：{{message}}',
          revealFailure: '获取密钥失败',
          copyFailure: '复制失败'
        },
        allowedEndpoints: '允许的端点',
        allEndpoints: '全部端点（不限制）',
        editEndpoints: '编辑端点权限',
        endpointRestricted: '已限制端点',
        selectEndpoints: '选择此密钥可以访问的端点，不选择则允许访问全部端点。',
        maxConcurrency: '最大并发数',
        maxConcurrencyPlaceholder: '留空表示不限制',
        maxConcurrencyHelper: '设置此密钥同时请求的最大数量。留空或设为 0 表示不限制。'
      },
      endpoints: {
        title: '自定义端点',
        description: '管理自定义 API 端点，支持多种协议类型。',
        createButton: '新增端点',
        createTitle: '创建端点',
        editTitle: '编辑端点',
        emptyTitle: '暂无自定义端点',
        emptyDescription: '点击"新增端点"按钮创建您的第一个自定义端点。',
        loadError: '加载端点列表失败',
        id: 'ID',
        path: '路径',
        disabled: '已禁用',
        hasRouting: '已配置路由',
        protocols: {
          anthropic: 'Anthropic 协议',
          'openai-chat': 'OpenAI Chat',
          'openai-responses': 'OpenAI Responses'
        },
        protocolHints: {
          anthropic: 'Anthropic Messages API 协议（/v1/messages）',
          'openai-chat': 'OpenAI Chat Completions API 协议（/v1/chat/completions）',
          'openai-responses': 'OpenAI Responses API 协议（/v1/responses）'
        },
        form: {
          id: '端点 ID',
          idPlaceholder: '如 custom-api',
          idHint: 'ID 创建后不可修改，用于内部标识。',
          label: '显示名称',
          labelPlaceholder: '如 我的自定义 API',
          path: '访问路径',
          pathPlaceholder: '如 /custom/api',
          pathHint: '路径需以 / 开头，修改后立即生效。',
          protocol: '协议类型',
          enabled: '启用此端点'
        },
        routing: {
          title: '路由配置（可选）',
          modelRoutes: '模型路由规则',
          addRoute: '添加规则',
          noRoutes: '暂无路由规则',
          sourceModelPlaceholder: '源模型（如 claude-3-5-sonnet-20241022）',
          targetPlaceholder: '目标（如 anthropic:claude-3-5-sonnet-20241022）',
          modelRoutesHint: '格式：源模型 → provider:model，支持通配符（如 gpt-* → openai:*）',
          defaults: '默认模型配置',
          defaultCompletion: '常规对话默认模型',
          defaultReasoning: '推理任务默认模型',
          defaultBackground: '后台任务默认模型',
          longContextThreshold: '长上下文阈值（tokens）',
          defaultPlaceholder: '如 anthropic:claude-3-5-sonnet-20241022'
        },
        createSuccess: '端点创建成功',
        createError: '创建失败：{{error}}',
        updateSuccess: '端点更新成功',
        updateError: '更新失败：{{error}}',
        deleteSuccess: '端点删除成功',
        deleteError: '删除失败：{{error}}',
        deleteConfirm: '确定要删除端点 "{{label}}" 吗？此操作无法撤销。',
        validationError: '请填写所有必填字段'
      },
      profiler: {
        title: '性能分析',
        eyebrow: '会话性能分析',
        breadcrumb: '网关 / 性能分析',
        description: '记录并分析 LLM 会话的延迟与 token 用量。',
        sessionsTitle: '会话列表',
        sessionsCount: '{{count}} 个会话',
        searchPlaceholder: '搜索会话...',
        loadingSession: '正在加载会话...',
        sessionSummary: '{{turns}} 轮 · {{duration}} · {{tokens}} tokens',
        metricTurns: '{{count}} 轮',
        metricTokens: '{{value}} tok',
        tabs: {
          timeline: '时间线',
          breakdown: '拆解视图'
        },
        status: {
          recording: '录制中',
          idle: '未录制'
        },
        actions: {
          start: '开始录制',
          stop: '停止录制',
          export: '导出',
          clear: '清空'
        },
        timeline: {
          summary: '压缩总览 · 自动折叠空闲间隔 · 按轮次换行展示',
          mode: '模式：',
          compressed: '压缩',
          sessionDuration: '会话 {{duration}}',
          start: '开始',
          startAt: '开始 {{time}}s',
          tools: '工具',
          legend: {
            totalLatency: '总延迟',
            firstToken: '首 token（TTFT）',
            toolExecuting: '工具调用',
            selectedTurn: '选中轮次'
          }
        },
        turn: {
          title: '第 {{index}} 轮',
          previous: '上一轮',
          next: '下一轮'
        },
        payload: {
          request: '请求',
          response: '响应',
          toolCalls: '工具调用',
          empty: '（空）',
          emptyRequest: '（空请求）',
          emptyResponse: '（空响应）',
          noToolCalls: '（无工具调用）'
        },
        breakdown: {
          total: '总计 {{value}}',
          toolCallsCount: '{{count}} 次工具调用',
          error: '错误',
          turnMetrics: '轮次指标',
          duration: '耗时',
          status: '状态',
          input: '输入',
          output: '输出',
          totalDuration: '总耗时',
          llmTime: 'LLM 时间',
          avgTtft: '平均 TTFT',
          avgTpot: '平均 TPOT',
          inputTokens: '输入 Tokens',
          outputTokens: '输出 Tokens',
          turnsSub: '{{count}} 轮',
          sessionShare: '占会话 {{value}}%',
          perTurnTitle: '逐轮拆解',
          perTurnDescription: '展开任意轮次，检查请求、响应、工具调用与错误。'
        },
        empty: {
          waitingTitle: '等待请求进入...',
          waitingDescription: '带有 session_id 的请求会显示在这里。',
          idleTitle: '暂无会话',
          idleDescription: '开始录制后即可捕获 LLM 会话。',
          noTurnsTitle: '该会话还没有记录到轮次',
          noTurnsDescription: '会话壳已创建，但还没有写入 turn 级别的请求或响应内容。',
          selectTitle: '选择一个会话',
          selectDescription: '从左侧选择会话，查看其时间线、消息载荷和统计数据。',
          actions: {
            logs: '查看请求日志'
          }
        },
        errors: {
          loadFailed: '加载会话失败',
          notFound: '未找到会话'
        },
        relativeTime: {
          justNow: '刚刚',
          minutesAgo: '{{count}} 分钟前',
          hoursAgo: '{{count}} 小时前',
          daysAgo: '{{count}} 天前'
        }
      }
    }
  },
  en: {
    translation: {
      app: {
        title: 'cc-gw Console',
        skipToContent: 'Skip to main content',
        consoleSubtitle: 'Gateway control plane',
        environmentLabel: 'Environment',
        online: 'Service online'
      },
      nav: {
        dashboard: 'Dashboard',
        logs: 'Logs',
        events: 'Events',
        models: 'Model Providers',
        routing: 'Routing',
        apiKeys: 'API Keys',
        settings: 'Settings',
        help: 'Help',
        about: 'About',
        profiler: 'Profiler',
        group: {
          overview: 'Overview',
          admin: 'Admin'
        }
      },
      language: {
        zh: 'Simplified Chinese',
        en: 'English'
      },
      common: {
        loading: 'Loading...',
        loadingShort: 'Loading...',
        noData: 'No data available',
        languageSelector: 'Language selector',
        yes: 'Yes',
        edit: 'Edit',
        delete: 'Delete',
        create: 'Create',
        save: 'Save',
        saving: 'Saving...',
        cancel: 'Cancel',
        actions: {
          loading: 'Working...',
          refresh: 'Refresh',
          refreshing: 'Refreshing...',
          manualRefresh: 'Manual refresh',
          reset: 'Reset',
          close: 'Close',
          openNavigation: 'Open navigation',
          closeNavigation: 'Close navigation',
          save: 'Save changes',
          saving: 'Saving...',
          cancel: 'Cancel',
          copy: 'Copy',
          testConnection: 'Test connection',
          testingConnection: 'Testing...',
          cleanup: 'Clean up logs',
          cleaning: 'Cleaning...',
          checkUpdates: 'Check for updates',
          logout: 'Sign out'
        },
        theme: {
          label: 'Theme',
          light: 'Light',
          dark: 'Dark',
          system: 'System'
        },
        status: {
          success: 'Success',
          pending: 'In progress',
          error: 'Error',
          enabled: 'Enabled',
          disabled: 'Disabled'
        },
        notifications: {
          featureInProgress: 'Feature under development. Stay tuned!'
        },
        units: {
          request: 'req',
          ms: 'ms',
          token: 'tokens',
          msPerToken: 'ms/token'
        },
        noMatches: 'No matches',
        unknownError: 'Unknown error',
        filters: {
          activeCount: '{{count}} active filters',
          collapse: 'Collapse filters',
          expand: 'Expand filters',
          allRequests: 'All requests'
        }
      },
      login: {
        title: 'Sign in to cc-gw',
        description: 'Authentication is required before accessing the console.',
        fields: {
          username: 'Username',
          usernamePlaceholder: 'Enter your username',
          password: 'Password',
          passwordPlaceholder: 'Enter your password'
        },
        actions: {
          submit: 'Sign in'
        },
        validation: {
          required: 'Please enter both username and password',
          failed: 'Sign in failed. Check your credentials and try again.'
        },
        hint: 'Forgot your credentials? You can reset the Web UI login settings from the server CLI or by editing the configuration file.',
        status: 'Signed in as {{username}}'
      },
      dashboard: {
        description: 'Monitor request volume and runtime health at a glance.',
        labels: {
          providers: 'Providers',
          activeClientAddresses: 'Active client addresses',
          activeClientSessions: 'Active sessions',
          uniqueClientAddressesLastHour: '1h active client IPs',
          uniqueClientSessionsLastHour: '1h sessions',
          todayRequests: 'Today requests',
          activeRequests: 'Active forwarded connections',
          throughput: 'Throughput',
          requestsPerMinute: 'RPM',
          outputTokensPerMinute: 'TPM',
          cpu: 'CPU usage',
          bandwidth: 'Bandwidth',
          networkIngress: 'Ingress bandwidth',
          networkEgress: 'Egress bandwidth',
          database: 'Database',
          memory: 'Memory'
        },
        filters: {
          endpoint: 'Endpoint',
          endpointAll: 'All endpoints',
          endpointAnthropic: 'anthropic',
          endpointOpenAI: 'openai'
        },
        status: {
          listeningLabel: 'Listening',
          listening: 'Listening: {{host}}:{{port}}',
          providers: 'Providers: {{value}}',
          todayRequests: 'Requests today: {{value}}',
          active: 'Active requests: {{value}}',
          dbSize: 'Database: {{value}}',
          memory: 'Memory usage: {{value}}'
        },
        actions: {
          compact: 'Compact database',
          compacting: 'Compacting...'
        },
        toast: {
          overviewError: 'Failed to load overview metrics',
          dailyError: 'Failed to load trend metrics',
          modelError: 'Failed to load model statistics',
          statusError: 'Failed to load gateway status',
          dbError: 'Failed to load database info',
          recentError: 'Failed to load recent requests',
          compactSuccess: {
            title: 'Database compact completed',
            desc: 'Free pages were compacted. Refresh later to confirm size.'
          },
          compactError: {
            title: 'Database compact failed',
            desc: 'Error: {{message}}'
          }
        },
        cards: {
          todayRequests: 'Requests Today',
          todayInput: 'Input Tokens Today',
          todayCacheRead: 'Cache Read Today',
          todayCacheCreation: 'Cache Creation Today',
          todayOutput: 'Output Tokens Today',
          todayCached: 'Cached Tokens Today',
          avgLatency: 'Average Latency'
        },
        charts: {
          requestsTitle: 'Request Trends',
          requestsDesc: 'Requests and token usage over the last 14 days',
          modelTitle: 'Model Distribution',
          modelDesc: 'Requests and tokens by model in the past 7 days',
          barRequests: 'Requests',
          lineInput: 'Input tokens',
          lineOutput: 'Output tokens',
          lineCached: 'Cached tokens',
          lineCacheRead: 'Cache Read',
          lineCacheCreation: 'Cache Creation',
          axisTokens: 'Tokens',
          ttftLabel: 'TTFT (ms)',
          tpotLabel: 'TPOT (ms/token)',
          ttftTitle: 'TTFT Comparison',
          ttftDesc: 'Compare first-token latency (TTFT) across models',
          ttftEmpty: 'No TTFT data available.',
          tpotTitle: 'TPOT Comparison',
          tpotDesc: 'Compare per-token latency (TPOT) across models',
          tpotEmpty: 'No TPOT data available.',
          ttftAxis: 'TTFT (ms)',
          tpotAxis: 'TPOT (ms/token)',
          empty: 'No data'
        },
        insights: {
          totalRequests: 'Requests in range',
          totalRequestsHint: 'Total requests across the last 14 days',
          busiestDay: 'Busiest day',
          busiestDayHint: '{{value}} requests',
          topModel: 'Top model',
          topModelHint: '{{value}} calls',
          fastestTtft: 'Fastest TTFT model'
        },
        recent: {
          title: 'Recent Requests',
          subtitle: 'Showing the latest {{count}} records',
          loading: 'Loading...',
          empty: 'No recent requests',
          routePlaceholder: 'Not specified',
          columns: {
            time: 'Time',
            endpoint: 'Endpoint',
            provider: 'Provider',
            route: 'Route',
            latency: 'Latency (ms)',
            status: 'Status'
          }
        },
        modelTable: {
          title: 'Model Performance Snapshot',
          description: 'Requests, average latency, TTFT, and TPOT by downstream model.',
          empty: 'No model statistics available.',
          columns: {
            model: 'Provider/Model',
            requests: 'Requests',
            latency: 'Avg Latency',
            ttft: 'TTFT',
            tpot: 'TPOT'
          }
        }
      },
      logs: {
        title: 'Request Logs',
        description: 'Inspect recent traffic with provider/model/status filters and date range.',
        filtersTitle: 'Filters',
        filtersDescription: 'Combine conditions to zero in on the requests you care about.',
        summary: {
          total: 'Total records: {{value}}'
        },
        filters: {
          provider: 'Provider',
          providerAll: 'All providers',
          endpoint: 'Endpoint',
          endpointAll: 'All endpoints',
          endpointAnthropic: 'anthropic',
          endpointOpenAI: 'openai',
          apiKey: 'API Key',
          apiKeyHint: 'Select one or more keys; leave empty to include all.',
          modelId: 'Model ID',
          modelPlaceholder: 'e.g. deepseek-chat',
          status: 'Status',
          statusAll: 'All',
          statusSuccess: 'Success',
          statusError: 'Error',
          startDate: 'Start date',
          endDate: 'End date',
          apiKeyAll: 'All keys',
          apiKeySelected: '{{count}} selected'
        },
        actions: {
          columns: 'Columns',
          visibleCount: '{{count}} columns visible',
          manualRefresh: 'Manual refresh',
          refreshing: 'Refreshing...',
          export: 'Export ZIP',
          exporting: 'Exporting...',
          detail: 'Detail'
        },
        quickViews: {
          all: 'All traffic',
          errors: 'Errors only',
          today: 'Today',
          anthropic: 'Anthropic',
          openai: 'OpenAI'
        },
        table: {
          loading: 'Loading logs...',
          empty: 'No records match the current filters.',
          density: {
            comfortable: 'Comfortable',
            compact: 'Compact'
          },
          requestedModelFallback: 'Not specified',
          apiKeyUnknown: 'Unknown key',
          columns: {
            time: 'Time',
            endpoint: 'Endpoint',
            provider: 'Provider',
            requestedModel: 'Requested model',
            routedModel: 'Routed model',
            apiKey: 'API Key',
            inputTokens: 'Input Tokens',
            cacheReadTokens: 'Cache Read',
            cacheCreationTokens: 'Cache Creation',
            outputTokens: 'Output Tokens',
            stream: 'Stream',
            latency: 'Latency (ms)',
            ttft: 'TTFT (ms)',
            tpot: 'TPOT (ms/token)',
            status: 'Status',
            error: 'Error',
            actions: 'Actions'
          },
          pagination: {
            perPage: 'per page',
            unit: 'items',
            previous: 'Previous',
            next: 'Next',
            pageLabel: 'Page {{page}} / {{total}}'
          }
        },
        empty: {
          title: 'Logs have not accumulated yet',
          subtitle: 'Send a real request and this page will start showing routes, latency, and statuses.',
          filteredTitle: 'No logs match the current filters',
          filteredSubtitle: 'Reset the filters or widen the time range, endpoint, or status selection.',
          actions: {
            reset: 'Reset filters',
            apiKeys: 'Open API Keys'
          }
        },
        endpointAnthropic: 'anthropic',
        endpointOpenAI: 'openai',
        stream: {
          streaming: 'Streaming',
          single: 'Non-streaming'
        },
        toast: {
          listError: {
            title: 'Failed to fetch logs',
            desc: 'Error: {{message}}'
          },
          providerError: {
            title: 'Failed to fetch providers',
            desc: 'Error: {{message}}'
          },
          exportSuccess: {
            title: 'Export ready',
            desc: 'The ZIP archive is downloading now and contains `logs.json`.'
          },
          exportError: {
            title: 'Export failed',
            desc: 'Error: {{message}}'
          }
        },
        detail: {
          title: 'Log Detail',
          id: 'ID #{{id}}',
          infoSection: 'Overview',
          info: {
            time: 'Time',
            sessionId: 'Session ID',
            endpoint: 'Endpoint',
            provider: 'Provider',
            requestedModel: 'Requested model',
            noRequestedModel: 'Not specified',
            model: 'Routed model',
            stream: 'Stream',
            latency: 'Latency',
            status: 'Status',
            inputTokens: 'Input Tokens',
            cacheReadTokens: 'Cache Read',
            cacheCreationTokens: 'Cache Creation',
            outputTokens: 'Output Tokens',
            ttft: 'TTFT (first token latency)',
            tpot: 'TPOT (avg ms/token)',
            error: 'Error'
          },
          summary: {
            route: '{{from}} → {{to}}',
            latency: 'Latency: {{value}}',
            ttft: 'TTFT: {{value}}',
            tpot: 'TPOT: {{value}}',
            stream: 'Stream: {{value}}'
          },
          payload: {
            title: 'Payloads',
            helperWithUpstream: 'Client and upstream payloads are shown separately.',
            helperClientOnly: 'No upstream rewrite was recorded, so only client-side payloads are shown.',
            clientRequest: 'Client request',
            upstreamRequest: 'Upstream request',
            upstreamResponse: 'Upstream response',
            clientResponse: 'Client response',
            emptyRequest: 'No request content',
            emptyResponse: 'No response content'
          },
          apiKey: {
            title: 'API key',
            name: 'Key name',
            identifier: 'Key ID',
            masked: 'Masked form',
            maskedUnavailable: 'No mask available',
            raw: 'Raw key',
            rawUnavailable: 'Raw key not stored',
            rawMasked: 'Raw key (masked)',
            rawMaskedHint: 'For security, only the prefix and suffix are shown. Regenerate the key upstream if you need the full value.',
            missing: 'Not recorded',
            lastUsed: 'Last used'
          },
          copy: {
            requestSuccess: 'Request body copied to clipboard.',
            responseSuccess: 'Response body copied to clipboard.',
            keySuccess: 'API key copied to clipboard.',
            empty: 'Cannot copy empty {{label}}.',
            failure: 'Copy failed',
            failureFallback: 'Unable to copy content. Please try again later.'
          },
          loadError: 'Unable to load log detail.'
        }
      },

      providers: {
        title: 'Model Providers',
        description: 'Manage integrated services and default models.',
        emptyState: 'No providers yet. Click "Add provider" to get started.',
        emptyFiltered: 'No providers match the current filters.',
        count: '{{count}} providers configured',
        groupCount: '{{count}} providers',
        filters: {
          searchPlaceholder: 'Search by name, ID, or Base URL',
          typeAll: 'All types'
        },
        status: {
          ready: 'Ready',
          needsDefault: 'Needs default model'
        },
        toast: {
          createSuccess: 'Provider added: {{name}}',
          updateSuccess: 'Provider updated: {{name}}',
          testSuccess: 'Connection test succeeded.',
          testSuccessDesc: 'HTTP {{status}} · {{duration}} elapsed',
          testFailure: 'Connection test failed: {{message}}',
          loadFailure: 'Failed to load config: {{message}}',
          deleteSuccess: 'Provider removed: {{name}}',
          deleteFailure: 'Failed to remove provider: {{message}}'
        },
        actions: {
          add: 'Add provider',
          refresh: 'Refresh',
          refreshing: 'Refreshing...',
          edit: 'Edit',
          delete: 'Delete',
          test: 'Test connection'
        },
        quickAddHuawei: {
          button: 'Quick add Huawei models',
          title: 'Quick add Huawei models',
          description: 'Provide the API key to automatically configure Huawei Cloud DeepSeek V3.1, KIMI-K2, and Qwen3-235B-A22B.',
          apiKeyLabel: 'API Key',
          apiKeyPlaceholder: 'Enter your Huawei Cloud API Key',
          note: 'You can further adjust settings from the provider list after creation.',
          submit: 'Add provider',
          providerLabel: 'Huawei Cloud',
          validation: {
            apiKey: 'API Key is required'
          },
          toast: {
            success: 'Huawei provider added',
            added: '{{name}} added successfully',
            failure: 'Failed to add provider. Please try again later.'
          }
        },
        testDialog: {
          title: 'Connection Test Options',
          subtitle: 'Test request for {{name}}',
          description: 'Some Claude-compatible providers expect additional headers before accepting diagnostic calls. Select the headers to include; leave unchecked to send none.',
          headerValue: 'Header value: {{value}}',
          presetLabel: 'Simulate Claude Code request (recommended)',
          presetDescription: 'Adds the headers Claude CLI normally sends (anthropic-beta, x-app, user-agent, etc.) for maximum compatibility.',
          presetPreviewSummary: 'Show headers that will be attached',
          preservedInfo: 'Headers below are always included from the saved configuration:',
          cancel: 'Cancel',
          primary: 'Run Test',
          options: {
            beta: {
              label: '`anthropic-beta` header',
              description: 'Enables Claude Code experimental capabilities like fine-grained tool streaming. Services such as fox code_cc typically require it.'
            },
            browser: {
              label: '`anthropic-dangerous-direct-browser-access` header',
              description: 'Marks the request as coming from a trusted client. Claude Code includes this header by default.'
            },
            xApp: {
              label: '`x-app` header',
              description: 'Identifies the client as Claude CLI (cli).'
            },
            userAgent: {
              label: '`user-agent` header',
              description: 'Imitates the Claude CLI user agent string.'
            },
            accept: {
              label: '`accept` header',
              description: 'Declares JSON as the expected response format.'
            },
            acceptLanguage: {
              label: '`accept-language` header',
              description: 'Provides language information for providers that require it.'
            },
            secFetchMode: {
              label: '`sec-fetch-mode` header',
              description: 'Matches browser/CLI fetch metadata.'
            },
            acceptEncoding: {
              label: '`accept-encoding` header',
              description: 'Allows gzip/deflate compressed responses.'
            },
            stainlessHelper: {
              label: '`x-stainless-helper-method` header',
              description: 'Indicates the Claude CLI stream helper.'
            },
            stainlessRetry: {
              label: '`x-stainless-retry-count` header',
              description: 'Carries Claude CLI retry metadata.'
            },
            stainlessTimeout: {
              label: '`x-stainless-timeout` header',
              description: 'Specifies the CLI timeout window in seconds.'
            },
            stainlessLang: {
              label: '`x-stainless-lang` header',
              description: 'Reports the implementation language (js).'
            },
            stainlessPackage: {
              label: '`x-stainless-package-version` header',
              description: 'Provides the Claude CLI package version.'
            },
            stainlessOs: {
              label: '`x-stainless-os` header',
              description: 'Reports the operating system of the caller.'
            },
            stainlessArch: {
              label: '`x-stainless-arch` header',
              description: 'Reports the CPU architecture of the caller.'
            },
            stainlessRuntime: {
              label: '`x-stainless-runtime` header',
              description: 'Specifies the runtime environment (e.g. node).'
            },
            stainlessRuntimeVersion: {
              label: '`x-stainless-runtime-version` header',
              description: 'Specifies the runtime version number.'
            }
          }
        },
        card: {
          baseUrl: 'Base URL',
          defaultModelLabel: 'Default model',
          defaultModel: 'Default model: {{model}}',
          noDefault: 'No default model',
          modelsTitle: 'Supported models',
          noModels: 'No models configured yet.',
          authMode: 'Auth mode',
          providerDefault: 'Provider default',
          modelCount: '{{count}} models',
          passthrough: 'Pass-through'
        },
        drawer: {
          createTitle: 'Add Provider',
          editTitle: 'Edit Provider',
          quickStart: 'Quick setup',
          description: 'Configure base settings and model list.',
          formSummary: 'Current draft',
          modelsDescription: 'Maintain supported models.',
          defaultHint: 'Current default model: {{model}}',
          summary: {
            type: 'Provider type',
            auth: 'Authentication',
            models: 'Models',
            untitled: 'Untitled provider'
          },
          sections: {
            type: '1. Choose provider type',
            basic: '2. Basic information',
            auth: '3. Authentication',
            checklist: 'Pre-flight checks'
          },
          hints: {
            type: 'Start from a provider template to prefill the recommended Base URL.',
            basic: 'The ID is used by routing rules; the display name is used in the UI.',
            auth: 'Pick the header strategy expected by the upstream API.',
            customProvider: 'Custom compatible service',
            checkUrl: 'Make sure the Base URL points to the upstream API root.',
            checkAuth: 'Make sure the key matches the selected auth header mode.',
            checkModels: 'Add models if you want route suggestions and a default model.',
            advancedTitle: 'About advanced mode',
            advancedBody: 'Advanced mode lets you manage display names and model aliases separately. Keep the default sync if you only need a fast integration.'
          },
          fields: {
            id: 'Provider ID',
            idPlaceholder: 'e.g. openai',
            label: 'Display name',
            labelPlaceholder: 'e.g. OpenAI Official',
            baseUrl: 'Base URL',
            baseUrlPlaceholder: 'https://api.example.com/v1',
            type: 'Provider type',
            apiKey: 'API Key (optional)',
            apiKeyPlaceholder: 'Leave blank to read from environment',
            authMode: 'Authentication mode',
            authModeHint: 'Select the API authentication method and fill in the corresponding key.',
            authModeApiKey: 'X-API-Key',
            authModeProviderDefault: 'Provider default',
            authModeAuthToken: 'Authorization: Bearer',
            authModeXAuthToken: 'X-Auth-Token',
            models: 'Model configuration',
            showAdvanced: 'Show advanced options',
            hideAdvanced: 'Hide advanced options',
            addModel: 'Add model',
            modelId: 'Model ID',
            modelIdPlaceholder: 'e.g. claude-sonnet-4-5-20250929',
            modelLabel: 'Display name (optional)',
            modelLabelPlaceholder: 'e.g. GPT-4 Flagship',
            setDefault: 'Set as default',
            removeModel: 'Remove model'
          },
          errors: {
            idRequired: 'Provider ID is required',
            idDuplicate: 'Provider ID already exists',
            baseUrlInvalid: 'Invalid Base URL',
            modelsRequired: 'Configure at least one model',
            modelInvalid: 'Model IDs must be unique and non-empty',
            defaultInvalid: 'Default model must exist in the list'
          },
          toast: {
            saveFailure: 'Save failed: {{message}}'
          },
          noModelsTitle: 'Pass-through Mode Enabled',
          noModelsHint: 'No models are defined. This provider will run in pass-through mode—map routes in model routing or specify models directly in requests.',
          routeExample: 'Route Mapping Example:'
        },
        confirm: {
          delete: 'Remove provider “{{name}}”?'
        }
      },

      modelManagement: {
        title: 'Models & Routing',
        description: 'Configure providers, routing rules, and custom endpoints.',
        providersEyebrow: 'Supply Pool',
        header: {
          providersHelper: 'Maintain the upstream provider pool first, then move to Routing to map built-in and custom endpoints.',
          routingHelper: 'You are editing routing rules for "{{name}}" in a single focused workspace.'
        },
        guide: {
          title: 'Guided setup',
          subtitle: 'Separate upstream resources from public traffic entry points.',
          description: 'Configure providers first, then move to Routing to map /anthropic, /openai, and custom endpoints with focused context.',
          endpointBadge: '{{count}} routing workspaces',
          providersDescription: 'Manage Base URL, auth strategy, default model, and aliases. This layer only defines upstream resources.',
          providersMeta: '{{count}} providers configured',
          routingDescription: 'Control built-in endpoints, custom endpoints, presets, and validation policies. This layer decides how public traffic is routed.',
          routingMeta: '{{count}} workspaces, {{dirty}} unsaved',
          current: 'Current step',
          currentAction: 'Current page',
          openAction: 'Open'
        },
        overview: {
          synced: 'Workspace synced',
          unsavedCount: '{{count}} unsaved',
          providersStat: 'Providers',
          providersStatHint: 'Connected upstream supply pool',
          routeWorkspacesStat: 'Route workspaces',
          routeWorkspacesStatHint: 'System + custom endpoints',
          customEndpointsStat: 'Custom endpoints',
          customEndpointsStatHint: 'Additional public entry points',
          activeWorkspace: 'Active workspace',
          activeWorkspaceProvider: 'Provider inventory',
          activeWorkspaceRouting: 'Routing editor',
          providerAndSystem: 'Resources & system routing',
          providerPoolTag: 'Provider pool',
          systemEndpointTag: 'System endpoint',
          customEndpoints: 'Custom endpoints',
          customEndpointsHint: 'Keep custom endpoints in a compact horizontal strip so they remain easy to switch, edit, and remove.',
          headerWithCustom: 'Switch and maintain custom endpoints here to avoid squeezing the main workspace into a multi-column layout.',
          headerWithoutCustom: 'Set up providers and built-in routing first, then add custom endpoints when needed.',
          endpointPaths: 'Access paths',
          protocols: 'Protocol paths',
          endpointEnabled: 'Enabled',
          endpointDisabled: 'Disabled',
          endpointProtocols: '{{count}} protocol paths',
          endpointNoProtocol: 'No protocol path configured',
          endpointMorePaths: '{{count}} more paths',
          endpointManagedExternally: 'This endpoint cannot be removed from the UI.',
          routesEditorHint: 'Source model -> target provider:model',
          suggestionHint: 'Seed common source model names for this endpoint with one click.',
          resourceCardTitle: 'Provider supply pool',
          resourceCardDescription: 'Providers represent upstream model resources and authentication only; they are not public gateway entry points by themselves.',
          entryCardTitle: 'Endpoint entry layer',
          entryCardDescription: 'Anthropic, OpenAI, and custom endpoints are the actual public gateway entries. Routing rules and presets are scoped per endpoint.'
        },
        providersSemantics: {
          title: 'Maintain the provider pool first, then endpoint routing',
          description: 'This workspace defines upstream vendors, auth, and model inventory. Public traffic still enters through built-in or custom endpoints.'
        },
        tabs: {
          providers: 'Providers',
          providersDesc: 'Manage upstream providers and authentication.',
          anthropic: 'Anthropic Routing',
          anthropicDesc: 'Control mappings for the /anthropic endpoint.',
          openai: 'OpenAI Routing',
          openaiDesc: 'Control mappings for the /openai endpoint.',
          customEndpoint: 'Custom Endpoint'
        },
        addEndpoint: 'Add Endpoint',
        createEndpoint: 'Create Endpoint',
        editEndpoint: 'Edit Endpoint',
        deleteEndpointConfirm: 'Are you sure you want to delete endpoint "{{label}}"? This action cannot be undone.',
        deleteEndpointSuccess: 'Endpoint deleted successfully',
        deleteEndpointError: 'Failed to delete: {{error}}',
        createEndpointSuccess: 'Endpoint created successfully',
        createEndpointError: 'Failed to create: {{error}}',
        updateEndpointSuccess: 'Endpoint updated successfully',
        updateEndpointError: 'Failed to update: {{error}}',
        endpointValidationError: 'Please fill in all required fields',
        pathValidationError: 'Please fill in all path information',
        atLeastOnePath: 'At least one path is required',
        endpointId: 'Endpoint ID',
        endpointIdPlaceholder: 'e.g. custom-api',
        endpointIdHint: 'ID cannot be changed after creation, used for internal identification.',
        endpointLabel: 'Display Name',
        endpointLabelPlaceholder: 'e.g. My Custom API',
        endpointPath: 'Access Path',
        endpointPaths: 'Access Paths',
        endpointPathPlaceholder: 'e.g. /custom/api',
        endpointPathHint: 'Path must start with /. Changes take effect immediately.',
        endpointProtocol: 'Protocol Type',
        endpointEnabled: 'Enable this endpoint',
        endpointRoutingHint: 'After creation, you can configure routing rules in this endpoint\'s routing tab.',
        addPath: 'Add Path',
        removePath: 'Remove Path',
        protocolAnthropic: 'Anthropic Protocol',
        protocolOpenAI: 'OpenAI',
        protocolOpenAIChat: 'OpenAI Chat',
        protocolOpenAIResponses: 'OpenAI Responses',
        protocolHint: {
          anthropic: 'Anthropic Messages API protocol (/v1/messages)',
          'openai-auto': 'OpenAI protocol (supports Chat Completions and Responses APIs). Path must end with /v1/chat/completions or /v1/responses.',
          'openai-chat': 'OpenAI Chat Completions API protocol (/v1/chat/completions)',
          'openai-responses': 'OpenAI Responses API protocol (/v1/responses)'
        },
        actions: {
          saveRoutes: 'Save routes',
          unsaved: 'Unsaved changes',
          footerTitle: 'Route actions',
          footerDirtyHint: 'You changed the current rules. Save them here when you are ready.',
          footerSavedHint: 'The current routing rules are in sync with the server.'
        },
        routesEditorTitle: 'Routing rules',
        emptyRoutesHint: 'Use the buttons below to add your first route.',
        routing: {
          selectTarget: 'Select provider:model'
        },
        claudeValidation: {
          title: 'Anthropic request validation',
          description: 'Validate /anthropic payloads before forwarding. Use Anthropic strict for general schema checks, and Claude Code mode only when the client fully matches the Claude Code request shape.',
          modeLabel: 'Validation mode',
          options: {
            off: {
              label: 'Off',
              description: 'Disable request-body validation.'
            },
            'anthropic-strict': {
              label: 'Anthropic strict',
              description: 'Validate the base Anthropic Messages schema and reject unknown block types.'
            },
            'claude-code': {
              label: 'Claude Code',
              description: 'Keep the Claude Code-specific checks on top of Anthropic strict.'
            }
          }
        },
        toast: {
          routesSaved: 'Model routes updated successfully.',
          routesSaveFailure: 'Failed to save model routes: {{message}}',
          presetSaved: 'Preset "{{name}}" saved.',
          presetSaveFailure: 'Failed to save preset: {{message}}',
          presetApplySuccess: 'Applied preset "{{name}}".',
          presetApplyFailure: 'Failed to apply preset: {{message}}',
          presetDeleteSuccess: 'Preset "{{name}}" deleted.',
          presetDeleteFailure: 'Failed to delete preset: {{message}}',
          validationModeSaved: 'Anthropic request validation updated to: {{mode}}.',
          validationModeFailure: 'Failed to update request validation: {{message}}'
        },
        presets: {
          title: 'Routing presets',
          description: 'Capture the current Anthropic routing map and switch providers with one click.',
          namePlaceholder: 'Preset name, e.g. fox',
          save: 'Save preset',
          saving: 'Saving...',
          empty: 'No presets saved yet.',
          apply: 'Apply',
          applying: 'Applying...',
          delete: 'Delete',
          deleting: 'Deleting...',
          rulesCount: '{{count}} rules',
          noRules: 'Empty preset',
          previewTooltip: 'Hover to view routing rules',
          diffTitle: 'Confirm preset application',
          diffDescription: 'The following routes will be replaced with preset "{{name}}":',
          diffAdded: 'Added',
          diffRemoved: 'Removed',
          diffChanged: 'Changed',
          diffConfirm: 'Confirm',
          diffEmpty: 'Preset matches current configuration. No changes needed.'
        },
        validation: {
          presetName: 'Enter a preset name.',
          presetDuplicate: 'Preset {{name}} already exists.'
        },
        confirm: {
          deletePreset: 'Delete preset "{{name}}"?'
        }
      },
      events: {
        title: 'Security Events',
        description: 'Review validation defenses and system alerts to spot suspicious traffic.',
        filters: {
          title: 'Filters',
          allLevels: 'All severities',
          typePlaceholder: 'Filter by type (optional)'
        },
        actions: {
          newest: 'Newest',
          older: 'Older'
        },
        levels: {
          info: 'Info',
          warn: 'Warning',
          error: 'Error'
        },
        empty: {
          title: 'No events recorded',
          subtitle: 'No alerts or suspicious events have been recorded yet, which usually means things are healthy.',
          filteredTitle: 'No events match the current filters',
          filteredSubtitle: 'Reset the filters or inspect request logs for a broader view of traffic.',
          actions: {
            logs: 'Open request logs'
          }
        },
        details: 'View details',
        defaultTitle: 'Untitled event',
        defaultMessage: 'No additional description provided.',
        toast: {
          loadFailure: 'Failed to load events: {{message}}'
        }
      },
      settings: {
        title: 'Settings',
        description: 'Adjust gateway port, log retention, and runtime parameters.',
        toast: {
          loadFailure: 'Failed to load config: {{message}}',
          saveSuccess: 'Settings saved successfully.',
          saveFailure: 'Save failed: {{message}}',
          protocolRestartRequired: 'Configuration saved. Run cc-gw restart --daemon to apply protocol changes.',
          copySuccess: 'Config path copied to clipboard.',
          copyFailure: 'Copy failed: {{message}}',
          cleanupSuccess: '{{count}} old logs removed.',
          cleanupNone: 'No logs met the cleanup criteria.',
          cleanupFailure: 'Cleanup failed: {{message}}',
          clearAllSuccess: 'All logs cleared ({{logs}} requests, {{metrics}} daily rows).',
          clearAllFailure: 'Full wipe failed: {{message}}',
          missingConfig: 'Configuration not available. Refresh and try again.',
          authLoadFailure: 'Failed to load security settings: {{message}}'
        },
        sections: {
          basics: 'Basic configuration',
          routing: 'Model routing',
          configFile: 'Configuration file',
          cleanup: 'Log cleanup',
          security: 'Access security',
          protocol: 'Protocol Configuration',
          jump: 'Jump to'
        },
        overview: {
          title: 'Current snapshot',
          description: 'Confirm listening protocols, console protection, and config location before editing deeper settings.',
          unsavedCount: '{{count}} pending',
          cards: {
            protocols: 'Protocols',
            security: 'Console access',
            configFile: 'Config file'
          },
          values: {
            authEnabled: 'Sign-in required',
            authDisabled: 'Open access',
            httpOnly: 'HTTP only',
            httpsOnly: 'HTTPS only',
            httpAndHttps: 'HTTP + HTTPS'
          }
        },
        fields: {
          port: 'Listen port',
          host: 'Listen host (optional)',
          hostPlaceholder: 'Defaults to 127.0.0.1',
          retention: 'Log retention days',
          logExportTimeout: 'Log export timeout (seconds)',
          logExportTimeoutHint: 'Default is 60 seconds. Increase for larger exports. Range: 5-600 seconds.',
          bodyLimit: 'Request body limit (MB)',
          bodyLimitHint: 'Default is 10 MB. Increase this value if Claude Code /compact returns 413 errors.',
          defaults: 'Default models',
          storeRequestPayloads: 'Store request bodies',
          storeRequestPayloadsHint: 'Persist the client request body, and also the rewritten upstream request when protocol conversion happens.',
          storeResponsePayloads: 'Store response bodies',
          storeResponsePayloadsHint: 'Persist the client response body and, when applicable, the upstream response. Streamed responses are materialized into a complete offline message instead of raw chunks.',
          logLevel: 'Log level',
          logLevelOption: {
            fatal: 'Fatal',
            error: 'Error',
            warn: 'Warn',
            info: 'Info',
            debug: 'Debug',
            trace: 'Trace'
          },
          enableRoutingFallback: 'Enable routing fallback',
          enableRoutingFallbackHint: 'Automatically fall back to the first available model when no mapping matches. Disabled by default; enable only if you need legacy behavior.'
        },
        auth: {
          description: 'Require a username and password before accessing the Web UI. Model relay endpoints (/anthropic, /openai) remain publicly accessible.',
          enable: 'Enable Web UI sign-in',
          enableHint: 'Recommended for shared or production instances. The console and all /api/* routes will require authentication.',
          username: 'Username',
          usernamePlaceholder: 'Set the login username',
          password: 'Password',
          passwordPlaceholder: 'At least 6 characters',
          confirmPassword: 'Confirm password',
          confirmPasswordPlaceholder: 'Re-enter the password',
          status: 'Current status',
          statusEnabled: 'Sign-in protection enabled',
          statusDisabled: 'Sign-in protection disabled',
          passwordHintRequired: 'A new password (≥6 characters) is required when enabling auth or changing the username.',
          passwordHintOptional: 'Optional: set a new password. Leave blank to keep the current password.',
          actions: {
            save: 'Save security settings'
          },
          toast: {
            success: 'Security settings updated.',
            failure: 'Failed to save security settings: {{message}}'
          },
          validation: {
            username: 'Please enter a username',
            minLength: 'Password must be at least 6 characters',
            passwordRequired: 'Please provide a password',
            confirmMismatch: 'Passwords do not match'
          }
        },
        protocol: {
          description: 'Configure HTTP and HTTPS service ports (both protocols enabled by default)',
          restartWarning: '⚠️ Service restart required after modifying protocol configuration',
          restartHint: 'After saving, execute the following command to restart:',
          restartTip: '💡 Tip: Port, protocol enable status, and certificate paths require restart; Provider and routing configs support hot-reload',
          http: {
            enable: 'Enable HTTP',
            hint: 'Standard HTTP protocol, suitable for local development and internal networks',
            port: 'HTTP Port',
            host: 'HTTP Host'
          },
          https: {
            enable: 'Enable HTTPS',
            hint: 'HTTPS encrypted protocol',
            port: 'HTTPS Port',
            host: 'HTTPS Host',
            keyPath: 'Certificate Private Key Path',
            certPath: 'Certificate File Path',
            caPath: 'CA Certificate Path (Optional)',
            warning: '⚠️ About HTTPS Certificates',
            invalidCert: 'Self-signed certificates are invalid:',
            invalidCertDetail: 'Claude Code and most AI tools cannot trust self-signed certificates, causing connection failures.',
            recommended: 'Recommended:',
            recommendedDetail: 'For local development, use HTTP protocol (127.0.0.1 local access is secure).',
            tip: '💡 If HTTPS is required, use certificates from trusted CAs (e.g., Let\'s Encrypt) or configure a reverse proxy (e.g., Nginx/Caddy) to handle HTTPS.'
          }
        },
        validation: {
          port: 'Enter a port between 1 and 65535',
          retention: 'Retention days must be between 1 and 365',
          logExportTimeout: 'Log export timeout must be between 5 and 600 seconds',
          bodyLimit: 'Request body limit must be between 1 and 2048 MB',
          protocolRequired: 'Enable at least HTTP or HTTPS.',
          httpPort: 'HTTP port must be between 1 and 65535',
          httpsPort: 'HTTPS port must be between 1 and 65535',
          httpsCertificate: 'HTTPS is enabled but certificate paths are missing.',
          routePair: 'Fill both the source and target models.',
          routeDuplicate: 'A route for {{model}} already exists.'
        },
        defaults: {
          completion: 'Conversation: {{model}}',
          reasoning: 'Reasoning: {{model}}',
          background: 'Background: {{model}}',
          none: 'No defaults configured'
        },
        routing: {
          title: 'Model routing map',
          description: 'Override Claude Code model requests with provider:model targets (e.g., map Claude to Kimi). Leave empty to fall back to defaults.',
          titleByEndpoint: '{{endpoint}} routing',
          descriptionByEndpoint: {
            anthropic: 'Requests hitting the /anthropic endpoint will use these mappings.',
            openai: 'Requests hitting the /openai endpoint will use these mappings.'
          },
          wildcardHint: "Source model ids accept '*' wildcards (e.g. claude-*); the most specific match wins, and targets defined as providerId:* forward the original requested model name upstream.",
          add: 'Add route',
          empty: 'No custom routes configured. Default strategy will be used.',
          source: 'Source model',
          target: 'Target provider:model',
          sourceLabel: 'Source model',
          sourcePlaceholder: 'e.g. claude-sonnet-4-5-20250929',
          targetLabel: 'Target provider:model',
          targetPlaceholder: 'e.g. kimi:kimi-k2-0905-preview',
          customTargetOption: 'Custom target…',
          providerPassthroughOption: '{{provider}} · passthrough (*)',
          remove: 'Remove',
          suggested: 'Anthropic presets'
        },
        file: {
          description: 'Configuration is stored locally; edit the file for offline adjustments.',
          unknown: 'Unknown path'
        },
        cleanup: {
          description: 'Immediately purge logs older than the retention window.',
          softLabel: 'Routine action',
          softTitle: 'Clean up expired logs',
          softDescription: 'Deletes only logs older than the retention window. Suitable for normal maintenance.',
          confirmTitle: 'Clean up logs',
          confirmDescription: 'This deletes only logs older than the configured retention window and keeps recent records intact.',
          hardLabel: 'High-risk action',
          hardTitle: 'Clear all logs',
          clearAllTitle: 'Clear all logs',
          clearAll: 'Clear everything',
          clearingAll: 'Clearing…',
          confirmCleanup: 'This deletes only logs older than the configured retention window and keeps recent records intact.',
          confirmClearAll: 'This removes every request log and daily metric row. The operation cannot be undone.',
          clearAllWarning: 'Deletes every log entry and daily metric. This cannot be undone.'
        }
      },
      help: {
        title: 'Help & Guidance',
        intro: 'This page summarises how to configure cc-gw via the Web UI and how to operate it day to day.',
        note: 'Changes are written to ~/.cc-gw/config.json immediately. Prefer editing through the Web UI; use the CLI mainly to start or restart the daemon.',
        helper: 'Recommended order: start the service, add providers, create API keys, then connect Claude Code or Codex.',
        meta: {
          breadcrumb: 'Gateway / Help',
          guides: '{{count}} guides',
          faqCount: '{{count}} FAQs',
          recommendedFlow: 'Recommended Flow',
          claudeWorkflow: 'IDE / Desktop workflow',
          codexWorkflow: 'Terminal workflow'
        },
        clientConfig: {
          title: 'Client Configuration Guide',
          subtitle: 'Choose your client tool and follow the steps to configure'
        },
        advancedGuide: {
          title: 'Advanced Usage Guide',
          subtitle: 'Daily usage tips and best practices'
        },
        sections: {
          configuration: {
            title: '1. Initial Setup',
            items: [
              'Install the service and start it with `npm install -g @chenpu17/cc-gw && cc-gw start --daemon --port 4100`, then open http://127.0.0.1:4100/ui.',
              'Go to "Model Providers" to add upstream providers including base URL, API key, and default model.',
              'Generate Gateway API Keys (Optional): Create API keys on the "API Keys" page for different clients. By default, all requests can pass through the gateway.'
            ]
          },
          claudeCodeConfig: {
            title: '2. Claude Code Configuration',
            items: [
              'Configure environment variables:\n```bash\nexport ANTHROPIC_BASE_URL=http://127.0.0.1:4100/anthropic\nexport ANTHROPIC_API_KEY=sk-ant-oat01-8HEmUDacamV1...\n```\nAdd them to ~/.bashrc or ~/.zshrc and run `source ~/.bashrc` or `source ~/.zshrc` to apply.',
              'Plugin setup:\n- In Claude Code plugin settings, select "Custom API"\n- Base URL: `http://127.0.0.1:4100/anthropic`\n- API Key: Use your actual API key (e.g., `sk-ant-oat01-8HEmUDacamV1...`)',
              'Quick verification:\n```bash\nclaude "Hello, please respond briefly"\n```\nSuccessful response indicates proper configuration. Check the "Request Logs" page to see the request.'
            ]
          },
          codexConfig: {
            title: '3. Codex CLI Configuration',
            items: [
              'Edit configuration file in `~/.codex/config.toml`:\n```toml\nmodel = "gpt-5-codex"\nmodel_provider = "cc_gw"\nmodel_reasoning_effort = "high"\ndisable_response_storage = true\n\n[model_providers.cc_gw]\nname = "cc_gw"\nbase_url = "http://127.0.0.1:4100/openai/v1"\nwire_api = "responses"\nenv_key = "cc_gw_key"\n```',
              'Set environment variable:\n```bash\nexport cc_gw_key=sk-ant.....\n```\nAdd to ~/.bashrc or ~/.zshrc and run `source` to apply.',
              'Verify configuration:\n```bash\ncodex status  # Check connection status\ncodex ask "Hello, please introduce yourself"  # Test conversation\ncodex chat  # Enter interactive mode\n```\nSuccessful responses indicate proper setup.'
            ]
          },
          usage: {
            title: '4. Daily Usage',
            items: [
              'Use the dashboard to keep an eye on request volume, token usage, cache hits, and TTFT/TPOT trends.',
              '“Request Logs” provides rich filters plus separated client/upstream payload blocks, which makes protocol-rewrite debugging much easier.',
              'Use “Routing” to switch mappings and presets without redeploying IDE extensions or automation scripts.',
              '“Settings” controls log retention, payload storage, and runtime parameters to suit your operations.'
            ]
          },
          tips: {
            title: '5. Practical Tips',
            items: [
              'Use **direnv** to manage environment variables — create a .envrc file for automatic configuration loading.',
              '🔌 **Custom Endpoints**: Create additional API endpoints with different protocols and independent routing. Manage them from the "Routing" page.\n\n**Key Features**:\n• Configure only the base path (e.g., `/my-endpoint`), the system automatically registers full API paths based on protocol\n• Support for Anthropic and OpenAI protocols (Chat Completions / Responses API)\n• Each endpoint can have independent model routing rules\n• One endpoint can register multiple paths with different protocols\n\n**Example Configuration**:\n```json\n{\n  "id": "claude-api",\n  "label": "Claude Dedicated Endpoint",\n  "path": "/claude",\n  "protocol": "anthropic"\n}\n```\nAfter configuration, clients access via `http://127.0.0.1:4100/claude/v1/messages` (path auto-expansion).',
              'Enable "Store request bodies" / "Store response bodies" to inspect and copy client-side and upstream payloads from the log drawer when troubleshooting.',
              'If you do not need payload-level troubleshooting, turn off payload storage to reduce local disk usage and privacy exposure.',
              'Use **routing presets** to save common routing configurations and quickly switch between different provider setups.',
              'If you edit ~/.cc-gw/config.json manually, refresh the Settings page or restart cc-gw so the UI reflects the latest configuration.'
            ]
          }
        },
        faq: {
          title: 'Frequently asked questions',
          items: [
            {
              q: 'How can I change the default model for each endpoint?',
              a: 'Go to "Routing" and edit the routing workspace for /anthropic or /openai. Saving applies the change right away.'
            },
            {
              q: 'How do I use custom endpoints?',
              a: 'Create a custom endpoint in the "Routing" page by configuring a base path (e.g., `/my-endpoint`) and protocol type. The system automatically registers full API paths based on the protocol. For example, after configuring `/claude` + `anthropic` protocol, clients access via `http://127.0.0.1:4100/claude/v1/messages`.\n\nIf you encounter 404 errors, check:\n1) Is the endpoint enabled?\n2) Are clients using the complete path (including protocol subpath)?\n3) Check server logs to confirm route registration'
            },
            {
              q: 'Why are cached token numbers missing?',
              a: 'Upstream providers must return cached_tokens or input_tokens_details.cached_tokens. Enable cache metrics on the provider if supported.'
            },
            {
              q: 'How can I use different models for different clients?',
              a: 'Create separate API keys for each client and configure different routing rules in "Routing". You can also create dedicated custom endpoints for different clients.'
            }
          ]
        }
      },
      routingManagement: {
        title: 'Routing',
        description: 'Manage endpoint-specific mappings, presets, and custom entry points without mixing them into the provider inventory.',
        eyebrow: 'Traffic Entry'
      },

      apiKeys: {
        title: 'API Keys Management',
        description: 'Create and manage API keys for gateway access',
        helper: 'Use separate keys for each client, environment, or automation task so you can audit, restrict, and revoke access cleanly.',
        createNew: 'Create New Key',
        createAction: 'Create',
        createDescription: 'Create a new API key for authentication and optionally add a description.',
        descriptionLabel: 'Key description (optional)',
        keyDescriptionPlaceholder: 'e.g. Internal staging access only',
        keyNamePlaceholder: 'Enter key name',
        keyCreated: 'API Key Created',
        saveKeyWarning: 'Keep this key secure. You can also reveal the full key anytime from the key list.',
        wildcard: 'Any Key',
        wildcardHint: 'When enabled, any custom key — including an empty key — is accepted. Disable this key to enforce strict authentication.',
        status: {
          enabled: 'Enabled',
          disabled: 'Disabled'
        },
        actions: {
          enable: 'Enable',
          disable: 'Disable',
          delete: 'Delete',
          reveal: 'Reveal key',
          hide: 'Hide key'
        },
        created: 'Created',
        lastUsed: 'Last Used',
        requestCount: 'Requests',
        totalTokens: 'Total Tokens',
        deleteDialogTitle: 'Delete API key',
        confirmDelete: 'Are you sure you want to delete this API key? This action cannot be undone.',
        errors: {
          nameRequired: 'Key name is required'
        },
        analytics: {
          title: 'Key Usage Analytics',
          description: 'Highlights for the past {{days}} days of API key activity',
          range: {
            today: 'Today',
            week: 'Last 7 days',
            month: 'Last 30 days'
          },
          cards: {
            total: 'Total keys',
            enabled: 'Enabled keys',
            active: 'Active keys ({{days}} days)'
          },
          charts: {
            requests: 'Top 10 keys by request count',
            tokens: 'Top 10 keys by token usage'
          },
          tokens: {
            input: 'Input tokens',
            output: 'Output tokens'
          },
          requestsSeries: 'Requests',
          empty: 'No activity for the selected range.',
          emptyHint: 'Create and use at least one key, then charts will fill in as real traffic arrives.',
          actions: {
            logs: 'Open request logs'
          },
          unknownKey: 'Unknown key'
        },
        quickStart: {
          title: 'Recommended workflow',
          description: 'Start with separate keys per client, then tighten endpoint access as needed.',
          create: {
            title: 'Split keys by client',
            description: 'Create different keys for Claude Code, Codex, CI, or staging so logs stay easy to trace.'
          },
          restrict: {
            title: 'Restrict endpoint access',
            description: 'Limit keys to Anthropic, OpenAI, or custom endpoints when you want tighter isolation.'
          },
          wildcard: {
            title: 'Use wildcard sparingly',
            description: 'Wildcard access is convenient for migration, but named keys are safer for production.'
          }
        },
        list: {
          title: 'Key Inventory',
          emptyTitle: 'Create your first API key',
          empty: 'No API keys found. Use the button above to create one.',
          emptyFilteredTitle: 'No keys match the current filters',
          emptyFiltered: 'No API keys match the current filters.'
        },
        filters: {
          searchPlaceholder: 'Search by name, description, or endpoint',
          all: 'All',
          enabled: 'Enabled',
          disabled: 'Disabled'
        },
        summary: {
          totalCount: '{{count}} keys',
          wildcard: 'Wildcard keys: {{count}}',
          restricted: 'Restricted keys: {{count}}',
          unrestricted: 'Unrestricted keys: {{count}}'
        },
        views: {
          cards: 'Cards',
          compact: 'Compact list'
        },
        table: {
          name: 'Key',
          access: 'Access',
          actions: 'Actions',
          accessWildcard: 'Wildcard access',
          accessOpen: 'All endpoints'
        },
        toast: {
          keyCreated: 'API key created successfully',
          keyUpdated: 'API key updated successfully',
          keyDeleted: 'API key deleted successfully',
          keyCopied: 'Key copied to clipboard',
          createFailure: 'Failed to create: {{message}}',
          updateFailure: 'Failed to update: {{message}}',
          deleteFailure: 'Failed to delete: {{message}}',
          revealFailure: 'Failed to reveal key',
          copyFailure: 'Failed to copy'
        },
        allowedEndpoints: 'Allowed Endpoints',
        allEndpoints: 'All endpoints (unrestricted)',
        editEndpoints: 'Edit Endpoint Access',
        endpointRestricted: 'Restricted',
        selectEndpoints: 'Select which endpoints this key can access. Leave empty to allow all.',
        maxConcurrency: 'Max Concurrency',
        maxConcurrencyPlaceholder: 'Leave empty for unlimited',
        maxConcurrencyHelper: 'Set the maximum number of simultaneous requests for this key. Leave empty or set to 0 for unlimited.'
      },

      about: {
        title: 'About',
        description: 'Review cc-gw version details, build metadata, and current runtime status.',
        app: {
          title: 'Application',
          subtitle: 'Gateway build metadata at a glance.',
          labels: {
            name: 'Name',
            version: 'Version',
            buildTime: 'Build time',
            runtime: 'Backend runtime',
            backendVersion: 'Backend version'
          },
          hint: {
            buildTime: 'Timestamps are recorded in UTC so you can trace deployments easily.'
          }
        },
        status: {
          title: 'Runtime status',
          subtitle: 'Live metrics reported by the running gateway.',
          loading: 'Fetching status...',
          empty: 'Unable to retrieve status information.',
          labels: {
            host: 'Listen host',
            port: 'Listen port',
            providers: 'Providers configured',
            active: 'Active requests',
            platform: 'Platform',
            pid: 'Process PID'
          },
          hint: {
            active: 'Active request totals refresh roughly every minute.'
          }
        },
        support: {
          title: 'Operational notes',
          subtitle: 'Maintenance guidance',
          description: 'Manage providers, routing, and logs in the Web UI; advanced settings live in ~/.cc-gw/config.json.',
          tip: 'Consider keeping ~/.cc-gw/config.json under version control or managing it via automation scripts.',
          actions: {
            checkUpdates: 'Check for updates',
            checkingUpdates: 'Checking...'
          }
        },
        update: {
          available: 'Update available: v{{version}}',
          current: 'You are on the latest version: v{{version}}',
          channel: 'Channel: {{channel}}'
        },
        toast: {
          statusError: {
            title: 'Failed to load status'
          },
          upToDate: {
            title: 'You are on the latest version: v{{version}}',
            description: 'No newer release was found on npm.'
          },
          updateAvailable: {
            title: 'Update available: v{{version}}',
            description: 'Upgrade with npm install -g {{packageName}}.'
          },
          updateError: {
            title: 'Failed to check for updates'
          }
        }
      },
      endpoints: {
        title: 'Custom Endpoints',
        description: 'Manage custom API endpoints with multiple protocol support.',
        createButton: 'Add Endpoint',
        createTitle: 'Create Endpoint',
        editTitle: 'Edit Endpoint',
        emptyTitle: 'No custom endpoints',
        emptyDescription: 'Click "Add Endpoint" to create your first custom endpoint.',
        loadError: 'Failed to load endpoints',
        id: 'ID',
        path: 'Path',
        disabled: 'Disabled',
        hasRouting: 'Routing configured',
        protocols: {
          anthropic: 'Anthropic Protocol',
          'openai-chat': 'OpenAI Chat',
          'openai-responses': 'OpenAI Responses'
        },
        protocolHints: {
          anthropic: 'Anthropic Messages API protocol (/v1/messages)',
          'openai-chat': 'OpenAI Chat Completions API protocol (/v1/chat/completions)',
          'openai-responses': 'OpenAI Responses API protocol (/v1/responses)'
        },
        form: {
          id: 'Endpoint ID',
          idPlaceholder: 'e.g. custom-api',
          idHint: 'ID cannot be changed after creation, used for internal identification.',
          label: 'Display Name',
          labelPlaceholder: 'e.g. My Custom API',
          path: 'Access Path',
          pathPlaceholder: 'e.g. /custom/api',
          pathHint: 'Path must start with /. Changes take effect immediately.',
          protocol: 'Protocol Type',
          enabled: 'Enable this endpoint'
        },
        routing: {
          title: 'Routing Configuration (Optional)',
          modelRoutes: 'Model Routing Rules',
          addRoute: 'Add Rule',
          noRoutes: 'No routing rules',
          sourceModelPlaceholder: 'Source model (e.g. claude-3-5-sonnet-20241022)',
          targetPlaceholder: 'Target (e.g. anthropic:claude-3-5-sonnet-20241022)',
          modelRoutesHint: 'Format: source model → provider:model, wildcards supported (e.g. gpt-* → openai:*)',
          defaults: 'Default Model Configuration',
          defaultCompletion: 'Default for completion tasks',
          defaultReasoning: 'Default for reasoning tasks',
          defaultBackground: 'Default for background tasks',
          longContextThreshold: 'Long context threshold (tokens)',
          defaultPlaceholder: 'e.g. anthropic:claude-3-5-sonnet-20241022'
        },
        createSuccess: 'Endpoint created successfully',
        createError: 'Failed to create: {{error}}',
        updateSuccess: 'Endpoint updated successfully',
        updateError: 'Failed to update: {{error}}',
        deleteSuccess: 'Endpoint deleted successfully',
        deleteError: 'Failed to delete: {{error}}',
        deleteConfirm: 'Are you sure you want to delete endpoint "{{label}}"? This action cannot be undone.',
        validationError: 'Please fill in all required fields'
      },
      profiler: {
        title: 'Profiler',
        eyebrow: 'Session Profiler',
        breadcrumb: 'Gateway / Profiler',
        description: 'Record and analyze LLM session latency and token usage.',
        sessionsTitle: 'Sessions',
        sessionsCount: '{{count}} sessions',
        searchPlaceholder: 'Search sessions...',
        loadingSession: 'Loading session...',
        sessionSummary: '{{turns}} turns · {{duration}} · {{tokens}} tokens',
        metricTurns: '{{count}} turns',
        metricTokens: '{{value}} tok',
        tabs: {
          timeline: 'Timeline',
          breakdown: 'Breakdown'
        },
        status: {
          recording: 'Recording',
          idle: 'Not Recording'
        },
        actions: {
          start: 'Start Recording',
          stop: 'Stop Recording',
          export: 'Export',
          clear: 'Clear'
        },
        timeline: {
          summary: 'Compressed overview · idle gaps folded · wraps as turns grow',
          mode: 'Mode:',
          compressed: 'Compressed',
          sessionDuration: 'Session {{duration}}',
          start: 'start',
          startAt: 'start {{time}}s',
          tools: 'Tools',
          legend: {
            totalLatency: 'Total latency',
            firstToken: 'First token (TTFT)',
            toolExecuting: 'Tool executing',
            selectedTurn: 'Selected turn'
          }
        },
        turn: {
          title: 'Turn {{index}}',
          previous: 'Previous turn',
          next: 'Next turn'
        },
        payload: {
          request: 'Request',
          response: 'Response',
          toolCalls: 'Tool Calls',
          empty: '(empty)',
          emptyRequest: '(empty request)',
          emptyResponse: '(empty response)',
          noToolCalls: '(no tool calls)'
        },
        breakdown: {
          total: 'Total {{value}}',
          toolCallsCount: '{{count}} tool calls',
          error: 'Error',
          turnMetrics: 'Turn Metrics',
          duration: 'Duration',
          status: 'Status',
          input: 'Input',
          output: 'Output',
          totalDuration: 'Total Duration',
          llmTime: 'LLM Time',
          avgTtft: 'Avg TTFT',
          avgTpot: 'Avg TPOT',
          inputTokens: 'Input Tokens',
          outputTokens: 'Output Tokens',
          turnsSub: '{{count}} turns',
          sessionShare: '{{value}}% of session',
          perTurnTitle: 'Per-Turn Breakdown',
          perTurnDescription: 'Expand a turn to inspect request, response, tool calls, and errors.'
        },
        empty: {
          waitingTitle: 'Waiting for requests…',
          waitingDescription: 'Requests with session_id will appear here.',
          idleTitle: 'No sessions',
          idleDescription: 'Start recording to capture LLM sessions.',
          noTurnsTitle: 'No turns recorded',
          noTurnsDescription: 'The session exists, but no turn-level payloads have been captured yet.',
          selectTitle: 'Select a session',
          selectDescription: 'Choose a session from the left to inspect its timeline, message payloads, and stats.',
          actions: {
            logs: 'Open request logs'
          }
        },
        errors: {
          loadFailed: 'Failed to load session',
          notFound: 'Session not found'
        },
        relativeTime: {
          justNow: 'just now',
          minutesAgo: '{{count}} min ago',
          hoursAgo: '{{count}} hr ago',
          daysAgo: '{{count}} days ago'
        }
      }
    }
  }
}

function resolveInitialLanguage(): 'zh' | 'en' {
  if (typeof window === 'undefined') {
    return 'zh'
  }

  const stored = window.localStorage.getItem(storageKeys.language)
  if (stored === 'zh' || stored === 'en') {
    return stored
  }

  return 'zh'
}

function persistLanguage(language: string) {
  if (typeof window === 'undefined') {
    return
  }

  const normalized = language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  window.localStorage.setItem(storageKeys.language, normalized)
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    lng: resolveInitialLanguage(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  })

  i18n.on('languageChanged', persistLanguage)
  persistLanguage(i18n.language)
}

export default i18n
