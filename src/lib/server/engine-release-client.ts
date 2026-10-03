import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { env } from '$env/dynamic/private';
import { getSupabaseAdmin } from '$lib/server/supabase';
import { ensureInstallationIdentity } from '$lib/server/license';
import { resolveUpdaterProviderBase } from '$lib/server/updater-connection';

const MAX_ARCHIVE_BYTES = 75 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 210 * 1024 * 1024;
const MAX_FILES = 5000;
const ENGINE_COMPONENTS = new Set(['apex', 'mcp', 'studio']);
export const SUPPORTED_ENGINE_DEPLOYER_PROTOCOL = 1;
export type EngineReleaseFile = { file: string; component?: string; data: string; encoding: 'base64' | 'utf-8'; size?: number; sha256?: string };
export type EngineReleasePackage = { format: 'orbitfs-engine-release-v1' | 'orbitfs-engine-release-v2' | 'orbitfs-engine-release-v3'; schemaVersion?: number; manifestVersion?: number; version: string; releaseId: string; sourceCommit: string | null; createdAt: string; components: string[]; componentVersions?: Record<string, string | null>; minimumBaseVersion?: string; changedComponents?: string[]; checkpointRequired: boolean; minimumEngineDeployerProtocol: number; projectSettings: { framework?: string; buildCommand?: string; installCommand?: string; outputDirectory?: string }; files: EngineReleaseFile[] };
export type EngineReleaseDescriptor = { version: string; releaseId: string; channel: string; sourceCommit: string | null; sha256: string; size: number; fileCount: number; downloadUrl: string; expiresIn: number; projectSettings: EngineReleasePackage['projectSettings']; components: string[]; checkpointRequired: boolean; minimumEngineDeployerProtocol: number; minimumBaseVersion: string | null; distribution: 'orbitfs-store-package-v1' };
function fail(message: string, status = 500, code = 'ENGINE_RELEASE_FAILED') { return Object.assign(new Error(message), { status, code }); }
function timeoutMs() { return Math.max(5_000, Number(env.ORBITFS_ENGINE_RELEASE_TIMEOUT_MS || 30_000)); }
async function providerBase() { return resolveUpdaterProviderBase(); }
function safeDownloadUrl(value: unknown) { try { const url = new URL(String(value || '').trim()); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); return url.toString(); } catch { throw fail('License Master returned an invalid download URL.', 502, 'ENGINE_RELEASE_URL_INVALID'); } }
function safeFilePath(value: unknown) { const path = String(value || '').trim().replace(/\\/g, '/'); return Boolean(path && !path.startsWith('/') && !path.startsWith('../') && !path.includes('/../') && !path.includes('\0') && !/(^|\/)(\.git|\.vercel|node_modules)(\/|$)/.test(path) && !/(^|\/)\.env(?:\.|$)/.test(path)); }
function normalizedComponents(value: unknown) { return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim().toLowerCase()).filter((item) => ENGINE_COMPONENTS.has(item)))]; }
async function storedLicenseIdentity() { const installationId = await ensureInstallationIdentity(); const db = getSupabaseAdmin(); const result = await db.from('orbitfs_license').select('license_key').eq('id', 'primary').maybeSingle(); if (result.error) throw result.error; const licenseKey = String(result.data?.license_key || '').trim(); if (!licenseKey) throw fail('Activate the OrbitFS licence before deploying the Shared Engine Host.', 409, 'LICENSE_KEY_REQUIRED'); return { installationId, licenseKey }; }
async function masterJson(path: string, init: RequestInit = {}, licenseKey = '', installationId = '') { const response = await fetch(`${await providerBase()}${path}`, { ...init, headers: { 'x-license-key': licenseKey, 'x-installation-id': installationId, accept: 'application/json', ...(init.headers || {}) }, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs()) }); const body: any = await response.json().catch(() => ({})); if (!response.ok) throw fail(String(body?.error || body?.message || `License Master returned ${response.status}`), response.status < 500 ? response.status : 503, String(body?.code || 'LICENSE_MASTER_ERROR')); return body; }
async function requestReleaseDescriptor(selection: { releaseId?: string | null; channel?: string | null } = {}) { const { installationId, licenseKey } = await storedLicenseIdentity(); const channel=String(selection.channel||env.ORBITFS_UPDATE_CHANNEL||'stable').trim().toLowerCase()||'stable'; const selectedReleaseId=String(selection.releaseId||'').trim(); const query=selectedReleaseId ? `?product=orbitfs_base&channel=${encodeURIComponent(channel)}&type=update&release_id=${encodeURIComponent(selectedReleaseId)}` : `?product=orbitfs_base&channel=${encodeURIComponent(channel)}&type=update&engine=1`; const body = await masterJson(query, { method: 'GET' }, licenseKey, installationId); const rows: any[] = Array.isArray(body?.releases) ? body.releases : (body?.release ? [body.release] : []); const candidates = rows.map((release) => {
	const rawTargets=(Array.isArray(release?.manifest?.components)?release.manifest.components:Array.isArray(release?.components)?release.components:[]).map((item:any)=>String(item||'').trim().toLowerCase()).filter(Boolean);
	const components=normalizedComponents(rawTargets);
	const invalidTargets=rawTargets.filter((item:string)=>!ENGINE_COMPONENTS.has(item));
	return { release, components, invalidTargets };
}).filter(({ release }) => (!release?.status || String(release.status).toLowerCase() === 'published') && (!release?.review_status || String(release.review_status).toLowerCase() === 'approved'));
const selectedCandidate=selectedReleaseId?candidates.find(({release})=>String(release?.id||'')===selectedReleaseId):candidates.find(({components,invalidTargets})=>components.length>0&&invalidTargets.length===0);
if(selectedCandidate?.invalidTargets?.length) throw fail('Normal OrbitFS Update releases may target only MCP, APEX and Studio. Base is delivered only by the Base Deployer/Updater.',409,'ENGINE_RELEASE_SCOPE_INVALID');
const raw = selectedCandidate?.release || null; const components = selectedCandidate?.components || []; if (!raw?.id || !raw?.version) throw fail('No published Engine-backed update release is currently available.', 404, 'ENGINE_RELEASE_NOT_FOUND'); const minimumEngineDeployerProtocol = Math.max(1, Number(raw?.manifest?.minimumEngineDeployerProtocol || raw?.minimumEngineDeployerProtocol || 1)); if (!Number.isInteger(minimumEngineDeployerProtocol)) throw fail('License Master returned an invalid deployer protocol requirement.', 502, 'ENGINE_RELEASE_PROTOCOL_INVALID'); if (minimumEngineDeployerProtocol > SUPPORTED_ENGINE_DEPLOYER_PROTOCOL) throw fail(`Engine release ${raw.version} requires Engine Deployer protocol ${minimumEngineDeployerProtocol}, but this OrbitFS Base supports protocol ${SUPPORTED_ENGINE_DEPLOYER_PROTOCOL}. Update the Panel/Base first.`, 409, 'ENGINE_DEPLOYER_UPDATE_REQUIRED'); const releaseId = String(raw.id); const provider = await providerBase(); const downloadUrl = `${provider}?product=orbitfs_base&channel=${encodeURIComponent(channel)}&type=update&release_id=${encodeURIComponent(releaseId)}&download=1`; const sha256 = String(raw?.artifact?.sha256 || raw?.checksum || raw?.artifact_sha256 || '').trim(); if (!sha256) throw fail('License Master returned an Engine release without an artifact checksum.', 502, 'ENGINE_RELEASE_CHECKSUM_MISSING'); const release: EngineReleaseDescriptor = { version: String(raw.version), releaseId, channel:String(raw.channel||channel), sourceCommit: raw?.sourceCommit || raw?.source_sha || raw?.manifest?.sourceCommit || null, sha256, size: Number(raw?.artifact?.size || raw?.artifact_size || 0), fileCount: Number(raw?.manifest?.fileCount || 0), downloadUrl, expiresIn: 300, projectSettings: raw?.manifest?.projectSettings || {}, components, checkpointRequired: raw?.manifest?.checkpointRequired !== false, minimumEngineDeployerProtocol, minimumBaseVersion: raw?.manifest?.minimumBaseVersion || raw?.minimumBaseVersion || null, distribution: 'orbitfs-store-package-v1' }; if (!release.checkpointRequired) throw fail('Engine update is missing the required update checkpoint contract.', 502, 'ENGINE_RELEASE_CHECKPOINT_INVALID'); return { installationId, release }; }
function validateEnginePackage(payload: any, descriptor: EngineReleaseDescriptor): EngineReleasePackage {
	if (!['orbitfs-engine-release-v1','orbitfs-engine-release-v2','orbitfs-engine-release-v3'].includes(String(payload?.format || '')) || payload.version !== descriptor.version) throw fail('Engine release package identity does not match its License Master release.', 502, 'ENGINE_RELEASE_IDENTITY_MISMATCH');
	const packageProtocol = Math.max(1, Number(payload.minimumEngineDeployerProtocol || 1));
	if (!Number.isInteger(packageProtocol) || packageProtocol !== descriptor.minimumEngineDeployerProtocol) throw fail('Engine package deployer protocol does not match its License Master descriptor.', 502, 'ENGINE_RELEASE_PROTOCOL_MISMATCH');
	if (payload.checkpointRequired !== true) throw fail('Engine package does not require the mandatory update checkpoint.', 502, 'ENGINE_RELEASE_CHECKPOINT_INVALID');
	const packageComponents = normalizedComponents(payload.components);
	const descriptorComponents = descriptor.components.slice().sort();
	if (packageComponents.slice().sort().join(',') !== descriptorComponents.join(',')) throw fail('Engine package components do not match its License Master descriptor.', 502, 'ENGINE_RELEASE_COMPONENTS_MISMATCH');
	if (descriptor.sourceCommit && payload.sourceCommit && String(payload.sourceCommit) !== String(descriptor.sourceCommit)) throw fail('Engine package source commit does not match its License Master descriptor.', 502, 'ENGINE_RELEASE_SOURCE_MISMATCH');
	if (!Array.isArray(payload.files) || !payload.files.length || payload.files.length > MAX_FILES) throw fail('Engine release file list is invalid.', 502, 'ENGINE_RELEASE_FILES_INVALID');
	const seen = new Set<string>();
	for (const item of payload.files) {
		if (!safeFilePath(item?.file) || seen.has(item.file)) throw fail(`Unsafe or duplicate Engine release file: ${String(item?.file || '')}`, 502, 'ENGINE_RELEASE_FILE_INVALID');
		seen.add(item.file);
		if (!['base64', 'utf-8'].includes(item.encoding) || typeof item.data !== 'string') throw fail(`Invalid Engine release file encoding: ${item.file}`, 502, 'ENGINE_RELEASE_FILE_INVALID');
		const bytes = item.encoding === 'base64' ? Buffer.from(item.data,'base64') : Buffer.from(item.data,'utf8');
		const digest = createHash('sha256').update(bytes).digest('hex');
		if (item.sha256 && digest !== String(item.sha256).toLowerCase()) throw fail(`Engine release file checksum mismatch: ${item.file}`, 502, 'ENGINE_RELEASE_FILE_CHECKSUM_FAILED');
		if (Number(payload.schemaVersion || 0) >= 3 && (!item.component || !['shared','apex','mcp','studio'].includes(String(item.component)))) throw fail(`Engine release file component is missing: ${item.file}`, 502, 'ENGINE_RELEASE_FILE_COMPONENT_MISSING');
	}
	if (!seen.has('package.json') || ![...seen].some((path) => path.startsWith('src/'))) throw fail('Engine release is missing required project files.', 502, 'ENGINE_RELEASE_FILES_REQUIRED');
	return payload as EngineReleasePackage;
}

