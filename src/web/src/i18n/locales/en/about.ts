export default {
  title: 'About',
  description: 'Review cc-gw version details, build metadata, and current runtime status.',
  gateway: {
    address: 'Gateway address'
  },
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
  upgrade: {
    action: 'Upgrade now',
    viewProgress: 'View progress',
    autoHint: 'The one-click upgrade installs the new version from npm and restarts the gateway automatically.',
    manualHint: 'This installation cannot be upgraded from the Web UI. Run the following in a terminal:',
    copyCommand: 'Copy command',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    reason: {
      unknown: 'Automatic upgrades are not supported for this setup.',
      foreground: 'The service runs in the foreground and cannot restart itself.',
      'not-launched-by-cli': 'The service was not launched by the cc-gw CLI, so it cannot upgrade itself.',
      npx: 'Running through npx is temporary and cannot self-upgrade.',
      'local-build': 'A local source build cannot be upgraded through npm.',
      'not-writable': 'The global npm directory is not writable; run the command manually.',
      'package-manager': 'Automatic upgrades on Windows require a global npm install; run the command manually.'
    },
    confirm: {
      title: 'Upgrade to v{{version}}?',
      description: 'This installs the new version from npm and restarts the gateway service.',
      warning: 'The gateway will briefly stop serving requests during the upgrade (typically 10–30 seconds; on Windows the install runs while stopped, so it can take longer). In-flight requests may fail and new requests will receive 503 for a short time; avoid critical calls while it runs.',
      activeRequests: 'Requests currently in flight: {{count}}',
      activeHint: 'The upgrade waits for these requests to finish (up to ~15 seconds) before forcing a restart.',
      ack: 'I understand the upgrade briefly interrupts service',
      cancel: 'Cancel',
      confirm: 'Upgrade',
      starting: 'Starting...'
    },
    progress: {
      title: 'Upgrading cc-gw',
      description: 'Keep this page open; the connection drops briefly while the service restarts.',
      fromTo: 'v{{from}} → v{{to}}',
      phases: {
        preparing: 'Preparing the upgrade…',
        installing: 'Installing v{{version}} from npm…',
        draining: 'Waiting for in-flight requests to finish…',
        starting: 'Starting the new version…',
        verifying: 'Verifying the new version…'
      },
      drainingHint: 'Requests still in flight: {{count}}. The service restarts forcibly after the timeout.',
      reconnecting: 'Waiting for the service to restart and reconnect…',
      reconnectingHint: 'The gateway is restarting; this page updates automatically once it is back.',
      success: 'Upgraded to v{{version}}; the service is back.',
      successHint: 'If Web access is password-protected, you must sign in again after reloading.',
      reload: 'Reload page',
      close: 'Close',
      background: 'Close window (upgrade continues)',
      failedPhase: 'Upgrade failed',
      failedHint: 'The upgrade did not finish; the service may still be running the old version.',
      rolledBack: 'Automatically rolled back to v{{version}}.',
      logPath: 'Upgrade log: {{path}}',
      manualHint: 'Or run the upgrade manually in a terminal:',
      stale: 'The upgrade state has not changed for over 10 minutes (the helper may have exited). Check the service or upgrade manually.',
      authRequired: 'The service restarted and your session expired. Reload the page and sign in again.',
      retry: 'Retry upgrade'
    },
    toast: {
      startFailed: 'Failed to start the upgrade'
    }
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
      description: 'Upgrade from this page, or run npm install -g {{packageName}}.',
      descriptionAuto: 'Upgrade from this page; the service restarts automatically after a brief interruption.'
    },
    updateError: {
      title: 'Failed to check for updates'
    }
  }
}
