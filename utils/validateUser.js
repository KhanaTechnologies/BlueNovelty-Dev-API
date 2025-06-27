const jwt = require('jsonwebtoken');

const validateUser = async (req, res, next) => {
  try {
    const token = req.headers.authorization;
    if (!token || !token.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - Token missing or invalid format' });
    }

    const tokenValue = token.split(' ')[1];

    jwt.verify(tokenValue, process.env.secret, async (err, user) => {
      if (err) {
        return res.status(403).json({ error: 'Forbidden - Invalid token', details: err.message });
      }

      if (!user || !user.userId) {
        return res.status(403).json({ error: 'Forbidden - Invalid token payload' });
      }

      req.userId = user.userId;
      req.isAdmin = user.isAdmin;
      console.log(req.userId)
      next();
    });
  } catch (error) {
    console.error('Error in validateUser middleware:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

module.exports = validateUser;
