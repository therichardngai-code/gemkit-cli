import { OfficeState, OfficeEvent } from './types.js';

type StateListener = (state: OfficeState) => void;
type EventListener = (event: OfficeEvent) => void;

const MAX_HISTORY_SIZE = 1000;

export class OfficeEventEmitter {
  private state: OfficeState;
  private stateListeners: Set<StateListener> = new Set();
  private eventListeners: Set<EventListener> = new Set();
  private eventHistory: OfficeEvent[] = [];

  constructor(initialState: OfficeState) {
    this.state = initialState;
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    // Immediately notify with current state
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  /**
   * Subscribe to individual events
   */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Emit an event and update state
   */
  emit(event: OfficeEvent): void {
    // Store in history
    this.eventHistory.push(event);
    if (this.eventHistory.length > MAX_HISTORY_SIZE) {
      this.eventHistory.shift();
    }

    // Notify event listeners
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('Event listener error:', e);
      }
    }
  }

  /**
   * Update state and notify listeners
   */
  setState(newState: OfficeState): void {
    this.state = newState;

    // Notify state listeners
    for (const listener of this.stateListeners) {
      try {
        listener(this.state);
      } catch (e) {
        console.error('State listener error:', e);
      }
    }
  }

  /**
   * Get current state snapshot
   */
  getState(): OfficeState {
    return this.state;
  }

  /**
   * Get event history
   */
  getHistory(): OfficeEvent[] {
    return [...this.eventHistory];
  }

  /**
   * Replay events from a timestamp
   */
  replay(fromTimestamp: number): OfficeEvent[] {
    return this.eventHistory.filter(e => e.timestamp >= fromTimestamp);
  }

  /**
   * Clear all listeners (for cleanup)
   */
  dispose(): void {
    this.stateListeners.clear();
    this.eventListeners.clear();
    this.eventHistory = [];
  }
}
