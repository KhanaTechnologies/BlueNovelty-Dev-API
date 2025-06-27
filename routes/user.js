const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const User = require('../models/user');
const authJwt = require('../helpers/jwt');
const { sendVerificationEmail } = require('../utils/email');
const validateUser = require('../utils/validateUser');
const router = express.Router();

// ===== Multer Setup =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Unsupported file type'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

const cpUpload = upload.fields([
  { name: 'profileImage', maxCount: 1 },
  { name: 'idDocument', maxCount: 1 },
  { name: 'proofOfResidence', maxCount: 1 },
  { name: 'cvOrSupportingDocs', maxCount: 10 }
]);

// Helper function to add notification
const addNotification = async (userId, title, message, type = 'info', link = '') => {
  const notification = {
    title,
    message,
    type,
    link,
    createdAt: new Date()
  };
  
  await User.findByIdAndUpdate(
    userId,
    { $push: { notifications: notification } }
  );
};

// ===== Register (Public) =====
router.post('/register', cpUpload, async (req, res) => {
  try {
const files = req.files || {};
    console.log(req.body)

    const {
      name, surname, email, password, gender, dateOfBirth,
      expertise, physicalAddress, idNumber, role
    } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      name,
      surname,
      email,
      password: hashedPassword,
      gender,
      dateOfBirth,
      expertise,
      physicalAddress,
      idNumber,
      role,
      profileImage: files['profileImage']?.[0]?.path || '',
      idDocument: files['idDocument']?.[0]?.path || '',
      proofOfResidence: files['proofOfResidence']?.[0]?.path || '',
      cvOrSupportingDocs: files['cvOrSupportingDocs']?.map(f => f.path) || []

    });

    const savedUser = await user.save();

    // Add welcome notification
    await addNotification(
      savedUser._id,
      'Welcome to Our Platform!',
      'Thank you for registering. Please complete your profile to get started.',
      'success',
      '/profile'
    );

    // Send verification email if needed
    //const token = jwt.sign({ userId: savedUser._id }, process.env.emailSecret, { expiresIn: '1h' });
    //await sendVerificationEmail(savedUser.email, token);

    res.status(201).json({ user: savedUser });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== Login (Public) =====
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Add login notification
    await addNotification(
      user._id,
      'New Login Detected',
      `You logged in at ${new Date().toLocaleString()}`,
      'info',
      '/security'
    );

    const token = jwt.sign({ userId: user._id }, process.env.secret, { expiresIn: '1d' });
    res.json({ token, user: { ...user.toObject(), password: undefined } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== Reset Password (Public) =====
router.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ error: 'User not found' });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // Add password reset notification
    await addNotification(
      user._id,
      'Password Changed',
      'Your password was successfully changed',
      'security',
      '/security'
    );

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== Protect all routes below =====
router.use(authJwt());

// ===== Get all users =====
router.get('/', async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching users' });
  }
});

// ===== Get current user (/me) =====
router.get('/me', validateUser, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ===== Update user by ID =====
router.put('/:id', cpUpload, async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUser = req.userId;
    const updateFields = { ...req.body };

    // File handling
    if (req.files['profileImage']) updateFields.profileImage = req.files['profileImage'][0].path;
    if (req.files['idDocument']) updateFields.idDocument = req.files['idDocument'][0].path;
    if (req.files['proofOfResidence']) updateFields.proofOfResidence = req.files['proofOfResidence'][0].path;
    if (req.files['cvOrSupportingDocs']) updateFields.cvOrSupportingDocs = req.files['cvOrSupportingDocs'].map(f => f.path);

    // Password update
    if (updateFields.password) {
      updateFields.password = await bcrypt.hash(updateFields.password, 10);
      await addNotification(
        userId,
        'Password Changed',
        'Your password was successfully updated',
        'security',
        '/security'
      );
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateFields, {
      new: true
    }).select('-password');

    if (!updatedUser) return res.status(404).json({ error: 'User not found' });

    // Add profile update notification if user updated their own profile
    if (userId === currentUser.toString()) {
      await addNotification(
        userId,
        'Profile Updated',
        'Your profile information was successfully updated',
        'info',
        '/profile'
      );
    } else {
      // Admin notification if someone else updated the profile
      await addNotification(
        userId,
        'Profile Updated by Admin',
        'Your profile was updated by an administrator',
        'warning',
        '/profile'
      );
    }

    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== Delete user =====
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const deletedUser = await User.findByIdAndDelete(userId);
    
    if (!deletedUser) return res.status(404).json({ error: 'User not found' });

    // Optionally notify other users about account deletion
    if (req.userId !== userId) {
      await addNotification(
        req.userId,
        'User Account Deleted',
        `You deleted user ${deletedUser.name} ${deletedUser.surname}`,
        'admin',
        '/admin/users'
      );
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ===== Get user notifications =====
router.get('/notifications', validateUser, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('notifications');
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    // Sort notifications by createdAt (newest first)
    const sortedNotifications = user.notifications.sort(
      (a, b) => b.createdAt - a.createdAt
    );
    
    res.json(sortedNotifications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ===== Mark notifications as read =====
router.patch('/notifications/mark-read', validateUser, async (req, res) => {
  try {
    const { notificationIds } = req.body;
    
    await User.updateOne(
      { _id: req.userId },
      { $set: { 'notifications.$[elem].isRead': true } },
      { arrayFilters: [{ 'elem._id': { $in: notificationIds } }] }
    );
    
    res.json({ message: 'Notifications marked as read' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

module.exports = router;
