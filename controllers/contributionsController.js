const { poolPromise, sql } = require('../config/db')

// GET /api/contributions
const getContributions = async (req, res, next) => {
  try {
    const pool = await poolPromise
    const result = await pool.request()
      .input('groupId', sql.Int, req.user.groupId)
      .query(`SELECT c.contribution_id AS id,
                     c.member_id, m.name AS memberName,
                     c.amount, c.month, c.status,
                     c.proof_url AS proofUrl,
                     c.submitted_at AS submittedAt,
                     c.approved_at  AS approvedAt,
                     ab.name AS approvedByName
              FROM Contributions c
              JOIN Members m  ON m.member_id = c.member_id
              LEFT JOIN Members ab ON ab.member_id = c.approved_by
              WHERE c.group_id = @groupId
              ORDER BY c.submitted_at DESC`)
    res.json(result.recordset)
  } catch (err) {
    next(err)
  }
}

// POST /api/contributions  — member records their payment
const addContribution = async (req, res, next) => {
  try {
    const { amount = 1000, month, proof_url } = req.body
    if (!month) return res.status(400).json({ message: 'Month is required (YYYY-MM).' })

    const pool = await poolPromise

    // Prevent duplicate for same member + month
    const dup = await pool.request()
      .input('memberId', sql.Int, req.user.id)
      .input('month',    sql.NVarChar, month)
      .query(`SELECT contribution_id FROM Contributions
              WHERE member_id = @memberId AND month = @month
              AND status != 'rejected'`)
    if (dup.recordset.length > 0)
      return res.status(409).json({ message: 'Contribution for this month already exists.' })

    const result = await pool.request()
      .input('memberId', sql.Int,      req.user.id)
      .input('groupId',  sql.Int,      req.user.groupId)
      .input('amount',   sql.Decimal,  amount)
      .input('month',    sql.NVarChar, month)
      .input('proofUrl', sql.NVarChar, proof_url || null)
      .query(`INSERT INTO Contributions (member_id, group_id, amount, month, proof_url)
              OUTPUT INSERTED.contribution_id AS id,
                     INSERTED.member_id, INSERTED.amount, INSERTED.month,
                     INSERTED.status, INSERTED.submitted_at AS submittedAt
              VALUES (@memberId, @groupId, @amount, @month, @proofUrl)`)

    res.status(201).json(result.recordset[0])
  } catch (err) {
    next(err)
  }
}

// PATCH /api/contributions/:id/approve  (signatories only)
const approveContribution = async (req, res, next) => {
  try {
    const { id } = req.params
    const pool = await poolPromise

    const contribResult = await pool.request()
      .input('id',      sql.Int, id)
      .input('groupId', sql.Int, req.user.groupId)
      .query(`SELECT * FROM Contributions
              WHERE contribution_id = @id AND group_id = @groupId`)

    if (contribResult.recordset.length === 0)
      return res.status(404).json({ message: 'Contribution not found.' })

    const contrib = contribResult.recordset[0]
    if (contrib.status !== 'pending')
      return res.status(400).json({ message: `Contribution is already ${contrib.status}.` })

    await pool.request()
      .input('id',         sql.Int, id)
      .input('approvedBy', sql.Int, req.user.id)
      .query(`UPDATE Contributions
              SET status = 'approved', approved_by = @approvedBy, approved_at = GETDATE()
              WHERE contribution_id = @id`)

    res.json({ message: 'Contribution approved.' })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/contributions/:id/reject  (signatories only)
const rejectContribution = async (req, res, next) => {
  try {
    const { id } = req.params
    const pool = await poolPromise

    const existing = await pool.request()
      .input('id', sql.Int, id)
      .input('groupId', sql.Int, req.user.groupId)
      .query('SELECT * FROM Contributions WHERE contribution_id = @id AND group_id = @groupId')

    if (existing.recordset.length === 0)
      return res.status(404).json({ message: 'Contribution not found.' })
    if (existing.recordset[0].status !== 'pending')
      return res.status(400).json({ message: 'Only pending contributions can be rejected.' })

    await pool.request()
      .input('id', sql.Int, id)
      .query(`UPDATE Contributions SET status = 'rejected' WHERE contribution_id = @id`)

    res.json({ message: 'Contribution rejected.' })
  } catch (err) {
    next(err)
  }
}

module.exports = { getContributions, addContribution, approveContribution, rejectContribution }
