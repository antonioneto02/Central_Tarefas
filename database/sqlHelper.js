'use strict';

/**
 * Camada de compatibilidade SQL entre SQL Server (T-SQL) e PostgreSQL.
 *
 * Registre em cada instância Sequelize com: registerDialectHooks(sequelizeInstance)
 *
 * O hook beforeQuery intercepta cada query e traduz automaticamente os
 * construtores T-SQL para o equivalente ANSI/PostgreSQL quando dialect='postgres'.
 * Quando dialect='mssql' nada é alterado.
 *
 * Cobertura dos SELECTs:
 *   ✅ ISNULL        → COALESCE
 *   ✅ WITH (NOLOCK) → removido
 *   ✅ GETDATE()     → CURRENT_TIMESTAMP
 *   ✅ IIF(a,b,c)    → CASE WHEN a THEN b ELSE c END
 *   ✅ CONVERT(VARCHAR, date, 103/112/120) → TO_CHAR
 *   ✅ CONVERT(type, expr) → CAST
 *   ✅ TRY_CONVERT   → CAST (best-effort)
 *   ✅ DATEADD       → interval arithmetic
 *   ✅ DATEDIFF      → date_part / age
 *   ✅ LEN()         → LENGTH()
 *   ✅ TOP N         → LIMIT N (queries simples)
 *   ✅ STRING_AGG WITHIN GROUP → STRING_AGG (ORDER BY)
 *   ✅ CHARINDEX     → STRPOS
 *   ✅ STUFF         → OVERLAY
 *   ✅ FORMAT(val,'c','pt-br') → TO_CHAR monetário
 *   ✅ NEWID()       → gen_random_uuid()
 *   ⚠️ Cross-DB (dw.dbo., p11_prod..) → requer migração de schema
 *   ⚠️ TVFs, MERGE, SPs → requer reescrita manual
 */

// ─── mapeamento DATEADD ────────────────────────────────────────────────────
const DATEADD_UNIT_MAP = {
  year: 'years', yy: 'years', yyyy: 'years',
  quarter: 'months', qq: 'months', q: 'months',
  month: 'months', mm: 'months', m: 'months',
  week: 'weeks', wk: 'weeks', ww: 'weeks',
  day: 'days', dd: 'days', d: 'days',
  hour: 'hours', hh: 'hours',
  minute: 'minutes', mi: 'minutes', n: 'minutes',
  second: 'seconds', ss: 'seconds', s: 'seconds',
};

// ─── mapeamento DATEDIFF ───────────────────────────────────────────────────
const DATEDIFF_UNIT_MAP = {
  year: 'year', yy: 'year', yyyy: 'year',
  month: 'month', mm: 'month', m: 'month',
  day: 'day', dd: 'day', d: 'day',
  hour: 'hour', hh: 'hour',
  minute: 'minute', mi: 'minute', n: 'minute',
  second: 'second', ss: 'second', s: 'second',
};

// ─── mapeamento CONVERT date-format ───────────────────────────────────────
const CONVERT_DATE_FMT = {
  '101': 'MM/DD/YYYY',
  '103': 'DD/MM/YYYY',
  '104': 'DD.MM.YYYY',
  '105': 'DD-MM-YYYY',
  '110': 'MM-DD-YYYY',
  '111': 'YYYY/MM/DD',
  '112': 'YYYYMMDD',
  '120': 'YYYY-MM-DD HH24:MI:SS',
  '121': 'YYYY-MM-DD HH24:MI:SS.MS',
  '126': 'YYYY-MM-DD"T"HH24:MI:SS',
};

// ─── helpers internos ─────────────────────────────────────────────────────

/** Resolve um nível de parênteses a partir da posição `start`. Retorna o índice do ')' correspondente. */
function findCloseParen(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Divide argumentos de uma chamada de função respeitando parênteses e strings. */
function splitArgs(inner) {
  const args = [];
  let depth = 0, inStr = false, strChar = '', start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) { if (c === strChar) inStr = false; continue; }
    if (c === "'" || c === '"') { inStr = true; strChar = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { args.push(inner.slice(start, i).trim()); start = i + 1; }
  }
  args.push(inner.slice(start).trim());
  return args;
}

