import { randomUUID } from 'node:crypto';
import https from 'node:https';
import { env } from '$env/dynamic/private';
import { getSupabaseAdmin } from '$lib/server/supabase';

export const PANEL_COMPONENT='orbitfs_base';
export const STABLE_LICENSE_COMPONENTS=['orbitfs_base','orbitfs_mcp','orbitfs_apex','orbitfs_studio'] as const;
const LICENSE_ID='primary';
const LICENSE_KEY_PATTERN=/^LIC-[A-Z0-9]{10}-[A-Z0-9]{10}-[A-Z0-9]{10}$/;
const ROW_CACHE_MS=5000, SUMMARY_CACHE_MS=3000;
type LicenseRow={id:string;license_key:string|null;status:string;plan:string|null;licensed_to:string|null;expires_at:string|null;metadata:Record<string,any>|null};
type PulseDirective={id:string;revision:number;action:string;scope:string;license_id?:string|null;installation_id?:string|null;product?:string|null;component?:string|null;reason?:string|null;payload?:Record<string,any>;requires_ack?:boolean};
export type PanelLicenseSummary={valid:boolean;licensed:boolean;enforcement:true;reason:string|null;status:string;keyHint:string|null;installationId:string;lastCheckedAt:string|null;lastRevisionCheckedAt:string|null;masterRevision:string|number|null;nextValidationAt:string|null;nextRevisionCheckAt:string|null;offlineGrace:boolean;refreshError:string|null;component:Record<string,any>;components:Record<string,any>;plan:string|null;licensedTo:string|null;expiresAt:string|null};
const TRUSTED_LICENSE_REGISTRY_ROOT='https://incendiarynetworks.cc/api/v1';
const TRUSTED_LICENSE_RUNTIME_URL='https://incendiarynetworks.cc/api/v1/license';
let officialProviderCache:{expires:number;connections:any[]}|null=null;
function describeFetchError(error:any){
  const cause=error?.cause;
  const parts=[
    error?.name ? `name=${String(error.name)}` : '',
    error?.message ? `message=${String(error.message)}` : '',
    cause?.code ? `cause.code=${String(cause.code)}` : '',
    cause?.errno !== undefined ? `cause.errno=${String(cause.errno)}` : '',
    cause?.syscall ? `cause.syscall=${String(cause.syscall)}` : '',
    cause?.hostname ? `cause.hostname=${String(cause.hostname)}` : ''
  ].filter(Boolean);
  return parts.join('; ') || 'unknown fetch failure';
}

const REDACTED_DETAIL_KEYS=/license[_-]?key|token|secret|authorization|password|credential/i;
function safeDiagnosticValue(value:any,depth=0):any{
  if(depth>4)return '[depth-limit]';
  if(value===null||value===undefined||typeof value==='number'||typeof value==='boolean')return value;
  if(typeof value==='string')return value.length>1000?value.slice(0,1000)+'…':value;
  if(Array.isArray(value))return value.slice(0,30).map((item)=>safeDiagnosticValue(item,depth+1));
  if(typeof value==='object'){
    const out:Record<string,any>={};
    for(const [key,item] of Object.entries(value).slice(0,60)){
      out[key]=REDACTED_DETAIL_KEYS.test(key)?'[redacted]':safeDiagnosticValue(item,depth+1);
    }
    return out;
  }
  return String(value);
}
function upstreamErrorDetails(endpoint:string,status:number,body:any){
  return {
    source:'License Manager '+endpoint,
    http_status:status,
    response:safeDiagnosticValue(body),
    response_keys:Object.keys(objectValue(body)).sort()
  };
}
function normalizeLicenseKey(value:string){const key=String(value||'').trim().toUpperCase();if(!LICENSE_KEY_PATTERN.test(key))throw Object.assign(new Error('Invalid OrbitFS license key format. Expected LIC-XXXXXXXXXX-XXXXXXXXXX-XXXXXXXXXX.'),{status:400,code:'LICENSE_KEY_FORMAT_INVALID'});return key;}
const timeoutMs=()=>Math.max(1000,Number(env.ORBITFS_LICENSE_TIMEOUT_MS||8000));
function identityMetadata(installationId:string,extra:Record<string,any>={}){let supabaseProjectRef:string|null=null;try{supabaseProjectRef=new URL(String(env.SUPABASE_URL||"")).hostname.split(".")[0]||null}catch{}return{installationId,product:"orbitfs_base",component:PANEL_COMPONENT,appVersion:String(env.ORBITFS_APP_VERSION||"unknown"),panelUrl:String(env.ORBITFS_PANEL_URL||""),deploymentUrl:String(env.VERCEL_URL||""),vercelEnvironment:String(env.VERCEL_ENV||"production"),vercelRegion:String(env.VERCEL_REGION||""),supabaseProjectRef,...extra};}
const keyHint=(k:string)=>LICENSE_KEY_PATTERN.test(String(k||'').trim().toUpperCase())?`LIC-••••••••••-••••••••••-${String(k).slice(-10).toUpperCase()}`:'****';
let rowCache:{value:LicenseRow|null;expires:number}|null=null;let summaryCache:{value:PanelLicenseSummary;expires:number}|null=null;
function normalizeProviderBase(value:string){
  const raw=String(value||'').trim().replace(/\/+$/,'');
  if(!raw) throw Object.assign(new Error('OrbitFS licence API URL is not configured'),{status:503,code:'LICENSE_MASTER_URL_MISSING'});
  try{
    const u=new URL(raw);
    const path=u.pathname.replace(/\/+$/,'');
    const host=u.hostname.toLowerCase();
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||(host!=='incendiarynetworks.cc'&&!host.endsWith('.incendiarynetworks.cc'))||path!=='/api/v1/license') throw new Error();
    return `${u.origin}/api/v1/license`;
  }catch{
    throw Object.assign(new Error('Licence API must be an official OrbitFS HTTPS /api/v1/license endpoint'),{status:503,code:'LICENSE_MASTER_URL_INVALID'});
  }
}
async function officialLicenseProviders(force=false){
  if(!force&&officialProviderCache&&officialProviderCache.expires>Date.now())return officialProviderCache.connections;
  let connections:any[]=[];
  try{
    const url=new URL(TRUSTED_LICENSE_REGISTRY_ROOT+'/api-connections');
    url.searchParams.set('client','v1_base');url.searchParams.set('service','license_runtime');
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(response.ok){
      const body=await response.json().catch(()=>({}));
      connections=(Array.isArray(body?.connections)?body.connections:[])
        .filter((row:any)=>row?.enabled!==false)
        .map((row:any)=>({...row,base_url:normalizeProviderBase(String(row.base_url||''))}))
        .filter((row:any)=>Boolean(row.base_url));
    }
  }catch{}
  if(!connections.length)connections=[{service_key:'license_runtime',label:'Primary OrbitFS licence runtime API',base_url:TRUSTED_LICENSE_RUNTIME_URL,enabled:true,priority:10,settings:{bootstrap:true}}];
  connections.sort((a:any,b:any)=>Number(a.priority||100)-Number(b.priority||100));
  officialProviderCache={expires:Date.now()+30000,connections};
  return connections;
}
async function requireOfficialProviderBase(value:string){
  const normalized=normalizeProviderBase(value);
  const official=await officialLicenseProviders(true);
  if(!official.some((row:any)=>String(row.base_url)===normalized))throw Object.assign(new Error('That URL is not an enabled official OrbitFS licence API.'),{status:400,code:'LICENSE_PROVIDER_NOT_OFFICIAL'});
  return normalized;
}
async function configuredProvider(){
  const official=await officialLicenseProviders();
  const allowed=new Set(official.map((row:any)=>String(row.base_url)));
  let selected=allowed.has(TRUSTED_LICENSE_RUNTIME_URL)?TRUSTED_LICENSE_RUNTIME_URL:String(official[0]?.base_url||TRUSTED_LICENSE_RUNTIME_URL);
  try{
    const row=await getRow();
    const saved=String(row?.metadata?.officialLicenseProviderBase||'').trim();
    if(saved){
      const normalized=normalizeProviderBase(saved);
      if(allowed.has(normalized))selected=normalized;
    }
  }catch{}
  return selected;
}
async function nodeHttpsRequest(url:string,init:RequestInit={},timeout=8000,family?:4):Promise<any>{
  const target=new URL(url);
  const method=String(init.method||'GET').toUpperCase();
  const body=typeof init.body==='string'?init.body:undefined;
  const headers:Record<string,string>={
    accept:'application/json',
    'content-type':'application/json',
    'user-agent':'OrbitFS-License-Client/1.0',
    'x-orbitfs-client':'orbitfs-base',
    ...(init.headers as Record<string,string>||{}),
  };
  if(body!==undefined)headers['content-length']=Buffer.byteLength(body).toString();
  return await new Promise((resolve,reject)=>{
    const request=https.request({
      protocol:target.protocol,
      hostname:target.hostname,
      port:target.port||443,
      path:`${target.pathname}${target.search}`,
      method,
      headers,
      servername:target.hostname,
      timeout,
      ...(family?{family}:{}),
    },response=>{
      let text='';
      response.setEncoding('utf8');
      response.on('data',chunk=>{text+=chunk;});
      response.on('end',()=>{
        let bodyJson:any={};
        try{bodyJson=text?JSON.parse(text):{};}catch{bodyJson={error:text||'License Master returned invalid JSON'};}
        const status=Number(response.statusCode||0);
        if(status<200||status>=300){reject(Object.assign(new Error(String(bodyJson?.error||'License Master returned HTTP '+status)),{status,code:String(bodyJson?.code||'LICENSE_MASTER_HTTP_ERROR'),details:upstreamErrorDetails(target.pathname+target.search,status,bodyJson)}));return;}
        resolve(bodyJson);
      });
    });
    request.once('timeout',()=>request.destroy(Object.assign(new Error('License Master request timed out'),{code:'LICENSE_MASTER_TIMEOUT'})));
    request.once('error',reject);
    if(body!==undefined)request.write(body);
    request.end();
  });
}

