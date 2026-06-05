import log from 'electron-log/main';

// Structured logging to file + console. File goes to userData/logs/main.log.
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.transports.file.fileName = 'main.log';

// Scoped logger helper so each service tags its lines.
export function createLogger(scope: string) {
  return log.scope(scope);
}

export default log;
