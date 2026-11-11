-- The SalesCRM opportunity/deal ID a ticket belongs to, entered by sales in New Request.
-- Lets the ticket's shipper name, Sales PIC and potential revenue be synced from the
-- SalesCRM API later (those three fields only).
ALTER TABLE submissions ADD COLUMN salescrm_id VARCHAR(64) NULL;
ALTER TABLE submissions ADD KEY idx_submissions_salescrm_id (salescrm_id);
