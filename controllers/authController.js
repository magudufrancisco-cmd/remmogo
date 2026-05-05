const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { poolPromise, sql } = require('../config/db')

// Helper: sign a token
const signToken = (user) =>
  jwt.sign(
    { id: user.member_id, name: user.name, email: user.email, role: user.role, groupId: user.group_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  )

// POST /api/auth/register
// Registers the FIRST member of a new group (and creates the group).
// Subsequent members are added by signatories via /api/members.
const register = async (req, res, next) => {
  try {
    const { groupName, name, email, password, phone } = req.body
    if (!groupName || !name || !email || !password)
      return res.status(400).json({ message: 'All fields are required.' })

    const pool = await poolPromise

    // Check email not already taken
    const existing = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT member_id FROM Members WHERE email = @email')
    if (existing.recordset.length > 0)
      return res.status(409).json({ message: 'Email already registered.' })

    const hash = await bcrypt.hash(password, 12)

    // Create group
    const groupResult = await pool.request()
      .input('name', sql.NVarChar, groupName)
      .query('INSERT INTO Groups (name) OUTPUT INSERTED.group_id VALUES (@name)')
    const groupId = groupResult.recordset[0].group_id

    // Create first member as signatory
    const memberResult = await pool.request()
      .input('groupId', sql.Int, groupId)
      .input('name',    sql.NVarChar, name)
      .input('email',   sql.NVarChar, email)
      .input('phone',   sql.NVarChar, phone || null)
      .input('password',sql.NVarChar, hash)
      .input('role',    sql.NVarChar, 'signatory')
      .query(`INSERT INTO Members (group_id, name, email, phone, password, role)
              OUTPUT INSERTED.*
              VALUES (@groupId, @name, @email, @phone, @password, @role)`)

    const user = memberResult.recordset[0]
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

    const pool = await poolPromise
    const result = await pool.request()
      .input('email', sql.NVarChar, email)
      .query(`SELECT m.*, g.name AS group_name
              FROM Members m
              JOIN Groups g ON g.group_id = m.group_id
              WHERE m.email = @email`)

    if (result.recordset.length === 0)
      return res.status(401).json({ message: 'Invalid email or password.' })

    const user = result.recordset[0]
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
