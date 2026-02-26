-- Add RPC for distinct wallet counts and tighten select policy
create or replace function public.count_distinct_dapp_connections(since_ts timestamptz default null)
returns bigint
language sql
stable
as $$
  select count(distinct wallet)
  from public.dapp_connections
  where wallet is not null
    and (since_ts is null or connected_at >= since_ts);
$$;

-- Drop anon select policy so data access goes through admin function
drop policy if exists "dapp_connections_select_anon" on public.dapp_connections;
