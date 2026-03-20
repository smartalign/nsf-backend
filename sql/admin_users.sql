CREATE TABLE IF NOT EXISTS admin_users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'admin',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default login:
-- username: admin
-- password: admin123
INSERT INTO admin_users (username, password_hash, role, is_active)
SELECT 'admin', '$2b$10$aFtJ9uPKPmikkfusrEsFqujiIiuEWz30vf5.WS9TKCl3L9nf5.6J.', 'super_admin', 1
WHERE NOT EXISTS (
  SELECT 1 FROM admin_users WHERE username = 'admin'
);
