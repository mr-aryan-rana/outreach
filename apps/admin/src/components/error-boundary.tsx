"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: React.ReactNode;
  fallbackLabel?: string;
}

interface State {
  error: Error | null;
}

/**
 * Page-section error boundary -- catches render errors in one card/table/
 * chart without taking down the whole page (e.g. one broken widget on the
 * Dashboard shouldn't blank the KPIs next to it). Next.js's own
 * app/*\/error.tsx handles route-level crashes; this is for isolating
 * smaller regions within a page.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", this.props.fallbackLabel, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
          <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {this.props.fallbackLabel ?? "Something went wrong loading this section."}
          </p>
          <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
