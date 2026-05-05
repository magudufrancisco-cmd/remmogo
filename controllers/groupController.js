const { poolPromise, sql } = require('../config/db')

// GET /api/group
const getGroup = async (req, res, next) => {
  try {
    const pool = await poolPromise
    const result = await pool.request()
      .input('groupId', sql.Int, req.user.groupId)
      .query('SELECT * FROM Groups WHERE group_id = @groupId')

    if (result.recordset.length === 0)
      return res.status(404).json({ message: 'Group not found.' })

    res.json(result.recordset[0])
  } catch (err) {
    next(err)
  }
}

// PUT /api/group  (signatories only)
const updateGroup = async (req, res, next) => {
  try {
    const { name, description, target_amount } = req.body
    const pool = await poolPromise

    await pool.request()
      .input('groupId',      sql.Int,      req.user.groupId)
      .input('name',         sql.NVarChar, name || null)
      .input('description',  sql.NVarChar, description || null)
      .input('targetAmount', sql.Decimal,  target_amount || null)
      .query(`UPDATE Groups SET
                name          = ISNULL(@name,         name),
                description   = ISNULL(@description,  description),
                target_amount = ISNULL(@targetAmount,  target_amount)
              WHERE group_id = @groupId`)

    const updated = await pool.request()
      .input('groupId', sql.Int, req.user.groupId)
      .query('SELECT * FROM Groups WHERE group_id = @groupId')

    res.json(updated.recordset[0])
  } catch (err) {
    next(err)
  }
}

module.exports = { getGroup, updateGroup }
