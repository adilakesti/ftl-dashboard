-- Discussion thread scoped to a shipper (submission), not a single OD lane —
-- shared across every VM request raised from that submission's rows.
CREATE TABLE submission_comments (
    id              BIGINT NOT NULL AUTO_INCREMENT,
    submission_id   BIGINT NOT NULL,
    author_email    VARCHAR(255) NOT NULL,
    message         TEXT NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_submission_comments_submission (submission_id, created_at)
) DEFAULT CHARSET=utf8mb4;
