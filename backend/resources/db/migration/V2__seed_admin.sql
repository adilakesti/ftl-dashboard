-- Seed the initial user as 'sales' so there's a working account right after deploy.
-- Add more rows (and 'vm' role users) via the portal's Database tab as needed.
INSERT INTO user_roles (email, role) VALUES ('workinpns@gmail.com', 'sales');
