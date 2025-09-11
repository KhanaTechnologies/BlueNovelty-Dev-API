const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const moment = require('moment');
const User = require('../models/user');
const CleaningService = require('./../models/CleaningService.model');
const validateUser = require('../utils/validateUser');

// 🧹 Helper: expire/clean stale requests
async function expireStaleRequests(maxAgeHours = 12) {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);

  // Only touch requests that are still open (not completed/cancelled/expired)
  const staleServices = await CleaningService.find({
    createdAt: { $lte: cutoff },
    serviceStatus: { $nin: ['completed', 'cancelled', 'expired'] }
  }).select('_id requestingUserID serviceFee name');

  for (const svc of staleServices) {
    try {
      // 1) Expire the service
      await CleaningService.findByIdAndUpdate(
        svc._id,
        { $set: { serviceStatus: 'expired' } },
        { new: false }
      );

      // 2) Refund the requester and decrement active count (never below 0)
      if (svc.requestingUserID) {
        await User.findByIdAndUpdate(
          svc.requestingUserID,
          {
            $inc: {
              balance: svc.serviceFee || 0,
              numberOfActiveServiceRequests: -1
            },
            $push: {
              notifications: {
                title: 'Request Expired',
                message: `Your service "${svc.name || 'Cleaning Service'}" expired because it was inactive for more than 12 hours. We've refunded your balance.`,
                type: 'warning',
                link: `/services/${svc._id}`
              }
            }
          }
        );

        // Guard against negative active counts
        await User.updateOne(
          { _id: svc.requestingUserID, numberOfActiveServiceRequests: { $lt: 0 } },
          { $set: { numberOfActiveServiceRequests: 0 } }
        );
      }
    } catch (e) {
      // Keep going even if one service fails to update
      console.error('[expireStaleRequests] Failed for service', svc._id, e);
    }
  }

  return staleServices.length;
}


// ====== Cancellation Policy & Helpers ======
const POLICY = {
  CLEANER_CANCEL_LOCK_HOURS: 12,          // cleaner cannot cancel inside this window without penalty
  CLIENT_CANCEL_MIN_HOURS: 3,             // client must cancel >= 3h before TOA
  NO_ACCESS_CLIENT_PENALTY_PCT: 0.50,     // 50% of quoted amount
  CLEANER_LATE_CANCEL_PCT: Number(process.env.LATE_CLEANER_CANCEL_PCT || 0.15), // default 15%
  REASSIGNMENT_NOTIFICATION_BATCH: 10
};

function _getTOA(service) {
  return service.timeOfArrival || service.scheduledFor || service.startTime || service.bookedFor || null;
}
function _hoursUntil(dateish) {
  const t = new Date(dateish);
  return (t.getTime() - Date.now()) / (1000 * 60 * 60);
}
function _hasArrivedOrStarted(service) {
  return Boolean(
    service.cleanerArrived === true ||
    service.cleaningStarted === true ||
    ['in_progress', 'arrived', 'started'].includes(service.serviceStatus)
  );
}
async function _notify(userId, payload) {
  try {
    await User.findByIdAndUpdate(userId, {
      $push: { notifications: { ...payload, createdAt: new Date() } }
    });
  } catch (e) {
    console.error('[notify] failed', userId, e);
  }
}

// Notify available cleaners to step in
async function _attemptReassignCleaner(service) {
  try {
    await CleaningService.findByIdAndUpdate(service._id, { $set: { serviceStatus: 'awaiting_reassignment' } });
  } catch (e) {}

  const candidates = await User.find({
    _id: { $ne: service.cleanerID },
    role: 'cleaner',
    status: 'active'
  })
    .select('_id name email')
    .limit(POLICY.REASSIGNMENT_NOTIFICATION_BATCH);

  const note = {
    title: 'New job available',
    message: `A job needs coverage${service.location ? ' near ' + service.location : ''}. Tap to review and accept.`,
    type: 'job-offer',
    link: `/services/${service._id}`
  };

  await Promise.all(candidates.map(c => _notify(c._id, note)));

  if (service.requestingUserID) {
    await _notify(service.requestingUserID, {
      title: 'We’re finding a replacement cleaner',
      message: 'Your assigned cleaner cancelled. We’re notifying others who can step in.',
      type: 'info',
      link: `/services/${service._id}`
    });
  }

  return candidates.length;
}


