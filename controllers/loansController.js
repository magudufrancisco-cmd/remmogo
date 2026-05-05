const { poolPromise, sql } = require('../config/db')

const INTEREST_RATE = 0.20  // 20% monthly

// Helper: build a loan object with its payments
const fetchLoanWithPayments = async (pool, loanId, groupId) => {
  const loan = await pool.request()
    .input('loanId',  sql.Int, loanId)
    .input('groupId', sql.Int, groupId)
    .query(`SELECT l.*, m.name AS memberName,
                   (SELECT COUNT(*) FROM Approvals
                    WHERE entity_type='loan' AND entity_id=l.loan_id) AS approvalCount
            FROM Loans l
            JOIN Members m ON m.member_id = l.member_id
            WHERE l.loan_id = @loanId AND l.group_id = @groupId`)

  if (loan.recordset.length === 0) return null

  const payments = await pool.request()
    .input('loanId', sql.Int, loanId)
    .query(`SELECT lp.payment_id AS id, lp.amount, lp.proof_url AS proofUrl,
                   lp.status, lp.submitted_at AS date,
                   (SELECT COUNT(*) FROM Approvals
                    WHERE entity_type='loan_payment' AND entity_id=lp.payment_id) AS approvalCount
            FROM LoanPayments lp
            WHERE lp.loan_id = @loanId
            ORDER BY lp.submitted_at DESC`)

  return { ...loan.recordset[0], payments: payments.recordset }
}

// GET /api/loans
const getLoans = async (req, res, next) => {
  try {
    const pool = await poolPromise
    const result = await pool.request()
      .input('groupId', sql.Int, req.user.groupId)
      .query(`SELECT l.loan_id AS id, l.member_id, m.name AS memberName,
                     l.principal, l.balance, l.interest_rate AS interestRate,
                     ROUND(l.balance * l.interest_rate, 2) AS interestDue,
                     l.reason, l.status, l.date_taken AS dateTaken,
                     l.disbursed_at AS disbursedAt,
                     (SELECT COUNT(*) FROM Approvals
                      WHERE entity_type='loan' AND entity_id=l.loan_id) AS approvalCount
              FROM Loans l
              JOIN Members m ON m.member_id = l.member_id
              WHERE l.group_id = @groupId
              ORDER BY l.created_at DESC`)

    // Attach payments to each loan
    const loans = await Promise.all(
      result.recordset.map(async (loan) => {
        const payments = await pool.request()
          .input('loanId', sql.Int, loan.id)
          .query(`SELECT payment_id AS id, amount, proof_url AS proofUrl,
                         status, submitted_at AS date,
                         (SELECT COUNT(*) FROM Approvals
                          WHERE entity_type='loan_payment' AND entity_id=payment_id) AS approvalCount
                  FROM LoanPayments WHERE loan_id = @loanId ORDER BY submitted_at DESC`)
        return { ...loan, payments: payments.recordset }
      })
    )

    res.json(loans)
  } catch (err) {
    next(err)
  }
}

