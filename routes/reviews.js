// routes/reviews.js
const express = require('express');
const Review = require('../models/Review.model');
const authJwt = require('../helpers/jwt');
const User = require('../models/user');
const validateUser = require('../utils/validateUser');
const CleaningService = require('../models/CleaningService.model'); // Add this import

const router = express.Router();
router.use(authJwt());

// Create a new review with notifications
router.post('/', validateUser, async (req, res) => {
  try {
    const userId = req.userId;
    console.log('Creating review with data:', req.body);

    // Create the review
    const review = new Review({
      ...req.body,
      reviewerId: userId
    });

    const savedReview = await review.save();
    
    // Populate the review to get user details
    const populatedReview = await Review.findById(savedReview._id)
      .populate('reviewerId', 'name')
      .populate('reciverId', 'name notifications')
      .populate('serviceId', 'name');

    // Create notification for the reviewed user
    const notification = {
      title: 'New Review Received',
      message: `You've received a ${savedReview.reviewStars}-star review from ${populatedReview.reviewerId.name} for service "${populatedReview.serviceId?.name || 'a service'}".`,
      type: 'info',
      link: `/reviews/${savedReview._id}`
    };

    // Add notification to the reviewed user's profile
    await User.findByIdAndUpdate(
      populatedReview.reciverId._id,
      { $push: { notifications: notification } }
    );

    // Update review stats for the reviewed user
    await updateUserReviewStats(populatedReview.reciverId._id);

    res.status(201).json(savedReview);
  } catch (error) {
    console.error('Error creating review:', error);
    res.status(400).json({ error: error.message });
  }
});

// Helper function to update user review stats
async function updateUserReviewStats(userId) {
  const reviews = await Review.find({ reciverId: userId });
  const numberOfReviews = reviews.length;
  const totalStars = reviews.reduce((sum, review) => sum + review.reviewStars, 0);
  const averageRating = numberOfReviews > 0 ? (totalStars / numberOfReviews).toFixed(1) : 0;

  await User.findByIdAndUpdate(userId, {
    numberOfReviews,
    averageRating
  });

  // Create notification if this is the first review
  if (numberOfReviews === 1) {
    const firstReviewNotification = {
      title: 'First Review Received!',
      message: 'Congratulations on receiving your first review!',
      type: 'success',
      link: '/profile/reviews'
    };

    await User.findByIdAndUpdate(
      userId,
      { $push: { notifications: firstReviewNotification } }
    );
  }
}

// Get all reviews
router.get('/', validateUser, async (req, res) => {
  try {
    const reviews = await Review.find()
      .populate('reviewerId reciverId serviceId');
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Get all reviews received by the current user
router.get('/my/received', validateUser, async (req, res) => {
  try {
    const userId = req.userId;
    const reviews = await Review.find({ reciverId: userId })
      .populate('reviewerId reciverId serviceId');
    res.status(200).json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user reviews' });
  }
});

// Get all reviews written by the current user
router.get('/my/reviews', validateUser, async (req, res) => {
  try {
    const userId = req.userId;
    const reviews = await Review.find({ reviewerId: userId })
      .populate('reviewerId reciverId serviceId');
    res.status(200).json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user reviews' });
  }
});

// Get all reviews received by a specific user
router.get('/user/received/:id', validateUser, async (req, res) => {
  try {
    const userId = req.params.id;
    const reviews = await Review.find({ reciverId: userId })
      .populate('reviewerId reciverId serviceId');
    res.status(200).json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user reviews' });
  }
});

// Get all reviews written by a specific user
router.get('/user/reviews/:id', validateUser, async (req, res) => {
  try {
    const userId = req.params.id;
    const reviews = await Review.find({ reviewerId: userId })
      .populate('reviewerId reciverId serviceId');
    res.status(200).json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user reviews' });
  }
});

// Get a review by ID
router.get('/:id', validateUser, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)
      .populate('reviewerId reciverId serviceId');
    if (!review) return res.status(404).json({ error: 'Review not found' });
    res.json(review);
  } catch (error) {
    res.status(400).json({ error: 'Invalid review ID' });
  }
});

// Delete a review with notifications
router.delete('/:id', validateUser, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)
      .populate('reciverId', 'notifications');
    
    if (!review) return res.status(404).json({ error: 'Review not found' });

    // Create notification about review deletion
    const notification = {
      title: 'Review Deleted',
      message: 'A review you received has been deleted by the author.',
      type: 'warning',
      link: '/profile/reviews'
    };

    // Add notification before deleting the review
    await User.findByIdAndUpdate(
      review.reciverId._id,
      { $push: { notifications: notification } }
    );

    await review.remove();
    
    // Update the reviewed user's stats after deletion
    await updateUserReviewStats(review.reciverId._id);

    res.json({ message: 'Review deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update review stats for a user
router.get('/user/review-stats', validateUser, async (req, res) => {
  try {
    const userId = req.userId;
    await updateUserReviewStats(userId);
    
    const user = await User.findById(userId);
    res.status(200).json({
      message: 'User review stats updated successfully',
      data: {
        numberOfReviews: user.numberOfReviews,
        averageRating: user.averageRating
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user review stats' });
  }
});

module.exports = router;