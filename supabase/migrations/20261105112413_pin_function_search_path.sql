-- Functions resolve names through a fixed, empty search_path so a caller's own
-- search_path can't redirect them. Both already schema-qualify everything.
alter function public.enable_rls_on_new_table() set search_path = '';
alter function public.requesting_org_id() set search_path = '';