async function masterHttpsRequest(url:string,init:RequestInit={},timeout=8000):Promise<any>{
  let fetchError:any=null;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const headers:Record<string,string>={
      accept:'application/json',
      'content-type':'application/json',
      'user-agent':'OrbitFS-License-Client/1.0',
      'x-orbitfs-client':'orbitfs-base',
      ...(init.headers as Record<string,string>||{}),
    };
    const response=await fetch(url,{...init,method:String(init.method||'GET').toUpperCase(),headers,cache:'no-store',signal:controller.signal});
    const text=await response.text();
    let bodyJson:any={};
    try{bodyJson=text?JSON.parse(text):{};}catch{bodyJson={error:text||'License Master returned invalid JSON'};}
    const status=Number(response.status||0);
    if(status<200||status>=300)throw Object.assign(new Error(String(bodyJson?.error||'License Master returned HTTP '+status)),{status,code:String(bodyJson?.code||'LICENSE_MASTER_HTTP_ERROR'),details:upstreamErrorDetails(new URL(url).pathname+new URL(url).search,status,bodyJson)});
    return bodyJson;
  }catch(error:any){
    if(error?.name==='AbortError')fetchError=Object.assign(new Error('License Master request timed out'),{code:'LICENSE_MASTER_TIMEOUT'});
    else if(Number(error?.status||0)>=400&&Number(error?.status||0)<500&&![408,425,429].includes(Number(error?.status||0)))throw error;
    else fetchError=error;
  }finally{clearTimeout(timer);}

  let httpsError:any=null;
  try{return await nodeHttpsRequest(url,init,timeout);}
  catch(error:any){httpsError=error;}

  try{return await nodeHttpsRequest(url,init,timeout,4);}
  catch(error:any){
    const first=describeFetchError(fetchError);
    const second=describeFetchError(httpsError);
    const third=describeFetchError(error);
    throw Object.assign(new Error('native-fetch ['+first+'] ; node-https ['+second+'] ; node-https-ipv4 ['+third+']'),{
      status:Number(error?.status||httpsError?.status||fetchError?.status||503),
      code:String(error?.code||httpsError?.code||fetchError?.code||'LICENSE_MASTER_TRANSPORT_ERROR'),
      cause:error
    });
  }
}

async function masterRequest(path:string,init:RequestInit={}){
  const bases=[await configuredProvider()];
  let lastError:any=null;
  for(const base of bases){
    for(let attempt=0;attempt<2;attempt++){
      try{return await masterHttpsRequest(base+path,init,timeoutMs());}
      catch(error:any){
        lastError=Object.assign(new Error(describeFetchError(error)),{status:Number(error?.status||503),code:String(error?.code||'LICENSE_MASTER_TRANSPORT_ERROR'),details:error?.details ?? {
          source:'License Manager '+path,
          transport:describeFetchError(error)
        }});
        if(Number(error?.status||0)>=400&&Number(error?.status||0)<500)break;
        if(attempt===0)continue;
        break;
      }
    }
  }
  const detail=String(lastError?.message||lastError||'License Master request failed');
  throw Object.assign(new Error('License Master unavailable: '+detail),{status:Number(lastError?.status||503),code:String(lastError?.code||'LICENSE_MASTER_UNAVAILABLE'),details:lastError?.details ?? null});
}

const BLOCKING_STATES=new Set([
  'suspended','revoked','expired','installation_locked','installation_terminated','installation_released',
  'terminated','authority_disabled','system_disabled','licensing_disabled','maintenance_mode',
  'disabled','blocked'
]);

const COMPONENT_ONLY_DENIAL_CODES=new Set([
  'component_not_included','component_not_entitled','component_denied','component_disabled','component_not_licensed',
  'entitlement_not_included','entitlement_denied','addon_not_included','addon_not_licensed'
]);

function finiteSeconds(...values:any[]){
  for(const value of values){
    if(value===null||value===undefined||value==='')continue;
    const n=Number(value);
    if(Number.isFinite(n)&&n>=0)return n;
  }
  return null;
}
function finiteCount(...values:any[]){
  const n=finiteSeconds(...values);
  return n===null?null:Math.floor(n);
}

function objectValue(value:any){
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
}