// CREATE a new cleaning service
router.post('/', validateUser, async (req, res) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { baseFee = 0, extras = [], bookingFrequency = 'once-off' } = req.body;

    const validExtras = Array.isArray(extras) ? extras : [];
    const extrasTotal = validExtras.reduce((sum, item) => sum + (item.fee || 0), 0);

    let totalFee = baseFee + extrasTotal;

    // Apply 10% discount for recurring bookings
    const isRecurring = bookingFrequency !== 'once-off';
    if (isRecurring) {
      totalFee = totalFee * 0.9; // 10% discount
    }

    if (user.balance < totalFee) {
      return res.status(400).json({
        message: 'Insufficient funds to request this service',
        required: totalFee,
        currentBalance: user.balance
      });
    }

    user.balance -= totalFee;
    user.numberOfActiveServiceRequests += 1; // Increment here
    await user.save();

    const newService = new CleaningService({
      ...req.body,
      requestingUserID: userId,
      baseFee,
      serviceFee: totalFee, // Save the final fee to DB
      isRecurring: isRecurring
    });

    const savedService = await newService.save();
    res.status(201).json(savedService);

  } catch (err) {
    const userId = req.userId;
    try {
      const user = await User.findById(userId);
      if (user) {
        user.numberOfActiveServiceRequests = Math.max(0, (user.numberOfActiveServiceRequests || 0) - 1);
        await user.save();
      }
    } catch (e) {}

    console.error('Failed to create service:', err);
    res.status(400).json({ message: 'Failed to create service', error: err.message });
  }
});

// GET all cleaning services
router.get('/', validateUser, async (req, res) => {
  try {
    
    // Auto-clean before returning the list
    await expireStaleRequests(12);

    const services = await CleaningService.find()
      .populate('team.cleaner', 'name email')
      .populate('requestingUserID cleanerID')
      .populate('checklist.completedBy', 'name email')
      .populate('lastMessage')
      .populate('unreadCounts.user', 'name email');
    res.status(200).json(services);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch services', error: err.message });
  }
});

// GET all pending cleaning services
router.get('/pending', validateUser, async (req, res) => {
  try {
    const services = await CleaningService.find({ serviceStatus: 'pending' })
      .populate('team.cleaner', 'name email')
      .populate('requestingUserID cleanerID')
      .populate('checklist.completedBy', 'name email')
      .populate('lastMessage')
      .populate('unreadCounts.user', 'name email');

    res.status(200).json(services);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch pending services', error: err.message });
  }
});

// GET all assigned cleaning services for the current user (as cleaner or requester)
router.get('/assigned', validateUser, async (req, res) => {
  try {
    const services = await CleaningService.find({
      $or: [
        { cleanerID : req.userId },
        { requestingUserID: req.userId }
      ],
      serviceStatus: 'assigned'
    })
      .populate('team.cleaner', 'name email')
      .populate('requestingUserID cleanerID')
      .populate('checklist.completedBy', 'name email')
      .populate('lastMessage')
      .populate('unreadCounts.user', 'name email');

    res.status(200).json(services);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch assigned services', error: err.message });
  }
});

// --- Arrival Code APIs ---

