import {compareOrbitVersions,satisfiesMinimumOrbitVersion} from '../src/lib/server/orbit-version.ts';

const cases=[
 ['1.0.1','1.0.0',1,true],
 ['1.0.0','1.0.0',0,true],
 ['1.0.0','1.0.1',-1,false],
 ['v1.2.0','1.1.9',1,true],
 ['1.0.0','1.0.0-beta.1',1,true],
 ['1.0.0-beta.1','1.0.0',-1,false],
 ['garbage','1.0.0',null,false],
];

for(const [installed,minimum,expectedCompare,expectedSatisfied] of cases){
 const actualCompare=compareOrbitVersions(installed,minimum);
 const actualSatisfied=satisfiesMinimumOrbitVersion(installed,minimum);
 if(actualCompare!==expectedCompare||actualSatisfied!==expectedSatisfied){
  throw new Error(`Compatibility regression: ${installed} vs ${minimum}; compare=${actualCompare}, satisfied=${actualSatisfied}`);
 }
}

console.log('OrbitFS version compatibility checks passed');
