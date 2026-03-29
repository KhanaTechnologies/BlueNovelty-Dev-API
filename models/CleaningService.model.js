const mongoose = require('mongoose');
const validator = require('validator');
const crypto = require('crypto');

const cloneChecklist = (checklist = []) =>
  checklist.map(item => ({
    task: item.task,
    completedCleaner: false,
    completedRequester: false
  }));

const buildChecklistFromService = (serviceData = {}) => {
  const tasks = [];
  const serviceType = String(serviceData.serviceType || '').toLowerCase();
  const extras = Array.isArray(serviceData.extras) ? serviceData.extras : [];

  const addTask = (task) => {
    if (!task) return;
    if (!tasks.find(existing => existing.task === task)) {
      tasks.push({
        task,
        completedCleaner: false,
        completedRequester: false
      });
    }
  };

  if (serviceType === 'commercial' || serviceType === 'office') {
    addTask('Clean and sanitize work areas, desks, and shared surfaces');
    addTask('Sweep, vacuum, and mop office floors');
    addTask('Clean restrooms and restock essentials if provided');
    addTask('Empty bins and remove trash');
  } else if (serviceType === 'deep-cleaning') {
    addTask('Sweep, vacuum, and mop all floors');
    addTask('Dust and wipe all reachable surfaces');
    addTask('Deep clean kitchen surfaces, sink, and exterior appliances');
    addTask('Deep clean bathrooms including toilet, sink, bath, and shower');
    addTask('Tidy bedrooms and living areas');
  } else if (serviceType === 'move-in/move-out') {
    addTask('Clean all floors, skirting, and reachable corners');
    addTask('Wipe cupboards, shelves, and built-in storage');
    addTask('Clean kitchen surfaces, sink, and appliance exteriors');
    addTask('Clean bathrooms including toilet, sink, bath, and shower');
    addTask('Remove leftover dirt, dust, and trash from the property');
  } else if (serviceType === 'post-construction') {
    addTask('Remove post-construction dust from surfaces and fixtures');
    addTask('Sweep, vacuum, and mop all floors');
    addTask('Clean windows, frames, and reachable glass surfaces');
    addTask('Clean bathrooms and sanitize high-touch areas');
    addTask('Dispose of light construction debris and trash');
  } else if (serviceType === 'window') {
    addTask('Clean interior windows and remove visible marks');
    addTask('Wipe window sills and frames');
  } else if (serviceType === 'carpet') {
    addTask('Vacuum carpeted areas thoroughly');
    addTask('Spot clean visible carpet stains where possible');
  } else {
    addTask('Sweep, vacuum, and mop all floors');
    addTask('Dust and wipe surfaces in living areas and bedrooms');
    addTask('Clean bathrooms including toilet, sink, bath, and shower');
    addTask('Clean kitchen surfaces, sink, and outside of appliances');
    addTask('Tidy rooms and remove trash');
  }

  extras.forEach(extra => {
    const name = String(extra?.name || '').toLowerCase();

    if (name.includes('laundry')) addTask('Wash and sort laundry items');
    if (name.includes('clothesline') || name.includes('tumble')) addTask('Dry laundry using clothesline or tumble dryer');
    if (name.includes('iron') || name.includes('fold')) addTask('Iron and fold clothes');
    if (name.includes('fridge')) addTask('Clean inside the fridge and return items neatly');
    if (name.includes('cabinet')) addTask('Clean inside cabinets and wipe shelves');
    if (name.includes('window')) addTask('Clean interior windows and wipe frames');
    if (name.includes('wall')) addTask('Remove visible marks and dust from interior walls');
    if (name.includes('oven')) addTask('Clean inside the oven, trays, and racks');
    if (name.includes('garage')) addTask('Sweep and tidy the garage area');
  });

  return tasks;
};

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
  checklistsByDate: {
    type: mongoose.Schema.Types.Mixed,
    default: undefined
  },
  cleanerMarkedComplete: {
    type: Boolean,
    default: false
  },
  cleanerCompletedAt: Date,
  requesterConfirmedAt: Date,

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
    enum: ['scheduled', 'cancelled_by_cleaner', 'cancelled_by_user', 'completed', 'awaiting_reassignment', 'in_progress', 'no_access'],
    default: 'scheduled'
    },
    arrivalStatus: {
      type: String,
      enum: ['not_arrived', 'awaiting_code', 'code_confirmed'],
      default: 'not_arrived'
    },
    arrivalVerification: {
      codeHash: { type: String },
      salt: { type: String },
      generatedAt: { type: Date },
      expiresAt: { type: Date },
      attempts: { type: Number, default: 0 },
      maxAttempts: { type: Number, default: 5 },
      currentCode: { type: String },
      verifiedAt: { type: Date },
      verifiedByCleaner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
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
  recurringSeriesId: {
    type: String,
    index: true
  },
  recurringSeriesLabel: {
    type: String
  },
  recurringOccurrenceIndex: {
    type: Number,
    default: 0
  },
  recurringOccurrenceCount: {
    type: Number,
    default: 1
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
      return this.serviceStatus === 'assigned' || this.serviceStatus === 'in_progress';
    }
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  serviceStatus: {
    type: String,
    enum: [
      'pending',
      'assigned',
      'in_progress',
      'completed',
      'cancelled',
      'expired',
      'awaiting_reassignment',
      'cancelled_by_client',
      'no_access'
    ],
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
    currentCode: { type: String },
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
  const isRecurringSeriesOccurrence = Boolean(this.recurringSeriesId && (this.recurringOccurrenceCount || 0) > 1);
  this.isRecurring = isRecurringBooking; // Sync for multi-date legacy bookings only

  const base = this.baseFee || 0;
  const extrasTotal = (this.extras || []).reduce((sum, extra) => sum + (extra.fee || 0), 0);
  const totalBeforeDiscount = base + extrasTotal;
  const shouldApplyRecurringDiscount = isRecurringBooking || isRecurringSeriesOccurrence;

  // Apply discount
  if (shouldApplyRecurringDiscount) {
    this.discountAmount = totalBeforeDiscount * 0.1; // 10%
  } else {
    this.discountAmount = 0;
  }

  const totalAfterDiscount = totalBeforeDiscount - this.discountAmount;
  this.serviceFee = totalAfterDiscount;

  // Auto checklist
  if (!this.checklist || this.checklist.length === 0) {
    this.checklist = buildChecklistFromService(this);
  }

  if ((!this.checklistsByDate || Object.keys(this.checklistsByDate).length === 0) && Array.isArray(this.requestedDates) && this.requestedDates.length > 1) {
    const baseChecklist = cloneChecklist(this.checklist);
    const checklistsByDate = {};

    this.requestedDates.forEach((_, index) => {
      checklistsByDate[index] = cloneChecklist(baseChecklist);
    });

    this.checklistsByDate = checklistsByDate;
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

const resolveArrivalTarget = (service, dateIndex) => {
  if (service.isRecurring && Array.isArray(service.requestedDates) && service.requestedDates.length > 1) {
    if (typeof dateIndex !== 'number' || !service.requestedDates[dateIndex]) {
      throw new Error('A valid dateIndex is required for recurring services.');
    }

    return service.requestedDates[dateIndex];
  }

  return service;
};

cleaningServiceSchema.methods.generateArrivalCode = function (ttlMinutes = ARRIVAL_DEFAULT_TTL_MIN, dateIndex) {
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'); // 6 digits
  const salt = crypto.randomBytes(16).toString('hex');
  const codeHash = crypto.createHash('sha256').update(salt + code).digest('hex');
  const target = resolveArrivalTarget(this, dateIndex);

  const now = new Date();
  const expires = new Date(now.getTime() + (ttlMinutes * 60 * 1000));

  target.arrivalVerification = {
    codeHash,
    salt,
    generatedAt: now,
    expiresAt: expires,
    attempts: 0,
    maxAttempts: ARRIVAL_MAX_ATTEMPTS,
    currentCode: code,
    verifiedAt: null,
    verifiedByCleaner: null
  };
  target.arrivalStatus = 'awaiting_code';

  return code; // plaintext for display/send only
};

cleaningServiceSchema.methods.verifyArrivalCode = async function (submittedCode, cleanerId, dateIndex) {
  const target = resolveArrivalTarget(this, dateIndex);
  const v = target.arrivalVerification || {};
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
    target.arrivalVerification.verifiedAt = now;
    target.arrivalVerification.verifiedByCleaner = cleanerId || null;
    target.arrivalStatus = 'code_confirmed';

    if (this.serviceStatus === 'assigned') {
      this.serviceStatus = 'in_progress';
      this.chatEnabled = true;
    }

    await this.save();
    return { ok: true, verified: true };
  }

  target.arrivalVerification.attempts = (v.attempts || 0) + 1;
  await this.save();
  const remaining = (target.arrivalVerification.maxAttempts || ARRIVAL_MAX_ATTEMPTS) - target.arrivalVerification.attempts;
  throw new Error(remaining > 0 ? `Invalid code. ${remaining} attempt(s) left.` : 'Too many attempts. Code locked.');
};

module.exports = mongoose.model('CleaningService', cleaningServiceSchema);
