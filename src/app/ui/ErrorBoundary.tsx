import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useI18n } from "@/shared/i18n";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";

export interface ErrorFallbackProps {
  message: string;
  title: string;
  hint: string;
  detailsLabel: string;
  reloadLabel: string;
  onReload: () => void;
}

/** Presentational fallback so it can be tested without a router or provider. */
export function ErrorFallbackView({
  message,
  title,
  hint,
  detailsLabel,
  reloadLabel,
  onReload,
}: ErrorFallbackProps) {
  return (
    <section className="page" role="alert">
      <Card>
        <h1>{title}</h1>
        <p className="muted">{hint}</p>
        <div className="form-actions">
          <Button variant="primary" onClick={onReload}>
            {reloadLabel}
          </Button>
        </div>
        <details className="engine-diagnostics">
          <summary>{detailsLabel}</summary>
          <pre className="log-output">{message}</pre>
        </details>
      </Card>
    </section>
  );
}

/** Reload the whole window; a render error can leave React state unusable. */
export function reloadWindow(): void {
  if (typeof window !== "undefined" && typeof window.location?.reload === "function") {
    window.location.reload();
  }
}

export function RouteErrorFallback({ error }: { error: Error }) {
  const { t } = useI18n();
  return (
    <ErrorFallbackView
      message={error.message}
      title={t("errors.route.title")}
      hint={t("errors.route.hint")}
      detailsLabel={t("errors.route.details")}
      reloadLabel={t("errors.route.reload")}
      onReload={reloadWindow}
    />
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Keeps one broken screen from blanking the window: the error is contained and
 * the user gets a reload action instead of an empty frame.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The message is rendered in the fallback; the component stack stays in the
    // dev console. Never log provider payloads or tokens here.
    console.error("Route render failed", error.message, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    return error ? this.props.fallback(error) : this.props.children;
  }
}

/**
 * Route-level boundary: a new path resets the boundary, so navigating away from
 * a crashed screen recovers without a full reload.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary
      key={location.pathname}
      fallback={(error) => <RouteErrorFallback error={error} />}
    >
      {children}
    </ErrorBoundary>
  );
}