function normalizedLicenseComponents(result:any,valid:boolean){
  const direct=objectValue(result?.components ?? result?.metadata?.components);
  const policy=objectValue(result?.metadata?.license_policy ?? result?.metadata?.licensePolicy);
  const entitlements=objectValue(policy.components);
  const directAvailable=Object.keys(direct).length>0;
  const source=directAvailable?direct:entitlements;
  if(!Object.keys(source).length)return null;
  const installation=objectValue(result?.installation);
  const installationState=normalizedState(installation.status ?? installation.state);
  const componentOnlyDenial=COMPONENT_ONLY_DENIAL_CODES.has(normalizedState(result?.code));
  const explicitlyReleased=['released','unlocked'].includes(installationState);
  const bound=!explicitlyReleased&&(
    installation.locked===true||
    installation.locked_to_this_installation===true||
    installation.lockedToThisInstallation===true||
    installationState==='locked'
  );
  const out:Record<string,any>={};
  for(const id of STABLE_LICENSE_COMPONENTS){
    const raw=source[id];
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
      const rawAllowed=raw.allowed===true||raw.entitled===true||['active','enabled','locked'].includes(normalizedState(raw.state||raw.status));
      const rawLocked=raw.lockedToThisInstallation===true||raw.locked_to_this_installation===true||raw.installation_locked===true||
        (rawAllowed&&bound&&!['released','unlocked','activation_required'].includes(normalizedState(raw.state||raw.status||raw.reason)));
      out[id]={
        ...raw,
        state:String(raw.state||raw.status||(rawAllowed?(rawLocked?(id===PANEL_COMPONENT?'active':'locked'):'enabled'):'blocked')),
        allowed:rawAllowed,
        lockedToThisInstallation:rawLocked,
        reason:rawAllowed?(rawLocked?null:String(raw.reason||'activation_required')):String(raw.reason||'not_included')
      };
      continue;
    }
    const allowed=id===PANEL_COMPONENT
      ? (valid||componentOnlyDenial||raw===true)
      : raw===true;
    out[id]=allowed
      ? {state:bound?(id===PANEL_COMPONENT?'active':'locked'):'enabled',allowed:true,lockedToThisInstallation:bound,reason:bound?null:'activation_required'}
      : {state:'blocked',allowed:false,lockedToThisInstallation:false,reason:'not_included'};
  }
  return out;
}

function runtimePolicy(result:any){
  const nested=objectValue(result?.runtime_policy ?? result?.runtimePolicy);
  const legacy=objectValue(result?.policy);
  const metadata=objectValue(result?.metadata);
  return {
    validationTtlSeconds:finiteSeconds(
      nested.validation_ttl_seconds,nested.validationTtlSeconds,
      legacy.validation_ttl_seconds,legacy.validationTtlSeconds,
      result?.validation_ttl_seconds,result?.validationTtlSeconds,
      metadata.validation_ttl_seconds,metadata.validationTtlSeconds
    ),
    offlineGraceSeconds:finiteSeconds(
      nested.offline_grace_seconds,nested.offlineGraceSeconds,
      legacy.offline_grace_seconds,legacy.offlineGraceSeconds,
      result?.offline_grace_seconds,result?.offlineGraceSeconds,
      result?.grace_seconds,result?.graceSeconds,
      metadata.offline_grace_seconds,metadata.offlineGraceSeconds,
      metadata.grace_seconds,metadata.graceSeconds
    ),
    pulsePollSeconds:finiteSeconds(
      nested.pulse_poll_seconds,nested.pulsePollSeconds,
      legacy.pulse_poll_seconds,legacy.pulsePollSeconds,
      result?.pulse_poll_seconds,result?.pulsePollSeconds,
      metadata.pulse_poll_seconds,metadata.pulsePollSeconds
    ),
    maxFailedValidations:finiteCount(
      nested.max_failed_validations,nested.maxFailedValidations,
      legacy.max_failed_validations,legacy.maxFailedValidations,
      result?.max_failed_validations,result?.maxFailedValidations,
      metadata.max_failed_validations,metadata.maxFailedValidations
    ),
    allowOfflineGrace:(()=>{
      const value=nested.allow_offline_grace ?? nested.allowOfflineGrace ??
        legacy.allow_offline_grace ?? legacy.allowOfflineGrace ??
        result?.allow_offline_grace ?? result?.allowOfflineGrace ??
        metadata.allow_offline_grace ?? metadata.allowOfflineGrace;
      return value===undefined||value===null?null:value===true;
    })()
  };
}

function pulseInfo(result:any){
  return {
    revision:result?.applicable_revision ?? result?.applicableRevision ?? result?.pulse_revision ?? result?.pulseRevision ?? result?.metadata?.pulse_revision ?? result?.metadata?.pulseRevision ?? null,
    globalRevision:result?.pulse_revision ?? result?.pulseRevision ?? null,
    at:result?.pulse_at ?? result?.pulseAt ?? result?.metadata?.pulse_at ?? result?.metadata?.pulseAt ?? null,
    reason:result?.pulse_reason ?? result?.pulseReason ?? result?.metadata?.pulse_reason ?? result?.metadata?.pulseReason ?? null
  };
}
function pulseDirectives(result:any):PulseDirective[]{
  const rows=Array.isArray(result?.directives)?result.directives:[];
  return rows
    .filter((item:any)=>item&&typeof item==='object'&&item.id&&Number.isFinite(Number(item.revision))&&item.action)
    .map((item:any)=>({
      id:String(item.id),
      revision:Number(item.revision),
      action:normalizedState(item.action),
      scope:normalizedState(item.scope||'global'),
      license_id:item.license_id?String(item.license_id):null,
      installation_id:item.installation_id?String(item.installation_id):null,
      product:item.product?String(item.product):null,
      component:item.component?String(item.component):null,
      reason:item.reason?String(item.reason):null,
      payload:objectValue(item.payload),
      requires_ack:item.requires_ack!==false
    }));
}
function pendingPulseDirectives(value:any):PulseDirective[]{
  return pulseDirectives({directives:Array.isArray(value)?value:[]});
}
async function acknowledgePulseDirective(
  row:LicenseRow,
  installationId:string,
  directive:PulseDirective,
  status:'received'|'applied'|'failed',
  resultCode:string|null=null,
  resultingState:string|null=null,
  error:string|null=null
){
  if(directive.requires_ack===false)return;
  const metadata=objectValue(row.metadata);
  try{
    await masterRequest('/pulse',{method:'POST',body:JSON.stringify({
      action:'ack',
      pulse_id:directive.id,
      revision:directive.revision,
      license_id:metadata.masterLicenseId||directive.license_id||null,
      installation_id:installationId,
      product:'orbitfs_base',
      component:PANEL_COMPONENT,
      client:'orbitfs-base',
      client_version:env.ORBITFS_APP_VERSION||'unknown',
      status,
      result_code:resultCode,
      resulting_license_state:resultingState,
      resulting_revision:directive.revision,
      error,
      details:{pulse_action:directive.action,pulse_scope:directive.scope}
    })});
  }catch{
    // Receipts are observability only. They must never override licence enforcement.
  }
}
async function acknowledgePulseDirectives(
  row:LicenseRow,
  installationId:string,
  directives:PulseDirective[],
  status:'received'|'applied'|'failed',
  resultCode:string|null=null,
  resultingState:string|null=null,
  error:string|null=null
){
  await Promise.all(directives.map((directive)=>acknowledgePulseDirective(row,installationId,directive,status,resultCode,resultingState,error)));
}

function normalizedState(value:any){
  return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_');
}
function exactBlockingState(value:any){
  const raw=normalizedState(value);
  return BLOCKING_STATES.has(raw)?raw:null;
}
function canonicalState(value:any){
  const raw=normalizedState(value);
  if(!raw)return null;
  const aliases:Record<string,string>={
    suspended:'suspended',license_suspended:'suspended',installation_suspended:'suspended',
    revoked:'revoked',license_revoked:'revoked',
    expired:'expired',license_expired:'expired',
    installation_locked:'installation_locked',
    terminated:'installation_terminated',installation_terminated:'installation_terminated',
    authority_disabled:'authority_disabled',
    system_disabled:'system_disabled',
    licensing_disabled:'licensing_disabled',
    maintenance:'maintenance_mode',maintenance_mode:'maintenance_mode',
    disabled:'disabled',blocked:'blocked'
  };
  return aliases[raw]||raw;
}

