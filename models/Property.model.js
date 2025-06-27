const mongoose = require('mongoose');
const validator = require('validator');

const propertySchema = new mongoose.Schema({
  userID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User reference is required']
  },
  address: {
    street: {
      type: String,
      required: [true, 'Street address is required'],
      trim: true,
      maxlength: [200, 'Street address cannot exceed 200 characters']
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
      maxlength: [100, 'City name cannot exceed 100 characters']
    },
    province: {
      type: String,
      required: [true, 'province is required'],
      trim: true,
      maxlength: [100, 'province name cannot exceed 100 characters']
    },
    postalCode: {
      type: String,
      required: [true, 'Postal code is required'],
      trim: true,
      maxlength: [20, 'Postal code cannot exceed 20 characters']
    },
    country: {
      type: String,
      required: [false, 'Country is required'],
      default: 'South Africa',
      trim: true
    }
  },
  numberOfBedRooms: {
    type: Number,
    required: [true, 'Number of bedrooms is required'],
    min: [0, 'Bedroom count cannot be negative'],
    max: [20, 'Unrealistically high bedroom count']
  },
  numberOfBathRooms: {
    type: Number,
    required: [true, 'Number of bathrooms is required'],
    min: [0, 'Bathroom count cannot be negative'],
    max: [20, 'Unrealistically high bathroom count']
  },
  numberOfLivingRoomsOrTvRooms: {
    type: Number,
    required: [true, 'Number of living/TV rooms is required'],
    default: 1,
    min: [0, 'Living room count cannot be negative'],
    max: [10, 'Unrealistically high living room count']
  },
  numberOfKitchens: {
    type: Number,
    required: [true, 'Number of kitchens is required'],
    default: 1,
    min: [0, 'Kitchen count cannot be negative'],
    max: [5, 'Unrealistically high kitchen count']
  },
  numberOfGarages: {
    type: Number,
    required: [true, 'Number of garages is required'],
    default: 0,
    min: [0, 'Garage count cannot be negative'],
    max: [10, 'Unrealistically high garage count']
  },
  numberOfStories: {
    type: Number,
    required: [true, 'Number of stories is required'],
    default: 1,
    min: [0, 'Story count cannot be negative'],
    max: [10, 'Unrealistically high story count']
  },
  squareMeters: {
    type: Number,
    min: [10, 'Property too small (minimum 10m²)'],
    max: [5000, 'Unrealistically large property']
  },
  propertyType: {
    type: String,
    enum: [
      'house', 
      'apartment', 
      'townhouse', 
      'villa', 
      'cottage',
      'office',
      'commercial',
      'other'
    ],
    default: 'house'
  },
  additionalInfo: {
    type: String,
    maxlength: [1000, 'Additional info cannot exceed 1000 characters']
  },
  images: {
    type: [String], // Array of image URLs
    validate: {
      validator: function(images) {
        return images.length <= 20; // Maximum 20 images
      },
      message: 'Cannot upload more than 20 images'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// GeoJSON index for location searches
propertySchema.index({ 'address.coordinates': '2dsphere' });

// Virtual for full address
propertySchema.virtual('fullAddress').get(function() {
  return `${this.address.street}, ${this.address.city}, ${this.address.state} ${this.address.postalCode}, ${this.address.country}`;
});

// Cascade delete cleaning services when property is deleted
propertySchema.pre('remove', async function(next) {
  await mongoose.model('CleaningService').deleteMany({ propertyID: this._id });
  next();
});

module.exports = mongoose.model('Property', propertySchema);