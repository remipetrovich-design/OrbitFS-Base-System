import { readFileSync } from 'node:fs';

const LEGACY_LICENSE_URLS = [
  'https://customlicensev1.vercel.app',
  'https://orbitfsstore.vercel.app',
  'https://panel.incendiarynetworks.cc/api',
  'https://panel.incendiarynetworks.cc/api/v1',
  'https://custom-licence-manager-aud6rnutt-retroreview12-8045.vercel.app',
];

const files = [
  'src/lib/server/license.ts',
  'src/lib/server/engine-release-client.ts',
  'src/routes/license/+page.svelte',
  'src/routes/api/setup/[...rest]/+server.ts',
  'src/routes/api/config/[section]/+server.ts',
];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const legacy of LEGACY_LICENSE_URLS) {
    if (source.includes(legacy)) throw new Error(`Legacy License Master host remains in ${file}: ${legacy}`);
  }
}

console.log('License runtime endpoint validation passed; the Base runtime reads ORBITFS_LICENSE_API_URL from deployment environment.');
