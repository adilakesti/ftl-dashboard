-- OD Region: chosen by sales when raising a ticket (CJ / EJ / GJ / WJ, or the island
-- for lanes outside Java). Go-live: a ticket is marked live from Dashboard Ticket.
ALTER TABLE submissions ADD COLUMN od_region VARCHAR(32) NULL;
ALTER TABLE submissions ADD COLUMN went_live_at DATETIME NULL;
ALTER TABLE submissions ADD COLUMN went_live_by VARCHAR(255) NULL;
