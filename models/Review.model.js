const mongoose = require('mongoose');
const validator = require('validator');

const reviewSchema = new mongoose.Schema({
  reviewStars: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot exceed 5']
  },
  reviewDate: {
    type: Date,
    default: Date.now
  },
  reviewMessage: {
    type: String,
    required: [true, 'Review message is required'],
    trim: true,
    maxlength: [1000, 'Review cannot exceed 1000 characters'],
    minlength: [4, 'Review must be at least 4 characters']
  },
  reciverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    validate: {
      validator: async function(value) {
        const user = await mongoose.model('User').findById(value);
        return user && user.role !== this.reviewerRole;
      },
      message: 'Receiver must be a valid user or cleaner'
    }
  },
  reviewerId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',
  required: [true, 'Reviewer ID is required'],
    validate: {
      validator: async function(value) {
        const user = await mongoose.model('User').findById(value);
        return user && user.role === this.reviewerRole;
      },
      message: 'Reviewer role does not match user role'
    }
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CleaningService',
    required: [true, 'Service reference is required']
  },
  reviewerRole: {
    type: String,
    required: [true, 'Reviewer role is required'],
    enum: ['cleaner', 'user']
  },
  response: {
    message: {
      type: String,
      maxlength: [1000, 'Response cannot exceed 1000 characters']
    },
    respondedAt: Date
  },
  isVerified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound index to prevent duplicate reviews for same service
reviewSchema.index({ serviceId: 1, reviewerId: 1 }, { unique: true });

// Validate that reviewer is either the cleaner or user from the service
reviewSchema.pre('save', async function (next) {
  const CleaningService = mongoose.model('CleaningService');
  const service = await CleaningService.findById(this.serviceId);

  if (!service) {
    throw new Error('Associated service not found');
  }

  // Add support for services that use `cleanerID` instead of `team`
  const isCleaner =
    this.reviewerRole === 'cleaner' &&
    (service.team?.some(t => t.cleaner.equals(this.reviewerId)) ||
     service.cleanerID?.equals(this.reviewerId));

  const isUser =
    this.reviewerRole === 'user' &&
    service.requestingUserID.equals(this.reviewerId);

  const isValidReviewer = isCleaner || isUser;

  if (!isValidReviewer) {
    throw new Error('Reviewer not authorized to review this service');
  }

  // Set target user/cleaner
  if (this.reviewerRole === 'cleaner') {
    this.userId = service.requestingUserID;
    this.cleanerId = undefined;
  } else {
    this.cleanerId = service.cleanerID || service.team.find(t => t.cleaner.equals(this.reviewerId))?.cleaner;
    this.userId = undefined;
  }

  next();
});

// Update user's average rating when new review is added
reviewSchema.post('save', async function(doc) {
  await calculateAverageRating(doc);
});

// Update user's average rating when review is removed
reviewSchema.post('remove', async function(doc) {
  await calculateAverageRating(doc);
});

async function calculateAverageRating(doc) {
  const User = mongoose.model('User');
  const targetUserId = doc.reviewerRole === 'cleaner' ? doc.userId : doc.cleanerId;
  
  const stats = await mongoose.model('Review').aggregate([
    {
      $match: { 
        $or: [
          { cleanerId: targetUserId },
          { userId: targetUserId }
        ]
      }
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$reviewStars' },
        numberOfReviews: { $sum: 1 }
      }
    }
  ]);

  if (stats.length > 0) {
    await User.findByIdAndUpdate(targetUserId, {
      averageRating: stats[0].averageRating,
      numberOfReviews: stats[0].numberOfReviews
    });
  }
}

module.exports = mongoose.model('Review', reviewSchema);