-- Additional services (Overnight / TKBM / Additional Drop Point) asked of VM per
-- submission. One row per requested service; the submission's request is done
-- once every row has a unit price or is marked unavailable.
CREATE TABLE service_requests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    submission_id BIGINT NOT NULL,
    service VARCHAR(32) NOT NULL,
    note VARCHAR(1000) NULL,
    unit_price DECIMAL(18, 2) NULL,
    unavailable TINYINT(1) NOT NULL DEFAULT 0,
    auto_closed_sla TINYINT(1) NOT NULL DEFAULT 0,
    answered_by VARCHAR(255) NULL,
    answered_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_service_requests_submission (submission_id)
);
