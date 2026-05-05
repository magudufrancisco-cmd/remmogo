const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const pool = require('../config/db')

const signToken = (user) =>
  jwt.sign(
    { id: user.member_id, name: user.name, email: user.email, role: user.role, groupId: user.group_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )

// POST /api/auth/register
const register = async (req, res, next) => {
  try {
    const { groupName, name, email, password, phone } = req.body
    if (!groupName || !name || !email || !password)
      return res.status(400).json({ message: 'All fields are required.' })

    const existing = await pool.query('SELECT member_id FROM members WHERE email = $1', [email])
    if (existing.rows.length > 0)
      return res.status(409).json({ message: 'Email already registered.' })

    const hash = await bcrypt.hash(password, 12)

    const groupResult = await pool.query(
      'INSERT INTO groups (name) VALUES ($1) RETURNING group_id',
      [groupName]
    )
    const groupId = groupResult.rows[0].group_id

    const memberResult = await pool.query(
      `INSERT INTO members (group_id, name, email, phone, password, role)
       VALUES ($1, $2, $3, $4, $5, 'signatory')
       RETURNING *`,
      [groupId, name, email, phone || null, hash]
    )

    const user = memberResult.rows[0]
    const token = signToken(user)

    res.status(201).json({
      token,
      user: { id: user.member_id, name: user.name, email: user.email, role: user.role, groupName },
    })
  } catch (err) {
    next(err)
  }
}

// POST /api/auth/login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required.' })

    const result = await pool.query(
      `SELECT m.*, g.name AS group_name
       FROM members m
       JOIN groups g ON g.group_id = m.group_id
       WHERE m.email = $1`,
      [email]
    )

    if (result.rows.length === 0)
      return res.status(401).json({ message: 'Invalid email or password.' })

    const user = result.rows[0]
    const valid = await bcrypt.compare(password, user.password)
    if (!valid)
      return res.status(401).json({ message: 'Invalid email or password.' })

    if (user.status === 'inactive')
      return res.status(403).json({ message: 'Your account is inactive. Contact a signatory.' })

    const token = signToken(user)

    res.json({
      token,
      user: {
        id: user.member_id,
        name: user.name,
        email: user.email,
        role: user.role,
        groupId: user.group_id,
        groupName: user.group_name,
      },
    })
  } catch (err) {
    next(err)
  }
}

module.exports = { register, login }