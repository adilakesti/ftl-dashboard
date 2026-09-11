INSERT INTO user_roles (email, role) VALUES ('baskoro.nugroho@ninjavan.co', 'superadmin')
    ON DUPLICATE KEY UPDATE role = 'superadmin';
