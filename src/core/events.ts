export class EventDispatcher {
  private _listeners: Record<string, Function[]> = {};

  on(type: string, listener: Function) {
    if (!this._listeners[type]) {
      this._listeners[type] = [];
    }
    this._listeners[type].push(listener);
    return this;
  }

  off(type: string, listener: Function) {
    if (!this._listeners[type]) return this;
    this._listeners[type] = this._listeners[type].filter(l => l !== listener);
    return this;
  }

  fire(type: string, data?: any) {
    if (!this._listeners[type]) return this;
    const event = { type, ...data };
    this._listeners[type].forEach(l => l(event));
    return this;
  }
}
