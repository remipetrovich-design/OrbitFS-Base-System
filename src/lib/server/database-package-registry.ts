import { createHash } from 'node:crypto';
import { getLicenseProviderSettings, getStoredLicenseCredential } from '$lib/server/license';

export type CustomerDatabaseComponent='base'|'engine-shared'|'mcp'|'apex'|'studio';

export type CustomerDatabasePackage={
	id:string;
	component:CustomerDatabaseComponent;
	databaseTarget:'customer';
	sourceRepo:string;
	sourceCommit:string;
	databaseSchemaVersion:number;
	minimumBaseSchemaVersion:number|null;
	minimumBaseVersion:string|null;
	sha256:string;
	publishedAt:string|null;
	payload:any;
};

const EXPECTED_REPO:Record<CustomerDatabaseComponent,string>={
	base:'lucaskerim123/V1-vercel-base',
	'engine-shared':'lucaskerim123/V1-vercel-engine',
	mcp:'lucaskerim123/V1-vercel-engine',
	apex:'lucaskerim123/V1-vercel-engine',
	studio:'lucaskerim123/V1-vercel-engine'
};

const MIGRATION_COMPONENT:Record<CustomerDatabaseComponent,string>={
	base:'base',
	'engine-shared':'shared',
	mcp:'mcp',
	apex:'apex',
	studio:'studio'
};

const MIGRATION_PATH:Record<CustomerDatabaseComponent,RegExp>={
	base:/^supabase\/migrations\/\d{14}_[A-Za-z0-9._-]+\.sql$/,
	'engine-shared':/^supabase\/migrations\/shared\/\d{14}_[A-Za-z0-9._-]+\.sql$/,
	mcp:/^supabase\/migrations\/mcp\/\d{14}_[A-Za-z0-9._-]+\.sql$/,
	apex:/^supabase\/migrations\/apex\/\d{14}_[A-Za-z0-9._-]+\.sql$/,
	studio:/^supabase\/migrations\/studio\/\d{14}_[A-Za-z0-9._-]+\.sql$/
};

function fail(code:string,status=502,message?:string){
	return Object.assign(new Error(message||code),{code,status});
}

function canonicalJson(value:any):string{
	if(value===null||typeof value!=='object')return JSON.stringify(value);
	if(Array.isArray(value))return '['+value.map((item)=>canonicalJson(item)).join(',')+']';
	return '{'+Object.keys(value).sort().map((key)=>JSON.stringify(key)+':'+canonicalJson(value[key])).join(',')+'}';
}

function sha256(bytes:Buffer){return createHash('sha256').update(bytes).digest('hex');}

async function registryUrl(component:CustomerDatabaseComponent){
	const {providerBase}=await getLicenseProviderSettings();
	const url=new URL(String(providerBase||'').trim());
	const path=url.pathname.replace(/\/+$/,'');
	if(url.protocol!=='https:'||!path.endsWith('/api/v1/license'))throw fail('DATABASE_PACKAGE_PROVIDER_INVALID',503);
	url.pathname=path.slice(0,-'/license'.length)+'/database-packages/'+component+'/current';
	url.search='';
	url.hash='';
	return url;
}

