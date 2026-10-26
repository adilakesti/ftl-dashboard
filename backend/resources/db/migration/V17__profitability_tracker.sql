-- Profitability: shippers sales confirmed as going live, plus each live shipper's
-- editable "spreadsheet" (Sheet 1 quotation cost, frozen at go-live; Sheet 2 orders).
-- Keyed by shipper_name, same as how the app already groups a shipper's submissions.
CREATE TABLE go_live_shippers (
    shipper_name    VARCHAR(255) NOT NULL,
    confirmed_by    VARCHAR(255) NOT NULL,
    confirmed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (shipper_name)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE tracker_quotation (
    id              BIGINT NOT NULL AUTO_INCREMENT,
    shipper_name    VARCHAR(255) NOT NULL,
    position        INT NOT NULL DEFAULT 0,
    origin          VARCHAR(255) NOT NULL,
    destination     VARCHAR(255) NOT NULL,
    vehicle_type    VARCHAR(64) NOT NULL,
    vendor          VARCHAR(255) NULL,
    cost            DECIMAL(14,2) NULL,
    rate            DECIMAL(14,2) NULL,
    PRIMARY KEY (id),
    KEY idx_tracker_quotation_shipper (shipper_name, position)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE tracker_orders (
    id                    BIGINT NOT NULL AUTO_INCREMENT,
    shipper_name          VARCHAR(255) NOT NULL,
    position              INT NOT NULL DEFAULT 0,
    order_no              VARCHAR(64) NULL,
    order_date            DATE NULL,
    origin                VARCHAR(255) NULL,
    destination           VARCHAR(255) NULL,
    vehicle_type          VARCHAR(64) NULL,
    status                ENUM('completed', 'cancelled') NULL,
    planned_vendor        VARCHAR(255) NULL,
    est_cost              DECIMAL(14,2) NULL,
    rate                  DECIMAL(14,2) NULL,
    actual_vendor         VARCHAR(255) NULL,
    actual_invoice_cost   DECIMAL(14,2) NULL,
    revenue_uang_jalan    DECIMAL(14,2) NULL,
    revenue_overnight     DECIMAL(14,2) NULL,
    PRIMARY KEY (id),
    KEY idx_tracker_orders_shipper (shipper_name, position)
) DEFAULT CHARSET=utf8mb4;
