-- Human-friendly name for each provisioned user (shown in the Sales PIC dropdown
-- and Sales filters), and the sales user a submission belongs to. Legacy
-- submissions keep only the free-text sales_pic and have sales_email NULL.
ALTER TABLE user_roles ADD COLUMN display_name VARCHAR(255) NULL;
ALTER TABLE submissions ADD COLUMN sales_email VARCHAR(255) NULL;
