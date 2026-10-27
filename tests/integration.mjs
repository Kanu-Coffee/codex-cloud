import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const tmp=mkdtempSync(join(tmpdir(),'sites-test-')); const realGit='/usr/bin/git';
function cmd(bin,args,opts={}) { const r=spawnSync(bin,args,{encoding:'utf8',...opts}); if(r.status!==0) throw new Error(r.stderr); return r.stdout.trim(); }
try {
  const repo=join(tmp,'remote.git'),src=join(tmp,'source'),bin=join(tmp,'bin');
  mkdirSync(src);mkdirSync(bin);mkdirSync(join(src,'.openai'));mkdirSync(join(src,'dist'));mkdirSync(join(src,'dist','img'));
  cmd(realGit,['init','--bare',repo]);
  const wrapper=join(bin,'git');writeFileSync(wrapper,`#!/bin/sh\nset -- "$(printf '%s' "$1")" "${'$'}{@:2}"\n`); // replaced by portable wrapper below
  writeFileSync(wrapper,`#!/usr/bin/python3\nimport os,sys\na=[${JSON.stringify(realGit)}]+[${JSON.stringify(repo)} if x.startswith('https://git.chatgpt-team.site/') else x for x in sys.argv[1:]]\nos.execv(a[0],a)\n`);chmodSync(wrapper,0o755);
  const project='appgprj_test123'; const credential={remote_url:`https://git.chatgpt-team.site/test/${project}.git`,branch:'main',auth_mode:'work_proxy'};
  writeFileSync(join(src,'.openai','hosting.json'),JSON.stringify({project_id:project,static:{directory:'dist'}}));
  writeFileSync(join(src,'index.html'),'source v1');writeFileSync(join(src,'dist','index.html'),'output v1');writeFileSync(join(src,'dist','img','a.txt'),'image');
  const archive=join(tmp,'package.tar.gz'); const env={...process.env,PATH:bin+':'+process.env.PATH};
  const script=fileURLToPath(new URL('../site-workflow.mjs',import.meta.url));
  function helper(input,success=true){const r=spawnSync(process.execPath,[script],{input:JSON.stringify({project_id:project,credential,...input})+'\n',encoding:'utf8',env}); if(success){assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout)} assert.notEqual(r.status,0);return r;}
  assert.equal(helper({mode:'inspect'}).remote_head,null);
  const first=helper({source_dir:src,expected_head:null,archive_path:archive,source_paths:['index.html']});assert.ok(existsSync(archive));
  assert.equal(helper({mode:'inspect'}).remote_head,first.commit_sha);
  const listing=cmd('tar',['-tzf',archive]);assert.match(listing,/dist\/img\/a.txt/);
  writeFileSync(join(src,'dist','index.html'),'output v2');
  helper({source_dir:src,expected_head:null,archive_path:archive,source_paths:['index.html']},false);
  assert.equal(helper({mode:'inspect'}).remote_head,first.commit_sha);
  const second=helper({source_dir:src,expected_head:first.commit_sha,archive_path:archive,source_paths:['index.html']});
  assert.notEqual(second.commit_sha,first.commit_sha); assert.equal(cmd(realGit,['--git-dir',repo,'show','main:dist/index.html']),'output v2');
  assert.equal(cmd(realGit,['--git-dir',repo,'show','main:dist/img/a.txt']),'image');
  console.log('PASS: new source, archive assets, stale head rejection, existing-site update');
} finally {rmSync(tmp,{recursive:true,force:true});}
