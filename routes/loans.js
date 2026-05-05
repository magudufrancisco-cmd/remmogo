const router = require('express').Router()
const { protect, signatory } = require('../middleware/auth')
const {
  getLoans, applyLoan, approveLoan, rejectLoan,
  addPayment, approvePayment, rejectPayment,
  applyMonthlyInterest,
} = require('../controllers/loansController')

router.get('/',                               protect, getLoans)
router.post('/',                              protect, applyLoan)
router.patch('/:id/approve',                  protect, signatory, approveLoan)
router.patch('/:id/reject',                   protect, signatory, rejectLoan)
router.post('/:id/payments',                  protect, addPayment)
router.patch('/payments/:paymentId/approve',  protect, signatory, approvePayment)
router.patch('/payments/:paymentId/reject',   protect, signatory, rejectPayment)
router.post('/apply-interest',                protect, signatory, applyMonthlyInterest)

module.exports = router
