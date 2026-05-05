const pool = require('../config/db')

// GET /api/loans
const getLoans = async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT l.loan_id AS id, l.member_id, m.name AS "memberName",
              l.principal, l.balance, l.interest_rate AS "interestRate",
              ROUND(l.balance * l.interest_rate, 2) AS "interestDue",
              l.reason, l.status, l.date_taken AS "dateTaken",
              l.disbursed_at AS "disbursedAt",
              (SELECT COUNT(*) FROM approvals
               WHERE entity_type='loan' AND entity_id=l.loan_id) AS "approvalCount"
       FROM loans l
       JOIN members m ON m.member_id = l.member_id
       WHERE l.group_id = $1
       ORDER BY l.created_at DESC`,
      [req.user.groupId]
    )

    const loans = await Promise.all(
      result.rows.map(async (loan) => {
        const payments = await pool.query(
          `SELECT payment_id AS id, amount, proof_url AS "proofUrl",
                  status, submitted_at AS date,
                  (SELECT COUNT(*) FROM approvals
                   WHERE entity_type='loan_payment' AND entity_id=payment_id) AS "approvalCount"
           FROM loan_payments WHERE loan_id = $1 ORDER BY submitted_at DESC`,
          [loan.id]
        )
        return { ...loan, payments: payments.rows }
      })
    )

    res.json(loans)
  } catch (err) {
    next(err)
  }
}

// POST /api/loans
const applyLoan = async (req, res, next) => {
  try {
    const { principal, reason } = req.body
    if (!principal || principal < 1)
      return res.status(400).json({ message: 'Enter a valid principal amount.' })

    // Only one active loan per member
    const active = await pool.query(
      `SELECT loan_id FROM loans
       WHERE member_id = $1 AND status NOT IN ('rejected','fully_paid')`,
      [req.user.id]
    )
    if (active.rows.length > 0)
      return res.status(400).json({ message: 'You already have an active loan.' })

    const result = await pool.query(
      `INSERT INTO loans (member_id, group_id, principal, balance, reason)
       VALUES ($1, $2, $3, $3, $4)
       RETURNING loan_id AS id, member_id, principal, balance, status, date_taken AS "dateTaken"`,
      [req.user.id, req.user.groupId, principal, reason || null]
    )

    res.status(201).json({ ...result.rows[0], payments: [] })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/loans/:id/approve
const approveLoan = async (req, res, next) => {
  try {
    const { id } = req.params

    const loanResult = await pool.query(
      `SELECT * FROM loans WHERE loan_id = $1 AND group_id = $2`,
      [id, req.user.groupId]
    )
    if (loanResult.rows.length === 0)
      return res.status(404).json({ message: 'Loan not found.' })

    const loan = loanResult.rows[0]
    if (loan.status !== 'pending')
      return res.status(400).json({ message: `Loan is already ${loan.status}.` })

    // Check if this signatory already approved
    const alreadyApproved = await pool.query(
      `SELECT approval_id FROM approvals
       WHERE entity_type='loan' AND entity_id=$1 AND signatory_id=$2`,
      [id, req.user.id]
    )
    if (alreadyApproved.rows.length > 0)
      return res.status(400).json({ message: 'You have already approved this loan.' })

    await pool.query(
      `INSERT INTO approvals (entity_type, entity_id, signatory_id)
       VALUES ('loan', $1, $2)`,
      [id, req.user.id]
    )

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM approvals WHERE entity_type='loan' AND entity_id=$1`,
      [id]
    )
    const total = parseInt(countResult.rows[0].total)

    if (total >= 2) {
      await pool.query(
        `UPDATE loans SET status='approved', disbursed_at=NOW() WHERE loan_id=$1`,
        [id]
      )
      return res.json({ message: 'Loan approved and disbursed. Both signatories signed off.', approved: true })
    }

    res.json({ message: 'First approval recorded. Awaiting second signatory.', approvalCount: total })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/loans/:id/reject
const rejectLoan = async (req, res, next) => {
  try {
    const { id } = req.params

    const existing = await pool.query(
      `SELECT * FROM loans WHERE loan_id = $1 AND group_id = $2`,
      [id, req.user.groupId]
    )
    if (existing.rows.length === 0)
      return res.status(404).json({ message: 'Loan not found.' })
    if (existing.rows[0].status !== 'pending')
      return res.status(400).json({ message: 'Only pending loans can be rejected.' })

    await pool.query(`UPDATE loans SET status='rejected' WHERE loan_id=$1`, [id])

    res.json({ message: 'Loan rejected.' })
  } catch (err) {
    next(err)
  }
}

