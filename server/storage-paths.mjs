import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

export function isInsideDirectory(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

// Resolve symlinks so a private directory cannot accidentally be exposed
// beneath the publicly served build directory.
export function assertPrivateDataDirectory(dataDir, distDir) {
  const actualDataDir = realpathSync(dataDir);
  const actualDistDir = existsSync(distDir) ? realpathSync(distDir) : path.resolve(distDir);
  if (isInsideDirectory(actualDistDir, actualDataDir)) {
    throw new Error('HADIR_DATA_DIR tidak boleh berada di dalam folder dist yang dapat diakses publik.');
  }
}

// Refuse static files that resolve outside dist through filesystem symlinks.
export function isSafeStaticFile(distDir, filePath) {
  return isInsideDirectory(realpathSync(distDir), realpathSync(filePath));
}