function authorityState(result:any){
  const authority=objectValue(result?.authority);
  const license=objectValue(result?.license);
  const installation=objectValue(result?.installation);
  if(authority.system_enabled===false||authority.systemEnabled===false)return 'system_disabled';
  if(authority.licensing_enabled===false||authority.licensingEnabled===false)return 'licensing_disabled';
  const maintenance=authority.maintenance_mode ?? authority.maintenanceMode;
  if(maintenance===true||['true','on','enabled','active','maintenance'].includes(String(maintenance||'').toLowerCase()))return 'maintenance_mode';
  if(result?.authority_enabled===false||result?.authorityEnabled===false)return 'authority_disabled';
  if(result?.suspended===true||license.suspended===true)return 'suspended';
  if(result?.revoked===true||license.revoked===true)return 'revoked';
  if(result?.expired===true||license.expired===true)return 'expired';
  // installation.locked=true means the licence is successfully bound to this installation.
  // Only explicit authority denial fields/codes represent an installation lock failure.
  if(result?.installation_locked===true||result?.installationLocked===true)return 'installation_locked';
  if(result?.installation_terminated===true||result?.installationTerminated===true||installation.terminated===true)return 'installation_terminated';

  const candidates=[
    result?.code,result?.status,result?.state,result?.license_status,result?.licenseStatus,
    result?.authority_state,result?.authorityState,result?.installation_state,result?.installationState,
    license?.status,license?.state,
    installation?.status,installation?.state,
    authority?.state
  ].map(canonicalState).filter(Boolean) as string[];
  const reasons=[license?.reason,installation?.reason,authority?.reason]
    .map(exactBlockingState).filter(Boolean) as string[];
  return [...candidates,...reasons].find((value)=>BLOCKING_STATES.has(value))||candidates[0]||null;
}

function resultValid(result:any){
  const state=authorityState(result);
  if(state&&BLOCKING_STATES.has(state))return false;
  return result?.valid===true;
}

function metadataPolicy(m:Record<string,any>){
  return {
    validationTtlSeconds:finiteSeconds(m.validationTtlSeconds),
    offlineGraceSeconds:finiteSeconds(m.offlineGraceSeconds),
    pulsePollSeconds:finiteSeconds(m.pulsePollSeconds),
    maxFailedValidations:finiteCount(m.maxFailedValidations),
    allowOfflineGrace:typeof m.allowOfflineGrace==='boolean'?m.allowOfflineGrace:null,
    pulseRevision:m.pulseRevision ?? null,
    pulseAt:typeof m.pulseAt==='string'?m.pulseAt:null,
    pulseReason:typeof m.pulseReason==='string'?m.pulseReason:null,
    lastRevisionCheckedAt:typeof m.lastRevisionCheckedAt==='string'?m.lastRevisionCheckedAt:null,
    lastAuthorityState:typeof m.lastAuthorityState==='string'?m.lastAuthorityState:null,
    lastAuthoritativeValid:m.lastAuthoritativeValid===true,
    failedValidationCount:Number.isFinite(Number(m.failedValidationCount))?Math.max(0,Number(m.failedValidationCount)):0,
    pulseValidationRequired:m.pulseValidationRequired===true,
    pendingPulseRevision:m.pendingPulseRevision ?? null,
    pendingPulseAuthorityState:typeof m.pendingPulseAuthorityState==='string'?m.pendingPulseAuthorityState:null,
    pendingPulseDirectives:pendingPulseDirectives(m.pendingPulseDirectives),
    lastValidationAttemptAt:typeof m.lastValidationAttemptAt==='string'?m.lastValidationAttemptAt:null
  };
}
function missingRuntimePolicy(policy:ReturnType<typeof metadataPolicy>){
  const missing:string[]=[];
  if(policy.validationTtlSeconds===null)missing.push('validation_ttl_seconds');
  if(policy.offlineGraceSeconds===null)missing.push('offline_grace_seconds');
  if(policy.pulsePollSeconds===null)missing.push('pulse_poll_seconds');
  if(policy.maxFailedValidations===null)missing.push('max_failed_validations');
  if(policy.allowOfflineGrace===null)missing.push('allow_offline_grace');
  return missing;
}
function missingRuntimePolicyFromResult(result:any){
  const policy=runtimePolicy(result);
  const missing:string[]=[];
  if(policy.validationTtlSeconds===null)missing.push('validation_ttl_seconds');
  if(policy.offlineGraceSeconds===null)missing.push('offline_grace_seconds');
  if(policy.pulsePollSeconds===null)missing.push('pulse_poll_seconds');
  if(policy.maxFailedValidations===null)missing.push('max_failed_validations');
  if(policy.allowOfflineGrace===null)missing.push('allow_offline_grace');
  return missing;
}

function runtimePolicyDiagnostic(result:any,missing:string[]){
  const policy=runtimePolicy(result);
  const runtime=objectValue(result?.runtime_policy ?? result?.runtimePolicy);
  const authority=objectValue(result?.authority);
  const pulse=pulseInfo(result);
  return {
    source:'License Manager POST /api/v1/license/validate',
    missing,
    parsed:{
      validation_ttl_seconds:policy.validationTtlSeconds,
      offline_grace_seconds:policy.offlineGraceSeconds,
      pulse_poll_seconds:policy.pulsePollSeconds,
      max_failed_validations:policy.maxFailedValidations,
      allow_offline_grace:policy.allowOfflineGrace
    },
    response:{
      valid:result?.valid ?? null,
      code:result?.code ?? null,
      status:result?.status ?? result?.state ?? null,
      top_level_keys:Object.keys(objectValue(result)).sort(),
      runtime_policy_keys:Object.keys(runtime).sort(),
      pulse_revision:pulse.revision,
      pulse_at:pulse.at,
      pulse_reason:pulse.reason,
      authority:{
        system_enabled:authority.system_enabled ?? authority.systemEnabled ?? null,
        licensing_enabled:authority.licensing_enabled ?? authority.licensingEnabled ?? null,
        maintenance_mode:authority.maintenance_mode ?? authority.maintenanceMode ?? null
      }
    }
  };
}
function runtimePolicyError(result:any,missing:string[]){
  return Object.assign(
    new Error('License Manager runtime policy is missing: '+missing.join(', ')),
    {
      status:503,
      code:'LICENSE_RUNTIME_POLICY_MISSING',
      details:runtimePolicyDiagnostic(result,missing)
    }
  );
}

function deadline(iso:string|null,seconds:number|null){
  if(!iso||seconds===null)return null;
  const t=Date.parse(iso);
  return Number.isFinite(t)?t+seconds*1000:null;
}
function isoAt(ms:number|null){return ms===null?null:new Date(ms).toISOString();}
function knownDenied(m:Record<string,any>){
  const state=canonicalState(m.lastAuthorityState);
  const pending=canonicalState(m.pendingPulseAuthorityState);
  return m.lastAuthoritativeValid===false||
    Boolean(state&&BLOCKING_STATES.has(state))||
    Boolean(pending&&BLOCKING_STATES.has(pending));
}
function isAuthoritativeHttpError(error:any){
  const status=Number(error?.status||0);
  return status>=400&&status<500&&![408,425,429].includes(status);
}
function errorAuthorityState(error:any){
  return canonicalState(error?.code)||canonicalState(error?.message)||'LICENSE_INVALID';
}

