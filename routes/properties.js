// routes/properties.js
const express = require('express');
const Property = require('../models/Property.model');
const authJwt = require('../helpers/jwt');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const validateUser = require('../utils/validateUser');


const router = express.Router();
router.use(authJwt());

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({ storage });




// Create property
router.post('/',validateUser, upload.array('images', 20), async (req, res) => {
  try {
    const data = {
      ...req.body,
      userID: req.userId, // <-- Grab user ID from token
      // images: req.files.map(f => f.path)
    };
    const property = new Property(data);
    const saved = await property.save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get all properties (admin gets all, user gets only theirs)
router.get('/', validateUser, async (req, res) => {
  try {
    const filter = req.isAdmin ? {} : { userID: req.userId };
    const properties = await Property.find(filter).populate('userID');
    res.json(properties);
  } catch (error) {
    console.error('Error fetching properties:', error);
    res.status(500).json({ error: 'Failed to fetch properties' });
  }
});

// Get property by ID
router.get('/:id', async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) return res.status(404).json({ error: 'Property not found' });
    res.json(property);
  } catch (error) {
    res.status(400).json({ error: 'Invalid property ID' });
  }
});

// Update property
router.put('/:id', upload.array('images', 20), async (req, res) => {
  try {
    const updated = await Property.findByIdAndUpdate(
      req.params.id,
      { ...req.body, 
        // images: req.files.map(f => f.path) 
      },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Property not found' });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete property
router.delete('/:id', async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);
    if (!property) return res.status(404).json({ error: 'Property not found' });
    await property.remove();
    res.json({ message: 'Property deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete property' });
  }
});

module.exports = router;
