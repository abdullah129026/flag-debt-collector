-- Provider token RPCs. Tokens are encrypted with pgcrypto using a key held
-- in Vault (name: provider_token_enc_key, created by the phase-6 deploy
-- steps). Reads return last4 only; the raw token is decrypted only inside
-- the service-role RPC that fetches rollout, and is never logged.
-- Same pattern as project 3 (github token RPCs).

create or replace function public.store_provider_token(p_owner_id uuid, p_provider text, p_token text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_key text;
  v_id uuid;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'provider_token_enc_key';

  if v_key is null then
    raise exception 'provider token encryption key is not configured';
  end if;

  insert into public.provider_tokens (owner_id, provider, token_enc, last4)
  values (
    p_owner_id,
    p_provider,
    pgp_sym_encrypt(p_token, v_key),
    right(p_token, 4)
  )
  on conflict (owner_id, provider) do update
    set token_enc = excluded.token_enc,
        last4 = excluded.last4,
        created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.read_provider_token(p_owner_id uuid, p_provider text)
returns text
language plpgsql
security definer
as $$
declare
  v_key text;
  v_token text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'provider_token_enc_key';

  if v_key is null then
    return null;
  end if;

  select pgp_sym_decrypt(token_enc, v_key) into v_token
  from public.provider_tokens
  where owner_id = p_owner_id and provider = p_provider;

  return v_token;
end;
$$;

create or replace function public.delete_provider_token(p_owner_id uuid, p_provider text)
returns void
language plpgsql
security definer
as $$
begin
  delete from public.provider_tokens
  where owner_id = p_owner_id and provider = p_provider;
end;
$$;

revoke all on function public.store_provider_token(uuid, text, text) from public;
revoke all on function public.read_provider_token(uuid, text) from public;
revoke all on function public.delete_provider_token(uuid, text) from public;
grant execute on function public.store_provider_token(uuid, text, text) to service_role;
grant execute on function public.read_provider_token(uuid, text) to service_role;
grant execute on function public.delete_provider_token(uuid, text) to service_role;
