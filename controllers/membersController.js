const bcrypt = require('bcryptjs')
const { poolPromise, sql } = require('../config/db')

// GET /api/members
const getMembers = async (req, res, next) => {
  try {
    const pool = await poolPromise
    const result = await pool.request()
      .input('groupId', sql.Int, req.user.groupId)
      .query(`SELECT member_id AS id, name, email, phone, role, status, join_date AS joinDate
              FROM Members
              WHERE group_id = @groupId
              ORDER BY join_date, name`)
    res.json(result.recordset)
  } catch (err) {
    next(err)
  }
}

// GET /api/members/:id
const getMember = async (req, res, next) => {
  try {
    const pool = await poolPromise
    const result = await pool.request()
      .input('memberId', sql.Int, req.params.id)
      .input('groupId',  sql.Int, req.user.groupId)
      .query(`SELECT member_id AS id, name, email, phone, role, status, join_date AS joinDate
              FROM Members
              WHERE member_id = @memberId AND group_id = @groupId`)

    if (result.recordset.length === 0)
      return res.status(404).json({ message: 'Member not found.' })

    res.json(result.recordset[0])
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

    const pool = await poolPromise

    // Check signatories cap
    if (role === 'signatory') {
      const count = await pool.request()
        .input('groupId', sql.Int, req.user.groupId)
        .query(`SELECT COUNT(*) AS total FROM Members
                WHERE group_id = @groupId AND role = 'signatory' AND status = 'active'`)
      if (count.recordset[0].total >= 2)
        return res.status(400).json({ message: 'Only 2 signatories are allowed per group.' })
    }

    // Check email
    const existing = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT member_id FROM Members WHERE email = @email')
    if (existing.recordset.length > 0)
      return res.status(409).json({ message: 'Email already registered.' })

    // Default password = first part of email + "1234" (member must change it)
    const defaultPwd = email.split('@')[0] + '1234'
    const hash = await bcrypt.hash(defaultPwd, 12)

    const result = await pool.request()
      .input('groupId',  sql.Int,      req.user.groupId)
      .input('name',     sql.NVarChar, name)
      .input('email',    sql.NVarChar, email)
      .input('phone',    sql.NVarChar, phone || null)
      .input('password', sql.NVarChar, hash)
      .input('role',     sql.NVarChar, role)
      .query(`INSERT INTO Members (group_id, name, email, phone, password, role)
              OUTPUT INSERTED.member_id AS id, INSERTED.name, INSERTED.email,
                     INSERTED.phone, INSERTED.role, INSERTED.status, INSERTED.join_date AS joinDate
              VALUES (@groupId, @name, @email, @phone, @password, @role)`)

    res.status(201).json({
      ...result.recordset[0],
      defaultPassword: defaultPwd,   // shown once so signatory can share it
      message: 'Member added. Default password shown once — please share securely.',
    })
  } catch (err) {
    next(err)
  }
}

module.exports = { getMembers, getMember, addMember }
