interface Settlement<T> {
  resolve?: (value: T) => void;
  reject?: (reason: unknown) => void;
}

// These reactions capture only the detachable cell. They must not capture the
// consumer, AbortSignal, or its resolve/reject closures after cancellation.
function observe<T>(pending: Promise<T>, cell: Settlement<T>): void {
  void pending.then(
    (value) => cell.resolve?.(value),
    (error) => cell.reject?.(error),
  );
}

/** Stop awaiting an external operation without retaining its cancelled consumer. */
export function awaitWithSignal<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cell: Settlement<T> = {};
    const clear = () => {
      cell.resolve = undefined;
      cell.reject = undefined;
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      clear();
      reject(signal.reason ?? new DOMException('Operation cancelled', 'AbortError'));
    };
    cell.resolve = (value) => {
      clear();
      resolve(value);
    };
    cell.reject = (error) => {
      clear();
      reject(error);
    };
    observe(pending, cell);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