/** Substitui recursivamente IIF aninhados. */
function replaceIIF(sql) {
  const re = /\bIIF\s*\(/gi;
  let result = sql;
  let safety = 50;
  while (safety-- > 0) {
    let match; re.lastIndex = 0;
    const m = re.exec(result);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    const close = findCloseParen(result, open);
    if (close === -1) break;
    const inner = result.slice(open + 1, close);
    const [cond, tVal, fVal] = splitArgs(inner);
    const replacement = `CASE WHEN ${cond} THEN ${tVal} ELSE ${fVal} END`;
    result = result.slice(0, m.index) + replacement + result.slice(close + 1);
  }
  return result;
}

/** Substitui CONVERT(VARCHAR(N), expr, code) por TO_CHAR(expr, fmt). */
function replaceConvertDate(sql) {
  // CONVERT(VARCHAR(N), expr, code)
  const re = /\bCONVERT\s*\(\s*VARCHAR\s*\(\s*\d+\s*\)\s*,/gi;
  let result = sql;
  let m; re.lastIndex = 0;
  while ((m = re.exec(result)) !== null) {
    const open = result.indexOf('(', m.index) ;
    const close = findCloseParen(result, open);
    if (close === -1) { re.lastIndex = m.index + 1; continue; }
    const inner = result.slice(open + 1, close);
    const args = splitArgs(inner);
    if (args.length === 3) {
      const code = args[2].trim();
      const fmt = CONVERT_DATE_FMT[code];
      if (fmt) {
        const replacement = `TO_CHAR(${args[1].trim()}, '${fmt}')`;
        result = result.slice(0, m.index) + replacement + result.slice(close + 1);
        re.lastIndex = m.index + replacement.length;
        continue;
      }
    }
    re.lastIndex = close + 1;
  }
  return result;
}

/** Substitui CONVERT(type, expr) sem código de formato → CAST(expr AS type). */
function replaceConvertSimple(sql) {
  const TYPE_MAP = {
    INT: 'INTEGER', INTEGER: 'INTEGER', BIGINT: 'BIGINT',
    FLOAT: 'DOUBLE PRECISION', REAL: 'REAL',
    DECIMAL: 'DECIMAL', NUMERIC: 'NUMERIC',
    DATE: 'DATE', DATETIME: 'TIMESTAMP', DATETIME2: 'TIMESTAMP',
    VARCHAR: 'VARCHAR', NVARCHAR: 'VARCHAR', CHAR: 'CHAR',
    BIT: 'BOOLEAN',
  };
  // Matches CONVERT(type, expr) or CONVERT(type(N), expr) with only 2 args
  const re = /\bCONVERT\s*\(/gi;
  let result = sql;
  let m; re.lastIndex = 0;
  while ((m = re.exec(result)) !== null) {
    const open = result.lastIndexOf('(', m.index + m[0].length);
    const close = findCloseParen(result, open);
    if (close === -1) { re.lastIndex = m.index + 1; continue; }
    const inner = result.slice(open + 1, close);
    const args = splitArgs(inner);
    if (args.length === 2) {
      const rawType = args[0].trim().replace(/\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\)/, '').toUpperCase();
      const pgType = TYPE_MAP[rawType];
      if (pgType) {
        const sizeMatch = args[0].match(/\(\s*(\d+(?:\s*,\s*\d+)?)\s*\)/);
        const size = sizeMatch ? `(${sizeMatch[1]})` : '';
        const replacement = `CAST(${args[1].trim()} AS ${pgType}${size})`;
        result = result.slice(0, m.index) + replacement + result.slice(close + 1);
        re.lastIndex = m.index + replacement.length;
        continue;
      }
    }
    re.lastIndex = close + 1;
  }
  return result;
}

/** Substitui DATEADD(unit, n, date). Suporta literais inteiros e @params/:params. */
function replaceDateAdd(sql) {
  const re = /\bDATEADD\s*\(/gi;
  let result = sql;
  let m; re.lastIndex = 0;
  while ((m = re.exec(result)) !== null) {
    const open = result.lastIndexOf('(', m.index + m[0].length);
    const close = findCloseParen(result, open);
    if (close === -1) { re.lastIndex = m.index + 1; continue; }
    const inner = result.slice(open + 1, close);
    const args = splitArgs(inner);
    if (args.length === 3) {
      const unit = args[0].trim().toLowerCase().replace(/['"]/g, '');
      const n = args[1].trim();
      const dateExpr = args[2].trim();
      const pgUnit = DATEADD_UNIT_MAP[unit];
      if (pgUnit) {
        let replacement;
        const numMatch = n.match(/^(-?\d+)$/);
        if (numMatch) {
          const num = parseInt(numMatch[1]);
          if (num < 0) {
            replacement = `(${dateExpr} - INTERVAL '${Math.abs(num)} ${pgUnit}')`;
          } else {
            replacement = `(${dateExpr} + INTERVAL '${num} ${pgUnit}')`;
          }
        } else {
          // :param or expression — use dynamic interval
          replacement = `(${dateExpr} + (${n} || ' ${pgUnit}')::INTERVAL)`;
        }
        result = result.slice(0, m.index) + replacement + result.slice(close + 1);
        re.lastIndex = m.index + replacement.length;
        continue;
      }
    }
    re.lastIndex = close + 1;
  }
  return result;
}

/** Substitui DATEDIFF(unit, d1, d2). */
function replaceDateDiff(sql) {
  const re = /\bDATEDIFF\s*\(/gi;
  let result = sql;
  let m; re.lastIndex = 0;
  while ((m = re.exec(result)) !== null) {
    const open = result.lastIndexOf('(', m.index + m[0].length);
    const close = findCloseParen(result, open);
    if (close === -1) { re.lastIndex = m.index + 1; continue; }
    const inner = result.slice(open + 1, close);
    const args = splitArgs(inner);
    if (args.length === 3) {
      const unit = args[0].trim().toLowerCase().replace(/['"]/g, '');
      const d1 = args[1].trim();
      const d2 = args[2].trim();
      const pgUnit = DATEDIFF_UNIT_MAP[unit];
      let replacement;
      if (pgUnit === 'day') {
        replacement = `(${d2}::date - ${d1}::date)`;
      } else if (pgUnit) {
        replacement = `EXTRACT(${pgUnit.toUpperCase()} FROM AGE(${d2}::timestamp, ${d1}::timestamp))::INTEGER`;
      } else {
        re.lastIndex = close + 1; continue;
      }
      result = result.slice(0, m.index) + replacement + result.slice(close + 1);
      re.lastIndex = m.index + replacement.length;
      continue;
    }
    re.lastIndex = close + 1;
  }
  return result;
}

/** Substitui SELECT TOP N / SELECT TOP (N) → remove TOP e adiciona LIMIT N ao final. */
function replaceTop(sql) {
  const re = /\bSELECT\s+TOP\s+\(?(\d+)\)?\s+/i;
  const m = sql.match(re);
  if (!m) return sql;
  const n = m[1];
  let result = sql.replace(re, 'SELECT ');
  // Remove trailing semicolon if present, add LIMIT, put semicolon back
  const hasSemi = result.trimEnd().endsWith(';');
  if (hasSemi) result = result.trimEnd().slice(0, -1);
  result = result.trimEnd() + ` LIMIT ${n}`;
  if (hasSemi) result += ';';
  return result;
}

/** STRING_AGG(x,'sep') WITHIN GROUP (ORDER BY y) → STRING_AGG(x,'sep' ORDER BY y) */
function replaceStringAgg(sql) {
  return sql.replace(
    /STRING_AGG\s*\(([^)]+)\)\s+WITHIN\s+GROUP\s*\(\s*ORDER\s+BY\s+([^)]+)\)/gi,
    (_, expr, order) => `STRING_AGG(${expr.trim()} ORDER BY ${order.trim()})`
  );
}

/** CHARINDEX(substr, str) → STRPOS(str, substr) */
function replaceCharIndex(sql) {
  const re = /\bCHARINDEX\s*\(/gi;
  let result = sql;
  let m; re.lastIndex = 0;
  while ((m = re.exec(result)) !== null) {
    const open = result.lastIndexOf('(', m.index + m[0].length);
    const close = findCloseParen(result, open);
    if (close === -1) { re.lastIndex = m.index + 1; continue; }
    const args = splitArgs(result.slice(open + 1, close));
    if (args.length >= 2) {
      const replacement = `STRPOS(${args[1].trim()}, ${args[0].trim()})`;
      result = result.slice(0, m.index) + replacement + result.slice(close + 1);
      re.lastIndex = m.index + replacement.length;
    } else {
      re.lastIndex = close + 1;
    }
  }
  return result;
}

/** STUFF(str, start, len, replace) → OVERLAY(str PLACING replace FROM start FOR len) */
function replaceStuff(sql) {
  const re = /\bSTUFF\s*\(/gi;
  let result = sql;
  let m; re.lastIndex = 0;
  while ((m = re.exec(result)) !== null) {
    const open = result.lastIndexOf('(', m.index + m[0].length);
    const close = findCloseParen(result, open);
    if (close === -1) { re.lastIndex = m.index + 1; continue; }
    const args = splitArgs(result.slice(open + 1, close));
    if (args.length === 4) {
      const replacement = `OVERLAY(${args[0].trim()} PLACING ${args[3].trim()} FROM ${args[1].trim()} FOR ${args[2].trim()})`;
      result = result.slice(0, m.index) + replacement + result.slice(close + 1);
      re.lastIndex = m.index + replacement.length;
    } else {
      re.lastIndex = close + 1;
    }
  }
  return result;
}

/** FORMAT(val, 'c', locale) → TO_CHAR monetário (aproximação). */
function replaceFormat(sql) {
  const re = /\bFORMAT\s*\(/gi;
  let result = sql;
  let m; re.lastIndex = 0;
  while ((m = re.exec(result)) !== null) {
    const open = result.lastIndexOf('(', m.index + m[0].length);
    const close = findCloseParen(result, open);
    if (close === -1) { re.lastIndex = m.index + 1; continue; }
    const args = splitArgs(result.slice(open + 1, close));
    if (args.length >= 2) {
      const fmtArg = args[1].trim().replace(/['"]/g, '').toLowerCase();
      let replacement;
      if (fmtArg === 'c' || fmtArg.startsWith('c')) {
        replacement = `TO_CHAR(${args[0].trim()}, 'FM999G999G999G990D00')`;
      } else {
        replacement = `TO_CHAR(${args[0].trim()}, '${fmtArg}')`;
      }
      result = result.slice(0, m.index) + replacement + result.slice(close + 1);
      re.lastIndex = m.index + replacement.length;
    } else {
      re.lastIndex = close + 1;
    }
  }
  return result;
}

/** TRY_CONVERT(type, expr) → CAST(expr AS type) — best effort, sem try/catch no SQL. */
function replaceTryConvert(sql) {
  return sql.replace(/\bTRY_CONVERT\s*\(/gi, 'CONVERT(');
}

// ─── tradução principal ────────────────────────────────────────────────────

/**
 * Traduz uma query T-SQL para ANSI/PostgreSQL.
 * Chamado automaticamente via hook quando dialect='postgres'.
 */
function translateToPostgres(sql) {
  if (!sql || typeof sql !== 'string') return sql;

  let s = sql;

  // Ordem importa: substituir antes de alterar a estrutura

  // 1. TRY_CONVERT → CONVERT (antes de replaceConvertDate)
  s = replaceTryConvert(s);

  // 2. CONVERT(VARCHAR(N), date, code) → TO_CHAR
  s = replaceConvertDate(s);

  // 3. CONVERT(type, expr) → CAST (2 args)
  s = replaceConvertSimple(s);

  // 4. ISNULL → COALESCE
  s = s.replace(/\bISNULL\s*\(/gi, 'COALESCE(');

  // 5. WITH (NOLOCK) → remover
  s = s.replace(/\s+WITH\s*\(\s*NOLOCK\s*\)/gi, '');

  // 6. GETDATE() → CURRENT_TIMESTAMP
  s = s.replace(/\bGETDATE\s*\(\)/gi, 'CURRENT_TIMESTAMP');

  // 7. NEWID() → gen_random_uuid()
  s = s.replace(/\bNEWID\s*\(\)/gi, 'gen_random_uuid()');

  // 8. IIF → CASE WHEN
  s = replaceIIF(s);

  // 9. DATEADD → interval arithmetic
  s = replaceDateAdd(s);

  // 10. DATEDIFF → date_part / age
  s = replaceDateDiff(s);

  // 11. STRING_AGG WITHIN GROUP → STRING_AGG (ORDER BY)
  s = replaceStringAgg(s);

  // 12. CHARINDEX → STRPOS
  s = replaceCharIndex(s);

  // 13. STUFF → OVERLAY
  s = replaceStuff(s);

  // 14. FORMAT(val, 'c', locale) → TO_CHAR
  s = replaceFormat(s);

  // 15. LEN( → LENGTH(
  s = s.replace(/\bLEN\s*\(/gi, 'LENGTH(');

  // 16. TOP N → LIMIT N  (somente SELECT simples de nível externo)
  s = replaceTop(s);

  return s;
}

// ─── registro do hook ─────────────────────────────────────────────────────

/**
 * Registra o hook de tradução em uma instância Sequelize.
 * Quando dialect='mssql' o hook existe mas não faz nada (zero overhead).
 * Quando dialect='postgres' todas as queries passam pela tradução.
 *
 * @param {import('sequelize').Sequelize} sequelizeInstance
 */
function registerDialectHooks(sequelizeInstance) {
  sequelizeInstance.addHook('beforeQuery', (options) => {
    if (sequelizeInstance.getDialect() === 'postgres' && options.sql) {
      options.sql = translateToPostgres(options.sql);
    }
  });
}

module.exports = { registerDialectHooks, translateToPostgres };
