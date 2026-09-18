-- Engagement signal computation for the nightly consolidation loop

create or replace function compute_engagement_signals(
  p_user_id uuid,
  p_since timestamptz
)
returns jsonb as $$
declare
  v_total_messages int;
  v_chip_offered_count int;
  v_chip_selected_count int;
  v_avg_theme_repeat numeric;
  v_max_theme_repeat int;
  v_stage_reached_challenging int;
  v_stage_reached_integration int;
  v_farewell_early_count int;
begin
  select count(*) into v_total_messages
  from message_emotions
  where user_id = p_user_id and created_at > p_since;

  select count(*) into v_chip_offered_count
  from message_emotions
  where user_id = p_user_id and created_at > p_since
    and (array_length(suggested_emotions, 1) > 0 or array_length(suggested_needs, 1) > 0);

  select count(*) into v_chip_selected_count
  from message_emotions
  where user_id = p_user_id and created_at > p_since
    and (selected_emotion is not null or selected_need is not null);

  select avg(theme_repeat_count), max(theme_repeat_count)
    into v_avg_theme_repeat, v_max_theme_repeat
  from message_emotions
  where user_id = p_user_id and created_at > p_since;

  select count(*) into v_stage_reached_challenging
  from message_emotions
  where user_id = p_user_id and created_at > p_since
    and conversation_stage in ('challenging_belief', 'integration');

  select count(*) into v_stage_reached_integration
  from message_emotions
  where user_id = p_user_id and created_at > p_since
    and conversation_stage = 'integration';

  select count(*) into v_farewell_early_count
  from message_emotions
  where user_id = p_user_id and created_at > p_since
    and conversation_stage = 'closed';

  return jsonb_build_object(
    'total_messages', coalesce(v_total_messages, 0),
    'chip_offer_rate', case when v_total_messages > 0
      then round(v_chip_offered_count::numeric / v_total_messages, 2) else 0 end,
    'chip_acceptance_rate', case when v_chip_offered_count > 0
      then round(v_chip_selected_count::numeric / v_chip_offered_count, 2) else null end,
    'avg_theme_repeat_count', round(coalesce(v_avg_theme_repeat, 0), 2),
    'max_theme_repeat_count', coalesce(v_max_theme_repeat, 0),
    'reached_deeper_stages', coalesce(v_stage_reached_challenging, 0),
    'reached_integration', coalesce(v_stage_reached_integration, 0),
    'conversations_closed', coalesce(v_farewell_early_count, 0)
  );
end;
$$ language plpgsql security definer;

-- Candidate lookup: which users have enough new data since their last snapshot

create or replace function get_users_needing_consolidation(min_new_messages int)
returns table(user_id uuid, since_watermark timestamptz) as $$
begin
  return query
  select
    m.user_id,
    coalesce(
      (select max(u.processed_through) from user_understanding u where u.user_id = m.user_id),
      '2020-01-01'::timestamptz
    ) as since_watermark
  from message_emotions m
  group by m.user_id
  having count(*) filter (
    where m.created_at > coalesce(
      (select max(u.processed_through) from user_understanding u where u.user_id = m.user_id),
      '2020-01-01'::timestamptz
    )
  ) >= min_new_messages;
end;
$$ language plpgsql security definer;

comment on function compute_engagement_signals is
  'Computes engagement signal metrics for a user since a given timestamp. Used by the nightly consolidation loop.';

comment on function get_users_needing_consolidation is
  'Returns users with enough new message_emotions rows since their last consolidation snapshot.';
