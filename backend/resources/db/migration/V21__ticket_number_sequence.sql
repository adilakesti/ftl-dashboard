-- Ticket numbers (FTL-000123) are a running number given when a request is submitted,
-- not the row id: the database may skip ahead in big jumps when it allocates ids.
-- Already-submitted tickets are numbered by the backend at startup, oldest first.
ALTER TABLE submissions ADD COLUMN ticket_seq INT NULL;
ALTER TABLE submissions ADD UNIQUE KEY uniq_submissions_ticket_seq (ticket_seq);
