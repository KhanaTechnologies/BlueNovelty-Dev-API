const mongoose = require('mongoose');
const validator = require('validator');

const cleaningServiceSchema = new mongoose.Schema({
  propertyID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Property reference is required']
  },
  serviceType: {
    type: String,
    required: [true, 'Service type is required'],
    enum: [
      'standard', 
      'deep-cleaning', 
      'move-in/move-out', 
      'post-construction',
      'commercial',
      'office',
      'carpet',
      'window'
    ],
    lowercase: true
  },
  extras: {
    type: [{
      name: {
        type: String,
        required: [true, 'Extra service name is required'],
        trim: true
      },
      fee: {
        type: Number,
        required: [true, 'Extra service fee is required'],
        min: [0, 'Fee cannot be negative']
      }
    }],
    default: []
  },
  cleanerID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    validate: {
      validator: async function(value) {
        const user = await mongoose.model('User').findById(value);
        return user && user.role === 'cleaner';
      },
      message: 'Cleaner ID must reference a valid cleaner'
    }
  },
  requestingUserID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Requesting user is required']
  },
  // Add these new fields to track review status
  reviewedByCleaner: {
    type: Boolean,
    default: false
  },
  reviewedByRequestingUser: {
    type: Boolean,
    default: false
  },

  // NEW: Payment Tracking
  payments: [{
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    method: {
      type: String,
      enum: ['credit-card', 'bank-transfer', 'cash', 'mobile-money'],
      required: true
    },
    transactionId: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    paymentDate: {
      type: Date,
      default: Date.now
    },
    receiptUrl: String
  }],

  // NEW: Rating System
  rating: {
    score: {
      type: Number,
      min: 1,
      max: 5
    },
    feedback: {
      type: String,
      maxlength: 500
    },
    ratedAt: Date
  },
  baseFee: {
    type: Number,
    required: [true, 'Base service fee is required'],
    min: [0, 'Base fee cannot be negative']
  },
  serviceFee: {
    type: Number,
    default: 0,
    min: [0, 'Service fee cannot be negative']
  },
  paidToCleaner: { type: Boolean, default: false },

  // NEW: Equipment Requirements
  equipmentRequirements: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    providedBy: {
      type: String,
      enum: ['company', 'cleaner', 'customer'],
      required: true
    },
    notes: String
  }],

  // NEW: Team Assignment
  team: [{
    cleaner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    isTeamLead: {
      type: Boolean,
      default: false
    },
    assignedTasks: [String]
  }],

  // NEW: Service Checklist
  checklist: [{
    task: {
      type: String,
      required: true
    },
    completedCleaner: {
      type: Boolean,
      default: false
    },
    completedRequester: {
      type: Boolean,
      default: false
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    completedAt: Date
  }],

  // NEW: Cancellation Policy
  cancellationPolicy: {
    allowed: {
      type: Boolean,
      default: true
    },
    deadlineHours: {
      type: Number,
      default: 24
    },
    refundPercentage: {
      type: Number,
      default: 80,
      min: 0,
      max: 100
    }
  },

    // NEW: Booking Frequency
  bookingFrequency: {
  type: String,
  enum: ['once-off', 'weekly', 'bi-weekly', 'monthly'],
  default: 'once-off',
  required: true
},


  // NEW: Rebooking Status
  hasBeenRebooked: {
    type: Boolean,
    default: false
  },

  // NEW: Rebooking Status
  CleanerhasAcceptedRebooking: {
    type: String,
    enum: ['Yes', 'No'],
    default: ''
  },

  //NEW : Chat stuff
 requestedDates: [{
  date: {
    type: String, // can change to Date type if validated
    required: true
  },
  timeOfArrival: {
    type: String,
    required: true
  }
}],

  // New fields
isRecurring: {
  type: Boolean,
  default: false
},

discountAmount: {
  type: Number,
  default: 0,
  min: 0,
  max: 100
},


  chatEnabled: {
    type: Boolean,
    default: function() {
      return this.serviceStatus === 'confirmed';
    }
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  serviceStatus: {
    type: String,
    enum: ['pending','assigned', 'completed', 'cancelled','expired'],
    default: 'pending'
  },
  unreadCounts: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    count: {
      type: Number,
      default: 0
    }
  }]
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true } 
});

// Calculate duration for each service date
cleaningServiceSchema.virtual('requestedDates.duration').get(function() {
  if (!Array.isArray(this.requestedDates)) return [];

  return this.requestedDates.map(date => {
    if (!date?.startTime || !date?.endTime) return null;

    const [startH, startM] = date.startTime.split(':').map(Number);
    const [endH, endM] = date.endTime.split(':').map(Number);

    return (endH - startH) + (endM - startM) / 60;
  });
});


// Indexes for performance
cleaningServiceSchema.index({ propertyID: 1 });
cleaningServiceSchema.index({ cleanerID: 1 });
cleaningServiceSchema.index({ requestingUserID: 1 });
cleaningServiceSchema.index({ 'requestedDates.date': 1 });
cleaningServiceSchema.index({ serviceStatus: 1 });

// Auto-generate checklist from extras if checklist is empty
cleaningServiceSchema.pre('save', function(next) {
  // Discount logic
  const isRecurringBooking = this.bookingFrequency && this.bookingFrequency !== 'once-off';

  this.isRecurring = isRecurringBooking; // Sync with flag

  const base = this.baseFee || 0;
  const extrasTotal = this.extras.reduce((sum, extra) => sum + (extra.fee || 0), 0);
  const totalBeforeDiscount = base + extrasTotal;

  // Apply discount
  if (isRecurringBooking) {
    this.discountAmount = totalBeforeDiscount * 0.1; // 10%
  } else {
    this.discountAmount = 0;
  }

  const totalAfterDiscount = totalBeforeDiscount - this.discountAmount;

  // Set serviceFee
  this.serviceFee = totalAfterDiscount;

  // Auto-generate checklist if empty
  if (this.isModified('extras') && (!this.checklist || this.checklist.length === 0)) {
    this.checklist = this.extras.map(extra => ({
      task: extra.name,
      completedCleaner: false,
      completedRequester: false
    }));
  }

  // Initialize payments if not yet set
  if ((!this.payments || this.payments.length === 0) && base != null) {
    this.payments = [{
      amount: totalAfterDiscount,
      method: 'cash', // default
      transactionId: `auto-${Date.now()}`,
      status: 'pending',
      paymentDate: new Date()
    }];
  }

  next();
});



// Virtual: Total Amount Paid
cleaningServiceSchema.virtual('totalAmountPaid').get(function () {
  return this.payments
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + p.amount, 0);
});

// Virtual: Is Fully Paid
cleaningServiceSchema.virtual('isFullyPaid').get(function () {
  return this.totalAmountPaid >= this.serviceFee;
});






module.exports = mongoose.model('CleaningService', cleaningServiceSchema);
