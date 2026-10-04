import { EventEmitter } from 'node:events';
// In-process pub/sub that feeds the live dashboard (SSE).
// With more than one server instance, swap this for Redis pub/sub.
export const bus = new EventEmitter();
bus.setMaxListeners(0);