async function pollPulse(row:LicenseRow,installationId:string):Promise<{changed:boolean;row:LicenseRow}>{
  const m={...(row.metadata||{})},policy=metadataPolicy(m);
  if(policy.pulseValidationRequired)return {changed:true,row};
  if(policy.pulsePollSeconds===null)return {changed:false,row};
  const checked=policy.lastRevisionCheckedAt?Date.parse(policy.lastRevisionCheckedAt):NaN;
  if(Number.isFinite(checked)&&Date.now()-checked<policy.pulsePollSeconds*1000)return {changed:false,row};

  const checkedAt=new Date().toISOString();
  try{
    const params=new URLSearchParams({
      installation_id:installationId,
      product:'orbitfs_base',
      component:PANEL_COMPONENT,
      since_revision:String(policy.pulseRevision??0)
    });
    const licenseId=String(m.masterLicenseId||'').trim();
    if(licenseId)params.set('license_id',licenseId);
    const pulse=await masterRequest('/pulse?'+params.toString(),{method:'GET'});
    const pulsePolicy=runtimePolicy(pulse),pulseData=pulseInfo(pulse),pulseState=authorityState(pulse);
    const directives=pulseDirectives(pulse);
    const revisionChanged=pulseData.revision!==null&&(
      policy.pulseRevision===null||String(pulseData.revision)!==String(policy.pulseRevision)
    );
    const authorityChanged=Boolean(pulseState&&BLOCKING_STATES.has(pulseState));
    const changed=directives.length>0||revisionChanged||authorityChanged;
    if(directives.length)await acknowledgePulseDirectives(row,installationId,directives,'received');
    const nextMetadata={
      ...m,
      lastRevisionCheckedAt:checkedAt,
      pulseAt:typeof pulseData.at==='string'?pulseData.at:m.pulseAt||null,
      pulseReason:typeof pulseData.reason==='string'?pulseData.reason:m.pulseReason||null,
      ...(pulsePolicy.pulsePollSeconds!==null?{pulsePollSeconds:pulsePolicy.pulsePollSeconds}:{}),
      ...(pulsePolicy.validationTtlSeconds!==null?{validationTtlSeconds:pulsePolicy.validationTtlSeconds}:{}),
      ...(pulsePolicy.offlineGraceSeconds!==null?{offlineGraceSeconds:pulsePolicy.offlineGraceSeconds}:{}),
      ...(pulsePolicy.maxFailedValidations!==null?{maxFailedValidations:pulsePolicy.maxFailedValidations}:{}),
      ...(pulsePolicy.allowOfflineGrace!==null?{allowOfflineGrace:pulsePolicy.allowOfflineGrace}:{}),
      ...(changed?{
        pulseValidationRequired:true,
        pendingPulseRevision:pulseData.revision ?? policy.pulseRevision,
        pendingPulseAuthorityState:pulseState&&BLOCKING_STATES.has(pulseState)?pulseState:null,
        pendingPulseDirectives:directives
      }:{
        pulseRevision:pulseData.revision ?? policy.pulseRevision,
        pulseValidationRequired:false,
        pendingPulseRevision:null,
        pendingPulseAuthorityState:null,
        pendingPulseDirectives:[]
      })
    };
    const saved=(await saveRow({metadata:nextMetadata},row))!;
    return {changed,row:saved};
  }catch{
    // Record the poll attempt so a broken pulse endpoint cannot cause every incoming
    // request to hammer validation and exhaust max_failed_validations immediately.
    const saved=(await saveRow({metadata:{...m,lastRevisionCheckedAt:checkedAt}},row))!;
    return {changed:true,row:saved};
  }
}

async function saveValidationResult(row:LicenseRow,installationId:string,result:any,licenseKey:string,extraPatch:Record<string,any>={},options:{preserveExpiry?:boolean;componentUpdateOnly?:string}={}){
  const now=new Date().toISOString(),policy=runtimePolicy(result),state=authorityState(result),pulse=pulseInfo(result);
  const previous=metadataPolicy(row.metadata||{});
  const valid=resultValid(result);
  const installation=objectValue(result?.installation);
  const installationState=normalizedState(installation.status ?? installation.state);
  const installationLocked=
    installation.locked===true||
    installation.locked_to_this_installation===true||
    installation.lockedToThisInstallation===true||
    installationState==='locked';
  const m={
    ...(row.metadata||{}),...(result?.metadata||{}),
    installationId,
    installationLockedToThisInstallation:installationLocked,
    masterLicenseId:result?.license_id||row.metadata?.masterLicenseId||null,
    lastCheckedAt:now,
    lastRevisionCheckedAt:now,
    keyHint:keyHint(licenseKey),
    validationTtlSeconds:policy.validationTtlSeconds ?? previous.validationTtlSeconds,
    offlineGraceSeconds:policy.offlineGraceSeconds ?? previous.offlineGraceSeconds,
    allowOfflineGrace:policy.allowOfflineGrace ?? previous.allowOfflineGrace,
    pulseRevision:pulse.revision ?? previous.pendingPulseRevision ?? previous.pulseRevision,
    pulseAt:typeof pulse.at==='string'?pulse.at:previous.pulseAt,
    pulseReason:typeof pulse.reason==='string'?pulse.reason:previous.pulseReason,
    pulsePollSeconds:policy.pulsePollSeconds ?? previous.pulsePollSeconds,
    maxFailedValidations:policy.maxFailedValidations ?? previous.maxFailedValidations,
    failedValidationCount:0,
    lastValidationAttemptAt:now,
    pulseValidationRequired:false,
    pendingPulseRevision:null,
    pendingPulseAuthorityState:null,
    pendingPulseDirectives:[],
    components:(()=>{
      const normalized=normalizedLicenseComponents(result,valid);
      if(!normalized)return row.metadata?.components;
      const target=normalizedState(options.componentUpdateOnly);
      if(!target)return normalized;
      const previous=objectValue(row.metadata?.components);
      return {...previous,...(normalized[target]?{[target]:normalized[target]}:{})};
    })(),
    lastAuthorityState:state||(valid?'active':'invalid'),
    lastAuthoritativeValid:valid
  };
  const invalidState=state&&BLOCKING_STATES.has(state)?state:String(result?.code||'invalid').toLowerCase();
  return saveRow({
    ...extraPatch,
    status:valid?'active':invalidState,
    plan:m.plan||row.plan||null,
    licensed_to:m.licensedTo||row.licensed_to||null,
    expires_at:options.preserveExpiry?row.expires_at:(result?.expires_at ?? result?.expiresAt ?? null),
    metadata:m
  },row);
}

async function saveAuthoritativeFailure(row:LicenseRow,installationId:string,error:any){
  const state=errorAuthorityState(error),now=new Date().toISOString(),previous=metadataPolicy(row.metadata||{});
  const m={
    ...(row.metadata||{}),
    installationId,
    lastCheckedAt:now,
    lastRevisionCheckedAt:now,
    lastAuthorityState:state,
    lastAuthoritativeValid:false,
    failedValidationCount:0,
    lastValidationAttemptAt:now,
    pulseRevision:previous.pendingPulseRevision ?? previous.pulseRevision,
    pulseValidationRequired:false,
    pendingPulseRevision:null,
    pendingPulseAuthorityState:null,
    pendingPulseDirectives:[]
  };
  return saveRow({status:String(state).toLowerCase(),metadata:m},row);
}

async function saveTransportFailure(row:LicenseRow):Promise<LicenseRow>{
  const policy=metadataPolicy(row.metadata||{});
  const next=policy.failedValidationCount+1;
  return (await saveRow({metadata:{
    ...(row.metadata||{}),
    failedValidationCount:next,
    lastValidationAttemptAt:new Date().toISOString()
  }},row))!;
}

