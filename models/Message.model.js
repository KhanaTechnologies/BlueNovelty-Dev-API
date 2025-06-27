const mongoose = require('mongoose');
const Service = require('./CleaningService.model');

const messageSchema = new mongoose.Schema({
  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CleaningService',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipients: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    read: {
      type: Boolean,
      default: false
    },
    readAt: Date
  }],
  content: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  attachments: [{
    url: String,
    type: {
      type: String,
      enum: ['image', 'document', 'other']
    }
  }],
  isSystemMessage: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Indexes for faster querying
messageSchema.index({ service: 1, createdAt: -1 });
messageSchema.index({ 'recipients.user': 1 });

// Middleware to validate participants are part of the service
messageSchema.pre('save', async function (next) {
  const message = this;

  try {
    const service = await Service.findById(message.service);
    if (!service) {
      return next(new Error('Service does not exist'));
    }

    const senderId = message.sender.toString();
    const recipientIds = message.recipients.map(r => r.user.toString());
    const allowedUserIds = [
      service.requestingUserID?.toString(),
      service.cleanerID?.toString()
    ];

    if (!allowedUserIds.includes(senderId)) {
      return next(new Error(`Sender ${senderId} not authorized for this service`));
    }

    for (const recipientId of recipientIds) {
      if (!allowedUserIds.includes(recipientId)) {
        return next(new Error(`Recipient ${recipientId} is not part of the service`));
      }
    }

    next();
  } catch (error) {
    console.error('Validation error:', error.message);
    next(new Error('Validation error: ' + error.message));
  }
});



module.exports = mongoose.model('Message', messageSchema);