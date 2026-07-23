export default {
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
}
