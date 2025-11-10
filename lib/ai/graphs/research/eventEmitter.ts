// Event emitter for research progress tracking
// This can be imported and listened to by the server

let emitter: any = null;

export function setResearchEmitter(eventEmitter: any) {
  emitter = eventEmitter;
}

export function emitAction(action: string, title: string, description: string, meta?: any) {
  if (emitter) {
    emitter.emit('action', {
      action,
      title,
      description,
      meta,
      timestamp: new Date().toISOString()
    });
  }
}

export function emitProgress(data: any) {
  if (emitter) {
    emitter.emit('progress', {
      ...data,
      timestamp: new Date().toISOString()
    });
  }
}