async function getRow(force=false){if(!force&&rowCache&&rowCache.expires>Date.now())return rowCache.value;const {data,error}=await getSupabaseAdmin().from('orbitfs_license').select('id,license_key,status,plan,licensed_to,expires_at,metadata').eq('id',LICENSE_ID).maybeSingle();if(error)throw error;rowCache={value:data as LicenseRow|null,expires:Date.now()+ROW_CACHE_MS};return rowCache.value;}
async function saveRow(patch:Record<string,any>,row?:LicenseRow|null):Promise<LicenseRow>{const s=getSupabaseAdmin();const current=row===undefined?await getRow():row;const payload={...patch,updated_at:new Date().toISOString()};if(current){const {error}=await s.from('orbitfs_license').update(payload).eq('id',LICENSE_ID);if(error)throw error;rowCache={value:{...current,...patch,id:LICENSE_ID} as LicenseRow,expires:Date.now()+ROW_CACHE_MS};}else{const inserted={id:LICENSE_ID,license_key:null,status:'unconfigured',plan:null,licensed_to:null,expires_at:null,metadata:{},...patch};const {error}=await s.from('orbitfs_license').upsert(inserted,{onConflict:'id',ignoreDuplicates:true});if(error)throw error;const {data:actual,error:readError}=await s.from('orbitfs_license').select('id,license_key,status,plan,licensed_to,expires_at,metadata').eq('id',LICENSE_ID).maybeSingle();if(readError)throw readError;if(!actual)throw new Error('Unable to establish the local OrbitFS license record');rowCache={value:actual as LicenseRow,expires:Date.now()+ROW_CACHE_MS};}summaryCache=null;return rowCache.value as LicenseRow;}
async function installation(row:LicenseRow|null){const m={...(row?.metadata||{})};if(m.installationId)return {id:String(m.installationId),row};const provided=String(env.ORBITFS_INSTALLATION_ID||'').trim();if(provided&&!/^ofs[-_][A-Za-z0-9._:-]{8,128}$/.test(provided))throw Object.assign(new Error('Configured OrbitFS installation identity is invalid'),{status:500,code:'INSTALLATION_ID_INVALID'});const id=provided||`ofs-${randomUUID()}`;return {id,row:await saveRow({metadata:{...m,installationId:id,installationCreatedAt:new Date().toISOString(),installationIdentitySource:provided?'deployment':'generated'}},row)};}
export async function ensureInstallationIdentity(){return (await installation(await getRow())).id;}
export async function getStoredLicenseCredential(){const row=await getRow();const i=await installation(row);const key=String(i.row?.license_key||'').trim();if(!key)throw Object.assign(new Error('Activate the OrbitFS licence before requesting release data.'),{status:409,code:'LICENSE_KEY_REQUIRED'});return {installationId:i.id,licenseKey:key};}
function components(valid:boolean,m:Record<string,any>){const supplied=m.components&&typeof m.components==='object'?m.components:{};const out:Record<string,any>={};for(const id of STABLE_LICENSE_COMPONENTS){const x=supplied[id];const locked=m.installationLockedToThisInstallation===true;out[id]=x&&typeof x==='object'?x:{state:id===PANEL_COMPONENT&&valid?(locked?'active':'enabled'):'blocked',allowed:id===PANEL_COMPONENT&&valid,lockedToThisInstallation:id===PANEL_COMPONENT&&valid&&locked,reason:id===PANEL_COMPONENT&&valid?(locked?null:'activation_required'):'not_included'};}return out;}
export function componentLicensed(c:Record<string,any>){return c?.allowed===true&&c?.lockedToThisInstallation===true&&['active','enabled','locked'].includes(String(c?.state||''));}
function makeSummary(row:LicenseRow|null,valid:boolean,reason:string|null,extra:any={}):PanelLicenseSummary{
  const m={...(row?.metadata||{})},policy=metadataPolicy(m);
  const checked=typeof m.lastCheckedAt==='string'?m.lastCheckedAt:null;
  const ttlDeadline=deadline(checked,policy.validationTtlSeconds);
  const revisionChecked=policy.lastRevisionCheckedAt;
  const nextRevision=deadline(revisionChecked,policy.pulsePollSeconds);
  const cs=components(valid,m),component=cs[PANEL_COMPONENT];
  return {
    valid,
    licensed:valid&&componentLicensed(component),
    enforcement:true,
    reason:valid&&componentLicensed(component)?null:reason||component.reason||'LICENSE_REQUIRED',
    status:valid?'active':row?.status||'unconfigured',
    keyHint:typeof m.keyHint==='string'?m.keyHint:null,
    installationId:String(m.installationId||''),
    lastCheckedAt:checked,
    lastRevisionCheckedAt:revisionChecked,
    masterRevision:policy.pulseRevision,
    nextValidationAt:isoAt(ttlDeadline),
    nextRevisionCheckAt:isoAt(nextRevision),
    offlineGrace:false,
    refreshError:null,
    component,components:cs,
    plan:row?.plan||null,
    licensedTo:row?.licensed_to||null,
    expiresAt:row?.expires_at||null,
    ...extra
  };
}

function summaryCacheExpiry(summary:PanelLicenseSummary){
  const now=Date.now();
  const deadlines=[summary.nextValidationAt,summary.nextRevisionCheckAt,summary.expiresAt]
    .map((value)=>value?Date.parse(value):NaN)
    .filter(Number.isFinite) as number[];
  const remaining=deadlines.length?Math.max(0,Math.min(...deadlines)-now):SUMMARY_CACHE_MS;
  return now+Math.min(SUMMARY_CACHE_MS,remaining);
}
function cacheSummary(summary:PanelLicenseSummary){
  summaryCache={value:summary,expires:summaryCacheExpiry(summary)};
  return summary;
}

