import { createHash } from 'node:crypto';
import { getStoredLicenseCredential, getLicenseProviderSettings } from '$lib/server/license';
import { parsePackage, type EngineReleaseDescriptor } from '$lib/server/engine-release-client';

const MAX_ARCHIVE = 75 * 1024 * 1024;

function fail(code: string, status: number) {
  return Object.assign(new Error('Authorized Engine branch source failed: ' + code), { code, status });
}
async function sourceUrl() {
  const { providerBase } = await getLicenseProviderSettings();
  const configured = String(providerBase || '').trim();
  const url = new URL(configured);
  if (url.protocol !== 'https:' || !url.pathname.endsWith('/api/v1/license'))
    throw fail('ENGINE_LICENSE_PROVIDER_INVALID', 503);
  url.pathname = url.pathname.slice(0, -'/license'.length) + '/engine-bootstrap';
  url.search = '';
  url.hash = '';
  return url;
}
// The existing Custom License Manager performs all private GitHub access.
// Base never receives the GitHub token or contacts private repository APIs.
export async function fetchAuthorizedEngineBranch(selection: { sourceCommit?: string | null } = {}) {
  const identity = await getStoredLicenseCredential();
  const headers = {
    'x-license-key': identity.licenseKey,
    'x-installation-id': identity.installationId,
    'x-orbitfs-client': 'orbitfs-base-engine-deployer',
    accept: 'application/json',
  };
  const url = await sourceUrl();
  const requested = String(selection.sourceCommit || '').trim().toLowerCase();
  if (requested) {
    if (!/^[a-f0-9]{40}$/.test(requested)) throw fail('ENGINE_SOURCE_SHA_INVALID', 400);
    url.searchParams.set('sha', requested);
  }
  const metadata = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(90_000) });
  const body: any = await metadata.json().catch(() => ({}));
  if (!metadata.ok || !body?.ok || !body?.release)
    throw fail(String(body?.code || 'ENGINE_SOURCE_DESCRIPTOR_UNAVAILABLE'), metadata.status || 503);
  const item = body.release;
  const sha = String(item.sourceCommit || '').trim().toLowerCase();
  const expected = String(item.checksum || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^[a-f0-9]{64}$/.test(expected) ||
    String(item.sourceRepo) !== 'remipetrovich-design/OrbitFS_Engine' ||
    String(item.sourceRef) !== 'UPDATE_RELEASE' ||
    String(item.id) !== 'github:remipetrovich-design/OrbitFS_Engine@' + sha)
    throw fail('ENGINE_SOURCE_DESCRIPTOR_INVALID', 502);
  if (requested && requested !== sha) throw fail('ENGINE_SOURCE_STALE', 409);
  url.searchParams.set('sha', sha);
  url.searchParams.set('download', '1');
  const download = await fetch(url, {
    headers: { ...headers, accept: 'application/gzip' }, cache: 'no-store',
    signal: AbortSignal.timeout(90_000),
  });
  if (!download.ok) {
    const error: any = await download.json().catch(() => ({}));
    throw fail(String(error?.code || 'ENGINE_SOURCE_DOWNLOAD_FAILED'), download.status || 503);
  }
  if (Number(download.headers.get('content-length') || 0) > MAX_ARCHIVE) throw fail('ENGINE_SOURCE_SIZE_INVALID', 502);
  const archive = Buffer.from(await download.arrayBuffer());
  if (!archive.length || archive.length > MAX_ARCHIVE ||
    createHash('sha256').update(archive).digest('hex') !== expected ||
    String(download.headers.get('x-orbitfs-source-sha') || '').toLowerCase() !== sha)
    throw fail('ENGINE_SOURCE_CHECKSUM_MISMATCH', 502);
  const descriptor: EngineReleaseDescriptor = {
    version: String(item.version), releaseId: String(item.id), channel: 'branch',
    sourceCommit: sha, sha256: expected, size: archive.length,
    fileCount: Number(item.fileCount), downloadUrl: '', expiresIn: 0,
    projectSettings: { framework: 'sveltekit', buildCommand: 'npm run build', installCommand: 'npm ci' },
    components: ['mcp', 'apex', 'studio'], checkpointRequired: true,
    minimumEngineDeployerProtocol: Number(item.minimumEngineDeployerProtocol || 1),
    minimumBaseVersion: String(item.minimumBaseVersion || ''), distribution: 'orbitfs-store-package-v1',
  };
  const packageData: any = parsePackage(archive, descriptor);
  if (packageData.sourceCommit !== sha || packageData.releaseId !== descriptor.releaseId)
    throw fail('ENGINE_SOURCE_PACKAGE_INVALID', 502);
  return {
    installationId: identity.installationId,
    descriptor, package: packageData,
    files: packageData.files.map((file: any) => ({
      file: file.file, component: file.component, data: file.data, encoding: file.encoding,
      size: file.size, sha256: file.sha256,
    })),
  };
}

export async function verifyAuthorizedEngineBranch(selection: { releaseId: string; sourceCommit: string; sha256: string }) {
  const identity = await getStoredLicenseCredential();
  const url = await sourceUrl();
  url.searchParams.set('sha', selection.sourceCommit);
  const response = await fetch(url, {
    headers: { 'x-license-key': identity.licenseKey, 'x-installation-id': identity.installationId,
      'x-orbitfs-client': 'orbitfs-base-engine-deployer', accept: 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(90_000),
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok || !body?.ok) throw fail(String(body?.code || 'ENGINE_SOURCE_VERIFY_FAILED'), response.status || 503);
  if (String(body.release?.id) !== selection.releaseId ||
    String(body.release?.sourceCommit) !== selection.sourceCommit ||
    String(body.release?.checksum).toLowerCase() !== selection.sha256.toLowerCase())
    throw fail('ENGINE_SOURCE_VERIFY_MISMATCH', 409);
  return {
    installationId: identity.installationId, releaseId: selection.releaseId,
    version: String(body.release.version), channel: 'branch',
    provider: (await sourceUrl()).toString(), protocol: 1, verifiedAt: new Date().toISOString(),
  };
}