export function parsePackage(archive: Buffer, descriptor: EngineReleaseDescriptor) {
	if (!archive.length || archive.length > MAX_ARCHIVE_BYTES) throw fail('Engine release package size is invalid.', 502, 'ENGINE_RELEASE_SIZE_INVALID');
	const digest = createHash('sha256').update(archive).digest('hex');
	if (digest.toLowerCase() !== String(descriptor.sha256).toLowerCase()) throw fail('Engine release checksum verification failed.', 502, 'ENGINE_RELEASE_CHECKSUM_FAILED');
	let payload: any;
	try { payload = JSON.parse(gunzipSync(archive, { maxOutputLength: MAX_UNPACKED_BYTES }).toString('utf8')); }
	catch { throw fail('Engine release package could not be unpacked.', 502, 'ENGINE_RELEASE_PACKAGE_INVALID'); }

	if (String(payload?.format || '') === 'orbitfs-update-bundle-v3') {
		if (String(payload.version || '') !== descriptor.version) throw fail('Update bundle version does not match its License Master release.', 502, 'ENGINE_RELEASE_IDENTITY_MISMATCH');
		if (payload.checkpointRequired !== true) throw fail('Update bundle does not require the mandatory update checkpoint.', 502, 'ENGINE_RELEASE_CHECKPOINT_INVALID');
		const bundleProtocol = Math.max(1, Number(payload.minimumEngineDeployerProtocol || 1));
		if (!Number.isInteger(bundleProtocol) || bundleProtocol !== descriptor.minimumEngineDeployerProtocol) throw fail('Update bundle deployer protocol does not match its License Master descriptor.', 502, 'ENGINE_RELEASE_PROTOCOL_MISMATCH');
		if (descriptor.sourceCommit && payload.sourceCommit && String(payload.sourceCommit) !== String(descriptor.sourceCommit)) throw fail('Update bundle source commit does not match its License Master descriptor.', 502, 'ENGINE_RELEASE_SOURCE_MISMATCH');
		const rawBundleComponents=(Array.isArray(payload.components)?payload.components:[]).map((item:any)=>String(item||'').trim().toLowerCase()).filter(Boolean);
		const invalidBundleComponents=rawBundleComponents.filter((item:string)=>!ENGINE_COMPONENTS.has(item));
		if(invalidBundleComponents.length) throw fail('Published Update contains a Base/non-Engine target. Base updates must use the Base Deployer/Updater.',409,'ENGINE_RELEASE_SCOPE_INVALID');
		const bundleComponents = normalizedComponents(rawBundleComponents);
		if (bundleComponents.slice().sort().join(',') !== descriptor.components.slice().sort().join(',')) throw fail('Update bundle Engine components do not match its License Master descriptor.', 502, 'ENGINE_RELEASE_COMPONENTS_MISMATCH');
		if(payload.payloads?.panel||payload.baseBaseline) throw fail('Published Update contains a Base/Panel payload. The OrbitFS Updater is Engine/addon-only.',409,'ENGINE_RELEASE_SCOPE_INVALID');
		if(payload.updateScope&&payload.updateScope!=='engine-components-only-v1') throw fail('Published Update declares an unsupported update scope.',409,'ENGINE_RELEASE_SCOPE_INVALID');
		if (!payload.payloads?.engine) throw fail('Published update does not contain a Shared Engine payload.', 409, 'ENGINE_RELEASE_PAYLOAD_MISSING');
		return validateEnginePackage(payload.payloads.engine, descriptor);
	}

	return validateEnginePackage(payload, descriptor);
}