// POST /api/loans/:id/payments
const addPayment = async (req, res, next) => {
  try {
    const { id } = req.params
    const { amount, proof_url } = req.body
    if (!amount || amount < 1)
      return res.status(400).json({ message: 'Enter a valid payment amount.' })

    const loanResult = await pool.query(
      `SELECT * FROM loans WHERE loan_id = $1 AND group_id = $2`,
      [id, req.user.groupId]
    )
    if (loanResult.rows.length === 0)
      return res.status(404).json({ message: 'Loan not found.' })
    if (loanResult.rows[0].status !== 'approved')
      return res.status(400).json({ message: 'Cannot pay a loan that is not approved.' })

    const result = await pool.query(
      `INSERT INTO loan_payments (loan_id, member_id, amount, proof_url)
       VALUES ($1, $2, $3, $4)
       RETURNING payment_id AS id, amount, status, submitted_at AS date`,
      [id, req.user.id, amount, proof_url || null]
    )

    res.status(201).json({ ...result.rows[0], approvalCount: 0 })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/loans/payments/:paymentId/approve
const approvePayment = async (req, res, next) => {
  try {
    const { paymentId } = req.params

    const payResult = await pool.query(
      `SELECT lp.*, l.group_id, l.balance AS "loanBalance"
       FROM loan_payments lp
       JOIN loans l ON l.loan_id = lp.loan_id
       WHERE lp.payment_id = $1`,
      [paymentId]
    )
    if (payResult.rows.length === 0)
      return res.status(404).json({ message: 'Payment not found.' })

    const payment = payResult.rows[0]
    if (payment.group_id !== req.user.groupId)
      return res.status(403).json({ message: 'Not authorised.' })
    if (payment.status !== 'pending')
      return res.status(400).json({ message: `Payment already ${payment.status}.` })

    const alreadyApproved = await pool.query(
      `SELECT approval_id FROM approvals
       WHERE entity_type='loan_payment' AND entity_id=$1 AND signatory_id=$2`,
      [paymentId, req.user.id]
    )
    if (alreadyApproved.rows.length > 0)
      return res.status(400).json({ message: 'You have already approved this payment.' })

    await pool.query(
      `INSERT INTO approvals (entity_type, entity_id, signatory_id)
       VALUES ('loan_payment', $1, $2)`,
      [paymentId, req.user.id]
    )

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM approvals
       WHERE entity_type='loan_payment' AND entity_id=$1`,
      [paymentId]
    )
    const total = parseInt(countResult.rows[0].total)

    if (total >= 2) {
      await pool.query(
        `UPDATE loan_payments SET status='approved', approved_by=$1, approved_at=NOW()
         WHERE payment_id=$2`,
        [req.user.id, paymentId]
      )

      const newBalance = Math.max(0, Number(payment.loanBalance) - Number(payment.amount))
      const loanStatus = newBalance <= 0 ? 'fully_paid' : 'approved'

      await pool.query(
        `UPDATE loans SET balance=$1, status=$2 WHERE loan_id=$3`,
        [newBalance, loanStatus, payment.loan_id]
      )

      return res.json({ message: 'Payment approved. Loan balance updated.', newBalance, loanStatus, approved: true })
    }

    res.json({ message: 'First payment approval recorded. Awaiting second signatory.', approvalCount: total })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/loans/payments/:paymentId/reject
const rejectPayment = async (req, res, next) => {
  try {
    const { paymentId } = req.params

    const existing = await pool.query(
      `SELECT lp.*, l.group_id FROM loan_payments lp
       JOIN loans l ON l.loan_id = lp.loan_id
       WHERE lp.payment_id = $1`,
      [paymentId]
    )
    if (existing.rows.length === 0)
      return res.status(404).json({ message: 'Payment not found.' })

    const pay = existing.rows[0]
    if (pay.group_id !== req.user.groupId)
      return res.status(403).json({ message: 'Not authorised.' })
    if (pay.status !== 'pending')
      return res.status(400).json({ message: 'Only pending payments can be rejected.' })

    await pool.query(
      `UPDATE loan_payments SET status='rejected' WHERE payment_id=$1`,
      [paymentId]
    )

    res.json({ message: 'Payment rejected.' })
  } catch (err) {
    next(err)
  }
}

// POST /api/loans/apply-interest
const applyMonthlyInterest = async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE loans
       SET balance = ROUND(balance * 1.20, 2)
       WHERE group_id = $1 AND status = 'approved' AND balance > 0`,
      [req.user.groupId]
    )

    res.json({ message: 'Monthly interest applied.', loansUpdated: result.rowCount })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getLoans, applyLoan, approveLoan, rejectLoan,
  addPayment, approvePayment, rejectPayment,
  applyMonthlyInterest,
}