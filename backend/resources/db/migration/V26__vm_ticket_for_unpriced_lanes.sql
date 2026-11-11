-- Lanes edited to a route with no vendor rate never got a VM ticket (the edit
-- path only raised one for single-vendor lanes), so they sat as "No rate
-- available" with nobody working them. Raise an open VM ticket for every such
-- lane on a submitted ticket that has no VM ticket at all.
INSERT INTO vm_requests
    (submission_row_id, origin, destination, vehicle_type, target_rate, current_final_rate, requested_by)
SELECT r.id, r.origin, r.destination, r.vehicle_type, r.target_rate, NULL, s.uploaded_by
FROM submission_rows r
JOIN submissions s ON s.id = r.submission_id
WHERE s.submitted_at IS NOT NULL
  AND r.final_rate IS NULL
  AND NOT EXISTS (SELECT 1 FROM vm_requests vr WHERE vr.submission_row_id = r.id);
