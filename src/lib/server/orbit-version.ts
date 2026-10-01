export type OrbitVersion={
 prefix:'v'|'b'|'d'|null;
 parts:number[];
 prerelease:string|null;
 rank:number;
 raw:string;
};

const VERSION_PATTERN=/^([vVbBdD])?\.?(\d+(?:\.\d+){0,7})(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseOrbitVersion(value:unknown):OrbitVersion|null{
 const raw=String(value??'').trim();
 const match=raw.match(VERSION_PATTERN);
 if(!match)return null;
 const prefix=(match[1]?.toLowerCase()||null) as OrbitVersion['prefix'];
 const parts=match[2].split('.').map(Number);
 if(!parts.length||parts.some(part=>!Number.isSafeInteger(part)||part<0))return null;
 return {prefix,parts,prerelease:match[3]||null,rank:prefix==='d'?0:prefix==='b'?1:2,raw};
}

export function compareOrbitVersions(a:unknown,b:unknown):number|null{
 const left=parseOrbitVersion(a),right=parseOrbitVersion(b);
 if(!left||!right)return null;
 const width=Math.max(left.parts.length,right.parts.length);
 for(let index=0;index<width;index++){
  const delta=(left.parts[index]??0)-(right.parts[index]??0);
  if(delta!==0)return delta>0?1:-1;
 }
 if(left.rank!==right.rank)return left.rank>right.rank?1:-1;
 if(left.prerelease===right.prerelease)return 0;
 if(left.prerelease===null)return 1;
 if(right.prerelease===null)return -1;
 const prerelease=left.prerelease.localeCompare(right.prerelease,undefined,{numeric:true,sensitivity:'base'});
 return prerelease===0?0:prerelease>0?1:-1;
}

export function satisfiesMinimumOrbitVersion(installed:unknown,minimum:unknown):boolean{
 const comparison=compareOrbitVersions(installed,minimum);
 return comparison!==null&&comparison>=0;
}
