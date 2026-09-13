ALTER TABLE vm_requests
    MODIFY status ENUM('open', 'in_progress', 'resolved', 'closed_no_vendor') NOT NULL DEFAULT 'open';