// Generate (or regenerate) an arrival code — only the requesting user can do this
router.post('/:id/generate-arrival-code', validateUser, async (req, res) => {
  try {
    const { ttlMinutes } = req.body || {};
    const serviceId = req.params.id;

    if (!mongoose.isValidObjectId(serviceId)) {
      return res.status(400).json({ message: 'Invalid service ID' });
    }

    const service = await CleaningService.findById(serviceId).populate('requestingUserID cleanerID');
    if (!service) return res.status(404).json({ message: 'Service not found' });

    if (service.requestingUserID._id.toString() !== req.userId) {
      return res.status(403).json({ message: 'Only the requesting user can generate the arrival code' });
    }

    // Optional: only allow generation when assigned
    if (service.serviceStatus !== 'assigned') {
      return res.status(400).json({ message: 'Arrival code can only be generated when the service is assigned' });
    }

    const minutes = 2; // fixed lifetime
    const code = service.generateArrivalCode(minutes);
    await service.save();

    // TODO: send via SMS/email/push; returning for now
    res.status(200).json({
      message: 'Arrival code generated',
      code,
      expiresAt: service.arrivalVerification.expiresAt
    });
  } catch (err) {
    console.error('Generate arrival code error:', err);
    res.status(400).json({ message: 'Failed to generate arrival code', error: err.message });
  }
});

// Cleaner verifies the arrival code on site
router.post('/:id/verify-arrival', validateUser, async (req, res) => {
  try {
    const serviceId = req.params.id;
    const { code } = req.body;

    if (!mongoose.isValidObjectId(serviceId)) {
      return res.status(400).json({ message: 'Invalid service ID' });
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ message: 'Code is required' });
    }

    const service = await CleaningService.findById(serviceId);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    if (!service.cleanerID || service.cleanerID.toString() !== req.userId) {
      return res.status(403).json({ message: 'Only the assigned cleaner can verify arrival' });
    }

    const result = await service.verifyArrivalCode(code, req.userId);

    try {
      await User.findByIdAndUpdate(service.requestingUserID, {
        $push: {
          notifications: {
            title: 'Cleaner Arrived',
            message: 'Your cleaner has verified arrival using your code. The service is now in progress.',
            type: 'info',
            link: `/services/${service._id}`
          }
        }
      });
    } catch (_) {}

    res.status(200).json({
      message: result.alreadyVerified ? 'Already verified' : 'Arrival verified',
      serviceStatus: service.serviceStatus,
      verifiedAt: service.arrivalVerification?.verifiedAt
    });
  } catch (err) {
    console.error('Verify arrival error:', err);
    res.status(400).json({ message: 'Failed to verify arrival', error: err.message });
  }
});

// --- End Arrival Code APIs ---

// 💡 Make this function available to other files
async function handleStreakLogic(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error('Invalid ID');
  }

  const startOfWeek = moment().startOf('week').toDate();
  const endOfWeek = moment().endOf('week').toDate();

  const services = await CleaningService.find({
    cleanerID: userId,
    serviceStatus: 'completed',
    updatedAt: { $gte: startOfWeek, $lte: endOfWeek },
    'rating.score': { $exists: true }
  }).sort({ updatedAt: 1 });

  if (!services.length) {
    await User.findByIdAndUpdate(userId, { hasAStreak: false });
    return { streak: 'no', message: 'No completed services found in this period.', streakCount: 0 };
  }

  let streakCount = 0;
  let hasStreak = false;

  for (const service of services) {
    if (service.rating.score > 3) {
      streakCount++;
      if (streakCount >= 5) {
        hasStreak = true;
        break;
      }
    } else {
      streakCount = 0;
    }
  }

  await User.findByIdAndUpdate(userId, { hasAStreak: hasStreak });

  return { streak: hasStreak ? 'yes' : 'no', streakCount };
}

router.get('/streak', validateUser, async (req, res) => {
  try {
    const result = await handleStreakLogic(req.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get streak', error: err.message });
  }
});

// GET a single cleaning service by ID
router.get('/:id', validateUser, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });

  try {
    const service = await CleaningService.findById(req.params.id)
      .populate('team.cleaner', 'name email')
      .populate('requestingUserID cleanerID')
      .populate('checklist.completedBy', 'name email')
      .populate('lastMessage')
      .populate('unreadCounts.user', 'name email');
    if (!service) return res.status(404).json({ message: 'Service not found' });
    res.status(200).json(service);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get service', error: err.message });
  }
});

