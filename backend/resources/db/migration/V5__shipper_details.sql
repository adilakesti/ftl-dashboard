ALTER TABLE submissions
    ADD COLUMN shipper_name VARCHAR(255) NULL AFTER uploaded_by,
    ADD COLUMN sales_pic VARCHAR(255) NULL AFTER shipper_name,
    ADD COLUMN shipper_status ENUM('new', 'existing') NULL AFTER sales_pic,
    ADD COLUMN potential_monthly_revenue DECIMAL(14,2) NULL AFTER shipper_status,
    ADD COLUMN commodity_type VARCHAR(255) NULL AFTER potential_monthly_revenue,
    ADD COLUMN high_value_fragile BOOLEAN NOT NULL DEFAULT FALSE AFTER commodity_type,
    ADD COLUMN add_ons JSON NULL AFTER high_value_fragile;
