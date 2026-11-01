import { isAcceptableSetupToken } from './auth-security.mjs';

// Localhost is the default. An HTTPS public origin is only meaningful when
// binding the production server to all interfaces.
export function resolveRuntimeConfig(env = process.env) {
  const port = Number(env.PORT || 5197);
  const host = env.HOST || '127.0.0.1';
  const development = env.HADIR_DEV === '1';

  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT harus berupa angka antara 1 dan 65535.');
  if (!['127.0.0.1', '0.0.0.0'].includes(host))
    throw new Error('HOST harus 127.0.0.1 (lokal) atau 0.0.0.0 (server hosting).');

  if (host === '0.0.0.0' && development)
    throw new Error('Mode pengembangan tidak boleh berjalan di HOST=0.0.0.0.');

  const publicOriginText = env.HADIR_PUBLIC_ORIGIN;
  const ignoredPublicOrigin = host === '127.0.0.1' && !!publicOriginText;
  if (host === '127.0.0.1')
    return { port, host, development, publicOrigin: null, ignoredPublicOrigin };

  // Use only the explicitly configured HTTPS origin, never untrusted proxy
  // headers. Public mode must fail closed if its security settings are missing.
  if (!publicOriginText)
    throw new Error('HOST=0.0.0.0 memerlukan HADIR_PUBLIC_ORIGIN HTTPS.');
  let publicOrigin;
  try {
    publicOrigin = new URL(publicOriginText);
  } catch {
    throw new Error('HADIR_PUBLIC_ORIGIN harus berupa URL HTTPS yang valid.');
  }
  const hostname = publicOrigin.hostname;
  if (
    publicOrigin.protocol !== 'https:' ||
    !hostname.includes('.') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    publicOrigin.username ||
    publicOrigin.password ||
    publicOrigin.pathname !== '/' ||
    publicOrigin.search ||
    publicOrigin.hash ||
    publicOrigin.port
  ) {
    throw new Error('HADIR_PUBLIC_ORIGIN harus origin HTTPS publik, contoh: https://hadir.example.org');
  }
  if (!isAcceptableSetupToken(env.HADIR_SETUP_TOKEN))
    throw new Error('Akses publik memerlukan HADIR_SETUP_TOKEN acak 32 byte (64 karakter heksadesimal).');

  return { port, host, development, publicOrigin, ignoredPublicOrigin: false };
}