router.put('/:id', validateUser, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid ID' });
  }

  try {
    // Fetch current service before update with populated requestingUserID
    const existing = await CleaningService.findById(req.params.id)
      .populate('requestingUserID', 'name email notifications')
      .populate('cleanerID', 'name email notifications');

    if (!existing) {
      return res.status(404).json({ message: 'Service not found' });
    }

    // Update the service
    const updated = await CleaningService.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('requestingUserID cleanerID');

    // Check checklist items
    const checklist = updated.checklist || [];
    const allTasksCompleted = checklist.length > 0 && checklist.every(task =>
      task.completedCleaner === true && task.completedRequester === true
    );

    // Check if service status just changed
    const statusJustChanged = existing.serviceStatus !== updated.serviceStatus;
    const statusJustCompleted = (
      existing.serviceStatus !== 'completed' && 
      updated.serviceStatus === 'completed'
    );

    // Handle notifications for status changes
    if (statusJustChanged) {
      let notification;
      const serviceName = updated.name || 'Cleaning Service';
      
      switch(updated.serviceStatus) {
        case 'assigned':
          if (updated.cleanerID) {
            await User.findByIdAndUpdate(
              updated.requestingUserID._id,
              { $inc: { numberOfActiveServiceRequests: -1 } }
            );
            notification = {
              title: 'Service Assigned',
              message: `Your service "${serviceName}" has been assigned to a cleaner.`,
              type: 'info',
              link: `/services/${updated._id}`
            };
            await User.findByIdAndUpdate(
              updated.requestingUserID._id,
              { $push: { notifications: notification } }
            );
          }
          break;
          
        case 'in_progress':
          notification = {
            title: 'Service Started',
            message: `Your service "${serviceName}" has started.`,
            type: 'info',
            link: `/services/${updated._id}`
          };
          await User.findByIdAndUpdate(
            updated.requestingUserID._id,
            { $push: { notifications: notification } }
          );
          break;
          
        case 'completed':
          const requesterNotification = {
            title: 'Service Completed',
            message: `Your service "${serviceName}" has been completed. Please review the work.`,
            type: 'success',
            link: `/services/${updated._id}`
          };
          const cleanerNotification = {
            title: 'Job Completed',
            message: `You've completed the service "${serviceName}". Payment will be processed.`,
            type: 'success',
            link: `/services/${updated._id}`
          };
          await User.findByIdAndUpdate(
            updated.requestingUserID._id,
            { $push: { notifications: requesterNotification } }
          );
          if (updated.cleanerID) {
            await User.findByIdAndUpdate(
              updated.cleanerID._id,
              { $push: { notifications: cleanerNotification } }
            );
          }
          break;
          
        case 'cancelled':
          const cancelledNotification = {
            title: 'Service Cancelled',
            message: `The service "${serviceName}" has been cancelled.`,
            type: 'warning',
            link: `/services/${updated._id}`
          };
          const recipients = [updated.requestingUserID._id];
          if (updated.cleanerID) recipients.push(updated.cleanerID._id);
          await User.updateMany(
            { _id: { $in: recipients } },
            { $push: { notifications: cancelledNotification } }
          );
          break;
      }
    }

    const shouldPayCleaner = (allTasksCompleted || statusJustCompleted) && !updated.paidToCleaner;

    if (shouldPayCleaner) {
      const unpaidCompletedPayments = updated.payments.filter(p =>
        p.status !== 'completed' && !p.paidToCleaner
      );
      const amountToPay = unpaidCompletedPayments.reduce((sum, p) => sum + p.amount, 0);

      if (amountToPay > 0) {
        await User.findByIdAndUpdate(
          updated.cleanerID,
          { $inc: { balance: amountToPay } }
        );

        const paymentNotification = {
          title: 'Payment Received',
          message: `You've received $${amountToPay.toFixed(2)} for completing "${updated.name || 'Cleaning Service'}".`,
          type: 'success',
          link: `/services/${updated._id}`
        };
        
        await User.findByIdAndUpdate(
          updated.cleanerID._id,
          { $push: { notifications: paymentNotification } }
        );

        unpaidCompletedPayments.forEach(p => {
          p.paidToCleaner = true;
        });

        updated.paidToCleaner = true;
        await updated.save();
      }
    }

    res.status(200).json(updated);
  } catch (err) {
    console.error('[ERROR]', err);
    res.status(400).json({ message: 'Failed to update service', error: err.message });
  }
});

