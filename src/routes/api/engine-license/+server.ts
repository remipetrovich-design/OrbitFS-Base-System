import { createHmac, timingSafeEqual } from 'node:crypto';
import { json } from '@sveltejs/kit';
import { engineSharedSecret } from '$lib/server/runtime-secrets';
import { ensureInstallationIdentity, getPanelLicenseSummary } from '$lib/server/license';

function safeEqual(a:string,b:string){
	const left=Buffer.from(a),right=Buffer.from(b);
	return left.length===right.length&&left.length>0&&timingSafeEqual(left,right);
}

async function authorize(request:Request){
	const secret=engineSharedSecret();
	const suppliedSecret=String(request.headers.get('x-orbitfs-engine-secret')||'').trim();
	if(!secret||!safeEqual(suppliedSecret,secret))return false;
	const timestamp=String(request.headers.get('x-orbitfs-timestamp')||'').trim();
	const signature=String(request.headers.get('x-orbitfs-signature')||'').trim();
	const seconds=Number(timestamp);
	if(!timestamp||!signature||!Number.isFinite(seconds)||Math.abs(Date.now()-seconds*1000)>5*60*1000)return false;
	const expected=createHmac('sha256',secret).update(`${timestamp}.`).digest('hex');
	if(!safeEqual(signature,expected))return false;
	const installationId=await ensureInstallationIdentity();
	return safeEqual(String(request.headers.get('x-orbitfs-installation-id')||'').trim(),installationId);
}

export async function GET({request,url}:any){
	try{
		if(!await authorize(request))return json({ok:false,error:'Unauthorized',code:'ENGINE_LICENSE_UNAUTHORIZED'},{status:401});
		const refresh=['1','true','yes'].includes(String(url.searchParams.get('refresh')||'').toLowerCase());
		const summary=await getPanelLicenseSummary({refresh});
		return json({ok:true,summary},{headers:{'cache-control':'private, no-store'}});
	}catch(error:any){
		return json({ok:false,error:String(error?.message||'Base licence status failed'),code:String(error?.code||'ENGINE_LICENSE_STATUS_FAILED')},{status:Number(error?.status||500),headers:{'cache-control':'private, no-store'}});
	}
}
