-- Vendor rates can be revoked (kept for history, no longer used for pricing) and can
-- carry a valid-until date after which they stop being used automatically.
ALTER TABLE vendor_rates ADD COLUMN valid_until DATE NULL;
ALTER TABLE vendor_rates ADD COLUMN revoked_at DATETIME NULL;
ALTER TABLE vendor_rates ADD COLUMN revoked_by VARCHAR(255) NULL;
ALTER TABLE vendor_rates ADD COLUMN revoke_reason VARCHAR(500) NULL;
