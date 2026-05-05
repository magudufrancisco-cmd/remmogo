const router = require('express').Router()
const { protect } = require('../middleware/auth')
const { getYearEndReport } = require('../controllers/reportsController')

router.get('/yearend', protect, getYearEndReport)

module.exports = router
