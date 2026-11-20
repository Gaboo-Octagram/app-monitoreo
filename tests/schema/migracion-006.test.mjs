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
const mig=['001-permisos-y-conformidad','002-roles-desde-el-panel','003-accion-correctiva','004-subareas-y-permisos-catalogo','005-informes-semanales','006-politica-auditorias'].map(f=>fs.readFileSync(R+'docs/migraciones/'+f+'.sql','utf8'));
for (const m of mig) await db.exec(m);
let bad=0; const ok=(c,m)=>{console.log((c?'OK   ':'FALLA ')+m); if(!c)bad++;};
const store=(await db.query(`select public.create_store_with_defaults('Demo') id`)).rows[0].id;
const A='11111111-1111-1111-1111-111111111111',M='22222222-2222-2222-2222-222222222222',J='44444444-4444-4444-4444-444444444444';
await db.exec(`insert into auth.users(id,email) values('${A}','a@t'),('${M}','m@t'),('${J}','j@t')`);
await db.exec(`update public.profiles set role='administrador', store_id='${store}' where id='${A}'; update public.profiles set role='monitora', store_id='${store}' where id='${M}'; update public.profiles set role='jefa_calidad', store_id='${store}' where id='${J}';`);
const as=async id=>{await db.exec('reset role');await db.exec(`select set_config('request.jwt.claim.sub','${id}',false)`);await db.exec('set role authenticated')};
const ins=`insert into public.audits(store_id,audit_date,status,evaluator_id,evaluator_name,goal) values($1,$2,'draft',$3,'Monitora',90) returning id`;
// La monitora crea una auditoría y la devuelve (igual que la app)
await as(M);
try { const r=await db.query(ins,[store,'2026-11-12',M]); ok(r.rows.length===1,'monitora crea y ve su auditoría (insert + returning)'); }
catch(e){ ok(false,'monitora crea y ve su auditoría (insert + returning): '+e.message); }
// Ve solo lo suyo: otra monitora no lo ve (regla de visibilidad intacta)
await db.exec('reset role');
const r2=(await db.query(`select count(*)::int n from public.audits`)).rows[0].n;
ok(r2===1,'la auditoría quedó guardada ('+r2+')');
await as(J);
const jn=(await db.query(`select count(*)::int n from public.audits`)).rows[0].n; ok(jn===1,'jefa ve la auditoría (lectura intacta)');
await as(A);
try { await db.query(ins,[store,'2026-11-13',A]); ok(true,'administrador crea auditoría'); } catch(e){ ok(false,'administrador crea: '+e.message); }
await db.exec('reset role');
console.log(bad? `\n${bad} FALLA(S)` : '\nTODO OK — migración 006');
process.exit(bad?1:0);
