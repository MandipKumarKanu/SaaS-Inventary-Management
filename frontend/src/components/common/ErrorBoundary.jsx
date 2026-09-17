import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // Log error to monitoring console
    console.error('ErrorBoundary caught an unexpected React render error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-[400px] w-full flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center shadow-sm">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </div>

          <h3 className="text-lg font-bold tracking-tight text-foreground">
            Something went wrong in this section
          </h3>

          <p className="mt-1.5 max-w-md text-xs text-muted-foreground">
            {this.state.error?.message || 'An unexpected rendering error occurred. You can retry loading this section.'}
          </p>

          <div className="mt-5 flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={this.handleReset}
              className="gap-2 text-xs font-semibold"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try Again
            </Button>

            <Button
              variant="default"
              size="sm"
              onClick={() => window.location.assign('/dashboard')}
              className="gap-2 text-xs font-semibold"
            >
              <Home className="h-3.5 w-3.5" />
              Go to Dashboard
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
