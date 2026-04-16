import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/styles/global.css'
import LandingPage from './LandingPage'

const rootElement = document.getElementById('landing-root')

if (!rootElement) {
  throw new Error('Root element #landing-root not found')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <LandingPage />
  </React.StrictMode>
)
