import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

interface Props { children: ReactNode }
interface State { error: Error | null }

// React only catches render errors via a class component's static
// getDerivedStateFromError/componentDidCatch — there's no hook equivalent.
// Without this, any unhandled render error (malformed road data, a null ref
// in the 3D scene) white-screens the entire app instead of showing something
// recoverable.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("RoadTwin crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full w-full flex items-center justify-center bg-ink-950 text-ink-100 p-6">
          <div className="max-w-md text-center">
            <div className="font-display text-xl mb-2">Something went wrong</div>
            <p className="text-sm text-ink-400 mb-1">
              RoadTwin hit an unexpected error and couldn&rsquo;t continue rendering this view.
            </p>
            <p className="mono text-2xs text-ink-500 mb-5 break-words">{this.state.error.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-brand text-ink-950 text-sm font-semibold hover:bg-brand-bright transition-colors"
            >
              <RefreshCw size={14} /> Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