// BOOK AGAIN - Create a new booking based on a previous service
router.post('/:id/book-again', validateUser, async (req, res) => {
  let user = null;
  let originalService = null;
  try {
    const userId = req.userId;
    const originalServiceId = req.params.id;

    if (!mongoose.isValidObjectId(originalServiceId)) {
      return res.status(400).json({ message: 'Invalid service ID' });
    }

    originalService = await CleaningService.findById(originalServiceId)
      .populate('requestingUserID', 'balance')
      .populate('cleanerID');

    if (!originalService) {
      return res.status(404).json({ message: 'Original service not found' });
    }

    if (originalService.requestingUserID._id.toString() !== userId) {
      return res.status(403).json({ message: 'You can only book again your own services' });
    }

    if (originalService.serviceStatus !== 'completed') {
      return res.status(400).json({ 
        message: 'You can only book again completed services',
        currentStatus: originalService.serviceStatus
      });
    }

    user = await User.findById(userId);
    if (user.balance < originalService.serviceFee) {
      return res.status(400).json({
        message: 'Insufficient funds to request this service',
        required: originalService.serviceFee,
        currentBalance: user.balance
      });
    }

    const newServiceData = {
      ...originalService.toObject(),
      _id: undefined,
      requestedDates: req.body.requestedDates,
      serviceStatus: 'pending',
      cleanerID: originalService.cleanerID,
      cleanerAcceptedRebooking: false,
      hasBeenRebooked: true,
      reviewedByCleaner: false,
      reviewedByRequestingUser: false,
      rating: undefined,
      checklist: originalService.checklist.map(item => ({
        ...item.toObject(),
        _id: undefined,
        completedCleaner: false,
        completedRequester: false,
        completedBy: undefined,
        completedAt: undefined
      })),
      payments: [{
        amount: originalService.serviceFee,
        method: 'cash',
        transactionId: `auto-${Date.now()}`,
        status: 'pending'
      }],
      paidToCleaner: false,
      createdAt: undefined,
      updatedAt: undefined,
      arrivalVerification: undefined
    };

    user.balance -= originalService.serviceFee;
    user.numberOfActiveServiceRequests = (user.numberOfActiveServiceRequests || 0) + 1;
    await user.save();

    const newService = new CleaningService(newServiceData);
    const savedService = await newService.save();

    if (originalService.cleanerID) {
      const notification = {
        title: 'Rebooking Request',
        message: `A previous customer has requested you again for a service. Please accept or decline.`,
        type: 'info',
        link: `/services/${savedService._id}/accept-rebooking`
      };

      await User.findByIdAndUpdate(
        originalService.cleanerID._id,
        { $push: { notifications: notification } }
      );
    }

    res.status(201).json(savedService);

  } catch (err) {
    console.error('Failed to book again:', err);
    if (user && originalService) {
      try {
        user.balance += originalService.serviceFee;
        user.numberOfActiveServiceRequests = Math.max(0, (user.numberOfActiveServiceRequests || 1) - 1);
        await user.save();
      } catch (e) {}
    }
    res.status(400).json({ message: 'Failed to book again', error: err.message });
  }
});

// DELETE a cleaning service
router.delete('/:id', validateUser, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid ID' });

  try {
    const deleted = await CleaningService.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Service not found' });

    res.status(200).json({ message: 'Service deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete service', error: err.message });
  }
});

