require('dotenv').config();
const mysql = require('mysql2/promise');

async function runMigration() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Connected to Aiven database...');
        await connection.execute(`ALTER TABLE order_item_addons ADD COLUMN addon_price DECIMAL(10, 2) DEFAULT 0.00;`);
        console.log('Successfully added addon_price column!');
    } catch (err) {
        console.error('Note:', err.message);
    } finally {
        await connection.end();
    }
}

runMigration();