export async function getPanelLicenseSummary(options:{refresh?:boolean}={}):Promise<PanelLicenseSummary>{
  if(!options.refresh&&summaryCache&&summaryCache.expires>Date.now())return summaryCache.value;

  let row:LicenseRow|null=null;
  let i:{id:string;row:LicenseRow|null};
  try{
    row=await getRow(Boolean(options.refresh));
    i=await installation(row);
  }catch(error:any){
    const detail=describeFetchError(error),code=String(error?.code||'BASE_DATABASE_UNAVAILABLE');
    const message=String(error?.message||error||'Base database request failed');
    return cacheSummary({
      valid:false,licensed:false,enforcement:true,reason:code,status:'unavailable',keyHint:null,
      installationId:'',lastCheckedAt:null,lastRevisionCheckedAt:null,masterRevision:null,
      nextValidationAt:null,nextRevisionCheckAt:null,offlineGrace:false,
      refreshError:code+': '+detail+(message===detail?'':' ('+message+')'),
      component:{state:'blocked',allowed:false,lockedToThisInstallation:false,reason:code},
      components:{},plan:null,licensedTo:null,expiresAt:null
    });
  }

  let current=i.row||row;
  if(current&&current.license_key&&!LICENSE_KEY_PATTERN.test(String(current.license_key).trim().toUpperCase())){
    return cacheSummary(makeSummary(current,false,'LICENSE_KEY_FORMAT_INVALID'));
  }
  if(!current||!current.license_key)return cacheSummary(makeSummary(current,false,'not_activated'));
  const currentLicenseKey=current.license_key;

  let pulseChanged=false;
  if(!options.refresh){
    const pulse=await pollPulse(current,i.id);
    current=pulse.row;
    pulseChanged=pulse.changed;
  }

  let m={...(current.metadata||{})},policy=metadataPolicy(m);
  const missingPolicy=missingRuntimePolicy(policy);
  const policyBootstrapNeeded=missingPolicy.length>0&&!policy.lastValidationAttemptAt;
  if(!options.refresh&&missingPolicy.length&&!policyBootstrapNeeded&&!pulseChanged){
    return cacheSummary(makeSummary(current,false,'LICENSE_RUNTIME_POLICY_MISSING',{
      refreshError:'License Manager runtime_policy is missing: '+missingPolicy.join(', ')
    }));
  }
  const checked=typeof m.lastCheckedAt==='string'?m.lastCheckedAt:null;
  const ttlUntil=deadline(checked,policy.validationTtlSeconds);
  const expiresAt=current.expires_at?Date.parse(current.expires_at):NaN;
  const locallyExpired=Number.isFinite(expiresAt)&&Date.now()>=expiresAt;
  const denied=knownDenied(m);
  const ttlValid=ttlUntil!==null&&Date.now()<ttlUntil&&!locallyExpired&&current.status==='active'&&policy.lastAuthoritativeValid&&!denied;
  let mustValidate=Boolean(options.refresh||pulseChanged||policy.pulseValidationRequired||policyBootstrapNeeded||locallyExpired||(!denied&&!ttlValid));

  if(mustValidate&&!options.refresh&&!locallyExpired&&policy.failedValidationCount>0){
    const retryMs=policy.pulsePollSeconds===null?0:policy.pulsePollSeconds*1000;
    const lastAttempt=policy.lastValidationAttemptAt?Date.parse(policy.lastValidationAttemptAt):NaN;
    if(retryMs>0&&Number.isFinite(lastAttempt)&&Date.now()-lastAttempt<retryMs)mustValidate=false;
  }

  if(!mustValidate){
    if(denied){
      return cacheSummary(makeSummary(current,false,String(m.pendingPulseAuthorityState||m.lastAuthorityState||current.status||'LICENSE_INVALID')));
    }
    if(ttlValid)return cacheSummary(makeSummary(current,true,null));

    const baseDeadline=deadline(checked,policy.validationTtlSeconds);
    const graceUntil=baseDeadline===null||policy.offlineGraceSeconds===null
      ? null
      : baseDeadline+policy.offlineGraceSeconds*1000;
    const failureBudgetOk=policy.maxFailedValidations===null
      ? true
      : policy.failedValidationCount<=policy.maxFailedValidations;
    const mayGrace=policy.allowOfflineGrace===true&&policy.lastAuthoritativeValid&&!knownDenied(m)&&!locallyExpired&&
      failureBudgetOk&&graceUntil!==null&&Date.now()<graceUntil;
    return cacheSummary(makeSummary(current,mayGrace,mayGrace?null:'LICENSE_MASTER_UNAVAILABLE',{
      offlineGrace:mayGrace
    }));
  }

  const pendingDirectives=policy.pendingPulseDirectives;

  try{
    const result=await masterRequest('/validate',{method:'POST',body:JSON.stringify({
      action:'validate',
      license_key:currentLicenseKey,
      product:'orbitfs_base',
      component:PANEL_COMPONENT,
      installation_id:i.id,
      product_version:env.ORBITFS_APP_VERSION||'cloud',
      metadata:identityMetadata(i.id)
    })});
    const saved=await saveValidationResult(current,i.id,result,currentLicenseKey);
    const valid=resultValid(result);
    const savedPolicy=metadataPolicy(saved?.metadata||{});
    const missingSavedPolicy=missingRuntimePolicy(savedPolicy);
    if(valid&&missingSavedPolicy.length){
      const diagnostic=runtimePolicyDiagnostic(result,missingSavedPolicy);
      await acknowledgePulseDirectives(saved,i.id,pendingDirectives,'failed','LICENSE_RUNTIME_POLICY_MISSING','blocked','Runtime policy missing after validation');
      return cacheSummary(makeSummary(saved,false,'LICENSE_RUNTIME_POLICY_MISSING',{
        refreshError:'License Manager runtime_policy is missing: '+missingSavedPolicy.join(', ')+' | diagnostic='+JSON.stringify(diagnostic)
      }));
    }
    const reason=valid?null:String(authorityState(result)||result?.code||'LICENSE_INVALID');
    if(valid&&pendingDirectives.some((directive)=>directive.action==='request_check_in')){
      await recordLicenseManagerCheckIn({action:'check_in',phase:'completed',product:'orbitfs_base',productVersion:env.ORBITFS_APP_VERSION||'cloud',client:'orbitfs-base',clientVersion:env.ORBITFS_APP_VERSION||null,details:{source:'license-pulse'}});
    }
    await acknowledgePulseDirectives(saved,i.id,pendingDirectives,'applied',String(result?.code||'LICENSE_VALID'),valid?'active':reason);
    return cacheSummary(makeSummary(saved,valid,reason));
  }catch(error:any){
    if(isAuthoritativeHttpError(error)){
      const state=String(errorAuthorityState(error));
      const saved=await saveAuthoritativeFailure(current,i.id,error);
      await acknowledgePulseDirectives(saved,i.id,pendingDirectives,'applied',state,state);
      return cacheSummary(makeSummary(saved,false,state));
    }

    const failed=await saveTransportFailure(current);
    m={...(failed.metadata||{})};
    policy=metadataPolicy(m);

    const baseDeadline=deadline(
      typeof m.lastCheckedAt==='string'?m.lastCheckedAt:null,
      policy.validationTtlSeconds
    );
    const graceUntil=baseDeadline===null||policy.offlineGraceSeconds===null
      ? null
      : baseDeadline+policy.offlineGraceSeconds*1000;

    const failureBudgetOk=policy.maxFailedValidations===null
      ? true
      : policy.failedValidationCount<=policy.maxFailedValidations;

    const mayGrace=
      policy.allowOfflineGrace===true &&
      policy.lastAuthoritativeValid &&
      !knownDenied(m) &&
      !locallyExpired &&
      failureBudgetOk &&
      graceUntil!==null &&
      Date.now()<graceUntil;

    const detail=describeFetchError(error),code=String(error?.code||'LICENSE_MASTER_UNAVAILABLE');
    await acknowledgePulseDirectives(failed,i.id,pendingDirectives,'failed',code,mayGrace?'offline_grace':'unavailable',detail);
    return cacheSummary(makeSummary(failed,mayGrace,mayGrace?null:code,{
      offlineGrace:mayGrace,
      refreshError:`${code}: ${detail}`
    }));
  }
}

