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

revoke all on function public.app_object_put_json(text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.app_object_put_json(text, text, text, text, boolean) to service_role;
