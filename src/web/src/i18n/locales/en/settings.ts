export default {
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
    compactSuccess: {
      title: 'Database compact completed',
      desc: 'Free pages were reclaimed. Refresh later to confirm the new size.'
    },
    compactFailure: 'Database compact failed: {{message}}',
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
    add: 'Add route',
    sourcePlaceholder: 'e.g. claude-sonnet-4-5-20250929',
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
    clearAllWarning: 'Deletes every log entry and daily metric. This cannot be undone.',
    dbSizeLabel: 'Database size',
    compactTitle: 'Compact database',
    compactDescription: 'Reclaims free pages left by deleted logs and shrinks the database file. No data is deleted.'
  }
}
