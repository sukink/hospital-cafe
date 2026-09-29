const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'hospital_food',
  port: process.env.DB_PORT || 3306,

  // Most hosted MySQL providers (e.g. Render, PlanetScale, Aiven) require SSL.
  // Local/plain MySQL or MariaDB usually doesn't support it, so it can be turned
  // off for local development with DB_SSL=false in .env.
  ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true
});

module.exports = pool;