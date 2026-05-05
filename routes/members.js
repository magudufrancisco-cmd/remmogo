const router = require('express').Router()
const { protect, signatory } = require('../middleware/auth')
const { getMembers, getMember, addMember } = require('../controllers/membersController')
router.get('/',     protect, getMembers)
router.get('/:id',  protect, getMember)
router.post('/',    protect, signatory, addMember)
module.exports = router
