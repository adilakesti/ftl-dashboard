-- Flyway migration (OceanBase / MySQL dialect).

CREATE TABLE user_roles (
    email       VARCHAR(255) NOT NULL,
    role        ENUM('sales', 'vm') NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (email)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE submissions (
    id              BIGINT NOT NULL AUTO_INCREMENT,
    uploaded_by     VARCHAR(255) NOT NULL,
    filename        VARCHAR(255) NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE submission_rows (
    id              BIGINT NOT NULL AUTO_INCREMENT,
    submission_id   BIGINT NOT NULL,
    origin          VARCHAR(255) NOT NULL,
    destination     VARCHAR(255) NOT NULL,
    vehicle_type    VARCHAR(64) NOT NULL,
    target_rate     DECIMAL(14,2) NULL,
    final_rate      DECIMAL(14,2) NULL,
    remarks         VARCHAR(255) NULL,
    matched_vendor  VARCHAR(64) NULL,
    matched_cost    DECIMAL(14,2) NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_submission_rows_submission (submission_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE vm_requests (
    id                  BIGINT NOT NULL AUTO_INCREMENT,
    submission_row_id   BIGINT NULL,
    origin              VARCHAR(255) NOT NULL,
    destination         VARCHAR(255) NOT NULL,
    vehicle_type        VARCHAR(64) NOT NULL,
    target_rate         DECIMAL(14,2) NULL,
    current_final_rate  DECIMAL(14,2) NULL,
    requested_by        VARCHAR(255) NOT NULL,
    status               ENUM('open', 'in_progress', 'resolved') NOT NULL DEFAULT 'open',
    resolved_vendor      VARCHAR(64) NULL,
    resolved_cost        DECIMAL(14,2) NULL,
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_vm_requests_status (status),
    KEY idx_vm_requests_lane (origin, destination, vehicle_type)
) DEFAULT CHARSET=utf8mb4;