// accept REBOOKING RESPONSE
router.put('/:id/accept-rebooking', validateUser, async (req, res) => {
  try {
    const { accepted } = req.body;
    const serviceId = req.params.id;
    const cleanerId = req.userId;

    if (typeof accepted !== 'boolean') {
      return res.status(400).json({ message: 'Accepted status must be boolean' });
    }

    if (!mongoose.isValidObjectId(serviceId)) {
      return res.status(400).json({ message: 'Invalid service ID' });
    }

    const service = await CleaningService.findById(serviceId)
      .populate('requestingUserID')
      .populate('cleanerID');

    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    if (service.cleanerID._id.toString() !== cleanerId) {
      return res.status(403).json({ message: 'Only the assigned cleaner can respond' });
    }

    if (!service.hasBeenRebooked) {
      return res.status(400).json({ message: 'This is not a rebooked service' });
    }

    const update = {
      CleanerhasAcceptedRebooking: accepted ? 'Yes' : 'No',
      ...(accepted && { serviceStatus: 'assigned' })
    };

    const updatedService = await CleaningService.findByIdAndUpdate(
      serviceId,
      { $set: update },
      { new: true }
    );

    const notification = {
      title: accepted ? 'Rebooking Accepted' : 'Rebooking Declined',
      message: accepted 
        ? `Your cleaner has accepted your repeat booking request.` 
        : `Your cleaner has declined your repeat booking request. This service can no longer be rebooked.`,
      type: accepted ? 'success' : 'warning',
      link: `/services/${serviceId}`
    };

    await User.findByIdAndUpdate(
      service.requestingUserID._id,
      { $push: { notifications: notification } }
    );

    if (!accepted) {
      await User.findByIdAndUpdate(
        service.requestingUserID._id,
        { 
          $inc: { 
            balance: service.serviceFee,
            numberOfActiveServiceRequests: -1
          } 
        }
      );
    }

    res.status(200).json(updatedService);

  } catch (err) {
    console.error('Failed to process rebooking response:', err);
    res.status(400).json({ message: 'Failed to process response', error: err.message });
  }
});

// MARK SERVICES AS EXPIRED
router.put('/expire-services', validateUser, async (req, res) => {
  try {
    const { serviceIds } = req.body;

    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      return res.status(400).json({ message: 'Invalid service IDs provided' });
    }

    const invalidIds = serviceIds.filter(id => !mongoose.isValidObjectId(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ 
        message: 'Invalid service IDs detected',
        invalidIds
      });
    }

    const result = await CleaningService.updateMany(
      {
        _id: { $in: serviceIds },
        serviceStatus: { $nin: ['completed', 'expired'] }
      },
      {
        $set: { 
          serviceStatus: 'expired'
        }
      }
    );

    res.status(200).json({
      message: 'Services expired successfully',
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount
    });

  } catch (err) {
    console.error('Failed to expire services:', err);
    res.status(500).json({ message: 'Failed to expire services', error: err.message });
  }
});

// ====== Cancellation & No-Access Routes ======

// Cleaner cancels (penalty if inside 12h; trigger reassignment)
router.post('/:id/cancel/cleaner', validateUser, async (req, res) => {
  try {
    const service = await CleaningService.findById(req.params.id);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    if (String(service.cleanerID) !== String(req.userId) && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Not allowed to cancel this job' });
    }

    const toa = _getTOA(service);
    if (!toa) return res.status(422).json({ message: 'Service has no Time of Arrival set' });

    const hrs = _hoursUntil(toa);
    let penaltyAmount = 0;
    if (hrs < POLICY.CLEANER_CANCEL_LOCK_HOURS) {
      penaltyAmount = Math.max(0, Math.round((service.serviceFee || 0) * POLICY.CLEANER_LATE_CANCEL_PCT));
    }

    await CleaningService.findByIdAndUpdate(service._id, {
      $set: {
        serviceStatus: 'cancelled_by_cleaner',
        cancellation: { by: 'cleaner', at: new Date(), lateWindowHours: POLICY.CLEANER_CANCEL_LOCK_HOURS, penaltyAmount }
      }
    });

    if (penaltyAmount > 0 && service.cleanerID) {
      await User.findByIdAndUpdate(service.cleanerID, {
        $inc: { balance: -penaltyAmount },
        $push: {
          penalties: { type: 'late_cleaner_cancellation', amount: penaltyAmount, service: service._id, at: new Date() },
          notifications: {
            title: 'Late cancellation penalty',
            message: `You cancelled within ${POLICY.CLEANER_CANCEL_LOCK_HOURS} hours of arrival. A penalty of ${penaltyAmount} has been applied.`,
            type: 'warning',
            link: `/services/${service._id}`
          }
        }
      });
    }

    const notified = await _attemptReassignCleaner(service);

    if (service.requestingUserID) {
      await _notify(service.requestingUserID, {
        title: 'Cleaner cancelled',
        message: `Your cleaner cancelled. We notified ${notified} other cleaner(s) to step in.`,
        type: 'warning',
        link: `/services/${service._id}`
      });
    }

    return res.status(200).json({ message: 'Cleaner cancellation processed', penaltyApplied: penaltyAmount, reassignmentNotifications: notified });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to cancel by cleaner', error: err.message });
  }
});

