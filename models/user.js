const mongoose = require('mongoose');
const validator = require('validator');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add your first name'],
    trim: true,
    maxlength: [50, 'Name cannot exceed 50 characters']
  },
  surname: {
    type: String,
    required: [true, 'Please add your surname'],
    trim: true,
    maxlength: [50, 'Surname cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Please provide your email'],
    unique: true,
    lowercase: true,
    validate: [validator.isEmail, 'Please provide a valid email'],
    maxlength: [100, 'Email cannot exceed 100 characters']
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false // Never show in output
  },
  balance: {
    type: Number,
    default: 0,
    min: [0, 'Balance cannot be negative']
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other', 'prefer-not-to-say'],
    lowercase: true
  },
  dateOfBirth: {
    type: Date,
    validate: {
      validator: function(value) {
        return value < new Date();
      },
      message: 'Birth date must be in the past'
    }
  },
  expertise: {
    type: String,
    maxlength: [200, 'Expertise cannot exceed 200 characters']
  },
  physicalAddress: {
    type: String,
    maxlength: [200, 'Address cannot exceed 200 characters']
  },
  idNumber: {
    type: String,
    unique: true,
    sparse: true,
    maxlength: [50, 'ID number cannot exceed 50 characters']
  },
  idDocument: {
    type: String,
    maxlength: [500, 'Document path too long']
  },
  proofOfResidence: {
    type: String,
    maxlength: [500, 'Document path too long']
  },
  cvOrSupportingDocs: {
    type: [String],
    maxlength: [500, 'Document path too long']
  },
  profileImage: {
    type: String,
    default: 'default.jpg',
    maxlength: [500, 'Image path too long']
  },
  role: {
    type: String,
    enum: ['user', 'cleaner', 'admin', 'moderator'],
    default: 'user'
  },
  hasAStreak: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  averageRating: {
    type: Number,
    default: 0,
    min: [0, 'Rating must be at least 0'],
    max: [5, 'Rating cannot exceed 5']
  },
  numberOfReviews: {
    type: Number,
    default: 0
  },
  phoneNumber: {
    type: String,
    unique: true,
    sparse: true,
    maxlength: [10, 'phone number cannot exceed 10 characters']
  },
  notifications: {
    type: [
      {
        title: {
          type: String,
          required: [true, 'Notification title is required'],
          maxlength: [100, 'Title cannot exceed 100 characters']
        },
        message: {
          type: String,
          required: [true, 'Notification message is required'],
          maxlength: [500, 'Message cannot exceed 500 characters']
        },
        type: {
          type: String,
          enum: ['info', 'warning', 'success', 'error', 'system'],
          default: 'info'
        },
        isRead: {
          type: Boolean,
          default: false
        },
        link: {
          type: String,
          maxlength: [200, 'Link cannot exceed 200 characters']
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ],
    default: []
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Add index for frequently queried fields
userSchema.index({ email: 1 });
userSchema.index({ idNumber: 1 });

// Virtual property for full name
userSchema.virtual('fullName').get(function() {
  return `${this.name} ${this.surname}`;
});

// Document middleware to sanitize data before saving
userSchema.pre('save', function(next) {
  // Trim string fields
  if (this.name) this.name = this.name.trim();
  if (this.surname) this.surname = this.surname.trim();
  if (this.expertise) this.expertise = this.expertise.trim();
  
  next();
});

// Notification helper methods
userSchema.methods.addNotification = function(notification) {
  this.notifications.push(notification);
  return this.save();
};

userSchema.methods.markAllNotificationsAsRead = function() {
  this.notifications.forEach(notification => {
    notification.isRead = true;
  });
  return this.save();
};

userSchema.methods.getUnreadNotifications = function() {
  return this.notifications.filter(notification => !notification.isRead);
};

userSchema.methods.getRecentNotifications = function(limit = 10) {
  return this.notifications
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
};

module.exports = mongoose.model('User', userSchema);