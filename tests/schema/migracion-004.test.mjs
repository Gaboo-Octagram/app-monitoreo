import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path'; import {fileURLToPath} from 'url'; const R=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','..')+path.sep;
const db=await PGlite.create();
await db.exec(`create role anon nologin; create role authenticated nologin;
create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(),email text,raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create schema storage; create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,created_at timestamptz default now());
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
grant usage on schema storage to authenticated,anon; grant all on storage.buckets to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
alter table storage.objects enable row level security; alter table storage.buckets enable row level security;`);
await db.exec(fs.readFileSync(R+'docs/schema.sql','utf8').replace('create extension if not exists pgcrypto;',''));

const mig=['001-permisos-y-conformidad','002-roles-desde-el-panel','003-accion-correctiva','004-subareas-y-permisos-catalogo'].map(f=>fs.readFileSync(R+'docs/migraciones/'+f+'.sql','utf8')).join('\n');
await db.exec(mig); await db.exec(mig); // idempotente
let bad=0; const ok=(c,m)=>{console.log((c?'OK   ':'FALLA ')+m); if(!c)bad++;};
const store=(await db.query(`select public.create_store_with_defaults('Demo') id`)).rows[0].id;
const A='11111111-1111-1111-1111-111111111111',M='22222222-2222-2222-2222-222222222222',J='44444444-4444-4444-4444-444444444444';
await db.exec(`insert into auth.users(id,email) values('${A}','a@t'),('${M}','m@t'),('${J}','j@t')`);
await db.exec(`update public.profiles set role='monitora', store_id='${store}' where id='${M}'; update public.profiles set role='jefa_calidad', store_id='${store}' where id='${J}'; update public.profiles set store_id='${store}' where id='${A}'`);
const as=async id=>{await db.exec('reset role');await db.exec(`select set_config('request.jwt.claim.sub','${id}',false)`);await db.exec('set role authenticated')};
const fails=async(m,s,p)=>{try{await db.query(s,p);ok(false,m+' (debía fallar)')}catch(e){ok(true,m+' → bloqueado')}};
const cnt=async(m,s,n)=>{const r=(await db.query(s)).rows[0].n;ok(r===n,`${m} (${r})`)};
await db.exec('reset role');
ok((await db.query(`select 1 from information_schema.columns where table_name='area_workers' and column_name='sub'`)).rows.length===1,'area_workers.sub existe');
ok((await db.query(`select 1 from information_schema.columns where table_name='audit_entries' and column_name='corrective_action'`)).rows.length===1,'audit_entries.corrective_action existe');
// monitora: ya no edita el catálogo
await as(M);
await fails('monitora NO crea trabajador',`insert into public.workers(store_id,name) values($1,'X')`,[store]);
await cnt('monitora NO edita áreas',`with u as(update public.areas set name='Zzz' where name='Panadería' returning 1) select count(*)::int n from u`,0);
await cnt('monitora NO agrega ítems',`with i as(insert into public.checklist_items(block_id,text) select id,'N' from public.checklist_blocks limit 1 returning 1) select count(*)::int n from i`,0).catch(()=>ok(true,'monitora NO agrega ítems → bloqueado'));
await cnt('monitora sigue leyendo el catálogo',`select count(*)::int n from public.areas`,7);
// jefa: sí edita
await as(J);
await db.query(`insert into public.workers(id,store_id,name) values('55555555-5555-5555-5555-555555555555',$1,'Ana Demo')`,[store]);
ok(true,'jefa crea trabajador');
await cnt('jefa edita área',`with u as(update public.areas set name='Panadería 2' where name='Panadería' returning 1) select count(*)::int n from u`,1);
await db.query(`insert into public.area_workers(area_id,worker_id,store_id,sub) select id,'55555555-5555-5555-5555-555555555555',$1,'Cuarto Frío' from public.areas limit 1`,[store]);
await cnt('jefa asigna trabajador a sub-área',`select count(*)::int n from public.area_workers where sub='Cuarto Frío'`,1);
await cnt('jefa agrega ítem',`with i as(insert into public.checklist_items(block_id,text) select id,'Nuevo' from public.checklist_blocks limit 1 returning 1) select count(*)::int n from i`,1);
// administrador: sí
await as(A);
await db.query(`insert into public.workers(store_id,name) values($1,'Beto Demo')`,[store]);
ok(true,'administrador crea trabajador');
await db.exec('reset role');
console.log(bad?`\n${bad} falla(s)`:'\nTodo OK'); process.exit(bad?1:0);
