-- Personal notifications (currently: @mentions in a submission's discussion).
CREATE TABLE notifications (
    id              BIGINT NOT NULL AUTO_INCREMENT,
    recipient_email VARCHAR(255) NOT NULL,
    submission_id   BIGINT NOT NULL,
    message         VARCHAR(500) NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at         DATETIME NULL,
    PRIMARY KEY (id),
    KEY idx_notifications_recipient (recipient_email, read_at, created_at)
) DEFAULT CHARSET=utf8mb4;

-- Per-user "last viewed" marker for a submission's ticket/discussion, used to
-- show a "new" badge on tickets a VM user hasn't opened yet.
CREATE TABLE ticket_views (
    viewer_email    VARCHAR(255) NOT NULL,
    submission_id   BIGINT NOT NULL,
    last_viewed_at  DATETIME NOT NULL,
    PRIMARY KEY (viewer_email, submission_id)
) DEFAULT CHARSET=utf8mb4;
