import { join } from 'node:path';
import { app } from 'electron';

// Centralized filesystem locations. All app-managed files live under userData.
export const paths = {
  userData: () => app.getPath('userData'),
  database: () => join(app.getPath('userData'), 'lol-vod-review.db'),
  logsDir: () => join(app.getPath('userData'), 'logs'),
  archiveDir: () => join(app.getPath('userData'), 'archive'),
};
