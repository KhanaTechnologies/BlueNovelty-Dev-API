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
    console.log(req.body)
    const userId = req.userId;

    // Merge the userId into the request body explicitly
    const newService = new CleaningService({
      ...req.body,
      requestingUserID: userId
    });

    const savedService = await newService.save();
    console.log(savedService);
    res.status(201).json(savedService);
  } catch (err) {
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


router.get('/streak', validateUser, async (req, res) => {
  
  const cleanerId = req.userId;  // fixed here

  console.log(cleanerId);
   if (!mongoose.isValidObjectId(cleanerId))
     return res.status(400).json({ message: 'Invalid ID' });

  try {
    const startOfWeek = moment().startOf('week').toDate();
    const endOfWeek = moment().endOf('week').toDate();

    const services = await CleaningService.find({
      cleanerID: cleanerId,  // fixed here (was userId)
      serviceStatus: 'completed',
      updatedAt: { $gte: startOfWeek, $lte: endOfWeek },
      'rating.score': { $exists: true }
    }).sort({ updatedAt: 1 });

    if (!services.length) {
      await User.findByIdAndUpdate(cleanerId, { hasAStreak: false });
      return res.json({ streak: 'no', message: 'No completed services found in this period.' });
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

    await User.findByIdAndUpdate(cleanerId, { hasAStreak: hasStreak });

    res.json({ streak: hasStreak ? 'yes' : 'no', streakCount });
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
