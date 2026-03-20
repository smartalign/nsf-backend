import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

// Create and export a reusable function for getting a DB connection
export async function getConnection() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "localhost",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "nsf",
    port: process.env.MYSQL_PORT || 3306,  // ✅ add this line
  });
  return connection;
}


// import mysql from "mysql2/promise";

// const pool = mysql.createPool({
//   host: process.env.MYSQL_HOST,
//   user: process.env.MYSQL_USER,
//   password: process.env.MYSQL_PASSWORD,
//   database: process.env.MYSQL_DATABASE,
//   port: process.env.MYSQL_PORT,
//   waitForConnections: true,
//   connectionLimit: 5,
//   queueLimit: 0,
// });

// export async function getConnection() {
//   return pool;
// }

