import { getActiveRelease } from '$lib/server/update-checkpoints';
import { compareOrbitVersions, satisfiesMinimumOrbitVersion } from '$lib/server/orbit-version';

type ReleaseFile = { file: string; component?: string; sha256?: string; size?: number };
type EnginePackage = { version: string; releaseId: string; sourceCommit: string | null; components: string[]; componentVersions?: Record<string, string | null>; minimumBaseVersion?: string; files: ReleaseFile[] };
type EngineDescriptor = { version: string; releaseId: string; sha256: string; sourceCommit: string | null; components: string[]; minimumBaseVersion?: string | null };

export type EngineUpdatePlan = {
	format: 'orbitfs-engine-update-plan-v1';
	status: 'install' | 'update' | 'noop' | 'blocked';
	blocked: boolean;
	reason: string | null;
	current: { version: string | null; releaseId: string | null; componentVersions: Record<string, string | null>; fileCount: number } | null;
	target: { version: string; releaseId: string; components: string[]; componentVersions: Record<string, string | null>; minimumBaseVersion: string | null; fileCount: number };
	changes: { added: string[]; modified: string[]; removed: string[]; unchanged: string[] };
	componentChanges: Array<{ component: string; from: string | null; to: string | null }>;
	baselineKnown: boolean;
	baseCompatibility: { required: string | null; installed: string | null; comparison: number | null; compatible: boolean };
	deployment: { fullSnapshotRequired: boolean; checkpointRequired: boolean; immutableTarget: true };
};

function normalizeInventory(files: ReleaseFile[] = [], components: string[] = []) {
	const selected=new Set(components.map((item)=>String(item||'').trim().toLowerCase()).filter(Boolean));
	return new Map(files
		.filter((item)=>{const component=String(item.component||'shared').trim().toLowerCase();return component==='shared'||selected.has(component);})
		.map((item) => [String(item.file), { component: String(item.component || 'shared'), sha256: String(item.sha256 || ''), size: Number(item.size || 0) }]));
}
export async function buildEngineUpdatePlan(input: {
	descriptor: EngineDescriptor;
	package: EnginePackage;
	installedBaseVersion?: string | null;
	supportedProtocol?: number;
}): Promise<EngineUpdatePlan> {
	const active = await getActiveRelease();
	const engine = active?.engine && typeof active.engine === 'object' ? active.engine : null;
	const executionComponents=[...new Set((input.package.components||[]).map((item)=>String(item||'').trim().toLowerCase()).filter(Boolean))];
	const currentInventory = normalizeInventory(Array.isArray(engine?.fileInventory) ? engine.fileInventory : [],executionComponents);
	const targetInventory = normalizeInventory(input.package.files || [],executionComponents);
	const baselineKnown = Boolean(engine?.releaseId && currentInventory.size > 0);
	const currentVersion = engine?.version ? String(engine.version) : (active?.engineReleaseVersion ? String(active.engineReleaseVersion) : null);
	const currentReleaseId = engine?.releaseId ? String(engine.releaseId) : null;
	const currentVersions = engine?.componentVersions && typeof engine.componentVersions === 'object' ? engine.componentVersions : {};
	const rawTargetVersions = input.package.componentVersions && typeof input.package.componentVersions === 'object' ? input.package.componentVersions : {};
	const targetVersions=Object.fromEntries(Object.entries(rawTargetVersions).filter(([component])=>executionComponents.includes(component)));
	const added:string[]=[]; const modified:string[]=[]; const removed:string[]=[]; const unchanged:string[]=[];
	for (const [file,target] of targetInventory) {
		const current=currentInventory.get(file);
		if (!current) added.push(file);
		else if (current.sha256 && target.sha256 && current.sha256 === target.sha256) unchanged.push(file);
		else modified.push(file);
	}
	for (const file of currentInventory.keys()) if (!targetInventory.has(file)) removed.push(file);
	added.sort(); modified.sort(); removed.sort(); unchanged.sort();
	const componentSet = new Set(executionComponents);
	const componentChanges = [...componentSet].sort().map((component) => ({component,from:currentVersions[component] ?? null,to:targetVersions[component] ?? null})).filter((item) => item.from !== item.to);
	const installedBase = String(input.installedBaseVersion || active?.panelVersion || active?.baseVersion || (!engine ? active?.version : '') || '').trim() || null;
	const requiredBase = String(input.package.minimumBaseVersion || '').trim() || null;
	const baseCmp = requiredBase && installedBase ? compareOrbitVersions(installedBase, requiredBase) : null;
	const baseCompatible = !requiredBase || Boolean(installedBase && satisfiesMinimumOrbitVersion(installedBase, requiredBase));
	const targetCmp = currentVersion ? compareOrbitVersions(input.descriptor.version, currentVersion) : null;
	let status: EngineUpdatePlan['status'] = currentVersion ? 'update' : 'install';
	let reason: string | null = null;
	if (currentVersion && targetCmp === 0 && currentReleaseId === input.descriptor.releaseId) status='noop';
	else if (currentVersion && targetCmp !== null && targetCmp < 0) { status='blocked'; reason='Installed Engine release ' + currentVersion + ' is newer than target ' + input.descriptor.version + '; downgrade requires an explicit rollback release.'; }
	else if (!baseCompatible) { status='blocked'; reason='Engine release ' + input.descriptor.version + ' requires Base ' + requiredBase + ' or newer, but this installation reports Base ' + (installedBase || 'unknown') + '.'; }
	else if (currentVersion && !baselineKnown) reason='The installed Engine version is known but its file inventory is not. The target will be deployed as a complete immutable snapshot and the missing baseline will be recorded after success.';
	return {
		format:'orbitfs-engine-update-plan-v1', status, blocked:status==='blocked', reason,
		current: currentVersion ? {version:currentVersion,releaseId:currentReleaseId,componentVersions:currentVersions,fileCount:currentInventory.size} : null,
		target:{version:input.descriptor.version,releaseId:input.descriptor.releaseId,components:input.package.components,componentVersions:targetVersions,minimumBaseVersion:requiredBase||null,fileCount:targetInventory.size},
		changes:{added,modified,removed,unchanged}, componentChanges, baselineKnown,
		baseCompatibility:{required:requiredBase||null,installed:installedBase,comparison:baseCmp,compatible:baseCompatible},
		deployment:{fullSnapshotRequired:true,checkpointRequired:true,immutableTarget:true}
	};
}
