-- Hospital Cafe database schema
-- NOTE: No payment fields anywhere. No patient personal data.

CREATE DATABASE IF NOT EXISTS hospital_food
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE hospital_food;

-- -----------------------------------------------------
-- menu_items
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120)   NOT NULL,
  category      ENUM('Breakfast', 'Main Course', 'Snacks', 'Beverages') NOT NULL,
  description   VARCHAR(500)   DEFAULT '',
  serving       VARCHAR(60)    NOT NULL,
  food_type     ENUM('veg', 'nonveg') NOT NULL,
  image         VARCHAR(255)   DEFAULT NULL,
  price         DECIMAL(10,2)  NOT NULL,
  available     TINYINT(1)     NOT NULL DEFAULT 1,
  created_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- -----------------------------------------------------
-- orders
-- room_number is patient-entered, non-PII (bed/room only)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  room_number           VARCHAR(20)   NOT NULL,
  total_amount          DECIMAL(10,2) NOT NULL,
  special_instructions  VARCHAR(300)  DEFAULT '',
  status                ENUM('Pending', 'Preparing', 'Ready', 'Delivered', 'Cancelled')
                          NOT NULL DEFAULT 'Pending',
  order_time            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- -----------------------------------------------------
-- order_items
-- price is snapshotted at time of order (price history)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  order_id    INT NOT NULL,
  item_id     INT NOT NULL,
  item_name   VARCHAR(120)  NOT NULL,
  unit_price  DECIMAL(10,2) NOT NULL,
  quantity    INT NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_order_items_order
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------
-- Seed data: exactly the 7 required menu items
-- -----------------------------------------------------
INSERT INTO menu_items (name, category, description, serving, food_type, image, price, available) VALUES
('Idly', 'Breakfast', 'Soft steamed South Indian rice cakes.', '1 Plate', 'veg', 'idly.png', 60.00, 1),
('Dosa', 'Breakfast', 'Crispy South Indian rice crepe.', '1 Plate', 'veg', 'dosa.png', 70.00, 1),
('Chicken Biriyani', 'Main Course', 'Aromatic chicken biriyani with fragrant rice and spices.', '1 Plate', 'nonveg', 'chicken-biriyani.png', 150.00, 1),
('Mixed Veg Sandwich', 'Snacks', 'Fresh mixed vegetable sandwich.', '1 Sandwich', 'veg', 'veg-sandwich.png', 70.00, 1),
('Egg Sandwich', 'Snacks', 'Fresh egg sandwich.', '1 Sandwich', 'nonveg', 'egg-sandwich.png', 85.00, 1),
('Tea', 'Beverages', 'Freshly prepared hot tea.', '1 Cup', 'veg', 'tea.png', 25.00, 1),
('Coffee', 'Beverages', 'Freshly prepared hot coffee.', '1 Cup', 'veg', 'coffee.png', 30.00, 1);
