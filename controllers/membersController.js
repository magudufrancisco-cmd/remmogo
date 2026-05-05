const bcrypt = require('bcryptjs')
const pool = require('../config/db')

// GET /api/members
const getMembers = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT member_id AS id, name, email, phone, role, status, join_date AS "joinDate"
       FROM members
       WHERE group_id = $1
       ORDER BY join_date, name`,
      [req.user.groupId]
    )
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
}

// GET /api/members/:id
const getMember = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT member_id AS id, name, email, phone, role, status, join_date AS "joinDate"
       FROM members
       WHERE member_id = $1 AND group_id = $2`,
      [req.params.id, req.user.groupId]
    )
    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Member not found.' })

    res.json(result.rows[0])
  } catch (err) {
    next(err)
  }
}

// POST /api/members  (signatories only)
const addMember = async (req, res, next) => {
  try {
    const { name, email, phone, role = 'member' } = req.body
    if (!name || !email)
      return res.status(400).json({ message: 'Name and email are required.' })

    // Check signatories cap
    if (role === 'signatory') {
      const count = await pool.query(
        `SELECT COUNT(*) AS total FROM members
         WHERE group_id = $1 AND role = 'signatory' AND status = 'active'`,
        [req.user.groupId]
      )
      if (parseInt(count.rows[0].total) >= 2)
        return res.status(400).json({ message: 'Only 2 signatories are allowed per group.' })
    }

    // Check email
    const existing = await pool.query(
      'SELECT member_id FROM members WHERE email = $1',
      [email]
    )
    if (existing.rows.length > 0)
      return res.status(409).json({ message: 'Email already registered.' })

    const defaultPwd = email.split('@')[0] + '1234'
    const hash = await bcrypt.hash(defaultPwd, 12)

    const result = await pool.query(
      `INSERT INTO members (group_id, name, email, phone, password, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING member_id AS id, name, email, phone, role, status, join_date AS "joinDate"`,
      [req.user.groupId, name, email, phone || null, hash, role]
    )

    res.status(201).json({
      ...result.rows[0],
      defaultPassword: defaultPwd,
      message: 'Member added. Default password shown once — please share securely.',
    })
  } catch (err) {
    next(err)
  }
}

module.exports = { getMembers, getMember, addMember }