const pool = require('../config/db')

// GET /api/contributions
const getContributions = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.contribution_id AS id,
              c.member_id, m.name AS "memberName",
              c.amount, c.month, c.status,
              c.proof_url AS "proofUrl",
              c.submitted_at AS "submittedAt",
              c.approved_at  AS "approvedAt",
              ab.name AS "approvedByName"
       FROM contributions c
       JOIN members m  ON m.member_id = c.member_id
       LEFT JOIN members ab ON ab.member_id = c.approved_by
       WHERE c.group_id = $1
       ORDER BY c.submitted_at DESC`,
      [req.user.groupId]
    )
    res.json(result.rows)
  } catch (err) {
    next(err)
  }
}

// POST /api/contributions
const addContribution = async (req, res, next) => {
  try {
    const { amount = 1000, month, proof_url } = req.body
    if (!month) return res.status(400).json({ message: 'Month is required (YYYY-MM).' })

    // Prevent duplicate for same member + month
    const dup = await pool.query(
      `SELECT contribution_id FROM contributions
       WHERE member_id = $1 AND month = $2 AND status != 'rejected'`,
      [req.user.id, month]
    )
    if (dup.rows.length > 0)
      return res.status(409).json({ message: 'Contribution for this month already exists.' })

    const result = await pool.query(
      `INSERT INTO contributions (member_id, group_id, amount, month, proof_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING contribution_id AS id, member_id, amount, month, status, submitted_at AS "submittedAt"`,
      [req.user.id, req.user.groupId, amount, month, proof_url || null]
    )

    res.status(201).json(result.rows[0])
  } catch (err) {
    next(err)
  }
}

// PATCH /api/contributions/:id/approve
const approveContribution = async (req, res, next) => {
  try {
    const { id } = req.params

    const existing = await pool.query(
      `SELECT * FROM contributions WHERE contribution_id = $1 AND group_id = $2`,
      [id, req.user.groupId]
    )
    if (existing.rows.length === 0)
      return res.status(404).json({ message: 'Contribution not found.' })

    const contrib = existing.rows[0]
    if (contrib.status !== 'pending')
      return res.status(400).json({ message: `Contribution is already ${contrib.status}.` })

    await pool.query(
      `UPDATE contributions
       SET status = 'approved', approved_by = $1, approved_at = NOW()
       WHERE contribution_id = $2`,
      [req.user.id, id]
    )

    res.json({ message: 'Contribution approved.' })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/contributions/:id/reject
const rejectContribution = async (req, res, next) => {
  try {
    const { id } = req.params

    const existing = await pool.query(
      `SELECT * FROM contributions WHERE contribution_id = $1 AND group_id = $2`,
      [id, req.user.groupId]
    )
    if (existing.rows.length === 0)
      return res.status(404).json({ message: 'Contribution not found.' })
    if (existing.rows[0].status !== 'pending')
      return res.status(400).json({ message: 'Only pending contributions can be rejected.' })

    await pool.query(
      `UPDATE contributions SET status = 'rejected' WHERE contribution_id = $1`,
      [id]
    )

    res.json({ message: 'Contribution rejected.' })
  } catch (err) {
    next(err)
  }
}

module.exports = { getContributions, addContribution, approveContribution, rejectContribution }