import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'index.html'),
        landing: path.resolve(__dirname, 'landing.html')
      },
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          if (id.includes('zrender')) {
            return 'charts-engine'
          }

          if (id.includes('echarts-for-react')) {
            return 'charts-react'
          }

          if (id.includes('echarts')) {
            return 'charts-core'
          }

          if (id.includes('@radix-ui')) {
            return 'radix'
          }

          if (id.includes('@tanstack/react-query')) {
            return 'query'
          }

          if (id.includes('react-i18next') || id.includes('i18next')) {
            return 'i18n'
          }

          if (id.includes('react-router')) {
            return 'router'
          }

          return 'vendor'
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'import.meta.env.VITE_NODE_VERSION': JSON.stringify(process.version)
  },
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/api': 'http://127.0.0.1:4100',
      '/v1': 'http://127.0.0.1:4100'
    }
  },
  preview: {
    port: 5173
  }
})
