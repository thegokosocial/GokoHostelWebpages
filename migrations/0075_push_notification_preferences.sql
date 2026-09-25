ALTER TABLE push_subscriptions ADD COLUMN muted_notification_types TEXT NOT NULL DEFAULT '[]';

UPDATE push_subscriptions
SET user_label = 'admin'
WHERE trim(coalesce(user_label, '')) = '';
