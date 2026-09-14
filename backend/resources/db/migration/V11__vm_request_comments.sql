-- Discussion thread attached to a VM request; persists across
-- open -> resolved/closed so sales and VM can keep talking on a ticket
-- even after it's completed.
CREATE TABLE vm_request_comments (
    id              BIGINT NOT NULL AUTO_INCREMENT,
    vm_request_id   BIGINT NOT NULL,
    author_email    VARCHAR(255) NOT NULL,
    message         TEXT NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_vm_request_comments_request (vm_request_id, created_at)
) DEFAULT CHARSET=utf8mb4;
