import { test } from 'vitest';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function probe({override,gitRepo=true,mutateOverride=false}: {override?: string; gitRepo?: boolean; mutateOverride?: boolean}={}){
 const dir=mkdtempSync(join(tmpdir(),'hogwarts-start-commit-'));
 const git=(...args: string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  if(gitRepo){git('init','-q');git('config','user.name','Commit Fixture');git('config','user.email','fixture@example.invalid');writeFileSync(join(dir,'fixture.txt'),'before import\n');git('add','fixture.txt');git('-c','commit.gpgsign=false','commit','-qm','startup baseline');}
  const env: NodeJS.ProcessEnv={...process.env,HAS_GIT:gitRepo?'1':'0',MUTATE_OVERRIDE:mutateOverride?'1':'0'};
  delete env.HOGWARTS_COMMIT;if(override!==undefined)env.HOGWARTS_COMMIT=override;
  const stdout=execFileSync(process.execPath,['--import',fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url)),fileURLToPath(new URL('./fixtures/running-commit-probe.mjs',import.meta.url))],{cwd:dir,env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  return JSON.parse(stdout);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('first contribute call reports startup HEAD even when repository commits after module import',()=>{const r=probe();assert.notEqual(r.startingHead,r.laterHead);assert.equal(r.first,r.startingHead);assert.equal(r.second,r.startingHead);});
test('HOGWARTS_COMMIT at module load wins and is immutable after import',()=>{const r=probe({override:'release-start-abc123',mutateOverride:true});assert.equal(r.first,'release-start-abc123');assert.equal(r.second,'release-start-abc123');});
test('empty override retains git fallback captured at module load',()=>{const r=probe({override:''});assert.notEqual(r.startingHead,r.laterHead);assert.equal(r.first,r.startingHead);});
test('without a repository or override, report unknown',()=>{const r=probe({gitRepo:false});assert.equal(r.first,'unknown');assert.equal(r.second,'unknown');});
