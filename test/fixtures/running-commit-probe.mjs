import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const startingHead=process.env.HAS_GIT==='0'?'unknown':git('rev-parse','--short','HEAD');
const { contributeInfo }=await import(new URL('../../src/mcp/server.ts',import.meta.url).href);
// No createMcpServer/session/tool call occurs before this worktree mutation.
if(process.env.HAS_GIT!=='0'){writeFileSync('fixture.txt','after import\n');git('add','fixture.txt');git('-c','commit.gpgsign=false','commit','-qm','after module import');}
if(process.env.MUTATE_OVERRIDE==='1')process.env.HOGWARTS_COMMIT='changed-after-import';
const laterHead=process.env.HAS_GIT==='0'?'unknown':git('rev-parse','--short','HEAD');
const first=contributeInfo().runningCommit,second=contributeInfo().runningCommit;
process.stdout.write(JSON.stringify({startingHead,laterHead,first,second})+'\n');
