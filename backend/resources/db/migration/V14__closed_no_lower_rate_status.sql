-- Distinguishes "no vendor at all for this lane" (closed_no_vendor, wipes the
-- Final Rate) from "VM can't beat the sales target on an already-priced lane"
-- (closed_no_lower_rate, keeps the existing Final Rate as the standing quote).
ALTER TABLE vm_requests
    MODIFY status ENUM('open', 'in_progress', 'resolved', 'closed_no_vendor', 'closed_no_lower_rate')
    NOT NULL DEFAULT 'open';
