import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(process.cwd());
const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? String(args[i + 1] || fallback) : fallback;
};

const version = arg('version', process.env.ORBITFS_PANEL_RELEASE_VERSION || '0.0.0-dev').trim();
const releaseChannel = arg('channel', process.env.ORBITFS_RELEASE_CHANNEL || 'stable').trim().toLowerCase();
const output = resolve(ROOT, arg('output', `orbitfs-base-v${version}.json.gz`));
const sourceCommit = arg('commit', process.env.GITHUB_SHA || '').trim() || null;
const databaseMetadataPath = resolve(ROOT, arg('database-metadata', 'orbitfs-database-schema.json'));
const validSemver = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

if (!validSemver.test(version)) throw new Error('Base release version must be valid SemVer');
if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(releaseChannel)) throw new Error('Invalid Base release delivery channel');
if (!sourceCommit || !/^[a-f0-9]{40}$/i.test(sourceCommit)) throw new Error('Base release source commit is required');
if (!existsSync(databaseMetadataPath)) throw new Error('Base database metadata is required. Run tools/build-customer-schema.mjs first.');

const database = JSON.parse(readFileSync(databaseMetadataPath, 'utf8'));
if (database?.format !== 'orbitfs-base-database-snapshot-v1') throw new Error('Invalid Base database metadata format');
const databaseSchemaVersion = String(database.schemaVersion || '').trim();
const databaseSchemaPath = String(database.path || 'supabase/customer-schema.sql').replaceAll('\\', '/');
const databaseSchemaSha256 = String(database.sha256 || '').trim().toLowerCase();
const databaseMigrationCount = Number(database.migrationCount || 0);
const databaseLatestMigration = String(database.latestMigration || '').trim();
const databaseMigrations = Array.isArray(database.migrations) ? database.migrations : [];
const databaseMigrationRoot = String(database.migrationRoot || databaseMigrations[0]?.id || '').trim();
const databaseMigrationRootSha256 = String(database.migrationRootSha256 || databaseMigrations[0]?.sha256 || '').trim().toLowerCase();
const databaseMigrationChain = database?.migrationChain && typeof database.migrationChain === 'object'
	? database.migrationChain
	: {
		format: 'orbitfs-base-migration-chain-v1',
		complete: true,
		baseline: true,
		lineageMode: 'authoritative-baseline',
		predecessorTracking: 'legacy-untracked',
		rootMigration: databaseMigrationRoot,
		rootSha256: databaseMigrationRootSha256,
		latestMigration: databaseLatestMigration,
		migrationCount: databaseMigrationCount,
		migrations: databaseMigrations
	};

if (!databaseSchemaVersion) throw new Error('Database schema version is required');
if (databaseSchemaPath !== 'supabase/customer-schema.sql') throw new Error('Base database snapshot path must be supabase/customer-schema.sql');
if (!/^[a-f0-9]{64}$/.test(databaseSchemaSha256)) throw new Error('Database schema SHA-256 is invalid');
if (!Number.isInteger(databaseMigrationCount) || databaseMigrationCount < 1 || databaseMigrations.length !== databaseMigrationCount) throw new Error('Database migration metadata is incomplete');
if (!/^\d{14}$/.test(databaseLatestMigration)) throw new Error('Database latest migration id is invalid');
if (!/^\d{14}$/.test(databaseMigrationRoot)) throw new Error('Database migration root id is invalid');
if (!/^[a-f0-9]{64}$/.test(databaseMigrationRootSha256)) throw new Error('Database migration root SHA-256 is invalid');

