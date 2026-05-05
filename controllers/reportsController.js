const pool = require('../config/db')

// GET /api/reports/yearend
const getYearEndReport = async (req, res, next) => {
  try {
    const year = req.query.year || new Date().getFullYear()
    const groupId = req.user.groupId

    const contribResult = await pool.query(
      `SELECT m.member_id AS "memberId", m.name,
              COUNT(c.contribution_id)        AS "monthsPaid",
              COALESCE(SUM(c.amount), 0)      AS "totalContributed"
       FROM members m
       LEFT JOIN contributions c
         ON c.member_id = m.member_id
         AND c.status = 'approved'
         AND LEFT(c.month, 4) = $2
       WHERE m.group_id = $1 AND m.status = 'active'
       GROUP BY m.member_id, m.name
       ORDER BY m.name`,
      [groupId, String(year)]
    )

    const interestResult = await pool.query(
      `SELECT l.member_id AS "memberId",
              COALESCE(SUM(
                CASE WHEN l.status = 'fully_paid'
                     THEN l.principal * l.interest_rate
                     ELSE l.balance   * l.interest_rate
                END
              ), 0) AS "interestGenerated",
              COALESCE(SUM(l.principal), 0) AS "totalBorrowed",
              COALESCE(SUM(CASE WHEN l.status = 'fully_paid' THEN 1 ELSE 0 END), 0) AS "loansFullyPaid"
       FROM loans l
       WHERE l.group_id = $1
         AND EXTRACT(YEAR FROM l.date_taken) = $2
       GROUP BY l.member_id`,
      [groupId, year]
    )

    const interestMap = {}
    interestResult.rows.forEach((r) => {
      interestMap[r.memberId] = r
    })

    const totalContributions = contribResult.rows.reduce((s, r) => s + Number(r.totalContributed), 0)
    const totalInterest = interestResult.rows.reduce((s, r) => s + Number(r.interestGenerated), 0)
    const grandTotal = totalContributions + totalInterest

    const members = contribResult.rows.map((m) => {
      const interest = interestMap[m.memberId] || {}
      return {
        memberId:          m.memberId,
        name:              m.name,
        monthsPaid:        Number(m.monthsPaid),
        totalContributed:  Number(m.totalContributed),
        interestGenerated: Number(interest.interestGenerated || 0),
        totalBorrowed:     Number(interest.totalBorrowed || 0),
        loansFullyPaid:    Number(interest.loansFullyPaid || 0),
        estimatedPayout:   grandTotal > 0
          ? +((Number(m.totalContributed) / totalContributions) * grandTotal).toFixed(2)
          : 0,
      }
    })

    res.json({
      year,
      totalContributions,
      totalInterest: +totalInterest.toFixed(2),
      grandTotal:    +grandTotal.toFixed(2),
      members,
    })
  } catch (err) {
    next(err)
  }
}

module.exports = { getYearEndReport }