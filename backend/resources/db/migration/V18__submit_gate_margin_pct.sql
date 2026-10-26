-- Submissions are saved as drafts by "Check Result" and only enter the VM queue
-- (and Active/Completed/Profitability) once sales Submit them. Everything that
-- already exists counts as submitted.
ALTER TABLE submissions ADD COLUMN submitted_at DATETIME NULL;
UPDATE submissions SET submitted_at = created_at;

-- Policy markup (incl. PPN) the lane was priced with: 11.1 standard, 6.1 bottom.
-- NULL on rows priced before this column existed.
ALTER TABLE submission_rows ADD COLUMN margin_pct DECIMAL(5,2) NULL;
ALTER TABLE tracker_quotation ADD COLUMN margin_pct DECIMAL(5,2) NULL;
