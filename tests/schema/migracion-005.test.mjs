import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path'; import {fileURLToPath} from 'url'; const R=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','..')+path.sep;
const db=await PGlite.create();
await db.exec(`create role anon nologin; create role authenticated nologin;
create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create schema storage; create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[],created_at timestamptz default now(),updated_at timestamptz default now());
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,created_at timestamptz default now(),updated_at timestamptz default now(),metadata jsonb);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
grant usage on schema storage to authenticated,anon; grant all on storage.buckets to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
alter table storage.objects enable row level security; alter table storage.buckets enable row level security;`);
await db.exec(fs.readFileSync(R+'docs/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));
const mig=['001-permisos-y-conformidad','002-roles-desde-el-panel','003-accion-correctiva','004-subareas-y-permisos-catalogo','005-informes-semanales'].map(f=>fs.readFileSync(R+'docs/migraciones/'+f+'.sql','utf8'));
for (const m of mig) await db.exec(m);
for (const m of mig) await db.exec(m); // idempotente
let bad=0; const ok=(c,m)=>{console.log((c?'OK   ':'FALLA ')+m); if(!c)bad++;};
const store=(await db.query(`select public.create_store_with_defaults('Demo') id`)).rows[0].id;
const A='11111111-1111-1111-1111-111111111111',M='22222222-2222-2222-2222-222222222222',J='44444444-4444-4444-4444-444444444444';
await db.exec(`insert into auth.users(id,email) values('${A}','a@t'),('${M}','m@t'),('${J}','j@t')`);
await db.exec(`update public.profiles set role='administrador', store_id='${store}' where id='${A}'; update public.profiles set role='monitora', store_id='${store}' where id='${M}'; update public.profiles set role='jefa_calidad', store_id='${store}' where id='${J}';`);
const as=async id=>{await db.exec('reset role');await db.exec(`select set_config('request.jwt.claim.sub','${id}',false)`);await db.exec('set role authenticated')};
const fails=async(m,s,p)=>{try{await db.query(s,p);ok(false,m+' (debía fallar)')}catch(e){ok(true,m+' → bloqueado')}};
const area=(await db.query(`select id from public.areas where store_id=$1 limit 1`,[store])).rows[0].id;
await db.exec('reset role');
ok((await db.query(`select 1 from storage.buckets where id='weekly-reports' and file_size_limit=10485760`)).rows.length===1,'bucket weekly-reports de 10 MB');
// administrador: sube informe y valores
await as(A);
await db.query(`insert into public.weekly_reports(store_id,area_id,year,week,week_start,file_name,file_path,file_size) values($1,$2,2026,41,'2026-10-05','a.docx','${store}/x.docx',1000)`,[store,area]);
await db.query(`insert into public.weekly_report_values(report_id,store_id,type,sub,pct) select id,$1,'limpieza','',96 from public.weekly_reports where week=41`,[store]);
ok(true,'administrador sube informe y valores');
await fails('administrador NO repite misma área y semana',`insert into public.weekly_reports(store_id,area_id,year,week,week_start,file_name) values($1,$2,2026,41,'2026-10-05','b.docx')`,[store,area]);
await db.exec('reset role');
// monitora y jefa: solo leen
for (const [who,nm] of [[M,'monitora'],[J,'jefa']]) {
  await as(who);
  await fails(`${nm} NO sube informes`,`insert into public.weekly_reports(store_id,area_id,year,week,week_start,file_name) values($1,$2,2026,42,'2026-10-12','c.docx')`,[store,area]);
  const r=(await db.query(`select count(*)::int n from public.weekly_reports`)).rows[0].n;
  ok(r===1,`${nm} lee los informes del local (${r})`);
  await db.query(`delete from public.weekly_reports`);
  const q=(await db.query(`select count(*)::int n from public.weekly_reports`)).rows[0].n;
  ok(q===1,`${nm} NO borra informes (siguen ${q})`);
  await db.exec('reset role');
}
// Storage: solo administrador escribe, dentro de su local
await as(J);
await fails('jefa NO sube archivos a Storage',`insert into storage.objects(bucket_id,name) values('weekly-reports','${store}/${area}/2026-S41-x.docx')`);
await db.exec('reset role');
await as(A);
await db.query(`insert into storage.objects(bucket_id,name) values('weekly-reports','${store}/${area}/2026-S41-x.docx')`);
ok(true,'administrador sube archivo a Storage de su local');
await db.exec('reset role');
console.log(bad? `\n${bad} FALLA(S)` : '\nTODO OK — migración 005');
process.exit(bad?1:0);