// Client cancels (≥ 3h before TOA; blocked if arrived/started)
router.post('/:id/cancel/client', validateUser, async (req, res) => {
  try {
    const service = await CleaningService.findById(req.params.id);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    if (String(service.requestingUserID) !== String(req.userId) && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Not allowed to cancel this job' });
    }

    if (_hasArrivedOrStarted(service)) {
      return res.status(409).json({ message: 'Cannot cancel — cleaner has arrived or the cleaning has commenced' });
    }

    const toa = _getTOA(service);
    if (!toa) return res.status(422).json({ message: 'Service has no Time of Arrival set' });

    const hrs = _hoursUntil(toa);
    if (hrs < POLICY.CLIENT_CANCEL_MIN_HOURS) {
      return res.status(409).json({
        message: `Client cancellation must be at least ${POLICY.CLIENT_CANCEL_MIN_HOURS} hours before the Time of Arrival`
      });
    }

    await CleaningService.findByIdAndUpdate(service._id, {
      $set: { serviceStatus: 'cancelled_by_client', cancellation: { by: 'client', at: new Date() } }
    });

    if (service.requestingUserID) {
      await User.findByIdAndUpdate(service.requestingUserID, {
        $inc: { balance: service.serviceFee || 0, numberOfActiveServiceRequests: -1 },
        $push: { notifications: {
          title: 'Booking cancelled',
          message: 'Your booking was cancelled and any applicable fees were refunded.',
          type: 'info',
          link: `/services/${service._id}`
        } }
      });
      await User.updateOne(
        { _id: service.requestingUserID, numberOfActiveServiceRequests: { $lt: 0 } },
        { $set: { numberOfActiveServiceRequests: 0 } }
      );
    }

    return res.status(200).json({ message: 'Client cancellation processed', refund: service.serviceFee || 0 });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to cancel by client', error: err.message });
  }
});

// Client absent / no access at TOA → 50% penalty
router.post('/:id/no-access', validateUser, async (req, res) => {
  try {
    const service = await CleaningService.findById(req.params.id);
    if (!service) return res.status(404).json({ message: 'Service not found' });

    // Assigned cleaner or admin can mark no-access
    if (String(service.cleanerID) !== String(req.userId) && req.user?.role !== 'admin') {
      return res.status(403).json({ message: 'Not allowed to mark no-access' });
    }

    const base = (service.quotedAmount || service.serviceFee || 0);
    const penalty = Math.max(0, Math.round(base * POLICY.NO_ACCESS_CLIENT_PENALTY_PCT));

    await CleaningService.findByIdAndUpdate(service._id, {
      $set: { serviceStatus: 'no_access', noAccess: { at: new Date(), penalty } }
    });

    if (service.requestingUserID) {
      await User.findByIdAndUpdate(service.requestingUserID, {
        $inc: { balance: -penalty },
        $push: {
          penalties: { type: 'client_no_access', amount: penalty, service: service._id, at: new Date() },
          notifications: {
            title: 'No access fee applied',
            message: `We could not access the property at the scheduled time. A 50% fee of ${penalty} has been charged.`,
            type: 'warning',
            link: `/services/${service._id}`
          }
        }
      });
    }

    return res.status(200).json({ message: 'No access recorded', penaltyApplied: penalty });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to record no-access', error: err.message });
  }
});


module.exports = { router, handleStreakLogic };
