import { readFileSync, writeFileSync } from 'node:fs';

const analysis=JSON.parse(readFileSync('release-analysis.json','utf8'));
const version=process.env.RELEASE_VERSION||'';
const kind=analysis.kind==='engine'?'Engine update':'Base release';
const commits=Array.isArray(analysis.commits)?analysis.commits:[];
const components=Array.isArray(analysis.detectedComponents)?analysis.detectedComponents:[];
const flags=analysis.flags||{};
const lines=[`# OrbitFS ${kind} v${version}`,'',`Generated from ${analysis.commitCount||0} commit(s) and ${analysis.fileCount||0} changed file(s).`,''];
if(components.length) lines.push(`## Components\n${components.map(x=>`- ${x}`).join('\\n')}`,'');
if(commits.length) lines.push('## Changes',...commits.slice(0,80).map(c=>`- ${String(c.subject||'').trim()}`),'');
const checks=[['Schema/database changes',flags.schemaChanged],['Dependency changes',flags.dependenciesChanged],['Deployment changes',flags.deploymentChanged],['API changes',flags.apiChanged],['UI changes',flags.uiChanged],['Engine/deployer changes',flags.engineDeployerChanged]].filter(([,v])=>v).map(([k])=>`- ${k}`);
if(checks.length) lines.push('## Change areas',...checks,'');
lines.push('## Release status','- Build/check validation completed by GitHub Actions.','- License Master must complete technical validation and finalise the candidate before Billing Store review.','- Billing Store performs the final customer-facing cleanup and publication gate.');
writeFileSync('release-changelog.md',lines.join('\\n')+'\\n');