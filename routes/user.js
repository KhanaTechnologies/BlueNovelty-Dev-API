// === FULL FIXED USER ROUTER WITH GITHUB FILE UPLOAD ===

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Octokit } = require("@octokit/rest");
const User = require('../models/user');
const authJwt = require('../helpers/jwt');
const { sendVerificationEmail } = require('../utils/email');
const validateUser = require('../utils/validateUser');
const router = express.Router();

require('dotenv').config();

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const FILE_TYPE_MAP = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpg',
  'application/pdf': 'pdf'
};

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (FILE_TYPE_MAP[file.mimetype]) cb(null, true);
    else cb(new Error('Unsupported file type'), false);
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

const cpUpload = upload.fields([
  { name: 'profileImage', maxCount: 1 },
  { name: 'idDocument', maxCount: 1 },
  { name: 'proofOfResidence', maxCount: 1 },
  { name: 'cvOrSupportingDocs', maxCount: 10 }
]);

const uploadFileToGitHub = async (file, filePathPrefix) => {
  const extension = FILE_TYPE_MAP[file.mimetype];
  const fileName = `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`;
  const fullPath = `${filePathPrefix}/${fileName}`;
  const content = file.buffer.toString('base64');

  const { data } = await octokit.repos.createOrUpdateFileContents({
    owner: process.env.GITHUB_REPO.split('/')[0],
    repo: process.env.GITHUB_REPO.split('/')[1],
    path: fullPath,
    message: `Upload ${fileName}`,
    content,
    branch: process.env.GITHUB_BRANCH
  });
  return data.content.download_url;
};

const processUploads = async (files, pathPrefix) => {
  const result = {};
  if (files['profileImage']) result.profileImage = await uploadFileToGitHub(files['profileImage'][0], pathPrefix);
  if (files['idDocument']) result.idDocument = await uploadFileToGitHub(files['idDocument'][0], pathPrefix);
  if (files['proofOfResidence']) result.proofOfResidence = await uploadFileToGitHub(files['proofOfResidence'][0], pathPrefix);
  if (files['cvOrSupportingDocs']) {
    result.cvOrSupportingDocs = await Promise.all(
      files['cvOrSupportingDocs'].map(file => uploadFileToGitHub(file, pathPrefix))
    );
  }
  return result;
};

const addNotification = async (userId, title, message, type = 'info', link = '') => {
  const notification = {
    title,
    message,
    type,
    link,
    createdAt: new Date()
  };
  await User.findByIdAndUpdate(userId, { $push: { notifications: notification } });
};

router.post('/register', cpUpload, async (req, res) => {
  try {
    const { name, surname, email, password, gender, dateOfBirth,
      expertise, physicalAddress, idNumber, role } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already in use' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const fileUrls = await processUploads(req.files || {}, 'users');

    const user = new User({
      name, surname, email, password: hashedPassword, gender, dateOfBirth,
      expertise, physicalAddress, idNumber, role,
      profileImage: fileUrls.profileImage || '',
      idDocument: fileUrls.idDocument || '',
      proofOfResidence: fileUrls.proofOfResidence || '',
      cvOrSupportingDocs: fileUrls.cvOrSupportingDocs || []
    });

    const savedUser = await user.save();

    await addNotification(savedUser._id, 'Welcome to Our Platform!',
      'Thank you for registering. Please complete your profile to get started.', 'success', '/profile');

    res.status(201).json({ user: savedUser });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    await addNotification(user._id, 'New Login Detected', `You logged in at ${new Date().toLocaleString()}`, 'info', '/security');
    const token = jwt.sign({ userId: user._id }, process.env.secret, { expiresIn: '1d' });
    res.json({ token, user: { ...user.toObject(), password: undefined } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    await addNotification(user._id, 'Password Changed', 'Your password was successfully changed', 'security', '/security');
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.use(authJwt());

router.get('/', async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching users' });
  }
});

router.get('/me', validateUser, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.put('/:id', cpUpload, async (req, res) => {
  try {
    const userId = req.params.id;
    const currentUser = req.userId;
    const updateFields = { ...req.body };
    const fileUrls = await processUploads(req.files || {}, 'users');

    if (fileUrls.profileImage) updateFields.profileImage = fileUrls.profileImage;
    if (fileUrls.idDocument) updateFields.idDocument = fileUrls.idDocument;
    if (fileUrls.proofOfResidence) updateFields.proofOfResidence = fileUrls.proofOfResidence;
    if (fileUrls.cvOrSupportingDocs) updateFields.cvOrSupportingDocs = fileUrls.cvOrSupportingDocs;

    if (updateFields.password) {
      updateFields.password = await bcrypt.hash(updateFields.password, 10);
      await addNotification(userId, 'Password Changed', 'Your password was successfully updated', 'security', '/security');
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updateFields, { new: true }).select('-password');
    if (!updatedUser) return res.status(404).json({ error: 'User not found' });

    if (userId === currentUser.toString()) {
      await addNotification(userId, 'Profile Updated', 'Your profile information was successfully updated', 'info', '/profile');
    } else {
      await addNotification(userId, 'Profile Updated by Admin', 'Your profile was updated by an administrator', 'warning', '/profile');
    }

    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const deletedUser = await User.findByIdAndDelete(userId);
    if (!deletedUser) return res.status(404).json({ error: 'User not found' });

    if (req.userId !== userId) {
      await addNotification(req.userId, 'User Account Deleted', `You deleted user ${deletedUser.name} ${deletedUser.surname}`, 'admin', '/admin/users');
    }
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

router.get('/notifications', validateUser, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('notifications');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const sorted = user.notifications.sort((a, b) => b.createdAt - a.createdAt);
    res.json(sorted);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

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