export async function activatePanelLicense(licenseKey:string){
  const key=normalizeLicenseKey(licenseKey);let row:LicenseRow|null=null;let i:{id:string;row:LicenseRow|null};
  try{row=await getRow();i=await installation(row);}
  catch(error:any){throw Object.assign(new Error('Base database unavailable: '+describeFetchError(error)),{status:503,code:'BASE_DATABASE_UNAVAILABLE',cause:error});}

  // A licence key may be unlocked, rotated or replaced without changing the OrbitFS installation identity.
  // Activation always reuses the deployment's persistent installation id; identity rotation belongs to an
  // explicit uninstall/reinstall lifecycle, never ordinary licence activation.
  const result=await masterRequest('/validate',{method:'POST',body:JSON.stringify({
    action:'activate',license_key:key,product:'orbitfs_base',component:PANEL_COMPONENT,installation_id:i.id,
    product_version:env.ORBITFS_APP_VERSION||'cloud',metadata:identityMetadata(i.id)
  })});

  if(!resultValid(result))throw Object.assign(new Error(authorityState(result)||result?.code||'LICENSE_INVALID'),{status:Number(result?.status||403),code:String(authorityState(result)||result?.code||'LICENSE_INVALID')});
  const missingPolicy=missingRuntimePolicyFromResult(result);
  if(missingPolicy.length)throw runtimePolicyError(result,missingPolicy);

  const base=i.row||{id:LICENSE_ID,license_key:key,status:'unconfigured',plan:null,licensed_to:null,expires_at:null,metadata:{}} as LicenseRow;
  const saved=await saveValidationResult({...base,license_key:key},i.id,result,key,{license_key:key});
  const summary=makeSummary(saved,true,null);
  if(!summary.licensed||summary.component?.lockedToThisInstallation!==true){
    throw Object.assign(new Error('License Manager accepted the licence but did not lock it to this OrbitFS installation.'),{status:409,code:'LICENSE_INSTALLATION_LOCK_REQUIRED'});
  }
  summaryCache=null;return summary;
}
export async function clearPanelLicense(){const row=await getRow();const i=await installation(row);const m={...(i.row?.metadata||{})};const saved=await saveRow({license_key:null,status:'unconfigured',plan:null,licensed_to:null,expires_at:null,metadata:{installationId:i.id,installationCreatedAt:m.installationCreatedAt||new Date().toISOString()}},i.row);summaryCache=null;return makeSummary(saved,false,'not_activated');}
export async function resetPanelLicenseInstallationState(){
  const s=getSupabaseAdmin();
  const removed=await s.from('orbitfs_license').delete().eq('id',LICENSE_ID);
  if(removed.error)throw removed.error;
  rowCache=null;
  summaryCache=null;
  return {reset:true};
}
export async function activateLicenseComponent(componentId:string){
  const component=normalizedState(componentId);
  if(!STABLE_LICENSE_COMPONENTS.includes(component as any))throw Object.assign(new Error('Unknown OrbitFS licence component'),{status:400,code:'LICENSE_COMPONENT_INVALID'});
  const row=await getRow();const i=await installation(row);if(!i.row?.license_key)return makeSummary(i.row,false,'not_activated');

  const request=(action:'activate'|'validate')=>masterRequest('/validate',{method:'POST',body:JSON.stringify({
    action,license_key:i.row!.license_key,product:'orbitfs_base',component,installation_id:i.id,
    product_version:env.ORBITFS_APP_VERSION||'cloud',metadata:identityMetadata(i.id,{requestedComponent:component})
  })});

  let result=await request('activate');
  let state=authorityState(result);
  if(state&&BLOCKING_STATES.has(state)){
    const saved=await saveValidationResult(i.row,i.id,result,i.row.license_key,{}, {preserveExpiry:true,componentUpdateOnly:component});
    return makeSummary(saved,false,state);
  }

  let saved=await saveValidationResult(i.row,i.id,result,i.row.license_key,{}, {preserveExpiry:true});
  let summary=makeSummary(saved,resultValid(result),resultValid(result)?null:String(result?.code||state||'LICENSE_INVALID'));
  let requested=objectValue(summary.components?.[component]);

  // Activation is complete only when the authority confirms this component is
  // entitled and locked to this exact persistent OrbitFS installation.
  if(!(componentLicensed(requested)&&requested.lockedToThisInstallation===true&&requested.reason!=='activation_required')){
    result=await request('validate');
    state=authorityState(result);
    saved=await saveValidationResult(saved,i.id,result,i.row.license_key,{}, {preserveExpiry:true,componentUpdateOnly:component});
    summary=makeSummary(saved,resultValid(result),resultValid(result)?null:String(result?.code||state||'LICENSE_INVALID'));
    requested=objectValue(summary.components?.[component]);
  }

  if(!resultValid(result)||!componentLicensed(requested)){
    throw Object.assign(new Error(String(requested.reason||result?.code||state||'This licence does not include the requested OrbitFS component')),{status:403,code:String(result?.code||'LICENSE_COMPONENT_NOT_ENTITLED')});
  }
  if(requested.lockedToThisInstallation!==true){
    throw Object.assign(new Error('License Manager did not lock the requested component to this OrbitFS installation.'),{status:409,code:'LICENSE_COMPONENT_LOCK_REQUIRED'});
  }
  summaryCache=null;
  return summary;
}
export async function assertPanelLicensed(){const s=await getPanelLicenseSummary();if(!s.licensed)throw Object.assign(new Error(s.reason||'Valid OrbitFS Base license required'),{status:403,code:s.reason||'LICENSE_REQUIRED'});return s;}
export async function getLicenseProviderSettings(){
 const [official,providerBase]=await Promise.all([officialLicenseProviders(true),configuredProvider()]);
 return {providerBase,allowedProviderBases:official.map((row:any)=>row.base_url),officialConnections:official,configured:true,apiConfigured:true,apiTokenConfigured:false,mode:'license-master-v2',product:PANEL_COMPONENT,registryAuthority:TRUSTED_LICENSE_REGISTRY_ROOT};
}
export async function setLicenseProviderBase(value:string){
 const providerBase=await requireOfficialProviderBase(value);
 const row=await getRow();
 const metadata={...(row?.metadata||{}),officialLicenseProviderBase:providerBase,officialLicenseProviderSelectedAt:new Date().toISOString()};
 await saveRow({metadata},row);
 summaryCache=null;
 return getLicenseProviderSettings();
}
export async function getLicenseProviderDiagnostics(candidate?:string){
 const providerBase=candidate?await requireOfficialProviderBase(candidate):await configuredProvider();
 const result:any={providerBase,apiTokenConfigured:false,database:{ok:false,error:null},master:{ok:false,status:null,error:null},installationId:null};
 try{const row=await getRow();result.database={ok:true,error:null};result.installationId=(await installation(row)).id;}catch(e:any){result.database={ok:false,error:String(e?.message||e)}}
 try{const health=await masterHttpsRequest(providerBase+'/health',{method:'GET'},timeoutMs());result.master={ok:Boolean(health?.ok??true),status:200,error:null,health};}
 catch(e:any){result.master={ok:false,status:Number(e?.status||503),error:String(e?.message||e),code:String(e?.code||'LICENSE_MASTER_UNAVAILABLE')}}
 return result;
}

export async function recordLicenseManagerCheckIn(input:{
  action:'deploy'|'update'|'redeploy'|'rollback'|'check_in';
  phase:'started'|'completed'|'failed';
  product?:string;
  productVersion?:string|null;
  previousVersion?:string|null;
  releaseId?:string|null;
  deploymentId?:string|null;
  deploymentUrl?:string|null;
  projectId?:string|null;
  projectName?:string|null;
  provider?:string|null;
  region?:string|null;
  platform?:string|null;
  architecture?:string|null;
  hostname?:string|null;
  client?:string|null;
  clientVersion?:string|null;
  customerIdentity?:Record<string,unknown>|null;
  details?:Record<string,unknown>;
}) {
  const row=await getRow(true);
  const identity=await installation(row);
  const licenseKey=String(row?.license_key||'').trim();
  const licenseId=String(row?.metadata?.masterLicenseId||'').trim();
  if(!licenseKey)return {ok:false,skipped:true,reason:'LICENSE_KEY_NOT_CONFIGURED'};
  try {
    const response=await masterRequest('/validate',{method:'POST',body:JSON.stringify({
      action:'check_in',license_key:licenseKey,...(licenseId?{license_id:licenseId}:{}),installation_id:identity.id,deployment_action:input.action,phase:input.phase,
      product:input.product||PANEL_COMPONENT,product_version:input.productVersion||env.ORBITFS_APP_VERSION||'unknown',
      previous_version:input.previousVersion||null,release_id:input.releaseId||null,deployment_id:input.deploymentId||null,
      deployment_url:input.deploymentUrl||env.VERCEL_URL||null,project_id:input.projectId||null,project_name:input.projectName||null,
      provider:input.provider||'vercel',region:input.region||env.VERCEL_REGION||null,platform:input.platform||'vercel',
      architecture:input.architecture||null,hostname:input.hostname||null,client:input.client||'orbitfs-base-deployer',
      client_version:input.clientVersion||env.ORBITFS_APP_VERSION||null,customer_identity:input.customerIdentity||null,
      details:input.details||{}
    })});
    const state=authorityState(response);
    if(row?.license_key&&state&&BLOCKING_STATES.has(state)){
      await saveValidationResult(row,identity.id,response,row.license_key);
    }
    return response;
  } catch(error:any) {
    return {ok:false,skipped:false,error:String(error?.message||error)};
  }
}