// Stage 1 freshness gate: independently rebuild the customer schema from the
// current Base migration chain and require the supplied snapshot/metadata to
// match byte-for-byte. This makes stale schema packaging impossible even if a
// caller forgets to regenerate supabase/customer-schema.sql first.
{
	const tempRoot = mkdtempSync(join(tmpdir(), 'orbitfs-base-db-stage1-'));
	const generatedSchema = join(tempRoot, 'customer-schema.sql');
	const generatedMetadata = join(tempRoot, 'orbitfs-database-schema.json');
	try {
		const result = spawnSync(process.execPath, [
			resolve(ROOT, 'tools/build-customer-schema.mjs'),
			'--schema-version', databaseSchemaVersion,
			'--output', generatedSchema,
			'--metadata', generatedMetadata
		], { cwd: ROOT, encoding: 'utf8' });
		if (result.status !== 0) {
			throw new Error(`Stage 1 database snapshot rebuild failed: ${String(result.stderr || result.stdout || 'unknown error').trim()}`);
		}
		const expectedSchema = readFileSync(generatedSchema);
		const actualSchemaPath = resolve(ROOT, databaseSchemaPath);
		if (!existsSync(actualSchemaPath)) throw new Error('Stage 1 database snapshot is missing: supabase/customer-schema.sql');
		const actualSchema = readFileSync(actualSchemaPath);
		if (!actualSchema.equals(expectedSchema)) {
			throw new Error('Stage 1 database snapshot is stale. Regenerate supabase/customer-schema.sql from the current Base migrations before packaging.');
		}
		const expectedMetadata = JSON.parse(readFileSync(generatedMetadata, 'utf8'));
		const expectedMigrations = Array.isArray(expectedMetadata.migrations) ? expectedMetadata.migrations : [];
		const actualMigrations = databaseMigrations;
		if (
			String(expectedMetadata.sha256 || '').toLowerCase() !== databaseSchemaSha256 ||
			Number(expectedMetadata.migrationCount || 0) !== databaseMigrationCount ||
			String(expectedMetadata.latestMigration || '') !== databaseLatestMigration ||
			String(expectedMetadata.migrationRoot || '') !== databaseMigrationRoot ||
			String(expectedMetadata.migrationRootSha256 || '').toLowerCase() !== databaseMigrationRootSha256 ||
			expectedMigrations.length !== actualMigrations.length
		) {
			throw new Error('Stage 1 database metadata is stale relative to the current Base migration chain.');
		}
		for (let index = 0; index < expectedMigrations.length; index += 1) {
			const expected = expectedMigrations[index] || {};
			const actual = actualMigrations[index] || {};
			if (
				String(expected.id || '') !== String(actual.id || '') ||
				String(expected.file || '').replaceAll('\\\\', '/') !== String(actual.file || '').replaceAll('\\\\', '/') ||
				Number(expected.size || 0) !== Number(actual.size || 0) ||
				String(expected.sha256 || '').toLowerCase() !== String(actual.sha256 || '').toLowerCase()
			) {
				throw new Error(`Stage 1 database migration inventory is stale at index ${index}.`);
			}
		}
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

for (let index = 0; index < databaseMigrations.length; index += 1) {
	const migration = databaseMigrations[index] || {};
	const id = String(migration.id || '').trim();
	const file = String(migration.file || '').replaceAll('\\\\', '/');
	const sha256 = String(migration.sha256 || '').trim().toLowerCase();
	const checksum = String(migration.checksum || `sha256:${sha256}`).trim().toLowerCase();
	if (!/^\d{14}$/.test(id)) throw new Error(`Database migration id is invalid at index ${index}`);
	if (!file.startsWith(`supabase/migrations/${id}_`) || !file.endsWith('.sql')) throw new Error(`Database migration path does not match id: ${file}`);
	if (!/^[a-f0-9]{64}$/.test(sha256) || checksum !== `sha256:${sha256}`) throw new Error(`Database migration checksum is invalid: ${file}`);
	if (index > 0 && id <= String(databaseMigrations[index - 1]?.id || '')) throw new Error(`Database migration chain is not strictly ordered at ${id}`);
}
if (databaseMigrationRoot !== String(databaseMigrations[0]?.id || '')) throw new Error('Database migration root does not match the first migration');
if (databaseMigrationRootSha256 !== String(databaseMigrations[0]?.sha256 || '').toLowerCase()) throw new Error('Database migration root SHA-256 does not match the first migration');
if (databaseLatestMigration !== String(databaseMigrations[databaseMigrations.length - 1]?.id || '')) throw new Error('Database latest migration does not match the end of the migration chain');
if (databaseMigrationChain?.format !== 'orbitfs-base-migration-chain-v1' || databaseMigrationChain?.complete !== true || databaseMigrationChain?.baseline !== true) throw new Error('Database migration chain contract is incomplete');
if (String(databaseMigrationChain.rootMigration || '') !== databaseMigrationRoot || String(databaseMigrationChain.rootSha256 || '').toLowerCase() !== databaseMigrationRootSha256) throw new Error('Database migration chain root metadata is inconsistent');
if (String(databaseMigrationChain.latestMigration || '') !== databaseLatestMigration || Number(databaseMigrationChain.migrationCount) !== databaseMigrationCount) throw new Error('Database migration chain head metadata is inconsistent');
if (!Array.isArray(databaseMigrationChain.migrations) || databaseMigrationChain.migrations.length !== databaseMigrationCount) throw new Error('Database migration chain inventory is incomplete');

const topFiles = [
	'.npmrc',
	'.env.example',
	'package.json',
	'package-lock.json',
	'svelte.config.js',
	'tsconfig.json',
	'vite.config.ts',
	'deployment/base-environment.json',
	'tools/prepare-license-runtime.mjs',
	databaseSchemaPath
];
const topDirectories = ['src', 'static', 'supabase/migrations'];
const excludedNames = new Set(['.DS_Store', 'Thumbs.db']);

function collectDirectory(path, files) {
	for (const name of readdirSync(path)) {
		if (excludedNames.has(name)) continue;
		const full = join(path, name);
		const stats = statSync(full);
		if (stats.isDirectory()) collectDirectory(full, files);
		else if (stats.isFile()) files.push(full);
	}
}

const selected = [];
for (const name of topFiles) {
	const full = join(ROOT, name);
	if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`Required Base release file is missing: ${name}`);
	selected.push(full);
}
for (const name of topDirectories) {
	const full = join(ROOT, name);
	if (!existsSync(full) || !statSync(full).isDirectory()) throw new Error(`Required Base release directory is missing: ${name}`);
	collectDirectory(full, selected);
}

const uniqueSelected = [...new Set(selected)].sort((a, b) => a.localeCompare(b));
const files = uniqueSelected.map((full) => {
	const file = relative(ROOT, full).replaceAll('\\', '/');
	if (!file || file.startsWith('../') || file.includes('/../')) throw new Error(`Unsafe Base release path: ${file}`);
	if (/(^|\/)(\.git|\.vercel|node_modules)(\/|$)/.test(file) || /(^|\/)\.env(?:\.|$)/.test(file) && file !== '.env.example') {
		throw new Error(`Forbidden Base release path: ${file}`);
	}
	const bytes = readFileSync(full);
	return {
		file,
		component: 'base',
		data: bytes.toString('base64'),
		encoding: 'base64',
		size: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex')
	};
});

const schemaFile = files.find((file) => file.file === databaseSchemaPath);
if (!schemaFile || schemaFile.sha256 !== databaseSchemaSha256) throw new Error('Packaged customer schema does not match database metadata SHA-256');
if (!files.some((file) => file.file === 'package.json')) throw new Error('package.json is required');
if (!files.some((file) => file.file === 'svelte.config.js')) throw new Error('svelte.config.js is required');
if (!files.some((file) => file.file === 'tools/prepare-license-runtime.mjs')) throw new Error('tools/prepare-license-runtime.mjs is required');
if (!files.some((file) => file.file.startsWith('src/'))) throw new Error('src files are required');

for (const migration of databaseMigrations) {
	const file = String(migration?.file || '').replaceAll('\\', '/');
	const packaged = files.find((item) => item.file === file);
	if (!packaged) throw new Error(`Database migration is missing from Base package: ${file}`);
	if (packaged.size !== Number(migration.size) || packaged.sha256 !== String(migration.sha256 || '').toLowerCase()) {
		throw new Error(`Database migration checksum mismatch: ${file}`);
	}
}

const projectSettings = {
	framework: 'sveltekit',
	buildCommand: 'npm run build',
	installCommand: 'npm ci'
};
const fileInventory = files.map(({ file, component, size, sha256 }) => ({ file, component, size, sha256 }));
const databaseContract = {
	format: 'orbitfs-base-database-snapshot-v1',
	schemaVersion: databaseSchemaVersion,
	path: databaseSchemaPath,
	sha256: databaseSchemaSha256,
	migrationCount: databaseMigrationCount,
	migrationRoot: databaseMigrationRoot,
	migrationRootSha256: databaseMigrationRootSha256,
	latestMigration: databaseLatestMigration,
	migrations: databaseMigrations,
	migrationChain: databaseMigrationChain
};
const databaseCompatibility = {
	mode: 'expand-contract',
	migrationMode: 'forward-only',
	automaticDestructiveMigrations: false,
	rollbackDatabase: 'not-supported'
};
const rollbackPolicy = {
	codeRollback: 'previous-successful-deployment',
	databaseRollback: 'forward-only-no-down-migrations'
};
const releaseLifecycle = {
	mode: 'single-current-per-channel',
	onPublish: 'supersede-previous-published-base',
	archiveSuperseded: true,
	hideSupersededByDefault: true,
	preserveRollbackHistory: true
};
const payload = {
	format: 'orbitfs-base-deployment-v2',
	schemaVersion: 2,
	version,
	baseVersion: version,
	releaseChannel,
	components: ['base'],
	componentVersions: { base: version },
	checkpointRequired: false,
	minimumEngineDeployerProtocol: 1,
	releaseId: `base-${version}`,
	sourceCommit,
	createdAt: new Date().toISOString(),
	projectSettings,
	fileCount: files.length,
	fileInventory,
	databaseSchemaVersion,
	databaseSchemaPath,
	databaseSchemaSha256,
	databaseMigrationCount,
	databaseMigrationRoot,
	databaseMigrationRootSha256,
	databaseLatestMigration,
	databaseMigrations,
	databaseMigrationChain,
	database: databaseContract,
	databaseCompatibility,
	rollbackPolicy,
	releaseLifecycle,
	releaseInfo: {
		format: 'orbitfs-base-deployment-v2',
		schemaVersion: 2,
		version,
		databaseSchemaVersion,
		databaseSchemaPath,
		databaseSchemaSha256,
		databaseMigrationCount,
		databaseMigrationRoot,
		databaseMigrationRootSha256,
		databaseLatestMigration,
		databaseMigrationChain,
		databaseCompatibility,
		rollbackPolicy,
		releaseLifecycle
	},
	files
};

const json = Buffer.from(JSON.stringify(payload));
const archive = gzipSync(json, { level: 9 });
writeFileSync(output, archive);
const sha256 = createHash('sha256').update(archive).digest('hex');
const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

console.log(JSON.stringify({
	ok: true,
	format: payload.format,
	schemaVersion: payload.schemaVersion,
	version,
	releaseChannel,
	components: payload.components,
	databaseSchemaVersion,
	databaseSchemaSha256,
	databaseMigrationCount,
	databaseLatestMigration,
	output: basename(output),
	sha256,
	fileCount: files.length,
	sourceBytes: totalBytes,
	archiveBytes: archive.byteLength
}, null, 2));
