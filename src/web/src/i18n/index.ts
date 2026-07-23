import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { storageKeys } from '@/services/storageKeys'

import zhApp from './locales/zh/app'
import zhNav from './locales/zh/nav'
import zhLanguage from './locales/zh/language'
import zhCommon from './locales/zh/common'
import zhLogin from './locales/zh/login'
import zhDashboard from './locales/zh/dashboard'
import zhLogs from './locales/zh/logs'
import zhProviders from './locales/zh/providers'
import zhModelManagement from './locales/zh/modelManagement'
import zhRoutingManagement from './locales/zh/routingManagement'
import zhEvents from './locales/zh/events'
import zhSettings from './locales/zh/settings'
import zhHelp from './locales/zh/help'
import zhAbout from './locales/zh/about'
import zhApiKeys from './locales/zh/apiKeys'
import zhEndpoints from './locales/zh/endpoints'
import zhWorkbench from './locales/zh/workbench'
import zhSetup from './locales/zh/setup'

import enApp from './locales/en/app'
import enNav from './locales/en/nav'
import enLanguage from './locales/en/language'
import enCommon from './locales/en/common'
import enLogin from './locales/en/login'
import enDashboard from './locales/en/dashboard'
import enLogs from './locales/en/logs'
import enProviders from './locales/en/providers'
import enModelManagement from './locales/en/modelManagement'
import enRoutingManagement from './locales/en/routingManagement'
import enEvents from './locales/en/events'
import enSettings from './locales/en/settings'
import enHelp from './locales/en/help'
import enAbout from './locales/en/about'
import enApiKeys from './locales/en/apiKeys'
import enEndpoints from './locales/en/endpoints'
import enWorkbench from './locales/en/workbench'
import enSetup from './locales/en/setup'

const resources = {
  zh: {
    translation: {
      app: zhApp,
      nav: zhNav,
      language: zhLanguage,
      common: zhCommon,
      login: zhLogin,
      dashboard: zhDashboard,
      logs: zhLogs,
      providers: zhProviders,
      modelManagement: zhModelManagement,
      routingManagement: zhRoutingManagement,
      events: zhEvents,
      settings: zhSettings,
      help: zhHelp,
      about: zhAbout,
      apiKeys: zhApiKeys,
      endpoints: zhEndpoints,
      workbench: zhWorkbench,
      setup: zhSetup
    }
  },
  en: {
    translation: {
      app: enApp,
      nav: enNav,
      language: enLanguage,
      common: enCommon,
      login: enLogin,
      dashboard: enDashboard,
      logs: enLogs,
      providers: enProviders,
      modelManagement: enModelManagement,
      routingManagement: enRoutingManagement,
      events: enEvents,
      settings: enSettings,
      help: enHelp,
      about: enAbout,
      apiKeys: enApiKeys,
      endpoints: enEndpoints,
      workbench: enWorkbench,
      setup: enSetup
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
