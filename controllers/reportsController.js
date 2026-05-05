const { poolPromise, sql } = require('../config/db')

// GET /api/reports/yearend
// Returns per-member totals: contributions, interest generated (from loans), payout share
const getYearEndReport = async (req, res, next) => {
  try {
    const pool = await poolPromise
    const year = req.query.year || new Date().getFullYear()
    const groupId = req.user.groupId

    // Total approved contributions for the year
    const contribResult = await pool.request()
      .input('groupId', sql.Int, groupId)
      .input('year',    sql.NVarChar, String(year))
      .query(`SELECT m.member_id AS memberId, m.name,
                     COUNT(c.contribution_id)             AS monthsPaid,
                     ISNULL(SUM(c.amount), 0)             AS totalContributed
              FROM Members m
              LEFT JOIN Contributions c
                ON c.member_id = m.member_id
                AND c.status = 'approved'
                AND LEFT(c.month, 4) = @year
              WHERE m.group_id = @groupId AND m.status = 'active'
              GROUP BY m.member_id, m.name
              ORDER BY m.name`)

    // Interest generated per member (from their loans)
    // Interest = principal * 0.20 * months_active   (simplified: principal - balance as repaid + remaining balance * rate)
    // We use: interest_generated = (loan balance * rate) for active loans, or total repaid above principal for closed ones
    const interestResult = await pool.request()
      .input('groupId', sql.Int, groupId)
      .input('year',    sql.Int, year)
      .query(`SELECT l.member_id AS memberId,
                     ISNULL(SUM(
                       CASE WHEN l.status = 'fully_paid'
                            THEN l.principal * l.interest_rate  -- approx for paid loans
                            ELSE l.balance   * l.interest_rate  -- outstanding interest
                       END
                     ), 0) AS interestGenerated,
                     ISNULL(SUM(l.principal), 0) AS totalBorrowed,
                     ISNULL(SUM(CASE WHEN l.status = 'fully_paid' THEN 1 ELSE 0 END), 0) AS loansFullyPaid
              FROM Loans l
              WHERE l.group_id = @groupId
                AND YEAR(l.date_taken) = @year
              GROUP BY l.member_id`)

    // Merge
    const interestMap = {}
    interestResult.recordset.forEach((r) => {
      interestMap[r.memberId] = r
    })

    // Total pool = sum of all contributions + interest generated
    const totalContributions = contribResult.recordset.reduce((s, r) => s + Number(r.totalContributed), 0)
    const totalInterest = interestResult.recordset.reduce((s, r) => s + Number(r.interestGenerated), 0)
    const grandTotal = totalContributions + totalInterest

    const members = contribResult.recordset.map((m) => {
      const interest = interestMap[m.memberId] || {}
      return {
        memberId:           m.memberId,
        name:               m.name,
        monthsPaid:         m.monthsPaid,
        totalContributed:   Number(m.totalContributed),
        interestGenerated:  Number(interest.interestGenerated || 0),
        totalBorrowed:      Number(interest.totalBorrowed || 0),
        loansFullyPaid:     Number(interest.loansFullyPaid || 0),
        // Payout = contributed share of the total pool
        estimatedPayout:    grandTotal > 0
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
