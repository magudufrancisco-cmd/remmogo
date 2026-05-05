const router = require('express').Router()
const { protect, signatory } = require('../middleware/auth')
const {
  getContributions, addContribution,
  approveContribution, rejectContribution,
} = require('../controllers/contributionsController')
router.get('/',               protect, getContributions)
router.post('/',              protect, addContribution)
router.patch('/:id/approve',  protect, signatory, approveContribution)
router.patch('/:id/reject',   protect, signatory, rejectContribution)
module.exports = router
