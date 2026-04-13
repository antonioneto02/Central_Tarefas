const dotenv = require('dotenv');
dotenv.config();
const config = {
  user: process.env.DB_USER_CT,
  password: process.env.DB_PASSWORD_CT,
  server: process.env.DB_SERVER_CT,
  database: process.env.DB_DATABASE_DW,
  options: {
    encrypt: true,
    trustServerCertificate: true,
    useUTC: false,
    cryptoCredentialsDetails: { minVersion: 'TLSv1' },
  },
  requestTimeout: 1200000,
};

module.exports = config;
