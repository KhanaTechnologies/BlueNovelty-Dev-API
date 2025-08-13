const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/user');
const CleaningService = require('./../models/CleaningService.model');
const validateUser = require('../utils/validateUser'); // <- Add your middleware
const moment = require('moment');


// CREATE a new cleaning service
router.post('/', validateUser, async (req, res) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId);
    console.log(req.body);
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
    let totalFee = baseFee + extrasTotal;

    // Apply 10% discount for recurring bookings
    const isRecurring = bookingFrequency !== 'once-off';
    if (isRecurring) {
      totalFee = totalFee * 0.9; // 10% discount
    }

    console.log(`User balance: ${user.balance}`);
    console.log(`Total fee (after discount if any): ${totalFee}`);

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
      requestingUserID: userId,
      baseFee,
      serviceFee: totalFee, // Save the final fee to DB
      isRecurring: isRecurring
    });

    const savedService = await newService.save();
    res.status(201).json(savedService);

  } catch (err) {
        if (user) {
      user.numberOfActiveServiceRequests -= 1;
      await user.save().catch(console.error);
    }
    console.error('Failed to create service:', err);
    res.status(400).json({ message: 'Failed to create service', error: err.message });
  }
});






// GET all cleaning services
router.get('/', validateUser, async (req, res) => {
  try {

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
        { cleanerID : req.userId },       // Assigned as cleaner on the team
        { requestingUserID: req.userId }      // The user who requested the service
      ],
      serviceStatus: 'assigned'            // Only assigned services
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
    console.log(service);
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
    console.log('[REQ.BODY]', req.body);

    // Fetch current service before update with populated requestingUserID
    const existing = await CleaningService.findById(req.params.id)
      .populate('requestingUserID', 'name email notifications')
      .populate('cleanerID', 'name email notifications');
    
    console.log('[EXISTING SERVICE]', existing);

    if (!existing) {
      return res.status(404).json({ message: 'Service not found' });
    }

    // Update the service
    const updated = await CleaningService.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('requestingUserID cleanerID');
    
    console.log('[UPDATED SERVICE]', updated);

    // Check checklist items
    const checklist = updated.checklist || [];
    const allTasksCompleted = checklist.length > 0 && checklist.every(task =>
      task.completedCleaner === true && task.completedRequester === true
    );
    console.log('[CHECKLIST]', checklist);
    console.log('[ALL TASKS COMPLETED]', allTasksCompleted);

    // Check if service status just changed
    const statusJustChanged = existing.serviceStatus !== updated.serviceStatus;
    const statusJustCompleted = (
      existing.serviceStatus !== 'completed' && 
      updated.serviceStatus === 'completed'
    );
    console.log('[STATUS JUST COMPLETED]', statusJustCompleted);

    // Handle notifications for status changes
    if (statusJustChanged) {
      let notification;
      const serviceName = updated.name || 'Cleaning Service';
      
      switch(updated.serviceStatus) {
        case 'assigned':
          if (updated.cleanerID) {
            // Decrement active requests counter for the requester
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
          // Notification for requester
          const requesterNotification = {
            title: 'Service Completed',
            message: `Your service "${serviceName}" has been completed. Please review the work.`,
            type: 'success',
            link: `/services/${updated._id}`
          };
          
          // Notification for cleaner
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
    console.log('[SHOULD PAY CLEANER]', shouldPayCleaner);

    if (shouldPayCleaner) {
      // Filter unpaid completed payments
      const unpaidCompletedPayments = updated.payments.filter(p =>
        p.status !== 'completed' && !p.paidToCleaner
      );
      console.log('[UNPAID COMPLETED PAYMENTS]', unpaidCompletedPayments);

      const amountToPay = unpaidCompletedPayments.reduce((sum, p) => sum + p.amount, 0);
      console.log('[AMOUNT TO PAY]', amountToPay);

      if (amountToPay > 0) {
        // Credit the cleaner's balance
        await User.findByIdAndUpdate(
          updated.cleanerID,
          { $inc: { balance: amountToPay } }
        );
        console.log(`[CLEANER ${updated.cleanerID}] credited with ${amountToPay}`);

        // Create payment notification for cleaner
        const paymentNotification = {
          title: 'Payment Received',
          message: `You've received $${amountToPay.toFixed(2)} for completing "${updated.name}".`,
          type: 'success',
          link: `/services/${updated._id}`
        };
        
        await User.findByIdAndUpdate(
          updated.cleanerID._id,
          { $push: { notifications: paymentNotification } }
        );

        // Mark payments as paid
        unpaidCompletedPayments.forEach(p => {
          p.paidToCleaner = true;
        });

        updated.paidToCleaner = true;
        await updated.save();
        console.log('[UPDATED SERVICE AFTER PAYMENT]', updated);
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
  try {
    const userId = req.userId;
    const originalServiceId = req.params.id;

    // Validate the original service ID
    if (!mongoose.isValidObjectId(originalServiceId)) {
      return res.status(400).json({ message: 'Invalid service ID' });
    }

    // Find the original service
    const originalService = await CleaningService.findById(originalServiceId)
      .populate('requestingUserID', 'balance')
      .populate('cleanerID');

    if (!originalService) {
      return res.status(404).json({ message: 'Original service not found' });
    }

    // Verify the requesting user is the same as the original
    if (originalService.requestingUserID._id.toString() !== userId) {
      return res.status(403).json({ message: 'You can only book again your own services' });
    }

    // Verify the original service was completed
    if (originalService.serviceStatus !== 'completed') {
      return res.status(400).json({ 
        message: 'You can only book again completed services',
        currentStatus: originalService.serviceStatus
      });
    }

    // Check user balance
    const user = await User.findById(userId);
    if (user.balance < originalService.serviceFee) {
      return res.status(400).json({
        message: 'Insufficient funds to request this service',
        required: originalService.serviceFee,
        currentBalance: user.balance
      });
    }

    // Create new service based on original
    const newServiceData = {
      ...originalService.toObject(),
      _id: undefined, // Let MongoDB create new ID
      requestedDates: req.body.requestedDates, // New dates from request
      serviceStatus: 'pending',
      cleanerID: originalService.cleanerID, // Keep same cleaner
      cleanerAcceptedRebooking: false, // Reset acceptance flag
      hasBeenRebooked: true, // Mark as rebooked
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
      updatedAt: undefined
    };

    // Deduct funds and increment active requests
    user.balance -= originalService.serviceFee;
    user.numberOfActiveServiceRequests += 1;
    await user.save();

    // Create the new service
    const newService = new CleaningService(newServiceData);
    const savedService = await newService.save();

    // Notify the cleaner (if they were assigned previously)
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
    
    // Rollback user balance and counter if error occurred
    if (user) {
      user.balance += originalService.serviceFee;
      user.numberOfActiveServiceRequests -= 1;
      await user.save().catch(console.error);
    }
    
    res.status(400).json({ message: 'Failed to book again', error: err.message });
  }
});

// ACCEPT REBOOKING - Cleaner accepts a rebooked service
router.put('/:id/accept-rebooking', validateUser, async (req, res) => {
  try {
    const serviceId = req.params.id;
    const cleanerId = req.userId;

    // Validate service ID
    if (!mongoose.isValidObjectId(serviceId)) {
      return res.status(400).json({ message: 'Invalid service ID' });
    }

    // Find the service
    const service = await CleaningService.findById(serviceId)
      .populate('requestingUserID');

    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    // Verify this is a rebooked service
    if (!service.hasBeenRebooked) {
      return res.status(400).json({ message: 'This is not a rebooked service' });
    }

    // Verify the user is the assigned cleaner
    if (service.cleanerID.toString() !== cleanerId) {
      return res.status(403).json({ message: 'Only the assigned cleaner can accept this rebooking' });
    }

    // Update service status
    service.cleanerAcceptedRebooking = true;
    service.serviceStatus = 'assigned';
    const updatedService = await service.save();

    // Decrement requester's active service counter
    await User.findByIdAndUpdate(
      service.requestingUserID._id,
      { $inc: { numberOfActiveServiceRequests: -1 } }
    );

    // Notify the requester
    const requesterNotification = {
      title: 'Rebooking Accepted',
      message: `Your cleaner has accepted your repeat booking request.`,
      type: 'success',
      link: `/services/${service._id}`
    };

    await User.findByIdAndUpdate(
      service.requestingUserID._id,
      { $push: { notifications: requesterNotification } }
    );

    res.status(200).json(updatedService);

  } catch (err) {
    console.error('Failed to accept rebooking:', err);
    res.status(400).json({ message: 'Failed to accept rebooking', error: err.message });
  }
});


// ACCEPT REBOOKING - Cleaner accepts a rebooked service
router.put('/:id/accept-rebooking', validateUser, async (req, res) => {
  try {
    const { accepted } = req.body;
    const serviceId = req.params.id;
    const cleanerId = req.userId;

    // Validate input
    if (typeof accepted !== 'boolean') {
      return res.status(400).json({ message: 'Accepted status must be boolean' });
    }

    if (!mongoose.isValidObjectId(serviceId)) {
      return res.status(400).json({ message: 'Invalid service ID' });
    }

    // Find the service
    const service = await CleaningService.findById(serviceId)
      .populate('requestingUserID')
      .populate('cleanerID');

    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    // Verify permissions
    if (service.cleanerID._id.toString() !== cleanerId) {
      return res.status(403).json({ message: 'Only the assigned cleaner can respond' });
    }

    if (!service.hasBeenRebooked) {
      return res.status(400).json({ message: 'This is not a rebooked service' });
    }

    // Prepare update
    const update = {
      CleanerhasAcceptedRebooking: accepted ? 'Yes' : 'No',
      ...(accepted && { serviceStatus: 'assigned' }) // Only update status if accepted
    };

    const updatedService = await CleaningService.findByIdAndUpdate(
      serviceId,
      { $set: update },
      { new: true }
    );

    // Handle notifications
    const notification = {
      title: accepted ? 'Rebooking Accepted' : 'Rebooking Declined',
      message: accepted 
        ? `Your cleaner has accepted your repeat booking request.` 
        : `Your cleaner has declined your repeat booking request.`,
      type: accepted ? 'success' : 'warning',
      link: `/services/${serviceId}`
    };

    await User.findByIdAndUpdate(
      service.requestingUserID._id,
      { $push: { notifications: notification } }
    );

    // If declined, refund the user
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




module.exports = router;
