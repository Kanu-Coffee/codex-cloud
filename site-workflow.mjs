// Community-built static Sites source helper. Not the official Sites helper.
// Supply one JSON object on stdin; never provide credentials as command arguments.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, lstatSync, readdirSync, copyFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve, join, isAbsolute, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';

function fail(message) { throw new Error(message); }
function safePath(p) {
  if (typeof p !== 'string' || !p || isAbsolute(p) || p.split(/[\\/]/).some(x => !x || x === '.' || x === '..') || p.includes('\\')) fail('Invalid relative path');
  if (p.split('/').some(x => x === '.git' || x === 'node_modules' || x === '.env' || x.startsWith('.env.'))) fail('Unsafe source path');
  return p;
}
function copySafe(src, dst) {
  const stat = lstatSync(src);
  if (stat.isSymbolicLink()) fail('Symlinks are not supported: ' + src);
  if (stat.isDirectory()) { mkdirSync(dst, {recursive:true}); for (const name of readdirSync(src)) { if (name === '.git' || name === 'node_modules' || name === '.env' || name.startsWith('.env.')) fail('Unsafe source entry: ' + name); copySafe(join(src,name), join(dst,name)); } }
  else if (stat.isFile()) { mkdirSync(resolve(dst, '..'), {recursive:true}); copyFileSync(src,dst); }
  else fail('Unsupported source entry: ' + src);
}
const lines = createInterface({input:process.stdin,terminal:false});
let data = ''; for await (const line of lines) { data = line; break; } lines.close();
const input = JSON.parse(data);
const { credential:c, project_id:project, mode='publish' } = input;
if (!c || typeof project !== 'string' || !/^appgprj_[A-Za-z0-9]+$/.test(project)) fail('Missing or invalid project_id or credential');
const remote = new URL(c.remote_url);
if (remote.protocol !== 'https:' || remote.hostname !== 'git.chatgpt-team.site' || remote.username || remote.password || remote.search || remote.hash || !remote.pathname.endsWith('/'+project+'.git')) fail('Repository does not match project');
if (typeof c.branch !== 'string' || !c.branch || c.branch.startsWith('-')) fail('Invalid branch');
const auth = {...process.env, GIT_TERMINAL_PROMPT:'0'};
if (c.auth_mode === 'http_extra_header') {
  if (typeof c.token !== 'string' || !c.token || !Number.isFinite(Date.parse(c.token_expires_at)) || Date.parse(c.token_expires_at) <= Date.now()) fail('Credential missing or expired');
  auth.GIT_CONFIG_COUNT='1'; auth.GIT_CONFIG_KEY_0='http.extraHeader'; auth.GIT_CONFIG_VALUE_0=`Authorization: Bearer ${c.token}`;
} else if (c.auth_mode !== 'work_proxy' && c.auth_mode !== undefined) fail('Unsupported credential mode');
const tmp=mkdtempSync(join(tmpdir(),'sites-publish-'));
function run(cmd,args,cwd,authenticated=false,raw=false) {
  const r=spawnSync(cmd,args,{cwd,env:authenticated?auth:process.env,encoding:raw?null:'utf8',maxBuffer:128*1024*1024});
  if(r.status!==0) { let err=String(r.stderr||''); if(c.token) err=err.split(c.token).join('[redacted]'); fail(`${cmd} failed: ${err.slice(0,1200)}`); }
  return raw?r.stdout:String(r.stdout).trim();
}
try {
  run('git',['check-ref-format','--branch',c.branch],tmp);
  const ref=`refs/heads/${c.branch}`;
  const output=run('git',['ls-remote','--heads',c.remote_url,ref],tmp,true);
  const head=output ? output.split(/\s+/)[0] : null;
  if(mode==='inspect') { console.log(JSON.stringify({project_id:project,branch:c.branch,remote_head:head})); }
  else if(mode==='publish') {
    if (!Object.hasOwn(input,'expected_head') || input.expected_head !== head) fail('Remote head changed or expected_head was not provided; inspect and review before retrying');
    const source=realpathSync(input.source_dir);
    const manifest=JSON.parse(readFileSync(join(source,'.openai/hosting.json'),'utf8'));
    if(manifest.project_id!==project) fail('Manifest project_id does not match');
    const dir=safePath(manifest.static?.directory);
    if(!['dist','dist/client','out','build','.output/public'].includes(dir)) fail('Unsupported static output directory');
    lstatSync(join(source,dir,'index.html'));
    const paths=[...new Set(['.openai/hosting.json',dir,...(input.source_paths||[]).map(safePath)])];
    for(const p of paths) { if(paths.some(other=>other!==p && p.startsWith(other+'/'))) fail('Overlapping source paths'); }
    const archive=resolve(input.archive_path);
    if(relative(source,archive)==='' || (!relative(source,archive).startsWith('..') && !isAbsolute(relative(source,archive)))) fail('Archive must be outside source directory');
    run('git',['init','-b',c.branch],tmp);
    run('git',['config','user.name','Sites publisher'],tmp); run('git',['config','user.email','sites-publisher@localhost'],tmp);
    if(head) { run('git',['fetch','--no-tags',c.remote_url,ref],tmp,true); const fetched=run('git',['rev-parse','FETCH_HEAD'],tmp); if(fetched!==head) fail('Remote changed while opening'); run('git',['checkout','-B',c.branch,'FETCH_HEAD'],tmp); }
    for(const p of paths) {
      let cursor=source;
      for (const component of p.split('/')) { cursor=join(cursor,component); if(lstatSync(cursor).isSymbolicLink()) fail('Symlinks are not supported: '+p); }
      cursor=tmp;
      for (const component of p.split('/').slice(0,-1)) { cursor=join(cursor,component); if(existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) fail('Remote parent is a symlink: '+p); }
      const src=join(source,p),dst=join(tmp,p); rmSync(dst,{recursive:true,force:true}); copySafe(src,dst);
    }
    run('git',['add','-A','--',...paths],tmp);
    const changes=run('git',['status','--porcelain'],tmp);
    if(changes) run('git',['commit','-m',input.commit_message || 'Update site source'],tmp);
    if(!head && !changes) fail('No source to publish');
    const sha=run('git',['rev-parse','HEAD'],tmp);
    const tar=run('git',['archive','--format=tar',sha,'--','.openai/hosting.json',dir],tmp,false,true);
    mkdirSync(resolve(archive,'..'),{recursive:true}); writeFileSync(archive,gzipSync(tar));
    run('git',['push',c.remote_url,`HEAD:${ref}`],tmp,true);
    const confirmed=run('git',['ls-remote','--heads',c.remote_url,ref],tmp,true).split(/\s+/)[0];
    if(confirmed!==sha) fail('Remote head does not match pushed commit');
    console.log(JSON.stringify({project_id:project,commit_sha:sha,archive,previous_head:head}));
  } else fail('Unsupported mode');
} finally { rmSync(tmp,{recursive:true,force:true}); }
