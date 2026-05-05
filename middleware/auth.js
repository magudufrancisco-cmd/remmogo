const jwt = require('jsonwebtoken')

const protect = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorised. No token.' })
  }
  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded          // { id, name, email, role, groupId }
    next()
  } catch {
    return res.status(401).json({ message: 'Token invalid or expired.' })
  }
}

// Restrict to signatories only
const signatory = (req, res, next) => {
  if (req.user.role !== 'signatory') {
    return res.status(403).json({ message: 'Only signatories can perform this action.' })
  }
  next()
}

module.exports = { protect, signatory }
