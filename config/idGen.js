const pool = require('../config/db');

async function generateID(entity) {
  const conn = await pool.getConnection();
  await conn.query(`UPDATE ID_COUNTER SET last_num = last_num + 1 WHERE entity = ?`, [entity]);
  const [[row]] = await conn.query(`SELECT last_num FROM ID_COUNTER WHERE entity = ?`, [entity]);
  conn.release();

  const num = row.last_num;
  if (entity === 'PERSON')      return `USER-${String(num).padStart(4, '0')}`;
  if (entity === 'VEHICLE')     return `VH-${String(num).padStart(3, '0')}`;
  if (entity === 'TRANSACTION') return `TX-${String(num).padStart(6, '0')}`;
  if (entity === 'PAYMENT')     return `PM-${String(num).padStart(5, '0')}`;
  if (entity === 'FEEDBACK')    return `FB-${String(num).padStart(4, '0')}`;
}

module.exports = generateID;
