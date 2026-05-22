'use strict';
const { Sequelize } = require('sequelize');
const { registerDialectHooks } = require('../sqlHelper');
require('dotenv').config();
const seq = new Sequelize(
  process.env.DB_DATABASE_DW, process.env.DB_USER_CT, process.env.DB_PASSWORD_CT,
  {
    host: process.env.DB_SERVER_CT,
    dialect: process.env.DB_DIALECT || 'mssql',
    dialectOptions: { options: { encrypt: true, trustServerCertificate: true, requestTimeout: 60000 } },
    pool: { max: 10, min: 0, acquire: 60000, idle: 10000 },
    logging: false,
  }
);
registerDialectHooks(seq);
module.exports = seq;
