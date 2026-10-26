-- Optional per-lane trip commitments (informational, shown to VM and in the quotation).
ALTER TABLE submission_rows
    ADD COLUMN min_dedicated_trip INT NULL,
    ADD COLUMN min_trip INT NULL,
    -- Snapshot of how the winning vendor was picked, taken at pricing time:
    -- a short basis ("2nd cheapest of 3") and the full ranked vendor list as JSON.
    ADD COLUMN matched_basis VARCHAR(255) NULL,
    ADD COLUMN matched_ranked TEXT NULL;

-- Single-vendor override (ticket-level) and SLA auto-close marker.
ALTER TABLE vm_requests
    ADD COLUMN single_vendor_approved TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN override_reason VARCHAR(255) NULL,
    ADD COLUMN override_by VARCHAR(255) NULL,
    ADD COLUMN auto_closed_sla TINYINT(1) NOT NULL DEFAULT 0;
