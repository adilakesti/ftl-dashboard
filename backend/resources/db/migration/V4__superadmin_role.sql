ALTER TABLE user_roles MODIFY role ENUM('sales', 'vm', 'superadmin') NOT NULL;

INSERT INTO user_roles (email, role) VALUES ('adila.kestibawani@ninjavan.co', 'superadmin')
    ON DUPLICATE KEY UPDATE role = 'superadmin';
