import { Component, type ErrorInfo, type ReactNode } from 'react'

interface AppErrorBoundaryProps {
  children: ReactNode
  fallback: ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
}

/**
 * Last-resort render guard. Without it a malformed payload that trips an
 * unguarded accessor blanks the whole console with no explanation; here the
 * user keeps a page with a reload action and the error reaches the console.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
