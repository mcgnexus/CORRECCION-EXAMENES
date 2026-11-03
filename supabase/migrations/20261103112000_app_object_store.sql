create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_object_store (
  path text primary key,
  content_type text not null,
  etag text not null,
  body bytea,
  is_binary boolean not null,
  updated_at timestamptz not null default now(),
  constraint app_object_store_path_safe check (
    path <> '' and path !~ '(^/|(^|/)\.\.(/|$))'
  )
);

alter table public.app_object_store enable row level security;
revoke all on public.app_object_store from anon, authenticated;
grant all on public.app_object_store to service_role;

create or replace function public.app_object_get(p_path text)
returns table(body_base64 text, content_type text, etag text, is_binary boolean)
language sql
security definer
set search_path = ''
as $$
  select encode(o.body, 'base64'), o.content_type, o.etag, o.is_binary
  from public.app_object_store as o
  where o.path = p_path;
$$;

create or replace function public.app_object_list(p_prefix text)
returns table(path text)
language sql
security definer
set search_path = ''
as $$
  select o.path
  from public.app_object_store as o
  where left(o.path, length(p_prefix)) = p_prefix
  order by o.path;
$$;

create or replace function public.app_object_put_json(
  p_path text,
  p_body_base64 text,
  p_content_type text,
  p_if_match text default null,
  p_if_none_match boolean default false
)
returns table(etag text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body bytea := decode(p_body_base64, 'base64');
  v_etag text := '"' || encode(extensions.digest(decode(p_body_base64, 'base64'), 'sha256'), 'hex') || '"';
  v_saved_etag text;
begin
  if p_path = '' or p_path ~ '(^/|(^|/)\.\.(/|$))' then
    raise exception 'INVALID_OBJECT_PATH' using errcode = '22023';
  end if;

  if p_if_match is not null then
    update public.app_object_store as o
    set content_type = p_content_type, etag = v_etag, body = v_body, is_binary = false, updated_at = now()
    where o.path = p_path and not o.is_binary and o.etag = p_if_match
    returning o.etag into v_saved_etag;
    if v_saved_etag is null then
      raise exception 'ETAG_CONFLICT' using errcode = 'P0001';
    end if;
    return query select v_saved_etag;
    return;
  end if;

  if p_if_none_match then
    insert into public.app_object_store(path, content_type, etag, body, is_binary)
    values (p_path, p_content_type, v_etag, v_body, false)
    on conflict (path) do nothing
    returning app_object_store.etag into v_saved_etag;
    if v_saved_etag is null then
      raise exception 'OBJECT_EXISTS' using errcode = '23505';
    end if;
    return query select v_saved_etag;
    return;
  end if;

  insert into public.app_object_store(path, content_type, etag, body, is_binary)
  values (p_path, p_content_type, v_etag, v_body, false)
  on conflict (path) do update
  set content_type = excluded.content_type, etag = excluded.etag, body = excluded.body,
      is_binary = false, updated_at = now()
  returning app_object_store.etag into v_saved_etag;
  return query select v_saved_etag;
end;
$$;

create or replace function public.app_object_register_binary(p_path text, p_content_type text, p_etag text)
returns table(etag text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etag text;
begin
  if p_path = '' or p_path ~ '(^/|(^|/)\.\.(/|$))' then
    raise exception 'INVALID_OBJECT_PATH' using errcode = '22023';
  end if;
  insert into public.app_object_store(path, content_type, etag, body, is_binary)
  values (p_path, p_content_type, p_etag, null, true)
  on conflict (path) do nothing;
  select o.etag into v_etag from public.app_object_store as o where o.path = p_path and o.is_binary;
  if v_etag is null then
    raise exception 'OBJECT_EXISTS' using errcode = '23505';
  end if;
  return query select v_etag;
end;
$$;

create or replace function public.app_object_delete(p_path text)
returns table(content_type text, is_binary boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  delete from public.app_object_store as o
  where o.path = p_path
  returning o.content_type, o.is_binary;
end;
$$;

revoke all on function public.app_object_get(text) from public, anon, authenticated;
revoke all on function public.app_object_list(text) from public, anon, authenticated;
revoke all on function public.app_object_put_json(text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.app_object_register_binary(text, text, text) from public, anon, authenticated;
revoke all on function public.app_object_delete(text) from public, anon, authenticated;
grant execute on function public.app_object_get(text) to service_role;
grant execute on function public.app_object_list(text) to service_role;
grant execute on function public.app_object_put_json(text, text, text, text, boolean) to service_role;
grant execute on function public.app_object_register_binary(text, text, text) to service_role;
grant execute on function public.app_object_delete(text) to service_role;
