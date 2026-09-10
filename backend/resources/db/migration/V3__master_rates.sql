-- Master vendor-cost data, refreshed by VM uploading a CSV export of the
-- "Database Rate" Google Sheet tab (replaces the live-sheet integration, which
-- org policy blocked both the public-link and service-account routes for).

CREATE TABLE vendor_rates (
    id                  BIGINT NOT NULL AUTO_INCREMENT,
    origin              VARCHAR(255) NOT NULL,
    destination         VARCHAR(255) NOT NULL,
    vehicle_type        VARCHAR(64) NOT NULL,
    norm_origin         VARCHAR(255) NOT NULL,
    norm_destination    VARCHAR(255) NOT NULL,
    norm_vehicle_type   VARCHAR(64) NOT NULL,
    duta_cost           DECIMAL(14,2) NULL,
    seryu_cost          DECIMAL(14,2) NULL,
    ab_cargo_cost       DECIMAL(14,2) NULL,
    sjl_cost            DECIMAL(14,2) NULL,
    PRIMARY KEY (id),
    KEY idx_vendor_rates_lane (norm_origin, norm_destination, norm_vehicle_type)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE master_rate_uploads (
    id              BIGINT NOT NULL AUTO_INCREMENT,
    uploaded_by     VARCHAR(255) NOT NULL,
    filename        VARCHAR(255) NULL,
    row_count       INT NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) DEFAULT CHARSET=utf8mb4;
