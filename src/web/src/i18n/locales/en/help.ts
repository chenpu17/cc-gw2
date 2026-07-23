export default {
  title: 'Help & Guidance',
  intro: 'This page summarises how to configure cc-gw via the Web UI and how to operate it day to day.',
  note: 'Changes are written to ~/.cc-gw/config.json immediately. Prefer editing through the Web UI; use the CLI mainly to start or restart the daemon.',
  helper: 'Recommended order: start the service, configure providers and models, verify connectivity, configure routing, create API keys if needed, then connect Claude Code or Codex.',
  meta: {
    breadcrumb: 'Gateway / Help',
    guides: '{{count}} guides',
    faqCount: '{{count}} FAQs',
    recommendedFlow: 'Recommended Flow',
    claudeWorkflow: 'IDE / Desktop workflow',
    codexWorkflow: 'Terminal workflow',
    tocTitle: 'On this page'
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
    consoleTour: {
      title: '🧭 Console Tour',
      items: [
        '**Dashboard**: Live view of request volume, token usage, cache-hit ratio, and TTFT / TPOT latency. Filter by endpoint (`/anthropic`, `/openai`, or custom).',
        '**Request Logs**: Paginated request metadata. The detail drawer shows client ↔ upstream payloads side by side, ideal for debugging protocol rewrites. Enable “Store request/response bodies” in Settings to capture full payloads.',
        '**Model Providers**: Manage upstream Providers (Base URL, auth, model list). Providers form the resource pool — they are not exposed publicly without routing.',
        '**Routing**: Map the model name a client requests to a concrete `providerId:modelId`. Each endpoint (`/anthropic`, `/openai`, custom) has its own independent routing workspace.',
        '**API Keys**: Issue keys per client / environment / automation task for auditing, scoping and revocation. The default wildcard key, when enabled, accepts any key.',
        '**Events**: Gateway-level system event stream (startup, config changes, security alerts) for auditing and incident review.',
        '**Settings**: Adjust port, log retention, payload storage, cleanup, and Web UI login protection.'
      ]
    },
    configuration: {
      title: '1. Initial Setup',
      items: [
        'Install the service and start it with `npm install -g @chenpu17/cc-gw && cc-gw start --daemon --port 4100`, then open http://127.0.0.1:4100/ui.',
        'Configure providers and models: Go to "Model Providers", add at least one Provider, configure Base URL, auth mode/API key, and add at least one model or default model. Providers are only the upstream resource pool; public traffic still needs routing.',
        'Test provider connectivity: After a model list or default model exists, use the test button to verify the Base URL, API key, and model. If the UI says no model is configured, add a model under that Provider first.',
        'Configure model routing: Open "Routing", choose `/anthropic`, `/openai`, or a custom endpoint, then map the client-requested model name to target model `providerId:modelId`; use `providerId:*` to pass the original client model name through to that provider. Saving only updates the current endpoint.',
        'Generate Gateway API Keys (Optional): Create API keys on the "API Keys" page for auditing, client separation, and future revocation. By default, all requests can pass through the gateway.'
      ]
    },
    claudeCodeConfig: {
      title: '2. Claude Code Configuration',
      items: [
        'Set environment variables (recommended):\n```bash\nexport ANTHROPIC_BASE_URL=http://127.0.0.1:4100/anthropic\nexport ANTHROPIC_API_KEY=sk-ant-oat01-8HEmUDacamV1...\n```\nAdd them to `~/.bashrc` or `~/.zshrc` and run `source ~/.bashrc` / `source ~/.zshrc`. Claude Code reads these variables on startup and routes through cc-gw.',
        'Which API key to use: If you have enabled API key restrictions in cc-gw, use a key created on the "API Keys" page. If not (the default wildcard key is still enabled), any non-empty placeholder string works.',
        'Quick verification:\n```bash\nclaude "Hello, please respond briefly"\n```\nA successful reply means the gateway is wired up — check "Request Logs" to see the request.'
      ]
    },
    codexConfig: {
      title: '3. Codex CLI Configuration',
      items: [
        'Edit configuration file in `~/.codex/config.toml`:\n```toml\nmodel = "gpt-5-codex"\nmodel_provider = "cc_gw"\nmodel_reasoning_effort = "high"\ndisable_response_storage = true\n\n[model_providers.cc_gw]\nname = "cc_gw"\nbase_url = "http://127.0.0.1:4100/openai/v1"\nwire_api = "responses"\nenv_key = "cc_gw_key"\n```',
        'Set environment variable:\n```bash\nexport cc_gw_key=sk-ant.....\n```\nAdd to `~/.bashrc` or `~/.zshrc` and run `source` to apply. The variable name must match `env_key` in config.toml.',
        'Verify configuration:\n```bash\ncodex status  # Check connection status\ncodex ask "Hello, please introduce yourself"  # Test conversation\ncodex chat  # Enter interactive mode\n```\nSuccessful responses indicate proper setup.'
      ]
    },
    usage: {
      title: '4. Daily Usage',
      items: [
        'Use the dashboard to keep an eye on request volume, token usage, cache hits, and TTFT/TPOT trends — filterable by endpoint.',
        '“Request Logs” provides rich filters plus separated client/upstream payload blocks, which makes protocol-rewrite debugging much easier.',
        'Use “Routing” to maintain model mappings per endpoint. Built-in `/anthropic` and `/openai` have separate routing workspaces, and each custom endpoint keeps its own routing rules.',
        '“Settings” controls log retention, payload storage, and runtime parameters to suit your operations.',
        '🔬 **Session timeline analysis**: On the "Performance Analysis" page, click "Start Recording" and then have your client send requests. Each session is parsed into an Agent–LLM–Tools sequence diagram, so you can see tool-call order, TTFT, and per-turn latency at a glance.',
        '🔐 **Security hardening**: Enable Web UI login protection with a username and password to keep the admin interface secure.'
      ]
    },
    tips: {
      title: '5. Practical Tips',
      items: [
        'Use **direnv** to manage environment variables — create a .envrc file for automatic configuration loading.',
        '🔌 **Custom Endpoints**: Create additional API endpoints with different protocols and independent routing. Manage them from the "Routing" page.\n\n**Key Features**:\n• Configure only the base path (e.g., `/my-endpoint`), the system automatically registers full API paths based on protocol\n• Support for Anthropic and OpenAI protocols (Chat Completions / Responses API)\n• Each endpoint can have independent model routing rules\n• One endpoint can register multiple paths with different protocols\n\n**Example Configuration**:\n```json\n{\n  "id": "claude-api",\n  "label": "Claude Dedicated Endpoint",\n  "path": "/claude",\n  "protocol": "anthropic"\n}\n```\nAfter configuration, clients access via `http://127.0.0.1:4100/claude/v1/messages` (path auto-expansion).',
        'Enable "Store request bodies" / "Store response bodies" to inspect and copy client-side and upstream payloads from the log drawer when troubleshooting.',
        'If you do not need payload-level troubleshooting, turn off payload storage to reduce local disk usage and privacy exposure.',
        'Use **routing presets** to save common mapping schemes, such as "Claude models through Anthropic" or "GPT models through an OpenAI-compatible provider", then apply them per endpoint when switching providers.',
        'If you edit `~/.cc-gw/config.json` manually, refresh the Settings page or restart cc-gw so the UI reflects the latest configuration.',
        '🗃️ **Data backup**: Regularly back up the `~/.cc-gw/` directory — it holds config.json, the SQLite database, and logs.',
        '🧹 **Log cleanup**: Adjust the log retention days to your needs, or use the cleanup tools on the "Settings" page to compact the database manually.'
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
        q: 'Why does provider testing say no model is configured?',
        a: 'Provider settings store Base URL and authentication, but the test request still needs a concrete model. Add at least one model under that Provider, or set a default model, then test again.'
      },
      {
        q: 'When do I need model routing?',
        a: 'Configure routing when the client model name differs from the upstream model name, when `/anthropic` and `/openai` should go to different providers, or when different clients need different provider mappings. Target models use `providerId:modelId`; `providerId:*` passes the original client model name through to that provider.'
      },
      {
        q: 'Why are cached token numbers missing?',
        a: 'Upstream providers must return `cached_tokens` or `input_tokens_details.cached_tokens`. Enable cache metrics on the provider if supported.'
      },
      {
        q: 'How can I use different models for different clients?',
        a: 'The recommended approach is to create dedicated custom endpoints for different clients and maintain independent routing rules per endpoint. You can also point clients at `/anthropic`, `/openai`, or custom Base URLs. API keys are mainly for auditing, source separation, and revocation; they do not carry separate routing rules by themselves.'
      },
      {
        q: 'How do I enable login protection for the Web UI?',
        a: 'Go to "Settings → Security", turn on login protection, and set a username and password. After saving, the next visit to `/ui` will require credentials. When login is disabled, the console is open to anyone who can reach the port — enable it for shared or public deployments.'
      },
      {
        q: 'How does Codex CLI connect to cc-gw?',
        a: 'Edit `~/.codex/config.toml`: set `model_provider` to "cc_gw", point `base_url` at the cc-gw OpenAI-compatible endpoint, and configure the matching environment variable. See the Codex CLI Configuration section above for the full example.'
      },
      {
        q: 'How do I back up and migrate my configuration?',
        a: 'Back up the entire `~/.cc-gw/` directory, which contains config.json, the database, and log files. To migrate, restore the directory on the new machine and restart the service.'
      },
      {
        q: 'What should I do if the Web UI shows a 404 error?',
        a: 'Make sure the Web UI has been built with `pnpm --filter @cc-gw/web build`, or use the npm-installed global version. Also check the static asset path reported in the service startup logs.'
      }
    ]
  }
}
