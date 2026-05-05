const router = require('express').Router()
const { protect, signatory } = require('../middleware/auth')
const { getGroup, updateGroup } = require('../controllers/groupController')
router.get('/',  protect, getGroup)
router.put('/',  protect, signatory, updateGroup)
module.exports = router
