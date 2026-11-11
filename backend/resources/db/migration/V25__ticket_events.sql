-- Ticket history: what happened to a ticket, when and by whom (raised, sent to VM,
-- status changes, rate set, lane edits, go-live...). Replaces the automatic "System"
-- notes that used to be written into the Discussion.
CREATE TABLE ticket_events (
    id              BIGINT NOT NULL AUTO_INCREMENT,
    submission_id   BIGINT NOT NULL,
    stage           VARCHAR(64) NOT NULL,
    detail          VARCHAR(1000) NULL,
    actor           VARCHAR(255) NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_ticket_events_submission (submission_id, created_at)
) DEFAULT CHARSET=utf8mb4;
