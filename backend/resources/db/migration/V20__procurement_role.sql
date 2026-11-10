-- Procurement: same rights as VM (backend/permissions.py), its own label.
ALTER TABLE user_roles MODIFY role ENUM('sales', 'vm', 'superadmin', 'procurement') NOT NULL;
