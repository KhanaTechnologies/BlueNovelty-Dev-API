// routes/messages.js
const express = require('express');
const Message = require('../models/Message.model');
const authJwt = require('../helpers/jwt');
const validateUser = require('../utils/validateUser');
const User = require('../models/user');
const CleaningService = require('../models/CleaningService.model');

const router = express.Router();
router.use(authJwt());

// Create message with notifications
router.post('/', validateUser, async (req, res) => {
  try {
    const senderId = req.userId;
    const { content, service: serviceId, recipients } = req.body;

    // Validate required fields
    if (!content || !serviceId || !recipients?.length) {
      return res.status(400).json({ error: 'Content, service ID, and recipients are required' });
    }

    // Ensure recipients is an array and extract user IDs
    const recipientUserIds = Array.isArray(recipients) 
      ? recipients.map(r => typeof r === 'object' ? r.user : r)
      : [typeof recipients === 'object' ? recipients.user : recipients];

    // Create the message with proper recipient structure
    const message = new Message({
      content,
      service: serviceId,
      sender: senderId,
      recipients: recipientUserIds.map(userId => ({
        user: userId,  // Just the user ID string
        read: false    // Default read status
      }))
    });

    // The rest of your code remains the same...
    const savedMessage = await message.save();

    // Populate and send notifications
    const populatedMessage = await Message.findById(savedMessage._id)
      .populate('sender', 'name')
      .populate('service', 'name')
      .populate('recipients.user', 'name notifications');

    // Notification logic...
    const serviceName = populatedMessage.service?.name || 'the service';
    
    const notificationPromises = populatedMessage.recipients.map(async recipient => {
      if (recipient.user._id.toString() === senderId.toString()) return;

      const notification = {
        title: 'New Message',
        message: `You have a new message from ${populatedMessage.sender.name} regarding ${serviceName}`,
        type: 'info',
        link: `/services/${serviceId}/messages`,
        createdAt: new Date()
      };

      await User.findByIdAndUpdate(
        recipient.user._id,
        { $push: { notifications: notification } }
      );
    });

    await Promise.all(notificationPromises);
    res.status(201).json(savedMessage);

  } catch (error) {
    console.error('Error creating message:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get messages for a service with read status updates
router.get('/service/:serviceId', validateUser, async (req, res) => {
  try {
    const userId = req.userId;
    const serviceId = req.params.serviceId;

    // Get messages and mark them as read for this user
    const messages = await Message.find({ service: serviceId })
      .sort({ createdAt: 1 })
      .populate('sender', 'name profileImage')
      .populate('recipients.user', 'name profileImage');

    // Update read status for the current user
    const updatePromises = messages.map(async message => {
      const recipient = message.recipients.find(r => 
        r.user._id.toString() === userId.toString()
      );
      
      if (recipient && !recipient.read) {
        await Message.updateOne(
          { _id: message._id, 'recipients.user': userId },
          { $set: { 'recipients.$.read': true, 'recipients.$.readAt': new Date() } }
        );
      }
    });

    await Promise.all(updatePromises);

    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Delete a message with notifications
router.delete('/:id', validateUser, async (req, res) => {
  try {
    const userId = req.userId;
    const message = await Message.findById(req.params.id)
      .populate('sender', 'name')
      .populate('recipients.user', 'notifications');

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Only allow sender to delete the message
    if (message.sender._id.toString() !== userId.toString()) {
      return res.status(403).json({ error: 'Only the sender can delete this message' });
    }

    // Notify recipients about message deletion
    const notificationPromises = message.recipients.map(async recipient => {
      // Skip notification if recipient is the sender
      if (recipient.user._id.toString() === userId.toString()) return;

      const notification = {
        title: 'Message Deleted',
        message: `${message.sender.name} has deleted a message`,
        type: 'warning',
        link: `/services/${message.service}/messages`,
        createdAt: new Date()
      };

      await User.findByIdAndUpdate(
        recipient.user._id,
        { $push: { notifications: notification } }
      );
    });

    await Promise.all(notificationPromises);
    await message.remove();

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;