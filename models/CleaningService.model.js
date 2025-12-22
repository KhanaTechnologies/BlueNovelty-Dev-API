const mongoose = require('mongoose');
const validator = require('validator');
const crypto = require('crypto');

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
        if (!value) return true;
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

  // Reviews
  reviewedByCleaner: {
    type: Boolean,
    default: false
  },
  reviewedByRequestingUser: {
    type: Boolean,
    default: false
  },

  // Payments
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
    receiptUrl: String,
    paidToCleaner: { type: Boolean, default: false }
  }],

  // Rating
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

  // Equipment
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

  // Team
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

  // Checklist
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

  // Cancellation
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

  // Booking frequency
  bookingFrequency: {
    type: String,
    enum: ['once-off', 'weekly', 'bi-weekly', 'monthly'],
    default: 'once-off',
    required: true
  },

  // Rebooking
  hasBeenRebooked: {
    type: Boolean,
    default: false
  },
  CleanerhasAcceptedRebooking: {
    type: String,
    enum: ['', 'Yes', 'No'],
    default: ''
  },

  // Chat & dates
  requestedDates: [{
    date: {
      type: String, // consider Date if validated
      required: true
    },
    timeOfArrival: {
      type: String,
      required: true
    },
    startTime: String,
    endTime: String,

    status: {
    type: String,
    enum: ['scheduled', 'cancelled_by_cleaner', 'cancelled_by_user', 'completed'],
    default: 'scheduled'
    },
    cancellation: {
      by: {
        type: String,
        enum: ['cleaner', 'user']
      },
      at: Date,
      penaltyAmount: {
        type: Number,
        default: 0
      }
    }
  }],

  isRecurring: {
    type: Boolean,
    default: false
  },

  discountAmount: {
    type: Number,
    default: 0,
    min: 0,
    max: 1000000
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
    enum: ['pending','assigned','in_progress','completed','cancelled','expired'],
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
  }],

  // --- Proof-of-presence (arrival code) ---
  arrivalVerification: {
    codeHash: { type: String },           // sha256(salt + code)
    salt: { type: String },               // per-code salt
    generatedAt: { type: Date },
    expiresAt: { type: Date },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    verifiedAt: { type: Date },
    verifiedByCleaner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }

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

// Indexes
cleaningServiceSchema.index({ propertyID: 1 });
cleaningServiceSchema.index({ cleanerID: 1 });
cleaningServiceSchema.index({ requestingUserID: 1 });
cleaningServiceSchema.index({ 'requestedDates.date': 1 });
cleaningServiceSchema.index({ serviceStatus: 1 });
cleaningServiceSchema.index({ 'arrivalVerification.expiresAt': 1 });

// Pre-save discount & checklist/payment bootstrapping
cleaningServiceSchema.pre('save', function(next) {
  const isRecurringBooking = this.bookingFrequency && this.bookingFrequency !== 'once-off';
  this.isRecurring = isRecurringBooking; // Sync

  const base = this.baseFee || 0;
  const extrasTotal = (this.extras || []).reduce((sum, extra) => sum + (extra.fee || 0), 0);
  const totalBeforeDiscount = base + extrasTotal;

  // Apply discount
  if (isRecurringBooking) {
    this.discountAmount = totalBeforeDiscount * 0.1; // 10%
  } else {
    this.discountAmount = 0;
  }

  const totalAfterDiscount = totalBeforeDiscount - this.discountAmount;
  this.serviceFee = totalAfterDiscount;

  // Auto checklist
  if (this.isModified('extras') && (!this.checklist || this.checklist.length === 0)) {
    this.checklist = (this.extras || []).map(extra => ({
      task: extra.name,
      completedCleaner: false,
      completedRequester: false
    }));
  }

  // Initialize payments if empty
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

// Virtuals
cleaningServiceSchema.virtual('totalAmountPaid').get(function () {
  return (this.payments || [])
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + p.amount, 0);
});

cleaningServiceSchema.virtual('isFullyPaid').get(function () {
  return this.totalAmountPaid >= this.serviceFee;
});

cleaningServiceSchema.virtual('arrivalVerified').get(function () {
  const v = this.arrivalVerification || {};
  return !!v.verifiedAt;
});

// --- Arrival Code helpers ---
const ARRIVAL_DEFAULT_TTL_MIN = 2;
const ARRIVAL_MAX_ATTEMPTS = 5;

cleaningServiceSchema.methods.generateArrivalCode = function (ttlMinutes = ARRIVAL_DEFAULT_TTL_MIN) {
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'); // 6 digits
  const salt = crypto.randomBytes(16).toString('hex');
  const codeHash = crypto.createHash('sha256').update(salt + code).digest('hex');

  const now = new Date();
  const expires = new Date(now.getTime() + (ttlMinutes * 60 * 1000));

  this.arrivalVerification = {
    codeHash,
    salt,
    generatedAt: now,
    expiresAt: expires,
    attempts: 0,
    maxAttempts: ARRIVAL_MAX_ATTEMPTS,
    verifiedAt: null,
    verifiedByCleaner: null
  };

  return code; // plaintext for display/send only
};

cleaningServiceSchema.methods.verifyArrivalCode = async function (submittedCode, cleanerId) {
  const v = this.arrivalVerification || {};
  const now = new Date();

  if (!v.codeHash || !v.salt || !v.expiresAt) {
    throw new Error('No active arrival code. Ask the customer to generate a new one.');
  }
  if (v.verifiedAt) {
    return { ok: true, alreadyVerified: true };
  }
  if (v.attempts >= (v.maxAttempts || ARRIVAL_MAX_ATTEMPTS)) {
    throw new Error('Too many attempts. Code locked. Ask the customer to generate a new code.');
  }
  if (now > v.expiresAt) {
    throw new Error('Code expired. Ask the customer to generate a new code.');
  }

  const candidate = crypto.createHash('sha256').update(v.salt + submittedCode).digest('hex');

  // timingSafeEqual requires same length buffers; ensure hex -> Buffer
  const ok = candidate.length === v.codeHash.length &&
    crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(v.codeHash, 'hex'));

  if (ok) {
    this.arrivalVerification.verifiedAt = now;
    this.arrivalVerification.verifiedByCleaner = cleanerId || null;

    if (this.serviceStatus === 'assigned') {
      this.serviceStatus = 'in_progress';
      this.chatEnabled = true;
    }

    await this.save();
    return { ok: true, verified: true };
  }

  this.arrivalVerification.attempts = (v.attempts || 0) + 1;
  await this.save();
  const remaining = (this.arrivalVerification.maxAttempts || ARRIVAL_MAX_ATTEMPTS) - this.arrivalVerification.attempts;
  throw new Error(remaining > 0 ? `Invalid code. ${remaining} attempt(s) left.` : 'Too many attempts. Code locked.');
};

module.exports = mongoose.model('CleaningService', cleaningServiceSchema);
