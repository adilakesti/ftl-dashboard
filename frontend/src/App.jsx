import { ErrorBoundary } from "./shared.jsx";
import { AppInner } from "./shell.jsx";

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
