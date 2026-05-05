const pool = require('../config/db')

// GET /api/group
const getGroup = async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM groups WHERE group_id = $1',
      [req.user.groupId]
    )
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Group not found.' })

    res.json(result.rows[0])
  } catch (err) {
    next(err)
  }
}

// PUT /api/group  (signatories only)
const updateGroup = async (req, res, next) => {
  try {
    const { name, description, target_amount } = req.body

    await pool.query(
      `UPDATE groups SET
         name          = COALESCE($1, name),
         description   = COALESCE($2, description),
         target_amount = COALESCE($3, target_amount)
       WHERE group_id = $4`,
      [name || null, description || null, target_amount || null, req.user.groupId]
    )

    const updated = await pool.query(
      'SELECT * FROM groups WHERE group_id = $1',
      [req.user.groupId]
    )

    res.json(updated.rows[0])
  } catch (err) {
    next(err)
  }
}

module.exports = { getGroup, updateGroup }