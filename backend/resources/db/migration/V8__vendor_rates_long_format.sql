-- Switch vendor_rates from "4 fixed vendor columns" to a long format (one row
-- per origin/destination/vehicle/vendor), matching the new master-rate CSV
-- template (Origin L2 | Destinasi L2 | Vehicle Type | Cost/Rate | Vendor Name)
-- and letting VM upsert individual lanes without wiping the whole table.
DROP TABLE vendor_rates;

CREATE TABLE vendor_rates (
    id                  BIGINT NOT NULL AUTO_INCREMENT,
    origin              VARCHAR(255) NOT NULL,
    destination         VARCHAR(255) NOT NULL,
    vehicle_type        VARCHAR(64) NOT NULL,
    vendor_name         VARCHAR(255) NOT NULL,
    cost                DECIMAL(14,2) NOT NULL,
    norm_origin         VARCHAR(255) NOT NULL,
    norm_destination    VARCHAR(255) NOT NULL,
    norm_vehicle_type   VARCHAR(64) NOT NULL,
    norm_vendor_name    VARCHAR(255) NOT NULL,
    updated_by          VARCHAR(255) NULL,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_vendor_rates_lane_vendor (norm_origin, norm_destination, norm_vehicle_type, norm_vendor_name),
    KEY idx_vendor_rates_lane (norm_origin, norm_destination, norm_vehicle_type)
) DEFAULT CHARSET=utf8mb4;
