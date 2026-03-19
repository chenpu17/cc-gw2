import { AppProviders } from '@/providers/AppProviders'
import { AppRouter } from '@/app/router'

export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  )
}

export default App