// POST /api/loans  — member applies for a loan
const applyLoan = async (req, res, next) => {
  try {
    const { principal, reason } = req.body
    if (!principal || principal < 1)
      return res.status(400).json({ message: 'Enter a valid principal amount.' })

    const pool = await poolPromise

    // Only one active loan per member
    const active = await pool.request()
      .input('memberId', sql.Int, req.user.id)
      .query(`SELECT loan_id FROM Loans
              WHERE member_id = @memberId AND status NOT IN ('rejected','fully_paid')`)
    if (active.recordset.length > 0)
      return res.status(400).json({ message: 'You already have an active loan.' })

    const result = await pool.request()
      .input('memberId',  sql.Int,      req.user.id)
      .input('groupId',   sql.Int,      req.user.groupId)
      .input('principal', sql.Decimal,  principal)
      .input('balance',   sql.Decimal,  principal)
      .input('reason',    sql.NVarChar, reason || null)
      .query(`INSERT INTO Loans (member_id, group_id, principal, balance, reason)
              OUTPUT INSERTED.loan_id AS id, INSERTED.member_id, INSERTED.principal,
                     INSERTED.balance, INSERTED.status, INSERTED.date_taken AS dateTaken
              VALUES (@memberId, @groupId, @principal, @balance, @reason)`)

    res.status(201).json({ ...result.recordset[0], payments: [] })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/loans/:id/approve  (signatories only)
// First approval → records it and returns "awaiting 2nd".
// Second approval → marks loan as approved and sets disbursed_at.
const approveLoan = async (req, res, next) => {
  try {
    const { id } = req.params
    const pool = await poolPromise

    const loanResult = await pool.request()
      .input('loanId',  sql.Int, id)
      .input('groupId', sql.Int, req.user.groupId)
      .query('SELECT * FROM Loans WHERE loan_id = @loanId AND group_id = @groupId')

    if (loanResult.recordset.length === 0)
      return res.status(404).json({ message: 'Loan not found.' })

    const loan = loanResult.recordset[0]
    if (loan.status !== 'pending')
      return res.status(400).json({ message: `Loan is already ${loan.status}.` })

    // Check if this signatory already approved
    const alreadyApproved = await pool.request()
      .input('loanId',      sql.Int, id)
      .input('signatoryId', sql.Int, req.user.id)
      .query(`SELECT approval_id FROM Approvals
              WHERE entity_type='loan' AND entity_id=@loanId AND signatory_id=@signatoryId`)
    if (alreadyApproved.recordset.length > 0)
      return res.status(400).json({ message: 'You have already approved this loan.' })

    // Insert approval
    await pool.request()
      .input('loanId',      sql.Int,     id)
      .input('signatoryId', sql.Int,     req.user.id)
      .query(`INSERT INTO Approvals (entity_type, entity_id, signatory_id)
              VALUES ('loan', @loanId, @signatoryId)`)

    // Count total approvals
    const countResult = await pool.request()
      .input('loanId', sql.Int, id)
      .query(`SELECT COUNT(*) AS total FROM Approvals
              WHERE entity_type='loan' AND entity_id=@loanId`)

    const total = countResult.recordset[0].total

    if (total >= 2) {
      await pool.request()
        .input('loanId', sql.Int, id)
        .query(`UPDATE Loans
                SET status='approved', disbursed_at=GETDATE()
                WHERE loan_id = @loanId`)
      return res.json({ message: 'Loan approved and disbursed. Both signatories signed off.', approved: true })
    }

    res.json({ message: 'First approval recorded. Awaiting second signatory.', approvalCount: total })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/loans/:id/reject  (signatories only)
const rejectLoan = async (req, res, next) => {
  try {
    const { id } = req.params
    const pool = await poolPromise

    const existing = await pool.request()
      .input('loanId', sql.Int, id)
      .input('groupId', sql.Int, req.user.groupId)
      .query('SELECT * FROM Loans WHERE loan_id = @loanId AND group_id = @groupId')

    if (existing.recordset.length === 0)
      return res.status(404).json({ message: 'Loan not found.' })
    if (existing.recordset[0].status !== 'pending')
      return res.status(400).json({ message: 'Only pending loans can be rejected.' })

    await pool.request()
      .input('loanId', sql.Int, id)
      .query(`UPDATE Loans SET status='rejected' WHERE loan_id=@loanId`)

    res.json({ message: 'Loan rejected.' })
  } catch (err) {
    next(err)
  }
}

// --- LOAN PAYMENTS ---

// POST /api/loans/:id/payments  — member records a repayment
const addPayment = async (req, res, next) => {
  try {
    const { id } = req.params
    const { amount, proof_url } = req.body
    if (!amount || amount < 1)
      return res.status(400).json({ message: 'Enter a valid payment amount.' })

    const pool = await poolPromise
    const loanResult = await pool.request()
      .input('loanId',  sql.Int, id)
      .input('groupId', sql.Int, req.user.groupId)
      .query('SELECT * FROM Loans WHERE loan_id = @loanId AND group_id = @groupId')

    if (loanResult.recordset.length === 0)
      return res.status(404).json({ message: 'Loan not found.' })

    const loan = loanResult.recordset[0]
    if (loan.status !== 'approved')
      return res.status(400).json({ message: 'Cannot pay a loan that is not approved.' })

    const result = await pool.request()
      .input('loanId',   sql.Int,     id)
      .input('memberId', sql.Int,     req.user.id)
      .input('amount',   sql.Decimal, amount)
      .input('proofUrl', sql.NVarChar, proof_url || null)
      .query(`INSERT INTO LoanPayments (loan_id, member_id, amount, proof_url)
              OUTPUT INSERTED.payment_id AS id, INSERTED.amount,
                     INSERTED.status, INSERTED.submitted_at AS date
              VALUES (@loanId, @memberId, @amount, @proofUrl)`)

    res.status(201).json({ ...result.recordset[0], approvalCount: 0 })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/loans/payments/:paymentId/approve  (signatories only)
// Second approval deducts from loan balance; if balance ≤ 0 → fully_paid
const approvePayment = async (req, res, next) => {
  try {
    const { paymentId } = req.params
    const pool = await poolPromise

    const payResult = await pool.request()
      .input('paymentId', sql.Int, paymentId)
      .query(`SELECT lp.*, l.group_id, l.balance AS loanBalance
              FROM LoanPayments lp
              JOIN Loans l ON l.loan_id = lp.loan_id
              WHERE lp.payment_id = @paymentId`)

    if (payResult.recordset.length === 0)
      return res.status(404).json({ message: 'Payment not found.' })

    const payment = payResult.recordset[0]
    if (payment.group_id !== req.user.groupId)
      return res.status(403).json({ message: 'Not authorised.' })
    if (payment.status !== 'pending')
      return res.status(400).json({ message: `Payment already ${payment.status}.` })

    // Check double-approval by same signatory
    const alreadyApproved = await pool.request()
      .input('paymentId',   sql.Int, paymentId)
      .input('signatoryId', sql.Int, req.user.id)
      .query(`SELECT approval_id FROM Approvals
              WHERE entity_type='loan_payment' AND entity_id=@paymentId AND signatory_id=@signatoryId`)
    if (alreadyApproved.recordset.length > 0)
      return res.status(400).json({ message: 'You have already approved this payment.' })

    await pool.request()
      .input('paymentId',   sql.Int, paymentId)
      .input('signatoryId', sql.Int, req.user.id)
      .query(`INSERT INTO Approvals (entity_type, entity_id, signatory_id)
              VALUES ('loan_payment', @paymentId, @signatoryId)`)

    const countResult = await pool.request()
      .input('paymentId', sql.Int, paymentId)
      .query(`SELECT COUNT(*) AS total FROM Approvals
              WHERE entity_type='loan_payment' AND entity_id=@paymentId`)

    const total = countResult.recordset[0].total

    if (total >= 2) {
      // Mark payment approved and reduce loan balance
      await pool.request()
        .input('paymentId', sql.Int, paymentId)
        .query(`UPDATE LoanPayments SET status='approved', approved_by=@signatoryId, approved_at=GETDATE()
                WHERE payment_id=@paymentId`)
        .input('signatoryId', sql.Int, req.user.id)

      const newBalance = Math.max(0, payment.loanBalance - payment.amount)
      const loanStatus = newBalance <= 0 ? 'fully_paid' : 'approved'

      await pool.request()
        .input('loanId',     sql.Int,     payment.loan_id)
        .input('newBalance', sql.Decimal, newBalance)
        .input('status',     sql.NVarChar, loanStatus)
        .query(`UPDATE Loans SET balance=@newBalance, status=@status WHERE loan_id=@loanId`)

      return res.json({
        message: 'Payment approved. Loan balance updated.',
        newBalance,
        loanStatus,
        approved: true,
      })
    }

    res.json({ message: 'First payment approval recorded. Awaiting second signatory.', approvalCount: total })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/loans/payments/:paymentId/reject  (signatories only)
const rejectPayment = async (req, res, next) => {
  try {
    const { paymentId } = req.params
    const pool = await poolPromise

    const existing = await pool.request()
      .input('paymentId', sql.Int, paymentId)
      .query(`SELECT lp.*, l.group_id FROM LoanPayments lp
              JOIN Loans l ON l.loan_id = lp.loan_id
              WHERE lp.payment_id = @paymentId`)

    if (existing.recordset.length === 0)
      return res.status(404).json({ message: 'Payment not found.' })

    const pay = existing.recordset[0]
    if (pay.group_id !== req.user.groupId)
      return res.status(403).json({ message: 'Not authorised.' })
    if (pay.status !== 'pending')
      return res.status(400).json({ message: 'Only pending payments can be rejected.' })

    await pool.request()
      .input('paymentId', sql.Int, paymentId)
      .query(`UPDATE LoanPayments SET status='rejected' WHERE payment_id=@paymentId`)

    res.json({ message: 'Payment rejected.' })
  } catch (err) {
    next(err)
  }
}

// POST /api/loans/apply-interest  (signatories only) — apply monthly 20% to all active loans
const applyMonthlyInterest = async (req, res, next) => {
  try {
    const pool = await poolPromise
    const result = await pool.request()
      .input('groupId', sql.Int, req.user.groupId)
      .query(`UPDATE Loans
              SET balance = ROUND(balance * 1.20, 2)
              WHERE group_id = @groupId
                AND status = 'approved'
                AND balance > 0
              SELECT @@ROWCOUNT AS updated`)

    res.json({ message: 'Monthly interest applied.', loansUpdated: result.recordset[0]?.updated || 0 })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getLoans, applyLoan, approveLoan, rejectLoan,
  addPayment, approvePayment, rejectPayment,
  applyMonthlyInterest,
}
