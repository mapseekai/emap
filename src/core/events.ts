/** Event listener function type with typed event data */
export type EventListener<T = Record<string, unknown>> = (event: { type: string } & T) => void;

export class EventDispatcher {
  private _listeners: Record<string, EventListener[]> = {};

  on<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this {
    if (!this._listeners[type]) {
      this._listeners[type] = [];
    }
    this._listeners[type].push(listener as EventListener);
    return this;
  }

  off<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this {
    if (!this._listeners[type]) return this;
    this._listeners[type] = this._listeners[type].filter(l => l !== listener);
    return this;
  }

  fire<T = Record<string, unknown>>(type: string, data?: T): this {
    if (!this._listeners[type]) return this;
    const event = { type, ...data } as { type: string } & T;
    this._listeners[type].forEach(l => l(event));
    return this;
  }
}
