ALTER TABLE tasks ADD COLUMN follower_usernames TEXT NOT NULL DEFAULT '[]';

UPDATE tasks
SET follower_usernames = COALESCE((
  SELECT json_group_array(username)
  FROM (
    SELECT u.username
    FROM users u
    WHERE u.id = tasks.assignee_user_id AND u.deleted_at IS NULL
    UNION
    SELECT u.username
    FROM users u
    WHERE u.username = tasks.created_by AND u.deleted_at IS NULL
  )
), '[]')
WHERE deleted_at IS NULL;

UPDATE users
SET permissions = json_set(
  CASE WHEN json_valid(permissions) AND json_type(permissions) = 'object' THEN permissions ELSE '{}' END,
  '$.canReceiveTaskNotifications',
  json('true')
)
WHERE deleted_at IS NULL;
