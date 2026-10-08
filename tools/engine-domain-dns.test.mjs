import assert from 'node:assert/strict';
import test from 'node:test';
import { describeEngineDomainDns } from '../src/lib/server/engine-domain-dns.ts';

const dns=(domain, entry, config)=>describeEngineDomainDns(domain,entry,config);

test('subdomain uses the top-ranked Vercel CNAME and shows its DNS provider name',()=>{
	const result=dns('engine.example.com',{apexName:'example.com',verified:true},{misconfigured:false,recommendedCNAME:[{rank:2,value:'other.vercel-dns.com'},{rank:1,value:'project-specific.vercel-dns.com'}],recommendedIPv4:[{rank:1,value:['192.0.2.1']}]});
	assert.equal(result.ready,true);
	assert.deepEqual(result.records.map(({type,name,hostname,value})=>({type,name,hostname,value})),[{type:'CNAME',name:'engine',hostname:'engine.example.com',value:'project-specific.vercel-dns.com'}]);
});
test('apex root selects an A record and @ DNS host, never CNAME',()=>{
	const result=dns('example.com',{apexName:'example.com',verified:true},{misconfigured:false,recommendedIPv4:[{rank:1,value:['198.51.100.1','198.51.100.2']}],recommendedCNAME:[{rank:1,value:'ignore.example'}]});
	assert.deepEqual(result.records.map((record)=>[record.type,record.name,record.value]),[['A','@','198.51.100.1']]);
});
test('pending ownership gives an additional TXT challenge without treating DNS routing as verification',()=>{
	const result=dns('engine.example.com',{apexName:'example.com',verified:false,verification:[{type:'TXT',domain:'_vercel.example.com',value:'vc-domain-verify=example'}]},{misconfigured:false,recommendedCNAME:[{rank:1,value:'site.vercel-dns.com'}]});
	assert.deepEqual(result.records.map((record)=>[record.type,record.name,record.purpose]),[['CNAME','engine','routing'],['TXT','_vercel','verification']]);
	assert.equal(result.ready,false);
	assert.equal(result.ownershipVerified,false);
	assert.equal(result.dnsConfigured,true);
});
test('domain is not ready if Vercel reports routing misconfigured, even after ownership verification',()=>{
	const result=dns('engine.example.com',{apexName:'example.com',verified:true},{misconfigured:true,recommendedCNAME:[{rank:1,value:'site.vercel-dns.com'}]});
	assert.equal(result.ready,false);
	assert.equal(result.dnsConfigured,false);
});
test('missing config never invents DNS records or reports ready',()=>{
	const result=dns('engine.example.com',{apexName:'example.com',verified:true},null);
	assert.deepEqual(result.records,[]);
	assert.equal(result.hasRoutingRecommendation,false);
	assert.equal(result.dnsConfigured,null);
	assert.equal(result.ready,false);
});
test('does not guess record type for unknown apex when Vercel provides both A and CNAME',()=>{
	const result=dns('example.com',{verified:true},{misconfigured:false,recommendedCNAME:[{value:'name.vercel-dns.com'}],recommendedIPv4:[{value:['203.0.113.1']}]});
	assert.deepEqual(result.records,[]);
	assert.equal(result.ready,true); // Vercel confirms configured; absence of an inferred type must not invent a record.
});
test('verified ownership does not require an unnecessary TXT record',()=>{
	const result=dns('engine.example.com',{apexName:'example.com',verified:true,verification:[{type:'TXT',domain:'_vercel.example.com',value:'old'}]},{misconfigured:false,recommendedCNAME:[{value:'site.vercel-dns.com'}]});
	assert.equal(result.records.length,1);
	assert.equal(result.records[0].purpose,'routing');
});