function validatePackage(component:CustomerDatabaseComponent,row:any):CustomerDatabasePackage{
	const payload=row?.payload;
	if(!row||typeof row!=='object'||!payload||typeof payload!=='object'||Array.isArray(payload))throw fail('DATABASE_PACKAGE_INVALID');
	if(String(row.component)!==component||String(row.databaseTarget)!=='customer')throw fail('DATABASE_PACKAGE_IDENTITY_MISMATCH');
	if(String(row.sourceRepo)!==EXPECTED_REPO[component]||String(payload.sourceRepo)!==EXPECTED_REPO[component])throw fail('DATABASE_PACKAGE_SOURCE_INVALID');
	if(String(payload.format)!=='orbitfs-customer-database-package-v1'||Number(payload.packageVersion)!==1)throw fail('DATABASE_PACKAGE_FORMAT_INVALID');
	if(String(payload.component)!==component||String(payload.databaseTarget)!=='customer')throw fail('DATABASE_PACKAGE_PAYLOAD_SCOPE_INVALID');
	if(String(payload.sourceCommit)!==String(row.sourceCommit)||!/^[a-f0-9]{40}$/.test(String(row.sourceCommit||'')))throw fail('DATABASE_PACKAGE_SOURCE_COMMIT_INVALID');
	if(Number(payload.databaseSchemaVersion)!==Number(row.databaseSchemaVersion)||!Number.isInteger(Number(row.databaseSchemaVersion))||Number(row.databaseSchemaVersion)<1)throw fail('DATABASE_PACKAGE_SCHEMA_VERSION_INVALID');

	const expectedDigest=String(row.sha256||'').trim().toLowerCase();
	const actualDigest=sha256(Buffer.from(canonicalJson(payload),'utf8'));
	if(!/^[a-f0-9]{64}$/.test(expectedDigest)||actualDigest!==expectedDigest)throw fail('DATABASE_PACKAGE_CHECKSUM_MISMATCH');

	const migrations=Array.isArray(payload.migrations)?payload.migrations:[];
	if(!migrations.length)throw fail('DATABASE_PACKAGE_MIGRATIONS_MISSING');
	const ids=new Set<string>();
	for(const migration of migrations){
		const id=String(migration?.id||'').trim();
		const file=String(migration?.file||'').trim().replaceAll('\\','/');
		const migrationComponent=String(migration?.component||'').trim().toLowerCase();
		if(!id||ids.has(id))throw fail('DATABASE_PACKAGE_MIGRATION_ID_INVALID');
		ids.add(id);
		if(!MIGRATION_PATH[component].test(file)||migrationComponent!==MIGRATION_COMPONENT[component])throw fail('DATABASE_PACKAGE_MIGRATION_SCOPE_INVALID');
		if(migration?.encoding!=='base64'||typeof migration?.data!=='string')throw fail('DATABASE_PACKAGE_MIGRATION_ENCODING_INVALID');
		const bytes=Buffer.from(migration.data,'base64');
		const digest=sha256(bytes);
		if(bytes.length<1||Number(migration.size)!==bytes.length||digest!==String(migration.sha256||'').trim().toLowerCase())throw fail('DATABASE_PACKAGE_MIGRATION_CHECKSUM_INVALID');
	}
	return {
		id:String(row.id||''),
		component,
		databaseTarget:'customer',
		sourceRepo:String(row.sourceRepo),
		sourceCommit:String(row.sourceCommit),
		databaseSchemaVersion:Number(row.databaseSchemaVersion),
		minimumBaseSchemaVersion:row.minimumBaseSchemaVersion==null?null:Number(row.minimumBaseSchemaVersion),
		minimumBaseVersion:row.minimumBaseVersion==null?null:String(row.minimumBaseVersion),
		sha256:expectedDigest,
		publishedAt:row.publishedAt==null?null:String(row.publishedAt),
		payload
	};
}

export async function fetchCurrentDatabasePackage(component:CustomerDatabaseComponent){
	const identity=await getStoredLicenseCredential();
	const response=await fetch(await registryUrl(component),{
		headers:{
			'x-license-key':identity.licenseKey,
			'x-installation-id':identity.installationId,
			'x-orbitfs-client':'orbitfs-base-database-deployer',
			accept:'application/json'
		},
		cache:'no-store',
		signal:AbortSignal.timeout(30_000)
	});
	const body:any=await response.json().catch(()=>({}));
	if(!response.ok||!body?.ok||!body?.package){
		throw fail(String(body?.code||'DATABASE_PACKAGE_FETCH_FAILED'),response.status||503);
	}
	return validatePackage(component,body.package);
}

export async function fetchEngineDatabasePackageSet(components:string[]){
	const selected=[...new Set((components||[]).map((value)=>String(value||'').trim().toLowerCase()).filter((value)=>['mcp','apex','studio'].includes(value)))] as Array<'mcp'|'apex'|'studio'>;
	if(!selected.length)throw fail('ENGINE_DATABASE_COMPONENT_REQUIRED',400);

	const packages=await Promise.all([
		fetchCurrentDatabasePackage('engine-shared'),
		...selected.map((component)=>fetchCurrentDatabasePackage(component))
	]);

	const migrations:any[]=[];
	const ids=new Set<string>();
	for(const pkg of packages){
		for(const migration of pkg.payload.migrations){
			const id=String(migration.id||'');
			if(ids.has(id))throw fail('DATABASE_PACKAGE_MIGRATION_ID_CONFLICT',409);
			ids.add(id);
			migrations.push(migration);
		}
	}

	migrations.sort((a,b)=>{
		const aName=String(a.file||'').split('/').at(-1)||String(a.file||'');
		const bName=String(b.file||'').split('/').at(-1)||String(b.file||'');
		return aName.localeCompare(bName)||String(a.file||'').localeCompare(String(b.file||''));
	});

	return {
		packages,
		database:{
			format:'orbitfs-db-migrations-v1',
			mode:'shared-panel',
			provider:'supabase',
			migrationCount:migrations.length,
			migrations
		}
	};
}