export async function fetchLatestEngineRelease(selection: { releaseId?: string | null; channel?: string | null } = {}) { const { installationId, release } = await requestReleaseDescriptor(selection); const identity = await storedLicenseIdentity(); const response = await fetch(release.downloadUrl, { headers: { 'x-license-key': identity.licenseKey, 'x-installation-id': installationId, accept: 'application/octet-stream' }, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs()) }); if (!response.ok) throw fail(`Engine release download returned ${response.status}.`, 503, 'ENGINE_RELEASE_DOWNLOAD_FAILED'); const declared = Number(response.headers.get('content-length') || 0); if (declared > MAX_ARCHIVE_BYTES) throw fail('Engine release package is too large.', 502, 'ENGINE_RELEASE_SIZE_INVALID'); const archive = Buffer.from(await response.arrayBuffer()); const packageData = parsePackage(archive, release); const descriptor = { ...release, fileCount:packageData.files.length, components:normalizedComponents(packageData.components), projectSettings:packageData.projectSettings || release.projectSettings }; return { installationId, descriptor, package: packageData, files: packageData.files.map((file) => ({ file: file.file, component: file.component, data: file.data, encoding: file.encoding, size: file.size, sha256: file.sha256 || createHash('sha256').update(file.encoding === 'base64' ? Buffer.from(file.data,'base64') : Buffer.from(file.data,'utf8')).digest('hex') })) }; }


export async function verifyEngineUpdaterRelease(selection: { releaseId: string; channel?: string | null }) {
	const requestedReleaseId=String(selection.releaseId||'').trim();
	if(!requestedReleaseId) throw fail('Engine release ID is required for updater verification.',400,'ENGINE_RELEASE_ID_REQUIRED');
	const {installationId,release}=await requestReleaseDescriptor({releaseId:requestedReleaseId,channel:selection.channel||null});
	if(release.releaseId!==requestedReleaseId) throw fail('License Master returned a different Engine release during updater verification.',502,'ENGINE_RELEASE_VERIFICATION_MISMATCH');
	return {
		installationId,
		releaseId:release.releaseId,
		version:release.version,
		channel:release.channel,
		provider:await providerBase(),
		protocol:SUPPORTED_ENGINE_DEPLOYER_PROTOCOL,
		verifiedAt:new Date().toISOString()
	};
}
