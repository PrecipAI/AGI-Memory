UPDATE rule SET metadata = metadata || '{"host_action":{"skill":"gate-master","status":"pending","generated_at":null,"trace_id":"reset-for-test"}}'::jsonb WHERE rule_key = 'host-rule-52cdfecc8797';
SELECT rule_key, metadata->'host_action'->>'status' AS status FROM rule WHERE rule_key = 'host-rule-52cdfecc8797';
