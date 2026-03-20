const axios = require("axios");
const dotenv = require("dotenv");
const sql = require("mssql");
const dbConfigDw = require("../config/dbConfigDw");

dotenv.config();

let _sharedPool = null;
async function getPool() {
  if (_sharedPool && _sharedPool.connected) return _sharedPool;
  const pool = new sql.ConnectionPool(dbConfigDw);
  _sharedPool = await pool.connect();
  _sharedPool.on('error', () => { _sharedPool = null; });
  return _sharedPool;
}
async function validaLogin(username, password, res, req) {
  let protheusServer = process.env.PROTHEUS_SERVER;
  try {
    if (req && req.session) {
      req.session.destroy((err) => {
        if (err) {
          console.error("Erro ao limpar sessão anterior:", err);
        }
      });
    }

    res.clearCookie("token", { httpOnly: true, secure: false, sameSite: "lax" });
    res.clearCookie("refresh_token", { httpOnly: true, secure: false, sameSite: "lax" });
    res.clearCookie("username", { httpOnly: true, secure: false, sameSite: "lax" });

    const response = await axios.post(
      `http://${protheusServer}:9001/rest/api/oauth2/v1/token`,
      null,
      {
        params: { grant_type: "password", username: username, password: password },
        timeout: 10000,
      }
    );

    let { access_token, refresh_token } = response.data || {};
    res.cookie("token", access_token, { httpOnly: true, secure: false, sameSite: "lax", maxAge: 3600000 });
    res.cookie("refresh_token", refresh_token, { httpOnly: true, secure: false, sameSite: "lax", maxAge: 43200000 });
    res.cookie("username", username, { httpOnly: true, secure: false, sameSite: "lax", maxAge: 43200000 });

    if (!res.headersSent) {
      return res.status(200).json({ message: "Login bem-sucedido!", redirect: '/dashboard' });
    }
  } catch (error) {
    console.error("Erro ao realizar login:", {
      message: error.message,
      responseData: error.response ? error.response.data : null,
      responseStatus: error.response ? error.response.status : null,
    });
    return res.redirect("/loginPage?error=invalid_credentials");
  }
}

async function verificarEAtualizarToken(req, res, next) {
  if (req.session && req.session.userID && req.session.groups && req.session.groups.length > 0) {
    const now = Date.now();
    const lastActivity = req.session.lastActivity || now;
    if (now - lastActivity < 120 * 60 * 1000) {
      req.session.lastActivity = now;
      return next();
    }
  }
  const token = req.cookies["token"];
  const refresh_token = req.cookies["refresh_token"];
  if (!token && refresh_token) {
    const atualizou = await atualizaToken(refresh_token, res);
    if (!atualizou) return res.redirect("/loginPage");
    return next();
  } else if (!token && !refresh_token) {
    return res.redirect("/loginPage");
  }
  return next();
}

async function atualizaToken(refresh_token_param, res) {
  let protheusServer = process.env.PROTHEUS_SERVER;
  try {
    let response = await axios.post(
      `http://${protheusServer}:9001/rest/api/oauth2/v1/token`,
      null,
      { params: { grant_type: "refresh_token", refresh_token: refresh_token_param } }
    );
    let { access_token, refresh_token } = response.data;
    res.cookie("token", access_token, { httpOnly: true, secure: false, sameSite: "lax", maxAge: 3600000 });
    res.cookie("refresh_token", refresh_token, { httpOnly: true, secure: false, sameSite: "lax", maxAge: 43200000 });
    return true;
  } catch (error) {
    console.error("Erro ao atualizar token:", error);
    return false;
  }
}

module.exports = { validaLogin, verificarEAtualizarToken };
